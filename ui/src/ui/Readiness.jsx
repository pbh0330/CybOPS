import { readiness } from '../sandbox.js'
import { assetName } from '../labels.js'

// The readiness card (sandbox, ADR-0027). It sits above the mission card
// because in the sandbox the first question is not "how bad is it" but
// "is the board even playable": the engine reads a service with no
// provider as degradation 0, so an empty board looks like a healthy one.
// The card counts what is still missing and names it; the same readiness()
// result locks the start button in Wargame.jsx.

const name = (g, list, id) => ((list || []).find((x) => x.id === id) || {}).name || id

export default function Readiness({ graph }) {
  const r = readiness(graph)
  const row = (label, ok, total, missing) => (
    <div className={`rd-row${missing.length ? ' is-short' : ''}`}>
      <span className="rd-label">{label}</span>
      <b className="rd-count">{ok}/{total}</b>
      {missing.length > 0 && <span className="rd-missing" title={missing.join(', ')}>{missing.join(', ')}</span>}
    </div>
  )
  return (
    <div className={`rd${r.ready ? ' is-ready' : ''}`}>
      <div className="rail-head"><h2>준비도</h2><span className="when">{r.ready ? '교전 가능' : '구성 중'}</span></div>
      {row('서비스 제공', r.services.ok, r.services.total, r.services.missing.map((id) => name(graph, graph.services, id)))}
      {row('작업 배치', r.tasks.ok, r.tasks.total, r.tasks.missing.map((id) => name(graph, graph.tasks, id)))}
      <div className={`rd-row${r.isolated.length ? ' is-warn' : ''}`}>
        <span className="rd-label">고립 자산</span>
        <b className="rd-count">{r.isolated.length}</b>
        {r.isolated.length > 0 && <span className="rd-missing" title={r.isolated.join(', ')}>{r.isolated.map((id) => assetName(graph, id).ko).join(', ')}</span>}
      </div>
      <div className="rd-row">
        <span className="rd-label">보석</span>
        <b className="rd-count">{r.jewels}</b>
        {r.jewels === 0 && <span className="rd-missing">보석 방어 모드는 잠김</span>}
      </div>
      <p className="rail-caption">서비스마다 제공 자산, 작업마다 수행 자산이 있어야 교전이 열린다. 엔진은 제공자 없는 서비스를 저하 0 으로 보기 때문이다(ADR-0027).</p>
    </div>
  )
}
