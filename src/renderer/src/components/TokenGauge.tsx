import { formatPercent, formatTokens } from '../format'
import { useAppState } from '../state'

export function TokenGauge() {
  const { state } = useAppState()
  const graph = state.graph
  const baseline = graph?.baselineTokens ?? 0
  const active = graph?.activeTokens ?? 0
  const reduction = graph?.reduction ?? 0
  const width = baseline > 0 ? Math.max(6, Math.min(100, (active / baseline) * 100)) : 0
  const mode = graph?.reductionMode ?? 'projected'
  return (
    <section className="panel gauge">
      <p className="eyebrow">Context budget</p>
      <div className="gauge-figure">
        <strong>{baseline > 0 ? formatPercent(reduction) : '—'}</strong>
        <span>{mode === 'live' ? 'left out of this turn' : 'projected if two shards mount'}</span>
      </div>
      <div className="meter" aria-hidden="true">
        <div className="meter-fill" style={{ width: `${baseline > 0 ? width : 0}%` }} />
      </div>
      <dl>
        <div>
          <dt>Monolith</dt>
          <dd>{formatTokens(baseline)}</dd>
        </div>
        <div>
          <dt>Active</dt>
          <dd>{formatTokens(active)}</dd>
        </div>
        <div>
          <dt>Registry</dt>
          <dd>{formatTokens(graph?.registryTokens ?? 0)}</dd>
        </div>
      </dl>
      <p className="fine">
        {baseline > 0 && active > baseline
          ? 'The mounted context is larger than the monolith.'
          : 'Baseline is the raw file. Active is the locked core plus the shards actually mounted.'}
      </p>
    </section>
  )
}
