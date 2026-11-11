import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, dirname, resolve } from 'node:path'
import type { BuildRequest } from './schemas'

export interface WorkspaceChange {
  path: string
  before: string
  after: string
}

export interface BuildOutcome {
  ok: boolean
  summary: string
  command: string | null
  exitCode: number | null
  output: string
  reasons: string[]
  files: WorkspaceChange[]
}

interface Snapshot {
  absolute: string
  relativePath: string
  existed: boolean
  before: string
}

const COMMAND_TIMEOUT_MS = 60_000
const OUTPUT_CAP = 120_000

const ENV_KEEP = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TERM',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES',
  'SYSTEMDRIVE',
  'PROGRAMDATA',
  'DRIVERDATA',
  'PSMODULEPATH'
]

export function normalizeRelative(input: string): string {
  const trimmed = input.trim().replace(/\\/g, '/')
  if (!trimmed || trimmed.includes('\0')) throw new Error('That path is not safe.')
  if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) throw new Error('Build paths must stay inside the workspace.')
  const parts = trimmed.split('/').filter((part) => part.length > 0)
  if (parts.length === 0) throw new Error('That path is not safe.')
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('Build paths must stay inside the workspace.')
  if (parts.some((part) => /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(part) || part.length > 180)) {
    throw new Error('That path is not safe.')
  }
  return parts.join('/')
}

function assertInside(rootReal: string, target: string): void {
  const rel = relative(rootReal, target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Build paths must stay inside the workspace.')
}

function nearestExisting(start: string, rootReal: string): string {
  let current = start
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) throw new Error('That path is not safe.')
    current = parent
  }
  const real = realpathSync(current)
  assertInside(rootReal, real)
  return real
}

export function resolveWorkspacePath(root: string, requested: string): string {
  const relativePath = normalizeRelative(requested)
  const rootReal = realpathSync(root)
  const absolute = resolve(rootReal, ...relativePath.split('/'))
  nearestExisting(dirname(absolute), rootReal)
  assertInside(rootReal, absolute)
  return absolute
}

function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_KEEP) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    return
  }
  child.kill('SIGKILL')
}

export function assertCommand(command: string): string {
  const clean = command.trim()
  if (!clean || clean.length > 400) throw new Error('That verify command is not allowed.')
  if (/[\0\r\n]/.test(clean)) throw new Error('The verify command must be a single line.')
  return clean
}

export function runWorkspaceCommand(
  root: string,
  command: string,
  signal?: AbortSignal
): Promise<{ exitCode: number; output: string }> {
  const clean = assertCommand(command)
  const rootReal = realpathSync(root)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Cancelled.')
      error.name = 'CancelledError'
      reject(error)
      return
    }
    const file = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', clean] : ['-c', clean]
    const child = spawn(file, args, { cwd: rootReal, env: scrubbedEnv(), windowsHide: true })
    let output = ''
    let timedOut = false
    const append = (chunk: Buffer | string): void => {
      output = `${output}${String(chunk)}`.slice(-OUTPUT_CAP)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, COMMAND_TIMEOUT_MS)
    const onAbort = (): void => {
      killTree(child)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    let settled = false
    const finish = (handler: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      handler()
    }
    child.on('error', (error) => {
      finish(() => reject(error))
    })
    child.on('close', (code) => {
      finish(() => {
        if (signal?.aborted) {
          const error = new Error('Cancelled.')
          error.name = 'CancelledError'
          reject(error)
          return
        }
        if (timedOut) {
          resolve({ exitCode: 1, output: `${output}\nTimed out after 60 seconds.`.trim() })
          return
        }
        resolve({ exitCode: code ?? 1, output: output.trim() })
      })
    })
  })
}

