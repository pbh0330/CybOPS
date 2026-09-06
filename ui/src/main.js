// MC-CyCOP situation display - viewer only.
//
// Every number on this screen was produced by the deterministic engine and
// exported by scripts/Export-ReplayData.ps1. Nothing here recomputes mission
// degradation, and nothing here is produced by a language model (ADR-0003).
// If a value looks wrong, the fix belongs in the engine, not in this file.

import './style.css'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { loadSymbology, unmappedTypes } from './symbols.js'
import { buildElements, stylesheet, LAYOUTS, CAUSE_COLOR, degColor } from './graph.js'
import { runStep, containmentCandidates } from './engine.js'
import { createEditor } from './editor.js'
import { deviceIconDataUri, iconSvgMarkup, serviceIconSvgMarkup } from './icons.js'

cytoscape.use(dagre)

const SCENARIOS = ['tacnet-01', 'defnet-01']

const el = {
  scenario: document.getElementById('scenario'),
  cy: document.getElementById('cy'),
  missions: document.getElementById('missions'),
  cuts: document.getElementById('cuts'),
  actions: document.getElementById('actions'),
  queue: document.getElementById('queue'),
  inspect: document.getElementById('inspect'),
  scrub: document.getElementById('scrub'),
  ribbon: document.getElementById('ribbon'),
  clock: document.getElementById('clock'),
  tOff: document.getElementById('t-off'),
  stepLabel: document.getElementById('step-label'),
  phaseLine: document.getElementById('phase-line'),
  play: document.getElementById('play'),
  legend: document.getElementById('legend'),
  fit: document.getElementById('fit-btn'),
  labels: document.getElementById('toggle-labels'),
  palette: document.getElementById('palette'),
  editState: document.getElementById('edit-state'),
  exportBtn: document.getElementById('export-btn'),
  resetBtn: document.getElementById('reset-btn'),
  undoBtn: document.getElementById('undo-btn'),
  redoBtn: document.getElementById('redo-btn'),
  helpBtn: document.getElementById('help-btn'),
  onboard: document.getElementById('onboard'),
  onboardClose: document.getElementById('onboard-close'),
  onboardStart: document.getElementById('onboard-start'),
  onboardSkip: document.getElementById('onboard-skip'),
}

let cy = null
let payload = null
let idx = 0
let view = 'dependency'
let timer = null

// Editing state. `graph` is the working copy: identical to payload.graph until
// someone edits it, after which every number on screen is recomputed locally
// by engine.js instead of read from the precomputed export. The parity test
// (tools/parity.mjs) is what keeps those two paths agreeing.
let mode = 'observe'
let graph = null
let edited = false
let editor = null

init().catch((e) => {
  console.error(e)
  el.cy.innerHTML = `<div style="padding:24px;color:#e5484d">데이터를 읽지 못했다: ${e.message}<br>
    <code>.\\scripts\\Export-ReplayData.ps1</code> 을 먼저 실행한다.</div>`
})

async function init() {
  await loadSymbology()

  const available = []
  for (const id of SCENARIOS) {
    const res = await fetch(`./data/${id}.replay.json`, { method: 'HEAD' }).catch(() => null)
    if (res && res.ok) available.push(id)
  }
  const list = available.length ? available : SCENARIOS
  el.scenario.innerHTML = list.map((id) => `<option value="${id}">${id}</option>`).join('')
  el.scenario.addEventListener('change', () => load(el.scenario.value))

  bindControls()
  renderLegend()
  await load(list[0])
  maybeShowOnboard()
}

// Onboarding. Someone seeing this screen for the first time has to be told the
// one thing that is not guessable: the layout is a dependency graph, not a map.
// Everything else follows from that.
function maybeShowOnboard() {
  let seen = false
  try { seen = localStorage.getItem('mccycop:onboard:seen') === '1' } catch { /* ignore */ }
  if (!seen) showOnboard(false)
}
function showOnboard() { el.onboard.hidden = false }
function closeOnboard() {
  el.onboard.hidden = true
  if (el.onboardSkip.checked) {
    try { localStorage.setItem('mccycop:onboard:seen', '1') } catch { /* ignore */ }
  }
}

async function load(id) {
  stopPlay()
  const res = await fetch(`./data/${id}.replay.json`)
  if (!res.ok) throw new Error(`${id}.replay.json (${res.status})`)
  payload = await res.json()

  const missing = unmappedTypes()
  if (missing.length) console.warn('[symbols] SIDC 미매핑 타입:', missing.join(', '))

  graph = structuredClone(payload.graph)
  edited = false
  history = []
  future = []
  restoreEdits(id)
  lastSnapshot = structuredClone(graph)

  if (cy) cy.destroy()
  cy = cytoscape({
    container: el.cy,
    elements: buildElements(graph),
    style: stylesheet(),
    wheelSensitivity: 0.2,
  })
  cy.on('tap', 'node', (evt) => {
    if (editor && mode === 'edit' && editor.handleTap(evt.target)) return
    inspect(evt.target)
  })
  cy.on('tap', 'edge', (evt) => {
    if (editor && mode === 'edit') editor.handleTap(evt.target)
  })
  cy.on('tap', (evt) => { if (evt.target === cy) clearInspect() })

  // dev-only handle so the graph can be inspected from the console
  if (import.meta.env && import.meta.env.DEV) window.__cy = cy

  idx = 0
  el.scrub.min = 0
  el.scrub.max = Math.max(0, payload.steps.length - 1)
  el.scrub.value = 0
  buildRibbon()
  applyView(view)
  render()
}

