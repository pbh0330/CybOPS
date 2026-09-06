# 12. MIL-STD-2525 심볼 매핑

**상태**: 초안 (2026-09-06). **원문 대조 미완료.**
**대응 파일**: `configs/symbology-2525.json` (기계 판독용)
**근거 ADR**: ADR-0013(2525 준용), ADR-0012(전술망), ADR-0002(지오로케이션 배제), ADR-0003(상태는 결정론 엔진), ADR-0017(시간축)

이 문서는 ADR-0013이 요구한 `Asset.type` → SIDC 매핑 테이블의 사람이 읽는 절반이다.
코드값 자체는 JSON에 있고, 여기에는 **왜 그렇게 골랐는지**와 **무엇이 아직 검증되지 않았는지**를 적는다.

> **인용 주의.** 이 문서의 SIDC는 MIL-STD-2525D 원문 PDF를 직접 대조해서 얻은 것이 아니다.
> 공개된 표준 데이터 인코딩(Esri JMSML)과 오픈소스 렌더러 소스에서 교차 확인한 값이다.
> 논문·제안서에 "MIL-STD-2525D 부록 L에 따르면"이라고 쓰기 전에 8절 체크리스트를 소진해야 한다.
> CLAUDE.md "인용·수치 취급 주의" 적용 대상이다.

---

## 1. 가장 중요한 조사 결과 — ADR-0013 2항은 개정되어야 한다

ADR-0013 2항은 이렇게 적었다.

> "침해됨", "임무 저하 55%" 같은 사이버 고유 의미는 **표준에 대응 심볼이 없거나 불확실하다.**
> (…) 따라서 상태·증정보 계층에 얹는다.
> **검증 필요**: 2525D/E 및 APP-6D의 사이버 공간 작전 심볼 지원 범위를 확인해야 한다.

**확인 결과: 표준에 대응 심볼이 있다.**

MIL-STD-2525D에는 **심볼셋 60 = Cyberspace**가 존재한다. 부록 L에 해당한다. 그 안에 이 프로젝트가
필요로 하던 것이 거의 다 들어 있다.

| 2525D 심볼셋 60 엔터티 | 하위 항목 |
|---|---|
| 11 Botnet | C2, Herder, Callback Domain, Zombie |
| 12 Infection | APT / NAPT (각각 C2·자가전파 조합 하위형) |
| **13 Health and Status** | **Normal, Network Outage, Unknown, Impaired** |
| **14 Device Type** | Core Router, Router, Cross Domain Solution, **Mail Server, Web Server, Domain Server, File Server**, Peer-to-Peer Node, **Firewall, Switch, Host**, VPN |
| 15 Device Domain | DoD, Government, Contractor, SCADA, Non-Government |
| **16 Effect** | **Infection, Degradation**, Data Spoofing, Data Manipulation, **Exfiltration, Power Outage, Network Outage, Service Outage, Device Outage** |

즉 "침해됨"은 `Effect > Infection`, "임무 저하"는 `Effect > Degradation`, "원인 미상"은
`Health and Status > Unknown`으로 **표준 심볼이 이미 있다.**

### 결론 — ADR-0013 2항의 방침은 유지하되 근거가 바뀐다

- **결론 자체는 그대로다**: 자체 아이콘을 만들지 않는다.
- **근거가 바뀐다**: "표준에 없어서 상태 계층에 얹는다"가 아니라, **"표준에 이미 있으므로 그것을 쓴다"**이다.
- **한 가지 제약이 새로 생긴다**: Health and Status와 Effect는 심볼셋 60 **안의 별개 엔터티**다.
  SIDC의 엔터티 자릿수(11-16)는 하나뿐이므로 `Domain Server`와 `Impaired`를 **한 심볼로 합칠 수 없다.**
  장비 심볼 옆에 부가 심볼로 배치하거나 노드 배지로 축소 렌더해야 한다.

ADR-0013 개정안을 별도로 작성할 것을 권한다. 이 문서는 그 근거 자료다.

### APP-6D 쪽은 사정이 다르다 (미검증)

