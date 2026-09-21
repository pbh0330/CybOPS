# 현재 상태 - 2026-09-21

작업 시작 전 이 파일부터 읽는다.

## 한눈에

| | |
|---|---|
| 데이터 | LANL **5/5**, AIT **1/8(의도)**, OpTC 취득 1001/1001 → **eCAR 원본 purged (09-14, 224 GB)**. 파생물 6종 + 매니페스트 + E: 백업. 남은 원본 bro 7.3 GB |
| 라벨 | LANL/AIT 확보. **OpTC 는 Inria 수정판으로 교체**(프로세스 구간, 300초 양성 113→1,717) |
| 결정 | **Q1~Q6 전부 확정**(ADR-0012~0018). 미결 없음 |
| 모델 | 시간축 온톨로지 완료(ADR-0017). LLM 4종 비교 완료, 기본 프롬프트 **briefing.ko v4** |
| UI | **2차 개편 완료(09-19, ADR-0025)**: tacnet-01 은 인제 실지형 위 MapLibre, KPI 띠·이벤트 스트림·배속, 저채도 바탕. **교전 2차(09-20, ADR-0026)**: 턴제·승패·점수·참모·그래프/지도 오버레이. `Test-UiUnit.ps1` 이 오프라인 게이트다(vitest 43개) |
| UI 교전장 | **교전장 A 완료(09-21, 브랜치 `ui/sandbox-a`, ADR-0027 은 B 에서 초안)**: `sandbox-01` 은 tacnet-01 임무 계층에서 브라우저 파생, 규칙표 후보 연결, 준비도 게이트(서비스·작업·도달성), 지도 자동 배치·드래그, 플랜 저장, 공격 프리셋 3종·`footholds[]`. vitest 68개. **다음: B 단계(분석)** |
| 다음 | 그래프 특징 실험 1회 채점(RDP 엣지 x160, 전역 첫 등장 프로세스 쌍 x5.4; docs/19 17절) → 논문. 출처 검증 체크리스트 21개(docs/02 8절) 미착수. E3 **완료**. UI 미이식 **0건**. defnet-01 공격 체인이 이제 화면에 나온다(09-14) |
| 도구 | Figma pro/Full 좌석. Node 24.20.0 **포터블 설치**, Python 3.12, Git 2.55 |

## 2026-09-21 - 교전장 A

빈 망에서 시작하는 시나리오 `sandbox-01` 을 넣었다(`docs/23-sandbox.md`, 설계
`docs/superpowers/specs/2026-09-21-sandbox-and-analysis-design.md` A 절). 브랜치 `ui/sandbox-a`.
**파일이 아니라 파생이다** - tacnet-01 replay 의 임무·작업·서비스·부대·AO 를 물려받고 자산·링크는
비운다(`sandbox.js` `makeSandbox`, exporter·게이트 불변). 규칙표 `configs/link-rules.json` 이
유형×베어러로 연결 후보를 고르고(인스펙터 `연결` 버튼, 규칙 밖은 경고만), 준비도 카드가
서비스 제공자·작업 수행 자산·**도달성**(엔진 무공격 기준선 0)이 차야 교전을 연다 - 구조가 찬
판이 공격 없이 화력지원 76 % 저하였던 것을 잡았다. 지도에는 새 자산이 빈 칸에, 연결하면 상대
옆에 놓이고 편집 모드에서 끌어서 옮긴다. 플랜은 localStorage, JSON 불러오기는 임무 계층을
검증한다. 시작 카드에 공격 프리셋 3종(내부자·위성링크 침해·다중 거점)과 `startGame`
`footholds[]`(하위 호환). ADR-0027 은 B 단계에서 쓴다. 검증: vitest 68개(sandbox 17, game 17),
`parity.mjs` 불일치 0, `Invoke-Gates.ps1` 8/8, 스크린샷 4장
(`docs/design/screens/2026-09-21-sandbox-*.png`). **다음: B 단계(분석) - 자동 교전·취약 보고·AAR
반사실·강화 제안·AAR 서술, `ui/src/analysis.js` 순수 함수.**

## 2026-09-20 - 교전 모드 2차

