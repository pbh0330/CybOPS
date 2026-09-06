// Mission dependency graph -> Cytoscape elements.
//
// The coordinate system is the dependency topology, not geography (ADR-0001).
// Node position comes from the graph; the 2525 symbol is only the picture
// drawn on the node (ADR-0013 section 3).

import { symbolDataUri, isVerified } from './symbols.js'

export const CAUSE_COLOR = {
  attack: '#e5484d',
  mobility: '#6ea8c7',
  terrain: '#8f9f6e',
  maintenance: '#8a8f98',
  unknown: '#d8a13a',
}

// degradation -> colour. Not a red ramp: red is reserved for adversary effect,
// so the neutral ramp goes green -> amber -> slate-red and the CAUSE is what
// decides the border.
export function degColor(v) {
  if (v <= 0.001) return '#12463a'
  if (v < 0.25) return '#2c5c3f'
  if (v < 0.5) return '#6b6330'
  if (v < 0.75) return '#8f4f2c'
  return '#8f2f39'
}

export function buildElements(g) {
  const els = []
  const phaseOf = {}
  for (const ph of g.phases || []) phaseOf[ph.id] = ph

  for (const m of g.missions || []) {
    els.push({ data: { id: m.id, kind: 'mission', label: m.name, priority: m.priority } })
  }
  for (const t of g.tasks || []) {
    const ph = phaseOf[t.phase] || {}
    els.push({
      data: {
        id: t.id, kind: 'task', label: t.name,
        phase: t.phase, phaseName: ph.name || '', mission: ph.mission || '',
        performedAt: t.performed_at || '', criticality: t.criticality,
      },
    })
    // direction is mission -> task on purpose: dagre ranks by edge direction, and
    // the picture has to read top-down as mission > task > service > asset
    if (ph.mission) els.push({ data: { id: `e:${ph.mission}->${t.id}`, source: ph.mission, target: t.id, kind: 'part_of' } })
    // where the work is actually done. Without this edge the terminals float
    // free in the dependency view, and "which terminal can still reach the
    // service" is exactly what the time axis is about.
    if (t.performed_at) {
      els.push({ data: { id: `e:at:${t.id}->${t.performed_at}`, source: t.id, target: t.performed_at, kind: 'performed_at' } })
    }
  }
  for (const s of g.services || []) {
    els.push({
      data: {
        id: s.id, kind: 'service', label: s.name,
        redundancy: s.redundancy_group || '',
      },
    })
  }
  for (const a of g.assets || []) {
    const uri = symbolDataUri(a.type, { size: 40 })
    els.push({
      data: {
        id: a.id, kind: 'asset', label: a.id, assetType: a.type,
        unit: a.unit || '', site: a.site || '', mobility: a.mobility || 'static',
        transit: a.transit === false ? false : true,
        symbol: uri || '', symbolVerified: uri ? isVerified(a.type) : false,
      },
    })
  }

  const E = g.edges || {}
  for (const e of E.requires || []) {
    els.push({ data: { id: `e:${e.from}->${e.to}`, source: e.from, target: e.to, kind: 'requires', w: e.w, label: fmtW(e.w) } })
  }
  for (const e of E.provided_by || []) {
    els.push({ data: { id: `e:${e.from}->${e.to}`, source: e.from, target: e.to, kind: 'provided_by', w: e.w } })
  }
  for (const e of E.depends_on || []) {
    els.push({ data: { id: `e:dep:${e.from}->${e.to}`, source: e.from, target: e.to, kind: 'depends_on', w: e.w, label: fmtW(e.w) } })
  }
  for (const e of E.hosted_on || []) {
    els.push({ data: { id: `e:host:${e.from}->${e.to}`, source: e.from, target: e.to, kind: 'hosted_on' } })
  }

  // transport links live in the same graph but are hidden in the dependency
  // view. They are not dependencies - mixing the two semantics on one screen
  // is how people start reading the picture wrong.
  for (const l of g.links || []) {
    els.push({
      data: {
        id: l.id, source: l.a, target: l.b, kind: 'link',
        bearer: l.bearer || '', label: l.bearer || '',
      },
      classes: 'transport',
    })
  }

  return els
}

function fmtW(w) {
  if (w === undefined || w === null) return ''
  return String(w)
}

