// The sandbox (ADR-0027). A scenario derived in the browser from a template:
// the mission layer stays, the assets go, and what the user builds is the
// network the attacker will see. Everything here is a pure function over the
// graph except the plan store at the bottom, which is localStorage.
//
// The engine treats a service with no provider as degraded 0, so an empty
// sandbox reads as "mission fine". readiness() is the gate that keeps a game
// from starting until every service has a provider and every task a
// performer - it is what teaches what the mission needs. The gate also asks
// the engine for a no-attack baseline: a performer that cannot reach its
// provider over the links is degradation 1 before anyone attacks.

import { runChain } from './engine.js'

export const SANDBOX_ID = 'sandbox-01'
export const TEMPLATE_ID = 'tacnet-01'
export const BEARER_ORDER = ['wired', 'vhf', 'satcom', 'hf', 'lte']

export function makeSandbox(template) {
  const t = structuredClone(template.graph)
  const graph = {
    scenario_id: SANDBOX_ID,
    name: '교전장 - 임무는 물려받고 망은 직접 만든다',
    network_type: t.network_type,
    authored: 'derived',
    classification: `가상. ${TEMPLATE_ID} 의 임무 계층에서 파생. 자산·링크는 사용자가 구성한다.`,
    basis: 'ADR-0027',
    template: TEMPLATE_ID,
    cause_labels: t.cause_labels,
    units: t.units,
    missions: t.missions,
    phases: (t.phases || []).map(({ window, ...p }) => p),   // static: every phase active
    tasks: (t.tasks || []).map((x) => ({ ...x, performed_at: null })),
    services: t.services,
    assets: [],
    links: [],
    edges: { requires: t.edges.requires || [], provided_by: [], hosted_on: [], depends_on: [], redundant_with: [] },
    crown_jewels: [],
    geo: { _role: t.geo._role, frame: t.geo.frame, georef: t.geo.georef, safety: t.geo.safety, position_rule: t.geo.position_rule },
    notes: ['교전장. 준비도(서비스 제공자·작업 수행 자산)가 차야 교전이 열린다.'],
  }
  return { scenario_id: SANDBOX_ID, generated: null, generator: 'ui/src/sandbox.js', contract: template.contract, method: template.method || 'weighted', note: 'derived in the browser; steps are computed by the local engine', graph, steps: [] }
}

let rulesCache = null
export async function loadRules(base = './data/link-rules.json') {
  if (rulesCache) return rulesCache
  try { const r = await fetch(base); rulesCache = r.ok ? await r.json() : null } catch { rulesCache = null }
  return rulesCache
}
export function rules() { return rulesCache }

const byId = (g, id) => (g.assets || []).find((a) => a.id === id)
const linked = (g, a, b) => (g.links || []).some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))
// '신규' is the placeholder a freshly placed asset carries, not a place; two of
// them are not at the same site. Exported so the inspector flags links by the
// same reading that proposed them.
export const siteOf = (a) => (a && a.site && a.site !== '신규' ? a.site : null)

export function linkCandidates(g, rules, assetId) {
  const me = byId(g, assetId)
  if (!me || !rules || !rules.types || !rules.types[me.type]) return []
  const mine = rules.types[me.type].bearers || []
  const out = []
  for (const o of g.assets || []) {
    if (o.id === assetId || linked(g, assetId, o.id)) continue
    const theirs = (rules.types[o.type] || {}).bearers || []
    for (const b of BEARER_ORDER) {
      if (!mine.includes(b) || !theirs.includes(b)) continue
      const rule = (rules.bearers || {})[b] || {}
      if (rule.same_site && (!siteOf(me) || !siteOf(o) || siteOf(me) !== siteOf(o))) continue
      if (rule.needs_type && me.type !== rule.needs_type && o.type !== rule.needs_type) continue
      const mySite = siteOf(me)
      const oSite = siteOf(o)
      const why = mySite && mySite === oSite ? 'site' : me.unit === o.unit ? 'unit' : o.transit !== false ? 'transit' : 'bearer'
      out.push({ id: o.id, bearer: b, why })
    }
  }
  const whyRank = { site: 0, unit: 1, transit: 2, bearer: 3 }
  out.sort((a, b) => (whyRank[a.why] - whyRank[b.why]) || (BEARER_ORDER.indexOf(a.bearer) - BEARER_ORDER.indexOf(b.bearer)) || a.id.localeCompare(b.id))
  return out.map((c, i) => ({ ...c, rank: i + 1 }))
}

export function missionCandidates(g, rules, assetId) {
  const me = byId(g, assetId)
  const r = me && rules && rules.types ? rules.types[me.type] : null
  if (!r) return { services: [], tasks: [] }
  const kinds = new Set(r.provides || [])
  const taskIds = new Set((g.tasks || []).map((t) => t.id))
  return {
    services: (g.services || []).filter((s) => kinds.has(s.kind)).map((s) => s.id),
    tasks: (r.performs || []).filter((id) => taskIds.has(id)),
  }
}

