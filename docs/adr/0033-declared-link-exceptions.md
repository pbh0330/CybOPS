# ADR-0033. 시나리오의 추상화 예외는 링크 데이터에 선언한다

**상태**: 채택 (2026-10-14). 아무것도 대체하지 않는다. ADR-0027(교전장 준비도)이 규칙표를
도입한 자리에, **규칙표가 틀렸을 때와 시나리오가 단순화했을 때를 구분하는 방법**을 더한다.

## 맥락

`ui/public/data/link-rules.json` 은 어떤 자산 유형이 어떤 베어러를 타는지, 그 베어러에
무슨 조건이 붙는지를 적는다. `wired` 에는 `same_site: true` 가 붙어 있다 - 유선은 같은
위치 안에서만 잇는다. `ui/src/sandbox.js` 의 `linkFitsRules` 가 이 표를 읽어 **이미 놓인
링크**를 판정하고, 그 결과가 인스펙터의 `규칙 밖` 표시와 상황도의 점선 유령 선이 된다.

U13 이 링크 하나를 이름으로 집는 대신 **시나리오의 모든 선언된 링크를 `linkFitsRules` 에
통과시키는** 검사를 썼다. 열 건이 걸렸다. 한 건(`L-VHF-RLY`)은 규칙표에서 `c2-server` 가
`vhf` 를 빠뜨린 것이어서 표의 행을 고쳐 닫혔다. **남은 아홉 건은 전부 사이트가 다른
`wired` 링크다.**

- tacnet-01: `L-TOC-FDC` (여단 TOC - 포병 FDC)
- defnet-01: `L-SW-ESX02`, `L-SW-DC02`, `L-SW-DB02` (본부 전산실 - 예비 전산실),
  `L-FW-WKS001`~`L-FW-WKS005` (본부 전산실 - 각 부대 워크스테이션)

**그런데 defnet-01 은 이미 자백하고 있었다.** `mission.json` 의 `_links_note` 마지막 두
문장이 "부대별 액세스 스위치는 모델링하지 않는다. 이 추상 수준에서 FW01 이 사용자 구간의
집선·정책 지점 역할을 겸한다" 라고 적고, `notes[5]` 가 "예비 전산실용 스위치(SW02)를 두지
않았다 - 알면서 넣지 않은 한계다" 라고 적는다. 실제 토폴로지라면 각 부대에 액세스 스위치가
있고 FW01 은 그 위에 있는데, 시나리오가 그 계층을 접었다.

즉 **규칙이 틀린 것도 아니고 데이터가 틀린 것도 아니다. 공개가 틀린 자리에 있었다.**
`_links_note` 와 `notes[5]` 는 사람만 읽는 산문이고 `linkFitsRules` 는 산문을 읽지 못한다.

### 같은 모양의 실패가 이 저장소에서 세 번 났다

이 항목이 이 ADR 을 편의가 아니라 규칙으로 만든다.

1. `docs/15-propagation-functions.md` 11절의 전역 주의문은 옳게 적혀 있지만 **파일 끝에**
   있다. 5.2절의 계산 예제를 읽으러 온 사람은 그 주의문을 만나지 않는다. 같은 날 고쳤다.
2. 올바른 수치 84.4% / 100.0% 는 2026-09-07 커밋 `4cb8070` 에서
   `docs/adr/0017-temporal-mission-graph.md` 의 **주석으로** 적혔다. 그런데
   `scenarios/defnet-01/mission.json` 은 그 뒤 **다섯 주 동안** 80.5% 를 "실측 확인" 으로
   들고 있었고, UI 가 실제로 읽는 리플레이에도 낡은 값이 박혀 있었다. 둘 다
   [ADR-0032](0032-evaluation-integrity.md) 의 자기검사 절에 기록돼 있다.
3. 이번 건. `_links_note` 가 `linkFitsRules` 에 닿지 않았다.

세 번 다 **사실은 이미 적혀 있었다.** 적힌 자리가 기계에 닿지 않았을 뿐이다. 같은 날
U10 이 `checkGraphMirror` 를 만든 이유도 같다 - 리플레이가 `mission.json` 과 어긋나도
아무도 말해 주지 않았다.

## 결정

**시나리오의 추상화 예외는 링크 데이터에 선언한다. 산문 주석에만 두지 않는다.**

링크에 `rule_exception` 필드를 둔다.

```json
{"id": "L-FW-WKS001", "a": "FW01", "b": "WKS001", "bearer": "wired",
 "rule_exception": {"exempts": ["same_site"],
                    "why": "부대별 액세스 스위치를 모델링하지 않아 FW01 이 사용자 구간의 집선·정책 지점을 겸한다(_links_note)."}}
```

세 가지를 지킨다.

**1. 이름은 `_` 로 시작하지 않는다.** 이 저장소에서 `_links_note`, `_transit_note`,
`_geo_note` 처럼 `_` 접두는 **사람만 읽는 산문**이라는 뜻으로 쓰이고 있다. 기계가 읽는
필드가 그 관례를 어기면 다음 사람이 산문으로 읽고, 그것이 애초의 실패 모양이다.

**2. `why` 는 필수다.** 이유 없는 선언은 **예외로 인정하지 않는다** - 그 링크는 여전히
규칙 밖이다. 이유 없는 면제는 판정기를 끄는 스위치이고, 끄는 스위치는 곧 전부 켜진다.
`why` 는 **무엇이 모델링되지 않았는지**를 적는 자리이고, 위 두 시나리오의 이유는 새로 쓰지
않고 `_links_note` 와 `notes[5]` 의 문장을 출처로 인용했다.

