// The theme switch. A skin is an ATTRIBUTE on the document root and nothing
// else: `theme-apple.css` is scoped entirely under
// `:root[data-theme-skin="apple"]`, so with the attribute absent not one of
// its selectors matches and the default theme renders exactly as it did
// before that file existed. Rollback is the other button.
//
// Deliberately NOT a React context or a prop threaded through App: the skin
// is a property of the document, the stylesheet reads it off the root, and no
// component needs to know which one is on. One control, one attribute.

import { useEffect, useState } from 'react'

export const SKIN_KEY = 'mccycop:skin'
export const SKIN_ATTR = 'data-theme-skin'
export const DEFAULT_SKIN = 'default'
export const SKINS = [['default', '기본'], ['apple', 'Apple']]

const IDS = SKINS.map(([id]) => id)
export const isSkin = (v) => IDS.includes(v)

// A missing or unrecognised stored value is the default skin, never an
// attribute value nobody wrote a stylesheet for. A browser in private mode
// throws on localStorage rather than returning null, so the read is guarded.
export function readSkin(store) {
  try {
    const s = store || window.localStorage
    const raw = s.getItem(SKIN_KEY)
    return isSkin(raw) ? raw : DEFAULT_SKIN
  } catch {
    return DEFAULT_SKIN
  }
}

// The default skin REMOVES the attribute instead of setting it to "default".
// The scoped stylesheet is then inert by selector rather than by a token that
// happens not to match, which is what makes the rollback total: no rule of
// the Apple theme can win a cascade it is not in.
export function applySkin(skin, root, store) {
  const id = isSkin(skin) ? skin : DEFAULT_SKIN
  const el = root || document.documentElement
  if (id === DEFAULT_SKIN) el.removeAttribute(SKIN_ATTR)
  else el.setAttribute(SKIN_ATTR, id)
  try { (store || window.localStorage).setItem(SKIN_KEY, id) } catch { /* private mode or quota */ }
  return id
}

export default function SkinToggle() {
  const [skin, setSkin] = useState(() => readSkin())
  useEffect(() => { applySkin(skin) }, [skin])
  return (
    <div className="seg skin-seg" role="group" aria-label="테마">
      {SKINS.map(([id, label]) => (
        <button
          key={id} type="button"
          className={skin === id ? 'on' : ''}
          aria-pressed={skin === id}
          onClick={() => setSkin(id)}
        >{label}</button>
      ))}
    </div>
  )
}
