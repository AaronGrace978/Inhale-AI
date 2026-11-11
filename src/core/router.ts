import { keywords } from './text'

export interface RoutableShard {
  id: string
  title: string
  body: string
  triggers: string[]
  tokenCount: number
}

export interface RankedShard {
  shard: RoutableShard
  score: number
  raw: number
}

export function routeShards(query: string, shards: RoutableShard[], limit = 2): RankedShard[] {
  const terms = new Set(keywords(query, 32))
  if (terms.size === 0 || shards.length === 0) return []
  const ranked = shards
    .map((shard) => {
      const triggers = new Set(shard.triggers.map((trigger) => trigger.toLowerCase()))
      const title = shard.title.toLowerCase()
      const body = shard.body.toLowerCase()
      let raw = 0
      for (const term of terms) {
        if (triggers.has(term)) raw += 3
        else if (title.includes(term)) raw += 2
        else if (body.includes(term)) raw += 1
      }
      const score = raw / (Math.sqrt(terms.size) * Math.sqrt(shard.triggers.length + 4))
      return { shard, score, raw }
    })
    .filter((entry) => entry.raw > 0)
    .sort((a, b) => b.score - a.score || a.shard.tokenCount - b.shard.tokenCount || a.shard.id.localeCompare(b.shard.id))

  return ranked.filter((entry) => entry.raw >= 3 || entry.score >= 0.45).slice(0, Math.max(1, Math.min(2, limit)))
}
