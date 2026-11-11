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

const BUILD = /\b(build|scaffold|create a file|write a file|make a (page|app|site|script))\b/i

export function offlinePlan(prompt: string, mounted: MountedBehavior[]): Plan {
  const heavy = mounted.find((shard) => shard.tokenCount > 600 || duplicateLine(shard.body))
  const names = mounted.map((shard) => shard.title)
  const build = BUILD.test(prompt)
  return {
    goal: build ? 'Build the requested files in the open workspace' : names.length > 0 ? `Answer from ${names.join(', ')}` : 'Answer from the identity core',
    steps: build
      ? ['Keep the paths inside the workspace', 'Write only the files the task names', 'Run a verify command only when the task asks for one']
      : [
          'Read the locked identity core before any shard',
          names.length > 0 ? `Use only ${names.join(' and ')}` : 'Answer without mounting a shard',
          heavy ? 'Propose a shorter shard when rules repeat' : 'Do not rewrite a shard without a reason'
        ],
    needsShardEdit: !build && (Boolean(heavy) || /\b(bloat|make it longer|add more detail)\b/i.test(prompt)),
    targetShardId: build ? null : heavy?.id ?? mounted[0]?.id ?? null,
    successCriteria: build
      ? ['The files stay inside the workspace', 'A failing command leaves the folder unchanged']
      : ['The answer addresses the task', 'No foreign identity is introduced', 'Token bloat is rejected'],
    needsBuild: build,
    verifyCommand: null
  }
}

export function offlineAct(prompt: string, mounted: MountedBehavior[]): string {
  const titles = mounted.map((shard) => shard.title)
  const lead = titles.length
    ? `Offline rehearsal. I stayed Inhale and used ${titles.join(' and ')}.`
    : 'Offline rehearsal. No skill shard matched, so this answer uses the identity core only.'
  const answer = `${lead} Task: ${prompt.trim()}`
  if (BUILD.test(prompt)) {
    const html = /index\.html/i.test(prompt)
    const file = html
      ? {
          path: 'index.html',
          content:
            '<!doctype html>\n<html>\n<body style="background:#ff6fae;color:#3a1020;font-family:sans-serif">\n<h1>Inhale</h1>\n</body>\n</html>\n'
        }
      : { path: 'inhale-build/hello.txt', content: `Inhale rehearsal\n${prompt.trim()}\n` }
    const build = {
      summary: html ? 'Pink page' : 'Offline rehearsal file',
      files: [file],
      delete: [] as string[],
      command: null
    }
    return `<answer>${answer} I drafted ${file.path} in the open folder.</answer>\n<build>${JSON.stringify(build)}</build>`
  }
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
