// After-action metrics on the OPERATOR (U4). Pure functions over the history
// game.js already writes: nothing here records anything new, and nothing here
// is a fixture.
//
// --- the mandate ---------------------------------------------------------
//
// ADR-0015 decided not to run an expert evaluation and named the replacement
// in the same breath: 순위 불일치도. Instead of asking officers to grade
// answers we record where the operator's own isolation sat in the staff's
// ranking for that turn, and report the disagreement. 순위 일치도 below is
// that promise's one implementation - the metric has a mandate, it is not a
// number somebody liked the look of.
//
// The shape of the KPI set comes from Cert Copilot, which proposed measuring
// the room rather than the answer: readiness, time to triage, evidence,
// approval compliance. The idea pointed at a real gap (our wargame scored the
// board and never looked at the person). All seven of their KPIs turned out to
// be fixtures - Readiness Score was a lookup table returning a fixed grade and
// Time to Triage was not computed at all - so we took the idea and none of the
// numbers, and compute only what we already record.
//
// What is deliberately NOT here:
//
// - No wall-clock timing. The scenario time is fixed (`cfg.t`) and the replay
//   has a speed control, so elapsed real time measures the operator's coffee
//   break and nothing else. There is no 'time to triage' in this file.
// - No approval-compliance percentage. Our one write-like action is isolation,
//   so the denominator is a single kind of thing and the ratio is 100% by
//   construction (ADR-0004 leaves no other way in). It is an INVARIANT, not a
//   metric: `approvalOf` returns the sentence's truth value, and a percentage
//   there would be theatre of exactly the Cert Copilot kind.
// - No agreement figure over decisions the staff had no preference about. See
//   the tie note on `classify`.
//
// Every figure is reported with its denominator. Three isolations in an
// eight-turn game is three, and the caller is given the 3 to print.

// staffTable's `net` is a 6-decimal rounded difference, so two candidates that
// tie arithmetically can differ in the last bit. Same epsilon facts.js uses
// for the same comparison on the same field.
const EPS = 1e-9
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const sameNet = (a, b) => Math.abs(num(a) - num(b)) < EPS

// One history row's isolation, classified.
//
// --- the tie, which is the whole decision in this file -------------------
//
// staffTable sorts by net, then by blocks, then by id. At tacnet-01's early
// steps EVERY candidate's net is 0 (isolating an asset the attacker cannot
// reach yet costs the mission nothing and blocks nothing), so rank 1 and
// rank 9 are TIED and the winner is decided by the blocks tiebreak alone. A
// metric that read 9위 off that table would score the operator as having
// disagreed with a staff that had no preference at all. That is manufacturing
// a disagreement out of a sort order, and it is the same species of dishonesty
// as a fixture KPI.
//
// So the rank number is never the test. The test is `net`:
//
//   agreed  - the pick's net equals the top net. The operator picked one of
//             the staff's best options, whether or not the tiebreak had put it
//             first. `rank` may be 9 and this is still agreement.
//   tied    - agreed AND the top net was shared. The staff had nothing to
//             prefer, so the decision is counted and reported as its own
//             number and kept OUT of the agreement denominator.
//   decided - the staff had a preference: either the top net was unique, or
//             the pick was strictly worse than the best. Only these feed the
//             headline agreement.
//
// `staff.tiedTop` (how many rows shared the top net) is written by game.js at
// decision time because the table cannot be rebuilt later. A record from
// before that field existed falls back to what the record itself proves: a
// pick that matches the top net while not BEING the top row is a tie of at
// least two. A rank-1 pick on such a record cannot be shown to be tied, and is
// read as decided - the fallback can understate the tie count, never invent
// one.
export function classify(h) {
  const d = (h && h.defender) || null
  if (!d || d.type !== 'isolate') return null
  const st = d.staff || null
  const chosen = (st && st.chosen) || null
  const top = (st && st.top) || null
  const base = {
    turn: num(h.turn), id: d.id, actor: d.actor || null,
    rank: Number.isFinite(Number(d.rank)) ? Number(d.rank) : null,
    cost: num(d.cost), rows: st && Number.isFinite(Number(st.rows)) ? Number(st.rows) : null,
  }
  if (!chosen || !top) {
    return { ...base, recorded: false, agreed: false, tied: false, decided: false, tieSize: null, blocks: null }
  }
  const agreed = sameNet(chosen.net, top.net)
  const declared = Number(st.tiedTop)
  const tieSize = Number.isFinite(declared) && declared >= 1
    ? declared
    : (agreed && chosen.id !== top.id ? 2 : 1)
  const tied = agreed && tieSize > 1
  return {
    ...base, recorded: true, agreed, tied, decided: !tied, tieSize,
    blocks: num(chosen.blocks), net: num(chosen.net), topNet: num(top.net), topId: top.id,
  }
}

