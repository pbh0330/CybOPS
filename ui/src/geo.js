// Geographic layer (docs/17-geo-layer.md, ADR-0001).
//
// This is a secondary view. The base view is the mission dependency graph, and
// nothing here feeds a judgement: the position of an asset is drawn, never
// read by the engine. scripts/Test-GeoInvariance.ps1 asserts exactly that, so
// this file can only ever be a renderer.
//
// The canonical frame is the scenario's local plane (TACGRID-01, metres). Lat
// and lon exist to place the grid on a map widget, and MGRS is derived for
// display. Neither is used here: we draw the local plane directly, which keeps
// the picture honest about what it is - a fictional grid, not a place.
//
// 2D and 3D are the same projection with a different camera. No 3D library:
// an axonometric projection is nine lines of arithmetic, and pulling in a
// renderer would cost more than the whole rest of the bundle for a scene of
// thirteen boxes (ADR-0018 keeps this an offline static bundle).

// Position of an asset at time t, from the segment table. Outside every
// segment the position is undefined, and undefined is drawn as absent rather
// than as the last known point: a unit that has gone is not a unit standing
// still (docs/17).
export function positionAt(asset, t) {
  const g = asset && asset.geo
  if (!g) return null
  if (g.kind === 'fixed' || !g.segments) return g.at ? { ...g.at, mode: 'fixed' } : null

  for (const s of g.segments) {
    const from = Number(s.from)
    const to = Number(s.to)
    if (!(t >= from && t < to)) continue
    if (s.mode === 'move' && s.to_at) {
      const u = to > from ? (t - from) / (to - from) : 0
      return {
        x: s.at.x + (s.to_at.x - s.at.x) * u,
        y: s.at.y + (s.to_at.y - s.at.y) * u,
        z: (s.at.z ?? 0) + ((s.to_at.z ?? 0) - (s.at.z ?? 0)) * u,
        mode: 'move',
        note: s.note || '',
      }
    }
    return { ...s.at, mode: 'hold', note: s.note || '' }
  }
  return null
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// Camera. az rotates about the vertical axis, pitch tilts toward the horizon.
// pitch = 90 degrees is straight down, which is exactly the 2D plan view, so
// the two modes are one projection and there is no second code path to keep
// in agreement.
function makeProjector({ ext, width, height, az, pitch, zScale, pad = 40, fitPoints = null }) {
  const cx = (ext.x[0] + ext.x[1]) / 2
  const cy = (ext.y[0] + ext.y[1]) / 2
  const a = (az * Math.PI) / 180
  const p = (pitch * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const sp = Math.sin(p)
  const cp = Math.cos(p)

  const raw = (x, y, z = 0) => {
    const dx = x - cx
    const dy = y - cy
    const rx = dx * ca - dy * sa
    const ry = dx * sa + dy * ca
    // screen y grows downward; north should go up, so negate
    return { x: rx, y: -(ry * sp) - (z * zScale) * cp }
  }

  // Fit to what is actually on screen, not to the declared extent. The AO is
  // 24 km wide but the assets occupy a corner of it, and fitting the box left
  // the scene as a small clump in the middle of a large empty grid.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const zTop = ext.z ? ext.z[1] : 0
  const corners = []
  for (const x of ext.x) for (const y of ext.y) for (const z of [0, zTop]) corners.push({ x, y, z })
  const sample = (fitPoints && fitPoints.length >= 2) ? fitPoints : corners
  for (const q of sample) {
    const r = raw(q.x, q.y, q.z || 0)
    minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x)
    minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y)
  }
  // never zoom past the grid itself
  const spanGuard = 1200
  if (maxX - minX < spanGuard) { const c = (maxX + minX) / 2; minX = c - spanGuard / 2; maxX = c + spanGuard / 2 }
  if (maxY - minY < spanGuard) { const c = (maxY + minY) / 2; minY = c - spanGuard / 2; maxY = c + spanGuard / 2 }
  const scale = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1))
  const offX = pad + ((width - pad * 2) - (maxX - minX) * scale) / 2 - minX * scale
  const offY = pad + ((height - pad * 2) - (maxY - minY) * scale) / 2 - minY * scale

  return (x, y, z = 0) => {
    const r = raw(x, y, z)
    return { x: offX + r.x * scale, y: offY + r.y * scale }
  }
}

function centroid(pts) {
  const s = pts.reduce((a, q) => ({ x: a.x + q.x, y: a.y + q.y }), { x: 0, y: 0 })
  return { x: s.x / pts.length, y: s.y / pts.length }
}

