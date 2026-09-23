// Wargame core (ADR-0026). Pure functions over the attacker engine
// (attack.js) and the mission engine (engine.js): a game is a value, every
// action returns a new one, and the same seed with the same actions gives the
// same history. Nothing here touches the DOM or the network - the LLM
// attacker's pick is handed in as a constant chooser by the caller.
//
// Isolation is the defender's one move. It means two different things on
// purpose: to the mission engine the asset is down (compromise 1, the same
// arithmetic the 대응 tab uses), to the attacker the asset does not exist
// (attack.js `isolated`). Isolating a fully compromised asset costs the
// mission nothing and stops the spread - that choice is the game.

import { legalMoves, scoreMoves, playTurn, footholds, greedyChooser, randomChooser, orderMoves } from './attack.js'
import { runChain } from './engine.js'

const DEFAULTS = { mode: 'hold', turns: 8, t: 0, foothold: null, seed: 20260906, strategy: 'greedy', method: 'weighted' }

export function compromiseOf(G) {
  const s = { ...(G.attacker || {}) }
  for (const id of G.isolated || []) s[id] = 1
  return s
}

function missionsAt(g, G) {
  return runChain(g, compromiseOf(G), { t: G.cfg.t, method: G.cfg.method, causes: 'all' }).mission
}

// priority-weighted sum, the same weight scoreMoves uses for the attacker
export function weightedOf(g, missions) {
  let s = 0
  for (const m of g.missions || []) s += (missions[m.id] || 0) / Math.max(1, Number(m.priority) || 1)
  return Number(s.toFixed(6))
}

function p1Of(g, missions) {
  const m = [...(g.missions || [])].sort((a, b) => (a.priority || 9) - (b.priority || 9))[0]
  return m ? Number(missions[m.id] || 0) : 0
}

// The first asset the authored attack timeline compromises, at its first level.
export function defaultFoothold(payload) {
  for (const st of payload?.attack?.steps || []) {
    const ids = Object.keys(st.state || {}).filter((k) => Number(st.state[k]) > 0)
    if (ids.length) return { id: ids[0], level: Number(st.state[ids[0]]) }
  }
  return null
}

export function startGame(g, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  // footholds[] (several seeds, the presets) wins when present; foothold
  // (one seed) is the original shape and every existing caller. Both end up
  // in the same attacker map, so the rest of the game does not know which.
  const seeds = Array.isArray(c.footholds) && c.footholds.length ? c.footholds : (c.foothold && c.foothold.id ? [c.foothold] : [])
  const attacker = Object.fromEntries(seeds.filter((f) => f && f.id).map((f) => [f.id, Number(f.level) || 0.5]))
  return {
    cfg: c, turn: 0, phase: 'defend', attacker, isolated: [], pending: null,
    history: [], score: { total: 0, perTurn: [], isolationCost: 0 }, result: null,
  }
}

// The attacker's options, in the attacker's own order (attack.js orderMoves).
// The panel must not rank them its own way: the head of this list is the move
// greedy will actually play. `orderMoves` gets G.attacker, the same state
// playTurn hands the chooser - isolated assets are excluded from the moves
// themselves, so the compromise-merged state used for scoring would give the
// same answer, but there is no reason for the two to differ.
export function legalFor(g, G) {
  const legal = legalMoves(g, G.attacker, G.cfg.t, { isolated: G.isolated })
  const scored = scoreMoves(g, compromiseOf(G), G.cfg.t, legal, G.cfg.method)
  return orderMoves(scored, { g, state: G.attacker, t: G.cfg.t })
}

export function isolationCost(g, G, id) {
  const before = weightedOf(g, missionsAt(g, G))
  const after = weightedOf(g, missionsAt(g, { ...G, isolated: [...G.isolated, id] }))
  return Number((after - before).toFixed(6))
}

export function defend(g, G, act) {
  if (!G || G.phase !== 'defend' || G.result) return G
  if (!act || act.type !== 'isolate' || !act.id) return G
  if (G.isolated.includes(act.id)) return G
  if (!(g.assets || []).some((a) => a.id === act.id)) return G
  const cost = isolationCost(g, G, act.id)
  return { ...G, isolated: [...G.isolated, act.id], phase: 'attack', pending: { defender: { type: 'isolate', id: act.id, cost } } }
}

