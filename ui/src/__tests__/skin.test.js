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

// --- 툴바 가로 패딩 (2026-11-10) --------------------------------------
//
// Apple 스킨을 머지하면서 상판 툴바가 1280x800 편집 모드에서 13px 넘쳤다.
// 기본 테마는 같은 내용을 690 of 690 으로 눕히는데, Apple 의 7px/14px 컨트롤이
// 같은 내용을 703 으로 밀었다. U12 의 fold 는 한 단뿐이고 이미 그 한 단을 썼다.
//
// 고친 값은 가로 11px 이고, 그 값이 다시 올라가는 것을 막는 것이 이 검사다.
// **막은 것은 지식이 아니라 검사기다** - 이 저장소가 여섯 번 배운 문장이다.
// 브라우저 없이 잴 수 있는 것은 CSS 텍스트뿐이라 거기까지만 한다. 넘침 자체는
// 사람이 브라우저에서 재고 그 수치를 theme-apple.css 주석에 적는다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const px = (s) => Number(String(s).replace('px', ''))
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('Apple 스킨의 툴바 가로 패딩', () => {
  const apple = read('../theme-apple.css')
  const base = read('../style.css')

  // 기본 테마의 button/select 가로 패딩
  const baseH = px((base.match(/button,\s*select\s*\{[^}]*padding:\s*\d+px\s+(\d+)px/s) || [])[1])
  // Apple 의 툴바 전용 재지정
  const tbLeft = px((apple.match(/\.board-toolbar button,[^{]*\{[^}]*padding-left:\s*(\d+)px/s) || [])[1])
  const tbRight = px((apple.match(/\.board-toolbar button,[^{]*\{[^}]*padding-right:\s*(\d+)px/s) || [])[1])

  it('기본 테마의 가로 패딩을 읽어 낸다', () => {
    expect(Number.isFinite(baseH)).toBe(true)
    expect(baseH).toBeGreaterThan(0)
  })

  it('툴바 전용 재지정이 존재한다', () => {
    expect(Number.isFinite(tbLeft)).toBe(true)
    expect(Number.isFinite(tbRight)).toBe(true)
  })

  it('기본 테마보다 넓지 않다 - 넓어지면 1280 에서 다시 넘친다', () => {
    expect(tbLeft).toBeLessThanOrEqual(baseH)
    expect(tbRight).toBeLessThanOrEqual(baseH)
  })

  it('좌우가 같다', () => {
    expect(tbLeft).toBe(tbRight)
  })
})
