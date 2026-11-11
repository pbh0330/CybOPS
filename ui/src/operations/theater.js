// Presentation only. These functions never call the state engine.
import { positionAt } from '../geo.js'
import { toLonLat } from '../georef.js'
import { modelKind } from './presentation.js'

export function domainOf(asset) {
  const kind = modelKind(asset)
  return ['ship', 'usv'].includes(kind) ? 'sea' : ['fighter', 'aew'].includes(kind) ? 'air' : kind === 'spacecraft' ? 'space' : 'ground'
}

export function headingAt(asset, t) {
  const seg = asset?.geo?.segments?.find((s) => t >= s.from && t < s.to)
  if (!seg?.to_at || seg.mode !== 'move') return null
  const dx = seg.to_at.x - seg.at.x, dy = seg.to_at.y - seg.at.y
  return dx || dy ? (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 : null
}

export function sceneRows(graph, step) {
  const t = Number(step?.t ?? 0)
  return (graph?.assets || []).flatMap((asset) => {
    const position = positionAt(asset, t)
    if (!position || ![position.x, position.y, position.z ?? 0].every(Number.isFinite)) return []
    return [{ asset, id: asset.id, kind: modelKind(asset), domain: domainOf(asset), position,
      heading: headingAt(asset, t), lonlat: graph.geo?.georef ? toLonLat(graph.geo.georef, position.x, position.y) : null,
      cause: Number(step?.compromise?.[asset.id]) > 0 ? 'attack' : step?.asset_outage?.[asset.id] || null }]
  })
}

// Kilometres on the horizontal axes; altitude compressed for a legible overview.
// HUD always displays the authored metre value, never this display coordinate.
export function theaterPoint(p, center = { x: 0, y: 0 }) {
  return [(p.x - center.x) / 1000, Math.log1p(Math.max(0, p.z || 0) / 1000) * 2.5, -(p.y - center.y) / 1000]
}

export function globePoint(lonlat, altitude = 0, radius = 12) {
  const [lon, lat] = lonlat.map((v) => v * Math.PI / 180)
  const r = radius * (1 + Math.max(0, altitude) / 6371000)
  return [-r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)]
}

export function visibleConnections(graph, rows, step) {
  const ids = new Set(rows.map((r) => r.id))
  return (graph?.links || []).filter((l) => ids.has(l.a) && ids.has(l.b)).map((l) => ({ ...l, cause: step?.link_outage?.[l.id] || null }))
}
