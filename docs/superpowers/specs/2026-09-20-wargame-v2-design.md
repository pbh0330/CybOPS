# 교전 모드 2차 - 게임 코어, 참모, 오버레이 (설계)

작성 2026-09-20. 승인됨(대화). 구현 계획은 별도 문서.

## 0. 왜

교전 모드(ADR-0019)는 공격자 엔진에 얼굴을 붙인 것이었다. 실제로 돌려 보면:

- 방어자는 드롭다운에서 자산을 골라 "격리" 하나만 할 수 있다.
- 화면 변화가 우측 레일 안에서만 일어난다. 공격자가 노리는 수, 방어 행동, 판정이
  그래프·지도에 안 보인다.
- 승패·턴 예산·점수가 없다. t=300 에서 시작하면 지휘통제가 이미 100% 라 모든 수의
  이득이 0.0% 다.
- **격리가 공격자의 거점이 된다.** `wargame.js` 는 격리를 `state[id]=1` 로 넣고,
  `attack.js` `footholds()` 는 0.5 이상을 전부 거점으로 본다. 방어 행동이 공격자를
  돕는다. 게임으로 만들면 첫 턴에 드러나는 버그다.

사용자가 고른 방향: 그래프·지도 위 시각화, 턴 구조·승패·점수(모드 둘 다), LLM 참모는
규칙 기반이 기본이고 모델은 있으면 붙는다. 방어 행동 다양화는 이번에 안 한다.

## 1. 범위와 불변 조건

**유지**
- `attack.js` 의 합법수·판정·greedy/random/LLM 공격자, `engine.js` 의 숫자 경로,
  `ui/tools/parity.mjs` 와 PowerShell 참조 대조(ADR-0019)
- LLM 은 상태값을 결정하지 않는다(ADR-0003). 참모는 **읽어 주는** 것이지 고르는 것이 아니다
- 실행 경로 없음(ADR-0004). 참모 카드의 버튼은 사람이 누르는 것이고 모의 상태만 바꾼다
- 인용 없는 LLM 문장은 미검증(ADR-0009)
- 빨강=공격(ADR-0012), 크롬 무채색(ADR-0024/0025)

**바꿈**
- `wargame.js`(명령형 DOM) → 순수 `game.js` + `Wargame.jsx`
- `attack.js` 에 `isolated` 집합 인식 추가 - 격리 자산은 거점·도달성·표적에서 빠진다
- 그래프·지도 교전 오버레이(후보수·마지막 수·격리·거점)
- 시작 대화상자, 모드 2종, 턴 예산, 점수, AAR
- 참모 카드(규칙 기반 순위표 + 있으면 LLM 문장)

**ADR-0026 신설** - 교전 규칙: 턴 구조, 승패, 점수 산식, 격리의 의미(임무에는 미가용,
공격자에게는 없는 자산, 영구), 참모의 권한(제안만). ADR-0019 를 대체하지 않는다.

**접근 선택**: 순수 코어 + React 패널 + props 오버레이(B). 엔진에 '격리' 원인을 넣는
접근(C)은 PowerShell 참조·parity·원인 색 8종 규칙을 건드리므로 이번엔 안 한다.

## 2. 게임 코어 `ui/src/game.js` (순수 함수)

```
startGame(graph, cfg) -> G
  cfg = { mode: 'hold' | 'jewel', turns: 8, t, foothold: { id, level: 0.5 },
          seed, strategy: 'greedy' | 'random' | 'llm', method: 'weighted' }
G = { cfg, turn, phase: 'defend' | 'attack' | 'over',
      attacker: { [assetId]: level },      // attack.js 의 state 그대로
      isolated: [assetId],                 // 방어자가 격리한 자산, 영구
      history: [{ turn, defender: {type:'isolate', id, cost} | null,
                  attacker: { move, success, roll, rationale } | null,
                  missions: { [missionId]: value } }],
      score: { total, perTurn: [number] },
      result: null | { win: boolean, reason: string } }

defend(G, { type: 'isolate', id }) -> G     // phase 'defend' 에서만. cost 는 엔진 what-if delta
pass(G) -> G                                 // 방어 행동 생략, phase -> 'attack'
attackerTurn(G, chooser) -> G                // playTurn 호출, history 기록, 평가
evaluate(G) -> G                             // 종료·승패·점수
staffTable(G) -> [{ id, cost, blocks, gainBlocked, rank }]
compromiseOf(G) -> { [assetId]: level }      // 엔진 입력: attacker 상태 + 격리 자산은 1
```

