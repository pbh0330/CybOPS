// Derived values for the React layer.
//
// Nothing in this file computes mission degradation. It either reads the
// precomputed export or delegates to engine.js, which is the deterministic
// layer (ADR-0003). If a number looks wrong, the fix belongs in the engine.

import { runStep, containmentCandidates } from './engine.js'
import { assetName, linkName, techniqueKo } from './labels.js'
import { legalFor } from './game.js'
import { footholds } from './attack.js'

export function num(v) { return typeof v === 'number' ? v : Number(v || 0) }
export function pct(v) { return `${(num(v) * 100).toFixed(1)}%` }

// An edited scenario has no precomputed export, so its numbers come from the
// local engine port. In a wargame the compromise state belongs to the turn
// loop, not to the export: that is what makes the opponent real rather than a
// replay of one.
export function computeStep({ payload, graph, idx, edited, wargameState }) {
  if (!payload || !graph) return null
  const base = payload.steps[idx]
  const live = wargameState != null
  if (!edited && !live) return base
  const t = base && base.t !== undefined && base.t !== null ? Number(base.t) : -1
  const compromise = live ? wargameState : ((base && base.compromise) || {})
  const computed = runStep(graph, compromise, {
    t,
    method: payload.method || 'weighted',
    candidates: containmentCandidates(graph, compromise),
  })
  return { ...computed, label: base?.label, note: base?.note, time_iso: base?.time_iso, t }
}

// total is the truth; att/env/inter are an attribution of it. Draw the bar to
// total length and divide it in the ratio of the (absolute) contributions, so
// a negative interaction never produces a bar longer than the real value.
export function splitBar(att, env, inter, total) {
  const mag = Math.abs(att) + Math.abs(env) + Math.abs(inter)
  if (total <= 0 || mag <= 0) return { attack: 0, env: 0, inter: 0 }
  const k = (total * 100) / mag
  return { attack: Math.abs(att) * k, env: Math.abs(env) * k, inter: Math.abs(inter) * k }
}

export function noteFor(outages, t) {
  for (const o of outages || []) {
    if (t >= o.from && t < o.to) return o.note || ''
  }
  return ''
}

// Wiring a box into the transport graph does not make it matter to a mission.
// It can matter by carrying traffic, but to provide a service or host work it
// has to be said. An asset with no such tie is drawn as unattached.
export function linkageOf(graph, assetId) {
  const E = (graph && graph.edges) || {}
  const provides = (E.provided_by || []).filter((e) => e.to === assetId).map((e) => e.from)
  const hosts = ((graph && graph.tasks) || []).filter((t) => t.performed_at === assetId).map((t) => t.id)
  const dependedOn = (E.depends_on || []).filter((e) => e.to === assetId).map((e) => e.from)
  const hostedOn = (E.hosted_on || []).filter((e) => e.to === assetId).map((e) => e.from)
  return {
    provides, hosts, dependedOn, hostedOn,
    linked: provides.length + hosts.length + dependedOn.length + hostedOn.length > 0,
  }
}

export function missionRows(graph, s) {
  const missions = (graph?.missions || []).slice().sort((a, b) => (a.priority || 9) - (b.priority || 9))
  return missions.map((m) => {
    const total = num(s?.mission?.[m.id])
    const active = s?.mission_active ? s.mission_active[m.id] !== false : true
    const att = num(s?.mission_attack?.[m.id])
    const env = num(s?.mission_env?.[m.id])
    const inter = total - att - env
    return { ...m, total, active, att, env, inter, parts: splitBar(att, env, inter, total) }
  })
}

export function cutRows(graph, s) {
  const rows = []
  const assetOut = s?.asset_outage || {}
  const linkOut = s?.link_outage || {}
  // Korean first, id second: the id is a cross-reference key, not a name
  for (const a of graph?.assets || []) {
    const c = assetOut[a.id]
    if (c) rows.push({ what: assetName(graph, a.id).ko, id: a.id, cause: c, note: noteFor(a.outages, s.t) })
  }
  for (const l of graph?.links || []) {
    const c = linkOut[l.id]
    if (c) rows.push({ what: linkName(graph, l), id: l.id, cause: c, note: noteFor(l.outages, s.t) })
  }
  for (const [id, v] of Object.entries(s?.compromise || {})) {
    if (num(v) > 0) rows.push({ what: assetName(graph, id).ko, id, cause: 'attack', note: `침해 ${pct(num(v))}` })
  }
  return rows
}

