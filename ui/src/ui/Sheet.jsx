// The rail's content does not change on a phone - only where it lives. So this
// is a container, not a second rail: App passes the same children it would
// have put in <aside class="rail">.

import { useEffect, useRef, useState } from 'react'

// Nearest snap point. Ties go to the lower (more closed) point so that letting
// go halfway never opens further than the user dragged.
export function snapTo(y, points) {
  const sorted = [...points].sort((a, b) => a - b)
  let best = sorted[0]
  let bestDist = Infinity
  for (const p of sorted) {
    const d = Math.abs(p - y)
    if (d < bestDist) { bestDist = d; best = p }
  }
  return best
}

const STATES = ['peek', 'half', 'full']

export default function Sheet({ peek, children, raised, onStateChange }) {
  const [state, setState] = useState('peek')
  const ref = useRef(null)
  const drag = useRef(null)

  // A selection raises the sheet, but only from peek: once the user has set a
  // height, nothing takes it away from them.
  useEffect(() => {
    if (raised && state === 'peek') setState('half')
  }, [raised])          // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (onStateChange) onStateChange(state) }, [state, onStateChange])

  function heights() {
    const h = typeof window !== 'undefined' ? window.innerHeight : 800
    return { peek: 56, half: Math.round(h * 0.5), full: Math.round(h * 0.86) }
  }

  function onPointerDown(e) {
    const el = ref.current
    if (!el) return
    drag.current = { startY: e.clientY, startH: el.getBoundingClientRect().height }
    el.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    const el = ref.current
    if (!el || !drag.current) return
    const next = drag.current.startH + (drag.current.startY - e.clientY)
    el.style.height = Math.max(56, next) + 'px'
  }

  function onPointerUp(e) {
    const el = ref.current
    if (!el || !drag.current) return
    const hs = heights()
    const now = el.getBoundingClientRect().height
    const target = snapTo(now, [hs.peek, hs.half, hs.full])
    const name = STATES.find((s) => hs[s] === target) || 'peek'
    el.style.height = ''
    drag.current = null
    el.releasePointerCapture(e.pointerId)
    setState(name)
  }

  function cycle() {
    setState((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'))
  }

  return (
    <div className="sheet" data-state={state} ref={ref}>
      <button
        type="button" className="sheet-grip" onClick={cycle}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        aria-label="패널 높이"
      >
        <span className="sheet-bar" />
        <span className="sheet-peek">{peek}</span>
      </button>
      <div className="sheet-body">{children}</div>
    </div>
  )
}
