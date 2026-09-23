// The fact layer (참모 S1, ADR-0003).
//
// The engine decides; this file only phrases what it decided. Every builder
// turns one slice of engine output into short Korean sentences, each carrying
// the raw number it came from and a reference to the node it is about. A later
// layer numbers them (F1, F2, ...) and cites them; nothing here asks a model
// anything, and nothing here computes a state value of its own.
//
// Three rules hold everywhere in this file:
//   1. Numbers come from the engine. `value` is the raw 0~1 value, `text` is
//      the display form through derive.js `pct`, so a fact can never round
//      differently from the panel that shows the same number.
//   2. A sentence names a thing as 이름(ID) - the Korean name a person reads,
//      the id a person greps. Same form staff-llm.mjs used.
//   3. Same input, same output. Anything keyed by object is sorted before it
//      is walked.
//
// `ref` is what makes a fact clickable later: {kind, id} with kind one of
// 'asset' | 'mission' | 'task' | 'service' | 'link' | 'turn'.

import { num, pct, splitBar, linkageOf } from './derive.js'
import { assetName } from './labels.js'
import { compromiseOf } from './game.js'
import { runChain } from './engine.js'
import { footholds } from './attack.js'
import { readiness as readinessOf } from './sandbox.js'

// %p (percentage points) shares the display rule of % so a decomposition can
// never disagree with the total it decomposes.
function pp(v) { return `${pct(v)}p` }

const fact = (text, ref = null, value = null, unit = null) => ({
  text, ref, value: value === null || value === undefined ? null : Number(value), unit: unit || null,
})

const refOf = (kind, id) => ({ kind, id })

function nameOf(g, id) { return `${assetName(g, id).ko}(${id})` }

function labelled(list, id, fallbackKo) {
  const row = (list || []).find((x) => x.id === id)
  const ko = (row && row.name) || fallbackKo || id
  return `${ko}(${id})`
}
const missionName = (g, id) => labelled(g?.missions, id, id)
const serviceName = (g, id) => labelled(g?.services, id, id)
const taskName = (g, id) => labelled(g?.tasks, id, id)

const joinKo = (parts) => parts.join(', ')

// {text,ref,value,unit}[] -> Fact[]. Consumers read .ref/.value/.unit without
// checking, so every field is present even when the builder left it out.
export function numbered(list) {
  return (list || []).map((f, i) => ({
    id: `F${i + 1}`,
    text: String((f && f.text) || ''),
    ref: (f && f.ref) || null,
    value: f && f.value !== undefined && f.value !== null ? Number(f.value) : null,
    unit: (f && f.unit) || null,
  }))
}

// Mission degradation and where it came from. The attribution is splitBar's,
// the same one the mission bar draws - not a second opinion about it.
export function missionFacts(g, s) {
  const missions = (g?.missions || []).slice().sort((a, b) => (num(a.priority) || 9) - (num(b.priority) || 9))
  const out = []
  for (const m of missions) {
    const total = num(s?.mission?.[m.id])
    const active = s?.mission_active ? s.mission_active[m.id] !== false : true
    const ref = refOf('mission', m.id)
    const head = `${missionName(g, m.id)} P${m.priority}`
    if (!active) {
      out.push(fact(`${head} 임무는 현재 단계에 활성 작업이 없어 저하도를 내지 않는다.`, ref))
      continue
    }
    out.push(fact(`${head} 임무 저하도 ${pct(total)}.`, ref, total, '%'))
    if (total > 0) {
      const att = num(s?.mission_attack?.[m.id])
      const env = num(s?.mission_env?.[m.id])
      const parts = splitBar(att, env, total - att - env, total)
      out.push(fact(
        `${head} 저하 ${pct(total)} 의 원인 분해 - 침해 ${pp(parts.attack / 100)}, 환경 ${pp(parts.env / 100)}, 상호작용 ${pp(parts.inter / 100)}.`,
        ref, parts.attack / 100, '%p',
      ))
    }
  }
  return out
}

