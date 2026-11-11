export type ProviderId = 'ollama-cloud' | 'openrouter'

export type ModelTier = 'flagship' | 'frontier' | 'balanced' | 'fast' | 'router'

export interface ModelOption {
  id: string
  provider: ProviderId
  label: string
  vendor: string
  tier: ModelTier
  contextTokens: number
  note: string
}

export interface PublicConfig {
  provider: ProviderId
  model: string
  catalog: ModelOption[]
  keys: Record<ProviderId, boolean>
  endpoints: Record<ProviderId, string>
  identityLocked: true
}

export interface HistoryEntry {
  version: number
  at: string
  reason: string
  tokenCount: number
  decision: 'ingest' | 'committed' | 'compressed'
}

export interface ShardRecord {
  id: string
  file: string
  title: string
  triggers: string[]
  tokenCount: number
  version: number
  source: string
  updatedAt: string
  history: HistoryEntry[]
}

export interface SourceStat {
  baselineTokens: number
  strippedTokens: number
  at: string
}

export interface Manifest {
  version: 1
  updatedAt: string
  shards: ShardRecord[]
  sources: Record<string, SourceStat>
}

export interface ShardNode {
  id: string
  title: string
  tokenCount: number
  triggers: string[]
  version: number
  source: string
  active: boolean
  score: number
}

export interface GraphSnapshot {
  identity: {
    id: 'identity-core'
    title: string
    tokenCount: number
    locked: true
  }
  shards: ShardNode[]
  mountedIds: string[]
  baselineTokens: number
  strippedTokens: number
  registryTokens: number
  activeTokens: number
  reduction: number
  reductionMode: 'live' | 'projected'
}

export interface ShardDetail {
  id: string
  title: string
  body: string
  tokenCount: number
  version: number
  triggers: string[]
  source: string
  locked: boolean
  history: HistoryEntry[]
}

export type PavState = 'PLANNING' | 'ACTING' | 'VERIFYING' | 'COMMITTED' | 'REJECTED'

export type IngestStage =
  | 'received'
  | 'parsed'
  | 'stripped'
  | 'sharded'
  | 'compressed'
  | 'manifest'
  | 'done'
  | 'error'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface DiffPayload {
  requestId: string
  shardId: string
  title: string
  before: string
  after: string
  decision: 'COMMITTED' | 'REJECTED'
  reasons: string[]
  beforeTokens: number
  afterTokens: number
  beforePassRate: number
  afterPassRate: number
}

export type TelemetryEvent =
  | {
      kind: 'ingest'
      stage: IngestStage
      detail: string
      source?: string
      baselineTokens?: number
      shardCount?: number
    }
  | {
      kind: 'route'
      mountedIds: string[]
      scores: Array<{ id: string; score: number }>
      baselineTokens: number
      activeTokens: number
      reduction: number
    }
  | {
      kind: 'pav'
      requestId: string
      state: PavState
      detail: string
      at: number
    }
  | ({ kind: 'diff' } & DiffPayload)
  | {
      kind: 'chat'
      requestId: string
      phase: 'delta' | 'done' | 'error'
      text: string
    }
  | {
      kind: 'turn'
      requestId: string
      mode: 'cloud' | 'offline'
      provider: ProviderId
      model: string
    }
  | {
      kind: 'graph'
      snapshot: GraphSnapshot
    }
  | {
      kind: 'error'
      message: string
    }
  | {
      kind: 'workspace'
      path: string | null
    }
  | {
      kind: 'build'
      requestId: string
      summary: string
      decision: 'COMMITTED' | 'REJECTED'
      command: string | null
      exitCode: number | null
      output: string
      reasons: string[]
    }

export interface TurnResult {
  requestId: string
  status: 'committed' | 'rejected' | 'cancelled'
  mode: 'cloud' | 'offline'
}

export interface WorkspaceInfo {
  path: string | null
}

export interface InhaleApi {
  getConfig: () => Promise<PublicConfig>
  setProvider: (provider: ProviderId) => Promise<PublicConfig>
  setModel: (model: string) => Promise<PublicConfig>
  setApiKey: (provider: ProviderId, apiKey: string) => Promise<PublicConfig>
  clearApiKey: (provider: ProviderId) => Promise<PublicConfig>
  getGraph: () => Promise<GraphSnapshot>
  readShard: (id: string) => Promise<ShardDetail>
  ingest: (input: { filename: string; content: string }) => Promise<GraphSnapshot>
  ingestDialog: () => Promise<GraphSnapshot | null>
  ingestSample: () => Promise<GraphSnapshot>
  runTurn: (prompt: string) => Promise<TurnResult>
  cancelTurn: (requestId: string) => Promise<void>
  compressBloated: () => Promise<GraphSnapshot>
  getWorkspace: () => Promise<WorkspaceInfo>
  chooseWorkspace: () => Promise<WorkspaceInfo>
  clearWorkspace: () => Promise<WorkspaceInfo>
  onTelemetry: (listener: (event: TelemetryEvent) => void) => () => void
}
