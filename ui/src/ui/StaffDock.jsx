// The staff officer, on screen and without a model (참모 S1, Task 3).
//
// Everything here is a renderer for what `staff.js` already decided. There is
// NO LLM in this file and none is needed: the buttons call `ask` directly, so
// the panel keeps its full function on a machine with no GPU at all. S2 adds
// sentences on top of these same answers; the citation chips it will draw are
// the fact rows below, which is why a fact with a `ref` is already a button.
//
// Three rules it inherits:
//   1. Read-only (ADR-0004). `Answer.actions` is [] in S1 and this component
//      has no code path that would press one if it were not.
//   2. The engine owns every number (ADR-0003). Nothing here computes a
//      degradation, a cost or a rank - `tieRuns` only READS the table it was
//      handed and says where equal values sit next to each other.
//   3. Achromatic (ADR-0024). Fact numbers separate themselves with the mono
//      face, never with a hue; red stays attack-only.
//
// ONE instance. App.jsx builds this node once and hands it to one of two
// parents - the rail's 참모 tab on a phone, a bottom drawer on a desktop.
// Rendering it in both branches would give the screen two query logs and two
// writers for the same localStorage key.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { catalog, ask } from '../staff.js'
import { assetName } from '../labels.js'

export const LOG_MAX = 10

// Per scenario, and deliberately NOT part of the engagement history: a
// question that was asked is not a state the board is in.
export const storeKey = (scenarioId) => `mccycop:staff:${scenarioId}`

export const K_CHOICES = [3, 5, 8, 12]

const RANK_COL = '순위'

// Where equal values sit next to each other in a ranked table.
//
// staff.js numbers its containment rows 1..n after sorting, which is the only
// honest thing a sort can do - but in observe mode most candidates cost
// exactly 0, so "1위" would read as "the best one" when it is one of six that
// tie. This marks the run so the table can say 동률 instead. It reads the
// table's own cells and never re-sorts: the ordering is game.staffTable's
// (ADR-0003).
//
// The ordering value is the LAST column in both shapes staff.js builds -
// 순이득 when a game is scoring, 임무 비용 when it is not.
export function tieRuns(table) {
  const rows = (table && table.rows) || []
  const cols = (table && table.cols) || []
  const out = rows.map(() => null)
  if (cols[0] !== RANK_COL || cols.length < 2) return out
  const key = cols.length - 1
  const at = (i) => String(rows[i].cells[key])
  let i = 0
  while (i < rows.length) {
    let j = i
    while (j + 1 < rows.length && at(j + 1) === at(i)) j += 1
    if (j > i) {
      let first = rows[i].cells[0]
      for (let k = i; k <= j; k += 1) {
        const r = Number(rows[k].cells[0])
        if (Number.isFinite(r) && r < Number(first)) first = rows[k].cells[0]
      }
      for (let k = i; k <= j; k += 1) out[k] = { first, size: j - i + 1 }
    }
    i = j + 1
  }
  return out
}

// What a fact's ref can actually select. Missions, tasks, services, assets and
// links are all nodes or edges on the graph canvas; a {kind:'turn'} ref from
// gameFacts is not, and neither is anything from a logged answer whose asset
// has since been deleted in the editor. Those rows stay plain text rather
// than becoming a button that clears the selection.
export function selectableIds(graph) {
  const out = new Set()
  for (const key of ['missions', 'tasks', 'services', 'assets', 'links']) {
    for (const x of (graph && graph[key]) || []) if (x && x.id) out.add(x.id)
  }
  return out
}

export function optionsOf(graph, kind) {
  if (kind === 'mission') {
    return ((graph && graph.missions) || []).map((m) => ({ id: m.id, label: `${m.name || m.id} · ${m.id}` }))
  }
  if (kind === 'asset') {
    return ((graph && graph.assets) || []).map((a) => ({ id: a.id, label: `${assetName(graph, a.id).ko} · ${a.id}` }))
  }
  return []
}

