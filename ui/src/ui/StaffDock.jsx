// The staff officer on screen (참모 S1 Task 3, + S2 Task 2's question box).
//
// The buttons below still call `ask` directly and no model is involved in
// them: on a machine with no GPU the panel keeps its FULL function, which is
// the property the GPU-less demo stands on. S2 adds one line above them - a
// question in Korean - and that line is the only part that needs a model. It
// disables itself with a reason when there is none.
//
// What the question box does NOT do is decide anything (ADR-0003). The model
// picks a query id out of the catalogue and phrases the answer; between those
// two the deterministic engine runs, and the numbers on screen are its. The
// pipeline, in order:
//
//   질문 -> routeQuestion -> staff.validate -> staff.ask -> narrate
//
// `staff.validate` is in that list on purpose. routeQuestion only guarantees
// the id came from the catalogue it was handed; it never looked at whether
// `assetId` names an asset that exists. Nothing the model produced reaches the
// engine without passing the same gate a button press passes.
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { catalog, ask, validate, ctxT, graphFingerprint } from '../staff.js'
import { routeQuestion, narrate } from '../staff-llm.mjs'
import { config, probeLlm } from '../config.js'
import { timeLabel } from '../derive.js'
import { assetName } from '../labels.js'
import { CitedText, citeStats } from './cite.jsx'

// A raw argument name is what `staff.js` rejects by (the message says
// `assetId`, `aId`, ...), so the control keeps that name in its `title` even
// once the visible label is Korean. Unlisted names fall back to themselves -
// the catalogue is closed (staff.js QUERIES), so this only needs to cover
// what is there today.
const ARG_KO = {
  missionId: '임무',
  assetId: '자산',
  aId: '비교할 자산 A',
  bId: '비교할 자산 B',
  k: '표시 개수',
}
const argLabel = (name) => ARG_KO[name] || name

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
    // `at` is the React key for the card AND the only thing that orders the
    // list, so an entry without a numeric one is not an Answer this component
    // can render - it would give every such card key={undefined}.
    .filter((a) => a && typeof a.query === 'string' && Array.isArray(a.facts) && typeof a.at === 'number')
    .slice(0, LOG_MAX)
}

// --- is this card still current? -----------------------------------------
//
// An answer carries the basis its numbers were computed on: `t` (staff.js
// `ctxT`) and `gfp` (staff.js `graphFingerprint`). `curT`/`curFp` are those
// same two readings taken live, right now, off the ctx the dock is rendering
// with - one definition each, so the two readings cannot drift apart.
//
// BOTH have to match. The clock alone was the old check and it missed the case
// the sandbox makes routine: edit the graph without touching the timeline and
// every number moves while `t` sits still (ADR-0027, ADR-0009).
//
// A card missing either stamp (written by an older build) has no checkable
// basis, so it reads as stale rather than being quietly trusted - and says
// that is why, instead of claiming a change it cannot actually see.
export function staleOf(answer, curT, curFp) {
  const a = answer || {}
  const hasT = a.t !== undefined && a.t !== null
  const hasFp = typeof a.gfp === 'string' && a.gfp !== ''
  return {
    time: !hasT || Number(a.t) !== curT,
    graph: !hasFp || a.gfp !== curFp,
    unknown: !hasT || !hasFp,
    stale: !hasT || !hasFp || Number(a.t) !== curT || a.gfp !== curFp,
  }
}

// "이 답은 낡았다" without a reason is barely better than nothing: the reader
// cannot tell whether to seek the timeline back or to re-run the query.
export function staleWhy(st) {
  if (st.unknown) return '기준을 확인할 수 없음'
  if (st.time && st.graph) return '기준 시각과 그래프가 모두 다름'
  return st.time ? '기준 시각이 다름' : '기준 그래프가 다름'
}

