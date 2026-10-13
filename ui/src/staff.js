// The staff query catalogue (참모 S1, ADR-0003 / ADR-0004).
//
// A closed set of read-only questions. Each one runs the deterministic engine,
// hands the numbers to facts.js to be phrased, and returns an Answer. There is
// no model in this file and no model is needed to use it: the dock's buttons
// call `ask` directly, and S2's router will only ever pick an id out of
// `catalog(ctx)` - it cannot invent a question, an argument or an action.
//
// Four rules hold for every query here:
//   1. **Read-only.** `Answer.actions` is always [] in S1. Isolation is a
//      person pressing a button in the wargame (ADR-0004); the answer panel
//      has no execution path at all.
//   2. **The engine owns every number.** A query calls runChain/runStep/
//      staffTable and phrases what comes back. It never computes a
//      degradation, a cost or a ranking of its own (ADR-0003).
//   3. **One definition of isolation cost.** In a game that definition is
//      game.js `isolationCost`, reached through `staffTable`. Outside a game
//      the same expression is rebuilt from `weightedOf` imported from game.js
//      - the formula is not copied, only the loop around it.
//   4. **The catalogue is the gate.** `needs` keeps a question out of the list
//      where it would make no sense, so the question cannot be asked at all
//      rather than being asked and answered with nulls.
//
// ctx = { graph, step, game, sandbox, method? }
//   graph   the scenario graph (required)
//   step    the step on screen - used for the clock label only; the numbers
//           are recomputed, so an answer cannot disagree with the engine
//   game    a wargame state (game.js), when one is running
//   sandbox truthy on the sandbox board (ADR-0027)
//   method  combine method, default 'weighted' (a game uses its own cfg)
//
// Answer = { query, args, label, facts, table|null, series|null, actions: [], note|null }
// table  = { cols: string[], rows: [{ id, cells: (string|number)[] }] }

import { num, pct, cutRows, clockOf, activePhaseNames, CAUSE_KO_ROW } from './derive.js'
import { runChain, runStep, containmentCandidates } from './engine.js'
import { staffTable, weightedOf, compromiseOf } from './game.js'
import { readiness } from './sandbox.js'
import { assetName } from './labels.js'
import {
  numbered, missionFacts, assetFacts, serviceFacts,
  containmentFacts, gameFacts, readinessFacts, TOP_N,
  attribution, attributionFacts,
} from './facts.js'

const f = (text, ref = null, value = null, unit = null) => ({ text, ref, value, unit })
const refOf = (kind, id) => ({ kind, id })

const pp = (v) => `${pct(v)}p`
const signed = (v) => `${num(v) >= 0 ? '+' : ''}${pp(v)}`
const assetLabel = (g, id) => `${assetName(g, id).ko}(${id})`
const rowLabel = (list, id) => {
  const r = (list || []).find((x) => x.id === id)
  return `${(r && r.name) || id}(${id})`
}
const missionLabel = (g, id) => rowLabel(g?.missions, id)
const taskLabel = (g, id) => rowLabel(g?.tasks, id)

// --- what the engine is asked about -------------------------------------
//
// In a game the truth is the game state and its turn clock, not the exported
// step: that is what makes the opponent real rather than a replay. Outside a
// game it is the step's compromise map at the step's t.
//
// `ctxT` is the one place that reads "what time is it" out of a ctx. `ask`
// stamps every Answer with it, and the dock re-reads it live off the same ctx
// shape to tell whether a logged card's numbers still match the screen - one
// definition, so the two readings cannot drift apart (ADR-0009: a claim's
// basis has to be checkable, not just present).
export function ctxT(ctx) {
  const G = ctx && ctx.game
  if (G && G.cfg) return Number(G.cfg.t)
  const s = (ctx && ctx.step) || {}
  return s.t === undefined || s.t === null ? -1 : Number(s.t)
}

