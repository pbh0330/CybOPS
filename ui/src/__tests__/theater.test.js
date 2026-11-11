import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { domainOf, globePoint, headingAt, sceneRows, theaterPoint, visibleConnections } from '../operations/theater.js'
import { runChain } from '../engine.js'
import { linkFitsRules } from '../sandbox.js'

const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'))
const replay=read('../../public/data/jointnet-01.replay.json')
const graph=replay.graph
const at=t=>replay.steps.find(s=>s.t===t)

describe('joint theater display contract',()=>{
  it('keeps the same authored position and identity on map and in the scene',()=>{
    const rows=sceneRows(graph,at(30))
    expect(rows).toHaveLength(9)
    const ship=rows.find(r=>r.id==='SHIP-01')
    expect(ship.position).toMatchObject({x:76000,y:26000,z:0})
    expect(ship.kind).toBe('ship')
    expect(domainOf(ship.asset)).toBe('sea')
    expect(rows.find(r=>r.id==='ORB-01').domain).toBe('space')
  })
  it('does not leave a vanished platform at its last coordinate',()=>{
    const rows=sceneRows(graph,{t:120})
    expect(rows.some(r=>r.id==='SHIP-01')).toBe(false)
    expect(rows.some(r=>r.id==='FTR-01')).toBe(false)
    expect(rows.some(r=>r.id==='AIR-C2')).toBe(true)
  })
  it('derives direction only inside an authored moving interval',()=>{
    const ship=graph.assets.find(a=>a.id==='SHIP-01')
    expect(headingAt(ship,0)).toBeCloseTo(28.6104,3)
    expect(headingAt(ship,120)).toBeNull()
    expect(headingAt(graph.assets[0],0)).toBeNull()
  })
  it('never implies an engine outage from missing coordinates',()=>{
    const altered=structuredClone(graph)
    delete altered.assets.find(a=>a.id==='ORB-01').geo
    const rows=sceneRows(altered,at(70))
    expect(rows.some(r=>r.id==='ORB-01')).toBe(false)
    expect(visibleConnections(altered,rows,at(70)).some(l=>l.b==='ORB-01')).toBe(false)
    expect(runChain(altered,at(70).compromise,{t:70})).toEqual(runChain(graph,at(70).compromise,{t:70}))
  })
  it('projects altitude for display without changing the source',()=>{
    const p={x:2000,y:4000,z:420000}
    expect(theaterPoint(p)).toEqual([2,Math.log1p(420)*2.5,-4])
    expect(p.z).toBe(420000)
    expect(Math.hypot(...globePoint([128,38],0))).toBeCloseTo(12)
    expect(Math.hypot(...globePoint([128,38],420000))).toBeGreaterThan(12)
  })
  it('only paints declared connection causes',()=>{
    const links=visibleConnections(graph,sceneRows(graph,at(40)),at(40))
    expect(links.filter(l=>l.cause).map(l=>[l.id,l.cause])).toEqual([['L-BACKUP','unknown']])
    expect(visibleConnections(graph,sceneRows(graph,at(60)),at(60)).filter(l=>l.cause)).toEqual([])
  })
})

describe('joint fixture evidence',()=>{
  it('keeps air control, maritime dependency and space terminal input distinct',()=>{
    expect(at(40).mission['M-MARITIME']).toBe(1)
    expect(at(60).mission['M-MARITIME']).toBe(0)
    expect(at(70).mission['M-MARITIME']).toBeCloseTo(.45)
    expect(at(70).mission['M-AIR-C2']).toBe(0)
    expect(at(80).mission['M-AIR-PICTURE']).toBeCloseTo(.65)
  })
  it('uses existing cyber types and bearer rules for all new platforms',()=>{
    const rules=read('../../../configs/link-rules.json')
    expect(graph.links.filter(l=>!linkFitsRules(graph,rules,l))).toEqual([])
    expect(graph.assets.filter(a=>['ship','usv','spacecraft'].includes(a.visual_model)).map(a=>a.type)).toEqual(['c2-terminal','c2-terminal','satcom-terminal'])
  })
  it('camera and environment inputs cannot change an engine result',()=>{
    const changed=structuredClone(graph)
    delete changed.geo
    for(const a of changed.assets){delete a.geo;a.visual_model='rack'}
    for(const s of replay.steps)expect(runChain(changed,s.compromise,{t:s.t})).toEqual(runChain(graph,s.compromise,{t:s.t}))
  })
  it('pins the inputs, generator and exported replay bytes',()=>{
    const manifest=read('../../../scenarios/jointnet-01/MANIFEST.json')
    const check=(path,hash)=>expect(createHash('sha256').update(readFileSync(new URL('../../../'+path,import.meta.url))).digest('hex')).toBe(hash)
    for(const f of manifest.files)check('scenarios/jointnet-01/'+f.path,f.sha256)
    for(const f of manifest.inputs)check(f.path,f.sha256)
    check(manifest.generator,manifest.generator_sha256)
    check(manifest.replay.path,manifest.replay.sha256)
    expect(read('../../public/data/jointnet-01.provenance.json')).toEqual(manifest)
  })
})