// One asset, read out: how far it is compromised, what it carries for the
// mission, how it is wired, and whether anything depends on it alone.
export function assetFacts(g, s, id) {
  const a = (g?.assets || []).find((x) => x.id === id)
  if (!a) return []
  const ref = refOf('asset', id)
  const name = nameOf(g, id)
  const out = []

  const comp = num(s?.compromise?.[id])
  out.push(comp > 0
    ? fact(`${name} 침해 ${pct(comp)}.`, ref, comp, '%')
    : fact(`${name} 침해 없음 (${pct(0)}).`, ref, 0, '%'))

  const imp = num(s?.asset?.[id])
  if (Math.abs(imp - comp) > 1e-9) {
    out.push(fact(`${name} 자산 영향도 ${pct(imp)} - 침해값보다 높은 몫은 의존·호스팅으로 전파된 것이다.`, ref, imp, '%'))
  }

  const outage = s?.asset_outage?.[id]
  if (outage) out.push(fact(`${name} 단절 - 원인 ${outage}.`, ref))

  const lk = linkageOf(g, id)
  const roles = []
  if (lk.provides.length) roles.push(`서비스 ${joinKo(lk.provides.slice().sort().map((sid) => serviceName(g, sid)))} 제공`)
  if (lk.hosts.length) roles.push(`작업 ${joinKo(lk.hosts.slice().sort().map((tid) => taskName(g, tid)))} 수행`)
  if (lk.hostedOn.length) roles.push(`${joinKo(lk.hostedOn.slice().sort().map((hid) => nameOf(g, hid)))} 을 호스팅`)
  out.push(roles.length
    ? fact(`${name} 역할 - ${joinKo(roles)}.`, ref)
    : fact(`${name} 은 서비스도 작업도 맡지 않아 임무에 직접 붙어 있지 않다.`, ref))

  const links = (g?.links || []).filter((l) => l.a === id || l.b === id)
  const peers = links.map((l) => (l.a === id ? l.b : l.a)).sort()
  out.push(links.length
    ? fact(`${name} 링크 ${links.length}개 - 이웃 ${joinKo(peers.map((p) => nameOf(g, p)))}.`, ref, links.length)
    : fact(`${name} 은 어떤 링크에도 연결되지 않았다.`, ref, 0))

  const provided = (g?.edges?.provided_by) || []
  const sole = (g?.services || [])
    .filter((svc) => {
      const ps = provided.filter((e) => e.from === svc.id)
      return ps.length === 1 && ps[0].to === id
    })
    .map((svc) => svc.id)
  out.push(sole.length
    ? fact(`${name} 은 서비스 ${joinKo(sole.map((sid) => serviceName(g, sid)))} 의 유일한 제공 자산이다 (단일점).`, ref, sole.length)
    : fact(`${name} 이 유일하게 제공하는 서비스는 없다.`, ref, 0))

  if ((g?.crown_jewels || []).includes(id)) {
    out.push(fact(`${name} 은 핵심 자산(보석)으로 지정돼 있다.`, ref))
  }

  // The isolation what-if the engine already ran at this step: the real cost
  // of containing this asset, not an estimate made here.
  const wf = s?.whatif?.[id]
  if (wf && wf.delta) {
    const ids = Object.keys(wf.delta).sort()
    let worstId = null
    let worst = 0
    for (const mid of ids) {
      const d = num(wf.delta[mid])
      if (d > worst) { worst = d; worstId = mid }
    }
    out.push(worstId
      ? fact(`${name} 을 격리하면 임무 저하도가 가장 많이 오르는 곳은 ${missionName(g, worstId)} ${pp(worst)} 이다.`, ref, worst, '%p')
      : fact(`${name} 을 격리해도 임무 저하도는 오르지 않는다 (${pp(0)}).`, ref, 0, '%p'))
  }

  return out
}

// Services, with their degradation and who provides them. A redundancy group
// is said out loud because it is why two providers do not mean two failures.
export function serviceFacts(g, s) {
  const provided = (g?.edges?.provided_by) || []
  const out = []
  for (const svc of g?.services || []) {
    const ref = refOf('service', svc.id)
    const v = num(s?.service?.[svc.id])
    const providers = provided.filter((e) => e.from === svc.id).map((e) => e.to).sort()
    const who = providers.length ? `제공 자산 ${joinKo(providers.map((p) => nameOf(g, p)))}` : '제공 자산 없음'
    const red = svc.redundancy_group ? ` (이중화 그룹 ${svc.redundancy_group})` : ''
    out.push(fact(`${serviceName(g, svc.id)} 서비스 저하도 ${pct(v)} - ${who}${red}.`, ref, v, '%'))
    const down = providers.filter((p) => num(s?.asset?.[p]) > 0)
    if (v > 0 && down.length) {
      out.push(fact(`${serviceName(g, svc.id)} 저하의 원인 자산 - ${joinKo(down.map((p) => `${nameOf(g, p)} ${pct(num(s?.asset?.[p]))}`))}.`, ref, v, '%'))
    }
  }
  return out
}

// game.js staffTable rows, phrased. The order is the table's own (rank); this
// never reorders it (ADR-0003). `g` is optional - without it a row is named by
// its id alone.
export function containmentFacts(rows, g) {
  const list = (rows || []).slice().sort((a, b) => (num(a.rank) - num(b.rank)) || String(a.id).localeCompare(String(b.id)))
  return list.slice(0, 5).map((r) => {
    const name = g ? nameOf(g, r.id) : r.id
    const cost = num(r.cost)
    return fact(
      `${name} 격리 - 임무 비용 ${cost >= 0 ? '+' : ''}${pp(cost)}, 막는 공격 수 ${num(r.blocks)}개, 차단하는 최대 이득 ${pct(num(r.gainBlocked))}, 순위 ${num(r.rank)}.`,
      refOf('asset', r.id), cost, '%p',
    )
  })
}

