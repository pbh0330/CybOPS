// Read-only projections. Geometry, camera and time navigation never enter the engine.
import { clockOf } from '../derive.js'

export const valueOf = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null
export const percent = (v) => valueOf(v) === null ? '미측정' : `${(v * 100).toFixed(1)}%`

export function modelKind(asset) {
  if (!asset) return null
  if (['fighter', 'aew'].includes(asset.visual_model)) return asset.visual_model
  if (asset.type === 'satcom-terminal') return 'satellite'
  if (asset.type === 'radio-relay') return 'relay'
  if (asset.type === 'c2-terminal' && /VEH|지휘차/.test(`${asset.id} ${asset.site || ''}`)) return 'vehicle'
  if (/server|hypervisor|database|domain-controller/.test(asset.type)) return 'rack'
  if (/gateway|switch|firewall/.test(asset.type)) return 'network'
  return 'terminal'
}

export function assetSnapshot(graph, step, id) {
  const asset = graph?.assets?.find((a) => a.id === id)
  if (!asset || !step) return null
  const serviceIds = new Set((graph.edges?.provided_by || []).filter((e) => e.to === id).map((e) => e.from))
  return {
    asset,
    // A missing state is unknown, never a fabricated healthy zero.
    degradation: valueOf(step.asset?.[id]),
    compromise: step.compromise ? (Object.hasOwn(step.compromise, id) ? valueOf(step.compromise[id]) : 0) : null,
    outage: step.asset_outage?.[id] || null,
    services: (graph.services || []).filter((s) => serviceIds.has(s.id)),
    links: (graph.links || []).filter((l) => l.a === id || l.b === id).map((l) => ({
      ...l, peer: l.a === id ? l.b : l.a, cause: step.link_outage?.[l.id] || null,
    })),
    whatif: step.whatif?.[id] || null,
  }
}

export function timeLabel(step, index) {
  return step?.time_iso ? clockOf(step).time : (valueOf(step?.t) === null ? `${index + 1}단계` : `T+${step.t}분`)
}

// Bookmarks come from authored state changes, including environmental outages.
// A repeated attack label is not evidence that nothing else happened.
export function operationMoments(graph, steps = []) {
  const signature = (s) => JSON.stringify([
    Object.entries(s.compromise || {}).sort(),
    Object.entries(s.asset_outage || {}).filter(([, v]) => v).sort(),
    Object.entries(s.link_outage || {}).filter(([, v]) => v).sort(),
    [...(s.active_phases || [])].sort(),
  ])
  return steps.flatMap((s, i) => {
    if (i > 0 && signature(s) === signature(steps[i - 1])) return []
    const prev = steps[i - 1]
    const attackChanged = prev && JSON.stringify(s.compromise) !== JSON.stringify(prev.compromise)
    const causes = [...new Set([...Object.values(s.asset_outage || {}), ...Object.values(s.link_outage || {})].filter(Boolean))]
    const outageCount = (v) => [...Object.values(v?.asset_outage || {}), ...Object.values(v?.link_outage || {})].filter(Boolean).length
    const restored = prev && outageCount(s) < outageCount(prev)
    const causeLabel = causes.map((c) => ({ mobility: '기동', terrain: '지형', maintenance: '정비', unknown: '미상' }[c]) || c).join('·')
    const phase = (graph?.phases || []).filter((p) => s.active_phases?.includes(p.id)).map((p) => p.name).join('·')
    return [{ index: i, time: timeLabel(s, i), label: i === 0 ? '시나리오 시작' : attackChanged ? (s.label || '침해 상태 변경') : restored ? '연결 복구' : causeLabel ? `${causeLabel} 단절` : (phase || '연결 상태 변경'), attack: !!attackChanged,
      note: restored && !attackChanged ? '현재 시점의 엔진 단절 목록에서 해제된 연결·자산이 있습니다.' : s.note || '' }]
  })
}

// The horizontal axis uses scenario time, not equally spaced samples. Missing
// measurements break the line instead of being turned into zeros.
export function missionSeries(steps = [], missionId) {
  const timed = steps.length > 1 && steps.every((s) => valueOf(s.t) !== null) && steps.at(-1).t > steps[0].t
  const start = timed ? steps[0].t : 0
  const span = timed ? steps.at(-1).t - start : Math.max(1, steps.length - 1)
  return steps.map((s, i) => ({ x: ((timed ? s.t : i) - start) / span, value: valueOf(s.mission?.[missionId]), active: s.mission_active?.[missionId] !== false }))
}

export function trendPath(points) {
  let pen = false
  return points.map((p) => {
    if (p.value === null || !p.active) { pen = false; return '' }
    const segment = `${pen ? 'L' : 'M'}${(p.x * 280).toFixed(2)},${(48 - p.value * 40).toFixed(2)}`
    pen = true
    return segment
  }).join(' ')
}
