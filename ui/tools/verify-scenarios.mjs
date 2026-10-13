// Scenario invariants: does a scenario agree with its own declarations, and is
// a seeded run independent of how it was batched?
//
// ASCII only in this file, so the output reads the same in any console.
//
// WHY THIS EXISTS
//
// We already had three kinds of check and none of them asked this question.
//
//   ui/tools/parity.mjs        does the JS engine agree with the PowerShell
//                              reference? (1622 values, tolerance 1e-9)
//   npm test (vitest)          do the functions behave as their unit tests say?
//   scripts/Test-Ontology.ps1  are the graph references well formed? (dangling
//                              ids, weight ranges, cycles, orphan services)
//
// What nobody checked: the scenario DECLARES things about itself in fields that
// no code reads, and those declarations can be false. `geo.frame.extent` says
// where the assets are allowed to be. `position_rule` says the track segments
// tile [0, horizon) with no gap and no overlap. `approximation_error_m` says how
// far the display projection can be off. A building polygon says an asset with
// that `building` sits inside it. All of that was prose until now, and prose
// does not fail a build.
//
// And our determinism check was only "the same seed twice gives the same
// answer", which is the weak form. The strong form is the one RedCarpet's
// scripts/verify.ts asserts: a seeded run must be independent of how the steps
// were batched. run(s, 1) deep-equals run(s, 7). That catches hidden state the
// same-seed-twice check cannot see, because both of its runs take the identical
// path through the code.
//
// WHY NODE AND NOT POWERSHELL
//
// The batching checks have to execute src/engine.js, src/game.js and
// src/attack.js. A PowerShell version would have to reimplement the attacker and
// the turn loop, which is a third implementation of rules that already exist
// twice - exactly the drift parity.mjs exists to police. scripts/Test-Scenario-
// Invariants.ps1 is a thin wrapper so Invoke-Gates.ps1 can list this like any
// other gate, in the same shape as Test-UiUnit.ps1.
//
// THIS DOES NOT COMPUTE MISSION NUMBERS OF ITS OWN
//
// Every value it compares against comes from src/engine.js or from the exported
// replay. The tool measures and asserts; it does not model (ADR-0003).
//
// Usage:
//   node tools/verify-scenarios.mjs
//   node tools/verify-scenarios.mjs --verbose
//
// Exit 1 if any invariant fails, so this is the thing to put in the gates.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChain, runStep, containmentCandidates } from '../src/engine.js'
import { startGame, defend, pass, attackerTurn, staffTable, defaultFoothold } from '../src/game.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const EPS = 1e-9
const VERBOSE = process.argv.includes('--verbose')

// ---------------------------------------------------------------- bookkeeping

const failures = []
const notes = []
let checked = 0
let muted = false     // true while the self test is deliberately breaking things

function fail(group, msg) { failures.push(`${group}: ${msg}`) }
function note(msg) { if (!muted) notes.push(msg) }
function ok(n = 1) { checked += n }
function say(msg) { if (VERBOSE && !muted) console.log('    ' + msg) }

const clone = (v) => JSON.parse(JSON.stringify(v))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const pct = (v) => (Number(v) * 100).toFixed(1)

// ------------------------------------------------------------------- geodesy
//
// Used only to MEASURE the error of the scenario's own declared display
// projection. Nothing downstream reads these; the engine never sees geo at all
// (ADR-0001/0002, and scripts/Test-GeoInvariance.ps1 proves it).
// Series for the length of one degree of latitude / longitude on WGS84.

const D = Math.PI / 180

function meridianDegM(phi) {
  const a = phi * D
  return 111132.95 - 559.85 * Math.cos(2 * a) + 1.175 * Math.cos(4 * a) - 0.0023 * Math.cos(6 * a)
}

function parallelDegM(phi) {
  const a = phi * D
  return 111412.88 * Math.cos(a) - 93.5 * Math.cos(3 * a) + 0.118 * Math.cos(5 * a)
}

// ------------------------------------------------------- A. self consistency

function inExtent(ext, q) {
  if (!ext || !q) return true
  const axis = (k) => {
    const r = ext[k]
    if (!Array.isArray(r)) return true
    const v = Number(q[k])
    return Number.isFinite(v) && v >= r[0] - EPS && v <= r[1] + EPS
  }
  return axis('x') && axis('y') && axis('z')
}

function checkFrame(g) {
  const G = 'frame'
  const f = g.geo && g.geo.frame
  if (!f) { fail(G, 'geo.frame missing'); return }
  if (f.canonical !== true) fail(G, 'geo.frame.canonical is not true - two coordinate representations drift')
  if (f.unit !== 'meter') fail(G, `geo.frame.unit is ${f.unit}, every coordinate in this file is read as metres`)
  ok(2)
  for (const a of g.assets || []) {
    const fr = a.geo && a.geo.frame
    if (fr && fr !== f.id) fail(G, `asset ${a.id} declares frame ${fr}, scenario frame is ${f.id}`)
    ok()
  }
}

