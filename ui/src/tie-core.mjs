// 동률 판정 한 벌 - 세 소비자가 같은 파일을 읽는다.
//
// `staffTable` 의 `net` 은 6자리에서 반올림된 차이값이므로, 산술적으로 같은 두
// 후보가 마지막 비트에서 갈린다. 그래서 "순이득이 같다" 는 판정에 엡실론이
// 필요하고, 그 엡실론이 세 군데에 따로 적혀 있었다:
//
//   game.js   tiedTopOf      그 턴 표에서 1위 net 을 공유한 후보 수
//   aar.js    classify       운용자의 결심이 1위와 동률이었나 (agreed / tied / decided)
//   facts.js  decisionFacts  "고른 것과 1위의 순이득은 같다" 문장을 붙이나
//
// 세 값은 오늘 일치하고 각 쪽에 검사가 붙어 있다. 그래도 한쪽만 고치면 AAR 카드와
// `decision_why` 가 "두 후보가 동률이었나" 를 두고 서로 다른 말을 하게 된다.
// 인용 산수를 `cite-core.mjs` 한 벌로 모은 것과 같은 모양이고, 처방도 같다:
// 정의는 하나, 소비자는 셋.
//
// 여기에는 판단이 없다. 두 수를 비교할 뿐이다 (ADR-0003).

export const TIE_EPS = 1e-9

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// 두 `net` 이 같은가. 절대차 비교이고 임계값은 TIE_EPS 하나다.
export function sameNet(a, b) { return Math.abs(num(a) - num(b)) < TIE_EPS }
