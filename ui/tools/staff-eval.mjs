// Staff routing evaluation (참모 S2, ADR-0008 / ADR-0009).
//
//   node ui/tools/staff-eval.mjs [--model <name>] [--endpoint <url>] ...
//   -> eval/results/staff-<model>-<date>.json
//
// What this measures, and what it refuses to measure.
//
// The staff answers out of a closed catalogue of read-only queries
// (src/staff.js). staff-llm.mjs picks one of them from a sentence a person
// typed, and then reads the engine's facts back out. Two different things can
// be wrong there, so they are scored separately:
//
// QUERY_IDS below is the golden set's class list, NOT the catalogue. It is
// six, and the catalogue is eight: `mission_attribution` (U1) and
// `decision_why` (U2) were added after this golden set was written and have no
// questions in it, so nothing here measures how well a model routes to either.
// That is a gap in the measurement, and it is said here rather than papered
// over by counting the classes as covered. `decision_why` has a second reason
// to stay out for now: it is the first needs:'game' query, and every item in
// this set is asked in the observe or sandbox ctx, where the catalogue gate
// correctly refuses it.
//
//   routing   did the model pick the query id (and the arguments) the golden
//             set says the question meant? Reported as precision@1 PER CLASS
//             and MACRO-AVERAGED. The classes are unbalanced by construction -
//             state_summary gets six questions and readiness_gap three - and a
//             single pooled number hides a model that answers everything with
//             the most common id. Accuracy is not reported at all (ADR-0008).
//   narration did every sentence end in a [F#] that exists in the facts it was
//             given? Reported as citation rate and its complement, the
//             unverified rate (ADR-0009).
//
// Abstention is reported as TWO numbers, never one. A model that abstains on
// everything gets a perfect "abstained when it should" and a zero "answered
// when it should"; averaging those two into one figure would hide exactly the
// failure the pair exists to expose (docs/04-evaluation.md 2.3.1).
//
// **No model reachable is not a zero.** If the endpoint does not answer, or
// does not have the requested model, the routing / citation / abstention /
// latency blocks are written as `null` with the reason, and the run falls back
// to the catalogue-only regression: every expected query id in the golden set
// is executed through staff.validate + staff.ask and has to produce facts.
// That checks the half of the pipeline that has no model in it. The result
// file and the console both say plainly that routing was not measured. Writing
// 0.0 there would be a fabricated measurement.
//
// Exit code: 1 if the golden set is malformed or the catalogue regression
// fails. A missing model is not a failure of this tool.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { splitSentences, citesIn, endsWithCite } from '../src/cite-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..', '..')

// --- loading src/ from plain node -------------------------------------------
//
// src/labels.js does `import ATTACK from '../../configs/attack-techniques.ko.json'`
// with no import attribute. Vite and vitest accept that; node 24 does not
// ("needs an import attribute of type: json"). Rather than change app source
// for a tool's benefit, the tool teaches its own loader how to read a .json
// file - the same thing the default loader would do, minus the attribute
// check. Registered lazily, inside the CLI path only, so importing this module
// from a test (which runs under vite and does not need it) has no side effect.
let hooked = false
async function ensureJsonLoader() {
  if (hooked) return
  hooked = true
  const mod = await import('node:module')
  if (typeof mod.registerHooks !== 'function') return
  mod.registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && url.endsWith('.json')) {
        return { format: 'json', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8') }
      }
      return nextLoad(url, context)
    },
  })
}

// --- pure helpers (exported so the unit tests can reach them) ---------------

// The classes the golden set scores. A subset of staff.js QUERIES: see the
// header. Adding an id here without adding at least three questions for it
// makes checkGolden fail, which is the intended order.
export const QUERY_IDS = [
  'state_summary', 'mission_why', 'asset_impact',
  'containment_top', 'compare_defense', 'readiness_gap',
]

