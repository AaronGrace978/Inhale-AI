import { createHash } from 'node:crypto'
import { countTokens } from './tokenizer'
import { keywords, slugify } from './text'
import { parseMarkdown, splitSections, stringifyMarkdown, type Section } from './stripper'

export const SHARD_MIN_TOKENS = 200
export const SHARD_MAX_TOKENS = 500
const TARGET_TOKENS = 360

export interface ShardDraft {
  id: string
  title: string
  body: string
  triggers: string[]
  tokenCount: number
  atomic: boolean
}

interface Piece {
  title: string
  body: string
  tokens: number
  atomic: boolean
}

function ensureHeading(title: string, body: string): string {
  const trimmed = body.trim()
  if (/^#{1,6}\s/m.test(trimmed.split('\n')[0] ?? '')) return `${trimmed}\n`
  return `# ${title}\n\n${trimmed}\n`
}

function pieceFrom(title: string, body: string, atomic: boolean): Piece {
  const withHeading = ensureHeading(title, body)
  return { title, body: withHeading, tokens: countTokens(withHeading), atomic }
}

function splitParagraphs(piece: Piece): Piece[] {
  if (piece.atomic || piece.tokens <= SHARD_MAX_TOKENS) return [piece]
  const heading = piece.body.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ?? piece.title
  const body = piece.body.replace(/^#{1,6}\s+.+\n+/, '')
  const paragraphs = body.split(/\n\n+/).map((part) => part.trim()).filter(Boolean)
  const units = paragraphs.flatMap((paragraph) => explodeUnit(paragraph))
  const groups: string[][] = []
  let current: string[] = []
  let tokens = 0
  const flush = (): void => {
    if (current.length > 0) groups.push(current)
    current = []
    tokens = 0
  }
  for (const unit of units) {
    const unitTokens = countTokens(unit)
    if (tokens > 0 && tokens + unitTokens > SHARD_MAX_TOKENS) flush()
    current.push(unit)
    tokens += unitTokens
    if (tokens >= TARGET_TOKENS) flush()
  }
  flush()
  if (groups.length === 0) return [piece]
  return groups.map((group, index) => {
    const title = groups.length === 1 ? heading : `${heading} ${index + 1}`
    return pieceFrom(title, joinUnits(group), false)
  })
}

function explodeUnit(paragraph: string): string[] {
  if (countTokens(paragraph) <= SHARD_MAX_TOKENS) return [paragraph]
  const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length > 1) return lines
  const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/)
  if (sentences.length > 1) return sentences
  const words = paragraph.split(/\s+/)
  const chunks: string[] = []
  let current: string[] = []
  for (const word of words) {
    current.push(word)
    if (countTokens(current.join(' ')) >= TARGET_TOKENS) {
      chunks.push(current.join(' '))
      current = []
    }
  }
  if (current.length > 0) chunks.push(current.join(' '))
  return chunks
}

function joinUnits(units: string[]): string {
  const glue = units.every((unit) => /^[-*]\s+/.test(unit.trim())) ? '\n' : '\n\n'
  return units.join(glue)
}

function pack(pieces: Piece[]): Piece[][] {
  const groups: Piece[][] = []
  let current: Piece[] = []
  let tokens = 0
  const flush = (): void => {
    if (current.length > 0) groups.push(current)
    current = []
    tokens = 0
  }
  for (const piece of pieces) {
    if (piece.atomic) {
      flush()
      groups.push([piece])
      continue
    }
    if (tokens > 0 && tokens + piece.tokens > SHARD_MAX_TOKENS) flush()
    current.push(piece)
    tokens += piece.tokens
    if (tokens >= SHARD_MIN_TOKENS && tokens >= TARGET_TOKENS) flush()
  }
  flush()
  if (groups.length >= 2) {
    const last = groups[groups.length - 1]
    const lastAtomic = last.some((piece) => piece.atomic)
    const lastTokens = last.reduce((sum, piece) => sum + piece.tokens, 0)
    const previous = groups[groups.length - 2]
    const previousAtomic = previous.some((piece) => piece.atomic)
    const previousTokens = previous.reduce((sum, piece) => sum + piece.tokens, 0)
    if (!lastAtomic && !previousAtomic && lastTokens < SHARD_MIN_TOKENS && previousTokens + lastTokens <= SHARD_MAX_TOKENS) {
      groups.splice(groups.length - 2, 2, previous.concat(last))
    }
  }
  return groups
}

function sectionPieces(section: Section): Piece[] {
  const rendered = stringifyMarkdown(section.nodes).trim()
  if (!rendered) return []
  const atomic = rendered.includes('<!-- inhale:atomic -->')
  const title = section.title || 'Skill'
  return splitParagraphs(pieceFrom(title, rendered, atomic))
}

export function shardMarkdown(markdown: string, source: string): ShardDraft[] {
  const tree = parseMarkdown(markdown)
  const pieces = splitSections(tree).flatMap((section) => sectionPieces(section))
  const groups = pack(pieces.filter((piece) => piece.tokens > 0))
  return groups.map((group, index) => {
    const title = group[0]?.title || 'Skill'
    const body = group
      .map((piece) => piece.body.trim())
      .join('\n\n')
      .replaceAll('<!-- inhale:atomic -->', '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const normalized = ensureHeading(title, body)
    const id = `${slugify(title)}-${createHash('sha256').update(`${source}\n${index}\n${normalized}`).digest('hex').slice(0, 6)}`
    const triggers = keywords(`${title}\n${normalized}`, 10)
    return {
      id,
      title,
      body: normalized,
      triggers,
      tokenCount: countTokens(normalized),
      atomic: group.some((piece) => piece.atomic)
    }
  })
}
