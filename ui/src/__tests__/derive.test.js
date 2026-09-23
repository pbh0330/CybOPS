import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import { startGame, defend, pass, attackerTurn } from '../game.js'
import { eventRows, kpiOf, timeLabel, BAND_LABELS, gameOverlay, peekLine } from '../derive.js'

const graph = {
  timeline: { t0_iso: '2026-09-10T06:00:00+09:00', horizon: 420, step: 15 },
  units: [{ id: 'U-1BN', name: '1대대' }],
  missions: [{ id: 'M-C2', name: '지휘통제', priority: 1 }, { id: 'M-FIRE', name: '화력지원', priority: 2 }],
  phases: [{ id: 'PH-1', mission: 'M-C2', name: '집결·준비' }, { id: 'PH-2', mission: 'M-C2', name: '기동' }],
  assets: [
    { id: 'BN-SRV', type: 'c2-server', unit: 'U-1BN', site: '대대 지휘소',
      geo: { kind: 'track', segments: [
        { from: 0, to: 95, mode: 'hold', at: { x: 0, y: 0, z: 0 } },
        { from: 95, to: 125, mode: 'move', at: { x: 0, y: 0, z: 0 }, to_at: { x: 1, y: 1, z: 1 } },
        { from: 125, to: 420, mode: 'hold', at: { x: 1, y: 1, z: 1 } } ] } },
    { id: 'CO2-VEH', type: 'c2-terminal', unit: 'U-1BN', site: '2중대 지휘차', geo: { kind: 'fixed', at: { x: 0, y: 0, z: 0 } } },
  ],
  links: [{ id: 'L-SAT-TOC', a: 'BN-SRV', b: 'CO2-VEH', bearer: 'satcom' }],
}

const steps = [
  { t: 0, active_phases: ['PH-1'], compromise: {}, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
  { t: 90, active_phases: ['PH-2'], compromise: {}, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
  { t: 300, label: 'BN-SRV 장악', gt: [{ technique: 'T1078.002' }], compromise: { 'BN-SRV': 1 },
    link_outage: { 'L-SAT-TOC': 'unknown' }, asset_outage: {} },
  { t: 345, active_phases: ['PH-2'], compromise: { 'BN-SRV': 1 }, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
]
const payload = { steps }

describe('timeLabel', () => {
  it('formats wall clock from t0', () => expect(timeLabel(graph, 300)).toBe('11:00'))
  it('falls back to offset without t0', () => expect(timeLabel({}, 300)).toBe('+300분'))
})

describe('eventRows', () => {
  const rows = eventRows(graph, payload)
  it('is sorted by t', () => {
    const ts = rows.map((r) => r.t)
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
  })
  it('emits a phase change, an attack, an outage, a restore and two moves', () => {
    const kinds = rows.map((r) => r.kind)
    expect(kinds.filter((k) => k === 'phase').length).toBe(2)    // PH-1 at t=0, PH-2 at t=90
    expect(kinds.filter((k) => k === 'attack').length).toBe(1)
    expect(kinds.filter((k) => k === 'outage').length).toBe(1)
    expect(kinds.filter((k) => k === 'restore').length).toBe(1)
    expect(kinds.filter((k) => k === 'move').length).toBe(2)     // start 95, arrive 125
  })
  it('names things in Korean and carries the cause', () => {
    const out = rows.find((r) => r.kind === 'outage')
    expect(out.cause).toBe('unknown')
    expect(out.text).toContain('단절')
    const atk = rows.find((r) => r.kind === 'attack')
    expect(atk.cause).toBe('attack')
    expect(atk.text).toContain('대대 지휘소')
  })
  it('points each row at the last step at or before its t', () => {
    const move = rows.find((r) => r.kind === 'move' && r.t === 95)
    expect(move.stepIdx).toBe(1)                                  // t=90 is the last step <= 95
    expect(rows.find((r) => r.kind === 'restore').stepIdx).toBe(3)
  })
})

describe('kpiOf', () => {
  it('counts compromised assets and cut links by cause, and bands the worst mission', () => {
    const k = kpiOf(graph, { ...steps[2], mission: { 'M-C2': 0.72, 'M-FIRE': 0 }, mission_active: { 'M-C2': true, 'M-FIRE': true } })
    expect(k.compromised).toEqual({ n: 1, total: 2 })
    expect(k.cuts).toEqual({ n: 1, byCause: { unknown: 1 } })
    expect(k.band).toEqual({ level: 3, label: '심각' })
    expect(k.missions[0]).toMatchObject({ id: 'M-C2', total: 0.72, active: true })
  })
  it('bands 0 / <0.3 / <0.7 / >=0.7', () => {
    const at = (v) => kpiOf(graph, { mission: { 'M-C2': v }, compromise: {}, link_outage: {} }).band.level
    expect([at(0), at(0.1), at(0.5), at(0.7)]).toEqual([0, 1, 2, 3])
    expect(BAND_LABELS).toEqual(['정상', '주의', '경계', '심각'])
  })
})

describe('gameOverlay', () => {
  const g = replay.graph
  it('returns null without a game', () => expect(gameOverlay(g, null)).toBe(null))
  it('lists lateral candidates as edges, self-targets as node threats, and marks isolated/footholds', () => {
    let G = startGame(g, { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' })
    G = defend(g, G, { type: 'isolate', id: 'FDC-TERM' })
    const o = gameOverlay(g, G)
    expect(o.isolated).toEqual(['FDC-TERM'])
    expect(o.footholds).toEqual(['CO2-VEH'])
    expect(o.candidates.every((c) => c.from !== c.to)).toBe(true)
    expect(o.candidates.length + o.nodeThreats.length).toBeLessThanOrEqual(6)
    expect(o.last).toBe(null)
    G = attackerTurn(g, G)
    const o2 = gameOverlay(g, G)
    expect(o2.turn).toBe(1)
    if (G.history[0].attacker && G.history[0].attacker.move.target) expect(o2.last).toMatchObject({ turn: 0 })
  })
})

describe('peekLine', () => {
  const s = { ...steps[2], mission: { 'M-C2': 0.72, 'M-FIRE': 0.1 }, mission_active: { 'M-C2': true, 'M-FIRE': true } }
  it('headlines the top-priority mission and its degradation', () => {
    expect(peekLine(graph, s, null)).toBe('지휘통제 P1 72.0%')
  })
  it('skips a mission the current phase has switched off', () => {
    const off = { ...s, mission_active: { 'M-C2': false, 'M-FIRE': true } }
    expect(peekLine(graph, off, null)).toBe('화력지원 P2 10.0%')
  })
  it('reads zero before anything has happened', () => {
    expect(peekLine(graph, steps[0], null)).toBe('지휘통제 P1 0.0%')
  })
  it('a running game replaces it with the turn and the score', () => {
    const g = replay.graph
    let G = startGame(g, { mode: 'hold', turns: 8, t: 150, foothold: { id: 'CO2-VEH', level: 0.8 }, seed: 11, strategy: 'greedy' })
    expect(peekLine(g, s, G)).toBe(`턴 1/8 · 점수 ${G.score.total.toFixed(2)}`)
    G = pass(G)
    G = attackerTurn(g, G)
    expect(peekLine(g, s, G)).toBe(`턴 2/8 · 점수 ${G.score.total.toFixed(2)}`)
  })
  it('survives a graph with no missions at all', () => {
    expect(peekLine({ missions: [] }, {}, null)).toBe('임무 없음')
  })
})
