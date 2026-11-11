import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPLETION_URLS, DEFAULT_MODELS, MODEL_CATALOG } from '../src/shared/catalog'
import { alignDiff } from '../src/core/diffview'
import { ingestDocument } from '../src/core/ingest'
import { completeChat, streamChat } from '../src/core/model-client'
import { buildMessages } from '../src/core/prompt'
import { redactSecrets } from '../src/core/redact'
import { SkillRegistry } from '../src/core/registry'
import { routeShards } from '../src/core/router'
import { createFileSealer } from '../src/core/seal'
import { ConfigStore } from '../src/core/config-store'
import { shardMarkdown } from '../src/core/sharder'
import { createAnswerFilter } from '../src/core/stream-filter'
import { lintForeignIdentity, stripPersona } from '../src/core/stripper'
import { countTokens } from '../src/core/tokenizer'
import { compressDeterministic } from '../src/core/compressor'
import { runSandboxedJs } from '../src/core/sandbox'
import { verifyMutation } from '../src/core/verifier'
import { SECURE_WEB_PREFERENCES } from '../src/main/security'
import { runPlanActVerify, type EditCommit } from '../src/core/pav'
import { applyWorkspaceBuild, resolveWorkspacePath } from '../src/core/workspace'
import type { TelemetryEvent } from '../src/shared/types'

const roots: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'inhale-'))
  roots.push(directory)
  return directory
}

function section(title: string, target = 340): string {
  const sentence = `When handling ${title}, record the observation, name the next check, and stop if the signal is missing.`
  let body = `# ${title}\n\n`
  let index = 0
  while (countTokens(body) < target) {
    body += `${sentence} Case ${index} stays specific to ${title}.\n\n`
    index += 1
  }
  return body
}

describe('persona stripper', () => {
  it('drops vendor identity, catalogs, and claim lines while keeping procedure', () => {
    const source = `---
name: Claude
vendor: Anthropic
---

# You are Claude

You are Claude, a helpful assistant built by Anthropic.

## Product catalog

| Model | Vendor | Price |
| --- | --- | --- |
| Claude | Anthropic | 15 |

## Reproduce a failure

- Write the smallest failing test first.
- You are allowed to retry a flaky step once.
- If you are unsure which commit broke it, bisect.
- Call OpenAI only after the failure is named.

You are a helpful assistant. Never skip the log.
`
    const report = stripPersona(source)
    expect(report.markdown.toLowerCase()).not.toContain('claude')
    expect(report.markdown.toLowerCase()).not.toContain('anthropic')
    expect(report.markdown.toLowerCase()).not.toContain('openai')
    expect(report.markdown).toContain('smallest failing test')
    expect(report.markdown).toContain('allowed to retry')
    expect(report.markdown).toContain('bisect')
    expect(report.markdown).not.toContain('|')
    expect(report.removedClaims).toBeGreaterThan(0)
    expect(lintForeignIdentity(report.markdown).claims).toBe(0)
    expect(lintForeignIdentity(report.markdown).vendors).toEqual([])
  })
})

describe('sharder', () => {
  it('packs executable sections into the 200 to 500 token band', () => {
    const markdown = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((title) => section(title)).join('\n')
    const shards = shardMarkdown(markdown, 'playbook.md')
    expect(shards.length).toBeGreaterThanOrEqual(6)
    expect(shards.every((shard) => shard.tokenCount <= 500)).toBe(true)
    expect(shards.every((shard) => shard.tokenCount >= 200)).toBe(true)
    expect(new Set(shards.map((shard) => shard.id)).size).toBe(shards.length)
  })

  it('keeps a short playbook as one shard instead of inventing text', () => {
    const shards = shardMarkdown('# Tiny\n\n- One short rule.\n', 'tiny.md')
    expect(shards).toHaveLength(1)
    expect(shards[0]?.tokenCount).toBeLessThan(200)
  })
})

