// Top bar. Achromatic by rule (ADR-0024): the selected mode is a raised
// plane, not a coloured one, so the only colours on screen stay the cause
// colours.

const MODES = [
  ['observe', '관측'],
  ['edit', '편집'],
  ['wargame', '교전'],
]

export default function Topbar({ scenarios, scenarioId, onScenario, mode, onMode, phases, onHelp }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">MC-CyCOP</span>
        <span className="brand-sub">임무중심 사이버 공동상황도</span>
      </div>

      <span className="tb-rule" />

      <div className="tb-field">
        <label htmlFor="scenario">시나리오</label>
        <select id="scenario" value={scenarioId || ''} onChange={(e) => onScenario(e.target.value)}>
          {scenarios.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </div>

      <div className="seg" role="group" aria-label="모드">
        {MODES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={mode === id ? 'on' : ''}
            aria-pressed={mode === id}
            onClick={() => onMode(id)}
          >{label}</button>
        ))}
      </div>

      <span className="tb-spacer" />

      <div className="tb-phase">
        {phases.length ? <>활성 단계 <b>{phases.join(' · ')}</b></> : '활성 단계 없음'}
      </div>

      <button type="button" className="help-btn" title="이 화면 읽는 법" onClick={onHelp}>?</button>
    </header>
  )
}