export function decisionsOf(game) {
  return ((game && game.history) || []).map(classify).filter(Boolean)
}

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  return Number(v.toFixed(1))
}

// 순위 일치도 (ADR-0015). Rates are returned as ratios with their counts
// beside them, and as `null` where there is no denominator - a 0% that means
// "nothing happened" is a lie the caller would have no way to spot.
export function agreementOf(decisions) {
  const ds = decisions || []
  const recorded = ds.filter((d) => d.recorded)
  const tied = recorded.filter((d) => d.tied)
  const decided = recorded.filter((d) => d.decided)
  const agreed = decided.filter((d) => d.agreed)
  const ranks = decided.map((d) => d.rank).filter((r) => Number.isFinite(r))
  const top3 = ranks.filter((r) => r <= 3)
  return {
    isolations: ds.length,                      // the denominator, always printed
    unrecorded: ds.length - recorded.length,    // rows written before the staff record existed
    tied: tied.length,
    decided: decided.length,
    agreed: agreed.length,
    // headline: only over decisions the staff actually had a preference about
    rate: decided.length ? Number((agreed.length / decided.length).toFixed(6)) : null,
    medianRank: median(ranks),
    top3: top3.length,
    top3Rate: ranks.length ? Number((top3.length / ranks.length).toFixed(6)) : null,
    ranked: ranks.length,
    // every recorded decision was a tie: there is no agreement figure to give,
    // and the honest output is a sentence about the staff, not a percentage
    allTied: recorded.length > 0 && decided.length === 0,
  }
}

// 첫 유효 격리 턴. `blocks` is staffTable's count of the attacker's legal moves
// that this isolation removes, measured on the pre-isolation state - so
// blocks > 0 is exactly "the isolation actually took moves away from the
// attacker". `null` when no isolation ever did, which is a real answer about
// the run and not missing data.
export function firstEffectiveOf(decisions) {
  const ds = (decisions || []).filter((d) => d.recorded)
  const hit = ds.find((d) => d.blocks > 0) || null
  return {
    turn: hit ? hit.turn : null,
    id: hit ? hit.id : null,
    blocks: hit ? hit.blocks : null,
    effective: ds.filter((d) => d.blocks > 0).length,
    measured: ds.length,
  }
}

// Approval is an invariant, not a metric (ADR-0004). `holds` is the truth of
// the one sentence we can honestly write - "모든 격리는 사람의 탭에서 왔다" -
// and `other` exists so that a future automatic path could not make the
// sentence false in silence. No rate is returned on purpose.
export function approvalOf(decisions) {
  const ds = decisions || []
  const other = ds.filter((d) => d.actor !== 'human')
  return { isolations: ds.length, human: ds.length - other.length, other: other.length, holds: other.length === 0 }
}

export function aarMetrics(game) {
  const hist = (game && game.history) || []
  const ds = decisionsOf(game)
  return {
    turns: hist.length,
    passes: hist.filter((h) => !h.defender).length,
    decisions: ds,
    agreement: agreementOf(ds),
    firstEffective: firstEffectiveOf(ds),
    approval: approvalOf(ds),
  }
}