검색 결과 NATO APP-6 계열에서는 사이버 챕터의 성숙도에 대한 이견이 있었고,
독일·영국·네덜란드가 "충분히 성숙하지 않았다"는 이유로 당장 구현하지 않겠다는 입장을 냈다는
서술이 있다. **이것은 검색 결과 요약이고 원문(APP-6 국가별 유보 조항)을 확인하지 못했다.**
"NATO는 사이버 심볼을 받아들이지 않았다"고 단정해서 쓰면 안 된다. 8절 체크리스트 V-9 항목.

한편 상용 렌더러 Carmenta Engine은 제품 문서에서 **2525D 부록 L(사이버)과 부록 I(METOC)을
지원하지 않는다**고 명시한다. 심볼셋 60이 이 프로젝트의 핵심이므로 이 제품은 후보에서 탈락한다.

---

## 2. 버전 선택 — 2525D로 고정한다

### 2525C vs 2525D/E — SIDC 형식이 다르다

| | 2525C | 2525D / 2525E |
|---|---|---|
| SIDC | 15자 영숫자 | **20자리 숫자** |
| 사이버 심볼셋 | 없음 | 심볼셋 60 |

이 프로젝트는 **20자리 숫자 SIDC**를 쓴다. 자릿수 배치는 다음과 같다.

| 자릿수 | 필드 |
|---|---|
| 1-2 | 버전 (10 = 2525D 계열, 13 = 2525E 계열) |
| 3 | 표준 식별 문맥 (0 실제 / 1 훈련 / 2 시뮬레이션) |
| 4 | 소속 (0 미결 / 1 미상 / 2 추정아군 / 3 아군 / 4 중립 / 5 의심 / 6 적대) |
| 5-6 | 심볼셋 |
| 7 | 상태 (0 현재 / 1 예정·예상 / 2 완전가동 / 3 손상 / 4 파괴 / 5 만재) |
| 8 | 지휘소·기동부대·기만 |
| 9-10 | 증정보(제대·기동성) |
| 11-12 | 엔터티 |
| 13-14 | 엔터티 타입 |
| 15-16 | 엔터티 하위타입 |
| 17-18 | 수식자 1 |
| 19-20 | 수식자 2 |

### 왜 D인가 — E가 더 좋아 보이는데도

2525E는 심볼셋 60을 **재구성**한 것으로 보인다. 확인된 정황은 다음과 같다.

| 코드 | 2525D 의미 | 2525E 의미(정황) |
|---|---|---|
| 130100 | Health and Status > Normal | Agent > **Firewall** |
| 130200 | Health and Status > Network Outage | Agent > **Firmware** |
| 140300 | Device Type > Cross Domain Solution | Application > **Search Engine** |
| 140400 | Device Type > **Mail Server** | Application > **Social Media** |
| 150100 | Device Domain > DoD | Threat > **Malware** |
| 160100 | Effect > Infection | Data > **Digital Currency** |
| 17xxxx | (없음) | **Endpoint** (Server, Workstation, 태블릿, IoT, 프린터, 라우터, 스위치) |
| 18xxxx | (없음) | **Network** |

E가 우리 자산 구성에 더 맞는 항목(범용 Server, Workstation, Tablet)을 갖고 있고,
수식자 1에 Wired / Wireless / Radio Frequency / Cloud 같은 전송수단 값이 있어 전술망의
bearer 모델과도 잘 맞는다. **그럼에도 D로 고정한다.** 이유는 하나다.

- **D판 표는 서로 독립인 두 출처(Esri JMSML, spatialillusions/milsymbol)에서 교차 확인된다.**
- **E판 표는 같은 저자의 두 저장소(milsymbol, npm milstandard-e)에서만 확인된다.** 독립 교차가
  성립하지 않는다.

검증 가능한 쪽에 고정하는 것이 CLAUDE.md 규칙에 맞다. E로의 이행은 원문 확인 후 별도 판단한다.

> **운영상 함정**: 버전 자릿수를 고정하지 않은 SIDC를 저장하면 안 된다. `milsymbol`은 1-2 자릿수
> 10/11/12를 edition D, 13/14를 edition E로 해석하고 **같은 엔터티 코드를 다른 아이콘에 매핑한다.**
> 버전을 흘리면 메일 서버가 조용히 소셜 미디어 아이콘이 된다.

---

## 3. 렌더러 호환성

