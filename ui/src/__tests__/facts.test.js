import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import { computeStep, splitBar, pct } from '../derive.js'
import { runChain } from '../engine.js'
import { startGame, defend, pass, attackerTurn, staffTable } from '../game.js'
import { readiness } from '../sandbox.js'
import {
  numbered, missionFacts, assetFacts, serviceFacts,
  containmentFacts, gameFacts, readinessFacts,
  attribution, attributionFacts, decisionFacts,
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

// --- asset attribution ----------------------------------------------------
//
// The question these answer: a mission reads 32.1% degraded, which asset is
// responsible? The method is leave-one-out against the engine, so the test of
// it is not "does the number look right" but "is it the difference between
// two runChain calls" - computed here, independently of facts.js.
const stepWith = (compromise) => ({ ...s, compromise })
const missionAt = (compromise, mid) => runChain(g, compromise, { t: s.t, method: 'weighted', causes: 'all' }).mission[mid]

// Three compromised assets that do matter to M-C2, so sum/joint/interaction
// are all exercised rather than being trivially equal.
const THREE = { 'CO2-VEH': 0.5, 'TOC-SRV': 0.6, 'TOC-ESX': 0.4 }

describe('attribution', () => {
  it('gives each asset the drop its own compromise accounts for, checked against runChain directly', () => {
    const st = stepWith(THREE)
    const a = attribution(g, st, 'M-C2')
    const total = missionAt(THREE, 'M-C2')
    expect(a.total).toBeCloseTo(total, 9)
    for (const r of a.rows) {
      const after = missionAt({ ...THREE, [r.id]: 0 }, 'M-C2')
      expect(r.after).toBeCloseTo(after, 9)
      expect(r.contribution).toBeCloseTo(total - after, 9)
    }
  })

  it('keeps the decomposition exact: floor + joint = total, sum + interaction = joint', () => {
    const a = attribution(g, stepWith(THREE), 'M-C2')
    expect(a.floor + a.joint).toBeCloseTo(a.total, 9)
    expect(a.sum + a.interaction).toBeCloseTo(a.joint, 9)
    // The floor is the engine with every compromise cleared - environment and
    // outages, which no asset's compromise can be charged for.
    expect(a.floor).toBeCloseTo(missionAt({}, 'M-C2'), 9)
    expect(a.floor).toBeGreaterThan(0)
  })

  it('leaves out an asset at compromise 0, and keeps a compromised one that moved nothing', () => {
    const a = attribution(g, stepWith({ 'CO2-VEH': 0.5, 'CO1-VEH': 0.9 }), 'M-C2')
    expect(a.rows.map((r) => r.id).sort()).toEqual(['CO1-VEH', 'CO2-VEH'])
    // CO1-VEH is compromised but contributes nothing to M-C2 at this t. It is
    // listed with 0 rather than dropped: "compromised and irrelevant here" is
    // a different statement from "not compromised".
    const idle = a.rows.find((r) => r.id === 'CO1-VEH')
    expect(idle.contribution).toBe(0)
    expect(a.rows.some((r) => r.id === 'TOC-SRV')).toBe(false)
  })

  it('ranks by contribution descending and breaks a tie by id', () => {
    const a = attribution(g, stepWith(THREE), 'M-C2')
    const c = a.rows.map((r) => r.contribution)
    expect(c).toEqual([...c].sort((x, y) => y - x))
    for (let i = 1; i < a.rows.length; i += 1) {
      if (a.rows[i].contribution === a.rows[i - 1].contribution) {
        expect(a.rows[i - 1].id < a.rows[i].id).toBe(true)
      }
    }
  })

  it('is deterministic', () => {
    expect(attribution(g, stepWith(THREE), 'M-C2')).toEqual(attribution(g, stepWith(THREE), 'M-C2'))
  })

  it('says a mission with no active task has nothing to split', () => {
    const idle = { ...g, phases: (g.phases || []).map((p) => (p.mission === 'M-FIRE' ? { ...p, window: { from: 0, to: 1 } } : p)) }
    const a = attribution(idle, stepWith(THREE), 'M-FIRE')
    expect(a.active).toBe(false)
    expect(attributionFacts(idle, stepWith(THREE), 'M-FIRE', { data: a })).toHaveLength(1)
  })

  // The number the plan asked to be measured rather than assumed. 13 assets
  // means 15 runChain calls (base + floor + 13 leave-one-out).
  it('attributes all 13 assets in well under 50 ms', () => {
    const every = Object.fromEntries(g.assets.map((x, i) => [x.id, 0.3 + (i % 5) / 20]))
    const st = stepWith(every)
    attribution(g, st, 'M-C2')
    const t0 = performance.now()
    const a = attribution(g, st, 'M-C2')
    const ms = performance.now() - t0
    expect(a.rows).toHaveLength(13)
    expect(ms).toBeLessThan(50)
  })
})

describe('attributionFacts', () => {
  it('carries an asset ref, the raw %p in value and the same rounding in text', () => {
    const st = stepWith(THREE)
    const a = attribution(g, st, 'M-C2')
    const facts = attributionFacts(g, st, 'M-C2', { data: a })
    const top = a.rows[0]
    const fx = facts.find((x) => x.ref && x.ref.kind === 'asset' && x.ref.id === top.id)
    expect(fx).toBeTruthy()
    expect(fx.unit).toBe('%p')
    expect(fx.value).toBeCloseTo(top.contribution, 9)
    expect(fx.text).toContain(pct(top.contribution).replace('%', '%p'))
    expect(fx.text).toContain(top.id)
    const head = facts[0]
    expect(head.ref).toEqual({ kind: 'mission', id: 'M-C2' })
    expect(head.unit).toBe('%')
    expect(head.text).toContain(pct(a.total))
  })

  it('reports the gap between the individual sum and the total instead of scaling it away', () => {
    const st = stepWith(THREE)
    const a = attribution(g, st, 'M-C2')
    const facts = attributionFacts(g, st, 'M-C2', { data: a })
    expect(a.interaction).not.toBe(0)
    const resid = facts.find((x) => x.text.includes('개별 기여 합'))
    expect(resid).toBeTruthy()
    expect(resid.text).toContain('상호작용')
    expect(resid.value).toBeCloseTo(a.interaction, 9)
    expect(resid.unit).toBe('%p')
    // The floor is named too, so the whole of total - sum is accounted for by
    // two facts rather than left as an unexplained remainder.
    expect(facts.some((x) => x.text.includes('단절·환경 몫'))).toBe(true)
    // Nothing in the list is a contribution divided by the total.
    const shares = a.rows.map((r) => pct(r.contribution / a.total))
    for (const f of facts) for (const sh of shares) expect(f.text).not.toContain(`${sh}p`)
  })

  // The case that makes normalising indefensible, measured on this graph: a
  // redundancy group multiplies its providers, so each leave-one-out run
  // charges the same loss to both assets and the sum passes the total.
  it('says so out loud when the individual sum exceeds the total', () => {
    const st = stepWith({ 'RELAY-1': 0.6, 'SAT-TERM': 0.7 })
    const a = attribution(g, st, 'M-FIRE')
    expect(a.sum).toBeGreaterThan(a.total)
    expect(a.interaction).toBeLessThan(0)
    const facts = attributionFacts(g, st, 'M-FIRE', { data: a })
    const warn = facts.find((x) => x.text.includes('비율로 읽으면 안 된다'))
    expect(warn).toBeTruthy()
    expect(warn.value).toBeCloseTo(a.sum, 9)
  })

  it('cuts the sentences at k but still sums over every row, and says it did', () => {
    const every = Object.fromEntries(g.assets.map((x, i) => [x.id, 0.3 + (i % 5) / 20]))
    const st = stepWith(every)
    const a = attribution(g, st, 'M-C2')
    const facts = attributionFacts(g, st, 'M-C2', { data: a, k: 3 })
    expect(facts.filter((x) => x.ref && x.ref.kind === 'asset')).toHaveLength(3)
    const cut = facts.find((x) => x.text.includes('상위 3개만'))
    expect(cut).toBeTruthy()
    expect(cut.value).toBe(13)
    const resid = facts.find((x) => x.text.includes('개별 기여 합'))
    expect(resid.text).toContain('침해 자산 13개')
    expect(resid.value).toBeCloseTo(a.interaction, 9)
  })

  it('says where the degradation came from when nothing is compromised', () => {
    const st = stepWith({})
    const facts = attributionFacts(g, st, 'M-C2')
    expect(facts.some((x) => x.text.includes('침해된 자산이 없다'))).toBe(true)
    expect(facts.every((x) => !x.ref || x.ref.kind === 'mission')).toBe(true)
  })

  it('computes its own numbers when the caller hands in none', () => {
    const st = stepWith(THREE)
    expect(attributionFacts(g, st, 'M-C2')).toEqual(attributionFacts(g, st, 'M-C2', { data: attribution(g, st, 'M-C2') }))
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

// --- decisionFacts -------------------------------------------------------
//
// One history row read back out. Everything asserted here was written by
// game.js at the time of the decision: these tests check the phrasing against
// the RECORD, never against a number recomputed on the present state, because
// the present state is a different turn.

describe('decisionFacts', () => {
  const cfg = { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' }
  const G0 = startGame(g, cfg)
  const table = staffTable(g, G0)
  const third = table[2]
  const played = (() => {
    let G = defend(g, G0, { type: 'isolate', id: third.id, basis: ['F1', 'F2', 'F3'], rationale: '단일 경로라서' })
    G = attackerTurn(g, G)
    return attackerTurn(g, pass(G))
  })()
  const facts = decisionFacts(g, played, 0)
  const txt = facts.map((f) => f.text).join(' ')

  it('names what was isolated, by whom, and what it cost', () => {
    const f = facts[0]
    expect(f.ref).toEqual({ kind: 'asset', id: third.id })
    expect(f.value).toBeCloseTo(played.history[0].defender.cost, 6)
    expect(f.unit).toBe('%p')
    expect(f.text).toContain('턴 1')
    expect(f.text).toContain(third.id)
    expect(f.text).toContain('사람(운용자)')
  })

  it('says where the staff table had it, out of how many candidates', () => {
    const f = facts.find((x) => x.value === 3 && x.ref.id === third.id)
    expect(f).toBeTruthy()
    expect(f.text).toContain('3위')
    expect(f.text).toContain(`${table.length}개`)
  })

  it('names the rank-1 row and compares the two on cost and on moves blocked', () => {
    const top = facts.find((x) => x.ref && x.ref.id === table[0].id && x.text.includes('1위는'))
    expect(top).toBeTruthy()
    expect(top.value).toBeCloseTo(table[0].net, 6)
    const cmp = facts.find((x) => x.text.includes('고른 것과 1위의 비교'))
    expect(cmp.value).toBeCloseTo(third.cost - table[0].cost, 6)
    expect(cmp.text).toContain(`${third.blocks}개 대 ${table[0].blocks}개`)
  })

  it('says so when the rank gap is only the net tiebreak', () => {
    // RELAY-1 and SAT-TERM both score net +25.0%p here, so 3위 is the blocks
    // tiebreak and not a worse option.
    expect(third.net).toBeCloseTo(table[0].net, 6)
    expect(txt).toContain('순이득은 같다')
  })

  it('lists the fact numbers that were on screen, and says they are another numbering', () => {
    const f = facts.find((x) => x.text.includes('근거 사실'))
    expect(f.value).toBe(3)
    expect(f.text).toContain('F1·F2·F3')
    expect(f.text).toContain('이 답의 F#')
  })

  it('quotes the operator line, and says it was left empty when it was', () => {
    expect(txt).toContain('"단일 경로라서"')
    let bare = defend(g, G0, { type: 'isolate', id: third.id })
    bare = attackerTurn(g, bare)
    const t2 = decisionFacts(g, bare, 0).map((f) => f.text).join(' ')
    expect(t2).toContain('한 줄 근거를 적지 않았다')
    expect(t2).toContain('근거 사실 번호가 기록되지 않았다')
  })

  it('says a human pressed it and that there is no execution path', () => {
    expect(txt).toContain('ADR-0004')
    expect(txt).toContain('기록이지 명령이 아니다')
  })

  it('does not claim a human when the record says otherwise', () => {
    let sys = defend(g, G0, { type: 'isolate', id: third.id, actor: 'system' })
    sys = attackerTurn(g, sys)
    const t2 = decisionFacts(g, sys, 0).map((f) => f.text).join(' ')
    expect(t2).toContain('사람의 승인 기록이 아니다')
  })

  it('reports the attack that followed with the strategy that played it', () => {
    const f = facts.find((x) => x.text.includes('공격 -'))
    expect(f.text).toContain('greedy')
  })

  it('reads P1 off the row and the next row, not off the present state', () => {
    const h = played.history[0]
    const nxt = played.history[1]
    const now = facts.find((x) => x.unit === '%' && x.text.includes('종료 시 P1'))
    expect(now.value).toBeCloseTo(h.p1, 9)
    expect(now.ref).toEqual({ kind: 'mission', id: 'M-C2' })
    const after = facts.find((x) => x.text.includes('다음 턴'))
    expect(after.value).toBeCloseTo(nxt.p1 - h.p1, 9)
    expect(after.unit).toBe('%p')
  })

  it('says a pass recorded no decision at all', () => {
    const t2 = decisionFacts(g, played, 1).map((f) => f.text).join(' ')
    expect(t2).toContain('생략')
    expect(t2).toContain('참모 순위')
    expect(t2).toContain('다음 턴 기록이 없다')
  })

  it('returns one fact for a turn with no row rather than throwing', () => {
    const miss = decisionFacts(g, played, 9)
    expect(miss.length).toBe(1)
    expect(miss[0].text).toContain('턴 10')
    expect(decisionFacts(g, null, 0).length).toBe(1)
  })

  it('is deterministic', () => {
    expect(decisionFacts(g, played, 0)).toEqual(decisionFacts(g, played, 0))
  })
})
