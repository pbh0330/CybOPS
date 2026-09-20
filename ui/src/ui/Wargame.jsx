import { useEffect, useMemo, useState } from 'react'
import { config, probeLlm } from '../config.js'
import { assetName, techniqueLine } from '../labels.js'
import { startGame, defaultFoothold, legalFor, defend, pass, attackerTurn, staffTable, compromiseOf } from '../game.js'
import { staffFacts, narrateStaff } from '../staff-llm.mjs'
import { runChain } from '../engine.js'

// The wargame panel (ADR-0026). Every number on it comes from game.js; this
// file only draws and forwards clicks. The three boundaries of the old
// wargame.js still hold: the model never decides an outcome, both sides are
// scored on the mission number the rest of the screen shows, and nothing here
// leaves the browser except an optional chat call to a local model.

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

function StartCard({ graph, payload, idx, llmOk, llmNote, onStart }) {
  const steps = payload?.steps || []
  const foot = defaultFoothold(payload)
  const [stepIdx, setStepIdx] = useState(idx)
  const [footId, setFootId] = useState(foot?.id || (graph.assets?.[0]?.id ?? ''))
  const [level, setLevel] = useState(foot?.level >= 0.8 ? 0.8 : 0.5)
  const [mode, setMode] = useState('hold')
  const [turns, setTurns] = useState(8)
  const [strategy, setStrategy] = useState('greedy')
  const [seed, setSeed] = useState(20260906)
  const t = steps[stepIdx] ? Number(steps[stepIdx].t) : 0
  return (
    <div className="wg-start">
      <div className="wg-sub">교전 시작 - 조건을 고른다</div>
      <label className="wg-pick"><span>시점</span>
        <select value={stepIdx} onChange={(e) => setStepIdx(Number(e.target.value))}>
          {steps.map((s, i) => <option key={i} value={i}>{s.time_iso ? s.time_iso.slice(11, 16) : `+${s.t}분`} · {s.label || ''}</option>)}
        </select></label>
      <div className="wg-row2">
        <label className="wg-pick"><span>초기 거점</span>
          <select value={footId} onChange={(e) => setFootId(e.target.value)}>
            {(graph.assets || []).map((a) => <option key={a.id} value={a.id}>{assetName(graph, a.id).ko} ({a.id})</option>)}
          </select></label>
        <label className="wg-pick"><span>수준</span>
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            <option value={0.5}>0.5 거점</option><option value={0.8}>0.8 자격증명</option>
          </select></label>
      </div>
      <div className="wg-row2">
        <label className="wg-pick"><span>모드</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="wg-pick"><span>턴</span>
          <select value={turns} onChange={(e) => setTurns(Number(e.target.value))}>{[4, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      <div className="wg-row2">
        <label className="wg-pick"><span>공격자</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="greedy">greedy (대조군)</option>
            <option value="random">random (하한)</option>
            <option value="llm" disabled={!llmOk}>LLM{llmOk ? '' : ' - 사용 불가'}</option>
          </select></label>
        <label className="wg-pick"><span>시드</span>
          <input type="number" value={seed} step="1" onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
      </div>
      {!llmOk && llmNote && <div className="wg-llm-note">LLM 공격자 사용 불가<span>{llmNote}</span></div>}
      <p className="rail-caption">{mode === 'hold' ? `${turns}턴 동안 P1 임무 저하도를 50% 미만으로 지키면 승. 점수는 턴별 가중 저하도의 합(낮을수록 좋음).` : `${turns}턴 동안 crown jewel 이 장악되지 않으면 승. 점수 = 버틴 턴×100 − 격리 비용.`}</p>
      <button type="button" className="wg-go" onClick={() => onStart({ mode, turns, t, foothold: { id: footId, level }, seed, strategy, method: 'weighted' }, stepIdx)}>시작</button>
    </div>
  )
}

// Split on sentence ends, keep the [F#] chips, mark the uncited (ADR-0009).
function CitedText({ text, facts, onToast }) {
  const map = new Map(facts.map((f) => [f.id, f.text]))
  const sentences = String(text).split(/(?<=[.!?。])\s+|(?<=\])\s+/).filter((x) => x.trim())
  return sentences.map((raw, i) => {
    const cites = [...raw.matchAll(/\[(F\d+)\]/g)].map((m) => m[1])
    const body = raw.replace(/\[(F\d+)\]/g, '').replace(/\s+([.,])/g, '$1').trim()
    return (
      <p className="brief-s" key={i}>{body}{' '}
        {cites.map((c) => (
          <button key={c} type="button" className={`cite-chip${map.has(c) ? '' : ' is-bad'}`} title={map.get(c) || '근거 없음'} onClick={() => onToast(`${c} — ${map.get(c) || '근거 없음'}`)}>{c}</button>
        ))}
        {cites.length === 0 && <span className="unverified">미검증</span>}
      </p>
    )
  })
}

function StaffCard({ graph, game, rows, p1, llmOk, onIsolate, onToast }) {
  const [narr, setNarr] = useState(null)   // { text } | { error } | null
  const [busy, setBusy] = useState(false)
  const facts = useMemo(() => staffFacts(graph, game, rows, p1), [graph, game, rows, p1])
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
  return (
    <div className="wg-staff">
      <div className="wg-staff-head">참모 <em className="ref">{llmOk && narr && narr.text ? `규칙 기반 + ${modelShort}` : '규칙 기반'}</em>
        {llmOk && game.phase === 'defend' && <button type="button" className="wg-staff-ask" disabled={busy} onClick={ask}>{busy ? '문장 생성 중' : '모델에게 읽게 하기'}</button>}
      </div>
      {rows.slice(0, 3).map((r) => (
        <div className="wg-staff-row" key={r.id}>
          <span className="wg-staff-rank">{r.rank}</span>
          <span className="wg-staff-what">{assetName(graph, r.id).ko} 격리<em className="ref">{r.id}</em>
            <small>비용 {pp(r.cost)} · 막는 수 {r.blocks} · 최대 차단 {pct(r.gainBlocked)}</small></span>
          <button type="button" className="req-btn" disabled={game.phase !== 'defend'} onClick={() => onIsolate(r.id)}>이 행동 선택</button>
        </div>
      ))}
      {narr && narr.text && <div className="wg-staff-text"><CitedText text={narr.text} facts={facts} onToast={onToast} /><span className="brief-meta">{narr.ms} ms · 표를 읽은 것이지 표를 만든 것이 아니다</span></div>}
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
            <td>{h.defender ? `${assetName(graph, h.defender.id).ko} 격리 (${pp(h.defender.cost)})` : '생략'}</td>
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

export default function Wargame({ graph, payload, idx, game, onGame, onSeekIdx, onToast, onMode }) {
  const [probe, setProbe] = useState(null)
  const [busy, setBusy] = useState(false)
  const [iso, setIso] = useState('')
  useEffect(() => { let alive = true; probeLlm().then((p) => { if (alive) setProbe(p) }); return () => { alive = false } }, [])
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

  if (!graph || !payload) return null

  const start = (cfg, stepIdx) => { onSeekIdx(stepIdx); onGame(startGame(graph, cfg)) }
  const isolate = (id) => { if (!id) return; onGame(defend(graph, game, { type: 'isolate', id })); setIso('') }
  const skip = () => onGame(pass(game))
  const attack = async () => {
    if (!game || game.phase !== 'attack' || busy) return
    setBusy(true)
    try {
      let chooser
      if (game.cfg.strategy === 'llm') {
        const pick = await (await getLlmChooser(game.cfg.seed))(legal, { g: graph, state: game.attacker, t: game.cfg.t, turn: game.turn })
        chooser = () => pick
      }
      onGame(attackerTurn(graph, game, chooser))
    } catch (e) { onToast(`공격자 모델 호출 실패: ${String(e && e.message || e)}`) } finally { setBusy(false) }
  }

  if (!game) return <StartCard graph={graph} payload={payload} idx={idx} llmOk={llmOk} llmNote={llmNote} onStart={start} />
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
        <button type="button" className="wg-reset" onClick={() => onGame(null)}>그만두기</button>
      </div>

      {game.phase === 'defend' && <StaffCard graph={graph} game={game} rows={rows} p1={p1} llmOk={llmOk} onIsolate={isolate} onToast={onToast} />}

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
        <button type="button" className="wg-go" disabled={game.phase !== 'attack' || busy} onClick={attack}>
          {busy ? (game.cfg.strategy === 'llm' ? '모델 응답 대기' : '진행 중') : '공격 턴 진행'}
        </button>
      </div>

      {game.history.length > 0 && (
        <div className="wg-log">
          {[...game.history].reverse().slice(0, 12).map((h) => (
            <div key={h.turn}>
              {h.defender && <div className="wg-log-row is-def"><span className="wg-log-turn">T{h.turn + 1}</span><span className="wg-log-what">격리 {h.defender.id} ({pp(h.defender.cost)})</span><span className="wg-log-tag">방어</span></div>}
              <div className={`wg-log-row${h.attacker ? (h.attacker.success ? ' is-hit' : ' is-miss') : ''}`}>
                <span className="wg-log-turn">T{h.turn + 1}</span>
                <span className="wg-log-what">{h.attacker ? `${h.attacker.move.label} ${h.attacker.move.from && h.attacker.move.target && h.attacker.move.from !== h.attacker.move.target ? `${h.attacker.move.from} → ${h.attacker.move.target}` : (h.attacker.move.target || '')}` : (h.reason || '')}</span>
                <span className="wg-log-tag">{h.attacker ? (h.attacker.success ? '성공' : '실패') : '-'}</span>
              </div>
            </div>))}
        </div>
      )}
      <p className="rail-caption">격리는 모의 상태만 바꾼다. 실행 경로는 없다 (ADR-0004).</p>
    </div>
  )
}
