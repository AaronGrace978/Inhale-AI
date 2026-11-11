import type { ModelOption, ProviderId } from './types'

/**
 * Official hosts only. Callers cannot substitute a base URL, so a sealed key
 * cannot be redirected to an arbitrary server.
 */
export const PROVIDER_ORIGINS: Record<ProviderId, string> = {
  'ollama-cloud': 'https://ollama.com/v1',
  openrouter: 'https://openrouter.ai/api/v1'
}

export const COMPLETION_URLS: Record<ProviderId, string> = {
  'ollama-cloud': 'https://ollama.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions'
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  'ollama-cloud': 'kimi-k3.1-pro',
  openrouter: 'anthropic/claude-opus-5.5'
}

/**
 * Curated November 2026 flagships. Ollama Cloud ids are the cloud tags.
 * OpenRouter ids are the public model slugs. Batch and free variants are omitted.
 */
export const MODEL_CATALOG: ModelOption[] = [
  {
    id: 'kimi-k3.1-pro',
    provider: 'ollama-cloud',
    label: 'Kimi K3.1 Pro',
    vendor: 'Moonshot',
    tier: 'flagship',
    contextTokens: 1_000_000,
    note: 'Highest scored Ollama Cloud model. Agentic flagship with a 1M window.'
  },
  {
    id: 'deepseek-v4.1-flash',
    provider: 'ollama-cloud',
    label: 'DeepSeek V4.1 Flash',
    vendor: 'DeepSeek',
    tier: 'balanced',
    contextTokens: 1_000_000,
    note: 'Best capability-to-cost model on Ollama Cloud. Strong default for long loops.'
  },
  {
    id: 'glm-5.3',
    provider: 'ollama-cloud',
    label: 'GLM 5.3',
    vendor: 'Z.ai',
    tier: 'frontier',
    contextTokens: 1_000_000,
    note: 'Top-tier general model on Ollama Cloud, behind Kimi and DeepSeek V4.1 Flash.'
  },
  {
    id: 'mimo-v2.6-pro',
    provider: 'ollama-cloud',
    label: 'MiMo V2.6 Pro',
    vendor: 'Xiaomi',
    tier: 'frontier',
    contextTokens: 1_000_000,
    note: 'Large MoE with strong agent scores and a low cache rate.'
  },
  {
    id: 'muse-spark-open',
    provider: 'ollama-cloud',
    label: 'Muse Spark Open',
    vendor: 'Meta',
    tier: 'frontier',
    contextTokens: 1_000_000,
    note: 'Built for coding and long-horizon agent work.'
  },
  {
    id: 'minimax-m3.1-flash',
    provider: 'ollama-cloud',
    label: 'MiniMax M3.1 Flash',
    vendor: 'MiniMax',
    tier: 'fast',
    contextTokens: 976_000,
    note: 'Fast agentic flash model for tool use and coding.'
  },
  {
    id: 'mistral-large-4',
    provider: 'ollama-cloud',
    label: 'Mistral Large 4',
    vendor: 'Mistral',
    tier: 'balanced',
    contextTokens: 1_000_000,
    note: 'Open-weight multimodal general model on Ollama Cloud.'
  },
  {
    id: 'beam',
    provider: 'ollama-cloud',
    label: 'Beam',
    vendor: 'Reflection',
    tier: 'fast',
    contextTokens: 1_000_000,
    note: 'Token-efficient coding and tool-use model.'
  },
  {
    id: 'anthropic/claude-opus-5.5',
    provider: 'openrouter',
    label: 'Claude Opus 5.5',
    vendor: 'Anthropic',
    tier: 'flagship',
    contextTokens: 1_000_000,
    note: 'OpenRouter flagship for long-horizon coding, review, and agent work.'
  },
  {
    id: 'anthropic/claude-fable-5.2',
    provider: 'openrouter',
    label: 'Claude Fable 5.2',
    vendor: 'Anthropic',
    tier: 'frontier',
    contextTokens: 1_000_000,
    note: 'Highest-priced Anthropic tier on OpenRouter.'
  },
  {
    id: 'openai/gpt-6.1-sol-pro',
    provider: 'openrouter',
    label: 'GPT-6.1 Sol Pro',
    vendor: 'OpenAI',
    tier: 'flagship',
    contextTokens: 1_050_000,
    note: 'OpenAI flagship tier on OpenRouter.'
  },
  {
    id: 'openai/gpt-6.1-terra-pro',
    provider: 'openrouter',
    label: 'GPT-6.1 Terra Pro',
    vendor: 'OpenAI',
    tier: 'frontier',
    contextTokens: 1_050_000,
    note: 'OpenAI frontier model with a 1.05M window.'
  },
  {
    id: 'moonshotai/kimi-k3.1-pro',
    provider: 'openrouter',
    label: 'Kimi K3.1 Pro',
    vendor: 'Moonshot',
    tier: 'flagship',
    contextTokens: 1_048_576,
    note: 'Same K3.1 Pro class, routed through OpenRouter.'
  },
  {
    id: 'z-ai/glm-5.3-prime',
    provider: 'openrouter',
    label: 'GLM 5.3 Prime',
    vendor: 'Z.ai',
    tier: 'frontier',
    contextTokens: 1_000_000,
    note: 'Top GLM 5.3 tier on OpenRouter.'
  },
  {
    id: 'z-ai/glm-5.3',
    provider: 'openrouter',
    label: 'GLM 5.3',
    vendor: 'Z.ai',
    tier: 'balanced',
    contextTokens: 1_048_576,
    note: 'GLM 5.3 general model on OpenRouter.'
  },
  {
    id: 'tencent/hy4',
    provider: 'openrouter',
    label: 'Hy4',
    vendor: 'Tencent',
    tier: 'frontier',
    contextTokens: 1_048_576,
    note: 'Frontier agent model and one of the most used on OpenRouter.'
  },
  {
    id: 'meta/muse-wonder',
    provider: 'openrouter',
    label: 'Muse Wonder',
    vendor: 'Meta',
    tier: 'frontier',
    contextTokens: 1_048_576,
    note: 'Meta flagship on OpenRouter.'
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    provider: 'openrouter',
    label: 'DeepSeek V4.1 Flash',
    vendor: 'DeepSeek',
    tier: 'balanced',
    contextTokens: 1_048_576,
    note: 'Most-used coding model family on OpenRouter, in the efficient tier.'
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    provider: 'openrouter',
    label: 'Claude Sonnet 5.5',
    vendor: 'Anthropic',
    tier: 'fast',
    contextTokens: 1_000_000,
    note: 'Faster Anthropic tier for interactive turns.'
  },
  {
    id: 'mistralai/mistral-large-4-0',
    provider: 'openrouter',
    label: 'Mistral Large 4',
    vendor: 'Mistral',
    tier: 'balanced',
    contextTokens: 1_048_576,
    note: 'Mistral Large 4 on OpenRouter.'
  },
  {
    id: 'openrouter/auto-code',
    provider: 'openrouter',
    label: 'Auto Code',
    vendor: 'OpenRouter',
    tier: 'router',
    contextTokens: 2_000_000,
    note: 'OpenRouter coding router. Picks a high coding tier per request.'
  }
]

export function modelsFor(provider: ProviderId): ModelOption[] {
  return MODEL_CATALOG.filter((model) => model.provider === provider)
}

export function findModel(provider: ProviderId, id: string): ModelOption | undefined {
  return MODEL_CATALOG.find((model) => model.provider === provider && model.id === id)
}

export function assertCatalogModel(provider: ProviderId, id: string): ModelOption {
  const model = findModel(provider, id)
  if (!model) {
    throw new Error(`Model ${id} is not in the ${provider} catalog.`)
  }
  return model
}
