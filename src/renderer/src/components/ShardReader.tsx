import { useAppState } from '../state'

export function ShardReader() {
  const { state, dispatch } = useAppState()
  const shard = state.shard
  if (!shard) return null
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={() => dispatch({ type: 'shard', shard: null })}>
      <article className="reader" role="dialog" aria-modal="true" aria-labelledby="shard-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="panel-head">
          <div>
            <p className="eyebrow">{shard.locked ? 'Immutable' : `v${shard.version} · ${shard.source}`}</p>
            <h2 id="shard-title">{shard.title}</h2>
          </div>
          <button className="button ghost" type="button" onClick={() => dispatch({ type: 'shard', shard: null })}>
            Close
          </button>
        </header>
        {shard.locked ? <p className="pill bad">Locked identity core. Turns inject this first. Nothing in the registry can overwrite it.</p> : null}
        <pre>{shard.body}</pre>
        {shard.history.length > 0 ? (
          <ul className="history">
            {shard.history.map((entry) => (
              <li key={`${entry.version}-${entry.at}`}>
                v{entry.version} · {entry.decision} · {entry.tokenCount} tokens · {entry.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </div>
  )
}
