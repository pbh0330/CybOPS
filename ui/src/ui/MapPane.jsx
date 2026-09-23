import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { config } from '../config.js'
import { CAUSE_COLOR } from '../graph.js'
import { attackHops } from '../derive.js'
import { toLonLat, fromLonLat, toMgrs } from '../georef.js'
import { markerRows, linkFeatures, trackFeatures, attackArcFeatures, gridFeatures, aoFeature, stackAt } from '../mapLayers.js'
import { deviceIconDataUri } from '../icons.js'
import { assetName } from '../labels.js'

// The map view for a georeferenced scenario (ADR-0025). Secondary by
// construction (ADR-0001): it draws positions the engine never reads.
//
// One style load. The OpenFreeMap dark style is fetched once and the
// satellite raster, the DEM and every overlay are added on top of it, so
// switching base maps is a visibility toggle and never a setStyle that would
// throw the overlays away.

const BASES = [['dark', '다크'], ['satellite', '위성'], ['terrain', '지형']]
// A thumb is about this wide on a marker, and markers are drawn at 30px. Two
// assets inside this radius of each other on SCREEN are one tap target, so
// the tap has to report both and let the caller decide what that means.
const TAP_RADIUS_PX = 22
const EMPTY = { type: 'FeatureCollection', features: [] }

function firstSymbolLayer(style) {
  const l = (style.layers || []).find((x) => x.type === 'symbol')
  return l ? l.id : undefined
}

// No `glyphs` URL on the fallback style, so text (symbol) layers would throw.
// Everything else - lines, fills, DOM markers - draws fine without glyphs.
const FALLBACK_STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#070a10' } }] }