// ---------------------------------------------------------------- edit mode
//
// An edited scenario has no precomputed export, so its numbers come from the
// local engine port. Everything else on screen behaves the same, which is the
// point: you edit the graph and watch the mission bars move.

function currentStep() {
  const base = payload.steps[idx]
  if (!edited) return base
  const t = base && base.t !== undefined && base.t !== null ? Number(base.t) : -1
  const compromise = (base && base.compromise) || {}
  const computed = runStep(graph, compromise, {
    t,
    method: payload.method || 'weighted',
    candidates: containmentCandidates(graph, compromise),
  })
  return { ...computed, label: base?.label, note: base?.note, time_iso: base?.time_iso, t }
}

// Undo history. Snapshots are whole-graph clones: the graph is a few hundred
// objects, so the simple thing is also the fast thing, and a diff-based
// history would be a second place for edits to go wrong.
const HISTORY_MAX = 60
let history = []
let future = []
let lastSnapshot = null

function markEdited(info) {
  // lastSnapshot is the graph as it was before this edit, which is exactly
  // what "what did this change" needs. Computing the delta here rather than at
  // each call site means every edit reports itself: palette adds, links drawn
  // with the link tool, deletions, service attachments.
  const prevGraph = lastSnapshot
  if (lastSnapshot) {
    history.push(lastSnapshot)
    if (history.length > HISTORY_MAX) history.shift()
  }
  future = []
  lastSnapshot = structuredClone(graph)
  edited = true
  rebuildElements()
  persistEdits()
  updateHistoryButtons()
  el.editState.hidden = false
  const added = (graph.assets || []).filter((a) => a._added).length
  const links = (graph.links || []).filter((l) => l._added).length
  el.editState.textContent = `편집됨 (자산 +${added}, 링크 +${links}) · 값은 브라우저 엔진이 재계산`
  render()
  reportDelta(prevGraph)
  // put the new node in the inspector straight away: that panel is where an
  // asset gets attached to a service or a task, and a fresh box that is not
  // attached to anything will not move a single number until it is
  if (info && info.id && cy.$id(info.id).length) {
    const n = cy.$id(info.id)
    n.select()
    if (n.isNode()) inspect(n)
  }
}

// What the edit did to the mission numbers, said out loud. Without this the
// editor is a drawing tool: you change the graph and nothing answers.
function reportDelta(prevGraph) {
  if (!prevGraph) return
  const base = payload.steps[idx]
  const t = base && base.t !== undefined && base.t !== null ? Number(base.t) : -1
  const compromise = (base && base.compromise) || {}
  const method = payload.method || 'weighted'
  let before
  try {
    before = runStep(prevGraph, compromise, { t, method, candidates: [] })
  } catch {
    return
  }
  const after = currentStep()
  const lines = []
  for (const m of graph.missions || []) {
    const a = num(before.mission?.[m.id])
    const b = num(after.mission?.[m.id])
    if (Math.abs(a - b) > 0.0005) {
      const arrow = b < a ? '↓' : '↑'
      lines.push(`${m.name} ${pct(a)} ${arrow} <b>${pct(b)}</b>`)
    }
  }
  toast(lines.length ? lines.join(' · ') : '임무 저하도 변화 없음')
}

// Rebuild the cytoscape graph after a structural edit, keeping the positions
// of nodes that already existed. Re-laying out the whole graph on every click
// makes the canvas jump and the edit unreadable.
function rebuildElements() {
  const pos = {}
  for (const n of cy.nodes()) pos[n.id()] = { ...n.position() }
  const elements = buildElements(graph)
  cy.elements().remove()
  cy.add(elements)
  const fresh = []
  for (const n of cy.nodes()) {
    if (pos[n.id()]) n.position(pos[n.id()])
    else fresh.push(n)
  }
  // place new nodes near the middle of the current viewport
  const ext = cy.extent()
  let k = 0
  for (const n of fresh) {
    n.position({
      x: (ext.x1 + ext.x2) / 2 + (k % 4) * 90 - 135,
      y: (ext.y1 + ext.y2) / 2 + Math.floor(k / 4) * 90,
    })
    k++
  }
  applyViewVisibility()
}

function applyViewVisibility() {
  const transport = cy.edges('.transport')
  const structural = cy.edges().not('.transport')
  const nonAssets = cy.nodes('[kind != "asset"]')
  if (view === 'transport') {
    transport.removeClass('hidden'); structural.addClass('hidden'); nonAssets.addClass('hidden')
  } else {
    transport.addClass('hidden'); structural.removeClass('hidden'); nonAssets.removeClass('hidden')
  }
}

function storageKey() { return `mccycop:edit:${payload?.scenario_id}` }

function persistEdits() {
  try { localStorage.setItem(storageKey(), JSON.stringify(graph)) } catch { /* private mode */ }
}

function restoreEdits(id) {
  try {
    const raw = localStorage.getItem(`mccycop:edit:${id}`)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (saved && saved.scenario_id === id) {
      graph = saved
      edited = true
    }
  } catch { /* ignore */ }
}

function resetEdits() {
  try { localStorage.removeItem(storageKey()) } catch { /* ignore */ }
  history = []
  future = []
  graph = structuredClone(payload.graph)
  lastSnapshot = structuredClone(graph)
  edited = false
  el.editState.hidden = true
  rebuildElements()
  cy.layout(LAYOUTS[view] || LAYOUTS.dependency).run()
  render()
  updateHistoryButtons()
  toast('시나리오를 원래 상태로 되돌렸다')
}