export function parseArgs(argv) {
  const out = {
    model: '', endpoint: '', golden: '', out: '', scenario: 'tacnet-01',
    limit: 0, retries: 1, seed: 1, timeoutMs: 60000, narrate: true, probeMs: 4000,
    // Routing runs at 0 because staff-llm's normCfg defaults it there for the
    // 'route' kind. Narration's own default in that file is 0.2 - fine for a
    // person reading one answer, wrong for a number that goes in a result file.
    // So this tool pins it, rather than inheriting whatever the app wants,
    // and writes the value it used next to the figures it produced.
    narrateTemp: 0,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--model') out.model = String(next() || '')
    else if (a === '--endpoint') out.endpoint = String(next() || '')
    else if (a === '--golden') out.golden = String(next() || '')
    else if (a === '--out') out.out = String(next() || '')
    else if (a === '--scenario') out.scenario = String(next() || '')
    else if (a === '--limit') out.limit = Number(next() || 0)
    else if (a === '--retries') out.retries = Number(next() || 0)
    else if (a === '--seed') out.seed = Number(next() || 1)
    else if (a === '--timeout') out.timeoutMs = Number(next() || 60000)
    else if (a === '--probe-timeout') out.probeMs = Number(next() || 4000)
    else if (a === '--narrate-temp') out.narrateTemp = Number(next() || 0)
    else if (a === '--no-narrate') out.narrate = false
    else throw new Error(`unknown option: ${a}`)
  }
  return out
}

export function readJsonl(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try { return JSON.parse(l) } catch (e) { throw new Error(`golden line ${i + 1}: ${e.message}`) }
    })
}

// Nearest-rank, no interpolation. Deterministic and it never invents a value
// that no call actually took.
export function percentile(values, p) {
  const xs = (values || []).filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (!xs.length) return null
  const idx = Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1))
  return xs[idx]
}

export function latencyBlock(values) {
  const xs = (values || []).filter((v) => Number.isFinite(v))
  return {
    n: xs.length,
    p50_ms: percentile(xs, 0.5),
    p95_ms: percentile(xs, 0.95),
    min_ms: xs.length ? Math.min(...xs) : null,
    max_ms: xs.length ? Math.max(...xs) : null,
  }
}

// Argument comparison after both sides have been through staff.validate, so a
// default that the catalogue fills in (containment_top's k) is not scored as a
// disagreement and an explicit wrong value still is.
export function sameArgs(a, b) {
  const A = a || {}
  const B = b || {}
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()
  return keys.every((k) => JSON.stringify(A[k] === undefined ? null : A[k])
    === JSON.stringify(B[k] === undefined ? null : B[k]))
}

// The sentence split and the two citation predicates live in
// ../src/cite-core.mjs, which the screen (src/ui/cite.jsx) imports as well.
// They used to be two implementations and they diverged: the screen cut after
// every [F#] and this file only cut a chunk that carried two or more, so the
// same narration had two sentence counts and two citation rates. ADR-0009 makes
// the citation rate a headline number; two of them means neither can be quoted.
// Re-exported here because the unit tests and the result file both reach for it
// by this name.
export { splitSentences }

// ADR-0009, and the reason this returns TWO counters.
//
//   cited  the prompt's own rule - the sentence ENDS in a [F#]. This is the
//          headline citation_rate (docs/04-evaluation.md 2.3.3) and it measures
//          format compliance as much as basis.
//   loose  a citation anywhere in the sentence. Reported beside it so a low
//          strict rate cannot be read as "no citations at all" when the model is
//          only putting them in the wrong place. **This is the number the screen
//          shows**, because the 미검증 badge accuses a sentence of having no
//          basis, and a mid-sentence [F2] is a basis.
//
// `invalid` is a citation of a fact id that was never handed to the model: that
// is fabrication, not a format slip.
export function citationStats(text, facts) {
  const known = new Set((facts || []).map((f) => String(f && f.id)))
  const sentences = splitSentences(text)
  let cited = 0
  let loose = 0
  let invalid = 0
  const rows = []
  for (const s of sentences) {
    const all = citesIn(s)
    const endsWith = endsWithCite(s)
    const bad = all.filter((id) => !known.has(id))
    if (endsWith) cited += 1
    if (all.length) loose += 1
    if (bad.length) invalid += 1
    rows.push({ text: s, cited: endsWith, refs: all, unknown_refs: bad })
  }
  return { sentences: sentences.length, cited, loose, invalid, rows }
}

