import { useCallback, useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { buildElements, stylesheet, bindTaps, LAYOUTS, CAUSE_COLOR, degColor } from '../graph.js'
import { deviceIconDataUri } from '../icons.js'
import { num, linkageOf, attackHops } from '../derive.js'
import { techniqueKo } from '../labels.js'

cytoscape.use(dagre)

// The four dependency layers, top to bottom. Their on-screen extents are NOT
// fixed percentages: they are measured from where the nodes actually are and
// recomputed on every pan, zoom and layout.
//
// The first version used fixed bands. They sat still while the graph panned
// out from under them, so after any pan the label "임무" was pointing at
// whatever happened to be in the top fifth of the screen. A band that can be
// wrong about its own contents is worse than no band.
const LAYERS = [
  ['mission', '임무'],
  ['task', '작업'],
  ['service', '서비스'],
  ['asset', '자산'],
]

const LEGEND = [
  ['공격', 'attack'], ['기동', 'mobility'], ['지형', 'terrain'],
  ['정비', 'maintenance'], ['미상', 'unknown'], ['정상', 'ok'],
]

// One picture per node: the device icon. State rides on colour, not on extra
// glyphs, so a node never has to be decoded.
function paintSymbol(n, state) {
  const d = n.data()
  const color = state === 'attack' ? '#ffb4ba' : state === 'outage' ? '#93a6ba' : '#e6f0fb'
  const dev = deviceIconDataUri(d.assetType, { size: 44, color })
  if (!dev) return
  n.style({
    'background-image': dev,
    'background-fit': 'contain',
    'background-width': '64%',
    'background-height': '64%',
    'background-position-x': '50%',
    'background-position-y': '50%',
    'background-image-opacity': 1,
  })
}

export default function GraphCanvas({ graph, step, steps, idx, view, labels, hidden, cyRef, onSelect, onTap, selected, overlay, contrib, ghosts, onGhostConnect }) {
  const boxRef = useRef(null)
  const flowRef = useRef({ raf: null, offset: 0, view, hidden })
  const [bands, setBands] = useState([])
  // U9: the ghost lines, in RENDERED pixels. Measured from where the nodes
  // actually are and recomputed on every pan, zoom, layout and node drag -
  // the same rule the layer bands follow, for the same reason.
  const [ghostLines, setGhostLines] = useState([])
  const [hopCount, setHopCount] = useState(0)
  // Effects run in declaration order, so this one fires before the instance
  // below exists. cyReady is the signal that it now does.
  const [cyReady, setCyReady] = useState(0)
  // The cy instance is rebuilt only when `graph` changes, and its tap
  // handlers are registered with it. Adding the callbacks to that effect's
  // dependencies would rebuild cytoscape on every mode switch and lose the
  // layout and the viewport, so the handlers read the current callbacks out
  // of refs instead - same fix as MapPane's moveRef/selectRef. Without this,
  // the first tap after entering edit mode still ran the observe-mode
  // `onTap` and did nothing.
  const tapRef = useRef(onTap)
  tapRef.current = onTap
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  // U9 connects through editor.addLinkWith, the same call the inspector's
  // 연결 button makes. Read through a ref because the handler is attached to
  // the SVG the same way the taps are attached to cy: once, with props that
  // change under it.
  const ghostRef = useRef(onGhostConnect)
  ghostRef.current = onGhostConnect

  flowRef.current.view = view
  flowRef.current.hidden = hidden

  // Measure where each layer currently sits on screen. Boundaries are placed
  // midway between the bottom of one layer and the top of the next, so the
  // bands tile the canvas without overlapping whatever the layout produced.
  const measureBands = useCallback(() => {
    const cy = cyRef.current
    const box = boxRef.current
    if (!cy || !box || view !== 'dependency') { setBands([]); return }
    const H = box.clientHeight || 0

    // Cluster the nodes by the row the layout actually put them in, then name
    // each row after what is in it. Grouping by KIND instead was wrong: dagre
    // ranks by dependency depth, so an asset that hosts a task sits directly
    // under the tasks while an asset under a service sits far below. The real
    // order in tacnet-01 is 임무 → 작업 → 자산 → 서비스 → 자산, and a band
    // labelled from a presumed ordering pointed at the wrong nodes.
    const rows = []
    for (const n of cy.nodes().not('.hidden')) {
      const bb = n.renderedBoundingBox({ includeLabels: false })
      rows.push({ kind: n.data('kind'), y1: bb.y1, y2: bb.y2, mid: (bb.y1 + bb.y2) / 2 })
    }
    if (!rows.length) { setBands([]); return }
    rows.sort((a, b) => a.mid - b.mid)

    const gap = 26 * (cy.zoom() || 1)
    const clusters = []
    for (const r of rows) {
      const last = clusters[clusters.length - 1]
      if (last && r.y1 - last.y2 < gap) {
        last.y1 = Math.min(last.y1, r.y1)
        last.y2 = Math.max(last.y2, r.y2)
        last.kinds.add(r.kind)
      } else {
        clusters.push({ y1: r.y1, y2: r.y2, kinds: new Set([r.kind]) })
      }
    }

    // Label a row only for the kinds appearing there for the FIRST time going
    // down. Assets show up in three separate rows, and writing "자산" three
    // times is noise, not orientation. Rows that introduce nothing new keep
    // their stripe and stay unlabelled.
    const seen = new Set()
    const out = clusters.map((c, i) => {
      const top = i === 0 ? 0 : (clusters[i - 1].y2 + c.y1) / 2
      const bottom = i === clusters.length - 1 ? H : (c.y2 + clusters[i + 1].y1) / 2
      const fresh = LAYERS.filter(([k]) => c.kinds.has(k) && !seen.has(k))
      for (const [k] of fresh) seen.add(k)
      return {
        key: `band-${i}`,
        name: fresh.map(([, n]) => n).join('·'),
        top,
        height: Math.max(0, bottom - top),
        // keep the label on screen even when its band has been panned off it
        labelTop: Math.min(Math.max(top + 8, 6), Math.max(6, H - 22)),
      }
    })
    setBands(out)
  }, [view, cyRef])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.on('pan zoom resize layoutstop', measureBands)
    measureBands()
    return () => cy.off('pan zoom resize layoutstop', measureBands)
  }, [measureBands, graph, view, step, hidden, cyReady])

  // --- build ------------------------------------------------------------
  useEffect(() => {
    if (!graph || !boxRef.current) return
    const cy = cytoscape({
      container: boxRef.current,
      elements: buildElements(graph),
      style: stylesheet(),
      wheelSensitivity: 0.2,
    })
    cyRef.current = cy
    bindTaps(cy, tapRef, selectRef)
    if (import.meta.env && import.meta.env.DEV) window.__cy = cy
    setCyReady((v) => v + 1)
    return () => { cy.destroy(); cyRef.current = null }
  }, [graph])

  // --- view visibility and layout ---------------------------------------
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || view === 'geo') return
    const transport = cy.edges('.transport')
    // attack hops go between assets and belong in both views
    const structural = cy.edges().not('.transport').not('.attack-hop').not('.threat-hop')
    const nonAssets = cy.nodes('[kind != "asset"]')
    if (view === 'transport') {
      transport.removeClass('hidden')
      structural.addClass('hidden')
      nonAssets.addClass('hidden')
    } else {
      transport.addClass('hidden')
      structural.removeClass('hidden')
      nonAssets.removeClass('hidden')
    }
    // attack hops are drawn over the layout, never fed to it: an extra
    // asset-to-asset edge would change what dagre thinks the ranks are
    cy.elements().not('.hidden').not('.attack-hop').not('.threat-hop').layout(LAYOUTS[view] || LAYOUTS.dependency).run()
  }, [view, graph])

  // --- attack path --------------------------------------------------------
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.edges('.attack-hop').remove()
    // during a game the scripted chain is not the game's state (v2 starts
    // from one chosen foothold), so the authored arrows would contradict it
    const { hops } = overlay ? { hops: [] } : attackHops(steps || [], idx || 0)
    const els = []
    for (const h of hops) {
      if (!cy.$id(h.from).length || !cy.$id(h.to).length) continue
      const ko = techniqueKo(h.technique)
      els.push({
        group: 'edges',
        classes: 'attack-hop',
        data: {
          id: `hop:${h.from}->${h.to}`, source: h.from, target: h.to,
          label: `${ko || h.technique || ''} +${h.t}분`,
        },
      })
    }
    if (els.length) cy.add(els)
    setHopCount(els.length)
  }, [steps, idx, graph, cyReady, overlay])

  // --- contribution path ---------------------------------------------------
  // Structural edges point downward (mission -> task -> service -> asset), so
  // predecessors are what the selected node holds up and successors are what
  // it stands on. Transport links are left out: they are a different picture.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass('faded path')
    if (!selected || view === 'transport') return
    const n = cy.$id(selected)
    if (!n.length) return
    const structural = cy.edges().not('.transport').not('.attack-hop').not('.threat-hop')
    const up = n.predecessors().filter((e) => e.isNode() || structural.contains(e))
    const down = n.successors().filter((e) => e.isNode() || structural.contains(e))
    const keep = n.union(up).union(down)
    cy.elements().not(keep).not('.attack-hop').not('.threat-hop').addClass('faded')
    keep.edges().addClass('path')
  }, [selected, view, graph, cyReady])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().style('text-opacity', labels ? 1 : 0)
  }, [labels, graph])

  // --- contribution weight (U3) --------------------------------------------
  //
  // A toggle, off by default. `contrib` is derive.contribLayer's output:
  // attribution()'s per-asset %p, each divided by the LARGEST contribution in
  // the same set. Not by the mission total - contributions can exceed it (see
  // the note in derive.js and the stylesheet rule in graph.js), so the
  // thickness is a comparison between assets and the legend says so.
  //
  // Two things get the weight: the asset node's outline, and the structural
  // edges between that asset and the mission. The node carries it too because
  // an asset that contributes only through reachability (a relay) has no
  // structural edge to the mission at all, and edges alone would draw the
  // most interesting contributor as nothing.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass('contrib')
    if (!contrib || view === 'geo') return
    const structural = cy.edges().not('.transport').not('.attack-hop').not('.threat-hop')
    const mission = cy.$id(contrib.mission)
    // influence runs opposite to the drawn direction (mission -> task ->
    // service -> asset), so the edges an asset's loss travels along are its
    // predecessors, cut down to those the mission can also reach
    const reach = mission.length ? mission.successors().edges() : null
    const widths = new Map()
    cy.batch(() => {
      for (const r of contrib.rows) {
        const n = cy.$id(r.id)
        if (!n.length) continue
        n.data('contribW', r.w)
        n.addClass('contrib')
        let up = n.predecessors().edges().intersection(structural)
        if (reach) up = up.intersection(reach)
        // an edge on two assets' paths takes the heavier weight: the line is
        // one line, and the lighter claim is already made by the other node
        for (const e of up) widths.set(e.id(), Math.max(widths.get(e.id()) || 0, r.w))
      }
      for (const [id, w] of widths) {
        const e = cy.$id(id)
        if (!e.length) continue
        e.data('contribW', w)
        e.addClass('contrib')
      }
    })
  }, [contrib, view, graph, step, cyReady])

  // --- link candidates as ghost lines (U9) ---------------------------------
  //
  // Drawn as an SVG layer over the canvas rather than as cytoscape edges, for
  // three reasons: a candidate is not a dependency and must not enter the
  // dagre layout or the selected node's path traversal; the line needs a wide
  // invisible hit stroke so a thumb can reach it at 390px; and dashed versus
  // dotted belongs in style.css, where the rest of the chrome lives.
  //
  // Each line is trimmed to stop clear of both node boxes, so the hit stroke
  // never sits on top of a node and steal its tap, and the far end carries a
  // handle - that is the "far endpoint" the line can be connected by, without
  // overloading what a click on the candidate NODE means (it still selects).
  const measureGhosts = useCallback(() => {
    const cy = cyRef.current
    if (!cy || !ghosts || view === 'geo') { setGhostLines([]); return }
    const a = cy.$id(ghosts.from)
    if (!a.length || a.hasClass('hidden')) { setGhostLines([]); return }
    const pa = a.renderedPosition()
    const ba = a.renderedBoundingBox({ includeLabels: false })
    const radA = Math.max(ba.w, ba.h) / 2
    const out = []
    const push = (kind, c) => {
      const b = cy.$id(c.to)
      if (!b.length || b.hasClass('hidden')) return
      const pb = b.renderedPosition()
      const bb = b.renderedBoundingBox({ includeLabels: false })
      const radB = Math.max(bb.w, bb.h) / 2
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const len = Math.hypot(dx, dy)
      // two boxes almost touching leave no stub worth drawing, and a 4 px line
      // under two node borders is noise rather than information
      if (!(len > radA + radB + 24)) return
      const ux = dx / len
      const uy = dy / len
      out.push({
        kind, to: c.to, bearer: c.bearer, why: c.why || '', w: c.w || 2,
        x1: pa.x + ux * (radA + 4), y1: pa.y + uy * (radA + 4),
        x2: pa.x + ux * (len - radB - 10), y2: pa.y + uy * (len - radB - 10),
      })
    }
    for (const c of ghosts.cands) push('cand', c)
    for (const c of ghosts.offRule) push('off', c)
    setGhostLines(out)
  }, [ghosts, view, cyRef])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.on('pan zoom resize layoutstop position', measureGhosts)
    measureGhosts()
    return () => cy.off('pan zoom resize layoutstop position', measureGhosts)
  }, [measureGhosts, graph, view, hidden, cyReady])


  // --- wargame overlay -----------------------------------------------------
  // Ghost arrows are the attacker's candidate moves (the engine's legal move
  // table, top n by gain). They are drawn over the layout and never fed to
  // it, and they do not crawl: a move that has not happened is not traffic.
  // The flash marks one adjudication, once per turn.
  const flashRef = useRef({ turn: -1, timer: null })
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.edges('.threat-hop').remove()
    cy.nodes().removeClass('threat isolated')
    // No game, or a game with nothing adjudicated yet (a restart goes straight
    // from the old game's overlay to the new one's): forget the last flashed
    // turn so the next adjudication flashes even on the same turn index.
    if (!overlay || !overlay.last) flashRef.current.turn = -1
    if (!overlay) return
    const els = []
    for (const c of overlay.candidates) {
      if (!cy.$id(c.from).length || !cy.$id(c.to).length) continue
      els.push({ group: 'edges', classes: 'threat-hop', data: { id: `threat:${c.from}->${c.to}`, source: c.from, target: c.to, w: Math.max(1.5, 4 - c.rank * 0.4) } })
    }
    if (els.length) cy.add(els)
    for (const n of overlay.nodeThreats) cy.$id(n.id).addClass('threat')
    for (const id of overlay.isolated) cy.$id(id).addClass('isolated')
    // one flash per adjudicated turn
    if (overlay.last && overlay.last.turn !== flashRef.current.turn) {
      flashRef.current.turn = overlay.last.turn
      const n = cy.$id(overlay.last.to)
      const cls = overlay.last.success ? 'flash-hit' : 'flash-miss'
      // a second adjudication inside 800 ms: the first target's class must go
      // too, or its underlay stays on for good once its timer is cancelled
      clearTimeout(flashRef.current.timer)
      cy.nodes().removeClass('flash-hit flash-miss')
      n.addClass(cls)
      flashRef.current.timer = setTimeout(() => n.removeClass(cls), 800)
    }
  }, [overlay, graph, cyReady])
  useEffect(() => () => clearTimeout(flashRef.current.timer), [])

  // --- paint ------------------------------------------------------------
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !step || !graph) return
    const assetOut = step.asset_outage || {}
    const linkOut = step.link_outage || {}
    const activePhases = new Set(step.active_phases || [])
    const temporal = !!graph.timeline

    cy.batch(() => {
      for (const n of cy.nodes()) {
        const d = n.data()
        let v = 0
        if (d.kind === 'asset') v = num(step.asset?.[d.id])
        else if (d.kind === 'service') v = num(step.service?.[d.id])
        else if (d.kind === 'task') v = num(step.task?.[d.id])
        else if (d.kind === 'mission') v = num(step.mission?.[d.id])

        const cause = d.kind === 'asset' ? assetOut[d.id] : null
        // isolation (wargame) is the defender's own mark. The engine counts an
        // isolated asset as down (game.js compromiseOf), which would paint it
        // as attacked; it is not, so the mark is achromatic and wins over
        // the red here (ADR-0012: red means adversary effect and nothing else).
        const isIso = !!(overlay && overlay.isolated.includes(d.id))
        const hit = d.kind === 'asset' && !isIso && num(step.compromise?.[d.id]) > 0

        if (d.kind === 'asset' && d.assetType) {
          paintSymbol(n, hit ? 'attack' : cause || isIso ? 'outage' : 'ok')
        }

        // degradation is a luminance ramp, cause is the border: red stays
        // exclusive to attack (ADR-0012, ADR-0024). Selection is a bypass
        // too (n.style() below), so it has to win here explicitly - the
        // node:selected stylesheet rule alone never shows through a bypass.
        const isSel = n.id() === selected
        n.style('background-color', degColor(v))
        n.style('border-color', isSel ? '#f2f3f4' : isIso ? '#f2f3f4' : (cause ? (CAUSE_COLOR[cause] || '#2a3442') : (hit ? CAUSE_COLOR.attack : '#2a3442')))
        n.style('border-width', isSel ? 3 : isIso ? 4 : (cause || hit ? 2.5 : 1.5))
        n.style('border-style', isIso ? 'double' : (cause ? 'dashed' : 'solid'))
        n.toggleClass('hit', hit)
        n.toggleClass('out', !!cause && !hit)
        n.data('outColor', cause ? (CAUSE_COLOR[cause] || CAUSE_COLOR.unknown) : '#000')

        const inactive = temporal && d.kind === 'task' && d.phase && !activePhases.has(d.phase)
        n.toggleClass('dim', inactive)
        if (d.kind === 'asset') n.toggleClass('orphan', !linkageOf(graph, d.id).linked)
      }
      for (const e of cy.edges('.transport')) {
        const cause = linkOut[e.id()]
        e.toggleClass('cut', !!cause)
        e.style('line-color', cause ? (CAUSE_COLOR[cause] || '#8a8f98') : '#2fd18b')
        e.style('label', cause ? `${e.data('bearer')} · ${cause}` : e.data('bearer'))
      }
    })
  }, [step, graph, selected, overlay])

  // Dashes crawling along a link mean traffic is moving on it. A cut link
  // stops moving, so the eye finds the break before it finds the label.
  useEffect(() => {
    const tick = () => {
      flowRef.current.raf = requestAnimationFrame(tick)
      const cy = cyRef.current
      if (!cy || flowRef.current.hidden) return
      flowRef.current.offset = (flowRef.current.offset - 0.6) % 26
      if (flowRef.current.view === 'transport') {
        const live = cy.edges('.transport').not('.cut').not('.hidden')
        if (live.length) live.style('line-dash-offset', flowRef.current.offset)
      }
      const hops = cy.edges('.attack-hop')
      if (hops.length) hops.style('line-dash-offset', flowRef.current.offset)
    }
    flowRef.current.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(flowRef.current.raf)
  }, [])

  const drawnCands = ghostLines.filter((l) => l.kind === 'cand').length
  const drawnOffRule = ghostLines.filter((l) => l.kind === 'off').length

  return (
    <>
      <div id="cy" ref={boxRef} hidden={hidden} />
      {!hidden && view === 'dependency' && bands.length > 0 && (
        <div className="bands" aria-hidden="true">
          {bands.map((b, i) => (
            <div key={b.key} className={`band${i % 2 ? " alt" : ""}`} style={{ top: `${b.top}px`, height: `${b.height}px` }} />
          ))}
          {bands.map((b) => (
            b.name ? <span key={`l-${b.key}`} className="band-label" style={{ top: `${b.labelTop}px` }}>{b.name}</span> : null
          ))}
        </div>
      )}
      {/* U9. aria-hidden on purpose: this is a redundant graphical affordance -
          the same link is made from the inspector's 연결 button, which is a
          real button in the tab order. The overlay adds a place on screen, not
          a second way in. */}
      {!hidden && ghostLines.length > 0 && (
        <svg className="ghosts" aria-hidden="true">
          {ghostLines.map((l) => (
            <g key={`${l.kind}:${l.to}`} className={`ghost ghost-${l.kind}`}>
              <line className="ghost-line" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeWidth={l.w} />
              {l.kind === 'cand' && (
                <>
                  <line
                    className="ghost-hit" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                    onClick={() => ghostRef.current && ghostRef.current(ghosts.from, l.to, l.bearer)}
                  />
                  <circle
                    className="ghost-end" cx={l.x2} cy={l.y2} r={7}
                    onClick={() => ghostRef.current && ghostRef.current(ghosts.from, l.to, l.bearer)}
                  />
                </>
              )}
            </g>
          ))}
        </svg>
      )}
      {!hidden && (
        <div className="legend-bar">
          <b>테두리 = 원인</b>
          <span className="lg-rule" />
          {LEGEND.map(([label, key]) => (
            <span className="legend-item" key={key}>
              <span className="legend-sw" style={{ color: CAUSE_COLOR[key] || 'var(--ok)' }} />
              {label}
            </span>
          ))}
          {hopCount > 0 && (
            <>
              <span className="lg-rule" />
              <span className="legend-item legend-hop" title="저작된 침해 순서를 화살표로 그린 것. 엔진이 추론한 경로가 아니다.">
                <span className="legend-arrow" />공격 경로 {hopCount}구간 · 저작 순서
              </span>
            </>
          )}
          {overlay && overlay.candidates.length + overlay.nodeThreats.length > 0 && (
            <>
              <span className="lg-rule" />
              <span className="legend-item legend-threat" title="엔진의 합법수 표에서 이득 상위 n개. 공격자가 실제로 고른 수가 아니다.">
                <span className="legend-arrow ghost" />유령 화살표 = 공격자 후보수 상위 {overlay.candidates.length + overlay.nodeThreats.length}
              </span>
            </>
          )}
          {overlay && overlay.isolated.length > 0 && (
            <>
              <span className="lg-rule" />
              <span className="legend-item">이중선 = 격리</span>
            </>
          )}
          {selected && view !== 'transport' && (
            <>
              <span className="lg-rule" />
              <span className="legend-item">선택 노드의 기여 경로만 밝게</span>
            </>
          )}
          {contrib && view !== 'geo' && (
            <>
              <span className="lg-rule" />
              <span
                className="legend-item legend-contrib"
                title="attribution() 의 자산별 기여(%p)를 그 집합의 최대 기여로 나눈 값이다. 임무 저하도로 나눈 몫이 아니다 - 중복 그룹에서는 자산별 기여의 합이 저하도를 넘을 수 있다."
              >
                <span className="legend-thick" />
                선 굵기 = {contrib.missionName} 저하 기여 · 자산 간 비교이고 저하도의 몫이 아니다
                {contrib.dropped > 0 ? ` · 음수 기여 ${contrib.dropped}개는 굵기로 못 그린다` : ''}
              </span>
            </>
          )}
          {/* The numerator is what measureGhosts actually put on screen, not
              what linkGhosts offered: a candidate whose ends are too close
              together, or whose far end is hidden in this view, is dropped
              there. A caption that counts the offer would claim more lines
              than the picture contains. `total` after the slash is the
              unclipped candidate count, so the gap is stated rather than
              hidden. */}
          {ghosts && drawnCands > 0 && (
            <>
              <span className="lg-rule" />
              <span className="legend-item legend-ghost" title="규칙표(data/link-rules.json)가 고른 후보다. 선이나 끝의 점을 누르면 인스펙터의 연결 버튼과 같은 경로로 이어진다. 앞 숫자는 지금 화면에 그린 선의 수다.">
                <span className="legend-dash" />유령 선 = 연결 가능 후보 {drawnCands}
                {ghosts.total > drawnCands ? `/${ghosts.total}` : ''}
              </span>
            </>
          )}
          {ghosts && drawnOffRule > 0 && (
            <>
              <span className="lg-rule" />
              <span className="legend-item legend-ghost" title="지금 걸려 있지만 규칙표에 맞지 않는 링크다. 끊지 않는다 - 표시만 한다.">
                <span className="legend-dot" />점선 = 규칙 밖 링크 {drawnOffRule}
                {ghosts.offRule.length > drawnOffRule ? `/${ghosts.offRule.length}` : ''}
              </span>
            </>
          )}
        </div>
      )}
    </>
  )
}
