import { describe, it, expect } from 'vitest'
import { markerRows, linkFeatures, trackFeatures, attackArcFeatures, gridFeatures, aoFeature, stackAt, ghostFeatures, WIRE } from '../mapLayers.js'
import { CAUSE_COLOR } from '../graph.js'

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
  it('sorts the ids rather than returning input order', () => {
    const unsorted = [
      { id: 'Z', x: 100, y: 100 },
      { id: 'A', x: 108, y: 104 },   // 9px 거리
    ]
    expect(stackAt(unsorted, 'Z', 22)).toEqual(['A', 'Z'])
  })
})

// U9: the link candidates of the selected asset, on the ground. Straight and
// not arced - the attack arc curves because it is a route somebody took, and
// a candidate is not a route. `kind` rides on the feature because MapLibre
// cannot make line-dasharray data-driven, so MapPane filters one source into
// two line layers: the dashed / dotted distinction is the whole point and
// must not vanish into one style.
describe('ghostFeatures', () => {
  const gh = (over) => ({ from: 'A', cands: [], offRule: [], ...over })

  it('draws a two-point line per candidate, from the selected asset outward', () => {
    const out = ghostFeatures(graph, gh({ cands: [{ to: 'B', bearer: 'vhf', w: 3.6 }] }), 0, georef)
    expect(out.lines.features).toHaveLength(1)
    const f = out.lines.features[0]
    expect(f.geometry.type).toBe('LineString')
    expect(f.geometry.coordinates).toHaveLength(2)
    expect(f.properties).toMatchObject({ kind: 'cand', from: 'A', to: 'B', bearer: 'vhf', w: 3.6 })
  })

  it('gives a candidate an endpoint handle short of the far marker', () => {
    const out = ghostFeatures(graph, gh({ cands: [{ to: 'B', bearer: 'vhf', w: 3 }] }), 0, georef)
    expect(out.ends.features).toHaveLength(1)
    const [lon0, lat0] = out.lines.features[0].geometry.coordinates[0]
    const [lon1, lat1] = out.lines.features[0].geometry.coordinates[1]
    const [lonE, latE] = out.ends.features[0].geometry.coordinates
    // between the two ends, and nearer the far one
    const span = Math.hypot(lon1 - lon0, lat1 - lat0)
    expect(Math.hypot(lonE - lon0, latE - lat0)).toBeLessThan(span)
    expect(Math.hypot(lonE - lon1, latE - lat1)).toBeLessThan(span / 2)
    expect(out.ends.features[0].properties.to).toBe('B')
  })

  it('tags an out-of-rule link and gives it no handle: there is nothing to connect', () => {
    const out = ghostFeatures(graph, gh({ offRule: [{ id: 'L-1', to: 'B', bearer: 'wired', w: 2 }] }), 0, georef)
    expect(out.lines.features.map((f) => f.properties.kind)).toEqual(['off'])
    expect(out.ends.features).toHaveLength(0)
  })

  it('drops an end that has no position, and draws nothing without a selection', () => {
    const out = ghostFeatures(graph, gh({ cands: [{ to: 'NOWHERE', bearer: 'vhf', w: 3 }] }), 0, georef)
    expect(out.lines.features).toHaveLength(0)
    expect(ghostFeatures(graph, null, 0, georef).lines.features).toHaveLength(0)
    expect(ghostFeatures(graph, gh({ from: 'NOWHERE' }), 0, georef).lines.features).toHaveLength(0)
  })
})

// U7. The one thing that can go wrong in a holographic render mode on THIS
// screen is colour, and the trap is one level deeper than "do not recolour
// the assets": `--mobility` is cyan (#35c8ff), so a RedCarpet-style cyan
// terrain would not add a ninth saturated colour, it would spend one of the
// eight on the background and make the whole map read as "mobility cause"
// (ADR-0024, ADR-0012). A comment does not stop that. This does.
describe('WIRE palette (U7)', () => {
  const colors = () => Object.entries(WIRE).filter(([, v]) => typeof v === 'string' && v.startsWith('#'))

  // ADR-0025 section 3 sets the bar itself: the navy-black surfaces count as
  // achromatic because their OKLCH chroma is at or under 0.03. A raw
  // channel-spread test would have failed --surface-board (#070a10, spread 9
  // of 255) and would have been the wrong rule, not a caught bug. So measure
  // the quantity the ADR measures.
  const chroma = (h) => {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
    const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255))
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return Math.hypot(
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    )
  }

  it('has colours at all, so the assertions below are not vacuous', () => {
    expect(colors().length).toBeGreaterThan(0)
    // the measure works: cyan, the colour this mode is not allowed to be, is
    // far over the bar
    expect(chroma(CAUSE_COLOR.mobility)).toBeGreaterThan(0.1)
  })

  it('is achromatic by the ADR-0025 bar: OKLCH chroma at or under 0.03', () => {
    for (const [k, v] of colors()) {
      expect(chroma(v), `${k} = ${v} carries chroma ${chroma(v).toFixed(4)}`).toBeLessThanOrEqual(0.03)
    }
  })

  // Chroma alone is not enough: --maintenance (#7f8794) measures 0.0217 and
  // would clear the bar above, so an exact-match test has to sit next to it.
  it('reuses none of the eight cause colours', () => {
    const causes = Object.values(CAUSE_COLOR).map((c) => String(c).toLowerCase())
    for (const [k, v] of colors()) {
      expect(causes, `${k} = ${v} is a cause colour`).not.toContain(v.toLowerCase())
    }
  })

  it('keeps every opacity a real fraction, so no layer is accidentally opaque or gone', () => {
    for (const [k, v] of Object.entries(WIRE)) {
      if (!/Opacity$/.test(k)) continue
      expect(v, k).toBeGreaterThan(0)
      expect(v, k).toBeLessThanOrEqual(1)
    }
  })

  it('brightens the 2 km grid past the 0.14 it is drawn at with a basemap', () => {
    expect(WIRE.gridOpacity).toBeGreaterThan(0.14)
    // and the fine grid stays under it: the 2 km grid is the one that is read
    expect(WIRE.fineOpacity).toBeLessThan(WIRE.gridOpacity)
  })
})

// The fine grid is the SAME gridFeatures call at a smaller spacing - no
// contour is computed anywhere, which is the whole point of the approach.
describe('gridFeatures at the wire spacing', () => {
  it('subdivides the 2 km grid without leaving the extent', () => {
    const coarse = gridFeatures(georef, extent, 2000).lines.features[0].geometry.coordinates
    const fineLines = gridFeatures(georef, extent, WIRE.fineSpacing).lines.features[0].geometry.coordinates
    expect(fineLines.length).toBeGreaterThan(coarse.length)
    // 2000 / 500 = 4 subdivisions per cell, so 4x the lines minus the shared edges
    expect(fineLines.length).toBe(49 + 37)
    const [[lon0, lat0]] = gridFeatures(georef, extent, 2000).labels.features.map((f) => f.geometry.coordinates)
    for (const seg of fineLines) {
      for (const [lon, lat] of seg) {
        expect(lon).toBeGreaterThanOrEqual(lon0 - 1e-9)
        expect(lat).toBeGreaterThanOrEqual(lat0 - 1e-9)
      }
    }
  })
})
