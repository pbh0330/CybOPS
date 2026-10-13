import { useEffect, useMemo, useRef, useState } from 'react'
import { config, probeLlm } from '../config.js'
import { assetName, techniqueLine } from '../labels.js'
import { startGame, defaultFoothold, legalFor, defend, pass, attackerTurn, staffTable, compromiseOf } from '../game.js'
import { staffFacts, narrateStaff } from '../staff-llm.mjs'
import { runChain } from '../engine.js'
import { readiness } from '../sandbox.js'
import { PRESETS } from '../presets.js'
import { CitedText, factText } from './cite.jsx'

// The wargame panel (ADR-0026). Every number on it comes from game.js; this
// file only draws and forwards clicks. The three boundaries of the old
// wargame.js still hold: the model never decides an outcome, both sides are
// scored on the mission number the rest of the screen shows, and nothing here
// leaves the browser except an optional chat call to a local model.

// Where a wargame starts. A scenario can declare it - mission.json
// `wargame.foothold`, carried into the replay graph - and that declaration
// exists because the fallback is the replay's FIRST COMPROMISE STATE, which is
// a propagation input rather than a game seed. defnet-01's is WKS003 at 0.3,
// the deterministic layer's judgment at initial access, and it sits under
// attack.js's foothold threshold on purpose: a game seeded there would have no
// legal move at all. ui/tools/verify-scenarios.mjs plays the declared seed and
// fails the gate when it yields none, so this is checked rather than hoped for.
export function startFoothold(graph, payload) {
  const d = (graph && graph.wargame) ? graph.wargame.foothold : null
  if (d && d.id) return { id: d.id, level: Number(d.level) }
  return defaultFoothold(payload)
}

