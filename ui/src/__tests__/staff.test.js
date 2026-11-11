import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import { computeStep, pct } from '../derive.js'
import { runChain } from '../engine.js'
import { startGame, defend, pass, attackerTurn, staffTable, weightedOf, compromiseOf } from '../game.js'
import { readiness } from '../sandbox.js'
import { readinessFacts } from '../facts.js'
import {
  QUERIES, catalog, needsMet, validate, ask, ctxT, graphFingerprint,
  recordedTurns, latestDecisionTurn,
} from '../staff.js'

const g = replay.graph
// idx 12: t=180, CO2-VEH 침해 0.5, L-VHF-CO1 지형 단절. 관측 모드이므로
// computeStep 은 리플레이 스텝을 그대로 돌려준다.
const s = computeStep({ payload: replay, graph: g, idx: 12 })
const observe = { graph: g, step: s }
const G = startGame(g, { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' })
const inGame = { graph: g, step: s, game: G }
const inSandbox = { graph: g, step: s, sandbox: true }
// A game with history: turn 1 isolates the staff table's third row, turn 2
// passes. decision_why needs a RECORDED turn, and startGame has none.
const STAFF_ROWS_AT_START = staffTable(g, G)
const PICK = STAFF_ROWS_AT_START[2]
const played = (() => {
  let X = defend(g, G, { type: 'isolate', id: PICK.id, basis: ['F1', 'F2'], rationale: '단일 경로라서' })
  X = attackerTurn(g, X)
  return attackerTurn(g, pass(X))
})()
const inPlayed = { graph: g, step: s, game: played }

const T = s.t
const METHOD = 'weighted'
const chainOf = (comp) => runChain(g, comp, { t: T, method: METHOD, causes: 'all' })
const base = weightedOf(g, chainOf(s.compromise).mission)
const observeCost = (id) => Number((weightedOf(g, chainOf({ ...s.compromise, [id]: 1 }).mission) - base).toFixed(6))

// 편집기가 실제로 하는 두 가지 그래프 편집. 둘 다 시계는 건드리지 않는다.
// cutTocSrv - TOC-SRV 에 붙은 링크를 전부 끊는다 (자산 수는 그대로, 링크 수는 준다).
// movedLink - 링크 한 개의 끝만 옮긴다 (자산 수도 링크 수도 그대로다).
const cutTocSrv = { ...g, links: g.links.filter((l) => l.a !== 'TOC-SRV' && l.b !== 'TOC-SRV') }
const movedLink = { ...g, links: g.links.map((l, i) => (i === 0 ? { ...l, b: 'TOC-ESX' } : l)) }
const missionValue = (a, id) => a.facts.find((f) => f.ref && f.ref.kind === 'mission' && f.ref.id === id && f.unit === '%').value

describe('catalog', () => {
  it('leaves out a game-only query when there is no game, and admits it when there is', () => {
    // U2 가 decision_why 를 넣기 전까지 아래 마지막 단언은 구조적으로
    // `0 === 0` 이었다 - needs:'game' 질의가 하나도 없었으므로 양쪽이 모두 0
    // 이었고, 게이트가 꺼져 있어도 통과했다. 이제 교전 전용 질의가 있으므로
    // 실질 검사다: 분모가 0 이 아닌 것을 먼저 못 박고 비교한다.
    const gameOnly = QUERIES.filter((q) => q.needs === 'game').map((q) => q.id)
    expect(gameOnly).toContain('decision_why')
    expect(gameOnly.length).toBeGreaterThan(0)
    expect(needsMet(observe, 'game')).toBe(false)
    expect(needsMet(inGame, 'game')).toBe(true)
    expect(catalog(observe).some((q) => q.needs === 'game')).toBe(false)
    expect(catalog(observe).map((q) => q.id)).not.toContain('decision_why')
    expect(catalog(inGame).filter((q) => q.needs === 'game').map((q) => q.id)).toEqual(gameOnly)
    expect(catalog(inSandbox).map((q) => q.id)).not.toContain('decision_why')
  })
  it('leaves out readiness_gap outside the sandbox', () => {
    expect(catalog(observe).map((q) => q.id)).not.toContain('readiness_gap')
    expect(catalog(inGame).map((q) => q.id)).not.toContain('readiness_gap')
    expect(catalog(inSandbox).map((q) => q.id)).toContain('readiness_gap')
  })
  it('lists the six graph queries in the observe mode', () => {
    expect(catalog(observe).map((q) => q.id)).toEqual([
      'state_summary', 'mission_why', 'mission_attribution',
      'asset_impact', 'containment_top', 'compare_defense',
    ])
  })
  it('hands out descriptors without run(), so nothing can bypass validate', () => {
    for (const q of catalog(observe)) {
      expect(q.run).toBeUndefined()
      expect(typeof q.label).toBe('string')
      expect(Array.isArray(q.args)).toBe(true)
      expect(QUERIES.some((x) => x.id === q.id)).toBe(true)
    }
  })
  it('returns nothing without a graph', () => {
    expect(catalog({})).toEqual([])
  })
})

describe('validate', () => {
  it('rejects a query id that is not in the catalogue', () => {
    const r = validate(observe, 'drop_table', {})
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('drop_table')
  })
  it('rejects a query whose needs are not met here', () => {
    const r = validate(observe, 'readiness_gap', {})
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('readiness_gap')
  })
  it('rejects a missionId the graph does not have, naming it', () => {
    const r = validate(observe, 'mission_why', { missionId: 'M-NOPE' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('M-NOPE')
    expect(validate(observe, 'mission_why', {}).ok).toBe(false)
    expect(validate(observe, 'mission_why', { missionId: 'M-FIRE' })).toEqual({ ok: true, args: { missionId: 'M-FIRE' } })
  })
  it('rejects an assetId the graph does not have, naming it', () => {
    const r = validate(observe, 'asset_impact', { assetId: 'NOPE' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('NOPE')
    expect(validate(observe, 'asset_impact', { assetId: 'TOC-SRV' })).toEqual({ ok: true, args: { assetId: 'TOC-SRV' } })
  })
  // 결정: k 는 보정하지 않고 거부한다. 빠진 인자만 기본값 5 로 채운다.
  // S2 는 검증 실패를 보고 한 번 다시 고를 수 있다 - 조용히 5 로 바꾸면
  // 모델은 자기가 옳은 값을 낸 줄 안다.
  it('fills k when it is missing and rejects every bad k rather than coercing it', () => {
    expect(validate(observe, 'containment_top', {})).toEqual({ ok: true, args: { k: 5 } })
    expect(validate(observe, 'containment_top', { k: 3 })).toEqual({ ok: true, args: { k: 3 } })
    for (const bad of ['3', -1, 0, 2.5, NaN, true, null]) {
      const r = validate(observe, 'containment_top', { k: bad })
      expect(r.ok, `k=${String(bad)} 이 통과했다`).toBe(false)
      expect(r.reason).toContain('k')
    }
  })
  it('wants two different assets for compare_defense', () => {
    expect(validate(observe, 'compare_defense', { aId: 'TOC-SRV' }).ok).toBe(false)
    expect(validate(observe, 'compare_defense', { aId: 'TOC-SRV', bId: 'TOC-SRV' }).ok).toBe(false)
    expect(validate(observe, 'compare_defense', { aId: 'TOC-SRV', bId: 'BN-SRV' }).ok).toBe(true)
  })
})

describe('ask - state_summary', () => {
  const a = ask(observe, 'state_summary', {})
  it('answers with numbered facts and no model, in the observe mode', () => {
    expect(a.query).toBe('state_summary')
    expect(a.facts[0].id).toBe('F1')
    expect(a.facts.some((f) => f.ref && f.ref.kind === 'mission' && f.text.includes(pct(s.mission['M-C2'])))).toBe(true)
  })
  it('surfaces the link outage as a link ref, which no other layer emits', () => {
    const f = a.facts.find((x) => x.ref && x.ref.kind === 'link')
    expect(f).toBeTruthy()
    expect(f.ref.id).toBe('L-VHF-CO1')
    expect(f.text).toContain('지형')
  })
  it('puts the same incidents in the table', () => {
    expect(a.table.rows.map((r) => r.id)).toContain('L-VHF-CO1')
    expect(a.table.rows.map((r) => r.id)).toContain('CO2-VEH')
    expect(a.table.cols.length).toBe(a.table.rows[0].cells.length)
  })
})

describe('ask - mission_why', () => {
  it('reports the degradation runChain reports, not the step it was handed', () => {
    const a = ask(observe, 'mission_why', { missionId: 'M-C2' })
    const truth = chainOf(s.compromise).mission['M-C2']
    const f = a.facts.find((x) => x.ref && x.ref.kind === 'mission' && x.ref.id === 'M-C2' && x.unit === '%')
    expect(f.value).toBeCloseTo(truth, 9)
    expect(f.text).toContain(pct(truth))
  })
  it('names the broken path and the degraded task', () => {
    const a = ask(observe, 'mission_why', { missionId: 'M-C2' })
    expect(a.facts.some((f) => f.ref && f.ref.kind === 'link' && f.ref.id === 'L-VHF-CO1')).toBe(true)
    const task = a.facts.find((f) => f.ref && f.ref.kind === 'task')
    expect(task).toBeTruthy()
    const truth = chainOf(s.compromise).task[task.ref.id]
    expect(task.value).toBeCloseTo(truth, 9)
    expect(a.table.rows.every((r) => (g.tasks.find((t) => t.id === r.id))))
      .toBe(true)
  })
})

// The companion to mission_why: the same degradation, split by ASSET instead
// of by cause. Everything here is checked against runChain called directly,
// so the query cannot pass by agreeing with facts.js.
describe('ask - mission_attribution', () => {
  const loo = (id, mid) => chainOf({ ...s.compromise, [id]: 0 }).mission[mid]
  const floorOf = (mid) => chainOf({}).mission[mid]

  it('charges each asset the drop its own compromise accounts for', () => {
    const a = ask(observe, 'mission_attribution', { missionId: 'M-C2' })
    const total = chainOf(s.compromise).mission['M-C2']
    const rows = a.facts.filter((f) => f.ref && f.ref.kind === 'asset')
    expect(rows.length).toBeGreaterThan(0)
    for (const f of rows) {
      expect(f.unit).toBe('%p')
      expect(f.value).toBeCloseTo(total - loo(f.ref.id, 'M-C2'), 9)
    }
  })

  it('splits the same total mission_why splits, along a different axis', () => {
    const why = ask(observe, 'mission_why', { missionId: 'M-C2' })
    const attr = ask(observe, 'mission_attribution', { missionId: 'M-C2' })
    const totalOf = (x) => x.facts.find((f) => f.ref && f.ref.kind === 'mission' && f.ref.id === 'M-C2' && f.unit === '%').value
    expect(totalOf(attr)).toBeCloseTo(totalOf(why), 9)
    // 원인 분해 vs 자산 분해. The note has to say which this is, or the two
    // answers look like the same decomposition disagreeing with itself.
    expect(attr.note).toContain('mission_why')
    expect(attr.note).toContain('자산별')
    expect(attr.label).not.toBe(why.label)
  })

  it('ends the table with the arithmetic rather than a share of the total', () => {
    const a = ask(observe, 'mission_attribution', { missionId: 'M-C2' })
    const ids = a.table.rows.map((r) => r.id)
    expect(ids.slice(-5)).toEqual(['__sum', '__inter', '__joint', '__floor', '__total'])
    const cell = (rid) => a.table.rows.find((r) => r.id === rid).cells[3]
    expect(cell('__total')).toBe(pct(chainOf(s.compromise).mission['M-C2']))
    expect(cell('__floor')).toBe(pct(floorOf('M-C2')))
    // No cell is a contribution expressed as a percentage of the total - that
    // normalisation is the thing this query refuses to do.
    const share = pct(a.facts.find((f) => f.ref && f.ref.kind === 'asset').value / chainOf(s.compromise).mission['M-C2'])
    expect(a.table.rows.every((r) => !r.cells.includes(share))).toBe(true)
  })

  it('names the environment floor no asset can be charged for', () => {
    const a = ask(observe, 'mission_attribution', { missionId: 'M-C2' })
    const f = a.facts.find((x) => x.text.includes('단절·환경 몫'))
    expect(f).toBeTruthy()
    expect(f.value).toBeCloseTo(floorOf('M-C2'), 9)
  })

  it('wants a mission id and rejects one the graph does not have', () => {
    expect(validate(observe, 'mission_attribution', {}).ok).toBe(false)
    expect(() => ask(observe, 'mission_attribution', { missionId: 'M-NOPE' })).toThrow(/M-NOPE/)
    expect(validate(observe, 'mission_attribution', { missionId: 'M-FIRE' }))
      .toEqual({ ok: true, args: { missionId: 'M-FIRE' } })
  })
})

describe('ask - asset_impact', () => {
  it('gives the what-if the engine gives for the same isolation', () => {
    const a = ask(observe, 'asset_impact', { assetId: 'TOC-SRV' })
    const before = chainOf(s.compromise).mission
    const after = chainOf({ ...s.compromise, 'TOC-SRV': 1 }).mission
    for (const m of g.missions) {
      const f = a.facts.find((x) => x.ref && x.ref.kind === 'mission' && x.ref.id === m.id && x.unit === '%p')
      expect(f, `${m.id} 의 증가 사실이 없다`).toBeTruthy()
      expect(f.value).toBeCloseTo(after[m.id] - before[m.id], 9)
    }
    const row = a.table.rows.find((r) => r.id === 'M-C2')
    expect(row.cells).toContain(pct(after['M-C2']))
  })
})

describe('ask - containment_top', () => {
  it('is game.staffTable, top k, in the table s own order when a game is on', () => {
    const rows = staffTable(g, G)
    const a = ask(inGame, 'containment_top', { k: 5 })
    expect(a.facts.filter((f) => f.unit === '%p').map((f) => f.ref.id)).toEqual(rows.slice(0, 5).map((r) => r.id))
    expect(a.table.rows.map((r) => r.id)).toEqual(rows.slice(0, 5).map((r) => r.id))
    expect(a.table.cols).toContain('막는 공격 수')
  })
  it('honours k instead of always cutting at five', () => {
    expect(ask(inGame, 'containment_top', { k: 3 }).table.rows.length).toBe(3)
    expect(ask(inGame, 'containment_top', {}).table.rows.length).toBe(5)
  })
  it('prices the observe mode with the one cost definition, cheapest first', () => {
    const a = ask(observe, 'containment_top', { k: 5 })
    const priced = a.facts.filter((f) => f.unit === '%p')
    expect(priced.length).toBeGreaterThan(1)
    const costs = priced.map((f) => f.value)
    expect(costs).toEqual([...costs].sort((x, y) => x - y))
    for (const f of priced) expect(f.value).toBeCloseTo(observeCost(f.ref.id), 9)
    expect(a.table.cols).not.toContain('막는 공격 수')
    expect(a.note).toBeTruthy()
    expect(a.note).toContain('관측')
  })
})

describe('ask - compare_defense', () => {
  it('prices both sides the way containment_top prices them', () => {
    const a = ask(observe, 'compare_defense', { aId: 'TOC-SRV', bId: 'BN-SRV' })
    const fa = a.facts.find((f) => f.ref && f.ref.id === 'TOC-SRV' && f.unit === '%p')
    const fb = a.facts.find((f) => f.ref && f.ref.id === 'BN-SRV' && f.unit === '%p')
    expect(fa.value).toBeCloseTo(observeCost('TOC-SRV'), 9)
    expect(fb.value).toBeCloseTo(observeCost('BN-SRV'), 9)
    expect(a.table.rows.map((r) => r.id)).toEqual(['TOC-SRV', 'BN-SRV'])
  })
  // 결함이었다: 관측 모드의 순위가 `i + 1` 이라 aId 로 넣은 쪽이 무조건 1위였다.
  // TOC-SRV(+27.7%p) 를 A 로 넣으면 비싼 쪽이 "순위 1" 로 나왔고, 인자를 바꾸면
  // 순위도 따라 뒤집혔다. 타이핑 순서에 따라 바뀌는 것은 순위가 아니다.
  it('ranks the observe-mode pair by cost, not by which argument it arrived in', () => {
    expect(observeCost('TOC-SRV')).toBeGreaterThan(observeCost('BN-SRV'))
    const rankOf = (a, id) => a.table.rows.find((r) => r.id === id).cells[0]
    for (const a of [
      ask(observe, 'compare_defense', { aId: 'TOC-SRV', bId: 'BN-SRV' }),
      ask(observe, 'compare_defense', { aId: 'BN-SRV', bId: 'TOC-SRV' }),
    ]) {
      expect(rankOf(a, 'BN-SRV')).toBe(1)
      expect(rankOf(a, 'TOC-SRV')).toBe(2)
      expect(a.facts.find((f) => f.ref && f.ref.id === 'BN-SRV' && f.unit === '%p').text).toContain('순위 1')
    }
    // 표는 물어본 순서 그대로 둔다 - 순위만 비용이 정한다.
    expect(ask(observe, 'compare_defense', { aId: 'TOC-SRV', bId: 'BN-SRV' }).table.rows.map((r) => r.id))
      .toEqual(['TOC-SRV', 'BN-SRV'])
  })
  it('reads the verdict off game.staffTable in a game', () => {
    const rows = staffTable(g, G)
    const a = ask(inGame, 'compare_defense', { aId: rows[0].id, bId: rows[rows.length - 1].id })
    const f = a.facts.find((x) => x.ref && x.ref.id === rows[0].id && x.unit === '%p')
    expect(f.value).toBeCloseTo(rows[0].cost, 9)
    expect(a.facts[a.facts.length - 1].text).toContain(rows[0].id)
  })
})

describe('ask - readiness_gap', () => {
  it('says what the readiness card says', () => {
    const a = ask(inSandbox, 'readiness_gap', {})
    const truth = readinessFacts(g, readiness(g))
    expect(a.facts.map((f) => f.text)).toEqual(truth.map((f) => f.text))
  })
  it('lists a service left without a provider in the table', () => {
    const broken = { ...g, edges: { ...g.edges, provided_by: g.edges.provided_by.filter((e) => e.from !== 'S-BFT') } }
    const a = ask({ graph: broken, step: s, sandbox: true }, 'readiness_gap', {})
    expect(a.table.rows.some((r) => r.id === 'S-BFT')).toBe(true)
  })
})

// 어느 ctx 에서 숫자를 뽑는가. 셋 다 "리플레이 스텝을 그대로 읽지 않는다"는
// 같은 규칙의 세 지점이고, 셋 다 돌연변이 검사에서 살아남았던 가지다.
describe('what the engine is asked about', () => {
  it('takes the clock from the game, not from the step it was handed (ctxT)', () => {
    expect(G.cfg.t).not.toBe(s.t)              // 150 vs 180
    expect(ctxT(inGame)).toBe(G.cfg.t)
    expect(ctxT(observe)).toBe(s.t)
    expect(ctxT({ graph: g })).toBe(-1)
    // 스탬프도 같은 값이어야 한다 - 교전 중 카드를 리플레이 시계로 검사하면
    // 안 낡은 카드가 낡았다고 나온다.
    expect(ask(inGame, 'state_summary', {}).t).toBe(G.cfg.t)
    expect(ask(observe, 'state_summary', {}).t).toBe(s.t)
  })

  it('takes the compromise map from the game state, not from the step (baseOf)', () => {
    // 같은 t=150 에서 둘을 돌린다 - 시계를 맞춰 두면 남는 차이는 침해 지도뿐이고,
    // 그 차이가 답에 실리는지만 본다. 교전은 CO2-VEH 0.8, 리플레이 스텝은 0.5 다.
    const atGameT = (comp) => runChain(g, comp, { t: G.cfg.t, method: G.cfg.method || 'weighted', causes: 'all' }).mission
    const fromGame = atGameT(compromiseOf(G))
    const fromStep = atGameT(s.compromise)
    expect(fromGame['M-C2']).not.toBeCloseTo(fromStep['M-C2'], 6)   // 0.386 vs 0.321

    const a = ask(inGame, 'mission_why', { missionId: 'M-C2' })
    expect(missionValue(a, 'M-C2')).toBeCloseTo(fromGame['M-C2'], 9)
    expect(missionValue(a, 'M-C2')).not.toBeCloseTo(fromStep['M-C2'], 6)

    // 격리 what-if 도 같은 기준 위에서 돈다.
    const after = ask(inGame, 'asset_impact', { assetId: 'TOC-SRV' })
    const isoGame = atGameT({ ...compromiseOf(G), 'TOC-SRV': 1 })
    const now = after.facts.find((x) => x.ref && x.ref.kind === 'mission' && x.ref.id === 'M-C2' && x.unit === '%p')
    expect(now.value).toBeCloseTo(isoGame['M-C2'] - fromGame['M-C2'], 9)
    expect(after.table.rows.find((r) => r.id === 'M-C2').cells).toContain(pct(fromGame['M-C2']))
  })

  it('recomputes the view instead of reading the step it was handed (viewOf)', () => {
    // 스텝의 compromise 는 그대로 두고 파생 숫자만 거짓으로 채운다. 숫자를
    // 스텝에서 읽는 구현이면 0.999 가 그대로 답에 실린다.
    const poisoned = {
      ...s,
      mission: Object.fromEntries(g.missions.map((m) => [m.id, 0.999])),
      task: Object.fromEntries(g.tasks.map((t) => [t.id, 0.999])),
      service: Object.fromEntries(g.services.map((x) => [x.id, 0.999])),
    }
    const a = ask({ graph: g, step: poisoned }, 'state_summary', {})
    for (const m of g.missions) {
      expect(missionValue(a, m.id)).toBeCloseTo(chainOf(s.compromise).mission[m.id], 9)
      expect(missionValue(a, m.id)).not.toBeCloseTo(0.999, 3)
    }
    // 같은 compromise 에서는 오염된 스텝이든 원본 스텝이든 답이 같다.
    expect(a.facts).toEqual(ask(observe, 'state_summary', {}).facts)
  })
})

// 낡음은 시각만이 아니다. 교전장에서는 시계를 그대로 둔 채 그래프를 고치는
// 것이 일상이고, 그때 모든 숫자가 움직인다 (ADR-0027, ADR-0009).
describe('graphFingerprint', () => {
  it('is stable for the same graph, and ignores what no engine path reads', () => {
    expect(graphFingerprint(g)).toBe(graphFingerprint(g))
    expect(graphFingerprint({ ...g, links: g.links.slice().reverse() })).toBe(graphFingerprint(g))
    expect(graphFingerprint({ ...g, assets: g.assets.slice().reverse() })).toBe(graphFingerprint(g))
    expect(graphFingerprint({ ...g, assets: g.assets.map((a) => ({ ...a, site: '다른 곳' })) })).toBe(graphFingerprint(g))
    expect(graphFingerprint({ ...g, name: '다른 이름' })).toBe(graphFingerprint(g))
  })

  it('changes when one link moves, though every count stays the same', () => {
    expect(movedLink.assets.length).toBe(g.assets.length)
    expect(movedLink.links.length).toBe(g.links.length)
    expect(graphFingerprint(movedLink)).not.toBe(graphFingerprint(g))
  })

  it('changes when a link is cut, an asset is removed, or a dependency edge is dropped', () => {
    expect(graphFingerprint(cutTocSrv)).not.toBe(graphFingerprint(g))
    expect(graphFingerprint({ ...g, assets: g.assets.slice(1) })).not.toBe(graphFingerprint(g))
    expect(graphFingerprint({ ...g, links: g.links.map((l, i) => (i === 0 ? { ...l, bearer: 'vhf' } : l)) })).not.toBe(graphFingerprint(g))
    expect(graphFingerprint({ ...g, edges: { ...g.edges, provided_by: g.edges.provided_by.slice(1) } })).not.toBe(graphFingerprint(g))
    expect(graphFingerprint({ ...g, edges: { ...g.edges, requires: g.edges.requires.slice(1) } })).not.toBe(graphFingerprint(g))
  })

  it('is a short string for an empty or absent graph rather than a throw', () => {
    expect(typeof graphFingerprint(null)).toBe('string')
    expect(graphFingerprint(undefined)).toBe(graphFingerprint({}))
    expect(graphFingerprint({})).toBe(graphFingerprint({ assets: [], links: [], edges: {} }))
  })
})

describe('ask - the basis it stamps on every answer', () => {
  it('stamps both the clock and the graph', () => {
    const a = ask(observe, 'mission_why', { missionId: 'M-C2' })
    expect(a.t).toBe(s.t)
    expect(a.gfp).toBe(graphFingerprint(g))
    expect(ask(inSandbox, 'readiness_gap', {}).gfp).toBe(graphFingerprint(g))
  })

  it('moves the graph stamp when an edit moves the numbers at an unchanged clock', () => {
    const before = ask(observe, 'mission_why', { missionId: 'M-C2' })
    const after = ask({ graph: cutTocSrv, step: s }, 'mission_why', { missionId: 'M-C2' })
    expect(after.t).toBe(before.t)                       // 시계는 180 그대로
    expect(missionValue(after, 'M-C2')).toBeGreaterThan(missionValue(before, 'M-C2') + 0.1)
    expect(after.gfp).not.toBe(before.gfp)               // 그래서 이것이 유일한 단서다
  })
})

describe('ask - the rules that hold for every query', () => {
  const cases = [
    [observe, 'state_summary', {}],
    [observe, 'mission_why', { missionId: 'M-C2' }],
    [observe, 'mission_attribution', { missionId: 'M-C2' }],
    [observe, 'mission_attribution', { missionId: 'M-FIRE' }],
    [observe, 'asset_impact', { assetId: 'TOC-SRV' }],
    [observe, 'containment_top', { k: 5 }],
    [observe, 'compare_defense', { aId: 'TOC-SRV', bId: 'BN-SRV' }],
    [inGame, 'containment_top', { k: 5 }],
    [inGame, 'state_summary', {}],
    [inSandbox, 'readiness_gap', {}],
  ]
  it('carries no action in S1 - a person isolates, the panel never does (ADR-0004)', () => {
    for (const [ctx, id, args] of cases) expect(ask(ctx, id, args).actions).toEqual([])
  })
  it('gives the same answer to the same input', () => {
    for (const [ctx, id, args] of cases) expect(ask(ctx, id, args)).toEqual(ask(ctx, id, args))
  })
  it('numbers the facts from F1 and always has some', () => {
    for (const [ctx, id, args] of cases) {
      const a = ask(ctx, id, args)
      expect(a.facts.length, `${id} 가 사실을 내지 않았다`).toBeGreaterThan(0)
      expect(a.facts.map((f) => f.id)).toEqual(a.facts.map((_, i) => `F${i + 1}`))
      expect(a.series).toBeNull()
      expect(typeof a.label).toBe('string')
    }
  })
  it('throws on arguments validate would have rejected', () => {
    expect(() => ask(observe, 'mission_why', { missionId: 'M-NOPE' })).toThrow(/M-NOPE/)
    expect(() => ask(observe, 'readiness_gap', {})).toThrow(/readiness_gap/)
    expect(() => ask(observe, 'containment_top', { k: '3' })).toThrow(/k/)
  })
})

// --- decision_why --------------------------------------------------------
//
// The catalogue's first needs:'game' query (U2). Its subject is the operator:
// what was isolated, where the staff table had it, and what was ranked first.
// ADR-0004 makes a person approve the isolation; this is what makes that
// approval answerable afterwards - and it is still read-only.

describe('recordedTurns / latestDecisionTurn', () => {
  it('counts the recorded turns 1-based, the way the panel prints them', () => {
    expect(recordedTurns(inPlayed)).toEqual([1, 2])
    expect(recordedTurns(inGame)).toEqual([])
    expect(recordedTurns(observe)).toEqual([])
  })
  it('points at the latest turn that recorded a decision, not just the latest', () => {
    // turn 2 was a pass, so the decision to explain is turn 1
    expect(latestDecisionTurn(inPlayed)).toBe(1)
    expect(latestDecisionTurn(inGame)).toBe(null)
    expect(latestDecisionTurn(observe)).toBe(null)
  })
  it('falls back to the last recorded turn when every turn was a pass', () => {
    const allPass = attackerTurn(g, pass(attackerTurn(g, pass(G))))
    expect(latestDecisionTurn({ graph: g, game: allPass })).toBe(2)
  })
})

describe('validate - turn', () => {
  it('takes the latest recorded decision when the argument is absent', () => {
    expect(validate(inPlayed, 'decision_why', {})).toEqual({ ok: true, args: { turn: 1 } })
  })
  it('refuses a turn the game never recorded, naming the ones it did', () => {
    const r = validate(inPlayed, 'decision_why', { turn: 7 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('턴 7')
    expect(r.reason).toContain('1, 2')
  })
  it('refuses a non-integer turn rather than coercing it', () => {
    for (const bad of ['1', 1.5, NaN, true]) {
      const r = validate(inPlayed, 'decision_why', { turn: bad })
      expect(r.ok, `turn=${String(bad)} 이 통과했다`).toBe(false)
      expect(r.reason).toContain('turn')
    }
  })
  it('refuses an integer outside the recorded range, by what it is', () => {
    // 0 and -1 ARE integers, so they are refused for the true reason - the
    // game recorded no such turn - rather than for being malformed.
    for (const bad of [0, -1]) {
      const r = validate(inPlayed, 'decision_why', { turn: bad })
      expect(r.ok, `turn=${String(bad)} 이 통과했다`).toBe(false)
      expect(r.reason).toContain(`턴 ${bad}`)
      expect(r.reason).toContain('1, 2')
    }
  })
  it('refuses the query outright before any turn is recorded', () => {
    const r = validate(inGame, 'decision_why', {})
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('기록된 턴이 없다')
  })
  it('refuses it outside a game, which is the catalogue gate talking', () => {
    const r = validate(observe, 'decision_why', { turn: 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('교전 중에만')
  })
})

describe('ask - decision_why', () => {
  const a = ask(inPlayed, 'decision_why', { turn: 1 })

  it('answers about the recorded turn with the recorded rank', () => {
    expect(a.query).toBe('decision_why')
    expect(a.args).toEqual({ turn: 1 })
    expect(a.label).toContain('턴 1')
    expect(a.label).toContain(PICK.id)
    const rank = a.facts.find((f) => f.text.includes('위였다'))
    expect(rank.value).toBe(3)
    expect(rank.value).toBe(played.history[0].defender.rank)
  })

  it('puts the chosen row and the rank-1 row side by side in the table', () => {
    expect(a.table.rows.map((r) => r.id)).toEqual([PICK.id, STAFF_ROWS_AT_START[0].id])
    expect(a.table.rows.every((r) => r.cells.length === a.table.cols.length)).toBe(true)
    expect(a.table.rows[0].cells[0]).toBe('고른 것')
    expect(a.table.rows[1].cells[0]).toBe('참모 1위')
  })

  it('records no action - a record is not an order (ADR-0004)', () => {
    expect(a.actions).toEqual([])
    expect(a.note).toContain('ADR-0004')
  })

  it('stamps the same basis every other answer carries', () => {
    expect(a.t).toBe(ctxT(inPlayed))
    expect(a.gfp).toBe(graphFingerprint(g))
  })

  it('answers a passed turn without a table and says why there is none', () => {
    const b = ask(inPlayed, 'decision_why', { turn: 2 })
    expect(b.table).toBe(null)
    expect(b.label).toContain('생략')
    expect(b.note).toContain('생략')
    expect(b.facts.length).toBeGreaterThan(0)
    expect(b.facts.map((f) => f.id)).toEqual(b.facts.map((_, i) => `F${i + 1}`))
  })

  it('gives the same answer to the same input', () => {
    expect(ask(inPlayed, 'decision_why', { turn: 1 })).toEqual(ask(inPlayed, 'decision_why', { turn: 1 }))
  })

  it('throws where validate refuses, with the reason as written', () => {
    expect(() => ask(inPlayed, 'decision_why', { turn: 9 })).toThrow(/턴 9/)
    expect(() => ask(observe, 'decision_why', {})).toThrow(/decision_why/)
    expect(() => ask(inGame, 'decision_why', {})).toThrow(/기록된 턴이 없다/)
  })
})
