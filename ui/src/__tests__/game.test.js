import { describe, it, expect } from 'vitest'
import payload from '../../public/data/tacnet-01.replay.json'
import { runStep } from '../engine.js'
import { footholds, greedyChooser } from '../attack.js'
import {
  startGame, defaultFoothold, legalFor, isolationCost, defend, pass, attackerTurn,
  evaluate, staffTable, compromiseOf, strategyOf,
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
  it('footholds[] seeds several assets at once (presets)', () => {
    const G = startGame(g, { ...base, foothold: null, footholds: [{ id: 'CO2-VEH', level: 0.5 }, { id: 'FO-TAB', level: 0.5 }] })
    expect(G.attacker).toEqual({ 'CO2-VEH': 0.5, 'FO-TAB': 0.5 })
    expect(footholds(G.attacker, G.isolated).sort()).toEqual(['CO2-VEH', 'FO-TAB'])
  })
  it('foothold alone gives the same attacker as before footholds[] existed', () => {
    expect(startGame(g, base).attacker).toEqual({ 'CO2-VEH': 0.8 })
    expect(startGame(g, { ...base, footholds: [] }).attacker).toEqual({ 'CO2-VEH': 0.8 })
    expect(startGame(g, { ...base, foothold: null }).attacker).toEqual({})
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
  it('a full game reaches over through attackerTurn alone, with one history row per turn', () => {
    let G = startGame(g, { ...base, turns: 3 })
    for (let i = 0; i < 3; i++) G = attackerTurn(g, pass(G))
    expect(G.phase).toBe('over')
    expect(G.history.length).toBe(3)
    expect(G.result).not.toBe(null)
    expect(G.result.at).toBe(3)
  })
  it('a turn with no legal attacker move still advances and records why', () => {
    let G = defend(g, startGame(g, base), { type: 'isolate', id: 'CO2-VEH' })
    G = attackerTurn(g, G)
    expect(G.turn).toBe(1)
    expect(G.history[0].attacker).toBe(null)
    expect(G.history[0].reason).toBeTruthy()
    expect(G.phase).toBe('defend')
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
  it('an isolated jewel that the attacker has does not cause a loss', () => {
    let G = startGame(g, { ...base, mode: 'jewel', turns: 8 })
    G = { ...G, turn: 1, attacker: { 'TOC-SRV': 1 }, isolated: ['TOC-SRV'], history: [] }
    expect(evaluate(g, G).result).toBe(null)
  })
})

describe('legalFor is the attacker order, not the panel own order', () => {
  it('its head is the move greedy plays, at a flat-gain time too', () => {
    // t=0 from a 0.5 foothold: every move scores gain 0. The panel used to
    // sort gain -> p -> id, so it listed recon (p 0.95) first while the
    // engine played something else (2026-09-23, ADR-0019 amendment).
    const G = startGame(g, { ...base, t: 0, foothold: { id: 'CO2-VEH', level: 0.5 } })
    const rows = legalFor(g, G)
    expect(rows.length).toBeGreaterThan(1)
    expect(Math.max(...rows.map((m) => m.gain))).toBe(0)   // the flat premise
    expect(rows[0].action).not.toBe('recon')
    expect(rows[rows.length - 1].action).toBe('recon')     // last resort, last row
    expect(rows[0].id).toBe(greedyChooser(rows, { g, state: G.attacker, t: G.cfg.t }).move.id)
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

// --- the decision record (ADR-0004, U2) ----------------------------------
//
// ADR-0004 demands a human approval and we were keeping no record of it. These
// check the record, not the isolation: who pressed, what was on screen, where
// the staff table had the asset, and what the operator typed. `rank` is the
// load-bearing one - U4's agreement metric is computed from it.

describe('defend writes a decision record', () => {
  const G0 = startGame(g, base)
  const table = staffTable(g, G0)
  const third = table[2]

  it('records the actor, the basis, the rank and the one line', () => {
    const d = defend(g, G0, {
      type: 'isolate', id: third.id, actor: 'human',
      basis: ['F1', 'F2'], rationale: '  단일 경로라서\n ',
    }).pending.defender
    // the three fields that were here before U2 keep their meaning
    expect(d).toMatchObject({ type: 'isolate', id: third.id })
    expect(d.cost).toBeCloseTo(isolationCost(g, G0, third.id), 6)
    expect(d.actor).toBe('human')
    expect(d.basis).toEqual(['F1', 'F2'])
    expect(d.rank).toBe(3)
    expect(d.rationale).toBe('단일 경로라서')
  })

  it('keeps the two staffTable rows a later question cannot recompute', () => {
    const d = defend(g, G0, { type: 'isolate', id: third.id }).pending.defender
    expect(d.staff.rows).toBe(table.length)
    expect(d.staff.chosen).toEqual({
      id: third.id, rank: third.rank, cost: third.cost,
      blocks: third.blocks, gainBlocked: third.gainBlocked, net: third.net,
    })
    expect(d.staff.top.id).toBe(table[0].id)
    expect(d.staff.top.rank).toBe(1)
  })

  it('reads the rank off the engine, so a caller cannot assert one', () => {
    const d = defend(g, G0, { type: 'isolate', id: third.id, rank: 1 }).pending.defender
    expect(d.rank).toBe(3)
    expect(d.rank).toBe(table.find((r) => r.id === third.id).rank)
  })

  it('isolating the staff first choice records rank 1', () => {
    const d = defend(g, G0, { type: 'isolate', id: table[0].id }).pending.defender
    expect(d.rank).toBe(1)
    expect(d.staff.top.id).toBe(d.id)
  })

  it('takes only well-formed fact ids as the basis, deduped and in order', () => {
    const d = (basis) => defend(g, G0, { type: 'isolate', id: third.id, basis }).pending.defender.basis
    expect(d(['F2', 'junk', 'F2', 'F10', null, 3, ' F1 '])).toEqual(['F2', 'F10', 'F1'])
    expect(d('F1')).toEqual([])
    expect(d(undefined)).toEqual([])
    expect(d(Array.from({ length: 30 }, (_, i) => `F${i + 1}`)).length).toBe(12)
  })

  it('defaults the actor to human and admits nothing but system beside it', () => {
    const actor = (v) => defend(g, G0, { type: 'isolate', id: third.id, actor: v }).pending.defender.actor
    expect(actor(undefined)).toBe('human')
    expect(actor('robot')).toBe('human')
    expect(actor('greedy')).toBe('human')
    expect(actor('system')).toBe('system')
  })

  it('treats an empty rationale as none, and clamps a long one', () => {
    const why = (v) => defend(g, G0, { type: 'isolate', id: third.id, rationale: v }).pending.defender.rationale
    expect(why(undefined)).toBe(null)
    expect(why('   ')).toBe(null)
    expect(why('a\u0000b')).toBe('a b')
    expect(why('x'.repeat(400)).length).toBe(140)
  })

  it('carries the record into history and leaves the score arithmetic alone', () => {
    let G = defend(g, G0, { type: 'isolate', id: third.id, basis: ['F1'], rationale: '시험' })
    G = attackerTurn(g, G)
    const d = G.history[0].defender
    expect(d.rank).toBe(3)
    expect(d.basis).toEqual(['F1'])
    expect(d.actor).toBe('human')
    expect(G.score.isolationCost).toBeCloseTo(d.cost, 6)
  })

  it('records nothing for a pass - there was no decision to record', () => {
    expect(pass(G0).pending.defender).toBe(null)
  })

  it('is deterministic, record and all', () => {
    const play = () => {
      let G = startGame(g, base)
      G = attackerTurn(g, defend(g, G, { type: 'isolate', id: 'RELAY-1', basis: ['F1', 'F3'], rationale: '같은 입력' }))
      return attackerTurn(g, pass(G))
    }
    expect(play().history).toEqual(play().history)
  })
})

describe('an attack row says what played it', () => {
  it('names the strategy per row instead of leaving it in cfg', () => {
    const G = attackerTurn(g, pass(startGame(g, base)))
    expect(G.history[0].attacker.by).toBe('greedy')
    const R = attackerTurn(g, pass(startGame(g, { ...base, strategy: 'random' })))
    expect(R.history[0].attacker.by).toBe('random')
  })
  it('does not write llm on a row no model chose', () => {
    // strategy 'llm' with no chooser handed in falls back to greedyChooser
    // (chooserFor has no llm branch), so the row must not name a model.
    const G = attackerTurn(g, pass(startGame(g, { ...base, strategy: 'llm' })))
    expect(G.history[0].attacker.by).toBe('greedy')
    const L = attackerTurn(g, pass(startGame(g, { ...base, strategy: 'llm' })), greedyChooser)
    expect(L.history[0].attacker.by).toBe('llm')
  })
  it('strategyOf is that rule on its own', () => {
    const of = (strategy, injected) => strategyOf({ cfg: { strategy } }, injected)
    expect(of('greedy', false)).toBe('greedy')
    expect(of('greedy', true)).toBe('greedy')
    expect(of('random', false)).toBe('random')
    expect(of('llm', false)).toBe('greedy')
    expect(of('llm', true)).toBe('llm')
    expect(of('', false)).toBe('greedy')
    expect(strategyOf(null, false)).toBe('greedy')
  })
})
