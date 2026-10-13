import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import rules from '../../public/data/link-rules.json'
import { startGame, defend, pass, attackerTurn } from '../game.js'
import {
  eventRows, kpiOf, timeLabel, BAND_LABELS, gameOverlay, peekLine,
  contribLayer, contribMission, linkGhosts,
} from '../derive.js'
import { attribution } from '../facts.js'
import { linkCandidates } from '../sandbox.js'

const graph = {
  timeline: { t0_iso: '2026-09-10T06:00:00+09:00', horizon: 420, step: 15 },
  units: [{ id: 'U-1BN', name: '1대대' }],
  missions: [{ id: 'M-C2', name: '지휘통제', priority: 1 }, { id: 'M-FIRE', name: '화력지원', priority: 2 }],
  phases: [{ id: 'PH-1', mission: 'M-C2', name: '집결·준비' }, { id: 'PH-2', mission: 'M-C2', name: '기동' }],
  assets: [
    { id: 'BN-SRV', type: 'c2-server', unit: 'U-1BN', site: '대대 지휘소',
      geo: { kind: 'track', segments: [
        { from: 0, to: 95, mode: 'hold', at: { x: 0, y: 0, z: 0 } },
        { from: 95, to: 125, mode: 'move', at: { x: 0, y: 0, z: 0 }, to_at: { x: 1, y: 1, z: 1 } },
        { from: 125, to: 420, mode: 'hold', at: { x: 1, y: 1, z: 1 } } ] } },
    { id: 'CO2-VEH', type: 'c2-terminal', unit: 'U-1BN', site: '2중대 지휘차', geo: { kind: 'fixed', at: { x: 0, y: 0, z: 0 } } },
  ],
  links: [{ id: 'L-SAT-TOC', a: 'BN-SRV', b: 'CO2-VEH', bearer: 'satcom' }],
}

