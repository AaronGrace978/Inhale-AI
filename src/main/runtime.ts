import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { ConfigStore } from '../core/config-store'
import { Mutex } from '../core/mutex'
import { isCancelled, completeChat, streamChat, visibleCompletion } from '../core/model-client'
import { offlineAct, offlinePlan } from '../core/offline'
import { runPlanActVerify, normalizeSkill, type EditCommit } from '../core/pav'
import { buildMessages, type MountedBehavior } from '../core/prompt'
import { actInstruction, distillInstruction, planInstruction } from '../core/prompts'
import { redactSecrets } from '../core/redact'
import { SkillRegistry } from '../core/registry'
import { routeShards } from '../core/router'
import { planSchema, type BuildRequest, type Plan } from '../core/schemas'
import { extractJsonObject } from '../core/json'
import { createAnswerFilter } from '../core/stream-filter'
import { buildSnapshot } from '../core/snapshot'
import { compressDeterministic, needsCompression } from '../core/compressor'
import { verifyMutation } from '../core/verifier'
import { countTokens } from '../core/tokenizer'
import { applyWorkspaceBuild, type BuildOutcome } from '../core/workspace'
import { IngestionPool } from './workers/pool'
import type { GraphSnapshot, ProviderId, TelemetryEvent, TurnResult } from '../shared/types'

export interface RuntimeOptions {
  registry: SkillRegistry
  config: ConfigStore
  identityPath: string
  samplePath: string
  emit: (event: TelemetryEvent) => void
  pool?: IngestionPool
}

export class InhaleRuntime {
  private readonly registry: SkillRegistry
  private readonly config: ConfigStore
  private readonly identityPath: string
  private readonly samplePath: string
  private readonly emit: (event: TelemetryEvent) => void
  private readonly pool: IngestionPool
  private readonly mutex = new Mutex()
  private mounted: Array<{ id: string; score: number }> = []
  private active: { requestId: string; controller: AbortController } | null = null
  private workspace: string | null = null

  constructor(options: RuntimeOptions) {
    this.registry = options.registry
    this.config = options.config
    this.identityPath = options.identityPath
    this.samplePath = options.samplePath
    this.emit = options.emit
    this.pool = options.pool ?? new IngestionPool()
  }

  stop(): void {
    this.active?.controller.abort()
    this.pool.stop()
  }

  snapshot(): GraphSnapshot {
    return buildSnapshot({
      identityTokens: countTokens(this.identity()),
      manifest: this.registry.current(),
      mounted: this.mounted
    })
  }

  async ingestText(filename: string, content: string): Promise<GraphSnapshot> {
    return this.mutex.run(async () => {
      const result = await this.pool.run(filename, content, (stage, detail) => {
        this.emit({ kind: 'ingest', stage, detail, source: filename })
      })
      this.registry.applyIngest(result)
      for (const diff of result.diffs) {
        this.emit({ kind: 'diff', requestId: 'ingest', ...diff })
      }
      this.mounted = []
      this.emit({
        kind: 'ingest',
        stage: 'done',
        detail: `Saved ${result.shards.length} shards from ${result.source}.`,
        source: result.source,
        baselineTokens: result.baselineTokens,
        shardCount: result.shards.length
      })
      return this.publish()
    })
  }

  ingestSample(): Promise<GraphSnapshot> {
    const content = readFileSync(this.samplePath, 'utf8')
    return this.ingestText('foreign-agent-playbook.md', content)
  }

  async runTurn(prompt: string): Promise<TurnResult> {
    const clean = prompt.trim()
    if (!clean) throw new Error('Write a prompt first.')
    return this.mutex.run(() => this.executeTurn(clean))
  }

  cancel(requestId: string): void {
    if (this.active?.requestId === requestId) this.active.controller.abort()
  }

  workspaceInfo(): { path: string | null } {
    return { path: this.workspace }
  }

  setWorkspace(folder: string): { path: string } {
    if (this.active) throw new Error('Wait for the turn to finish before changing folders.')
    const resolved = realpathSync(folder)
    if (!statSync(resolved).isDirectory()) throw new Error('Open a folder, not a file.')
    this.workspace = resolved
    this.emit({ kind: 'workspace', path: resolved })
    return { path: resolved }
  }

  clearWorkspace(): { path: null } {
    if (this.active) throw new Error('Wait for the turn to finish before closing the folder.')
    this.workspace = null
    this.emit({ kind: 'workspace', path: null })
    return { path: null }
  }

