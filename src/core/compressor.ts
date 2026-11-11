import { countTokens } from './tokenizer'
import { COMPRESSION_BUDGET } from './verifier'

function compressProse(markdown: string): string {
  const lines = markdown.split('\n')
  const seen = new Set<string>()
  const kept: string[] = []
  const bulletText = (line: string): string => line.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^[-*]\s+/, '')
  for (const line of lines) {
    const key = line.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('')
      continue
    }
    if (key.startsWith('#')) {
      if (!seen.has(key)) kept.push(line.trimEnd())
      seen.add(key)
      continue
    }
    if (seen.has(key)) continue
    if (/^[-*]\s+/.test(key)) {
      const content = bulletText(line)
      const redundant = [...seen].some((previous) => {
        if (!/^[-*]\s+/.test(previous)) return false
        const previousContent = previous.replace(/^[-*]\s+/, '')
        return previousContent.includes(content) && previousContent.length > content.length + 12
      })
      if (redundant) continue
    }
    seen.add(key)
    kept.push(line.trimEnd())
  }
  const bullets = kept.filter((line) => /^[-*]\s+/.test(line.trim()))
  const drop = new Set<string>()
  for (const line of bullets) {
    const content = bulletText(line)
    for (const other of bullets) {
      if (other === line) continue
      const otherContent = bulletText(other)
      if (otherContent.includes(content) && otherContent.length > content.length + 12) drop.add(line)
    }
  }
  return kept.filter((line) => !drop.has(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function compressDeterministic(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```)/g)
  const compressed = parts
    .map((part, index) => (index % 2 === 1 ? part.trim() : compressProse(part)))
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!compressed) return markdown.trim()
  if (countTokens(compressed) >= countTokens(markdown)) return markdown.trim()
  return `${compressed}\n`
}

export function needsCompression(markdown: string): boolean {
  return countTokens(markdown) > COMPRESSION_BUDGET
}