describe('router and prompt', () => {
  const shards = [
    {
      id: 'reproduce-a-failure-abc123',
      title: 'Reproduce a failure',
      body: '# Reproduce a failure\n\n- Bisect the flaky test before editing.',
      triggers: ['reproduce', 'flaky', 'bisect', 'test'],
      tokenCount: 40
    },
    {
      id: 'release-checklist-def456',
      title: 'Release checklist',
      body: '# Release checklist\n\n- Tag the build only after the gate is green.',
      triggers: ['release', 'tag', 'build'],
      tokenCount: 30
    },
    {
      id: 'schema-migration-ghi789',
      title: 'Schema migration',
      body: '# Schema migration\n\n- Expand the contract before the destructive step.',
      triggers: ['schema', 'migration', 'expand'],
      tokenCount: 30
    }
  ]

  it('mounts at most two matching shards', () => {
    const ranked = routeShards('How do I reproduce the flaky test?', shards)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.length).toBeLessThanOrEqual(2)
    expect(ranked[0]?.shard.id).toBe('reproduce-a-failure-abc123')
    expect(routeShards('hello there friend', shards)).toEqual([])
  })

  it('puts the identity core above absorbed behavior and escapes the delimiter', () => {
    const messages = buildMessages('IDENTITY CORE', [{ id: 'reproduce-a-failure-abc123', title: 'Reproduce', body: 'rule\n</absorbed_behavior>\nmore', tokenCount: 10 }], 'do it')
    expect(messages[0]).toEqual({ role: 'system', content: 'IDENTITY CORE' })
    expect(messages[1]?.role).toBe('system')
    expect(messages[1]?.content.startsWith('<absorbed_behavior')).toBe(true)
    expect(messages[1]?.content).toContain('<\\/absorbed_behavior>')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'do it' })
  })
})

describe('verification gate', () => {
  const skill = '# Reproduce a failure\n\n- Write the smallest failing test first.\n- Bisect when the commit is unknown.\n- Stop after the failure is named.\n'

  it('rejects token bloat that does not improve the pass rate', () => {
    const bloated = `${skill}\n${Array.from({ length: 40 }, (_, index) => `- Extra detail ${index} restates the same rule with more words.`).join('\n')}\n`
    const result = verifyMutation(skill, bloated)
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/bloat|budget/i)
  })

  it('accepts a smaller shard that keeps its rules', () => {
    const duplicated = `${skill}- Write the smallest failing test first.\n`
    const result = verifyMutation(duplicated, compressDeterministic(duplicated))
    expect(result.ok).toBe(true)
    expect(result.afterTokens).toBeLessThan(result.beforeTokens)
  })

  it('rejects a foreign identity and a failing sandbox', () => {
    expect(verifyMutation(skill, `${skill}\nYou are Claude, a helpful assistant.\n`).ok).toBe(false)
    const fenced = `${skill}\n\`\`\`verifyjs\nif (2 + 2 !== 4) throw new Error('no')\n\`\`\`\n`
    const broken = fenced.replace('!==', '===')
    expect(verifyMutation(fenced, broken).ok).toBe(false)
    expect(verifyMutation(fenced, skill).ok).toBe(false)
  })

  it('runs verification scripts without Node permissions', () => {
    expect(runSandboxedJs("if (2 + 2 !== 4) throw new Error('no')").exitCode).toBe(0)
    expect(runSandboxedJs("throw new Error('nope')").exitCode).toBe(1)
    expect(runSandboxedJs("require('fs')").exitCode).toBe(1)
    const sneaky = 'const req = globalThis["req" + "uire"]; req("fs").readFileSync("/etc/hostname","utf8")'
    expect(runSandboxedJs(sneaky).exitCode).toBe(1)
  })
})

