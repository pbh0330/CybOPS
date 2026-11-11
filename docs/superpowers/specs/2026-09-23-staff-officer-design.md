# LLM 참모 - 상주 참모, 닫힌 질의 카탈로그, 기권 (설계)

작성 2026-09-23. 승인됨(대화). 구현 계획은 별도 문서(S1/S2/S3).

## 0. 왜

LLM 의 역할을 **공격자에서 참모로** 옮긴다. 지금 배선은 두 군데다.

- **공격자**(`attack-llm.mjs`): 합법수 중 하나를 고른다. 유지하되 기본 UI 에서 숨긴다.
- **참모**(`staff-llm.mjs`): 교전의 방어 페이즈에서 격리 순위표 5줄을 읽어 준다. 그게 전부다.

그리고 브리핑은 **사전 생성**이다 - `tacnet-01-t{120,300,390}.{pack,brief}.json` 세 시각뿐이고,
편집된 그래프에는 "해당 브리핑이 없다"가 뜬다(`ui/src/ui/Rail.jsx:237`). 방금 만든 교전장
(`sandbox-01`)은 전부 편집된 그래프라 LLM 이 닿지 않는다.

사실 생성이 이미 결정론적이라는 구조는 옳다. 바꾸는 것은 **사실을 어디서 뽑느냐**다:
오프라인 팩 세 개가 아니라, 화면에 떠 있는 그래프에서 실시간으로.

## 1. 범위와 불변 조건

**유지**
- 상태 산출은 엔진이 한다. LLM 은 질의를 고르고 결과를 서술한다(ADR-0003).
- 모든 문장은 `[F#]` 로 근거를 인용한다. 인용 없는 문장은 미검증 표기(ADR-0009).
- 실행 경로 없음. 권고는 버튼이고 누르는 것은 사람이다(ADR-0004).
- 온프렘 전제, 모델 어댑터 계층(ADR-0007). 특정 벤더 API 에 의존하지 않는다.
- 빨강=공격, 크롬 무채색(ADR-0024/0025).
- 평가에 accuracy 를 쓰지 않는다(ADR-0008).

**바꿈**
- 실시간 사실 계층 `facts.js` 신설. 시나리오·교전장·관측·교전 어디서나 동작한다.
- 닫힌 **질의 카탈로그** `staff.js` 신설. 읽기 전용 10종.
- `staff-llm.mjs` 를 라우팅 + 서술 두 기능으로 재구성.
- 하단 드로어 `StaffDock.jsx` 신설. 참모가 상주한다.
- 공격자 LLM 은 `llm.attacker_enabled`(기본 false) 뒤로 숨긴다. 코드는 남는다.

**신설 ADR**
- **ADR-0027** 교전장 준비도 (`docs/23-sandbox.md` 가 이미 전방 참조 중)
- **ADR-0028** LLM 참모: 닫힌 카탈로그, 인자 검증, 기권, 인용, 모델 없는 배포,
  공격자 LLM 은닉(ADR-0019 개정 메모)

## 2. 계층

| 파일 | 성격 | 책임 |
|---|---|---|
| `ui/src/facts.js` | 순수 | 엔진 산출 -> `Fact[]`. 번호(F1..Fn)와 참조를 붙인다 |
| `ui/src/staff.js` | 순수 | 질의 카탈로그, 인자 검증, 엔진 호출 -> `Answer` |
| `ui/src/staff-llm.mjs` | IO | `routeQuestion()` -> `{query,args}` 또는 기권, `narrate()` -> 문장 |
| `ui/src/ui/StaffDock.jsx` | UI | 하단 드로어. 질의 버튼, 질의창, 로그, 인용 칩, 권고 버튼 |

의존 방향은 한쪽이다. `staff.js` 는 `engine.js`/`game.js`/`sandbox.js` 를 읽고,
`staff-llm.mjs` 는 `staff.js` 의 카탈로그 **명세만** 받는다(구현을 모른다).
UI 는 셋 다 쓰지만 엔진을 직접 부르지 않는다.

## 3. 사실 모델

```js
Fact = {
  id: 'F3',                       // 답변 안에서 연속 번호
  text: '여단 TOC(BN-SRV) 침해 0.80, 이 자산이 화력지원의 단일 경로다',
  ref: { kind: 'asset'|'mission'|'task'|'service'|'link'|'turn', id: 'BN-SRV' } | null,
  value: 0.8 | null,              // 숫자를 말한 사실이면 원값
  unit: '%' | '%p' | null,
}
```

