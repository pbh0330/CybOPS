// Height field and contours for the geo view (docs/17-geo-layer.md, ADR-0002).
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// The scenario authors terrain as a handful of shapes: a ridge line with a
// crest elevation, a valley floor, an assembly area, and a few spot heights.
// That is enough to say "the relay is on a ridge and the TOC is in a bowl",
// but it draws as three lines on an empty grid, which reads as nothing.
//
// So we interpolate a continuous surface from those shapes and draw it -
// shaded relief plus contour lines, the way a topographic map does. The
// surface is not data. It is a picture generated from the authored shapes,
// and every number on it (including the contour labels) is a consequence of
// the interpolation, not a measurement. Real DEM tiles are deliberately not
// used: geo.safety.basemap_policy forbids laying real terrain under fictional
// coordinates, because a reader would then take the terrain as real.
//
// Nothing here is read by the engine. scripts/Test-GeoInvariance.ps1 asserts
// that mission degradation is invariant under geo mutation, and this file is
// downstream of that boundary: it consumes geo and produces pixels.
//
// INTERPOLATION
//
// Inverse distance weighting, but distance is measured to the *shape*, not to
// its vertices: the nearest point on a polyline, or zero inside a polygon.
// Weighting to vertices makes a ridge look like three separate hills with
// saddles between them, which is exactly the wrong picture. A background pull
// toward field.base_elev_m keeps far corners from inheriting whatever feature
// happens to be least distant.
//
//   h(p) = ( sum_i w_i z_i + w0 z_base ) / ( sum_i w_i + w0 )
//   w_i  = 1 / (d_i^3 + eps_i^3)      d_i = distance from p to shape i
//   w0   = 1 / base_influence^3
//
// eps is the feature's influence radius: inside it the feature dominates,
// outside it falls off. It is authored per feature so a narrow valley does not
// flatten a wide ridge next to it.
//
// The exponent is 3, not the textbook 2. With a squared kernel the weight
// hardly moves between d = 0 and d = eps, so every feature drew as a
// flat-topped mesa with a cliff around it - the first version of this file
// turned a 420 m ridge into a plateau the size of the brigade sector. Cubing
// makes the weight fall by a factor of eight over the same distance, which is
// what gives a ridge a crest instead of a table top.

const CACHE = new WeakMap()

function dist2ToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const L = vx * vx + vy * vy
  let t = L > 0 ? (wx * vx + wy * vy) / L : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const dx = wx - vx * t
  const dy = wy - vy * t
  return dx * dx + dy * dy
}

function inPolygon(px, py, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0]
    const yi = pts[i][1]
    const xj = pts[j][0]
    const yj = pts[j][1]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function normPts(raw) {
  return (raw || []).map((q) => (Array.isArray(q) ? [Number(q[0]), Number(q[1])] : [Number(q.x), Number(q.y)]))
}

// One control shape: its outline, its elevation, and how far its influence
// reaches before the background takes over.
function controlsOf(terr) {
  const out = []
  for (const f of (terr && terr.features) || []) {
    const pts = normPts(f.polyline || f.outline || f.polygon)
    if (!pts.length) continue
    out.push({
      pts,
      closed: !!(f.polygon || f.outline),
      elev: Number(f.crest_elev_m ?? f.floor_elev_m ?? f.elev_m ?? 0),
      eps3: Math.pow(Number(f.influence_m || 900), 3),
    })
  }
  for (const s of (terr && terr.spots) || []) {
    out.push({
      pts: [[Number(s.x), Number(s.y)]],
      closed: false,
      elev: Number(s.elev_m || 0),
      eps3: Math.pow(Number(s.influence_m || 1200), 3),
    })
  }
  return out
}

function dist2ToControl(px, py, c) {
  const pts = c.pts
  if (pts.length === 1) {
    const dx = px - pts[0][0]
    const dy = py - pts[0][1]
    return dx * dx + dy * dy
  }
  if (c.closed && inPolygon(px, py, pts)) return 0
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const d = dist2ToSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
    if (d < best) best = d
  }
  if (c.closed) {
    const d = dist2ToSegment(px, py, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1])
    if (d < best) best = d
  }
  return best
}

export function makeElev(terr) {
  const ctrl = controlsOf(terr)
  const field = (terr && terr.field) || {}
  const base = Number(field.base_elev_m ?? 70)
  const w0 = 1 / Math.pow(Number(field.base_influence_m || 2600), 3)
  return (x, y) => {
    let num = base * w0
    let den = w0
    for (let i = 0; i < ctrl.length; i++) {
      const c = ctrl[i]
      const d2 = dist2ToControl(x, y, c)
      const w = 1 / (d2 * Math.sqrt(d2) + c.eps3)
      num += w * c.elev
      den += w
    }
    return num / den
  }
}

