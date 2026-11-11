import { describe, it, expect } from 'vitest'
import { CAUSE_COLOR, CHROME } from '../tokens.mjs'
import { CAUSE_COLOR as FROM_GRAPH, stylesheet } from '../graph.js'

// tokens.mjs is the source for every colour the JS side draws with
// (ADR-0024). Three files mirror it and tools/token-parity.mjs holds those
// three to each other; what it cannot see is the JS side of the arrangement,
// which is what breaks here:
//
//   - graph.js RE-EXPORTS the palette. Six components import CAUSE_COLOR from
//     '../graph.js', so if someone turns the re-export back into a local
//     object the gate still passes and the second copy is back.
//   - the hex shape. A three-digit or malformed value reaches Cytoscape as a
//     silent no-paint rather than an error.
describe('tokens.mjs', () => {
  it('has the eight cause colours, all six-digit lowercase hex', () => {
    expect(Object.keys(CAUSE_COLOR).sort()).toEqual([
      'attack', 'env', 'inter', 'maintenance', 'mobility', 'ok', 'terrain', 'unknown',
    ])
    for (const [k, v] of Object.entries(CAUSE_COLOR)) {
      expect(v, k).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  // nodeUnderlayNone is '#000' and stays '#000': this task moved where the
  // value lives, not what it is, and widening the shorthand would be a change
  // to the bytes the renderer sees. Hence three OR six digits.
  it('has chrome greys that are all hex', () => {
    expect(Object.keys(CHROME).length).toBeGreaterThan(0)
    for (const [k, v] of Object.entries(CHROME)) {
      expect(v, k).toMatch(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/)
    }
  })

  // The values the refactor replaced, written out. If a name is ever repointed
  // at a different grey this fails, which is the difference between moving a
  // constant and changing a colour.
  it('still carries the exact literals it replaced', () => {
    expect(CHROME.lineStrong).toBe('#2a3442')
    expect(CHROME.textPrimary).toBe('#f2f3f4')
    expect(CHROME.causeFallback).toBe('#8a8f98')
    expect(CHROME.markRingIdle).toBe('#3a4657')
    expect(CHROME.nodeUnderlayNone).toBe('#000')
    expect(CAUSE_COLOR.ok).toBe('#2fd18b')
  })
})

describe('graph.js', () => {
  it('re-exports the palette rather than copying it', () => {
    // toBe, not toEqual: a copy with equal values would pass toEqual and is
    // exactly the thing being prevented.
    expect(FROM_GRAPH).toBe(CAUSE_COLOR)
  })

  it('builds a stylesheet that carries the attack colour', () => {
    const sheet = stylesheet()
    const colours = sheet.flatMap((rule) => Object.values(rule.style || {}))
    expect(colours).toContain(CAUSE_COLOR.attack)
    expect(colours).toContain(CAUSE_COLOR.ok)
  })
})