export function staleText(st, ansLabel, curLabel) {
  if (st.unknown) {
    return `이 카드는 기준 시각·그래프를 남기지 않은 예전 기록이라, 지금 화면(${curLabel})과 같은 기준으로 계산됐는지 확인할 수 없다.`
  }
  const out = []
  if (st.time) out.push(`이 답은 ${ansLabel} 기준이고, 화면은 지금 ${curLabel} 이다.`)
  if (st.graph) out.push('이 답이 나온 뒤 그래프가 편집됐다. 같은 시각이라도 지금 다시 물으면 다른 숫자가 나온다.')
  return out.join(' ')
}

// --- the question box's controller ---------------------------------------
//
// Everything below is pure except the two injected calls, which is why it can
// be tested on this machine: there is no Ollama here and there will not be
// one on the demo laptop's worst day either.

// Where a routing failure lands. Not a random choice: state_summary takes no
// arguments and needs nothing but a graph, so it is the one query that cannot
// itself fail for the same reason the routing just did.
export const FALLBACK_QUERY = 'state_summary'

// routeQuestion's error codes, read out loud. The code stays visible next to
// them - it is what a bug report needs.
export const ROUTE_ERR_KO = {
  unparsable: '응답을 JSON 으로 읽지 못함',
  bad_shape: '응답 형식이 틀림',
  bad_args: '인자 형식이 틀림',
  unknown_query: '없는 질의를 고름',
  timeout: '제한 시간 초과',
  transport: '모델 호출 실패',
  empty: '빈 응답',
  validate: '인자 검증 거부',
  engine: '엔진이 질의를 거부함',
}

export const errKo = (code) => ROUTE_ERR_KO[code] || code || '알 수 없는 오류'

// Is the question box usable, and if not, why in a sentence the reader can
// act on. `unavailable_note` is the deployment's own words (config.json), so
// a build that ships deliberately without a model says so rather than looking
// broken. The probe's own reason follows in parentheses - except 'disabled',
// which the note already explains.
export function llmNoteOf(probe, cfg) {
  if (!probe || probe.ok) return ''
  const note = ((cfg || {}).llm || {}).unavailable_note || ''
  const why = probe.why && probe.why !== 'disabled' ? `(${probe.why})` : ''
  return [note, why].filter(Boolean).join(' ')
}

// A model that cannot pick has an answer anyway - the summary - and the card
// has to say that is what happened. Silence here is the failure mode this
// sentence exists to prevent: a summary shown for a question about one asset
// reads as an answer to that question.
export function fallbackNote(fb) {
  if (!fb) return null
  const head = '질의를 고르지 못해 요약으로 답했다'
  const why = fb.why ? ` - ${fb.why}` : ''
  if (fb.from) return `${head} (${errKo(fb.error)}: 모델이 고른 ${fb.from} 의 인자가 검증을 통과하지 못했다)${why}`
  return `${head} (${errKo(fb.error)})${why}`
}

// The fallback sentence leads; the engine's own note keeps its text after it.
export function noteWith(fb, engineNote) {
  return [fallbackNote(fb), engineNote || null].filter(Boolean).join(' · ') || null
}

