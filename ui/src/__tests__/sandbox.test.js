import { describe, it, expect, beforeEach } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import rules from '../../public/data/link-rules.json'
import {
  makeSandbox, linkCandidates, missionCandidates, readiness, placeFree, placeNear,
  validateImport, listPlans, savePlan, loadPlan, deletePlan, SANDBOX_ID, siteOf,
} from '../sandbox.js'

const tg = replay.graph

describe('makeSandbox', () => {
  const sb = makeSandbox(replay)
  it('keeps the mission layer and drops the assets', () => {
    expect(sb.scenario_id).toBe(SANDBOX_ID)
    expect(sb.graph.missions.map((m) => m.id)).toEqual(tg.missions.map((m) => m.id))
    expect(sb.graph.tasks.length).toBe(tg.tasks.length)
    expect(sb.graph.tasks.every((t) => t.performed_at === null)).toBe(true)
    expect(sb.graph.services.length).toBe(tg.services.length)
    expect(sb.graph.edges.requires.length).toBe(tg.edges.requires.length)
    expect(sb.graph.assets).toEqual([])
    expect(sb.graph.links).toEqual([])
    expect(sb.graph.edges.provided_by).toEqual([])
    expect(sb.graph.crown_jewels).toEqual([])
    expect(sb.graph.timeline).toBeUndefined()
    expect(sb.graph.phases.every((p) => !p.window)).toBe(true)
    expect(sb.graph.geo.georef.anchor.lat).toBe(38.02)
    expect(sb.graph.geo.terrain).toBeUndefined()
    expect(sb.steps).toEqual([])
  })
  it('does not share objects with the template', () => {
    sb.graph.tasks[0].performed_at = 'X'
    expect(tg.tasks[0].performed_at).not.toBe('X')
  })
})

function g3() {
  // a small sandbox graph: a C2 server at the TOC, a relay in the hills, a
  // company terminal in the field
  const g = makeSandbox(replay).graph
  g.assets = [
    { id: 'SRV-01', type: 'c2-server', unit: 'U-BDE', site: '여단 TOC', transit: true, geo: { kind: 'fixed', at: { x: 4000, y: 2000, z: 0 } } },
    { id: 'WKS-01', type: 'workstation', unit: 'U-BDE', site: '여단 TOC', transit: false, geo: { kind: 'fixed', at: { x: 4030, y: 2010, z: 0 } } },
    { id: 'RELAY-01', type: 'radio-relay', unit: 'U-1BN', site: '능선', transit: true, geo: { kind: 'fixed', at: { x: 5700, y: 9600, z: 0 } } },
    { id: 'CP-01', type: 'c2-terminal', unit: 'U-1BN', site: '1중대', transit: false, geo: { kind: 'fixed', at: { x: 9000, y: 9000, z: 0 } } },
    { id: 'SAT-01', type: 'satcom-terminal', unit: 'U-1BN', site: '1중대', transit: true, geo: { kind: 'fixed', at: { x: 9040, y: 9020, z: 0 } } },
  ]
  g.links = [{ id: 'L-1', a: 'SRV-01', b: 'WKS-01', bearer: 'wired' }]
  return g
}

describe('linkCandidates', () => {
  it('wired only within a site, satcom only with a satcom terminal, ranked site > unit > transit', () => {
    const g = g3()
    const c = linkCandidates(g, rules, 'CP-01')
    const ids = c.map((x) => `${x.id}:${x.bearer}`)
    expect(ids).toContain('SAT-01:wired')        // same site
    expect(ids).toContain('RELAY-01:vhf')        // shared bearer
    expect(ids).not.toContain('SRV-01:wired')    // different site
    expect(ids).not.toContain('SRV-01:satcom')   // c2-terminal has no satcom
    expect(c[0].id).toBe('SAT-01')               // same site first
    expect(c[0].why).toBe('site')
    expect(c.every((x, i) => x.rank === i + 1)).toBe(true)
  })
  it('offers satcom between a satcom terminal and a c2 server, and skips existing links', () => {
    const g = g3()
    const c = linkCandidates(g, rules, 'SAT-01').map((x) => `${x.id}:${x.bearer}`)
    expect(c).toContain('SRV-01:satcom')
    const c2 = linkCandidates(g, rules, 'SRV-01').map((x) => `${x.id}:${x.bearer}`)
    expect(c2).not.toContain('WKS-01:wired')      // already linked
  })
  it('returns [] for an unknown asset or a type not in the rules', () => {
    const g = g3()
    expect(linkCandidates(g, rules, 'NOPE')).toEqual([])
    g.assets.push({ id: 'X', type: 'toaster', site: '여단 TOC' })
    expect(linkCandidates(g, rules, 'X')).toEqual([])
  })
  it('a placeholder or missing site is not a site: no wired candidates, no site rank', () => {
    const g = g3()
    g.assets.push({ id: 'N1', type: 'workstation', unit: 'U-BDE', site: '신규', transit: false })
    g.assets.push({ id: 'N2', type: 'c2-server', unit: 'U-BDE', site: '신규', transit: true })
    g.assets.push({ id: 'N3', type: 'c2-server', unit: 'U-BDE', transit: true })
    const c = linkCandidates(g, rules, 'N1')
    expect(c.some((x) => x.bearer === 'wired')).toBe(false)
    expect(c.some((x) => x.why === 'site')).toBe(false)
  })

  it('siteOf reads the placeholder and a missing site as no site', () => {
    expect(siteOf({ site: '신규' })).toBeNull()
    expect(siteOf({})).toBeNull()
    expect(siteOf(undefined)).toBeNull()
    expect(siteOf({ site: '여단 TOC' })).toBe('여단 TOC')
  })
})

