# 교전장(샌드박스)과 교전 분석 (설계)

작성 2026-09-21. 승인됨(대화). 두 단계(A 기반, B 분석)로 계획·실행한다.

## 0. 왜

교전 2차(ADR-0026)는 저작 시나리오 위에서만 돈다. 편집 모드로 자산을 더할 수는 있지만
저작 시나리오를 localStorage 로 덧씌우는 방식이라 "정본을 건드리는" 일이고, 더한 자산은
지도 좌표도 서비스·작업 연결도 없다. 링크는 두 노드를 찍으면 무조건 `wired` 다.

사용자 결정: (1) 교전 전용 시나리오를 따로 두고 거기서 자산을 추가한다 — 임무·작업·
서비스만 있고 자산은 비어 있는 상태에서 시작. (2) 자산을 추가하면 **무엇과 연결 가능한지**
보여 주고 연결까지 해 준다(유형×베어러 규칙표). (3) 지도에는 연결한 자산 옆에 자동 배치하고
드래그로 옮긴다. (4) D4D 쇼케이스의 교전 기능을 참고해 더한다: 자동 교전+취약 보고(혜안
창-방패), AAR 반사실 복기+권고 채택 표시(혜안 복기 AAR, link16 결정 로그), 구성 저장/로드+
강화 제안(bunkr), 공격 프리셋+AAR 서술(link16/COIC2S/RabbiOn).

**엔진 사실 하나가 설계를 정한다.** `serviceDegFor` 는 제공자가 없는 서비스를 저하 0 으로
본다. 빈 샌드박스를 그대로 두면 임무가 "정상"이라 지킬 것이 없다. 엔진(과 PowerShell
참조·parity)을 건드리지 않고 **준비도 게이트**로 막는다 — 서비스마다 제공자, 작업마다 수행
자산이 있어야 교전이 열린다. 이 게이트가 "임무가 무엇을 필요로 하는가"를 가르친다.

## 1. 범위와 불변 조건

**유지**: `engine.js`·`attack.js`·`game.js` 의 숫자 경로와 parity, 저작 시나리오 파일
불변, ADR-0003(LLM 은 서술만)/0004(실행 경로 없음)/0009(인용)/0012(빨강=공격)/0019/0026.
**바꿈**: 가상 시나리오 `sandbox-01`, 규칙표 데이터, 편집 모드의 후보·준비도·배치·저장,
교전 시작 카드의 프리셋, 분석 계층(자동 교전·반사실·강화 제안·AAR 서술).
**ADR-0027** "교전장 — 파생 시나리오, 연결 규칙표, 준비도 게이트, 분석은 같은 코어의 재실행".

---

## A. 교전장 기반

### A1. 가상 시나리오 (파일이 아니라 파생)

`ui/src/sandbox.js` `makeSandbox(templatePayload)` 가 tacnet-01 replay 에서 브라우저 안에서
만든다.

| 물려받음 | 비움 |
|---|---|
| 임무 2, 단계 5(`window` 제거 → 전부 활성, 정적), 작업 8(`performed_at: null`), 서비스 5, 부대, `edges.requires`, `geo.georef/frame`(인제 AO) | 자산, 링크, `provided_by/hosted_on/depends_on/redundant_with`, crown_jewels, timeline, attack, 단절 |

`steps` 는 로컬 엔진 스냅샷 하나(`t = -1`). 새 파일·exporter·게이트 변경 없음. 시나리오
셀렉터에 `sandbox-01 · 교전장`. 상단에 "편집됨" 대신 `구성 중 · 자산 n · 링크 m`.

### A2. 연결 규칙표 `configs/link-rules.json`

Export-ReplayData 가 symbology 와 같은 방식으로 `ui/public/data/` 에 복사한다.

```json
{
  "template": "tacnet-01",
  "bearers": {
    "wired":  { "label": "유선",   "same_site": true },
    "vhf":    { "label": "VHF" },
    "hf":     { "label": "HF" },
    "satcom": { "label": "위성",   "needs_type": "satcom-terminal" },
    "lte":    { "label": "LTE" }
  },
  "types": {
    "c2-server":           { "bearers": ["wired", "satcom"],        "provides": ["messaging", "intel"], "performs": ["T-ORDER", "T-SITREP"] },
    "c2-terminal":         { "bearers": ["wired", "vhf", "lte"],    "performs": ["T-BFT", "T-CTRL", "T-CO1REP", "T-CO2REP"] },
    "workstation":         { "bearers": ["wired"],                  "performs": ["T-ORDER", "T-SITREP"] },
    "terminal":            { "bearers": ["wired", "lte"],           "performs": ["T-CFF"] },
    "radio-relay":         { "bearers": ["vhf", "hf"],              "provides": ["voice"] },
    "satcom-terminal":     { "bearers": ["wired", "satcom"],        "provides": ["voice"] },
    "gateway":             { "bearers": ["wired", "vhf", "lte"],    "provides": ["position-reporting"] },
    "switch":              { "bearers": ["wired"] },
    "firewall":            { "bearers": ["wired"] },
    "fire-control-server": { "bearers": ["wired", "vhf"],           "provides": ["fire-control"], "performs": ["T-CFF"] },
    "observer-terminal":   { "bearers": ["vhf", "lte"],             "performs": ["T-TGT"] },
    "database": { "bearers": ["wired"] }, "file-server": { "bearers": ["wired"] }, "mail-server": { "bearers": ["wired"] },
    "web-server": { "bearers": ["wired"] }, "domain-controller": { "bearers": ["wired"] }, "hypervisor": { "bearers": ["wired"] }
  }
}
```

