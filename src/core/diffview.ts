import { diffLines } from 'diff'

export interface AlignedRow {
  kind: 'same' | 'add' | 'del' | 'change'
  before: string
  after: string
}

function linesOf(value: string): string[] {
  if (!value) return []
  const normalized = value.endsWith('\n') ? value.slice(0, -1) : value
  return normalized.split('\n')
}

export function alignDiff(before: string, after: string, limit = 500): { rows: AlignedRow[]; truncated: boolean } {
  const parts = diffLines(before, after)
  const rows: AlignedRow[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const lines = linesOf(part.value)
    if (!part.added && !part.removed) {
      for (const line of lines) rows.push({ kind: 'same', before: line, after: line })
      continue
    }
    if (part.removed && parts[index + 1]?.added) {
      const added = linesOf(parts[index + 1].value)
      const width = Math.max(lines.length, added.length)
      for (let row = 0; row < width; row += 1) {
        const left = lines[row]
        const right = added[row]
        if (left !== undefined && right !== undefined) rows.push({ kind: 'change', before: left, after: right })
        else if (left !== undefined) rows.push({ kind: 'del', before: left, after: '' })
        else rows.push({ kind: 'add', before: '', after: right ?? '' })
      }
      index += 1
      continue
    }
    if (part.removed) {
      for (const line of lines) rows.push({ kind: 'del', before: line, after: '' })
      continue
    }
    for (const line of lines) rows.push({ kind: 'add', before: '', after: line })
  }
  if (rows.length <= limit) return { rows, truncated: false }
  return { rows: rows.slice(0, limit), truncated: true }
}
