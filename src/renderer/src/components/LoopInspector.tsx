import { useEffect, useRef } from 'react'
import { useAppState } from '../state'

export function LoopInspector() {
  const { state } = useAppState()
  const timeline = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const node = timeline.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [state.pav.length])
  return (
    <section className="panel inspector">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Recursive loop</p>
          <h2>Plan → Act → Verify</h2>
        </div>
      </header>
      <ol className="timeline" ref={timeline}>
        {state.pav.length === 0 ? <li className="wait">The state machine is quiet.</li> : null}
        {state.pav.map((entry) => (
          <li key={entry.id} className={entry.state.toLowerCase()}>
            <b>{entry.state}</b>
            <span>{entry.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
