import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import type { Content, Root } from 'mdast'

export interface Section {
  depth: number
  title: string
  nodes: Content[]
}

const MODEL_SOURCE =
  'ChatGPT|Claude(?:\\s+\\d+(?:\\.\\d+)?)?|GPT-\\d+(?:\\.\\d+)?(?:-turbo)?|Google\\s+Gemini|Gemini(?:\\s+(?:Pro|Ultra|Flash))?|GitHub\\s+Copilot|Microsoft\\s+Copilot|Copilot|Grok(?:\\s+\\d+)?|Qwen\\d*|Llama(?:\\s+\\d+(?:\\.\\d+)?)?'

const COMPANY_SOURCE = 'OpenAI|Anthropic|xAI|DeepSeek|Cohere|Perplexity|Mistral\\s+AI|Azure\\s+OpenAI|Amazon\\s+Bedrock|Cursor'

function modelPattern(): RegExp {
  return new RegExp(`\\b(?:${MODEL_SOURCE})\\b`, 'g')
}

function companyPattern(): RegExp {
  return new RegExp(`\\b(?:${COMPANY_SOURCE})\\b`, 'g')
}

export function hasVendor(text: string): boolean {
  return new RegExp(`\\b(?:${MODEL_SOURCE}|${COMPANY_SOURCE})\\b`).test(text)
}

export function isIdentitySentence(sentence: string): boolean {
  const trimmed = sentence.trim()
  const starts = /^(you are|you're|you’re|i am|i'm|i’m|my name is)\b/i.test(trimmed)
  const ruleNotPersona = /\b(allowed|able|unsure|expected|required|responsible for|going to|about to|free to|welcome to)\b/i.test(trimmed)
  if (starts && !ruleNotPersona) return true
  if (/\b(acting|role-?play|pretend to be|identify as)\b/i.test(trimmed) && hasVendor(trimmed)) return true
  if (/\b(built|made|created|developed|trained) by\b/i.test(trimmed) && hasVendor(trimmed)) return true
  return false
}

export function isCatalogHeading(title: string): boolean {
  return /\b(product catalog|model catalog|available models|model lineup|plans and pricing|pricing table)\b/i.test(title.trim())
}

export function isForeignHeading(title: string): boolean {
  const trimmed = title.trim()
  if (isIdentitySentence(trimmed)) return true
  if (/^(identity|persona|who you are|about you|character sheet|system persona)\b/i.test(trimmed)) return true
  if (isCatalogHeading(trimmed)) return true
  if (hasVendor(trimmed) && /\b(system prompt|model spec|persona|identity|catalog)\b/i.test(trimmed)) return true
  return false
}

export function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  })
}

export function stringifyMarkdown(nodes: Content[]): string {
  return toMarkdown({ type: 'root', children: nodes }, { extensions: [gfmToMarkdown()] })
}

export function plainText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const record = node as { type?: string; value?: string; children?: unknown[] }
  if (typeof record.value === 'string' && (record.type === 'text' || record.type === 'inlineCode' || record.type === 'code')) {
    return record.value
  }
  if (Array.isArray(record.children)) return record.children.map((child) => plainText(child)).join('')
  return ''
}

export function splitSections(tree: Root): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  for (const node of tree.children) {
    if (node.type === 'heading') {
      current = { depth: node.depth, title: plainText(node).trim(), nodes: [node] }
      sections.push(current)
      continue
    }
    if (!current) {
      current = { depth: 1, title: 'Overview', nodes: [] }
      sections.push(current)
    }
    current.nodes.push(node)
  }
  return sections
}

function isCatalogTable(node: Content): boolean {
  if (node.type !== 'table') return false
  const header = plainText(node.children[0]).toLowerCase()
  return header.includes('model') && (header.includes('price') || header.includes('vendor') || header.includes('provider'))
}

export interface IdentityLint {
  claims: number
  vendors: string[]
  catalogTables: number
}

function withoutFences(markdown: string): string {
  return markdown
    .split(/```[\s\S]*?```/g)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}

