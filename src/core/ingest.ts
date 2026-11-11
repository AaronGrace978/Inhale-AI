import type { IngestStage } from '../shared/types'
import { compressDeterministic } from './compressor'
import { verifyMutation, type VerifyResult } from './verifier'
import { shardMarkdown, type ShardDraft } from './sharder'
import { stripPersona } from './stripper'
import { keywords, safeSourceName } from './text'
import { countTokens } from './tokenizer'

export interface IngestDiff {
  shardId: string
  title: string
  before: string
  after: string
  decision: 'COMMITTED' | 'REJECTED'
  reasons: string[]
  beforeTokens: number
  afterTokens: number
  beforePassRate: number
  afterPassRate: number
}

export interface IngestResult {
  source: string
  baselineTokens: number
  strippedTokens: number
  removedHeadings: string[]
  removedClaims: number
  shards: ShardDraft[]
  diffs: IngestDiff[]
}

function titleOf(body: string, fallback: string): string {
  return body.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() || fallback
}

function brief(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160)
}

export function ingestDocument(
  filename: string,
  content: string,
  onStage?: (stage: IngestStage, detail: string) => void
): IngestResult {
  if (content.includes('\u0000')) throw new Error('The file contains binary data.')
  const source = safeSourceName(filename)
  onStage?.('received', `Received ${source}.`)
  const baselineTokens = countTokens(content)
  onStage?.('parsed', 'Parsed the markdown AST.')
  const stripped = stripPersona(content)
  if (!stripped.markdown.trim()) {
    throw new Error('Nothing executable remained after the foreign persona was stripped.')
  }
  const claimText =
    stripped.removedClaims > 0
      ? `Removed ${stripped.removedClaims} identity claim${stripped.removedClaims === 1 ? '' : 's'}`
      : ''
  const sectionText =
    stripped.removedHeadings.length > 0
      ? `Dropped ${stripped.removedHeadings.length} foreign section${stripped.removedHeadings.length === 1 ? '' : 's'}`
      : ''
  onStage?.('stripped', [claimText, sectionText].filter(Boolean).join('. ') + (claimText || sectionText ? '.' : 'No foreign persona was found.'))
  const shards = shardMarkdown(stripped.markdown, source)
  if (shards.length === 0) throw new Error('The sharder produced no skills.')
  onStage?.('sharded', `Split the playbook into ${shards.length} skill shard${shards.length === 1 ? '' : 's'}.`)
  const diffs: IngestDiff[] = []
  let compressed = 0
  for (const shard of shards) {
    if (shard.tokenCount <= 600) continue
    const after = compressDeterministic(shard.body)
    if (after.trim() === shard.body.trim()) continue
    const verification: VerifyResult = verifyMutation(shard.body, after)
    const title = titleOf(verification.ok ? after : shard.body, shard.title)
    diffs.push({
      shardId: shard.id,
      title,
      before: shard.body,
      after,
      decision: verification.ok ? 'COMMITTED' : 'REJECTED',
      reasons: verification.reasons,
      beforeTokens: verification.beforeTokens,
      afterTokens: verification.afterTokens,
      beforePassRate: verification.beforePassRate,
      afterPassRate: verification.afterPassRate
    })
    if (!verification.ok) continue
    shard.body = after.endsWith('\n') ? after : `${after}\n`
    shard.title = titleOf(shard.body, shard.title)
    shard.tokenCount = countTokens(shard.body)
    shard.triggers = keywords(`${shard.title}\n${shard.body}`, 10)
    compressed += 1
  }
  onStage?.(
    'compressed',
    compressed > 0 ? `Distilled ${compressed} shard${compressed === 1 ? '' : 's'} that exceeded 600 tokens.` : 'No shard needed compression.'
  )
  onStage?.('manifest', `Indexed ${shards.length} shards from ${brief(source)}.`)
  return {
    source,
    baselineTokens,
    strippedTokens: countTokens(stripped.markdown),
    removedHeadings: stripped.removedHeadings,
    removedClaims: stripped.removedClaims,
    shards,
    diffs
  }
}
