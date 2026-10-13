// What the wargame panel contributes to the decision record (U2).
//
// `rank` and `cost` are game.js's (and tested there). The panel's own share is
// `basis`: the fact numbers that were ON SCREEN when the operator committed.
// That claim is only true if the list is cut where the card is cut, which is
// what this file holds down - a basis listing a row the reader could not see
// would be a false record, and nothing downstream could tell.

import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import { startGame, staffTable } from '../game.js'
import { staffFacts } from '../staff-llm.mjs'
import { STAFF_ROWS, visibleBasis } from '../ui/Wargame.jsx'

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
