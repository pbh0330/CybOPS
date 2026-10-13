// Tests for the staff golden set and its runner (참모 S2 Task 3).
//
// Two jobs here, and the first one matters more than the second.
//
//   1. The golden set is checked against the REAL tacnet-01 graph. A golden
//      set with a typo'd mission or asset id measures the typo, and nothing
//      downstream would notice - staff.validate would reject the expected
//      answer and the model would be blamed for it. So the ids are looked up
//      in ui/public/data/tacnet-01.replay.json here, in a test that fails.
//   2. The metric functions are checked on hand-made records, including the
//      two cases the metrics exist to expose: a model that answers everything
//      with one query id, and a model that abstains on everything.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  QUERY_IDS, readJsonl, checkGolden, percentile, latencyBlock, sameArgs,
  splitSentences, citationStats, routingMetrics, abstentionMetrics,
  narrationBlock, catalogRegression, runWithModel, parseArgs,
} from '../../tools/staff-eval.mjs'
import * as S from '../staff.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..', '..')
const GOLDEN = join(ROOT, 'eval', 'golden', 'staff', 'tacnet-01.jsonl')
const REPLAY = join(ROOT, 'ui', 'public', 'data', 'tacnet-01.replay.json')

const items = readJsonl(readFileSync(GOLDEN, 'utf8'))
const payload = JSON.parse(readFileSync(REPLAY, 'utf8'))

describe('golden set: eval/golden/staff/tacnet-01.jsonl', () => {
  it('follows the eval/golden/<task>/<scenario>.jsonl convention', () => {
    expect(items.length).toBeGreaterThan(0)
    for (const it2 of items) {
      expect(it2.id).toMatch(/^tacnet-01:staff:\d+$/)
      expect(it2.scenario).toBe('tacnet-01')
      expect(it2.task).toBe('staff')
      expect(typeof it2.question).toBe('string')
    }
  })

  it('is 38~45 items with about a fifth of them unanswerable', () => {
    expect(items.length).toBeGreaterThanOrEqual(38)
    expect(items.length).toBeLessThanOrEqual(45)
    const abstains = items.filter((x) => x.abstain).length
    expect(abstains / items.length).toBeGreaterThanOrEqual(0.15)
    expect(abstains / items.length).toBeLessThanOrEqual(0.25)
  })

  it('names only missions and assets that exist in the replay graph', () => {
    const report = checkGolden(items, payload.graph)
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('gives every class in QUERY_IDS at least three questions', () => {
    const report = checkGolden(items, payload.graph)
    for (const q of QUERY_IDS) expect(report.per_class[q]).toBeGreaterThanOrEqual(3)
  })

  it('does not simply echo the query label back as the question', () => {
    const labels = new Map(S.QUERIES.map((q) => [q.id, q.label]))
    for (const it2 of items) {
      if (it2.abstain) continue
      expect(it2.question).not.toBe(labels.get(it2.expect.query))
    }
  })

  it('every t it asks about exists in the replay', () => {
    const ts = new Set((payload.steps || []).map((s) => Number(s.t)))
    for (const it2 of items) expect(ts.has(Number(it2.t))).toBe(true)
  })
})

describe('catalogue regression (the half with no model in it)', () => {
  const reg = catalogRegression(S, payload, items)

  it('executes every expected query and gets facts back', () => {
    expect(reg.failures).toEqual([])
    expect(reg.fail).toBe(0)
    expect(reg.cases).toBe(items.filter((x) => !x.abstain).length)
  })

  it('covers every class in QUERY_IDS', () => {
    expect(reg.queries_uncovered).toEqual([])
    expect(reg.queries_covered).toEqual([...QUERY_IDS].sort())
  })

  it('catches a golden item whose expected id is not reachable in its ctx', () => {
    const bad = [{ ...items.find((x) => x.expect.query === 'readiness_gap'), ctx: 'observe' }]
    const r = catalogRegression(S, payload, bad)
    expect(r.fail).toBe(1)
    expect(r.failures[0].why).toMatch(/not in catalog/)
  })
})

describe('percentile and latency', () => {
  it('is nearest-rank, so it only ever returns an observed value', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20)
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40)
    expect(percentile([5], 0.5)).toBe(5)
  })

  it('returns null rather than 0 when nothing was timed', () => {
    expect(percentile([], 0.5)).toBe(null)
    expect(latencyBlock([])).toEqual({ n: 0, p50_ms: null, p95_ms: null, min_ms: null, max_ms: null })
  })
})

