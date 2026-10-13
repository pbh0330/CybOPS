// What the wargame panel contributes to the decision record (U2).
//
// `rank` and `cost` are game.js's (and tested there). The panel's own share is
// `basis`: the fact numbers that were ON SCREEN when the operator committed.
// That claim is only true if the list is cut where the card is cut, which is
// what this file holds down - a basis listing a row the reader could not see
// would be a false record, and nothing downstream could tell.

import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import defnet from '../../public/data/defnet-01.replay.json'
import { startGame, staffTable, legalFor, defaultFoothold } from '../game.js'
import { staffFacts } from '../staff-llm.mjs'
import { STAFF_ROWS, visibleBasis, startFoothold } from '../ui/Wargame.jsx'

const g = replay.graph
const G = startGame(g, { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' })
const rows = staffTable(g, G)
const facts = staffFacts(g, G, rows, 0.3)

describe('visibleBasis', () => {
  it('takes the turn line plus one id per row the card actually shows', () => {
    expect(rows.length).toBeGreaterThan(STAFF_ROWS)
    expect(visibleBasis(facts, rows)).toEqual(['F1', 'F2', 'F3', 'F4'])
  })
  it('never claims a fact the card did not draw', () => {
    // staffFacts builds five rows; the card draws STAFF_ROWS of them.
    expect(facts.length).toBeGreaterThan(1 + STAFF_ROWS)
    expect(visibleBasis(facts, rows).length).toBe(1 + STAFF_ROWS)
  })
  it('shrinks with the table rather than padding', () => {
    expect(visibleBasis(facts, rows.slice(0, 2))).toEqual(['F1', 'F2', 'F3'])
    expect(visibleBasis(facts, [])).toEqual(['F1'])
  })
  it('is empty when there is no card, instead of inventing F1', () => {
    expect(visibleBasis([], rows)).toEqual([])
    expect(visibleBasis(null, rows)).toEqual([])
  })
})

// Where the start card seeds the attacker. The scenario's declared wargame
// foothold wins over the replay's first compromise state, because the latter is
// a propagation input: defnet-01's is WKS003 at 0.3, under attack.js's
// threshold, and a game seeded there is over before turn one.
describe('startFoothold', () => {
  it('prefers the scenario declaration over the replay timeline', () => {
    expect(defaultFoothold(defnet)).toEqual({ id: 'WKS003', level: 0.3 })
    expect(startFoothold(defnet.graph, defnet)).toEqual({ id: 'WKS003', level: 0.5 })
  })

  it('falls back to the replay timeline when nothing is declared', () => {
    expect(replay.graph.wargame).toBeUndefined()
    expect(startFoothold(replay.graph, replay)).toEqual(defaultFoothold(replay))
  })

  it('declares a seed the attacker can actually act from', () => {
    for (const p of [defnet, replay]) {
      const t = p.graph.timeline ? 300 : -1
      const cfg = { mode: 'hold', turns: 8, t, seed: 11, strategy: 'greedy', foothold: startFoothold(p.graph, p) }
      expect(legalFor(p.graph, startGame(p.graph, cfg)).length).toBeGreaterThan(0)
    }
    // and the level the card used to inherit really would have been unplayable
    const dead = { mode: 'hold', turns: 8, t: -1, seed: 11, strategy: 'greedy', foothold: defaultFoothold(defnet) }
    expect(legalFor(defnet.graph, startGame(defnet.graph, dead))).toEqual([])
  })
})