// --------------------------------------------------------------- marching squares
//
// Corners a=TL b=TR c=BR d=BL, bit set when the sample is at or above the
// level. Edges: 0 top, 1 right, 2 bottom, 3 left. The two ambiguous cases (5
// and 10) are resolved by the cell average, which is the standard fix and the
// only one that keeps a saddle from turning into a crossing.
const MS = [
  [], [[3, 0]], [[0, 1]], [[3, 1]],
  [[1, 2]], null, [[0, 2]], [[3, 2]],
  [[2, 3]], [[2, 0]], null, [[2, 1]],
  [[1, 3]], [[1, 0]], [[0, 3]], [],
]

function contourSegments(grid, n, x0, y0, dx, dy, level) {
  const at = (i, j) => grid[j * (n + 1) + i]
  const segs = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const va = at(i, j)
      const vb = at(i + 1, j)
      const vc = at(i + 1, j + 1)
      const vd = at(i, j + 1)
      let k = 0
      if (va >= level) k |= 1
      if (vb >= level) k |= 2
      if (vc >= level) k |= 4
      if (vd >= level) k |= 8
      if (k === 0 || k === 15) continue
      let cases = MS[k]
      if (cases === null) {
        const avg = (va + vb + vc + vd) / 4
        if (k === 5) cases = avg >= level ? [[3, 2], [1, 0]] : [[3, 0], [1, 2]]
        else cases = avg >= level ? [[0, 1], [2, 3]] : [[0, 3], [2, 1]]
      }
      const X = x0 + i * dx
      const Y = y0 + j * dy
      const lerp = (p, q) => (level - p) / (q - p || 1e-9)
      const edge = (e) => {
        if (e === 0) return [X + dx * lerp(va, vb), Y]
        if (e === 1) return [X + dx, Y + dy * lerp(vb, vc)]
        if (e === 2) return [X + dx * lerp(vd, vc), Y + dy]
        return [X, Y + dy * lerp(va, vd)]
      }
      for (const [e1, e2] of cases) segs.push([edge(e1), edge(e2)])
    }
  }
  return segs
}

// --------------------------------------------------------------- public

// Everything below is camera independent, so it is computed once per scenario
// and cached. Only the projection changes when the user orbits, and projecting
// a few thousand points is cheap; rebuilding the field on every mouse move
// would not be.
export function terrainModel(graph) {
  const geo = graph && graph.geo
  const terr = geo && geo.terrain
  if (!terr || (!terr.features && !terr.spots)) return null
  const hit = CACHE.get(graph)
  if (hit !== undefined) return hit

  const field = terr.field || {}
  const ext = geo.frame.extent

  // Mesh bounds: every position an asset ever occupies, padded, clamped to
  // the declared extent.
  //
  // Only assets. The field is still shaped by every feature and spot in the
  // scenario, including the ones far outside this box - they are what makes
  // the edge of the mesh slope the right way - but the drawn surface stops
  // near the units. Meshing the whole 24 by 18 km AO put a peak 20 km away in
  // the frame and shrank the brigade to a smudge in the corner; the view is
  // there to show where the units are.
  //
  // The bounds are time independent on purpose: a surface that grew and shrank
  // as units moved would make the camera lurch on every scrub tick.
  let bx0 = Infinity
  let bx1 = -Infinity
  let by0 = Infinity
  let by1 = -Infinity
  const see = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < bx0) bx0 = x
    if (x > bx1) bx1 = x
    if (y < by0) by0 = y
    if (y > by1) by1 = y
  }
  for (const a of graph.assets || []) {
    const g = a.geo
    if (!g) continue
    if (g.at) see(Number(g.at.x), Number(g.at.y))
    for (const s of g.segments || []) {
      if (s.at) see(Number(s.at.x), Number(s.at.y))
      if (s.to_at) see(Number(s.to_at.x), Number(s.to_at.y))
    }
  }
  if (!Number.isFinite(bx0)) return null

  const padX = Math.max(1400, (bx1 - bx0) * 0.3)
  const padY = Math.max(1400, (by1 - by0) * 0.3)
  bx0 = Math.max(ext.x[0], bx0 - padX)
  bx1 = Math.min(ext.x[1], bx1 + padX)
  by0 = Math.max(ext.y[0], by0 - padY)
  by1 = Math.min(ext.y[1], by1 + padY)

  const elev = makeElev(terr)

  const n = Math.max(8, Math.min(72, Number(field.grid_n || 32)))
  const dx = (bx1 - bx0) / n
  const dy = (by1 - by0) / n
  const grid = new Float64Array((n + 1) * (n + 1))
  let lo = Infinity
  let hi = -Infinity
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = elev(bx0 + i * dx, by0 + j * dy)
      grid[j * (n + 1) + i] = v
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }

  // A finer grid just for the contour lines. The mesh can be coarse - facets
  // read as a schematic surface - but a coarse contour is visibly polygonal
  // and looks like a bug rather than a choice.
  const cn = Math.max(n, Math.min(128, Number(field.contour_grid_n || 64)))
  const cdx = (bx1 - bx0) / cn
  const cdy = (by1 - by0) / cn
  const cgrid = new Float64Array((cn + 1) * (cn + 1))
  for (let j = 0; j <= cn; j++) {
    for (let i = 0; i <= cn; i++) cgrid[j * (cn + 1) + i] = elev(bx0 + i * cdx, by0 + j * cdy)
  }

  const interval = Math.max(5, Number(field.contour_interval_m || 40))
  const every = Math.max(1, Number(field.index_contour_every || 5))
  const levels = []
  const first = Math.ceil(lo / interval) * interval
  for (let L = first; L <= hi; L += interval) {
    const segs = contourSegments(cgrid, cn, bx0, by0, cdx, cdy, L)
    if (!segs.length) continue
    levels.push({ level: L, index: Math.round(L / interval) % every === 0, segs })
  }

  const model = {
    n, x0: bx0, y0: by0, dx, dy, grid, lo, hi,
    levels, interval, every,
    base: Number(field.base_elev_m ?? 70),
    elev,
    bounds: { x: [bx0, bx1], y: [by0, by1] },
  }
  CACHE.set(graph, model)
  return model
}

