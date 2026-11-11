export const channels = {
  configGet: 'kirby:config:get',
  configSetProvider: 'kirby:config:set-provider',
  configSetModel: 'kirby:config:set-model',
  configSetKey: 'kirby:config:set-key',
  configClearKey: 'kirby:config:clear-key',
  graphGet: 'kirby:graph:get',
  shardRead: 'kirby:shard:read',
  ingest: 'kirby:ingest',
  ingestDialog: 'kirby:ingest:dialog',
  ingestSample: 'kirby:ingest:sample',
  turnRun: 'kirby:turn:run',
  turnCancel: 'kirby:turn:cancel',
  compress: 'kirby:compress',
  telemetry: 'kirby:telemetry'
} as const

export type ChannelName = (typeof channels)[keyof typeof channels]
