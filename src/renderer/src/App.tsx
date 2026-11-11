import { useEffect } from 'react'
import { humanError } from './format'
import { useAppState } from './state'
import { DiffPane } from './components/DiffPane'
import { Dropzone } from './components/Dropzone'
import { KirbyMark } from './components/KirbyMark'
import { LoopInspector } from './components/LoopInspector'
import { Pipeline } from './components/Pipeline'
import { PromptDock } from './components/PromptDock'
import { SettingsSheet } from './components/SettingsSheet'
import { ShardReader } from './components/ShardReader'
import { SkillGraph } from './components/SkillGraph'
import { TokenGauge } from './components/TokenGauge'

export function App() {
  const { state, dispatch } = useAppState()

  useEffect(() => {
    const bridge = window.kirby
    if (!bridge) return
    void bridge
      .getConfig()
      .then((config) => dispatch({ type: 'config', config }))
      .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
    void bridge
      .getGraph()
      .then((graph) => dispatch({ type: 'graph', graph }))
      .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
    const onDrag = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', onDrag)
    window.addEventListener('drop', onDrag)
    return () => {
      window.removeEventListener('dragover', onDrag)
      window.removeEventListener('drop', onDrag)
    }
  }, [dispatch])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dispatch({ type: 'settings', open: false })
        dispatch({ type: 'shard', shard: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  if (!window.kirby) {
    return (
      <main className="missing">
        <KirbyMark size={84} />
        <h1>Kirby runs in Electron</h1>
        <p>The renderer has no Node access. Open the desktop shell so the sealed runtime can start.</p>
      </main>
    )
  }

  const providerName = state.config?.provider === 'openrouter' ? 'OpenRouter' : 'Ollama Cloud'
  const model = state.config?.catalog.find((item) => item.provider === state.config?.provider && item.id === state.config?.model)

  return (
    <div className="sky">
      <header className="topbar">
        <div className="brand">
          <KirbyMark />
          <div>
            <h1>Kirby</h1>
            <p>Inhale a playbook. Mount only what the turn needs.</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="provider-pill" type="button" onClick={() => dispatch({ type: 'settings', open: true })}>
            <span>{providerName}</span>
            <strong>{model?.label ?? 'Choose a model'}</strong>
            <i className={state.config?.keys[state.config.provider] ? 'sealed' : 'open'} />
          </button>
          <button
            className="button ghost"
            type="button"
            disabled={state.busy !== 'idle'}
            onClick={() => {
              const bridge = window.kirby
              if (!bridge) return
              dispatch({ type: 'busy', busy: 'compress' })
              void bridge
                .compressBloated()
                .then((graph) => dispatch({ type: 'graph', graph }))
                .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
                .finally(() => dispatch({ type: 'busy', busy: 'idle' }))
            }}
          >
            Compress
          </button>
        </div>
      </header>
      {state.error ? (
        <div className="banner" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={() => dispatch({ type: 'error', error: null })}>
            Dismiss
          </button>
        </div>
      ) : null}
      <main className="stage">
        <section className="column ingest">
          <Dropzone />
          <Pipeline />
        </section>
        <SkillGraph />
        <section className="column side">
          <TokenGauge />
          <PromptDock />
        </section>
      </main>
      <footer className="lower">
        <LoopInspector />
        <DiffPane />
      </footer>
      <SettingsSheet />
      <ShardReader />
    </div>
  )
}
