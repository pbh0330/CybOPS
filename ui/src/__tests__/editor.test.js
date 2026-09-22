import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import { makeSandbox, placeFree } from '../sandbox.js'
import { createEditor } from '../editor.js'

// createEditor without a DOM: renderPalette/setTool touch document, the
// graph-only functions below do not
function harness() {
  const g = makeSandbox(replay).graph
  const changes = []
  const ed = createEditor({ paletteEl: null, onChange: (c) => changes.push(c), getGraph: () => g, getCy: () => null })
  return { g, ed, changes }
}
const at = (g, id) => g.assets.find((a) => a.id === id).geo.at
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)

describe('addLinkWith placement', () => {
  it('a new asset lands in a free cell, then moves next to the first asset it is linked to', () => {
    const { g, ed } = harness()
    const srv = ed.addAsset({ type: 'c2-server', transit: true })
    const first = placeFree({ ...g, assets: [] })
    expect(at(g, srv)).toEqual(first)
    const wks = ed.addAsset({ type: 'workstation', transit: false })
    expect(dist(at(g, wks), at(g, srv))).toBeGreaterThanOrEqual(1000)   // free cell, not on top
    ed.addLinkWith(srv, wks, 'wired')
    expect(Math.round(dist(at(g, wks), at(g, srv)))).toBe(150)          // now beside the server
    expect(at(g, srv)).toEqual(first)                                    // the anchor did not move
  })
  it('moves whichever end has no other link, and neither once both are wired', () => {
    const { g, ed } = harness()
    const a = ed.addAsset({ type: 'c2-server', transit: true })
    const b = ed.addAsset({ type: 'switch', transit: true })
    const c = ed.addAsset({ type: 'workstation', transit: false })
    ed.addLinkWith(b, a, 'wired')                                        // both fresh: the second end (a) moves
    expect(Math.round(dist(at(g, a), at(g, b)))).toBe(150)
    const pa = at(g, a); const pb = at(g, b)
    ed.addLinkWith(c, b, 'wired')                                        // b already linked: c moves to b
    expect(Math.round(dist(at(g, c), at(g, b)))).toBe(150)
    expect(at(g, a)).toEqual(pa); expect(at(g, b)).toEqual(pb)
    const pc = at(g, c)
    ed.addLinkWith(a, c, 'wired')                                        // both linked: nobody moves
    expect(at(g, a)).toEqual(pa); expect(at(g, c)).toEqual(pc)
  })
  it('never moves an authored (non-_added) asset', () => {
    const { g, ed } = harness()
    g.assets.push({ id: 'AUTH-01', type: 'c2-server', unit: null, site: 'TOC', transit: true, geo: { kind: 'fixed', at: { x: 5000, y: 5000, z: 0 } } })
    const n = ed.addAsset({ type: 'workstation', transit: false })
    ed.addLinkWith(n, 'AUTH-01', 'wired')
    expect(at(g, 'AUTH-01')).toEqual({ x: 5000, y: 5000, z: 0 })
    expect(Math.round(dist(at(g, n), at(g, 'AUTH-01')))).toBe(150)
  })
  it('is one commit: link, bearer and placement land in a single onChange', () => {
    const { g, ed, changes } = harness()
    const a = ed.addAsset({ type: 'c2-server', transit: true })
    const b = ed.addAsset({ type: 'satcom-terminal', transit: true })
    changes.length = 0
    const id = ed.addLinkWith(a, b, 'satcom')
    expect(changes).toEqual([{ reason: 'link', id }])
    expect(g.links.find((l) => l.id === id).bearer).toBe('satcom')
    expect(Math.round(dist(at(g, a), at(g, b)))).toBe(150)
    changes.length = 0
    expect(ed.addLinkWith(a, b, 'satcom')).toBeNull()                    // duplicate: no commit at all
    expect(changes).toEqual([])
    ed.addLink(b, ed.addAsset({ type: 'switch', transit: true }))       // palette path keeps its own single commit
    expect(changes.map((c) => c.reason)).toEqual(['add-asset', 'add-link'])
  })
  it('a duplicate link moves nothing', () => {
    const { g, ed } = harness()
    const a = ed.addAsset({ type: 'c2-server', transit: true })
    const b = ed.addAsset({ type: 'switch', transit: true })
    ed.addLinkWith(a, b, 'wired')
    const pa = at(g, a); const pb = at(g, b)
    expect(ed.addLinkWith(b, a, 'wired')).toBeNull()
    expect(at(g, a)).toEqual(pa); expect(at(g, b)).toEqual(pb)
  })
})
