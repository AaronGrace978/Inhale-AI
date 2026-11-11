import type { TelemetryEvent } from '../shared/types'
import { needsCompression, compressDeterministic } from './compressor'
import { isCancelled } from './model-client'
import type { MountedBehavior } from './prompt'
import { buildSchema, planSchema, proposalSchema, type BuildRequest, type Plan, type Proposal } from './schemas'
import { dropLeadingFrontmatter, stripWrappingFence } from './text'
import { stripPersona } from './stripper'
import { countTokens } from './tokenizer'
import { verifyAnswer, verifyMutation, type VerifyResult } from './verifier'
import { extractJsonObject } from './json'
import type { BuildOutcome } from './workspace'

export interface EditCommit {
  id: string
  body: string
  verification: VerifyResult
  reason: string
}

export interface PavHost {
  requestId: string
  prompt: string
  signal: AbortSignal
  mounted: MountedBehavior[]
  emit: (event: TelemetryEvent) => void
  plan: () => Promise<unknown>
  act: (plan: Plan) => Promise<string>
  loadBody: (id: string) => string | null
  commitBody: (commit: EditCommit) => void
  distill: ((body: string) => Promise<string | null>) | null
  applyBuild?: (request: BuildRequest) => Promise<BuildOutcome>
}

function stamp(requestId: string, state: 'PLANNING' | 'ACTING' | 'VERIFYING' | 'COMMITTED' | 'REJECTED', detail: string): TelemetryEvent {
  return { kind: 'pav', requestId, state, detail, at: Date.now() }
}

export function parseAct(text: string): {
  answer: string
  proposal: Proposal | null
  hadProposal: boolean
  build: BuildRequest | null
  hadBuild: boolean
} {
  const answerMatch = text.match(/<answer>([\s\S]*?)<\/answer>/i)
  const proposalMatch = text.match(/<proposal>([\s\S]*?)<\/proposal>/i)
  const buildMatch = text.match(/<build>([\s\S]*?)<\/build>/i)
  const answer = (
    answerMatch
      ? answerMatch[1]
      : text.replace(/<proposal>[\s\S]*<\/proposal>/gi, '').replace(/<build>[\s\S]*<\/build>/gi, '')
  ).trim()
  let proposal: Proposal | null = null
  const hadProposal = /<proposal>/i.test(text)
  if (proposalMatch) {
    try {
      const parsed = proposalSchema.safeParse(extractJsonObject(proposalMatch[1] ?? ''))
      proposal = parsed.success ? parsed.data : null
    } catch {
      proposal = null
    }
  }
  let build: BuildRequest | null = null
  const hadBuild = /<build>/i.test(text)
  if (buildMatch) {
    try {
      const parsed = buildSchema.safeParse(extractJsonObject(buildMatch[1] ?? ''))
      build = parsed.success ? parsed.data : null
    } catch {
      build = null
    }
  }
  return { answer, proposal, hadProposal, build, hadBuild }
}

export function normalizeSkill(markdown: string, fallbackTitle: string): string {
  const stripped = stripPersona(dropLeadingFrontmatter(stripWrappingFence(markdown))).markdown.trim()
  if (!stripped) return ''
  const withHeading = /^#{1,6}\s/m.test(stripped) ? stripped : `# ${fallbackTitle}\n\n${stripped}`
  return `${withHeading.trim()}\n`
}

function emitDiff(
  host: PavHost,
  input: {
    shardId: string
    title: string
    before: string
    after: string
    verification: VerifyResult
  }
): void {
  host.emit({
    kind: 'diff',
    requestId: host.requestId,
    shardId: input.shardId,
    title: input.title,
    before: input.before,
    after: input.after,
    decision: input.verification.ok ? 'COMMITTED' : 'REJECTED',
    reasons: input.verification.reasons,
    beforeTokens: input.verification.beforeTokens,
    afterTokens: input.verification.afterTokens,
    beforePassRate: input.verification.beforePassRate,
    afterPassRate: input.verification.afterPassRate
  })
}