// Terrain features are outlines only. They are authored shapes in a fictional
// grid, not derived from any real map, and the picture must not suggest
// otherwise (docs/17 safety policy). In 3D they are lifted to their stated
// elevation, with a dropped shadow line so the height is readable.
function drawTerrain(out, geo, project, is3d) {
  for (const f of (geo.terrain && geo.terrain.features) || []) {
    const raw = f.polyline || f.outline || f.polygon || []
    const elev = f.crest_elev_m ?? f.floor_elev_m ?? 0
    const coords = raw.map((q) => (Array.isArray(q) ? { x: q[0], y: q[1] } : q))
    if (coords.length < 2) continue
    const closed = !!(f.polygon || f.outline)
    const cls = f.kind === 'valley' ? 'terr-valley' : 'terr-ridge'

    if (is3d) {
      const ground = coords.map((q) => project(q.x, q.y, 0))
      const gd = ground.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ') + (closed ? ' Z' : '')
      out.push(`<path class="terr-ground" d="${gd}" />`)
    }
    const pts = coords.map((q) => project(q.x, q.y, is3d ? elev : 0))
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ') + (closed ? ' Z' : '')
    out.push(`<path class="${cls}" d="${d}"><title>${esc(f.name || f.id || '')} ${elev} m</title></path>`)
    const c = centroid(pts)
    out.push(`<text class="terr-label" x="${c.x.toFixed(1)}" y="${(c.y - 6).toFixed(1)}">${esc(f.name || '')}</text>`)
  }
}

