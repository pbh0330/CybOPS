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
//
// 문장을 가르고 [F#] 을 세는 산수 자체는 이 파일에 없다. `src/cite-core.mjs`
// 에 있고 평가 러너(`tools/staff-eval.mjs`)가 같은 파일을 읽는다. 한때 두 벌이
// 었고 갈라졌다 - 같은 서술의 문장 수가 화면과 러너에서 달랐다. 이 파일은
// 렌더러이고, 산수는 빌려 쓴다.

import { splitSentences, citesIn, hasCite, stripCites } from '../cite-core.mjs'

// 재수출 - Rail.jsx 와 테스트가 여기서 가져간다. 구현은 cite-core 에 있다.
export { splitSentences, stripCites }

// 한 문장이 같은 근거를 두 번 인용하면 칩은 하나다. 중복 칩은 인용이 두 건인
// 것처럼 보이지만 근거는 하나뿐이다.
export function citesOf(raw) {
  return citesIn(raw)
}

export function citeParts(text) {
  return splitSentences(text).map((raw) => ({ raw, text: stripCites(raw), cites: citesOf(raw) }))
}

// 인용률을 화면에 세는 값. 분모는 문장이고 분자는 근거를 댄 문장, 나머지가
// 미검증이다.
//
// **어느 지표와 같은 값인가.** 문장 가르기는 러너와 글자 하나까지 같다
// (cite-core.mjs). 분자의 정의는 러너가 두 벌을 내는데, 화면이 쓰는 것은 그중
// **`loose_citation_rate`** - 문장 안 어디든 `[F#]` 이 있으면 인용한 문장이다.
// 러너의 헤드라인 `citation_rate` 는 더 엄격해서 문장이 `[F#]` 으로 끝나야
// 하고(프롬프트가 요구하는 형식), 그것은 형식 준수를 재는 수치다.
//
// 화면이 느슨한 쪽을 쓰는 이유는 배지가 뜻하는 바가 다르기 때문이다. 미검증은
// "이 문장은 근거를 대지 못했다"는 고발이다. `"M-C2 는 [F2] 때문에 저하됐다."`
// 는 근거를 댔고 칩도 붙는다 - 인용을 문장 가운데 놓았다는 이유로 그 문장에
// 미검증을 붙이면 배지가 거짓말을 한다. 형식 준수는 평가 러너가 잰다
// (docs/04-evaluation.md 2.3.3).
export function citeStats(text) {
  const parts = citeParts(text)
  const cited = parts.filter((p) => hasCite(p.raw)).length
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
