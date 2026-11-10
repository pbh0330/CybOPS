import { describe, it, expect } from 'vitest'
import { SKIN_KEY, SKIN_ATTR, DEFAULT_SKIN, SKINS, isSkin, readSkin, applySkin } from '../ui/SkinToggle.jsx'

// A fake root and a fake store: the environment is node, so there is no
// document and no localStorage. Both are injectable for exactly this reason.
const fakeRoot = () => {
  const attrs = new Map()
  return {
    attrs,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
  }
}
const fakeStore = (initial) => {
  const m = new Map(initial ? Object.entries(initial) : [])
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }
}
const throwingStore = () => ({
  getItem: () => { throw new Error('private mode') },
  setItem: () => { throw new Error('private mode') },
})

describe('skin identity', () => {
  it('has exactly two skins and the default is the existing theme', () => {
    expect(SKINS.map(([id]) => id)).toEqual(['default', 'apple'])
    expect(DEFAULT_SKIN).toBe('default')
  })
  it('names one localStorage key and one attribute', () => {
    expect(SKIN_KEY).toBe('mccycop:skin')
    expect(SKIN_ATTR).toBe('data-theme-skin')
  })
  it('only knows the skins it has a stylesheet for', () => {
    expect(isSkin('apple')).toBe(true)
    expect(isSkin('default')).toBe(true)
    expect(isSkin('Apple')).toBe(false)
    expect(isSkin('')).toBe(false)
    expect(isSkin(null)).toBe(false)
  })
})

describe('readSkin', () => {
  it('reads a stored skin', () => {
    expect(readSkin(fakeStore({ [SKIN_KEY]: 'apple' }))).toBe('apple')
  })
  it('falls back to the default when nothing is stored', () => {
    expect(readSkin(fakeStore())).toBe(DEFAULT_SKIN)
  })
  // a value nobody wrote a stylesheet for must not reach the attribute: the
  // screen would then be neither theme
  it('falls back to the default on a value it does not know', () => {
    expect(readSkin(fakeStore({ [SKIN_KEY]: 'cupertino' }))).toBe(DEFAULT_SKIN)
  })
  it('falls back to the default when the store throws', () => {
    expect(readSkin(throwingStore())).toBe(DEFAULT_SKIN)
  })
})

describe('applySkin', () => {
  it('sets the attribute for the apple skin', () => {
    const root = fakeRoot(); const store = fakeStore()
    expect(applySkin('apple', root, store)).toBe('apple')
    expect(root.getAttribute(SKIN_ATTR)).toBe('apple')
    expect(store.m.get(SKIN_KEY)).toBe('apple')
  })
  // This is what makes the rollback total: the scoped stylesheet is inert by
  // selector, not by a token value that happens not to match.
  it('REMOVES the attribute for the default skin rather than setting it', () => {
    const root = fakeRoot(); const store = fakeStore()
    applySkin('apple', root, store)
    expect(applySkin('default', root, store)).toBe('default')
    expect(root.getAttribute(SKIN_ATTR)).toBe(null)
    expect(root.attrs.size).toBe(0)
    expect(store.m.get(SKIN_KEY)).toBe('default')
  })
  it('an unknown skin lands on the default, attribute removed', () => {
    const root = fakeRoot(); const store = fakeStore()
    applySkin('apple', root, store)
    expect(applySkin('cupertino', root, store)).toBe('default')
    expect(root.getAttribute(SKIN_ATTR)).toBe(null)
  })
  it('still sets the attribute when the store throws', () => {
    const root = fakeRoot()
    expect(applySkin('apple', root, throwingStore())).toBe('apple')
    expect(root.getAttribute(SKIN_ATTR)).toBe('apple')
  })
  it('round-trips through a store', () => {
    const root = fakeRoot(); const store = fakeStore()
    applySkin('apple', root, store)
    expect(readSkin(store)).toBe('apple')
    applySkin('default', root, store)
    expect(readSkin(store)).toBe('default')
  })
})
