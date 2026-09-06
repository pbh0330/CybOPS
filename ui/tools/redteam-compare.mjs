// Adversary comparison harness (ADR-0019 section 5, 04-evaluation.md 2.4).
//
// Runs the same scenario under every attacker strategy over several PRNG seeds
// and writes one comparison file. The point is the last column: greedy is the
// control, and an attacker that does not beat it has not earned its place.
//
//   node tools/redteam-compare.mjs --out ../analysis/redteam/comparison.json
//
// Each run is a separate redteam.mjs process, so what is compared here is
// exactly what the CLI produces. Nothing is recomputed.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

const scenario = arg('scenario', resolve(here, '../../scenarios/tacnet-01/mission.json'))
const entry = arg('entry', 'CO2-VEH')
const turns = arg('turns', '8')
const seeds = arg('seeds', '20260906,20260907,20260908').split(',').map((s) => s.trim())
const model = arg('model', 'qwen2.5:7b-instruct-q4_K_M')
const endpoint = arg('endpoint', 'http://127.0.0.1:11434')
const temp = arg('temp', '0.15')
const outPath = resolve(arg('out', resolve(here, '../../analysis/redteam/comparison.json')))

const variants = [
  { name: 'random', args: ['--strategy', 'random'] },
  { name: 'greedy', args: ['--strategy', 'greedy'] },
  { name: 'llm', args: ['--strategy', 'llm', '--model', model, '--endpoint', endpoint, '--temp', temp] },
  { name: 'llm+gain', args: ['--strategy', 'llm', '--model', model, '--endpoint', endpoint, '--temp', temp, '--show-gain'] },
]

const work = join(tmpdir(), `redteam-compare-${process.pid}`)
mkdirSync(work, { recursive: true })

