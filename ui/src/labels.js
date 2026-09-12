// Human-readable names for assets.
//
// The scenario data already carries Korean: `site` ("2중대 지휘차", "여단 TOC")
// and `unit` -> units[].name ("2중대", "포병중대"). Only the asset TYPE was
// English, and the ids ("CO2-VEH", "FDC-SRV") were the only thing on screen.
//
// An id is a cross-reference key, not a name. It has to stay visible so the
// screen can be matched against logs and the engine export, but it should not
// be the first thing read. So: Korean first, id underneath.

// Same wording as the edit palette (editor.js PALETTE) - one vocabulary for
// the whole product, not two.
export const TYPE_KO = {
  'c2-server': 'C2 서버',
  'c2-terminal': 'C2 단말',
  'workstation': '워크스테이션',
  'terminal': '단말',
  'radio-relay': '무선 중계소',
  'satcom-terminal': '위성 단말',
  'gateway': '게이트웨이',
  'switch': '스위치',
  'firewall': '방화벽',
  'fire-control-server': '사격지휘 서버',
  'database': '데이터베이스',
  'file-server': '파일 서버',
  'mail-server': '메일 서버',
  'web-server': '웹 서버',
  'domain-controller': '도메인 컨트롤러',
  'hypervisor': '하이퍼바이저',
  'observer-terminal': '관측반 단말',
}

export function typeKo(type) { return TYPE_KO[type] || type || '' }

function unitIndex(graph) {
  const m = {}
  for (const u of graph?.units || []) m[u.id] = u.name || u.id
  return m
}

// The primary line is the SITE, not the type: the device icon already says
// what kind of machine it is, so repeating that in text buys nothing. Where
// the asset sits and whose it is are what the id was hiding.
export function assetName(graph, id) {
  const a = (graph?.assets || []).find((x) => x.id === id)
  if (!a) return { id, ko: id, site: '', typeKo: '', unit: '', twoLine: id }
  const units = unitIndex(graph)
  const site = a.site || ''
  const unit = units[a.unit] || ''
  const ko = site || unit || typeKo(a.type) || id
  return {
    id,
    ko,
    site,
    unit,
    typeKo: typeKo(a.type),
    // canvas label: meaning first, cross-reference key second
    twoLine: site ? `${site}\n${id}` : id,
  }
}

// "2중대 지휘차 · C2 단말" - for panels, where there is room for both.
export function assetLong(graph, id) {
  const n = assetName(graph, id)
  if (!n.site && !n.typeKo) return id
  return [n.site, n.typeKo].filter(Boolean).join(' · ')
}

// Links are named by their endpoints, so they inherit the same treatment.
export function linkName(graph, link) {
  const a = assetName(graph, link.a)
  const b = assetName(graph, link.b)
  return `${a.ko} ↔ ${b.ko}`
}
