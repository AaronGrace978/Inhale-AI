import { countTokens } from './tokenizer'
import { extractVerifyScripts, runSandboxedJs } from './sandbox'
import { lintForeignIdentity } from './stripper'

export const COMPRESSION_BUDGET = 600

export interface CheckResult {
  name: string
  passed: boolean
  detail?: string
}

export interface VerifyResult {
  ok: boolean
  reasons: string[]
  beforeTokens: number
  afterTokens: number
  beforePassRate: number
  afterPassRate: number
  checks: Array<{ name: string; before: boolean; after: boolean }>
}

interface Evaluated {
  checks: CheckResult[]
  tokens: number
}

function jsonSchemas(markdown: string): string[] {
  const found: string[] = []
  const pattern = /```jsonschema\s*\n([\s\S]*?)```/gi
  for (const match of markdown.matchAll(pattern)) {
    if (match[1]?.trim()) found.push(match[1].trim())
  }
  return found
}

function jsonSamples(markdown: string): string[] {
  const found: string[] = []
  const pattern = /```jsonsample\s*\n([\s\S]*?)```/gi
  for (const match of markdown.matchAll(pattern)) {
    if (match[1]?.trim()) found.push(match[1].trim())
  }
  return found
}

function typeMatches(value: unknown, type: string): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value)
  if (type === 'null') return value === null
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeof value === type
}

export function validateJsonSchema(schema: unknown, value: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [`${path} schema is not an object`]
  const record = schema as Record<string, unknown>
  const errors: string[] = []
  if (typeof record.type === 'string' && !typeMatches(value, record.type)) {
    errors.push(`${path} expected ${record.type}`)
    return errors
  }
  if (Array.isArray(record.enum) && !record.enum.some((entry) => Object.is(entry, value))) {
    errors.push(`${path} is outside the enum`)
  }
  if (typeof value === 'string') {
    if (typeof record.minLength === 'number' && value.length < record.minLength) errors.push(`${path} is too short`)
    if (typeof record.maxLength === 'number' && value.length > record.maxLength) errors.push(`${path} is too long`)
  }
  if (typeof value === 'number') {
    if (typeof record.minimum === 'number' && value < record.minimum) errors.push(`${path} is below minimum`)
    if (typeof record.maximum === 'number' && value > record.maximum) errors.push(`${path} is above maximum`)
  }
  if (Array.isArray(value) && record.items && typeof record.items === 'object') {
    value.forEach((item, index) => {
      errors.push(...validateJsonSchema(record.items, item, `${path}[${index}]`))
    })
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const required = Array.isArray(record.required) ? record.required.filter((item) => typeof item === 'string') : []
    for (const key of required) {
      if (!(key in object)) errors.push(`${path}.${key} is required`)
    }
    if (record.properties && typeof record.properties === 'object') {
      for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) {
        if (key in object) errors.push(...validateJsonSchema(child, object[key], `${path}.${key}`))
      }
    }
  }
  return errors
}

function evaluate(markdown: string): Evaluated {
  const tokens = countTokens(markdown)
  const checks: CheckResult[] = []
  const trimmed = markdown.trim()
  const hasHeading = /^#{1,6}\s+\S/m.test(trimmed)
  checks.push({ name: 'heading', passed: hasHeading && trimmed.length > 0, detail: hasHeading ? undefined : 'missing heading' })
  const lint = lintForeignIdentity(markdown)
  checks.push({
    name: 'identity',
    passed: lint.claims === 0 && lint.vendors.length === 0 && lint.catalogTables === 0,
    detail: [...(lint.claims ? ['identity claim'] : []), ...lint.vendors, ...(lint.catalogTables ? ['catalog'] : [])].join(', ')
  })
  checks.push({
    name: 'budget',
    passed: tokens <= COMPRESSION_BUDGET,
    detail: tokens <= COMPRESSION_BUDGET ? undefined : `${tokens} tokens`
  })
  const rules = trimmed.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('```'))
  checks.push({ name: 'substance', passed: rules.length >= 3, detail: rules.length >= 3 ? undefined : 'too thin' })

  for (const [index, rawSchema] of jsonSchemas(markdown).entries()) {
    let schema: unknown
    try {
      schema = JSON.parse(rawSchema) as unknown
    } catch {
      checks.push({ name: `schema:${index}`, passed: false, detail: 'schema is not JSON' })
      continue
    }
    const samples = jsonSamples(markdown)
    if (samples.length === 0) {
      checks.push({ name: `schema:${index}`, passed: true })
      continue
    }
    try {
      const sample = JSON.parse(samples[Math.min(index, samples.length - 1)] ?? '') as unknown
      const errors = validateJsonSchema(schema, sample)
      checks.push({ name: `schema:${index}`, passed: errors.length === 0, detail: errors[0] })
    } catch {
      checks.push({ name: `schema:${index}`, passed: false, detail: 'sample is not JSON' })
    }
  }

  for (const [index, script] of extractVerifyScripts(markdown).entries()) {
    const result = runSandboxedJs(script)
    checks.push({
      name: `sandbox:${index}`,
      passed: result.exitCode === 0,
      detail: result.exitCode === 0 ? undefined : result.error
    })
  }

  return { checks, tokens }
}

