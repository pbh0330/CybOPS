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
import { sameNet } from './tie-core.mjs'

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

// How many ranked rows a fact list carries when the caller does not say. The
// cut lives here, not at the call sites, so a query that wants a different k
// passes it instead of slicing a list of sentences it did not build.
export const TOP_N = 5

function cutAt(k) {
  const n = Number(k)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : TOP_N
}

// --- asset attribution ----------------------------------------------------
//
// A mission reads 76.2% degraded and nothing says which asset is responsible.
// `missionFacts` splits that number by CAUSE (compromise, environment, their
// interaction); this splits the same number by ASSET.
//
// The method is leave-one-out against the engine, not an inference about it:
// set one asset's compromise back to 0, run the chain again, and the drop in
// the mission's degradation is that asset's contribution. runChain is cheap
// and deterministic, so a contribution here is a measured difference between
// two engine runs rather than a weight fitted to one.
//
// NOTHING IS NORMALISED. Individual contributions do not add up to the total,
// and the gap is reported instead of being scaled away:
//
//   total = floor + joint
//   joint = sum(contributions) + interaction
//
//   floor        what is left when EVERY compromise is set to 0. Outages and
//                environment; no asset's compromise can be charged for it.
//   joint        what the compromises together are worth (total - floor).
//   interaction  joint - sum. Positive where two assets mask each other (a
//                max combine: removing one leaves the other at the same
//                height), negative where a redundancy group needs both of
//                them, because the service multiplies its providers and each
//                one alone then looks decisive. A bar rescaled to add up to
//                the total would hide exactly this term.
//
// `total` is recomputed here rather than read off s.mission, so the total and
// the per-asset values come out of the same engine call and the arithmetic
// above is exact. In the staff query path s.mission IS that same runChain
// output; against an exported replay step the two agree to parity tolerance
// (1e-9), well below the 0.1% the display rounds to.

const ATTR_DP = 9
const r9 = (v) => Number(num(v).toFixed(ATTR_DP))

// A signed %p. The sign is printed rather than assumed: interaction goes
// either way, and so would a contribution if the engine ever stopped being
// monotone in compromise.
const sgnPp = (v) => `${num(v) >= 0 ? '+' : ''}${pp(v)}`

export function attribution(g, s, missionId, method = 'weighted') {
  const t = s && s.t !== undefined && s.t !== null ? Number(s.t) : -1
  const compromise = { ...((s && s.compromise) || {}) }
  const opt = { t, method: method || 'weighted', causes: 'all' }

  const base = runChain(g, compromise, opt)
  const total = num(base.mission[missionId])
  const active = base.mission_active ? base.mission_active[missionId] !== false : true
  const floor = num(runChain(g, {}, opt).mission[missionId])

  // Only assets the graph declares, and only the compromised ones: an asset
  // at 0 did not move the number, so it is not listed as having moved it by 0.
  const ids = (g?.assets || []).map((a) => a.id).filter((id) => num(compromise[id]) > 0).sort()
  const rows = ids.map((id) => {
    const after = num(runChain(g, { ...compromise, [id]: 0 }, opt).mission[missionId])
    return { id, compromise: num(compromise[id]), after, contribution: r9(total - after) }
  })
  rows.sort((a, b) => (b.contribution - a.contribution) || String(a.id).localeCompare(String(b.id)))

  const sum = r9(rows.reduce((acc, x) => acc + x.contribution, 0))
  const joint = r9(total - floor)
  return {
    mission: missionId, t, method: opt.method, active,
    total, floor, joint, rows, sum, interaction: r9(joint - sum),
  }
}

