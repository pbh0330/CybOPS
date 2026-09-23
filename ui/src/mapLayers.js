// graph + step -> GeoJSON for the MapLibre pane. Pure functions: MapPane owns
// the map, this file owns what is drawn on it. Positions come from the
// scenario's segment table via positionAt and are converted with the
// scenario's own georef; the engine reads none of it (ADR-0001, ADR-0025).

import { positionAt } from './geo.js'
import { toLonLat, toMgrs } from './georef.js'
import { techniqueKo } from './labels.js'

const fc = (features) => ({ type: 'FeatureCollection', features })
const line = (coords, properties) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties })

function placed(graph, t, georef) {
  const out = new Map()
  for (const a of graph?.assets || []) {
    const p = positionAt(a, t)
    if (!p) continue
    const [lon, lat] = toLonLat(georef, p.x, p.y)
    out.set(a.id, { ...p, lon, lat })
  }
  return out
}

export function markerRows(graph, step, t, georef) {
  const rows = []
  for (const [id, p] of placed(graph, t, georef)) {
    rows.push({
      id, lon: p.lon, lat: p.lat, z: p.z ?? 0, mode: p.mode,
      compromise: Number(step?.compromise?.[id] || 0),
      outage: (step?.asset_outage || {})[id] || null,
    })
  }
  return rows
}

// `isolated` is the wargame's defender mark: a link touching an isolated
// asset is dead for the duration, whatever the step's outage table says.
export function linkFeatures(graph, step, t, georef, isolated = []) {
  const pos = placed(graph, t, georef)
  const iso = new Set(isolated || [])
  const feats = []
  for (const l of graph?.links || []) {
    const a = pos.get(l.a), b = pos.get(l.b)
    if (!a || !b) continue
    const cause = (step?.link_outage || {})[l.id] || null
    feats.push(line([[a.lon, a.lat], [b.lon, b.lat]], { id: l.id, cause, cut: !!cause, bearer: l.bearer || '', dead: iso.has(l.a) || iso.has(l.b) }))
  }
  return fc(feats)
}

// The path a track asset has covered up to t: every segment start before t,
// then the interpolated point at t itself.
export function trackFeatures(graph, t, georef) {
  const feats = []
  for (const a of graph?.assets || []) {
    const segs = a.geo?.segments
    if (!segs) continue
    const pts = []
    for (const s of segs) {
      if (Number(s.from) > t) break
      pts.push(s.at)
    }
    const now = positionAt(a, t)
    if (now) pts.push(now)
    if (pts.length < 2) continue
    feats.push(line(pts.map((p) => toLonLat(georef, p.x, p.y)), { id: a.id }))
  }
  return fc(feats)
}

// A quadratic arc in the local plane (metres), offset to the left of travel by
// 12% of the hop length, then converted. Curving in metres rather than in
// degrees keeps the bend symmetric on the map.
export function attackArcFeatures(graph, hops, t, georef) {
  const feats = []
  for (const h of hops || []) {
    const a = positionAt((graph.assets || []).find((x) => x.id === h.from), t)
    const b = positionAt((graph.assets || []).find((x) => x.id === h.to), t)
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const cx = (a.x + b.x) / 2 - dy / len * len * 0.12
    const cy = (a.y + b.y) / 2 + dx / len * len * 0.12
    const coords = []
    for (let i = 0; i <= 24; i++) {
      const u = i / 24
      const x = (1 - u) ** 2 * a.x + 2 * (1 - u) * u * cx + u * u * b.x
      const y = (1 - u) ** 2 * a.y + 2 * (1 - u) * u * cy + u * u * b.y
      coords.push(toLonLat(georef, x, y))
    }
    const ko = techniqueKo(h.technique)
    feats.push(line(coords, { label: `${ko || h.technique || ''} +${h.t}분`, from: h.from, to: h.to }))
  }
  return fc(feats)
}

export function gridFeatures(georef, extent, spacing = 2000) {
  const [x0, x1] = extent.x, [y0, y1] = extent.y
  const lines = [], labels = []
  for (let x = x0; x <= x1; x += spacing) {
    lines.push([toLonLat(georef, x, y0), toLonLat(georef, x, y1)])
    const [lon, lat] = toLonLat(georef, x, y0)
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { text: toMgrs(lat, lon, 2).slice(3) } })
  }
  for (let y = y0; y <= y1; y += spacing) {
    lines.push([toLonLat(georef, x0, y), toLonLat(georef, x1, y)])
    const [lon, lat] = toLonLat(georef, x0, y)
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { text: toMgrs(lat, lon, 2).slice(3) } })
  }
  return {
    lines: fc([{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines }, properties: {} }]),
    labels: fc(labels),
  }
}

export function aoFeature(georef, extent) {
  const [x0, x1] = extent.x, [y0, y1] = extent.y
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => toLonLat(georef, x, y))
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }
}

// Which markers share a tap. Screen-space, because overlap is a screen
// problem: the same two assets are distinct at z15 and one blob at z11.
export function stackAt(points, id, radiusPx) {
  const self = (points || []).find((p) => p.id === id)
  if (!self) return []
  const r2 = Number(radiusPx) * Number(radiusPx)
  return (points || [])
    .filter((p) => {
      const dx = p.x - self.x, dy = p.y - self.y
      return dx * dx + dy * dy <= r2
    })
    .map((p) => p.id)
    .sort()
}
