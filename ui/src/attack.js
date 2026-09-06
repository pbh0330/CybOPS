// Adversary simulation (ADR-0019).
//
// The split that matters: this file enumerates what an attacker COULD do from
// its current footholds and decides what happens when it tries. A model may
// choose among the enumerated moves and say why. It cannot invent a move, and
// it cannot decide an outcome.
//
// That is not a courtesy to ADR-0003, it is what makes the thing testable: an
// illegal move has no way to exist, so "the model broke the rules" is not a
// failure mode that needs catching downstream.
//
// Everything here is a simulation. Nothing connects to a network, nothing is
// executed (ADR-0019 section 7).

import { runChain } from './engine.js'

// Deterministic PRNG (mulberry32). Same scenario + seed + turn + move gives the
// same roll, every time. A demo you cannot replay is not an experiment.
function rng(seed) {
  let a = seed >>> 0
  return function next() {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Action catalogue. Preconditions and effects are rules, not prose: the whole
// point is that they are checked in code before a model ever sees the move.
export const ACTIONS = {
  recon: {
    label: '정찰',
    technique: 'T1046',
    tactic: 'discovery',
    p: 0.95,
    // no state change; it exists so the attacker has something to do when it
    // has no viable move, and so the turn log shows hesitation honestly
  },
  credential_access: {
    label: '자격증명 탈취',
    technique: 'T1003',
    tactic: 'credential-access',
    p: 0.7,
  },
  lateral_move: {
    label: '측면 이동',
    technique: 'T1021',
    tactic: 'lateral-movement',
    p: 0.6,
  },
  escalate: {
    label: '권한 상승',
    technique: 'T1078',
    tactic: 'privilege-escalation',
    p: 0.65,
  },
  deny: {
    label: '서비스 거부',
    technique: 'T1499',
    tactic: 'impact',
    p: 0.8,
  },
}

const FOOTHOLD = 0.5     // compromise level that counts as a usable foothold
const LATERAL_FROM = 0.7 // needed on the source host to move onward
const DENY_FROM = 0.8    // needed on the target before it can be taken down

function reachableFrom(g, state, t, fromId) {
  // Reuse the propagation engine's own view of the world so the attacker and
  // the mission picture never disagree about what is connected.
  const snap = runChain(g, state, { t, causes: 'all' })
  const links = g.links || []
  const assets = g.assets || []
  if (!links.length) return assets.map((a) => a.id).filter((id) => id !== fromId)

  const out = []
  for (const a of assets) {
    if (a.id === fromId) continue
    if (snap.asset_outage[a.id]) continue
    if (isReachable(g, snap, fromId, a.id)) out.push(a.id)
  }
  return out
}

// Mirrors engine.js reach(): transit nodes form components, terminals hang off
// them. Kept here rather than exported from engine.js so the engine's contract
// stays "run the chain", but the rule is the same one and the parity test
// covers the chain that uses it.
function isReachable(g, snap, from, to) {
  if (from === to) return true
  const links = (g.links || []).filter((l) => !snap.link_outage[l.id])
  const transit = {}
  for (const a of g.assets || []) transit[a.id] = a.transit === false ? false : true
  const adj = {}
  for (const a of g.assets || []) adj[a.id] = []
  for (const l of links) {
    if (snap.asset_outage[l.a] || snap.asset_outage[l.b]) continue
    adj[l.a].push(l.b)
    adj[l.b].push(l.a)
  }
  if ((adj[from] || []).includes(to)) return true
  const seen = new Set([from])
  const stack = (adj[from] || []).filter((m) => transit[m] && !snap.asset_outage[m])
  for (const m of stack) seen.add(m)
  while (stack.length) {
    const n = stack.pop()
    if (n === to) return true
    for (const m of adj[n] || []) {
      if (seen.has(m)) continue
      seen.add(m)
      if (m === to) return true
      if (transit[m] && !snap.asset_outage[m]) stack.push(m)
    }
  }
  return seen.has(to)
}

export function footholds(state) {
  return Object.keys(state || {}).filter((k) => Number(state[k]) >= FOOTHOLD)
}

// What the attacker can see: its footholds plus everything currently reachable
// from them. Computed from the live graph, so an asset someone added a minute
// ago is in here without anyone editing a script (ADR-0019 section 2).
export function attackerView(g, state, t) {
  const own = footholds(state)
  const seen = new Set(own)
  for (const f of own) for (const id of reachableFrom(g, state, t, f)) seen.add(id)
  return { footholds: own, visible: [...seen] }
}

export function legalMoves(g, state, t) {
  const moves = []
  const view = attackerView(g, state, t)
  const lvl = (id) => Number((state || {})[id] || 0)

  if (!view.footholds.length) return moves

  moves.push({ id: 'recon', action: 'recon', target: null, from: null, ...meta('recon') })

  for (const f of view.footholds) {
    if (lvl(f) >= FOOTHOLD && lvl(f) < 1) {
      moves.push({ id: `credential_access:${f}`, action: 'credential_access', target: f, from: f, ...meta('credential_access') })
    }
    if (lvl(f) >= LATERAL_FROM) {
      for (const to of reachableFrom(g, state, t, f)) {
        if (lvl(to) >= FOOTHOLD) continue
        moves.push({ id: `lateral_move:${f}->${to}`, action: 'lateral_move', from: f, target: to, ...meta('lateral_move') })
      }
    }
  }
  for (const id of view.visible) {
    if (lvl(id) >= FOOTHOLD && lvl(id) < 1) {
      moves.push({ id: `escalate:${id}`, action: 'escalate', from: id, target: id, ...meta('escalate') })
    }
    if (lvl(id) >= DENY_FROM) {
      moves.push({ id: `deny:${id}`, action: 'deny', from: id, target: id, ...meta('deny') })
    }
  }
  // de-duplicate by id, keep order
  const seen = new Set()
  return moves.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
}

function meta(action) {
  const a = ACTIONS[action]
  return { label: a.label, technique: a.technique, tactic: a.tactic, p: a.p }
}

// What each legal move would cost the defender, if it lands. This is the same
// number the mission panel shows, so red and blue are scored on one scale.
export function scoreMoves(g, state, t, moves, method = 'weighted') {
  const before = runChain(g, state, { t, method, causes: 'all' })
  return moves.map((m) => {
    const after = applyEffect(g, state, m, true)
    const r = runChain(g, after.state, { t, method, causes: 'all' })
    let gain = 0
    for (const mi of g.missions || []) {
      const d = (r.mission[mi.id] || 0) - (before.mission[mi.id] || 0)
      const w = 1 / Math.max(1, Number(mi.priority) || 1)
      gain += Math.max(0, d) * w
    }
    return { ...m, gain: Number(gain.toFixed(6)) }
  })
}

// Effects are rules. `assumeSuccess` is used for scoring what a move is worth;
// the real turn rolls for it.
export function applyEffect(g, state, move, assumeSuccess) {
  const next = { ...(state || {}) }
  const outageAdd = []
  const lvl = (id) => Number(next[id] || 0)

  switch (move.action) {
    case 'recon':
      break
    case 'credential_access':
      next[move.target] = Math.min(1, Math.max(lvl(move.target), 0.8))
      break
    case 'lateral_move':
      next[move.target] = Math.max(lvl(move.target), 0.5)
      break
    case 'escalate':
      next[move.target] = 1
      break
    case 'deny':
      // denial is an outage whose cause IS attack. It is the one place an
      // outage may carry cause=attack, and it is produced by the engine, never
      // written into a scenario file (ADR-0017 section 3).
      outageAdd.push({ asset: move.target, cause: 'attack' })
      next[move.target] = 1
      break
    default:
      break
  }
  return { state: next, outageAdd, applied: !!assumeSuccess }
}

// One turn. Returns the move taken, whether it landed, and the resulting state.
export function playTurn(g, state, t, opts = {}) {
  const method = opts.method || 'weighted'
  const seed = Number(opts.seed || 20260906)
  const turn = Number(opts.turn || 0)
  const chooser = opts.chooser || greedyChooser

  const legal = scoreMoves(g, state, t, legalMoves(g, state, t), method)
  if (!legal.length) {
    return { turn, t, move: null, reason: 'no legal move', success: false, state, legal }
  }

  const choice = chooser(legal, { g, state, t })
  const move = choice.move
  const roll = rng(seed ^ hashStr(`${turn}|${move.id}`))()
  const success = roll < move.p

  const eff = success ? applyEffect(g, state, move, true) : { state, outageAdd: [] }
  return {
    turn,
    t,
    move,
    rationale: choice.rationale || null,
    cited: choice.cited || null,
    roll: Number(roll.toFixed(4)),
    success,
    state: eff.state,
    outageAdd: eff.outageAdd,
    legal,
  }
}

// The control. Picks the move that costs the defender the most right now
// (ties broken by cheaper action, then by id, so it is deterministic).
// Without this there is no way to tell whether an LLM attacker is any good
// (ADR-0019 section 5).
export function greedyChooser(legal) {
  const sorted = [...legal].sort((a, b) => (b.gain - a.gain) || (b.p - a.p) || a.id.localeCompare(b.id))
  return { move: sorted[0], rationale: 'greedy: 임무 저하도 증가분이 가장 큰 수' }
}

// Picks at random among the legal moves. Useful as a floor: an attacker model
// that cannot beat random is not adding anything.
export function randomChooser(seed = 1) {
  let n = 0
  return (legal) => {
    const r = rng(seed ^ hashStr(`rand${n++}`))()
    return { move: legal[Math.floor(r * legal.length)], rationale: 'random baseline' }
  }
}
