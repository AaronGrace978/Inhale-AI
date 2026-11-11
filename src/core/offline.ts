import type { MountedBehavior } from './prompt'
import type { Plan } from './schemas'
import { compressDeterministic } from './compressor'

function duplicateLine(body: string): boolean {
  const seen = new Set<string>()
  for (const line of body.split('\n')) {
    const key = line.trim().toLowerCase()
    if (!key || key.startsWith('#')) continue
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

export function offlinePlan(prompt: string, mounted: MountedBehavior[]): Plan {
  const heavy = mounted.find((shard) => shard.tokenCount > 600 || duplicateLine(shard.body))
  const names = mounted.map((shard) => shard.title)
  return {
    goal: names.length > 0 ? `Answer from ${names.join(', ')}` : 'Answer from the identity core',
    steps: [
      'Read the locked identity core before any shard',
      names.length > 0 ? `Use only ${names.join(' and ')}` : 'Answer without mounting a shard',
      heavy ? 'Propose a shorter shard when rules repeat' : 'Do not rewrite a shard without a reason'
    ],
    needsShardEdit: Boolean(heavy) || /\b(bloat|make it longer|add more detail)\b/i.test(prompt),
    targetShardId: heavy?.id ?? mounted[0]?.id ?? null,
    successCriteria: ['The answer addresses the task', 'No foreign identity is introduced', 'Token bloat is rejected']
  }
}

export function offlineAct(prompt: string, mounted: MountedBehavior[]): string {
  const titles = mounted.map((shard) => shard.title)
  const lead = titles.length
    ? `Offline rehearsal. I stayed Kirby and used ${titles.join(' and ')}.`
    : 'Offline rehearsal. No skill shard matched, so this answer uses the identity core only.'
  const answer = `${lead} Task: ${prompt.trim()}`
  const bloated = /\b(bloat|make it longer|add more detail)\b/i.test(prompt) ? mounted[0] : undefined
  if (bloated) {
    const extra = Array.from({ length: 36 }, (_, index) =>
      `- Extra detail ${index + 1} restates the same rule with more words and no new check.`
    ).join('\n')
    const proposal = {
      shardId: bloated.id,
      markdown: `${bloated.body.trim()}\n${extra}`,
      rationale: 'Requested a longer shard. The gate should reject token bloat.'
    }
    return `<answer>${answer}</answer>\n<proposal>${JSON.stringify(proposal)}</proposal>`
  }
  const repeated = mounted.find((shard) => duplicateLine(shard.body) || shard.tokenCount > 600)
  if (!repeated) return `<answer>${answer}</answer>`
  const distilled = compressDeterministic(repeated.body)
  if (distilled.trim() === repeated.body.trim()) return `<answer>${answer}</answer>`
  const proposal = {
    shardId: repeated.id,
    markdown: distilled.trim(),
    rationale: 'Remove repeated rules and stay inside the token budget.'
  }
  return `<answer>${answer}</answer>\n<proposal>${JSON.stringify(proposal)}</proposal>`
}
