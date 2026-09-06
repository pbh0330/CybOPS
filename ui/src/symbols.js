// MIL-STD-2525 symbol rendering (ADR-0013).
//
// milsymbol draws the symbol; this module only decides WHICH symbol code an
// asset type gets, and it does not decide that itself either - the mapping
// lives in configs/symbology-2525.json, copied into public/data at export
// time. Codes that have not been checked against the standard are marked
// unverified in that file, and unverified codes are drawn with a dashed
// outline here so nobody mistakes a guess for a standard.

import ms from 'milsymbol'

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
  const m = table.mapping || table.types || table
  const e = m ? m[type] : null
  if (!e) { missing.add(type); return null }
  return typeof e === 'string' ? { sidc: e } : e
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