ADR-0013 "결과" 절이 요구한 조사다. Q5(UI 스택) 결정 시 입력으로 쓴다.

| 렌더러 | 2525D | 2525E | 심볼셋 60 | 비고 |
|---|---|---|---|---|
| **milsymbol** (JS, SVG/Canvas) | O | O | **O** | v3.0.4 (2026-03-10). 무의존. 편집판을 SIDC 버전 자릿수로 자동 판별 |
| mil-sym-java | O | O | 표방 | Java 미설치 환경이라 후순위 (CLAUDE.md 개발환경) |
| Carmenta Engine (상용) | O | - | **X** | 부록 L 미지원을 문서에 명시 — **탈락** |

**milsymbol이 사실상 유일한 현실적 후보다.** 심볼셋 60을 렌더하고, 브라우저에서 SVG를 뽑고,
의존성이 없다. ADR-0013이 예상한 대로 이 제약은 상황도를 **웹 스택** 쪽으로 민다.

milsymbol 확인 사항:
- 심볼셋 60의 프레임 차원(dimension)을 **Ground**로 처리한다.
- 20자리 SIDC를 받는다. 21자리 이상을 주면 21번째부터를 수식자 확장·frameshape로 읽는다.
- 상태 자릿수 1은 점선 프레임, 3/4는 손상·파괴 표식으로 자동 렌더한다.

> **미실행 검증**: 위는 저장소 소스를 읽어 확인한 것이고 **실제 렌더 결과를 눈으로 보지 않았다.**
> 이 환경에 Node가 없다(CLAUDE.md 개발환경). Node 설치 후 심볼셋 60 스모크 테스트가 필요하다.
> 8절 V-10.

> **프레임 차원 불일치(미해결)**: JMSML은 심볼셋 60의 차원을 `AIR SPACE LAND_EQUIPMENT
> SEA_SURFACE SEA_SUBSURFACE`로 적는다 — LAND_UNIT과 LAND_INSTALLATION이 빠져 있다.
> 즉 표준상 사이버 심볼의 프레임은 그 장비가 올라탄 플랫폼의 차원을 따르고, 지상 장비는
> LAND_EQUIPMENT다. milsymbol은 이를 일괄 Ground로 처리한다. 두 처리가 실제로 같은 프레임을
> 그리는지 확인되지 않았다. 8절 V-8.

---

## 4. `Asset.type` → SIDC 매핑

두 시나리오의 자산 타입 17종을 전부 덮는다. 상세 코드와 대체안은 `configs/symbology-2525.json`에 있다.

**아래 SIDC는 기본값(버전 10, 문맥 0=실제, 소속 3=아군, 상태 0=현재)이 적용된 완성형이다.**

### 4.1 defnet-01 (국방망 시나리오)

| `Asset.type` | SIDC | 계층 | 코드 검증 | 비고 |
|---|---|---|---|---|
| domain-controller | `10036000001406000000` | Cyberspace > Device Type > Domain Server | O | AD DC인지 DNS 도메인 서버인지 원문 정의 확인 필요 |
| mail-server | `10036000001404000000` | Cyberspace > Device Type > Mail Server | O | |
| file-server | `10036000001407000000` | Cyberspace > Device Type > File Server | O | |
| web-server | `10036000001405000000` | Cyberspace > Device Type > Web Server | O | |
| firewall | `10036000001409000000` | Cyberspace > Device Type > Firewall | O | |
| switch | `10036000001410000000` | Cyberspace > Device Type > Switch | O | |
| workstation | `10036000001411000000` | Cyberspace > Device Type > Host | O | **결손** — D에 workstation 엔터티 없음 |
| database | `10036000001411000000` | Cyberspace > Device Type > Host | O | **결손** — DB 엔터티가 D·E 양쪽에 없음. 텍스트 증정보 `DB` |
| hypervisor | `10036000001411000000` | Cyberspace > Device Type > Host | O | **결손** — 가상화 호스트 엔터티 없음. 텍스트 증정보 `ESX` |

### 4.2 tacnet-01 (전술망 시나리오)