describe('sameArgs', () => {
  it('treats absent and null alike but not absent and a value', () => {
    expect(sameArgs({ k: 5 }, { k: 5 })).toBe(true)
    expect(sameArgs({ k: 5 }, { k: 3 })).toBe(false)
    expect(sameArgs({ missionId: 'M-C2' }, { missionId: 'M-C2' })).toBe(true)
    expect(sameArgs({}, { k: 5 })).toBe(false)
  })
})

describe('citation accounting (ADR-0009)', () => {
  const facts = [{ id: 'F1' }, { id: 'F2' }, { id: 'F3' }]

  it('counts a sentence as cited only when it ends in a [F#]', () => {
    const st = citationStats('지휘통제가 100% 저하됐다 [F1]. 원인은 BN-SRV 침해다 [F2].', facts)
    expect(st.sentences).toBe(2)
    expect(st.cited).toBe(2)
    expect(st.invalid).toBe(0)
  })

  it('separates a citation in the wrong place from no citation at all', () => {
    const st = citationStats('[F1] 때문에 저하됐다. 근거 없는 주장이다.', facts)
    expect(st.sentences).toBe(2)
    expect(st.cited).toBe(0)
    expect(st.loose).toBe(1)
  })

  it('flags a citation of a fact that was never handed over', () => {
    const st = citationStats('저하도가 올랐다 [F9].', facts)
    expect(st.invalid).toBe(1)
    expect(st.rows[0].unknown_refs).toEqual(['F9'])
  })

  it('splits sentences that end in a citation with no full stop', () => {
    expect(splitSentences('첫 문장이다 [F1] 둘째 문장이다 [F2]')).toHaveLength(2)
  })

  it('reports unverified rate as the complement, and null when there is nothing', () => {
    const recs = [{ citation: { sentences: 4, cited: 3, loose: 4, invalid: 1 } }]
    const b = narrationBlock(recs)
    expect(b.citation_rate).toBe(0.75)
    expect(b.unverified_rate).toBe(0.25)
    expect(b.invalid_citation_rate).toBe(0.25)
    expect(narrationBlock([]).citation_rate).toBe(null)
  })
})

describe('routing precision@1 (ADR-0008 - no accuracy)', () => {
  const rec = (expected, predicted, argsMatch = true) => ({
    expected_query: expected, predicted_query: predicted, args_match: argsMatch,
  })

  it('divides by what the model predicted, not by the class size', () => {
    const m = routingMetrics([
      rec('state_summary', 'state_summary'),
      rec('state_summary', 'mission_why'),
      rec('mission_why', 'mission_why'),
    ], ['state_summary', 'mission_why'])
    expect(m.classes.state_summary).toMatchObject({ support: 2, predicted: 1, correct: 1, precision: 1 })
    expect(m.classes.mission_why).toMatchObject({ support: 1, predicted: 2, correct: 1, precision: 0.5 })
    expect(m.macro_precision).toBe(0.75)
  })

  it('does not report a class the model never picked as 0 or as 1', () => {
    const m = routingMetrics([rec('state_summary', 'state_summary')], ['state_summary', 'mission_why'])
    expect(m.classes.mission_why.precision).toBe(null)
    expect(m.undefined_classes).toEqual(['mission_why'])
    expect(m.macro_precision).toBe(1)
    expect(m.macro_precision_strict).toBe(0.5)
  })

  it('exposes the one-answer-for-everything model that micro precision flatters', () => {
    // 6 state_summary questions, 3 of everything else, all answered
    // "state_summary". Micro reads as one small fraction; the macro over
    // predicted classes is that same single number, and every other class is
    // named as unmeasured. The expectations are written off QUERY_IDS.length
    // rather than pasted in, so adding a class to the golden set does not turn
    // this into an arithmetic puzzle that gets "fixed" by editing the number.
    const others = QUERY_IDS.slice(1)
    const total = 6 + others.length * 3
    const recs = []
    for (let i = 0; i < 6; i += 1) recs.push(rec('state_summary', 'state_summary'))
    for (const q of others) for (let i = 0; i < 3; i += 1) recs.push(rec(q, 'state_summary'))
    const m = routingMetrics(recs)
    expect(m.classes.state_summary.precision).toBeCloseTo(6 / total, 6)
    expect(m.undefined_classes).toHaveLength(others.length)
    expect(m.macro_precision_strict).toBeCloseTo((6 / total) / QUERY_IDS.length, 6)
  })

  it('counts an abstention as neither a right nor a wrong prediction', () => {
    const m = routingMetrics([
      { expected_query: null, predicted_query: null, args_match: false },
      rec('mission_why', 'mission_why'),
    ], ['mission_why'])
    expect(m.routed).toBe(1)
    expect(m.classes.mission_why.precision).toBe(1)
  })

  it('scores arguments separately from the id', () => {
    const m = routingMetrics([
      rec('mission_why', 'mission_why', true),
      rec('mission_why', 'mission_why', false),
    ], ['mission_why'])
    expect(m.classes.mission_why.precision).toBe(1)
    expect(m.args_exact_of_correct).toBe(0.5)
  })
})

