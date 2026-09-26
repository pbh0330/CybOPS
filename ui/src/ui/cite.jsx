// 인용 렌더링 - 한 벌만 있다 (ADR-0009).
//
// 화면에서 모델이 쓴 문장은 두 곳에 나온다: 레일의 브리핑(미리 생성된 팩)과
// 참모 답변의 서술(질문 즉시 생성). 둘은 같은 규칙을 그린다.
//
//   1. 문장은 근거 id 로 끝난다: `... 막는다 [F2]`
//   2. 칩을 누르면 그 근거로 간다.
//   3. 인용이 없는 문장에는 미검증 배지가 붙는다.
//
// 이 파일이 있는 이유는 하나다: 같은 규칙을 두 번 구현하면 갈라진다.
// Rail.jsx 가 먼저 했고 S2 의 참모 질의창이 두 번째를 만들 뻔했다. 배지 규칙이
// 한쪽에서만 바뀌면 "인용 없는 문장은 반드시 보인다"는 ADR-0009 의 약속이
// 조용히 절반만 지켜진다. 그래서 렌더러도 통계도 여기 하나뿐이고, 두 곳이
// 같이 import 한다.
//
// 여기에는 판단이 없다. 문자열을 쪼개고 칩을 그릴 뿐이고, 숫자는 전부
// 결정론 엔진이 만든 사실에서 온다 (ADR-0003).

// 모든 [F#] (g 플래그는 상태를 가지므로 쓰는 쪽에서 매번 새로 만든다)
const citeG = () => /\[(F\d+)\]/g

// 문장 경계. 두 가지다:
//   - 마침표/물음표/느낌표 뒤의 공백 - 브리핑 팩이 쓰는 형식
//     (`... [F2]{확신}.` 다음 줄바꿈)
//   - 인용 바로 뒤의 공백 - narrate() 가 쓰는 형식 (`... 막는다 [F2] 다음 ...`).
//     마침표가 뒤따르는 경우는 첫 규칙이 잡으므로 여기서 쪼개지 않는다.
//     이것이 없으면 프롬프트대로 마침표 없이 끝낸 서술이 통째로 한 문장이 되고,
//     인용 없는 문장 하나가 인용 있는 문장에 묻혀 미검증 배지를 피한다.
const SPLIT = /(?<=[.!?])\s+|(?<=\[F\d{1,4}\])\s+(?=[^.,!?…\s])/

export function splitSentences(text) {
  return String(text == null ? '' : text)
    .split(SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)
}

// 한 문장이 같은 근거를 두 번 인용하면 칩은 하나다. 중복 칩은 인용이 두 건인
// 것처럼 보이지만 근거는 하나뿐이다.
export function citesOf(raw) {
  return [...new Set([...String(raw == null ? '' : raw).matchAll(citeG())].map((m) => m[1]))]
}

// 인용 표시를 지운 본문. 마침표·쉼표 앞에 남는 공백을 함께 거둔다.
export function stripCites(raw) {
  return String(raw == null ? '' : raw)
    .replace(citeG(), '')
    .replace(/\s+([.,])/g, '$1')
    .trim()
}

export function citeParts(text) {
  return splitSentences(text).map((raw) => ({ raw, text: stripCites(raw), cites: citesOf(raw) }))
}

// 인용률을 화면에 세는 값. 평가 지표와 같은 정의다 (ADR-0009): 분모는 문장,
// 분자는 근거를 댄 문장이고, 나머지가 미검증이다.
export function citeStats(text) {
  const parts = citeParts(text)
  const cited = parts.filter((p) => p.cites.length > 0).length
  return { sentences: parts.length, cited, unverified: parts.length - cited }
}

// 근거는 두 모양으로 들어온다: 레일은 Map<id, string>, 참모는 [{id, text, ref}].
// 칩은 둘 다 그릴 수 있어야 한다.
export function factMap(facts) {
  if (facts instanceof Map) return facts
  const m = new Map()
  for (const f of facts || []) if (f && f.id) m.set(f.id, f)
  return m
}

export function factText(v) {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v.text || '')
}

// 문장들 + 칩. `onCite(id, fact)` 가 없으면 칩은 비활성이다 - 누를 데가 없는
// 칩을 누를 수 있는 것처럼 그리지 않는다.
export function CitedText({ text, facts, onCite, className = 'brief-s' }) {
  const map = factMap(facts)
  const parts = citeParts(text)
  return (
    <>
      {parts.map((p, i) => (
        <p className={className} key={i}>
          {p.text}{' '}
          {p.cites.map((c, ci) => {
            const hit = map.get(c)
            return (
              <button
                key={`${c}-${ci}`} type="button"
                className={`cite-chip${hit ? '' : ' is-bad'}`}
                title={factText(hit) || '근거를 찾지 못했다'}
                disabled={!onCite}
                onClick={onCite ? () => onCite(c, hit == null ? null : hit) : undefined}
              >{c}</button>
            )
          })}
          {p.cites.length === 0 && <span className="unverified">미검증</span>}
        </p>
      ))}
    </>
  )
}

export default CitedText
