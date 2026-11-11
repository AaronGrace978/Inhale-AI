import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MODELS, MODEL_CATALOG, PROVIDER_ORIGINS, assertCatalogModel, findModel } from '../shared/catalog'
import type { ProviderId, PublicConfig } from '../shared/types'
import { assertApiKey } from './redact'
import type { Sealer, SecretBox } from './seal'

interface StoredConfig {
  provider: ProviderId
  models: Record<ProviderId, string>
  secrets: Partial<Record<ProviderId, SecretBox>>
}

function defaults(): StoredConfig {
  return {
    provider: 'ollama-cloud',
    models: { ...DEFAULT_MODELS },
    secrets: {}
  }
}

export class ConfigStore {
  private readonly file: string
  private stored: StoredConfig

  constructor(
    directory: string,
    private readonly sealer: Sealer
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    this.file = join(directory, 'config.json')
    this.stored = this.load()
  }

  publicView(): PublicConfig {
    const provider = this.stored.provider
    return {
      provider,
      model: this.stored.models[provider],
      catalog: MODEL_CATALOG.map((model) => ({ ...model })),
      keys: {
        'ollama-cloud': Boolean(this.stored.secrets['ollama-cloud']),
        openrouter: Boolean(this.stored.secrets.openrouter)
      },
      endpoints: { ...PROVIDER_ORIGINS },
      identityLocked: true
    }
  }

  getKey(provider: ProviderId): string | null {
    const box = this.stored.secrets[provider]
    if (!box) return null
    const plain = this.sealer.open(box).trim()
    if (!plain) return null
    return plain
  }

  setProvider(provider: ProviderId): PublicConfig {
    this.stored = { ...this.stored, provider, models: this.normalizeModels(this.stored.models) }
    this.persist()
    return this.publicView()
  }

  setModel(model: string): PublicConfig {
    const provider = this.stored.provider
    assertCatalogModel(provider, model)
    this.stored = {
      ...this.stored,
      models: { ...this.stored.models, [provider]: model }
    }
    this.persist()
    return this.publicView()
  }

  setKey(provider: ProviderId, apiKey: string): PublicConfig {
    const sealed = this.sealer.seal(assertApiKey(apiKey))
    this.stored = {
      ...this.stored,
      secrets: { ...this.stored.secrets, [provider]: sealed }
    }
    this.persist()
    return this.publicView()
  }

  clearKey(provider: ProviderId): PublicConfig {
    const secrets = { ...this.stored.secrets }
    delete secrets[provider]
    this.stored = { ...this.stored, secrets }
    this.persist()
    return this.publicView()
  }

  private normalizeModels(models: Partial<Record<ProviderId, string>>): Record<ProviderId, string> {
    const next = { ...DEFAULT_MODELS }
    for (const provider of ['ollama-cloud', 'openrouter'] as const) {
      const candidate = models[provider]
      if (candidate && findModel(provider, candidate)) next[provider] = candidate
    }
    return next
  }

  private load(): StoredConfig {
    if (!existsSync(this.file)) return defaults()
    try {
      chmodSync(this.file, 0o600)
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredConfig>
      const provider = parsed.provider === 'openrouter' ? 'openrouter' : 'ollama-cloud'
      return {
        provider,
        models: this.normalizeModels(parsed.models ?? {}),
        secrets: parsed.secrets ?? {}
      }
    } catch {
      throw new Error('The local config file is damaged.')
    }
  }

  private persist(): void {
    const temporary = `${this.file}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(this.stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, this.file)
    chmodSync(this.file, 0o600)
  }
}
