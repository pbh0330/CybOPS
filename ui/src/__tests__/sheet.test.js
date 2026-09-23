import { describe, it, expect } from 'vitest'
import { COMPACT_QUERY } from '../useCompact.js'

describe('compact breakpoint', () => {
  it('is a max-width query at 860px', () => {
    expect(COMPACT_QUERY).toBe('(max-width: 860px)')
  })
})
