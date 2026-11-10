import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useToolbarFold } from '../fold.js'
import SkinToggle from './SkinToggle.jsx'

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
  // U12: 넘침은 뷰포트가 아니라 내용으로 판정한다. 이 툴바가 자기 상자를 넘는지
  // 재서 위로 알리고, App 이 `compact || 넘침` 으로 `menuNode` 를 넘긴다.
  // 재는 쪽과 접는 쪽이 같은 엘리먼트여야 하므로 측정은 여기서 한다.
  onFold,
}) {
  const editing = mode === 'edit'
  const into = (el) => (menuNode && el ? createPortal(el, menuNode) : el)

  // 구조 서명: 컨트롤 묶음이 들고 나는 것만. 이것이 바뀌면 기억한 폭을 버린다.
  // 둘 다 상단바에서 바뀌므로(모드 세그먼트, 시나리오 select) 패널을 열어 둔
  // 채 바뀌는 일이 없다.
  //
  // 뷰(`contribOk`)는 **들어가지 않는다.** 비활성 체크박스는 활성과 폭이 같고,
  // 뷰는 접힌 패널 안에서 눌린다 - 여기 넣으면 패널 안에서 뷰를 고르는 순간
  // 판정이 초기화되어 그 패널이 닫힌다.
  const box = useRef(null)
  const sig = `${editing ? 'e' : '-'}|${sandbox ? 's' : '-'}`
  // 다시 재기만 하는 신호: 저장된 구성이 생기면 삭제 select 가 하나 더 붙고,
  // 구성 이름이 길면 그 select 가 넓어지고, `editState` 캡션은 자산/링크 수가
  // 바뀔 때마다 길이가 달라진다. 판정 상태는 건드리지 않는다.
  const probe = `${plans.map((p) => p.name).join('\u001f')}|${editState || ''}`
  const folded = useToolbarFold(box, sig, probe)
  useEffect(() => { if (onFold) onFold(folded) }, [folded, onFold])

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

  // The theme switch belongs with the other DISPLAY controls (the view
  // segment, the label checkbox): it changes how the screen looks and
  // nothing about what it says. Same portal as the rest, so on a narrow
  // screen there is one of it, inside the topbar's ⋯ panel.
  const skinSeg = <SkinToggle />

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
    <div className="board-toolbar" ref={box}>
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
      {into(skinSeg)}
      <button type="button" onClick={onFit}>화면 맞춤</button>
    </div>
  )
}
