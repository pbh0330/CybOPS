import { useCallback, useEffect, useRef, useState } from 'react'
import { kpiOf, clockOf, pct } from '../derive.js'
import { CAUSE_COLOR } from '../graph.js'
import { SANDBOX_ID } from '../sandbox.js'

// Top strip. Achromatic by rule (ADR-0024/0025): the numbers are big, the
// chrome is not coloured, and the only hue is the cause dot on the cut count.

const MODES = [['observe', '관측'], ['edit', '편집'], ['wargame', '교전']]

function Ring({ value }) {
  const r = 13, c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <svg className="kpi-ring" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="3" />
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--text-primary)" strokeWidth="3"
        strokeDasharray={`${c * v} ${c}`} strokeLinecap="round" transform="rotate(-90 16 16)" />
    </svg>
  )
}

const scenarioLabel = (id) => (id === SANDBOX_ID ? `${id} · 교전장` : id)

export default function Topbar({ scenarios, scenarioId, onScenario, mode, onMode, phases, onHelp, graph, step, game, sandbox = false, compact = false, onMenuNode }) {
  // The `⋯` panel exists only on a narrow screen, and it is a PLACE, not a
  // second set of controls: the mode switch below moves into it, and the view
  // switch, the label toggle, the sandbox tools and the speed control are
  // portaled into it by the components that own them (App hands them this
  // node). One control, one node, wherever it happens to be parented.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const btnRef = useRef(null)

  const setMenuEl = useCallback((node) => {
    menuRef.current = node
    if (onMenuNode) onMenuNode(node)
  }, [onMenuNode])

  // widening the window takes the panel away; it must not stay "open"
  useEffect(() => { if (!compact) setMenuOpen(false) }, [compact])

  useEffect(() => {
    if (!menuOpen) return
    // DOM containment, not React containment: what is inside the panel
    // arrives through a portal, so a React-tree test would call a tap on the
    // view switch an outside tap and close the panel under the finger.
    const onDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return
      if (btnRef.current && btnRef.current.contains(e.target)) return
      setMenuOpen(false)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      if (btnRef.current) btnRef.current.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const k = kpiOf(graph, step)
  // The sandbox has no time axis, so every phase is active at once; listing
  // every name overflows the strip, so say so in two words instead.
  const phaseText = sandbox ? '전체(정적)' : phases.join(' · ')
  const clock = clockOf(step)
  // During a game the engine sees an isolated asset as compromise 1
  // (game.js compromiseOf), so the projected step counts it as compromised.
  // Isolation is the defender's own mark: take it out of the count and show
  // it separately.
  const isolated = game ? game.isolated.length : 0
  const compromised = Math.max(0, k.compromised.n - isolated)
  // built once, parented once: in the strip on a desktop, in the panel on a
  // phone. Never both.
  const modeSeg = (
    <div className="seg" role="group" aria-label="모드">
      {MODES.map(([id, label]) => (
        <button key={id} type="button" className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => onMode(id)}>{label}</button>
      ))}
    </div>
  )
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
          {scenarios.map((id) => <option key={id} value={id}>{scenarioLabel(id)}</option>)}
        </select>
      </div>
      {!compact && modeSeg}
      <span className="tb-rule" />

      <div className="kpis">
        {k.missions.map((m) => (
          <div className={`kpi${m.active ? '' : ' inactive'}`} key={m.id}>
            <Ring value={m.active ? m.total : 0} />
            <div>
              <div className="kpi-v">{m.active ? pct(m.total) : '—'}</div>
              <div className="kpi-l">{m.name} <span className="ref">P{m.priority}</span></div>
            </div>
          </div>
        ))}
        {game && (
          <div className="kpi kpi-game">
            <div>
              <div className="kpi-v">{game.phase === 'over' ? (game.result.win ? '승' : '패') : `${Math.min(game.turn + 1, game.cfg.turns)}/${game.cfg.turns}`}<small>{game.cfg.mode === 'hold' ? game.score.total.toFixed(2) : game.score.total}</small></div>
              <div className="kpi-l">교전 {game.phase === 'over' ? '종료' : '턴'} · 점수</div>
            </div>
          </div>
        )}
        <div className="kpi">
          <div>
            <div className="kpi-v">{compromised}<small>/{k.compromised.total}</small>{isolated > 0 && <small>격리 {isolated}</small>}</div>
            <div className="kpi-l">침해 자산</div>
          </div>
        </div>
        <div className="kpi">
          <div>
            <div className="kpi-v">{k.cuts.n}
              <span className="kpi-dots">{Object.entries(k.cuts.byCause).map(([c, n]) => (
                <i key={c} title={`${c} ${n}`} style={{ background: CAUSE_COLOR[c] || CAUSE_COLOR.unknown }} />
              ))}</span>
            </div>
            <div className="kpi-l">단절 링크</div>
          </div>
        </div>
        <div className={`kpi kpi-band lv${k.band.level}`}>
          <div>
            <div className="kpi-v">{k.band.label}</div>
            <div className="kpi-l">상황 등급</div>
          </div>
        </div>
      </div>

      <span className="tb-spacer" />
      <div className="tb-phase">{phases.length ? <>활성 단계 <b>{phaseText}</b></> : '활성 단계 없음'}</div>
      <div className="tb-clock"><b>{clock.time}</b><span>{clock.off}</span></div>
      <button type="button" className="help-btn" title="이 화면 읽는 법" onClick={onHelp}>?</button>
      {compact && (
        <button
          ref={btnRef} type="button" className="tb-menu-btn"
          aria-expanded={menuOpen} aria-controls="tb-menu"
          aria-label="기타 컨트롤" title="기타 컨트롤"
          onClick={() => setMenuOpen((o) => !o)}
        >⋯</button>
      )}
      {compact && (
        <div
          id="tb-menu" className="tb-menu" ref={setMenuEl}
          data-open={menuOpen ? '1' : undefined}
          role="group" aria-label="기타 컨트롤"
        >
          {modeSeg}
        </div>
      )}
    </header>
  )
}
