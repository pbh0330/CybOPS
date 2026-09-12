// Derived values for the React layer.
//
// Nothing in this file computes mission degradation. It either reads the
// precomputed export or delegates to engine.js, which is the deterministic
// layer (ADR-0003). If a number looks wrong, the fix belongs in the engine.

import { runStep, containmentCandidates } from './engine.js'
import { assetName, linkName } from './labels.js'

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
  return { time: '스냅샷', off: '' }
}
