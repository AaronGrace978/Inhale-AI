import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { channels } from '../shared/channels'
import type { KirbyApi, ProviderId, TelemetryEvent } from '../shared/types'

function isTelemetry(payload: unknown): payload is TelemetryEvent {
  return Boolean(payload) && typeof payload === 'object' && typeof (payload as { kind?: unknown }).kind === 'string'
}

const api: KirbyApi = {
  getConfig: () => ipcRenderer.invoke(channels.configGet),
  setProvider: (provider: ProviderId) => ipcRenderer.invoke(channels.configSetProvider, { provider }),
  setModel: (model: string) => ipcRenderer.invoke(channels.configSetModel, { model }),
  setApiKey: (provider: ProviderId, apiKey: string) => ipcRenderer.invoke(channels.configSetKey, { provider, apiKey }),
  clearApiKey: (provider: ProviderId) => ipcRenderer.invoke(channels.configClearKey, { provider }),
  getGraph: () => ipcRenderer.invoke(channels.graphGet),
  readShard: (id: string) => ipcRenderer.invoke(channels.shardRead, { id }),
  ingest: (input) => ipcRenderer.invoke(channels.ingest, input),
  ingestDialog: () => ipcRenderer.invoke(channels.ingestDialog),
  ingestSample: () => ipcRenderer.invoke(channels.ingestSample),
  runTurn: (prompt: string) => ipcRenderer.invoke(channels.turnRun, { prompt }),
  cancelTurn: (requestId: string) => ipcRenderer.invoke(channels.turnCancel, { requestId }),
  compressBloated: () => ipcRenderer.invoke(channels.compress),
  onTelemetry: (listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      if (isTelemetry(payload)) listener(payload)
    }
    ipcRenderer.on(channels.telemetry, wrapped)
    return () => {
      ipcRenderer.removeListener(channels.telemetry, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('kirby', api)