| `Asset.type` | SIDC | 계층 | 코드 검증 | 비고 |
|---|---|---|---|---|
| gateway | `10036000001402000000` | Cyberspace > Device Type > Router | O | BFT-GW가 망간연동이면 Cross Domain Solution(`…1403…`)이 맞을 수 있음 |
| radio-relay | `10031000001108000000` | Land Unit > Command and Control > Radio Relay | O | **세 출처 일치.** D·E 양쪽에서 코드 동일 |
| satcom-terminal | `10031500002001000000` | Land Equipment > Other Equipment > Antennae | O | 의미상 Tactical Satellite가 더 가깝지만 **2525E에서 Disused**로 보임 |
| workstation | `10036000001411000000` | Cyberspace > Device Type > Host | O | 위와 동일 |
| hypervisor | `10036000001411000000` | Cyberspace > Device Type > Host | O | 위와 동일 |
| c2-server | `10036000001411000000` | Cyberspace > Device Type > Host | O | **결손** — D에 범용 Server 엔터티 없음. 텍스트 증정보 `C2` |
| fire-control-server | `10036000001411000000` | Cyberspace > Device Type > Host | O | **결손**. 텍스트 증정보 `FDC` |
| terminal | `10036000001411000000` | Cyberspace > Device Type > Host | O | **결손** — 종단 단말 엔터티 없음 |
| c2-terminal | `10036000001411000000` | Cyberspace > Device Type > Host | O | **결손**. 텍스트 증정보 `C2` |
| observer-terminal | `10036000001411000000` | Cyberspace > Device Type > Host | O | **결손** — FO-TAB은 안드로이드 태블릿. D에 휴대단말 엔터티 없음 |

### 4.3 결손 항목이 말해주는 것

10종이 `Host`로 몰렸다. 2525D 심볼셋 60의 Device Type은 **역할별 서버(mail/web/domain/file)와
네트워크 장비**를 상정했고, **범용 서버·워크스테이션·휴대단말·데이터베이스·가상화**는 상정하지
않았다. 전술 단말은 아예 시야에 없다.

2525E의 `Endpoint`(17) 계열이 이 결손을 정확히 메운다 — Server, Workstation, Tablet, Laptop,
IoT까지 있다. **E 원문이 확인되면 이 표의 절반이 개선된다.** 8절 V-3이 가장 값어치 있는 검증
항목인 이유다.

그때까지 결손 항목은 `Host` + 텍스트 증정보로 간다. 대체안은 JSON의 `alternatives`에 기록해뒀다.

---

## 5. 상태 표현 규약

ADR-0013 2항 — 아이콘은 표준을 유지하고, 사이버 상태는 **상태 자릿수 + 표준 사이버 상태 심볼 +
심볼 바깥 장식**으로 표현한다.

### 5.1 상태 자릿수(7번)는 공격에 의한 손상에만 쓴다

| 엔진 상태 | 상태 자릿수 | 표준 라벨 |
|---|---|---|
| 정상 | 2 | Present/Fully Capable |
| 공격에 의한 부분 저하 | 3 | Present/Damaged |
| 공격에 의한 전면 불가 | 4 | Present/Destroyed |
| 시점 t에 유효구간 밖(미전개·미가용) | 1 | Planned/Anticipated (점선 프레임) |
| **기동·지형·정비에 의한 단절** | **1** | Planned/Anticipated + 원인 텍스트 |
| **원인 미상 단절** | **0** | Present + `Health and Status > Unknown` 병기 |

**이것이 이 규약의 핵심이다.** `Damaged`/`Destroyed`는 전투 손상을 함의한다. 능선 차폐로 끊긴
링크를 `Damaged`로 그리면 **상황도가 언덕을 적의 소행으로 보고한다.** ADR-0012 2항이 금지한
바로 그것이다.

원인 미상은 3/4로 올리지 않는다. 공격으로 단정하지 않는다는 뜻이다(ADR-0012 2항).
tacnet-01의 300~345분 위성 단절(`cause: unknown`)이 이 규칙의 시험 사례다.

> 상태 코드값 자체는 교차 검증됐다. 그러나 **어느 엔진 상태를 어느 코드에 붙일지는 이 프로젝트의
> 설계 판단**이고 표준이 정해주는 것이 아니다. 교리 검토 대상이다.

### 5.2 사이버 상태는 표준 심볼을 병기한다

