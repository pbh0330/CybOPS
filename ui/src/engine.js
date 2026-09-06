// Mission degradation propagation, ported from scripts/Invoke-MissionPropagation.ps1.
//
// WHY THIS EXISTS. The viewer reads precomputed engine output and does not
// recompute anything (ADR-0003). That is still true for the shipped scenarios.
// But the editor lets a person add a node and a link, and a scenario that does
// not exist yet has no precomputed output. Without a local engine, editing
// would mean "change something, run PowerShell, reload" - which is not an
// editor, it is a batch job.
//
// TWO IMPLEMENTATIONS OF THE SAME RULES DRIFT. That risk is real and is not
// waved away here: ui/tools/parity.mjs replays every shipped scenario through
// this port and fails if any mission value differs from the PowerShell output
// by more than 1e-9. Run it whenever either side changes.
//
// PowerShell remains the reference. If the two disagree, this file is wrong.

const ALL_CAUSES = ['attack', 'mobility', 'terrain', 'maintenance', 'unknown']

function causeSet(mode) {
  if (mode === 'all') return new Set(ALL_CAUSES)
  if (mode === 'attack') return new Set(['attack'])
  if (mode === 'env') return new Set(ALL_CAUSES.filter((c) => c !== 'attack'))
  return new Set()
}

function activeOutage(outages, t, causes) {
  if (t < 0) return null
  for (const o of outages || []) {
    const c = o.cause || 'unknown'
    if (!causes.has(c)) continue
    if (t >= Number(o.from) && t < Number(o.to)) return c
  }
  return null
}

// Which assets are up, which links are up, and what can reach what.
// transit=false marks an end terminal: it originates and receives its own
// traffic but relays nobody else's, so components are built over transit nodes
// and terminals hang off them.
function snapshot(g, t, causes) {
  const assets = g.assets || []
  const links = g.links || []

  const assetOut = {}
  for (const a of assets) assetOut[a.id] = activeOutage(a.outages, t, causes)

  const linkOut = {}
  for (const l of links) linkOut[l.id] = activeOutage(l.outages, t, causes)

  const transit = {}
  for (const a of assets) transit[a.id] = a.transit === false ? false : true

  const adj = {}
  for (const a of assets) adj[a.id] = []
  for (const l of links) {
    if (linkOut[l.id]) continue
    if (assetOut[l.a] || assetOut[l.b]) continue
    if (!adj[l.a] || !adj[l.b]) continue
    adj[l.a].push(l.b)
    adj[l.b].push(l.a)
  }

  const comp = {}
  for (const a of assets) comp[a.id] = -1
  let cid = 0
  for (const a of assets) {
    if (assetOut[a.id] || !transit[a.id] || comp[a.id] >= 0) continue
    cid++
    comp[a.id] = cid
    const stack = [a.id]
    while (stack.length) {
      const n = stack.pop()
      for (const m of adj[n]) {
        if (assetOut[m] || !transit[m]) continue
        if (comp[m] < 0) { comp[m] = cid; stack.push(m) }
      }
    }
  }

  const compSet = {}
  for (const a of assets) {
    const set = new Set()
    if (!assetOut[a.id]) {
      if (transit[a.id]) set.add(comp[a.id])
      else for (const m of adj[a.id]) { if (!assetOut[m] && transit[m]) set.add(comp[m]) }
    }
    compSet[a.id] = set
  }

  return { assetOut, linkOut, comp, compSet, adj, transit, hasLinks: links.length > 0 }
}

function reach(snap, from, to) {
  if (!snap.hasLinks) return true
  if (!from) return true
  if (!(from in snap.compSet) || !(to in snap.compSet)) return true
  if (snap.assetOut[from] || snap.assetOut[to]) return false
  if (from === to) return true
  for (const m of snap.adj[from]) if (m === to) return true
  for (const c of snap.compSet[from]) if (snap.compSet[to].has(c)) return true
  return false
}

// An unreachable provider is indistinguishable from a dead one, from where the
// consumer sits. Redundancy that cannot be reached is not redundancy.
function serviceDegFor(imp, g, snap, consumer) {
  const svc = {}
  const provided = (g.edges && g.edges.provided_by) || []
  for (const s of g.services || []) {
    const providers = provided.filter((p) => p.from === s.id)
    if (!providers.length) { svc[s.id] = 0; continue }
    const eff = providers.map((p) => (reach(snap, consumer, p.to) ? Number(imp[p.to] || 0) : 1))
    svc[s.id] = s.redundancy_group
      ? eff.reduce((acc, v) => acc * v, 1)
      : eff.reduce((acc, v) => Math.max(acc, v), 0)
  }
  return svc
}

