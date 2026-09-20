import { describe, it, expect } from 'vitest'
import payload from '../../public/data/tacnet-01.replay.json'
import { runStep } from '../engine.js'
import { footholds } from '../attack.js'
import {
  startGame, defaultFoothold, legalFor, isolationCost, defend, pass, attackerTurn,
  evaluate, staffTable, compromiseOf,
} from '../game.js'

const g = payload.graph
const base = { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' }

describe('startGame / defaultFoothold', () => {
  it('seeds the attacker with the foothold and starts in the defend phase', () => {
    const G = startGame(g, base)
    expect(G.attacker).toEqual({ 'CO2-VEH': 0.8 })
    expect(G).toMatchObject({ turn: 0, phase: 'defend', isolated: [], history: [], result: null })
    expect(G.score).toEqual({ total: 0, perTurn: [], isolationCost: 0 })
  })
  it('defaultFoothold reads the first compromised asset of the attack timeline', () => {
    expect(defaultFoothold(payload)).toEqual({ id: 'CO2-VEH', level: 0.5 })
    expect(defaultFoothold({ attack: { steps: [] } })).toBe(null)
  })
})

describe('isolation', () => {
  it('compromiseOf merges isolated assets as 1 without touching attacker levels', () => {
    const G = defend(g, startGame(g, base), { type: 'isolate', id: 'RELAY-1' })
    expect(G.attacker).toEqual({ 'CO2-VEH': 0.8 })
    expect(compromiseOf(G)).toEqual({ 'CO2-VEH': 0.8, 'RELAY-1': 1 })
    expect(footholds(G.attacker, G.isolated)).toEqual(['CO2-VEH'])
  })
  it('isolationCost equals the engine what-if delta, priority-weighted', () => {
    const G = startGame(g, base)
    const step = runStep(g, compromiseOf(G), { t: 150, method: 'weighted', candidates: ['TOC-SRV'] })
    let want = 0
    for (const m of g.missions) want += (step.whatif['TOC-SRV'].delta[m.id] || 0) / Math.max(1, m.priority || 1)
    expect(isolationCost(g, G, 'TOC-SRV')).toBeCloseTo(want, 6)
  })
  it('defend moves to the attack phase, records cost, and is ignored outside the defend phase', () => {
    const G1 = defend(g, startGame(g, base), { type: 'isolate', id: 'RELAY-1' })
    expect(G1.phase).toBe('attack')
    expect(G1.pending.defender).toMatchObject({ type: 'isolate', id: 'RELAY-1' })
    const G2 = defend(g, G1, { type: 'isolate', id: 'TOC-SRV' })
    expect(G2).toBe(G1)
    expect(pass(startGame(g, base))).toMatchObject({ phase: 'attack', pending: { defender: null } })
  })
})

describe('turns and reproducibility', () => {
  it('attackerTurn appends history, advances the turn, and returns to defend', () => {
    const G = attackerTurn(g, pass(startGame(g, base)))
    expect(G.turn).toBe(1)
    expect(G.phase).toBe('defend')
    expect(G.history.length).toBe(1)
    expect(G.history[0]).toMatchObject({ turn: 0, defender: null })
    expect(typeof G.history[0].p1).toBe('number')
    expect(G.score.perTurn.length).toBe(1)
  })
  it('the same seed and the same actions give the same history', () => {
    const play = () => {
      let G = startGame(g, base)
      G = attackerTurn(g, pass(G))
      G = attackerTurn(g, defend(g, G, { type: 'isolate', id: 'RELAY-1' }))
      G = attackerTurn(g, pass(G))
      return G
    }
    expect(play().history).toEqual(play().history)
  })
})

describe('evaluate: hold', () => {
  const done = (p1) => ({ ...startGame(g, { ...base, turns: 1 }), turn: 1, history: [{ turn: 0, defender: null, attacker: null, missions: {}, p1, weighted: 0.3 }] })
  it('wins when P1 < 0.5 at the end, loses otherwise, and scores the weighted sum', () => {
    const w = evaluate(g, done(0.2))
    expect(w.result).toMatchObject({ win: true })
    expect(w.phase).toBe('over')
    expect(w.score.total).toBeCloseTo(0.3, 6)
    expect(evaluate(g, done(0.7)).result).toMatchObject({ win: false })
  })
  it('does not end before the turn budget', () => {
    const G = { ...done(0.2), turn: 0 }
    expect(evaluate(g, { ...G, cfg: { ...G.cfg, turns: 3 } }).result).toBe(null)
  })
})

describe('evaluate: jewel', () => {
  it('loses the moment the attacker fully owns a crown jewel, scoring turns*100 - isolation cost*100', () => {
    let G = startGame(g, { ...base, mode: 'jewel', turns: 8 })
    G = { ...G, turn: 3, attacker: { 'CO2-VEH': 0.8, 'TOC-SRV': 1 },
      history: [{ turn: 2, defender: { type: 'isolate', id: 'FDC-SRV', cost: 0.25 }, attacker: null, missions: {}, p1: 1, weighted: 1 }] }
    const r = evaluate(g, G)
    expect(r.result).toMatchObject({ win: false, at: 3 })
    expect(r.result.reason).toContain('TOC-SRV')
    expect(r.score.total).toBe(3 * 100 - 25)
  })
  it('an isolated crown jewel is not a loss', () => {
    let G = startGame(g, { ...base, mode: 'jewel', turns: 2 })
    G = { ...G, turn: 2, isolated: ['TOC-SRV'], history: [] }
    expect(evaluate(g, G).result).toMatchObject({ win: true })
  })
})

describe('staffTable', () => {
  it('ranks by net (gainBlocked - cost), then blocks, and only lists non-isolated assets', () => {
    const G = defend(g, startGame(g, base), { type: 'isolate', id: 'FDC-TERM' })
    const rows = staffTable(g, { ...G, phase: 'defend' })
    expect(rows.some((r) => r.id === 'FDC-TERM')).toBe(false)
    expect(rows[0].rank).toBe(1)
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]
      expect(a.net > b.net || (a.net === b.net && a.blocks >= b.blocks)).toBe(true)
    }
    // isolating the attacker's only foothold blocks every move
    const co2 = rows.find((r) => r.id === 'CO2-VEH')
    expect(co2.blocks).toBe(legalFor(g, G).length)
  })
})
