// MIL-STD-2525 symbol rendering (ADR-0013).
//
// milsymbol draws the symbol; this module only decides WHICH symbol code an
// asset type gets, and it does not decide that itself either - the mapping
// lives in configs/symbology-2525.json, copied into public/data at export
// time. Codes that have not been checked against the standard are marked
// unverified in that file, and unverified codes are drawn with a dashed
// outline here so nobody mistakes a guess for a standard.

// milsymbol has shipped both a default export (2.x) and a namespace with a
// named Symbol (3.x). Take whichever this install provides rather than
// pinning the import shape.
import * as msNS from 'milsymbol'
const ms = msNS.default ?? msNS

let table = null
let missing = new Set()

export async function loadSymbology(base = './data/symbology-2525.json') {
  try {
    const res = await fetch(base)
    if (!res.ok) throw new Error(res.status)
    table = await res.json()
  } catch {
    table = null
    console.warn('[symbols] symbology-2525.json 없음 - 자산은 기하 도형으로 표시된다')
  }
  return table
}

function entryFor(type) {
  if (!table) return null
  const m = table.asset_type_map || table.mapping || table.types || table
  const e = m ? m[type] : null
  if (!e || typeof e !== 'object' || !e.sidc) {
    if (typeof e === 'string') return { sidc: e }
    missing.add(type)
    return null
  }
  return e
}

export function unmappedTypes() {
  return [...missing]
}

// affiliation: assets are our own, so 'friend'. Uncertainty about an asset is
// a STATUS, never an affiliation flip - an unknown-cause outage does not turn
// our own command post into an unknown contact.
export function symbolDataUri(type, opts = {}) {
  const e = entryFor(type)
  if (!e || !e.sidc) return null
  try {
    const sym = new ms.Symbol(e.sidc, {
      size: opts.size || 28,
      fill: true,
      monoColor: opts.monoColor || undefined,
      strokeWidth: 3,
      ...(e.options || {}),
    })
    if (!sym.isValid || !sym.isValid()) return null
    return sym.toDataURL()
  } catch (err) {
    console.warn('[symbols] 렌더 실패', type, e.sidc, err)
    return null
  }
}

export function isVerified(type) {
  const e = entryFor(type)
  return !!(e && e.verified === true)
}

// ---------------------------------------------------------------- state
//
// The status digit (position 7 of the 20-digit SIDC) is what makes a node
// readable at a glance: milsymbol draws a dashed frame for 1 (planned), a
// diagonal bar for 3 (damaged) and a cross for 4 (destroyed). That is the
// standard's own way of saying what happened, so no custom icon is needed
// (ADR-0013, and the status policy in configs/symbology-2525.json).
//
// The policy matters as much as the drawing: 3 and 4 are for ATTACK damage
// only. A link cut by a ridge is status 1, not damaged. Otherwise the picture
// reports the hill as enemy action (ADR-0012 section 2).
export const STATUS = {
  normal: '2',
  planned: '1',      // out for mobility / terrain / maintenance
  damaged: '3',      // attack, partial
  destroyed: '4',    // attack, full
  present: '0',      // unknown-cause outage: do not escalate to damaged
}

export function statusForState({ compromise = 0, outageCause = null } = {}) {
  if (compromise >= 0.999) return STATUS.destroyed
  if (compromise > 0) return STATUS.damaged
  if (outageCause === 'unknown') return STATUS.present
  if (outageCause) return STATUS.planned
  return STATUS.normal
}

function withStatus(sidc, status) {
  if (!sidc || sidc.length < 8 || !status) return sidc
  return sidc.slice(0, 6) + status + sidc.slice(7)
}

const cache = new Map()

export function symbolDataUriWithStatus(type, status, opts = {}) {
  const e = entryFor(type)
  if (!e || !e.sidc) return null
  const size = opts.size || 40
  const key = `${type}|${status}|${size}`
  if (cache.has(key)) return cache.get(key)
  let uri = null
  try {
    // outline, not filled: the node's own colour carries the degradation and a
    // solid blue symbol would bury it. monoColor keeps the glyph legible on the
    // dark canvas without claiming an affiliation colour it should not.
    const sym = new ms.Symbol(withStatus(e.sidc, status), {
      size,
      fill: false,
      monoColor: opts.monoColor || '#e3edf9',
      infoColor: opts.monoColor || '#e3edf9',
      strokeWidth: 6,
      ...(e.options || {}),
    })
    if (sym.isValid && sym.isValid()) uri = sym.toDataURL()
  } catch (err) {
    console.warn('[symbols] 상태 심볼 렌더 실패', type, status, err)
  }
  cache.set(key, uri)
  return uri
}

// Unit symbols are a different axis from asset symbols: a battalion is drawn
// as a land unit with an echelon amplifier, not as a device. The mapping is a
// placeholder in the config (the scenario does not say which branch each unit
// is), so this is drawn but never claimed as doctrinally checked.
export function unitSymbolDataUri(echelon, opts = {}) {
  if (!table || !table.unit_symbols) return null
  const amp = (table.unit_symbols.echelon_amplifier || {})[echelon]
  const base = (table.unit_symbols.example || {}).sidc
  if (!amp || !base) return null
  const sidc = base.slice(0, 8) + amp + base.slice(10)
  const size = opts.size || 22
  const key = `unit|${echelon}|${size}`
  if (cache.has(key)) return cache.get(key)
  let uri = null
  try {
    const sym = new ms.Symbol(sidc, { size, fill: false, monoColor: '#9fb2c6', infoColor: '#9fb2c6', strokeWidth: 8 })
    if (sym.isValid && sym.isValid()) uri = sym.toDataURL()
  } catch { uri = null }
  cache.set(key, uri)
  return uri
}
