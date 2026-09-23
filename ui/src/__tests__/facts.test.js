import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import { computeStep, splitBar, pct } from '../derive.js'
import { startGame, defend, attackerTurn, staffTable } from '../game.js'
import { readiness } from '../sandbox.js'
import {
  numbered, missionFacts, assetFacts, serviceFacts,
  containmentFacts, gameFacts, readinessFacts,
} from '../facts.js'

const g = replay.graph
// computeStep takes one options object and returns the exported step as-is
// when the scenario is neither edited nor live.
const s = computeStep({ payload: replay, graph: g, idx: 12 })

describe('numbered', () => {
  it('renumbers from F1 and keeps order', () => {
    const out = numbered([{ text: 'a' }, { text: 'b' }, { text: 'c' }])
    expect(out.map((f) => f.id)).toEqual(['F1', 'F2', 'F3'])
    expect(out[1].text).toBe('b')
  })
  it('fills the optional fields so consumers never read undefined', () => {
    const [f] = numbered([{ text: 'a' }])
    expect(f.ref).toBeNull(); expect(f.value).toBeNull(); expect(f.unit).toBeNull()
  })
  it('keeps a zero value as zero, not null', () => {
    expect(numbered([{ text: 'a', value: 0, unit: '%' }])[0].value).toBe(0)
  })
})

describe('missionFacts', () => {
  it('says the same number the mission panel says', () => {
    const facts = missionFacts(g, s)
    const p1 = g.missions.find((m) => Number(m.priority) === 1)
    const f = facts.find((x) => x.ref && x.ref.id === p1.id)
    expect(f).toBeTruthy()
    expect(f.value).toBeCloseTo(s.mission[p1.id], 6)
    expect(f.unit).toBe('%')
    expect(f.ref.kind).toBe('mission')
    expect(f.text).toContain(pct(s.mission[p1.id]))
    expect(f.text).toContain(p1.id)
  })
  it('splits the cause the same way splitBar does', () => {
    const p1 = g.missions.find((m) => Number(m.priority) === 1)
    const total = s.mission[p1.id]
    const att = s.mission_attack[p1.id]
    const env = s.mission_env[p1.id]
    const parts = splitBar(att, env, total - att - env, total)
    const f = missionFacts(g, s).filter((x) => x.ref && x.ref.id === p1.id).find((x) => x.unit === '%p')
    expect(f).toBeTruthy()
    expect(f.value).toBeCloseTo(parts.attack / 100, 6)
    expect(f.text).toContain('침해')
    expect(f.text).toContain('환경')
  })
  it('is deterministic', () => {
    expect(missionFacts(g, s)).toEqual(missionFacts(g, s))
  })
  it('survives a graph with no missions', () => {
    expect(missionFacts({ missions: [] }, s)).toEqual([])
  })
})

describe('assetFacts', () => {
  it('carries an asset ref and mentions the id', () => {
    const facts = assetFacts(g, s, 'BN-SRV')
    expect(facts.length).toBeGreaterThan(0)
    expect(facts.every((f) => !f.ref || f.ref.kind === 'asset')).toBe(true)
    expect(facts.some((f) => f.text.includes('BN-SRV'))).toBe(true)
  })
  it('returns an empty list for an unknown id rather than throwing', () => {
    expect(assetFacts(g, s, 'NOPE')).toEqual([])
  })
  it('reports the compromise level the step carries', () => {
    const facts = assetFacts(g, s, 'CO2-VEH')
    const f = facts.find((x) => x.text.includes('침해'))
    expect(f.value).toBeCloseTo(s.compromise['CO2-VEH'], 6)
    expect(f.unit).toBe('%')
    expect(f.text).toContain('50.0%')
  })
  it('is deterministic', () => {
    expect(assetFacts(g, s, 'TOC-SRV')).toEqual(assetFacts(g, s, 'TOC-SRV'))
  })
})

