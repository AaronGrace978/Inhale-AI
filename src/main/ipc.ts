import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { ZodError } from 'zod'
import { ConfigStore } from '../core/config-store'
import { redactSecrets } from '../core/redact'
import {
  cancelSchema,
  clearKeySchema,
  ingestSchema,
  setKeySchema,
  setModelSchema,
  setProviderSchema,
  shardIdSchema,
  turnSchema
} from '../core/schemas'
import { channels } from '../shared/channels'
import { KirbyRuntime } from './runtime'

function assertSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl && url.startsWith(devUrl)) return
  if (url.startsWith('file:')) return
  throw new Error('Untrusted caller.')
}

function explain(error: unknown): Error {
  if (error instanceof ZodError) {
    return new Error(error.issues[0]?.message ?? 'That request was not valid.')
  }
  const message = error instanceof Error ? error.message : 'Request failed.'
  return new Error(redactSecrets(message))
}

export function registerIpc(options: {
  runtime: KirbyRuntime
  config: ConfigStore
  getWindow: () => BrowserWindow | null
}): void {
  const { runtime, config, getWindow } = options
  const handle = (channel: string, fn: (payload: unknown) => Promise<unknown> | unknown): void => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        assertSender(event)
        return await fn(payload)
      } catch (error) {
        throw explain(error)
      }
    })
  }

  handle(channels.configGet, () => config.publicView())
  handle(channels.configSetProvider, (payload) => config.setProvider(setProviderSchema.parse(payload).provider))
  handle(channels.configSetModel, (payload) => config.setModel(setModelSchema.parse(payload).model))
  handle(channels.configSetKey, (payload) => {
    const parsed = setKeySchema.parse(payload)
    return config.setKey(parsed.provider, parsed.apiKey)
  })
  handle(channels.configClearKey, (payload) => config.clearKey(clearKeySchema.parse(payload).provider))
  handle(channels.graphGet, () => runtime.snapshot())
  handle(channels.shardRead, (payload) => runtime.readShard(shardIdSchema.parse(payload).id))
  handle(channels.ingest, (payload) => {
    const parsed = ingestSchema.parse(payload)
    return runtime.ingestText(parsed.filename, parsed.content)
  })
  handle(channels.ingestSample, () => runtime.ingestSample())
  handle(channels.ingestDialog, async () => {
    const win = getWindow()
    const dialogOptions: OpenDialogOptions = {
      title: 'Inhale a playbook',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    }
    const chosen = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    const file = chosen.filePaths[0]
    if (chosen.canceled || !file) return null
    const content = readFileSync(file, 'utf8')
    if (content.length > 1_500_000) throw new Error('That playbook is larger than Kirby will inhale.')
    return runtime.ingestText(basename(file), content)
  })
  handle(channels.turnRun, (payload) => runtime.runTurn(turnSchema.parse(payload).prompt))
  handle(channels.turnCancel, (payload) => {
    runtime.cancel(cancelSchema.parse(payload).requestId)
    return { ok: true }
  })
  handle(channels.compress, () => runtime.compressBloated())
}
