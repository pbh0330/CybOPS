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
//
// The relief surface and contours live in terrain.js. They are generated from
// the scenario's authored shapes, never from real elevation data - see the
// header there and geo.safety.basemap_policy.

import { terrainModel, surfaceAt, terrainSvg } from './terrain.js'

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

// Terrain features are the authored skeleton the relief surface was generated
// from, so they stay drawn on top of it: the reader can see which lines were
// written down and which shape was interpolated between them. In 3D they are
// lifted to their stated elevation.
function drawTerrain(out, geo, project, is3d, bounds) {
  for (const f of (geo.terrain && geo.terrain.features) || []) {
    const raw = f.polyline || f.outline || f.polygon || []
    const elev = f.crest_elev_m ?? f.floor_elev_m ?? f.elev_m ?? 0
    const coords = raw.map((q) => (Array.isArray(q) ? { x: q[0], y: q[1] } : q))
    if (coords.length < 2) continue
    // features wholly outside the drawn block are still shaping the field,
    // but labelling a ridge nobody can see just adds text to the edge
    if (bounds && !coords.some((q) => q.x >= bounds.x[0] && q.x <= bounds.x[1] && q.y >= bounds.y[0] && q.y <= bounds.y[1])) continue
    const closed = !!(f.polygon || f.outline)
    const cls = f.kind === 'valley' ? 'terr-valley' : 'terr-ridge'

    const pts = coords.map((q) => project(q.x, q.y, is3d ? elev : 0))
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ') + (closed ? ' Z' : '')
    out.push(`<path class="${cls}" d="${d}"><title>${esc(f.name || f.id || '')} ${elev} m</title></path>`)
    // Label at the vertex nearest the middle of the block, not at the
    // centroid: a ridge that runs off the edge has its centroid off the edge
    // too, and the name gets sliced in half by the frame.
    let c = centroid(pts)
    if (bounds) {
      const mx = (bounds.x[0] + bounds.x[1]) / 2
      const my = (bounds.y[0] + bounds.y[1]) / 2
      let best = Infinity
      coords.forEach((q, i) => {
        const d = (q.x - mx) ** 2 + (q.y - my) ** 2
        if (d < best) { best = d; c = pts[i] }
      })
    }
    out.push(`<text class="terr-label" x="${c.x.toFixed(1)}" y="${(c.y - 8).toFixed(1)}">${esc(f.name || '')}</text>`)
  }
}

