// Wargame turn loop (ADR-0019, ADR-0003, ADR-0004).
//
// attack.js has had the whole adversary engine in it for a while - legal move
// enumeration, seeded adjudication, greedy and random choosers - and none of it
// was on screen. It ran from the command line and produced a table in
// docs/13-adversary-comparison.md. That is a measurement, not a picture, and
// the thing this project is supposed to demonstrate is that a scenario is not
// a script: you add an asset, the attacker sees it, and the mission number
// moves.
//
// So this is the turn loop with a face on it. Nothing new is computed here.
// Every number comes from attack.js and engine.js, which is the same code path
// ui/tools/redteam.mjs uses and ui/tools/parity.mjs checks against the
// PowerShell reference.
//
// THREE BOUNDARIES ARE LOAD BEARING
//
// 1. The model never decides an outcome. It picks one of the enumerated legal
//    moves; the roll is a seeded PRNG in attack.js. An illegal move has no way
//    to exist because the id is not in the set (ADR-0003).
// 2. Both sides are scored on the same number the mission panel shows. The
//    attacker's "gain" is the increase in the same weighted mission
//    degradation the defender is looking at.
// 3. Nothing here touches a network or a device. Isolating an asset sets a
//    value in a simulated state (ADR-0004 forbids an execution path, and this
//    is not one - there is nothing at the other end).

import { legalMoves, scoreMoves, playTurn, greedyChooser, randomChooser, footholds } from './attack.js'

const DEFAULT_MODEL = 'qwen2.5:7b-instruct-q4_K_M'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434'

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

