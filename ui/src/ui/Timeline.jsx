import { useCallback, useEffect, useMemo, useRef, useState } from 'react' 
import { CAUSE_COLOR } from '../graph.js'
import { clockOf } from '../derive.js'
import { techniqueLine } from '../labels.js'

// The strip under the graph is the argument this project is making, drawn as
// one picture: phases on top, cause-coloured outage bands in the middle,
// attack steps at the bottom. Where a red tick sits inside an amber band, the
// operator can see for themselves that two different things are happening at
// once - which is the whole point of separating the causes (ADR-0012).

const PAD_L = 4
const PAD_R = 4
const LANE_H = 14
const H = 64

export default function Timeline({ graph, payload, idx, step, playing, onPlay, onSeek, speed, onSpeed, onStep }) {
  const [w, setW] = useState(0)
  const roRef = useRef(null)

  // A callback ref, not useRef + useEffect([]). This component returns early
  // until the graph loads, so the ribbon element does not exist on the first
  // render - a mount-once effect observed nothing and the viewBox stayed at
  // its initial width while the element was laid out at the real one. The
  // result was an SVG stretched ~1.8x horizontally: every phase label and hour
  // tick was visibly wider than the rest of the UI.
  const wrapRef = useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!node) return
    const ro = new ResizeObserver(([e]) => {
      const next = Math.round(e.contentRect.width)
      if (next > 0) setW(next)
    })
    ro.observe(node)
    roRef.current = ro
    setW(Math.round(node.getBoundingClientRect().width) || 0)
  }, [])

  useEffect(() => () => { if (roRef.current) roRef.current.disconnect() }, [])

  const tl = graph?.timeline
  // A scenario without a phase/outage timeline can still have an attack
  // chain with its own clock (defnet-01: chain offsets in minutes from the
  // phishing mail). Then the ribbon is the chain: horizon from the last
  // step, ticks as offsets, no phase lanes, no outage bands - only the red
  // attack marks and the head. Nothing is drawn that the data does not have.
  const steps = payload?.steps || []
  const chainOnly = !tl && steps.length > 1
  const lastT = steps.reduce((m, st) => Math.max(m, Number(st.t) || 0), 0)
  const horizon = tl ? Number(tl.horizon || 0) : (chainOnly ? Math.max(15, Math.ceil(lastT / 15) * 15) : 0)
  const x = (t) => PAD_L + (horizon ? (t / horizon) : 0) * (w - PAD_L - PAD_R)

  const missions = useMemo(
    () => (graph?.missions || []).slice().sort((a, b) => (a.priority || 9) - (b.priority || 9)),
    [graph]
  )

  const ticks = useMemo(() => {
    if (!tl && !chainOnly) return []
    const every = horizon > 240 ? 60 : (horizon > 60 ? 30 : 15)
    const out = []
    for (let t = 0; t <= horizon; t += every) {
      const d = tl && tl.t0_iso ? new Date(new Date(tl.t0_iso).getTime() + t * 60000) : null
      out.push({
        t,
        label: d
          ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          : `+${t}분`,
      })
    }
    return out
  }, [tl, chainOnly, horizon])

  const bands = useMemo(() => {
    const out = []
    for (const a of graph?.assets || []) for (const o of a.outages || []) out.push({ o, what: a.id })
    for (const l of graph?.links || []) for (const o of l.outages || []) out.push({ o, what: l.id })
    return out
  }, [graph])

  if (!tl && !chainOnly) return <footer className="timeline" />

  let laneY = 4
  const phaseLanes = []
  for (const m of missions) {
    if (chainOnly) break
    for (const ph of (graph.phases || []).filter((p) => p.mission === m.id && p.window)) {
      phaseLanes.push({ ph, y: laneY, active: (step?.active_phases || []).includes(ph.id) })
    }
    laneY += LANE_H + 3
  }
  const bandY = laneY + 2
  const atkY = bandY + 12
  const headX = x(Number(payload?.steps?.[idx]?.t ?? 0))
  const clock = clockOf(step)

  const seek = (evt) => {
    const r = evt.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (evt.clientX - r.left - PAD_L) / (r.width - PAD_L - PAD_R)))
    onSeek(frac * horizon)
  }

  return (
    <footer className="timeline">
      <div className="transport">
        <button type="button" className="step-btn" onClick={() => onStep(-1)} title="이전 (←)">◀</button>
        <button type="button" className="play-btn" onClick={onPlay} title="재생 / 정지 (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="step-btn" onClick={() => onStep(1)} title="다음 (→)">▶</button>
        <div className="seg speed" role="group" aria-label="배속">
          {[1, 4, 16].map((s) => (
            <button key={s} type="button" className={speed === s ? 'on' : ''} onClick={() => onSpeed(s)}>{s}×</button>
          ))}
        </div>
      </div>

      <div className="ribbon-wrap" ref={wrapRef}>
        {/* nothing is drawn until the element has been measured: a viewBox
            that does not match the laid-out width is a stretched picture */}
        {w > 0 && (
        <svg
          id="ribbon" viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none"
          role="img" aria-label="단계와 단절 타임라인" onClick={seek}
        >
          {ticks.map((tk) => (
            <g key={tk.t}>
              <line x1={x(tk.t)} y1={0} x2={x(tk.t)} y2={H} stroke="#1c2430" />
              {tk.label && <text x={x(tk.t) + 3} y={H - 2} fill="#99a0a7" fontSize="9">{tk.label}</text>}
            </g>
          ))}

          {phaseLanes.map(({ ph, y, active }) => {
            const x0 = x(ph.window.from)
            const wd = Math.max(2, x(ph.window.to) - x0)
            return (
              <g key={ph.id}>
                <rect
                  x={x0} y={y} width={wd} height={LANE_H} rx="3"
                  fill={active ? '#222b39' : '#18202c'}
                  stroke={active ? '#4a5668' : '#2a3442'}
                />
                {wd > 46 && (
                  <text x={x0 + 6} y={y + LANE_H - 4} fill={active ? '#f2f3f4' : '#99a0a7'} fontSize="9.5">
                    {ph.name}
                  </text>
                )}
              </g>
            )
          })}

          {bands.map((b, i) => {
            const x0 = x(b.o.from)
            const wd = Math.max(2, x(b.o.to) - x0)
            return (
              <rect
                key={`${b.what}-${i}`} x={x0} y={bandY} width={wd} height="9" rx="2"
                fill={CAUSE_COLOR[b.o.cause] || CAUSE_COLOR.unknown} fillOpacity=".62"
              >
                <title>{`${b.what} · ${b.o.cause} · ${b.o.note || ''}`}</title>
              </rect>
            )
          })}

          {(payload?.attack?.steps || []).map((st, i, all) => {
            if (!st.state || Object.keys(st.state).length === 0) return null
            const px = x(st.t)
            // room to the next mark decides whether the stage name fits
            const nx = i + 1 < all.length ? x(all[i + 1].t) : w - PAD_R
            const room = nx - px
            return (
              <g key={i}>
                <path d={`M${px} ${atkY} l4 4 l-4 4 l-4 -4 z`} fill={CAUSE_COLOR.attack}>
                  <title>{[st.label || '', ...(Array.isArray(st.gt) ? st.gt : (st.gt ? [st.gt] : [])).map((g) => techniqueLine(g.technique)), st.note || ''].filter(Boolean).join('\n')}</title>
                </path>
                {chainOnly && room > 62 && (
                  <text x={px + 7} y={atkY + 7} fill="#99a0a7" fontSize="9">{st.label}</text>
                )}
              </g>
            )
          })}

          <line x1={headX} y1={0} x2={headX} y2={H} stroke="#f2f3f4" strokeWidth="1.5" />
          <circle cx={headX} cy={H - 6} r="4" fill="#f2f3f4" />
        </svg>
        )}
      </div>

      <div className="clock">
        <div className="clock-time">{clock.time}</div>
        <div className="clock-sub">{step?.label || '-'} {clock.off}</div>
      </div>
    </footer>
  )
}