- **턴 순서**: 방어(1행동 또는 생략) → 공격 → 평가. `cfg.turns` 회.
- **격리의 의미**: 임무 수치에는 `compromise = 1`(자산 미가용)로 들어간다 - 대응 탭과
  같은 엔진 what-if 를 쓴다(집계는 다르다 - 게임은 우선순위 가중합, 대응 탭은 최악 임무
  하나의 delta). 공격자에게는 없는 자산이다:
  `legalMoves(g, state, t, { isolated })` 가 거점·도달성·표적에서 뺀다. 격리는 턴당 1회,
  되돌릴 수 없다. 침해 1.0 인 자산을 격리하면 임무 비용은 0 이지만 확산이 막힌다 -
  이것이 게임의 핵심 선택이다.
- **hold 모드**: 점수 = 매 턴 `Σ_missions (저하도 × 1/priority)` 의 합, 낮을수록 좋다.
  종료 시 P1 임무 저하도 < 0.5 이면 방어 승.
- **jewel 모드**: 공격자가 `crown_jewels` 중 하나를 1.0 으로 만들면(`escalate`/`deny`
  성공) 즉시 패. N턴 버티면 승. 점수 = 버틴 턴 × 100 − Σ 격리 비용(%p × 100). 자기가
  격리한 보석은 패가 아니지만 비용은 든다.
- **참모 순위표**: 격리 후보(격리 안 된 자산 전부)마다
  (a) `cost` = 엔진 what-if delta 의 우선순위 가중 합(대응 탭은 최악 임무 하나만 보인다),
  (b) `blocks` = 그 자산을 격리했을 때 사라지는 공격자 합법수의 개수,
  (c) `gainBlocked` = 사라지는 수 중 최대 gain.
  순위 = `gainBlocked − cost` 내림차순, 동률이면 `blocks` 내림차순, id.
- 재현성: 같은 graph·cfg·행동 열이면 history 가 바이트 단위로 같다.

**테스트(Vitest, ≥ 10)**: 격리 자산이 `footholds`/`legalMoves` 에서 빠짐; 격리 비용이
엔진 what-if delta 의 우선순위 가중합과 같은 값; hold 승/패, jewel 즉시 패/버티기 승; 점수 산식 두 모드;
`pass` 후 phase; `defend` 를 attack 페이즈에 부르면 무시; 재현성(같은 시드 두 판 동일);
`staffTable` 정렬.

## 3. 참모 (Wargame.jsx 의 StaffCard)

- 항상: `staffTable` 상위 3. 행마다 "여단 TOC 격리 · 비용 +8.2%p · 막는 수 4 · 최대
  차단 이득 31%" 와 **"이 행동 선택"** 버튼 → `defend()`. 버튼이 사람의 결정이다.
  카드 라벨 "규칙 기반".
