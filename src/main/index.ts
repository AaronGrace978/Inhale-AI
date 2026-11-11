import { app, BrowserWindow, dialog, session } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigStore } from '../core/config-store'
import { redactSecrets } from '../core/redact'
import { SkillRegistry } from '../core/registry'
import { channels } from '../shared/channels'
import { registerIpc } from './ipc'
import { InhaleRuntime } from './runtime'
import { createElectronSealer } from './sealer'
import { contentSecurityPolicy, SECURE_WEB_PREFERENCES } from './security'

app.setName('Inhale')

process.on('uncaughtException', (error) => {
  console.error('inhale', redactSecrets(error.message))
})
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : 'unhandled rejection'
  console.error('inhale', redactSecrets(message))
})

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let runtime: InhaleRuntime | null = null

function paths(): { registry: string; config: string; sealKey: string; identity: string; sample: string } {
  const user = app.getPath('userData')
  const root = app.getAppPath()
  if (app.isPackaged) {
    return {
      registry: join(user, 'skills_registry'),
      config: join(user, 'config'),
      sealKey: join(user, 'config', 'master.key'),
      identity: join(process.resourcesPath, 'resources', 'identity_core.md'),
      sample: join(process.resourcesPath, 'resources', 'examples', 'foreign-agent-playbook.md')
    }
  }
  return {
    registry: join(root, 'skills_registry'),
    config: join(user, 'config'),
    sealKey: join(user, 'config', 'master.key'),
    identity: join(root, 'resources', 'identity_core.md'),
    sample: join(root, 'resources', 'examples', 'foreign-agent-playbook.md')
  }
}

function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env.ELECTRON_RENDERER_URL
      if (devUrl && url.startsWith(devUrl)) return
      if (url.startsWith('file:')) return
      event.preventDefault()
    })
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false)
    })
  })
}

function installContentSecurityPolicy(): void {
  const policy = contentSecurityPolicy(process.env.ELECTRON_RENDERER_URL)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1100,
    minHeight: 740,
    show: false,
    backgroundColor: '#140810',
    title: 'Inhale',
    autoHideMenuBar: true,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js')
    }
  })
  win.once('ready-to-show', () => win.show())
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function broadcast(event: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channels.telemetry, event)
}

if (gotSingleInstanceLock) app.whenReady().then(() => {
  const location = paths()
  if (!existsSync(location.identity) || !existsSync(location.sample)) {
    dialog.showErrorBox('Inhale', 'The locked identity core or the sample playbook is missing.')
    app.quit()
    return
  }
  installNavigationGuards()
  installContentSecurityPolicy()
  const config = new ConfigStore(location.config, createElectronSealer(location.sealKey))
  const registry = new SkillRegistry(location.registry)
  runtime = new InhaleRuntime({
    registry,
    config,
    identityPath: location.identity,
    samplePath: location.sample,
    emit: broadcast
  })
  registerIpc({ runtime, config, getWindow: () => mainWindow })
  mainWindow = createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

if (gotSingleInstanceLock) app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

if (gotSingleInstanceLock) {
  app.on('before-quit', () => {
    runtime?.stop()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
