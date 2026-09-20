import { describe, it, expect } from 'vitest'
import payload from '../../public/data/tacnet-01.replay.json'
import { footholds, legalMoves, playTurn, greedyChooser } from '../attack.js'

const g = payload.graph
const t = 150

describe('isolated assets are invisible to the attacker', () => {
  it('footholds() drops isolated ids even at level 1', () => {
    expect(footholds({ 'CO2-VEH': 0.8, 'BN-SRV': 1 })).toEqual(['CO2-VEH', 'BN-SRV'])
    expect(footholds({ 'CO2-VEH': 0.8, 'BN-SRV': 1 }, ['BN-SRV'])).toEqual(['CO2-VEH'])
  })
  it('legalMoves() never targets or launches from an isolated asset', () => {
    const state = { 'CO2-VEH': 0.8 }
    const before = legalMoves(g, state, t)
    const toRelay = before.filter((m) => m.target === 'RELAY-1')
    expect(toRelay.length).toBeGreaterThan(0)
    const after = legalMoves(g, state, t, { isolated: ['RELAY-1'] })
    expect(after.some((m) => m.target === 'RELAY-1' || m.from === 'RELAY-1')).toBe(false)
    // an isolated asset is not a foothold either
    const iso = legalMoves(g, { 'CO2-VEH': 0.8, 'BN-SRV': 1 }, t, { isolated: ['BN-SRV'] })
    expect(iso.some((m) => m.from === 'BN-SRV')).toBe(false)
  })
  it('an isolated transit node also blocks what was reachable only through it', () => {
    // RELAY-1 is the VHF hub: with it isolated, nothing behind it is reachable from CO2-VEH
    const state = { 'CO2-VEH': 0.8 }
    const after = legalMoves(g, state, t, { isolated: ['RELAY-1'] })
    expect(after.some((m) => m.action === 'lateral_move' && m.target === 'BN-SRV')).toBe(false)
  })
  it('the default path is unchanged: same legal ids and same roll with and without an empty option', () => {
    const state = { 'CO2-VEH': 0.8 }
    const a = legalMoves(g, state, t).map((m) => m.id)
    const b = legalMoves(g, state, t, {}).map((m) => m.id)
    expect(a).toEqual(b)
    const r1 = playTurn(g, state, t, { seed: 7, turn: 0, chooser: greedyChooser })
    const r2 = playTurn(g, state, t, { seed: 7, turn: 0, chooser: greedyChooser, isolated: [] })
    expect(r2).toEqual(r1)
  })
  it('playTurn with isolated never lands on the isolated asset', () => {
    const state = { 'CO2-VEH': 0.8 }
    for (let turn = 0; turn < 6; turn++) {
      const r = playTurn(g, state, t, { seed: 3, turn, chooser: greedyChooser, isolated: ['RELAY-1', 'BN-SRV'] })
      if (r.move) expect(['RELAY-1', 'BN-SRV']).not.toContain(r.move.target)
    }
  })
})