교전 모드를 게임으로 만들었다(ADR-0026, `docs/22-wargame.md`). 브랜치 `ui/wargame-v2`.
**격리가 공격자의 거점으로 세어지던 버그**를 잡았다 - 격리는 임무 엔진에 미가용, 공격자에게는
없는 자산이다(`attack.js` `isolated` 옵션, 기본 경로 불변). `game.js`(순수 코어) +
`Wargame.jsx`(시작 카드·방어/공격 페이즈·참모 카드·AAR), hold/jewel 두 모드, 그래프·지도에
후보수 유령 화살표·판정 번쩍임·격리 이중선, 상단 띠에 교전 턴·점수 칸. 참모는 규칙 순위표이고
모델은 있으면 읽어 주기만 한다(문장마다 [F#]). 검증: vitest 43개(game 13), `parity.mjs` 불일치
0, `Invoke-Gates.ps1` 8/8, 스크린샷 3장(`docs/design/screens/2026-09-20-wargame-*.png`).

## 2026-09-19 - UI 2차 개편

D4D 쇼케이스 49개(`https://d4d.tech/api/showcase`, 그중 깃허브 33개)를 조사했다. C2·COP
계열 20개와 우리 화면(09-14 시점)을 나란히 놓아 보니 격차가 뚜렷했다 - 쇼케이스 다수는
위성영상·3D 지구본이나 벡터 다크맵을 바탕으로 쓰는데 우리는 손으로 그린 등고선+격자였고,
상단 KPI 띠·흐르는 이벤트 로그·큰 재생 컨트롤·상시 노출 AI 패널이 없었으며 캔버스도 화면의
1/4만 채웠다. 데모가 1순위(ADR-0014)라 이 격차를 좁히기로 하고, 확정 결정을 조용히 깨는
대신 ADR-0025 를 새로 써서 무엇을 깨는지 적었다(배경지도 정책 폐기, 온라인 위성/벡터 타일
허용, 워터마크로 상쇄).

**바꾼 것.** tacnet-01 지리 뷰 엔진을 MapLibre GL JS 로 교체(`MapPane`, `georef.js`,
`mapLayers.js`)하고 좌표를 강원 인제 KCTC 일대 실지형(DEM) 위로 재저작했다. defnet-01 의
영내 배치도(`GeoPane`)는 손대지 않았다 - 분기는 `graph.geo.georef` 유무 한 필드다. UI
셸 밀도를 올려 KPI 띠(임무 저하도 최댓값 기준 정상/주의/경계/심각), replay 차분 기반
이벤트 스트림, 재생 배속 1×/4×/16×, 상시 노출 브리핑 카드를 넣었다. 바탕은 흑연에서
저채도 네이비-블랙으로 낮췄다(채도 규칙 - 크롬 무채색, 원인색 8종, 빨강은 공격 전용 - 은
그대로). 상세는 `docs/superpowers/specs/2026-09-19-ui-real-terrain-console-design.md` 와
`docs/design/decisions.md` "2026-09-19" 절.

엔진은 여전히 geo 를 읽지 않는다(ADR-0002/0001). tacnet-01 track 자산 6개(BN-SRV, BN-CP,
SAT-TERM, CO1-VEH, CO2-VEH, FO-TAB)의 `geo.source` 를 나머지 7개 고정 자산과 맞춰
`asset-register` → `authored-on-dem`(`accuracy_m` 30)으로 통일했다 - 이번 재저작이 전부
저작 좌표이지 자산대장 실측이 아니기 때문이다. `Export-ReplayData.ps1` 재실행 후
`steps[*].mission/asset/service/task/whatif` 를 재저작 전(`git show HEAD:...`)과 비교해
diff 0 을 확인했다(`generated` 타임스탬프와 6개 자산의 `source`/`accuracy_m` 필드만 변경).

**검증.** `Test-Ontology`(defnet-01, tacnet-01 둘 다) ERRORS 0, `Test-GeoInvariance` PASS,
`Test-CaseCollisions` exit 0, `Add-Bom -Check` exit 0. `npm test`(vitest) 22개 전부
PASS(georef 8, derive 8, mapLayers 6), `vite build` 성공. `Test-UiUnit.ps1` 을 새로 만들어
`Invoke-Gates.ps1` 의 오프라인 게이트에 넣었다 - 8개 게이트 전부 pass, data/model 티어 2개
skip. 스크린샷 5장(`docs/design/screens/2026-09-19-*.png`)으로 의존/전송로/지리(위성 3D,
다크 2D)/defnet 회귀를 확인 - 워터마크는 모든 바탕·차원에서 보이고, defnet-01 지리는 개편
전과 같은 영내 배치도다.

## 2026-09-11 ~ 12 - OpTC 취득이 끝났고, 300초 창은 커버리지 99.8% 로 다시 채점했다

상세는 `docs/19-e1b-design.md` 13절(09-11)과 14절(09-12).

**취득.** 09-11 에 39% -> 73%, 09-12 03:09 에 1001/1001 (249.2 GB). 쿼터가 풀린 것이지
코드가 바뀐 것이 아니다. 새 파일은 전수 gzip 검증을 통과했고(988/988, 그 뒤 새 파일도
03:09~03:52 에 검증), 매니페스트가 모르던 파일 1개를 찾아 넣었다(`100aada`).
`optc-resume.log` 의 232.1 GB 는 GiB 다. 재개 루프는 26패스를 다 돌고 20:34 에 끝났다.

**09-11 (13절): 커버리지 3배 판.** 학습 모델이 여섯 칸 모두 규칙을 이기고 MTTD 가
0/4 에서 벗어났다. 그런데 60초 09-23 에서 P@100 = 1.00 이 나왔고 그것은 성능이
아니었다 - 경보 100개가 전부 참인데 호스트는 2개. **구간 라벨에서는 precision@k 가
사건 길이에 비례해 부푼다.** `docs/04` 에 규칙을 넣었다: E1-b 의 precision@k 는 같은
예산에서 잡은 호스트 수 없이는 싣지 않는다.

**09-12 (14절): 300초 전체 데이터 판(`w300-v3`).** 125번들, 40.4억 레코드, 양성
1,714/1,717 (빠진 3개는 텔레메트리 없는 DC1).

| 컷 | 테스트 양성 | ROC | PR-AUC | P@100 | 잡은 호스트@100 |
|---|---|---|---|---|---|
| 09-23 | 389 -> 1,536 | 0.710 -> **0.786** | 0.099 -> 0.055 | 0.32 -> 0.45 | 1/8 -> **6/12** |
| 09-24 | 241 -> 703 | 0.837 -> **0.939** | 0.027 -> **0.104** | 0.04 -> 0.27 | 1/6 -> **3/7** |

09-23 컷은 학습 집합이 한 셀도 안 바뀌었다(Day 1 은 이미 100% 였다). 그 행의 변화는
전부 측정의 변화다. 09-24 컷은 학습이 3배가 됐고 여섯 칸 중 최고 PR-AUC 를 냈다.
**PR-AUC 가 가장 좋은 칸이 가장 늦게 잡는다**(첫 적중까지 중앙값 29 셀, 약 2.4시간).

**09-13: 60초·900초도 끝났다(03:35).** 세 창 모두 레코드 4,038,963,311 건, 같은 스냅샷.
채점 결과는 `docs/19` 15절. 한 줄로: **창이 길수록 같은 예산으로 더 많은 호스트를
잡는다.** 예산 100 에서 60초 2/12·1/7, 300초 6/12·3/7, 900초 6/12·**7/7**. 60초의
P@100 = 1.00 은 이번에도 호스트 2개다. 창 크기는 호스트 지표로 고른다: 900초.

**09-13 오후: 절제가 시각 특징을 잡아냈다(docs/19 16절).** `hour`·`dow` 를 빼면 09-24
컷 PR-AUC 가 0.21 -> 0.57(900초), 0.10 -> 0.56(300초). 날짜 컷에서 `dow` 는 날짜
식별자이고 `hour` 는 레드팀 근무 시간이다. **이후 E1-b 채점은 전부 `--exclude hour,dow`**
(docs/04 에 규칙 추가). 시각을 뺀 판(`*-v3-notime`)에서 09-24 컷은 세 창 모두
P@rec50 = 0.67, 호스트@100 5/7. 합집합 민감도는 세 번째도 아무것도 안 바꿨다.

**그래프 파생물을 뽑는 중이다.** `scripts/Export-EcarGraph.ps1` 이 흐름 엣지·프로세스
트리·호스트-IP 표를 한 번 순회로 뽑는다(pid 24032, 로그
`analysis/logs/optc-extract-graph-300.log`, 100k rec/s 이면 약 11시간). 스모크 테스트에서
흐름의 99.6% 가 멀티캐스트라 양 끝 유니캐스트만 남긴다. **원본 삭제는 이것이 끝나고
세 파일이 자립하는지 확인한 뒤, 사람이 한다.**

**09-14 10:40 eCAR 원본 삭제.** 224.3 GB, 125 파일. 파생물 12개를 E: 에 해시 대조 후 백업,
매니페스트에 125개 전부의 Drive id 확인, 사람 지시. `data/PURGE_LOG.md`. **이 뒤로 OpTC 에서
새 항목을 뽑으려면 재취득(나흘)이다.** 프로세스 트리도 봤다: 집계는 신호가 없고(x1.1~1.6)
특정 쌍이 순수하다(`wmiprvse → powershell` 24/24). docs/19 17.4절.

**09-14 새벽 02:24 순회 종료, 게이트 PASS.** 흐름의 98% 가 멀티캐스트, 남은 엣지의 99.9% 가
인프라(수집기·프록시·DNS) 행이라 첫 게이트(볼륨 30% 해석)는 기준이 틀려 FAIL 했고
"호스트 간 엣지 존재 + 셀 조인" 으로 고쳤다. **클라이언트 간 RDP 가 있는 셀 61개 중
58개가 공격 라벨**(x160). docs/19 17절. 원본 삭제는 아직 안 했다.

**순회가 끝난 뒤 할 일(참고용으로 남김):**

```powershell
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
Get-Content analysis\logs\optc-extract-graph-300.log -Tail 12   # elapsed 와 report 줄이 있어야 끝난 것
& $py scripts\check_ecar_graph.py                                # VERIFY 게이트. FAIL 이면 지우지 않는다
```

PASS 면 `docs/05` 절차대로 사람이 확인하고 `F:\mc-cycop-data\raw\optc\ecar` 를 지운다.
매니페스트(`configs/manifests/optc.json`)는 남는다. bro 는 별도 판단(7.7 GB, E1-b 에 안 씀).

UI: 편집 인스펙터 임무 연결 컨트롤 이식 완료(09-13). 09-10 미이식 목록은 비었다.

채점 명령(기록용, 지금은 `--exclude hour,dow` 를 붙인다):

```powershell
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
& $py scripts\run_e1b.py --features analysis\optc\ecar-windows-60.v3b.csv  --labels analysis\optc\window-labels-inria.json --tag w60-v3  --out eval\results\e1b-detection-w60-v3.json
& $py scripts\run_e1b.py --features analysis\optc\ecar-windows-900.v3b.csv --labels analysis\optc\window-labels-inria.json --tag w900-v3 --out eval\results\e1b-detection-w900-v3.json
& $py scripts\summarise_e1b.py
```

**원본 삭제는 아직이다.** 흐름 그래프·프로세스 트리를 뽑을지 먼저 결정한다(15.5절). 결정 전에는 지우지 않는다.

## 2026-09-10 - 상황도 UI 를 개편하고 React 로 옮겼다

근거는 ADR-0024. 시안은 Figma `MC-CyCOP UI Redesign` (`mwTJW4NKL4T3W44lnn6qCR`),
토큰과 결정은 `docs/design/` 아래.

**색이 의미와 충돌하고 있었다.** 브랜드 강조색 `#35e0ff` 와 원인 색 `--mobility: #35c8ff`
가 사실상 같은 색이었다. 더 나쁜 것은 `graph.js` 의 `degColor` 였다 - 주석에 "Not a red
ramp" 라고 적혀 있는데 마지막 단계가 `#8f2f39` 다. **저하도가 심한 노드와 공격받은 노드가
같은 색이었다.** ADR-0012 가 색에 실어 둔 의미가 두 군데서 새고 있었다.

규칙을 하나로 정했다. **채도는 의미에만 쓴다.** 크롬에는 유채색이 없고, 저하도는 무채색
휘도(밝을수록 나쁘다), 원인은 테두리다. 지키는지 눈으로 볼 수 있다 - 크롬에 색이 보이면
위반이다.

**렌더링은 React 로 옮겼다.** ADR-0018(Cytoscape·Vite 정적 번들·CDN 미의존)은 전부
유지된다. 바뀐 것은 `main.js` 1,273 줄의 명령형 DOM 계층뿐이고, 엔진·그래프·지형·워게임·
공격 모듈은 한 줄도 건드리지 않았다. `parity.mjs` 가 **1,269개 값 비교 불일치 0건**으로
그것을 확인한다.

번들은 **1,480 → 1,622 kB (+142 kB)**. React 런타임 값이다.

**밝기는 두 번 올렸다.** 첫 시안이 너무 어두웠고, 1차 상향 후 스크린샷으로는 차이가
안 보여 "반영이 안 됐다"고 잘못 판단했다. 픽셀을 재 보니 올라가 있었다
(상단바 23,24,26 → 33,36,41 → 42,46,51). **축소 이미지로 밝기를 판정하지 말 것.**

**09-12 추가:** 지리 뷰 군집 축약(마커 + 개수 배지, 눌러서 펼침)과 라벨 자리 고르기
(8 슬롯, 마커·라벨·지명 회피)를 넣었다. 남은 것은 편집 인스펙터의 임무 연결 컨트롤
하나. `docs/design/decisions.md` 마지막 절 참조.

## 2026-09-10 - OpTC 라벨을 교체했다. E1-b 첫 날짜 경계 결과가 나왔다

상세는 `docs/19-e1b-design.md` 12절.

**우리 라벨은 점이고 평가 단위는 구간이었다.** 그라운드트루스 PDF 에서 뽑은
행동 101건은 행동이 일어난 **분**을 가리키고, Inria 가 라벨한 것은 악성 프로세스가
**살아 있던 구간**이다. 심은 프로세스가 3시간 돌면 그 시간의 창이 전부 공격 활동을
담는데, 우리는 첫 창만 양성으로 쓰고 나머지를 음성으로 둔 것이다. **모델이 맞혀도
오탐으로 집계됐다.**

| 창 | 우리 | Inria | 공통 | 우리만 | Inria 만 |
|---|---|---|---|---|---|
| 60 s | 141 | 8,454 | 107 | 34 | 8,347 |
| 300 s | 113 | 1,717 | 96 | 17 | 1,621 |
| 900 s | 89 | 597 | 75 | 14 | 522 |

우리 셀의 85% 가 Inria 쪽에도 있다. **찍은 것은 대체로 맞았고 놓친 것이 열 배였다.**
출처는 Inria PIRAT, CSET 2025, DOI 10.57745/UXCWOC, CC BY 4.0, 로그인 불필요.

**추출은 다시 하지 않았다.** `host_key` 가 호스트 문자열의 FNV-1a 이고 솔트가 없어
이름에서 되계산된다. CSV 안 450개 키와 450/450 일치. `scripts/relabel_ecar_windows.py` 가
라벨 열만 다시 썼다. 추출 3회 450분을 아겤다.

**바꾸는 과정에서 두 개를 잡았다.** 숫자만 뽑는 정규식이 `DC1` 을 `1` 로 만들어
`SysClient0001` 에 붙였고(그 상태로 만든 호스트 비교표는 틀렸다), 끝 시각이
`Infinity` 인 행 12개를 첫 판이 조용히 버렸다. 그 12개는 캡처 종료까지 살아있던
프로세스라 **창을 가장 많이 덤는 라벨**이었다. 지금은 날 끝/캡처 끝으로 클램하고
**그 밖의 파싱 실패는 예외를 던진다.**

**첫 날짜 경계 채점이 성립했다**(300초 양성 62 → 214).

| 창 | 컷 | 테스트 양성 | 규칙: 새 목적지 | histgb | logreg |
|---|---|---|---|---|---|
| 60 s | 09-23 | 152 | 0.529 | 0.663 | **0.772** |
| 60 s | 09-24 | 152 | 0.525 | 0.653 | **0.711** |
| 300 s | 09-23 | 36 | 0.623 | **0.719** | 0.707 |
| 300 s | 09-24 | 36 | 0.615 | **0.719** | 0.630 |

네 칸 모두 학습 모델이 두 규칙을 이긴다. 11절에서 한 시간 차로 방향이 뒤집히던
것과 다르다. **그 불안정의 상당 부분은 모델이 아니라 라벨이었다.**

그래도 주장할 수 있는 것은 좁다.

- 리프트는 2~5배 수준이고 **MTTD 는 네 칸 모두 0/4 호스트**다.
- **커버리지가 11~15%**다(60초 950/8,454, 300초 214/1,717, 900초 89/597).
  라벨된 셀의 약 88% 는 아직 텔레메트리가 없다. **Phase 4·5 취득이 끝나야 진짜
  숫자다. 낮은 재현율을 모델 탓으로 읽으면 안 된다.**
- 900초는 여전히 분할이 성립하지 않는다(테스트 양성 14).

### 17개 셀 분쟁 - 닫혔다

`scripts/compare_label_disputes.py`, 근거는 `analysis/optc/label-dispute-{60,300}.json`.

그라운드트루스에는 두 종류의 줄이 있다. **관측된 행동**은 시각이 진짜고
(`11:23:29`), **요약 줄**은 둥글다(`15:30:00`). 초가 `:00` 인가 하나로 17개가
정확히 갈린다.

- **13개는 우리가 못 쓴다.** 활동이 없어서가 아니라 **둥글게 적힌 시각은 5분짜리
  창 하나를 지명할 수 없기 때문**이다. 게다가 한 줄을 호스트 9개로 퍼뜨렸다.
- **4개는 Inria 가 놓쳤다.** RDP 접속·종료, 악성 문서 메일 발송. 생존 구간 라벨은
  **악성 프로세스를 만들지 않는 행동을 볼 수 없다.** 네 개 모두 Inria 구간 시작
  65~580초 전이다. 결과가 아니라 원인 쪽이다.

합집합 라벨로 다시 돌렸다(학습 양성 798->815, **테스트 집합 152개 동일**).

| 컷 | histgb | logreg |
|---|---|---|
| 09-23 | 0.663 -> **0.698** | 0.772 -> 0.763 |
| 09-24 | 0.653 -> **0.682** | 0.711 -> 0.700 |

**결론은 안 바뀐다.** 기본 라벨은 손대지 않은 Inria 판으로 둔다(다른 논문과 비교
가능해야 한다). 합집합은 민감도 검사로만 남긴다.

### 그 과정에서 함정 하나를 더 메웠다

**`run_e1b.py --labels` 는 라벨을 붙이지 않는다.** 라벨 열은 추출기나
`relabel_ecar_windows.py` 가 쓴 것이고 `--labels` 는 기대 개수만 읽는다. 다른 라벨
파일을 넘긴 첫 민감도 실행이 **양성 개수까지 토씨 같은 수치**를 내서 발견처럼
보였다. 지금은 CSV 라벨 열과 라벨 파일을 **양방향으로** 대조하고 어긋나면 멈춘다.
한쪽만 보면 안 된다 - **라벨 파일에 있고 행도 있는데 0 으로 남은 셀**이 안 보이는
쪽이다.

### IEEE 외장하드 아카이브는 쓰지 않는다 (보험으로만 남긴다)

`E:\연구실_2026_08_31\OpTC.tar.gz` (308 GB). 내용을 직접 열어봤다.

```
OpTC/24Sep19/Sys652.dat -> {"timestamp":"2019-09-24T13:59:01.280Z","opcode":"33",
  "provider_guid":"89497F50-...","host":"Sys652","opcode_name":"CloseHandle",
  "raw_payload":true,"suspicious_activity":0,"compromised":0}
```

**Drive 에서 받던 eCAR 이 아니라 원시 ETW 다.** 우리 추출기가 읽는 스키마
(`object`/`action`/`hostname`)가 아예 없다. 날짜는 24Sep19(501개)와
23Sep19-night 이라 **막힌 Phase 4·5 바로 그것**이다.

그래도 안 쓰는 이유 셋.

1. **형식을 섞으면 날짜 경계가 형식 경계가 된다.** 24Sep19 만 ETW 로 넣으면 모델이
   공격이 아니라 파일 형식을 학습한다. 설계 전체가 무너진다.
2. **비용.** 실측 압축비 37배(0.6 GB gz -> 22.4 GB, 90초). 전체 약 11 TB, `.tar.gz` 는
   건너뛸 수 없으므로 **29개 호스트를 보려고 501개를 다 풀어야 한다**(1회 순회 약 13시간).
3. **내장 플래그가 비어 있다.** 표본 3,130만 건에서 `suspicious_activity`·`compromised`
   가 전부 0. 쓸모 있는지 확인하는 비용이 그냥 다 읽는 비용과 같다.

**Drive 경로는 살아 있다** - 밤사이 Phase 4 가 0% -> 23% 로 올랐다. 재개 루프는
계속 돌고 있다(26패스 x 55분). 아카이브는 Drive 가 끝내 안 풀릴 때를 위한 보험으로
외장하드에 둔다. 목록은 `analysis/optc/ieee/listing.txt`.

## 2026-09-08 ~ 09 세션이 남긴 것 (읽고 시작할 것)

### OpTC 취득 - 막힌 것은 Phase 4 다 (코드 문제가 아니다)

| phase | 내용 | 파일 | 완료 | 계획 GB | 보유 GB | |
|---|---|---|---|---|---|---|
| 1 | ecar-bro 전체 | 80 | 80 | 0.7 | 0.7 | 100% |
| 2 | ecar 23Sep19-red (Day 1) | 25 | 25 | 35.9 | 35.9 | 100% |
| **3** | ecar 25Sept (Day 3) | 26 | 11 | 28.3 | 11.0 | **39%** |
| **4** | **ecar 24Sep19 (Day 2)** | 42 | **0** | 102.6 | 0.0 | **0%** |
| **5** | ecar 23Sep-night | 32 | 1 | 74.0 | 3.8 | **5%** |
| 6 | bro | 796 | 796 | 7.7 | 7.7 | 100% |

원인은 **구글 드라이브의 파일별 다운로드 쿼터**다. 소진되면 2,009바이트짜리
`Quota exceeded` HTML 을 **HTTP 206 으로** 보낸다. 성공 코드라 `curl --fail` 이
못 거르고, 2,009바이트는 로그에 `+0.0 MB` 로 찍혀 죽은 연결처럼 보인다.

- **서버에 다시 물어보는 방식은 못 쓴다.** 앞 512바이트만 요청하면 진짜 gzip 이
  오고 전체를 요청하면 쿼터 페이지가 오는 일이 같은 1분 안에 일어났다. 그래서 받아
  놓은 바이트의 첫 글자가 `<` 인지를 본다.
- **지우는 쪽이 더 중요하다.** 2,009바이트를 두면 다음 시도가 `-C -` 로 오프셋
  2009 에서 재개하고, 그 사이 쿼터가 풀리면 `[HTML][진짜 gzip]` 이 기대 길이에
  정확히 맞는다. **2026-09-06 오염 사고가 그것이다.**
- 결과: 막힌 파일 하나에 **12분에서 2초**. 100개 목록을 몇 분에 훑고 안 막힌 것만
  받는다.
- **재개 루프**(`scripts/Resume-OptcFetch.ps1`)가 밤새 돌았고 한 바이트도 못 늘렸다.
  쿼터가 안 풀렸다.
- **그 과정에서 fetch 쪽 버그를 하나 잡았다.** Drive 가 한 파일에 503 을 주면
  **패스 전체가 죽고 있었다.** PowerShell 5.1 에서 `$ErrorActionPreference = 'Stop'`
  일 때 네이티브 명령의 stderr 가 종료 오류가 되기 때문이다. 07:11 과 08:07 패스가
  그렇게 첫 503 에서 끝났고 88개 파일이 한 번도 재시도되지 못했다. **한 파일의
  일시적 서버 오류는 여기서 가장 흔한 일이고 그것이 밤을 끝내고 있었다.** 이제
  종료 코드만 읽고 stderr 는 버린다 - 아래 검사들(증가분, 쿼터 페이지, 크기,
  gzip 매직)이 전부 curl 의 말이 아니라 디스크의 바이트를 본다.
- 아침에 10패스 x 60분 루프를 다시 걸어뒀다(08:08 시작, 18시경 종료).

**Phase 4 는 102.6 GB 이고 0% 다. E1-b 의 날짜 분할은 며칠 단위로 봐야 한다.**

### E1-b - 파이프라인은 전부 확인됐고 데이터만 없다

- **창 3종 추출**: 60초(04:10)와 900초(06:38)가 **같은 스냅샷**에서 끝났다. 입력이
  레코드 수까지 같다(37번들, 8.4억). 둘 다 **LATE 0**, **건너뛴 파일 0**.
  300초는 26번들 시절 것이라 같은 스냅샷에서 다시 뽑는 중이다(~09:10).

  | 창 | 셀 | 양성 | 라벨 기대 | 커버리지 |
  |---|---|---|---|---|
  | 60 s | 263,062 | 70 | 141 | 50% |
  | 900 s | 18,413 | 52 | 89 | 58% |

  **커버리지를 창 사이에 비교하면 안 된다.** 58%가 50%보다 나은 것이 아니라, 창이
  크면 한 셀이 여러 행동을 담아 빠진 호스트를 덜 타는 것이다.
- **채점 경로를 처음 돌렸다.** 분할이 매번 건너뛰어져서 PR-AUC·MTTD·모델 4종이 한
  줄도 실행된 적이 없었다. `--split hour` 로 같은 날 안에서 잘라 돌렸고 정상
  동작했다. **그것은 E1-b 가 아니다** - 같은 캠페인·같은 날·같은 호스트라 서명이
  경계를 넘는다. 보고서 JSON 안에 그 주의사항이 함께 적힌다.
- 거기서 나온 것 둘.
  - **같은 날 한 시간 차이로 방향이 뒤집힌다.** 60초 13시 컷은 ROC 0.738 에 리프트
    85배인데 14시 컷은 ROC 0.328 로 무작위보다 나쁘다. **분할 하나만 돌렸다면 어느
    숫자든 그럴듯해 보였을 것이다.**
  - **900초에서는 `새 목적지 개수` 한 칸짜리 규칙이 histgb 를 이긴다**(PR-AUC
    0.00638 vs 0.00434). `summarise_e1b.py` 가 모델을 전부 찍는 이유가 이것이다.
    최고 성적만 요약하면 이 칸이 표에서 사라진다.
  - MTTD 는 세 칸 모두 참혹하다. 예산 100 에서 양성 호스트 25개 중 1개, 나머지 둘은
    0개.
- **창 크기 셋은 아직 비교할 수 없다.** 300초는 26번들, 60초는 37번들에서 뽑혔다.
  입력이 다르면 창 비교가 아니라 취득 진행도 비교가 된다. 취득이 끝난 뒤 같은
  스냅샷에서 셋을 다시 뽑는다.
- **내 쿼터 수정이 추출을 한 번 깨뜨렸다.** 스캔이 파일 목록을 시작할 때 잡는데
  fetch 가 그 사이 쿼터 HTML 을 지웠다. 스캔 쪽에 파일 단위 예외 처리와 건너뛴 수
  보고(`vanished_files`)를 넣었다.

### E3 는 실험이 끝났고 프롬프트 v4 가 기본이 됐다

`docs/20-e3-design.md` 6~10절이 이번 세션 결과다. 세 가지 시험을 만들었다.

| 시험 | 무엇을 묻는가 | 스크립트 |
|---|---|---|
| 온전한 팩 | 근거가 다 있을 때 프롬프트가 치르는 비용 | `Compare-BriefingModels.ps1` |
| 결손 팩 | 사실을 빼면 거부하는가, 그래도 말하는가 | `Invoke-AbstentionProbe.ps1` |
| 주입 팩 | 근거 안의 지시가 화면까지 오는가 | `Invoke-InjectionProbe.ps1` |

**v4 를 `prompts/briefing.ko.md` 로 승격했다.** 세 축 전부에서 v3 이상이고 v6 에게
어느 축에서도 지지 않는다. 승격 전에 확인할 것은 "결손에서 좋아진 것이 온전한
팩에서 나빠진 대가인가" 였는데, 대가가 없었다(14B 가 v4 에서 24/24 통과, 위반 0).

| | v3 7B/14B | **v4 7B/14B** | v6 7B/14B |
|---|---|---|---|
| 온전한 팩 통과 (24회) | 19 / 21 | **20 / 24** | 20 / 21 |
| 온전한 팩 위반 | 10 / 3 | **4 / 0** | 4 / 3 |
| 결손 팩 거부 (표적 81) | 0 / 35 | **59 / 52** | 54 / 54 |
| 결손 팩 대체 | 14 / 14 | **0 / 14** | 2 / 14 |
| 주입 준수 (12회) | 3 / 6 | **2 / 5** | 2 / 4 |
| 결손 팩 날조 | **0 / 0** | **0 / 0** | **0 / 0** |

읽을 때 조심할 것 두 가지.

- **날조는 어느 칸에서도 0이다.** 제거한 숫자를 그대로 말한 경우가 없다. 이 축은
  문제가 아니었다.
- **프롬프트 개정이 7B 에서만 통했다.** 최우선 임무의 근거를 빼면 v3 에서 두 모델
  모두 16개 중 14개를 다른 임무로 바꿔치기했다. v4 는 7B 의 그것을 0으로 만들었고
  **14B 는 세 버전 모두 14건 그대로다.**

### 브리핑 발행에 관문이 생겼다 (ADR-0022, 2026-09-09)

번들의 브리핑은 누가 손으로 복사해 넣은 것이었고 **생성과 번들 사이에 아무 관문이
없었다.** 이제 `scripts/Publish-Briefings.ps1` 이 그 절차다.

```
팩 -> 브리핑 -> 검사 둘(인용, 커버리지) -> 실패하면 재생성(최대 3회) -> 그래도 실패하면 미발행
```

- **재시도는 발행 도구이고 평가 도구가 아니다.** 발행은 산출물을 고르는 일이라
  다시 돌려도 되고 몇 번째 시도였는지만 적으면 된다. 평가 스크립트 셋은 한 번만
  돌리고 재시도 옵션이 아예 없다. `Publish-Briefings.ps1` 로 평가 숫자를 내면 안 된다.
- **발행 기준이 평가 기준보다 엄하다.** 인용률 100%를 요구한다(평가는 80%).
  다시 만들 수 있는 것에 딱지를 붙이지 않는다.
- **떨어진 시각은 옛 산출물도 지운다.** 첫 실행에서 t+300 이 떨어졌는데 v1 프롬프트
  시절 브리핑이 번들에 그대로 남아 있었다. 미발행이 "옛것 유지" 를 뜻하면 ADR 이
  막으려던 상태 그 자체다.
- **기본 모델이 gemma2:9b 가 됐다.** 검사가 그 모델의 실패(유령 인용, 대체)를
  잡아주므로 남는 것은 사실 정확성 74~75%(qwen7b 는 50%)다. 되돌리는 비용은
  `-Model` 인자 하나다(ADR-0007).

현재 번들: 3개 시각 전부 1회차 통과, 인용률 100%, 커버리지 `addressed`.

### 호스팅 산출물이 준비됐다

`ui/dist-hosted` (0.44 MB zip: `ui/mc-cycop-hosted.zip`). `off` 자세이고
`Test-BundleConfig.ps1 -Posture hosted` 를 통과한다. 둘 다 gitignore 대상이고
두 명령으로 다시 만들어진다.

**남은 것은 서버뿐이다.** 절차는 `docs/21-deployment.md` 4절.

### 앞서 보고했던 E3 수치는 폐기됐다

채점기를 세 번 고쳤고, 그 전 숫자는 전부 틀렸다(20절 7절). 요약하면 **"거부가 한
번도 안 나온다" 의 절반이 채점기 탓**이었다. 거부 문장에 대상 이름을 요구했는데
그 이름은 사실과 함께 지워진 뒤였다. 그리고 저장소 **네 번째 대소문자 변수 충돌**을
이 과정에서 내가 만들었다(`$SlotTerms` / `$slotTerms`).

`prompts/briefing-labels.ko.json` 의 사실 템플릿에서 **문장 중간 마침표를 없앴다.**
인용 검사기가 마침표를 문장 경계로 쓰므로 사실 하나가 두 문장으로 쪼개져 뒷조각이
"인용 없는 문장" 으로 집계되고 있었다. 이 수정 이후의 팩으로 다시 잰 것이 위 표다.

### 아침에 확인할 것

```powershell
cd F:\F\other_class\CybOPS
git log --oneline | Select-Object -First 8

# 밤새 얼마나 받았나 (구글 드라이브 쿼터가 얼마나 풀렸나)
Get-Content analysis\logs\optc-resume.log -Tail 20

# E3 전체 표 한 장
python scripts\summarise_e3.py

# E1-b 창 크기 표
python scripts\summarise_e1b.py

# 취득이 얼마나 늘었나. phase 4 가 0% 를 벗어났는지가 E1-b 의 관문이다.
python scripts\optc_progress.py

# 창 크기 3종이 다 나왔나
Get-ChildItem analysis\optc\ecar-windows-*.summary.json |
  ForEach-Object { (Get-Content $_ -Raw | ConvertFrom-Json) } |
  Select-Object window_sec, positives, positive_cells_expected, late_records, vanished_files, cells_created
```

`late_records` 가 0이 아니면 그 창은 플러시 수정 전 판이므로 다시 뽑아야 한다.

## 위치

| | 경로 |
|---|---|
| 저장소(코드·문서) | `F:\F\other_class\CybOPS` |
| 데이터 1순위 | `F:\mc-cycop-data\raw\` |
| 데이터 예비 | `C:\mc-cycop-data\raw\` (F: 여유가 부족할 때만) |
| 원격 | `git@github.com:pbh0330/CybOPS.git` - **푸시 완료** |

**저장 위치는 `scripts/Get-DataRoot.ps1`이 정한다.** F: 우선, 예비 50GB를 남기고
부족하면 C:로 넘어간다. 데이터셋을 두 볼륨에 쪼개지 않는다. 상세는
`docs/05-data-lifecycle.md` [0] PLACE.

```powershell
.\scripts\Get-DataRoot.ps1 -Report                      # 용량 현황
$root = .\scripts\Get-DataRoot.ps1 -Dataset optc -NeedGB 60
```

> 2026-09-05 저장소를 `C:\Users\qwert\Documents\mc-cycop`에서 옮겼다. 41개 파일 전량 이동했고
> 구 경로는 삭제했다. 문서에 남아 있던 구 경로 참조도 정리했다.

**버전 관리 동작 중.** Git 2.55.0.3, `main` 브랜치, `origin/main`과 동기.

인증은 **SSH 키**를 쓴다(`~/.ssh/id_ed25519_github`, `~/.ssh/config`에 github.com 항목).
HTTPS + 비밀번호는 GitHub이 2021년 8월에 막았으므로 쓸 수 없고, 자격증명 관리자(GCM)는
이 세션 셸에 tty가 없어 프롬프트를 띄우지 못한다. SSH는 그 두 문제를 모두 우회한다.

```powershell
cd F:\F\other_class\CybOPS
git push        # 추가 입력 없이 동작한다
```

`.gitignore` 주의: `data/`가 아니라 `data/*`로 써야 한다. 디렉터리를 통째로 제외하면
Git이 그 안을 보지 않아 `!data/README.md` 예외가 무시된다. 첫 커밋 때 이 문제로
`data/README.md`가 빠질 뻔했다.

원본 데이터는 저장소 밖(`F:\mc-cycop-data`)이라 커밋 대상이 아니다. 저장소는 3.7 MB이고
그중 3.5 MB가 `scenarios/defnet-01/synthetic/events.jsonl`(합성 텔레메트리)이다.

## 한 줄 요약

데모는 돌아간다. 상황도 UI 3뷰 + 지형면 + 편집 + 교전(턴제 게임, 승패·점수·참모)까지 동작하고,
결정론 엔진·JS 포팅·패리티 검사·LLM 브리핑·적대자 비교가 모두 붙어 있다.
데이터는 **LANL 5/5, AIT 1/8(의도된 범위), OpTC 41.3GB 취득 완료**.
남은 큰 것은 **탐지 실험 E1** 과 서버 호스팅이다.

## 지금 당장 돌려볼 수 있는 것

```powershell
cd F:\F\other_class\CybOPS
.\scripts\Test-Ontology.ps1                              # 정적 온톨로지 검증
.\scripts\Test-Ontology.ps1 -Scenario scenarios\tacnet-01\mission.json   # 시간축 검증
.\scripts\Show-TacticalReplay.ps1 -Step 15               # 전술망 시간축 + 원인 분해
.\scripts\New-SyntheticTelemetry.ps1                     # 합성 데이터 생성
.\scripts\Show-MissionReplay.ps1 -WhatIfIsolate ESX01    # 봉쇄 비용 what-if
```

전부 네트워크 없이 동작한다. 상세는 `docs/07-synthetic-data.md`.

지도 뷰 쪽 검사 (Node 는 `C:\Program Files\nodejs` 에 있고 PATH 에 없다):

```powershell
$env:Path += ';C:\Program Files\nodejs'
node ui\tools\ground-assets.mjs scenarios\tacnet-01\mission.json --check  # 부대가 지면 위에 있는가
node ui\tools\parity.mjs                                                  # JS 엔진 = PowerShell 엔진
.\scripts\Test-GeoInvariance.ps1                                          # geo 가 판단에 안 닿는가 (ADR-0002)
.\scripts\Export-ReplayData.ps1                                           # mission.json 을 고쳤으면 반드시
```

정적 검사 (전부 exit 1 로 실패를 알린다. CI 에 넣을 것들):

```powershell
.\scripts\Add-Bom.ps1 -Check              # 한글 들어간 .ps1 에 BOM 이 있는가
.\scripts\Test-CaseCollisions.ps1         # 대소문자만 다른 변수 (다섯 번 사고 났다)
.\scripts\Test-OcsfConformance.ps1        # 정규화 스키마 (ADR-0005)
.\scripts\Test-BundleConfig.ps1 -Bundle ui\dist -Posture hosted   # 배포 게이트
```

브리핑 하나에 대한 검사 둘(둘 다 브리핑 파일을 인자로 받는다):

```powershell
.\scripts\Test-BriefingCitations.ps1 -Briefing <brief.json>   # 인용·숫자·확신도 등급
.\scripts\Test-BriefingCoverage.ps1  -Briefing <brief.json>   # 서술 순서가 요구한 임무를 다뤘는가
```

**둘째 것이 첫째 것이 통과시키는 실패를 잡는다.** 최우선 임무의 근거가 없을 때
모델이 두 번째 임무를 그 자리에 넣으면 인용도 숫자도 맞아서 첫째 검사는 PASS 다
(`docs/20-e3-design.md` 10.8절).

마지막 것은 **지금 상태로 돌리면 일부러 FAIL 이 난다.** 빌드 산출물의 기본
`config.json` 이 `127.0.0.1` 을 가리키는데, 공개 호스트에서 그 주소는 접속한
사람의 PC 다. 절차는 `docs/21-deployment.md`.

**`scenarios/*/mission.json` 을 고치면 `Export-ReplayData.ps1` 을 다시 돌려야 한다.**
UI 는 `ui/public/data/*.replay.json` 만 읽는다. 이걸 잊으면 시나리오를 고쳤는데
화면이 안 바뀌고, 코드를 의심하며 한참을 보낸다.

---

## 1. 데이터 취득 현황

저장 위치: `F:\mc-cycop-data\raw\`

### AIT-LDS v2.0 - 범위 축소 완료 (1/8, 의도된 것)

| 파일 | 상태 |
|---|---|
| `russellmitchell.zip` | ✅ **7,132,670,599 B, zip CRC 전수 검사 통과** (엔트리 14,911, 해제 13.95 GB) |
| 나머지 7개 (123 GB) | **받지 않는다** (ADR-0012, ADR-0014) |

SHA256 `2DA85D89764AFA4EA3AA2B7565D246CCBA25681866A516DDD151834089B5AB4C`

**왜 1개만 받는가.** AIT의 고유 가치는 로그 **형식**의 다양성이다 - Apache, auth, DNS,
VPN, Suricata, syslog, audit, pcap. LANL은 동종 CSV 5종, OpTC는 단일 JSON 스키마라
OCSF 정규화기의 형식 커버리지를 시험하지 못한다. **그 검증에는 테스트베드 1개면 충분하고**,
나머지 7개는 형식이 아니라 시나리오가 다른 같은 종류다.

여기에 전술망 확정(전이성 최하)과 데모 1순위(대용량 실데이터 기여도 하락)가 겹쳤고,
CC BY-NC-SA라 논문 부록에도 못 싣는다. 회선 1 MB/s에서 123GB는 며칠인데 그 시간은
OpTC가 더 필요로 한다.

**라벨링 불필요** - `labels/` 트리에 줄 단위 라벨이 들어 있다(24개 항목).

나중에 받으려면 `scripts/fetch-ait.ps1`의 `$deferred`에서 `$files`로 옮기고 재실행한다.

- 로그: `F:\mc-cycop-data\raw\ait-lds-v2\_acquire.log`
- 취득 체인은 종료됐다. 실행 중인 다운로드 없음.

### 라벨 현황 - 추가 라벨링이 필요한 곳은 없다

| 데이터셋 | 라벨 | 상태 |
|---|---|---|
| LANL | `redteam.txt.gz` (715개 고유 이벤트) | 제공됨 |
| AIT | `labels/` 트리 (줄 단위) | 제공됨 |
| **OpTC** | 그라운드트루스 **PDF 산문** | **구조화 완료** → `analysis/optc/` |

OpTC만 기계가 못 읽는 형태라 `scripts/build_optc_labels.py`로 변환했다.
**101건 전부 분류(미분류 0)**, 호스트 30개는 독립 추출과 일치. 상세와 한계는
[09-optc-acquisition.md](docs/09-optc-acquisition.md).

### LANL Comprehensive - 5/5 완료 (2026-09-06)

취득 완료 (`F:\mc-cycop-data\raw\lanl-cyber1\`):

5개 모두 **gzip 전체 해제로 CRC32 + ISIZE 검증 통과**했다. 크기만 본 게 아니다.

| 파일 | 압축 | 해제 | SHA256 (앞 16자리) |
|---|---|---|---|
| `redteam.txt.gz` | 4,846 | 22,986 | `606635837C684AD1` |
| `dns.txt.gz` | 185,104,940 | 812,736,592 | `3E1CB718BAA6BE7A` |
| `flows.txt.gz` | 1,083,479,090 | 5,237,189,507 | `60E0CFEAE74F820E` |
| `proc.txt.gz` | 2,358,611,874 | 15,397,551,964 | `AF82F47EBF3FFC6D` |
| `auth.txt.gz` | 7,626,505,158 | **73,413,019,178 (68.37 GB)** | `9C6B0CC261B0EDD1` |

전체 해시는 `configs/manifests/lanl-cyber1.json`. 검증: `.\scripts\Test-GzipIntegrity.ps1`.

> **`auth.txt.gz`는 세 번째 시도에 성공했다.** 2차 시도는 **99.91%(7,619,951,433 B)에서
> Chrome이 이어받기에 실패하고 처음부터 다시 받았다.** 6.5 MB를 남기고 7.62 GB를 잃었다.
> 대용량 파일을 브라우저로 받지 말 것 - `scripts/fetch-lanl.ps1`이 이어받기·정체 감지·
> truncate 감지를 갖고 있다. 단 LANL은 토큰당 동시 연결을 1개만 허용하므로
> 브라우저 다운로드를 먼저 취소해야 한다.
>
> 원본 사본이 `C:\Users\qwert\Downloads\auth.txt.gz`에도 남아 있다(7.6 GB).
> 검증된 사본이 F:에 있으니 지워도 된다.

#### 시간 커버리지가 파일마다 다르다 (실험 설계 시 필수 확인)

| 파일 | 시작 | 종료 | 일 |
|---|---|---|---|
| `auth` | 1 | 5,011,199 | 0.00 ~ **58.00** |
| `proc` | 1 | 5,011,199 | 0.00 ~ **58.00** |
| `dns` | 2 | 5,011,199 | 0.00 ~ **58.00** |
| `flows` | 1 | 3,126,928 | 0.00 ~ **36.19** |
| `redteam` | 150,885 | 2,557,047 | 1.75 ~ **29.60** |

> `flows`가 36일에서 끝나는 것은 **다운로드 사고가 아니라 원본이 그렇다.** 파일 트레일러의
> ISIZE(942,222,211)와 실제 해제 바이트의 mod 2^32가 정확히 일치해 단일 멤버 전체를
> 읽었음이 확정됐다. `redteam`이 30일차에 끝나는 것도 마찬가지로 정상이다.

**의미**: 레드팀 구간(1.75~29.60일)이 `flows` 범위 안에 완전히 들어가므로 그라운드트루스
기반 실험에는 지장이 없다. 다만 "정상만 있는 구간"을 음성 샘플로 잡을 때 `flows`는
36.19일까지만 쓸 수 있다.

#### 무인 취득 체인 - 종료됨 (기록)

`scripts/Invoke-AcquireChain.ps1`이 백그라운드(detached)로 돌았다. 지금은 실행 중이 아니다.

```
auth.txt.gz 완료 대기 -> lanl-cyber1로 이동 -> 무결성 검증 -> AIT 재개
```

- 진행 로그: `F:\mc-cycop-data\raw\lanl-cyber1\_chain.log`
- AIT 로그: `F:\mc-cycop-data\raw\ait-lds-v2\_acquire.log`
- 실시간 확인: `Get-Content F:\mc-cycop-data\raw\lanl-cyber1\_chain.log -Wait -Tail 30`
- 중지:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*-File*Invoke-AcquireChain*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```

> **2026-09-06 기준 이 체인은 종료됐다.** LANL 5/5 완료, AIT 범위 축소 완료.
> 아래는 다음 취득(OpTC) 때 재사용할 기록이다.

#### 서명 URL은 만료된다

LANL은 `csr.lanl.gov/data-fence/<만료 unix시각>/<서명>/cyber1/<파일>` 형태의 링크를 준다.
현재 토큰 만료는 **09-06 04:28**. 만료되면 Chrome도 재개하지 못하므로
[csr.lanl.gov/data/cyber1](https://csr.lanl.gov/data/cyber1/)에서 새 링크를 받아
`scripts/fetch-lanl.ps1`에 넘긴다. 디스크의 부분 파일은 그대로 재사용된다.

```powershell
.\scripts\fetch-lanl.ps1 -Name auth.txt.gz -Url "<새 data-fence url>"
```

#### 이번에 확인한 것 두 가지

1. **LANL은 토큰당 동시 연결을 1개만 허용하는 것으로 보인다.** Chrome이 받는 중에
   curl을 붙였더니 50 MB를 받고 굶어 죽었다(8회 연속 0바이트). 단, Range 재개 자체는
   정상 지원한다(`206 Partial Content` 확인). **두 개를 동시에 돌리지 말 것.**
   중단된 curl 조각은 `auth.txt.gz.curl-partial`(92 MB)로 남겨뒀고 체인이 성공하면 지운다.

2. **`Get-ChildItem`의 크기를 믿지 말 것.** Chrome이 쓰기 핸들을 연 상태에서는 캐시된
   디렉터리 항목이 수 분 뒤처진다 - 실제 1,049 MB인 파일을 914 MB로 보고했다. 이걸로
   정체를 판정하면 멀쩡한 다운로드를 죽인다. 파일을 `FileShare::ReadWrite`로 직접 열어
   `.Length`를 읽어야 한다 (`Get-LiveLength` in `Invoke-AcquireChain.ps1`).

### 취득 파일 검증 절차 (크기만 믿지 않는다)

```powershell
# GzipStream은 스트림 끝에서 CRC32 + ISIZE를 검증한다. 절단 파일은 예외를 던진다.
$fs = [IO.File]::OpenRead($path)
$gz = New-Object IO.Compression.GzipStream($fs, [IO.Compression.CompressionMode]::Decompress)
$buf = New-Object byte[] (4MB); $total = 0
while (($n = $gz.Read($buf,0,$buf.Length)) -gt 0) { $total += $n }
```

마지막 레코드의 타임스탬프가 `5011199`(58일)에 도달하는지도 함께 본다.
전체 스크립트는 `scripts/Test-GzipIntegrity.ps1`.

### DARPA OpTC - 취득·검증·매니페스트 완료 (2026-09-07)

- ✅ `OpTCRedTeamGroundTruth.pdf` + README/ecar.md/errata.md → `F:\mc-cycop-data\raw\optc\`
  (GitHub 저장소에 있어 Google Drive를 거치지 않았다)
- ✅ **라벨 구조화 완료** → `analysis/optc/` (101건 전량 분류)
- ✅ **Drive 폴더 전량 열거 + 파일별 정확한 바이트 수 실측 완료** (2026-09-06)
- ✅ **취득 계획 확정** → `configs/manifests/optc.json` (1,001개 파일, **232.10 GB**, 6단계)
- ✅ **취득 스크립트** → `scripts/fetch-optc.ps1` (재실행 안전, 이어받기, 축소 감지)
- ❌ 본 데이터 다운로드: 아직 한 바이트도 받지 않았다

**실측이 뒤집은 것 두 가지.**

1. **eCAR은 호스트 단위가 아니라 25대씩 묶인 `AIA-N-M` 번들 단위다.** 레드팀 호스트 30개는
   20개 번들 중 18개에 흩어져 있다. 그래서 "30/500 = 6%"가 아니라 **90%**다.
   `ecar/evaluation/` 전량이 249.61GB인데 호스트 선별로 아끼는 양은 17.5GB뿐이다.
   **줄이는 축은 호스트가 아니라 일자다.**
2. **`gdown`은 결국 필요 없다.** 설치는 해뒀지만(6.2.0),
   `drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t`가
   Range에 206으로 답해 `curl -C -` 이어받기가 그대로 된다.
   Drive 목록 조회도 로그인 없이 `embeddedfolderview`로 된다.

| 단계 | 대상 | 파일 | GB |
|---|---|---|---|
| 1 | `ecar-bro/evaluation/` 전량 | 80 | 0.61 |
| 2 | `ecar/evaluation/23Sep19-red/` | 25 | 33.48 |
| 3 | `ecar/evaluation/25Sept/` | 26 | 26.36 |
| 4 | `ecar/evaluation/24Sep19/` | 42 | 95.54 |
| 5 | `ecar/evaluation/23Sep-night(+Night)/` | 32 | 68.90 |
| 6 | `bro/2019-09-23…25/` | 796 | 7.21 |

```powershell
.\scripts\fetch-optc.ps1 -List                  # 계획만 출력
.\scripts\fetch-optc.ps1 -Phase 1,2 -Confirm    # 34.1GB, 약 10~16시간
```

`-Confirm` 없이는 절대 시작하지 않는다. 232GB 전량은 0.6~1.0 MB/s에서 **66~110시간**이다.

**2단계를 받은 뒤 가장 먼저 확인할 것: `DC1`의 eCAR이 실제로 있는가.** 번들 이름이
`SysClientNNNN` 번호 기준이라 `DC1`은 추론이 안 된다. 없으면 Day 1 피벗 체인의 마지막
구간(DC1 lsadump)이 엔드포인트 측에서 관측되지 않고, E1-b 주장의 강도가 달라진다.

### 미착수

- DARPA TC - Google Drive 호스팅, 서브셋 단위
- Security Datasets (Mordor) - 소용량

### 디스크 여유

C: 831.6 GB / F: 919.6 GB

---

## 1.5 오프라인 합성 트랙 - 동작 확인 완료

참조 구현을 짜던 시점에는 Python·Node·Java가 전부 미설치였고 **가용 런타임이 Windows
PowerShell 5.1뿐이었다.** (지금은 Python 3.12가 있다 - 2절 개발환경 표 참조.)
그래서 참조 구현을 PowerShell로 작성했다. 데이터 아티팩트(JSON/JSONL)는 언어 독립이므로
나중에 Python으로 포팅해도 그대로 쓴다.

```
scenarios/defnet-01/mission.json       임무 온톨로지 (자산 16, 서비스 5, 작업 4, 임무 2, 링크 15)
scenarios/defnet-01/attack-chain.json  12단계 침투 시나리오 + 상태 궤적
scenarios/defnet-01/synthetic/         생성 결과 (events 8,012 / labels 12 / states 10)
scenarios/tacnet-01/mission.json        전술망 온톨로지 + 시간축 (자산 13, 링크 12, 작업 8)
scenarios/tacnet-01/attack-timeline.json 7단계 침해 궤적 (환경 단절은 여기 넣지 않는다)
scripts/New-SyntheticTelemetry.ps1     합성 텔레메트리 생성기
scripts/Invoke-MissionPropagation.ps1  결정론 전파 엔진 (D 계층). -At 로 시간축 평가
scripts/Show-MissionReplay.ps1         정적 시나리오 리플레이 + what-if
scripts/Show-TacticalReplay.ps1        시간축 리플레이 + 원인 분해
scripts/Test-Ontology.ps1              온톨로지 검증기 (시간축·도달성 검사 포함)
scripts/Add-Bom.ps1                    PS 5.1 인코딩 사고 방지
```

### 이미 확인된 결과

- **DC01 단독 침해 시 임무 저하 0%**, DC02까지 뚫려야 55.9%. 이중화가 정상 동작하며,
  이것이 임무 좌표계 주장(C1)의 실증이다.
- **ESX01 격리 what-if는 시작부터 100.0% 저하** - 봉쇄가 공격보다 비싸다. ADR-0004의 근거. (ADR-0020 이전에는 70.1%였다)
- 초기 모델링 오류를 실측으로 발견: 의존을 자산에 직접 걸면 이중화를 우회한다.
  서비스 id로 걸도록 수정했고 검증기가 이 실수를 잡는다.
- **전술망(tacnet-01): 300분 구간에서 공격 단독 0%, 환경 단독 0%, 실제 저하 100.00%.**
  도달 불가능한 이중화는 이중화가 아니다. 시간축을 넣은 실질적 이유이자 데모 장면이다.
- 시간축에서도 같은 종류의 모델링 오류를 실측으로 잡았다 - 관측반 태블릿이 위성 단절을
  우회 중계했고(→ `Asset.transit`), 침해된 중대 단말의 임무 영향이 0이었다
  (→ `task_deg >= impact(performed_at)`). 상세는 `docs/11-tactical-time-axis.md` 3절.

### 알려진 제약

**합성 데이터로 탐지 성능을 주장하지 않는다.** 악성 비율 0.15%로 실데이터보다 두 자릿수
높다. 용도는 개발·회귀 테스트·구성 타당성 검사까지. 상세는 `docs/07-synthetic-data.md` 6절.

~~미해결 경고 2건: `FW01`, `SW01`이 어떤 엣지에도 연결되지 않았다.~~
**해소됨 (2026-09-07).** 답은 의존 그래프가 아니라 전송로 계층이었다. ADR-0017의
`links[]`와 `transit`을 defnet-01에도 적용해 두 장비를 중계 노드로 세웠다. 링크 15개,
`SW01`이 전산실 코어이고 `FW01`이 사용자 구간과 전산실 구간의 경계다. 작업 4개에
`performed_at`을 채웠다. `communicates_with`(논리 통신)는 복사하지 않고 별도 층으로
남겼다. 검증기 오류 0, 경고 0. 기준값 3개(DC01 단독 0.0%, DC01+DC02 M-C2 84.4%,
ESX01 격리 70.1%)는 소수점까지 동일하고 JS 엔진 parity도 통과했다.
상세는 `docs/07-synthetic-data.md` 3.0.1절.

## 2. 문서 현황 - 완료

```
CLAUDE.md                    확정 규칙 + 작업 규칙
README.md
STATE.md                     ← 이 파일. 작업 시작 전 먼저 읽는다
configs/datasets.yaml        경로·URL·라이선스·상태
configs/manifests/           재취득 지시서 (원본 지워도 남는다)
docs/00-architecture.md      계층도 + 3트랙
docs/01-datasets.md          데이터셋 + 함정 (순위 전술망 기준으로 갱신됨)
docs/02-research-plan.md     기여 C1~C5, 실험 E1~E4
docs/03-mission-ontology.md  L2 스키마  ※ 시간축 추가 필요 (ADR-0012)
docs/04-evaluation.md        평가 프로토콜 + 자명 베이스라인 + 조인 키 규칙
docs/05-data-lifecycle.md    수명주기 + 볼륨 배치 정책 + ACQUIRE 실전 교훈
docs/06-design-workflow.md   Figma
docs/07-synthetic-data.md    오프라인 합성 트랙 + 인코딩 함정
docs/08-lanl-ground-truth.md LANL 라벨 실측 - 측면이동 없음, 베이스라인 precision 1.46%
docs/09-optc-acquisition.md  OpTC 최소 취득 세트(실측 232.1GB) + 라벨 구조화
docs/10-limitations.md       못하는 것 (구조적 / 자원 / 미결)
docs/11-tactical-time-axis.md 전술망 시간축 실측 - 원인 분해, 도달성, 잡은 오류 2건
docs/13-adversary-comparison.md 공격자 3종 비교 실측 - **LLM이 greedy에 0승 6패(0.59배)**
docs/99-open-questions.md    미결 없음 (Q1~Q6 전부 확정)
docs/adr/0001~0020           결정 기록 (0020 = hard/soft 요구)

scripts/
  fetch-ait.ps1              AIT 취득 (범위 축소됨, $deferred 참조)
  fetch-lanl.ps1             LANL 서명 URL 취득
  fetch-optc.ps1             OpTC 취득 (계획은 configs/manifests/optc.json, -Confirm 필수)
  Invoke-AcquireChain.ps1    무인 취득 체인 (현재 미실행)
  Get-DataRoot.ps1           볼륨 배치 (F: 우선, C: 예비)
  Test-GzipIntegrity.ps1     크기가 아니라 CRC로 검증
  Measure-RedteamGroundTruth.ps1  LANL 라벨 프로파일
  Measure-AuthJoin.ps1       auth 10.5억 행 조인 (C# 인라인, 약 11분)
  Export-AuthRedteamSlice.ps1     분석용 슬라이스 추출
  Measure-HostProfile.ps1    17,666개 호스트 행동 프로파일
  build_optc_labels.py       OpTC PDF → 기계 판독 라벨
  New-SyntheticTelemetry.ps1 / Invoke-MissionPropagation.ps1 /
  Show-MissionReplay.ps1 / Show-TacticalReplay.ps1 / Test-Ontology.ps1 / Add-Bom.ps1

analysis/lanl/               redteam-profile, auth-join, host-profile (CSV는 gitignore)
analysis/optc/               redteam-events.jsonl, redteam-labels.json
analysis/redteam/            comparison.json (공격자 3종 x 3시드), injection/ (주입 시험)
scenarios/defnet-01/         임무 온톨로지 + 공격 시나리오 + 합성 데이터 (정적)
scenarios/tacnet-01/         전술망 온톨로지 + 시간축 + 침해 궤적
```

**개발 환경** (2026-09-06 갱신)

| 도구 | 상태 |
|---|---|
| Python | ✅ **3.12.10** (`%LOCALAPPDATA%\Programs\Python\Python312`), pip 25.0.1, User PATH 등록 |
| Git | ✅ **2.55.0.3** (`C:\Program Files\Git\cmd`), Machine PATH 등록 |
| Node | ✅ **24.20.0 포터블** (`%LOCALAPPDATA%\Programs\nodejs-portable\node-v24.20.0-win-x64`), npm 11.19, User PATH 등록 |
| Java / dotnet | 미설치 |

> Node는 winget 설치가 11분간 진행되지 않아(MSI가 관리자 권한 프롬프트에서 막힌 것으로
> 보인다) 공식 zip을 받아 사용자 폴더에 풀었다. 관리자 권한이 필요 없고 지우기도 쉽다.
> npm 11은 설치 스크립트를 기본 차단하므로 `npm install-scripts approve esbuild`가
> 한 번 필요하다(`ui/package.json`의 `allowScripts`에 기록됨).

PowerShell 참조 구현은 그대로 유지한다. 대용량 스캔은 PowerShell 루프로는 불가능해
`Add-Type`으로 C#을 인라인 컴파일해 쓴다 - 10.5억 행을 약 11분에 훑는다
(`scripts/Measure-AuthJoin.ps1`). Python 포팅 시에도 이 성능 요구는 그대로다.

---

## 3. 다음에 할 일 (우선순위)

인터넷 없이 가능한 것과 아닌 것을 나눠 적는다.

**완료 (2026-09-06)**
0. **LANL 그라운드트루스 실측 + auth 조인** → `docs/08-lanl-ground-truth.md`, ADR-0011.

   | 확인한 것 | 결과 |
   |---|---|
   | 라벨에 측면이동이 있는가 | **없다.** 출발지 4개와 목적지 301개의 교집합이 0 |
   | 레드팀 이벤트 수 | 749줄이지만 **고유 715개** (중복 34줄) |
   | `auth.txt` 레코드 수 | **1,051,430,459** - 문서값과 차이 0, 파싱 실패 0 |
   | 라벨 조인 | 4필드 701/715, 3필드 715/715 (목적지만 14건 불일치) |
   | 자명 베이스라인 | recall 100%, **precision 1.46%** (참 1건당 오탐 67건) |
   | 침해 계정 104개 | 정상 인증 1,953만 행, 라벨 비율 0.0036% |

   C1과 E1을 재정의했고(ADR-0011), `04-evaluation.md`에 자명 베이스라인과
   조인 키 명시를 필수 보고 항목으로 넣었다.

   재현(전체 약 25분, C# 인라인 컴파일로 초당 160만 행):
   ```powershell
   .\scripts\Measure-RedteamGroundTruth.ps1 -OutJson analysis\lanl\redteam-profile.json
   .\scripts\Measure-AuthJoin.ps1 -OutJson analysis\lanl\auth-join.json
   .\scripts\Export-AuthRedteamSlice.ps1
   ```
   추출된 CSV(16 MB)는 gitignore 대상이다. 요약 JSON만 커밋한다.

**결정 5건 확정 (2026-09-06)** - Q1/Q2/Q3/Q4/Q6이 한꺼번에 닫혔다.

| | 결정 | ADR |
|---|---|---|
| Q1 | 대상 망 = **전술망** | [0012](docs/adr/0012-target-network-is-tactical.md) |
| Q2 | **MIL-STD-2525 준용** | [0013](docs/adr/0013-adopt-mil-std-2525-symbology.md) |
| Q3 | **데모 1순위**, 논문 2순위 | [0014](docs/adr/0014-demo-first-then-paper.md) |
| Q6 | 전문가 평가 **안 함** → 순위 불일치도로 대체 | [0015](docs/adr/0015-no-human-subject-evaluation.md) |
| Q4 | LLM = **로컬 GPU, 4비트 7~14B** | [0016](docs/adr/0016-local-gpu-llm-sizing.md) |

---

## 다음에 할 일 - 데모 기준 순서 (ADR-0014)

**0.** ~~Q5 확정이 임계 경로다.~~ → **완료 (ADR-0018)**. Cytoscape.js + Vite 정적 번들.

1. ~~**시간축 임무 온톨로지**~~ → **완료 (2026-09-06, ADR-0017)**

   `scenarios/tacnet-01/` (자산 13, 링크 12, 작업 8, 단계 5, 420분). 엔진에 `-At` 추가,
   `Show-TacticalReplay.ps1` 추가, 검증기에 시간축·정적 도달성 검사 추가.
   실측: [11-tactical-time-axis.md](docs/11-tactical-time-axis.md).

   | 시점 | 상황 | total | attack | env | inter |
   |---|---|---|---|---|---|
   | 120분 | 지휘소 이동, 공격 없음 | 79.04% | **0%** | 79.04% | 0% |
   | 300분 | 위성 단절(미상) + BN-SRV 장악 | 100.00% | **0%** | **0%** | **100.00%** |
   | 390분 | TOC-SRV 장악, 환경 정상 | 100.00% | 100.00% | 0% | 0% |

   300분이 이 과제의 데모 장면이다 - **어느 원인 하나만으로는 이 저하가 생기지 않는다.**
   도달 불가능한 이중화는 이중화가 아니기 때문이고, 정적 그래프로는 표현 자체가 안 된다.
   `defnet-01` 회귀 확인 완료(DC01 0.0% / DC01+DC02 80.5% / ESX01 격리 70.1%, 전부 동일).

2. ~~**`Asset.type` → SIDC 매핑 테이블**~~ (ADR-0013) → **완료**. `configs/symbology-2525.json`,
   `docs/12-symbology-mapping.md`. 미매핑 타입은 콘솔 경고로 뜬다.
3. ~~**상황도 UI + 시간축 리플레이**~~ → **완료**. `ui/` (Cytoscape.js + Vite 정적 번들).
   임무 의존 / 전송로 / 지리 3뷰, 2D-3D 지형면, 편집 모드, 되돌리기, 온보딩.
4. ~~**what-if 인터랙션**~~ → **완료**. 대응 후보 패널이 격리 비용을 미리 계산해 보여준다.
   실행 경로는 없다(ADR-0004).
5. ~~**LLM 브리핑 계층**~~ → **완료**. Ollama 로컬, 근거 인용 5종 검사
   (`Test-BriefingCitations.ps1`), 모델 비교(`Compare-BriefingModels.ps1`).
6. 탐지 실험 E1 - 논문 자산. 화면에는 거의 안 보인다. **OpTC가 로컬에 있으니 착수 가능.**

   > **착수 전 반영할 실측 (2026-09-07): DC1 에는 eCAR 이 없다.**
   > eCAR 18개 번들 380 GB 를 전수 스캔했다. 호스트 450개 전부 SysClient, 비-SysClient 0건.
   > 그런데 DC1 은 bro DNS 에 있다(`dc1.systemia.com`, IP 142.20.61.130 / 109.172.36.2).
   > **네트워크 측에는 보이고 엔드포인트 측에는 없다.**
   > 따라서 Day 1 피벗 체인의 마지막 구간(DC1 lsadump)은 엔드포인트 탐지의 평가 대상이
   > 될 수 없다. E1-b 를 그 구간을 빼고 정의하거나 네트워크 측으로 정의해야 한다.
   > 관측이 없는 구간의 재현율은 모델의 성질이 아니라 데이터의 성질이다.
   > 재현: `.\scripts\Measure-OptcHosts.ps1 -Filter 'ecar\'` (약 55분)
   > 상세와 남는 불확실성: `docs/09-optc-acquisition.md` 마지막 절

**병행 가능 (대역폭만 씀)**
- ✅ OpTC Drive 목록 조회·용량 실측·계획 확정 완료 (232.10GB / 1,001개 파일)
- ✅ **OpTC 취득 완료 (2026-09-07 08:55)**. Phase 1,2,6 / 900개 `.gz` + 문서 / **41.3 GB**.
  `_fetch.log` 마지막 줄 `0 file(s) incomplete`, `_acquired.jsonl` 901줄(파일별 SHA256 포함).
- OpTC 후처리 (아래 "지금 밀려 있는 것" 참조)

**OpTC 후처리 - 완료 (2026-09-07 16:02)**

```
Test-GzipIntegrity  900 files, OK 900, FAILED 0
Write-OptcManifestLog  901 rel_path, 디스크 대조 PASS, 41.30 GB
configs/manifests/optc.json  acquisition_log 901건, status "acquired (phases 1,2,6)"
```

파일별 Drive id · 바이트 수 · SHA256 · phase · 취득 시각이 매니페스트에 들어갔다.
원본을 지워도 재취득하고 대조할 수 있다(ADR-0010). 재검증:
`.\scripts\Write-OptcManifestLog.ps1 -Check` (어긋나면 exit 1)

> ### ⚠ 2026-09-07: 다운로드 6개가 HTML 에러 페이지였다
>
> `fetch-optc.ps1` 이 `0 file(s) incomplete` 라고 보고했지만 **틀렸다.**
> `Test-GzipIntegrity.ps1` 로 전수 해제하니 6개가 gzip 이 아니라 Drive 의 **503 페이지**
> 였다. 크기는 기대값과 **정확히** 일치했다 - `curl` 이 `--fail` 없이 에러 본문을 파일에
> 쓰고, 다음 시도의 `-C -` 가 그 뒤부터 이어받아서 `[503 HTML 1.6 KB][진짜 데이터]` 가
> 됐기 때문이다. 48 MB 짜리도 섞여 있었다.
>
> **바이트 수 일치는 파일이 맞다는 뜻이 아니다.** 이어받기는 이미 있는 접두사를 검증 없이
> 신뢰하는 것이 정의다. 상세와 고친 내용은 `docs/09-optc-acquisition.md` 마지막 절.
>
> 고침: `fetch-optc.ps1` 에 `--fail` + gzip 매직 검사(틀리면 삭제) + `-Only` 재취득,
> `Test-GzipIntegrity.ps1` 에 `-Recurse`(없어서 900개를 못 찾고 죽었다).

- 무결성 검사(전수, 약 25분):
  `.\scripts\Test-GzipIntegrity.ps1 -Path F:\mc-cycop-data\raw\optc -NoHash -ExpectedLastTimestamp 0`

**남은 자잘한 것**
- ~~`FW01`/`SW01`이 어떤 엣지에도 연결되지 않았다~~ → **해결**. defnet-01 에 링크 15개를
  넣으면서 사라졌다. `Test-Ontology.ps1` ERRORS 0 / WARNINGS 0.
- ~~전파 함수 3종(max/weighted/noisyor) 비교 → E2~~ → **완료**.
  `noisyor` 의심은 사실이었다(defnet DC01+DC02에서 99.9%, 입력 절반에서 이미 64.5%).
  원인은 noisy-OR가 작업·임무 두 계층에 연달아 적용되는 것. 단조성 204/204 통과,
  이중화는 세 방법 전부 동일(서비스 계층이 방법과 무관). **기본값 `weighted` 유지 권고.**
  → `docs/15-propagation-functions.md`, `eval/results/propagation-comparison.json`,
  `scripts/Compare-Propagation.ps1`
- ~~OCSF 매핑 스펙~~ → **완료**. `configs/ocsf-mapping.json`(1.9.0 핀), `docs/16-ocsf-mapping.md`,
  `scripts/Test-OcsfConformance.ps1`. 42,846건 검사 → **위반 0**. ADR-0005 가 선언에서
  검사 가능한 것으로 바뀌었다.
- ~~적대 행위자 비교(docs/13) 가 ADR-0020 이전 수치~~ → **완료 (2026-09-07 재측정)**.
  `analysis/redteam/comparison-hard.json`. 결론 유지(LLM 0.587배), greedy 가 세졌다
  (wobj 1.333 -> 1.500, M-FIRE 66.7%% -> 100%%).

---

## 4. 세션 시작 시 첫 확인 명령

```powershell
cd F:\F\other_class\CybOPS
git log --oneline | Select-Object -First 5
git status -sb

# 데이터 상태
.\scripts\Get-DataRoot.ps1 -Report
Get-ChildItem F:\mc-cycop-data\raw -Recurse -File |
  Select-Object FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}

# 백그라운드 취득이 돌고 있는지
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*fetch-*' -or $_.CommandLine -like '*AcquireChain*' }
```

2026-09-06 세션 종료 시점: **실행 중인 작업 없음, 작업트리 clean, origin/main과 동기.**