function applySnapshot(g) {
  graph = g
  lastSnapshot = structuredClone(graph)
  edited = JSON.stringify(graph) !== JSON.stringify(payload.graph)
  rebuildElements()
  persistEdits()
  el.editState.hidden = !edited || mode !== 'edit'
  if (edited) {
    const added = (graph.assets || []).filter((a) => a._added).length
    const links = (graph.links || []).filter((l) => l._added).length
    el.editState.textContent = `편집됨 (자산 +${added}, 링크 +${links}) · 값은 브라우저 엔진이 재계산`
  }
  render()
  updateHistoryButtons()
}

function undo() {
  if (!history.length) { toast('되돌릴 편집이 없다'); return }
  future.push(structuredClone(graph))
  applySnapshot(history.pop())
  toast('되돌렸다')
}

function redo() {
  if (!future.length) { toast('다시 실행할 편집이 없다'); return }
  history.push(structuredClone(graph))
  applySnapshot(future.pop())
  toast('다시 실행했다')
}

function updateHistoryButtons() {
  if (el.undoBtn) el.undoBtn.disabled = history.length === 0
  if (el.redoBtn) el.redoBtn.disabled = future.length === 0
}

// The export is a mission.json the pipeline can take straight back:
// Test-Ontology.ps1 validates it, Export-ReplayData.ps1 recomputes it. The
// browser engine is for editing; PowerShell stays the reference (ADR-0003).
function exportScenario() {
  const clean = structuredClone(graph)
  for (const a of clean.assets || []) delete a._added
  for (const l of clean.links || []) delete l._added
  clean.scenario_id = `${clean.scenario_id}-edit`
  clean.authored = new Date().toISOString().slice(0, 10)
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${clean.scenario_id}.mission.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

function setMode(next) {
  mode = next
  for (const b of document.querySelectorAll('.mode-btn')) b.classList.toggle('is-on', b.dataset.mode === next)
  for (const n of document.querySelectorAll('[data-edit-only]')) n.hidden = next !== 'edit'
  el.palette.hidden = next !== 'edit'
  document.body.classList.toggle('is-editing', next === 'edit')
  if (next === 'edit') {
    if (!editor) {
      editor = createEditor({
        paletteEl: el.palette,
        getGraph: () => graph,
        getCy: () => cy,
        onChange: markEdited,
      })
    }
    editor.renderPalette()
    editor.setTool('select')
  }
  if (edited) el.editState.hidden = next !== 'edit'
}

function bindControls() {
  el.scrub.addEventListener('input', () => { idx = Number(el.scrub.value); render() })
  el.play.addEventListener('click', () => (timer ? stopPlay() : startPlay()))
  el.fit.addEventListener('click', () => cy && cy.fit(undefined, 30))
  el.labels.addEventListener('change', () => {
    if (!cy) return
    cy.style().selector('node').style('label', el.labels.checked ? 'data(label)' : '').update()
  })
  for (const btn of document.querySelectorAll('.view-btn')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.view-btn')) b.classList.remove('is-on')
      btn.classList.add('is-on')
      applyView(btn.dataset.view)
    })
  }
  let dragging = false
  el.ribbon.addEventListener('pointerdown', (e) => {
    dragging = true
    el.ribbon.setPointerCapture(e.pointerId)
    stopPlay()
    ribbonSeek(e.clientX)
  })
  el.ribbon.addEventListener('pointermove', (e) => { if (dragging) ribbonSeek(e.clientX) })
  el.ribbon.addEventListener('pointerup', (e) => {
    dragging = false
    el.ribbon.releasePointerCapture(e.pointerId)
  })

  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  }
  for (const btn of document.querySelectorAll('.tool-btn')) {
    btn.addEventListener('click', () => editor && editor.setTool(btn.dataset.tool))
  }
  el.exportBtn.addEventListener('click', exportScenario)
  // Two-step instead of a browser confirm(): a modal dialog blocks the page,
  // and this action is undoable in spirit anyway (the original scenario is
  // always on disk).
  let resetArmed = null
  el.resetBtn.addEventListener('click', () => {
    if (resetArmed) {
      clearTimeout(resetArmed)
      resetArmed = null
      el.resetBtn.textContent = '시나리오 초기화'
      el.resetBtn.classList.remove('is-armed')
      resetEdits()
      return
    }
    el.resetBtn.textContent = '한 번 더 누르면 초기화'
    el.resetBtn.classList.add('is-armed')
    toast('편집 내용과 되돌리기 기록을 전부 버린다. 취소하려면 4초 기다린다')
    resetArmed = setTimeout(() => {
      resetArmed = null
      el.resetBtn.textContent = '시나리오 초기화'
      el.resetBtn.classList.remove('is-armed')
    }, 4000)
  })
  el.undoBtn.addEventListener('click', undo)
  el.redoBtn.addEventListener('click', redo)

  el.helpBtn.addEventListener('click', () => showOnboard(true))
  el.onboardClose.addEventListener('click', () => closeOnboard())
  el.onboardStart.addEventListener('click', () => closeOnboard())
  el.onboard.addEventListener('click', (e) => { if (e.target === el.onboard) closeOnboard() })

  let resizeTimer = null
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { buildRibbon(); updatePlayhead() }, 150)
  })

  document.addEventListener('keydown', (e) => {
    const key = (e.key || '').toLowerCase()
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo(); else undo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); return }
    if (e.key === 'ArrowRight') { idx = Math.min(idx + 1, payload.steps.length - 1); el.scrub.value = idx; render() }
    if (e.key === 'ArrowLeft') { idx = Math.max(idx - 1, 0); el.scrub.value = idx; render() }
    if (e.key === ' ') { e.preventDefault(); timer ? stopPlay() : startPlay() }
  })
}