function checkExtent(g) {
  const G = 'extent'
  const ext = g.geo && g.geo.frame && g.geo.frame.extent
  if (!ext) { fail(G, 'geo.frame.extent missing - nothing declares where assets may be'); return }
  for (const a of g.assets || []) {
    const geo = a.geo
    if (!geo) continue
    const pts = []
    if (geo.at) pts.push(['at', geo.at])
    for (const [i, s] of (geo.segments || []).entries()) {
      if (s.at) pts.push([`segments[${i}].at`, s.at])
      if (s.to_at) pts.push([`segments[${i}].to_at`, s.to_at])
    }
    for (const [where, q] of pts) {
      ok()
      if (!inExtent(ext, q)) {
        fail(G, `asset ${a.id} ${where} = (${q.x}, ${q.y}, ${q.z}) is outside the declared extent `
          + `x[${ext.x}] y[${ext.y}] z[${ext.z}]`)
      }
    }
  }
}

// The scenario's own position_rule says: segments do not overlap and they cover
// [0, timeline.horizon) with no gap. It also says a `move` interpolates at ->
// to_at, which only reads as a path if consecutive segments meet.
function checkSegments(g) {
  const G = 'segments'
  const horizon = g.timeline ? Number(g.timeline.horizon) : null
  for (const a of g.assets || []) {
    const geo = a.geo
    if (!geo) continue
    if (geo.kind === 'fixed') {
      ok()
      if (!geo.at) fail(G, `asset ${a.id} is kind=fixed with no geo.at`)
      if (geo.segments) fail(G, `asset ${a.id} is kind=fixed but carries segments`)
      continue
    }
    if (geo.kind !== 'track') { fail(G, `asset ${a.id} geo.kind = ${geo.kind}, expected fixed or track`); continue }
    const segs = [...(geo.segments || [])]
    if (!segs.length) { fail(G, `asset ${a.id} is kind=track with no segments`); continue }
    const sorted = [...segs].sort((p, q) => Number(p.from) - Number(q.from))
    if (!same(segs.map((s) => Number(s.from)), sorted.map((s) => Number(s.from)))) {
      fail(G, `asset ${a.id} segments are not in time order - position_rule reads them as a sequence`)
    }
    ok()
    let cursor = 0
    for (const [i, s] of sorted.entries()) {
      ok(2)
      if (Number(s.from) !== cursor) {
        const what = Number(s.from) > cursor ? 'gap' : 'overlap'
        fail(G, `asset ${a.id} segments[${i}] starts at ${s.from}, previous ended at ${cursor} (${what}) `
          + '- position_rule declares the segments tile [0, horizon) with neither')
      }
      if (!(Number(s.to) > Number(s.from))) fail(G, `asset ${a.id} segments[${i}] is empty or reversed: [${s.from}, ${s.to})`)
      cursor = Number(s.to)
      if (s.mode === 'move') {
        if (!s.to_at) fail(G, `asset ${a.id} segments[${i}] mode=move with no to_at - nothing to interpolate towards`)
      } else if (s.mode === 'hold') {
        if (s.to_at) fail(G, `asset ${a.id} segments[${i}] mode=hold carries to_at, which position_rule never reads`)
      } else {
        fail(G, `asset ${a.id} segments[${i}] mode = ${s.mode}, expected hold or move`)
      }
    }
    ok()
    if (horizon !== null && cursor !== horizon) {
      fail(G, `asset ${a.id} segments end at ${cursor}, timeline.horizon is ${horizon} `
        + '- position_rule declares full coverage of [0, horizon)')
    }
    for (let i = 1; i < sorted.length; i++) {
      ok()
      const prev = sorted[i - 1]
      const end = prev.mode === 'move' ? prev.to_at : prev.at
      const next = sorted[i].at
      if (!end || !next) continue
      if (Number(end.x) !== Number(next.x) || Number(end.y) !== Number(next.y) || Number(end.z) !== Number(next.z)) {
        fail(G, `asset ${a.id} jumps at t=${sorted[i].from}: segments[${i - 1}] ends at `
          + `(${end.x}, ${end.y}, ${end.z}) and segments[${i}] starts at (${next.x}, ${next.y}, ${next.z})`)
      }
    }
  }
}

