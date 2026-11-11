import { useState } from 'react'
import { humanError } from '../format'
import { useAppState } from '../state'
import { InhaleMark } from './InhaleMark'

function isMarkdown(file: File): boolean {
  return /\.(md|markdown)$/i.test(file.name)
}

export function Dropzone() {
  const { state, dispatch } = useAppState()
  const [hot, setHot] = useState(false)
  const bridge = window.inhale

  async function ingestFile(file: File): Promise<void> {
    if (!bridge) return
    if (!isMarkdown(file)) {
      dispatch({ type: 'error', error: 'Inhale only inhales .md playbooks.' })
      return
    }
    if (file.size > 1_500_000) {
      dispatch({ type: 'error', error: 'That playbook is larger than Inhale will inhale.' })
      return
    }
    dispatch({ type: 'busy', busy: 'ingest' })
    dispatch({ type: 'error', error: null })
    try {
      const content = await file.text()
      const graph = await bridge.ingest({ filename: file.name, content })
      dispatch({ type: 'graph', graph })
    } catch (error) {
      dispatch({ type: 'error', error: humanError(error) })
    } finally {
      dispatch({ type: 'busy', busy: 'idle' })
    }
  }

  return (
    <div
      className={hot ? 'dropzone hot' : 'dropzone'}
      onDragEnter={(event) => {
        event.preventDefault()
        setHot(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setHot(true)
      }}
      onDragLeave={() => setHot(false)}
      onDrop={(event) => {
        event.preventDefault()
        setHot(false)
        const files = [...event.dataTransfer.files]
        void (async () => {
          for (const file of files) await ingestFile(file)
        })()
      }}
    >
      <InhaleMark size={72} />
      <div>
        <h2>Drop a playbook</h2>
        <p>Vendor personas are stripped before a single shard is saved.</p>
      </div>
      <div className="drop-actions">
        <button
          className="button"
          type="button"
          disabled={state.busy !== 'idle'}
          onClick={() => {
            void (async () => {
              if (!bridge) return
              dispatch({ type: 'busy', busy: 'ingest' })
              dispatch({ type: 'error', error: null })
              try {
                const graph = await bridge.ingestDialog()
                if (graph) dispatch({ type: 'graph', graph })
              } catch (error) {
                dispatch({ type: 'error', error: humanError(error) })
              } finally {
                dispatch({ type: 'busy', busy: 'idle' })
              }
            })()
          }}
        >
          Choose markdown
        </button>
        <button
          className="button ghost"
          type="button"
          disabled={state.busy !== 'idle'}
          onClick={() => {
            void (async () => {
              if (!bridge) return
              dispatch({ type: 'busy', busy: 'ingest' })
              dispatch({ type: 'error', error: null })
              try {
                const graph = await bridge.ingestSample()
                dispatch({ type: 'graph', graph })
              } catch (error) {
                dispatch({ type: 'error', error: humanError(error) })
              } finally {
                dispatch({ type: 'busy', busy: 'idle' })
              }
            })()
          }}
        >
          Inhale the sample
        </button>
      </div>
    </div>
  )
}
