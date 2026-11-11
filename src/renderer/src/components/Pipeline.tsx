import { STAGES, useAppState } from '../state'
import type { IngestStage } from '../../../shared/types'

const LABELS: Record<IngestStage, string> = {
  received: 'Received',
  parsed: 'Parsed',
  stripped: 'Persona stripped',
  sharded: 'Sharded',
  compressed: 'Compressed',
  manifest: 'Manifest',
  done: 'Mounted ready',
  error: 'Stopped'
}

export function Pipeline() {
  const { state } = useAppState()
  const active = state.furthest ? STAGES.indexOf(state.furthest) : -1
  return (
    <ol className="pipeline">
      {STAGES.map((stage, index) => {
        const stateName = state.failedStage && index === active ? 'failed' : index < active ? 'done' : index === active && state.furthest ? 'now' : 'wait'
        return (
          <li key={stage} className={stateName}>
            <span>{index + 1}</span>
            <div>
              <strong>{LABELS[stage]}</strong>
              <small>{state.stages[stage] ?? 'Waiting'}</small>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