// Containment candidates, priced. The engine already ran the isolation
// what-if for each of them at each step, so what is shown is the real cost of
// the action, not an estimate made at render time.
export function actionRows(graph, s) {
  const wf = s?.whatif || {}
  const missions = graph?.missions || []
  const rows = Object.keys(wf).map((id) => {
    const w = wf[id]
    let worst = 0
    const parts = []
    for (const m of missions) {
      const d = num(w.delta?.[m.id])
      if (Math.abs(d) > 0.0005) parts.push({ id: m.id, name: m.name, d })
      if (d > worst) worst = d
    }
    const n = assetName(graph, id)
    return {
      id, worst, parts,
      ko: n.ko, typeKo: n.typeKo,
      compromised: num(s?.compromise?.[id]) > 0,
      fullyHit: num(s?.compromise?.[id]) >= 0.999,
    }
  })
  rows.sort((a, b) => (b.compromised - a.compromised) || (a.worst - b.worst))
  return rows
}

export function activePhaseNames(graph, s) {
  const active = new Set(s?.active_phases || [])
  return (graph?.phases || []).filter((p) => active.has(p.id)).map((p) => p.name)
}

export function clockOf(s) {
  if (s?.time_iso) {
    const d = new Date(s.time_iso)
    return {
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      off: `+${s.t}분`,
    }
  }
  // chain time only (no t0): the offset is the clock
  if (s && Number(s.t) >= 0) return { time: `+${s.t}분`, off: '' }
  return { time: '스냅샷', off: '' }
}

// The attack path so far, as the authored compromise order says it. Each
// asset is listed at the step where its compromise first rises above zero,
// and a hop is drawn from the previously compromised asset to it, labelled
// with that step's technique. This is a reading of the attack INPUT (the
// timeline the scenario author wrote), not a detection and not an inference:
// the engine never reasons about which host reached which. It exists so the
// picture shows the campaign as a route, not as a set of red borders.
export function attackHops(steps, idx) {
  const seen = new Set()
  const order = []
  for (let i = 0; i <= idx && i < (steps || []).length; i++) {
    const st = steps[i]
    const gts = Array.isArray(st.gt) ? st.gt : (st.gt ? [st.gt] : [])
    const fresh = Object.entries(st.compromise || {})
      .filter(([id, v]) => num(v) > 0 && !seen.has(id))
      .map(([id]) => id)
    for (const id of fresh) {
      seen.add(id)
      order.push({ id, t: st.t, label: st.label, technique: gts.length ? gts[gts.length - 1].technique : null })
    }
  }
  const hops = []
  for (let i = 1; i < order.length; i++) {
    hops.push({ from: order[i - 1].id, to: order[i].id, t: order[i].t, label: order[i].label, technique: order[i].technique })
  }
  return { order, hops }
}

// One word per cause, shared by the event log and the staff query layer so a
// sentence and a row never name the same cause differently.
export const CAUSE_KO_ROW = { attack: '공격', mobility: '기동', terrain: '지형', maintenance: '정비', unknown: '미상' }

