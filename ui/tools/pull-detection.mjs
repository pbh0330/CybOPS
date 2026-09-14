// Copies the detection-tier numbers the rail's evidence card quotes out of
// eval/results/ into src/detection.json, so the bundle carries figures that
// were measured, with their source file and date, and never numbers typed
// into a component. Re-run after any E1-b rescoring; the card shows the
// generated date so a stale copy is visible.
//
//   node tools/pull-detection.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8').replace(/^﻿/, ''))

// The operating point: 900 s window, time features excluded (docs/19 16.3),
// the day cut whose test day is the unseen one, histgb.
const det = read('eval/results/e1b-detection-w900-v3-notime.json')
const split = det.splits.find((s) => s.cut_day === '2019-09-24')
const model = split.models.find((m) => m.model === 'histgb')
const m100 = split.mttd.find((t) => t.budget === 100)
const rules = split.models.filter((m) => m.model.startsWith('rule'))

const sig = read('eval/results/e1b-graph-signals.json')
const rdp = sig.flow_signals.find((f) => f.condition.includes('RDP'))
const wmi = sig.process_pairs.find((p) => /wmiprvse.*powershell/i.test(p.pair))

const out = {
  pulled: new Date().toISOString().slice(0, 10),
  sources: {
    detection: 'eval/results/e1b-detection-w900-v3-notime.json',
    signals: 'eval/results/e1b-graph-signals.json',
  },
  dataset: 'DARPA OpTC (실데이터), Inria 수정 라벨',
  window_sec: det.window_sec,
  train_days: '2019-09-23, 24',
  test_day: '2019-09-25',
  test_positives: split.test_pos,
  test_cells: split.test_cells,
  base_rate: split.test_pos / split.test_cells,
  model: 'histgb, 28 특징 (시각 제외)',
  pr_auc: model.pr_auc,
  precision_at_recall50: model['precision@recall50'],
  rules_pr_auc_max: Math.max(...rules.map((r) => r.pr_auc)),
  budget: m100.budget,
  hosts_caught: m100.hosts_caught,
  hosts_with_positives: m100.hosts_with_positives,
  median_cells_before_first_hit: m100.median_cells_before_first_hit,
  signals: [
    { name: '클라이언트 간 RDP(3389) 흐름', cells: rdp.cells, attack_cells: rdp.attack_cells, technique: 'T1021.001' },
    { name: 'wmiprvse.exe → powershell.exe', cells: wmi.cells, attack_cells: wmi.attack_cells, technique: 'T1047' },
  ],
  signals_caveat: sig.caveat,
}
writeFileSync(join(here, '..', 'src', 'detection.json'), JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out, null, 2))
