import { useCallback, useEffect, useRef, useState } from 'react'
import { renderGeo } from '../geo.js'
import { CAUSE_COLOR } from '../graph.js'
import { deviceIconDataUri } from '../icons.js'

// The map view. Secondary by construction (ADR-0001): it draws positions the
// engine never reads. geo.js stays imperative - it is ~570 lines of projection
// maths with no React in it, and rewriting it would be risk with no payoff
// (ADR-0024).
//
// Direct manipulation: drag to orbit, Ctrl+drag to zoom. The sliders stay,
// because a slider is the only way to hit an exact value and to see what the
// current one is - dragging is for looking, the slider is for reporting.
//
// az is meaningful in BOTH modes: geo.js forces pitch to 90 for the plan view
// but still honours az, so a horizontal drag rotates the bearing in 2D too.
// pitch only exists in 3D.

const ZOOM_MIN = 0.4
const ZOOM_MAX = 6

function Slider({ label, value, min, max, unit, onChange }) {
  return (
    <label className="geo-slider">
      <span>{label}</span>
      <input
        type="range" min={min} max={max} step="1" value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <b>{unit}</b>
    </label>
  )
}

export default function GeoPane({ graph, step, cam, onCam, selected, onSelect, hidden }) {
  const boxRef = useRef(null)
  const [viewT, setViewT] = useState({ zoom: 1, x: 0, y: 0 })
  const drag = useRef(null)
  const camRef = useRef(cam)
  camRef.current = cam

  // --- draw -------------------------------------------------------------
  useEffect(() => {
    const box = boxRef.current
    if (hidden || !box || !graph || !step) return
    box.innerHTML = renderGeo({
      graph,
      step,
      width: box.clientWidth || 900,
      height: box.clientHeight || 560,
      causeColor: CAUSE_COLOR,
      iconFor: (type, state) => deviceIconDataUri(type, {
        size: 22,
        color: state === 'attack' ? '#ffb4ba' : state === 'outage' ? '#93a6ba' : '#e6f0fb',
      }),
      selected,
      ...cam,
    })
    const handlers = []
    for (const g of box.querySelectorAll('.geo-node')) {
      const fn = (e) => {
        // a click that ended a drag is not a selection
        if (drag.current && drag.current.moved) return
        e.stopPropagation()
        onSelect(g.dataset.asset)
      }
      g.addEventListener('click', fn)
      handlers.push([g, fn])
    }
    return () => { for (const [g, fn] of handlers) g.removeEventListener('click', fn) }
  }, [graph, step, cam, selected, hidden])

  // Zoom and pan are a view transform on the finished drawing, not camera
  // parameters. Keeping them out of renderGeo means zooming costs one style
  // write instead of a full re-projection.
  useEffect(() => {
    const svg = boxRef.current && boxRef.current.querySelector('.geo-svg')
    if (!svg) return
    svg.style.transformOrigin = 'center center'
    svg.style.transform = `translate(${viewT.x}px, ${viewT.y}px) scale(${viewT.zoom})`
  }, [viewT, cam, step, graph, hidden])

  // --- direct manipulation ----------------------------------------------
  //
  // Throttled on the clock, NOT on requestAnimationFrame. The first version
  // used a rAF with an "already scheduled" guard, and a frame that never
  // arrives leaves that guard set forever - every later move is dropped and
  // the map freezes mid-drag. rAF is suspended whenever the page is not being
  // rendered, so this was not hypothetical. A timestamp cannot wedge.
  const applyDrag = useCallback((d, dx, dy) => {
    if (d.zoomMode) {
      // drag up = zoom in. Exponential so the feel is even at every scale.
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, d.zoom0 * Math.exp(-dy / 240)))
      setViewT((v) => ({ ...v, zoom: z }))
      return
    }
    const c = camRef.current
    const az = ((d.az0 + dx * 0.4) % 360 + 360) % 360
    const next = { ...c, az: Math.round(az) }
    if (c.mode === '3d') {
      // pitch 90 is straight down (the plan view), 12 is near the horizon.
      // Sign is +dy: dragging DOWN raises the pitch toward the plan view, and
      // dragging UP tips the scene toward the horizon - you pull the far edge
      // of the ground up toward you, the way you would tilt a physical board.
      // Inverted from the first version, which read backwards in use.
      next.pitch = Math.round(Math.min(88, Math.max(12, d.pitch0 + dy * 0.3)))
    }
    onCam(next)
  }, [onCam])

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return
    if (e.target.closest && e.target.closest('.geo-controls')) return
    drag.current = {
      x: e.clientX, y: e.clientY, moved: false, lastApply: 0,
      zoomMode: e.ctrlKey || e.metaKey,
      az0: camRef.current.az, pitch0: camRef.current.pitch,
      zoom0: viewT.zoom, panX0: viewT.x, panY0: viewT.y,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no capture, still works */ }
  }, [viewT])

  const onPointerMove = useCallback((e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    d.dx = dx; d.dy = dy
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (!d.moved) return
    const now = performance.now()
    if (now - d.lastApply < 16) return
    d.lastApply = now
    applyDrag(d, dx, dy)
  }, [applyDrag])

  const endDrag = useCallback((e) => {
    const d = drag.current
    if (!d) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
    // the throttle can swallow the last move; land on the real final position
    if (d.moved) applyDrag(d, d.dx || 0, d.dy || 0)
    // let the node click handler see `moved`, then clear on the next tick
    setTimeout(() => { if (drag.current === d) drag.current = null }, 0)
  }, [applyDrag])

  const resetView = () => {
    setViewT({ zoom: 1, x: 0, y: 0 })
    onCam({ ...cam, az: 35, pitch: 55 })
  }

  const is3d = cam.mode === '3d'
  const zoomed = Math.abs(viewT.zoom - 1) > 0.01

  return (
    <div className="geo-pane" hidden={hidden}>
      <div className="geo-controls">
        <div className="seg" role="group" aria-label="차원">
          {['2d', '3d'].map((m) => (
            <button
              key={m}
              type="button"
              className={cam.mode === m ? 'on' : ''}
              onClick={() => onCam({ ...cam, mode: m })}
            >{m.toUpperCase()}</button>
          ))}
        </div>
        <span className="tb-rule" />
        <label className="chk">
          <input
            type="checkbox" checked={cam.terrain}
            onChange={(e) => onCam({ ...cam, terrain: e.target.checked })}
          /> 지형
        </label>
        <Slider label="회전" min={0} max={360} value={cam.az} unit={`${cam.az}°`}
          onChange={(az) => onCam({ ...cam, az })} />
        {is3d && (
          <>
            <Slider label="고도각" min={12} max={88} value={cam.pitch} unit={`${cam.pitch}°`}
              onChange={(pitch) => onCam({ ...cam, pitch })} />
            <Slider label="표고 과장" min={1} max={30} value={cam.zScale} unit={`×${cam.zScale}`}
              onChange={(zScale) => onCam({ ...cam, zScale })} />
          </>
        )}
        <span className="tb-rule" />
        <span className="geo-hint">끌어서 회전{is3d ? '·고도각' : ''} · Ctrl+끌기 확대</span>
        {zoomed && <b className="geo-zoom">×{viewT.zoom.toFixed(1)}</b>}
        <button type="button" className="geo-reset" onClick={resetView}>원래대로</button>
      </div>
      <div
        id="geo-canvas"
        className={`geo-canvas${drag.current ? ' is-dragging' : ''}`}
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  )
}
