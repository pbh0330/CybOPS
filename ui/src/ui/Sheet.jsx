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
// Below this, a pointer sequence was a tap and not a drag. A thumb never lands
// and lifts on exactly the same pixel.
const TAP_SLOP = 6

export default function Sheet({ peek, children, raised, onStateChange }) {
  const [state, setState] = useState('peek')
  const ref = useRef(null)
  const drag = useRef(null)
  const dragEndedAt = useRef(0)

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
    drag.current = { startY: e.clientY, startH: el.getBoundingClientRect().height, moved: false, h: null }
    // The sheet eases between snap points (transition: height). While a finger
    // is on it there is nothing to ease TO - it must follow the finger - and,
    // worse, a rect read mid-transition reports the animated height rather
    // than the one the drag asked for, which is what the snap is measured on.
    el.style.transition = 'none'
    // Capture on the GRIP, not on ref.current. Capturing on the sheet retargets
    // the rest of the sequence - pointerup AND the click - to the sheet, which
    // is the button's ancestor, so the button's own onClick never fires and a
    // tap does nothing at all.
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    const el = ref.current
    if (!el || !drag.current) return
    const dy = drag.current.startY - e.clientY
    if (!drag.current.moved && Math.abs(dy) <= TAP_SLOP) return
    drag.current.moved = true
    drag.current.h = Math.max(56, drag.current.startH + dy)
    el.style.height = drag.current.h + 'px'
  }

  function onPointerUp(e) {
    const el = ref.current
    const d = drag.current
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
    if (!el) return
    el.style.transition = ''
    if (!d) return
    if (!d.moved) return            // a tap: the click that follows cycles
    dragEndedAt.current = Date.now()
    const hs = heights()
    const now = d.h != null ? d.h : el.getBoundingClientRect().height
    const target = snapTo(now, [hs.peek, hs.half, hs.full])
    const name = STATES.find((s) => hs[s] === target) || 'peek'
    el.style.height = ''
    setState(name)
  }

  function cycle() {
    // a drag fires a click too; that click must not cycle on top of the snap
    if (Date.now() - dragEndedAt.current < 350) return
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