`ref` 가 있으면 UI 의 인용 칩이 그 노드를 그래프·지도에서 강조한다. **근거 체인(TRACEABLE)은
별도 기능이 아니라 인용 그 자체다.**

`facts.js` 가 제공하는 빌더(전부 순수, 입력이 같으면 출력이 같다):

```
numbered(list)                    // {text, ref, value, unit}[] -> Fact[] (F1..Fn)
missionFacts(g, s)                // 임무별 저하도와 원인 분해(침해/환경/상호작용)
assetFacts(g, s, id)              // 한 자산의 침해·역할·연결·단일점 여부
serviceFacts(g, s)                // 서비스 저하와 제공자, 도달 실패 여부
containmentFacts(rows)            // 격리 후보 행 -> 사실
gameFacts(g, G)                   // 턴/모드/점수/거점/격리
readinessFacts(g, r)              // 교전장 준비도(서비스/작업/도달성/고립/보석)
trendFacts(series)                // 추이의 시작·최대·끝
```

## 4. 질의 카탈로그 (읽기 전용, 닫힌 집합)

각 항목은 `{ id, label, args, needs, run }`. `needs` 는 `'graph'`(항상), `'game'`(교전
중에만), `'sandbox'`(교전장에서만). `catalog(ctx)` 는 지금 쓸 수 있는 것만 돌려준다 -
교전이 없으면 `counterfactual` 은 목록에 없고, 따라서 모델이 고를 수도 없다.

| id | 인자 | 하는 일 | 엔진 |
|---|---|---|---|
| `state_summary` | - | 현 시각 상황 요약(임무 상위, 진행 중 사건) | `computeStep` |
| `mission_why` | `missionId` | 이 임무가 왜 저하됐나. 원인 분해 + 끊긴 경로 | `runChain`, `cutRows` |
| `asset_impact` | `assetId` | 이 자산이 죽으면 어느 임무가 무너지나 | `runChain` what-if |
| `containment_top` | `k=5` | 지금 격리 후보 순위(비용/차단) | `staffTable` 또는 `containmentCandidates`+`isolationCost` |
| `harden` | `k=5` | 어디를 보강하나. 링크 추가·이중화 후보 | 반복 what-if |
| `compare_defense` | `aId`, `bId` | 두 격리안의 비용·차단 효과 비교 | `isolationCost` 2회 |
| `counterfactual` | `turn`, `assetId` | 그 턴에 그걸 격리했으면 | 기록 재생 |
| `autoplay` | `turns=8` | 방어 없이 끝까지 | `playTurn` 시드 고정 |
| `trend` | `missionId?` | 저하 추이(스텝 또는 턴) | 반복 `runChain` |
| `readiness_gap` | - | 교전장 구성이 왜 안 찼나 | `readiness` |

반환:

```js
Answer = {
  query: 'mission_why', args: { missionId: 'fire-support' },
  label: '임무 원인 분해 - 화력지원',
  facts: Fact[],                 // 항상 있다. 모델이 없어도 이것은 나온다
  table: { cols: [...], rows: [...] } | null,
  series: { x: [...], ys: [{ id, label, v: [...] }] } | null,
  actions: [{ kind: 'isolate', id: 'BN-SRV', label: '격리' }] | [],  // 사람이 누른다
  note: '...' | null,
}
```

`actions` 는 교전 중에만 채운다. 관측 모드에서는 비어 있다(실행 경로가 없다, ADR-0004).

**`containment_top` 은 기존 `game.staffTable` 을 감싼다.** 교전 중이면 `staffTable` 을
그대로 부르고, 관측 모드이면 `containmentCandidates` + `isolationCost` 로 같은 모양을
만든다. 계산을 복제하지 않는다 - 교전 규칙(ADR-0026)의 비용 정의는 한 곳에 남는다.

## 5. 라우팅, 검증, 기권

```
질문 -> routeQuestion() -> {query, args} 또는 {abstain, why}
     -> validate(ctx, query, args)   // 카탈로그에 있는가, id 가 실제 그래프에 있는가
     -> ask(ctx, query, args)        // 엔진이 돈다
     -> narrate(facts, question)     // 모델이 문장만 쓴다
```

