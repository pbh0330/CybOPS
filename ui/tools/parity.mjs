// Parity check: the JS engine port must agree with the PowerShell reference.
//
// Two implementations of the same rules drift. This is the thing that catches
// it. It replays every step of every exported scenario through src/engine.js
// and compares against the numbers PowerShell already wrote into the replay
// file. Any mission, task, service or asset value that differs by more than
// TOL is a failure.
//
// PowerShell is the reference. If this fails, the JS port is wrong.
//
//   node tools/parity.mjs
//   node tools/parity.mjs ../ui/public/data/tacnet-01.replay.json

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChain } from '../src/engine.js'

const here = dirname(fileURLToPath(import.meta.url))
const TOL = 1e-9

const files = process.argv.length > 2
  ? process.argv.slice(2).map((p) => resolve(p))
  : readdirSync(join(here, '..', 'public', 'data'))
      .filter((f) => f.endsWith('.replay.json'))
      .map((f) => join(here, '..', 'public', 'data', f))

let failures = 0
let compared = 0

for (const file of files) {
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  const g = payload.graph
  const method = payload.method || 'weighted'
  console.log(`\n${payload.scenario_id}  (${payload.steps.length} steps, method=${method})`)

  for (const step of payload.steps) {
    const t = step.t === null || step.t === undefined ? -1 : Number(step.t)
    const got = runChain(g, step.compromise || {}, { t, method, causes: 'all' })

    const checks = [
      ['mission', step.mission, got.mission],
      ['task', step.task, got.task],
      ['service', step.service, got.service],
      ['asset', step.asset, got.asset],
    ]
    if (step.mission_attack) {
      const atk = runChain(g, step.compromise || {}, { t, method, causes: 'attack' })
      checks.push(['mission_attack', step.mission_attack, atk.mission])
      const env = runChain(g, {}, { t, method, causes: 'env' })
      checks.push(['mission_env', step.mission_env, env.mission])
    }

    for (const [label, expected, actual] of checks) {
      for (const k of Object.keys(expected || {})) {
        compared++
        const e = Number(expected[k])
        const a = Number(actual[k])
        if (!(Math.abs(e - a) <= TOL)) {
          failures++
          console.log(`  MISMATCH t=+${t} ${label}.${k}: ps=${e} js=${a} diff=${Math.abs(e - a)}`)
        }
      }
    }

    // whatif is only in the exported file; recompute it the same way
    for (const id of Object.keys(step.whatif || {})) {
      const w = runChain(g, { ...(step.compromise || {}), [id]: 1 }, { t, method, causes: 'all' })
      for (const m of g.missions || []) {
        compared++
        const e = Number(step.whatif[id].mission[m.id])
        const a = Number(w.mission[m.id])
        if (!(Math.abs(e - a) <= TOL)) {
          failures++
          console.log(`  MISMATCH t=+${t} whatif[${id}].${m.id}: ps=${e} js=${a}`)
        }
      }
    }
  }
}

console.log(`\ncompared ${compared} values, ${failures} mismatch(es)`)
process.exit(failures === 0 ? 0 : 1)