function bboxOf(poly) {
  const xs = poly.map((p) => Number(p[0]))
  const ys = poly.map((p) => Number(p[1]))
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

// The facility block is this scenario's geometry declaration: a building says
// how tall it is and where its footprint is, and an asset says which building
// and which floor it is on. Three things follow and none of them was checked.
function checkFacility(g) {
  const G = 'facility'
  const fac = g.geo && g.geo.facility
  if (!fac) return
  const ext = g.geo.frame && g.geo.frame.extent
  const builds = fac.buildings || []
  const byId = {}
  for (const b of builds) {
    ok(2)
    if (byId[b.id]) fail(G, `duplicate building id ${b.id}`)
    byId[b.id] = b
    if (!Array.isArray(b.polygon) || b.polygon.length < 3) { fail(G, `building ${b.id} has no usable polygon`); continue }
    const bb = bboxOf(b.polygon)
    if (ext && !(inExtent(ext, { x: bb.x0, y: bb.y0, z: 0 }) && inExtent(ext, { x: bb.x1, y: bb.y1, z: 0 }))) {
      fail(G, `building ${b.id} footprint [${bb.x0}..${bb.x1}, ${bb.y0}..${bb.y1}] leaves the declared extent`)
    }
    const top = Number(b.floors) * Number(b.floor_height_m)
    if (ext && Array.isArray(ext.z) && top > ext.z[1] + EPS) {
      fail(G, `building ${b.id} is ${top} m tall (${b.floors} x ${b.floor_height_m}), extent.z tops out at ${ext.z[1]}`)
    }
  }
  // Two buildings cannot occupy the same ground.
  for (let i = 0; i < builds.length; i++) {
    for (let j = i + 1; j < builds.length; j++) {
      ok()
      const A = bboxOf(builds[i].polygon || [])
      const B = bboxOf(builds[j].polygon || [])
      if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) {
        fail(G, `buildings ${builds[i].id} and ${builds[j].id} overlap on the ground`)
      }
    }
  }
  for (const a of g.assets || []) {
    const geo = a.geo
    if (!geo || !geo.building) continue
    const b = byId[geo.building]
    ok(3)
    if (!b) { fail(G, `asset ${a.id} declares building ${geo.building}, which is not in facility.buildings`); continue }
    const bb = bboxOf(b.polygon || [])
    const q = geo.at || {}
    if (!(Number(q.x) >= bb.x0 - EPS && Number(q.x) <= bb.x1 + EPS
       && Number(q.y) >= bb.y0 - EPS && Number(q.y) <= bb.y1 + EPS)) {
      fail(G, `asset ${a.id} sits at (${q.x}, ${q.y}) but declares building ${b.id}, `
        + `whose footprint is [${bb.x0}..${bb.x1}, ${bb.y0}..${bb.y1}]`)
    }
    const floor = Number(geo.floor)
    if (!(floor >= 1 && floor <= Number(b.floors))) {
      fail(G, `asset ${a.id} is on floor ${geo.floor} of ${b.id}, which has ${b.floors} floors`)
    }
    // scenarios/defnet-01/PROVENANCE.md 4.1: z is derived from the floor, not
    // declared independently. The 1.0 m is floor to equipment.
    const expect = (floor - 1) * Number(b.floor_height_m) + 1.0
    if (Math.abs(Number(q.z) - expect) > 1e-6) {
      fail(G, `asset ${a.id} declares z = ${q.z}, but floor ${geo.floor} of ${b.id} `
        + `(floor_height_m ${b.floor_height_m}) gives ${expect} by the rule in PROVENANCE.md 4.1`)
    }
  }
}

// approximation_error_m is a declared BOUND, not a measurement to reproduce.
// Measure the real worst case of the scenario's own formula over its own extent
// and require it to fit inside what the file promises.
function checkGeoref(g) {
  const G = 'georef'
  const gr = g.geo && g.geo.georef
  if (!gr) return
  const ext = g.geo.frame.extent
  const bound = Number(gr.approximation_error_m)
  if (!Number.isFinite(bound)) { fail(G, 'georef has no approximation_error_m - the display mapping promises nothing'); return }
  if (gr.method !== 'equirectangular-local') {
    note(`georef.method is ${gr.method}; the measurement below assumes equirectangular-local`)
    return
  }
  const lat0 = Number(gr.anchor.lat)
  const stepX = Math.max(1, (ext.x[1] - ext.x[0]) / 240)
  const stepY = Math.max(1, (ext.y[1] - ext.y[0]) / 180)
  let worstE = 0
  let worstN = 0
  let worst = 0
  let at = null
  for (let y = ext.y[0]; y <= ext.y[1] + EPS; y += stepY) {
    const lat = lat0 + y / 111320
    const dn = Math.abs((lat - lat0) * meridianDegM(lat0 + (lat - lat0) / 2) - y)
    for (let x = ext.x[0]; x <= ext.x[1] + EPS; x += stepX) {
      const dlon = x / (111320 * Math.cos(lat0 * D))
      const de = Math.abs(dlon * parallelDegM(lat) - x)
      const c = Math.hypot(de, dn)
      if (de > worstE) worstE = de
      if (dn > worstN) worstN = dn
      if (c > worst) { worst = c; at = { x: Math.round(x), y: Math.round(y) } }
    }
  }
  ok()
  say(`georef measured worst error ${worst.toFixed(1)} m (east ${worstE.toFixed(1)}, north `
    + `${worstN.toFixed(1)}) at (${at.x}, ${at.y}); declared bound ${bound} m`)
  if (worst > bound + EPS) {
    fail(G, `declared approximation_error_m = ${bound} but the formula is off by `
      + `${worst.toFixed(1)} m at (${at.x}, ${at.y}) - the file promises more than it delivers`)
  }
}