// 질문 -> routeQuestion -> validate -> ask -> narrate.
//
// Returns exactly one of three kinds:
//
//   { kind:'abstain', why, ms, attempts }   the model declined. Correct
//                                           behaviour, not an error, and the
//                                           engine is NOT run.
//   { kind:'error', error, why, ... }       transport, timeout, or an engine
//                                           refusal. Nothing to show but the
//                                           reason and the buttons.
//   { kind:'answer', answer, fallback, text, narrateErr, ... }
//                                           an Answer from staff.ask, with a
//                                           narration when one came back.
//
// The retry is NOT here. routeQuestion already retries a malformed answer
// once (its own `retries`), and deliberately does not retry a timeout or a
// dead endpoint - a second call to a closed port is a second wait for the same
// answer. What this layer owes instead is the fallback, and saying so.
export async function runQuestion(ctx, question, opts = {}) {
  const spec = opts.spec || catalog(ctx)
  const cfg = opts.cfg || {}
  const route = opts.route || routeQuestion
  const tell = opts.narrate || narrate
  const askFn = opts.ask || ask
  const validateFn = opts.validate || validate

  const r = await route(cfg, question, spec, opts.routeOpts || {})
  const attempts = r.attempts || 0

  if (r.abstain) return { kind: 'abstain', why: r.why, ms: r.ms || 0, attempts }
  // A dead endpoint and a timeout end here: there is no answer to narrate and
  // running the engine anyway would put a summary on screen that the person
  // did not ask for.
  if (r.error && (r.error === 'transport' || r.error === 'timeout')) {
    return { kind: 'error', error: r.error, why: r.why, ms: r.ms || 0, attempts }
  }

  let query = r.query
  let args = r.args || {}
  let fallback = null
  if (r.error) {
    fallback = { from: null, error: r.error, why: r.why }
    query = FALLBACK_QUERY
    args = {}
  } else {
    // THE GATE. routeQuestion checked the id against the catalogue; it never
    // checked that "BN-SRV-2" is an asset in THIS graph (ADR-0003).
    const v = validateFn(ctx, query, args)
    if (!v.ok) {
      fallback = { from: query, error: 'validate', why: v.reason }
      query = FALLBACK_QUERY
      args = {}
    }
  }

  let answer
  try {
    answer = askFn(ctx, query, args)
  } catch (e) {
    // The fallback itself was refused - no graph, or a catalogue without
    // state_summary. Nothing left to show but why.
    return { kind: 'error', error: 'engine', why: (e && e.message) || String(e), ms: r.ms || 0, attempts }
  }

  const n = await tell(cfg, answer.facts, question, opts.narrateOpts || {})
  return {
    kind: 'answer',
    answer,
    fallback,
    // A narration that failed costs the sentences and nothing else: the
    // facts, the table and the citations are the engine's and are already in
    // hand. The card says the sentences are missing rather than hiding it.
    text: n && n.text ? n.text : null,
    narrateErr: n && n.error ? { error: n.error, why: n.why } : null,
    routeMs: r.ms || 0,
    narrateMs: (n && n.ms) || 0,
    ms: (r.ms || 0) + ((n && n.ms) || 0),
    attempts,
  }
}

// An answered question becomes a log card like any other, plus what the model
// contributed. The extra keys are additive on purpose: `readLog` accepts the
// same shape it always did, so a card written by S1 and a card written here
// render through one component.
export function entryOf(res, question, at) {
  const a = res.answer
  return {
    ...a,
    note: noteWith(res.fallback, a.note),
    at,
    when: new Date(at).toLocaleTimeString('ko-KR', { hour12: false }),
    asked: question,
    text: res.text || null,
    narrateErr: res.narrateErr || null,
    fallback: res.fallback || null,
    ms: res.ms || 0,
    attempts: res.attempts || 0,
  }
}

