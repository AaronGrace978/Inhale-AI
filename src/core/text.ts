const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'with', 'by', 'is', 'are', 'be',
  'this', 'that', 'it', 'as', 'at', 'from', 'into', 'your', 'you', 'we', 'our', 'their', 'when',
  'if', 'then', 'than', 'not', 'do', 'does', 'each', 'using', 'use', 'via', 'per', 'its', 'was',
  'were', 'can', 'may', 'must', 'should', 'would', 'will', 'just', 'only', 'also', 'any', 'all',
  'about', 'after', 'before', 'over', 'under', 'such', 'them', 'they', 'have', 'has', 'had',
  'but', 'nor', 'too', 'very', 'what', 'which', 'who', 'how', 'why', 'where', 'there', 'here'
])

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42)
  return slug || 'skill'
}

export function keywords(text: string, limit = 12): string[] {
  const counts = new Map<string, number>()
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (STOP.has(raw)) continue
    counts.set(raw, (counts.get(raw) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word)
}

export function assertInside(parent: string, target: string, sep: string): void {
  const parentResolved = parent.endsWith(sep) ? parent : parent + sep
  if (target !== parent && !target.startsWith(parentResolved)) {
    throw new Error('Path escaped the registry.')
  }
}

export function safeSourceName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'playbook.md'
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  if (!/\.(md|markdown)$/i.test(cleaned)) {
    throw new Error('Only markdown files can be inhaled.')
  }
  return cleaned
}

export function yamlQuote(value: string): string {
  if (/^[a-zA-Z0-9._ -]+$/.test(value) && value.trim() === value && !value.includes(':')) {
    return value
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function splitFrontmatter(file: string): { meta: Record<string, string>; body: string } {
  if (!file.startsWith('---\n')) return { meta: {}, body: file }
  const end = file.indexOf('\n---\n', 4)
  if (end < 0) return { meta: {}, body: file }
  const meta: Record<string, string> = {}
  for (const line of file.slice(4, end).split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    meta[key] = value
  }
  return { meta, body: file.slice(end + 5).replace(/^\n/, '') }
}

export function stripWrappingFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/)
  return match ? match[1].trim() : trimmed
}

export function dropLeadingFrontmatter(text: string): string {
  return splitFrontmatter(text.startsWith('---\n') ? text : text.replace(/^---\r?\n/, '---\n')).body.trim()
}
