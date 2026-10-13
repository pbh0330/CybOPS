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

// Why the inspector has no candidates for a type: null when the rule table
// knows it, otherwise the string the inspector shows. A table that failed to
// load is a different message from a type the table does not list.
export function ruleGap(rules, type) {
  if (!rules || !rules.types || !Object.keys(rules.types).length) return '규칙표 없음'
  if (!rules.types[type]) return '규칙표에 없는 유형'
  return null
}

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

// Which rule conditions a scenario may waive by declaration: the conditions
// the table hangs on a bearer. The "both ends carry this bearer" test is NOT
// on the list, and that is the whole point of having a list. Whether a type
// carries a bearer is a question about the TABLE - c2-server was missing
// `vhf` and the answer was to fix the row (U13), not to let the scenario
// declare its way past it. A blanket "this link is fine" would have covered
// that too, silently.
const EXEMPTABLE = ['same_site', 'needs_type']

// A link's declared abstraction exception, or null when it has none the
// predicate will honour.
//
// defnet-01 already admitted, in prose, why FW01 is wired to workstations at
// other sites: "부대별 액세스 스위치는 모델링하지 않는다". linkFitsRules cannot
// read a note, so a scenario that was being honest looked wrong on screen.
// This moves the same sentence to where the predicate reaches it (ADR-0033).
// The field does not start with '_' on purpose: in this repository '_' marks
// prose for people only, and a machine-read field wearing that prefix would
// be read as prose by the next person.
//
// `why` is required: an exception without a reason is a switch that turns the
// judge off, and a link that carries one is still out of rule. `exempts` must
// name the conditions waived, so the declaration cannot quietly cover a later
// violation of a different kind.
export function linkException(l) {
  const e = l && l.rule_exception
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null
  const why = typeof e.why === 'string' ? e.why.trim() : ''
  const exempts = (Array.isArray(e.exempts) ? e.exempts : []).filter((r) => EXEMPTABLE.includes(r))
  if (!why || !exempts.length) return null
  return { exempts, why }
}

