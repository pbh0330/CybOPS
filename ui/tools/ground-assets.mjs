// Put every asset on the ground.
//
// WHY
//
// The scenario carried two independent statements about height: geo.terrain,
// which says where the ridges and valleys are, and each asset's geo.at.z,
// which says how high that asset is. They were written by hand at different
// times and they disagreed. Once the geo view started drawing an actual
// surface the disagreement became visible - nodes hung in the air over the
// valley and sank into the ridge, which asks the obvious question: is there a
// bunker inside that hill?
//
// There is not. A unit sits on the ground, at ground elevation plus however
// far its antenna or its hull lifts it. This tool makes that true in the data
// rather than papering over it in the renderer: it reads the same height field
// the view draws, evaluates it under every authored position, and rewrites z.
//
// The terrain is the authority and the assets follow it. The other direction
// would be worse - fitting the terrain to wherever the assets happen to be
// leaves the terrain meaningless.
//
// This does not touch x or y. Where a unit is, is a scenario decision; how
// high the ground is there, is not.
//
// Usage:
//   node ui/tools/ground-assets.mjs scenarios/tacnet-01/mission.json
//   node ui/tools/ground-assets.mjs scenarios/tacnet-01/mission.json --check
//
// --check reports the differences and exits 1 if any exceed the tolerance,
// which is what CI wants; without it the file is rewritten in place.

import fs from 'node:fs'
import path from 'node:path'
import { makeElev } from '../src/terrain.js'

// How far above the ground the thing actually sits. A mast is not a tablet.
const PLATFORM_M = {
  relay: 12,          // mast on the ridge
  'sat-terminal': 3,  // dish on a trailer
  gateway: 3,
  vehicle: 2,
  'c2-server': 2,
  'fire-control': 2,
  workstation: 2,
  hypervisor: 2,
  terminal: 2,
  tablet: 1,
  handheld: 1,
}
const DEFAULT_PLATFORM_M = 2

function platformOf(asset) {
  const t = String(asset.type || '').toLowerCase()
  if (t in PLATFORM_M) return PLATFORM_M[t]
  for (const k of Object.keys(PLATFORM_M)) if (t.includes(k)) return PLATFORM_M[k]
  if (/veh|truck|carrier/.test(t)) return PLATFORM_M.vehicle
  return DEFAULT_PLATFORM_M
}

const file = process.argv[2]
const check = process.argv.includes('--check')
if (!file) {
  console.error('usage: node ui/tools/ground-assets.mjs <mission.json> [--check]')
  process.exit(2)
}

const raw = fs.readFileSync(file, 'utf8')
const g = JSON.parse(raw)
const terr = g.geo && g.geo.terrain
if (!terr) {
  console.error(`${path.basename(file)}: no geo.terrain, nothing to ground`)
  process.exit(0)
}

const elev = makeElev(terr)
const rows = []
let worst = 0

// Rewriting the text rather than re-serialising the object: the mission files
// are hand maintained and formatted, and ConvertTo-JSON style output would
// reflow every line and bury the change in a diff nobody can read.
let text = raw

function ground(asset, at, label) {
  if (!at || !Number.isFinite(Number(at.x)) || !Number.isFinite(Number(at.y))) return
  const gz = elev(Number(at.x), Number(at.y))
  const want = Math.round(gz + platformOf(asset))
  const have = Math.round(Number(at.z ?? 0))
  if (want === have) return
  worst = Math.max(worst, Math.abs(want - have))
  rows.push({ id: asset.id, where: label, x: at.x, y: at.y, have, want, ground: Math.round(gz) })

  // match this exact coordinate triple, which is unique enough in practice
  const pat = new RegExp(
    `("x"\\s*:\\s*${at.x}\\s*,\\s*"y"\\s*:\\s*${at.y}\\s*,\\s*"z"\\s*:\\s*)${have}\\b`,
  )
  const next = text.replace(pat, `$1${want}`)
  if (next === text) rows[rows.length - 1].note = 'NOT MATCHED'
  text = next
}

for (const a of g.assets || []) {
  const geo = a.geo
  if (!geo) continue
  if (geo.at) ground(a, geo.at, 'fixed')
  ;(geo.segments || []).forEach((s, i) => {
    if (s.at) ground(a, s.at, `seg${i}.at`)
    if (s.to_at) ground(a, s.to_at, `seg${i}.to_at`)
  })
}

const pad = (s, n) => String(s).padEnd(n)
console.log('')
console.log(`ground-assets  ${path.basename(file)}   field=idw-to-feature`)
console.log('-'.repeat(74))
if (!rows.length) {
  console.log('  every asset already sits on the surface')
} else {
  console.log(`  ${pad('asset', 11)}${pad('where', 12)}${pad('ground', 8)}${pad('was', 7)}${pad('now', 7)}delta`)
  for (const r of rows) {
    console.log(`  ${pad(r.id, 11)}${pad(r.where, 12)}${pad(r.ground + ' m', 8)}${pad(r.have, 7)}${pad(r.want, 7)}${r.want - r.have > 0 ? '+' : ''}${r.want - r.have}${r.note ? '   ' + r.note : ''}`)
  }
}
console.log('')

const unmatched = rows.filter((r) => r.note)
if (unmatched.length) {
  console.error(`FAIL: ${unmatched.length} coordinate(s) could not be located in the file text`)
  process.exit(1)
}

if (check) {
  if (rows.length) {
    console.log(`RESULT: FAIL   ${rows.length} asset position(s) off the surface, worst ${worst} m`)
    process.exit(1)
  }
  console.log('RESULT: PASS')
  process.exit(0)
}

if (rows.length) {
  JSON.parse(text) // never write a file we just broke
  fs.writeFileSync(file, text, 'utf8')
  console.log(`written: ${file}`)
  console.log('')
}
