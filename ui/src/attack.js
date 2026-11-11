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

// 격리 자산은 공격자에게 없는 자산이다: 거점도, 경유지도, 표적도 아니다 (ADR-0026).
// state 값은 그대로 두고(임무 수치는 compromise=1 로 따로 들어간다) 목록만 걸러낸다.
function isoSet(isolated) {
  return new Set(Array.isArray(isolated) ? isolated : [])
}

function reachableFrom(g, state, t, fromId, isolated = []) {
  const iso = isoSet(isolated)
  // Reuse the propagation engine's own view of the world so the attacker and
  // the mission picture never disagree about what is connected.
  const snap = runChain(g, state, { t, causes: 'all' })
  const links = g.links || []
  const assets = g.assets || []
  if (!links.length) return assets.map((a) => a.id).filter((id) => id !== fromId && !iso.has(id))

  const out = []
  for (const a of assets) {
    if (a.id === fromId) continue
    if (snap.asset_outage[a.id] || iso.has(a.id)) continue
    if (isReachable(g, snap, fromId, a.id, iso)) out.push(a.id)
  }
  return out
}

// Mirrors engine.js reach(): transit nodes form components, terminals hang off
// them. Kept here rather than exported from engine.js so the engine's contract
// stays "run the chain", but the rule is the same one and the parity test
// covers the chain that uses it. An isolated asset counts as down.
function isReachable(g, snap, from, to, iso = new Set()) {
  if (from === to) return true
  const down = (id) => !!snap.asset_outage[id] || iso.has(id)
  const links = (g.links || []).filter((l) => !snap.link_outage[l.id])
  const transit = {}
  for (const a of g.assets || []) transit[a.id] = a.transit === false ? false : true
  const adj = {}
  for (const a of g.assets || []) adj[a.id] = []
  for (const l of links) {
    if (down(l.a) || down(l.b)) continue
    adj[l.a].push(l.b)
    adj[l.b].push(l.a)
  }
  if ((adj[from] || []).includes(to)) return true
  const seen = new Set([from])
  const stack = (adj[from] || []).filter((m) => transit[m] && !down(m))
  for (const m of stack) seen.add(m)
  while (stack.length) {
    const n = stack.pop()
    if (n === to) return true
    for (const m of adj[n] || []) {
      if (seen.has(m)) continue
      seen.add(m)
      if (m === to) return true
      if (transit[m] && !down(m)) stack.push(m)
    }
  }
  return seen.has(to)
}

export function footholds(state, isolated = []) {
  const iso = isoSet(isolated)
  return Object.keys(state || {}).filter((k) => Number(state[k]) >= FOOTHOLD && !iso.has(k))
}

// What the attacker can see: its footholds plus everything currently reachable
// from them. Computed from the live graph, so an asset someone added a minute
// ago is in here without anyone editing a script (ADR-0019 section 2).
export function attackerView(g, state, t, opts = {}) {
  const own = footholds(state, opts.isolated)
  const seen = new Set(own)
  for (const f of own) for (const id of reachableFrom(g, state, t, f, opts.isolated)) seen.add(id)
  return { footholds: own, visible: [...seen] }
}