- LLM 이 살아 있으면(`probeLlm()` 재사용): 순위표를 사실 F1..Fn 으로 만들어 "2~3문장,
  각 문장 끝에 [F#]" 를 요구 → 기존 `Brief` 와 같은 렌더링(인용 칩, 미검증 배지).
  실패·없음이면 문장 없이 순위표만. 새 파일 `ui/src/staff-llm.mjs`: `attack-llm.mjs` 의
  Ollama 호출 골격을 쓰되 선택지 파싱은 없고 문장만 받는다. 카드 라벨 "규칙 기반 +
  <모델명>".
- 참모 문장은 `history` 에 남기지 않는다(상태가 아니다).

## 4. 시작 대화상자 · 진행 패널 · AAR (`ui/src/ui/Wargame.jsx`)

- **시작 카드**(교전 모드 진입 시): 시점(replay step 셀렉트, 기본 현재 step),
  초기 거점(자산 셀렉트 + 0.5/0.8, 기본 = `payload.attack.steps` 에서 처음 침해값이
  생기는 자산 - tacnet CO2-VEH, defnet WKS003), 모드(버티기/보석 방어), 턴(4/8/12),
  공격자(greedy/random/LLM - 사용 불가면 비활성 + 사유), 시드. "시작".
- **진행 패널**(위→아래): 턴/페이즈/점수 줄, 참모 카드, 공격자 후보수 상위 6(지금 것),
  방어 행동(격리 셀렉트 + "격리" / "생략"), "공격 턴 진행"(방어 페이즈가 끝나야 활성),
  턴 로그(방어/공격 행 구분).
- **AAR 카드**(`phase === 'over'`): 승/패와 이유, 점수, 턴별 표(방어 행동·공격 수·
  성공·P1), 버튼 "같은 시드로 다시" / "새 시드" / "관측으로".
- 상단 KPI 띠: 교전 중이면 `턴 3/8 · 점수 214` 칸 하나(무채색).
- `wargame.js` 삭제. `Rail.jsx` 의 `wargameSlot` 자리에 `<Wargame/>`.

## 5. 오버레이

`derive.js` `gameOverlay(game, legal)` → `{ candidates: [{from, to, gain, rank}],
last: {from, to, success} | null, isolated: [ids], footholds: [ids] }`. App 이 `game` 과
이 파생값을 GraphCanvas/MapPane 에 넘긴다.

| 요소 | 그래프 | 지도 | 색 |
|---|---|---|---|
| 후보수 상위 6 | 유령 화살표: 점선, opacity .25, gain 순 굵기, `.threat-hop` | `attackArcFeatures` 재사용, `threat` 레이어 opacity .25 | 빨강 계열 - 공격자의 수이므로(ADR-0012) |
| 마지막 수 | 성공: 표적 노드 0.8s 빨강 글로우 펄스 / 실패: 회색 × 0.8s | 마커에 같은 애니메이션 | 성공만 빨강 |
| 격리 | 흰 파선 방패 링 + `격리` 태그 | 마커 `.is-isolated`, 그 자산으로 가는 링크 회색 실선 | 무채 |
| 거점 | 기존 침해 표기 | 기존 | 빨강 |

## 6. 파일 · 검증

신규: `ui/src/game.js`, `ui/src/__tests__/game.test.js`, `ui/src/ui/Wargame.jsx`,
`ui/src/staff-llm.mjs`, `docs/adr/0026-wargame-rules.md`, `docs/22-wargame.md`.
수정: `ui/src/attack.js`(`isolated` 옵션, 기본 없음 → parity 불변), `derive.js`,
`App.jsx`(game reducer, `computeStep` 에 `compromiseOf(game)`), `GraphCanvas.jsx`,
`MapPane.jsx`, `mapLayers.js`(threat 레이어), `Topbar.jsx`, `Rail.jsx`, `Onboard.jsx`
7번 문장, `style.css`/`modules.css`. 삭제: `ui/src/wargame.js`.

검증: vitest 게임 코어 ≥ 10 + 기존 22; `node ui/tools/parity.mjs` 통과(attack.js 기본
경로 불변); `Invoke-Gates.ps1` 8/8; Playwright 로 hold 와 jewel 각 한 판(시작 카드,
진행 중 오버레이, AAR) 스크린샷 → `docs/design/screens/2026-09-20-wargame-*.png`.

## 7. 하지 않는 것

격리 외 방어 행동(패치·기만·우회 경로), 실시간 자동 진행, 멀티플레이, 엔진의 격리 원인
분해, LLM 이 방어 행동을 실행·선택하는 경로, 공격자 LLM 프롬프트 변경.

## 8. 순서

attack.js 격리 수정 → game.js + 테스트 → Wargame.jsx(시작·진행·AAR) → 참모(규칙 → LLM)
→ 오버레이 → KPI·Onboard·문서·ADR-0026 → 검증·스크린샷.
