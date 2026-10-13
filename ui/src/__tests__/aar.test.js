// U4: the AAR looks at the operator.
//
// The one thing these tests exist to hold down is the tie. At tacnet-01's
// early steps twelve of thirteen staff candidates share net 0, so rank 1 and
// rank 9 are the same recommendation and the sort order is the only thing
// between them. A metric that read the rank number would report a
// disagreement the staff never had, which is the fixture problem in another
// costume. Agreement is tested on `net`, ties are reported as their own
// number, and the headline is computed only where the staff had a preference.
//
// Nothing here measures wall-clock time, and nothing here turns approval into
// a percentage (ADR-0004: isolation is the only way in, so the ratio would be
// 100% by construction).

import { describe, it, expect } from 'vitest'
import payload from '../../public/data/tacnet-01.replay.json'
import { startGame, defend, pass, attackerTurn, staffTable } from '../game.js'
import { classify, decisionsOf, agreementOf, firstEffectiveOf, approvalOf, aarMetrics } from '../aar.js'

const g = payload.graph
// t = 0: the attack has not started, every candidate's net is 0, the table is
// one big tie. t = 120 with a credentialed foothold: one row is strictly
// better than the rest, so the staff has a preference and agreement is
// computable. Both are read off the table in the tests rather than asserted
// as constants, so a scenario edit fails the premise test instead of quietly
// changing what the metric tests mean.
const flat = { mode: 'hold', turns: 8, t: 0, foothold: { id: 'CO2-VEH', level: 0.5 }, seed: 11, strategy: 'greedy', method: 'weighted' }
const sharp = { mode: 'hold', turns: 8, t: 120, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy', method: 'weighted' }

// play a run by picking, each defend phase, the first row a predicate accepts
const play = (cfg, picks) => {
  let G = startGame(g, cfg)
  for (const pick of picks) {
    const rows = staffTable(g, G)
    const row = pick(rows)
    G = attackerTurn(g, row ? defend(g, G, { type: 'isolate', id: row.id, actor: 'human' }) : pass(G))
  }
  return G
}
const atRank = (n) => (rows) => rows[n - 1] || null
// a row the staff cannot prefer over its own first choice: same net, lower
// down the table only because of the blocks/id tiebreak
const tiedPick = (rows) => rows.find((r) => r.id !== rows[0].id && r.net === rows[0].net) || null
const worst = (rows) => rows[rows.length - 1] || null
const noBlocks = (rows) => rows.find((r) => r.blocks === 0) || null
const blocking = (rows) => rows.find((r) => r.blocks > 0) || null

describe('the scenario really does tie (the premise of the rest)', () => {
  it('t=0 shares the top net across most of the table, t=150 does not', () => {
    const t0 = staffTable(g, startGame(g, flat))
    expect(t0.filter((r) => r.net === t0[0].net).length).toBeGreaterThan(1)
    expect(t0[0].blocks).toBeGreaterThan(t0[1].blocks)   // the tiebreak, not a better net
    const t150 = staffTable(g, startGame(g, sharp))
    expect(t150.filter((r) => r.net === t150[0].net).length).toBe(1)
  })
  it('game.js records how many rows shared the top net', () => {
    const G = startGame(g, flat)
    const table = staffTable(g, G)
    const d = defend(g, G, { type: 'isolate', id: table[4].id }).pending.defender
    expect(d.staff.tiedTop).toBe(table.filter((r) => r.net === table[0].net).length)
    expect(d.staff.tiedTop).toBeGreaterThan(1)
    // the fields U2 wrote are untouched
    expect(d.staff.rows).toBe(table.length)
    expect(d.staff.chosen.id).toBe(table[4].id)
    expect(d.staff.top.id).toBe(table[0].id)
  })
})

describe('classify treats a tied pick as agreement, not as disagreement', () => {
  it('reads rank 5 of a flat table as agreement and marks it tied', () => {
    const G = startGame(g, flat)
    const row = staffTable(g, G)[4]
    const c = classify({ turn: 0, defender: defend(g, G, { type: 'isolate', id: row.id }).pending.defender })
    expect(c.rank).toBe(5)
    expect(c.agreed).toBe(true)      // same net as rank 1
    expect(c.tied).toBe(true)        // and the staff had nothing to prefer
    expect(c.decided).toBe(false)    // so it is out of the headline denominator
    expect(c.tieSize).toBeGreaterThan(1)
  })
  it('reads a strictly worse pick as a real disagreement even on a flat table', () => {
    const G = startGame(g, flat)
    const row = worst(staffTable(g, G))
    expect(row.net).toBeLessThan(staffTable(g, G)[0].net)
    const c = classify({ turn: 0, defender: defend(g, G, { type: 'isolate', id: row.id }).pending.defender })
    expect(c.agreed).toBe(false)
    expect(c.tied).toBe(false)
    expect(c.decided).toBe(true)
  })
  it('reads rank 1 of a table with a unique best as a decided agreement', () => {
    const G = startGame(g, sharp)
    const row = staffTable(g, G)[0]
    const c = classify({ turn: 0, defender: defend(g, G, { type: 'isolate', id: row.id }).pending.defender })
    expect(c).toMatchObject({ rank: 1, agreed: true, tied: false, decided: true, tieSize: 1 })
  })
  it('reads rank 2 of a table with a unique best as a disagreement', () => {
    const G = startGame(g, sharp)
    const row = staffTable(g, G)[1]
    const c = classify({ turn: 0, defender: defend(g, G, { type: 'isolate', id: row.id }).pending.defender })
    expect(c).toMatchObject({ rank: 2, agreed: false, tied: false, decided: true })
  })
  it('ignores a pass and anything that is not an isolation', () => {
    expect(classify({ turn: 0, defender: null })).toBe(null)
    expect(classify({ turn: 0 })).toBe(null)
    expect(classify(null)).toBe(null)
    expect(classify({ turn: 0, defender: { type: 'other', id: 'X' } })).toBe(null)
  })
  it('marks a record with no staff table as unrecorded rather than as agreement', () => {
    const c = classify({ turn: 2, defender: { type: 'isolate', id: 'RELAY-1', cost: 0, actor: 'human', rank: 4 } })
    expect(c).toMatchObject({ recorded: false, agreed: false, tied: false, decided: false, blocks: null, rank: 4 })
  })
  it('falls back to what a pre-tiedTop record proves, and never invents a tie', () => {
    const row = (id, rank, net) => ({ id, rank, net, cost: 0, blocks: 0, gainBlocked: 0 })
    // same net as the top while not being the top row: a tie of at least two
    const a = classify({ turn: 0, defender: { type: 'isolate', id: 'B', rank: 3, staff: { rows: 9, chosen: row('B', 3, 0), top: row('A', 1, 0) } } })
    expect(a).toMatchObject({ agreed: true, tied: true, tieSize: 2 })
    // rank 1 on such a record cannot be shown to be tied, so it is not
    const b = classify({ turn: 0, defender: { type: 'isolate', id: 'A', rank: 1, staff: { rows: 9, chosen: row('A', 1, 0), top: row('A', 1, 0) } } })
    expect(b).toMatchObject({ agreed: true, tied: false, tieSize: 1, decided: true })
  })
})

describe('agreementOf prints a denominator and refuses a rate it cannot have', () => {
  it('computes the headline only over decisions the staff had a preference about', () => {
    const G = play(flat, [tiedPick, worst])
    const a = agreementOf(decisionsOf(G))
    expect(a.isolations).toBe(2)       // the denominator, printed as 2
    expect(a.tied).toBe(1)             // the flat-table pick, reported on its own
    expect(a.decided).toBe(1)          // only the strictly worse pick counts
    expect(a.agreed).toBe(0)
    expect(a.rate).toBe(0)
    expect(a.allTied).toBe(false)
  })
  it('gives no agreement figure at all when every decision was tied', () => {
    const G = play(flat, [tiedPick, tiedPick])
    const ds = decisionsOf(G)
    // the operator did NOT pick rank 1 either time, and it is still not a
    // disagreement: the staff had no preference to disagree with
    expect(ds.every((d) => d.rank > 1)).toBe(true)
    const a = agreementOf(ds)
    expect(a.isolations).toBe(2)
    expect(a.tied).toBe(2)
    expect(a.decided).toBe(0)
    expect(a.rate).toBe(null)
    expect(a.medianRank).toBe(null)
    expect(a.top3Rate).toBe(null)
    expect(a.allTied).toBe(true)
  })
  it('does not call a game with no isolation a fully tied one', () => {
    const a = agreementOf(decisionsOf(play(flat, [() => null, () => null])))
    expect(a).toMatchObject({ isolations: 0, tied: 0, decided: 0, rate: null, allTied: false })
  })
  it('counts a rank-1 pick on a table with a unique best as agreement', () => {
    const a = agreementOf(decisionsOf(play(sharp, [atRank(1)])))
    expect(a).toMatchObject({ isolations: 1, decided: 1, agreed: 1, rate: 1, tied: 0, medianRank: 1, top3: 1, top3Rate: 1 })
  })
  it('reports the median rank and the top-3 share over the decided set only', () => {
    const ds = [
      { recorded: true, tied: true, decided: false, agreed: true, rank: 9 },
      { recorded: true, tied: false, decided: true, agreed: true, rank: 1 },
      { recorded: true, tied: false, decided: true, agreed: false, rank: 2 },
      { recorded: true, tied: false, decided: true, agreed: false, rank: 5 },
      { recorded: true, tied: false, decided: true, agreed: false, rank: 8 },
    ]
    const a = agreementOf(ds)
    expect(a.isolations).toBe(5)
    expect(a.decided).toBe(4)
    expect(a.rate).toBe(0.25)
    expect(a.medianRank).toBe(3.5)     // 1, 2, 5, 8 - the tied 9 is not in it
    expect(a.top3).toBe(2)
    expect(a.top3Rate).toBe(0.5)
  })
  it('separates records that carry no staff table from the agreement counts', () => {
    const a = agreementOf([
      { recorded: false, tied: false, decided: false, agreed: false, rank: 4 },
      { recorded: true, tied: false, decided: true, agreed: true, rank: 1 },
    ])
    expect(a).toMatchObject({ isolations: 2, unrecorded: 1, decided: 1, agreed: 1, rate: 1 })
  })
})

describe('firstEffectiveOf', () => {
  it('is the turn of the first isolation that removed attacker moves', () => {
    const G = play(flat, [noBlocks, blocking, noBlocks])
    const fe = firstEffectiveOf(decisionsOf(G))
    expect(fe.turn).toBe(1)
    expect(fe.blocks).toBeGreaterThan(0)
    expect(fe.id).toBe(G.history[1].defender.id)
    expect(fe.measured).toBe(3)
  })
  it('is null - not zero - when no isolation ever removed a move', () => {
    const G = play(flat, [noBlocks, noBlocks])
    const fe = firstEffectiveOf(decisionsOf(G))
    expect(fe).toMatchObject({ turn: null, id: null, blocks: null, effective: 0, measured: 2 })
  })
  it('is null when nothing was isolated at all', () => {
    expect(firstEffectiveOf(decisionsOf(play(flat, [() => null])))).toMatchObject({ turn: null, measured: 0 })
  })
  it('does not guess from a record with no staff table', () => {
    const fe = firstEffectiveOf([{ recorded: false, blocks: null, turn: 1 }])
    expect(fe).toMatchObject({ turn: null, measured: 0, effective: 0 })
  })
})

describe('approval is an invariant, not a metric', () => {
  it('holds for a run played through the panel, and reports no rate', () => {
    const ap = approvalOf(decisionsOf(play(flat, [atRank(1), atRank(2)])))
    expect(ap).toEqual({ isolations: 2, human: 2, other: 0, holds: true })
    expect(ap.rate).toBeUndefined()      // a percentage here would be theatre
    expect(ap.percent).toBeUndefined()
  })
  it('holds vacuously with no isolation', () => {
    expect(approvalOf([])).toEqual({ isolations: 0, human: 0, other: 0, holds: true })
  })
  it('goes false the moment a row is not a person, instead of rounding to 100%', () => {
    const G = startGame(g, flat)
    const table = staffTable(g, G)
    const G1 = attackerTurn(g, defend(g, G, { type: 'isolate', id: table[0].id, actor: 'system' }))
    const ap = approvalOf(decisionsOf(G1))
    expect(ap).toEqual({ isolations: 1, human: 0, other: 1, holds: false })
  })
})

describe('aarMetrics', () => {
  it('bundles the three readings with the turn and pass counts', () => {
    const G = play(flat, [atRank(1), () => null, atRank(3)])
    const m = aarMetrics(G)
    expect(m.turns).toBe(3)
    expect(m.passes).toBe(1)
    expect(m.decisions.length).toBe(2)
    expect(m.agreement.isolations).toBe(2)
    expect(m.approval.holds).toBe(true)
    expect(m.firstEffective.measured).toBe(2)
  })
  it('survives an absent or empty game without inventing numbers', () => {
    for (const G of [null, undefined, {}, { history: [] }]) {
      const m = aarMetrics(G)
      expect(m.turns).toBe(0)
      expect(m.agreement).toMatchObject({ isolations: 0, rate: null, medianRank: null, allTied: false })
      expect(m.firstEffective.turn).toBe(null)
      expect(m.approval.holds).toBe(true)
    }
  })
  it('is deterministic for the same seed and the same picks', () => {
    const once = () => JSON.stringify(aarMetrics(play(sharp, [atRank(1), atRank(2), () => null])))
    expect(once()).toBe(once())
  })
})