export function renderGeo({
  graph, step, width, height, causeColor, iconFor, selected,
  mode = '2d', az = 35, pitch = 55, zScale = 8,
}) {
  const geo = graph.geo
  if (!geo || !geo.frame) return '<div class="geo-empty">이 시나리오에는 좌표가 없다.</div>'

  const is3d = mode === '3d'
  const ext = geo.frame.extent

  // what the camera should frame: every asset at this instant, plus the
  // terrain features, padded so labels do not fall off the edge
  const fitPoints = []
  for (const a of graph.assets || []) {
    const p = positionAt(a, Number(step.t))
    if (p) fitPoints.push({ x: p.x, y: p.y, z: is3d ? (p.z || 0) : 0 })
  }
  for (const f of (geo.terrain && geo.terrain.features) || []) {
    const raw = f.polyline || f.outline || f.polygon || []
    const elev = f.crest_elev_m ?? f.floor_elev_m ?? 0
    for (const q of raw) {
      const pt = Array.isArray(q) ? { x: q[0], y: q[1] } : q
      fitPoints.push({ x: pt.x, y: pt.y, z: is3d ? elev : 0 })
    }
  }

  const project = makeProjector({
    ext, width, height,
    az: is3d ? az : 0,
    pitch: is3d ? pitch : 90,
    zScale: is3d ? zScale : 0,
    pad: 56,
    fitPoints,
  })

  const out = []

  // ground grid, 2 km spacing
  const gridStep = 2000
  for (let x = ext.x[0]; x <= ext.x[1]; x += gridStep) {
    const a = project(x, ext.y[0], 0)
    const b = project(x, ext.y[1], 0)
    out.push(`<line class="geo-grid" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" />`)
    if (!is3d) out.push(`<text class="geo-tick" x="${a.x.toFixed(1)}" y="${(a.y + 13).toFixed(1)}">${x / 1000}</text>`)
  }
  for (let y = ext.y[0]; y <= ext.y[1]; y += gridStep) {
    const a = project(ext.x[0], y, 0)
    const b = project(ext.x[1], y, 0)
    out.push(`<line class="geo-grid" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" />`)
    if (!is3d) out.push(`<text class="geo-tick" x="${(a.x - 14).toFixed(1)}" y="${(a.y + 3).toFixed(1)}">${y / 1000}</text>`)
  }

  drawTerrain(out, geo, project, is3d)

  const posOf = {}
  for (const a of graph.assets || []) posOf[a.id] = positionAt(a, Number(step.t))

  // transport links, drawn at asset height so a relay on a ridge visibly
  // reaches down to the valley
  const linkOut = step.link_outage || {}
  for (const l of graph.links || []) {
    const pa = posOf[l.a]
    const pb = posOf[l.b]
    if (!pa || !pb) continue
    const A = project(pa.x, pa.y, is3d ? (pa.z ?? 0) : 0)
    const B = project(pb.x, pb.y, is3d ? (pb.z ?? 0) : 0)
    const cause = linkOut[l.id]
    const color = cause ? (causeColor[cause] || '#8a8f98') : '#2fd18b'
    out.push(`<line class="geo-link${cause ? ' is-cut' : ''}" x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" ` +
      `x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" stroke="${color}">` +
      `<title>${esc(l.id)} ${esc(l.bearer || '')}${cause ? ' / ' + esc(cause) : ''}</title></line>`)
  }

  // Several assets share a site: a TOC holds a server, a workstation and a
  // gateway within metres of each other, and at 24 km across they land on one
  // pixel. Spread co-located nodes on a small ring in screen space only. The
  // underlying position is untouched and the tooltip reports the real metres.
  const cluster = new Map()
  for (const a of graph.assets || []) {
    const p = posOf[a.id]
    if (!p) continue
    const key = `${Math.round(p.x / 400)}:${Math.round(p.y / 400)}`
    if (!cluster.has(key)) cluster.set(key, [])
    cluster.get(key).push(a.id)
  }
  const ringOffset = {}
  for (const ids of cluster.values()) {
    if (ids.length < 2) continue
    const r = 22 + ids.length * 2
    ids.forEach((id, i) => {
      const ang = (i / ids.length) * Math.PI * 2 - Math.PI / 2
      ringOffset[id] = { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r }
    })
  }

  // paint far-to-near so nearer nodes overlap farther ones
  const drawList = []
  for (const a of graph.assets || []) {
    const p = posOf[a.id]
    if (!p) continue
    const base = project(p.x, p.y, is3d ? (p.z ?? 0) : 0)
    const off = ringOffset[a.id] || { dx: 0, dy: 0 }
    drawList.push({ a, p, P: { x: base.x + off.dx, y: base.y + off.dy }, ground: project(p.x, p.y, 0) })
  }
  drawList.sort((m, n) => m.P.y - n.P.y)

  const assetOut = step.asset_outage || {}
  const missing = (graph.assets || []).filter((a) => !posOf[a.id]).map((a) => a.id)

  for (const d of drawList) {
    const { a, p, P, ground } = d
    const cause = assetOut[a.id]
    const hit = Number((step.compromise || {})[a.id] || 0) > 0
    const ring = cause ? (causeColor[cause] || '#8a8f98') : (hit ? causeColor.attack : '#3a4657')
    const icon = iconFor(a.type, hit ? 'attack' : cause ? 'outage' : 'ok')
    const sel = selected === a.id ? ' is-selected' : ''

    // the drop line is what makes elevation readable at all
    if (is3d && Math.abs(P.y - ground.y) > 2) {
      out.push(`<line class="geo-drop" x1="${P.x.toFixed(1)}" y1="${P.y.toFixed(1)}" x2="${(ground.x + (P.x - ground.x) * 0.15).toFixed(1)}" y2="${ground.y.toFixed(1)}" />`)
      out.push(`<ellipse class="geo-shadow" cx="${ground.x.toFixed(1)}" cy="${ground.y.toFixed(1)}" rx="7" ry="3" />`)
    }

    out.push(`<g class="geo-node${sel}" data-asset="${esc(a.id)}" transform="translate(${P.x.toFixed(1)},${P.y.toFixed(1)})">
      <circle r="15" fill="#0d131c" stroke="${ring}" stroke-width="${cause || hit ? 2.2 : 1.2}" ${cause ? 'stroke-dasharray="3 3"' : ''} />
      ${icon ? `<image href="${icon}" x="-9" y="-9" width="18" height="18" />` : ''}
      <text class="geo-label" y="27">${esc(a.id)}</text>
      <title>${esc(a.id)} ${esc(a.type)} (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z ?? 0)} m)${p.note ? ' / ' + esc(p.note) : ''}</title>
    </g>`)
  }

  const missingNote = missing.length
    ? `<div class="geo-missing">위치 미상 ${missing.length}: ${missing.join(', ')}
        <span>구간 밖이다. 마지막 위치를 그대로 찍지 않는다.</span></div>`
    : ''

  const anchor = geo.georef && geo.georef.anchor
  const foot = `<div class="geo-foot">
    <span>${esc(geo.frame.id)} · 격자 2 km · 단위 m${is3d ? ` · 표고 ${zScale}배 과장` : ''}</span>
    ${anchor ? `<span>앵커 ${anchor.lat}, ${anchor.lon}${geo.georef.mgrs ? ' · MGRS ' + esc(geo.georef.mgrs.gzd) : ''}</span>` : ''}
    <span class="geo-warn">가상 좌표다. 실제 부대 배치가 아니다.</span>
  </div>`

  return `<svg class="geo-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${out.join('')}</svg>${missingNote}${foot}`
}