후보 규칙(`linkCandidates(graph, rules, assetId)`): 두 유형의 `bearers` 교집합 중, `wired`
는 같은 `site` 일 때만, `satcom` 은 한쪽이 `needs_type` 일 때만. 이미 있는 링크 제외.
순위: 같은 site → 같은 unit → 상대가 transit → 베어러 순서(유선·vhf·satcom·hf·lte).
규칙 밖 연결은 링크 도구로 여전히 가능하되 인스펙터에 `규칙 밖` 경고.

### A3. 인스펙터 (편집 모드, 자산 선택 시)

- **site·unit 편집**: 텍스트 입력·셀렉트(유선 규칙이 site 를 쓴다). `unit` 은 `graph.units`.
- **연결 가능**: 후보 행 `능선 중계소 RELAY-1 · VHF` + "연결" 버튼 → 그 베어러로 링크 생성.
  기존 링크는 베어러 셀렉트로 바꿀 수 있음(`setLinkBearer` 재사용).
- **임무 연결 후보**: `provides` 에 맞는 서비스(`kind` 매칭)와 `performs` 의 작업만 위에
  펼치고 나머지는 접음. 기존 `setProvidedBy/setPerformedAt` 그대로.
- **보석으로 표시** 토글 → `crown_jewels` (jewel 모드용).

### A4. 준비도 카드 (레일 상단, 샌드박스에서만)

`readiness(graph)` → `{ services: {ok, missing:[ids]}, tasks: {ok, missing}, isolated: [assetIds
with no link], jewels: n, ready: boolean }`. 카드: `서비스 제공 3/5 · 작업 배치 5/8 · 고립
자산 1 · 보석 0`, 미충족 항목은 이름으로. `ready`(서비스·작업 전부 충족)여야 교전 시작
버튼 활성; 보석 0 이면 jewel 모드만 비활성.

### A5. 지도 배치

- 추가한 자산의 `geo.at`: 첫 연결 대상 기준 반경 150 m 링에서 빈 각도(같은 site 는 근접),
  연결이 없으면 AO 2 km 격자에서 자산이 없는 칸 중앙. z 는 0(표시 전용, DEM 없음).
  `placeNear(graph, assetId, anchorId)`, `placeFree(graph, assetId)` 는 순수 함수.
- 편집 모드에서 MapLibre 마커 `draggable`; drop 시 `fromLonLat` 으로 로컬 평면에 기록
  (`onChange({ reason: 'move' })`, undo 히스토리에 들어감). 푸터에 `드래그로 배치`.

### A6. 구성 저장/로드 · 내보내기/불러오기

- `mccycop:sandbox:plans` 에 `{ name, saved_at, graph }` 목록. 툴바 `저장(이름)` / `불러오기`
  셀렉트 / `삭제`. 현재 작업본은 지금처럼 `mccycop:edit:sandbox-01`.
- `내보내기`(있음) + **`불러오기`(JSON 파일)**: `graph` 를 검증(`missions/tasks/services` id 가
  템플릿과 같아야 함)하고 적용.

### A7. 공격 프리셋 (시작 카드)

`configs/link-rules.json` 옆이 아니라 `ui/src/presets.js` 에 코드로(3개, 데이터 아님):
`내부자`(transit 아닌 단말 하나 0.5), `위성링크 침해`(satcom-terminal 하나 0.8, 없으면
비활성), `다중 거점`(단말 둘 0.5). 프리셋은 `foothold` 를 **배열**로 확장한다 →
`startGame` 이 `foothold` 또는 `footholds[]` 를 받는다(하위 호환).

---

## B. 교전 분석

전부 `game.js` 위의 순수 함수(`ui/src/analysis.js`)이고 LLM 은 마지막 서술에만 쓴다.

### B1. 자동 교전 + 취약 보고

`autoPlay(g, cfg, defenderPolicy)` — `policy ∈ 'none' | 'staff'`(참모 1순위, net ≤ 0 이면
생략). 결정론(같은 시드). 결과 `{ game, firstCompromised: [{id, turn}], pathLinks: [linkIds],
lostJewel }`. `pathLinks` = 공격자가 성공한 `lateral_move` 의 (from,target) 을 잇는 링크
(도달 경로 중 그래프 링크가 유일하지 않으면 최단 경로).
- 샌드박스·tacnet 모두에서 레일 "분석" 탭: `자동 교전 실행`(hold/jewel, 턴, 시드) →
  취약 보고 카드: 먼저 뚫린 자산 3, 경로 링크(그래프·지도에 굵은 빨강으로 강조), 무대응
  vs 참모 방어 점수. 실행은 웹워커 없이 동기(13~20 자산, 8턴이면 수십 ms).
