import { describe, it, expect } from 'vitest'
import payload from '../../public/data/tacnet-01.replay.json'
import { footholds, legalMoves, scoreMoves, playTurn, greedyChooser } from '../attack.js'

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

// greedyChooser: recon is a last resort, and a flat gain is broken by progress.
// recon changes no state, so choosing it while anything else is legal means
// facing the identical position next turn - a livelock, not caution.
describe('greedyChooser does not stand still', () => {
  const flatT = 0   // the operation has not started: every move scores gain 0

  it('never picks recon while another legal move exists', () => {
    for (const tt of [0, 150, 300]) {
      const state = { 'CO2-VEH': 0.5 }
      const legal = scoreMoves(g, state, tt, legalMoves(g, state, tt), 'weighted')
      expect(legal.some((m) => m.action === 'recon')).toBe(true)
      expect(legal.some((m) => m.action !== 'recon')).toBe(true)
      expect(greedyChooser(legal, { g, state, t: tt }).move.action).not.toBe('recon')
    }
  })

  it('picks recon when it is the only legal move', () => {
    const only = [{ id: 'recon', action: 'recon', target: null, from: null, p: 0.95, gain: 0 }]
    expect(greedyChooser(only, { g, state: {}, t: flatT }).move.id).toBe('recon')
  })

  it('from a flat-gain start the attacker still advances over six turns', () => {
    const start = { 'CO2-VEH': 0.5 }
    const legal = scoreMoves(g, start, flatT, legalMoves(g, start, flatT), 'weighted')
    expect(Math.max(...legal.map((m) => m.gain))).toBe(0)   // the flat premise
    let state = start
    const chosen = []
    for (let turn = 0; turn < 6; turn++) {
      const r = playTurn(g, state, flatT, { seed: 20260906, turn, chooser: greedyChooser })
      chosen.push(r.move ? r.move.action : null)
      state = r.state
    }
    expect(chosen.every((a) => a === 'recon')).toBe(false)
    // the compromise picture actually moved: some asset sits higher than it did
    expect(Object.keys(state).some((id) => Number(state[id] || 0) > Number(start[id] || 0))).toBe(true)
  })

  it('is deterministic: the same inputs give the same move id', () => {
    const state = { 'CO2-VEH': 0.5 }
    const legal = scoreMoves(g, state, flatT, legalMoves(g, state, flatT), 'weighted')
    const a = greedyChooser(legal, { g, state, t: flatT }).move.id
    const b = greedyChooser(legal, { g, state, t: flatT }).move.id
    const c = greedyChooser([...legal].reverse(), { g, state, t: flatT }).move.id
    expect(b).toBe(a)
    expect(c).toBe(a)   // input order must not decide it either
  })

  it('with gain and advance tied, the target nearer a crown jewel wins', () => {
    // fixture: HOME reaches FAR and NEAR directly; JEWEL hangs off NEAR, which
    // is a terminal, so JEWEL itself is not a legal target. No missions, so
    // every gain is 0. Both lateral moves are the same action (same p) and
    // raise their target 0 -> 0.5 (the same advance). The only thing left is
    // which one points at the jewel - and FAR is the one that would win on id.
    const fx = {
      assets: [{ id: 'HOME', transit: false }, { id: 'FAR' }, { id: 'NEAR', transit: false }, { id: 'JEWEL', transit: false }],
      links: [{ id: 'l1', a: 'HOME', b: 'FAR' }, { id: 'l2', a: 'HOME', b: 'NEAR' }, { id: 'l3', a: 'NEAR', b: 'JEWEL' }],
      crown_jewels: ['JEWEL'], missions: [], tasks: [], services: [],
    }
    const state = { HOME: 0.8 }
    const legal = scoreMoves(fx, state, 0, legalMoves(fx, state, 0), 'weighted')
    const far = legal.find((m) => m.id === 'lateral_move:HOME->FAR')
    const near = legal.find((m) => m.id === 'lateral_move:HOME->NEAR')
    expect(far && near).toBeTruthy()
    expect(far.gain).toBe(near.gain)
    expect(far.p).toBe(near.p)
    expect('lateral_move:HOME->FAR' < 'lateral_move:HOME->NEAR').toBe(true)   // id order would pick FAR
    expect(greedyChooser(legal, { g: fx, state, t: 0 }).move.id).toBe('lateral_move:HOME->NEAR')
  })
})