function rate(checks: CheckResult[]): number {
  if (checks.length === 0) return 0
  return checks.filter((check) => check.passed).length / checks.length
}

export function verifyMutation(before: string, after: string): VerifyResult {
  const previous = evaluate(before)
  const next = evaluate(after)
  const names = [...new Set([...previous.checks.map((check) => check.name), ...next.checks.map((check) => check.name)])]
  const checks = names.map((name) => {
    const beforeCheck = previous.checks.find((check) => check.name === name)
    const afterCheck = next.checks.find((check) => check.name === name)
    return {
      name,
      before: beforeCheck ? beforeCheck.passed : true,
      after: afterCheck ? afterCheck.passed : false
    }
  })
  const beforePassRate = rate(previous.checks)
  const afterPassed = checks.filter((check) => check.after).length
  const afterPassRate = checks.length === 0 ? 0 : afterPassed / checks.length
  const reasons: string[] = []
  const hardFailures = next.checks.filter((check) => !check.passed && check.name !== 'budget')
  for (const failure of hardFailures) {
    reasons.push(failure.detail ? `${failure.name} failed (${failure.detail})` : `${failure.name} failed`)
  }
  for (const check of checks) {
    if (check.before && !check.after && !reasons.some((reason) => reason.startsWith(check.name))) {
      reasons.push(`${check.name} regressed`)
    }
  }
  const grew = next.tokens > previous.tokens
  const passImproved = afterPassRate > beforePassRate + 1e-9
  if (grew && !passImproved) reasons.push('token bloat without a higher pass rate')
  if (next.tokens > COMPRESSION_BUDGET && next.tokens > previous.tokens) {
    reasons.push('edit grows a shard that is already over the compression budget')
  }
  if (before.trim() === after.trim()) reasons.push('edit made no change')
  const identityFailed = next.checks.some((check) => check.name === 'identity' && !check.passed)
  const sandboxFailed = next.checks.some((check) => check.name.startsWith('sandbox:') && !check.passed)
  const schemaFailed = next.checks.some((check) => check.name.startsWith('schema:') && !check.passed)
  const ok = reasons.length === 0 && !identityFailed && !sandboxFailed && !schemaFailed && afterPassRate + 1e-9 >= beforePassRate
  return {
    ok,
    reasons: ok ? ['verification passed'] : [...new Set(reasons)],
    beforeTokens: previous.tokens,
    afterTokens: next.tokens,
    beforePassRate,
    afterPassRate,
    checks
  }
}

export function verifyAnswer(text: string): { ok: boolean; reasons: string[] } {
  const trimmed = text.trim()
  if (trimmed.length < 2) return { ok: false, reasons: ['The answer was empty.'] }
  const lint = lintForeignIdentity(trimmed)
  if (lint.claims > 0) return { ok: false, reasons: ['The answer reintroduced a foreign identity.'] }
  if (/bearer\s+[a-z0-9._~+/-]{8,}/i.test(trimmed) || /\bsk-[a-z0-9_-]{8,}\b/i.test(trimmed)) {
    return { ok: false, reasons: ['The answer contained credential-like material.'] }
  }
  return { ok: true, reasons: [] }
}