// A redundancy_group on a service and a redundant_with pair are two statements
// about the same fact. Test-Ontology checks neither against the other, and the
// engine multiplies providers only when the service carries the group - so a
// pair whose group does not exist is silently inert.
function checkRedundancyGroups(g) {
  const G = 'redundancy'
  const E = g.edges || {}
  const groups = new Set((g.services || []).map((s) => s.redundancy_group).filter(Boolean))
  const providers = {}
  for (const e of E.provided_by || []) {
    if (!providers[e.from]) providers[e.from] = new Set()
    providers[e.from].add(e.to)
  }
  for (const pair of E.redundant_with || []) {
    ok(3)
    if (!pair.group) { fail(G, `redundant_with ${pair.a}/${pair.b} has no group`); continue }
    if (!groups.has(pair.group)) {
      fail(G, `redundant_with ${pair.a}/${pair.b} names group "${pair.group}", `
        + 'which no service declares as redundancy_group - the engine would not multiply its providers')
    }
    const svc = (g.services || []).filter((s) => s.redundancy_group === pair.group).map((s) => s.id)
    for (const id of [pair.a, pair.b]) {
      const provides = svc.some((sid) => providers[sid] && providers[sid].has(id))
      if (svc.length && !provides) {
        fail(G, `redundant_with pair member ${id} (group ${pair.group}) does not provide `
          + `${svc.join('/')} - the pair says they stand in for each other but provided_by does not`)
      }
    }
  }
  // A group declared on a service with fewer than two providers is not redundancy.
  for (const s of g.services || []) {
    if (!s.redundancy_group) continue
    ok()
    const n = providers[s.id] ? providers[s.id].size : 0
    if (n < 2) {
      fail(G, `service ${s.id} declares redundancy_group "${s.redundancy_group}" but has ${n} provider(s) `
        + '- the engine would multiply a single term and call it redundant')
    }
  }
}

function checkCrownJewels(g) {
  const G = 'crown jewels'
  const seen = new Set()
  const assets = new Set((g.assets || []).map((a) => a.id))
  for (const id of g.crown_jewels || []) {
    ok(2)
    if (seen.has(id)) fail(G, `crown_jewels lists ${id} twice`)
    seen.add(id)
    if (!assets.has(id)) fail(G, `crown_jewels names ${id}, which is not in assets[]`)
  }
}

// Referential integrity. scripts/Test-Ontology.ps1 checks the same facts from
// the PowerShell side and goes further (cycles, orphan services, weight ranges),
// so this is deliberate overlap rather than the only cover: that script is
// pointed at a fixed pair of scenarios, while this tool walks scenarios/ and so
// picks up anything added later. Two cheap checks of the same fact beat one
// check nobody remembered to point at the new file.
function checkReferences(g) {
  const G = 'references'
  const assets = new Set((g.assets || []).map((a) => a.id))
  const services = new Set((g.services || []).map((s) => s.id))
  const tasks = new Set((g.tasks || []).map((t) => t.id))
  const E = g.edges || {}

  for (const t of g.tasks || []) {
    ok()
    if (!t.performed_at) { fail(G, `task ${t.id} has no performed_at - reachability has no starting point`); continue }
    if (!assets.has(t.performed_at)) fail(G, `task ${t.id}.performed_at names ${t.performed_at}, which is not an asset`)
  }
  for (const e of E.requires || []) {
    ok(2)
    if (!tasks.has(e.from)) fail(G, `requires.from names ${e.from}, which is not a task`)
    if (!services.has(e.to)) fail(G, `requires.to names ${e.to}, which is not a defined service`)
  }
  for (const e of E.provided_by || []) {
    ok(2)
    if (!services.has(e.from)) fail(G, `provided_by.from names ${e.from}, which is not a service`)
    if (!assets.has(e.to)) fail(G, `provided_by.to names ${e.to}, which is not an asset`)
  }
  for (const e of E.hosted_on || []) {
    ok(2)
    if (!assets.has(e.from)) fail(G, `hosted_on.from names ${e.from}, which is not an asset`)
    if (!assets.has(e.to)) fail(G, `hosted_on.to names ${e.to}, which is not an asset`)
  }
  for (const e of E.depends_on || []) {
    ok(2)
    if (!assets.has(e.from)) fail(G, `depends_on.from names ${e.from}, which is not an asset`)
    if (!assets.has(e.to) && !services.has(e.to)) fail(G, `depends_on.to names ${e.to}, which is neither an asset nor a service`)
  }
  const linkIds = new Set()
  for (const l of g.links || []) {
    ok(4)
    if (!l.id) { fail(G, 'a link has no id'); continue }
    if (linkIds.has(l.id)) fail(G, `duplicate link id ${l.id}`)
    linkIds.add(l.id)
    if (!assets.has(l.a)) fail(G, `link ${l.id}.a names ${l.a}, which is not an asset`)
    if (!assets.has(l.b)) fail(G, `link ${l.id}.b names ${l.b}, which is not an asset`)
    if (l.a === l.b) fail(G, `link ${l.id} joins ${l.a} to itself`)
  }
}

