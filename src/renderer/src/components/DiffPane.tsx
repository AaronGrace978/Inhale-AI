import { alignDiff } from '../../../core/diffview'
import { formatPercent, formatTokens } from '../format'
import { useAppState } from '../state'

export function DiffPane() {
  const { state, dispatch } = useAppState()
  const diff = state.diffs[state.diffIndex]
  const aligned = diff ? alignDiff(diff.before, diff.after) : null
  return (
    <section className="panel diff-pane">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Rule diff</p>
          <h2>{diff ? diff.title : 'No edit yet'}</h2>
        </div>
        {diff ? <span className={diff.decision === 'COMMITTED' ? 'pill good' : 'pill bad'}>{diff.decision}</span> : null}
      </header>
      {state.diffs.length > 1 ? (
        <div className="diff-tabs">
          {state.diffs.map((item, index) => (
            <button key={`${item.shardId}-${index}`} type="button" className={index === state.diffIndex ? 'on' : ''} onClick={() => dispatch({ type: 'diff', index })}>
              {item.decision === 'COMMITTED' ? 'Kept' : 'Dropped'} · {item.title}
            </button>
          ))}
        </div>
      ) : null}
      {diff && aligned ? (
        <>
          <p className="fine">
            {formatTokens(diff.beforeTokens)} → {formatTokens(diff.afterTokens)} tokens · pass {formatPercent(diff.beforePassRate)} →{' '}
            {formatPercent(diff.afterPassRate)}. {diff.reasons.join(' ')}
          </p>
          <div className="diff-grid">
            <div>
              <h3>Before</h3>
              {aligned.rows.map((row, index) => (
                <div key={`b-${index}`} className={`diff-line ${row.kind === 'add' ? 'gap' : row.kind}`}>
                  {row.before || ' '}
                </div>
              ))}
            </div>
            <div>
              <h3>After</h3>
              {aligned.rows.map((row, index) => (
                <div key={`a-${index}`} className={`diff-line ${row.kind === 'del' ? 'gap' : row.kind}`}>
                  {row.after || ' '}
                </div>
              ))}
            </div>
          </div>
          {aligned.truncated ? <p className="fine">Showing the first 500 changed rows.</p> : null}
        </>
      ) : (
        <p className="placeholder">Compression and rejected rewrites land here, side by side, before anything touches disk.</p>
      )}
    </section>
  )
}
