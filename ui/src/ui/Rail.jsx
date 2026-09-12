import { useEffect, useState } from 'react'
import { CAUSE_COLOR } from '../graph.js'
import { num, pct, missionRows, cutRows, actionRows, linkageOf } from '../derive.js'

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

function Cuts({ graph, step }) {
  const rows = cutRows(graph, step)
  if (!rows.length) return <div className="none">현재 단절·침해 없음</div>
  return (
    <>
      <p className="rail-caption">원인이 미상인 단절을 공격으로 표기하지 않는다 (ADR-0012)</p>
      {rows.map((r, i) => (
        <div className="cut" key={`${r.id}-${i}`}>
          <span className={`cause cause-${r.cause}`}>{CAUSE_KO[r.cause] || r.cause}</span>
          <span className="what">{r.what}<em className="ref">{r.id}</em></span>
          <span className="note">{r.note}</span>
        </div>
      ))}
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

function Inspect({ graph, step, data }) {
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
  const link = data.kind === 'asset' ? linkageOf(graph, data.id) : null
  return (
    <div className="inspect">
      <div className="rail-head" style={{ marginBottom: 10 }}>
        <h2>{data.siteName || data.label?.split('\n')[0] || data.id}</h2>
        <span className="when">{data.id}</span>
      </div>
      <dl>{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {link && !link.linked && (
        <p className="rail-caption" style={{ marginTop: 12 }}>
          임무 계층에 연결되어 있지 않다. 중계로는 쓰일 수 있으나 이 자산만으로 임무 수치가 움직이지 않는다.
        </p>
      )}
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
  requests, onRequest, selectedData, onToast, mode, wargameSlot,
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
            {tab === 'inspect' && <Inspect graph={graph} step={step} data={selectedData} />}
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
