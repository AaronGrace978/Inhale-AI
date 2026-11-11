import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { HistoryEntry, Manifest, ShardRecord, SourceStat } from '../shared/types'
import type { IngestResult } from './ingest'
import type { VerifyResult } from './verifier'
import { assertInside, keywords, splitFrontmatter, yamlQuote } from './text'
import { countTokens } from './tokenizer'

const SHARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function emptyManifest(): Manifest {
  return { version: 1, updatedAt: new Date().toISOString(), shards: [], sources: {} }
}

function writeAtomic(file: string, content: string, mode: number): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, content, { encoding: 'utf8', mode })
  renameSync(temporary, file)
}

function encodeFile(record: Pick<ShardRecord, 'id' | 'title' | 'version' | 'source' | 'tokenCount' | 'triggers'>, body: string): string {
  return [
    '---',
    `id: ${record.id}`,
    `title: ${yamlQuote(record.title)}`,
    `version: ${record.version}`,
    `source: ${yamlQuote(record.source)}`,
    `tokens: ${record.tokenCount}`,
    `triggers: ${yamlQuote(record.triggers.join(', '))}`,
    '---',
    '',
    body.trim(),
    ''
  ].join('\n')
}

export class SkillRegistry {
  private manifest: Manifest

  constructor(private readonly directory: string) {
    mkdirSync(this.directory, { recursive: true })
    mkdirSync(join(this.directory, 'history'), { recursive: true })
    this.manifest = this.readManifest()
  }

  current(): Manifest {
    return structuredClone(this.manifest)
  }

  get(id: string): ShardRecord | undefined {
    this.assertId(id)
    return this.manifest.shards.find((shard) => shard.id === id)
  }

  readBody(id: string): string | null {
    const record = this.get(id)
    if (!record) return null
    const file = this.shardPath(id)
    if (!existsSync(file)) return null
    return splitFrontmatter(readFileSync(file, 'utf8')).body.trim()
  }

  applyIngest(result: IngestResult): Manifest {
    const kept = this.manifest.shards.filter((shard) => shard.source !== result.source)
    for (const shard of this.manifest.shards) {
      if (shard.source !== result.source) continue
      this.removeShardFiles(shard.id)
    }
    const now = new Date().toISOString()
    const committed = new Set(result.diffs.filter((diff) => diff.decision === 'COMMITTED').map((diff) => diff.shardId))
    const created: ShardRecord[] = result.shards.map((shard) => {
      const record: ShardRecord = {
        id: shard.id,
        file: `${shard.id}.md`,
        title: shard.title,
        triggers: shard.triggers,
        tokenCount: shard.tokenCount,
        version: 1,
        source: result.source,
        updatedAt: now,
        history: [
          {
            version: 1,
            at: now,
            reason: committed.has(shard.id) ? 'Ingest compression' : 'Ingest',
            tokenCount: shard.tokenCount,
            decision: committed.has(shard.id) ? 'compressed' : 'ingest'
          }
        ]
      }
      writeAtomic(this.shardPath(shard.id), encodeFile(record, shard.body), 0o644)
      return record
    })
    const sources: Record<string, SourceStat> = {
      ...this.manifest.sources,
      [result.source]: {
        baselineTokens: result.baselineTokens,
        strippedTokens: result.strippedTokens,
        at: now
      }
    }
    this.manifest = {
      version: 1,
      updatedAt: now,
      shards: kept.concat(created),
      sources
    }
    this.persist()
    return this.current()
  }

  commit(id: string, body: string, verification: VerifyResult, reason: string): ShardRecord {
    if (!verification.ok) throw new Error('Refusing to write a shard that failed verification.')
    const existing = this.get(id)
    if (!existing) throw new Error('That skill shard does not exist.')
    const previous = this.readBody(id) ?? ''
    const nextVersion = existing.version + 1
    const historyDir = join(this.directory, 'history', id)
    mkdirSync(historyDir, { recursive: true })
    writeAtomic(join(historyDir, `v${existing.version}.md`), `${previous.trim()}\n`, 0o644)
    const title = body.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() || existing.title
    const tokenCount = countTokens(body)
    const entry: HistoryEntry = {
      version: nextVersion,
      at: new Date().toISOString(),
      reason: reason.slice(0, 240),
      tokenCount,
      decision: reason.toLowerCase().includes('compress') ? 'compressed' : 'committed'
    }
    const history = existing.history.concat(entry).slice(-20)
    const record: ShardRecord = {
      ...existing,
      title,
      triggers: keywords(`${title}\n${body}`, 10),
      tokenCount,
      version: nextVersion,
      updatedAt: entry.at,
      history
    }
    writeAtomic(this.shardPath(id), encodeFile(record, body), 0o644)
    this.manifest = {
      ...this.manifest,
      updatedAt: entry.at,
      shards: this.manifest.shards.map((shard) => (shard.id === id ? record : shard))
    }
    this.persist()
    this.pruneHistory(id, history)
    return structuredClone(record)
  }

  private pruneHistory(id: string, history: HistoryEntry[]): void {
    const keep = new Set(history.map((entry) => entry.version))
    const historyDir = join(this.directory, 'history', id)
    if (!existsSync(historyDir)) return
    for (const name of readdirSync(historyDir)) {
      const match = name.match(/^v(\d+)\.md$/)
      if (!match) continue
      if (!keep.has(Number(match[1]))) unlinkSync(join(historyDir, name))
    }
  }

  private removeShardFiles(id: string): void {
    const file = this.shardPath(id)
    if (existsSync(file)) unlinkSync(file)
    rmSync(join(this.directory, 'history', id), { recursive: true, force: true })
  }

  private persist(): void {
    writeAtomic(join(this.directory, 'manifest.json'), `${JSON.stringify(this.manifest, null, 2)}\n`, 0o644)
  }

  private readManifest(): Manifest {
    const file = join(this.directory, 'manifest.json')
    if (!existsSync(file)) return emptyManifest()
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Manifest>
    if (parsed.version !== 1 || !Array.isArray(parsed.shards) || !parsed.sources) return emptyManifest()
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      shards: parsed.shards,
      sources: parsed.sources
    }
  }

  private assertId(id: string): void {
    if (!SHARD_ID.test(id)) throw new Error('Shard id is not safe.')
  }

  private shardPath(id: string): string {
    this.assertId(id)
    const file = resolve(this.directory, `${id}.md`)
    assertInside(resolve(this.directory), file, sep)
    return file
  }
}