- 사용자가 직접 한 판을 끝내면 AAR 에 `내 점수 / 참모 자동 방어 / 무대응` 세 줄.

### B2. AAR 반사실 복기 + 권고 채택 표시

`counterfactual(g, game)` → 턴마다 `{ turn, actual: {id|null, p1After}, recommended:
{id|null}, followed: boolean, cfP1: number|null }`. `cfP1` = 그 턴에 참모 1순위(또는 생략)를
택하고 이후 턴은 **실제 행동을 그대로** 재적용했을 때의 최종 P1(같은 시드; 재적용이
불가능한 행동 — 이미 격리된 자산 등 — 은 생략으로 대체). AAR 표에 `권고`·`따름`·`반사실
최종 P1` 열. "따름" 비율을 AAR 머리에.

### B3. 구성 강화 제안

`hardening(g, cfg)` — 후보 변형: (a) 링크 하나 제거(`links` 각각), (b) 서비스에 제공자
추가(제공자가 하나뿐인 서비스에, 같은 유형의 기존 자산이 있으면 그것을 `provided_by` 에 추가
— 새 자산은 만들지 않음). 각 변형을 `autoPlay(policy:'staff')` 로 채점(hold 점수 낮을수록,
jewel 버틴 턴 높을수록). 상위 3 을 "강화 제안" 카드에 `이 변형 적용` 버튼(편집으로 적용,
undo 가능). 실행 비용: 변형 수(≤ 20) × 자동 교전.

### B4. AAR 서술 (LLM 있으면)

`aarFacts(g, game, cf)` → F1..Fn(결과, 점수, 따름 비율, 가장 아팠던 턴, 반사실 최대 차이).
`narrateStaff` 재사용(프롬프트 텍스트만 "AAR 을 읽어 준다"). 없으면 표만. 서술은 저장하지
않는다.

---

## C. 화면

- 시나리오 셀렉터: `sandbox-01 · 교전장`.
- 편집 툴바(샌드박스): `저장` `불러오기 ▾` `JSON 불러오기` + 기존.
- 레일: 샌드박스에서 준비도 카드가 임무 카드 위에. 탭에 **분석** 추가(자동 교전·강화 제안).
- 인스펙터: A3.
- 시작 카드: 프리셋 버튼 3, 준비도 미충족 시 잠금 사유.
- AAR: B2 열 + B1 세 줄 + B4 문단.
- 그래프·지도: 취약 경로 링크 강조(빨강 굵게, 분석 탭이 열려 있을 때만).

## D. 파일

신규: `ui/src/sandbox.js`(+test), `ui/src/analysis.js`(+test), `ui/src/presets.js`,
`configs/link-rules.json`, `ui/src/ui/Readiness.jsx`, `ui/src/ui/Analysis.jsx`,
`docs/adr/0027-sandbox-and-analysis.md`, `docs/23-sandbox.md`.
수정: `App.jsx`, `editor.js`, `Rail.jsx`, `Wargame.jsx`, `game.js`(footholds[]),
`MapPane.jsx`(드래그·경로 강조), `GraphCanvas.jsx`(경로 강조), `BoardToolbar.jsx`,
`Topbar.jsx`, `Onboard.jsx`, `Export-ReplayData.ps1`, STATE/decisions.

## E. 검증

- vitest: sandbox(makeSandbox 형태, readiness 4경우, linkCandidates 규칙 5경우, placeNear
  충돌 없음, 저장/로드 왕복), analysis(autoPlay 결정론·정책 차이, counterfactual followed
  계산, hardening 후보 수·정렬), game(footholds[] 하위 호환). 기존 45 유지.
- parity, 게이트 8/8. Playwright: 빈 교전장 → 자산 6개 배치·연결·임무 연결 → 준비도 충족
  → 프리셋으로 시작 → AAR(반사실 열) → 분석 탭 자동 교전·강화 제안 스크린샷.

## F. 하지 않는 것

엔진의 "제공자 없음=불가용" 변경, 샌드박스 파일을 `scenarios/` 에 두는 것, 시간축·환경 단절
편집, 서버 저장·공유, 자산 유형 신설, 규칙표 UI 편집, 강화 제안의 새 자산 생성, 실시간
자동 진행, LLM 이 변형·행동을 고르는 경로.

## G. 순서

A(계획 1): 규칙표+sandbox.js → 가상 시나리오·저장/로드·불러오기 → 인스펙터 → 준비도·시작
잠금 → 지도 배치·드래그 → 프리셋(footholds[]) → 문서.
B(계획 2): analysis.js(autoPlay·counterfactual·hardening) → 분석 탭·취약 경로 강조 → AAR
열·세 줄·서술 → ADR-0027·docs/23·검증.