function startPlay() {
  el.play.textContent = '❚❚'
  timer = setInterval(() => {
    idx = idx + 1
    if (idx >= payload.steps.length) { idx = 0 }
    el.scrub.value = idx
    render()
  }, 900)
}
function stopPlay() {
  if (timer) clearInterval(timer)
  timer = null
  el.play.textContent = '▶'
}

function applyView(v) {
  view = v
  if (!cy) return
  const transport = cy.edges('.transport')
  const structural = cy.edges().not('.transport')
  const nonAssets = cy.nodes('[kind != "asset"]')
  if (v === 'transport') {
    transport.removeClass('hidden')
    structural.addClass('hidden')
    nonAssets.addClass('hidden')
  } else {
    transport.addClass('hidden')
    structural.removeClass('hidden')
    nonAssets.removeClass('hidden')
  }
  const layout = cy.elements().not('.hidden').layout(LAYOUTS[v] || LAYOUTS.dependency)
  layout.run()
  render()
}

function render() {
  if (!payload || !cy) return
  const s = currentStep()
  if (!s) return

  const assetOut = s.asset_outage || {}
  const linkOut = s.link_outage || {}
  const activePhases = new Set(s.active_phases || [])
  const temporal = !!graph.timeline

  cy.batch(() => {
    for (const n of cy.nodes()) {
      const d = n.data()
      let v = 0
      if (d.kind === 'asset') v = num(s.asset?.[d.id])
      else if (d.kind === 'service') v = num(s.service?.[d.id])
      else if (d.kind === 'task') v = num(s.task?.[d.id])
      else if (d.kind === 'mission') v = num(s.mission?.[d.id])

      const cause = d.kind === 'asset' ? assetOut[d.id] : null
      const hit = d.kind === 'asset' && num(s.compromise?.[d.id]) > 0

      if (d.kind === 'asset' && d.assetType) {
        paintSymbol(n, hit ? 'attack' : cause ? 'outage' : 'ok')
      }

      n.style('background-color', degColor(v))
      n.style('border-color', cause ? (CAUSE_COLOR[cause] || '#2a3441') : (hit ? CAUSE_COLOR.attack : '#2a3441'))
      n.style('border-width', cause || hit ? 2.5 : 1.5)
      // a dashed frame is the standard's way of saying "not present as planned",
      // which is what a mobility or terrain outage is (ADR-0012)
      n.style('border-style', cause ? 'dashed' : 'solid')

      const inactive = temporal && d.kind === 'task' && d.phase && !activePhases.has(d.phase)
      n.toggleClass('dim', inactive)

      // An asset with no tie to the mission layer is drawn as unattached. It
      // may still matter as a relay, but nothing about it will move a mission
      // number on its own, and a node that silently does nothing is worse than
      // one that says so.
      if (d.kind === 'asset') n.toggleClass('orphan', !linkageOf(d.id).linked)
    }
    for (const e of cy.edges('.transport')) {
      const cause = linkOut[e.id()]
      e.toggleClass('cut', !!cause)
      e.style('line-color', cause ? (CAUSE_COLOR[cause] || '#8a8f98') : '#2fd18b')
      e.style('label', cause ? `${e.data('bearer')} · ${cause}` : e.data('bearer'))
    }
  })
  startFlow()

  renderMissions(s)
  renderCuts(s, assetOut, linkOut)
  renderActions(s)
  renderBrief(s)
  renderClock(s, activePhases)
  updatePlayhead()
  if (cy.$(':selected').length) inspect(cy.$(':selected').first())
}

// Dashes crawling along a link mean traffic is moving on it. It is decoration
// with one job: a cut link stops moving, so the eye finds the break before it
// finds the label.
let flowRaf = null
let flowOffset = 0
function startFlow() {
  if (flowRaf) return
  const tick = () => {
    flowRaf = requestAnimationFrame(tick)
    if (!cy || view !== 'transport') { return }
    flowOffset = (flowOffset - 0.6) % 26
    const live = cy.edges('.transport').not('.cut').not('.hidden')
    if (live.length) live.style('line-dash-offset', flowOffset)
  }
  flowRaf = requestAnimationFrame(tick)
}

// One picture per node: the device icon. Stacking the 2525 symbol and a unit
// badge on top of it turned every node into a collage, and a node you have to
// decode is worse than one that says less.
//
// State therefore rides on colour, not on extra glyphs:
//   attack      icon goes red, border red
//   outage      icon goes grey, border the cause colour, frame dashed
//   otherwise   icon pale, border neutral
//
// The 2525 identity and the owning unit are still on the node's data and show
// in the inspector panel when a node is selected, so ADR-0013 traceability is
// kept without paying for it on the canvas.
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

function renderMissions(s) {
  const missions = graph.missions || []
  el.missions.innerHTML = missions
    .slice()
    .sort((a, b) => (a.priority || 9) - (b.priority || 9))
    .map((m) => {
      const total = num(s.mission?.[m.id])
      const active = s.mission_active ? s.mission_active[m.id] !== false : true
      const att = num(s.mission_attack?.[m.id])
      const env = num(s.mission_env?.[m.id])
      const inter = total - att - env
      if (!active) {
        return `<div class="mission inactive">
          <div class="mission-head"><span class="mission-name">${m.name}</span>
          <span class="mission-pri">P${m.priority}</span>
          <span class="mission-total">해당 단계 없음</span></div>
          <div class="bar"></div></div>`
      }
      // negative interaction means the two causes overlap; show it by shrinking
      // the single-cause parts proportionally rather than drawing a negative bar
      const parts = splitBar(att, env, inter, total)
      return `<div class="mission">
        <div class="mission-head">
          <span class="mission-name">${m.name}</span>
          <span class="mission-pri">P${m.priority}</span>
          <span class="mission-total">${pct(total)}</span>
        </div>
        <div class="bar">
          <span class="b-attack" style="width:${parts.attack}%"></span>
          <span class="b-env" style="width:${parts.env}%"></span>
          <span class="b-inter" style="width:${parts.inter}%"></span>
        </div>
        <div class="mission-legend">
          <span>공격 ${pct(att)}</span><span>환경 ${pct(env)}</span>
          <span>상호작용 ${inter >= 0 ? '' : '−'}${pct(Math.abs(inter))}</span>
        </div>
      </div>`
    })
    .join('')
}

