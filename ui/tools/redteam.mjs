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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { playTurn, greedyChooser, randomChooser } from '../src/attack.js'
import { runChain } from '../src/engine.js'

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
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

const g = JSON.parse(readFileSync(scenarioPath, 'utf8'))
if (!(g.assets || []).some((a) => a.id === entry)) {
  console.error(`entry asset not in scenario: ${entry}`)
  process.exit(1)
}

const chooser = strategy === 'random' ? randomChooser(seed) : greedyChooser

let state = { [entry]: 0.5 }
const steps = [{ t: 0, label: '정상', state: {}, note: '침해 없음' }]
const log = []

console.log(`scenario ${g.scenario_id}  entry ${entry}  strategy ${strategy}  seed ${seed}\n`)

for (let i = 0; i < turns; i++) {
  const t = startT + i * stepT
  if (g.timeline && t >= Number(g.timeline.horizon)) break

  const r = playTurn(g, state, t, { method, seed, turn: i, chooser })
  if (!r.move) {
    console.log(`t+${t}  (합법 수 없음)`)
    break
  }
  state = r.state

  const after = runChain(g, state, { t, method, causes: 'all' })
  const missions = (g.missions || []).map((m) => `${m.id} ${(after.mission[m.id] * 100).toFixed(1)}%`).join('  ')

  console.log(
    `t+${String(t).padEnd(4)} ${r.success ? 'HIT ' : 'MISS'} ${r.move.label.padEnd(10)} ` +
    `${(r.move.from || '-')} -> ${(r.move.target || '-')}`.padEnd(26) +
    `gain ${(r.move.gain * 100).toFixed(1)}%p  legal ${r.legal.length}  |  ${missions}`
  )

  log.push({
    turn: i, t, action: r.move.action, from: r.move.from, target: r.move.target,
    technique: r.move.technique, tactic: r.move.tactic,
    p: r.move.p, roll: r.roll, success: r.success,
    gain: r.move.gain, legal_count: r.legal.length,
    rationale: r.rationale, mission: after.mission,
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

const payload = {
  campaign_id: `RED-${strategy.toUpperCase()}`,
  scenario_id: g.scenario_id,
  name: `적대 행위자 시뮬레이션 (${strategy})`,
  victim_entry: entry,
  generator: 'ui/tools/redteam.mjs',
  strategy,
  seed,
  generated: new Date().toISOString(),
  note: '시뮬레이션 산출이다. 실제 네트워크에 접속하거나 명령을 실행하지 않는다(ADR-0019 7항). 환경 단절은 여기 넣지 않는다 - mission.json 의 outages 가 담당한다.',
  steps,
  log,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')

const final = runChain(g, state, { t: startT + (turns - 1) * stepT, method, causes: 'all' })
console.log('\n최종 임무 저하도')
for (const m of g.missions || []) {
  console.log(`  ${m.id.padEnd(8)} ${(final.mission[m.id] * 100).toFixed(2)}%`)
}
console.log(`\nwrote ${outPath}  (침해 단계 ${steps.length - 1}개, 턴 로그 ${log.length}개)`)
