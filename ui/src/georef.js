// Local plane <-> WGS84 <-> MGRS. Display only (docs/17 §2, ADR-0025): the
// engine reads none of this and the scenario stores only the local plane.
//
// The plane->WGS84 step is the scenario's own formula (geo.georef.formula),
// repeated here rather than read from the JSON so a scenario cannot ship a
// formula the UI does not implement. The UTM step is the classic USGS series
// (Snyder 1987), good to about a metre - far inside the ~90 m the anchor's
// fixed-cosine approximation already accepts.

export function toLonLat(georef, x, y) {
  const a = georef.anchor
  const lat = a.lat + (y - (a.y || 0)) / 111320
  const lon = a.lon + (x - (a.x || 0)) / (111320 * Math.cos(a.lat * Math.PI / 180))
  return [lon, lat]
}

export function fromLonLat(georef, lon, lat) {
  const a = georef.anchor
  return {
    x: (a.x || 0) + (lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180),
    y: (a.y || 0) + (lat - a.lat) * 111320,
  }
}

const A = 6378137
const F = 1 / 298.257223563
const K0 = 0.9996
const E2 = F * (2 - F)
const EP2 = E2 / (1 - E2)

export function toUtm(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180
  const phi = lat * Math.PI / 180
  const lam = lon * Math.PI / 180
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi)
  const N = A / Math.sqrt(1 - E2 * sin * sin)
  const T = tan * tan
  const C = EP2 * cos * cos
  const Aa = cos * (lam - lon0)
  const M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi))
  const easting = K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120) + 500000
  let northing = K0 * (M + N * tan * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720))
  if (lat < 0) northing += 10000000
  return { zone, easting, northing }
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX'
const COLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const ROWS = 'ABCDEFGHJKLMNPQRSTUV'

// precision = digits per axis: 5 is one metre, 2 is one kilometre
export function toMgrs(lat, lon, precision = 5) {
  const { zone, easting, northing } = toUtm(lat, lon)
  const band = BANDS[Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)))]
  const colSet = (zone - 1) % 3
  const col = COLS[(colSet * 8 + Math.floor(easting / 100000) - 1) % 24]
  const rowOff = zone % 2 === 0 ? 5 : 0
  const row = ROWS[(Math.floor(northing / 100000) + rowOff) % 20]
  const e = String(Math.floor(easting % 100000)).padStart(5, '0').slice(0, precision)
  const n = String(Math.floor(northing % 100000)).padStart(5, '0').slice(0, precision)
  return `${zone}${band}${col}${row}${e}${n}`
}