// attribution(), phrased. `opts.data` reuses a result the caller already has,
// so one answer does not run the engine twice; `opts.k` cuts the ranked
// sentences, and the sum is over ALL the rows either way - a cut list must not
// move the number the residual is read off.
export function attributionFacts(g, s, missionId, opts = {}) {
  const o = opts || {}
  const a = o.data || attribution(g, s, missionId, o.method)
  const mRef = refOf('mission', missionId)
  const m = (g?.missions || []).find((x) => x.id === missionId)
  const head = `${missionName(g, missionId)}${m && m.priority !== undefined ? ` P${m.priority}` : ''}`

  if (!a.active) {
    return [fact(`${head} 임무는 현재 단계에 활성 작업이 없어 저하도를 내지 않는다 - 자산별로 가를 것이 없다.`, mRef)]
  }

  const out = [fact(`${head} 임무 저하도 ${pct(a.total)} - 아래는 이것을 자산별 기여로 가른 것이다.`, mRef, a.total, '%')]

  if (a.floor > 1e-9) {
    out.push(fact(
      `${head} 침해를 전부 0 으로 되돌려도 ${pct(a.floor)} 는 남는다 - 단절·환경 몫이고 어느 자산의 침해에도 돌릴 수 없다.`,
      mRef, a.floor, '%',
    ))
  }

  if (!a.rows.length) {
    out.push(a.total > 1e-9
      ? fact(`현 시각 침해된 자산이 없다 - 저하도 ${pct(a.total)} 는 전부 단절·환경에서 왔다.`, mRef, a.total, '%')
      : fact(`현 시각 침해된 자산도 저하도도 없다 (${pct(0)}).`, mRef, 0, '%'))
    return out
  }

  const k = cutAt(o.k)
  for (const r of a.rows.slice(0, k)) {
    out.push(Math.abs(r.contribution) > 1e-9
      ? fact(
        `${nameOf(g, r.id)} 침해 ${pct(r.compromise)} - 이 임무 저하에 ${sgnPp(r.contribution)} 기여 (그 침해만 0 으로 되돌리면 ${pct(a.total)} → ${pct(r.after)}).`,
        refOf('asset', r.id), r.contribution, '%p',
      )
      : fact(
        `${nameOf(g, r.id)} 침해 ${pct(r.compromise)} 이지만 이 임무 저하에는 기여하지 않는다 (${pp(0)}, 되돌려도 ${pct(r.after)}).`,
        refOf('asset', r.id), 0, '%p',
      ))
  }
  if (a.rows.length > k) {
    out.push(fact(
      `침해 자산 ${a.rows.length}개 중 기여 상위 ${k}개만 문장으로 냈다 - 아래 합계는 ${a.rows.length}개 전부로 계산한 것이고, 표에는 전부 들어 있다.`,
      mRef, a.rows.length,
    ))
  }

  out.push(Math.abs(a.interaction) > 1e-9
    ? fact(
      `침해 자산 ${a.rows.length}개의 개별 기여 합 ${sgnPp(a.sum)}, 침해 전체의 몫 ${sgnPp(a.joint)} (${pct(a.total)} - ${pct(a.floor)}), 차이 ${sgnPp(a.interaction)} 는 자산 간 상호작용이다 - 합이 전체와 맞도록 개별 기여를 고치지 않는다.`,
      mRef, a.interaction, '%p',
    )
    : fact(
      `침해 자산 ${a.rows.length}개의 개별 기여 합 ${sgnPp(a.sum)} 이 침해 전체의 몫 ${sgnPp(a.joint)} 과 같다 - 이 구성에서는 상호작용 항이 0 이다 (${pp(0)}).`,
      mRef, 0, '%p',
    ))

  // Measured on tacnet-01: RELAY-1 + SAT-TERM against M-FIRE gives a sum of
  // +17.3%p against a total of 8.6%p. A redundancy group's service multiplies
  // its providers, so returning either one alone makes that one look
  // decisive, and the two leave-one-out runs double-count the same loss. The
  // sum is then not a share of anything and the sentence says so, because a
  // reader who divides it by the total gets 200%.
  if (a.sum > a.total + 1e-9) {
    out.push(fact(
      `개별 기여의 합 ${sgnPp(a.sum)} 이 전체 저하도 ${pct(a.total)} 보다 크다 - 이중화 서비스는 제공 자산을 곱해서 합치므로 하나만 되돌리면 각각이 결정적으로 보인다. 이 합을 전체로 나눠 비율로 읽으면 안 된다.`,
      mRef, a.sum, '%p',
    ))
  }
  return out
}