// ------------------------------------------------- B. the declared story holds

function checkReplayValues(id, payload) {
  const G = `replay(${id})`
  const g = payload.graph
  const requires = (g.edges && g.edges.requires) || []
  const taskById = Object.fromEntries((g.tasks || []).map((t) => [t.id, t]))
  for (const s of payload.steps) {
    for (const key of ['mission', 'task', 'service', 'asset']) {
      for (const [k, v] of Object.entries(s[key] || {})) {
        ok()
        const n = Number(v)
        if (!Number.isFinite(n) || n < -EPS || n > 1 + EPS) {
          fail(G, `t=${s.t} ${key}.${k} = ${v}, outside [0, 1]`)
        }
      }
    }
    // A task is no better than the machine performing it (ADR-0017 section 6).
    for (const [tid, v] of Object.entries(s.task || {})) {
      const at = taskById[tid] && taskById[tid].performed_at
      if (!at || s.asset == null || s.asset[at] === undefined) continue
      ok()
      if (Number(v) < Number(s.asset[at]) - 1e-9) {
        fail(G, `t=${s.t} task ${tid} = ${v} is below its own terminal ${at} = ${s.asset[at]}`)
      }
    }
    // A hard requirement admits no substitute (ADR-0020). The exported service
    // value is the consumer-agnostic one, which is a lower bound on what the
    // consumer sees, so the task can never come in under it.
    for (const r of requires) {
      if (!r.hard) continue
      if (s.task == null || s.service == null) continue
      if (s.task[r.from] === undefined || s.service[r.to] === undefined) continue
      ok()
      if (Number(s.task[r.from]) < Number(s.service[r.to]) - 1e-9) {
        fail(G, `t=${s.t} task ${r.from} = ${s.task[r.from]} is below its hard requirement `
          + `${r.to} = ${s.service[r.to]}`)
      }
    }
    // No compromise means nothing is the enemy's doing (ADR-0012 section 2).
    if (s.mission_attack) {
      const anyCompromise = Object.values(s.compromise || {}).some((v) => Number(v) > 0)
      for (const [m, v] of Object.entries(s.mission_attack)) {
        ok()
        if (!anyCompromise && Math.abs(Number(v)) > EPS) {
          fail(G, `t=${s.t} mission_attack.${m} = ${v} with an empty compromise state `
            + '- environment degradation is being attributed to the enemy')
        }
      }
    }
  }
}

// Per scenario, the one or two sentences the scenario itself claims. Each entry
// names where in the data the claim is written down.
const STORIES = {
  'tacnet-01': (payload) => {
    const out = []
    const g = payload.graph
    const bn = (g.assets || []).find((a) => a.id === 'BN-SRV')
    const move = ((bn && bn.outages) || []).find((o) => o.cause === 'mobility')
    const sat = (g.links || []).find((l) => l.id === 'L-SAT-TOC')
    const satOut = ((sat && sat.outages) || [])[0]
    if (!move) { out.push(['missing', 'BN-SRV has no mobility outage - notes[1] describes one']); return out }
    if (!satOut) { out.push(['missing', 'L-SAT-TOC has no outage - notes[0] describes one']); return out }

    // notes[1]: the 95-125 cut is mobility, not the enemy.
    let seen = 0
    for (const s of payload.steps) {
      const t = Number(s.t)
      if (!(t >= Number(move.from) && t < Number(move.to))) continue
      seen++
      if (Math.abs(Number(s.mission_attack['M-C2'])) > EPS) {
        out.push(['notes[1]', `t=${t} mission_attack.M-C2 = ${s.mission_attack['M-C2']} inside the `
          + 'command post displacement window; that cut has cause=mobility'])
      }
      if (!(Number(s.mission_env['M-C2']) > 0)) {
        out.push(['notes[1]', `t=${t} mission_env.M-C2 = ${s.mission_env['M-C2']} inside the displacement `
          + 'window; the whole battalion is down, the environment should show it'])
      }
    }
    if (!seen) out.push(['notes[1]', `no exported step falls inside [${move.from}, ${move.to})`])

    // notes[0]: redundancy you cannot reach is not redundancy. Globally S-C2MSG
    // is fine (TOC-SRV is up); from the battalion terminal it is gone.
    let seen2 = 0
    for (const s of payload.steps) {
      const t = Number(s.t)
      if (!(t >= Number(satOut.from) && t < Number(satOut.to))) continue
      seen2++
      if (Math.abs(Number(s.service['S-C2MSG'])) > EPS) {
        out.push(['notes[0]', `t=${t} service.S-C2MSG = ${s.service['S-C2MSG']}; the claim is that the `
          + 'service looks intact globally'])
      }
      if (Math.abs(Number(s.task['T-CTRL']) - 1) > EPS) {
        out.push(['notes[0]', `t=${t} task.T-CTRL = ${s.task['T-CTRL']}, expected 1 - the battalion `
          + 'terminal cannot reach TOC-SRV while the satcom link is cut'])
      }
    }
    if (!seen2) out.push(['notes[0]', `no exported step falls inside [${satOut.from}, ${satOut.to})`])
    return out
  },

  // scenarios/defnet-01/PROVENANCE.md 6. The two figures mission.json notes[6]
  // still quotes (80.5 and 70.1) predate ADR-0020 and are recorded there as
  // stale; these are what the engine gives now.
  'defnet-01': (payload) => {
    const out = []
    const g = payload.graph
    const cases = [
      ['DC01 alone', { DC01: 1 }, { 'M-C2': '0.0', 'M-LOG': '0.0' }],
      ['DC01 + DC02', { DC01: 1, DC02: 1 }, { 'M-C2': '84.4', 'M-LOG': '50.2' }],
      ['ESX01 isolated', { ESX01: 1 }, { 'M-C2': '100.0', 'M-LOG': '21.8' }],
    ]
    for (const [name, compromise, want] of cases) {
      const r = runChain(g, compromise, { method: payload.method || 'weighted' })
      for (const [m, w] of Object.entries(want)) {
        const got = pct(r.mission[m])
        if (got !== w) out.push(['PROVENANCE.md 6', `${name}: ${m} = ${got}%, PROVENANCE.md declares ${w}%`])
      }
    }
    return out
  },
}