// Elevation of the surface under a point, bilinear from the mesh so the drop
// line of a node lands on the same facet the eye sees it standing on.
export function surfaceAt(model, x, y) {
  if (!model) return 0
  const fi = (x - model.x0) / model.dx
  const fj = (y - model.y0) / model.dy
  const i = Math.max(0, Math.min(model.n - 1, Math.floor(fi)))
  const j = Math.max(0, Math.min(model.n - 1, Math.floor(fj)))
  const u = Math.max(0, Math.min(1, fi - i))
  const v = Math.max(0, Math.min(1, fj - j))
  const g = model.grid
  const w = model.n + 1
  const a = g[j * w + i]
  const b = g[j * w + i + 1]
  const c = g[(j + 1) * w + i + 1]
  const d = g[(j + 1) * w + i]
  return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + c * u) * v
}

// Hypsometric tint. Muted on purpose: this sits under status colour, and a
// saturated green-to-brown ramp would compete with the one thing the view is
// actually for - which node is red.
const RAMP = [
  [0.00, [22, 33, 43]],
  [0.22, [27, 47, 51]],
  [0.45, [36, 56, 47]],
  [0.68, [56, 65, 46]],
  [0.85, [74, 69, 54]],
  [1.00, [96, 90, 78]],
]

function tint(u) {
  let i = 0
  while (i < RAMP.length - 2 && u > RAMP[i + 1][0]) i++
  const [t0, c0] = RAMP[i]
  const [t1, c1] = RAMP[i + 1]
  const k = t1 > t0 ? (u - t0) / (t1 - t0) : 0
  return [0, 1, 2].map((m) => c0[m] + (c1[m] - c0[m]) * Math.max(0, Math.min(1, k)))
}

// Lambert shading against a fixed north-west sun, the cartographic convention.
// Slope is computed in metres so the exaggeration slider does not change the
// shading - the light would swing with the slider otherwise, which reads as
// the scene being lit from a different place at every setting.
function shade(dzdx, dzdy) {
  const lx = -0.55
  const ly = 0.55
  const lz = 0.63
  const nx = -dzdx
  const ny = -dzdy
  const nz = 1
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  const d = (nx * lx + ny * ly + nz * lz) / len
  return 0.62 + 0.62 * Math.max(0, d)
}

