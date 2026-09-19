// Mission dependency graph -> Cytoscape elements.
//
// The coordinate system is the dependency topology, not geography (ADR-0001).
// Node position comes from the graph; the 2525 symbol is only the picture
// drawn on the node (ADR-0013 section 3).

import { symbolDataUri, isVerified, unitSymbolDataUri } from './symbols.js'
import { serviceIconDataUri } from './icons.js'
import { assetName } from './labels.js'

// Node shape used to carry the device class. It does not need to any more: the
// device icon says what the machine is, and a canvas of triangles, hexagons and
// barrels next to icons was two competing systems for one message. Every asset
// is a rounded box now, and the icon inside it does the identifying.

// Cause colours. These are the only saturated colours on the screen
// (ADR-0024); they match docs/design/tokens.md one for one.
export const CAUSE_COLOR = {
  attack: '#ff4d5e',
  mobility: '#35c8ff',
  terrain: '#a7c261',
  maintenance: '#7f8794',
  unknown: '#ffb020',
  env: '#7d93ab',
  inter: '#c07dff',
  ok: '#2fd18b',
}

// degradation -> colour. ACHROMATIC BY RULE (ADR-0024): brighter is worse and
// there is no hue at all.
//
// The previous ramp went green -> amber -> slate-red, and its top step
// (#8f2f39) was a red. That put a second meaning on the one colour reserved
// for adversary effect, so a badly degraded node and an attacked node looked
// alike. Hue belongs to the border, which carries the cause.
export function degColor(v) {
  const d = Math.max(0, Math.min(1, Number(v) || 0))
  const l = (0.19 + d * 0.36) * 255
  return `rgb(${Math.round(l)}, ${Math.round(l * 1.02)}, ${Math.round(l * 1.09)})`
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
        serviceKind: s.kind || '',
        redundancy: s.redundancy_group || '',
        icon: serviceIconDataUri(s.kind, { size: 34 }) || '',
      },
    })
  }
  const echelonOf = {}
  const unitNameOf = {}
  for (const u of g.units || []) {
    echelonOf[u.id] = u.echelon
    unitNameOf[u.id] = u.name || u.id
  }
  for (const a of g.assets || []) {
    const uri = symbolDataUri(a.type, { size: 44 })
    const unitUri = a.unit ? unitSymbolDataUri(echelonOf[a.unit], { size: 20 }) : null
    const name = assetName(g, a.id)
    els.push({
      data: {
        // meaning first, id second: "CO2-VEH" alone told the operator nothing
        id: a.id, kind: 'asset', label: name.twoLine, assetType: a.type,
        assetTypeKo: name.typeKo, siteName: name.site, unitName: unitNameOf[a.unit] || '',
        unit: a.unit || '', unitEchelon: echelonOf[a.unit] || '',
        site: a.site || '', mobility: a.mobility || 'static',
        transit: a.transit === false ? false : true,
        symbol: uri || '', unitSymbol: unitUri || '',
        symbolVerified: uri ? isVerified(a.type) : false,
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
        'color': '#c2c6cb',
        'font-family': '"IBM Plex Sans KR", Pretendard, "Segoe UI", "Malgun Gothic", sans-serif',
        'font-size': 10,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'text-wrap': 'wrap',
        'text-max-width': 132,
        'line-height': 1.25,
        'text-outline-color': '#1e2125',
        'text-outline-width': 2.5,
        'text-outline-opacity': 0.85,
        'border-width': 1.5,
        'border-color': '#4a515a',
        'background-color': '#31353b',
        'transition-property': 'background-color, border-color, border-width',
        'transition-duration': '180ms',
      },
    },
    {
      selector: 'node[kind="mission"]',
      style: {
        'shape': 'round-rectangle',
        'width': 148, 'height': 50,
        'font-size': 13, 'font-weight': 'bold',
        'color': '#f2f3f4',
        'text-valign': 'center',
        'text-margin-y': 0,
        'background-color': '#353a41',
        'border-color': '#4a515a',
        'border-width': 1.5,
      },
    },
    {
      selector: 'node[kind="task"]',
      style: {
        'shape': 'round-rectangle', 'width': 120, 'height': 36,
        'text-valign': 'center', 'text-margin-y': 0, 'font-size': 10,
        'text-max-width': 100, 'color': '#c2c6cb',
      },
    },
    {
      selector: 'node[kind="service"]',
      style: { 'shape': 'round-diamond', 'width': 68, 'height': 68 },
    },
    {
      // Each service kind gets its own icon. C2 messaging, voice and fire
      // control are not interchangeable, and five identical diamonds said they
      // were.
      selector: 'node[kind="service"][icon != ""]',
      style: {
        'background-image': 'data(icon)',
        'background-fit': 'contain',
        'background-width': '48%',
        'background-height': '48%',
        'background-image-opacity': 1,
        'background-opacity': 0.42,
      },
    },
    {
      selector: 'node[kind="asset"]',
      style: { 'shape': 'round-rectangle', 'width': 68, 'height': 68 },
    },
    {
      // The device icon is painted per element (paintSymbol in main.js) so its
      // colour can follow the state. The node fill stays low so the icon reads
      // on top of it.
      selector: 'node[kind="asset"]',
      style: { 'background-opacity': 0.34 },
    },
    { selector: 'node.dim', style: { 'opacity': 0.32 } },
    // not attached to the mission layer: present, but nothing depends on it
    {
      selector: 'node.orphan',
      style: { 'border-style': 'dotted', 'border-color': '#4a5568', 'opacity': 0.75 },
    },
    // the first endpoint picked with the link tool, so it is obvious what the
    // next click will connect to
    { selector: 'node.link-src', style: { 'border-color': '#f2f3f4', 'border-width': 3 } },
    { selector: 'node:selected', style: { 'border-color': '#f2f3f4', 'border-width': 3 } },
    // glow lives under the node and takes the cause colour, so a lit node is
    // read the same way as its border (ADR-0012: red only for attack)
    { selector: 'node.hit', style: { 'underlay-color': CAUSE_COLOR.attack, 'underlay-opacity': 0.28, 'underlay-padding': 12, 'underlay-shape': 'ellipse' } },
    { selector: 'node.out', style: { 'underlay-color': 'data(outColor)', 'underlay-opacity': 0.16, 'underlay-padding': 10, 'underlay-shape': 'ellipse' } },

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
    // the campaign as a route: red is attack's colour and nothing else's
    // (ADR-0012), so a red arrow between two assets can only mean one thing
    {
      selector: 'edge.attack-hop',
      style: {
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [-40],
        'control-point-weights': [0.5],
        'line-color': CAUSE_COLOR.attack,
        'target-arrow-color': CAUSE_COLOR.attack,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1.1,
        'width': 2.5,
        'line-style': 'dashed',
        'line-dash-pattern': [8, 6],
        'label': 'data(label)',
        'font-size': 9,
        'color': '#ffb4ba',
        'text-background-color': '#1c1e22',
        'text-background-opacity': 0.85,
        'text-background-padding': 2,
        'text-rotation': 'autorotate',
        'z-index': 9,
      },
    },
    // contribution path of the selected node: what it rests on and what
    // rests on it. Everything else steps back instead of disappearing, so
    // the path is read in its context.
    { selector: 'node.faded', style: { 'opacity': 0.16 } },
    { selector: 'edge.faded', style: { 'opacity': 0.08 } },
    { selector: 'edge.path', style: { 'width': 2, 'line-color': '#9aa5b1', 'target-arrow-color': '#9aa5b1', 'opacity': 1 } },
    { selector: '.hidden', style: { 'display': 'none' } },
  ]
}

export const LAYOUTS = {
  dependency: {
    name: 'dagre',
    rankDir: 'TB',
    nodeSep: 34,
    rankSep: 96,
    animate: false,
    fit: true,
    padding: 16,
  },
  transport: {
    name: 'cose',
    animate: false,
    fit: true,
    padding: 24,
    nodeRepulsion: 12000,
    idealEdgeLength: 90,
  },
}
