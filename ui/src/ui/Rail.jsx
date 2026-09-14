import { useEffect, useState } from 'react'
import { CAUSE_COLOR } from '../graph.js'
import { num, pct, missionRows, cutRows, actionRows, linkageOf } from '../derive.js'
import detection from '../detection.json'
import { techniqueKo, techniqueMeaning, tacticKo } from '../labels.js'

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
function DetectionEvidence() {
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
          <em className="ref" title={techniqueMeaning(sg.technique)}>{sg.technique} {techniqueKo(sg.technique)}</em>
        </div>
      ))}
      <div className="ev-foot">
        {d.sources.detection.replace('eval/results/', '')} · {d.pulled}
      </div>
    </details>
  )
}

function Cuts({ graph, step }) {
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
      {anyAttack && <DetectionEvidence />}
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

function Linkage({ graph, assetId, mode, editor }) {
  const link = linkageOf(graph, assetId)
  const asset = (graph.assets || []).find((a) => a.id === assetId)
  const ed = editor && editor.current
  const editing = mode === 'edit' && ed
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
            <div className="lk-sub">이 자산이 제공하는 서비스</div>
            {(graph.services || []).map((svc) => (
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
            ))}
          </div>
          <div className="lk-group">
            <div className="lk-sub">이 자산에서 수행하는 작업</div>
            {(graph.tasks || []).map((t) => (
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
            ))}
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

function Inspect({ graph, step, data, mode, editor }) {
  if (!data) return <div className="inspect-empty">노드를 클릭하면 기여 경로가 나온다.</div>
  const rows = []
  const add = (k, v) => rows.push([k, v])
  add('종류', KIND_KO[data.kind] || data.kind)
  if (data.kind === 'asset') {
    add('자산 유형', data.assetTypeKo || data.assetType)
    add('부대 / 위치', `${data.unitName || data.unit} / ${data.site}`)
    add('기동성', data.mobility)
    add('중계', data.transit ? '가능' : '종단 단말(중계 안 함)')
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
        <h2>{data.siteName || data.label?.split('\n')[0] || data.id}</h2>
        <span className="when">{data.id}</span>
      </div>
      <dl>{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {data.kind === 'asset' && <Linkage graph={graph} assetId={data.id} mode={mode} editor={editor} />}
    </div>
  )
}

const TABS = [
  ['cuts', '단절'],
  ['actions', '대응'],
  ['brief', '브리핑'],
  ['inspect', '선택'],
]

export default function Rail({
  graph, step, scenarioId, edited, when, tab, onTab,
  requests, onRequest, selectedData, onToast, mode, wargameSlot, editor,
}) {
  const cuts = cutRows(graph, step).length
  const acts = actionRows(graph, step).length
  const counts = { cuts, actions: acts }

  return (
    <aside className="rail">
      <MissionState graph={graph} step={step} when={when} />

      {mode === 'wargame' ? (
        <>
          <div className="tabs"><button type="button" className="on">교전</button></div>
          <div className="rail-body">{wargameSlot}</div>
        </>
      ) : (
        <>
          <div className="tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={id} type="button" role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'on' : ''}
                onClick={() => onTab(id)}
              >
                {label}
                {counts[id] !== undefined && counts[id] > 0 && <span className="count">{counts[id]}</span>}
              </button>
            ))}
          </div>
          <div className="rail-body">
            {tab === 'cuts' && <Cuts graph={graph} step={step} />}
            {tab === 'actions' && <Actions graph={graph} step={step} requests={requests} onRequest={onRequest} />}
            {tab === 'brief' && <Brief scenarioId={scenarioId} step={step} edited={edited} onToast={onToast} />}
            {tab === 'inspect' && <Inspect graph={graph} step={step} data={selectedData} mode={mode} editor={editor} />}
          </div>
        </>
      )}

      <div className="rail-foot">
        이 화면에는 실행 경로가 없다. 차단·격리는 사람이 별도 절차로 수행한다.
        <span className="adr">ADR-0004</span>
      </div>
    </aside>
  )
}