  async compressBloated(): Promise<GraphSnapshot> {
    return this.mutex.run(async () => {
      const requestId = randomUUID()
      const heavy = this.registry.current().shards.filter((shard) => shard.tokenCount > 600)
      if (heavy.length === 0) {
        this.emit({
          kind: 'pav',
          requestId,
          state: 'COMMITTED',
          detail: 'No shard is over the 600 token budget.',
          at: Date.now()
        })
        return this.publish()
      }
      const view = this.config.publicView()
      let apiKey = this.config.getKey(view.provider)
      const controller = new AbortController()
      this.active = { requestId, controller }
      try {
        for (const shard of heavy) {
          const before = this.registry.readBody(shard.id)
          if (!before) continue
          this.emit({ kind: 'pav', requestId, state: 'VERIFYING', detail: `Distilling ${shard.title}.`, at: Date.now() })
          let candidate = compressDeterministic(before)
          if (needsCompression(candidate) && apiKey) {
            const messages = buildMessages(this.identity(), [], distillInstruction(before))
            const modeled = visibleCompletion(
              await completeChat({
                provider: view.provider,
                model: view.model,
                apiKey,
                messages,
                temperature: 0,
                maxTokens: 1400,
                signal: controller.signal
              })
            )
            const normalized = normalizeSkill(modeled, shard.title)
            if (normalized) candidate = normalized
          }
          if (candidate.trim() === before.trim()) continue
          const verification = verifyMutation(before, candidate)
          this.emit({
            kind: 'diff',
            requestId,
            shardId: shard.id,
            title: shard.title,
            before,
            after: candidate,
            decision: verification.ok ? 'COMMITTED' : 'REJECTED',
            reasons: verification.reasons,
            beforeTokens: verification.beforeTokens,
            afterTokens: verification.afterTokens,
            beforePassRate: verification.beforePassRate,
            afterPassRate: verification.afterPassRate
          })
          if (verification.ok) {
            this.registry.commit(shard.id, candidate.endsWith('\n') ? candidate : `${candidate}\n`, verification, 'compression pass')
          }
        }
        this.emit({
          kind: 'pav',
          requestId,
          state: 'COMMITTED',
          detail: 'Compression pass finished. Failed edits were discarded.',
          at: Date.now()
        })
        return this.publish()
      } catch (error) {
        if (isCancelled(error)) {
          this.emit({ kind: 'pav', requestId, state: 'REJECTED', detail: 'Compression was cancelled.', at: Date.now() })
          return this.publish()
        }
        const message = redactSecrets(error instanceof Error ? error.message : 'Compression failed.', apiKey ?? undefined)
        this.emit({ kind: 'error', message })
        throw new Error(message)
      } finally {
        apiKey = null
        if (this.active?.requestId === requestId) this.active = null
      }
    })
  }

  readShard(id: string) {
    if (id === 'identity-core') {
      const body = this.identity()
      return {
        id,
        title: 'Identity Core',
        body,
        tokenCount: countTokens(body),
        version: 1,
        triggers: [],
        source: 'identity_core.md',
        locked: true,
        history: []
      }
    }
    const record = this.registry.get(id)
    if (!record) throw new Error('That skill is not in the registry.')
    const body = this.registry.readBody(id)
    if (!body) throw new Error('That skill file is missing.')
    return {
      id: record.id,
      title: record.title,
      body,
      tokenCount: record.tokenCount,
      version: record.version,
      triggers: record.triggers,
      source: record.source,
      locked: false,
      history: record.history
    }
  }

  private async executeTurn(prompt: string): Promise<TurnResult> {
    const requestId = randomUUID()
    const controller = new AbortController()
    this.active = { requestId, controller }
    const view = this.config.publicView()
    let apiKey = this.config.getKey(view.provider)
    const mode = apiKey ? 'cloud' : 'offline'
    try {
      const mounted = this.mountFor(prompt)
      this.emit({ kind: 'turn', requestId, mode, provider: view.provider, model: view.model })
      this.emit({
        kind: 'route',
        mountedIds: mounted.map((shard) => shard.id),
        scores: mounted.map((shard) => ({ id: shard.id, score: this.mounted.find((item) => item.id === shard.id)?.score ?? 0 })),
        baselineTokens: this.snapshot().baselineTokens,
        activeTokens: this.snapshot().activeTokens,
        reduction: this.snapshot().reduction
      })
      this.publish()
      const identity = this.identity()
      const status = await runPlanActVerify({
        requestId,
        prompt,
        signal: controller.signal,
        mounted,
        emit: this.emit,
        plan: () => this.plan(mode, view.provider, view.model, apiKey, identity, mounted, prompt, controller.signal),
        act: (plan) => this.act(mode, view.provider, view.model, apiKey, identity, mounted, prompt, plan, requestId, controller.signal),
        loadBody: (id) => this.registry.readBody(id),
        commitBody: (commit: EditCommit) => {
          this.registry.commit(commit.id, commit.body, commit.verification, commit.reason)
        },
        applyBuild: (request) => this.applyWorkspace(request),
        distill:
          mode === 'cloud' && apiKey
            ? async (body) => {
                const modeled = visibleCompletion(
                  await completeChat({
                    provider: view.provider,
                    model: view.model,
                    apiKey: apiKey as string,
                    messages: buildMessages(identity, [], distillInstruction(body)),
                    temperature: 0,
                    maxTokens: 1400,
                    signal: controller.signal
                  })
                )
                return modeled
              }
            : null
      })
      this.publish()
      return { requestId, status, mode }
    } catch (error) {
      if (isCancelled(error) || controller.signal.aborted) {
        this.emit({ kind: 'chat', requestId, phase: 'error', text: 'Cancelled.' })
        return { requestId, status: 'cancelled', mode }
      }
      const message = redactSecrets(error instanceof Error ? error.message : 'The turn failed.', apiKey ?? undefined)
      this.emit({ kind: 'error', message })
      this.emit({ kind: 'pav', requestId, state: 'REJECTED', detail: message, at: Date.now() })
      return { requestId, status: 'rejected', mode }
    } finally {
      apiKey = null
      if (this.active?.requestId === requestId) this.active = null
    }
  }