// Does a link that is already on the board still fit the rule table? The same
// reading linkCandidates uses to PROPOSE a link, applied to one that is there
// already: the inspector's 규칙 밖 mark and the overlay's dotted ghost line
// (derive.linkGhosts) are one predicate, so the flag and the line can never
// disagree. A link that stopped fitting is flagged, never removed - the board
// stays the person's and the flag is the table's opinion.
//
// True when the table cannot say: no table, or either end's type absent from
// it. Silence is not an accusation.
//
// A link with NO bearer is out of rule, not 'wired'. The table answers about
// the bearer a link declares, and a link that declares none has not been
// answered about - defaulting it would invent a declaration the scenario did
// not make, and would silently flip the inspector's verdict on exactly the
// links a person is most likely to have left half-built. This is the reading
// the inline predicate in Rail.jsx had before it moved here.
//
// A link may waive a condition by declaring it (linkException above). Only a
// link that EXISTS can carry a declaration, which is why this reads one and
// linkCandidates does not: candidates are links that are not there yet, so
// there is nothing to read, and the proposer still refuses wired across
// sites. One predicate, two questions - not two predicates (ADR-0033).
export function linkFitsRules(g, rules, l) {
  if (!l) return true
  const a = byId(g, l.a)
  const b = byId(g, l.b)
  if (!a || !b || !rules || !rules.types) return true
  const ra = rules.types[a.type]
  const rb = rules.types[b.type]
  if (!ra || !rb) return true
  const bearer = l.bearer
  const both = (ra.bearers || []).includes(bearer) && (rb.bearers || []).includes(bearer)
  const r = (rules.bearers || {})[bearer] || {}
  // '신규' is not a place: siteOf reads it as no site, same as linkCandidates
  const sameSite = !!siteOf(a) && siteOf(a) === siteOf(b)
  const waived = linkException(l)
  const exempt = (rule) => !!waived && waived.exempts.includes(rule)
  if (r.same_site && !sameSite && !exempt('same_site')) return false
  if (r.needs_type && a.type !== r.needs_type && b.type !== r.needs_type && !exempt('needs_type')) return false
  return both
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
    // With no links at all the engine treats everything as reachable (parity
    // with the reference). A board that has more than one asset and no link is
    // not that case, so probe it with one self-loop: connectivity is unchanged,
    // but the engine now applies its reachability rule.
    const noLinks = !(g.links || []).length && (g.assets || []).length > 1
    const probe = noLinks ? { ...g, links: [{ id: '_probe', a: g.assets[0].id, b: g.assets[0].id }] } : g
    const base = runChain(probe, {}, { t: -1, method: 'weighted', causes: 'all' })
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

// The graph is written to localStorage and drawn by cytoscape on the next
// load, and cytoscape throws on an edge whose end does not exist - a file
// that gets past this check with a hole in it kills the app on every reload.
// So every edge kind is walked, not only the links.
const EDGE_KINDS = ['requires', 'provided_by', 'hosted_on', 'depends_on', 'redundant_with']
const pairKey = (e) => `${e.from}>${e.to}`

export function validateImport(sandbox, graph) {
  const errors = []
  const t = sandbox.graph
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.assets)) errors.push('assets 배열이 없다')
  const same = (k) => JSON.stringify((graph && graph[k] || []).map((x) => x.id)) === JSON.stringify((t[k] || []).map((x) => x.id))
  if (graph && Array.isArray(graph.assets)) {
    if (!same('missions')) errors.push('임무 목록이 템플릿과 다르다')
    if (!same('tasks')) errors.push('작업 목록이 템플릿과 다르다')
    if (!same('services')) errors.push('서비스 목록이 템플릿과 다르다')
    if (!Array.isArray(graph.links)) errors.push('links 배열이 없다')
    if (graph.edges != null && (typeof graph.edges !== 'object' || Array.isArray(graph.edges))) errors.push('edges 가 객체가 아니다')
    const E = graph.edges && typeof graph.edges === 'object' && !Array.isArray(graph.edges) ? graph.edges : {}
    const kinds = new Set([...EDGE_KINDS, ...Object.keys(E).filter((k) => !k.startsWith('_'))])
    for (const k of kinds) {
      const has = ((t.edges || {})[k] || []).length > 0
      if (E[k] === undefined) { if (has) errors.push(`edges.${k} 배열이 없다`); continue }
      if (!Array.isArray(E[k])) errors.push(`edges.${k} 가 배열이 아니다`)
    }
    const ids = new Set(graph.assets.map((a) => a.id))
    const seen = new Set()
    for (const a of graph.assets) { if (seen.has(a.id)) errors.push(`자산 id ${a.id} 가 중복된다`); seen.add(a.id) }
    if (Array.isArray(graph.links)) for (const l of graph.links) if (!ids.has(l.a) || !ids.has(l.b)) errors.push(`링크 ${l.id} 의 끝이 없는 자산을 가리킨다`)
    const nodes = new Set([...ids, ...(graph.services || []).map((s) => s.id), ...(graph.tasks || []).map((x) => x.id)])
    for (const k of kinds) {
      if (!Array.isArray(E[k])) continue
      E[k].forEach((e, i) => {
        const ends = e && typeof e === 'object' ? ('a' in e || 'b' in e ? [e.a, e.b] : [e.from, e.to]) : [undefined, undefined]
        if (!ends.every((x) => nodes.has(x))) errors.push(`edges.${k}[${i}] 의 끝이 없는 노드를 가리킨다`)
      })
    }
    if (Array.isArray(E.requires)) {
      const want = ((t.edges || {}).requires || []).map(pairKey).sort()
      const got = E.requires.map((e) => (e && typeof e === 'object' ? pairKey(e) : '')).sort()
      if (JSON.stringify(want) !== JSON.stringify(got)) errors.push('edges.requires 가 템플릿과 다르다')
    }
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