function checkStory(id, payload) {
  const story = STORIES[id]
  if (!story) {
    note(`${id} has no story block in verify-scenarios.mjs STORIES - only the generic replay `
      + 'invariants cover it')
    return
  }
  for (const [where, msg] of story(payload)) {
    fail(`story(${id})`, `${where} - ${msg}`)
  }
  ok()
}

// ------------------------------------------------- C. batching independence

// Recompute every exported step through the engine. `order` lets the caller ask
// for a different traversal; the answer must not depend on it.
function replayPass(g, payload, order) {
  const out = {}
  for (const i of order) {
    const base = payload.steps[i]
    const t = base.t === null || base.t === undefined ? -1 : Number(base.t)
    const compromise = base.compromise || {}
    out[i] = runStep(g, compromise, {
      t,
      method: payload.method || 'weighted',
      candidates: containmentCandidates(g, compromise),
    })
  }
  return out
}

function checkReplayBatching(id, payload) {
  const G = `replay batching(${id})`
  const n = payload.steps.length
  const forward = [...Array(n).keys()]
  const pristine = clone(payload.graph)

  const live = clone(pristine)
  const one = replayPass(live, payload, forward)
  ok()
  if (!same(live, pristine)) {
    fail(G, 'the engine mutated the graph it was handed - every later result depends on call order')
  }

  // Chunked, with the graph reparsed between chunks: a cache keyed on object
  // identity would survive a chunk, not a reparse.
  const chunked = (size) => {
    const acc = {}
    for (let i = 0; i < n; i += size) {
      Object.assign(acc, replayPass(clone(pristine), payload, forward.slice(i, i + size)))
    }
    return acc
  }
  for (const [a, b] of [[1, 7], [4, 20]]) {
    ok()
    if (!same(chunked(a), chunked(b))) fail(G, `stepping ${a} at a time differs from stepping ${b} at a time`)
  }
  ok()
  if (!same(one, chunked(1))) fail(G, 'one pass over all steps differs from stepping one at a time')
  ok()
  if (!same(one, replayPass(clone(pristine), payload, [...forward].reverse()))) {
    fail(G, 'computing the steps back to front gives different values - something is carried between steps')
  }
  say(`${n} steps, chunk sizes 1/4/7/20 and reverse order all agree`)
}

// A defender that is a pure function of the game state, so a resumed game makes
// the same choice a continuous one would. Isolating the top-ranked row is also
// the move the staff panel recommends, which keeps the run realistic.
function policy(g, G) {
  if (G.turn % 3 === 2) {
    const rows = staffTable(g, G)
    if (rows.length) return { type: 'isolate', id: rows[0].id }
  }
  return null
}

// Play `turns` turns, pausing every `chunk` turns and putting the game state
// through JSON on the way. That is what a resumed session actually does, and it
// is why this is stronger than running the same seed twice: both of those runs
// take the identical path, this one does not.
function playBatched(g, cfg, turns, chunk) {
  let G = startGame(g, cfg)
  let since = 0
  while (G.turn < turns && !G.result) {
    const act = policy(g, G)
    G = act ? defend(g, G, act) : pass(G)
    G = attackerTurn(g, G)
    if (++since >= chunk) { G = clone(G); since = 0 }
  }
  return G
}