export function terrainSvg(model, project, is3d, opts = {}) {
  if (!model) return ''
  const { n, x0, y0, dx, dy, grid, lo, hi } = model
  const w = n + 1
  const span = hi - lo || 1
  const relief = Number(opts.relief ?? 1)
  const out = []

  // painter's algorithm: far facets first. In plan view the order is
  // irrelevant, and sorting anyway keeps one code path.
  const cells = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const za = grid[j * w + i]
      const zb = grid[j * w + i + 1]
      const zc = grid[(j + 1) * w + i + 1]
      const zd = grid[(j + 1) * w + i]
      const X = x0 + i * dx
      const Y = y0 + j * dy
      const P = [
        project(X, Y, is3d ? za : 0),
        project(X + dx, Y, is3d ? zb : 0),
        project(X + dx, Y + dy, is3d ? zc : 0),
        project(X, Y + dy, is3d ? zd : 0),
      ]
      const zm = (za + zb + zc + zd) / 4
      const dzdx = ((zb + zc) - (za + zd)) / (2 * dx)
      const dzdy = ((zd + zc) - (za + zb)) / (2 * dy)
      const c = tint((zm - lo) / span)
      const s = shade(dzdx * relief, dzdy * relief)
      const rgb = c.map((v) => Math.round(Math.max(0, Math.min(255, v * s))))
      cells.push({
        y: (P[0].y + P[1].y + P[2].y + P[3].y) / 4,
        d: P.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '),
        f: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
      })
    }
  }
  // Skirt: the four side walls of the block, from the surface down to a datum
  // below the lowest point. Without it the terrain is a sheet floating in the
  // dark and the near edge reads as a cliff of unknown depth. With it the view
  // is a block diagram, which is what it actually is - a finite box of
  // authored ground with nothing outside it.
  if (is3d) {
    const zBase = lo - Math.max(40, (hi - lo) * 0.25)
    const wall = (ax, ay, az, bx, by, bz, k) => {
      const P = [
        project(ax, ay, az), project(bx, by, bz),
        project(bx, by, zBase), project(ax, ay, zBase),
      ]
      cells.push({
        y: (P[0].y + P[1].y + P[2].y + P[3].y) / 4 - 1e6, // walls never hide the surface
        d: P.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '),
        f: k,
      })
    }
    for (let i = 0; i < n; i++) {
      const X = x0 + i * dx
      wall(X, y0, grid[i], X + dx, y0, grid[i + 1], 'rgb(20,27,36)')
      const jt = n * w
      wall(X, y0 + n * dy, grid[jt + i], X + dx, y0 + n * dy, grid[jt + i + 1], 'rgb(13,18,25)')
    }
    for (let j = 0; j < n; j++) {
      const Y = y0 + j * dy
      wall(x0, Y, grid[j * w], x0, Y + dy, grid[(j + 1) * w], 'rgb(16,22,30)')
      wall(x0 + n * dx, Y, grid[j * w + n], x0 + n * dx, Y + dy, grid[(j + 1) * w + n], 'rgb(11,15,21)')
    }
  }

  if (is3d) cells.sort((a, b) => a.y - b.y)
  for (const c of cells) out.push(`<polygon class="geo-cell" points="${c.d}" fill="${c.f}" stroke="${c.f}" />`)

  // Contours drape on the surface: each vertex is lifted to its own level, so
  // in 3D the line follows the relief instead of floating on a flat sheet.
  for (const L of model.levels) {
    const d = []
    for (const [p, q] of L.segs) {
      const A = project(p[0], p[1], is3d ? L.level : 0)
      const B = project(q[0], q[1], is3d ? L.level : 0)
      d.push(`M${A.x.toFixed(1)} ${A.y.toFixed(1)}L${B.x.toFixed(1)} ${B.y.toFixed(1)}`)
    }
    if (!d.length) continue
    out.push(`<path class="geo-contour${L.index ? ' is-index' : ''}" d="${d.join('')}"><title>표고 ${L.level} m</title></path>`)
  }

  // Label index contours only, and only once per level, at the segment
  // furthest from the middle of the picture so the numbers sit at the edge
  // rather than across the units.
  for (const L of model.levels) {
    if (!L.index || !L.segs.length) continue
    const s = L.segs[Math.floor(L.segs.length * 0.18)]
    const A = project(s[0][0], s[0][1], is3d ? L.level : 0)
    const B = project(s[1][0], s[1][1], is3d ? L.level : 0)
    const ang = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI
    const rot = ang > 90 || ang < -90 ? ang + 180 : ang
    const mx = (A.x + B.x) / 2
    const my = (A.y + B.y) / 2
    out.push(`<text class="geo-contour-label" transform="translate(${mx.toFixed(1)},${my.toFixed(1)}) rotate(${rot.toFixed(1)})">${L.level}</text>`)
  }

  return out.join('')
}