// Per-class precision@1 plus the macro average.
//
// Denominator of precision for class c is how many questions the model ROUTED
// to c (not how many belong to c). A class the model never picked has no
// precision - it is reported as null and named in `undefined_classes` rather
// than counted as 1.0 (vacuous) or 0.0 (a number nothing measured). The macro
// average is over the classes that were predicted at least once, and
// `macro_precision_strict` repeats it with the unpredicted classes scored 0 so
// a reader can see both readings instead of trusting whichever one flatters.
//
// recall and support ride along because precision@1 alone is gameable in the
// exact way this catalogue invites: answer state_summary to everything and its
// precision is whatever share of the set is state_summary, while five classes
// vanish from the average.
export function routingMetrics(records, classes = QUERY_IDS) {
  const per = {}
  for (const c of classes) per[c] = { support: 0, predicted: 0, correct: 0, args_correct: 0, precision: null, recall: null }
  let routed = 0
  let correct = 0
  let argsCorrect = 0
  for (const r of records) {
    if (r.expected_query && per[r.expected_query]) per[r.expected_query].support += 1
    if (!r.predicted_query) continue
    routed += 1
    const cell = per[r.predicted_query]
    if (!cell) continue
    cell.predicted += 1
    if (r.predicted_query === r.expected_query) {
      cell.correct += 1
      correct += 1
      if (r.args_match) { cell.args_correct += 1; argsCorrect += 1 }
    }
  }
  const undefinedClasses = []
  for (const c of classes) {
    const cell = per[c]
    cell.precision = cell.predicted ? Number((cell.correct / cell.predicted).toFixed(6)) : null
    cell.recall = cell.support ? Number((cell.correct / cell.support).toFixed(6)) : null
    if (cell.precision === null) undefinedClasses.push(c)
  }
  const defined = classes.filter((c) => per[c].precision !== null)
  const mean = (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(6)) : null)
  return {
    classes: per,
    routed,
    correct,
    undefined_classes: undefinedClasses,
    macro_precision: mean(defined.map((c) => per[c].precision)),
    macro_precision_strict: mean(classes.map((c) => per[c].precision === null ? 0 : per[c].precision)),
    macro_recall: mean(classes.filter((c) => per[c].recall !== null).map((c) => per[c].recall)),
    micro_precision: routed ? Number((correct / routed).toFixed(6)) : null,
    args_exact_of_correct: correct ? Number((argsCorrect / correct).toFixed(6)) : null,
  }
}

// Two numbers, kept apart on purpose (docs/04 2.3.1). An item that ended in a
// transport or parse error is neither: it is counted in `errors` so that the
// two rates keep meaning what they say.
export function abstentionMetrics(records) {
  const should = records.filter((r) => r.expect_abstain)
  const shouldNot = records.filter((r) => !r.expect_abstain)
  const rate = (n, d) => (d ? Number((n / d).toFixed(6)) : null)
  return {
    should_abstain: {
      n: should.length,
      abstained: should.filter((r) => r.outcome === 'abstain').length,
      answered: should.filter((r) => r.outcome === 'route').length,
      errored: should.filter((r) => r.outcome === 'error').length,
      rate: rate(should.filter((r) => r.outcome === 'abstain').length, should.length),
    },
    should_answer: {
      n: shouldNot.length,
      answered: shouldNot.filter((r) => r.outcome === 'route').length,
      abstained: shouldNot.filter((r) => r.outcome === 'abstain').length,
      errored: shouldNot.filter((r) => r.outcome === 'error').length,
      rate: rate(shouldNot.filter((r) => r.outcome === 'route').length, shouldNot.length),
    },
  }
}