// --- what graph is it -----------------------------------------------------
//
// The clock is only half of an answer's basis. On the sandbox board the graph
// itself is edited under the panel (ADR-0027), and an edit at a FIXED t moves
// every number: cutting the links on TOC-SRV takes M-C2 from 32.1% to 89.3%
// with t unchanged at 180. A card stamped with t alone cannot see that, so it
// kept reading 32.1% and looked current - exactly the confident-but-stale
// claim ADR-0009 exists to prevent.
//
// So `ask` stamps a second thing: a fingerprint of the structure the engine's
// numbers actually depend on. Counts are not enough - moving one end of a link
// leaves 13 assets and 12 links - so the digest is built from identity, not
// size: sorted asset ids, sorted `a|b|bearer` link triples, and the sorted
// provided_by / requires edge pairs. Attributes that no engine path reads
// (names, sites, coordinates) are left out on purpose; renaming an asset does
// not make an answer wrong.
//
// FNV-1a over the joined string. The graph is ~13 assets, so this is free and
// runs on every render of the dock.
function strHash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function graphFingerprint(graph) {
  const g = graph || {}
  const ids = (g.assets || []).map((a) => (a && a.id) || '').slice().sort()
  const links = (g.links || [])
    .map((l) => `${(l && l.a) || ''}|${(l && l.b) || ''}|${(l && l.bearer) || ''}`)
    .slice().sort()
  const edge = (key) => ((g.edges && g.edges[key]) || [])
    .map((e) => `${(e && e.from) || ''}>${(e && e.to) || ''}`)
    .slice().sort()
  const parts = [ids, links, edge('provided_by'), edge('requires')]
  return strHash(parts.map((p) => p.join(',')).join(';'))
}

function baseOf(ctx) {
  const G = ctx && ctx.game
  const t = ctxT(ctx)
  if (G && G.cfg) return { compromise: compromiseOf(G), t, method: G.cfg.method || 'weighted' }
  const s = (ctx && ctx.step) || {}
  return { compromise: { ...(s.compromise || {}) }, t, method: (ctx && ctx.method) || 'weighted' }
}

// A step-shaped view computed here and now. `runStep` with no candidates is
// exactly a step minus the isolation what-ifs, so the fact builders - which
// were written against an exported step - read it unchanged.
function viewOf(ctx) {
  const { compromise, t, method } = baseOf(ctx)
  const view = runStep(ctx.graph, compromise, { t, method, candidates: [] })
  const s = (ctx && ctx.step) || {}
  if (s.time_iso && Number(s.t) === t) view.time_iso = s.time_iso
  return view
}

// --- incidents ------------------------------------------------------------
//
// derive.cutRows decides what counts as an incident; this only sorts it into a
// stable order (outages by graph order, then compromise by id) and says it in
// a sentence. A link outage is the one place a {kind:'link'} ref comes from.
function incidents(g, view) {
  const linkIds = new Set((g?.links || []).map((l) => l.id))
  const rows = cutRows(g, view).map((r, i) => ({ ...r, link: linkIds.has(r.id), seq: i }))
  rows.sort((a, b) => (Number(a.cause === 'attack') - Number(b.cause === 'attack'))
    || (a.cause === 'attack' ? String(a.id).localeCompare(String(b.id)) : a.seq - b.seq))
  return rows
}

function incidentFacts(g, view) {
  return incidents(g, view).map((r) => {
    const cause = CAUSE_KO_ROW[r.cause] || r.cause
    const name = `${r.what}(${r.id})`
    const tail = r.note ? `, ${r.note}` : ''
    if (r.cause === 'attack') {
      const v = num(view?.compromise?.[r.id])
      return f(`${name} 침해 진행 중 - 원인 ${cause}, 침해도 ${pct(v)}.`, refOf('asset', r.id), v, '%')
    }
    const what = r.link ? '링크 단절' : '자산 단절'
    return f(`${name} ${what} - 원인 ${cause}${tail}.`, refOf(r.link ? 'link' : 'asset', r.id))
  })
}

const incidentTable = (g, view) => ({
  cols: ['대상', 'ID', '원인', '비고'],
  rows: incidents(g, view).map((r) => ({
    id: r.id,
    cells: [r.what, r.id, CAUSE_KO_ROW[r.cause] || r.cause, r.note || ''],
  })),
})

// --- the one isolation cost ----------------------------------------------
//
// game.js `isolationCost` is `weightedOf(missions after) - weightedOf(missions
// before)`, both from runChain at the game's t. Without a game there is no G
// to hand it, so the same two calls are made here around the same imported
// `weightedOf`. The arithmetic lives in one place; this is the loop.
function costFn(g, compromise, t, method) {
  const before = weightedOf(g, runChain(g, compromise, { t, method, causes: 'all' }).mission)
  return (id) => {
    const after = weightedOf(g, runChain(g, { ...compromise, [id]: 1 }, { t, method, causes: 'all' }).mission)
    return Number((after - before).toFixed(6))
  }
}