describe('plan act verify', () => {
  const skill = '# Reproduce a failure\n\n- Write the smallest failing test first.\n- Bisect when the commit is unknown.\n- Stop after the failure is named.\n'
  const plan = {
    goal: 'Answer from the reproduce shard',
    steps: ['Read the mounted shard'],
    needsShardEdit: false,
    targetShardId: 'reproduce-a-failure-abc123',
    successCriteria: ['The answer names the task']
  }

  function host(act: string, body = skill): { events: TelemetryEvent[]; commits: EditCommit[]; run: Promise<'committed' | 'rejected'> } {
    const events: TelemetryEvent[] = []
    const commits: EditCommit[] = []
    const run = runPlanActVerify({
      requestId: '00000000-0000-4000-8000-000000000001',
      prompt: 'reproduce the flaky test',
      signal: new AbortController().signal,
      mounted: [{ id: 'reproduce-a-failure-abc123', title: 'Reproduce a failure', body, tokenCount: countTokens(body) }],
      emit: (event) => events.push(event),
      plan: async () => plan,
      act: async () => act,
      loadBody: () => body,
      commitBody: (commit) => commits.push(commit),
      distill: null
    })
    return { events, commits, run }
  }

  it('commits an answer and discards a bloated rewrite', async () => {
    const clean = host('<answer>Reproduce the failure before editing.</answer>')
    await expect(clean.run).resolves.toBe('committed')
    expect(clean.commits).toHaveLength(0)
    expect(clean.events.some((event) => event.kind === 'pav' && event.state === 'COMMITTED')).toBe(true)

    const extra = Array.from({ length: 36 }, (_, index) => `- Extra detail ${index} restates the same rule.`).join('\n')
    const bloated = host(`<answer>Still Inhale.</answer><proposal>${JSON.stringify({
      shardId: 'reproduce-a-failure-abc123',
      markdown: `${skill}\n${extra}`,
      rationale: 'Make the shard longer.'
    })}</proposal>`)
    await expect(bloated.run).resolves.toBe('rejected')
    expect(bloated.commits).toHaveLength(0)
    expect(bloated.events.some((event) => event.kind === 'diff' && event.decision === 'REJECTED')).toBe(true)
  })

  it('writes a verified dedupe and rejects a bad plan', async () => {
    const duplicated = `${skill}- Write the smallest failing test first.\n`
    const improved = host(
      `<answer>Kept the distinct rules.</answer><proposal>${JSON.stringify({
        shardId: 'reproduce-a-failure-abc123',
        markdown: compressDeterministic(duplicated).trim(),
        rationale: 'Remove the repeated rule.'
      })}</proposal>`,
      duplicated
    )
    await expect(improved.run).resolves.toBe('committed')
    expect(improved.commits).toHaveLength(1)
    expect(improved.commits[0]?.verification.ok).toBe(true)

    const events: TelemetryEvent[] = []
    const status = await runPlanActVerify({
      requestId: '00000000-0000-4000-8000-000000000002',
      prompt: 'x',
      signal: new AbortController().signal,
      mounted: [],
      emit: (event) => events.push(event),
      plan: async () => ({ goal: '' }),
      act: async () => '<answer>no</answer>',
      loadBody: () => null,
      commitBody: () => {
        throw new Error('should not write')
      },
      distill: null
    })
    expect(status).toBe('rejected')
  })

  it('rejects a build when no folder is open', async () => {
    const closed = host(
      `<answer>Nothing written.</answer><build>${JSON.stringify({
        summary: 'Page',
        files: [{ path: 'index.html', content: '<h1>Inhale</h1>' }]
      })}</build>`
    )
    await expect(closed.run).resolves.toBe('rejected')
    expect(closed.commits).toHaveLength(0)
  })

  it('writes a folder build through the gate', async () => {
    const root = tempDir()
    const events: TelemetryEvent[] = []
    const status = await runPlanActVerify({
      requestId: '00000000-0000-4000-8000-000000000003',
      prompt: 'build a page',
      signal: new AbortController().signal,
      mounted: [],
      emit: (event) => events.push(event),
      plan: async () => ({
        goal: 'Build a page',
        steps: ['Write index.html'],
        needsShardEdit: false,
        targetShardId: null,
        successCriteria: ['The file exists'],
        needsBuild: true,
        verifyCommand: null
      }),
      act: async () =>
        `<answer>Built the page.</answer><build>${JSON.stringify({
          summary: 'Page',
          files: [{ path: 'index.html', content: '<h1>Inhale</h1>\n' }],
          command: null
        })}</build>`,
      loadBody: () => null,
      commitBody: () => {
        throw new Error('should not write a shard')
      },
      distill: null,
      applyBuild: (request) => applyWorkspaceBuild(root, request)
    })
    expect(status).toBe('committed')
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('Inhale')
    expect(events.some((event) => event.kind === 'build' && event.decision === 'COMMITTED')).toBe(true)
  })
})

