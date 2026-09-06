// Scenario editor. Packet Tracer in shape: a palette of device types on the
// left, click to place, a link tool to wire two of them together.
//
// The difference from Packet Tracer is what the wiring means here. This is not
// a network you are building for its own sake; every asset and link changes
// which missions can still be performed, and that number is recomputed on
// every edit by src/engine.js (which is parity-checked against the PowerShell
// reference in tools/parity.mjs).
//
// Edits stay local: they are held in memory, mirrored to localStorage, and
// exported as a mission.json the pipeline can take back. Nothing here writes
// to the repository.

import { symbolDataUri } from './symbols.js'

// The palette. Types match configs/symbology-2525.json so a placed node gets a
// real symbol rather than a blank box.
export const PALETTE = [
  { group: '지휘통제', items: [
    { type: 'c2-server', label: 'C2 서버', transit: true },
    { type: 'c2-terminal', label: 'C2 단말', transit: false },
    { type: 'workstation', label: '워크스테이션', transit: false },
    { type: 'terminal', label: '단말', transit: false },
  ] },
  { group: '통신', items: [
    { type: 'radio-relay', label: '무선 중계소', transit: true },
    { type: 'satcom-terminal', label: '위성 단말', transit: true },
    { type: 'gateway', label: '게이트웨이', transit: true },
    { type: 'switch', label: '스위치', transit: true },
    { type: 'firewall', label: '방화벽', transit: true },
  ] },
  { group: '서버', items: [
    { type: 'fire-control-server', label: '사격지휘 서버', transit: true },
    { type: 'database', label: '데이터베이스', transit: true },
    { type: 'file-server', label: '파일 서버', transit: true },
    { type: 'mail-server', label: '메일 서버', transit: true },
    { type: 'web-server', label: '웹 서버', transit: true },
    { type: 'domain-controller', label: '도메인 컨트롤러', transit: true },
    { type: 'hypervisor', label: '하이퍼바이저', transit: true },
  ] },
  { group: '관측', items: [
    { type: 'observer-terminal', label: '관측반 단말', transit: false },
  ] },
]

const BEARERS = ['wired', 'vhf', 'hf', 'satcom', 'lte']

