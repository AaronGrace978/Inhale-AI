import type { ChatMessage } from '../shared/types'

export interface MountedBehavior {
  id: string
  title: string
  body: string
  tokenCount: number
}

function escapeDelimiter(body: string): string {
  return body.replaceAll('</absorbed_behavior>', '<\\/absorbed_behavior>')
}

function escapeAttribute(value: string): string {
  return value.replace(/["<>&]/g, '')
}

export function wrapAbsorbed(shards: MountedBehavior[]): string {
  return shards
    .map(
      (shard) =>
        `<absorbed_behavior id="${escapeAttribute(shard.id)}" title="${escapeAttribute(shard.title)}">\n${escapeDelimiter(shard.body.trim())}\n</absorbed_behavior>`
    )
    .join('\n\n')
}

export function buildMessages(identity: string, shards: MountedBehavior[], user: string): ChatMessage[] {
  const absorbed = wrapAbsorbed(shards)
  const messages: ChatMessage[] = [{ role: 'system', content: identity.trim() }]
  if (absorbed) messages.push({ role: 'system', content: absorbed })
  messages.push({ role: 'user', content: user })
  return messages
}