// total is the truth; att/env/inter are an attribution of it. Draw the bar to
// total length and divide it in the ratio of the (absolute) contributions, so
// a negative interaction never produces a bar longer than the real value.
function splitBar(att, env, inter, total) {
  const mag = Math.abs(att) + Math.abs(env) + Math.abs(inter)
  if (total <= 0 || mag <= 0) return { attack: 0, env: 0, inter: 0 }
  const k = (total * 100) / mag
  return { attack: Math.abs(att) * k, env: Math.abs(env) * k, inter: Math.abs(inter) * k }
}

// Containment candidates, priced. The engine already ran the isolation
// what-if for each of them at each step, so what is shown here is the real
// cost of the action, not an estimate made up at render time.
//
// There is deliberately no execute path in this UI (ADR-0004). The button
// records a request; a human performs the action elsewhere. A demo that
// contains a one-click block would undo the argument the rest of the screen
// is making.
const requests = []

function renderActions(s) {
  const wf = s.whatif || {}
  const missions = graph.missions || []
  const rows = Object.keys(wf).map((id) => {
    const w = wf[id]
    let worst = 0
    const parts = []
    for (const m of missions) {
      const d = num(w.delta?.[m.id])
      if (Math.abs(d) > 0.0005) parts.push({ id: m.id, name: m.name, d })
      if (d > worst) worst = d
    }
    return { id, worst, parts, compromised: num(s.compromise?.[id]) > 0, fullyHit: num(s.compromise?.[id]) >= 0.999 }
  })
  rows.sort((a, b) => (b.compromised - a.compromised) || (a.worst - b.worst))

  el.actions.innerHTML = rows.map((r) => {
    const cost = r.parts.length
      ? r.parts.map((p) => `<span class="${p.d > 0 ? 'cost-up' : 'cost-down'}">${p.id} ${p.d > 0 ? '+' : ''}${(p.d * 100).toFixed(1)}%p</span>`).join(' ')
      : (r.fullyHit
        ? '<span class="cost-none">이미 전면 침해. 격리해도 추가 임무 비용은 없다</span>'
        : '<span class="cost-none">임무 영향 없음</span>')
    return `<div class="action ${r.compromised ? 'is-hot' : ''}">
      <div class="action-head">
        <span class="action-id">${r.id}</span>
        ${r.compromised ? '<span class="tag tag-hot">침해</span>' : ''}
        <span class="action-cost">${(r.worst * 100).toFixed(1)}<small>%p</small></span>
      </div>
      <div class="action-detail">${cost}</div>
      <button type="button" class="req-btn" data-req="${r.id}">승인 요청 기록</button>
    </div>`
  }).join('')

  for (const b of el.actions.querySelectorAll('.req-btn')) {
    b.addEventListener('click', () => {
      const id = b.dataset.req
      const st = payload.steps[idx]
      requests.unshift({ id, t: st.t, when: new Date().toLocaleTimeString('ko-KR', { hour12: false }) })
      renderQueue()
    })
  }
  renderQueue()
}

function renderQueue() {
  if (!requests.length) { el.queue.innerHTML = ''; return }
  el.queue.innerHTML = `<div class="queue-head">승인 대기 (기록 전용, 실행 없음)</div>` +
    requests.slice(0, 5).map((r) => `<div class="queue-row">
      <span class="queue-id">${r.id} 격리</span>
      <span class="queue-meta">t+${r.t}분 · ${r.when}</span>
    </div>`).join('')
}

// ---------------------------------------------------------------- briefing
//
// The one part of this screen a language model wrote. It is kept in its own
// panel, away from the numbers, and every sentence has to point at the fact it
// came from (ADR-0009). A sentence with no citation is labelled 미검증 rather
// than hidden: hiding it would make the panel look better than it is.
//
// The text is generated offline (scripts/Invoke-Briefing.ps1) and checked
// offline (scripts/Test-BriefingCitations.ps1). Nothing here calls a model.

const briefCache = new Map()