// Structural check of the golden set itself. A golden set with a typo'd asset
// id measures the typo, so this runs before anything else and a failure stops
// the run rather than being reported as a bad model.
export function checkGolden(items, graph) {
  const problems = []
  const missionIds = new Set((graph.missions || []).map((m) => m.id))
  const assetIds = new Set((graph.assets || []).map((a) => a.id))
  const seen = new Set()
  const perClass = {}
  for (const c of QUERY_IDS) perClass[c] = 0
  let abstains = 0

  for (const it of items) {
    const at = it.id || '(no id)'
    if (seen.has(it.id)) problems.push(`${at}: duplicate id`)
    seen.add(it.id)
    if (it.task !== 'staff') problems.push(`${at}: task must be "staff", got ${JSON.stringify(it.task)}`)
    if (!it.question) problems.push(`${at}: empty question`)
    if (it.ctx && it.ctx !== 'observe' && it.ctx !== 'sandbox') problems.push(`${at}: unknown ctx ${JSON.stringify(it.ctx)}`)
    const q = it.expect && it.expect.query
    if (it.abstain) {
      abstains += 1
      if (q) problems.push(`${at}: abstain item must have expect.query null`)
      continue
    }
    if (!QUERY_IDS.includes(q)) { problems.push(`${at}: expect.query ${JSON.stringify(q)} is not in the catalogue`); continue }
    perClass[q] += 1
    if (q === 'readiness_gap' && it.ctx !== 'sandbox') problems.push(`${at}: readiness_gap needs ctx "sandbox"`)
    const args = (it.expect && it.expect.args) || {}
    for (const [k, v] of Object.entries(args)) {
      if (k === 'missionId' && !missionIds.has(v)) problems.push(`${at}: mission id ${JSON.stringify(v)} is not in the graph`)
      if ((k === 'assetId' || k === 'aId' || k === 'bId') && !assetIds.has(v)) problems.push(`${at}: asset id ${JSON.stringify(v)} is not in the graph`)
    }
  }
  for (const c of QUERY_IDS) if (perClass[c] < 3) problems.push(`class ${c} has only ${perClass[c]} questions, the plan asks for at least 3`)
  const share = items.length ? abstains / items.length : 0
  return {
    items: items.length,
    abstain: abstains,
    abstain_share: Number(share.toFixed(4)),
    per_class: perClass,
    problems,
    ok: problems.length === 0,
  }
}

// --- the run ----------------------------------------------------------------

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const slug = (s) => String(s).replace(/[^\w.-]+/g, '_')

function gitRev() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch { return null }
}

function fnv1a(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16)
}

// Is there a model behind the endpoint, and is it the one asked for? Both
// answers are recorded verbatim; neither is turned into a score.
async function probeModel(endpoint, model, timeoutMs) {
  const url = `${String(endpoint).replace(/\/+$/, '')}/api/tags`
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    return { ok: false, reason: 'endpoint_unreachable', detail: `GET ${url}: ${(e && e.message) || e}`, available: [] }
  }
  if (!res.ok) return { ok: false, reason: 'endpoint_error', detail: `GET ${url}: HTTP ${res.status}`, available: [] }
  let names = []
  try {
    const j = await res.json()
    names = (j.models || []).map((m) => m.name).filter(Boolean)
  } catch (e) {
    return { ok: false, reason: 'endpoint_error', detail: `GET ${url}: ${(e && e.message) || e}`, available: [] }
  }
  if (!names.includes(model)) {
    return { ok: false, reason: 'model_not_installed', detail: `${model} is not among the ${names.length} model(s) the endpoint lists`, available: names }
  }
  return { ok: true, available: names }
}

function ctxFor(payload, item) {
  const t = Number(item.t)
  const step = (payload.steps || []).find((s) => Number(s.t) === t)
  if (!step) throw new Error(`${item.id}: replay has no step at t=${t}`)
  return {
    graph: payload.graph,
    step,
    method: payload.method || 'weighted',
    sandbox: item.ctx === 'sandbox',
  }
}

// Every expected (query, args, t, ctx) in the golden set, executed through the
// real gate. This is the part of the pipeline with no model in it, and it is
// what still runs when there is no model at all.
export function catalogRegression(S, payload, items) {
  const cases = []
  const covered = new Set()
  for (const it of items) {
    if (it.abstain) continue
    const want = it.expect.query
    let row = { id: it.id, query: want, t: it.t, ctx: it.ctx || 'observe', ok: false, facts: 0, why: null, must_cite: it.must_cite || [], cited_kinds: [] }
    try {
      const ctx = ctxFor(payload, it)
      const inCatalog = S.catalog(ctx).some((q) => q.id === want)
      if (!inCatalog) throw new Error(`${want} is not in catalog() for this ctx`)
      const v = S.validate(ctx, want, it.expect.args || {})
      if (!v.ok) throw new Error(`validate rejected: ${v.reason}`)
      const ans = S.ask(ctx, want, it.expect.args || {})
      const kinds = [...new Set((ans.facts || []).map((f) => f.ref && f.ref.kind).filter(Boolean))].sort()
      const missing = (it.must_cite || []).filter((k) => !kinds.includes(k))
      row = { ...row, facts: (ans.facts || []).length, cited_kinds: kinds }
      if (!ans.facts || !ans.facts.length) throw new Error('answer produced no facts')
      if (missing.length) throw new Error(`must_cite kinds missing from the answer's facts: ${missing.join(', ')}`)
      row.ok = true
      covered.add(want)
    } catch (e) {
      row.why = (e && e.message) || String(e)
    }
    cases.push(row)
  }
  const uncovered = QUERY_IDS.filter((q) => !covered.has(q))
  return {
    cases: cases.length,
    pass: cases.filter((c) => c.ok).length,
    fail: cases.filter((c) => !c.ok).length,
    queries_covered: [...covered].sort(),
    queries_uncovered: uncovered,
    failures: cases.filter((c) => !c.ok),
    rows: cases,
  }
}