function snapshot(absolute: string, relativePath: string): Snapshot {
  if (!existsSync(absolute)) return { absolute, relativePath, existed: false, before: '' }
  const stat = lstatSync(absolute)
  if (stat.isSymbolicLink()) throw new Error('Inhale will not write through a symlink.')
  if (!stat.isFile()) throw new Error('Inhale writes files, not directories.')
  const bytes = readFileSync(absolute)
  if (bytes.includes(0)) throw new Error('Inhale only changes text files.')
  return { absolute, relativePath, existed: true, before: bytes.toString('utf8') }
}

function rollback(snaps: Snapshot[]): void {
  for (const snap of [...snaps].reverse()) {
    if (!snap.existed) rmSync(snap.absolute, { force: true })
    else writeFileSync(snap.absolute, snap.before, { encoding: 'utf8' })
  }
}

export async function applyWorkspaceBuild(root: string, request: BuildRequest, signal?: AbortSignal): Promise<BuildOutcome> {
  const rootReal = realpathSync(root)
  if (!statSync(rootReal).isDirectory()) throw new Error('Open a folder before Inhale writes files.')
  const command = request.command ? assertCommand(request.command) : null
  const writes = request.files.map((file) => ({
    relativePath: normalizeRelative(file.path),
    absolute: resolveWorkspacePath(rootReal, file.path),
    content: file.content
  }))
  const deletions = request.delete.map((file) => ({
    relativePath: normalizeRelative(file),
    absolute: resolveWorkspacePath(rootReal, file)
  }))
  const seen = new Set<string>()
  for (const item of [...writes, ...deletions]) {
    const key = item.absolute.toLowerCase()
    if (seen.has(key)) throw new Error('That build touches the same path twice.')
    seen.add(key)
    if (item.relativePath.split('/').includes('node_modules') || item.relativePath.startsWith('.git/')) {
      throw new Error('Inhale will not write inside .git or node_modules.')
    }
  }
  for (const file of writes) {
    if (file.content.includes('\0')) throw new Error('Inhale only writes text files.')
  }

  const snaps = new Map<string, Snapshot>()
  for (const file of writes) snaps.set(file.absolute, snapshot(file.absolute, file.relativePath))
  for (const file of deletions) snaps.set(file.absolute, snapshot(file.absolute, file.relativePath))

  const applied: Snapshot[] = []
  const files: WorkspaceChange[] = [
    ...writes.map((file) => ({
      path: file.relativePath,
      before: snaps.get(file.absolute)?.before ?? '',
      after: file.content
    })),
    ...deletions.map((file) => ({
      path: file.relativePath,
      before: snaps.get(file.absolute)?.before ?? '',
      after: ''
    }))
  ]

  try {
    for (const file of writes) {
      mkdirSync(dirname(file.absolute), { recursive: true })
      writeFileSync(file.absolute, file.content, { encoding: 'utf8' })
      const snap = snaps.get(file.absolute)
      if (snap) applied.push(snap)
    }
    for (const file of deletions) {
      if (existsSync(file.absolute)) rmSync(file.absolute)
      const snap = snaps.get(file.absolute)
      if (snap) applied.push(snap)
    }
    if (!command) {
      return {
        ok: true,
        summary: request.summary,
        command: null,
        exitCode: null,
        output: '',
        reasons: ['Files stayed inside the workspace. No verify command was set.'],
        files
      }
    }
    const result = await runWorkspaceCommand(rootReal, command, signal)
    if (result.exitCode !== 0) {
      rollback(applied)
      const detail = result.output ? ` ${result.output.slice(0, 500)}` : ''
      return {
        ok: false,
        summary: request.summary,
        command,
        exitCode: result.exitCode,
        output: result.output,
        reasons: [`Verify command exited ${result.exitCode}.${detail}`.trim()],
        files
      }
    }
    return {
      ok: true,
      summary: request.summary,
      command,
      exitCode: 0,
      output: result.output,
      reasons: ['Verify command exited 0. The files were kept.'],
      files
    }
  } catch (error) {
    rollback(applied)
    throw error
  }
}
