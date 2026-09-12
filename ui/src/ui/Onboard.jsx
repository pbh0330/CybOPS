import { useState } from 'react'

// Someone seeing this screen for the first time has to be told the one thing
// that is not guessable: the layout is a dependency graph, not a map.
// Everything else follows from that.

export default function Onboard({ onClose }) {
  const [skip, setSkip] = useState(false)
  const close = () => {
    if (skip) { try { localStorage.setItem('mccycop:onboard:seen', '1') } catch { /* ignore */ } }
    onClose()
  }
  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label="이 화면을 읽는 법">
      <div className="onboard-card">
        <div className="onboard-head">
          <h2>이 화면을 읽는 법</h2>
          <button type="button" onClick={close} aria-label="닫기">✕</button>
        </div>
        <ol className="onboard-list">
          <li>
            <b>좌표계가 지도가 아니다.</b> 노드의 위치는 지리가 아니라 <em>무엇이 무엇을
            떠받치는가</em>로 정해진다. 임무가 맨 위, 그것을 떠받치는 것일수록 아래다.
            왼쪽 가장자리의 이름은 그 종류가 처음 나타나는 행을 가리킨다.
          </li>
          <li>
            <b>채도는 의미에만 쓴다.</b> 상단바·패널·버튼에는 색이 없다. 화면에서 색을 가진
            것은 원인뿐이므로, 색이 보이면 그것은 장식이 아니라 판단 재료다.
          </li>
          <li>
            <b>붉은색은 공격에만 쓴다.</b> 전술망에서 링크가 죽는 흔한 이유는 공격이 아니라
            기동과 지형이다. 그 둘을 같은 색으로 칠하면 상황도가 언덕을 적의 소행으로
            보고하게 된다.
          </li>
          <li>
            <b>저하도는 밝기로 읽는다.</b> 노드가 밝을수록 나쁘다. 저하도에 색상을 쓰지 않는
            이유는, 심한 저하가 빨강이 되면 위 규칙이 깨지기 때문이다.
          </li>
          <li>
            <b>임무 저하도는 공격 / 환경 / 상호작용으로 나뉜다.</b> 상호작용이 크다는 것은
            <em>어느 원인 하나만으로는 이 저하가 생기지 않았다</em>는 뜻이다.
          </li>
          <li>
            <b>봉쇄에도 비용이 있다.</b> 우측 "대응"은 그 자산을 격리했을 때 임무가 얼마나 더
            나빠지는지를 미리 계산한 값이다. 이 화면에는 실행 버튼이 없다. 차단은 사람이
            별도 절차로 한다.
          </li>
          <li>
            <b>편집·교전 모드가 있다.</b> 편집은 좌측 팔레트에서 자산을 추가하고 링크로
            연결한다. 교전은 그 시각의 상황을 그대로 물려받아 공격자 턴을 시작한다. 모델은
            <b>열거된 합법수 중 하나를 고를 뿐</b>이고 성공 여부는 시드 난수가 정한다.
          </li>
        </ol>
        <div className="onboard-foot">
          <label className="chk">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> 다음부터 보지 않기
          </label>
          <button type="button" onClick={close}>시작</button>
        </div>
      </div>
    </div>
  )
}