// Wall clock for an offset in minutes, or the offset itself when the
// scenario has no t0 (defnet-01's chain clock).
export function timeLabel(graph, t) {
  const t0 = graph?.timeline?.t0_iso
  if (!t0) return `+${t}분`
  const d = new Date(new Date(t0).getTime() + Number(t) * 60000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The replay read as a log. Every row is a change between two consecutive
// exported steps (or a segment boundary in the authored track), so nothing
// here is inferred: it is the same data the timeline ribbon draws, in prose.
// Rows point at the last step at or before their t so a click lands on the
// picture that already shows the change.
export function eventRows(graph, payload) {
  const steps = payload?.steps || []
  if (!steps.length) return []
  const rows = []
  const stepAt = (t) => {
    let idx = 0
    steps.forEach((s, i) => { if (num(s.t) <= t) idx = i })
    return idx
  }
  const push = (t, kind, cause, text, id) => rows.push({ t, time: timeLabel(graph, t), kind, cause, text, id, stepIdx: stepAt(t) })
  const phaseName = (id) => (graph?.phases || []).find((p) => p.id === id)?.name || id

  let prev = { compromise: {}, link_outage: {}, asset_outage: {}, active_phases: [] }
  for (const s of steps) {
    const t = num(s.t)
    const gts = Array.isArray(s.gt) ? s.gt : (s.gt ? [s.gt] : [])
    const tech = gts.length ? gts[gts.length - 1].technique : null
    for (const [id, v] of Object.entries(s.compromise || {})) {
      if (num(v) > 0 && !(num(prev.compromise?.[id]) > 0)) {
        const ko = techniqueKo(tech)
        push(t, 'attack', 'attack', `${assetName(graph, id).ko} 침해${ko ? ` · ${ko}` : ''}${s.label ? ` (${s.label})` : ''}`, id)
      }
    }
    for (const l of graph?.links || []) {
      const now = (s.link_outage || {})[l.id] || null
      const was = (prev.link_outage || {})[l.id] || null
      if (now && !was) push(t, 'outage', now, `${linkName(graph, l)} 단절 · ${CAUSE_KO_ROW[now] || now}`, l.id)
      if (!now && was) push(t, 'restore', was, `${linkName(graph, l)} 복구`, l.id)
    }
    for (const a of graph?.assets || []) {
      const now = (s.asset_outage || {})[a.id] || null
      const was = (prev.asset_outage || {})[a.id] || null
      if (now && !was) push(t, 'outage', now, `${assetName(graph, a.id).ko} 단절 · ${CAUSE_KO_ROW[now] || now}`, a.id)
      if (!now && was) push(t, 'restore', was, `${assetName(graph, a.id).ko} 복구`, a.id)
    }
    const wasPh = new Set(prev.active_phases || [])
    for (const ph of s.active_phases || []) {
      if (!wasPh.has(ph)) push(t, 'phase', null, `${phaseName(ph)} 단계 시작`, ph)
    }
    prev = { ...prev, ...s, compromise: s.compromise || prev.compromise, link_outage: s.link_outage || {}, asset_outage: s.asset_outage || {}, active_phases: s.active_phases || prev.active_phases }
  }
  for (const a of graph?.assets || []) {
    for (const seg of a.geo?.segments || []) {
      if (seg.mode !== 'move') continue
      const name = assetName(graph, a.id).ko
      push(num(seg.from), 'move', null, `${name} 이동 시작 (${a.id})`, a.id)
      push(num(seg.to), 'move', null, `${name} 이동 완료 (${a.id})`, a.id)
    }
  }
  const order = { phase: 0, move: 1, outage: 2, restore: 3, attack: 4 }
  rows.sort((a, b) => (a.t - b.t) || (order[a.kind] - order[b.kind]))
  return rows
}

export const BAND_LABELS = ['정상', '주의', '경계', '심각']

// Headline numbers for the top strip. The band is a fixed rule over the worst
// active mission value - a threshold, not a judgement, and not a doctrinal
// term (ADR-0003).
export function kpiOf(graph, s) {
  const missions = (graph?.missions || []).slice().sort((a, b) => (a.priority || 9) - (b.priority || 9))
    .map((m) => ({ id: m.id, name: m.name, priority: m.priority, total: num(s?.mission?.[m.id]),
      active: s?.mission_active ? s.mission_active[m.id] !== false : true }))
  const assets = graph?.assets || []
  const compromised = assets.filter((a) => num(s?.compromise?.[a.id]) > 0).length
  const byCause = {}
  for (const c of Object.values(s?.link_outage || {})) if (c) byCause[c] = (byCause[c] || 0) + 1
  const cuts = Object.values(byCause).reduce((x, y) => x + y, 0)
  const worst = Math.max(0, ...missions.filter((m) => m.active).map((m) => m.total))
  const level = worst <= 0 ? 0 : worst < 0.3 ? 1 : worst < 0.7 ? 2 : 3
  return { missions, compromised: { n: compromised, total: assets.length }, cuts: { n: cuts, byCause }, band: { level, label: BAND_LABELS[level] } }
}

// The single line the collapsed sheet shows on a phone. It reports, it never
// computes: the degradation comes out of kpiOf, which reads the same step the
// rail reads, so the peek and the panel behind it can never disagree. During
// an engagement the turn and the score replace it - that is what the operator
// is tracking while the clock is frozen.
export function peekLine(graph, step, game) {
  if (game && game.cfg) {
    const t = num(game.score?.total)
    const score = game.cfg.mode === 'hold' ? t.toFixed(2) : t
    return `턴 ${num(game.turn) + 1}/${game.cfg.turns} · 점수 ${score}`
  }
  const { missions } = kpiOf(graph, step)
  // missions is already priority-sorted; a phase-inactive mission has no
  // number to show, so the top ACTIVE one is the headline
  const m = missions.find((x) => x.active) || missions[0]
  if (!m) return '임무 없음'
  return `${m.name} P${m.priority} ${pct(m.total)}`
}

// What the pictures draw during a wargame. Candidates are the attacker's top
// six legal moves as the engine scores them - read from the same list the
// panel shows, never inferred. Lateral moves become edges, self-targeted
// moves (escalate/deny/credential) become node threats.
export function gameOverlay(g, game) {
  if (!game) return null
  const top = legalFor(g, game).filter((m) => m.target).slice(0, 6)
  const candidates = [], nodeThreats = []
  top.forEach((m, i) => {
    if (m.from && m.from !== m.target) candidates.push({ from: m.from, to: m.target, gain: m.gain, rank: i + 1, label: m.label })
    else nodeThreats.push({ id: m.target, gain: m.gain, rank: i + 1, label: m.label })
  })
  const rec = game.history[game.history.length - 1]
  const last = rec && rec.attacker && rec.attacker.move.target
    ? { from: rec.attacker.move.from, to: rec.attacker.move.target, success: rec.attacker.success, turn: rec.turn }
    : null
  return { candidates, nodeThreats, last, isolated: game.isolated.slice(), footholds: footholds(game.attacker, game.isolated), turn: game.turn }
}

// --- U3: contribution as thickness --------------------------------------
//
// `attribution()` (facts.js) measures, per asset, how many percentage points
// of ONE mission's degradation that asset's compromise accounts for: set its
// compromise back to 0, run the chain again, take the drop. The numbers are
// the engine's, measured, not fitted (ADR-0003).
//
// THE SCALE IS max(contribution) INSIDE THE SET, NEVER THE MISSION TOTAL.
//
// This is not a stylistic preference. Per-asset contributions can EXCEED the
// total they are drawn against, because engine.js serviceDegFor multiplies
// the providers of a redundancy_group: with two providers compromised,
// removing either one alone reads as decisive and the same loss is charged
// twice. On tacnet-01 at t=180, RELAY-1 (0.6) and SAT-TERM (0.7) against
// M-FIRE each read +8.6%p for a total of 8.6% - an individual sum of +17.3%p
// against a total of 8.6%, and a pair sweep found four such combinations.
// Dividing by the total would draw two lines at 100% each and a picture that
// says each of two assets is the whole of a loss both of them share.
//
// So the weight is a RANK-FREE COMPARISON BETWEEN ASSETS and nothing else.
// The legend has to say that, because thickness invites being read as a share.
export function contribLayer(attr, mission) {
  if (!attr || attr.active === false) return null
  const rows = (attr.rows || []).filter((r) => num(r.contribution) > 0)
  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => num(r.contribution)))
  if (!(max > 0)) return null
  return {
    mission: attr.mission,
    missionName: (mission && (mission.name || mission.id)) || attr.mission,
    total: num(attr.total),
    max,
    // w is contribution / max(contribution): 1 for the heaviest asset in the
    // set, proportional below it, and never a fraction of `total`.
    rows: rows
      .map((r) => ({ id: r.id, contribution: num(r.contribution), w: num(r.contribution) / max }))
      .sort((a, b) => (b.contribution - a.contribution) || String(a.id).localeCompare(String(b.id))),
  }
}

// Which mission the contribution layer is about. attribution() splits ONE
// mission's degradation, so the layer has to name one: the highest-priority
// mission that has active work at this step, the same mission peekLine puts in
// the phone's one line. Reported, never averaged across missions - a mean of
// two different totals is not a contribution to either.
export function contribMission(graph, s) {
  const missions = (graph?.missions || []).slice().sort((a, b) => (num(a.priority) || 9) - (num(b.priority) || 9))
  const active = (m) => (s?.mission_active ? s.mission_active[m.id] !== false : true)
  return missions.find(active) || missions[0] || null
}
