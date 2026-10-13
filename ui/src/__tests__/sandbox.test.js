import { describe, it, expect, beforeEach } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import rules from '../../public/data/link-rules.json'
import {
  makeSandbox, linkCandidates, missionCandidates, readiness, placeFree, placeNear,
  validateImport, listPlans, savePlan, loadPlan, deletePlan, SANDBOX_ID, siteOf, ruleGap,
  linkFitsRules, linkException,
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
    expect(tg.geo.dem_source).toBeDefined()               // the template has it
    expect(sb.graph.geo.dem_source).toBeUndefined()       // the sandbox drops it
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
  it('ruleGap tells a missing table from a type the table does not list', () => {
    expect(ruleGap(rules, 'c2-server')).toBeNull()
    expect(ruleGap(rules, 'toaster')).toBe('규칙표에 없는 유형')
    expect(ruleGap(null, 'c2-server')).toBe('규칙표 없음')
    expect(ruleGap({}, 'c2-server')).toBe('규칙표 없음')
    expect(ruleGap({ types: {} }, 'c2-server')).toBe('규칙표 없음')
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
  it('a task whose performer cannot reach the provider over the links is not ready', () => {
    // every service on SRV-01; seven tasks at WKS-01 (wired to SRV-01 by
    // g3's L-1), one task at CP-01, which has no link at all. Note the engine
    // treats a graph with zero links as fully reachable, so the case needs
    // at least one link somewhere - g3 already has one.
    const g = g3()
    g.edges.provided_by = ['S-C2MSG', 'S-BFT', 'S-VOICE', 'S-FIRE', 'S-INTEL'].map((s) => ({ from: s, to: 'SRV-01', w: 1 }))
    g.tasks = g.tasks.map((t) => ({ ...t, performed_at: 'WKS-01' }))
    const lone = g.tasks[3].id
    g.tasks[3].performed_at = 'CP-01'
    const r = readiness(g)
    expect(r.services.missing).toEqual([])
    expect(r.tasks.missing).toEqual([])
    expect(r.unreachable).toEqual([lone])
    expect(r.ready).toBe(false)
    // CP-01 is an end terminal (transit=false); it needs a transit neighbour
    // that is in SRV-01's component. Two links close the gap.
    g.links.push({ id: 'L-2', a: 'CP-01', b: 'SAT-01', bearer: 'wired' })
    g.links.push({ id: 'L-3', a: 'SAT-01', b: 'SRV-01', bearer: 'satcom' })
    const r2 = readiness(g)
    expect(r2.unreachable).toEqual([])
    expect(r2.ready).toBe(true)
  })
  it('a board with more than one asset and no link is not reachable', () => {
    // nine assets, zero links: every service on SRV-01, every task on an
    // asset that is not SRV-01. The engine alone would read a link-less graph
    // as fully reachable; the gate probes it with a self-loop instead.
    const g = g3()
    g.links = []
    for (let i = 2; i <= 5; i++) g.assets.push({ id: `WKS-0${i}`, type: 'workstation', unit: 'U-BDE', site: '신규', transit: false })
    expect(g.assets.length).toBe(9)
    g.edges.provided_by = ['S-C2MSG', 'S-BFT', 'S-VOICE', 'S-FIRE', 'S-INTEL'].map((s) => ({ from: s, to: 'SRV-01', w: 1 }))
    const others = g.assets.map((a) => a.id).filter((id) => id !== 'SRV-01')
    g.tasks = g.tasks.map((t, i) => ({ ...t, performed_at: others[i % others.length] }))
    const r = readiness(g)
    expect(r.services.missing).toEqual([])
    expect(r.tasks.missing).toEqual([])
    expect(r.unreachable.length).toBe(8)
    expect(r.ready).toBe(false)
    expect(g.links).toEqual([])                          // the probe never touches the board
  })
  it('a performer that hosts the provider is reachable with no link', () => {
    const g = g3()
    g.links = []
    g.edges.provided_by = ['S-C2MSG', 'S-BFT', 'S-VOICE', 'S-FIRE', 'S-INTEL'].map((s) => ({ from: s, to: 'SRV-01', w: 1 }))
    g.tasks = g.tasks.map((t) => ({ ...t, performed_at: 'SRV-01' }))
    const r = readiness(g)
    expect(r.unreachable).toEqual([])
    expect(r.ready).toBe(true)
  })
  it('does not run the engine while the structure is still short', () => {
    const g = g3()
    g.tasks = g.tasks.map((t) => ({ ...t, performed_at: 'CP-01' }))   // no providers yet
    const r = readiness(g)
    expect(r.services.missing.length).toBe(5)
    expect(r.unreachable).toEqual([])
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
  it('accepts the template replay graph itself', () => {
    const sb = makeSandbox(replay)
    expect(validateImport(sb, structuredClone(tg))).toEqual({ ok: true, errors: [] })
  })
  it('rejects an edge whose end is not on the board', () => {
    const sb = makeSandbox(replay)
    const g = g3()
    g.edges.provided_by = [{ from: 'S-C2MSG', to: 'GHOST', w: 1 }]
    const r = validateImport(sb, g)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('provided_by'))).toBe(true)
    const h = g3()
    h.edges.hosted_on = [{ from: 'SRV-01', to: 'NOPE' }]
    expect(validateImport(sb, h).ok).toBe(false)
  })
  it('rejects a non-array links or edges list without throwing', () => {
    const sb = makeSandbox(replay)
    const g = g3(); g.links = {}
    let r
    expect(() => { r = validateImport(sb, g) }).not.toThrow()
    expect(r.ok).toBe(false)
    const h = g3(); h.edges.provided_by = { from: 'S-C2MSG', to: 'SRV-01' }
    expect(validateImport(sb, h).ok).toBe(false)
    const k = g3(); k.edges = []
    expect(validateImport(sb, k).ok).toBe(false)
  })
  it('requires the template requires pairs and unique asset ids', () => {
    const sb = makeSandbox(replay)
    const g = g3(); delete g.edges.requires
    expect(validateImport(sb, g).ok).toBe(false)
    const h = g3(); h.edges.requires = h.edges.requires.slice(1)
    expect(validateImport(sb, h).ok).toBe(false)
    const k = g3(); k.edges.requires = k.edges.requires.map((e) => ({ from: e.from, to: e.to }))  // same pairs, no w/hard: fine
    expect(validateImport(sb, k).ok).toBe(true)
    const d = g3(); d.assets.push({ ...d.assets[0] })
    const r = validateImport(sb, d)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('중복'))).toBe(true)
    const m = g3(); delete m.edges.provided_by                              // template has none: absent is fine
    expect(validateImport(sb, m).ok).toBe(true)
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

// The predicate behind the inspector's 규칙 밖 mark and the overlay's dotted
// ghost line (derive.linkGhosts). It used to be written inline in Rail.jsx,
// where only the inspector could reach it; the overlay needed the same answer
// and a second copy would have let the two disagree about the same link.
describe('linkFitsRules', () => {
  const a = (over) => ({ id: 'A', type: 'c2-server', site: '본부', unit: 'U', ...over })
  const b = (over) => ({ id: 'B', type: 'satcom-terminal', site: '본부', unit: 'U', ...over })
  const g = (x, y, l) => ({ assets: [x, y], links: [l] })

  it('accepts a bearer both types carry under a satisfied condition', () => {
    const l = { id: 'L', a: 'A', b: 'B', bearer: 'wired' }
    expect(linkFitsRules(g(a(), b(), l), rules, l)).toBe(true)
  })
  it('rejects wired across two different sites (same_site)', () => {
    const l = { id: 'L', a: 'A', b: 'B', bearer: 'wired' }
    expect(linkFitsRules(g(a(), b({ site: '전방' }), l), rules, l)).toBe(false)
  })
  it('reads the placeholder site as no site, the way linkCandidates does', () => {
    const l = { id: 'L', a: 'A', b: 'B', bearer: 'wired' }
    expect(linkFitsRules(g(a({ site: '신규' }), b({ site: '신규' }), l), rules, l)).toBe(false)
  })
  it('rejects satcom with no satcom terminal at either end (needs_type)', () => {
    const l = { id: 'L', a: 'A', b: 'B', bearer: 'satcom' }
    expect(linkFitsRules(g(a(), b(), l), rules, l)).toBe(true)
    expect(linkFitsRules(g(a(), b({ type: 'workstation' }), l), rules, l)).toBe(false)
  })
  it('rejects a bearer one end does not carry', () => {
    const l = { id: 'L', a: 'A', b: 'B', bearer: 'vhf' }
    expect(linkFitsRules(g(a({ type: 'radio-relay' }), b({ type: 'workstation' }), l), rules, l)).toBe(false)
  })
  // A link with no bearer is out of rule, not 'wired'. The predicate used to
  // default it while being moved out of Rail.jsx, which flipped the
  // inspector's verdict on a half-built link from 규칙 밖 to fine. Every link
  // in tacnet-01 carries a bearer so nothing on screen moved, which is
  // exactly why this needs a test rather than an eye.
  it('flags a link that declares no bearer instead of assuming wired', () => {
    const x = a({ site: '본부' })
    const y = b({ site: '본부' })
    const none = { id: 'L', a: 'A', b: 'B' }
    expect(linkFitsRules(g(x, y, none), rules, none)).toBe(false)
    const empty = { id: 'L', a: 'A', b: 'B', bearer: '' }
    expect(linkFitsRules(g(x, y, empty), rules, empty)).toBe(false)
    // and the same pair WITH the bearer spelled out is fine, so the rejection
    // is about the missing declaration and not about the pair
    const wired = { id: 'L', a: 'A', b: 'B', bearer: 'wired' }
    expect(linkFitsRules(g(x, y, wired), rules, wired)).toBe(true)
  })

  it('stays silent when the table cannot say', () => {
    const l = { id: 'L', a: 'A', b: 'B', bearer: 'wired' }
    expect(linkFitsRules(g(a(), b(), l), null, l)).toBe(true)
    expect(linkFitsRules(g(a({ type: 'tent' }), b(), l), rules, l)).toBe(true)
    expect(linkFitsRules(g(a(), b(), l), rules, null)).toBe(true)
  })
  it('agrees with linkCandidates on what it would have proposed', () => {
    const x = a({ site: '본부' })
    const y = b({ site: '본부' })
    const graph = { assets: [x, y], links: [] }
    const proposed = linkCandidates(graph, rules, 'A')
    for (const c of proposed) {
      const l = { id: 'L', a: 'A', b: c.id, bearer: c.bearer }
      expect(linkFitsRules({ ...graph, links: [l] }, rules, l)).toBe(true)
    }
  })
})


// A scenario may declare, in the link data, that it waives a rule condition
// because it folded a layer away (ADR-0033). The declaration is read here and
// nowhere else: linkCandidates proposes links that do not exist yet, so there
// is no declaration to read and it still refuses wired across sites.
describe('linkException and the rules it can waive', () => {
  const a = (over) => ({ id: 'A', type: 'c2-server', site: '본부', unit: 'U', ...over })
  const b = (over) => ({ id: 'B', type: 'satcom-terminal', site: '전방', unit: 'U', ...over })
  const g = (x, y, l) => ({ assets: [x, y], links: [l] })
  const wired = (exc) => ({ id: 'L', a: 'A', b: 'B', bearer: 'wired', ...(exc ? { rule_exception: exc } : {}) })

  it('passes a cross-site wired link that declares the same_site exemption with a reason', () => {
    const l = wired({ exempts: ['same_site'], why: '부대별 액세스 스위치를 모델링하지 않는다' })
    expect(linkFitsRules(g(a(), b(), l), rules, l)).toBe(true)
    expect(linkException(l).exempts).toEqual(['same_site'])
  })

  // An exemption with no reason is not an exemption, it is a switch that
  // turns the judge off, and a switch that can be flipped without saying why
  // ends up flipped everywhere. The link stays 규칙 밖.
  it('does not honour a declaration with no reason', () => {
    for (const exc of [
      { exempts: ['same_site'] },
      { exempts: ['same_site'], why: '' },
      { exempts: ['same_site'], why: '   ' },
      { exempts: ['same_site'], why: 42 },
    ]) {
      const l = wired(exc)
      expect(linkException(l)).toBe(null)
      expect(linkFitsRules(g(a(), b(), l), rules, l)).toBe(false)
    }
  })

  // "this link is fine" would also cover the next violation, of a kind nobody
  // looked at. The declaration has to name what it waives.
  it('does not honour a declaration that names no rule, or a rule that is not waivable', () => {
    for (const exc of [
      { why: '이유는 있는데 무엇을 면제받는지 적지 않았다' },
      { exempts: [], why: '빈 목록' },
      { exempts: ['any'], why: '전부 면제' },
      { exempts: ['bearer'], why: '규칙표에 없는 베어러를 면제받겠다' },
    ]) {
      const l = wired(exc)
      expect(linkException(l)).toBe(null)
      expect(linkFitsRules(g(a(), b(), l), rules, l)).toBe(false)
    }
  })

  it('still flags a violation the declaration does not cover', () => {
    const why = '액세스 스위치를 모델링하지 않는다'
    // same_site waived, but a workstation does not carry satcom at all: that
    // is a question about the rule table's row, not about this scenario's
    // abstraction, so no declaration can waive it
    const sat = { id: 'L', a: 'A', b: 'B', bearer: 'satcom', rule_exception: { exempts: ['same_site'], why } }
    expect(linkFitsRules(g(a(), b({ type: 'workstation' }), sat), rules, sat)).toBe(false)
    // and needs_type is not waived by a same_site declaration
    const sat2 = { id: 'L', a: 'A', b: 'B', bearer: 'satcom', rule_exception: { exempts: ['same_site'], why } }
    expect(linkFitsRules(g(a(), b({ type: 'c2-terminal' }), sat2), rules, sat2)).toBe(false)
  })

  // The invariant the comment above linkFitsRules sets up: one predicate, two
  // questions. Splitting same_site into a proposal-only preference was the
  // first idea and it would have broken this (ADR-0033 rejects it).
  it('leaves linkCandidates refusing wired across sites', () => {
    const graph = { assets: [a(), b({ type: 'c2-server' })], links: [] }
    const proposed = linkCandidates(graph, rules, 'A').map((c) => `${c.id}:${c.bearer}`)
    expect(proposed).not.toContain('B:wired')
  })
})

// Every link a shipped scenario declares, walked through the app's own
// predicate. The rule table is a copy of what tacnet-01 declares (its
// `template` field says so), so a shipped link the table rejects is a finding
// somewhere - in the table, or in the scenario, or in the scenario's
// disclosure.
//
// This walk arrived (U13) with nine links pinned here by id as expected
// failures, labelled "open findings, not accepted behaviour": tacnet's
// L-TOC-FDC and defnet's L-SW-*02 / L-FW-WKS00x, all cross-site `wired`
// against bearers.wired.same_site. The pin lists are gone and nothing was
// pinned in their place, because the nine were never a rule problem:
// defnet-01 had already disclosed the simplification in `_links_note` and
// notes[5], where the predicate could not read it. The scenarios declare it
// in the link data now (ADR-0033), and the assertion below is stronger than
// the pin list was - every shipped link either fits the table or says, in
// data, which condition it waives and what it left unmodelled.
//
// Not asserted here: a link whose bearer the table does not give its types at
// all. That is a question about the TABLE and no declaration may waive it
// (EXEMPTABLE in sandbox.js). `L-VHF-RLY` is the open one - c2-server was
// missing `vhf` - and it is closed by the table row on data/link-rules-vhf,
// not by a declaration. When that row lands, assert this category empty too.
describe('shipped scenarios against the rule table', () => {
  // off-table links that fail a bearer CONDITION (same_site, needs_type)
  // without declaring it: the category this task closed
  const undeclared = (graph) => {
    const byId = new Map(graph.assets.map((x) => [x.id, x]))
    return (graph.links || [])
      .filter((l) => !linkFitsRules(graph, rules, l))
      .filter((l) => {
        const ra = (rules.types[(byId.get(l.a) || {}).type] || {}).bearers || []
        const rb = (rules.types[(byId.get(l.b) || {}).type] || {}).bearers || []
        return ra.includes(l.bearer) && rb.includes(l.bearer)
      })
      .map((l) => `${l.id}: ${l.a} --${l.bearer}--> ${l.b}`)
  }
  it('tacnet-01 declares every condition it waives', () => {
    expect(undeclared(tg)).toEqual([])
  })
  it('defnet-01 declares every condition it waives', async () => {
    const defnet = (await import('../../public/data/defnet-01.replay.json')).default
    expect(undeclared(defnet.graph)).toEqual([])
  })
  // the declarations sit on the links the walk named, and each carries a
  // reason: an empty list above could also mean nobody declared anything
  it('the nine links the walk found now carry a reason', async () => {
    const defnet = (await import('../../public/data/defnet-01.replay.json')).default
    const declared = (g) => (g.links || []).filter((l) => linkException(l)).map((l) => l.id)
    expect(declared(tg)).toEqual(['L-TOC-FDC'])
    expect(declared(defnet.graph)).toEqual([
      'L-SW-ESX02', 'L-SW-DC02', 'L-SW-DB02',
      'L-FW-WKS001', 'L-FW-WKS002', 'L-FW-WKS003', 'L-FW-WKS004', 'L-FW-WKS005',
    ])
    for (const g of [tg, defnet.graph]) {
      for (const l of g.links || []) {
        const e = linkException(l)
        if (e) expect(e.why.length).toBeGreaterThan(10)
      }
    }
  })
})