// The controls start on something valid so the first press answers instead of
// explaining. A wrong value is still REJECTED, never coerced (staff.js
// `validate`) - this only decides where the selects open.
export function initialArgs(graph) {
  const missions = ((graph && graph.missions) || []).map((m) => m.id)
  const assets = ((graph && graph.assets) || []).map((a) => a.id)
  return {
    missionId: missions[0] || '',
    assetId: assets[0] || '',
    aId: assets[0] || '',
    bId: assets[1] || assets[0] || '',
  }
}

export function pushLog(log, entry, max = LOG_MAX) {
  return [entry, ...(log || [])].slice(0, max)
}

// A logged answer is JSON that survived a reload; it may have been written by
// an older build. Anything that is not shaped like an Answer is dropped.
export function readLog(raw) {
  let parsed
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((a) => a && typeof a.query === 'string' && Array.isArray(a.facts))
    .slice(0, LOG_MAX)
}

function ArgControl({ spec, value, onChange, graph }) {
  if (spec.kind === 'int') {
    const opts = K_CHOICES.includes(spec.default) ? K_CHOICES : [spec.default, ...K_CHOICES]
    return (
      <label className="staff-arg">
        <span>{spec.name}</span>
        <select value={value === undefined || value === '' ? String(spec.default) : String(value)} onChange={(e) => onChange(Number(e.target.value))}>
          {opts.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
    )
  }
  const opts = optionsOf(graph, spec.kind)
  return (
    <label className="staff-arg">
      <span>{spec.name}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {!opts.length && <option value="">(없음)</option>}
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  )
}

function AnswerTable({ table }) {
  const ties = useMemo(() => tieRuns(table), [table])
  const tied = ties.filter(Boolean).length
  if (!table || !table.rows || !table.rows.length) return null
  return (
    <>
      {tied > 0 && (
        <p className="staff-tie">
          동률 {tied}행 - 값이 같은 후보가 있다. 번호는 정렬 순서일 뿐 우열이 아니다.
        </p>
      )}
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead>
            <tr>{table.cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((r, ri) => (
              <tr key={`${r.id}-${ri}`}>
                {r.cells.map((cell, ci) => {
                  const tie = ci === 0 ? ties[ri] : null
                  return (
                    <td key={ci} className={ci === 0 && tie ? 'is-tie' : undefined}>
                      {tie ? <>{tie.first}<em className="staff-tie-mark">동률 {tie.size}</em></> : String(cell === null || cell === undefined ? '' : cell)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Answer({ answer, graph, onSelect }) {
  const ids = useMemo(() => selectableIds(graph), [graph])
  const args = Object.entries(answer.args || {})
  return (
    <article className="staff-ans">
      <div className="staff-run">
        <span className="staff-badge">실행</span>
        <span className="staff-run-label">{answer.label}</span>
        <code className="staff-qid">{answer.query}</code>
        {args.map(([k, v]) => <code key={k} className="staff-argchip">{k}={String(v)}</code>)}
        {answer.when && <span className="staff-when">{answer.when}</span>}
      </div>

      <ol className="staff-facts">
        {answer.facts.map((fact) => {
          const ref = fact.ref && fact.ref.id ? fact.ref : null
          const can = !!(ref && ids.has(ref.id) && onSelect)
          return (
            <li key={fact.id}>
              <code className="staff-fn">{fact.id}</code>
              {can ? (
                <button
                  type="button" className="staff-fact is-ref"
                  title={`${ref.id} 선택`}
                  onClick={() => onSelect(ref.id)}
                >
                  {fact.text}
                </button>
              ) : (
                <span className="staff-fact">{fact.text}</span>
              )}
            </li>
          )
        })}
      </ol>

      <AnswerTable table={answer.table} />
      {/* answer.series is null in S1 (staff.js); a trend goes here when one exists */}
      {answer.note && <p className="staff-note">{answer.note}</p>}
    </article>
  )
}

export default function StaffDock({
  graph, step, game, sandbox, method, scenarioId, compact, onSelect,
}) {
  // `method` is passed through rather than defaulted here: it is 'weighted' in
  // both shipped scenarios, so a scenario with another one would diverge in
  // silence if this panel picked its own.
  const ctx = useMemo(
    () => ({ graph, step, game: game || null, sandbox: !!sandbox, method: method || 'weighted' }),
    [graph, step, game, sandbox, method],
  )
  const queries = useMemo(() => catalog(ctx), [ctx])

  const [open, setOpen] = useState(false)
  const [log, setLog] = useState([])
  const [err, setErr] = useState(null)
  const [args, setArgs] = useState(() => initialArgs(graph))

  useEffect(() => { setArgs(initialArgs(graph)) }, [graph])

  // The log belongs to the scenario, not to the session: switching boards
  // swaps it out rather than mixing two boards' answers in one list.
  useEffect(() => {
    if (!scenarioId) { setLog([]); return }
    let next = []
    try {
      const raw = localStorage.getItem(storeKey(scenarioId))
      if (raw) next = readLog(raw)
    } catch { /* private mode */ }
    setLog(next)
    setErr(null)
  }, [scenarioId])

  const write = useCallback((next) => {
    setLog(next)
    if (!scenarioId) return
    try { localStorage.setItem(storeKey(scenarioId), JSON.stringify(next)) } catch { /* quota */ }
  }, [scenarioId])

  const run = useCallback((q) => {
    const sent = {}
    for (const spec of q.args) {
      const v = args[spec.name]
      // An absent int takes staff.js's own default; an empty select is left
      // absent too, so `validate` gives the reason instead of this file
      // inventing one.
      if (v === undefined || v === '') continue
      sent[spec.name] = spec.kind === 'int' ? Number(v) : v
    }
    try {
      // `ask` validates and THROWS on a bad argument - the rejection is the
      // message, shown as written.
      const a = ask(ctx, q.id, sent)
      setErr(null)
      write(pushLog(log, {
        ...a,
        at: Date.now(),
        when: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
      }))
      setOpen(true)
    } catch (e) {
      setErr(e && e.message ? e.message : String(e))
    }
  }, [args, ctx, log, write])

  const body = (
    <div className="staff">
      <div className="staff-queries">
        <p className="staff-queries-head">질의 {queries.length}종 · 읽기 전용</p>
        {queries.map((q) => (
          <div className="staff-q" key={q.id}>
            <button type="button" className="staff-q-run" onClick={() => run(q)}>{q.label}</button>
            {q.args.length > 0 && (
              <div className="staff-args">
                {q.args.map((spec) => (
                  <ArgControl
                    key={spec.name} spec={spec} graph={graph}
                    value={args[spec.name]}
                    onChange={(v) => setArgs((prev) => ({ ...prev, [spec.name]: v }))}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {log.length > 0 && (
          <button type="button" className="staff-clear" onClick={() => { write([]); setErr(null) }}>
            기록 지우기 ({log.length})
          </button>
        )}
      </div>

      <div className="staff-answers">
        {err && <p className="staff-err" role="status">거부: {err}</p>}
        {!log.length && !err && (
          <p className="staff-empty">
            질의를 누르면 결정론적 엔진이 계산한 사실이 번호와 함께 나온다. 모델은 쓰지 않는다.
          </p>
        )}
        {log.map((a) => (
          <Answer key={a.at} answer={a} graph={graph} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )

  // On a phone this component IS the rail's 참모 tab - the sheet already owns
  // the bottom edge, so there is no drawer chrome and no `.staff-dock` node.
  if (compact) return body

  return (
    <section className={`staff-dock${open ? ' is-open' : ''}`} aria-label="참모">
      <button
        type="button" className="staff-toggle"
        aria-expanded={open} onClick={() => setOpen((v) => !v)}
      >
        <span className="staff-title">참모</span>
        <span className="staff-sub">질의 {queries.length}종</span>
        {log[0] && <span className="staff-last">최근: {log[0].label}</span>}
        <span className="staff-chev" aria-hidden="true">{open ? '▼' : '▲'}</span>
      </button>
      {open && body}
    </section>
  )
}
