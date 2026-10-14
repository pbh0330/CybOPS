// 색 상수 한 벌 - 화면과 도구가 같은 파일을 읽는다 (ADR-0024).
//
// 원인 색 8종이 같은 값으로 네 곳에 적혀 있었다. `graph.js` 의 `CAUSE_COLOR`,
// `style.css` 의 `:root`, `docs/design/tokens.md` 의 표, 그리고 Figma 변수.
// 거기에 이름 있는 토큰을 쓸 수 있는 자리에 맨 hex 가 박혀 있었다 - `#2fd18b`
// 은 `--ok` 와 같은 값이지만 `graph.js:267` 에서는 그냥 초록색 리터럴이었다.
//
// 한쪽만 고치면 조용히 갈라진다. 인용 산수를 `cite-core.mjs` 로, 동률 엡실론을
// `tie-core.mjs` 로 모은 것과 같은 모양이고 처방도 같다: 정의는 하나, 소비자는
// 여럿. 다만 색에는 지울 수 없는 사본이 둘 있다.
//
//   style.css   CSS 는 커스텀 프로퍼티 값을 import 할 수 없으므로 리터럴이 남는다
//   tokens.md   사람이 읽고 Figma 와 대조하는 표이므로 남는다
//
// 그래서 사본을 지우는 대신 `ui/tools/token-parity.mjs` 가 세 쪽을 맞춘다.
// 한 글자라도 다르면 exit 1 이다. 막는 것은 지식이 아니라 검사기다.
//
// 런타임에 `getComputedStyle` 로 CSS 를 읽는 길은 쓰지 않는다. Cytoscape
// 스타일시트는 마운트 전에 만들어지고 vitest 에는 스타일시트가 붙은 문서가
// 없으므로 폴백이 필요해지는데, 그 폴백이 곧 두 번째 사본이다. 정적 번들
// (ADR-0018)에서는 CSS 파싱 타이밍에 걸려 첫 프레임이 빈 문자열이 된다.
//
// 여기에는 판단이 없다. 값만 있다 (ADR-0003).
//
// **값을 바꾸지 않는다.** `tokens.md` 의 원인 색 표는 "ADR 구속 - 변경 금지"
// 이고 ADR-0012(빨강은 공격 전용)가 색 체계 수준에서 그것을 요구한다.

// 원인 색. 화면에서 채도를 가진 것은 이 8종뿐이고(ADR-0024)
// `docs/design/tokens.md` 의 표와 1:1 이다.
//
// 원래 `graph.js:18-27` 에 있었다. `graph.js` 는 이제 이것을 재수출만 한다.
export const CAUSE_COLOR = {
  attack: '#ff4d5e',
  mobility: '#35c8ff',
  terrain: '#a7c261',
  maintenance: '#7f8794',
  unknown: '#ffb020',
  env: '#7d93ab',
  inter: '#c07dff',
  ok: '#2fd18b',
}

// 원인 색이 아닌 무채색들. 원인 색과 달리 ADR 이 값을 묶어두지는 않지만,
// 여러 파일에 같은 리터럴로 박혀 있었다는 점은 같다.
//
// 이름은 **용도**로 짓는다. `gray98` 같은 값 이름은 값이 바뀌는 순간 거짓이
// 된다. 그리고 `style.css` 의 `:root` 에 같은 값의 토큰이 이미 있으면 새 이름을
// 만들지 않고 **그 토큰 이름을 쓴다** - 새 이름을 하나 더 만들면 같은 회색이
// 두 이름으로 불리고, 그것이 애초에 고치려던 문제다.
export const CHROME = {
  // style.css 의 기존 토큰을 그대로 쓴다. 값이 갈라지면 token-parity.mjs 가 잡는다.
  lineStrong: '#2a3442',   // = --line-strong. 원인 없는 노드의 테두리 (GraphCanvas.jsx:412)
  textPrimary: '#f2f3f4',  // = --text-primary. 선택/격리 테두리 (GraphCanvas.jsx:412)

  // style.css 에 같은 값이 없어 새로 이름을 준 것들.
  causeFallback: '#8a8f98', // 규칙표에 없는 원인 코드가 올 때 (graph.js 재수출 소비자: geo.js:462,651, GraphCanvas.jsx:426)
  markRingIdle: '#3a4657',  // 지리 뷰 자산 표지의 평시 테두리 (geo.js:651)

  // `.out` 클래스가 붙지 않은 노드에 남겨두는 자리값이므로 화면에 칠해지지
  // 않는다(graph.js:226 의 `underlay-color: data(outColor)` 는 `node.out` 에만
  // 걸린다). 세 자리 hex 인 것도 원래 값 그대로다 - 이 태스크는 출처를 바꾸고
  // 값의 바이트는 건드리지 않는다.
  nodeUnderlayNone: '#000', // GraphCanvas.jsx:417
}
