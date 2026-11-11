import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { DiffPayload, GraphSnapshot, IngestStage, PavState, PublicConfig, ShardDetail, TelemetryEvent } from '../../shared/types'

export interface BuildLog {
  requestId: string
  summary: string
  decision: 'COMMITTED' | 'REJECTED'
  command: string | null
  exitCode: number | null
  output: string
  reasons: string[]
}

const STAGES: IngestStage[] = ['received', 'parsed', 'stripped', 'sharded', 'compressed', 'manifest', 'done']

export interface PavEntry {
  id: string
  state: PavState
  detail: string
  at: number
}

interface State {
  config: PublicConfig | null
  graph: GraphSnapshot | null
  stages: Partial<Record<IngestStage, string>>
  furthest: IngestStage | null
  failedStage: boolean
  pav: PavEntry[]
  diffs: DiffPayload[]
  diffIndex: number
  chat: string
  error: string | null
  settingsOpen: boolean
  shard: ShardDetail | null
  busy: 'idle' | 'ingest' | 'turn' | 'compress'
  mode: 'cloud' | 'offline' | null
  modeDetail: string
  requestId: string | null
  workspace: string | null
  build: BuildLog | null
}

type Action =
  | { type: 'telemetry'; event: TelemetryEvent }
  | { type: 'config'; config: PublicConfig }
  | { type: 'graph'; graph: GraphSnapshot }
  | { type: 'busy'; busy: State['busy'] }
  | { type: 'error'; error: string | null }
  | { type: 'settings'; open: boolean }
  | { type: 'shard'; shard: ShardDetail | null }
  | { type: 'diff'; index: number }
  | { type: 'request'; requestId: string | null }
  | { type: 'workspace'; path: string | null }

const initial: State = {
  config: null,
  graph: null,
  stages: {},
  furthest: null,
  failedStage: false,
  pav: [],
  diffs: [],
  diffIndex: 0,
  chat: '',
  error: null,
  settingsOpen: false,
  shard: null,
  busy: 'idle',
  mode: null,
  modeDetail: 'Seal a cloud key, or run an offline rehearsal. The gate still decides every write.',
  requestId: null,
  workspace: null,
  build: null
}

function stageRank(stage: IngestStage | null): number {
  if (!stage) return -1
  return STAGES.indexOf(stage)
}

function reduce(state: State, action: Action): State {
  if (action.type === 'config') return { ...state, config: action.config }
  if (action.type === 'graph') return { ...state, graph: action.graph }
  if (action.type === 'busy') return { ...state, busy: action.busy }
  if (action.type === 'error') return { ...state, error: action.error }
  if (action.type === 'settings') return { ...state, settingsOpen: action.open }
  if (action.type === 'shard') return { ...state, shard: action.shard }
  if (action.type === 'diff') return { ...state, diffIndex: action.index }
  if (action.type === 'request') return { ...state, requestId: action.requestId }
  if (action.type === 'workspace') return { ...state, workspace: action.path }
  const event = action.event
  if (event.kind === 'ingest') {
    if (event.stage === 'error') {
      return { ...state, failedStage: true, error: event.detail, stages: { ...state.stages, error: event.detail } }
    }
    const furthest = stageRank(event.stage) >= stageRank(state.furthest) ? event.stage : state.furthest
    return {
      ...state,
      failedStage: false,
      furthest,
      stages: { ...state.stages, [event.stage]: event.detail }
    }
  }
  if (event.kind === 'graph') return { ...state, graph: event.snapshot }
  if (event.kind === 'pav') {
    const entry = { id: `${event.at}-${state.pav.length}`, state: event.state, detail: event.detail, at: event.at }
    return { ...state, pav: [...state.pav, entry].slice(-48) }
  }
  if (event.kind === 'diff') {
    const diffs = [...state.diffs, event].slice(-24)
    return { ...state, diffs, diffIndex: diffs.length - 1 }
  }
  if (event.kind === 'chat') {
    if (event.phase === 'delta') return { ...state, chat: state.chat + event.text }
    if (event.phase === 'done') return { ...state, chat: event.text }
    return { ...state, error: event.text }
  }
  if (event.kind === 'turn') {
    const model = state.config?.catalog.find((item) => item.provider === event.provider && item.id === event.model)
    return {
      ...state,
      mode: event.mode,
      requestId: event.requestId,
      chat: '',
      modeDetail:
        event.mode === 'offline'
          ? 'Offline rehearsal. Routing and the verification gate are live; no cloud model is connected.'
          : `${event.provider === 'ollama-cloud' ? 'Ollama Cloud' : 'OpenRouter'} · ${model?.label ?? event.model}`
    }
  }
  if (event.kind === 'error') return { ...state, error: event.message }
  if (event.kind === 'workspace') return { ...state, workspace: event.path }
  if (event.kind === 'build') {
    return {
      ...state,
      build: {
        requestId: event.requestId,
        summary: event.summary,
        decision: event.decision,
        command: event.command,
        exitCode: event.exitCode,
        output: event.output,
        reasons: event.reasons
      }
    }
  }
  return state
}

const StateContext = createContext<{ state: State; dispatch: (action: Action) => void } | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initial)
  useEffect(() => {
    const bridge = window.inhale
    if (!bridge) return
    return bridge.onTelemetry((event) => dispatch({ type: 'telemetry', event }))
  }, [])
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>
}

export function useAppState(): { state: State; dispatch: (action: Action) => void } {
  const value = useContext(StateContext)
  if (!value) throw new Error('Inhale state is missing.')
  return value
}

export { STAGES }