// Ranked containment rows. In a game these are game.staffTable's own rows in
// its own order (ADR-0003 - the staff never reorders the table). Outside one
// there is no attacker, so `blocks`/`gainBlocked` are null and the order is
// cost ascending: the cheapest thing to give up comes first.
function rankedRows(ctx) {
  const g = ctx.graph
  const G = ctx.game
  if (G && G.cfg) return { rows: staffTable(g, G), scored: true }
  const { compromise, t, method } = baseOf(ctx)
  const cost = costFn(g, compromise, t, method)
  const rows = containmentCandidates(g, compromise).slice().sort()
    .map((id) => ({ id, cost: cost(id), blocks: null, gainBlocked: null, net: null }))
  rows.sort((a, b) => (a.cost - b.cost) || String(a.id).localeCompare(String(b.id)))
  return { rows: rows.map((r, i) => ({ ...r, rank: i + 1 })), scored: false }
}

const SCORED_COLS = ['순위', '자산', 'ID', '임무 비용', '막는 공격 수', '최대 차단 이득', '순이득']
const PLAIN_COLS = ['순위', '자산', 'ID', '임무 비용']

function containmentTable(g, rows, scored) {
  return {
    cols: scored ? SCORED_COLS : PLAIN_COLS,
    rows: rows.map((r) => ({
      id: r.id,
      cells: scored
        ? [r.rank, assetName(g, r.id).ko, r.id, signed(r.cost), r.blocks, pct(r.gainBlocked), signed(r.net)]
        : [r.rank, assetName(g, r.id).ko, r.id, signed(r.cost)],
    })),
  }
}

const COLS_NOTE = '교전 중에는 막는 공격 수·최대 차단 이득·순이득 열이 더 붙는다. 관측 모드에는 공격자가 없어 그 세 값은 계산하지 않고 임무 비용만 매긴다 - 표의 열 이름이 두 경우에 다르다.'

// --- asset attribution ----------------------------------------------------
//
// Why this is a second query and not an extra block inside mission_why: the
// two decompose the SAME degradation along different axes. mission_why splits
// it by cause (compromise / environment / interaction, which is what the
// mission bar draws); this splits it by asset. Neither is a refinement of the
// other, and a reader who takes one for the other will read "침해 54.0%p" as
// "TOC-SRV 54.0%p". The note says so on every answer.
const ATTR_NOTE = [
  'mission_why 는 같은 저하도를 원인(침해·환경·상호작용)으로 가르고, 이 질의는 자산별로 가른다 - 분해 축이 다르고 서로를 대체하지 않는다.',
  '기여도는 leave-one-out 이다: 그 자산의 침해만 0 으로 되돌려 엔진을 다시 돌린 차이이고, 추정이 아니라 엔진 두 번의 차이다.',
  '개별 기여의 합은 전체 저하도와 같지 않다. 차이는 단절·환경 바닥과 자산 간 상호작용으로 표에 따로 적고, 합이 전체와 맞도록 비율로 고치지 않는다.',
  '상호작용은 음수가 될 수 있고, 그때는 개별 합이 전체 저하도보다 커진다 - 이중화 서비스가 제공 자산을 곱해서 합치기 때문이다(tacnet-01 의 RELAY-1+SAT-TERM 대 M-FIRE 에서 합 +17.3%p, 전체 8.6%). 그래서 이 합은 비율의 분자가 아니다.',
].join(' ')

// The summary rows carry their unit in the cell, not in the column head: the
// asset rows and the three derived rows are %p, the last two are levels in %.
// Putting one unit in the header would make one of the two groups a lie.
function attributionTable(g, a) {
  const rows = a.rows.map((r) => ({
    id: r.id,
    cells: [assetName(g, r.id).ko, r.id, pct(r.compromise), signed(r.contribution), pct(r.after)],
  }))
  const line = (key, label, cell) => ({ id: key, cells: [label, '', '', cell, ''] })
  rows.push(line('__sum', '개별 기여 합', signed(a.sum)))
  rows.push(line('__inter', '자산 간 상호작용 (침해 몫 - 개별 합)', signed(a.interaction)))
  rows.push(line('__joint', '침해 전체의 몫 (전체 - 바닥)', signed(a.joint)))
  rows.push(line('__floor', '단절·환경 바닥 (자산별로 가를 수 없음)', pct(a.floor)))
  rows.push(line('__total', '전체 저하도 (침해 몫 + 바닥)', pct(a.total)))
  return { cols: ['자산 / 항목', 'ID', '침해', '값', '0 으로 되돌린 뒤'], rows }
}

