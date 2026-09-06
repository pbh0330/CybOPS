// MC-CyCOP situation display - viewer only.
//
// Every number on this screen was produced by the deterministic engine and
// exported by scripts/Export-ReplayData.ps1. Nothing here recomputes mission
// degradation, and nothing here is produced by a language model (ADR-0003).
// If a value looks wrong, the fix belongs in the engine, not in this file.

import './style.css'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { loadSymbology, unmappedTypes, symbolDataUriWithStatus, statusForState } from './symbols.js'
import { buildElements, stylesheet, LAYOUTS, CAUSE_COLOR, degColor, SHAPE_LEGEND } from './graph.js'
import { runStep, containmentCandidates } from './engine.js'
import { createEditor } from './editor.js'

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
  restoreEdits(id)

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

function markEdited(info) {
  edited = true
  rebuildElements()
  persistEdits()
  el.editState.hidden = false
  const added = (graph.assets || []).filter((a) => a._added).length
  const links = (graph.links || []).filter((l) => l._added).length
  el.editState.textContent = `편집됨 (자산 +${added}, 링크 +${links}) · 값은 브라우저 엔진이 재계산`
  render()
  if (info && info.id && cy.$id(info.id).length) cy.$id(info.id).select()
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
  graph = structuredClone(payload.graph)
  edited = false
  el.editState.hidden = true
  rebuildElements()
  cy.layout(LAYOUTS[view] || LAYOUTS.dependency).run()
  render()
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
  el.resetBtn.addEventListener('click', () => {
    if (confirm('편집한 내용을 버리고 원래 시나리오로 되돌린다.')) resetEdits()
  })

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

      // The standard already has a way to draw "this thing is damaged": the
      // status digit of the SIDC. Attack damage gets 3/4 (bar, cross), an
      // outage caused by movement or terrain gets 1 (dashed frame), and an
      // unknown-cause outage is NOT escalated to damaged (ADR-0012).
      if (d.kind === 'asset' && d.assetType) {
        const st = statusForState({ compromise: num(s.compromise?.[d.id]), outageCause: cause })
        paintSymbol(n, symbolDataUriWithStatus(d.assetType, st, { size: 44 }))
      }

      n.style('background-color', degColor(v))
      n.style('border-color', cause ? (CAUSE_COLOR[cause] || '#2a3441') : (hit ? CAUSE_COLOR.attack : '#2a3441'))
      n.style('border-width', cause || hit ? 2.5 : 1.5)

      const inactive = temporal && d.kind === 'task' && d.phase && !activePhases.has(d.phase)
      n.toggleClass('dim', inactive)
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

// Draw the asset symbol, plus the owning unit as a small badge in the corner.
// Both go on as element styles with literal URIs: an image array in the
// stylesheet cannot use data() mappers.
function paintSymbol(n, uri) {
  if (!uri) return
  const d = n.data()
  if (uri !== d.symbol) n.data('symbol', uri)
  if (!d.unitSymbol) return
  n.style({
    'background-image': [uri, d.unitSymbol],
    'background-fit': ['contain', 'contain'],
    'background-width': ['84%', '26%'],
    'background-height': ['84%', '26%'],
    'background-position-x': ['50%', '100%'],
    'background-position-y': ['50%', '100%'],
    'background-image-opacity': [1, 0.75],
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
  const s = payload.steps[idx]
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
    <dl class="kv">${rows.join('')}</dl>`
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
  const shapeSvg = {
    rectangle: '<rect x="1" y="3" width="14" height="10" />',
    'round-rectangle': '<rect x="1" y="3" width="14" height="10" rx="3" />',
    triangle: '<path d="M8 2 L15 14 L1 14 Z" />',
    hexagon: '<path d="M4 3 L12 3 L15 8 L12 13 L4 13 L1 8 Z" />',
    octagon: '<path d="M5 2 L11 2 L14 5 L14 11 L11 14 L5 14 L2 11 L2 5 Z" />',
    barrel: '<path d="M2 4 q6 -3 12 0 v8 q-6 3 -12 0 Z" />',
  }
  el.legend.innerHTML =
    '<span class="item legend-title">원인</span>' +
    causes.map(([k, name]) => `<span class="item"><i class="dot" style="background:${CAUSE_COLOR[k]}"></i>${name}</span>`).join('') +
    '<span class="sep"></span><span class="item legend-title">자산</span>' +
    SHAPE_LEGEND.map((s) => `<span class="item">
      <svg class="shape-ico" viewBox="0 0 16 16" aria-hidden="true">${shapeSvg[s.shape] || shapeSvg.rectangle}</svg>${s.label}
    </span>`).join('') +
    '<span class="sep"></span><span class="item">색 = 저하도, 테두리 = 원인, 심볼의 사선/X = 공격 손상</span>'
}

function num(v) { return typeof v === 'number' ? v : Number(v || 0) }
function pct(v) { return `${(num(v) * 100).toFixed(1)}%` }