export function createEditor({ paletteEl, onChange, getGraph, getCy }) {
  let tool = 'select'
  let linkFrom = null

  function nextId(prefix) {
    const g = getGraph()
    const used = new Set((g.assets || []).map((a) => a.id))
    let i = 1
    while (used.has(`${prefix}-${String(i).padStart(2, '0')}`)) i++
    return `${prefix}-${String(i).padStart(2, '0')}`
  }

  function idPrefix(type) {
    const map = {
      'c2-server': 'SRV', 'c2-terminal': 'CP', workstation: 'WKS', terminal: 'TERM',
      'radio-relay': 'RELAY', 'satcom-terminal': 'SAT', gateway: 'GW', switch: 'SW',
      firewall: 'FW', 'fire-control-server': 'FDC', database: 'DB', 'file-server': 'FS',
      'mail-server': 'MAIL', 'web-server': 'WEB', 'domain-controller': 'DC',
      hypervisor: 'ESX', 'observer-terminal': 'FO',
    }
    return map[type] || 'NODE'
  }

  function addAsset(item) {
    const g = getGraph()
    const id = nextId(idPrefix(item.type))
    g.assets.push({
      id,
      type: item.type,
      unit: (g.units && g.units[0] && g.units[0].id) || null,
      site: '신규',
      os: 'unknown',
      mobility: 'static',
      transit: item.transit,
      _added: true,
    })
    onChange({ reason: 'add-asset', id })
    return id
  }

  function addLink(a, b) {
    const g = getGraph()
    if (a === b) return null
    const exists = (g.links || []).some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))
    if (exists) return null
    if (!g.links) g.links = []
    let i = g.links.length + 1
    const used = new Set(g.links.map((l) => l.id))
    while (used.has(`L-NEW-${i}`)) i++
    const id = `L-NEW-${i}`
    g.links.push({ id, a, b, bearer: 'wired', _added: true })
    onChange({ reason: 'add-link', id })
    return id
  }

  // Removing an asset removes what pointed at it too. A dangling edge is not a
  // smaller problem than a missing node: the validator would reject the export
  // and the engine would read a hole as "unreachable".
  function removeAsset(id) {
    const g = getGraph()
    g.assets = (g.assets || []).filter((a) => a.id !== id)
    g.links = (g.links || []).filter((l) => l.a !== id && l.b !== id)
    const E = g.edges || {}
    E.provided_by = (E.provided_by || []).filter((e) => e.to !== id)
    E.hosted_on = (E.hosted_on || []).filter((e) => e.from !== id && e.to !== id)
    E.depends_on = (E.depends_on || []).filter((e) => e.from !== id && e.to !== id)
    g.tasks = (g.tasks || []).map((t) => (t.performed_at === id ? { ...t, performed_at: null } : t))
    g.crown_jewels = (g.crown_jewels || []).filter((c) => c !== id)
    onChange({ reason: 'remove-asset', id })
  }

  function removeLink(id) {
    const g = getGraph()
    g.links = (g.links || []).filter((l) => l.id !== id)
    onChange({ reason: 'remove-link', id })
  }

  function setTool(next) {
    tool = next
    linkFrom = null
    const cy = getCy()
    if (cy) cy.elements().removeClass('link-src')
    for (const b of document.querySelectorAll('.tool-btn')) {
      b.classList.toggle('is-on', b.dataset.tool === next)
    }
  }

  // click behaviour depends on the active tool, the way a drawing app works
  function handleTap(target) {
    const cy = getCy()
    if (tool === 'delete') {
      if (target.isNode && target.isNode() && target.data('kind') === 'asset') removeAsset(target.id())
      else if (target.isEdge && target.isEdge() && target.hasClass('transport')) removeLink(target.id())
      return true
    }
    if (tool === 'link') {
      if (!target.isNode || !target.isNode() || target.data('kind') !== 'asset') return true
      if (!linkFrom) {
        linkFrom = target.id()
        target.addClass('link-src')
        return true
      }
      const from = linkFrom
      linkFrom = null
      if (cy) cy.elements().removeClass('link-src')
      addLink(from, target.id())
      return true
    }
    return false
  }

  function renderPalette() {
    paletteEl.innerHTML = `
      <div class="palette-head">
        <h2>자산 팔레트</h2>
        <p>클릭하면 캔버스에 추가된다. <b>연결</b> 도구로 두 자산을 차례로 누르면 링크가 생긴다.</p>
      </div>
      ${PALETTE.map((grp) => `
        <div class="palette-group">
          <div class="palette-group-name">${grp.group}</div>
          <div class="palette-items">
            ${grp.items.map((it) => {
              const uri = symbolDataUri(it.type, { size: 34 })
              return `<button type="button" class="palette-item" data-type="${it.type}" title="${it.label} (${it.type})">
                ${uri ? `<img src="${uri}" alt="" />` : '<span class="palette-blank"></span>'}
                <span class="palette-label">${it.label}</span>
              </button>`
            }).join('')}
          </div>
        </div>`).join('')}
      <div class="palette-note">
        추가한 자산은 아직 어떤 서비스도 제공하지 않는다. 임무 저하도에 영향을 주려면
        서비스에 연결하거나 작업의 수행 위치로 지정해야 한다.
      </div>`

    for (const btn of paletteEl.querySelectorAll('.palette-item')) {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type
        let item = null
        for (const g of PALETTE) for (const it of g.items) if (it.type === type) item = it
        if (item) addAsset(item)
      })
    }
  }

  return { renderPalette, setTool, handleTap, addLink, removeAsset, removeLink, get tool() { return tool }, BEARERS }
}