// --- the catalogue --------------------------------------------------------

export const QUERIES = [
  {
    id: 'state_summary',
    label: '현 상황 요약',
    args: [],
    needs: 'graph',
    run(ctx) {
      const g = ctx.graph
      const view = viewOf(ctx)
      const clock = clockOf(view)
      const phases = activePhaseNames(g, view)
      const facts = [
        f(`현 시각 ${clock.time}${clock.off ? ` (${clock.off})` : ''}, 진행 단계 ${phases.length ? phases.join(', ') : '없음'}.`, null, view.t),
      ]
      if (ctx.game && ctx.game.cfg) facts.push(...gameFacts(g, ctx.game))
      facts.push(...missionFacts(g, view))
      const inc = incidentFacts(g, view)
      facts.push(...(inc.length ? inc : [f('진행 중인 단절·침해 사건이 없다.', null, 0)]))
      return {
        label: '현 상황 요약',
        facts,
        table: incidentTable(g, view),
        note: inc.length ? null : '사건 표가 비어 있다 - 현 시각에 단절도 침해도 없다.',
      }
    },
  },
  {
    id: 'mission_why',
    label: '이 임무가 왜 저하됐나',
    args: [{ name: 'missionId', kind: 'mission', required: true }],
    needs: 'graph',
    run(ctx, args) {
      const g = ctx.graph
      const id = args.missionId
      const view = viewOf(ctx)
      const phases = (g.phases || []).filter((p) => p.mission === id).map((p) => p.id)
      const active = new Set(view.active_phases || [])
      const tasks = (g.tasks || []).filter((t) => phases.includes(t.phase) && active.has(t.phase))
      const ranked = tasks.slice().sort((a, b) => (num(view.task[b.id]) - num(view.task[a.id])) || String(a.id).localeCompare(String(b.id)))
      const hurt = ranked.filter((t) => num(view.task[t.id]) > 1e-9)

      const facts = missionFacts(g, view).filter((x) => x.ref && x.ref.id === id)
      for (const t of hurt) {
        const v = num(view.task[t.id])
        const at = t.performed_at ? `, 수행 자산 ${assetLabel(g, t.performed_at)}` : ''
        facts.push(f(`${taskLabel(g, t.id)} 작업 저하도 ${pct(v)} - 중요도 ${t.criticality}${at}.`, refOf('task', t.id), v, '%'))
      }
      if (ranked.length && !hurt.length) {
        facts.push(f(`이 임무의 활성 작업 ${ranked.length}개는 모두 저하도 ${pct(0)} 이다.`, refOf('mission', id), 0, '%'))
      }

      // Only the services those tasks actually require, and only the ones that
      // are down: a service the mission does not consume is not its reason.
      const requires = (g.edges?.requires) || []
      const need = new Set()
      for (const t of hurt) for (const r of requires) if (r.from === t.id) need.add(r.to)
      facts.push(...serviceFacts(g, view).filter((x) => need.has(x.ref.id) && num(x.value) > 1e-9))
      facts.push(...incidentFacts(g, view))

      return {
        label: `임무 원인 분해 - ${missionLabel(g, id)}`,
        facts,
        table: {
          cols: ['작업', 'ID', '중요도', '저하도', '수행 자산'],
          rows: ranked.map((t) => ({
            id: t.id,
            cells: [t.name || t.id, t.id, t.criticality, pct(num(view.task[t.id])), t.performed_at ? assetName(g, t.performed_at).ko : ''],
          })),
        },
        note: ranked.length ? null : '현재 단계에 이 임무의 활성 작업이 없다 - 저하도를 내지 않는 구간이다.',
      }
    },
  },
  {
    id: 'mission_attribution',
    label: '이 임무 저하는 어느 자산 때문인가',
    args: [{ name: 'missionId', kind: 'mission', required: true }],
    needs: 'graph',
    run(ctx, args) {
      const g = ctx.graph
      const id = args.missionId
      const view = viewOf(ctx)
      const { method } = baseOf(ctx)
      // Computed once and handed to the phrasing, so the answer and its table
      // are the same numbers rather than two runs that could round apart.
      const a = attribution(g, view, id, method)
      return {
        label: `자산별 기여 - ${missionLabel(g, id)}`,
        facts: attributionFacts(g, view, id, { data: a }),
        table: a.active ? attributionTable(g, a) : null,
        note: a.active
          ? ATTR_NOTE
          : `현재 단계에 이 임무의 활성 작업이 없어 저하도가 0 이고 가를 것이 없다. ${ATTR_NOTE}`,
      }
    },
  },
  {
    id: 'asset_impact',
    label: '이 자산이 죽으면 어느 임무가 무너지나',
    args: [{ name: 'assetId', kind: 'asset', required: true }],
    needs: 'graph',
    run(ctx, args) {
      const g = ctx.graph
      const id = args.assetId
      const { compromise, t, method } = baseOf(ctx)
      const view = viewOf(ctx)
      const after = runChain(g, { ...compromise, [id]: 1 }, { t, method, causes: 'all' }).mission
      const missions = (g.missions || []).slice().sort((a, b) => (num(a.priority) || 9) - (num(b.priority) || 9))

      const facts = assetFacts(g, view, id)
      let worst = null
      for (const m of missions) {
        const b = num(view.mission[m.id])
        const a = num(after[m.id])
        const d = Number((a - b).toFixed(9))
        if (!worst || d > worst.d) worst = { id: m.id, d }
        facts.push(f(
          `${assetLabel(g, id)} 단절 시 ${missionLabel(g, m.id)} P${m.priority} 저하도 ${pct(b)} → ${pct(a)} (${signed(d)}).`,
          refOf('mission', m.id), d, '%p',
        ))
      }
      if (worst) {
        facts.push(worst.d > 1e-9
          ? f(`가장 크게 무너지는 곳은 ${missionLabel(g, worst.id)} ${signed(worst.d)} 이다.`, refOf('mission', worst.id), worst.d, '%p')
          : f(`${assetLabel(g, id)} 이 죽어도 현 시각 임무 저하도는 오르지 않는다 (${pp(0)}).`, refOf('asset', id), 0, '%p'))
      }

      return {
        label: `자산 단절 영향 - ${assetLabel(g, id)}`,
        facts,
        table: {
          cols: ['임무', 'ID', '우선순위', '현재', '단절 시', '증가'],
          rows: missions.map((m) => ({
            id: m.id,
            cells: [m.name || m.id, m.id, `P${m.priority}`, pct(num(view.mission[m.id])), pct(num(after[m.id])), signed(num(after[m.id]) - num(view.mission[m.id]))],
          })),
        },
        note: '격리는 이 자산의 침해를 1 로 두는 것과 같은 산술이다 - 표가 말하는 "단절 시"는 격리했을 때와 같은 값이다.',
      }
    },
  },
  {
    id: 'containment_top',
    label: '격리 후보 순위',
    args: [{ name: 'k', kind: 'int', min: 1, default: TOP_N }],
    needs: 'graph',
    run(ctx, args) {
      const g = ctx.graph
      const k = args.k
      const { rows, scored } = rankedRows(ctx)
      const top = rows.slice(0, k)
      return {
        label: `격리 후보 상위 ${top.length}`,
        facts: containmentFacts(rows, g, k),
        table: containmentTable(g, top, scored),
        note: scored
          ? `순위는 game.staffTable 의 순이득 순서 그대로다 - 참모는 표를 읽을 뿐 다시 매기지 않는다. ${COLS_NOTE}`
          : `관측 모드 - 후보는 핵심 자산과 현재 침해된 자산이고, 순서는 임무 비용 오름차순(싼 것이 위)이다. ${COLS_NOTE}`,
      }
    },
  },
  {
    id: 'compare_defense',
    label: '두 격리안 비교',
    args: [
      { name: 'aId', kind: 'asset', required: true },
      { name: 'bId', kind: 'asset', required: true, distinctFrom: 'aId' },
    ],
    needs: 'graph',
    run(ctx, args) {
      const g = ctx.graph
      const ids = [args.aId, args.bId]
      const { rows, scored } = rankedRows(ctx)
      const missing = []
      let pair
      if (scored) {
        pair = ids.map((id, i) => {
          const hit = rows.find((r) => r.id === id)
          if (hit) return hit
          missing.push(id)
          return { id, cost: 0, blocks: 0, gainBlocked: 0, net: 0, rank: rows.length + 1 + i }
        })
      } else {
        const { compromise, t, method } = baseOf(ctx)
        const cost = costFn(g, compromise, t, method)
        // 순위 is cost ascending, the same thing it means in containment_top's
        // observe branch - NOT the order the two arguments arrived in. It used
        // to be `i + 1`, which labelled whichever asset was passed as `aId`
        // "순위 1" even when it was the expensive one (TOC-SRV +27.7%p over
        // BN-SRV +0.0%p), and flipped when the arguments were swapped. A rank
        // that depends on how the question was typed is not a rank.
        const priced = ids.map((id) => ({ id, cost: cost(id), blocks: null, gainBlocked: null, net: null }))
        // A tie keeps argument order so the number is stable; the table then
        // shows it as 동률 rather than as a winner (StaffDock `tieRuns`).
        const order = priced.slice().sort((x, y) => (x.cost - y.cost) || (ids.indexOf(x.id) - ids.indexOf(y.id)))
        pair = priced.map((r) => ({ ...r, rank: order.findIndex((o) => o.id === r.id) + 1 }))
      }

      const facts = containmentFacts(pair, g, pair.length)
      const [A, B] = pair
      const better = scored
        ? (num(B.net) > num(A.net) ? B : A)
        : (num(B.cost) < num(A.cost) ? B : A)
      facts.push(scored
        ? f(`순이득 비교 - ${assetLabel(g, A.id)} ${signed(A.net)}, ${assetLabel(g, B.id)} ${signed(B.net)} → ${assetLabel(g, better.id)} 쪽이 낫다.`, refOf('asset', better.id), num(better.net), '%p')
        : f(`임무 비용 비교 - ${assetLabel(g, A.id)} ${signed(A.cost)}, ${assetLabel(g, B.id)} ${signed(B.cost)} → 싼 쪽은 ${assetLabel(g, better.id)} 이다.`, refOf('asset', better.id), num(better.cost), '%p'))

      const note = [
        scored
          ? '두 값 모두 game.staffTable 의 행이다 - 비용 정의는 game.js isolationCost 하나뿐이다.'
          : '관측 모드 - 공격자가 없어 막는 공격 수와 순이득은 없고, 비교 기준은 임무 비용뿐이다. 순위는 임무 비용 오름차순이지 인자 순서가 아니다 - A 로 넣었다고 1위가 되지 않는다.',
        missing.length ? `${missing.join(', ')} 은 이미 격리돼 있어 추가 비용이 없다.` : '',
      ].filter(Boolean).join(' ')

      return {
        label: `격리안 비교 - ${assetLabel(g, args.aId)} vs ${assetLabel(g, args.bId)}`,
        facts,
        table: containmentTable(g, pair.slice().sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)), scored),
        note,
      }
    },
  },
  {
    id: 'readiness_gap',
    label: '교전장 구성이 왜 안 찼나',
    args: [],
    needs: 'sandbox',
    run(ctx) {
      const g = ctx.graph
      const rd = readiness(g)
      const rows = []
      for (const id of rd.services.missing.slice().sort()) rows.push({ id, cells: ['서비스', rowLabel(g.services, id), '제공 자산 없음'] })
      for (const id of rd.tasks.missing.slice().sort()) rows.push({ id, cells: ['작업', taskLabel(g, id), '수행 자산 없음'] })
      for (const id of (rd.unreachable || []).slice().sort()) rows.push({ id, cells: ['작업', taskLabel(g, id), '필요 서비스에 링크로 닿지 않음'] })
      // An isolated asset does not block the gate (sandbox.readiness does not
      // count it), so the row says so rather than looking like a blocker.
      for (const id of rd.isolated.slice().sort()) rows.push({ id, cells: ['자산', assetLabel(g, id), '어떤 링크에도 연결되지 않음 (준비도 판정에는 들어가지 않는다)'] })
      return {
        label: '교전장 준비도',
        facts: readinessFacts(g, rd),
        table: { cols: ['구분', '대상', '상태'], rows },
        note: rd.ready
          ? '준비도 충족 - 교전을 열 수 있다.'
          : '표의 항목이 전부 없어져야 교전이 열린다 (ADR-0027).',
      }
    },
  },
]