describe('workspace build', () => {
  const ok = process.platform === 'win32' ? 'exit /b 0' : 'true'
  const bad = process.platform === 'win32' ? 'exit /b 3' : 'false'

  it('keeps a file inside the folder and refuses a path that escapes', async () => {
    const root = tempDir()
    expect(() => resolveWorkspacePath(root, '../outside.txt')).toThrow(/workspace/i)
    const outcome = await applyWorkspaceBuild(root, {
      summary: 'Hello',
      files: [{ path: 'index.html', content: '<h1>Inhale</h1>\n' }],
      delete: [],
      command: null
    })
    expect(outcome.ok).toBe(true)
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('Inhale')
    await expect(
      applyWorkspaceBuild(root, {
        summary: 'Escape',
        files: [{ path: '../outside.txt', content: 'no' }],
        delete: [],
        command: null
      })
    ).rejects.toThrow(/workspace/i)
  })

  it('rolls back when the verify command fails', async () => {
    const root = tempDir()
    writeFileSync(join(root, 'keep.txt'), 'before\n')
    const outcome = await applyWorkspaceBuild(root, {
      summary: 'Replace',
      files: [
        { path: 'keep.txt', content: 'after\n' },
        { path: 'new.txt', content: 'new\n' }
      ],
      delete: [],
      command: bad
    })
    expect(outcome.ok).toBe(false)
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('before\n')
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
    const kept = await applyWorkspaceBuild(root, {
      summary: 'Replace',
      files: [{ path: 'keep.txt', content: 'after\n' }],
      delete: [],
      command: ok
    })
    expect(kept.ok).toBe(true)
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('after\n')
  })
})

describe('credentials and providers', () => {
  it('seals keys and never returns them from the public config', () => {
    const directory = tempDir()
    const store = new ConfigStore(directory, {
      seal: (plain) => ({ scheme: 'test', payload: `box:${plain}` }),
      open: (box) => box.payload.replace(/^box:/, '')
    })
    const view = store.setKey('ollama-cloud', 'sk-ollama-test-key')
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('sk-ollama-test-key')
    expect(serialized).not.toContain('box:')
    expect(view.keys['ollama-cloud']).toBe(true)
    expect(view.endpoints['ollama-cloud']).toBe('https://ollama.com/v1')
    expect(view.endpoints.openrouter).toBe('https://openrouter.ai/api/v1')
    expect(store.getKey('ollama-cloud')).toBe('sk-ollama-test-key')
    expect(store.clearKey('ollama-cloud').keys['ollama-cloud']).toBe(false)
  })

  it('round-trips the local AES seal', () => {
    const sealer = createFileSealer(join(tempDir(), 'master.key'))
    const box = sealer.seal('super-secret-value')
    expect(box.payload).not.toContain('super-secret-value')
    expect(sealer.open(box)).toBe('super-secret-value')
  })

  it('offers only Ollama Cloud and OpenRouter flagships', () => {
    expect(new Set(MODEL_CATALOG.map((model) => model.provider))).toEqual(new Set(['ollama-cloud', 'openrouter']))
    expect(DEFAULT_MODELS['ollama-cloud']).toBe('kimi-k3.1-pro')
    expect(DEFAULT_MODELS.openrouter).toBe('anthropic/claude-opus-5.5')
    expect(MODEL_CATALOG.some((model) => model.id === 'glm-5.3' && model.provider === 'ollama-cloud')).toBe(true)
    expect(MODEL_CATALOG.some((model) => model.id === 'z-ai/glm-5.3-prime')).toBe(true)
    expect(COMPLETION_URLS['ollama-cloud']).toBe('https://ollama.com/v1/chat/completions')
    expect(COMPLETION_URLS.openrouter).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('redacts secrets from provider errors', () => {
    const secret = 'sk-live-secret-value'
    expect(redactSecrets(`Bearer ${secret} failed`, secret)).not.toContain(secret)
  })
})

describe('model client', () => {
  it('streams from the official host and keeps the key out of the body', async () => {
    const secret = 'sk-ollama-live-key'
    const seen: { url?: string; body?: string; authorization?: string } = {}
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      seen.url = url
      seen.body = String(init.body)
      seen.authorization = headers.Authorization
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" Inhale"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      })
      return new Response(stream, { status: 200 })
    })
    const signal = new AbortController().signal
    const text = await streamChat(
      {
        provider: 'ollama-cloud',
        model: 'kimi-k3.1-pro',
        apiKey: secret,
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0,
        maxTokens: 20,
        signal
      },
      () => undefined
    )
    expect(text.content).toBe('Hi Inhale')
    expect(seen.url).toBe('https://ollama.com/v1/chat/completions')
    expect(seen.body).not.toContain(secret)
    expect(seen.authorization).toBe(`Bearer ${secret}`)
    expect(seen.body).toContain('kimi-k3.1-pro')
  })

  it('redacts a key echoed by an error response', async () => {
    const secret = 'sk-openrouter-secret'
    vi.stubGlobal('fetch', async () => new Response(`bad key ${secret}`, { status: 401 }))
    await expect(
      completeChat({
        provider: 'openrouter',
        model: 'anthropic/claude-opus-5.5',
        apiKey: secret,
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0,
        maxTokens: 20,
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/redacted|bad key/i)
    await expect(
      completeChat({
        provider: 'openrouter',
        model: 'anthropic/claude-opus-5.5',
        apiKey: secret,
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0,
        maxTokens: 20,
        signal: new AbortController().signal
      })
    ).rejects.not.toThrow(secret)
  })
})

