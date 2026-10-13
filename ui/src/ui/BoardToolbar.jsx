import { createPortal } from 'react-dom'

const VIEWS = [
  ['dependency', '임무 의존'],
  ['transport', '전송로'],
  ['geo', '지리'],
]

export default function BoardToolbar({
  view, onView, mode, labels, onLabels, onFit,
  // U3: the contribution layer. Off by default - it costs one engine run per
  // compromised asset and it is an analysis layer, not part of the picture.
  // `contribOk` is false in the geo view, which has no dependency edges to
  // thicken: the box is then disabled rather than left as a control that
  // accepts a click and does nothing.
  contrib = false, onContrib, contribOk = true,
  tool, onTool, canUndo, canRedo, onUndo, onRedo, onExport, onReset, editState,
  // sandbox (ADR-0027): named plans in localStorage and a JSON import
  sandbox = false, plans = [], onSavePlan, onLoadPlan, onDeletePlan, onImport,
  // On a narrow screen the topbar's `⋯` panel is where these controls live.
  // They are not rebuilt there: the same element is parented into that node
  // through a portal, so there is one view switch and one label checkbox in
  // the whole app no matter how wide the window is.
  menuNode = null,
}) {
  const editing = mode === 'edit'
  const into = (el) => (menuNode && el ? createPortal(el, menuNode) : el)

  const viewSeg = (
    <div className="seg" role="group" aria-label="뷰">
      {VIEWS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={view === id ? 'on' : ''}
          aria-pressed={view === id}
          onClick={() => onView(id)}
        >{label}</button>
      ))}
    </div>
  )

  const sandboxTools = editing && sandbox ? (
    <>
      <span className="tb-rule" />
      <button type="button" onClick={() => { const n = window.prompt('구성 이름', ''); if (n && n.trim()) onSavePlan(n.trim()) }}>구성 저장</button>
      <select value="" onChange={(e) => { if (e.target.value) onLoadPlan(e.target.value) }} title="저장한 구성 불러오기">
        <option value="">구성 불러오기…</option>
        {plans.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      {plans.length > 0 && (
        <select value="" onChange={(e) => { if (e.target.value && window.confirm(`'${e.target.value}' 을 지울까?`)) onDeletePlan(e.target.value) }} title="저장한 구성 삭제">
          <option value="">삭제…</option>
          {plans.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      )}
      <label className="tb-file">JSON 불러오기<input type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onImport(f); e.target.value = '' }} /></label>
    </>
  ) : null

  const labelsChk = (
    <label className="chk">
      <input type="checkbox" checked={labels} onChange={(e) => onLabels(e.target.checked)} /> 라벨
    </label>
  )

  const contribChk = (
    <label
      className={`chk${contribOk ? '' : ' is-off'}`}
      title={contribOk
        ? '자산별 임무 저하 기여를 선 굵기로 그린다. 굵기는 자산 간 비교이고 임무 저하도의 몫이 아니다.'
        : '지리 뷰에는 굵게 할 의존 간선이 없다. 임무 의존이나 전송로 뷰에서 켠다.'}
    >
      <input
        type="checkbox" checked={contrib} disabled={!contribOk}
        onChange={(e) => onContrib && onContrib(e.target.checked)}
      /> 기여 굵기
    </label>
  )

  return (
    <div className="board-toolbar">
      {into(viewSeg)}

      {editing && (
        <>
          <span className="tb-rule" />
          <div className="seg" role="group" aria-label="편집 도구">
            {[['select', '선택'], ['link', '연결'], ['delete', '삭제']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tool === id ? 'on' : ''}
                onClick={() => onTool(id)}
              >{label}</button>
            ))}
          </div>
          {editState ? <span className="rail-caption tb-state" title={editState}>{editState}</span> : null}
        </>
      )}

      <span className="sp" />

      {into(sandboxTools)}

      {editing && (
        <>
          <button type="button" onClick={onUndo} disabled={!canUndo} title="되돌리기 (Ctrl+Z)">되돌리기</button>
          <button type="button" onClick={onRedo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)">다시 실행</button>
          <button type="button" onClick={onExport}>시나리오 내보내기</button>
          <button type="button" className="danger" onClick={onReset}>{sandbox ? '교전장 비우기' : '시나리오 초기화'}</button>
        </>
      )}

      {into(labelsChk)}
      {into(contribChk)}
      <button type="button" onClick={onFit}>화면 맞춤</button>
    </div>
  )
}