export function renderGeo({
  graph, step, width, height, causeColor, iconFor, selected,
  mode = '2d', az = 35, pitch = 55, zScale = 8, terrain = true,
}) {
  const geo = graph.geo
  if (!geo || !geo.frame) return '<div class="geo-empty">이 시나리오에는 좌표가 없다.</div>'

  const is3d = mode === '3d'
  const ext = geo.frame.extent
  const model = terrain ? terrainModel(graph) : null

  const posOf = {}
  for (const a of graph.assets || []) posOf[a.id] = positionAt(a, Number(step.t))

  // Several assets share a site: a TOC holds a server, a workstation and a
  // gateway within metres of each other, and at 24 km across they land on one
  // pixel. Spread co-located nodes on a small ring.
  //
  // The ring used to be applied in screen space, and in 3D that was a bug you
  // could read off the picture: a downward pixel offset is indistinguishable
  // from lower ground, so SAT-TERM (147 m) drew below BN-SRV and BN-CP (146 m)
  // and the view said the satellite terminal was in a dip. The offset is now
  // in ground-plane metres, which the camera then projects like any other
  // position, so vertical screen position means elevation and nothing else.
  let sx0 = Infinity
  let sx1 = -Infinity
  let sy0 = Infinity
  let sy1 = -Infinity
  for (const id in posOf) {
    const p = posOf[id]
    if (!p) continue
    sx0 = Math.min(sx0, p.x); sx1 = Math.max(sx1, p.x)
    sy0 = Math.min(sy0, p.y); sy1 = Math.max(sy1, p.y)
  }
  const sceneSpan = Number.isFinite(sx0) ? Math.max(sx1 - sx0, sy1 - sy0) : 8000
  const ringR = Math.max(280, Math.min(1200, sceneSpan * 0.055))

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
    const r = ringR * (1 + ids.length * 0.08)
    ids.forEach((id, i) => {
      const ang = (i / ids.length) * Math.PI * 2 - Math.PI / 2
      // ground plane, metres: +y is north, so the ring is laid flat on the map
      ringOffset[id] = { dx: Math.cos(ang) * r, dy: -Math.sin(ang) * r }
    })
  }

  // drawn position = real position + ring offset, elevation untouched
  const drawPos = {}
  for (const id in posOf) {
    const p = posOf[id]
    if (!p) continue
    const o = ringOffset[id] || { dx: 0, dy: 0 }
    drawPos[id] = { x: p.x + o.dx, y: p.y + o.dy, z: p.z ?? 0 }
  }

  // what the camera should frame: the relief surface, every asset at this
  // instant, and the terrain features
  const fitPoints = []
  if (model) {
    const b = model.bounds
    for (const x of b.x) for (const y of b.y) fitPoints.push({ x, y, z: is3d ? surfaceAt(model, x, y) : 0 })
    // the crest matters for the fit: a peak that leaves the frame reads as a
    // clipped picture rather than a tall hill
    fitPoints.push({ x: (b.x[0] + b.x[1]) / 2, y: (b.y[0] + b.y[1]) / 2, z: is3d ? model.hi : 0 })
  }
  for (const id in drawPos) {
    const p = drawPos[id]
    fitPoints.push({ x: p.x, y: p.y, z: is3d ? p.z : 0 })
  }
  for (const f of (geo.terrain && geo.terrain.features) || []) {
    const raw = f.polyline || f.outline || f.polygon || []
    const elev = f.crest_elev_m ?? f.floor_elev_m ?? f.elev_m ?? 0
    for (const q of raw) {
      const pt = Array.isArray(q) ? { x: q[0], y: q[1] } : q
      // only what the block actually contains: a peak 20 km outside it must
      // not pull the camera back until the units are specks
      if (model && (pt.x < model.bounds.x[0] || pt.x > model.bounds.x[1] || pt.y < model.bounds.y[0] || pt.y > model.bounds.y[1])) continue
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

  // Sky. Only in 3D, and only as a gradient that fades into the pane
  // background well before the bottom, so what reads as sky is the band above
  // the far edge of the terrain and nothing else. There is no horizon line
  // drawn: the horizon is where the surface ends, which is the truth - the
  // scenario has coordinates for a 24 by 18 km box and nothing beyond it.
  if (is3d) {
    out.push(`<defs><linearGradient id="geo-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1622" />
      <stop offset="0.34" stop-color="#132433" />
      <stop offset="0.62" stop-color="#0a121b" />
      <stop offset="1" stop-color="#05070b" />
    </linearGradient></defs>`)
    out.push(`<rect class="geo-sky" x="0" y="0" width="${width}" height="${height}" fill="url(#geo-sky)" />`)
  }

  // relief surface and contours, under everything else
  if (model) out.push(terrainSvg(model, project, is3d, { relief: 1 }))

  // Map grid, 2 km spacing, draped on the surface so it creases over the
  // ridges instead of cutting through them.
  const gridStep = 2000
  const gx = model ? model.bounds.x : ext.x
  const gy = model ? model.bounds.y : ext.y
  const drape = (x, y) => (is3d && model ? surfaceAt(model, x, y) : 0)
  const gridPath = (pts) => pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ')
  const SAMPLES = model ? 28 : 1
  for (let x = Math.ceil(gx[0] / gridStep) * gridStep; x <= gx[1]; x += gridStep) {
    const pts = []
    for (let k = 0; k <= SAMPLES; k++) {
      const y = gy[0] + ((gy[1] - gy[0]) * k) / SAMPLES
      pts.push(project(x, y, drape(x, y)))
    }
    out.push(`<path class="geo-grid" d="${gridPath(pts)}" />`)
    if (!is3d) out.push(`<text class="geo-tick" x="${pts[0].x.toFixed(1)}" y="${(pts[0].y + 13).toFixed(1)}">${x / 1000}</text>`)
  }
  for (let y = Math.ceil(gy[0] / gridStep) * gridStep; y <= gy[1]; y += gridStep) {
    const pts = []
    for (let k = 0; k <= SAMPLES; k++) {
      const x = gx[0] + ((gx[1] - gx[0]) * k) / SAMPLES
      pts.push(project(x, y, drape(x, y)))
    }
    out.push(`<path class="geo-grid" d="${gridPath(pts)}" />`)
    if (!is3d) out.push(`<text class="geo-tick" x="${(pts[0].x - 14).toFixed(1)}" y="${(pts[0].y + 3).toFixed(1)}">${y / 1000}</text>`)
  }

  drawTerrain(out, geo, project, is3d, model ? model.bounds : null)

  // Transport links.
  //
  // A cable and a radio path are not the same shape and drawing them the same
  // way was wrong. Wired bearers are laid on the ground, so they follow the
  // relief; radio bearers are line of sight, so they go straight through the
  // air and a ridge in the way cuts the line rather than bending it.
  //
  // Where a straight radio path passes below the surface it is drawn dotted:
  // that span is inside the hill. This is a DRAWING, not a finding. The engine
  // never computes line of sight and never will from these coordinates - the
  // cause on an outage is an authored value (ADR-0012), and a masked span here
  // is at most a picture that agrees with it. Test-GeoInvariance.ps1 exists to
  // keep that boundary honest.
  const surf = (x, y) => (model ? surfaceAt(model, x, y) : 0)
  const linkOut = step.link_outage || {}
  const LINK_SAMPLES = 20
  let maskedCount = 0
  for (const l of graph.links || []) {
    const pa = drawPos[l.a]
    const pb = drawPos[l.b]
    if (!pa || !pb) continue
    const cause = linkOut[l.id]
    const color = cause ? (causeColor[cause] || '#8a8f98') : '#2fd18b'
    const bearer = String(l.bearer || '').toLowerCase()
    const wired = /wired|fibre|fiber|cable|lan|copper|landline/.test(bearer)
    const offA = pa.z - surf(pa.x, pa.y)
    const offB = pb.z - surf(pb.x, pb.y)

    const pts = []
    let anyMasked = false
    for (let k = 0; k <= LINK_SAMPLES; k++) {
      const u = k / LINK_SAMPLES
      const x = pa.x + (pb.x - pa.x) * u
      const y = pa.y + (pb.y - pa.y) * u
      const gz = surf(x, y)
      const losZ = pa.z + (pb.z - pa.z) * u
      const z = wired ? gz + offA + (offB - offA) * u : losZ
      const masked = !wired && model ? losZ < gz : false
      if (masked) anyMasked = true
      pts.push({ P: project(x, y, is3d ? z : 0), masked })
    }
    if (anyMasked) maskedCount++

    const title = `<title>${esc(l.id)} ${esc(l.bearer || '')}${wired ? ' · 지표 포설' : ' · 가시선'}` +
      `${anyMasked ? ' · 능선에 가림' : ''}${cause ? ' / 단절: ' + esc(cause) : ''}</title>`

    // one path per run of same-masking segments, so a link that dips behind a
    // ridge and comes back out is one element per span, not one per sample
    let i = 0
    while (i < LINK_SAMPLES) {
      const m = pts[i].masked || pts[i + 1].masked
      let j = i
      while (j < LINK_SAMPLES && (pts[j].masked || pts[j + 1].masked) === m) j++
      const d = []
      for (let k = i; k <= j; k++) d.push(`${k === i ? 'M' : 'L'}${pts[k].P.x.toFixed(1)} ${pts[k].P.y.toFixed(1)}`)
      out.push(`<path class="geo-link${cause ? ' is-cut' : ''}${m ? ' is-masked' : ''}" d="${d.join(' ')}" stroke="${color}">${title}</path>`)
      i = j
    }
  }

  // paint far-to-near so nearer nodes overlap farther ones
  const drawList = []
  for (const a of graph.assets || []) {
    const p = posOf[a.id]
    const q = drawPos[a.id]
    if (!p || !q) continue
    // A unit stands on the ground. ui/tools/ground-assets.mjs makes that true
    // in the scenario file, and this clamp keeps it true between waypoints:
    // z is interpolated linearly along a leg, so a vehicle crossing a convex
    // spur would otherwise cut a few metres into it on the way over. Nothing
    // in this project is underground.
    const gz = model ? surfaceAt(model, q.x, q.y) : 0
    const zDraw = Math.max(q.z, gz + 1)
    const P = project(q.x, q.y, is3d ? zDraw : 0)
    // the foot of the node is the surface under it, not the z = 0 datum
    const foot = project(q.x, q.y, is3d ? gz : 0)
    drawList.push({ a, p, P, ground: foot })
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
    ${model ? `<span>등고선 ${model.interval} m · 굵은 선 ${model.interval * model.every} m</span>` : ''}
    ${maskedCount ? `<span class="geo-mask-note">가시선 차폐 ${maskedCount}개 구간 (점선)<b>그림일 뿐이다. 단절 원인은 저작값이고 여기서 계산하지 않는다.</b></span>` : ''}
    ${anchor ? `<span>앵커 ${anchor.lat}, ${anchor.lon}${geo.georef.mgrs ? ' · MGRS ' + esc(geo.georef.mgrs.gzd) : ''}</span>` : ''}
    <span class="geo-warn">가상 좌표다. 지형도 저작 도형에서 보간한 것이고 실지형이 아니다.</span>
  </div>`

  return `<svg class="geo-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${out.join('')}</svg>${missingNote}${foot}`
}