const steps = [
  { t: 0, active_phases: ['PH-1'], compromise: {}, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
  { t: 90, active_phases: ['PH-2'], compromise: {}, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
  { t: 300, label: 'BN-SRV 장악', gt: [{ technique: 'T1078.002' }], compromise: { 'BN-SRV': 1 },
    link_outage: { 'L-SAT-TOC': 'unknown' }, asset_outage: {} },
  { t: 345, active_phases: ['PH-2'], compromise: { 'BN-SRV': 1 }, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
]
const payload = { steps }

describe('timeLabel', () => {
  it('formats wall clock from t0', () => expect(timeLabel(graph, 300)).toBe('11:00'))
  it('falls back to offset without t0', () => expect(timeLabel({}, 300)).toBe('+300분'))
})

describe('eventRows', () => {
  const rows = eventRows(graph, payload)
  it('is sorted by t', () => {
    const ts = rows.map((r) => r.t)
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
  })
  it('emits a phase change, an attack, an outage, a restore and two moves', () => {
    const kinds = rows.map((r) => r.kind)
    expect(kinds.filter((k) => k === 'phase').length).toBe(2)    // PH-1 at t=0, PH-2 at t=90
    expect(kinds.filter((k) => k === 'attack').length).toBe(1)
    expect(kinds.filter((k) => k === 'outage').length).toBe(1)
    expect(kinds.filter((k) => k === 'restore').length).toBe(1)
    expect(kinds.filter((k) => k === 'move').length).toBe(2)     // start 95, arrive 125
  })
  it('names things in Korean and carries the cause', () => {
    const out = rows.find((r) => r.kind === 'outage')
    expect(out.cause).toBe('unknown')
    expect(out.text).toContain('단절')
    const atk = rows.find((r) => r.kind === 'attack')
    expect(atk.cause).toBe('attack')
    expect(atk.text).toContain('대대 지휘소')
  })
  it('points each row at the last step at or before its t', () => {
    const move = rows.find((r) => r.kind === 'move' && r.t === 95)
    expect(move.stepIdx).toBe(1)                                  // t=90 is the last step <= 95
    expect(rows.find((r) => r.kind === 'restore').stepIdx).toBe(3)
  })
})

describe('kpiOf', () => {
  it('counts compromised assets and cut links by cause, and bands the worst mission', () => {
    const k = kpiOf(graph, { ...steps[2], mission: { 'M-C2': 0.72, 'M-FIRE': 0 }, mission_active: { 'M-C2': true, 'M-FIRE': true } })
    expect(k.compromised).toEqual({ n: 1, total: 2 })
    expect(k.cuts).toEqual({ n: 1, byCause: { unknown: 1 } })
    expect(k.band).toEqual({ level: 3, label: '심각' })
    expect(k.missions[0]).toMatchObject({ id: 'M-C2', total: 0.72, active: true })
  })
  it('bands 0 / <0.3 / <0.7 / >=0.7', () => {
    const at = (v) => kpiOf(graph, { mission: { 'M-C2': v }, compromise: {}, link_outage: {} }).band.level
    expect([at(0), at(0.1), at(0.5), at(0.7)]).toEqual([0, 1, 2, 3])
    expect(BAND_LABELS).toEqual(['정상', '주의', '경계', '심각'])
  })
})

describe('gameOverlay', () => {
  const g = replay.graph
  it('returns null without a game', () => expect(gameOverlay(g, null)).toBe(null))
  it('lists lateral candidates as edges, self-targets as node threats, and marks isolated/footholds', () => {
    let G = startGame(g, { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' })
    G = defend(g, G, { type: 'isolate', id: 'FDC-TERM' })
    const o = gameOverlay(g, G)
    expect(o.isolated).toEqual(['FDC-TERM'])
    expect(o.footholds).toEqual(['CO2-VEH'])
    expect(o.candidates.every((c) => c.from !== c.to)).toBe(true)
    expect(o.candidates.length + o.nodeThreats.length).toBeLessThanOrEqual(6)
    expect(o.last).toBe(null)
    G = attackerTurn(g, G)
    const o2 = gameOverlay(g, G)
    expect(o2.turn).toBe(1)
    if (G.history[0].attacker && G.history[0].attacker.move.target) expect(o2.last).toMatchObject({ turn: 0 })
  })
})

describe('peekLine', () => {
  const s = { ...steps[2], mission: { 'M-C2': 0.72, 'M-FIRE': 0.1 }, mission_active: { 'M-C2': true, 'M-FIRE': true } }
  it('headlines the top-priority mission and its degradation', () => {
    expect(peekLine(graph, s, null)).toBe('지휘통제 P1 72.0%')
  })
  it('skips a mission the current phase has switched off', () => {
    const off = { ...s, mission_active: { 'M-C2': false, 'M-FIRE': true } }
    expect(peekLine(graph, off, null)).toBe('화력지원 P2 10.0%')
  })
  it('reads zero before anything has happened', () => {
    expect(peekLine(graph, steps[0], null)).toBe('지휘통제 P1 0.0%')
  })
  it('a running game replaces it with the turn and the score', () => {
    const g = replay.graph
    let G = startGame(g, { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' })
    expect(peekLine(g, s, G)).toBe(`턴 1/8 · 점수 ${G.score.total.toFixed(2)}`)
    G = pass(G)
    G = attackerTurn(g, G)
    expect(peekLine(g, s, G)).toBe(`턴 2/8 · 점수 ${G.score.total.toFixed(2)}`)
  })
  it('survives a graph with no missions at all', () => {
    expect(peekLine({ missions: [] }, {}, null)).toBe('임무 없음')
  })
})

// --- U3: contribution as thickness ---------------------------------------
//
// The one thing these tests exist to hold down: the weight is scaled by the
// LARGEST contribution in the set and never by the mission total.
//
// U1 measured why. engine.js serviceDegFor MULTIPLIES the providers of a
// redundancy_group, so with two providers compromised, removing either one
// alone reads as decisive and the same loss is charged twice. On tacnet-01 at
// t=180, RELAY-1 (0.6) and SAT-TERM (0.7) against M-FIRE each read +8.6%p
// against a total of 8.6% - an individual sum of +17.3%p. Divided by the
// total, both lines would be drawn at full thickness and the picture would
// say each of two assets is the whole of a loss they share. A pair sweep
// found four such combinations, so this is the normal case for a redundancy
// group, not a corner.
describe('contribLayer', () => {
  const tg = replay.graph
  const at = (i, compromise) => ({ ...replay.steps[i], compromise })
  // the measured pair, read off the engine here rather than asserted as a
  // constant, so a scenario edit fails the premise instead of the metric
  const PAIR = { 'RELAY-1': 0.6, 'SAT-TERM': 0.7 }

  it('has the premise: per-asset contributions sum past the total', () => {
    const a = attribution(tg, at(12, PAIR), 'M-FIRE')
    expect(a.sum).toBeGreaterThan(a.total)
    expect(a.interaction).toBeLessThan(0)
    // what a share would have claimed, and why it cannot be drawn
    for (const r of a.rows) expect(r.contribution / a.total).toBeCloseTo(1, 6)
  })

  it('scales by max(contribution) in the set, not by the mission total', () => {
    const comp = { 'RELAY-1': 0.6, 'SAT-TERM': 0.7, 'TOC-SRV': 0.5 }
    const a = attribution(tg, at(12, comp), 'M-FIRE')
    const layer = contribLayer(a, { id: 'M-FIRE', name: '화력지원' })
    expect(a.sum).toBeGreaterThan(a.total)          // the trap is live here too
    const max = Math.max(...a.rows.map((r) => r.contribution))
    for (const row of layer.rows) {
      const src = a.rows.find((r) => r.id === row.id)
      expect(row.w).toBeCloseTo(src.contribution / max, 9)
      // and NOT the share: on this set the two readings differ
      expect(row.w).not.toBeCloseTo(src.contribution / a.total, 4)
    }
    expect(layer.max).toBeCloseTo(max, 9)
    expect(layer.missionName).toBe('화력지원')
  })

  it('keeps every weight inside 0..1 even where the sum is twice the total', () => {
    const layer = contribLayer(attribution(tg, at(12, PAIR), 'M-FIRE'), null)
    expect(layer.rows.length).toBe(2)
    for (const r of layer.rows) {
      expect(r.w).toBeGreaterThan(0)
      expect(r.w).toBeLessThanOrEqual(1)
    }
    // equal contributions draw equally: the comparison says "these two are
    // the same", which is the true statement about a shared loss
    expect(layer.rows[0].w).toBeCloseTo(layer.rows[1].w, 9)
    expect(layer.rows.reduce((x, r) => x + r.contribution, 0)).toBeGreaterThan(layer.total)
  })

  it('carries the heaviest asset at full weight and ranks downward', () => {
    const comp = { 'RELAY-1': 0.6, 'SAT-TERM': 0.7, 'TOC-SRV': 0.5 }
    const layer = contribLayer(attribution(tg, at(12, comp), 'M-FIRE'), null)
    expect(layer.rows[0].w).toBeCloseTo(1, 9)
    const ws = layer.rows.map((r) => r.w)
    expect(ws).toEqual([...ws].sort((x, y) => y - x))
  })

  it('draws nothing when there is nothing to compare', () => {
    expect(contribLayer(null, null)).toBe(null)
    expect(contribLayer({ active: false, rows: [{ id: 'A', contribution: 1 }] }, null)).toBe(null)
    // compromised but contributing nothing to this mission: a 0 weight is not
    // a thin line, it is no line
    expect(contribLayer({ active: true, rows: [{ id: 'A', contribution: 0 }], total: 0 }, null)).toBe(null)
    expect(contribLayer(attribution(tg, at(12, {}), 'M-FIRE'), null)).toBe(null)
  })
})

describe('contribMission', () => {
  const tg = replay.graph
  it('picks the highest-priority mission with active work', () => {
    const m = contribMission(tg, { mission_active: { 'M-C2': true, 'M-FIRE': true } })
    expect(m.id).toBe('M-C2')
  })
  it('skips a mission with no active task at this step', () => {
    const m = contribMission(tg, { mission_active: { 'M-C2': false, 'M-FIRE': true } })
    expect(m.id).toBe('M-FIRE')
  })
  it('treats a step with no activity table as all active', () => {
    expect(contribMission(tg, {}).id).toBe('M-C2')
  })
  it('has nothing to name without missions', () => {
    expect(contribMission({ missions: [] }, {})).toBe(null)
    expect(contribMission(null, null)).toBe(null)
  })
})

// --- U9: where a selected asset can connect ------------------------------
describe('linkGhosts', () => {
  const tg = replay.graph

  it('draws one line per target, on the best-ranked bearer', () => {
    const gh = linkGhosts(tg, rules, 'BN-SRV')
    const ids = gh.cands.map((c) => c.to)
    expect(new Set(ids).size).toBe(ids.length)
    const all = linkCandidates(tg, rules, 'BN-SRV')
    for (const c of gh.cands) {
      const best = all.find((x) => x.id === c.to)
      expect(c.bearer).toBe(best.bearer)            // the bearer addLinkWith gets
    }
    expect(gh.from).toBe('BN-SRV')
  })

  it('ranks from 1 and thins with the rank, the way the wargame ghosts do', () => {
    const gh = linkGhosts(tg, rules, 'BN-SRV')
    expect(gh.cands.map((c) => c.rank)).toEqual(gh.cands.map((x, i) => i + 1))
    const ws = gh.cands.map((c) => c.w)
    expect(ws).toEqual([...ws].sort((x, y) => y - x))
    expect(Math.min(...ws)).toBeGreaterThanOrEqual(1.5)
  })

  it('caps the drawn lines and still reports how many there were', () => {
    const gh = linkGhosts(tg, rules, 'BN-SRV')
    expect(gh.cands.length).toBeLessThanOrEqual(8)
    expect(gh.total).toBeGreaterThanOrEqual(gh.cands.length)
  })

  it('never proposes a link that is already there', () => {
    const gh = linkGhosts(tg, rules, 'BN-SRV')
    const mine = (tg.links || []).filter((l) => l.a === 'BN-SRV' || l.b === 'BN-SRV')
      .map((l) => (l.a === 'BN-SRV' ? l.b : l.a))
    for (const c of gh.cands) expect(mine).not.toContain(c.to)
  })

  it('marks an existing link the rule table no longer fits, and does not drop it', () => {
    // same site is what wired needs; move one end and the link is out of rule
    const wired = (tg.links || []).find((l) => l.bearer === 'wired' && (l.a === 'TOC-WS' || l.b === 'TOC-WS'))
    expect(wired).toBeTruthy()
    const off = {
      ...tg,
      assets: tg.assets.map((a) => (a.id === 'TOC-WS' ? { ...a, site: '다른 곳' } : a)),
    }
    const gh = linkGhosts(off, rules, 'TOC-WS')
    expect(gh.offRule.map((x) => x.id)).toContain(wired.id)
    // and the clean board has none of them
    expect((linkGhosts(tg, rules, 'TOC-WS') || { offRule: [] }).offRule).toEqual([])
  })

  it('has nothing to draw without a table, an asset, or a candidate', () => {
    expect(linkGhosts(tg, null, 'BN-SRV')).toBe(null)
    expect(linkGhosts(tg, rules, 'NOPE')).toBe(null)
    expect(linkGhosts(null, rules, 'BN-SRV')).toBe(null)
    const lone = { assets: [{ id: 'A', type: 'switch', site: '본부' }], links: [] }
    expect(linkGhosts(lone, rules, 'A')).toBe(null)
  })

  it('says why the table is silent, so the overlay can repeat the inspector', () => {
    const odd = { assets: [{ id: 'A', type: 'tent', site: '본부' }, { id: 'B', type: 'switch', site: '본부' }], links: [] }
    expect(linkGhosts(odd, rules, 'A')).toBe(null)
    expect(linkGhosts(tg, rules, 'BN-SRV').gap).toBe(null)
  })
})