async function distillIfNeeded(host: PavHost, shardId: string, title: string): Promise<void> {
  const before = host.loadBody(shardId)
  if (!before || !needsCompression(before)) return
  host.emit(stamp(host.requestId, 'VERIFYING', `Distilling ${title} because it is over 600 tokens.`))
  let candidate = compressDeterministic(before)
  if (needsCompression(candidate) && host.distill) {
    const modeled = await host.distill(before)
    if (modeled?.trim()) candidate = normalizeSkill(modeled, title) || candidate
  }
  if (!candidate.trim() || candidate.trim() === before.trim()) {
    host.emit(stamp(host.requestId, 'VERIFYING', `${title} is still over 600 tokens and distillation made no safe change.`))
    return
  }
  const verification = verifyMutation(before, candidate)
  emitDiff(host, { shardId, title, before, after: candidate, verification })
  if (!verification.ok) return
  host.commitBody({ id: shardId, body: candidate.endsWith('\n') ? candidate : `${candidate}\n`, verification, reason: 'compression pass' })
}

async function applyTurnBuild(host: PavHost, plan: Plan, build: BuildRequest): Promise<'committed' | 'rejected'> {
  if (!host.applyBuild) {
    host.emit(stamp(host.requestId, 'REJECTED', 'Open a folder before files can be written.'))
    return 'rejected'
  }
  const command = plan.verifyCommand ?? build.command
  host.emit(
    stamp(
      host.requestId,
      'VERIFYING',
      command ? `Writing files, then running ${command}.` : 'Writing files inside the open folder.'
    )
  )
  try {
    const outcome = await host.applyBuild({ ...build, command })
    if (host.signal.aborted) {
      const error = new Error('Cancelled.')
      error.name = 'CancelledError'
      throw error
    }
    for (const file of outcome.files) {
      if (file.before === file.after) continue
      const verification: VerifyResult = {
        ok: outcome.ok,
        reasons: outcome.reasons,
        beforeTokens: countTokens(file.before),
        afterTokens: countTokens(file.after),
        beforePassRate: 0,
        afterPassRate: outcome.ok ? 1 : 0,
        checks: []
      }
      emitDiff(host, { shardId: file.path, title: file.path, before: file.before, after: file.after, verification })
    }
    host.emit({
      kind: 'build',
      requestId: host.requestId,
      summary: outcome.summary,
      decision: outcome.ok ? 'COMMITTED' : 'REJECTED',
      command: outcome.command,
      exitCode: outcome.exitCode,
      output: outcome.output,
      reasons: outcome.reasons
    })
    if (!outcome.ok) {
      host.emit(stamp(host.requestId, 'REJECTED', outcome.reasons.join(' ') || 'The build was rolled back.'))
      return 'rejected'
    }
    host.emit(stamp(host.requestId, 'COMMITTED', `Built ${outcome.summary}.`))
    return 'committed'
  } catch (error) {
    if (isCancelled(error) || (error instanceof Error && error.name === 'CancelledError')) throw error
    const detail = error instanceof Error ? error.message : 'The build failed.'
    host.emit(stamp(host.requestId, 'REJECTED', detail))
    return 'rejected'
  }
}

