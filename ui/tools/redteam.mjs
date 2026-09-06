// Headless adversary run (ADR-0019).
//
// Rolls turns against a scenario and writes an attack timeline the existing
// pipeline already understands, so nothing downstream has to change:
//
//   node tools/redteam.mjs --scenario ../scenarios/tacnet-01/mission.json \
//        --entry CO2-VEH --turns 8 --out ../scenarios/tacnet-01/attack-timeline.redteam.json
//   .\scripts\Export-ReplayData.ps1 -Timeline scenarios\tacnet-01\attack-timeline.redteam.json
//
// The attacker here is `greedy` by default: no model, no network. That is the
// control the LLM attacker has to beat (ADR-0019 section 5).
//
// Strategies:
//   --strategy greedy   largest one-step mission-degradation gain (control)
//   --strategy random   uniform over legal moves (floor)
//   --strategy llm      a model picks one of the enumerated legal moves
//
// LLM options (Ollama-compatible /api/chat):
//   --model qwen2.5:7b-instruct-q4_K_M   --endpoint http://127.0.0.1:11434
//   --temp 0.15   --timeout 240000   --keep-alive 30m
//   --show-gain          hand the engine's one-step gain to the model too.
//                        Off by default: gain IS greedy's decision statistic,
//                        so showing it makes "llm == greedy" true by
//                        construction (docs/13-adversary-comparison.md).
//   --llm-log <path>     per-turn attempts, latencies, fallbacks

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { playTurn, greedyChooser, randomChooser, legalMoves, scoreMoves } from '../src/attack.js'
import { createLLMChooser } from '../src/attack-llm.mjs'
import { runChain } from '../src/engine.js'

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const scenarioPath = resolve(arg('scenario', '../scenarios/tacnet-01/mission.json'))
const entry = arg('entry', 'CO2-VEH')
const turns = Number(arg('turns', 8))
const seed = Number(arg('seed', 20260906))
const strategy = arg('strategy', 'greedy')
const startT = Number(arg('start', 150))
const stepT = Number(arg('step', 30))
const method = arg('method', 'weighted')
const outPath = resolve(arg('out', '../scenarios/tacnet-01/attack-timeline.redteam.json'))
const llmLogPath = arg('llm-log', null)

const g = JSON.parse(readFileSync(scenarioPath, 'utf8'))
if (!(g.assets || []).some((a) => a.id === entry)) {
  console.error(`entry asset not in scenario: ${entry}`)
  process.exit(1)
}
if (!['greedy', 'random', 'llm'].includes(strategy)) {
  console.error(`unknown strategy: ${strategy} (greedy|random|llm)`)
  process.exit(1)
}

let llm = null
if (strategy === 'llm') {
  llm = createLLMChooser({
    endpoint: arg('endpoint', 'http://127.0.0.1:11434'),
    model: arg('model', 'qwen2.5:7b-instruct-q4_K_M'),
    temperature: Number(arg('temp', 0.15)),
    timeoutMs: Number(arg('timeout', 240000)),
    keepAlive: arg('keep-alive', '30m'),
    showGain: flag('show-gain'),
    seed,
  })
}
const chooser = strategy === 'random' ? randomChooser(seed) : greedyChooser

let state = { [entry]: 0.5 }
const steps = [{ t: 0, label: '정상', state: {}, note: '침해 없음' }]
const log = []

const tag = strategy === 'llm' ? `llm(${llm.config.model}${llm.config.showGain ? ', +gain' : ''})` : strategy
console.log(`scenario ${g.scenario_id}  entry ${entry}  strategy ${tag}  seed ${seed}\n`)

const runStart = Date.now()

for (let i = 0; i < turns; i++) {
  const t = startT + i * stepT
  if (g.timeline && t >= Number(g.timeline.horizon)) break

  let r
  if (strategy === 'llm') {
    // Two-step so the model call can be awaited. The engine still enumerates
    // and scores; the model only names one id, and playTurn still rolls.
    const legal = scoreMoves(g, state, t, legalMoves(g, state, t), method)
    if (!legal.length) {
      console.log(`t+${t}  (합법 수 없음)`)
      break
    }
    const now = runChain(g, state, { t, method, causes: 'all' })
    const choice = await llm(legal, { g, state, t, turn: i, missionNow: now.mission })
    r = playTurn(g, state, t, { method, seed, turn: i, chooser: () => choice })
  } else {
    r = playTurn(g, state, t, { method, seed, turn: i, chooser })
  }

  if (!r.move) {
    console.log(`t+${t}  (합법 수 없음)`)
    break
  }
  state = r.state

  const after = runChain(g, state, { t, method, causes: 'all' })
  const missions = (g.missions || []).map((m) => `${m.id} ${(after.mission[m.id] * 100).toFixed(1)}%`).join('  ')

  const lat = strategy === 'llm' ? `  ${(llm.stats.turns[llm.stats.turns.length - 1].latency_ms / 1000).toFixed(1)}s` : ''
  console.log(
    `t+${String(t).padEnd(4)} ${r.success ? 'HIT ' : 'MISS'} ${r.move.label.padEnd(10)} ` +
    `${(r.move.from || '-')} -> ${(r.move.target || '-')}`.padEnd(26) +
    `gain ${(r.move.gain * 100).toFixed(1)}%p  legal ${r.legal.length}  |  ${missions}${lat}`
  )
  if (strategy === 'llm' && r.rationale) console.log(`        ${r.rationale}`)

  log.push({
    turn: i, t, action: r.move.action, from: r.move.from, target: r.move.target,
    technique: r.move.technique, tactic: r.move.tactic,
    p: r.move.p, roll: r.roll, success: r.success,
    gain: r.move.gain, legal_count: r.legal.length,
    best_gain: Math.max(...r.legal.map((m) => m.gain)),
    rationale: r.rationale, cited: r.cited || null, mission: after.mission,
  })

  if (r.success) {
    steps.push({
      t,
      label: `${r.move.label} ${r.move.target || ''}`.trim(),
      state: { ...state },
      gt: { technique: r.move.technique, tactic: r.move.tactic },
      note: r.rationale || '',
    })
  }
}

