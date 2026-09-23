import { describe, it, expect } from 'vitest'
import { markerRows, linkFeatures, trackFeatures, attackArcFeatures, gridFeatures, aoFeature, stackAt } from '../mapLayers.js'

const georef = { anchor: { x: 0, y: 0, lat: 38.02, lon: 128.08 } }
const extent = { x: [0, 24000], y: [0, 18000] }
const graph = {
  assets: [
    { id: 'A', geo: { kind: 'fixed', at: { x: 1000, y: 1000, z: 10 } } },
    { id: 'B', geo: { kind: 'track', segments: [
      { from: 0, to: 100, mode: 'move', at: { x: 0, y: 0, z: 0 }, to_at: { x: 2000, y: 0, z: 0 } },
      { from: 100, to: 200, mode: 'hold', at: { x: 2000, y: 0, z: 0 } } ] } },
    { id: 'C', geo: { kind: 'track', segments: [{ from: 50, to: 60, mode: 'hold', at: { x: 5, y: 5, z: 0 } }] } },
  ],
  links: [{ id: 'L1', a: 'A', b: 'B', bearer: 'vhf' }, { id: 'L2', a: 'A', b: 'C', bearer: 'wired' }],
}
const step = { compromise: { A: 1 }, link_outage: { L1: 'terrain' }, asset_outage: { B: 'mobility' } }

describe('markerRows', () => {
  it('drops assets whose position is undefined at t', () => {
    const rows = markerRows(graph, step, 150, georef)
    expect(rows.map((r) => r.id)).toEqual(['A', 'B'])
    expect(rows[0]).toMatchObject({ compromise: 1, outage: null })
    expect(rows[1]).toMatchObject({ outage: 'mobility', lon: expect.any(Number) })
  })
})

describe('linkFeatures', () => {
  it('draws only links with both ends placed, with cause and cut flags', () => {
    const fc = linkFeatures(graph, step, 150, georef)
    expect(fc.features.length).toBe(1)
    expect(fc.features[0].properties).toEqual({ id: 'L1', cause: 'terrain', cut: true, bearer: 'vhf', dead: false })
    expect(fc.features[0].geometry.coordinates.length).toBe(2)
  })
  it('marks links touching an isolated asset as dead', () => {
    const fc = linkFeatures(graph, step, 150, georef, ['B'])
    expect(fc.features[0].properties.dead).toBe(true)
    expect(linkFeatures(graph, step, 150, georef).features[0].properties.dead).toBe(false)
  })
})

describe('trackFeatures', () => {
  it('traces the path so far, interpolated inside a move', () => {
    const fc = trackFeatures(graph, 50, georef)
    const b = fc.features.find((f) => f.properties.id === 'B')
    expect(b.geometry.coordinates.length).toBe(2)
    const [lon1] = b.geometry.coordinates[1]
    const [lon0] = b.geometry.coordinates[0]
    expect(lon1).toBeGreaterThan(lon0)                     // moved east
    expect(fc.features.some((f) => f.properties.id === 'A')).toBe(false)   // fixed assets have no track
  })
})

describe('attackArcFeatures', () => {
  it('bends an arc between the two assets and labels it', () => {
    const fc = attackArcFeatures(graph, [{ from: 'A', to: 'B', t: 120, technique: 'T1021' }], 150, georef)
    expect(fc.features.length).toBe(1)
    expect(fc.features[0].geometry.coordinates.length).toBe(25)
    expect(fc.features[0].properties.label).toContain('+120분')
  })
})

describe('gridFeatures / aoFeature', () => {
  it('makes 13 vertical and 10 horizontal 2 km lines and labels them in MGRS', () => {
    const { lines, labels } = gridFeatures(georef, extent, 2000)
    expect(lines.features[0].geometry.coordinates.length).toBe(13 + 10)
    expect(labels.features.length).toBe(13 + 10)
    expect(labels.features[0].properties.text).toMatch(/^[A-Z]{2}\d{4}$/)
  })
  it('closes the AO polygon', () => {
    const ring = aoFeature(georef, extent).geometry.coordinates[0]
    expect(ring.length).toBe(5)
    expect(ring[0]).toEqual(ring[4])
  })
})

describe('stackAt', () => {
  const pts = [
    { id: 'A', x: 100, y: 100 },
    { id: 'B', x: 108, y: 104 },   // 9px 거리
    { id: 'C', x: 160, y: 100 },   // 60px 거리
  ]
  it('collects what is within the radius, including itself, sorted', () => {
    expect(stackAt(pts, 'A', 22)).toEqual(['A', 'B'])
  })
  it('a lone marker returns just itself', () => {
    expect(stackAt(pts, 'C', 22)).toEqual(['C'])
  })
  it('an unknown id returns an empty array rather than throwing', () => {
    expect(stackAt(pts, 'ZZZ', 22)).toEqual([])
  })
  it('is symmetric: B sees A too', () => {
    expect(stackAt(pts, 'B', 22)).toEqual(['A', 'B'])
  })
})