function assetImpact(compromise, g, snap) {
  const serviceIds = new Set((g.services || []).map((s) => s.id))
  const imp = {}
  for (const a of g.assets || []) {
    let v = Number(compromise[a.id] || 0)
    if (snap.assetOut[a.id]) v = 1
    imp[a.id] = v
  }
  const hosted = (g.edges && g.edges.hosted_on) || []
  const depends = (g.edges && g.edges.depends_on) || []

  for (let iter = 0; iter < 50; iter++) {
    let changed = false
    for (const e of hosted) {
      if (imp[e.to] > imp[e.from] + 1e-9) { imp[e.from] = imp[e.to]; changed = true }
    }
    for (const e of depends) {
      let src
      if (serviceIds.has(e.to)) {
        src = serviceDegFor(imp, g, snap, e.from)[e.to]
      } else {
        src = Number(imp[e.to] || 0)
        if (!reach(snap, e.from, e.to)) src = 1
      }
      const inherited = Number(e.w) * src
      if (inherited > imp[e.from] + 1e-9) { imp[e.from] = inherited; changed = true }
    }
    if (!changed) break
  }
  return imp
}

function combine(pairs, method) {
  if (!pairs.length) return 0
  if (method === 'max') return pairs.reduce((m, p) => Math.max(m, p.w * p.v), 0)
  if (method === 'noisyor') return 1 - pairs.reduce((acc, p) => acc * (1 - p.w * p.v), 1)
  let num = 0
  let den = 0
  for (const p of pairs) { num += p.w * p.v; den += p.w }
  return den <= 0 ? 0 : num / den
}

function activePhases(g, t) {
  const act = new Set()
  for (const ph of g.phases || []) {
    if (t < 0 || !ph.window) { act.add(ph.id); continue }
    if (t >= Number(ph.window.from) && t < Number(ph.window.to)) act.add(ph.id)
  }
  return act
}

// A task cannot be performed better than the machine performing it.
function taskDegradation(imp, g, snap, method) {
  const requires = (g.edges && g.edges.requires) || []
  const task = {}
  for (const t of g.tasks || []) {
    const consumer = t.performed_at || null
    const svc = serviceDegFor(imp, g, snap, consumer)
    const pairs = requires.filter((r) => r.from === t.id).map((r) => ({ w: Number(r.w), v: Number(svc[r.to] || 0) }))
    let v = combine(pairs, method)
    if (consumer && imp[consumer] > v) v = Number(imp[consumer])
    task[t.id] = v
  }
  return task
}

function missionDegradation(task, g, method, act) {
  const phaseOf = {}
  for (const ph of g.phases || []) phaseOf[ph.id] = ph.mission
  const value = {}
  const active = {}
  for (const m of g.missions || []) {
    const pairs = []
    for (const t of g.tasks || []) {
      if (phaseOf[t.phase] !== m.id) continue
      if (!act.has(t.phase)) continue
      pairs.push({ w: Number(t.criticality), v: Number(task[t.id] || 0) })
    }
    active[m.id] = pairs.length > 0
    value[m.id] = combine(pairs, method)
  }
  return { value, active }
}

export function runChain(g, compromise, { t = -1, method = 'weighted', causes = 'all' } = {}) {
  const cs = causeSet(causes)
  const snap = snapshot(g, t, cs)
  const imp = assetImpact(compromise || {}, g, snap)
  const svc = serviceDegFor(imp, g, snap, null)
  const task = taskDegradation(imp, g, snap, method)
  const act = activePhases(g, t)
  const mis = missionDegradation(task, g, method, act)
  return {
    t,
    asset: imp,
    service: svc,
    task,
    mission: mis.value,
    mission_active: mis.active,
    active_phases: [...act],
    asset_outage: snap.assetOut,
    link_outage: snap.linkOut,
  }
}

// Full step, matching the shape Export-ReplayData.ps1 writes, so the editor
// can hand the viewer something it already knows how to render.
export function runStep(g, compromise, { t = -1, method = 'weighted', candidates = [] } = {}) {
  const base = runChain(g, compromise, { t, method, causes: 'all' })
  const temporal = !!g.timeline
  const out = { ...base, compromise: { ...compromise } }

  if (temporal) {
    const atk = runChain(g, compromise, { t, method, causes: 'attack' })
    const env = runChain(g, {}, { t, method, causes: 'env' })
    out.mission_attack = atk.mission
    out.mission_env = env.mission
  }

  const whatif = {}
  for (const id of candidates) {
    const isolated = { ...compromise, [id]: 1 }
    const w = runChain(g, isolated, { t, method, causes: 'all' })
    const delta = {}
    for (const m of g.missions || []) {
      delta[m.id] = Number((w.mission[m.id] - base.mission[m.id]).toFixed(6))
    }
    whatif[id] = { mission: w.mission, delta }
  }
  out.whatif = whatif
  return out
}

export function containmentCandidates(g, compromise = {}) {
  const set = []
  for (const id of g.crown_jewels || []) if (!set.includes(id)) set.push(id)
  for (const id of Object.keys(compromise)) if (compromise[id] > 0 && !set.includes(id)) set.push(id)
  return set
}