export async function runPlanActVerify(host: PavHost): Promise<'committed' | 'rejected'> {
  const throwIfCancelled = (): void => {
    if (host.signal.aborted) {
      const error = new Error('Cancelled.')
      error.name = 'CancelledError'
      throw error
    }
  }
  throwIfCancelled()
  host.emit(stamp(host.requestId, 'PLANNING', 'Planning the turn before any answer or edit.'))
  let plan: Plan
  try {
    const parsed = planSchema.safeParse(await host.plan())
    throwIfCancelled()
    if (!parsed.success) {
      host.emit(stamp(host.requestId, 'REJECTED', 'The plan did not match the required shape, so nothing was written.'))
      return 'rejected'
    }
    plan = parsed.data
  } catch (error) {
    if (isCancelled(error) || (error instanceof Error && error.name === 'CancelledError')) throw error
    const detail = error instanceof Error ? error.message : 'Planning failed.'
    host.emit(stamp(host.requestId, 'REJECTED', detail))
    return 'rejected'
  }

  const mountedIds = new Set(host.mounted.map((shard) => shard.id))
  if (plan.targetShardId && !mountedIds.has(plan.targetShardId)) {
    plan = { ...plan, targetShardId: null, needsShardEdit: false }
  }
  host.emit(stamp(host.requestId, 'ACTING', plan.goal))
  let raw = ''
  try {
    raw = await host.act(plan)
    throwIfCancelled()
  } catch (error) {
    if (isCancelled(error) || (error instanceof Error && error.name === 'CancelledError')) throw error
    const detail = error instanceof Error ? error.message : 'The act phase failed.'
    host.emit(stamp(host.requestId, 'REJECTED', detail))
    return 'rejected'
  }

  const parsedAct = parseAct(raw)
  host.emit(stamp(host.requestId, 'VERIFYING', 'Checking the answer and any shard edit against the gate.'))
  const answerCheck = verifyAnswer(parsedAct.answer)
  if (!answerCheck.ok) {
    host.emit({ kind: 'chat', requestId: host.requestId, phase: 'error', text: answerCheck.reasons.join(' ') })
    host.emit(stamp(host.requestId, 'REJECTED', answerCheck.reasons.join(' ')))
    return 'rejected'
  }
  host.emit({ kind: 'chat', requestId: host.requestId, phase: 'done', text: parsedAct.answer })

  if (parsedAct.hadProposal && !parsedAct.proposal) {
    host.emit(stamp(host.requestId, 'REJECTED', 'A shard edit was proposed but it was not valid JSON, so the registry was left unchanged.'))
    return 'rejected'
  }
  if (parsedAct.hadBuild && !parsedAct.build) {
    host.emit(stamp(host.requestId, 'REJECTED', 'A build was proposed but it was not valid JSON, so the workspace was left unchanged.'))
    return 'rejected'
  }
  if (parsedAct.proposal && parsedAct.build) {
    host.emit(stamp(host.requestId, 'REJECTED', 'A turn can rewrite a shard or write workspace files, not both. Nothing was written.'))
    return 'rejected'
  }
  if (plan.needsBuild && !parsedAct.build) {
    host.emit(stamp(host.requestId, 'REJECTED', 'The plan said to build, but no files were proposed, so the workspace was left unchanged.'))
    return 'rejected'
  }
  if (parsedAct.build) {
    return applyTurnBuild(host, plan, parsedAct.build)
  }

  if (!parsedAct.proposal) {
    host.emit(stamp(host.requestId, 'COMMITTED', 'Answer kept. No shard edit was proposed.'))
    return 'committed'
  }

  const proposal = parsedAct.proposal
  if (!mountedIds.has(proposal.shardId)) {
    host.emit(stamp(host.requestId, 'REJECTED', 'The proposal targeted a shard that is not mounted.'))
    return 'rejected'
  }
  const current = host.loadBody(proposal.shardId)
  const mounted = host.mounted.find((shard) => shard.id === proposal.shardId)
  if (!current || !mounted) {
    host.emit(stamp(host.requestId, 'REJECTED', 'The mounted shard could not be read.'))
    return 'rejected'
  }
  const after = normalizeSkill(proposal.markdown, mounted.title)
  const verification = verifyMutation(current, after || current)
  const changed = Boolean(after) && after.trim() !== current.trim()
  if (changed) {
    emitDiff(host, { shardId: proposal.shardId, title: mounted.title, before: current, after, verification })
  }
  if (!after || !changed || !verification.ok) {
    host.emit(stamp(host.requestId, 'REJECTED', verification.reasons.join(' ') || 'The shard edit was discarded.'))
    return 'rejected'
  }
  host.commitBody({
    id: proposal.shardId,
    body: after,
    verification,
    reason: proposal.rationale
  })
  await distillIfNeeded(host, proposal.shardId, mounted.title)
  throwIfCancelled()
  host.emit(stamp(host.requestId, 'COMMITTED', `Answer kept. ${mounted.title} passed verification and was written.`))
  return 'committed'
}