describe('abstention is two numbers, never one', () => {
  const r = (expectAbstain, outcome) => ({ expect_abstain: expectAbstain, outcome })

  it('gives the abstain-on-everything model 1.0 on one and 0.0 on the other', () => {
    const m = abstentionMetrics([
      r(true, 'abstain'), r(true, 'abstain'),
      r(false, 'abstain'), r(false, 'abstain'), r(false, 'abstain'),
    ])
    expect(m.should_abstain.rate).toBe(1)
    expect(m.should_answer.rate).toBe(0)
  })

  it('counts an error as neither an abstention nor an answer', () => {
    const m = abstentionMetrics([r(true, 'error'), r(false, 'error')])
    expect(m.should_abstain).toMatchObject({ n: 1, abstained: 0, errored: 1, rate: 0 })
    expect(m.should_answer).toMatchObject({ n: 1, answered: 0, errored: 1, rate: 0 })
  })
})

describe('runWithModel, driven by a stub in place of a model', () => {
  const some = items.filter((x) => ['mission_why', 'readiness_gap'].includes(x.expect.query)).slice(0, 2)
    .concat(items.filter((x) => x.abstain).slice(0, 1))

  const stubLLM = (route, narration) => ({
    routeQuestion: async () => ({ ...route, ms: 12, attempts: 1 }),
    narrate: async () => ({ ...narration, ms: 34 }),
  })

  it('scores a perfect router and a well-cited narration', async () => {
    const recs = []
    for (const item of some) {
      const want = item.abstain
        ? { abstain: true, why: '카탈로그에 없다.' }
        : { query: item.expect.query, args: item.expect.args }
      const [r] = await runWithModel(S, stubLLM(want, { text: '저하됐다 [F1]. 원인은 이것이다 [F2].' }), payload, [item], {}, { retries: 1, narrate: true })
      recs.push(r)
    }
    const m = routingMetrics(recs)
    expect(m.micro_precision).toBe(1)
    expect(m.args_exact_of_correct).toBe(1)
    const a = abstentionMetrics(recs)
    expect(a.should_abstain.rate).toBe(1)
    expect(a.should_answer.rate).toBe(1)
    expect(narrationBlock(recs).citation_rate).toBe(1)
    expect(recs.every((r) => r.route_ms === 12)).toBe(true)
  })

  it('records an unknown-id failure as an error, not as an abstention', async () => {
    const item = items.find((x) => !x.abstain)
    const [r] = await runWithModel(S, stubLLM({ error: 'unknown_query', why: '없는 id' }, {}), payload, [item], {}, { retries: 1, narrate: false })
    expect(r.outcome).toBe('error')
    expect(r.error).toBe('unknown_query')
    expect(abstentionMetrics([r]).should_answer.errored).toBe(1)
  })

  it('marks a routed id whose args the catalogue rejects', async () => {
    const item = items.find((x) => x.expect.query === 'mission_why')
    const [r] = await runWithModel(S, stubLLM({ query: 'mission_why', args: { missionId: 'M-NOPE' } }, {}), payload, [item], {}, { retries: 1, narrate: false })
    expect(r.outcome).toBe('route')
    expect(r.validate_ok).toBe(false)
    expect(r.executed).toBe(false)
    expect(r.args_match).toBe(false)
  })

  it('accepts an omitted default argument as a match', async () => {
    const item = items.find((x) => x.expect.query === 'containment_top' && !Object.keys(x.expect.args).length)
    const [r] = await runWithModel(S, stubLLM({ query: 'containment_top', args: {} }, { text: '가장 싸다 [F1].' }), payload, [item], {}, { retries: 1, narrate: true })
    expect(r.args_match).toBe(true)
    expect(r.executed).toBe(true)
  })
})

describe('parseArgs', () => {
  it('reads --model and rejects an option it does not know', () => {
    expect(parseArgs(['--model', 'qwen2.5:7b']).model).toBe('qwen2.5:7b')
    expect(() => parseArgs(['--wat'])).toThrow(/unknown option/)
  })
})
