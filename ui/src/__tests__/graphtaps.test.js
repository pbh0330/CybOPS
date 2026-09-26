import { describe, it, expect } from 'vitest'
import { bindTaps } from '../graph.js'

// The defect: GraphCanvas registers its cytoscape tap handlers once, inside
// the effect that builds the instance ([graph]), while App rebuilds `onTap`
// whenever the mode changes ([mode]). The handler kept the observe-mode
// onTap, so the FIRST tap after entering edit mode did nothing - the edit
// tool only started working once something rebuilt cytoscape.
//
// A real cytoscape instance is not needed to pin this down: what matters is
// whether the registered handler reads the CURRENT callback or the one it
// was born with. This fake records handlers the way cy.on does and replays
// them. (That GraphCanvas keeps those refs up to date on every render is a
// one-line assignment the browser check covers; this covers the wiring.)
function fakeCy() {
  const regs = []
  const cy = {
    on(_evt, sel, fn) { regs.push(fn ? { sel, fn } : { sel: null, fn: sel }) },
    tap(target) {
      for (const r of regs) {
        const hit = r.sel === null
          || (r.sel === 'node' && target !== cy && target.isNode())
          || (r.sel === 'edge' && target !== cy && target.isEdge())
        if (hit) r.fn({ target })
      }
    },
  }
  return cy
}
const node = (id) => ({ isNode: () => true, isEdge: () => false, id: () => id })
const edge = (id) => ({ isNode: () => false, isEdge: () => true, id: () => id })

function wired() {
  const cy = fakeCy()
  const tapRef = { current: null }
  const selected = []
  const tapped = []
  const selectRef = { current: (id) => selected.push(id) }
  bindTaps(cy, tapRef, selectRef)
  return { cy, tapRef, selectRef, selected, tapped }
}

describe('bindTaps reads the current callbacks', () => {
  it('the first tap after the tool callback changes goes to the new one', () => {
    const { cy, tapRef, tapped, selected } = wired()
    // observe mode: onTap consumes nothing, so a node tap selects
    tapRef.current = () => false
    cy.tap(node('a1'))
    expect(selected).toEqual(['a1'])

    // entering edit mode replaces onTap. cytoscape was NOT rebuilt.
    tapRef.current = (t) => { tapped.push(t.id()); return true }
    cy.tap(node('a2'))
    expect(tapped).toEqual(['a2'])          // before the fix: [] - stale closure
    expect(selected).toEqual(['a1'])        // a consumed tap does not also select
  })

  it('an edge tap goes to the current onTap', () => {
    const { cy, tapRef, tapped } = wired()
    tapRef.current = () => false
    tapRef.current = (t) => { tapped.push(t.id()); return true }
    cy.tap(edge('l1'))
    expect(tapped).toEqual(['l1'])
  })

  it('a background tap clears the selection through the current onSelect', () => {
    const { cy, tapRef, selectRef } = wired()
    tapRef.current = () => false
    const later = []
    selectRef.current = (id) => later.push(id)
    cy.tap(cy)
    expect(later).toEqual([null])
  })

  it('a node tap with no onTap at all still selects', () => {
    const { cy, selected } = wired()
    cy.tap(node('a9'))
    expect(selected).toEqual(['a9'])
  })
})