async function loadBrief(scenarioId, t) {
  const key = `${scenarioId}|${t}`
  if (briefCache.has(key)) return briefCache.get(key)
  const p = { brief: null, pack: null }
  try {
    const [b, k] = await Promise.all([
      fetch(`./data/${scenarioId}-t${t}.brief.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`./data/${scenarioId}-t${t}.pack.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    p.brief = b
    p.pack = k
  } catch { /* offline bundle without briefings */ }
  briefCache.set(key, p)
  return p
}

function renderBrief(s) {
  const panel = document.getElementById('brief-panel')
  if (!panel) return
  const t = s && s.t !== undefined && s.t !== null ? Number(s.t) : null
  if (t === null || edited) {
    // an edited graph no longer matches the briefing that was written about it
    panel.hidden = true
    return
  }
  loadBrief(payload.scenario_id, t).then(({ brief, pack }) => {
    if (!brief || !brief.text) { panel.hidden = true; return }
    panel.hidden = false
    const facts = new Map((pack?.facts || []).map((f) => [f.id, f.text]))
    const sentences = String(brief.text).split(/(?<=[.!?])\s+/).filter((x) => x.trim())

    const body = sentences.map((raw) => {
      const cites = [...raw.matchAll(/\[(F\d+)\]/g)].map((m) => m[1])
      const text = raw.replace(/\[(F\d+)\]/g, '').replace(/\s+([.,])/g, '$1').trim()
      const chips = cites.map((c) => {
        const tip = facts.get(c) || '근거를 찾지 못했다'
        const bad = facts.has(c) ? '' : ' is-bad'
        return `<button type="button" class="cite-chip${bad}" data-fact="${c}" title="${esc(tip)}">${c}</button>`
      }).join('')
      const unver = cites.length ? '' : '<span class="unverified">미검증</span>'
      return `<p class="brief-s">${esc(text)} ${chips}${unver}</p>`
    }).join('')

    const meta = `<div class="brief-meta">
      <span>${esc(brief.model || '')}</span>
      <span>${esc(brief.prompt_version || '')}</span>
      <span>${sentences.length}문장 · 인용 ${sentences.filter((x) => /\[F\d+\]/.test(x)).length}건</span>
    </div>`

    document.getElementById('brief').innerHTML = body + meta

    for (const btn of document.querySelectorAll('#brief .cite-chip')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.fact
        toast(`<b>${id}</b> ${esc(facts.get(id) || '근거 없음')}`)
      })
    }
  })
}

function renderCuts(s, assetOut, linkOut) {
  const rows = []
  const assets = graph.assets || []
  const links = graph.links || []
  for (const a of assets) {
    const c = assetOut[a.id]
    if (c) rows.push({ what: a.id, cause: c, note: noteFor(a.outages, s.t) })
  }
  for (const l of links) {
    const c = linkOut[l.id]
    if (c) rows.push({ what: `${l.a} ↔ ${l.b}`, cause: c, note: noteFor(l.outages, s.t) })
  }
  for (const [id, v] of Object.entries(s.compromise || {})) {
    if (num(v) > 0) rows.push({ what: id, cause: 'attack', note: `침해 ${pct(num(v))}` })
  }
  el.cuts.innerHTML = rows.length
    ? rows.map((r) => `<div class="cut">
        <span class="cause cause-${r.cause}">${r.cause}</span>
        <span class="what">${r.what}</span>
        <span class="note">${r.note || ''}</span>
      </div>`).join('')
    : '<div class="none">현재 단절·침해 없음</div>'
}

function noteFor(outages, t) {
  for (const o of outages || []) {
    if (t >= o.from && t < o.to) return o.note || ''
  }
  return ''
}

function renderClock(s, activePhases) {
  el.stepLabel.textContent = s.label || '-'
  if (s.time_iso) {
    const d = new Date(s.time_iso)
    el.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    el.tOff.textContent = `+${s.t}분`
  } else {
    el.clock.textContent = '스냅샷'
    el.tOff.textContent = ''
  }
  const names = (graph.phases || [])
    .filter((p) => activePhases.has(p.id))
    .map((p) => p.name)
  el.phaseLine.innerHTML = names.length
    ? `활성 단계 <b>${names.join(' · ')}</b>`
    : '활성 단계 없음'
}

// ---------------------------------------------------------------- ribbon
//
// The strip under the graph is the argument this project is making, drawn as
// one picture: phases on top, cause-coloured outage bands in the middle,
// attack steps at the bottom. Where a red tick sits inside an amber band, the
// operator can see for themselves that two different things are happening at
// once - which is the whole point of separating the causes (ADR-0012).

const RIBBON = { padL: 4, padR: 4, laneH: 13, gap: 5 }

function buildRibbon() {
  const g = graph
  const tl = g.timeline
  if (!tl) { el.ribbon.innerHTML = ''; return }
  const W = el.ribbon.clientWidth || 800
  const H = 66
  const horizon = Number(tl.horizon)
  const x = (t) => RIBBON.padL + (t / horizon) * (W - RIBBON.padL - RIBBON.padR)

  const missions = (g.missions || []).slice().sort((a, b) => (a.priority || 9) - (b.priority || 9))
  const parts = []

  // hour grid
  const tickEvery = horizon > 240 ? 60 : 30
  for (let t = 0; t <= horizon; t += tickEvery) {
    parts.push(`<line x1="${x(t)}" y1="0" x2="${x(t)}" y2="${H}" stroke="#1a2husk" />`.replace('#1a2husk', '#18202b'))
    const d = tl.t0_iso ? new Date(new Date(tl.t0_iso).getTime() + t * 60000) : null
    if (d) {
      parts.push(`<text x="${x(t) + 3}" y="${H - 2}" fill="#5c6b7d" font-size="9">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</text>`)
    }
  }

  // phase lanes, one per mission
  let y = 4
  for (const m of missions) {
    for (const ph of (g.phases || []).filter((p) => p.mission === m.id && p.window)) {
      const x0 = x(ph.window.from)
      const w = Math.max(2, x(ph.window.to) - x0)
      parts.push(`<rect x="${x0}" y="${y}" width="${w}" height="${RIBBON.laneH}" rx="3"
        fill="${m.priority === 1 ? 'rgba(90,169,255,.16)' : 'rgba(180,137,232,.14)'}"
        stroke="${m.priority === 1 ? 'rgba(90,169,255,.4)' : 'rgba(180,137,232,.35)'}" />`)
      if (w > 46) {
        parts.push(`<text x="${x0 + 5}" y="${y + RIBBON.laneH - 3.5}" fill="#9fb0c4" font-size="9.5">${esc(ph.name)}</text>`)
      }
    }
    y += RIBBON.laneH + 3
  }

  // outage bands, cause-coloured
  const bandY = y + 2
  const bands = []
  for (const a of g.assets || []) for (const o of a.outages || []) bands.push({ o, what: a.id })
  for (const l of g.links || []) for (const o of l.outages || []) bands.push({ o, what: l.id })
  for (const b of bands) {
    const c = CAUSE_COLOR[b.o.cause] || CAUSE_COLOR.unknown
    const x0 = x(b.o.from)
    const w = Math.max(2, x(b.o.to) - x0)
    parts.push(`<rect x="${x0}" y="${bandY}" width="${w}" height="9" rx="2" fill="${c}" fill-opacity=".55">
      <title>${esc(b.what)} · ${esc(b.o.cause)} · ${esc(b.o.note || '')}</title></rect>`)
  }

  // attack steps
  const atkY = bandY + 12
  for (const st of (payload.attack?.steps || [])) {
    if (!st.state || Object.keys(st.state).length === 0) continue
    const px = x(st.t)
    parts.push(`<path d="M${px} ${atkY} l4 4 l-4 4 l-4 -4 z" fill="${CAUSE_COLOR.attack}">
      <title>${esc(st.label || '')}</title></path>`)
  }

  parts.push(`<line id="playhead" x1="0" y1="0" x2="0" y2="${H}" stroke="#e6ecf4" stroke-width="1.5" />`)
  parts.push(`<circle id="playknob" cx="0" cy="${H - 6}" r="4" fill="#e6ecf4" />`)

  el.ribbon.setAttribute('viewBox', `0 0 ${W} ${H}`)
  el.ribbon.setAttribute('preserveAspectRatio', 'none')
  el.ribbon.innerHTML = parts.join('')
}

function updatePlayhead() {
  const tl = graph?.timeline
  const head = el.ribbon.querySelector('#playhead')
  const knob = el.ribbon.querySelector('#playknob')
  if (!tl || !head) return
  const W = el.ribbon.clientWidth || 800
  const horizon = Number(tl.horizon)
  const t = payload.steps[idx]?.t ?? 0
  const px = RIBBON.padL + (t / horizon) * (W - RIBBON.padL - RIBBON.padR)
  head.setAttribute('x1', px); head.setAttribute('x2', px)
  knob.setAttribute('cx', px)
}

function ribbonSeek(clientX) {
  const tl = graph?.timeline
  if (!tl) return
  const r = el.ribbon.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (clientX - r.left - RIBBON.padL) / (r.width - RIBBON.padL - RIBBON.padR)))
  const t = frac * Number(tl.horizon)
  let best = 0
  let bestD = Infinity
  payload.steps.forEach((s, i) => {
    const d = Math.abs(Number(s.t) - t)
    if (d < bestD) { bestD = d; best = i }
  })
  idx = best
  el.scrub.value = idx
  render()
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function inspect(node) {
  const d = node.data()
  const s = currentStep()
  const rows = []
  const add = (k, v) => rows.push(`<dt>${k}</dt><dd>${v}</dd>`)
  add('종류', d.kind)
  if (d.kind === 'asset') {
    add('자산 유형', d.assetType)
    add('부대 / 위치', `${d.unit} / ${d.site}`)
    add('기동성', d.mobility)
    add('중계', d.transit ? '가능' : '종단 단말(중계 안 함)')
    add('영향도', pct(num(s.asset?.[d.id])))
    const c = (s.asset_outage || {})[d.id]
    if (c) add('현재 단절', `${c}`)
    if (d.symbol) add('심볼', d.symbolVerified ? '2525 매핑(대조 완료)' : '2525 매핑(<b>미검증</b>)')
  } else if (d.kind === 'service') {
    add('종류', d.serviceKind || '(미지정)')
    add('이중화', d.redundancy || '없음(단일 경로)')
    add('저하도(전역)', pct(num(s.service?.[d.id])))
  } else if (d.kind === 'task') {
    add('단계', `${d.phaseName} (${d.phase})`)
    add('수행 위치', d.performedAt || '-')
    add('중요도', d.criticality)
    add('저하도', pct(num(s.task?.[d.id])))
  } else if (d.kind === 'mission') {
    add('우선순위', `P${d.priority}`)
    add('저하도', pct(num(s.mission?.[d.id])))
    if (s.mission_attack) {
      add('공격 단독', pct(num(s.mission_attack[d.id])))
      add('환경 단독', pct(num(s.mission_env[d.id])))
    }
  }
  el.inspect.className = ''
  el.inspect.innerHTML = `<div class="kv-head"><b>${d.label}</b> <span class="mission-pri">${d.id}</span></div>
    <dl class="kv">${rows.join('')}</dl>` +
    (d.kind === 'asset' ? missionLinkBlock(d) : '')
  wireMissionLinkControls(d)
}