export function lintForeignIdentity(markdown: string): IdentityLint {
  const prose = withoutFences(markdown)
  let claims = 0
  for (const line of prose.split('\n')) {
    const content = line.replace(/^\s*[-*]\s+/, '').replace(/^#{1,6}\s+/, '')
    const sentences = content.split(/(?<=[.!?])\s+(?=[A-Z])/)
    for (const sentence of sentences) {
      if (isIdentitySentence(sentence)) claims += 1
    }
  }
  const vendors = new Set<string>()
  for (const match of prose.match(new RegExp(`\\b(?:${MODEL_SOURCE}|${COMPANY_SOURCE})\\b`, 'g')) ?? []) {
    vendors.add(match)
  }
  const catalogTables = (prose.match(/^\|[^\n]*\bmodel\b[^\n]*\|/gim) ?? []).filter((line) =>
    /\b(price|vendor|provider)\b/i.test(line)
  ).length
  return { claims, vendors: [...vendors], catalogTables }
}

function cleanProse(markdown: string): { text: string; removedClaims: number } {
  const lines = markdown.split('\n')
  const kept: string[] = []
  let removedClaims = 0
  for (const line of lines) {
    if (/^\s*$/.test(line) || /^\s*```/.test(line) || /^\|?\s*:?-{3,}/.test(line)) {
      kept.push(line)
      continue
    }
    const heading = line.match(/^(#{1,6}\s+)(.*)$/)
    if (heading) {
      if (isIdentitySentence(heading[2]) || isForeignHeading(heading[2])) {
        removedClaims += 1
        continue
      }
      kept.push(`${heading[1]}${redactVendors(heading[2])}`)
      continue
    }
    const bullet = line.match(/^(\s*[-*]\s+)(.*)$/)
    const prefix = bullet?.[1] ?? ''
    const rest = bullet ? bullet[2] : line
    const sentences = rest.split(/(?<=[.!?])\s+(?=[A-Z])/)
    const survivors: string[] = []
    for (const sentence of sentences) {
      if (isIdentitySentence(sentence)) {
        removedClaims += 1
        continue
      }
      const redacted = redactVendors(sentence).trim()
      if (redacted) survivors.push(redacted)
    }
    if (survivors.length === 0) continue
    kept.push(`${prefix}${survivors.join(' ')}`)
  }
  return { text: kept.join('\n'), removedClaims }
}

function redactVendors(text: string): string {
  return text
    .replace(modelPattern(), 'the assistant')
    .replace(companyPattern(), 'the provider')
    .replace(/\b(?:the assistant|the provider)(?:\s+(?:the assistant|the provider)\b)+/gi, (match) =>
      match.toLowerCase().includes('provider') ? 'the provider' : 'the assistant'
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
}

export interface StripReport {
  markdown: string
  removedHeadings: string[]
  removedClaims: number
}

export function stripPersona(markdown: string): StripReport {
  const withoutFrontmatter = markdown.replace(/^---\n[\s\S]*?\n---\n*/, '')
  const tree = parseMarkdown(withoutFrontmatter)
  const sections = splitSections(tree)
  const drop = new Set<number>()
  const removedHeadings: string[] = []
  for (let index = 0; index < sections.length; index += 1) {
    if (!isForeignHeading(sections[index].title) || drop.has(index)) continue
    drop.add(index)
    removedHeadings.push(sections[index].title)
    if (!isCatalogHeading(sections[index].title)) continue
    const depth = sections[index].depth
    for (let child = index + 1; child < sections.length && sections[child].depth > depth; child += 1) {
      drop.add(child)
      removedHeadings.push(sections[child].title)
    }
  }

  let removedClaims = 0
  const kept: string[] = []
  sections.forEach((section, index) => {
    if (drop.has(index)) return
    const nodes = section.nodes.filter((node) => !isCatalogTable(node))
    const rendered = stringifyMarkdown(nodes)
    const parts = rendered.split(/(```[\s\S]*?```)/g)
    const cleaned = parts
      .map((part, partIndex) => {
        if (partIndex % 2 === 1) return part
        const result = cleanProse(part.replace(/<!--(?!\s*kirby:atomic\b)[\s\S]*?-->/g, ''))
        removedClaims += result.removedClaims
        return result.text
      })
      .join('')
    const trimmed = cleaned.trim()
    if (trimmed) kept.push(trimmed)
  })

  const body = kept.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  return {
    markdown: body ? `${body}\n` : '',
    removedHeadings,
    removedClaims
  }
}