// The engagement as it stands: turn, mode, score, where the attacker is, what
// has been isolated, and what the missions read right now. The mission numbers
// come from the same runChain call game.js scores with.
export function gameFacts(g, G) {
  if (!G || !G.cfg) return []
  const turnRef = refOf('turn', String(G.turn))
  const total = num(G.score?.total)
  const out = [
    fact(`턴 ${G.turn + 1}/${G.cfg.turns}, 모드 ${G.cfg.mode}, 공격자 전략 ${G.cfg.strategy}.`, turnRef, G.turn),
    fact(`현재 점수 ${G.cfg.mode === 'hold' ? total.toFixed(2) : total}.`, turnRef, total),
  ]

  const missions = runChain(g, compromiseOf(G), { t: G.cfg.t, method: G.cfg.method || 'weighted', causes: 'all' }).mission
  const sorted = (g?.missions || []).slice().sort((a, b) => (num(a.priority) || 9) - (num(b.priority) || 9))
  for (const m of sorted) {
    const v = num(missions[m.id])
    out.push(fact(`${missionName(g, m.id)} P${m.priority} 임무 저하도 ${pct(v)}.`, refOf('mission', m.id), v, '%'))
  }

  for (const id of footholds(G.attacker, G.isolated).slice().sort()) {
    const lvl = num(G.attacker?.[id])
    out.push(fact(`${nameOf(g, id)} 은 공격자 거점이다 - 장악도 ${pct(lvl)}.`, refOf('asset', id), lvl, '%'))
  }
  for (const id of (G.isolated || []).slice().sort()) {
    out.push(fact(`${nameOf(g, id)} 은 격리돼 있다 - 임무 엔진에는 정지, 공격자에게는 부재.`, refOf('asset', id)))
  }

  const last = (G.history || [])[G.history.length - 1]
  if (last && last.attacker && last.attacker.move) {
    const mv = last.attacker.move
    const tgt = mv.target ? nameOf(g, mv.target) : '대상 없음'
    out.push(fact(`직전 턴 ${last.turn + 1} 공격 - ${mv.label || mv.action} 대상 ${tgt}, ${last.attacker.success ? '성공' : '실패'}.`,
      mv.target ? refOf('asset', mv.target) : turnRef))
  }
  if (G.result) {
    out.push(fact(`교전 종료 - ${G.result.win ? '방어 성공' : '방어 실패'}, 사유 ${G.result.reason}.`, turnRef))
  }
  return out
}

// The sandbox readiness gate (ADR-0027), read out. Counts first - they are
// what the card shows - then one sentence per thing that is still missing, so
// a citation can point at it.
export function readinessFacts(g, r) {
  const rd = r || readinessOf(g)
  const out = [
    fact(`서비스 제공 ${rd.services.ok}/${rd.services.total} - 제공 자산이 있는 서비스 수.`, null, rd.services.ok),
    fact(`작업 배치 ${rd.tasks.ok}/${rd.tasks.total} - 수행 자산이 있는 작업 수.`, null, rd.tasks.ok),
  ]
  const structural = rd.services.missing.length === 0 && rd.tasks.missing.length === 0
  const unreachable = rd.unreachable || []
  if (structural) {
    out.push(fact(`도달성 ${rd.tasks.total - unreachable.length}/${rd.tasks.total} - 수행 자산이 제공 서비스에 링크로 닿는 작업 수.`, null, rd.tasks.total - unreachable.length))
  }
  out.push(fact(`고립 자산 ${rd.isolated.length}개, 핵심 자산(보석) ${rd.jewels}개.`, null, rd.isolated.length))
  out.push(rd.ready
    ? fact('준비도 충족 - 교전 가능.', null)
    : fact('준비도 미충족 - 구성 중이라 교전을 열 수 없다.', null))

  for (const id of rd.services.missing.slice().sort()) {
    out.push(fact(`${serviceName(g, id)} 서비스에 제공 자산이 없다.`, refOf('service', id)))
  }
  for (const id of rd.tasks.missing.slice().sort()) {
    out.push(fact(`${taskName(g, id)} 작업에 수행 자산이 없다.`, refOf('task', id)))
  }
  for (const id of unreachable.slice().sort()) {
    out.push(fact(`${taskName(g, id)} 작업의 수행 자산이 필요한 서비스에 링크로 닿지 않는다.`, refOf('task', id)))
  }
  for (const id of rd.isolated.slice().sort().slice(0, 5)) {
    out.push(fact(`${nameOf(g, id)} 은 어떤 링크에도 연결되지 않았다.`, refOf('asset', id)))
  }
  return out
}
