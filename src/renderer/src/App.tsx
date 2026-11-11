import { useEffect } from 'react'
import { humanError } from './format'
import { useAppState } from './state'
import { DiffPane } from './components/DiffPane'
import { Dropzone } from './components/Dropzone'
import { InhaleMark } from './components/InhaleMark'
import { LoopInspector } from './components/LoopInspector'
import { Pipeline } from './components/Pipeline'
import { PromptDock } from './components/PromptDock'
import { SettingsSheet } from './components/SettingsSheet'
import { ShardReader } from './components/ShardReader'
import { SkillGraph } from './components/SkillGraph'
import { TokenGauge } from './components/TokenGauge'

function folderName(path: string | null): string {
  if (!path) return 'Open a folder'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function App() {
  const { state, dispatch } = useAppState()

  useEffect(() => {
    const bridge = window.inhale
    if (!bridge) return
    void bridge
      .getConfig()
      .then((config) => dispatch({ type: 'config', config }))
      .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
    void bridge
      .getGraph()
      .then((graph) => dispatch({ type: 'graph', graph }))
      .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
    void bridge
      .getWorkspace()
      .then((workspace) => dispatch({ type: 'workspace', path: workspace.path }))
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

  if (!window.inhale) {
    return (
      <main className="missing">
        <InhaleMark size={84} />
        <h1>Inhale runs in Electron</h1>
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
          <InhaleMark />
          <div>
            <h1>Inhale</h1>
            <p>Inhale a playbook. Build in an open folder.</p>
          </div>
        </div>
        <div className="top-actions">
          <button
            className="button ghost workspace-pill"
            type="button"
            disabled={state.busy !== 'idle'}
            title={state.workspace ?? 'Open a folder'}
            onClick={() => {
              const bridge = window.inhale
              if (!bridge) return
              void bridge
                .chooseWorkspace()
                .then((workspace) => dispatch({ type: 'workspace', path: workspace.path }))
                .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
            }}
          >
            <span>Folder</span>
            <strong>{folderName(state.workspace)}</strong>
          </button>
          {state.workspace ? (
            <button
              className="button ghost"
              type="button"
              disabled={state.busy !== 'idle'}
              onClick={() => {
                const bridge = window.inhale
                if (!bridge) return
                void bridge
                  .clearWorkspace()
                  .then(() => dispatch({ type: 'workspace', path: null }))
                  .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
              }}
            >
              Close folder
            </button>
          ) : null}
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
              const bridge = window.inhale
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