// Wiring a box into the transport graph does not make it matter to a mission.
// It can matter by carrying traffic (links already do that, through
// reachability), but to provide a service or host work it has to be said.
// This block says what the asset is currently attached to, and in edit mode
// lets someone attach it.
function missionLinkBlock(d) {
  const link = linkageOf(d.id)
  const parts = []

  if (link.provides.length) parts.push(`<div class="lk-row"><span class="lk-k">서비스 제공</span> ${link.provides.join(', ')}</div>`)
  if (link.hosts.length) parts.push(`<div class="lk-row"><span class="lk-k">작업 수행</span> ${link.hosts.join(', ')}</div>`)
  if (link.dependedOn.length) parts.push(`<div class="lk-row"><span class="lk-k">피의존</span> ${link.dependedOn.join(', ')}</div>`)
  if (link.hostedOn.length) parts.push(`<div class="lk-row"><span class="lk-k">게스트</span> ${link.hostedOn.join(', ')}</div>`)

  if (!link.linked) {
    parts.push(`<div class="lk-warn">임무 계층에 연결되지 않았다. 중계 경로로는 기여할 수 있으나,
      이 자산 자체가 죽어도 임무 저하도는 움직이지 않는다.</div>`)
  }

  if (mode !== 'edit') {
    return `<div class="linkage"><div class="lk-head">임무 연결</div>${parts.join('') || '<div class="lk-row">없음</div>'}</div>`
  }

  const services = (graph.services || []).map((s) => {
    const on = link.provides.includes(s.id)
    return `<label class="lk-chk"><input type="checkbox" data-svc="${s.id}" ${on ? 'checked' : ''} /> ${s.name} <span class="lk-id">${s.id}</span></label>`
  }).join('')

  const tasks = (graph.tasks || []).map((t) => {
    const on = t.performed_at === d.id
    return `<label class="lk-chk"><input type="checkbox" data-task="${t.id}" ${on ? 'checked' : ''} /> ${t.name} <span class="lk-id">${t.id}</span></label>`
  }).join('')

  return `<div class="linkage">
    <div class="lk-head">임무 연결</div>
    ${parts.join('')}
    <div class="lk-group"><div class="lk-sub">이 자산이 제공하는 서비스</div>${services}</div>
    <div class="lk-group"><div class="lk-sub">이 자산에서 수행하는 작업</div>${tasks}</div>
    <label class="lk-chk"><input type="checkbox" data-transit ${d.transit ? 'checked' : ''} /> 남의 트래픽을 중계한다</label>
  </div>`
}