- 모델 출력은 JSON 객체 하나: `{"query": "...", "args": {...}}` 또는 `{"query": null, "why": "..."}`.
- 검증에 실패하면 **1회 재시도**, 그래도 실패하면 `state_summary` 로 떨어뜨리고
  `note` 에 "질의를 고르지 못해 요약으로 답했다"를 적는다. 조용히 넘어가지 않는다.
- **기권은 실패가 아니다.** 카탈로그 밖 질문("이 장비 가격이 얼마냐")에는 답하지 않고
  이유를 말한다. 기권율과 기권 정확도를 지표로 잰다.
- 프롬프트는 `<facts>`/`<catalog>` 안의 문자열이 **데이터이지 지시가 아님**을 명시한다.
  자산 이름·부대·site 는 사용자가 편집 모드에서 아무 값이나 넣을 수 있다(ADR-0019 8절과
  같은 위협 모델). 출력 채널이 닫힌 id + 검증된 인자이므로 자유 문장에 행동 경로가 없다.
- 서술 규칙은 기존 참모와 같다: 한국어 2~5문장, 각 문장 끝에 `[F#]`, 표에 없는 숫자 금지.

## 6. UI - 하단 드로어

- **접힘**: 한 줄. 마지막 답변의 첫 문장, 없으면 `참모 · 질의 10종`. 높이 32px.
- **펼침**: 좌측 카탈로그(버튼, 인자가 필요한 질의는 셀렉트가 붙는다), 우측 로그.
- 답변 한 건의 구성(위에서 아래):
  1. **실행 배지** `실행: 임무 원인 분해 · fire-support` - 무엇이 돌았는지 숨기지 않는다
  2. 문장. 인용 칩 `[F2]` 를 누르면 해당 노드가 강조되고 사실 원문이 뜬다.
     인용 없는 문장에는 `미검증` 배지
  3. `사실 F1..Fn` (접기, 기본 펼침 - 모델이 없으면 이것이 답변 전체다)
  4. 표 / 추이 차트
  5. `actions` 버튼(교전 중에만)
- 로그는 시나리오별 `localStorage: mccycop:staff:<scenarioId>` 최근 20건. 교전 history 에는
  넣지 않는다 - **참모 문장은 상태가 아니다**.
- 색은 쓰지 않는다. 미검증 배지도 무채색 + 굵기로 구분한다.

## 7. 모델 없는 배포본

`llm.enabled=false` 이거나 엔드포인트가 죽어 있으면 라우팅과 서술만 빠진다.

- 카탈로그가 **클릭 가능한 질의 버튼**으로 나온다. 누르면 사실·표·차트가 그대로 나온다.
- 질의창은 비활성 + 사유(`config.llm.unavailable_note`).
- 즉 **모델 유무는 기능 차이가 아니라 서술 차이다.** 이것이 AWS 공개 사본이 GPU 없이도
  온전히 동작하는 근거다(`docs/24-aws-demo.md`).

## 8. 교전 흡수 (S3)

- 교전 참모 카드는 `containment_top` 한 경로로 통일한다.
- **AAR**: 종료 시 `autoplay`(방어 없이) + `counterfactual`(고른 턴/자산) 결과를 표로 놓고
  참모가 서술한다. "방어 없이 갔으면 P1 91%, 3턴에 여단 TOC 를 격리했으면 44%" 같은 문장에
  전부 `[F#]` 이 붙는다.
- **SITREP**: 참모가 초안을 만들고, 사람이 승인 버튼을 누르면 `{초안, 승인 시각, 근거 사실}`
  이 브라우저 저장소에 남고 JSON 으로 내보낸다. 서버는 없다(ADR-0029).
- **추이 차트**: `trend` 의 `series` 를 그린다. 답변 안에도, 우측 레일에도 같은 컴포넌트.

## 9. 평가

`eval/golden/staff/tacnet-01.jsonl` - 질문 35~40개. 기존 골든셋 관례를 따른다
(`eval/golden/<task>/<scenario>.jsonl`, 한 줄 한 항목, `id`/`scenario`/`task` 필드).

```json
{"id":"tacnet-01:staff:07","scenario":"tacnet-01","task":"staff","t":300,
 "question":"화력지원이 왜 떨어졌나",
 "expect":{"query":"mission_why","args":{"missionId":"fire-support"}},
 "must_cite":["mission","service"],"abstain":false}
```