const pct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`

// A lateral move is enumerated once per foothold it could be launched from, so
// three different moves can share a target and read as one line repeated three
// times. They are not the same move - they have different ids, different
// preconditions and, once one lands, different follow-ups. Show the origin.
function moveWhere(m) {
  if (m.from && m.target && m.from !== m.target) {
    return `<b>${esc(m.from)}</b> → <b>${esc(m.target)}</b>`
  }
  return m.target ? `<b>${esc(m.target)}</b>` : ''
}

export function createWargame({ mountEl, getGraph, getT, getMethod, onChange }) {
  let active = false
  let state = {}
  let baseline = {}
  let turn = 0
  let seed = 20260906
  let strategy = 'greedy'
  let busy = false
  let last = null
  const log = []
  let llm = null
  let llmStats = null

  // The LLM chooser is loaded on demand. It is the only part of this screen
  // that talks to anything outside the browser, and a demo machine with no
  // model server should not pay for it (ADR-0007: the model is swappable, so
  // nothing above depends on it being there).
  async function getLlmChooser() {
    if (!llm) {
      const mod = await import('./attack-llm.mjs')
      // createLLMChooser returns the chooser function itself, with .stats and
      // .config hung off it. It is not { chooser, stats }.
      llm = mod.createLLMChooser({
        endpoint: DEFAULT_ENDPOINT,
        model: DEFAULT_MODEL,
        seed,
        verbose: false,
      })
      llmStats = llm.stats
    }
    return llm
  }

  function start(initial) {
    baseline = { ...(initial || {}) }
    state = { ...baseline }
    turn = 0
    last = null
    log.length = 0
    active = true
    render()
  }

  function stop() {
    active = false
    render()
  }

  function reset() {
    state = { ...baseline }
    turn = 0
    last = null
    log.length = 0
    render()
    onChange && onChange()
  }

  async function step() {
    if (busy || !active) return
    const g = getGraph()
    const t = getT()
    const method = getMethod()
    if (!footholds(state).length) {
      last = { none: true, why: '거점이 없다. 공격자는 아무것도 볼 수 없다.' }
      render()
      return
    }

    busy = true
    render()
    try {
      let chooser
      if (strategy === 'random') chooser = randomChooser(seed + turn)
      else if (strategy === 'llm') {
        // playTurn's chooser is synchronous, so the model is asked first and
        // the answer handed back as a constant. redteam.mjs does the same, and
        // it matters that it is the same: the CLI numbers and the screen must
        // come from one path.
        const legal = scoreMoves(g, state, t, legalMoves(g, state, t), method)
        const pick = await (await getLlmChooser())(legal, { g, state, t, turn })
        chooser = () => pick
      } else chooser = greedyChooser

      const r = playTurn(g, state, t, { method, seed, turn, chooser })
      if (r.move) {
        state = r.state
        last = r
        log.unshift({
          turn, t,
          label: r.move.label,
          target: r.move.target,
          from: r.move.from,
          technique: r.move.technique,
          gain: r.move.gain,
          p: r.move.p,
          roll: r.roll,
          success: r.success,
          rationale: r.rationale,
          strategy,
        })
        turn++
      } else {
        last = { none: true, why: r.reason || '합법수가 없다.' }
      }
    } catch (e) {
      last = { error: String((e && e.message) || e) }
    } finally {
      busy = false
      render()
      onChange && onChange()
    }
  }

  // Defender move. Isolation is modelled the way the containment panel already
  // models it: the asset stops contributing. It costs whatever it costs, and
  // the cost shows up in the same mission bars.
  function isolate(id) {
    if (!active || !id) return
    state = { ...state, [id]: 1 }
    log.unshift({ turn, t: getT(), defender: true, target: id, label: '격리 (모의)' })
    render()
    onChange && onChange()
  }

  function render() {
    if (!mountEl) return
    if (!active) { mountEl.innerHTML = ''; return }

    const g = getGraph()
    const t = getT()
    const method = getMethod()
    let legal = []
    try { legal = scoreMoves(g, state, t, legalMoves(g, state, t), method) } catch { legal = [] }
    legal.sort((a, b) => (b.gain - a.gain) || (b.p - a.p))

    const own = footholds(state)
    const top = legal.slice(0, 6)
    const maxGain = Math.max(1e-9, ...top.map((m) => m.gain))

    const head = `
      <div class="wg-head">
        <span class="wg-turn">턴 ${turn}</span>
        <span class="wg-foot-count">거점 ${own.length}</span>
        <button type="button" class="wg-reset" data-wg="reset">초기화</button>
      </div>
      <div class="wg-controls">
        <label class="wg-pick">
          <span>공격자</span>
          <select data-wg="strategy">
            <option value="greedy"${strategy === 'greedy' ? ' selected' : ''}>greedy (대조군)</option>
            <option value="random"${strategy === 'random' ? ' selected' : ''}>random (하한)</option>
            <option value="llm"${strategy === 'llm' ? ' selected' : ''}>LLM (${esc(DEFAULT_MODEL.split(':')[0])})</option>
          </select>
        </label>
        <label class="wg-pick">
          <span>시드</span>
          <input type="number" data-wg="seed" value="${seed}" step="1" />
        </label>
        <button type="button" class="wg-go" data-wg="step"${busy ? ' disabled' : ''}>
          ${busy ? (strategy === 'llm' ? '모델 응답 대기' : '진행 중') : '1턴 진행'}
        </button>
      </div>`

    let result = ''
    if (last && last.error) {
      result = `<div class="wg-result is-bad">모델 호출 실패: ${esc(last.error)}
        <span>Ollama 가 떠 있는지 확인한다. greedy 와 random 은 모델 없이 동작한다.</span></div>`
    } else if (last && last.none) {
      result = `<div class="wg-result">${esc(last.why)}</div>`
    } else if (last && last.move) {
      const m = last.move
      result = `<div class="wg-result ${last.success ? 'is-hit' : 'is-miss'}">
        <div class="wg-result-top">
          <b>${esc(m.label)}</b>
          <span class="wg-target">${m.from && m.target && m.from !== m.target ? esc(m.from) + ' -> ' + esc(m.target) : esc(m.target || '')}</span>
          <span class="wg-verdict">${last.success ? '성공' : '실패'}</span>
        </div>
        <div class="wg-roll">판정 ${last.roll} ${last.success ? '&lt;' : '&ge;'} ${m.p}
          · 예상 이득 ${pct(m.gain)} · ${esc(m.technique)}</div>
        ${last.rationale ? `<div class="wg-why">${esc(last.rationale)}</div>` : ''}
      </div>`
    }

    const moves = top.length
      ? `<div class="wg-moves">
          <div class="wg-sub">공격자가 지금 둘 수 있는 수 ${legal.length}개 중 상위 ${top.length}</div>
          ${top.map((m) => `
            <div class="wg-move">
              <div class="wg-move-bar" style="width:${Math.round((m.gain / maxGain) * 100)}%"></div>
              <span class="wg-move-label">${esc(m.label)} ${moveWhere(m)}</span>
              <span class="wg-move-gain">${pct(m.gain)}</span>
            </div>`).join('')}
        </div>`
      : '<div class="wg-sub">둘 수 있는 수가 없다.</div>'

    const isolatable = (g.assets || [])
      .map((a) => a.id)
      .filter((id) => Number(state[id] || 0) < 1)
    const defence = `
      <div class="wg-defence">
        <div class="wg-sub">방어측 - 격리 (모의)</div>
        <div class="wg-def-row">
          <select data-wg="iso">
            <option value="">자산 선택</option>
            ${isolatable.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('')}
          </select>
          <button type="button" data-wg="isolate">격리</button>
        </div>
      </div>`

    const logHtml = log.length
      ? `<div class="wg-log">${log.slice(0, 12).map((r) => `
          <div class="wg-log-row${r.defender ? ' is-def' : r.success ? ' is-hit' : ' is-miss'}">
            <span class="wg-log-turn">T${r.turn}</span>
            <span class="wg-log-what">${esc(r.label)} ${r.from && r.target && r.from !== r.target
              ? `${esc(r.from)} → ${esc(r.target)}` : esc(r.target || '')}</span>
            ${r.defender ? '<span class="wg-log-tag">방어</span>'
              : `<span class="wg-log-tag">${r.success ? '성공' : '실패'}</span>`}
          </div>`).join('')}</div>`
      : ''

    mountEl.innerHTML = head + result + moves + defence + logHtml
  }

  mountEl && mountEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wg]')
    if (!b) return
    const k = b.dataset.wg
    if (k === 'step') step()
    else if (k === 'reset') reset()
    else if (k === 'isolate') {
      const sel = mountEl.querySelector('[data-wg="iso"]')
      if (sel && sel.value) isolate(sel.value)
    }
  })
  mountEl && mountEl.addEventListener('change', (e) => {
    const n = e.target.closest('[data-wg]')
    if (!n) return
    if (n.dataset.wg === 'strategy') { strategy = n.value; render() }
    else if (n.dataset.wg === 'seed') { seed = Number(n.value) || 0; llm = null }
  })

  return {
    start, stop, reset, render,
    isActive: () => active,
    getState: () => state,
    getTurn: () => turn,
    getLog: () => log.slice(),
    getLlmStats: () => llmStats,
  }
}