describe('registry', () => {
  it('writes shards and refuses an unverified mutation', () => {
    const result = ingestDocument('notes.md', section('Notes', 220))
    const registry = new SkillRegistry(tempDir())
    registry.applyIngest(result)
    const record = registry.current().shards[0]
    expect(record).toBeTruthy()
    expect(registry.readBody(record!.id)).toContain('# Notes')
    expect(() => registry.get('../secret')).toThrow(/not safe/i)
    const failed = verifyMutation(record ? registry.readBody(record.id) ?? '' : '', 'nope')
    expect(failed.ok).toBe(false)
    expect(() => registry.commit(record!.id, 'nope', failed, 'bad')).toThrow(/failed verification/i)
  })
})

describe('stream filter and diff', () => {
  it('shows the answer and hides the proposal', () => {
    const filter = createAnswerFilter()
    const first = filter.push('<ans')
    const second = filter.push('wer>Hello</answer><proposal>{"shardId":"a"}</proposal>')
    expect(first + second + filter.flush()).toBe('Hello')
    const hidden = createAnswerFilter()
    expect(hidden.push('<answer>Hi</answer><build>{"summary":"x"}</build>') + hidden.flush()).toBe('Hi')
    const raw = createAnswerFilter()
    expect(raw.push('A plain answer that is definitely longer than eighty characters so the filter releases it.') + raw.flush()).toContain('plain answer')
  })

  it('aligns added and removed lines', () => {
    const diff = alignDiff('one\ntwo\n', 'one\nthree\n')
    expect(diff.rows.some((row) => row.before === 'two' && row.kind !== 'same')).toBe(true)
    expect(diff.rows.some((row) => row.after === 'three')).toBe(true)
  })
})

describe('process boundary', () => {
  it('locks the renderer down in the main process', () => {
    expect(SECURE_WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    })
    const main = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const preload = readFileSync(join(process.cwd(), 'src/preload/index.ts'), 'utf8')
    expect(main).toContain('...SECURE_WEB_PREFERENCES')
    expect(preload).toContain('contextBridge.exposeInMainWorld')
    expect(preload).not.toContain('exposeInMainWorld(\'ipcRenderer\'')
    expect(preload).not.toContain('nodeIntegration')
  })
})

describe('sample playbook', () => {
  it('strips the foreign persona and projects a large context reduction', () => {
    const content = readFileSync(join(process.cwd(), 'resources/examples/foreign-agent-playbook.md'), 'utf8')
    const result = ingestDocument('foreign-agent-playbook.md', content)
    const joined = result.shards.map((shard) => shard.body).join('\n')
    expect(joined.toLowerCase()).not.toContain('claude')
    expect(joined.toLowerCase()).not.toContain('anthropic')
    expect(joined.toLowerCase()).not.toContain('openai')
    expect(result.shards.some((shard) => /reproduc/i.test(shard.title + shard.body))).toBe(true)
    expect(result.diffs.some((diff) => diff.decision === 'COMMITTED')).toBe(true)
    const mounted = routeShards('How should I reproduce a flaky test?', result.shards.map((shard) => ({
      id: shard.id,
      title: shard.title,
      body: shard.body,
      triggers: shard.triggers,
      tokenCount: shard.tokenCount
    })))
    expect(mounted.length).toBeGreaterThan(0)
    expect(mounted.length).toBeLessThanOrEqual(2)
    const active = countTokens(readFileSync(join(process.cwd(), 'resources/identity_core.md'), 'utf8')) + mounted.reduce((sum, entry) => sum + entry.shard.tokenCount, 0)
    expect((result.baselineTokens - active) / result.baselineTokens).toBeGreaterThan(0.8)
  })
})
