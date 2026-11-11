import type { ChatMessage, ProviderId } from '../shared/types'
import { COMPLETION_URLS } from '../shared/catalog'
import { redactSecrets } from './redact'

export interface CompletionRequest {
  provider: ProviderId
  model: string
  apiKey: string
  messages: ChatMessage[]
  temperature: number
  maxTokens: number
  json?: boolean
  signal: AbortSignal
}

export interface CompletionText {
  content: string
  reasoning: string
}

export class ModelError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ModelError'
    this.status = status
  }
}

export function linkAbortSignals(signals: AbortSignal[], timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('The model timed out.'))
  }, timeoutMs)
  const listeners: Array<() => void> = []
  const abortFrom = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason instanceof Error ? reason : new Error('Cancelled.'))
  }
  for (const signal of signals) {
    if (signal.aborted) abortFrom(signal.reason)
    else {
      const listener = (): void => abortFrom(signal.reason)
      signal.addEventListener('abort', listener, { once: true })
      listeners.push(() => signal.removeEventListener('abort', listener))
    }
  }
  let settled = false
  return {
    signal: controller.signal,
    dispose: () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const remove of listeners) remove()
    }
  }
}

function headers(provider: ProviderId, apiKey: string): Record<string, string> {
  const result: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
  if (provider === 'openrouter') {
    result['HTTP-Referer'] = 'https://kirby.local'
    result['X-Title'] = 'Kirby'
  }
  return result
}

function requestBody(request: CompletionRequest, stream: boolean): string {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    stream
  }
  if (request.json) body.response_format = { type: 'json_object' }
  return JSON.stringify(body)
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
      return ''
    })
    .join('')
}

function readReasoning(record: Record<string, unknown>): string {
  for (const key of ['reasoning', 'reasoning_content']) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

export function completionFromJson(payload: unknown): CompletionText {
  if (!payload || typeof payload !== 'object') return { content: '', reasoning: '' }
  const choices = (payload as { choices?: unknown }).choices
  const choice = Array.isArray(choices) ? choices[0] : undefined
  if (!choice || typeof choice !== 'object') return { content: '', reasoning: '' }
  const message = (choice as { message?: unknown; delta?: unknown }).message
  const delta = (choice as { delta?: unknown }).delta
  const source = (message && typeof message === 'object' ? message : delta) as Record<string, unknown> | undefined
  if (!source) return { content: '', reasoning: '' }
  return {
    content: textFromContent(source.content),
    reasoning: readReasoning(source)
  }
}

export function visibleCompletion(text: CompletionText): string {
  return text.content.trim() ? text.content : text.reasoning
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled.')
    this.name = 'CancelledError'
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof CancelledError || (error instanceof Error && error.name === 'CancelledError')
}

interface OpenResponse {
  response: Response
  dispose: () => void
}

async function openRequest(request: CompletionRequest, stream: boolean, timeoutMs: number): Promise<OpenResponse> {
  const linked = linkAbortSignals([request.signal], timeoutMs)
  try {
    const response = await fetch(COMPLETION_URLS[request.provider], {
      method: 'POST',
      headers: headers(request.provider, request.apiKey),
      body: requestBody(request, stream),
      signal: linked.signal
    })
    if (!response.ok) {
      const detail = redactSecrets(await response.text(), request.apiKey)
      linked.dispose()
      throw new ModelError(detail || `The model request failed (${response.status}).`, response.status)
    }
    return { response, dispose: linked.dispose }
  } catch (error) {
    linked.dispose()
    if (error instanceof ModelError) throw error
    if (request.signal.aborted) throw new CancelledError()
    if (linked.signal.aborted) throw new ModelError('The model timed out.', 0)
    const message = error instanceof Error ? error.message : 'The model request failed.'
    throw new ModelError(redactSecrets(message, request.apiKey), 0)
  }
}

export async function completeChat(request: CompletionRequest, timeoutMs = 60_000): Promise<CompletionText> {
  const opened = await openRequest(request, false, timeoutMs)
  try {
    return completionFromJson((await opened.response.json()) as unknown)
  } catch (error) {
    if (error instanceof ModelError || isCancelled(error)) throw error
    throw new ModelError('The model returned a response that was not JSON.', 0)
  } finally {
    opened.dispose()
  }
}

export async function streamChat(
  request: CompletionRequest,
  onDelta: (chunk: string) => void,
  timeoutMs = 120_000
): Promise<CompletionText> {
  const opened = await openRequest(request, true, timeoutMs)
  try {
    if (!opened.response.body) throw new ModelError('The model returned an empty stream.', 0)
    const reader = opened.response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const collected: CompletionText = { content: '', reasoning: '' }
    const consume = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') return
      let payload: unknown
      try {
        payload = JSON.parse(data) as unknown
      } catch {
        return
      }
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const message = (payload as { error?: { message?: string } }).error?.message ?? 'The model stream failed.'
        throw new ModelError(redactSecrets(message, request.apiKey), 0)
      }
      const piece = completionFromJson(payload)
      if (piece.content) {
        collected.content += piece.content
        onDelta(piece.content)
      }
      if (piece.reasoning) collected.reasoning += piece.reasoning
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) consume(line)
      }
      if (buffer.trim()) consume(buffer)
    } finally {
      reader.releaseLock()
    }
    return collected
  } finally {
    opened.dispose()
  }
}
