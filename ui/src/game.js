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

// --- the decision record (ADR-0004) --------------------------------------
//
// ADR-0004 makes a person approve every containment and forbids an automatic
// execution path. The approval was enforced and then thrown away: a history
// row said WHAT was isolated and what it cost, and nothing said who chose it,
// what they were looking at, or where the staff table had ranked it. Nobody
// could ask afterwards why RELAY-1 was isolated at turn 3 when the staff had
// something else first.
//
// What goes in is a RECORD, not an order. There is still no execution path
// in this file - isolation moves a simulated state and nothing else - and the
// staff catalogue's `actions` stays []. Recording a decision is not an action.
// The shape comes from two places: 혜안's audit log tags each entry with
// whether a human or the system acted (ours is `actor`), and ARGOS pins an
// authority onto each action spec.
//
// `rank` is the load-bearing field: U4 computes the operator's agreement with
// the staff ranking from it, which is what ADR-0015 promised when it dropped
// expert evaluation in favour of rank disagreement. So it is NOT taken from
// the caller. It is read off `staffTable(g, G)` here, on the pre-isolation
// state, which is exactly the table the defend phase had on screen. A rank the
// UI passed in would be a number nothing could check.
//
// `staff` keeps the two rows of that table a later question cannot recompute.
// The game moves on - the attacker gains ground, more assets get isolated - so
// by the time anyone asks about turn 3 the turn-3 table is gone. The chosen
// row and the rank-1 row are kept because "what was first, and how did the two
// compare on cost and on moves blocked" is the whole question.
//
// Everything in the record is engine output or operator input. No model writes
// any of it (ADR-0003).

const FACT_ID = /^F\d+$/
const BASIS_MAX = 12

// The fact numbers that were on screen when the operator committed. Only
// well-formed ids, deduped, in the order they were given: this is a record of
// what was visible, not a claim that those facts say anything in particular.
// They are the numbering of THAT staff card, not of any later answer.
function basisOf(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const x of v) {
    const s = String(x === null || x === undefined ? '' : x).trim()
    if (FACT_ID.test(s) && !out.includes(s)) out.push(s)
  }
  return out.slice(0, BASIS_MAX)
}

const RATIONALE_MAX = 140

// One optional line the operator typed. Control characters out, whitespace
// collapsed, clamped: it is shown on screen and it ends up in a fact that a
// model may read out, and the model's prompt already says fact text is data
// rather than instructions (staff-llm.mjs).
function rationaleOf(v) {
  if (v === null || v === undefined) return null
  const s = String(v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, RATIONALE_MAX)
  return s || null
}

// 'human' unless the caller says otherwise, and the only other thing it can
// say is 'system'. No caller passes 'system' today, because no automatic path
// exists (ADR-0004). The field is here so that if one is ever written - an
// autoplay harness for U4's metrics, say - it cannot pass itself off as a
// person by default, which is the whole point of 혜안's actorType.
const ACTORS = ['human', 'system']
const actorOf = (v) => (ACTORS.includes(v) ? v : 'human')

const staffRow = (r) => (r ? {
  id: r.id, rank: r.rank, cost: r.cost, blocks: r.blocks, gainBlocked: r.gainBlocked, net: r.net,
} : null)

export function defend(g, G, act) {
  if (!G || G.phase !== 'defend' || G.result) return G
  if (!act || act.type !== 'isolate' || !act.id) return G
  if (G.isolated.includes(act.id)) return G
  if (!(g.assets || []).some((a) => a.id === act.id)) return G
  const cost = isolationCost(g, G, act.id)
  // The table as it stood when the button was pressed. Same call the panel
  // renders from, on the same state, so the recorded rank is the rank that was
  // on screen (ADR-0003 - the record reads the table, it does not re-rank it).
  const table = staffTable(g, G)
  const chosen = table.find((r) => r.id === act.id) || null
  return {
    ...G,
    isolated: [...G.isolated, act.id],
    phase: 'attack',
    pending: {
      defender: {
        // the three fields that were here before, unchanged in meaning
        type: 'isolate', id: act.id, cost,
        actor: actorOf(act.actor),
        basis: basisOf(act.basis),
        rank: chosen ? chosen.rank : null,
        rationale: rationaleOf(act.rationale),
        staff: { rows: table.length, chosen: staffRow(chosen), top: staffRow(table[0] || null) },
      },
    },
  }
}

export function pass(G) {
  if (!G || G.phase !== 'defend' || G.result) return G
  return { ...G, phase: 'attack', pending: { defender: null } }
}

export function chooserFor(G) {
  if (G.cfg.strategy === 'random') return randomChooser(G.cfg.seed + G.turn)
  return greedyChooser
}

// Which chooser produced one attack row. `cfg.strategy` is global, so a row on
// its own could not say what played it - the same gap ARGOS closes by pinning
// an authority onto each action spec, one level down.
//
// `injected` is not decoration. With no chooser handed in, `chooserFor` above
// decides, and it has no llm branch at all: strategy 'llm' without a chooser
// falls back to greedy, and writing 'llm' on that row would name a model that
// never ran. The LLM attacker is the one caller that hands a chooser in
// (Wargame.jsx awaits the model and passes the pick as a constant chooser).
export function strategyOf(G, injected) {
  const s = (G && G.cfg && G.cfg.strategy) || ''
  if (s === 'random') return 'random'
  if (s === 'llm') return injected ? 'llm' : 'greedy'
  return 'greedy'
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
      by: strategyOf(G, !!chooser),
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