describe('missionCandidates', () => {
  it('maps provides -> services by kind and performs -> task ids present in the graph', () => {
    const g = g3()
    expect(missionCandidates(g, rules, 'SRV-01')).toEqual({ services: ['S-C2MSG', 'S-INTEL'], tasks: ['T-ORDER', 'T-SITREP'] })
    expect(missionCandidates(g, rules, 'RELAY-01')).toEqual({ services: ['S-VOICE'], tasks: [] })
  })
})

describe('readiness', () => {
  it('counts providers, performers, isolated assets and jewels', () => {
    const g = g3()
    let r = readiness(g)
    expect(r.services).toMatchObject({ ok: 0, total: 5 })
    expect(r.tasks).toMatchObject({ ok: 0, total: 8 })
    expect(r.isolated.sort()).toEqual(['CP-01', 'RELAY-01', 'SAT-01'])
    expect(r.ready).toBe(false)
    g.edges.provided_by = ['S-C2MSG', 'S-BFT', 'S-VOICE', 'S-FIRE', 'S-INTEL'].map((s) => ({ from: s, to: 'SRV-01', w: 1 }))
    g.tasks = g.tasks.map((t) => ({ ...t, performed_at: 'WKS-01' }))
    g.crown_jewels = ['SRV-01']
    r = readiness(g)
    expect(r.services.ok).toBe(5)
    expect(r.tasks.ok).toBe(8)
    expect(r.jewels).toBe(1)
    expect(r.ready).toBe(true)
  })
  it('a performed_at pointing at a missing asset does not count', () => {
    const g = g3()
    g.tasks[0].performed_at = 'GHOST'
    expect(readiness(g).tasks.ok).toBe(0)
    expect(readiness(g).tasks.missing).toContain(g.tasks[0].id)
  })
})

describe('placement', () => {
  it('placeNear puts the asset on a 150 m ring around the anchor without overlapping, deterministically', () => {
    const g = g3()
    const p1 = placeNear(g, 'RELAY-01')
    expect(Math.hypot(p1.x - 5700, p1.y - 9600)).toBeCloseTo(150, 0)
    g.assets.push({ id: 'N1', type: 'c2-terminal', geo: { kind: 'fixed', at: p1 } })
    const p2 = placeNear(g, 'RELAY-01')
    expect(Math.hypot(p2.x - p1.x, p2.y - p1.y)).toBeGreaterThan(60)
    expect(placeNear(g3(), 'RELAY-01')).toEqual(p1)
  })
  it('placeFree returns the centre of an empty 2 km cell inside the AO', () => {
    const g = g3()
    const p = placeFree(g)
    expect(p.x % 2000).toBe(1000)
    expect(p.y % 2000).toBe(1000)
    expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(24000)
    expect(g.assets.some((a) => Math.hypot(a.geo.at.x - p.x, a.geo.at.y - p.y) < 1000)).toBe(false)
  })
})

describe('validateImport', () => {
  it('accepts a graph with the template mission layer and rejects a different one', () => {
    const sb = makeSandbox(replay)
    expect(validateImport(sb, g3())).toEqual({ ok: true, errors: [] })
    const bad = g3(); bad.services = bad.services.slice(1)
    const r = validateImport(sb, bad)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
    expect(validateImport(sb, { assets: 'x' }).ok).toBe(false)
  })
})

describe('plans (localStorage)', () => {
  beforeEach(() => { globalThis.localStorage = (() => { let m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: (k) => { delete m[k] } } })() })
  it('saves, lists, loads and deletes by name', () => {
    const g = g3()
    expect(listPlans()).toEqual([])
    savePlan('구성 A', g)
    savePlan('구성 B', g)
    expect(listPlans().map((p) => p.name)).toEqual(['구성 A', '구성 B'])
    expect(loadPlan('구성 A').assets.length).toBe(5)
    savePlan('구성 A', { ...g, assets: [] })            // overwrite by name
    expect(loadPlan('구성 A').assets.length).toBe(0)
    deletePlan('구성 B')
    expect(listPlans().map((p) => p.name)).toEqual(['구성 A'])
    expect(loadPlan('없음')).toBe(null)
  })
})