// `LLM` is passed in rather than imported so a test can hand it a stub pair of
// routeQuestion/narrate and score a whole made-up model run without a model.
export async function runWithModel(S, LLM, payload, items, cfg, opts) {
  const records = []
  for (const it of items) {
    const ctx = ctxFor(payload, it)
    const spec = S.catalog(ctx)
    const r = await LLM.routeQuestion(cfg, it.question, spec, { retries: opts.retries })
    const rec = {
      id: it.id,
      t: it.t,
      ctx: it.ctx || 'observe',
      question: it.question,
      expect_abstain: !!it.abstain,
      expected_query: it.abstain ? null : it.expect.query,
      expected_args: it.abstain ? null : (it.expect.args || {}),
      predicted_query: null,
      predicted_args: null,
      args_match: false,
      outcome: 'error',
      error: null,
      why: null,
      route_ms: Number(r.ms) || 0,
      attempts: Number(r.attempts) || 0,
      validate_ok: null,
      executed: false,
      narration: null,
      narrate_ms: null,
      citation: null,
    }
    if (r.error) {
      rec.outcome = 'error'
      rec.error = r.error
      rec.why = r.why
    } else if (r.abstain) {
      rec.outcome = 'abstain'
      rec.why = r.why
    } else {
      rec.outcome = 'route'
      rec.predicted_query = r.query
      rec.predicted_args = r.args || {}
      // Normalise both sides through the real gate before comparing, so a
      // default the catalogue fills in is not scored as a disagreement.
      const gotV = S.validate(ctx, r.query, r.args || {})
      rec.validate_ok = gotV.ok
      if (!gotV.ok) rec.why = gotV.reason
      if (rec.predicted_query === rec.expected_query && gotV.ok) {
        const wantV = S.validate(ctx, it.expect.query, it.expect.args || {})
        rec.args_match = wantV.ok && sameArgs(gotV.args, wantV.args)
      }
      if (gotV.ok && !it.abstain) {
        try {
          const ans = S.ask(ctx, r.query, gotV.args)
          rec.executed = true
          if (opts.narrate) {
            // Narration gets its own cfg so its temperature is a decision this
            // tool made and recorded, not one it inherited (see parseArgs).
            const n = await LLM.narrate(opts.narrateCfg || cfg, ans.facts, it.question, {})
            rec.narrate_ms = Number(n.ms) || 0
            if (n.error) {
              rec.narration = { error: n.error, why: n.why }
            } else {
              const st = citationStats(n.text, ans.facts)
              rec.narration = { text: n.text }
              rec.citation = { sentences: st.sentences, cited: st.cited, loose: st.loose, invalid: st.invalid }
            }
          }
        } catch (e) {
          rec.why = `ask threw: ${(e && e.message) || e}`
        }
      }
    }
    records.push(rec)
    const mark = rec.outcome === 'route' ? `-> ${rec.predicted_query}${rec.predicted_query === rec.expected_query ? '' : ` (want ${rec.expected_query})`}`
      : rec.outcome === 'abstain' ? '-> abstain' : `-> ERROR ${rec.error}`
    console.log(`  ${it.id} ${mark} ${rec.route_ms}ms`)
  }
  return records
}

