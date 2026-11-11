import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { redactSecrets } from './redact'

export interface SandboxResult {
  exitCode: number
  error?: string
}

const FORBIDDEN = /\b(process|require|import|fetch|child_process|worker_threads|net|http|https|fs)\b/

export function runSandboxedJs(code: string, timeoutMs = 1500): SandboxResult {
  if (code.length > 20_000) return { exitCode: 1, error: 'Verification script is too large.' }
  if (FORBIDDEN.test(code)) return { exitCode: 1, error: 'Verification script asked for a forbidden API.' }
  const directory = mkdtempSync(join(tmpdir(), 'inhale-verify-'))
  const file = join(directory, 'check.js')
  try {
    writeFileSync(file, `'use strict';\n${code}\n`, { encoding: 'utf8', mode: 0o600 })
    const env: NodeJS.ProcessEnv = {}
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    const result = spawnSync(
      process.execPath,
      ['--permission', `--allow-fs-read=${file}`, '--disable-proto=delete', file],
      {
        cwd: directory,
        env,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
        windowsHide: true
      }
    )
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      return { exitCode: 1, error: 'Verification script timed out.' }
    }
    const exitCode = typeof result.status === 'number' ? result.status : 1
    if (exitCode === 0) return { exitCode: 0 }
    const detail = redactSecrets(`${result.stderr || result.stdout || 'non-zero exit'}`).trim()
    return { exitCode, error: detail.slice(0, 300) || 'Verification script failed.' }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function extractVerifyScripts(markdown: string): string[] {
  const scripts: string[] = []
  const pattern = /```verifyjs\s*\n([\s\S]*?)```/gi
  for (const match of markdown.matchAll(pattern)) {
    if (match[1]?.trim()) scripts.push(match[1].trim())
  }
  return scripts
}