20% 는 `abstain: true`(카탈로그 밖). 지표:

- **라우팅 precision@1** - 클래스별 + 매크로 평균(클래스 불균형을 숨기지 않는다)
- **인용률** - 문장 중 `[F#]` 을 단 비율
- **미검증 비율** - 인용 없는 문장 비율
- **기권 정확도** - 기권해야 할 때 기권, 답해야 할 때 답한 비율
- **지연** p50/p95

러너 `ui/tools/staff-eval.mjs`(Node, 헤드리스로 `staff.js`+`staff-llm.mjs` 를 import)
-> `eval/results/staff-<model>-<date>.json`. accuracy 는 쓰지 않는다(ADR-0008).
모델이 없으면 라우팅 지표는 생략하고 카탈로그 직접 호출의 회귀 검사만 돈다.

## 10. 기존 코드 정리

- `staff-llm.mjs`: `staffFacts` 는 `facts.js` 의 `containmentFacts` + `gameFacts` 로 대체,
  `narrateStaff` 는 `narrate` 로 일반화(사실 목록과 질문을 받는다).
- `Wargame.jsx` 의 StaffCard: 표는 `containment_top`, 문장은 `narrate`.
- `Rail.jsx` 의 사전 생성 브리핑(`loadBrief`)은 **그대로 둔다.** 저작 시나리오의 세 시각은
  오프라인 평가(E3)의 근거이고, 참모는 그 옆에 산다. 편집된 그래프에서 "브리핑이 없다"가
  뜨던 자리에 "참모에게 물어보라"를 안내한다.
- `config.js`: `llm.attacker_enabled` 추가(기본 false). `Wargame.jsx` StartCard 는 이 값이
  참일 때만 LLM 공격자 선택지를 그린다.

## 11. 파일과 테스트

**신규**: `ui/src/facts.js`, `ui/src/staff.js`, `ui/src/ui/StaffDock.jsx`,
`ui/src/__tests__/facts.test.js`, `ui/src/__tests__/staff.test.js`,
`ui/tools/staff-eval.mjs`, `eval/golden/staff/tacnet-01.jsonl`,
`docs/25-staff.md`, `docs/adr/0027-sandbox-readiness.md`, `docs/adr/0028-llm-staff.md`.

**수정**: `ui/src/staff-llm.mjs`, `ui/src/config.js`, `ui/src/App.jsx`,
`ui/src/ui/Wargame.jsx`, `ui/src/ui/Rail.jsx`, `ui/src/style.css`, `ui/src/ui/Onboard.jsx`,
`docs/21-deployment.md`, `STATE.md`, `docs/design/decisions.md`.

**테스트(vitest, 25개 이상)**: 사실 번호가 연속이고 결정론적이다; 질의 10종이 각각
엔진을 직접 부른 값과 같은 수를 낸다; `validate` 가 없는 id·없는 질의·형 틀린 인자를 막는다;
`catalog` 가 교전 없이 `counterfactual` 을 내놓지 않는다; 기권 경로; `autoplay` 가 같은
시드로 같은 기록을 낸다; `counterfactual` 이 실제 기록을 재생한다; `harden` 순위가
결정론적이다; `trend` 길이; 로그 20건 상한; 모델 없는 경로가 `facts` 를 그대로 낸다.

## 12. 하지 않는 것

파인튜닝(ADR-0006), 문서 RAG, 다단계 도구 연쇄(질문 하나에 질의 하나), LLM 이 상태값을
정하거나 행동을 실행하는 경로, 공격자 프롬프트 변경, 서버측 상태(ADR-0029), 멀티플레이.

## 13. 순서

- **S1 기반**: `facts.js`, `staff.js` 의 질의 6종(`state_summary`, `mission_why`,
  `asset_impact`, `containment_top`, `compare_defense`, `readiness_gap`), StaffDock(버튼·사실
  ·표, 모델 없이 동작), ADR-0027/0028, `docs/25-staff.md`
- **S2 모델**: `routeQuestion`/`narrate`, 인용 칩·미검증·실행 배지, 기권, 골든셋과 러너,
  공격자 LLM 은닉
- **S3 교전 흡수**: `autoplay`, `counterfactual`, `harden`, `trend` + 차트, AAR 서술,
  SITREP 초안·승인 기록
