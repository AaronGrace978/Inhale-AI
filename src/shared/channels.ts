export const channels = {
  configGet: 'inhale:config:get',
  configSetProvider: 'inhale:config:set-provider',
  configSetModel: 'inhale:config:set-model',
  configSetKey: 'inhale:config:set-key',
  configClearKey: 'inhale:config:clear-key',
  graphGet: 'inhale:graph:get',
  shardRead: 'inhale:shard:read',
  ingest: 'inhale:ingest',
  ingestDialog: 'inhale:ingest:dialog',
  ingestSample: 'inhale:ingest:sample',
  turnRun: 'inhale:turn:run',
  turnCancel: 'inhale:turn:cancel',
  compress: 'inhale:compress',
  workspaceGet: 'inhale:workspace:get',
  workspaceChoose: 'inhale:workspace:choose',
  workspaceClear: 'inhale:workspace:clear',
  telemetry: 'inhale:telemetry'
} as const

export type ChannelName = (typeof channels)[keyof typeof channels]
