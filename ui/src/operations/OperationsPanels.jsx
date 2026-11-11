import { useMemo } from 'react'
import { assetName } from '../labels.js'
import { positionAt } from '../geo.js'
import { CAUSE_COLOR } from '../tokens.mjs'
import { assetSnapshot, modelKind, missionSeries, operationMoments, percent, timeLabel, trendPath, valueOf } from './presentation.js'
import './operations.css'

const CAUSES = { attack: '침해', mobility: '기동 단절', terrain: '지형 단절', maintenance: '정비', unknown: '미상 단절' }
const MODELS = { fighter: '전투기', aew: '조기경보통제기', ship: '해상 지휘함', usv: '무인 수상정', spacecraft: '우주 중계 단말', vehicle: '지휘차', rack: '서버 랙', satellite: '위성 단말', relay: '무선 중계소', network: '네트워크 장비', terminal: '임무 단말' }

export function OperationsHeader({ graph, step, selected, onSelect }) {
  return <section className="ops-overview" aria-label="통합 작전 현황">
    <div className="ops-title"><span>MISSION-CENTRIC COP</span><strong>통합 작전</strong><small>훈련 · 합성 데이터</small></div>
    <div className="ops-missions">
      {(graph?.missions || []).map((m) => {
        const active = step?.mission_active?.[m.id] !== false
        const total = valueOf(step?.mission?.[m.id])
        return <button type="button" key={m.id} className="ops-mission" aria-pressed={selected === m.id} onClick={() => onSelect(m.id)}>
          <span>{m.name}<small>{m.id}</small></span><b>{active ? percent(total) : '비활성'}<small>임무 저하</small></b>
          <span className="ops-meter"><i style={{ width: `${total === null || !active ? 0 : total * 100}%` }} /></span>
        </button>
      })}
    </div>
    <div className="ops-source"><b>{graph?.scenario_id}</b><span>그래프 · 지도 · 자산 동기화</span><span>지리·형상은 표시 전용</span></div>
  </section>
}

export function OperationsMoments({ graph, steps, idx, onSeek, edited }) {
  const moments = useMemo(() => operationMoments(graph, steps), [graph, steps])
  const current = moments.filter((m) => m.index <= idx).at(-1)?.index
  return <nav className="ops-moments" aria-label="주요 시점">
    <div className="ops-moments-label"><b>주요 시점</b><small>{edited ? '원본 사건 기준' : '훈련 리플레이'}</small></div>
    <div className="ops-moment-list">{moments.map((m) => <button type="button" key={m.index} onClick={() => onSeek(m.index)} aria-current={current === m.index ? 'step' : undefined} title={m.note}>
      <span className="ops-event-dot" data-attack={m.attack || undefined} /><span><small>{m.time}</small>{m.label}</span>
    </button>)}</div>
  </nav>
}

