import { useState } from 'react'
import type { ProviderId } from '../../../shared/types'
import { humanError } from '../format'
import { useAppState } from '../state'

export function SettingsSheet() {
  const { state, dispatch } = useAppState()
  const [key, setKey] = useState('')
  const config = state.config
  if (!state.settingsOpen || !config) return null
  const models = config.catalog.filter((model) => model.provider === config.provider)
  const bridge = window.kirby

  async function chooseProvider(next: ProviderId): Promise<void> {
    if (!bridge) return
    const updated = await bridge.setProvider(next)
    dispatch({ type: 'config', config: updated })
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={() => dispatch({ type: 'settings', open: false })}>
      <aside
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="panel-head">
          <div>
            <p className="eyebrow">Cloud providers</p>
            <h2 id="settings-title">Ollama Cloud & OpenRouter</h2>
          </div>
          <button className="button ghost" type="button" onClick={() => dispatch({ type: 'settings', open: false })}>
            Close
          </button>
        </header>
        <div className="provider-switch">
          {(['ollama-cloud', 'openrouter'] as const).map((id) => (
            <button key={id} type="button" className={config.provider === id ? 'on' : ''} onClick={() => void chooseProvider(id)}>
              {id === 'ollama-cloud' ? 'Ollama Cloud' : 'OpenRouter'}
            </button>
          ))}
        </div>
        <p className="fine">Endpoint is fixed. Kirby will not send a key anywhere else.</p>
        <code className="endpoint">{config.endpoints[config.provider]}</code>
        <ul className="model-list">
          {models.map((model) => (
            <li key={model.id}>
              <button
                type="button"
                className={config.model === model.id && config.provider === model.provider ? 'on' : ''}
                onClick={() => {
                  if (!bridge) return
                  void bridge
                    .setModel(model.id)
                    .then((updated) => dispatch({ type: 'config', config: updated }))
                    .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
                }}
              >
                <span className={`tier ${model.tier}`}>{model.tier}</span>
                <strong>{model.label}</strong>
                <em>{model.vendor}</em>
                <small>{model.note}</small>
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!bridge || key.trim().length === 0) return
            void bridge
              .setApiKey(config.provider, key)
              .then((updated) => {
                setKey('')
                dispatch({ type: 'config', config: updated })
              })
              .catch((error: unknown) => dispatch({ type: 'error', error: humanError(error) }))
          }}
        >
          <label>
            {config.provider === 'ollama-cloud' ? 'Ollama Cloud' : 'OpenRouter'} API key
            <input
              type="password"
              value={key}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste once. This window cannot read it back."
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <div className="dock-actions">
            <button className="button" type="submit" disabled={key.trim().length < 8}>
              Seal key
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={() => {
                if (!bridge) return
                void bridge.clearApiKey(config.provider).then((updated) => dispatch({ type: 'config', config: updated }))
              }}
            >
              Clear
            </button>
            <span className={config.keys[config.provider] ? 'pill good' : 'pill bad'}>
              {config.keys[config.provider] ? 'Sealed in the main process' : 'No key sealed'}
            </span>
          </div>
        </form>
      </aside>
    </div>
  )
}