**3. 무엇을 면제받는지 명시한다.** `exempts` 는 규칙표가 베어러에 붙인 조건의 이름을
적는다(`same_site`, `needs_type`). "이 링크는 규칙 밖이어도 된다" 는 넓은 면제는 **다음에
생길 다른 종류의 위반까지 조용히 덮는다.** 특히 **"두 끝이 그 베어러를 탄다" 는 검사는
면제 대상이 아니다**(`sandbox.js` 의 `EXEMPTABLE`). 그것은 시나리오의 추상화에 대한 질문이
아니라 **규칙표의 행에 대한 질문**이고, 답은 행을 고치는 것이다 - `L-VHF-RLY` 가 바로 그
경우였고, 넓은 면제를 허용했다면 그 빠진 행까지 덮였을 것이다.

**선언된 예외는 숨지 않는다.** 인스펙터는 그 링크에 `선언된 예외` 를 표시하고 `why` 를
title 에 싣는다. 단순화를 데이터로 적는 목적은 감추는 것이 아니라 **보이게** 하는 것이다.

## 기각한 대안

### (가) `same_site` 를 "제안에만 쓰는 선호" 로 내린다

처음 떠오르는 답이고, `linkFitsRules` 바로 위 주석이 막으려고 세운 불변식을 깬다.

> The same reading linkCandidates uses to PROPOSE a link, applied to one that is
> there already: the inspector's 규칙 밖 mark and the overlay's dotted ghost line
> (derive.linkGhosts) are one predicate, so the flag and the line can never disagree.

제안과 판정이 다른 규칙을 읽기 시작하면 화면의 표시와 상황도의 선이 같은 링크를 두고
어긋날 수 있다. **하지 않는다.**

선언 방식은 이 불변식과 충돌하지 않는다. `linkFitsRules` 는 **존재하는 링크**를 보므로 그
링크의 선언을 읽을 수 있고, `linkCandidates` 는 **아직 없는 링크**를 만드므로 읽을 선언이
없어 사이트 밖 유선을 여전히 제안하지 않는다. **두 질문이 다른 것이지 판정기가 둘인 것이
아니다.** 이것을 테스트로 못 박았다(`sandbox.test.js`
"leaves linkCandidates refusing wired across sites").

### (나) 액세스 스위치를 실제로 모델링한다

올바르기는 하다. 그러나 자산이 늘면 전파 경로가 바뀌고 저하도 수치가 바뀌며, 리플레이와
**같은 날 U10 이 엔진으로 다시 잰 84.4% / 100.0%** 가 또 무효가 된다. **표시 문제를 고치려고
판단 입력을 바꾸는 것이고**, ADR-0031 이 0.3 foothold 를 올리는 길을 거부한 것과 같은
이유로 하지 않는다.

## 저하도 수치가 바뀌지 않음을 확인한 방법

`rule_exception` 은 `linkFitsRules` 만 읽는다. 엔진(`engine.js`)은 링크에서 `a`, `b`,
`outages` 만 보고 이 필드를 모른다. 약속으로 두지 않고 셋 다 측정했다.

| 확인 | 변경 전 | 변경 후 |
|---|---|---|
| `node ui/tools/parity.mjs` | 1622 값 / 불일치 0 | **1622 값 / 불일치 0** |
| defnet-01 M-C2, DC01+DC02 침해 | 84.4% | **84.4%** |
| defnet-01 M-C2, ESX01 격리 | 100.0% | **100.0%** |

(참고로 M-LOG 도 50.2% / 21.8% 로 그대로다.) parity 가 움직였다면 표시용 필드가 판단
경로에 닿은 것이므로 이 변경을 되돌릴 사유였다.

## 리플레이 미러를 반드시 따라간다

UI 는 `mission.json` 을 열지 않는다. 리플레이의 내장 그래프를 읽는다. 그래서 선언을
`mission.json` 에만 넣으면 **화면에서는 아무것도 달라지지 않는다** - 이 ADR 맥락 2번과
정확히 같은 실패다. 이번에는 U10 의 `checkGraphMirror` 가 즉시 잡았다.

```
FAIL  graph mirror(defnet-01): the replay's embedded graph is not the
      mission.json it was exported from (different: _links_note, links)
FAIL  graph mirror(tacnet-01): ... (different: links)
```

**막은 것은 지식이 아니라 검사기다.** 선언은 두 곳 모두에 들어갔고 게이트가 다시 통과한다.

## tacnet-01 의 `L-TOC-FDC` 는 따로 판단했다

defnet 의 여덟 건은 시나리오가 이미 근거를 줬다. tacnet 의 한 건은 근거가 없어서, 두
자산이 (가) 한 지휘소 복합체의 두 쉘터라 사실 같은 site 인지 (나) 다른 두 위치이고 야전선이
깔린 것인지를 좌표로 결정했다.

`TACGRID-01` 로컬 평면(미터)에서 TOC-SRV (4145, 2132, 185), FDC-SRV (7480, 6040, 319),
**수평 거리 5137.6 m**(3차원 5139.3 m). km 단위이므로 (나)다. 두 자산은 site 도 부대도
다르다(여단 TOC / U-BDE, 포병 FDC / U-FA). 따라서 site 문자열은 건드리지 않고 defnet 과
같은 선언을 붙였다.

## 결과

- `scenarios/*/mission.json` 과 두 리플레이의 아홉 링크가 자기 예외를 선언한다.
- `sandbox.test.js` 의 핀 목록(`TACNET_KNOWN` / `DEFNET_KNOWN`)이 **비었다.** 검사는 이제
  "시나리오의 모든 링크는 규칙을 통과하거나, 통과하지 못하는 조건을 스스로 선언한다" 이고,
  이것이 이름으로 박아 둔 목록보다 강하다.
- 규칙표의 `bearers.wired.same_site` 는 그대로다. 지우지도 false 로 바꾸지도 않았다.