export function legalMoves(g, state, t, opts = {}) {
  const moves = []
  const view = attackerView(g, state, t, opts)
  const lvl = (id) => Number((state || {})[id] || 0)

  if (!view.footholds.length) return moves

  moves.push({ id: 'recon', action: 'recon', target: null, from: null, ...meta('recon') })

  for (const f of view.footholds) {
    if (lvl(f) >= FOOTHOLD && lvl(f) < 1) {
      moves.push({ id: `credential_access:${f}`, action: 'credential_access', target: f, from: f, ...meta('credential_access') })
    }
    if (lvl(f) >= LATERAL_FROM) {
      for (const to of reachableFrom(g, state, t, f, opts.isolated)) {
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

  const isolated = opts.isolated || []
  // scoring sees the isolated assets as already down (compromise 1) so a move's
  // gain is measured against the picture the defender is looking at
  const scoreState = { ...(state || {}) }
  for (const id of isolated) scoreState[id] = 1
  const legal = scoreMoves(g, scoreState, t, legalMoves(g, state, t, { isolated }), method)
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

// How far each asset is from the nearest crown jewel, in hops over the link
// graph. Undirected and bearer-agnostic on purpose: the attacker is choosing a
// direction, not planning a route, and which radio carries the hop does not
// change which way is "toward the objective". Outages are not subtracted here
// either - legalMoves() has already decided what is reachable.
function jewelDistances(g) {
  const adj = {}
  const touch = (id) => { if (!adj[id]) adj[id] = [] ; return adj[id] }
  for (const a of g.assets || []) touch(a.id)
  for (const l of g.links || []) {
    if (!l || !l.a || !l.b) continue
    touch(l.a).push(l.b)
    touch(l.b).push(l.a)
  }
  // sorted neighbours: BFS order must not depend on link order in the file
  for (const id of Object.keys(adj)) adj[id] = [...new Set(adj[id])].sort()
  const dist = {}
  const queue = [...(g.crown_jewels || [])].filter((id) => !!id).sort()
  for (const id of queue) dist[id] = 0
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i]
    for (const m of adj[n] || []) {
      if (dist[m] !== undefined) continue
      dist[m] = dist[n] + 1
      queue.push(m)
    }
  }
  return dist
}

const FAR = Number.MAX_SAFE_INTEGER   // unknown or unreachable target sorts last

// How much compromise a move actually pushes into the graph, assuming it
// lands. `gain` is what the defender loses; this is what the attacker gains
// even when the mission number has not moved yet.
function advanceOf(g, state, move) {
  const before = state || {}
  const after = applyEffect(g, before, move, true).state
  let sum = 0
  for (const id of Object.keys(after).sort()) {
    const d = Number(after[id] || 0) - Number(before[id] || 0)
    if (d > 0) sum += d
  }
  return Number(sum.toFixed(6))
}

// THE order of scored moves. One definition, used by the control below and by
// anything that shows the attacker's options - two orders would let the panel
// list one move at the top while the engine plays another.
//
// Two rules keep the attacker from standing still. First, recon is a last
// resort: it changes no state, so choosing it when anything else is legal
// means facing the identical position next turn - a livelock, not caution.
// Second, when `gain` ties (at a time when the operation has not started, or
// when P1 is already fully degraded, every move scores 0), the tie is broken
// by things that mean progress: how much compromise the move pushes into the
// graph, and then how close its target sits to a crown jewel. Only after that
// does the cheaper action win, so the order is total and deterministic:
//
//   recon last -> gain desc -> advance desc -> jewel distance asc
//              -> p desc -> id asc
//
// recon's gain is always exactly 0 (it has no effect), so putting it last
// never breaks the "gain descending" reading of the list. (ADR-0019 section 5
// and its 2026-09-23 amendment.)
export function orderMoves(moves, ctx = {}) {
  const all = moves || []
  if (all.length < 2) return [...all]
  const g = (ctx && ctx.g) || {}
  const state = (ctx && ctx.state) || {}

  const dist = jewelDistances(g)
  const key = new Map()   // keyed by the move object: ids are unique, objects are safer
  for (const m of all) {
    const d = m.target === null || m.target === undefined ? undefined : dist[m.target]
    key.set(m, {
      last: m.action === 'recon' ? 1 : 0,
      adv: advanceOf(g, state, m),
      near: d === undefined ? FAR : d,
    })
  }

  return [...all].sort((a, b) => {
    const ka = key.get(a), kb = key.get(b)
    return (ka.last - kb.last)
      || (b.gain - a.gain)
      || (kb.adv - ka.adv)
      || (ka.near - kb.near)
      || (b.p - a.p)
      || a.id.localeCompare(b.id)
  })
}

// The control. Picks the head of that order: the move that costs the defender
// the most right now, and when nothing costs anything, the move that carries
// the attack furthest toward a crown jewel. Without this there is no way to
// tell whether an LLM attacker is any good (ADR-0019 section 5).
export function greedyChooser(legal, ctx = {}) {
  const all = legal || []
  if (!all.length) return { move: undefined, rationale: 'greedy: 둘 수 있는 수가 없다' }

  const move = orderMoves(all, ctx)[0]
  let rationale
  if (!all.some((m) => m.action !== 'recon')) rationale = 'greedy: 둘 수 있는 수가 정찰뿐이다'
  else if (move.gain > 0) rationale = 'greedy: 임무 저하도 증가분이 가장 큰 수'
  else rationale = 'greedy: 이득이 평평해 전진량과 crown jewel 근접으로 고른 수'
  return { move, rationale }
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
