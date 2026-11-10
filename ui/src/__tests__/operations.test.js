import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { assetSnapshot, modelKind, missionSeries, operationMoments, percent, trendPath } from '../operations/presentation.js'
import { buildModel } from '../operations/models.js'
import { runChain } from '../engine.js'
import { linkFitsRules } from '../sandbox.js'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const replay = read('../../public/data/airnet-01.replay.json')
const rules = read('../../../configs/link-rules.json')
const stepAt = (t) => replay.steps.find((s) => s.t === t)

describe('operations display keeps state provenance', () => {
  it('a mission selection never impersonates an arbitrary asset', () => {
    expect(assetSnapshot(replay.graph, stepAt(40), 'M-AIR-C2')).toBeNull()
    expect(assetSnapshot(replay.graph, stepAt(40), 'missing')).toBeNull()
  })
  it('missing engine values remain unmeasured', () => {
    expect(percent(undefined)).toBe('미측정')
    expect(percent(NaN)).toBe('미측정')
    expect(assetSnapshot(replay.graph, {}, 'FTR-01').degradation).toBeNull()
    expect(assetSnapshot(replay.graph, {}, 'FTR-01').compromise).toBeNull()
  })
  it('shows a healthy aircraft terminal while its control mission is unavailable', () => {
    const row = assetSnapshot(replay.graph, stepAt(40), 'FTR-01')
    expect(row.compromise).toBe(0)
    expect(row.degradation).toBe(0)
    expect(stepAt(40).mission['M-AIR-C2']).toBe(1)
    expect(row.links[0].peer).toBe('AIR-GW')
  })
  it('labels link restoration independently of the repeated attack label', () => {
    const moments = operationMoments(replay.graph, replay.steps)
    expect(moments.map((m) => replay.steps[m.index].t)).toEqual([0, 25, 40, 60, 80, 100])
    expect(moments.find((m) => replay.steps[m.index].t === 60)).toMatchObject({ label: '연결 복구', attack: false })
  })
  it('uses elapsed time for uneven samples and breaks a trace at unknown/inactive state', () => {
    const points = missionSeries([{ t: 0, mission: { M: 0 } }, { t: 2, mission: {} }, { t: 20, mission: { M: 1 } }], 'M')
    expect(points.map((p) => p.x)).toEqual([0, 0.1, 1])
    expect(trendPath(points)).toBe('M0.00,48.00  M280.00,8.00')
    expect(trendPath([{ x: 0, value: 1, active: false }])).toBe('')
  })
  it('only accepts known display models and does not change cyber asset type', () => {
    const asset = replay.graph.assets.find((a) => a.id === 'FTR-01')
    expect(modelKind(asset)).toBe('fighter')
    expect(asset.type).toBe('c2-terminal')
    expect(modelKind({ type: 'c2-server', visual_model: 'untrusted-model-url' })).toBe('rack')
  })
})

describe('airnet authored construct, not detection performance', () => {
  it('redundancy only protects the mission while the backup is reachable', () => {
    expect(stepAt(0).mission['M-AIR-C2']).toBe(0)
    expect(stepAt(25).mission['M-AIR-C2']).toBe(0)
    expect(stepAt(40).mission['M-AIR-C2']).toBe(1)
    expect(stepAt(40).mission_attack['M-AIR-C2']).toBe(0)
    expect(stepAt(40).mission_env['M-AIR-C2']).toBe(0)
    expect(stepAt(60).mission['M-AIR-C2']).toBe(0)
  })
  it('air picture loss stays separate from control availability', () => {
    expect(stepAt(80).mission['M-AIR-C2']).toBe(0)
    expect(stepAt(80).mission['M-AIR-PICTURE']).toBeCloseTo(0.65)
    expect(stepAt(100).mission['M-AIR-C2']).toBeCloseTo(0.25)
  })
  it('all links satisfy the existing rule table with explicit allowed exceptions', () => {
    expect(replay.graph.links.filter((l) => !linkFitsRules(replay.graph, rules, l))).toEqual([])
    expect(read('../../public/data/link-rules.json')).toEqual(rules)
  })
  it('moving aircraft, changing shapes and removing geography cannot change any judgment', () => {
    const graph = structuredClone(replay.graph)
    delete graph.geo
    for (const a of graph.assets) { delete a.geo; a.visual_model = 'rack' }
    for (const s of replay.steps) {
      expect(runChain(graph, s.compromise, { t: s.t })).toEqual(runChain(replay.graph, s.compromise, { t: s.t }))
    }
  })
  it('manifest pins the authored files and generator', async () => {
    const { createHash } = await import('node:crypto')
    const manifest = read('../../../scenarios/airnet-01/MANIFEST.json')
    for (const file of manifest.files) {
      const bytes = readFileSync(new URL(`../../../scenarios/airnet-01/${file.path}`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
    }
    const generator = readFileSync(new URL('../../../scripts/build_airnet_demo.py', import.meta.url))
    expect(createHash('sha256').update(generator).digest('hex')).toBe(manifest.generator_sha256)
    const exported = readFileSync(new URL('../../public/data/airnet-01.replay.json', import.meta.url))
    expect(createHash('sha256').update(exported).digest('hex')).toBe(manifest.replay.sha256)
  })
})

describe('bundled generic geometry', () => {
  for (const kind of ['fighter', 'aew', 'vehicle', 'rack', 'relay', 'satellite', 'network', 'terminal']) {
    it(`${kind} has finite geometry and releases each resource once`, () => {
      const model = buildModel(kind)
      const geometries = new Set(), materials = new Set()
      model.traverse((o) => {
        if (!o.geometry) return
        geometries.add(o.geometry); materials.add(o.material)
        expect([...o.geometry.attributes.position.array].every(Number.isFinite)).toBe(true)
      })
      expect(geometries.size).toBeGreaterThan(2)
      const releases = new Map()
      for (const r of [...geometries, ...materials]) r.addEventListener('dispose', () => releases.set(r, (releases.get(r) || 0) + 1))
      model.userData.dispose()
      expect([...releases.values()]).toEqual([...geometries, ...materials].map(() => 1))
    })
  }
})
