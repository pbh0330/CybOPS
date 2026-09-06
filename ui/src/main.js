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

cytoscape.use(dagre)

const SCENARIOS = ['tacnet-01', 'defnet-01']

const el = {
  scenario: document.getElementById('scenario'),
  cy: document.getElementById('cy'),
  missions: document.getElementById('missions'),
  cuts: document.getElementById('cuts'),
  inspect: document.getElementById('inspect'),
  scrub: document.getElementById('scrub'),
  clock: document.getElementById('clock'),
  stepLabel: document.getElementById('step-label'),
  phaseLine: document.getElementById('phase-line'),
  play: document.getElementById('play'),
  legend: document.getElementById('legend'),
  fit: document.getElementById('fit-btn'),
  labels: document.getElementById('toggle-labels'),
}

let cy = null
let payload = null
let idx = 0
let view = 'dependency'
let timer = null

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
}

async function load(id) {
  stopPlay()
  const res = await fetch(`./data/${id}.replay.json`)
  if (!res.ok) throw new Error(`${id}.replay.json (${res.status})`)
  payload = await res.json()

  const missing = unmappedTypes()
  if (missing.length) console.warn('[symbols] SIDC 미매핑 타입:', missing.join(', '))

  if (cy) cy.destroy()
  cy = cytoscape({
    container: el.cy,
    elements: buildElements(payload.graph),
    style: stylesheet(),
    wheelSensitivity: 0.2,
  })
  cy.on('tap', 'node', (evt) => inspect(evt.target))
  cy.on('tap', (evt) => { if (evt.target === cy) clearInspect() })

  idx = 0
  el.scrub.min = 0
  el.scrub.max = Math.max(0, payload.steps.length - 1)
  el.scrub.value = 0
  applyView(view)
  render()
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
  const s = payload.steps[idx]
  if (!s) return

  const assetOut = s.asset_outage || {}
  const linkOut = s.link_outage || {}
  const activePhases = new Set(s.active_phases || [])
  const temporal = !!payload.graph.timeline

  cy.batch(() => {
    for (const n of cy.nodes()) {
      const d = n.data()
      let v = 0
      if (d.kind === 'asset') v = num(s.asset?.[d.id])
      else if (d.kind === 'service') v = num(s.service?.[d.id])
      else if (d.kind === 'task') v = num(s.task?.[d.id])
      else if (d.kind === 'mission') v = num(s.mission?.[d.id])

      const cause = d.kind === 'asset' ? assetOut[d.id] : null
      n.style('background-color', degColor(v))
      n.style('border-color', cause ? CAUSE_COLOR[cause] || '#2a3441'
        : (v > 0.001 && d.kind === 'asset' && num(s.compromise?.[d.id]) > 0 ? CAUSE_COLOR.attack : '#2a3441'))
      n.style('border-width', cause || num(s.compromise?.[d.id]) > 0 ? 3 : 2)

      const inactive = temporal && d.kind === 'task' && d.phase && !activePhases.has(d.phase)
      n.toggleClass('dim', inactive)
    }
    for (const e of cy.edges('.transport')) {
      const cause = linkOut[e.id()]
      e.toggleClass('cut', !!cause)
      e.style('line-color', cause ? (CAUSE_COLOR[cause] || '#8a8f98') : '#3fa06a')
      e.style('label', cause ? `${e.data('bearer')} · ${cause}` : e.data('bearer'))
    }
  })

  renderMissions(s)
  renderCuts(s, assetOut, linkOut)
  renderClock(s, activePhases)
  if (cy.$(':selected').length) inspect(cy.$(':selected').first())
}

function renderMissions(s) {
  const missions = payload.graph.missions || []
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

function renderCuts(s, assetOut, linkOut) {
  const rows = []
  const assets = payload.graph.assets || []
  const links = payload.graph.links || []
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
  el.stepLabel.textContent = s.label || '—'
  if (s.time_iso) {
    const d = new Date(s.time_iso)
    el.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } else {
    el.clock.textContent = '스냅샷'
  }
  const names = (payload.graph.phases || [])
    .filter((p) => activePhases.has(p.id))
    .map((p) => p.name)
  el.phaseLine.textContent = names.length ? `활성 단계: ${names.join(' · ')}` : '활성 단계 없음'
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
    add('수행 위치', d.performedAt || '—')
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
  el.legend.innerHTML = causes
    .map(([k, name]) => `<span class="item"><i class="dot" style="background:${CAUSE_COLOR[k]}"></i>${name}</span>`)
    .join('') + '<span class="item">노드 색 = 임무 저하도, 테두리 = 원인</span>'
}

function num(v) { return typeof v === 'number' ? v : Number(v || 0) }
function pct(v) { return `${(num(v) * 100).toFixed(1)}%` }