const byId = (id) => QUERIES.find((q) => q.id === id)

// --- the gate -------------------------------------------------------------

export function needsMet(ctx, needs) {
  if (!ctx || !ctx.graph) return false
  if (needs === 'game') return !!(ctx.game && ctx.game.cfg)
  if (needs === 'sandbox') return !!ctx.sandbox
  return true
}

// What can be asked here, and nothing else. `run` is deliberately left out:
// the only way to execute a query is `ask`, which validates first.
export function catalog(ctx) {
  if (!ctx || !ctx.graph) return []
  return QUERIES.filter((q) => needsMet(ctx, q.needs)).map(({ id, label, args, needs }) => ({ id, label, args, needs }))
}

// --- validation -----------------------------------------------------------
//
// A bad `k` is REJECTED, not coerced. Only an absent one takes the default -
// an explicit null or '5' is a value, and a wrong one; quietly turning it into
// 5 would be exactly the coercion this rule refuses.
// The caller after S1 is a model that gets one retry on a rejection: a reason
// it can read is a correction, while a silent coercion would teach it that a
// wrong argument was right. The same rule reads plainly in the UI - a control
// that cannot produce a bad k never sees the message.
const idsOf = (g, kind) => new Set(((kind === 'asset' ? g.assets : kind === 'mission' ? g.missions : []) || []).map((x) => x.id))