export function OperationsPanel({ graph, step, payload, idx, selected, onSelect, onInspect, onActions, edited }) {
  const snap = useMemo(() => assetSnapshot(graph, step, selected), [graph, step, selected])
  const series = useMemo(() => (graph?.missions || []).map((m) => ({ ...m, points: missionSeries(payload?.steps, m.id) })), [graph, payload])
  const asset = snap?.asset
  const kind = modelKind(asset)
  const cause = snap?.compromise > 0 ? 'attack' : snap?.outage
  const pos = asset ? positionAt(asset, Number(step?.t ?? -1)) : null
  const selectedMission = graph?.missions?.find((m) => m.id === selected)
  return <aside className="ops-panel" aria-label="작전 자산 상세">
    <div className="ops-panel-heading"><b>자산 관측</b><span>{timeLabel(step, idx)}</span></div>
    <label className="ops-asset-picker"><span>관측 자산</span><select aria-label="관측 자산" value={asset?.id || ''} onChange={(e) => onSelect(e.target.value)}>
      <option value="">자산 선택</option>
      {(graph?.assets || []).map((a) => <option key={a.id} value={a.id}>{assetName(graph, a.id).ko} · {a.id}</option>)}
    </select></label>
    <div className="ops-asset-title"><h2>{asset ? assetName(graph, asset.id).ko : selectedMission?.name || '임무에서 자산까지'}</h2><span>{asset ? `${asset.id} · ${MODELS[kind]}` : '의존 그래프와 지도에서 연결된 자산을 살펴보세요'}</span></div>
    {snap && <>
      <div className="ops-status" style={{ '--cause': CAUSE_COLOR[cause] || 'var(--text-muted)' }}><i />{cause ? CAUSES[cause] || cause : snap.degradation === null ? '상태 미측정' : snap.degradation > 0 ? '의존 자산 영향' : '관측된 침해·단절 없음'}<span>엔진 상태</span></div>
      <dl className="ops-facts">
        <div><dt>침해 입력</dt><dd>{percent(snap.compromise)}</dd></div>
        <div><dt>자산 저하</dt><dd>{percent(snap.degradation)}</dd></div>
        <div><dt>연결 단절</dt><dd>{snap.links.filter((l) => l.cause).length}<small> / {snap.links.length}</small></dd></div>
      </dl>
      {pos && <p className="ops-position">저작 위치 · E {Math.round(pos.x).toLocaleString()} / N {Math.round(pos.y).toLocaleString()} m{asset.visual_model ? ` · 고도 ${Math.round(pos.z).toLocaleString()} m (가상)` : ''}</p>}
      <section className="ops-connections"><h3>연결된 자산 <span>{snap.links.length}</span></h3>
        {snap.links.length ? snap.links.map((l) => <button type="button" key={l.id} onClick={() => onSelect(l.peer)}><span>{assetName(graph, l.peer).ko}<small>{l.peer} · {l.bearer}</small></span><b style={{ color: l.cause ? CAUSE_COLOR[l.cause] : undefined }}>{l.cause ? CAUSES[l.cause] || l.cause : '연결'}</b></button>) : <p className="ops-muted">전송 링크가 정의되지 않았습니다.</p>}
      </section>
    </>}
    <section className="ops-trends"><h3>임무 저하 추이 <span>{edited ? '편집됨' : '원본 리플레이'}</span></h3>
      {edited ? <p className="ops-muted">현재 편집 구성은 상단의 현재 시점 수치로 확인합니다. 원본 추이와 섞어 표시하지 않습니다.</p> : series.map((m) => {
        const here = m.points[idx]
        const active = step?.mission_active?.[m.id] !== false
        const value = valueOf(step?.mission?.[m.id])
        return <div className="ops-trend" key={m.id}>
          <button type="button" onClick={() => onSelect(m.id)}><span>{m.name}</span><b>{active ? percent(value) : '비활성'}</b></button>
          <svg viewBox="0 0 280 56" role="img" aria-label={`${m.name} 원본 저하 추이, 현재 ${active ? percent(value) : '비활성'}`}>
            <path className="ops-chart-grid" d="M0 8H280 M0 28H280 M0 48H280" />
            <path className="ops-chart-line" d={trendPath(m.points)} />
            {here && <path className="ops-chart-cursor" d={`M${here.x * 280} 2V53`} />}
            {here && active && value !== null && <circle cx={here.x * 280} cy={48 - value * 40} r="3.5" />}
          </svg>
          <div className="ops-chart-scale"><span>{timeLabel(payload?.steps?.[0], 0)}</span><span>0~100%</span><span>{timeLabel(payload?.steps?.at(-1), (payload?.steps?.length || 1) - 1)}</span></div>
        </div>
      })}
    </section>
    {snap?.whatif && <section className="ops-whatif"><h3>이 자산을 격리하면</h3>
      {(graph?.missions || []).map((m) => <div key={m.id}><span>{m.name}</span><b>{valueOf(snap.whatif.delta?.[m.id]) === null ? '미측정' : `${snap.whatif.delta[m.id] >= 0 ? '+' : ''}${(snap.whatif.delta[m.id] * 100).toFixed(1)}%p`}</b></div>)}
      <p>현재 임무 저하 대비 변화 · 결정론적 what-if</p>
      <button type="button" onClick={onActions}>대응 비교·승인 건의 열기</button>
    </section>}
    <button type="button" className="ops-open-inspector" onClick={onInspect}>기존 분석 패널 열기</button>
    <p className="ops-panel-foot">합성 시나리오 · 탐지 성능 지표 아님<br />대응 실행은 사람 승인 필수</p>
  </aside>
}
