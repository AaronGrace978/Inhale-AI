export function redactSecrets(text: string, secret?: string): string {
  let output = text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
  output = output.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  output = output.replace(/\bsk-or-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  if (secret && secret.length >= 4) output = output.split(secret).join('[redacted]')
  return output.slice(0, 600)
}

export function assertApiKey(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 8 || trimmed.length > 512) {
    throw new Error('That API key length is not usable.')
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('API keys cannot contain control characters.')
  }
  return trimmed
}