function linkageOf(assetId) {
  const E = graph.edges || {}
  const provides = (E.provided_by || []).filter((e) => e.to === assetId).map((e) => e.from)
  const hosts = (graph.tasks || []).filter((t) => t.performed_at === assetId).map((t) => t.id)
  const dependedOn = (E.depends_on || []).filter((e) => e.to === assetId).map((e) => e.from)
  const hostedOn = (E.hosted_on || []).filter((e) => e.to === assetId).map((e) => e.from)
  return { provides, hosts, dependedOn, hostedOn, linked: provides.length + hosts.length + dependedOn.length + hostedOn.length > 0 }
}

function wireMissionLinkControls(d) {
  if (mode !== 'edit' || !editor || d.kind !== 'asset') return
  const box = el.inspect.querySelector('.linkage')
  if (!box) return

  for (const cb of box.querySelectorAll('input[data-svc]')) {
    cb.addEventListener('change', () => {
      const chosen = [...box.querySelectorAll('input[data-svc]')].filter((x) => x.checked).map((x) => x.dataset.svc)
      editor.setProvidedBy(d.id, chosen)
    })
  }
  for (const cb of box.querySelectorAll('input[data-task]')) {
    cb.addEventListener('change', () => {
      editor.setPerformedAt(cb.dataset.task, cb.checked ? d.id : null)
    })
  }
  const tr = box.querySelector('input[data-transit]')
  if (tr) tr.addEventListener('change', () => editor.setTransit(d.id, tr.checked))
}


let toastTimer = null
function toast(html) {
  let box = document.getElementById('toast')
  if (!box) {
    box = document.createElement('div')
    box.id = 'toast'
    box.className = 'toast'
    document.body.appendChild(box)
  }
  box.innerHTML = html
  box.classList.add('is-on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => box.classList.remove('is-on'), 4200)
}

function clearInspect() {
  if (cy) cy.$(':selected').unselect()
  el.inspect.className = 'inspect-empty'
  el.inspect.textContent = '노드를 클릭하면 기여 경로가 나온다.'
}

function renderLegend() {
  const causes = [
    ['attack', '공격'],
    ['mobility', '기동'],
    ['terrain', '지형'],
    ['maintenance', '정비'],
    ['unknown', '미상'],
  ]
  const devices = [
    ['c2-server', '서버'],
    ['database', 'DB'],
    ['c2-terminal', '단말'],
    ['radio-relay', '중계소'],
    ['satcom-terminal', '위성'],
    ['gateway', '라우터'],
    ['firewall', '방화벽'],
    ['observer-terminal', '관측 단말'],
  ]
  const services = [
    ['messaging', '메시징'],
    ['voice', '음성'],
    ['fire-control', '사격지휘'],
    ['position-reporting', '위치보고'],
    ['intel', '정보'],
    ['directory', '인증'],
  ]
  el.legend.innerHTML =
    '<span class="item legend-title">원인</span>' +
    causes.map(([k, name]) => `<span class="item"><i class="dot" style="background:${CAUSE_COLOR[k]}"></i>${name}</span>`).join('') +
    '<span class="sep"></span><span class="item legend-title">서비스</span>' +
    services.map(([k, label]) => `<span class="item">${serviceIconSvgMarkup(k, { size: 16 })}${label}</span>`).join('') +
    '<span class="sep"></span><span class="item legend-title">자산</span>' +
    devices.map(([t, label]) => `<span class="item">${iconSvgMarkup(t, { size: 17 })}${label}</span>`).join('') +
    '<span class="sep"></span><span class="item">아이콘 색: 흰=정상, <b style="color:#ffb4ba">붉음=공격</b>, 회색+점선 테두리=단절</span>'
}

function num(v) { return typeof v === 'number' ? v : Number(v || 0) }
function pct(v) { return `${(num(v) * 100).toFixed(1)}%` }