엔티티 자릿수가 하나뿐이라 장비 심볼과 합칠 수 없으므로, 장비 노드 옆 부가 심볼 또는 배지로 그린다.

| 엔진 상태 | 병기 심볼 |
|---|---|
| compromised | Effect > Infection |
| mission_degraded | Effect > Degradation |
| service_unavailable | Effect > Service Outage |
| asset_unavailable | Effect > Device Outage |
| link_down | Effect > Network Outage |
| exfiltration_observed | Effect > Exfiltration |
| cause_unknown | Health and Status > Unknown |
| impaired | Health and Status > Impaired |
| normal | Health and Status > Normal |

코드는 JSON의 `state_overlay.engine_state_to_overlay`에 있다.

> **미결**: 아군 자산에 나타난 `Effect > Infection`을 아군 프레임(소속 3)으로 그릴지 미상
> 프레임(소속 1)으로 그릴지 정하지 않았다. JSON에서는 참조용으로 소속 자릿수를 `00`으로 남겨뒀다.

### 5.3 색은 소속 전용이다 — 절대 재사용하지 않는다

**아군 프레임을 침해 때문에 빨갛게 칠하지 않는다.** 2525에서 빨강은 적대를 뜻한다. 건강상태에
프레임 색을 쓰면 표준의 가장 핵심적인 의미를 파괴하고, 준용의 이점(친숙성)을 스스로 없앤다.

- 프레임 색·형상 = **소속만**.
- 저하도 등급 색 = 심볼 **바깥**의 그래프 노드 장식(후광 링, 배경 원). 심볼 바운딩 박스를 침범하지 않는다.
- 점선 테두리 = 상태 자릿수 1이 렌더러에서 자동으로 만든다. 따로 그리지 않는다.
- 저하율 수치·단절 원인 라벨·소속 부대 = **텍스트 증정보 필드**.

임계값과 등급 경계는 여기서 정하지 않는다. 결정론 엔진의 몫이다(ADR-0003).

---

## 6. 소속(affiliation) 축 처리 방침

소속은 아군 고정이 아니지만, **자산의 소속을 건강상태 때문에 흔들지 않는다.**

| 규칙 | 내용 |
|---|---|
| AFF-1 | 임무 그래프의 Asset 노드는 소속 자릿수를 **3(아군)으로 고정**한다. 침해·저하·원인미상 때문에 1(미상)이나 5(의심)로 바꾸지 않는다 |
| AFF-2 | 소속 1(미상)은 **자산대장에 없는 관측 개체 전용**이다. 스캔에서 새로 나타난 미식별 호스트, 귀속되지 않은 외부 통신 상대. 이들은 Asset 노드가 아니라 별도 관측 노드로 들어온다 |
| AFF-3 | 소속 5(의심)·6(적대)은 결정론 엔진 또는 사람이 확정한 경우에만 부여한다. **LLM 출력이 이 자릿수를 바꾸는 경로를 만들지 않는다** (ADR-0003) |
| AFF-4 | **IP 지오로케이션 결과는 소속 산출에 입력되지 않는다** (ADR-0002) |
| AFF-5 | 합성 시나리오를 화면에 띄울 때는 문맥 자릿수를 2(시뮬레이션)로 둔다. 실데이터는 0(실제) |

AFF-1의 논거: "이 서버가 침해됐다"와 "이 서버가 우리 것인지 모르겠다"는 완전히 다른 문장이다.
2525의 프레임은 후자를 말하는 자리다. 침해된 아군 서버를 노란 미상 프레임으로 그리면 지휘관이
읽는 문장이 바뀐다. 건강상태는 5절이 담당한다.

AFF-5는 CLAUDE.md 11항(합성 데이터로 탐지 성능을 주장하지 않는다)을 화면에서도 지키기 위한 것이다.
다만 milsymbol이 문맥 자릿수를 어떤 프레임으로 그리는지는 확인하지 않았다(8절 V-11).

---

## 7. 검증 규칙

JSON의 `verified` 필드가 무엇을 뜻하는지 명확히 해둔다.

