// 상판 툴바의 넘침 신호. 판정 기준은 뷰포트가 아니라 내용이다 - 1600x900 은
// compact 가 아니지만 내용(1468px)이 상자(1010px)를 넘고, 넘치는 쪽 끝에 있던
// `화면 맞춤` 은 상자 밖에서 잘려 있었다.
//
// `useCompact` 의 COMPACT_QUERY 와는 **별개의 신호**다(ADR-0030 이 그 임계값을
// 구속한다). 둘은 같은 포털(상단바의 `⋯` 패널)로 모이기만 한다.
//
// ## 되감기 진동(flip-flop)을 막는 방식: 상자 폭 히스테리시스
//
// 접으면 컨트롤 넷이 `⋯` 로 빠지므로 내용이 좁아지고, 넘침이 사라진다. 그 폭을
// 그대로 "이제 들어간다" 로 읽으면 다시 인라인으로 돌아오고 다시 넘친다.
// 접힌 뒤의 내용 폭은 **접었다는 사실의 결과**이지 질문의 답이 아니다.
//
// 그래서 넘친 순간의 내용 폭(`needed`)을 기억하고, 접힌 뒤에는 **상자 폭만**
// 본다. 접힌 상태에서 내용 폭은 판정에 들어가지 않으므로 같은 상자 폭을 몇 번
// 재도 같은 상태가 나온다. 들어가는 임계값(내용 > 상자 + 여유)과 나오는
// 임계값(상자 >= 내용 + 여유)이 다르므로 경계에서도 떨지 않는다.
//
// 기각한 대안: (a) 접힌 폭으로 판정 - 위의 무한 루프 그 자체. (b) 접은 횟수를
// 세어 N 회 뒤 고정 - 수렴은 하지만 어느 상태로 수렴하는지가 창을 어떻게
// 끌었는지에 달린다. 폭은 폭으로 판정해야 결과가 재현된다.

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

// 여유 4px. 0 은 안 된다 - scrollWidth/clientWidth 는 정수로 반올림되는데
// 툴바는 `.sp` 스페이서가 남는 공간을 먹는 플렉스 행이라 꼭 맞을 때도 서브픽셀
// 반올림으로 1px 이 더 나올 수 있다. 4px 은 그 반올림보다 크고 가장 좁은
// 컨트롤(라벨 체크박스 ~60px)보다 한참 작으므로 진짜 넘침을 놓치지 않는다.
export const FOLD_SLACK = 4

export const FOLD_INIT = { sig: '', folded: false, needed: 0 }

// 순수 함수. 상태 + 측정값 + 내용 서명 -> 다음 상태.
// 입력이 같으면 **같은 객체**를 돌려준다. setState 가 거기서 멈추므로 진동이
// 없다는 것이 테스트로 확인 가능한 성질이 된다.
export function foldStep(state, m, sig, slack = FOLD_SLACK) {
  // 내용 구성이 바뀌면 기억한 `needed` 는 다른 툴바의 숫자다. 지우고 다시 센다.
  // 안 지우면 편집 모드를 나와 툴바가 짧아져도 뷰 전환이 `⋯` 에 남는다.
  const prev = state.sig === sig ? state : { sig, folded: false, needed: 0 }
  const box = Math.round(m.clientWidth || 0)
  const content = Math.round(m.scrollWidth || 0)
  let next = prev
  // box 0 은 레이아웃 전이거나 display:none 이다. 그때는 아무것도 판정하지 않는다.
  if (box > 0) {
    if (!prev.folded) {
      next = content > box + slack
        ? { sig, folded: true, needed: content }
        : { sig, folded: false, needed: 0 }
    } else if (box >= prev.needed + slack) {
      // 접힌 상태에서 되돌리는 것은 상자 폭뿐이다. `needed` 는 그대로 들고 간다 -
      // 다음 측정이 인라인 내용을 보고 갱신한다.
      next = { sig, folded: false, needed: prev.needed }
    }
  }
  return (state.sig === next.sig && state.folded === next.folded && state.needed === next.needed)
    ? state
    : next
}

// 폭 변화 구독. ResizeObserver 가 있으면 그것을, 없으면 창 크기 이벤트를 쓴다.
// `env` 는 테스트가 전역을 대신 넣기 위한 자리다.
export function observeWidth(el, cb, env = (typeof window === 'undefined' ? null : window)) {
  if (!el || typeof cb !== 'function') return () => {}
  const RO = env && env.ResizeObserver
  if (typeof RO === 'function') {
    const ro = new RO(() => cb())
    ro.observe(el)
    return () => ro.disconnect()
  }
  // ADR-0018: 정적 번들은 구형 브라우저에서도 열린다. 관찰자가 없는 환경에서
  // 던지지 않는 것이 요구다. 상자 폭은 거의 창 크기와 함께만 바뀌므로 resize
  // 로도 대부분 맞고, 그것조차 없으면 첫 측정만 유효하다 - 그 경우에도 컨트롤이
  // 안 보이는 채로 남지는 않는다. `.board-toolbar` 의 `overflow-x: auto` 가
  // 마지막 안전망이다.
  if (env && typeof env.addEventListener === 'function') {
    const on = () => cb()
    env.addEventListener('resize', on)
    return () => env.removeEventListener('resize', on)
  }
  return () => {}
}

// 신호가 둘인 이유. `sig` 는 **구조** 서명(편집 모드인가, 교전장인가)이고 바뀌면
// 기억을 지운다 - 편집 모드를 나오면 툴바가 짧아지므로 그때까지의 `needed` 는
// 다른 툴바의 숫자다. `probe` 는 **다시 재기만** 하는 신호(구성 목록, 상태 캡션
// 문구)이고 판정 상태를 건드리지 않는다.
//
// 가르지 않고 전부 `sig` 에 넣었더니, 접힌 상태에서 캡션 한 글자가 바뀔 때마다
// 기억이 지워져 한 커밋 동안 펼쳐졌다가 다시 접혔다. 페인트 전에 끝나므로 눈에는
// 안 보이지만 그 사이 패널이 언마운트되어 **열어 둔 `⋯` 패널이 닫혔다** -
// 교전장에서 자산을 하나 놓을 때마다 닫히는 셈이다. 구성 서명에는 폭을 실제로
// 바꾸면서 패널 안에서 눌리지 않는 것만 남긴다.
export function useToolbarFold(ref, sig, probe = '', slack = FOLD_SLACK) {
  const [state, setState] = useState(FOLD_INIT)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setState((s) => foldStep(s, { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }, sig, slack))
  }, [ref, sig, slack])

  // 판정이 바뀐 뒤 한 번 더 잰다: 접으면 DOM 이 달라지므로 그 결과를 봐야 한다.
  // 커밋마다 재지 않는 이유는 매 렌더에 레이아웃을 강제하지 않기 위해서다.
  // foldStep 이 고정점에서 같은 객체를 돌려주므로 이 고리는 멈춘다.
  useLayoutEffect(() => { measure() }, [measure, probe, state.folded, state.needed])

  useEffect(() => observeWidth(ref.current, measure), [ref, measure])

  return state.folded
}