export function pass(G) {
  if (!G || G.phase !== 'defend' || G.result) return G
  return { ...G, phase: 'attack', pending: { defender: null } }
}

export function chooserFor(G) {
  if (G.cfg.strategy === 'random') return randomChooser(G.cfg.seed + G.turn)
  return greedyChooser
}

export function attackerTurn(g, G, chooser) {
  if (!G || G.phase !== 'attack' || G.result) return G
  const r = playTurn(g, G.attacker, G.cfg.t, {
    method: G.cfg.method, seed: G.cfg.seed, turn: G.turn,
    chooser: chooser || chooserFor(G), isolated: G.isolated,
  })
  const attacker = r.move ? r.state : G.attacker
  const next = { ...G, attacker, pending: null }
  const missions = missionsAt(g, next)
  const rec = {
    turn: G.turn,
    defender: (G.pending && G.pending.defender) || null,
    attacker: r.move ? {
      move: { id: r.move.id, action: r.move.action, label: r.move.label, from: r.move.from, target: r.move.target, technique: r.move.technique, gain: r.move.gain, p: r.move.p },
      success: r.success, roll: r.roll, rationale: r.rationale || null, cited: r.cited || null,
    } : null,
    reason: r.move ? null : (r.reason || 'no legal move'),
    missions,
    p1: p1Of(g, missions),
    weighted: weightedOf(g, missions),
  }
  next.history = [...G.history, rec]
  next.turn = G.turn + 1
  next.phase = 'defend'
  return evaluate(g, next)
}

export function evaluate(g, G) {
  const jewels = g.crown_jewels || []
  let result = G.result || null
  if (!result && G.cfg.mode === 'jewel') {
    const lost = jewels.find((id) => !(G.isolated || []).includes(id) && Number((G.attacker || {})[id] || 0) >= 1)
    if (lost) result = { win: false, reason: `${lost} 장악`, at: G.turn }
  }
  if (!result && G.turn >= G.cfg.turns) {
    if (G.cfg.mode === 'hold') {
      const last = G.history[G.history.length - 1]
      const p1 = last ? Number(last.p1) : 0
      result = { win: p1 < 0.5, reason: p1 < 0.5 ? 'P1 임무 저하도 50% 미만 유지' : 'P1 임무 저하도 50% 이상', at: G.turn }
    } else {
      result = { win: true, reason: `${G.cfg.turns}턴 동안 보석 방어`, at: G.turn }
    }
  }
  const perTurn = G.history.map((h) => Number(h.weighted) || 0)
  const isolationCostSum = Number(G.history.reduce((s, h) => s + ((h.defender && h.defender.cost) || 0), 0).toFixed(6))
  const total = G.cfg.mode === 'hold'
    ? Number(perTurn.reduce((a, b) => a + b, 0).toFixed(6))
    : Math.round((result ? result.at : G.turn) * 100 - isolationCostSum * 100)
  return { ...G, score: { total, perTurn, isolationCost: isolationCostSum }, result, phase: result ? 'over' : G.phase }
}

// The staff's ranking. Rules only: what an isolation costs the mission, how
// many of the attacker's current moves it removes, and the biggest gain among
// those. A model may narrate this table; it never reorders it (ADR-0003).
export function staffTable(g, G) {
  const legal = legalFor(g, G)
  const rows = (g.assets || []).map((a) => a.id).filter((id) => !G.isolated.includes(id)).map((id) => {
    const cost = isolationCost(g, G, id)
    const after = new Set(legalMoves(g, G.attacker, G.cfg.t, { isolated: [...G.isolated, id] }).map((m) => m.id))
    const removed = legal.filter((m) => !after.has(m.id))
    const gainBlocked = removed.reduce((mx, m) => Math.max(mx, m.gain), 0)
    return { id, cost, blocks: removed.length, gainBlocked: Number(gainBlocked.toFixed(6)), net: Number((gainBlocked - cost).toFixed(6)) }
  })
  rows.sort((a, b) => (b.net - a.net) || (b.blocks - a.blocks) || a.id.localeCompare(b.id))
  return rows.map((r, i) => ({ ...r, rank: i + 1 }))
}