  private mountFor(prompt: string): MountedBehavior[] {
    const records = this.registry.current().shards
    const routable = records.flatMap((record) => {
      const body = this.registry.readBody(record.id)
      if (!body) return []
      return [{ id: record.id, title: record.title, body, triggers: record.triggers, tokenCount: record.tokenCount }]
    })
    const ranked = routeShards(prompt, routable, 2)
    this.mounted = ranked.map((entry) => ({ id: entry.shard.id, score: entry.score }))
    return ranked.map((entry) => ({
      id: entry.shard.id,
      title: entry.shard.title,
      body: entry.shard.body,
      tokenCount: entry.shard.tokenCount
    }))
  }

  private async plan(
    mode: 'cloud' | 'offline',
    provider: ProviderId,
    model: string,
    apiKey: string | null,
    identity: string,
    mounted: MountedBehavior[],
    prompt: string,
    signal: AbortSignal
  ): Promise<unknown> {
    if (mode === 'offline' || !apiKey) return offlinePlan(prompt, mounted)
    const messages = buildMessages(identity, mounted, planInstruction(prompt, mounted.map((shard) => shard.id), Boolean(this.workspace)))
    const first = visibleCompletion(
      await completeChat({
        provider,
        model,
        apiKey,
        messages,
        temperature: 0,
        maxTokens: 800,
        json: true,
        signal
      })
    )
    const parsed = parsePlan(first)
    if (parsed) return parsed
    const second = visibleCompletion(
      await completeChat({
        provider,
        model,
        apiKey,
        messages: messages.concat(
          { role: 'assistant', content: first.slice(0, 4000) },
          { role: 'user', content: 'Return only one JSON object with the required keys. Do not solve the task.' }
        ),
        temperature: 0,
        maxTokens: 800,
        json: true,
        signal
      })
    )
    const repaired = parsePlan(second)
    if (!repaired) throw new Error('The plan was not valid JSON.')
    return repaired
  }

  private async act(
    mode: 'cloud' | 'offline',
    provider: ProviderId,
    model: string,
    apiKey: string | null,
    identity: string,
    mounted: MountedBehavior[],
    prompt: string,
    plan: Plan,
    requestId: string,
    signal: AbortSignal
  ): Promise<string> {
    if (mode === 'offline' || !apiKey) return offlineAct(prompt, mounted)
    const filter = createAnswerFilter()
    const result = await streamChat(
      {
        provider,
        model,
        apiKey,
        messages: buildMessages(identity, mounted, actInstruction(prompt, plan)),
        temperature: 0.2,
        maxTokens: plan.needsBuild ? 8000 : 2000,
        signal
      },
      (chunk) => {
        const visible = filter.push(chunk)
        if (visible) this.emit({ kind: 'chat', requestId, phase: 'delta', text: visible })
      }
    )
    const tail = filter.flush()
    if (tail && result.content.trim()) this.emit({ kind: 'chat', requestId, phase: 'delta', text: tail })
    return visibleCompletion(result)
  }

  private publish(): GraphSnapshot {
    const snapshot = this.snapshot()
    this.emit({ kind: 'graph', snapshot })
    return snapshot
  }

  private identity(): string {
    return readFileSync(this.identityPath, 'utf8')
  }

  private async applyWorkspace(request: BuildRequest): Promise<BuildOutcome> {
    if (!this.workspace) throw new Error('Open a folder before files can be written.')
    const apiKey = this.config.getKey(this.config.publicView().provider)
    const outcome = await applyWorkspaceBuild(this.workspace, request, this.active?.controller.signal)
    return {
      ...outcome,
      output: redactSecrets(outcome.output, apiKey ?? undefined),
      reasons: outcome.reasons.map((reason) => redactSecrets(reason, apiKey ?? undefined))
    }
  }
}

function parsePlan(text: string): unknown {
  try {
    const parsed = planSchema.safeParse(extractJsonObject(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