const pct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`
const pp = (v) => `${v >= 0 ? '+' : ''}${(Number(v || 0) * 100).toFixed(1)}%p`
const MODES = [['hold', '버티기'], ['jewel', '보석 방어']]

let llmChooser = null
let llmSeed = null
async function getLlmChooser(seed) {
  if (!llmChooser || llmSeed !== seed) {
    const c = config().llm || {}
    const mod = await import('../attack-llm.mjs')
    llmChooser = mod.createLLMChooser({ endpoint: c.endpoint, model: c.model, seed, verbose: false })
    llmSeed = seed
  }
  return llmChooser
}

// The LLM attacker (ADR-0019) is behind `llm.attacker_enabled`, default false
// (ADR-0028 §1). Nothing is deleted - attack-llm.mjs, the prompt and the
// chooser above are untouched and the strategy string still works - the start
// card just does not offer the option, and with the option gone the "사용 불가"
// note under it would be advertising something the reader cannot pick, so it
// goes too. Turning the experiment back on is the one flag.
const attackerEnabled = () => !!((config().llm || {}).attacker_enabled)

function StartCard({ graph, payload, idx, llmOk, llmNote, onStart, readyState }) {
  const steps = payload?.steps || []
  const attackerOn = attackerEnabled()
  const foot = startFoothold(graph, payload)
  // the select lists graph.assets; with an edited graph the scenario's
  // default foothold may not be in it, and a foothold outside the graph
  // would start a game the engine cannot play
  const inGraph = (id) => (graph.assets || []).some((a) => a.id === id)
  // no authored timeline (the sandbox): the first end terminal is the
  // natural seed - an attacker starts at a user, not at a relay
  const firstTerminal = () => ((graph.assets || []).find((a) => a.transit === false) || graph.assets?.[0])?.id ?? ''
  const [stepIdx, setStepIdx] = useState(idx)
  const [footId, setFootId] = useState(foot && inGraph(foot.id) ? foot.id : firstTerminal())
  const [level, setLevel] = useState(foot?.level >= 0.8 ? 0.8 : 0.5)
  // an attack preset: several seeds picked from the graph by presets.js.
  // Touching the foothold select clears it; the seeds are re-checked
  // against the graph on every render because the sandbox can lose an asset
  // while this card is up
  const [preset, setPreset] = useState(null)   // { id, label, seeds } | null
  const activePreset = preset && preset.seeds.every((f) => inGraph(f.id)) ? preset : null
  const footSel = inGraph(footId) ? footId : firstTerminal()
  const usePreset = (p, seeds) => { setPreset({ id: p.id, label: p.label, seeds }); setFootId(seeds[0].id); setLevel(seeds[0].level) }
  const [mode, setMode] = useState('hold')
  const [turns, setTurns] = useState(8)
  const [strategy, setStrategy] = useState('greedy')
  const [seed, setSeed] = useState(20260906)
  // readiness gate (sandbox, ADR-0027): a service without a provider reads
  // as degradation 0, so a half-built board would play as a healthy one.
  // Outside the sandbox readyState is always open.
  const ready = !!readyState.ready
  const jewels = readyState.jewels
  const shortS = (readyState.services && readyState.services.missing || []).length
  const shortT = (readyState.tasks && readyState.tasks.missing || []).length
  // structure complete but the engine's no-attack baseline says a performer
  // cannot reach its provider over the links: a different fix (links), so a
  // different caption
  const shortR = (readyState.unreachable || []).length
  const lockText = shortS === 0 && shortT === 0 && shortR > 0
    ? `준비도 미충족 - 작업 ${shortR} 이 서비스에 닿지 않는다 (링크 확인)`
    : `준비도 미충족 - 서비스 ${shortS}·작업 ${shortT} 이 비어 있다`
  // jewel mode needs a jewel; if the last one is un-marked while the card is
  // up, the mode falls back rather than starting a game with nothing to hold
  useEffect(() => { if (jewels === 0 && mode === 'jewel') setMode('hold') }, [jewels, mode])
  // no steps (the sandbox, ADR-0027): there is no time axis, the engine runs
  // static at t = -1 and the picker has one entry to say so
  const t = steps[stepIdx] ? Number(steps[stepIdx].t) : (steps.length ? 0 : -1)
  // Headroom check: at some times no legal move can raise mission degradation
  // at all - the operation has not started yet, or P1 is already fully
  // degraded. 버티기 then wins by arithmetic rather than by defending, so the
  // card says so instead of letting the player find out after eight turns.
  const seeds = activePreset ? activePreset.seeds : (footSel ? [{ id: footSel, level }] : [])
  // seedKey is the dependency only - the seeds themselves are never rebuilt
  // from it, so an asset id containing the separator cannot corrupt them
  const seedKey = seeds.map((f) => `${f.id}:${f.level}`).join('|')
  const flat = useMemo(() => {
    if (!seeds.length) return false
    const moves = legalFor(graph, startGame(graph, { t, foothold: null, footholds: seeds, method: 'weighted' }))
    return !moves.length || Number(moves[0].gain || 0) <= 0
  }, [graph, t, seedKey])   // seeds is covered by seedKey
  return (
    <div className="wg-start">
      <div className="wg-sub">교전 시작 - 조건을 고른다</div>
      <label className="wg-pick"><span>시점</span>
        <select value={stepIdx} onChange={(e) => setStepIdx(Number(e.target.value))}>
          {steps.length === 0 && <option value={0}>정적</option>}
          {steps.map((s, i) => <option key={i} value={i}>{s.time_iso ? s.time_iso.slice(11, 16) : `+${s.t}분`} · {s.label || ''}</option>)}
        </select></label>
      <div className="wg-presets">
        <span className="wg-presets-label">공격 프리셋</span>
        {PRESETS.map((p) => {
          const seeds = p.pick(graph)
          return <button type="button" key={p.id} className={`wg-preset${activePreset && activePreset.id === p.id ? ' is-on' : ''}`} disabled={!seeds}
            title={seeds ? `${p.desc} - ${seeds.map((f) => f.id).join(', ')}` : `${p.desc} - 해당하는 자산이 없다`}
            onClick={() => seeds && usePreset(p, seeds)}>{p.label}</button>
        })}
      </div>
      <div className="wg-row2">
        <label className="wg-pick"><span>초기 거점</span>
          <select value={footSel} onChange={(e) => { setPreset(null); setFootId(e.target.value) }}>
            {(graph.assets || []).map((a) => <option key={a.id} value={a.id}>{assetName(graph, a.id).ko} ({a.id})</option>)}
          </select></label>
        <label className="wg-pick"><span>수준</span>
          <select value={level} onChange={(e) => { setPreset(null); setLevel(Number(e.target.value)) }}>
            <option value={0.5}>0.5 거점</option><option value={0.8}>0.8 자격증명</option>
          </select></label>
      </div>
      {activePreset && <p className="rail-caption wg-preset-note">프리셋: {activePreset.label} ({activePreset.seeds.map((f) => f.id).join(', ')})</p>}
      <div className="wg-row2">
        <label className="wg-pick"><span>모드</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([k, l]) => <option key={k} value={k} disabled={k === 'jewel' && jewels === 0}>{l}{k === 'jewel' && jewels === 0 ? ' (보석 없음)' : ''}</option>)}</select></label>
        <label className="wg-pick"><span>턴</span>
          <select value={turns} onChange={(e) => setTurns(Number(e.target.value))}>{[4, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      <div className="wg-row2">
        <label className="wg-pick"><span>공격자</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="greedy">greedy (대조군)</option>
            <option value="random">random (하한)</option>
            {attackerOn && <option value="llm" disabled={!llmOk}>LLM{llmOk ? '' : ' - 사용 불가'}</option>}
          </select></label>
        <label className="wg-pick"><span>시드</span>
          <input type="number" value={seed} step="1" onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
      </div>
      {attackerOn && !llmOk && llmNote && <div className="wg-llm-note">LLM 공격자 사용 불가<span>{llmNote}</span></div>}
      <p className="rail-caption">{mode === 'hold' ? `${turns}턴 동안 P1 임무 저하도를 50% 미만으로 지키면 승. 점수는 턴별 가중 저하도의 합(낮을수록 좋음).` : `${turns}턴 동안 crown jewel 이 장악되지 않으면 승. 점수 = 버틴 턴×100 − 격리 비용.`}</p>
      <button type="button" className="wg-start-go" disabled={!ready} onClick={() => onStart({ mode, turns, t, foothold: { id: footSel, level }, ...(activePreset ? { footholds: activePreset.seeds } : {}), seed, strategy, method: 'weighted' }, stepIdx)}>시작</button>
      {/* one caption line: the readiness lock wins, since it is the one that
          disables the button. The headroom note is about 버티기 only - in
          jewel mode it would be advising the mode already chosen. */}
      {(!ready || (flat && mode === 'hold')) && <p className="wg-lock">{!ready ? lockText
        : '이 시점은 여유가 없다 - 어떤 수도 임무 저하도를 올리지 못해 버티기는 무의미하다. 더 이른 시점이나 보석 방어를 고른다.'}</p>}
    </div>
  )
}

// 문장 분해·칩·미검증 배지는 cite.jsx 한 벌이다 (ADR-0009). 여기 있던 지역
// 구현은 레일의 것과 이미 규칙이 조금씩 달랐다 - 그래서 셋을 하나로 모았다.
const CitedNarration = ({ text, facts, onToast }) => (
  <CitedText
    text={text} facts={facts}
    onCite={(c, hit) => onToast(`${c} — ${factText(hit) || '근거 없음'}`)}
  />
)

// How many ranked rows the card shows. The number is shared with the decision
// record: `basis` is the fact ids that were ON SCREEN when the operator
// committed, so it is this cut that decides which ones those were, not the
// five staffFacts happens to build.
export const STAFF_ROWS = 3

// The fact numbers visible on the staff card right now. F1 is the turn line and
// each shown row adds one (staff-llm.mjs `staffFacts` numbers rows F2, F3, ...
// in table order), so the visible set is the head of the list - never a claim
// about a row the reader could not see.
export function visibleBasis(facts, rows) {
  if (!facts || !facts.length) return []
  const shown = Math.min(STAFF_ROWS, (rows || []).length)
  return facts.slice(0, 1 + shown).map((x) => x.id)
}

function StaffCard({ graph, game, rows, facts, llmOk, onIsolate, onToast }) {
  const [narr, setNarr] = useState(null)   // { text } | { error } | null
  const [busy, setBusy] = useState(false)
  useEffect(() => { setNarr(null) }, [game.turn, game.isolated.length])
  const ask = async () => {
    setBusy(true)
    try {
      const c = config().llm || {}
      const r = await narrateStaff({ endpoint: c.endpoint, model: c.model, seed: game.cfg.seed + game.turn }, facts)
      setNarr({ text: r.text, ms: r.ms })
    } catch (e) { setNarr({ error: String(e && e.message || e) }) } finally { setBusy(false) }
  }
  const modelShort = String((config().llm || {}).model || 'llm').split(':')[0]
  // staffTable has no "do nothing" row: when the best isolation does not
  // pay for itself the recommendation is to pass, and the rows stay as
  // information only
  const none = !rows.length || rows[0].net <= 0
  return (
    <div className="wg-staff">
      <div className="wg-staff-head">참모 <em className="ref">{llmOk && narr && narr.text ? `규칙 기반 + ${modelShort}` : '규칙 기반'}</em>
        {llmOk && game.phase === 'defend' && <button type="button" className="wg-staff-ask" disabled={busy} onClick={ask}>{busy ? '문장 생성 중' : '모델에게 읽게 하기'}</button>}
      </div>
      {none && <div className="wg-staff-none">생략 권고 - 지금 막을 수 있는 수가 없거나 격리 비용이 차단 이득보다 크다</div>}
      {rows.slice(0, STAFF_ROWS).map((r) => (
        <div className="wg-staff-row" key={r.id}>
          <span className="wg-staff-rank">{r.rank}</span>
          <span className="wg-staff-what">{assetName(graph, r.id).ko} 격리<em className="ref">{r.id}</em>
            <small>비용 {pp(r.cost)} · 막는 수 {r.blocks} · 최대 차단 {pct(r.gainBlocked)}</small></span>
          <button type="button" className="req-btn" disabled={none || game.phase !== 'defend'} onClick={() => onIsolate(r.id)}>{none ? '참고 (순이득 ≤ 0)' : '이 행동 선택'}</button>
        </div>
      ))}
      {narr && narr.text && <div className="wg-staff-text"><CitedNarration text={narr.text} facts={facts} onToast={onToast} /><span className="brief-meta">{narr.ms} ms · 표를 읽은 것이지 표를 만든 것이 아니다</span></div>}
      {narr && narr.error && <div className="wg-result is-bad">참모 모델 호출 실패: {narr.error}</div>}
    </div>
  )
}

function Aar({ graph, game, onAgain, onNewSeed, onObserve }) {
  const r = game.result
  return (
    <div className="wg-aar">
      <div className={`wg-aar-verdict${r.win ? ' is-win' : ' is-loss'}`}>{r.win ? '방어 성공' : '방어 실패'}<span>{r.reason} · {r.at}턴</span></div>
      <div className="wg-aar-score">점수 <b>{game.cfg.mode === 'hold' ? game.score.total.toFixed(3) : game.score.total}</b><small>{game.cfg.mode === 'hold' ? '가중 저하도 합 · 낮을수록 좋음' : `버틴 턴×100 − 격리 비용 ${pp(game.score.isolationCost)}`}</small></div>
      <table className="wg-aar-table"><thead><tr><th>턴</th><th>방어</th><th>공격</th><th>판정</th><th>P1</th></tr></thead><tbody>
        {game.history.map((h) => (
          <tr key={h.turn}>
            <td>{h.turn + 1}</td>
            {/* the decision as it was recorded: what, what it cost, where the
                staff had it, and the operator's own line if they typed one */}
            <td>{h.defender ? (
              <>
                {`${assetName(graph, h.defender.id).ko} 격리 (${pp(h.defender.cost)})`}
                <small className="wg-aar-why">{h.defender.rank ? `참모 ${h.defender.rank}위` : '순위 기록 없음'}{h.defender.actor === 'human' ? ' · 사람' : ''}{h.defender.rationale ? ` · "${h.defender.rationale}"` : ''}</small>
              </>
            ) : '생략'}</td>
            <td>{h.attacker ? `${h.attacker.move.label} ${h.attacker.move.target || ''}` : (h.reason || '-')}</td>
            <td className={h.attacker ? (h.attacker.success ? 'is-hit' : 'is-miss') : ''}>{h.attacker ? (h.attacker.success ? '성공' : '실패') : '-'}</td>
            <td>{pct(h.p1)}</td>
          </tr>))}
      </tbody></table>
      <div className="wg-aar-btns">
        <button type="button" onClick={onAgain}>같은 시드로 다시</button>
        <button type="button" onClick={onNewSeed}>새 시드</button>
        <button type="button" onClick={onObserve}>관측으로</button>
      </div>
    </div>
  )
}

export default function Wargame({ graph, payload, idx, game, onGame, onSeekIdx, onToast, onMode, sandbox }) {
  const [probe, setProbe] = useState(null)
  const [busy, setBusy] = useState(false)
  const [iso, setIso] = useState('')
  // The optional one line that goes into the decision record. Optional means
  // optional: an empty box still records the decision (game.js stores null).
  const [why, setWhy] = useState('')
  // Generation guard for the one await in here (the LLM attacker). A game
  // that was quit, restarted or left (mode switch) while the model was
  // thinking must not be written back over whatever replaced it.
  const gen = useRef(0)
  useEffect(() => { let alive = true; probeLlm().then((p) => { if (alive) setProbe(p) }); return () => { alive = false } }, [])
  useEffect(() => () => { gen.current++ }, [])
  const llmOk = !!(probe && probe.ok)
  const llmNote = probe && !probe.ok ? `${(config().llm || {}).unavailable_note || ''} ${probe.why && probe.why !== 'disabled' ? `(${probe.why})` : ''}` : ''

  const legal = useMemo(() => (game && graph ? legalFor(graph, game) : []), [game, graph])
  const rows = useMemo(() => (game && graph && game.phase !== 'over' ? staffTable(graph, game) : []), [game, graph])
  const p1 = useMemo(() => {
    if (!game || !graph) return 0
    const m = runChain(graph, compromiseOf(game), { t: game.cfg.t, method: game.cfg.method, causes: 'all' }).mission
    const first = [...(graph.missions || [])].sort((a, b) => (a.priority || 9) - (b.priority || 9))[0]
    return first ? Number(m[first.id] || 0) : 0
  }, [game, graph])

  // Lifted out of StaffCard so the isolate handler and the card read ONE list:
  // `basis` has to be the numbers the operator was actually looking at, and two
  // calls to staffFacts would be two lists that could drift.
  const staffCardFacts = useMemo(
    () => (game && graph && game.phase === 'defend' ? staffFacts(graph, game, rows, p1) : []),
    [graph, game, rows, p1],
  )

  // the gate only binds in the sandbox: authored scenarios are complete by
  // construction, and their jewel count is whatever the file says
  const readyState = useMemo(() => (sandbox && graph
    ? readiness(graph)
    : { ready: true, jewels: ((graph && graph.crown_jewels) || []).length, services: { missing: [] }, tasks: { missing: [] }, unreachable: [] }), [sandbox, graph])

  if (!graph || !payload) return null

  const start = (cfg, stepIdx) => { gen.current++; onSeekIdx(stepIdx); onGame(startGame(graph, cfg)) }
  const quit = () => { gen.current++; onGame(null) }
  // A person pressed a button, so the record says so (ADR-0004: there is no
  // other way in). `basis` is what was on the staff card at that moment and
  // `rank` is read off the table inside game.js - not passed from here, where
  // it would be a number nothing could check.
  const isolate = (id) => {
    if (!id) return
    onGame(defend(graph, game, {
      type: 'isolate',
      id,
      actor: 'human',
      basis: visibleBasis(staffCardFacts, rows),
      rationale: why,
    }))
    setIso('')
    setWhy('')
  }
  const skip = () => onGame(pass(game))
  const attack = async () => {
    if (!game || game.phase !== 'attack' || busy) return
    setBusy(true)
    const my = gen.current
    try {
      let chooser
      // With no legal move there is nothing to ask the model; the engine
      // records "no legal move" itself and the turn still passes.
      if (game.cfg.strategy === 'llm' && legal.length > 0) {
        const pick = await (await getLlmChooser(game.cfg.seed))(legal, { g: graph, state: game.attacker, t: game.cfg.t, turn: game.turn })
        if (my !== gen.current) return
        chooser = () => pick
      }
      onGame(attackerTurn(graph, game, chooser))
    } catch (e) { onToast(`공격자 모델 호출 실패: ${String(e && e.message || e)}`) } finally { setBusy(false) }
  }

  // keyed on the scenario: the card's defaults are initial state, and a
  // scenario switch while the card is up must not keep the old ones
  if (!game) return <StartCard key={payload.scenario_id || ''} graph={graph} payload={payload} idx={idx} llmOk={llmOk} llmNote={llmNote} onStart={start} readyState={readyState} />
  if (game.phase === 'over') {
    return <Aar graph={graph} game={game} onAgain={() => onGame(startGame(graph, game.cfg))} onNewSeed={() => onGame(startGame(graph, { ...game.cfg, seed: game.cfg.seed + 1 }))} onObserve={() => onMode('observe')} />
  }

  const last = game.history[game.history.length - 1]
  const top = legal.slice(0, 6)
  const maxGain = Math.max(1e-9, ...top.map((m) => m.gain))
  const isolatable = (graph.assets || []).map((a) => a.id).filter((id) => !game.isolated.includes(id))
  return (
    <div className="wg">
      <div className="wg-head">
        <span className="wg-turn">턴 {game.turn + 1}/{game.cfg.turns}</span>
        <span className={`wg-phase is-${game.phase}`}>{game.phase === 'defend' ? '방어 페이즈' : '공격 페이즈'}</span>
        <span className="wg-foot-count">점수 {game.cfg.mode === 'hold' ? game.score.total.toFixed(2) : game.score.total} · P1 {pct(p1)}</span>
        <button type="button" className="wg-reset" disabled={busy} onClick={quit}>그만두기</button>
      </div>

      {game.phase === 'defend' && <StaffCard graph={graph} game={game} rows={rows} facts={staffCardFacts} llmOk={llmOk} onIsolate={isolate} onToast={onToast} />}

      {last && last.attacker && (
        <div className={`wg-result ${last.attacker.success ? 'is-hit' : 'is-miss'}`}>
          <div className="wg-result-top"><b>{last.attacker.move.label}</b>
            <span className="wg-target">{last.attacker.move.from && last.attacker.move.target && last.attacker.move.from !== last.attacker.move.target ? `${last.attacker.move.from} -> ${last.attacker.move.target}` : (last.attacker.move.target || '')}</span>
            <span className="wg-verdict">{last.attacker.success ? '성공' : '실패'}</span></div>
          <div className="wg-roll">판정 {last.attacker.roll} {last.attacker.success ? '<' : '≥'} {last.attacker.move.p} · 예상 이득 {pct(last.attacker.move.gain)} · {techniqueLine(last.attacker.move.technique)}</div>
          {last.attacker.rationale && <div className="wg-why">{last.attacker.rationale}</div>}
        </div>
      )}
      {last && !last.attacker && <div className="wg-result">{last.reason}</div>}

      <div className="wg-moves">
        <div className="wg-sub">공격자가 지금 둘 수 있는 수 {legal.length}개 중 상위 {top.length}</div>
        {top.map((m) => (
          <div className="wg-move" key={m.id}>
            <div className="wg-move-bar" style={{ width: `${Math.round((m.gain / maxGain) * 100)}%` }} />
            <span className="wg-move-label">{m.label} {m.from && m.target && m.from !== m.target ? <><b>{m.from}</b> → <b>{m.target}</b></> : <b>{m.target || ''}</b>}</span>
            <span className="wg-move-gain">{pct(m.gain)}</span>
          </div>))}
      </div>

      <div className="wg-defence">
        <div className="wg-sub">방어측 - 격리 (모의, 턴당 1회, 영구)</div>
        <div className="wg-def-row">
          <select value={iso} onChange={(e) => setIso(e.target.value)} disabled={game.phase !== 'defend'}>
            <option value="">자산 선택</option>
            {isolatable.map((id) => <option key={id} value={id}>{assetName(graph, id).ko} ({id})</option>)}
          </select>
          <button type="button" disabled={game.phase !== 'defend' || !iso} onClick={() => isolate(iso)}>격리</button>
          <button type="button" disabled={game.phase !== 'defend'} onClick={skip}>생략</button>
        </div>
        {/* The optional line of the decision record (ADR-0004). It is written
            next to the decision, not instead of it: leaving it empty records
            the isolation anyway, with rationale null. */}
        <input
          type="text" className="wg-why-input" value={why}
          disabled={game.phase !== 'defend'}
          maxLength={140}
          placeholder="왜 이걸 고르는지 한 줄 (선택)"
          aria-label="결심 근거 한 줄 (선택 입력)"
          onChange={(e) => setWhy(e.target.value)}
        />
        <button type="button" className="wg-go" disabled={game.phase !== 'attack' || busy} onClick={attack}>
          {busy ? (game.cfg.strategy === 'llm' ? '모델 응답 대기' : '진행 중') : '공격 턴 진행'}
        </button>
      </div>

      {game.history.length > 0 && (
        <div className="wg-log">
          {[...game.history].reverse().slice(0, 12).map((h) => (
            <div key={h.turn}>
              {h.defender && <div className="wg-log-row is-def"><span className="wg-log-turn">T{h.turn + 1}</span><span className="wg-log-what">격리 {h.defender.id} ({pp(h.defender.cost)}{h.defender.rank ? ` · 참모 ${h.defender.rank}위` : ''})</span><span className="wg-log-tag">{h.defender.actor === 'human' ? '사람' : h.defender.actor || '방어'}</span></div>}
              <div className={`wg-log-row${h.attacker ? (h.attacker.success ? ' is-hit' : ' is-miss') : ''}`}>
                <span className="wg-log-turn">T{h.turn + 1}</span>
                <span className="wg-log-what">{h.attacker ? `${h.attacker.move.label} ${h.attacker.move.from && h.attacker.move.target && h.attacker.move.from !== h.attacker.move.target ? `${h.attacker.move.from} → ${h.attacker.move.target}` : (h.attacker.move.target || '')}` : (h.reason || '')}</span>
                <span className="wg-log-tag">{h.attacker ? (h.attacker.success ? '성공' : '실패') : '-'}</span>
              </div>
            </div>))}
        </div>
      )}
      <p className="rail-caption">격리는 모의 상태만 바꾼다. 실행 경로는 없다 (ADR-0004). 누른 사람·참모 순위·화면에 있던 근거 번호는 기록으로 남고, 참모 질의 <code>decision_why</code> 로 다시 읽을 수 있다.</p>
    </div>
  )
}
