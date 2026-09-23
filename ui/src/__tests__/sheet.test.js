import { describe, it, expect } from 'vitest'
import { COMPACT_QUERY } from '../useCompact.js'
import { snapTo } from '../ui/Sheet.jsx'

describe('compact breakpoint', () => {
  it('is a max-width query at 860px', () => {
    expect(COMPACT_QUERY).toBe('(max-width: 860px)')
  })
})

describe('snapTo', () => {
  it('picks the nearest snap point', () => {
    expect(snapTo(10, [0, 100, 300])).toBe(0)
    expect(snapTo(60, [0, 100, 300])).toBe(100)
    expect(snapTo(140, [0, 100, 300])).toBe(100)
    expect(snapTo(260, [0, 100, 300])).toBe(300)
  })
  it('ties go to the lower point, so a half-drag never jumps past the middle', () => {
    expect(snapTo(50, [0, 100])).toBe(0)
  })
  it('clamps outside the range', () => {
    expect(snapTo(-40, [0, 100, 300])).toBe(0)
    expect(snapTo(9999, [0, 100, 300])).toBe(300)
  })
})