- `verified: true` = **SIDC 문자열과 계층 라벨의 대응이 서로 독립인 두 개 이상의 공개 출처에서 일치했다.**
- `verified: true`는 **표준 원문(MIL-STD-2525D PDF)을 대조했다는 뜻이 아니다.**
- `verified: true`는 **그 심볼을 이 자산 타입에 쓰는 것이 옳다는 뜻도 아니다.**
  그것은 `mapping_reviewed`가 담당하고, **현재 전 항목 `false`다.**

독립성 기준: Esri/JMSML(DISA 인코딩 계열), spatialillusions/milsymbol, Carmenta 제품문서를
서로 독립으로 본다. npm `milstandard-e`는 milsymbol과 **같은 저자**이므로 milsymbol과 독립으로
세지 않는다. 그래서 2525E 관련 항목은 전부 `verified: false`다.

---

## 8. 반드시 사람이 원문 대조해야 하는 항목

우선순위 순. 이 목록을 소진하기 전에는 `configs/symbology-2525.json`의 `status`를
`draft-unverified`에서 올리지 않는다.

| ID | 항목 | 대조 대상 | 왜 중요한가 |
|---|---|---|---|
| **V-1** | 심볼셋 60의 엔터티 표 전체 (Device Type / Health and Status / Effect) | MIL-STD-2525D 부록 L | 매핑 17종 중 15종이 여기에 걸려 있다. 하나라도 틀리면 화면 전체가 틀린다 |
| **V-2** | 자산 타입 → 심볼 선택의 교리적 타당성 (`mapping_reviewed` 전 항목) | 사람(군 사용자·교리 담당) | 코드가 맞아도 선택이 틀릴 수 있다. `Domain Server`가 AD DC를 뜻하는지가 대표 사례 |
| **V-3** | 2525E 심볼셋 60의 재구성 여부와 `Endpoint`(17)·`Network`(18) 엔터티 | MIL-STD-2525E 부록(사이버) | 확인되면 결손 10종 중 대부분이 개선된다. 가장 값어치 있는 항목 |
| **V-4** | 데이터베이스·가상화 호스트 엔터티가 정말 표준에 없는가 | 2525D 부록 L 전체 표 훑기 | 지금은 "찾지 못했다"이지 "없다"가 아니다 |
| **V-5** | SIDC 자릿수 배치 | 2525D 5.3절 | 두 출처가 일치하지만 표준 본문 확인은 별개다 |
| **V-6** | 상태(5.3.4)·소속(5.3.3)·문맥(5.3.2)·증정보(5.3.6) 코드값 | 2525D 5.3절 각 항 | 교차 확인은 됐으나 원문 미대조 |
| **V-7** | 지휘소/기동부대/기만 자릿수(8번) 코드값 | 2525D 5.3.5절 | **단일 출처(JMSML)만 확인.** 교차 검증조차 안 됨 |
| **V-8** | 심볼셋 60의 프레임 차원 — LAND_EQUIPMENT인가 Ground인가 | 2525D 부록 L + milsymbol 렌더 결과 | JMSML과 milsymbol의 처리가 다르다 |
| **V-9** | APP-6D의 사이버 심볼 채택 여부 및 국가별 유보 | APP-6(D) 원문, NATO 표준화 문서 | "NATO는 안 받아들였다"는 서술은 현재 **검색 결과 요약일 뿐**이다. 논문에 쓰면 안 된다 |
| **V-10** | milsymbol의 심볼셋 60 실제 렌더 결과 | Node 설치 후 스모크 테스트 | 소스만 읽었고 그림을 보지 않았다 |
| **V-11** | 문맥 자릿수(훈련/시뮬레이션)의 렌더 결과 | milsymbol 렌더 테스트 | AFF-5가 화면에서 실제로 구분되는지 확인 필요 |
| **V-12** | 텍스트 증정보 필드 문자(H, F, T 등)와 배치 위치 | 2525D 5.3.7절 / 표 II | 저하율·단절 원인을 어디에 쓸지가 여기서 정해진다 |
| **V-13** | `satcom-terminal`의 Tactical Satellite가 2525E에서 Disused인지 | MIL-STD-2525E 부록 D | 사실이면 E 이행 시 이 항목이 깨진다 |
| **V-14** | 심볼셋 60에 제대 증정보를 붙일 수 있는가 | 2525D 부록 L / 5.3.6절 | 붙일 수 있으면 부대 소속을 텍스트 대신 표준 증정보로 표현할 수 있다 |
| **V-15** | 2525D 원문 PDF의 출처 신뢰성 | ASSIST 등 공식 배포처 | 현재 참조한 `mapsymbs.com` 사본은 **비공식 미러**다. 인용 출처로 쓸 수 없다 |