export function validate(ctx, queryId, args) {
  if (!ctx || !ctx.graph) return { ok: false, reason: '그래프가 없어 질의를 실행할 수 없다.' }
  const q = byId(queryId)
  if (!q) return { ok: false, reason: `질의 ${queryId} 는 카탈로그에 없다. 쓸 수 있는 것: ${catalog(ctx).map((x) => x.id).join(', ')}` }
  if (!needsMet(ctx, q.needs)) {
    const where = q.needs === 'game' ? '교전 중에만' : q.needs === 'sandbox' ? '교전장에서만' : ''
    return { ok: false, reason: `질의 ${queryId} 는 ${where} 쓸 수 있다.` }
  }
  const src = args || {}
  const out = {}
  for (const spec of q.args) {
    const v = src[spec.name]
    if (spec.kind === 'int') {
      // Absent takes the default. An explicit null is a value, and a wrong
      // one - turning it into 5 would be the coercion this rule refuses.
      if (v === undefined) { out[spec.name] = spec.default; continue }
      if (typeof v !== 'number' || !Number.isInteger(v) || v < (spec.min || 1)) {
        return { ok: false, reason: `인자 ${spec.name} 는 ${spec.min || 1} 이상의 정수여야 한다. 받은 값: ${JSON.stringify(v)}` }
      }
      out[spec.name] = v
      continue
    }
    if (v === undefined || v === null || v === '') {
      if (spec.required) return { ok: false, reason: `인자 ${spec.name} 가 없다.` }
      out[spec.name] = spec.default === undefined ? null : spec.default
      continue
    }
    if (!idsOf(ctx.graph, spec.kind).has(v)) {
      return { ok: false, reason: `${spec.kind} id ${JSON.stringify(v)} 는 이 그래프에 없다.` }
    }
    if (spec.distinctFrom && out[spec.distinctFrom] === v) {
      return { ok: false, reason: `인자 ${spec.name} 와 ${spec.distinctFrom} 는 서로 다른 ${spec.kind} 여야 한다.` }
    }
    out[spec.name] = v
  }
  return { ok: true, args: out }
}

// --- execution ------------------------------------------------------------

export function ask(ctx, queryId, args) {
  const v = validate(ctx, queryId, args)
  if (!v.ok) throw new Error(v.reason)
  const q = byId(queryId)
  const r = q.run(ctx, v.args)
  return {
    query: q.id,
    args: v.args,
    label: r.label || q.label,
    facts: numbered(r.facts),
    table: r.table || null,
    series: r.series || null,
    // S1 answers nothing to press. Containment is executed by a person in the
    // wargame panel, never from here (ADR-0004); S3 wires that up.
    actions: [],
    note: r.note || null,
    // The basis of this answer's numbers, so a logged card can be checked
    // against the screen later rather than just timestamped in wall-clock
    // time: the scenario clock it was computed at (ctxT) AND the shape of the
    // graph it was computed on (graphFingerprint). Either one moving is enough
    // to make the card's figures ones the engine would no longer produce.
    t: ctxT(ctx),
    gfp: graphFingerprint(ctx.graph),
  }
}
