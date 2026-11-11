import type { GraphSnapshot, Manifest } from '../shared/types'
import { contextReduction } from './tokenizer'

export interface MountRef {
  id: string
  score: number
}

export function buildSnapshot(input: {
  identityTokens: number
  manifest: Manifest
  mounted: MountRef[]
}): GraphSnapshot {
  const mounted = new Map(input.mounted.map((entry) => [entry.id, entry.score]))
  const shards = input.manifest.shards.map((shard) => ({
    id: shard.id,
    title: shard.title,
    tokenCount: shard.tokenCount,
    triggers: shard.triggers,
    version: shard.version,
    source: shard.source,
    active: mounted.has(shard.id),
    score: mounted.get(shard.id) ?? 0
  }))
  const registryTokens = shards.reduce((sum, shard) => sum + shard.tokenCount, 0)
  const baselineTokens = Object.values(input.manifest.sources).reduce((sum, source) => sum + source.baselineTokens, 0)
  const strippedTokens = Object.values(input.manifest.sources).reduce((sum, source) => sum + source.strippedTokens, 0)
  const liveMounted = shards.filter((shard) => shard.active)
  const average = shards.length === 0 ? 0 : registryTokens / shards.length
  const projectedActive = input.identityTokens + average * Math.min(2, shards.length)
  const liveActive = input.identityTokens + liveMounted.reduce((sum, shard) => sum + shard.tokenCount, 0)
  const reductionMode = liveMounted.length > 0 ? 'live' : 'projected'
  const activeTokens = reductionMode === 'live' ? liveActive : projectedActive
  return {
    identity: {
      id: 'identity-core',
      title: 'Identity Core',
      tokenCount: input.identityTokens,
      locked: true
    },
    shards,
    mountedIds: liveMounted.map((shard) => shard.id),
    baselineTokens,
    strippedTokens,
    registryTokens,
    activeTokens: Math.round(activeTokens),
    reduction: contextReduction(baselineTokens, activeTokens),
    reductionMode
  }
}