export function readiness(g) {
  const assetIds = new Set((g.assets || []).map((a) => a.id))
  const provided = (g.edges && g.edges.provided_by) || []
  const sMissing = (g.services || []).filter((s) => !provided.some((e) => e.from === s.id && assetIds.has(e.to))).map((s) => s.id)
  const tMissing = (g.tasks || []).filter((t) => !t.performed_at || !assetIds.has(t.performed_at)).map((t) => t.id)
  const linkedIds = new Set()
  for (const l of g.links || []) { linkedIds.add(l.a); linkedIds.add(l.b) }
  const isolated = (g.assets || []).filter((a) => !linkedIds.has(a.id)).map((a) => a.id)
  const jewels = (g.crown_jewels || []).filter((id) => assetIds.has(id)).length
  // Engine baseline with no attack: a provider the task performer cannot
  // reach over the links counts as degradation 1 in serviceDegFor, so a
  // structurally complete board can still be functionally dead. Only asked
  // once the structure is in place - runChain on a half-empty graph is
  // noise. runChain never reads geo (Test-GeoInvariance).
  let unreachable = []
  if (sMissing.length === 0 && tMissing.length === 0) {
    const base = runChain(g, {}, { t: -1, method: 'weighted', causes: 'all' })
    unreachable = (g.tasks || []).filter((t) => Number(base.task[t.id] || 0) > 1e-9).map((t) => t.id)
  }
  const services = { ok: (g.services || []).length - sMissing.length, total: (g.services || []).length, missing: sMissing }
  const tasks = { ok: (g.tasks || []).length - tMissing.length, total: (g.tasks || []).length, missing: tMissing }
  return {
    services, tasks, isolated, jewels, unreachable,
    ready: sMissing.length === 0 && tMissing.length === 0 && unreachable.length === 0,
  }
}

function extentOf(g) { return (g.geo && g.geo.frame && g.geo.frame.extent) || { x: [0, 24000], y: [0, 18000] } }
function pos(a) { return a && a.geo && a.geo.at ? a.geo.at : null }

// 150 m ring around the anchor, first angle (0, 45, 90, ...) that is at least
// 60 m from every placed asset. Deterministic: same graph, same point.
export function placeNear(g, anchorId) {
  const c = pos(byId(g, anchorId))
  if (!c) return placeFree(g)
  const taken = (g.assets || []).map(pos).filter(Boolean)
  for (let k = 0; k < 16; k++) {
    const ang = (k * 45 + Math.floor(k / 8) * 22.5) * Math.PI / 180
    const p = { x: Math.round(c.x + 150 * Math.cos(ang)), y: Math.round(c.y + 150 * Math.sin(ang)), z: 0 }
    if (taken.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 60)) return p
  }
  return placeFree(g)
}

// centre of the first 2 km cell (row-major from the south-west) with no asset
// within 1 km
export function placeFree(g) {
  const ext = extentOf(g)
  const taken = (g.assets || []).map(pos).filter(Boolean)
  for (let y = ext.y[0] + 1000; y < ext.y[1]; y += 2000) {
    for (let x = ext.x[0] + 1000; x < ext.x[1]; x += 2000) {
      if (taken.every((q) => Math.hypot(q.x - x, q.y - y) >= 1000)) return { x, y, z: 0 }
    }
  }
  return { x: ext.x[0] + 1000, y: ext.y[0] + 1000, z: 0 }
}

export function validateImport(sandbox, graph) {
  const errors = []
  const t = sandbox.graph
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.assets)) errors.push('assets 배열이 없다')
  const same = (k) => JSON.stringify((graph && graph[k] || []).map((x) => x.id)) === JSON.stringify((t[k] || []).map((x) => x.id))
  if (graph && Array.isArray(graph.assets)) {
    if (!same('missions')) errors.push('임무 목록이 템플릿과 다르다')
    if (!same('tasks')) errors.push('작업 목록이 템플릿과 다르다')
    if (!same('services')) errors.push('서비스 목록이 템플릿과 다르다')
    const ids = new Set(graph.assets.map((a) => a.id))
    for (const l of graph.links || []) if (!ids.has(l.a) || !ids.has(l.b)) errors.push(`링크 ${l.id} 의 끝이 없는 자산을 가리킨다`)
  }
  return { ok: errors.length === 0, errors }
}

const PLANS_KEY = 'mccycop:sandbox:plans'
function readPlans() { try { return JSON.parse(localStorage.getItem(PLANS_KEY) || '[]') } catch { return [] } }
function writePlans(list) { try { localStorage.setItem(PLANS_KEY, JSON.stringify(list)) } catch { /* quota */ } }
export function listPlans() { return readPlans().map(({ name, saved_at }) => ({ name, saved_at })) }
export function savePlan(name, graph) {
  const list = readPlans().filter((p) => p.name !== name)
  list.push({ name, saved_at: new Date().toISOString(), graph: structuredClone(graph) })
  list.sort((a, b) => a.name.localeCompare(b.name))
  writePlans(list)
}
export function loadPlan(name) { const p = readPlans().find((x) => x.name === name); return p ? structuredClone(p.graph) : null }
export function deletePlan(name) { writePlans(readPlans().filter((p) => p.name !== name)) }