const wallMs = Date.now() - runStart
const final = runChain(g, state, { t: startT + (turns - 1) * stepT, method, causes: 'all' })

// --- metrics (04-evaluation.md 2.4) -----------------------------------------

const missionFinal = {}
for (const m of g.missions || []) missionFinal[m.id] = Number((final.mission[m.id] || 0).toFixed(6))

// turns to threshold, per mission
const thresholds = [0.5, 1.0]
const turnsTo = {}
for (const m of g.missions || []) {
  turnsTo[m.id] = {}
  for (const th of thresholds) {
    const hit = log.find((l) => (l.mission[m.id] || 0) >= th - 1e-9)
    turnsTo[m.id][String(th)] = hit ? hit.turn + 1 : null
  }
}

const dist = {}
for (const l of log) dist[l.action] = (dist[l.action] || 0) + 1

// weighted objective: same weighting scoreMoves() uses, so red and blue agree
const wObj = (mission) =>
  (g.missions || []).reduce((s, m) => s + (mission[m.id] || 0) / Math.max(1, Number(m.priority) || 1), 0)

const metrics = {
  strategy,
  variant: strategy === 'llm' ? (llm.config.showGain ? 'llm+gain' : 'llm') : strategy,
  turns_played: log.length,
  mission_final: missionFinal,
  weighted_objective_final: Number(wObj(final.mission).toFixed(6)),
  cumulative_weighted_objective: Number(log.reduce((s, l) => s + wObj(l.mission), 0).toFixed(6)),
  turns_to_threshold: turnsTo,
  attempts: log.length,
  successes: log.filter((l) => l.success).length,
  success_rate: log.length ? Number((log.filter((l) => l.success).length / log.length).toFixed(4)) : null,
  action_distribution: dist,
  mean_legal_moves: log.length ? Number((log.reduce((s, l) => s + l.legal_count, 0) / log.length).toFixed(2)) : null,
  // how often the chosen move was also the engine's argmax gain. greedy is 1.0
  // by definition; for llm it says how far it strays from the control.
  greedy_agreement: log.length
    ? Number((log.filter((l) => Math.abs(l.gain - l.best_gain) < 1e-9).length / log.length).toFixed(4))
    : null,
  wall_ms: wallMs,
  sec_per_turn: log.length ? Number((wallMs / log.length / 1000).toFixed(2)) : null,
}

if (strategy === 'llm') {
  const lat = llm.stats.latency_ms
  metrics.llm = {
    model: llm.config.model,
    temperature: llm.config.temperature,
    show_gain: llm.config.showGain,
    calls: llm.stats.calls,
    retries: llm.stats.retries,
    invalid_id: llm.stats.invalid_id,
    unparsable: llm.stats.unparsable,
    transport_error: llm.stats.transport_error,
    fallback_greedy: llm.stats.fallback_greedy,
    latency_ms_mean: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    latency_ms_min: lat.length ? Math.min(...lat) : null,
    latency_ms_max: lat.length ? Math.max(...lat) : null,
  }
}

const payload = {
  campaign_id: `RED-${(metrics.variant || strategy).toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
  scenario_id: g.scenario_id,
  name: `적대 행위자 시뮬레이션 (${tag})`,
  victim_entry: entry,
  generator: 'ui/tools/redteam.mjs',
  strategy,
  seed,
  generated: new Date().toISOString(),
  note: '시뮬레이션 산출이다. 실제 네트워크에 접속하거나 명령을 실행하지 않는다(ADR-0019 7항). 환경 단절은 여기 넣지 않는다 - mission.json 의 outages 가 담당한다.',
  metrics,
  steps,
  log,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')

if (strategy === 'llm' && llmLogPath) {
  const p = resolve(llmLogPath)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ config: llm.config, stats: llm.stats }, null, 2), 'utf8')
  console.log(`wrote ${p}`)
}

console.log('\n최종 임무 저하도')
for (const m of g.missions || []) {
  console.log(`  ${m.id.padEnd(8)} ${(final.mission[m.id] * 100).toFixed(2)}%`)
}
if (strategy === 'llm') {
  const s = metrics.llm
  console.log(
    `\nLLM  호출 ${s.calls}  재시도 ${s.retries}  목록밖 id ${s.invalid_id}  파싱실패 ${s.unparsable}  ` +
    `전송오류 ${s.transport_error}  greedy 폴백 ${s.fallback_greedy}`
  )
  console.log(`     지연 평균 ${(s.latency_ms_mean / 1000).toFixed(1)}s (최소 ${(s.latency_ms_min / 1000).toFixed(1)}s, 최대 ${(s.latency_ms_max / 1000).toFixed(1)}s)`)
}
console.log(`\nwrote ${outPath}  (침해 단계 ${steps.length - 1}개, 턴 로그 ${log.length}개)`)