function firstDivergence(a, b) {
  const n = Math.max(a.history.length, b.history.length)
  for (let i = 0; i < n; i++) {
    if (!same(a.history[i], b.history[i])) return i
  }
  return null
}

function checkWargameBatching(id, payload) {
  const G = `wargame batching(${id})`
  const g = payload.graph
  const seed = defaultFoothold(payload)
  if (!seed) { note(`${id} replay has no attack input, so no wargame foothold - batching unchecked`); return }
  // The attacker needs a usable foothold (attack.js FOOTHOLD = 0.5); defnet-01's
  // chain starts at 0.3, which would end the game before turn one.
  const foothold = { id: seed.id, level: Math.max(0.5, Number(seed.level) || 0.5) }
  const t = g.timeline ? 300 : -1
  const turns = 12

  const cfgs = [
    { name: 'greedy/hold', cfg: { mode: 'hold', turns, t, seed: 20260906, strategy: 'greedy', foothold } },
    { name: 'random/hold', cfg: { mode: 'hold', turns, t, seed: 20260906, strategy: 'random', foothold } },
    { name: 'greedy/jewel', cfg: { mode: 'jewel', turns, t, seed: 777, strategy: 'greedy', foothold } },
    { name: 'random/jewel', cfg: { mode: 'jewel', turns, t, seed: 777, strategy: 'random', foothold } },
  ]

  for (const { name, cfg } of cfgs) {
    const runs = { 1: playBatched(g, cfg, turns, 1), 4: playBatched(g, cfg, turns, 4), 7: playBatched(g, cfg, turns, 7), 20: playBatched(g, cfg, turns, 20) }
    for (const [a, b] of [[1, 7], [4, 20], [1, 20]]) {
      ok()
      if (!same(runs[a], runs[b])) {
        const at = firstDivergence(runs[a], runs[b])
        fail(G, `${name}: ${a} turn(s) per batch differs from ${b}`
          + (at === null ? ' (histories agree, the trailing state does not)' : ` - first at history[${at}]`))
      }
    }
    // A game that never moved would make the comparison above vacuous.
    ok()
    const played = runs[1].history.filter((h) => h.attacker).length
    if (!played) fail(G, `${name}: the attacker never took a move, so the comparison proves nothing`)
    say(`${name}: ${runs[1].turn} turns, ${played} attacker move(s), isolated `
      + `${runs[1].isolated.length}, result ${runs[1].result ? runs[1].result.reason : 'open'}`)
  }
}

function checkJsonRoundTrip(label, value) {
  ok()
  const once = JSON.stringify(value)
  if (JSON.stringify(JSON.parse(once)) !== once) {
    fail('json round trip', `${label} does not survive JSON.parse(JSON.stringify(x)) unchanged`)
  }
}

// ------------------------------------------- D. the checks are not vacuous
//
// Every structural check above passes today, which is exactly when a check is
// easiest to get wrong: a check that can never fail reads the same as one that
// passes. So break the data on purpose, one way at a time, and require the
// matching check to notice. RedCarpet's verify.ts asserts that invalid values
// fail before import; this asserts that invalid values fail here.

const MUTATIONS = [
  ['coordinate pushed outside the declared extent', 'extent', (g) => {
    const a = (g.assets || []).find((x) => x.geo && x.geo.at)
    a.geo.at.x = Number(g.geo.frame.extent.x[1]) + 1
  }],
  ['a gap opened between two track segments', 'segments', (g) => {
    const a = (g.assets || []).find((x) => x.geo && (x.geo.segments || []).length > 1)
    a.geo.segments[0].to = Number(a.geo.segments[0].to) - 5
  }],
  ['a move segment left dangling from the next one', 'segments', (g) => {
    const a = (g.assets || []).find((x) => (((x.geo || {}).segments) || []).some((s) => s.mode === 'move'))
    const s = a.geo.segments.find((q) => q.mode === 'move')
    s.to_at.x = Number(s.to_at.x) + 50
  }],
  ['frame id changed on one asset only', 'frame', (g) => {
    const a = (g.assets || []).find((x) => x.geo && x.geo.frame)
    a.geo.frame = 'OTHER-GRID'
  }],
  ['approximation_error_m tightened below the real error', 'georef', (g) => {
    if (!(g.geo || {}).georef) return false
    g.geo.georef.approximation_error_m = 1
  }],
  ['an asset moved out of its declared building', 'facility', (g) => {
    if (!((g.geo || {}).facility)) return false
    const a = (g.assets || []).find((x) => x.geo && x.geo.building)
    a.geo.at.x = Number(a.geo.at.x) + 1000
  }],
  ['z no longer matches the floor it declares', 'facility', (g) => {
    if (!((g.geo || {}).facility)) return false
    const a = (g.assets || []).find((x) => x.geo && x.geo.building)
    a.geo.at.z = Number(a.geo.at.z) + 1
  }],
  ['two buildings pushed on top of each other', 'facility', (g) => {
    const bs = ((g.geo || {}).facility || {}).buildings
    if (!bs || bs.length < 2) return false
    bs[1].polygon = bs[0].polygon.map((p) => [p[0], p[1]])
  }],
  ['a redundant_with pair renamed to a group no service declares', 'redundancy', (g) => {
    const pairs = ((g.edges || {}).redundant_with) || []
    if (!pairs.length) return false
    pairs[0].group = 'nosuchgroup'
  }],
  ['crown_jewels given a duplicate', 'crown jewels', (g) => {
    if (!(g.crown_jewels || []).length) return false
    g.crown_jewels.push(g.crown_jewels[0])
  }],
  ['a crown jewel that is not an asset', 'crown jewels', (g) => {
    (g.crown_jewels || []).push('NO-SUCH-ASSET')
  }],
  ['performed_at pointed at a missing asset', 'references', (g) => {
    const t = (g.tasks || [])[0]
    if (!t) return false
    t.performed_at = 'NO-SUCH-ASSET'
  }],
  ['a provided_by endpoint removed from assets', 'references', (g) => {
    const e = ((g.edges || {}).provided_by || [])[0]
    if (!e) return false
    e.to = 'NO-SUCH-ASSET'
  }],
  ['a requires pointed at an undefined service', 'references', (g) => {
    const e = ((g.edges || {}).requires || [])[0]
    if (!e) return false
    e.to = 'NO-SUCH-SERVICE'
  }],
  ['one end of a link removed from assets', 'references', (g) => {
    const l = (g.links || [])[0]
    if (!l) return false
    l.b = 'NO-SUCH-ASSET'
  }],
]

