export function formatTokens(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function humanError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '')
}
