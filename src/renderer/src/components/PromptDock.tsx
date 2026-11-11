import { useState } from 'react'
import { humanError } from '../format'
import { useAppState } from '../state'

const BLOAT_PROMPT = 'Add more detail to the reproduce flaky test skill'
const BUILD_PROMPT = 'Build a single index.html in this folder. Pink background, the word Inhale, and nothing else. No verify command.'

export function PromptDock() {
  const { state, dispatch } = useAppState()
  const [prompt, setPrompt] = useState('How should I reproduce a flaky test before changing code?')
  const bridge = window.inhale
  const mounted = state.graph?.shards.filter((shard) => shard.active) ?? []

  async function run(text: string): Promise<void> {
    if (!bridge) return
    dispatch({ type: 'busy', busy: 'turn' })
    dispatch({ type: 'error', error: null })
    try {
      const result = await bridge.runTurn(text)
      dispatch({ type: 'request', requestId: result.requestId })
    } catch (error) {
      dispatch({ type: 'error', error: humanError(error) })
    } finally {
      dispatch({ type: 'busy', busy: 'idle' })
    }
  }

  return (
    <section className="panel dock">
      <p className="eyebrow">Turn</p>
      <p className="mode-note">{state.modeDetail}</p>
      <div className="chips">
        {mounted.length === 0 ? <span className="chip dim">No shard mounted</span> : null}
        {mounted.map((shard) => (
          <span key={shard.id} className="chip">
            {shard.title}
          </span>
        ))}
      </div>
      <textarea
        value={prompt}
        aria-label="Prompt"
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Ask Inhale, or tell it to build in the open folder…"
      />
      <div className="dock-actions">
        <button className="button" type="button" disabled={state.busy !== 'idle' || prompt.trim().length === 0} onClick={() => void run(prompt)}>
          {state.busy === 'turn' ? 'Running' : 'Run turn'}
        </button>
        <button
          className="button ghost"
          type="button"
          disabled={state.busy !== 'idle' || !state.requestId}
          onClick={() => {
            if (!bridge || !state.requestId) return
            void bridge.cancelTurn(state.requestId)
          }}
        >
          Cancel
        </button>
        <button className="button ghost" type="button" disabled={state.busy !== 'idle'} onClick={() => void run(BLOAT_PROMPT)}>
          Try a bloated edit
        </button>
        <button className="button ghost" type="button" disabled={state.busy !== 'idle' || !state.workspace} onClick={() => void run(BUILD_PROMPT)}>
          Build a page
        </button>
      </div>
      <div className="answer" aria-live="polite">
        {state.chat ? state.chat : <span className="placeholder">Answers land here. Keys stay in the main process.</span>}
        {state.busy === 'turn' ? <i className="caret" /> : null}
      </div>
    </section>
  )
}