export default function MapPane({ graph, step, steps, idx, selected, onSelect, hidden, overlay, editable, onMove, compact }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const markers = useRef(new Map())
  const dashRef = useRef({ raf: null, i: 0 })
  // one flash per adjudicated wargame turn (same rule as GraphCanvas)
  const flashRef = useRef({ turn: -1, timer: null })
  // Which scenario the current map (if any) was built for, or null. Doubles
  // as the lazy-build guard (F1) and the rebuild-only-on-scenario-change
  // guard (F4): an edit produces a new `graph` object but the same
  // scenario_id, so it is not a reason to tear anything down.
  const builtRef = useRef(null)
  // Markers are created once and their handlers registered at creation, so
  // the dragend handler reads the latest onMove/georef through refs rather
  // than the closure it was born in (which would be the first render's).
  const moveRef = useRef(onMove)
  moveRef.current = onMove
  // The marker's `title` is a hover tooltip - a tap never opens it. The click
  // handler is registered once, at creation, so this has to be a ref like
  // moveRef/selectRef: read fresh at tap time, not the value the marker was
  // born with.
  const compactRef = useRef(compact)
  compactRef.current = compact
  // Same reason as moveRef: the marker click handler is registered once, at
  // creation, so it must not keep the onSelect it was born with - App's
  // onSelect now closes over `compact`, which changes on a rotate.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  // The marker rows of the last draw, so a tap can project every asset and
  // ask which of them share the pixel it landed on.
  const rowsRef = useRef([])
  const georefRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [base, setBase] = useState('satellite')
  const [is3d, setIs3d] = useState(true)
  const [tileError, setTileError] = useState(false)

  // Every asset a tap on `id` could have meant. The projection is done at tap
  // time, not at draw time: pan, zoom and pitch all move markers relative to
  // each other, so yesterday's pixels are the wrong answer. Always at least
  // [id] - the caller's contract is "what you tapped, plus whatever it hid".
  function stackForTap(id) {
    const map = mapRef.current
    if (!map) return [id]
    const pts = rowsRef.current.map((row) => {
      const p = map.project([row.lon, row.lat])
      return { id: row.id, x: p.x, y: p.y }
    })
    const s = stackAt(pts, id, TAP_RADIUS_PX)
    return s.length ? s : [id]
  }

  const georef = graph?.geo?.georef
  georefRef.current = georef
  const extent = graph?.geo?.frame?.extent
  const t = step && step.t !== undefined && step.t !== null ? Number(step.t) : 0

  // --- build --------------------------------------------------------------
  // Deliberately keyed on scenario identity, not on `graph` itself: keying on
  // `graph` meant every edit (commitEdit replaces the object) tore the whole
  // MapLibre instance down and rebuilt it from a fresh style+tile fetch,
  // throwing away camera, base layer and 3D state on every undo/redo/reset
  // (F4). `hidden` is a dependency purely so this effect gets a chance to run
  // the FIRST time the pane becomes visible - the dependency-view default
  // means the box is display:none (0x0) at mount, so building then bakes a
  // bogus camera into both the constructor `bounds` and the first fitBounds
  // (F1). It does not by itself trigger a teardown: hiding the pane again
  // just leaves the map exactly as it was, and the separate resize() effect
  // below repaints it correctly when shown again.
  useEffect(() => {
    if (hidden || !boxRef.current || !georef || !extent) return
    const scenarioId = graph?.scenario_id
    if (builtRef.current === scenarioId) return // same scenario: nothing to (re)build

    // A previous scenario's map is still mounted - tear it down before
    // building the new one. This is the only place a full teardown happens.
    if (mapRef.current) {
      cancelAnimationFrame(dashRef.current.raf)
      for (const m of markers.current.values()) m.remove()
      markers.current.clear()
      mapRef.current.remove()
      mapRef.current = null
      setReady(false)
    }

    let cancelled = false
    const cfg = config().map
    const [lon0, lat0] = toLonLat(georef, extent.x[0], extent.y[0])
    const [lon1, lat1] = toLonLat(georef, extent.x[1], extent.y[1])

    const buildOn = (styleSpec, usedFallback) => {
      // Not "if (builtRef.current === scenarioId) return" at the TOP of the
      // effect, before the style fetch: React 18 StrictMode (and any other
      // legitimate rapid re-run) cleans up and re-invokes this effect once
      // synchronously on mount, before the fetch below resolves. Marking
      // builtRef done early made the second invocation see "already built"
      // and skip its own fetch, while the first invocation's fetch then
      // landed on a `cancelled` closure - net result, no map ever got built.
      // Only claim the scenario once a map is actually about to be created.
      if (cancelled) return
      builtRef.current = scenarioId
      const map = new maplibregl.Map({
        container: boxRef.current,
        style: styleSpec,
        bounds: [[lon0, lat0], [lon1, lat1]],
        fitBoundsOptions: { padding: 40 },
        pitch: 55,
        maxPitch: 75,
        attributionControl: { compact: true, customAttribution: `${cfg.satellite_attribution} · ${cfg.dem_attribution}` },
      })
      mapRef.current = map
      if (import.meta.env && import.meta.env.DEV) window.__map = map
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
      // Only a failure to fetch the style/a source/a tile is "offline" in the
      // sense the banner means; glyph and sprite warnings are routine and
      // must not flip it.
      map.on('error', (e) => {
        const msg = String(e?.error?.message || '')
        if (/style|tile|source|Failed to fetch|NetworkError/i.test(msg)) setTileError(true)
      })
      // map.on('click') is suppressed after a drag; a DOM onClick on the box is
      // not, and would deselect on every pan
      map.on('click', () => selectRef.current(null))

      map.on('load', () => {
        const style = map.getStyle()
        const beforeLabels = firstSymbolLayer(style)
        map.addSource('sat', { type: 'raster', tiles: [cfg.satellite], tileSize: 256, maxzoom: 18 })
        map.addLayer({ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': 1 }, layout: { visibility: 'none' } }, beforeLabels)
        map.addSource('dem', { type: 'raster-dem', tiles: [cfg.dem], tileSize: 256, encoding: 'terrarium', maxzoom: 15 })
        map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
          paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#05070c', 'hillshade-highlight-color': '#b9c4d1' } }, beforeLabels)

        // overlays, bottom to top
        map.addSource('ao', { type: 'geojson', data: aoFeature(georef, extent) })
        map.addLayer({ id: 'ao', type: 'line', source: 'ao', paint: { 'line-color': '#f2f3f4', 'line-opacity': 0.55, 'line-width': 1.5, 'line-dasharray': [4, 3] } })
        const grid = gridFeatures(georef, extent, 2000)
        map.addSource('grid', { type: 'geojson', data: grid.lines })
        map.addLayer({ id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#f2f3f4', 'line-opacity': 0.14, 'line-width': 0.8 } })
        map.addSource('grid-labels', { type: 'geojson', data: grid.labels })
        if (!usedFallback) {
          map.addLayer({ id: 'grid-labels', type: 'symbol', source: 'grid-labels',
            layout: { 'text-field': ['get', 'text'], 'text-size': 10, 'text-font': ['Noto Sans Regular'], 'text-anchor': 'bottom-left', 'text-offset': [0.3, -0.2] },
            paint: { 'text-color': '#c2c6cb', 'text-opacity': 0.75, 'text-halo-color': '#070a10', 'text-halo-width': 1 } })
        }
        map.addSource('tracks', { type: 'geojson', data: EMPTY })
        map.addLayer({ id: 'tracks', type: 'line', source: 'tracks', paint: { 'line-color': '#c2c6cb', 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': [1, 2] } })
        map.addSource('links', { type: 'geojson', data: EMPTY })
        map.addLayer({ id: 'links', type: 'line', source: 'links', layout: { 'line-cap': 'round' },
          paint: {
            // dead (an end is isolated in the wargame) wins over cut: the
            // defender pulled the plug, so the link carries nothing and no cause
            'line-color': ['case', ['get', 'dead'], '#4a5568', ['case', ['get', 'cut'], ['match', ['get', 'cause'],
              'attack', CAUSE_COLOR.attack, 'mobility', CAUSE_COLOR.mobility, 'terrain', CAUSE_COLOR.terrain,
              'maintenance', CAUSE_COLOR.maintenance, 'unknown', CAUSE_COLOR.unknown, CAUSE_COLOR.unknown], '#9aa5b1']],
            'line-width': ['case', ['get', 'dead'], 1.6, ['case', ['get', 'cut'], 3, 1.6]],
            'line-opacity': ['case', ['get', 'dead'], 0.55, 0.9],
            'line-dasharray': ['case', ['get', 'dead'], ['literal', [1, 0]], ['case', ['get', 'cut'], ['literal', [1, 2.5]], ['literal', [1, 0]]]],
          } })
        // the attacker's candidate moves during a wargame: faint, dotted, red
        // (ADR-0012), under the real attack arc
        map.addSource('threat', { type: 'geojson', data: EMPTY })
        map.addLayer({ id: 'threat', type: 'line', source: 'threat', layout: { 'line-cap': 'round' },
          paint: { 'line-color': CAUSE_COLOR.attack, 'line-width': ['get', 'w'], 'line-opacity': 0.28, 'line-dasharray': [1, 2] } })
        map.addSource('attack', { type: 'geojson', data: EMPTY })
        map.addLayer({ id: 'attack', type: 'line', source: 'attack', layout: { 'line-cap': 'round' },
          paint: { 'line-color': CAUSE_COLOR.attack, 'line-width': 2.5, 'line-opacity': 0.95, 'line-dasharray': [0, 4, 3] } })
        if (!usedFallback) {
          map.addLayer({ id: 'attack-labels', type: 'symbol', source: 'attack',
            layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, -1] },
            paint: { 'text-color': '#ffb4ba', 'text-halo-color': '#070a10', 'text-halo-width': 1.2 } })
        }

        // The constructor's own `bounds` option fits the AO before the map has a
        // real size and before pitch is accounted for, so the initial 3D camera
        // can crop the AO's far edge (or, while hidden, be computed against a
        // 0x0 box entirely). Re-fit once the style (and its real size) is
        // actually settled - by the time `load` fires this effect has already
        // refused to run while `hidden`, so the box has real dimensions.
        map.fitBounds([[lon0, lat0], [lon1, lat1]], { padding: 40, pitch: 55, duration: 0 })
        setReady(true)
      })
    }

    // Fetch the style ourselves rather than handing MapLibre the URL: a
    // failed style fetch means `load` never fires and nothing - not even the
    // overlays the offline banner promises - ever gets drawn (F2). On
    // failure, fall back to a bare background so the AO/grid/tracks/links/
    // attack arc/markers still render on a flat dark canvas.
    fetch(cfg.style)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then((styleJson) => buildOn(styleJson, false))
      .catch(() => { setTileError(true); buildOn(FALLBACK_STYLE, true) })

    return () => { cancelled = true }
  }, [graph?.scenario_id, georef?.anchor?.lat, georef?.anchor?.lon, extent?.x?.[1], extent?.y?.[1], hidden])

  // Safety net for a real unmount (e.g. the scenario stops being
  // georeferenced): the effect above only tears the map down when a NEW
  // scenario needs building, which never happens if this component is simply
  // removed from the tree.
  useEffect(() => () => {
    clearTimeout(flashRef.current.timer)
    if (mapRef.current) {
      cancelAnimationFrame(dashRef.current.raf)
      for (const m of markers.current.values()) m.remove()
      markers.current.clear()
      mapRef.current.remove()
      mapRef.current = null
      builtRef.current = null
    }
  }, [])

  // --- base map / terrain ----------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setLayoutProperty('sat', 'visibility', base === 'satellite' ? 'visible' : 'none')
    map.setLayoutProperty('hillshade', 'visibility', base === 'terrain' ? 'visible' : 'none')
  }, [base, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setTerrain(is3d ? { source: 'dem', exaggeration: 1.5 } : null)
    map.easeTo({ pitch: is3d ? 55 : 0, duration: 500 })
  }, [is3d, ready])

  // the pane is display:none while another view is up; MapLibre has to be
  // told when its box got a size again
  useEffect(() => { if (!hidden && mapRef.current) mapRef.current.resize() }, [hidden])

  // --- overlays per step ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !graph || !step) return
    map.getSource('links').setData(linkFeatures(graph, step, t, georef, overlay ? overlay.isolated : []))
    map.getSource('tracks').setData(trackFeatures(graph, t, georef))
    // the authored chain is hidden while a game runs: v2 starts from one
    // chosen foothold, so the scripted arrows would contradict the game
    const { hops } = overlay ? { hops: [] } : attackHops(steps || [], idx || 0)
    map.getSource('attack').setData(attackArcFeatures(graph, hops, t, georef))
    if (overlay) {
      // attackArcFeatures drops hops whose ends are unplaced, so the rank has
      // to ride on the feature itself rather than be re-read by index
      const cands = overlay.candidates.map((c) => ({ from: c.from, to: c.to, t: overlay.turn, technique: null, rank: c.rank }))
      const ghosts = attackArcFeatures(graph, cands, t, georef)
      for (const f of ghosts.features) {
        const c = cands.find((x) => x.from === f.properties.from && x.to === f.properties.to)
        f.properties.w = Math.max(1.5, 4 - (c ? c.rank : 6) * 0.4)
        f.properties.label = ''
      }
      map.getSource('threat').setData(ghosts)
    } else {
      map.getSource('threat').setData(EMPTY)
    }
    const isolated = overlay ? overlay.isolated : []
    const threats = overlay ? new Set(overlay.nodeThreats.map((n) => n.id)) : new Set()

    const rows = markerRows(graph, step, t, georef)
    rowsRef.current = rows
    const seen = new Set()
    for (const r of rows) {
      seen.add(r.id)
      const asset = graph.assets.find((a) => a.id === r.id)
      // an isolated asset counts as down for the engine but is the defender's
      // mark, not the attacker's: it never gets the red (same rule as GraphCanvas)
      const iso = isolated.includes(r.id)
      const state = iso ? 'outage' : r.compromise > 0 ? 'attack' : r.outage ? `outage cause-${r.outage}` : 'ok'
      const color = iso ? '#93a6ba' : r.compromise > 0 ? '#ffb4ba' : r.outage ? '#93a6ba' : '#e6f0fb'
      const uri = deviceIconDataUri(asset?.type, { size: 30, color })
      let m = markers.current.get(r.id)
      if (!m) {
        const el = document.createElement('div')
        el.className = 'map-mark'
        el.innerHTML = `<div class="map-mark-sym"><img alt="" /></div><div class="map-mark-label"></div>`
        // a drag ends with a click on the same element; that click must not
        // reselect (or, in link mode, wire) what was only being moved.
        //
        // The flag is cleared when the NEXT contact starts, not on a timer.
        // It used to be cleared from a setTimeout(0) in `dragend`, which
        // holds for a mouse - there the trailing click follows mouseup in the
        // same task - but not for a finger: the browser synthesises the click
        // a task (historically up to 300 ms) after touchend, by which time
        // the 0 ms timer had long since run and every touch drag ended by
        // selecting what it had just moved. Measured at 390px: drag RELAY-1
        // with pointerType touch while CO1-VEH is selected and the selection
        // jumped to RELAY-1.
        //
        // `pointerdown` is the one event that means "a new contact started"
        // for mouse, pen and finger alike; the compatibility mousedown the
        // browser fires after a touch does NOT produce one, which is exactly
        // why the reset cannot live on mousedown. touchstart is the fallback
        // for a browser without pointer events, and is equally never a
        // compatibility event.
        let dragged = false
        const armTap = () => { dragged = false }
        el.addEventListener('pointerdown', armTap)
        el.addEventListener('touchstart', armTap, { passive: true })
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          if (dragged) { dragged = false; return }
          // compact only: a tap toggles the same text the desktop `title`
          // shows on hover, since a touch never opens a native tooltip
          if (compactRef.current) {
            const info = el.querySelector('.map-mark-info')
            if (info) info.hidden = !info.hidden
          }
          selectRef.current(r.id, stackForTap(r.id))
        })
        m = new maplibregl.Marker({ element: el, anchor: 'center', draggable: !!editable }).setLngLat([r.lon, r.lat]).addTo(map)
        m.on('dragstart', () => { dragged = true })
        m.on('dragend', () => {
          // no reset here: a drag that ends without a trailing click (which
          // happens) leaves the flag set, and the next contact's pointerdown
          // clears it before its own click can be swallowed
          const { lng, lat } = m.getLngLat()
          const gr = georefRef.current
          if (!gr || !moveRef.current) return
          const p = fromLonLat(gr, lng, lat)
          moveRef.current(r.id, p.x, p.y)
        })
        markers.current.set(r.id, m)
      }
      m.setDraggable(!!editable)
      m.setLngLat([r.lon, r.lat])
      const el = m.getElement()
      // maplibregl.Marker's constructor stamps its own "maplibregl-marker"
      // class onto this element (that class, not ours, is what carries
      // position:absolute - see style.css note on .map-mark). Overwriting
      // className wholesale on every update strips that class right back off
      // after the very first render, so it has to be re-included here.
      // a flash in progress survives the rewrite: this effect re-runs on any
      // prop change, well inside the 800 ms the animation needs
      const flash = el.classList.contains('flash-hit') ? ' flash-hit' : el.classList.contains('flash-miss') ? ' flash-miss' : ''
      el.className = `maplibregl-marker map-mark ${state}${selected === r.id ? ' is-selected' : ''}${iso ? ' is-isolated' : ''}${threats.has(r.id) ? ' is-threat' : ''}${editable ? ' is-draggable' : ''}${flash}`
      const img = el.querySelector('img')
      if (uri && img.src !== uri) img.src = uri
      const n = assetName(graph, r.id)
      el.querySelector('.map-mark-label').textContent = n.ko
      const infoText = `${n.ko} · ${r.id} · ${Math.round(r.z)} m`
      el.title = infoText
      // desktop reads infoText through the native `title` above and gets no
      // extra DOM; compact only, so a phone never renders a node the tap
      // handler could not reach otherwise (reuses .rail-caption's type scale)
      if (compact) {
        let info = el.querySelector('.map-mark-info')
        if (!info) {
          info = document.createElement('div')
          info.className = 'map-mark-info rail-caption'
          info.hidden = true
          Object.assign(info.style, {
            position: 'absolute', left: '50%', top: '64px', transform: 'translateX(-50%)',
            whiteSpace: 'nowrap', background: 'rgba(7,10,16,.85)', padding: '2px 6px',
            borderRadius: '3px', margin: '0', zIndex: '1',
          })
          el.appendChild(info)
        }
        info.textContent = infoText
      } else {
        const info = el.querySelector('.map-mark-info')
        if (info) info.remove()
      }
    }
    for (const [id, m] of markers.current) if (!seen.has(id)) { m.remove(); markers.current.delete(id) }
  }, [graph, step, steps, idx, t, georef, ready, selected, onSelect, overlay, editable, compact])

  // One flash per adjudicated turn, on the target's marker. Declared after the
  // marker effect so the markers exist when it runs. The turn is recorded
  // whether or not the map is built or shown, so opening the pane later never
  // replays an old adjudication; a game with nothing adjudicated yet (a fresh
  // start, or a restart straight from the old game's overlay) forgets it.
  useEffect(() => {
    if (!overlay || !overlay.last) { flashRef.current.turn = -1; return }
    if (overlay.last.turn === flashRef.current.turn) return
    flashRef.current.turn = overlay.last.turn
    if (!ready || hidden) return
    const m = markers.current.get(overlay.last.to)
    if (!m) return
    const cls = overlay.last.success ? 'flash-hit' : 'flash-miss'
    // a second adjudication inside 800 ms: strip the first target too, or its
    // class stays on for good once its timer is cancelled
    clearTimeout(flashRef.current.timer)
    for (const mk of markers.current.values()) mk.getElement().classList.remove('flash-hit', 'flash-miss')
    const el = m.getElement()
    el.classList.add(cls)
    flashRef.current.timer = setTimeout(() => el.classList.remove(cls), 800)
  }, [overlay, ready, hidden])

  // the attack arc crawls: a route, not a border (same idea as the transport
  // flow in GraphCanvas)
  useEffect(() => {
    const seq = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]]
    let last = 0
    const tick = (now) => {
      dashRef.current.raf = requestAnimationFrame(tick)
      const map = mapRef.current
      if (!map || !ready || hidden || now - last < 60) return
      last = now
      dashRef.current.i = (dashRef.current.i + 1) % seq.length
      if (map.getLayer('attack')) map.setPaintProperty('attack', 'line-dasharray', seq[dashRef.current.i])
    }
    dashRef.current.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(dashRef.current.raf)
  }, [ready, hidden])

  const anchor = georef?.anchor
  const anchorMgrs = anchor ? toMgrs(anchor.lat, anchor.lon, 3) : ''

  return (
    <div className="map-pane" hidden={hidden}>
      <div className="map-canvas" ref={boxRef} />
      <div className="geo-controls map-controls">
        <div className="seg" role="group" aria-label="바탕">
          {BASES.map(([id, label]) => (
            <button key={id} type="button" className={base === id ? 'on' : ''} aria-pressed={base === id} onClick={() => setBase(id)}>{label}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="차원">
          <button type="button" className={!is3d ? 'on' : ''} onClick={() => setIs3d(false)}>2D</button>
          <button type="button" className={is3d ? 'on' : ''} onClick={() => setIs3d(true)}>3D</button>
        </div>
      </div>
      {/* not removable by design (ADR-0025): the screenshot carries the caveat */}
      <div className="map-watermark" aria-label="주의">가상 훈련 시나리오 · 실제 부대 배치 아님</div>
      {tileError && <div className="map-tile-error">바탕 지도를 받지 못했다. 오버레이만 그린다.</div>}
      <div className="geo-foot">
        <span>{graph?.geo?.frame?.id} · 격자 2 km · MGRS {anchorMgrs}</span>
        <span>지형 DEM · 3D 과장 1.5배</span>
        <span className="geo-warn">{editable ? '편집 모드 - 마커를 끌어 배치한다' : '위치는 표시 전용이다. 단절 원인은 저작값이고 지형에서 계산하지 않는다.'}</span>
      </div>
    </div>
  )
}