describe('serviceFacts', () => {
  it('gives one fact per service with a service ref and its degradation', () => {
    const facts = serviceFacts(g, s)
    expect(facts.length).toBeGreaterThanOrEqual(g.services.length)
    expect(facts.every((f) => f.ref && f.ref.kind === 'service')).toBe(true)
    const f = facts.find((x) => x.ref.id === 'S-C2MSG')
    expect(f.value).toBeCloseTo(s.service['S-C2MSG'], 6)
    expect(f.unit).toBe('%')
    expect(f.text).toContain('TOC-SRV')
  })
  it('is deterministic and empty without services', () => {
    expect(serviceFacts(g, s)).toEqual(serviceFacts(g, s))
    expect(serviceFacts({ services: [] }, s)).toEqual([])
  })
})

describe('containmentFacts', () => {
  const G = startGame(g, { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' })
  const rows = staffTable(g, G)
  it('phrases the ranked table with an asset ref and the cost as %p', () => {
    const facts = containmentFacts(rows, g)
    expect(facts.length).toBeGreaterThan(0)
    expect(facts.every((f) => f.ref && f.ref.kind === 'asset')).toBe(true)
    const top = rows.find((r) => r.rank === 1)
    const f = facts[0]
    expect(f.ref.id).toBe(top.id)
    expect(f.value).toBeCloseTo(top.cost, 6)
    expect(f.unit).toBe('%p')
    expect(f.text).toContain(`순위 ${top.rank}`)
    expect(f.text).toContain(top.id)
  })
  it('takes no graph and still names the id', () => {
    expect(containmentFacts(rows)[0].text).toContain(rows[0].id)
    expect(containmentFacts([])).toEqual([])
  })
})

describe('gameFacts', () => {
  it('reports the turn, the mode, the score and the footholds', () => {
    let G = startGame(g, { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' })
    G = defend(g, G, { type: 'isolate', id: 'FDC-TERM' })
    G = attackerTurn(g, G)
    const facts = gameFacts(g, G)
    expect(facts[0].ref).toEqual({ kind: 'turn', id: String(G.turn) })
    expect(facts[0].text).toContain(`턴 ${G.turn + 1}/8`)
    expect(facts.some((f) => f.text.includes('거점'))).toBe(true)
    expect(facts.some((f) => f.ref && f.ref.kind === 'asset' && f.ref.id === 'FDC-TERM' && f.text.includes('격리'))).toBe(true)
    const p1 = facts.find((f) => f.ref && f.ref.kind === 'mission' && f.ref.id === 'M-C2')
    expect(p1.unit).toBe('%')
    expect(p1.value).toBeCloseTo(G.history[G.history.length - 1].missions['M-C2'], 6)
  })
  it('returns an empty list without a game', () => {
    expect(gameFacts(g, null)).toEqual([])
  })
})

describe('readinessFacts', () => {
  it('counts what the readiness card counts', () => {
    const r = readiness(g)
    const facts = readinessFacts(g, r)
    const svc = facts.find((f) => f.text.includes('서비스 제공'))
    expect(svc.value).toBe(r.services.ok)
    expect(svc.text).toContain(`${r.services.ok}/${r.services.total}`)
    expect(facts.some((f) => f.text.includes(r.ready ? '교전 가능' : '구성 중'))).toBe(true)
  })
  it('names a service left without a provider, with a service ref', () => {
    const broken = { ...g, edges: { ...g.edges, provided_by: g.edges.provided_by.filter((e) => e.from !== 'S-BFT') } }
    const facts = readinessFacts(broken, readiness(broken))
    const f = facts.find((x) => x.ref && x.ref.kind === 'service' && x.ref.id === 'S-BFT')
    expect(f).toBeTruthy()
    expect(f.text).toContain('S-BFT')
  })
  it('reads the graph itself when no readiness result is handed in', () => {
    expect(readinessFacts(g)).toEqual(readinessFacts(g, readiness(g)))
  })
})
