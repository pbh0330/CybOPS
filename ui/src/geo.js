// Geographic layer (docs/17-geo-layer.md, ADR-0001).
//
// This is a secondary view. The base view is the mission dependency graph, and
// nothing here feeds a judgement: the position of an asset is drawn, never
// read by the engine. scripts/Test-GeoInvariance.ps1 asserts exactly that, so
// this file can only ever be a renderer.
//
// The canonical frame is the scenario's local plane (TACGRID-01, metres). Lat
// and lon exist to place the grid on a map widget, and MGRS is derived for
// display. None of that matters here: we draw the local plane directly, which
// keeps the picture honest about what it is - a fictional grid, not a place.

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

// Terrain features are drawn as outlines only. They are authored shapes in the
// fictional grid, not derived from any real map, and the picture should not
// suggest otherwise (docs/17 safety policy).
function drawTerrain(svg, geo, project) {
  const parts = []
  for (const f of (geo.terrain && geo.terrain.features) || []) {
    // features are authored as polylines of [x, y] pairs; polygons are closed
    const raw = f.polyline || f.outline || f.polygon || []
    const pts = raw.map((p) => (Array.isArray(p) ? project(p[0], p[1]) : project(p.x, p.y)))
    if (pts.length < 2) continue
    const closed = !!(f.polygon || f.outline)
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + (closed ? ' Z' : '')
    const cls = f.kind === 'valley' ? 'terr-valley' : 'terr-ridge'
    const elev = f.crest_elev_m ?? f.floor_elev_m
    parts.push(`<path class="${cls}" d="${d}"><title>${esc(f.name || f.id || '')}${elev != null ? ` ${elev} m` : ''}</title></path>`)
    const c = centroid(pts)
    parts.push(`<text class="terr-label" x="${c.x.toFixed(1)}" y="${(c.y - 6).toFixed(1)}">${esc(f.name || '')}</text>`)
  }
  svg.push(parts.join(''))
}

function centroid(pts) {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 })
  return { x: s.x / pts.length, y: s.y / pts.length }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// Render the whole layer as one SVG string. Kept out of cytoscape on purpose:
// the graph view owns a canvas whose coordinates mean dependency, and reusing
// it for metres would make two different meanings share one set of axes.
export function renderGeo({ graph, step, width, height, causeColor, iconFor, selected }) {
  const geo = graph.geo
  if (!geo || !geo.frame) return '<div class="geo-empty">이 시나리오에는 좌표가 없다.</div>'

  const ext = geo.frame.extent
  const pad = 28
  const spanX = ext.x[1] - ext.x[0]
  const spanY = ext.y[1] - ext.y[0]
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY)
  const offX = pad + ((width - pad * 2) - spanX * scale) / 2
  const offY = pad + ((height - pad * 2) - spanY * scale) / 2
  // y is north, so it grows upward: flip it for screen coordinates
  const project = (x, y) => ({ x: offX + (x - ext.x[0]) * scale, y: offY + (spanY - (y - ext.y[0])) * scale })

  const svg = []

  // grid, 2 km spacing, labelled in kilometres
  const gridStep = 2000
  for (let x = ext.x[0]; x <= ext.x[1]; x += gridStep) {
    const a = project(x, ext.y[0])
    const b = project(x, ext.y[1])
    svg.push(`<line class="geo-grid" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" />`)
    svg.push(`<text class="geo-tick" x="${a.x.toFixed(1)}" y="${(a.y + 13).toFixed(1)}">${x / 1000}</text>`)
  }
  for (let y = ext.y[0]; y <= ext.y[1]; y += gridStep) {
    const a = project(ext.x[0], y)
    const b = project(ext.x[1], y)
    svg.push(`<line class="geo-grid" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" />`)
    svg.push(`<text class="geo-tick" x="${(a.x - 14).toFixed(1)}" y="${(a.y + 3).toFixed(1)}">${y / 1000}</text>`)
  }

  drawTerrain(svg, geo, project)

  // transport links first, so nodes sit on top
  const outage = step.link_outage || {}
  const posOf = {}
  for (const a of graph.assets || []) posOf[a.id] = positionAt(a, Number(step.t))

  for (const l of graph.links || []) {
    const pa = posOf[l.a]
    const pb = posOf[l.b]
    if (!pa || !pb) continue
    const A = project(pa.x, pa.y)
    const B = project(pb.x, pb.y)
    const cause = outage[l.id]
    const color = cause ? (causeColor[cause] || '#8a8f98') : '#2fd18b'
    svg.push(`<line class="geo-link${cause ? ' is-cut' : ''}" x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" ` +
      `x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" stroke="${color}"><title>${esc(l.id)} ${esc(l.bearer || '')}${cause ? ' / ' + esc(cause) : ''}</title></line>`)
  }

  // assets
  //
  // Several assets share a site: a TOC holds a server, a workstation and a
  // gateway within metres of each other, and at 24 km across they land on one
  // pixel. Spread co-located nodes on a small ring so each is clickable and
  // labelled. The offset is screen-space only - the underlying position is
  // untouched, and the tooltip still reports the real metres.
  const assetOut = step.asset_outage || {}
  const missing = []
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

  for (const a of graph.assets || []) {
    const p = posOf[a.id]
    if (!p) { missing.push(a.id); continue }
    const base = project(p.x, p.y)
    const off = ringOffset[a.id] || { dx: 0, dy: 0 }
    const P = { x: base.x + off.dx, y: base.y + off.dy }
    const cause = assetOut[a.id]
    const hit = Number((step.compromise || {})[a.id] || 0) > 0
    const ring = cause ? (causeColor[cause] || '#8a8f98') : (hit ? causeColor.attack : '#3a4657')
    const icon = iconFor(a.type, hit ? 'attack' : cause ? 'outage' : 'ok')
    const sel = selected === a.id ? ' is-selected' : ''
    svg.push(`<g class="geo-node${sel}" data-asset="${esc(a.id)}" transform="translate(${P.x.toFixed(1)},${P.y.toFixed(1)})">
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
    <span>${esc(geo.frame.id)} · 격자 2 km · 단위 m</span>
    ${anchor ? `<span>앵커 ${anchor.lat}, ${anchor.lon}${geo.georef.mgrs ? ' · MGRS ' + esc(geo.georef.mgrs.gzd) : ''}</span>` : ''}
    <span class="geo-warn">가상 좌표다. 실제 부대 배치가 아니다.</span>
  </div>`

  return `<svg class="geo-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svg.join('')}</svg>${missingNote}${foot}`
}