function ArgControl({ spec, value, onChange, graph }) {
  if (spec.kind === 'int') {
    const opts = K_CHOICES.includes(spec.default) ? K_CHOICES : [spec.default, ...K_CHOICES]
    return (
      <label className="staff-arg">
        <span>{argLabel(spec.name)}</span>
        <select
          title={spec.name}
          value={value === undefined || value === '' ? String(spec.default) : String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {opts.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
    )
  }
  const opts = optionsOf(graph, spec.kind)
  return (
    <label className="staff-arg">
      <span>{argLabel(spec.name)}</span>
      <select title={spec.name} value={value || ''} onChange={(e) => onChange(e.target.value)}>
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

// A card is drawn with `staleOf` above: its stamped basis against the live
// one. When they differ the card is showing a figure the engine would no
// longer produce, and ADR-0009 says that has to be visible - and, since there
// are two ways to fall out of date, visible with its reason.
function Answer({ answer, graph, curT, curFp, onSelect }) {
  const ids = useMemo(() => selectableIds(graph), [graph])
  const args = Object.entries(answer.args || {})
  const hasT = answer.t !== undefined && answer.t !== null
  const ansLabel = hasT ? timeLabel(graph, answer.t) : null
  const st = staleOf(answer, curT, curFp)
  const stats = answer.text ? citeStats(answer.text) : null
  const [hl, setHl] = useState(null)

  // A citation chip goes to the fact it cites, and from there to the node -
  // the same selection path a fact row has had since S1, not a second one.
  const factDomId = (fid) => `staff-f-${answer.at}-${fid}`
  const onCite = useCallback((cid) => {
    setHl(cid)
    try {
      const el = typeof document === 'undefined' ? null : document.getElementById(factDomId(cid))
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
    } catch { /* no layout in a test renderer */ }
    const f = (answer.facts || []).find((x) => x.id === cid)
    const ref = f && f.ref && f.ref.id ? f.ref : null
    if (ref && ids.has(ref.id) && onSelect) onSelect(ref.id)
  }, [answer, ids, onSelect])

  return (
    <article className={`staff-ans${st.stale ? ' is-stale' : ''}`}>
      <div className="staff-run">
        <span className="staff-badge">실행{ansLabel ? ` · ${ansLabel}` : ''}</span>
        <span className="staff-run-label">{answer.label}</span>
        <code className="staff-qid">{answer.query}</code>
        {args.map(([k, v]) => <code key={k} className="staff-argchip">{k}={String(v)}</code>)}
        {answer.when && <span className="staff-when">{answer.when}</span>}
      </div>
      {st.stale && (
        <p className="staff-stale">
          <b className="staff-stale-why">{staleWhy(st)}</b>
          {' - '}
          {staleText(st, ansLabel || '알 수 없는 시각', timeLabel(graph, curT))}
        </p>
      )}

      {answer.asked && <p className="staff-asked"><b>질문</b> {answer.asked}</p>}

      {/* The one paragraph on this card a model wrote. Everything under it -
          every number, every ranking - is the engine's (ADR-0003), and every
          sentence has to point at the fact it came from (ADR-0009). */}
      {answer.text && (
        <div className="staff-say">
          <p className="staff-caption">이 문단만 모델이 썼다. 숫자는 결정론 엔진이 계산한 것이다 (ADR-0003)</p>
          <CitedText text={answer.text} facts={answer.facts} onCite={onCite} />
          <div className="staff-cite-meta">
            <span>{stats.sentences}문장 · 인용 {stats.cited}건</span>
            {stats.unverified > 0 && <span className="unverified">미검증 {stats.unverified}</span>}
            {answer.ms ? <span>{answer.ms} ms</span> : null}
          </div>
        </div>
      )}
      {answer.narrateErr && (
        <p className="staff-note">
          서술 실패({errKo(answer.narrateErr.error)}): {answer.narrateErr.why} - 아래 사실과 표는 엔진이 계산한 그대로다.
        </p>
      )}

      <ol className="staff-facts">
        {answer.facts.map((fact) => {
          const ref = fact.ref && fact.ref.id ? fact.ref : null
          const can = !!(ref && ids.has(ref.id) && onSelect)
          return (
            <li key={fact.id} id={factDomId(fact.id)} className={hl === fact.id ? 'is-hl' : undefined}>
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
  // What "now" reads as for a logged card's staleness check - the identical
  // two definitions `ask` stamps every new answer with (staff.js `ctxT` and
  // `graphFingerprint`). The fingerprint is keyed on `graph`, so an edit in
  // the sandbox recomputes it on the same render that redraws the board.
  const curT = useMemo(() => ctxT(ctx), [ctx])
  const curFp = useMemo(() => graphFingerprint(graph), [graph])

  const [open, setOpen] = useState(false)
  const [log, setLog] = useState([])
  const [err, setErr] = useState(null)
  const [args, setArgs] = useState(() => initialArgs(graph))
  // The question box. `probe` is null until the probe answers - the box stays
  // disabled meanwhile, because "unknown" is not "reachable".
  const [probe, setProbe] = useState(null)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  // Abstention and failure are NOT log entries: nothing was computed, so
  // there is no answer to keep. They sit above the log until the next ask.
  const [outcome, setOutcome] = useState(null)

  // One probe per mount, same call the wargame's LLM attacker uses. Its
  // result only ever disables one input; the buttons never consult it.
  // Set on the way IN as well as cleared on the way out. StrictMode mounts,
  // unmounts and remounts in dev, and a ref that is only cleared stays false
  // through the remount - which left the re-check button stuck on '확인 중'
  // forever, because the .finally() that clears it was gated on this.
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let alive = true
    probeLlm().then((p) => { if (alive) setProbe(p) }).catch(() => { if (alive) setProbe({ ok: false, why: 'probe failed' }) })
    return () => { alive = false }
  }, [])
  // ...but once per mount is the wrong number for the deployment we actually
  // have. The AWS copy's GPU is started for the demo and stopped after
  // (docs/24-aws-demo.md), so the model coming up mid-session is the normal
  // case, not the odd one - and without this the box stays dead until someone
  // reloads the page mid-demo. The probe is one GET with a 2.5s timeout, so
  // asking again is cheap; nothing here caches, so a second call really does
  // re-ask. Manual only: a poll would hammer an endpoint that is deliberately
  // absent for the whole run.
  const [recheck, setRecheck] = useState(false)
  const probeAgain = useCallback(() => {
    if (recheck) return
    setRecheck(true)
    probeLlm()
      .then((p) => { if (mounted.current) setProbe(p) })
      .catch(() => { if (mounted.current) setProbe({ ok: false, why: 'probe failed' }) })
      .finally(() => { if (mounted.current) setRecheck(false) })
  }, [recheck])
  const llmOk = !!(probe && probe.ok)
  const llmNote = llmNoteOf(probe, config())

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

  // The ask is async and the log moves under it: a button pressed while the
  // model is thinking would otherwise be overwritten by the answer, which was
  // built from the list as it stood when the question was sent. The ref is
  // the same fix the edit-mode tap handler needed - read the latest, do not
  // close over a snapshot.
  const logRef = useRef(log)
  useEffect(() => { logRef.current = log }, [log])
  const ctxRef = useRef(ctx)
  useEffect(() => { ctxRef.current = ctx }, [ctx])

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
      setOutcome(null)
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

  // 질문 -> routeQuestion -> validate -> ask -> narrate, with the three
  // outcomes kept apart on screen: an answer is logged, an abstention is
  // reported as correct behaviour, a failure names itself and points at the
  // buttons. None of the three is silent.
  const submit = useCallback(async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    const q = question.trim()
    if (!q || busy || !llmOk) return
    setBusy(true)
    setErr(null)
    setOutcome(null)
    setOpen(true)
    let res
    try {
      res = await runQuestion(ctxRef.current, q, { cfg: config().llm || {}, spec: queries })
    } catch (ex) {
      // runQuestion catches what it expects; anything left is still shown.
      res = { kind: 'error', error: 'transport', why: (ex && ex.message) || String(ex) }
    }
    setBusy(false)
    if (res.kind === 'answer') {
      setQuestion('')
      write(pushLog(logRef.current, entryOf(res, q, Date.now())))
      return
    }
    setOutcome({ ...res, question: q })
  }, [question, busy, llmOk, queries, write])

  const body = (
    <div className="staff">
      <div className="staff-queries">
        {/* The box is the only part of this panel that needs a model. The
            buttons under it are unaffected by every branch here - that is
            what makes the demo whole on a laptop with no GPU. */}
        {/* The example is the whole point of the placeholder - it is where a
            reader learns that this box takes a sentence, not a keyword - so
            it is the "질문을 쓴다" prefix that goes, not the question. The
            field holds 211px of text at 12px and the example measures 208px;
            with the prefix it was 275px and the tail was cut off. */}
        <form className="staff-askbox" onSubmit={submit}>
          <input
            type="text" className="staff-ask-input"
            value={question} disabled={!llmOk || busy}
            placeholder={llmOk ? '예: TOC-SRV 가 끊기면 어떤 임무가 상하나' : '모델이 없어 질의창을 쓸 수 없다'}
            aria-label="참모에게 묻는다"
            onChange={(ev) => setQuestion(ev.target.value)}
          />
          {llmOk ? (
            <button type="submit" className="staff-ask-go" disabled={busy || !question.trim()}>
              {busy ? '묻는 중' : '묻기'}
            </button>
          ) : (
            /* The disabled 묻기 button would be a second dead control next to a
               dead input. The one thing a person can usefully do here is ask
               again, so that is the button that occupies the slot. */
            <button type="button" className="staff-ask-go" onClick={probeAgain} disabled={recheck}>
              {recheck ? '확인 중' : '다시 확인'}
            </button>
          )}
        </form>
        {!llmOk && (
          <p className="staff-llm-note">
            <b>질의창 사용 불가</b> {llmNote || (probe ? '모델 서버에 닿지 못했다.' : '모델 서버를 확인하는 중이다.')}
            {' '}아래 질의 버튼은 모델 없이 그대로 동작한다. 모델을 지금 켰다면 <b>다시 확인</b>을 누른다.
          </p>
        )}

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
          <button type="button" className="staff-clear" onClick={() => { write([]); setErr(null); setOutcome(null) }}>
            기록 지우기 ({log.length})
          </button>
        )}
      </div>

      <div className="staff-answers">
        {err && <p className="staff-err" role="status">거부: {err}</p>}
        {busy && <p className="staff-asking" role="status">모델에 묻는 중이다 - 질의를 고르고 사실을 읽어 준다.</p>}

        {/* 기권. The model declining is the model working: it was told not to
            invent a query, and it did not. The engine was NOT run, and the
            wording says that without calling it an error. */}
        {outcome && outcome.kind === 'abstain' && (
          <div className="staff-outcome is-abstain" role="status">
            <p className="staff-outcome-head"><b>답할 수 없다 (기권)</b> <span className="staff-outcome-q">{outcome.question}</span></p>
            <p className="staff-outcome-why">{outcome.why}</p>
            <p className="staff-outcome-note">
              기권은 정상 동작이지 오류가 아니다. 카탈로그에 맞는 질의가 없다고 판단해 엔진을 돌리지 않았다.
              아래 질의 버튼으로 직접 고를 수 있다.
            </p>
          </div>
        )}

        {/* Transport, timeout, or an engine refusal. There is nothing to
            show but the reason - and the buttons, which still work. */}
        {outcome && outcome.kind === 'error' && (
          <div className="staff-outcome is-fail" role="status">
            <p className="staff-outcome-head">
              <b>묻지 못했다 · {errKo(outcome.error)}</b> <code className="staff-qid">{outcome.error}</code>
              <span className="staff-outcome-q">{outcome.question}</span>
            </p>
            <p className="staff-outcome-why">{outcome.why}</p>
            <p className="staff-outcome-note">
              모델 없이도 답이 나온다 - 아래 질의 버튼은 결정론 엔진을 직접 부른다.
            </p>
          </div>
        )}

        {!log.length && !err && !outcome && !busy && (
          <p className="staff-empty">
            질의를 누르면 결정론적 엔진이 계산한 사실이 번호와 함께 나온다 - 이 경로에 모델은 없다.
            질의창은 질문을 그 질의 중 하나로 옮기고, 나온 사실을 문장으로 읽어 줄 뿐이다.
          </p>
        )}
        {log.map((a) => (
          <Answer key={a.at} answer={a} graph={graph} curT={curT} curFp={curFp} onSelect={onSelect} />
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