const runs = []
for (const seed of seeds) {
  for (const v of variants) {
    const out = join(work, `${v.name.replace('+', '-')}-${seed}.json`)
    const llmLog = join(work, `${v.name.replace('+', '-')}-${seed}.llm.json`)
    const a = [
      join(here, 'redteam.mjs'),
      '--scenario', scenario, '--entry', entry, '--turns', turns, '--seed', seed,
      ...v.args, '--out', out,
    ]
    if (v.name.startsWith('llm')) a.push('--llm-log', llmLog)
    process.stderr.write(`run ${v.name} seed ${seed} ... `)
    const t0 = Date.now()
    const r = spawnSync(process.execPath, a, { encoding: 'utf8', cwd: here })
    if (r.status !== 0) {
      console.error(`\nFAILED ${v.name} seed ${seed}\n${r.stdout || ''}\n${r.stderr || ''}`)
      process.exit(1)
    }
    const payload = JSON.parse(readFileSync(out, 'utf8'))
    process.stderr.write(`${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
    runs.push({
      variant: v.name,
      seed: Number(seed),
      metrics: payload.metrics,
      moves: payload.log.map((l) => ({
        turn: l.turn, t: l.t, action: l.action, from: l.from, target: l.target,
        success: l.success, gain: l.gain, best_gain: l.best_gain,
        legal_count: l.legal_count, rationale: l.rationale,
        source: (l.cited && l.cited.source) || null,
      })),
    })
  }
}

// --- aggregation ------------------------------------------------------------

const missionIds = Object.keys(runs[0].metrics.mission_final)
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r4 = (x) => (x == null ? null : Number(x.toFixed(4)))

const summary = {}
for (const v of variants) {
  const rs = runs.filter((r) => r.variant === v.name)
  const s = {
    variant: v.name,
    n_seeds: rs.length,
    mission_final_mean: {},
    mission_final_by_seed: {},
    weighted_objective_final_mean: r4(mean(rs.map((r) => r.metrics.weighted_objective_final))),
    weighted_objective_final_by_seed: Object.fromEntries(rs.map((r) => [r.seed, r.metrics.weighted_objective_final])),
    cumulative_weighted_objective_mean: r4(mean(rs.map((r) => r.metrics.cumulative_weighted_objective))),
    success_rate_mean: r4(mean(rs.map((r) => r.metrics.success_rate))),
    greedy_agreement_mean: r4(mean(rs.map((r) => r.metrics.greedy_agreement))),
    mean_legal_moves: r4(mean(rs.map((r) => r.metrics.mean_legal_moves))),
    sec_per_turn_mean: r4(mean(rs.map((r) => r.metrics.sec_per_turn))),
    action_distribution: {},
    turns_to_threshold: {},
  }
  for (const m of missionIds) {
    s.mission_final_mean[m] = r4(mean(rs.map((r) => r.metrics.mission_final[m])))
    s.mission_final_by_seed[m] = Object.fromEntries(rs.map((r) => [r.seed, r.metrics.mission_final[m]]))
    s.turns_to_threshold[m] = {}
    for (const th of ['0.5', '1']) {
      const hits = rs.map((r) => (r.metrics.turns_to_threshold[m] || {})[th]).filter((x) => x != null)
      s.turns_to_threshold[m][th] = {
        reached_in_n_seeds: hits.length,
        mean_turn: hits.length ? r4(mean(hits)) : null,
      }
    }
  }
  for (const r of rs) {
    for (const [k, n] of Object.entries(r.metrics.action_distribution)) {
      s.action_distribution[k] = (s.action_distribution[k] || 0) + n
    }
  }
  if (v.name.startsWith('llm')) {
    const l = rs.map((r) => r.metrics.llm)
    s.llm = {
      model: l[0].model,
      temperature: l[0].temperature,
      show_gain: l[0].show_gain,
      calls: l.reduce((a, b) => a + b.calls, 0),
      retries: l.reduce((a, b) => a + b.retries, 0),
      invalid_id: l.reduce((a, b) => a + b.invalid_id, 0),
      unparsable: l.reduce((a, b) => a + b.unparsable, 0),
      transport_error: l.reduce((a, b) => a + b.transport_error, 0),
      fallback_greedy: l.reduce((a, b) => a + b.fallback_greedy, 0),
      latency_ms_mean: Math.round(mean(l.map((x) => x.latency_ms_mean))),
      latency_ms_min: Math.min(...l.map((x) => x.latency_ms_min)),
      latency_ms_max: Math.max(...l.map((x) => x.latency_ms_max)),
    }
  }
  summary[v.name] = s
}

// The only column that decides anything (ADR-0019 section 5).
const base = summary.greedy.weighted_objective_final_mean
for (const k of Object.keys(summary)) {
  summary[k].delta_vs_greedy = {
    weighted_objective_final: r4(summary[k].weighted_objective_final_mean - base),
    weighted_objective_final_ratio: r4(summary[k].weighted_objective_final_mean / base),
    beats_greedy: summary[k].weighted_objective_final_mean > base + 1e-9,
  }
  for (const m of missionIds) {
    summary[k].delta_vs_greedy[m] = r4(summary[k].mission_final_mean[m] - summary.greedy.mission_final_mean[m])
  }
}

const payload = {
  generated: new Date().toISOString(),
  generator: 'ui/tools/redteam-compare.mjs',
  adr: 'ADR-0019',
  protocol: '04-evaluation.md 2.4',
  config: { scenario, entry, turns: Number(turns), seeds: seeds.map(Number), model, endpoint, temperature: Number(temp) },
  objective_note:
    'weighted_objective = sum over missions of (final degradation / priority). scoreMoves() 가 쓰는 가중치와 같다. 클수록 공격자에게 유리하다.',
  caveat:
    '합성 시나리오 산출이다. 탐지 성능·오탐률을 주장하지 않는다(CLAUDE.md 규칙 11, ADR-0014 3항, ADR-0019 6항).',
  summary,
  runs,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
try { rmSync(work, { recursive: true, force: true }) } catch {}

console.log('')
console.log('variant     wobj(mean)   delta vs greedy   ' + missionIds.map((m) => m.padEnd(8)).join(' '))
for (const v of variants) {
  const s = summary[v.name]
  console.log(
    v.name.padEnd(11) +
    String(s.weighted_objective_final_mean).padEnd(12) +
    String(s.delta_vs_greedy.weighted_objective_final).padEnd(18) +
    missionIds.map((m) => String((s.mission_final_mean[m] * 100).toFixed(1) + '%').padEnd(8)).join(' ')
  )
}
console.log(`\nwrote ${outPath}`)
