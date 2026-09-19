import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { config } from '../config.js'
import { CAUSE_COLOR } from '../graph.js'
import { attackHops } from '../derive.js'
import { toLonLat, toMgrs } from '../georef.js'
import { markerRows, linkFeatures, trackFeatures, attackArcFeatures, gridFeatures, aoFeature } from '../mapLayers.js'
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
const EMPTY = { type: 'FeatureCollection', features: [] }

function firstSymbolLayer(style) {
  const l = (style.layers || []).find((x) => x.type === 'symbol')
  return l ? l.id : undefined
}

export default function MapPane({ graph, step, steps, idx, selected, onSelect, hidden }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const markers = useRef(new Map())
  const dashRef = useRef({ raf: null, i: 0 })
  const [ready, setReady] = useState(false)
  const [base, setBase] = useState('satellite')
  const [is3d, setIs3d] = useState(true)
  const [tileError, setTileError] = useState(false)

  const georef = graph?.geo?.georef
  const extent = graph?.geo?.frame?.extent
  const t = step && step.t !== undefined && step.t !== null ? Number(step.t) : 0

  // --- build ------------------------------------------------------------
  useEffect(() => {
    if (!boxRef.current || !georef || !extent) return
    const cfg = config().map
    const [lon0, lat0] = toLonLat(georef, extent.x[0], extent.y[0])
    const [lon1, lat1] = toLonLat(georef, extent.x[1], extent.y[1])
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: cfg.style,
      bounds: [[lon0, lat0], [lon1, lat1]],
      fitBoundsOptions: { padding: 40 },
      pitch: 55,
      maxPitch: 75,
      attributionControl: { compact: true, customAttribution: `${cfg.satellite_attribution} · ${cfg.dem_attribution}` },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('error', (e) => { if (e?.error && /tile|fetch|style/i.test(String(e.error.message || e.error))) setTileError(true) })
    // map.on('click') is suppressed after a drag; a DOM onClick on the box is
    // not, and would deselect on every pan
    map.on('click', () => onSelect(null))

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
      map.addLayer({ id: 'grid-labels', type: 'symbol', source: 'grid-labels',
        layout: { 'text-field': ['get', 'text'], 'text-size': 10, 'text-font': ['Noto Sans Regular'], 'text-anchor': 'bottom-left', 'text-offset': [0.3, -0.2] },
        paint: { 'text-color': '#c2c6cb', 'text-opacity': 0.75, 'text-halo-color': '#070a10', 'text-halo-width': 1 } })
      map.addSource('tracks', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'tracks', type: 'line', source: 'tracks', paint: { 'line-color': '#c2c6cb', 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': [1, 2] } })
      map.addSource('links', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'links', type: 'line', source: 'links', layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['case', ['get', 'cut'], ['match', ['get', 'cause'],
            'attack', CAUSE_COLOR.attack, 'mobility', CAUSE_COLOR.mobility, 'terrain', CAUSE_COLOR.terrain,
            'maintenance', CAUSE_COLOR.maintenance, 'unknown', CAUSE_COLOR.unknown, CAUSE_COLOR.unknown], '#9aa5b1'],
          'line-width': ['case', ['get', 'cut'], 3, 1.6],
          'line-opacity': 0.9,
          'line-dasharray': ['case', ['get', 'cut'], ['literal', [1, 2.5]], ['literal', [1, 0]]],
        } })
      map.addSource('attack', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'attack', type: 'line', source: 'attack', layout: { 'line-cap': 'round' },
        paint: { 'line-color': CAUSE_COLOR.attack, 'line-width': 2.5, 'line-opacity': 0.95, 'line-dasharray': [0, 4, 3] } })
      map.addLayer({ id: 'attack-labels', type: 'symbol', source: 'attack',
        layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, -1] },
        paint: { 'text-color': '#ffb4ba', 'text-halo-color': '#070a10', 'text-halo-width': 1.2 } })

      // The constructor's own `bounds` option fits the AO before the map has a
      // real size and before pitch is accounted for, so the initial 3D camera
      // can crop the AO's far edge. Re-fit once the style (and its size) is
      // actually settled.
      map.fitBounds([[lon0, lat0], [lon1, lat1]], { padding: 40, pitch: 55, duration: 0 })
      setReady(true)
    })
    return () => {
      cancelAnimationFrame(dashRef.current.raf)
      for (const m of markers.current.values()) m.remove()
      markers.current.clear()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [graph])

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
    map.getSource('links').setData(linkFeatures(graph, step, t, georef))
    map.getSource('tracks').setData(trackFeatures(graph, t, georef))
    const { hops } = attackHops(steps || [], idx || 0)
    map.getSource('attack').setData(attackArcFeatures(graph, hops, t, georef))

    const rows = markerRows(graph, step, t, georef)
    const seen = new Set()
    for (const r of rows) {
      seen.add(r.id)
      const asset = graph.assets.find((a) => a.id === r.id)
      const state = r.compromise > 0 ? 'attack' : r.outage ? `outage cause-${r.outage}` : 'ok'
      const color = r.compromise > 0 ? '#ffb4ba' : r.outage ? '#93a6ba' : '#e6f0fb'
      const uri = deviceIconDataUri(asset?.type, { size: 30, color })
      let m = markers.current.get(r.id)
      if (!m) {
        const el = document.createElement('div')
        el.className = 'map-mark'
        el.innerHTML = `<div class="map-mark-sym"><img alt="" /></div><div class="map-mark-label"></div>`
        el.addEventListener('click', (e) => { e.stopPropagation(); onSelect(r.id) })
        m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lon, r.lat]).addTo(map)
        markers.current.set(r.id, m)
      }
      m.setLngLat([r.lon, r.lat])
      const el = m.getElement()
      // maplibregl.Marker's constructor stamps its own "maplibregl-marker"
      // class onto this element (that class, not ours, is what carries
      // position:absolute - see style.css note on .map-mark). Overwriting
      // className wholesale on every update strips that class right back off
      // after the very first render, so it has to be re-included here.
      el.className = `maplibregl-marker map-mark ${state}${selected === r.id ? ' is-selected' : ''}`
      const img = el.querySelector('img')
      if (uri && img.src !== uri) img.src = uri
      const n = assetName(graph, r.id)
      el.querySelector('.map-mark-label').textContent = n.ko
      el.title = `${n.ko} · ${r.id} · ${Math.round(r.z)} m`
    }
    for (const [id, m] of markers.current) if (!seen.has(id)) { m.remove(); markers.current.delete(id) }
  }, [graph, step, steps, idx, t, georef, ready, selected, onSelect])

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
      {tileError && <div className="map-tile-error">지도 타일을 받지 못했다. 오버레이만 그린다.</div>}
      <div className="geo-foot">
        <span>{graph?.geo?.frame?.id} · 격자 2 km · MGRS {anchorMgrs}</span>
        <span>지형 DEM · 3D 과장 1.5배</span>
        <span className="geo-warn">위치는 표시 전용이다. 단절 원인은 저작값이고 지형에서 계산하지 않는다.</span>
      </div>
    </div>
  )
}