const STRUCTURAL = [checkFrame, checkExtent, checkSegments, checkFacility, checkGeoref, checkRedundancyGroups, checkCrownJewels, checkReferences]

function runStructural(g) {
  const keep = failures.splice(0, failures.length)
  const keepChecked = checked
  muted = true
  try {
    for (const fn of STRUCTURAL) fn(g)
  } finally {
    muted = false
  }
  const got = failures.splice(0, failures.length)
  failures.push(...keep)
  checked = keepChecked
  return got
}

function selfTest(scenarios) {
  const G = 'self test'
  let ran = 0
  for (const [what, group, mutate] of MUTATIONS) {
    let caught = false
    let applicable = false
    for (const { id, graph } of scenarios) {
      const g = clone(graph)
      let r
      try { r = mutate(g) } catch { r = false }
      if (r === false) continue
      applicable = true
      const found = runStructural(g).filter((m) => m.startsWith(group + ':'))
      if (found.length) { caught = true; say(`self test caught "${what}" on ${id}`); break }
    }
    ran++
    ok()
    if (!applicable) { note(`self test "${what}" applies to no shipped scenario`); continue }
    if (!caught) fail(G, `broke the data ("${what}") and the ${group} check did not notice - it is vacuous`)
  }
  say(`${ran} mutations attempted`)
}

// -------------------------------------------------------------------- driver

const scenarioDir = join(root, 'scenarios')
const dataDir = join(root, 'ui', 'public', 'data')

const scenarios = []
for (const name of readdirSync(scenarioDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const file = join(scenarioDir, name, 'mission.json')
  if (!existsSync(file)) continue
  const graph = JSON.parse(readFileSync(file, 'utf8'))
  const replayFile = join(dataDir, `${graph.scenario_id}.replay.json`)
  const payload = existsSync(replayFile) ? JSON.parse(readFileSync(replayFile, 'utf8')) : null
  scenarios.push({ id: graph.scenario_id, dir: name, graph, payload, replayFile })
}

if (!scenarios.length) {
  console.log('no scenarios found under scenarios/ - nothing to verify')
  process.exit(1)
}

console.log('')
console.log('scenario invariants')
console.log('==========================================================================')

for (const s of scenarios) {
  console.log(`\n${s.id}  (scenarios/${s.dir}/mission.json)`)
  checkJsonRoundTrip(`${s.id} mission.json`, s.graph)
  for (const fn of STRUCTURAL) fn(s.graph)
  if (!s.payload) {
    note(`${s.id} has no exported replay at ${s.replayFile} - story and batching checks skipped`)
    continue
  }
  checkJsonRoundTrip(`${s.id} replay payload`, s.payload)
  checkReplayValues(s.id, s.payload)
  checkStory(s.id, s.payload)
  checkReplayBatching(s.id, s.payload)
  checkWargameBatching(s.id, s.payload)
}

console.log('\nself test (break the data, require the check to notice)')
selfTest(scenarios)

console.log('')
console.log('==========================================================================')
for (const n of notes) console.log(`  NOTE  ${n}`)
for (const f of failures) console.log(`  FAIL  ${f}`)
console.log(`  ${checked} assertion(s), ${failures.length} failure(s), ${notes.length} note(s)`)
console.log('')
if (failures.length) {
  console.log('RESULT: FAIL')
  process.exit(1)
}
console.log('RESULT: PASS')