---

## 9. 참고 출처

조사에 실제로 사용한 URL이다. 신뢰 등급을 함께 적는다.

| 출처 | 성격 | 등급 |
|---|---|---|
| https://github.com/Esri/joint-military-symbology-xml | MIL-STD-2525D / APP-6(D)의 데이터 인코딩(JMSML). 스키마 네임스페이스가 `disa.mil` | 표준 파생, 신뢰 높음 |
| https://raw.githubusercontent.com/Esri/joint-military-symbology-xml/dev/instance/Cyberspace.xml | 심볼셋 60 엔터티 표 | 표준 파생 |
| https://raw.githubusercontent.com/Esri/joint-military-symbology-xml/dev/instance/Base.xml | 문맥·소속·상태·증정보 코드 표 | 표준 파생 |
| https://raw.githubusercontent.com/Esri/joint-military-symbology-xml/dev/instance/Land_Unit.xml | 심볼셋 10 (Radio Relay 등) | 표준 파생 |
| https://raw.githubusercontent.com/Esri/joint-military-symbology-xml/dev/instance/Land_Equipment.xml | 심볼셋 15 (Antennae 등) | 표준 파생 |
| https://github.com/spatialillusions/milsymbol | 렌더러. `src/numbersidc/sidc/cyberspace.js`가 D·E 아이콘 대응을 담고 있다 | 3자 구현, 교차검증용 |
| https://cdn.jsdelivr.net/npm/milstandard-e@0.2.14/tsv-tables/Cyberspace.tsv | 2525E 표 전사본 | 3자 전사, **milsymbol과 동일 저자 — 독립 아님** |
| https://docs.carmenta.com/pages/milstd2525d_tactical_sidc.html | SIDC 자릿수·심볼셋 목록 | 상용 제품 문서 |
| https://docs.carmenta.com/pages/milstd2525d_symbols.html | 부록 지원 범위 (부록 L 미지원 명시) | 상용 제품 문서 |
| https://docs.carmenta.com/pages/milstd2525d_appendix_d.html | 육상 부록 심볼 목록 | 상용 제품 문서 |
| https://www.npmjs.com/package/milsymbol | 배포 정보 | 3자 |
| https://github.com/missioncommand/mil-sym-java | 대안 렌더러 | 3자 |
| http://www.mapsymbs.com/MilStd2525D.pdf | 2525D 원문 사본 | **비공식 미러. 인용 출처로 쓰지 말 것 (V-15)** |
| https://publications.sto.nato.int/publications/STO%20Educational%20Notes/STO-EN-IST-170/EN-IST-170-07.pdf | NATO STO 사이버 심볼론 강의노트 | **접근 실패(HTTP 403). 내용 미확인** |

라이선스 메모 (`docs/01-datasets.md` 갱신 대상):

- **milsymbol** — MIT. 상황도 UI에 번들 가능.
- **Esri joint-military-symbology-xml** — Apache 2.0으로 표기됨(`license.txt` 확인 필요).
  이 프로젝트는 코드값을 참조만 하고 파일을 재배포하지 않는다.
- **milstandard-e** — 라이선스 미확인. 참조만 했고 배포 대상 아님.

---

## 10. 미결 사항 요약

1. **ADR-0013 2항 개정** — 표준에 사이버 심볼이 있다는 사실을 반영해야 한다(1절).
2. **2525D vs 2525E** — E 원문 확인 후 재검토(V-3). 결손 10종의 운명이 여기 걸려 있다.
3. **Q5 (UI 스택)** — 심볼셋 60 지원이 사실상 milsymbol을 강제한다. 웹 스택 쪽 압력(3절).
4. **오버레이 심볼의 소속 자릿수** — 아군 자산의 Effect 심볼을 어느 소속으로 그릴지(5.2).
5. **부대 심볼** — `tacnet-01`의 `units[]`에 병과 정보가 없어 엔터티를 정할 수 없다.
   시나리오 스키마 보강이 필요하다.
