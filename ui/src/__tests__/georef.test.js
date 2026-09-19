import { describe, it, expect } from 'vitest'
import { toLonLat, fromLonLat, toMgrs } from '../georef.js'

const georef = { anchor: { x: 0, y: 0, lat: 38.02, lon: 128.08 } }

describe('local plane <-> WGS84', () => {
  it('anchor maps to itself', () => {
    expect(toLonLat(georef, 0, 0)).toEqual([128.08, 38.02])
  })
  it('round trips within 1 m across the AO', () => {
    for (const [x, y] of [[0, 0], [24000, 18000], [5700, 9600], [13500, 11700]]) {
      const [lon, lat] = toLonLat(georef, x, y)
      const back = fromLonLat(georef, lon, lat)
      expect(Math.abs(back.x - x)).toBeLessThan(1)
      expect(Math.abs(back.y - y)).toBeLessThan(1)
    }
  })
  it('uses the scenario formula: y/111320 north, x/(111320 cos lat0) east', () => {
    const [lon, lat] = toLonLat(georef, 1000, 1000)
    expect(lat).toBeCloseTo(38.02 + 1000 / 111320, 6)
    expect(lon).toBeCloseTo(128.08 + 1000 / (111320 * Math.cos(38.02 * Math.PI / 180)), 6)
  })
})

describe('MGRS (reference values from python mgrs 1.5)', () => {
  it.each([
    [38.02, 128.08, '52SDH1924708433'],
    [38.123, 128.211, '52SDH3084319756'],
    [38.18, 128.35, '52SDH4307125986'],
    [36.45, 128.5, '52SDF5519333978'],
  ])('%f,%f -> %s', (lat, lon, want) => {
    expect(toMgrs(lat, lon, 5)).toBe(want)
  })
  it('truncates to the requested precision', () => {
    expect(toMgrs(38.02, 128.08, 2)).toBe('52SDH1908')
  })
})