export function narrationBlock(records) {
  const done = records.filter((r) => r.citation)
  const sentences = done.reduce((a, r) => a + r.citation.sentences, 0)
  const cited = done.reduce((a, r) => a + r.citation.cited, 0)
  const loose = done.reduce((a, r) => a + r.citation.loose, 0)
  const invalid = done.reduce((a, r) => a + r.citation.invalid, 0)
  const failed = records.filter((r) => r.narration && r.narration.error)
  const rate = (n, d) => (d ? Number((n / d).toFixed(6)) : null)
  return {
    narrations: done.length,
    narration_errors: failed.length,
    sentences,
    cited_sentences: cited,
    citation_rate: rate(cited, sentences),
    unverified_rate: sentences ? Number((1 - cited / sentences).toFixed(6)) : null,
    loose_citation_rate: rate(loose, sentences),
    invalid_citation_sentences: invalid,
    invalid_citation_rate: rate(invalid, sentences),
    answers_with_no_citation: done.filter((r) => r.citation.cited === 0).length,
  }
}

function errorBlock(records) {
  const out = {}
  for (const r of records) if (r.outcome === 'error') out[r.error] = (out[r.error] || 0) + 1
  return { n: records.filter((r) => r.outcome === 'error').length, by_code: out }
}

export async function main(argv) {
  const opts = parseArgs(argv)
  await ensureJsonLoader()
  const S = await import('../src/staff.js')
  const LLM = await import('../src/staff-llm.mjs')

  const goldenPath = opts.golden ? resolve(opts.golden) : join(ROOT, 'eval', 'golden', 'staff', `${opts.scenario}.jsonl`)
  const replayPath = join(ROOT, 'ui', 'public', 'data', `${opts.scenario}.replay.json`)
  if (!existsSync(goldenPath)) throw new Error(`golden set not found: ${goldenPath}`)
  if (!existsSync(replayPath)) throw new Error(`replay not found: ${replayPath}`)

  const goldenText = readFileSync(goldenPath, 'utf8')
  let items = readJsonl(goldenText)
  const payload = JSON.parse(readFileSync(replayPath, 'utf8'))

  const golden = checkGolden(items, payload.graph)
  golden.file = goldenPath.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', '')
  golden.sha = fnv1a(goldenText)
  console.log(`golden: ${golden.items} items, ${golden.abstain} abstain (${(golden.abstain_share * 100).toFixed(1)}%), per class ${JSON.stringify(golden.per_class)}`)
  if (!golden.ok) {
    for (const p of golden.problems) console.error(`  GOLDEN: ${p}`)
    console.error('FAIL: the golden set is malformed. Nothing was measured.')
    return { exit: 1 }
  }
  if (opts.limit > 0) items = items.slice(0, opts.limit)

  const cfgIn = {
    model: opts.model || undefined,
    endpoint: opts.endpoint || undefined,
    seed: opts.seed,
    timeoutMs: opts.timeoutMs,
  }
  const cfg = LLM.normCfg(cfgIn, 'route')
  const narrateCfg = LLM.normCfg({ ...cfgIn, temperature: opts.narrateTemp }, 'narrate')

  const reg = catalogRegression(S, payload, items)
  console.log(`catalogue regression: ${reg.pass}/${reg.cases} pass, covers ${reg.queries_covered.length}/${QUERY_IDS.length} queries`)
  for (const f of reg.failures) console.error(`  REGRESSION: ${f.id} (${f.query}): ${f.why}`)

  const probe = await probeModel(cfg.endpoint, cfg.model, opts.probeMs)

  const base = {
    tool: 'ui/tools/staff-eval.mjs',
    generated: new Date().toISOString(),
    scenario: opts.scenario,
    code_rev: gitRev(),
    golden,
    endpoint: cfg.endpoint,
    requested_model: cfg.model,
    catalog_regression: {
      cases: reg.cases, pass: reg.pass, fail: reg.fail,
      queries_covered: reg.queries_covered, queries_uncovered: reg.queries_uncovered,
      failures: reg.failures,
    },
  }

  let payloadOut
  let outName
  if (!probe.ok) {
    payloadOut = {
      ...base,
      model: null,
      model_skip: {
        reason: probe.reason,
        detail: probe.detail,
        available_models: probe.available,
      },
      measured: ['catalog_regression'],
      not_measured: ['routing_precision_at_1', 'citation_rate', 'unverified_rate', 'abstention', 'latency'],
      note: [
        '모델에 닿지 못해 라우팅·인용·기권·지연을 측정하지 않았다. 이 값들은 0 이 아니라 null 이다.',
        '돌린 것은 카탈로그 직접 호출 회귀뿐이다 - 골든셋의 기대 질의를 staff.validate + staff.ask 로 실제 실행해 사실이 나오는지만 확인했다.',
        '라우팅 품질에 대해 이 파일은 아무것도 말하지 않는다.',
      ],
      routing: null,
      narration: null,
      abstention: null,
      latency: null,
      errors: null,
      records: [],
    }
    outName = `staff-nomodel-${ymd(new Date())}.json`
    console.log('')
    console.log(`MODEL: not reachable (${probe.reason}) - ${probe.detail}`)
    console.log('ROUTING WAS NOT MEASURED. routing / narration / abstention / latency are null, not zero.')
  } else {
    console.log(`model: ${cfg.model} at ${cfg.endpoint}`)
    const records = await runWithModel(S, LLM, payload, items, cfg, { ...opts, narrateCfg })
    const routing = routingMetrics(records)
    const narration = narrationBlock(records)
    const abst = abstentionMetrics(records)
    payloadOut = {
      ...base,
      model: cfg.model,
      model_skip: null,
      config: {
        // Two temperatures because there are two calls. Both are written even
        // when they are equal: a reader of this file should not have to know
        // staff-llm's defaults to know what produced the citation figures.
        temperature: cfg.temperature,
        route_temperature: cfg.temperature,
        narrate_temperature: opts.narrate ? narrateCfg.temperature : null,
        seed: cfg.seed,
        num_ctx: cfg.numCtx,
        timeout_ms: cfg.timeoutMs,
        retries: opts.retries,
        narrate: opts.narrate,
      },
      measured: ['catalog_regression', 'routing_precision_at_1', 'citation_rate', 'abstention', 'latency'],
      not_measured: [],
      note: [
        'accuracy 는 내지 않는다 (ADR-0008). 클래스가 불균형이라 매크로 평균을 함께 본다.',
        '기권은 두 숫자다 - 기권해야 할 때 기권한 비율과 답해야 할 때 답한 비율. 합치지 않는다.',
      ],
      routing,
      narration,
      abstention: abst,
      latency: {
        route: latencyBlock(records.map((r) => r.route_ms)),
        narrate: latencyBlock(records.map((r) => r.narrate_ms).filter((v) => v !== null)),
      },
      errors: errorBlock(records),
      records,
    }
    outName = `staff-${slug(cfg.model)}-${ymd(new Date())}.json`
    console.log('')
    console.log(`routing macro precision@1: ${routing.macro_precision} (strict ${routing.macro_precision_strict}), micro ${routing.micro_precision}`)
    for (const c of QUERY_IDS) {
      const k = routing.classes[c]
      console.log(`  ${c.padEnd(16)} support ${k.support}  predicted ${k.predicted}  P@1 ${k.precision === null ? 'n/a (never predicted)' : k.precision}`)
    }
    console.log(`citation rate ${narration.citation_rate}, unverified ${narration.unverified_rate}, invalid refs ${narration.invalid_citation_sentences}`)
    console.log(`abstained when it should: ${abst.should_abstain.rate} (${abst.should_abstain.abstained}/${abst.should_abstain.n})`)
    console.log(`answered when it should:  ${abst.should_answer.rate} (${abst.should_answer.answered}/${abst.should_answer.n})`)
    console.log(`route latency p50 ${payloadOut.latency.route.p50_ms}ms p95 ${payloadOut.latency.route.p95_ms}ms`)
  }

  const outDir = join(ROOT, 'eval', 'results')
  mkdirSync(outDir, { recursive: true })
  const outPath = opts.out ? resolve(opts.out) : join(outDir, outName)
  writeFileSync(outPath, JSON.stringify(payloadOut, null, 2) + '\n', 'utf8')
  console.log(`wrote ${outPath}`)

  return { exit: reg.fail ? 1 : 0, result: payloadOut, path: outPath }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invoked) {
  main(process.argv.slice(2)).then((r) => { process.exitCode = r.exit }).catch((e) => {
    console.error(e && e.stack ? e.stack : String(e))
    process.exitCode = 1
  })
}
