// 인용 산수 한 벌 - 화면과 러너가 같은 파일을 읽는다 (ADR-0009).
//
// 왜 렌더러와 떨어져 있나. 칩과 배지는 `ui/cite.jsx` 가 그리고 그 파일은 JSX 를
// 쓰므로 node 가 바로 import 하지 못한다. 러너(`tools/staff-eval.mjs`)는 node 에서
// 돈다. 그래서 문장을 가르는 코드가 두 벌이 됐고, 두 벌은 갈라졌다:
//
//   화면  [F#] 뒤 공백에서 무조건 끊었다
//   러너  인용이 둘 이상인 덩어리에서만 [F#] 뒤에서 끊었다
//
// 같은 서술에 두 개의 인용률이 나왔다. `"[F1] 현재 시각은 11:00 이다."` 하나가
// 화면에서는 두 문장(칩만 있는 문장 + 미검증)이고 러너에서는 한 문장이었다.
// ADR-0009 가 인용률을 헤드라인 지표로 삼는 이상 둘 중 어느 쪽도 인용할 수 없다.
// 그래서 산수는 여기 하나뿐이고, 화면과 러너가 같이 import 한다.
//
// 여기에는 판단이 없다. 문자열을 가르고 `[F#]` 을 셀 뿐이다 (ADR-0003).

// 모든 [F#]. g 플래그는 상태를 가지므로 쓰는 쪽에서 매번 새로 만든다.
const citeG = () => /\[(F\d+)\]/g

// 문장 가르기. 두 단계다.
//
//   1. 문장부호(`.` `!` `?` `。`) 뒤의 공백에서 끊는다. 브리핑 팩이 쓰는 형식이다.
//   2. 그렇게 나온 덩어리에 인용이 **둘 이상** 있으면 각 `[F#]` 뒤에서 더 끊는다.
//      작은 모델은 마침표를 빼먹으므로 `"A 다 [F1] B 다 [F2]"` 는 두 문장이다.
//
// 2번의 "둘 이상"이 요점이다. `[F#]` 뒤에서 무조건 끊으면
// `"[F1] 때문에 저하됐다."` 가 둘로 갈라진다 - 인용을 문장 앞에 놓았을 뿐인데
// 인용 없는 문장 하나가 생기고, 미검증 배지가 형식 선택을 근거 부재로 고발한다.
//
// 대가는 있다. 인용이 하나뿐이고 마침표도 없는 `"A 다 [F1] B 다"` 는 한 문장으로
// 남아 뒤쪽 절이 앞의 인용에 묻힌다. 두 규칙 다 완벽하지 않고, 어느 쪽을 고르든
// 화면과 러너가 같은 것을 고르는 편이 낫다.
export function splitSentences(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (!s) return []
  const chunks = s.split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean)
  const out = []
  for (const c of chunks) {
    const n = (c.match(/\[F\d+\]/g) || []).length
    if (n >= 2) out.push(...c.split(/(?<=\[F\d+\])\s+(?=\S)/).map((x) => x.trim()).filter(Boolean))
    else out.push(c)
  }
  return out
}

// 문장이 인용한 근거 id, 나온 순서대로 중복 없이. 같은 근거를 두 번 인용해도
// 근거는 하나뿐이므로 칩도 하나다.
export function citesIn(text) {
  return [...new Set([...String(text == null ? '' : text).matchAll(citeG())].map((m) => m[1]))]
}

// 문장 안 어디든 인용이 있는가. 러너의 `loose_citation_rate` 의 정의이고,
// **화면의 미검증 배지가 쓰는 정의**다 - 배지는 "근거를 못 댔다"는 뜻이지
// "인용을 문장 끝에 두지 않았다"는 뜻이 아니다.
export function hasCite(text) {
  return citeG().test(String(text == null ? '' : text))
}

// 문장이 인용으로 끝나는가. 프롬프트가 요구하는 형식이고 러너의 헤드라인
// `citation_rate` 의 정의다. 이쪽은 형식 준수를 재므로 화면에는 쓰지 않는다.
export function endsWithCite(text) {
  return /\[F\d+\]\s*[.!?。]?\s*$/.test(String(text == null ? '' : text))
}

// 인용 표시를 지운 본문. 마침표·쉼표 앞에 남는 공백을 함께 거둔다.
export function stripCites(text) {
  return String(text == null ? '' : text)
    .replace(citeG(), '')
    .replace(/\s+([.,])/g, '$1')
    .trim()
}
