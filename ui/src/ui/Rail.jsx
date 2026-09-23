import { useEffect, useMemo, useRef, useState } from 'react'
import { CAUSE_COLOR } from '../graph.js'
import { num, pct, missionRows, cutRows, actionRows, linkageOf, eventRows } from '../derive.js'
import detection from '../detection.json'
import { techniqueKo, techniqueMeaning, tacticKo, assetName, typeKo } from '../labels.js'
import { linkCandidates, missionCandidates, siteOf, ruleGap, BEARER_ORDER } from '../sandbox.js'
import Readiness from './Readiness.jsx'

// The rail. Six stacked panels became one fixed block plus tabs (ADR-0024):
// mission state is always visible because it is the answer to "how bad is it",
// and everything else is a follow-up question.

// Cause labels were raw enum values on screen. They are a fixed, small
// vocabulary, so they get read in Korean like everything else.
const CAUSE_KO = {
  attack: '공격',
  mobility: '기동',
  terrain: '지형',
  maintenance: '정비',
  unknown: '미상',
}

const KIND_KO = { mission: '임무', task: '작업', service: '서비스', asset: '자산' }

function MissionState({ graph, step, when }) {
  const rows = missionRows(graph, step)
  return (
    <div className="rail-fixed">
      <div className="rail-head">
        <h2>임무 저하도</h2>
        <span className="when">{when}</span>
      </div>
      {rows.map((m) => {
        if (!m.active) {
          return (
            <div className="mission inactive" key={m.id}>
              <span className="mission-name">{m.name}</span>
              <span className="mission-pri">P{m.priority}</span>
              <span className="mission-total">해당 단계 없음</span>
            </div>
          )
        }
        // the edge marker takes the colour of the dominant cause
        const dom = m.att >= m.env && m.att >= m.inter ? 'attack'
          : m.env >= m.inter ? 'env' : 'inter'
        const domColor = { attack: 'var(--attack)', env: 'var(--env)', inter: 'var(--inter)' }[dom]
        return (
          <div className="mission" key={m.id}>
            <span className="edge" style={{ background: m.total > 0 ? domColor : 'var(--line-strong)' }} />
            <div className="body">
              <div className="mission-head">
                <span className="mission-name">{m.name}</span>
                <span className="mission-pri">P{m.priority}</span>
                <span className="mission-total">{pct(m.total)}</span>
              </div>
              <div className="bar">
                <span className="b-attack" style={{ width: `${m.parts.attack}%` }} />
                <span className="b-env" style={{ width: `${m.parts.env}%` }} />
                <span className="b-inter" style={{ width: `${m.parts.inter}%` }} />
              </div>
              <div className="mission-legend">
                <span><i style={{ background: 'var(--attack)' }} />공격<b>{pct(m.att)}</b></span>
                <span><i style={{ background: 'var(--env)' }} />환경<b>{pct(m.env)}</b></span>
                <span><i style={{ background: 'var(--inter)' }} />상호작용<b>{m.inter < 0 ? '−' : ''}{pct(Math.abs(m.inter))}</b></span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// What a compromise mark is worth. In an authored scenario the compromise is
// an authored value (ADR-0012); on real telemetry it would come from the
// detection tier, and this card says what that tier measured on real data
// (E1-b, docs/19 sections 16-17) so the reader can weigh the mark. Every
// number comes from eval/results via tools/pull-detection.mjs, with the file
// and the date it was pulled - nothing here is typed in. It is evidence in the
// ADR-0009 sense: a claim with its source attached, or no claim.
function DetectionEvidence({ compact }) {
  const d = detection
  const fmt = (x, n = 2) => Number(x).toFixed(n)
  return (
    <details className="evidence" open>
      <summary>침해 표기의 근거: 탐지 계층 실측</summary>
      <p className="rail-caption">
        이 시나리오의 침해는 저작값이다. 실데이터에서 침해 표기를 만드는 탐지 계층이 어디까지 되는지:
      </p>
      <div className="ev-src">{d.dataset} · {d.window_sec}초 창 · 학습 {d.train_days} → 못 본 날 {d.test_day} 채점 1회</div>
      <dl>
        <div style={{ display: 'contents' }}>
          <dt>경보 {d.budget}건 예산</dt>
          <dd><b>호스트 {d.hosts_caught}/{d.hosts_with_positives}</b> 잡음 · 첫 적중까지 중앙값 {d.median_cells_before_first_hit}셀</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt>재현율 50%</dt>
          <dd>정밀도 <b>{fmt(d.precision_at_recall50)}</b> (기저율 {fmt(100 * d.base_rate, 1)}%)</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt>PR-AUC</dt>
          <dd>{fmt(d.pr_auc, 3)} · 규칙 베이스라인 {fmt(d.rules_pr_auc_max, 3)}</dd>
        </div>
      </dl>
      <div className="ev-sub">측면이동 신호 (라벨 셀 대조, 성능 주장 아님)</div>
      {d.signals.map((sg) => (
        <div className="ev-row" key={sg.name}>
          <span>{sg.name}</span>
          <b>{sg.attack_cells}/{sg.cells}</b>
          {compact ? (
            // a `title` never opens on a tap - the same string gets a tap path
            // instead of a second tooltip component (M2 task 2)
            <details className="ev-ref-details">
              <summary className="ref">{sg.technique} {techniqueKo(sg.technique)}</summary>
              {techniqueMeaning(sg.technique) && <p className="rail-caption">{techniqueMeaning(sg.technique)}</p>}
            </details>
          ) : (
            <em className="ref" title={techniqueMeaning(sg.technique)}>{sg.technique} {techniqueKo(sg.technique)}</em>
          )}
        </div>
      ))}
      <div className="ev-foot">
        {d.sources.detection.replace('eval/results/', '')} · {d.pulled}
      </div>
    </details>
  )
}

function Cuts({ graph, step, compact }) {
  const rows = cutRows(graph, step)
  if (!rows.length) return <div className="none">현재 단절·침해 없음</div>
  const anyAttack = rows.some((r) => r.cause === 'attack')
  return (
    <>
      {step?.label && (
        // the attack input's own words for this step: stage, the observable it
        // was authored with, and the ATT&CK technique read out in Korean - an
        // id alone says nothing to the person at the screen
        <div className="step-note">
          <b>{step.label}</b>
          {(step.gt || []).map((g, i) => (
            <div className="gt" key={i}>
              <div className="gt-head">
                <em className="ref">{g.technique}</em>
                <b>{techniqueKo(g.technique) || g.technique}</b>
                {g.tactic && <span className="gt-tactic">{tacticKo(g.tactic)}</span>}
              </div>
              {g.msg && <div className="gt-obs">{g.msg}{g.host ? ` · ${g.host}` : ''}</div>}
              {techniqueMeaning(g.technique) && <div className="gt-why">{techniqueMeaning(g.technique)}</div>}
            </div>
          ))}
          {step.note && <span>{step.note}</span>}
        </div>
      )}
      <p className="rail-caption">원인이 미상인 단절을 공격으로 표기하지 않는다 (ADR-0012)</p>
      {rows.map((r, i) => (
        <div className="cut" key={`${r.id}-${i}`}>
          <span className={`cause cause-${r.cause}`}>{CAUSE_KO[r.cause] || r.cause}</span>
          <span className="what">{r.what}<em className="ref">{r.id}</em></span>
          <span className="note">{r.note}</span>
        </div>
      ))}
      {anyAttack && <DetectionEvidence compact={compact} />}
    </>
  )
}

// Containment candidates, priced. There is deliberately no execute path in
// this UI (ADR-0004): the button records a request, a human acts elsewhere.
function Actions({ graph, step, requests, onRequest }) {
  const rows = actionRows(graph, step)
  if (!rows.length) return <div className="none">대응 후보 없음</div>
  return (
    <>
      <p className="rail-caption">격리했을 때 임무가 얼마나 더 나빠지는가</p>
      {rows.map((r) => (
        <div className="action" key={r.id}>
          <div className="action-head">
            <span className="action-id">{r.ko}<em className="ref">{r.id}</em></span>
            {r.compromised && <span className="tag-hot">침해</span>}
            {/* cost is never red: red means attack (ADR-0012) */}
            <span className={`action-cost${r.worst === 0 ? ' zero' : ''}`}>
              {r.worst > 0 ? '+' : ''}{(r.worst * 100).toFixed(1)}<small>%p</small>
            </span>
          </div>
          <div className="action-detail">
            <span>
              {r.parts.length
                ? r.parts.map((p) => (
                  <span key={p.id} className={p.d > 0 ? 'cost-up' : 'cost-down'}>
                    {p.name || p.id} {p.d > 0 ? '+' : ''}{(p.d * 100).toFixed(1)}%p{' '}
                  </span>
                ))
                : (r.fullyHit ? '이미 전면 침해. 격리해도 추가 임무 비용은 없다' : '임무 영향 없음')}
            </span>
            <span className="sp" />
            <button type="button" className="req-btn" onClick={() => onRequest(r.id)}>승인 요청</button>
          </div>
        </div>
      ))}
      {requests.length > 0 && (
        <div className="queue">
          <div className="queue-head">승인 대기 (기록 전용, 실행 없음)</div>
          {requests.slice(0, 5).map((r, i) => (
            <div className="queue-row" key={i}>
              <span>{r.id} 격리</span>
              <span className="queue-meta">t+{r.t}분 · {r.when}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// The one part of this screen a language model wrote. Every sentence has to
// point at the fact it came from; a sentence with no citation is labelled
// 미검증 rather than hidden (ADR-0009).
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
    p.brief = b; p.pack = k
  } catch { /* offline bundle without briefings */ }
  briefCache.set(key, p)
  return p
}

function Brief({ scenarioId, step, edited, onToast }) {
  const [data, setData] = useState(null)
  const t = step && step.t !== undefined && step.t !== null ? Number(step.t) : null

  useEffect(() => {
    let alive = true
    if (t === null || edited) { setData(null); return }
    loadBrief(scenarioId, t).then((d) => { if (alive) setData(d) })
    return () => { alive = false }
  }, [scenarioId, t, edited])

  if (edited) return <div className="none">편집된 그래프에는 해당 브리핑이 없다</div>
  if (!data || !data.brief || !data.brief.text) return <div className="none">이 시각의 브리핑이 없다</div>

  const facts = new Map((data.pack?.facts || []).map((f) => [f.id, f.text]))
  const sentences = String(data.brief.text).split(/(?<=[.!?])\s+/).filter((x) => x.trim())

  return (
    <>
      <p className="rail-caption">이 문단만 LLM 이 썼다. 숫자는 결정론 계층이 만든 것이다 (ADR-0003)</p>
      {sentences.map((raw, i) => {
        const cites = [...raw.matchAll(/\[(F\d+)\]/g)].map((m) => m[1])
        const text = raw.replace(/\[(F\d+)\]/g, '').replace(/\s+([.,])/g, '$1').trim()
        return (
          <p className="brief-s" key={i}>
            {text}{' '}
            {cites.map((c) => (
              <button
                key={c} type="button"
                className={`cite-chip${facts.has(c) ? '' : ' is-bad'}`}
                title={facts.get(c) || '근거를 찾지 못했다'}
                onClick={() => onToast(`${c} — ${facts.get(c) || '근거 없음'}`)}
              >{c}</button>
            ))}
            {cites.length === 0 && <span className="unverified">미검증</span>}
          </p>
        )
      })}
      <div className="brief-meta">
        <span>{data.brief.model || ''}</span>
        <span>{data.brief.prompt_version || ''}</span>
        <span>{sentences.length}문장 · 인용 {sentences.filter((x) => /\[F\d+\]/.test(x)).length}건</span>
      </div>
    </>
  )
}

// The briefing is one sentence away at all times: the first sentence, the
// citation count, and a badge when a sentence has no citation (ADR-0009).
// Opening it shows the full Brief with its chips.
function BriefCard({ scenarioId, step, edited, onToast }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const t = step && step.t !== undefined && step.t !== null ? Number(step.t) : null
  useEffect(() => {
    let alive = true
    if (t === null || edited) { setData(null); return }
    loadBrief(scenarioId, t).then((d) => { if (alive) setData(d) })
    return () => { alive = false }
  }, [scenarioId, t, edited])
  const text = data?.brief?.text ? String(data.brief.text) : ''
  const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => x.trim())
  const cited = sentences.filter((x) => /\[F\d+\]/.test(x)).length
  const unverified = sentences.length - cited
  return (
    <div className="brief-card">
      <div className="brief-card-head">
        <span>브리핑 <em className="ref">LLM · 인용 필수</em></span>
        {sentences.length > 0 && (
          <span className="brief-badges">
            <span className="badge">인용 {cited}건</span>
            {unverified > 0 && <span className="unverified">미검증 {unverified}</span>}
          </span>
        )}
      </div>
      {!sentences.length && <div className="none">{edited ? '편집된 그래프에는 브리핑이 없다' : '이 시점 브리핑 없음'}</div>}
      {sentences.length > 0 && !open && (
        <p className="brief-first">{sentences[0].replace(/\[(F\d+)\]/g, '').trim()}</p>
      )}
      {open && <Brief scenarioId={scenarioId} step={step} edited={edited} onToast={onToast} />}
      {sentences.length > 0 && (
        <button type="button" className="brief-toggle" onClick={() => setOpen((o) => !o)}>{open ? '접기' : `펼치기 (${sentences.length}문장)`}</button>
      )}
    </div>
  )
}

// The replay as a log. Rows come from eventRows - differences between
// consecutive exported steps, nothing inferred. The current step's rows are
// lit and kept in view; clicking a row jumps to the step it points at.
function EventStream({ graph, payload, idx, onSeekIdx }) {
  const rows = useMemo(() => eventRows(graph, payload), [graph, payload])
  const ref = useRef(null)
  const curT = Number(payload?.steps?.[idx]?.t ?? -1)
  useEffect(() => {
    const el = ref.current?.querySelector('.ev.is-now')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [idx, rows])
  if (!rows.length) return null
  return (
    <div className="stream">
      <div className="stream-head">이벤트 스트림 <em className="ref">{rows.length}건 · replay 차분</em></div>
      <div className="stream-body" ref={ref}>
        {rows.map((r, i) => (
          <button
            type="button" key={i}
            className={`ev ev-${r.kind}${r.t <= curT ? ' is-past' : ''}${r.t === curT ? ' is-now' : ''}`}
            onClick={() => onSeekIdx(r.stepIdx)}
          >
            <span className="ev-t">{r.time}</span>
            <i className="ev-dot" style={{ background: r.cause ? (CAUSE_COLOR[r.cause] || CAUSE_COLOR.unknown) : 'var(--text-muted)' }} />
            <span className="ev-text">{r.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Wiring a box into the transport graph does not make it matter to a mission.
// It can matter by carrying traffic (links do that through reachability), but
// to provide a service or host work it has to be said. This block says what
// the asset is attached to, and in edit mode lets someone attach it. The
// edits go through editor.js like every other edit, so they land in the same
// undo history and the same local engine recompute (ADR-0003: the number
// moves because the graph changed, not because anyone typed a number).
function nameOf(list, id) {
  const x = (list || []).find((i) => i.id === id)
  return x ? x.name || id : id
}

function Linkage({ graph, assetId, mode, editor, rules }) {
  const link = linkageOf(graph, assetId)
  const asset = (graph.assets || []).find((a) => a.id === assetId)
  const ed = editor && editor.current
  const editing = mode === 'edit' && ed
  // the rule table says which services a type can provide and which tasks it
  // can perform; those come first, the rest fold away. No table: everything.
  const mc = rules ? missionCandidates(graph, rules, assetId) : null
  const split = (list, ids) => {
    if (!mc) return [list, []]
    const want = new Set(ids)
    return [list.filter((x) => want.has(x.id)), list.filter((x) => !want.has(x.id))]
  }
  const [svcFirst, svcRest] = split(graph.services || [], mc ? mc.services : [])
  const [taskFirst, taskRest] = split(graph.tasks || [], mc ? mc.tasks : [])
  const svcRow = (svc) => (
    <label className="chk lk-chk" key={svc.id}>
      <input
        type="checkbox"
        checked={link.provides.includes(svc.id)}
        onChange={(e) => {
          const next = link.provides.filter((id) => id !== svc.id)
          if (e.target.checked) next.push(svc.id)
          ed.setProvidedBy(assetId, next)
        }}
      />
      {svc.name || svc.id} <span className="ref">{svc.id}</span>
    </label>
  )
  const taskRow = (t) => (
    <label className="chk lk-chk" key={t.id}>
      <input
        type="checkbox"
        checked={t.performed_at === assetId}
        onChange={(e) => ed.setPerformedAt(t.id, e.target.checked ? assetId : null)}
      />
      {t.name || t.id} <span className="ref">{t.id}</span>
      {t.performed_at && t.performed_at !== assetId && (
        <span className="ref">지금: {t.performed_at}</span>
      )}
    </label>
  )
  const rows = [
    ['서비스 제공', link.provides.map((id) => nameOf(graph.services, id))],
    ['작업 수행', link.hosts.map((id) => nameOf(graph.tasks, id))],
    ['피의존', link.dependedOn],
    ['게스트', link.hostedOn],
  ].filter(([, v]) => v.length)

  return (
    <div className="linkage">
      <div className="lk-head">임무 연결</div>
      {rows.length === 0 && !editing && <div className="lk-row">없음</div>}
      {rows.map(([k, v]) => (
        <div className="lk-row" key={k}><span className="lk-k">{k}</span> {v.join(', ')}</div>
      ))}
      {!link.linked && (
        <p className="rail-caption lk-warn">
          임무 계층에 연결되어 있지 않다. 중계로는 쓰일 수 있으나 이 자산만으로 임무 수치가 움직이지 않는다.
        </p>
      )}
      {editing && (
        <>
          <div className="lk-group">
            <div className="lk-sub">이 자산이 제공하는 서비스{mc ? ` - 유형에 맞는 ${svcFirst.length}` : ''}</div>
            {svcFirst.map(svcRow)}
            {mc && svcFirst.length === 0 && svcRest.length > 0 && <div className="none">이 유형이 제공하는 서비스 종류가 규칙표에 없다</div>}
            {svcRest.length > 0 && (mc
              ? <details className="lk-more"><summary>그 외 {svcRest.length}</summary>{svcRest.map(svcRow)}</details>
              : svcRest.map(svcRow))}
          </div>
          <div className="lk-group">
            <div className="lk-sub">이 자산에서 수행하는 작업{mc ? ` - 유형에 맞는 ${taskFirst.length}` : ''}</div>
            {taskFirst.map(taskRow)}
            {mc && taskFirst.length === 0 && taskRest.length > 0 && <div className="none">이 유형이 수행하는 작업이 규칙표에 없다</div>}
            {taskRest.length > 0 && (mc
              ? <details className="lk-more"><summary>그 외 {taskRest.length}</summary>{taskRest.map(taskRow)}</details>
              : taskRest.map(taskRow))}
          </div>
          <label className="chk lk-chk">
            <input
              type="checkbox"
              checked={!!(asset && asset.transit)}
              onChange={(e) => ed.setTransit(assetId, e.target.checked)}
            />
            남의 트래픽을 중계한다
          </label>
        </>
      )}
    </div>
  )
}

// Building the network. The rule table (data/link-rules.json) says which
// types can link over which bearer and under what condition (wired needs the
// same site, satcom needs a satcom terminal at one end); the candidate list is
// that table applied to the board, so the person is told what can be wired
// rather than left to guess and be refused. A link that no longer fits the
// rule (site changed after wiring, bearer switched) is flagged, not removed:
// the board stays the person's, the flag is the table's opinion.
const WHY_KO = { site: '같은 위치', unit: '같은 부대', transit: '중계 노드', bearer: '베어러 일치' }

function Build({ graph, assetId, editor, rules, onDeselect }) {
  const ed = editor.current
  const asset = (graph.assets || []).find((a) => a.id === assetId)
  // the site input is committed on blur / Enter, not per keystroke: setSite
  // snaps an empty value back to '신규', which would fight the person mid-word.
  // Hooks sit above the early return so their order never changes.
  const liveSite = asset ? asset.site || '' : ''
  const [siteDraft, setSiteDraft] = useState(liveSite)
  useEffect(() => { setSiteDraft(liveSite) }, [assetId, liveSite])
  // deletion asks in place, not with window.confirm (a modal has no place on
  // a phone mid-edit); switching selection cancels a pending confirm rather
  // than leaving it armed against whatever gets selected next
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => { setConfirmDel(false) }, [assetId])
  if (!asset) return null
  const commitSite = () => { if (siteDraft !== liveSite) ed.setSite(assetId, siteDraft) }
  const cands = linkCandidates(graph, rules, assetId)
  const mine = (graph.links || []).filter((l) => l.a === assetId || l.b === assetId)
  // null when the table knows the type; else the reason ('규칙표 없음' when
  // link-rules.json did not load, '규칙표에 없는 유형' otherwise)
  const gap = ruleGap(rules, asset.type)
  const known = !gap
  const jewel = (graph.crown_jewels || []).includes(assetId)
  const bearerOk = (l) => {
    const o = (graph.assets || []).find((a) => a.id === (l.a === assetId ? l.b : l.a))
    if (!known || !o || !rules.types[o.type]) return true
    const both = (rules.types[asset.type].bearers || []).includes(l.bearer) && (rules.types[o.type].bearers || []).includes(l.bearer)
    const r = (rules.bearers || {})[l.bearer] || {}
    // same reading as linkCandidates: the placeholder site is not a site
    const sameSite = !!siteOf(asset) && siteOf(asset) === siteOf(o)
    return both && !(r.same_site && !sameSite) && !(r.needs_type && asset.type !== r.needs_type && o.type !== r.needs_type)
  }
  return (
    <div className="build">
      <div className="lk-head">구성</div>
      <div className="build-row">
        <label>위치(site)<input
          value={siteDraft}
          onChange={(e) => setSiteDraft(e.target.value)}
          onBlur={commitSite}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitSite() } }}
        /></label>
        <label>부대<select value={asset.unit || ''} onChange={(e) => ed.setUnit(assetId, e.target.value)}>
          <option value="">-</option>{(graph.units || []).map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}</select></label>
      </div>
      <label className="chk lk-chk"><input type="checkbox" checked={jewel} onChange={() => ed.toggleJewel(assetId)} /> 보석(crown jewel)으로 표시 - 보석 방어 모드의 패배 조건</label>

      <div className="lk-sub">연결 가능 {known ? `(${cands.length})` : `- ${gap}`}</div>
      {cands.slice(0, 8).map((c) => (
        <div className="build-cand" key={`${c.id}:${c.bearer}`}>
          <span>{assetName(graph, c.id).ko}<em className="ref">{c.id}</em></span>
          <span className="build-bearer">{c.bearer}</span>
          <span className="build-why">{WHY_KO[c.why]}</span>
          <button type="button" className="req-btn" onClick={() => ed.addLinkWith(assetId, c.id, c.bearer)}>연결</button>
        </div>
      ))}
      {known && cands.length === 0 && <div className="none">지금 연결할 수 있는 상대가 없다. 같은 위치의 자산을 놓거나 베어러가 맞는 중계 노드를 두어라.</div>}

      {mine.length > 0 && <div className="lk-sub">이 자산의 링크</div>}
      {mine.map((l) => (
        <div className="build-cand" key={l.id}>
          <span>{assetName(graph, l.a === assetId ? l.b : l.a).ko}<em className="ref">{l.id}</em></span>
          <select value={l.bearer} onChange={(e) => ed.setLinkBearer(l.id, e.target.value)}>
            {BEARER_ORDER.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {!bearerOk(l) && <span className="build-warn">규칙 밖</span>}
          <button type="button" className="req-btn" onClick={() => ed.removeLink(l.id)}>끊기</button>
        </div>
      ))}

      {/* removal is the eraser tool + a tap on desktop (editor.js handleTap);
          this is the same call, reached without switching tools (M2 task 2) */}
      <div className="build-row build-del">
        {confirmDel ? (
          <>
            <span>정말 지울까</span>
            <button type="button" className="danger" onClick={() => { ed.removeAsset(assetId); onDeselect && onDeselect() }}>지운다</button>
            <button type="button" onClick={() => setConfirmDel(false)}>취소</button>
          </>
        ) : (
          <button type="button" className="danger" onClick={() => setConfirmDel(true)}>자산 삭제</button>
        )}
      </div>
    </div>
  )
}

function Inspect({ graph, step, data, mode, editor, rules, onDeselect }) {
  if (!data) return <div className="inspect-empty">노드를 클릭하면 기여 경로가 나온다.</div>
  const rows = []
  const add = (k, v) => rows.push([k, v])
  add('종류', KIND_KO[data.kind] || data.kind)
  // an asset is editable in the build block below (site, unit, transit), so
  // its rows and title read the live graph, not the selection snapshot
  const live = data.kind === 'asset' ? (graph.assets || []).find((a) => a.id === data.id) : null
  if (data.kind === 'asset') {
    const a = live || data
    add('자산 유형', live ? typeKo(live.type) : (data.assetTypeKo || data.assetType))
    const unitName = ((graph.units || []).find((u) => u.id === a.unit) || {}).name || a.unit || '-'
    add('부대 / 위치', `${unitName} / ${a.site || '-'}`)
    add('기동성', a.mobility || 'static')
    add('중계', a.transit === false ? '종단 단말(중계 안 함)' : '가능')
    add('영향도', pct(num(step?.asset?.[data.id])))
    const c = (step?.asset_outage || {})[data.id]
    if (c) add('현재 단절', c)
    if (data.symbol) add('심볼', data.symbolVerified ? '2525 매핑(대조 완료)' : '2525 매핑(미검증)')
  } else if (data.kind === 'service') {
    add('종류', data.serviceKind || '(미지정)')
    add('이중화', data.redundancy || '없음(단일 경로)')
    add('저하도(전역)', pct(num(step?.service?.[data.id])))
  } else if (data.kind === 'task') {
    add('단계', `${data.phaseName} (${data.phase})`)
    add('수행 위치', data.performedAt || '-')
    add('중요도', data.criticality)
    add('저하도', pct(num(step?.task?.[data.id])))
  } else if (data.kind === 'mission') {
    add('우선순위', `P${data.priority}`)
    add('저하도', pct(num(step?.mission?.[data.id])))
    if (step?.mission_attack) {
      add('공격 단독', pct(num(step.mission_attack[data.id])))
      add('환경 단독', pct(num(step.mission_env[data.id])))
    }
  }
  return (
    <div className="inspect">
      <div className="rail-head" style={{ marginBottom: 10 }}>
        <h2>{live ? assetName(graph, data.id).ko : (data.siteName || data.label?.split('\n')[0] || data.id)}</h2>
        <span className="when">{data.id}</span>
      </div>
      <dl>{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {data.kind === 'asset' && mode === 'edit' && editor && editor.current && (
        <Build graph={graph} assetId={data.id} editor={editor} rules={rules} onDeselect={onDeselect} />
      )}
      {data.kind === 'asset' && <Linkage graph={graph} assetId={data.id} mode={mode} editor={editor} rules={rules} />}
    </div>
  )
}

const TABS = [
  ['cuts', '단절'],
  ['actions', '대응'],
  ['inspect', '선택'],
]

export default function Rail({
  graph, step, scenarioId, edited, when, tab, onTab,
  requests, onRequest, selectedData, onToast, mode, wargameSlot, staffSlot, editor,
  payload, idx, onSeekIdx, rules, sandbox, stack, onPick, onDeselect, compact,
}) {
  const cuts = cutRows(graph, step).length
  const acts = actionRows(graph, step).length
  const counts = { cuts, actions: acts }
  // A stack survives a delete (App only clears it from the inspector's own
  // delete button, not the eraser tool) and it survives a rotate to desktop
  // (App never clears it when compact goes false). Filtering against the
  // live asset list and gating on compact here, at the one place that
  // renders it, means neither caller has to get both right.
  const liveStack = compact ? (stack || []).filter((id) => (graph?.assets || []).some((a) => a.id === id)) : []
  // The staff panel is a TAB here, never a second drawer: on a phone the rail
  // already lives inside M1's sheet, and a second fixed drawer would fight it
  // for the bottom edge. App decides which parent gets the one StaffDock node
  // (App.jsx staffEl); this only says where it lands when the parent is us.
  // Rotating to desktop takes the slot away, so an active 참모 tab has to fall
  // back rather than leave the body empty.
  const hasStaff = !!staffSlot
  const active = tab === 'staff' && !hasStaff ? 'actions' : tab
  const tabList = hasStaff ? [...TABS, ['staff', '참모']] : TABS

  return (
    <aside className="rail">
      {/* sandbox: whether the board is playable comes before how bad it is */}
      {sandbox && graph && <Readiness graph={graph} />}
      <MissionState graph={graph} step={step} when={when} />

      {mode === 'wargame' ? (
        <>
          <div className="tabs" role="tablist">
            <button
              type="button" role="tab" aria-selected={active !== 'staff'}
              className={active !== 'staff' ? 'on' : ''}
              onClick={() => onTab('actions')}
            >
              교전
            </button>
            {hasStaff && (
              <button
                type="button" role="tab" aria-selected={active === 'staff'}
                className={active === 'staff' ? 'on' : ''}
                onClick={() => onTab('staff')}
              >
                참모
              </button>
            )}
          </div>
          <div className="rail-body">{active === 'staff' ? staffSlot : wargameSlot}</div>
        </>
      ) : (
        <>
          <div className="tabs" role="tablist">
            {tabList.map(([id, label]) => (
              <button
                key={id} type="button" role="tab"
                aria-selected={active === id}
                className={active === id ? 'on' : ''}
                onClick={() => onTab(id)}
              >
                {label}
                {counts[id] !== undefined && counts[id] > 0 && <span className="count">{counts[id]}</span>}
              </button>
            ))}
          </div>
          <div className="rail-body">
            {/* The map cannot separate markers that land on the same pixel, so
                it hands the ambiguity up instead of guessing: this is the list
                of everything that shared the tap. App only ever fills it on a
                narrow screen - a mouse does not need it. */}
            {liveStack.length > 1 && (
              <div className="stack-pick">
                <div className="stack-pick-head">이 위치에 자산 {liveStack.length}</div>
                {liveStack.map((id) => (
                  <button
                    key={id} type="button"
                    className={id === selectedData?.id ? 'on' : ''}
                    aria-pressed={id === selectedData?.id}
                    onClick={() => onPick && onPick(id)}
                  >
                    {assetName(graph, id).ko}<em className="ref">{id}</em>
                  </button>
                ))}
              </div>
            )}
            {active === 'cuts' && <Cuts graph={graph} step={step} compact={compact} />}
            {active === 'actions' && <Actions graph={graph} step={step} requests={requests} onRequest={onRequest} />}
            {active === 'inspect' && <Inspect graph={graph} step={step} data={selectedData} mode={mode} editor={editor} rules={rules} onDeselect={onDeselect} />}
            {active === 'staff' && staffSlot}
          </div>
        </>
      )}

      {mode !== 'wargame' && <BriefCard scenarioId={scenarioId} step={step} edited={edited} onToast={onToast} />}
      {mode !== 'wargame' && <EventStream graph={graph} payload={payload} idx={idx} onSeekIdx={onSeekIdx} />}

      <div className="rail-foot">
        이 화면에는 실행 경로가 없다. 차단·격리는 사람이 별도 절차로 수행한다.
        <span className="adr">ADR-0004</span>
      </div>
    </aside>
  )
}
