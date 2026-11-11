/** Stable budget tokenizer. It is not a provider tokenizer. */
const WORD = /[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g

export function countTokens(text: string): number {
  if (!text) return 0
  let count = 0
  for (const match of text.matchAll(WORD)) {
    const token = match[0]
    if (/^[A-Za-z0-9_]+$/.test(token)) count += Math.max(1, Math.ceil(token.length / 4))
    else count += 1
  }
  return count
}

export function contextReduction(baseline: number, active: number): number {
  if (!Number.isFinite(baseline) || baseline <= 0) return 0
  const value = (baseline - active) / baseline
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}