// game.js staffTable rows, phrased. The order is the table's own (rank); this
// never reorders it (ADR-0003). `g` is optional - without it a row is named by
// its id alone. `blocks`/`gainBlocked` are null in the observe mode, where
// there is no attacker to block: the sentence then says so rather than
// printing a zero that would read as "blocks nothing".
export function containmentFacts(rows, g, k = TOP_N) {
  const list = (rows || []).slice().sort((a, b) => (num(a.rank) - num(b.rank)) || String(a.id).localeCompare(String(b.id)))
  return list.slice(0, cutAt(k)).map((r) => {
    const name = g ? nameOf(g, r.id) : r.id
    const cost = num(r.cost)
    const head = `${name} 격리 - 임무 비용 ${cost >= 0 ? '+' : ''}${pp(cost)}`
    const scored = r.blocks !== null && r.blocks !== undefined
    return fact(
      scored
        ? `${head}, 막는 공격 수 ${num(r.blocks)}개, 차단하는 최대 이득 ${pct(num(r.gainBlocked))}, 순위 ${num(r.rank)}.`
        : `${head}, 순위 ${num(r.rank)} (관측 모드 - 막는 공격 수는 계산하지 않는다).`,
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

// --- the decision record, read out ---------------------------------------
//
// One history row, phrased so a person can reconstruct the moment: what was
// isolated, where the staff table had ranked it, what was ranked first and how
// the two compared, which fact numbers were on screen, the one line the
// operator typed, and what happened to P1 after. Every number here was written
// by the engine at the time (game.js `defend` / `attackerTurn`); nothing is
// recomputed against the present state, because the present state is a
// different turn.
//
// `turn` is the 0-based number history stores (h.turn). The sentences say
// turn + 1, the same off-by-one the panel shows.
//
// The fact ids in `basis` are the numbering of the staff card the operator was
// looking at. They are NOT this answer's F numbers, and the sentence says so -
// a reader who clicks F2 here would otherwise land on an unrelated fact.
function p1MissionOf(g) {
  const m = (g?.missions || []).slice().sort((a, b) => (num(a.priority) || 9) - (num(b.priority) || 9))[0]
  return m ? m.id : null
}

const WHO_KO = { human: '사람(운용자)', system: '시스템' }

export function decisionFacts(g, G, turn) {
  const list = (G && G.history) || []
  const n = Number(turn)
  const h = list.find((x) => Number(x.turn) === n)
  const turnRef = refOf('turn', String(n))
  if (!h) {
    return [fact(`턴 ${n + 1} 에는 기록된 행이 없다 - 결심을 읽을 수 없다.`, turnRef)]
  }
  const head = `턴 ${h.turn + 1}`
  const out = []
  const d = h.defender

  if (!d) {
    out.push(fact(`${head} 방어측은 격리하지 않고 생략했다 - 기록된 결심이 없고, 참모 순위·근거도 남지 않았다.`, turnRef))
  } else {
    const who = WHO_KO[d.actor] || d.actor || '기록 없음'
    out.push(fact(
      `${head} 결심 - ${who}이 ${nameOf(g, d.id)} 을 격리했다. 임무 비용 ${sgnPp(num(d.cost))}.`,
      refOf('asset', d.id), num(d.cost), '%p',
    ))

    const rows = d.staff && d.staff.rows ? Number(d.staff.rows) : null
    out.push(d.rank
      ? fact(
        `${nameOf(g, d.id)} 은 그 턴 참모 표의 후보 ${rows === null ? '?' : rows}개 중 ${d.rank}위였다.`,
        refOf('asset', d.id), d.rank,
      )
      : fact(`${nameOf(g, d.id)} 의 그 턴 참모 순위가 기록되지 않았다 - 순위를 적기 전에 만들어진 행이다.`, refOf('asset', d.id)))

    const top = (d.staff && d.staff.top) || null
    const mine = (d.staff && d.staff.chosen) || null
    if (top && top.id === d.id) {
      out.push(fact('운용자가 고른 것이 그 턴 참모 1위와 같다 - 순위 불일치 없음.', refOf('asset', d.id), 0))
    } else if (top) {
      out.push(fact(
        `그 턴 1위는 ${nameOf(g, top.id)} 였다 - 임무 비용 ${sgnPp(num(top.cost))}, 막는 공격 수 ${num(top.blocks)}개, 순이득 ${sgnPp(num(top.net))}.`,
        refOf('asset', top.id), num(top.net), '%p',
      ))
      if (mine) {
        const dc = Number((num(mine.cost) - num(top.cost)).toFixed(9))
        const db = num(mine.blocks) - num(top.blocks)
        out.push(fact(
          `고른 것과 1위의 비교 - 임무 비용 ${sgnPp(num(mine.cost))} 대 ${sgnPp(num(top.cost))} (차이 ${sgnPp(dc)}), 막는 공격 수 ${num(mine.blocks)}개 대 ${num(top.blocks)}개 (차이 ${db >= 0 ? '+' : ''}${db}개).`,
          refOf('asset', d.id), dc, '%p',
        ))
        // staffTable sorts by net, then by blocks, then by id. When the two
        // rows tie on net the rank gap is that tiebreak and nothing else, and
        // a reader who takes 3위 for "worse" would be reading a sort order as
        // a judgement (the same thing StaffDock's 동률 mark exists to stop).
        //
        // tie-core.mjs's test, shared with game.js (tiedTopOf) and aar.js
        // (classify): this sentence and the AAR card must never disagree
        // about whether the two rows tied.
        if (sameNet(mine.net, top.net)) {
          out.push(fact(
            `고른 것과 1위의 순이득은 같다 (${sgnPp(num(top.net))}) - 순위는 막는 공격 수로 갈린 것이고 우열이 아니다.`,
            refOf('asset', d.id), 0, '%p',
          ))
        }
      }
    } else {
      out.push(fact('그 턴 참모 표의 1위 행이 기록되지 않았다 - 비교할 기준이 없다.', turnRef))
    }

    const basis = (d.basis || [])
    out.push(basis.length
      ? fact(
        `결심 당시 화면에 있던 근거 사실 ${basis.length}개 - ${basis.join('·')} (그 시점 참모 카드의 번호이고, 이 답의 F# 와는 다른 체계다).`,
        turnRef, basis.length,
      )
      : fact('결심 당시의 근거 사실 번호가 기록되지 않았다 - 참모 카드 없이 자산 목록에서 바로 고른 결심이다.', turnRef, 0))

    out.push(d.rationale
      ? fact(`운용자가 적은 한 줄 - "${d.rationale}".`, turnRef)
      : fact('운용자는 한 줄 근거를 적지 않았다 - 선택 입력이고 비어 있어도 결심은 기록된다.', turnRef))

    out.push(d.actor === 'human'
      ? fact('이 격리는 사람이 누른 것이고 자동 실행 경로는 없다 (ADR-0004) - 이 행은 기록이지 명령이 아니다.', turnRef)
      : fact(`이 행은 사람이 아니라 ${who}으로 기록돼 있다 - 사람의 승인 기록이 아니다 (ADR-0004).`, turnRef))
  }

  if (h.attacker && h.attacker.move) {
    const mv = h.attacker.move
    const by = h.attacker.by || '기록 없음'
    const tgt = mv.target ? nameOf(g, mv.target) : '대상 없음'
    out.push(fact(
      `${head} 공격 - ${by} 가 고른 ${mv.label || mv.action}, 대상 ${tgt}, ${h.attacker.success ? '성공' : '실패'}.`,
      mv.target ? refOf('asset', mv.target) : turnRef,
    ))
  } else {
    out.push(fact(`${head} 공격자는 둘 수 있는 수가 없었다 - ${h.reason || '사유 기록 없음'}.`, turnRef))
  }

  const pid = p1MissionOf(g)
  const p1 = num(h.p1)
  out.push(fact(
    `${head} 종료 시 P1 ${pid ? missionName(g, pid) : '임무'} 저하도 ${pct(p1)}.`,
    pid ? refOf('mission', pid) : turnRef, p1, '%',
  ))

  const next = list.find((x) => Number(x.turn) === n + 1)
  out.push(next
    ? fact(
      `다음 턴 ${next.turn + 1} 종료 시 P1 저하도 ${pct(num(next.p1))} - 이 결심 뒤 변화 ${sgnPp(num(next.p1) - p1)}.`,
      pid ? refOf('mission', pid) : turnRef, Number((num(next.p1) - p1).toFixed(9)), '%p',
    )
    : fact('다음 턴 기록이 없다 - 이 턴이 마지막으로 기록된 턴이다.', turnRef))

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
  for (const id of rd.isolated.slice().sort().slice(0, TOP_N)) {
    out.push(fact(`${nameOf(g, id)} 은 어떤 링크에도 연결되지 않았다.`, refOf('asset', id)))
  }
  return out
}