export function stylesheet() {
  return [
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'color': '#c8d3e0',
        'font-family': 'Pretendard, "Segoe UI", "Malgun Gothic", sans-serif',
        'font-size': 10,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'text-wrap': 'wrap',
        'text-max-width': 110,
        'text-outline-color': '#0a0d12',
        'text-outline-width': 2.5,
        'text-outline-opacity': 0.85,
        'border-width': 1.5,
        'border-color': '#2a3441',
        'background-color': '#1b2432',
        'transition-property': 'background-color, border-color, border-width',
        'transition-duration': '180ms',
      },
    },
    {
      selector: 'node[kind="mission"]',
      style: {
        'shape': 'round-rectangle',
        'width': 132, 'height': 46,
        'font-size': 12.5, 'font-weight': 'bold',
        'color': '#eef4fb',
        'text-valign': 'center',
        'text-margin-y': 0,
        'background-color': '#22304a',
        'border-color': '#3d5a7d',
        'border-width': 1.5,
      },
    },
    {
      selector: 'node[kind="task"]',
      style: {
        'shape': 'round-rectangle', 'width': 112, 'height': 34,
        'text-valign': 'center', 'text-margin-y': 0, 'font-size': 10,
        'text-max-width': 100, 'color': '#dbe4ef',
      },
    },
    {
      selector: 'node[kind="service"]',
      style: { 'shape': 'diamond', 'width': 54, 'height': 54 },
    },
    {
      selector: 'node[kind="asset"]',
      style: { 'shape': 'round-rectangle', 'width': 54, 'height': 54 },
    },
    {
      selector: 'node[kind="asset"][symbol != ""]',
      style: {
        'background-image': 'data(symbol)',
        'background-fit': 'contain',
        'background-opacity': 0.5,
        'background-width': '78%',
        'background-height': '78%',
        'background-image-opacity': 1,
      },
    },
    {
      // an unverified symbol code must not look like a checked one
      selector: 'node[kind="asset"][?symbol][!symbolVerified]',
      style: { 'border-style': 'dashed' },
    },
    { selector: 'node.dim', style: { 'opacity': 0.32 } },
    // the first endpoint picked with the link tool, so it is obvious what the
    // next click will connect to
    { selector: 'node.link-src', style: { 'border-color': '#35e0ff', 'border-width': 3 } },
    { selector: 'node:selected', style: { 'border-color': '#4da3ff', 'border-width': 3 } },

    {
      selector: 'edge',
      style: {
        'width': 1.2,
        'line-color': '#2b3646',
        'line-opacity': 0.85,
        'target-arrow-color': '#2b3646',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.7,
        'curve-style': 'bezier',
        'control-point-step-size': 42,
        'font-size': 8.5,
        'color': '#5f6d80',
      },
    },
    { selector: 'edge[kind="part_of"]', style: { 'line-style': 'dotted', 'target-arrow-shape': 'none' } },
    {
      selector: 'edge[kind="performed_at"]',
      style: { 'line-style': 'dashed', 'line-color': '#4a5f7a', 'target-arrow-color': '#4a5f7a', 'arrow-scale': 0.7 },
    },
    { selector: 'edge[kind="hosted_on"]', style: { 'line-style': 'dashed' } },
    { selector: 'edge[kind="depends_on"]', style: { 'line-color': '#3b4a5c', 'label': 'data(label)' } },
    {
      selector: 'edge.transport',
      style: {
        'curve-style': 'straight',
        'target-arrow-shape': 'none',
        'line-color': '#2fd18b',
        'line-style': 'dashed',
        'line-dash-pattern': [7, 6],
        'width': 2,
        'label': 'data(label)',
        'text-rotation': 'autorotate',
        'text-background-color': '#0e1116',
        'text-background-opacity': 0.8,
        'text-background-padding': 2,
      },
    },
    // a cut reads as broken, not as busy: short stubs with a wide gap, and no
    // flow animation. Traffic that is not moving must not look like traffic.
    { selector: 'edge.cut', style: { 'line-dash-pattern': [2, 10], 'width': 3, 'line-opacity': 0.95 } },
    { selector: '.hidden', style: { 'display': 'none' } },
  ]
}

export const LAYOUTS = {
  dependency: {
    name: 'dagre',
    rankDir: 'TB',
    nodeSep: 38,
    rankSep: 86,
    animate: false,
    fit: true,
    padding: 30,
  },
  transport: {
    name: 'cose',
    animate: false,
    fit: true,
    padding: 40,
    nodeRepulsion: 12000,
    idealEdgeLength: 90,
  },
}
