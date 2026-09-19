import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadConfig } from './config.js'
import { loadSymbology, unmappedTypes } from './symbols.js'
import { createEditor } from './editor.js'
import { createWargame } from './wargame.js'
import { computeStep, activePhaseNames, clockOf } from './derive.js'
import Topbar from './ui/Topbar.jsx'
import BoardToolbar from './ui/BoardToolbar.jsx'
import GraphCanvas from './ui/GraphCanvas.jsx'
import GeoPane from './ui/GeoPane.jsx'
import MapPane from './ui/MapPane.jsx'
import Rail from './ui/Rail.jsx'
import Timeline from './ui/Timeline.jsx'
import Onboard from './ui/Onboard.jsx'

const SCENARIOS = ['tacnet-01', 'defnet-01']
const HISTORY_MAX = 60

// Mounts an imperative module (editor.js, wargame.js) into the React tree.
// Those two own their own DOM; React owns the box they live in.
function Mount({ make, deps = [], className }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    return make(ref.current)
  }, deps)
  return <div className={className} ref={ref} />
}

export default function App() {
  const [error, setError] = useState(null)
  const [scenarios, setScenarios] = useState(SCENARIOS)
  const [scenarioId, setScenarioId] = useState(null)
  const [payload, setPayload] = useState(null)
  const [graph, setGraph] = useState(null)
  const [idx, setIdx] = useState(0)
  // Deep link: ?scenario=tacnet-01&t=300&view=geo&tab=cuts. Read once at
  // start so a demo step or a screenshot can be reached without clicking.
  // Anything unknown is ignored and the defaults stand.
  const link = useRef(new URLSearchParams(window.location.search))
  const pick = (key, allowed, dflt) => (allowed.includes(link.current.get(key)) ? link.current.get(key) : dflt)
  const [view, setView] = useState(pick('view', ['dependency', 'transport', 'geo'], 'dependency'))
  const [mode, setMode] = useState('observe')
  const [tab, setTab] = useState(pick('tab', ['cuts', 'actions', 'inspect'], 'actions'))
  const [labels, setLabels] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [selectedData, setSelectedData] = useState(null)
  const [requests, setRequests] = useState([])
  const [edited, setEdited] = useState(false)
  const [tool, setTool] = useState('select')
  const [histVer, setHistVer] = useState(0)
  const [wgVer, setWgVer] = useState(0)
  const [onboard, setOnboard] = useState(false)
  const [toast, setToast] = useState(null)
  const [geoCam, setGeoCam] = useState({ mode: '2d', az: 35, pitch: 55, zScale: 12, terrain: true })

  const cyRef = useRef(null)
  const editorRef = useRef(null)
  const wargameRef = useRef(null)
  const graphRef = useRef(null)
  const hist = useRef({ past: [], future: [], last: null })

  graphRef.current = graph

  // --- boot -------------------------------------------------------------
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await loadConfig()
        await loadSymbology()
        const available = []
        for (const id of SCENARIOS) {
          const res = await fetch(`./data/${id}.replay.json`, { method: 'HEAD' }).catch(() => null)
          if (res && res.ok) available.push(id)
        }
        const list = available.length ? available : SCENARIOS
        if (!alive) return
        setScenarios(list)
        const wanted = link.current.get('scenario')
        setScenarioId(list.includes(wanted) ? wanted : list[0])
        let seen = false
        try { seen = localStorage.getItem('mccycop:onboard:seen') === '1' } catch { /* ignore */ }
        // a deep link is someone who already knows the screen; do not cover it
        const deep = ['scenario', 't', 'view', 'tab', 'select'].some((k) => link.current.has(k))
        if (!seen && !deep) setOnboard(true)
      } catch (e) {
        if (alive) setError(e.message)
      }
    })()
    return () => { alive = false }
  }, [])

  // --- scenario load ----------------------------------------------------
  const storageKey = useCallback((id) => `mccycop:edit:${id}`, [])

  useEffect(() => {
    if (!scenarioId) return
    let alive = true
    setPlaying(false)
    ;(async () => {
      try {
        const res = await fetch(`./data/${scenarioId}.replay.json`)
        if (!res.ok) throw new Error(`${scenarioId}.replay.json (${res.status})`)
        const p = await res.json()
        if (!alive) return
        const missing = unmappedTypes()
        if (missing.length) console.warn('[symbols] SIDC 미매핑 타입:', missing.join(', '))

        let g = structuredClone(p.graph)
        let wasEdited = false
        try {
          const raw = localStorage.getItem(storageKey(scenarioId))
          if (raw) {
            const saved = JSON.parse(raw)
            if (saved && saved.graph) { g = saved.graph; wasEdited = true }
          }
        } catch { /* ignore */ }

        hist.current = { past: [], future: [], last: structuredClone(g) }
        setPayload(p)
        setGraph(g)
        setEdited(wasEdited)
        // ?t=<minutes> lands on the nearest step, first load only
        let start = 0
        const tq = link.current.get('t')
        if (tq !== null && p.steps && p.steps.length) {
          const t = Number(tq)
          let best = Infinity
          p.steps.forEach((st, i) => {
            const d = Math.abs(Number(st.t) - t)
            if (d < best) { best = d; start = i }
          })
          link.current.delete('t')
        }
        setIdx(start)
        setSelectedData(null)
        setHistVer((v) => v + 1)
      } catch (e) {
        if (alive) setError(e.message)
      }
    })()
    return () => { alive = false }
  }, [scenarioId, storageKey])

  // --- derived ----------------------------------------------------------
  const wargameState = wargameRef.current && wargameRef.current.isActive()
    ? wargameRef.current.getState()
    : null

  const step = useMemo(
    () => computeStep({ payload, graph, idx, edited, wargameState }),
    // wgVer is the signal that the turn loop moved; wargameState is read fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload, graph, idx, edited, wgVer]
  )

  const phases = useMemo(() => activePhaseNames(graph, step), [graph, step])
  const when = clockOf(step).time

  // --- playback ---------------------------------------------------------
  useEffect(() => {
    if (!playing || !payload) return
    const id = setInterval(() => {
      setIdx((i) => (i + 1 >= payload.steps.length ? 0 : i + 1))
    }, 900 / speed)
    return () => clearInterval(id)
  }, [playing, payload, speed])

  // --- edit bookkeeping -------------------------------------------------
  const commitEdit = useCallback(() => {
    const g = graphRef.current
    if (!g) return
    if (hist.current.last) {
      hist.current.past.push(hist.current.last)
      if (hist.current.past.length > HISTORY_MAX) hist.current.past.shift()
    }
    hist.current.future = []
    hist.current.last = structuredClone(g)
    setEdited(true)
    setGraph({ ...g })
    setHistVer((v) => v + 1)
    try {
      localStorage.setItem(storageKey(scenarioId), JSON.stringify({ graph: g, at: Date.now() }))
    } catch { /* quota or private mode */ }
  }, [scenarioId, storageKey])

  const applySnapshot = useCallback((g) => {
    hist.current.last = structuredClone(g)
    setGraph(structuredClone(g))
    setHistVer((v) => v + 1)
    try {
      localStorage.setItem(storageKey(scenarioId), JSON.stringify({ graph: g, at: Date.now() }))
    } catch { /* ignore */ }
  }, [scenarioId, storageKey])

  const undo = useCallback(() => {
    const h = hist.current
    if (!h.past.length) return
    const prev = h.past.pop()
    h.future.push(structuredClone(graphRef.current))
    applySnapshot(prev)
  }, [applySnapshot])

  const redo = useCallback(() => {
    const h = hist.current
    if (!h.future.length) return
    const next = h.future.pop()
    h.past.push(structuredClone(graphRef.current))
    applySnapshot(next)
  }, [applySnapshot])

  const resetEdits = useCallback(() => {
    if (!payload) return
    try { localStorage.removeItem(storageKey(scenarioId)) } catch { /* ignore */ }
    const g = structuredClone(payload.graph)
    hist.current = { past: [], future: [], last: structuredClone(g) }
    setGraph(g)
    setEdited(false)
    setHistVer((v) => v + 1)
    setToast('시나리오를 원본으로 되돌렸다')
  }, [payload, scenarioId, storageKey])

  const exportScenario = useCallback(() => {
    const blob = new Blob([JSON.stringify(graphRef.current, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${scenarioId}-edited.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [scenarioId])

  // --- keyboard ---------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)
      if (typing) return
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); return }
      if (e.key === 'ArrowRight') { setIdx((i) => Math.min((payload?.steps.length || 1) - 1, i + 1)); return }
      if (e.key === 'ArrowLeft') { setIdx((i) => Math.max(0, i - 1)); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [payload, undo, redo])

  // --- selection --------------------------------------------------------
  const onSelect = useCallback((id) => {
    const cy = cyRef.current
    if (!id || !cy) { setSelectedData(null); return }
    const n = cy.$id(id)
    if (!n.length) { setSelectedData(null); return }
    cy.$(':selected').unselect()
    n.select()
    setSelectedData(n.data())
    setTab('inspect')
  }, [])

  // ?select=<node id>: select once the graph (and the cytoscape instance,
  // built in the child's effect, which runs before this one) exists
  useEffect(() => {
    const id = link.current.get('select')
    if (!id || !graph) return
    link.current.delete('select')
    onSelect(id)
  }, [graph, onSelect])

  const onTap = useCallback((target) => {
    if (editorRef.current && mode === 'edit') return editorRef.current.handleTap(target)
    return false
  }, [mode])

  const onRequest = useCallback((id) => {
    const st = payload?.steps[idx]
    setRequests((r) => [{
      id,
      t: st?.t,
      when: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    }, ...r])
  }, [payload, idx])

  const onSeek = useCallback((t) => {
    if (!payload) return
    let best = 0
    let bestD = Infinity
    payload.steps.forEach((s, i) => {
      const d = Math.abs(Number(s.t) - t)
      if (d < bestD) { bestD = d; best = i }
    })
    setIdx(best)
  }, [payload])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(id)
  }, [toast])

  // --- mode switching ---------------------------------------------------
  useEffect(() => {
    if (mode !== 'wargame' && wargameRef.current) {
      wargameRef.current.stop?.()
      setWgVer((v) => v + 1)
    }
    if (mode === 'edit') setTool('select')
  }, [mode])

  if (error) {
    return (
      <div className="load-error">
        데이터를 읽지 못했다: {error}<br />
        <code>.\scripts\Export-ReplayData.ps1</code> 을 먼저 실행한다.
      </div>
    )
  }

  const isGeo = view === 'geo'
  const hasGeoref = !!(graph && graph.geo && graph.geo.georef)

  return (
    <div className="app">
      <Topbar
        scenarios={scenarios}
        scenarioId={scenarioId}
        onScenario={setScenarioId}
        mode={mode}
        onMode={setMode}
        phases={phases}
        onHelp={() => setOnboard(true)}
        graph={graph}
        step={step}
      />

      <div className={`main${mode === 'edit' ? ' is-editing' : ''}`}>
        {mode === 'edit' && (
          <Mount
            className="palette"
            deps={[graph, mode]}
            make={(el) => {
              const ed = createEditor({
                paletteEl: el,
                onChange: commitEdit,
                getGraph: () => graphRef.current,
                getCy: () => cyRef.current,
              })
              editorRef.current = ed
              ed.renderPalette()
              ed.setTool('select')
              return () => { editorRef.current = null }
            }}
          />
        )}

        <section className="board">
          <BoardToolbar
            view={view} onView={setView} mode={mode}
            labels={labels} onLabels={setLabels}
            onFit={() => cyRef.current && cyRef.current.fit(undefined, 16)}
            tool={tool}
            onTool={(t) => { setTool(t); editorRef.current?.setTool(t) }}
            canUndo={hist.current.past.length > 0}
            canRedo={hist.current.future.length > 0}
            onUndo={undo} onRedo={redo}
            onExport={exportScenario} onReset={resetEdits}
            editState={edited ? '편집됨 · 수치는 로컬 엔진이 계산한다' : ''}
          />
          <div className="canvas-wrap">
            <GraphCanvas
              graph={graph} step={step} steps={payload?.steps} idx={idx} view={view} labels={labels}
              hidden={isGeo} cyRef={cyRef} onSelect={onSelect} onTap={onTap}
              selected={selectedData?.id || null}
            />
            {hasGeoref ? (
              <MapPane
                graph={graph} step={step} steps={payload?.steps} idx={idx}
                selected={selectedData?.id || null} onSelect={onSelect} hidden={!isGeo}
              />
            ) : (
              <GeoPane
                graph={graph} step={step} cam={geoCam} onCam={setGeoCam}
                selected={selectedData?.id || null} onSelect={onSelect} hidden={!isGeo}
              />
            )}
          </div>
        </section>

        <Rail
          graph={graph} step={step} scenarioId={scenarioId} edited={edited}
          when={when} tab={tab} onTab={setTab}
          requests={requests} onRequest={onRequest}
          selectedData={selectedData} onToast={setToast} mode={mode}
          editor={editorRef}
          payload={payload} idx={idx} onSeekIdx={(i) => setIdx(i)}
          wargameSlot={mode === 'wargame' ? (
            <Mount
              deps={[graph, mode]}
              make={(el) => {
                const wg = createWargame({
                  mountEl: el,
                  getGraph: () => graphRef.current,
                  getT: () => {
                    const b = payload?.steps[idx]
                    return b && b.t !== undefined && b.t !== null ? Number(b.t) : -1
                  },
                  getMethod: () => payload?.method || 'weighted',
                  onChange: () => setWgVer((v) => v + 1),
                })
                wargameRef.current = wg
                // start from whatever the replay says is compromised right
                // now, so the wargame begins in the situation the operator was
                // just looking at
                wg.start((payload?.steps[idx] || {}).compromise || {})
                return () => { wg.stop?.(); wargameRef.current = null }
              }}
            />
          ) : null}
        />
      </div>

      <Timeline
        graph={graph} payload={payload} idx={idx} step={step}
        playing={playing} onPlay={() => setPlaying((p) => !p)} onSeek={onSeek}
        speed={speed} onSpeed={setSpeed}
        onStep={(d) => setIdx((i) => Math.max(0, Math.min((payload?.steps.length || 1) - 1, i + d)))}
      />

      {onboard && <Onboard onClose={() => setOnboard(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
