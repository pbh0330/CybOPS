# 16. OCSF 정규화 매핑 스펙

**상태**: 초안 (2026-09-07). 클래스 번호는 원문 대조 완료, 의미 타당성 검토는 미완료.
**대응 파일**: `configs/ocsf-mapping.json` (기계 판독용)
**근거 ADR**: ADR-0005(OCSF 고정), ADR-0002(지오로케이션 배제), ADR-0003(상태는 결정론 엔진),
ADR-0008(불균형), ADR-0009(근거 인용), ADR-0010(원본은 임시 자원), ADR-0011(LANL 라벨 한계)

이 문서는 ADR-0005가 요구한 소스별 매핑 테이블의 사람이 읽는 절반이다. 코드값과 필드 대응표는
JSON에 있고, 여기에는 **왜 그렇게 골랐는지**와 **무엇을 잃는지**를 적는다.

> **인용 주의.** 아래 클래스 번호와 속성명은 OCSF 스키마 저장소의 원본 JSON 파일에서 직접 확인했다.
> 그러나 `verified: true`는 "그 이름이 OCSF 1.9.0에 실존한다"는 뜻일 뿐, "이 소스 필드를 그 속성에
> 넣는 것이 의미상 옳다"는 뜻이 **아니다.** 후자는 `semantics_reviewed`로 따로 표시했고 현재 전 항목
> false다. CLAUDE.md "인용·수치 취급 주의" 적용 대상이다.

---

## 1. 버전 고정

**OCSF 1.9.0에 고정한다.** 정확히는 릴리스 태그가 아니라 **커밋 SHA**에 고정한다.

| 항목 | 값 |
|---|---|
| 스키마 버전 | **1.9.0** |
| 고정 커밋 | **`856d462bd20dc46cc1ffed2dfffe3b91ef0fbeba`** |
| 릴리스 시각 | 2026-08-03T14:39:07Z |
| 원본 조회 기준 | `https://raw.githubusercontent.com/ocsf/ocsf-schema/856d462b.../` |

### 왜 태그가 아니라 커밋인가

`github.com/ocsf/ocsf-schema`에는 **`1.9.0`(태그)와 `v1.9.0`(브랜치)가 둘 다 있다.** 처음에는
`v1.9.0`으로 파일을 받았는데, 확인해 보니 그것은 태그가 아니라 브랜치였다. 브랜치 헤드는 움직인다.
같은 URL이 다음 달에 다른 내용을 줄 수 있고, 그러면 "우리는 1.9.0을 썼다"는 서술이 재현되지 않는다.

- `refs/tags/1.9.0` → `856d462bd20dc46cc1ffed2dfffe3b91ef0fbeba`
- `branches/v1.9.0` 헤드 → 같은 `856d462b...` (2026-09-07 시점)
- 그 커밋의 `version.json` → `{"version": "1.9.0"}`

셋이 일치하는 것을 확인하고 커밋 SHA를 채택했다. 확인 URL:

- `https://schema.ocsf.io/1.9.0/` (버전 선택기에 1.0.0 ~ 1.9.0, 1.10.0-dev 노출. 1.9.0이 현재 안정판)
- `https://api.github.com/repos/ocsf/ocsf-schema/releases`
- `https://api.github.com/repos/ocsf/ocsf-schema/git/refs/tags/1.9.0`
- `https://raw.githubusercontent.com/ocsf/ocsf-schema/856d462bd20dc46cc1ffed2dfffe3b91ef0fbeba/version.json`

### 합성 트랙과의 불일치

`scenarios/defnet-01/synthetic/events.jsonl`은 `metadata.version: "1.1.0"`을 쓴다. 이것은 실제
1.1.0 스키마를 대조해서 고른 값이 아니라 생성기에 하드코딩된 문자열이다. **1.9.0으로 바꿔야 한다.**
다만 이 문서는 `scripts/`를 수정하지 않으므로 5.1절에 부적합 목록으로 남긴다.

---

## 2. `verified` 플래그의 의미

`configs/symbology-2525.json`과 같은 규약을 쓴다. 축이 세 개다.

| 플래그 | 뜻 | 현재 상태 |
|---|---|---|
| `verified` | OCSF 목표(class_uid / 속성명 / 열거값)가 고정 커밋의 스키마 파일에 **실존한다** | true 152 / 전체 155 |
| `semantics_reviewed` | 이 소스 필드를 그 속성에 넣는 것이 **도메인 의미상 타당한지** 사람이 검토했다 | **전 항목 false** |
| `src_seen` | 원본 필드를 어디서 확인했는가. `file`(로컬 원본 실측) / `doc`(배포처 문서) / `none`(추정) | 아래 3~5절 |

`verified: false`는 세 건뿐이고 전부 **"OCSF에 대응 속성이 존재하지 않는다"**는 사실 자체를
기록한 항목이다(원본 줄 번호, 공격 단계 이름, auditd terminal). 즉 "확인을 못 했다"가 아니라
"확인해 보니 없다"이다.

`semantics_reviewed`가 전부 false라는 점을 강조해 둔다. **이 스펙은 아직 구현 승인 상태가 아니다.**

---

## 3. 공통 규칙

### 3.1 식별자 산식

```
class_uid = category_uid * 1000 + (클래스 정의 파일의 uid)
type_uid  = class_uid * 100 + activity_id
```

`dictionary.json`이 `type_uid` 설명에서 "Producers and mappers **must** compute this as
`class_uid * 100 + activity_id`"라고 못 박고, `class_uid` 설명이 "Detection Finding is 2004"를
예시로 든다. 카테고리 uid는 `categories.json`에서 확인했다:
system=1, findings=2, iam=3, network=4, discovery=5, application=6, remediation=7, unmanned_systems=8.

### 3.2 필수 필드

`events/base_event.json` 기준.

- **required**: `time`, `class_uid`, `category_uid`, `type_uid`, `activity_id`, `severity_id`, `metadata`
- **recommended**: `message`, `observables`, `status`, `status_code`, `status_detail`, `status_id`, `timezone_offset`
- **optional (이 프로젝트가 쓰는 것)**: `enrichments`, `raw_data`, `unmapped`, `duration`, `count`, `start_time`, `end_time`

두 가지가 실무적으로 중요하다.

1. **`status_id`는 required가 아니라 recommended다.** 성공/실패가 없는 소스를 억지로 채우지 않아도 된다.
2. **`time`은 "must be a UTC epoch value in milliseconds"라고 명시되어 있다.** 상대 시각만 있는
   LANL이 여기서 걸린다 (4.2절).

### 3.3 쓰는 프로파일

| 프로파일 | 쓰는 이유 |
|---|---|
| `host` | `actor`, `device`를 모든 클래스에 붙인다. 프로파일 설명이 "All event classes include this profile by default through the base event"라고 되어 있지만 `metadata.profiles`에 명시 선언한다 |
| `datetime` | `time` 옆에 RFC-3339 문자열 `time_dt`를 둔다. 합성 트랙의 `time_iso`가 가야 할 곳 |
| `security_control` | `action_id`, `is_alert`, `attacks[]`. **Suricata 경보와 방화벽 차단에만** 쓴다 |

### 3.4 한 줄은 한 이벤트

**원본 로그 한 줄은 OCSF 이벤트 하나로만 정규화한다.**

한 줄이 두 클래스에 걸치는 경우가 실제로 있다. AIT의 sudo 줄은 계정 전환(Authentication)이면서
동시에 프로세스 실행(Process Activity)이다. 유혹적으로는 두 개를 뱉고 싶지만 그러면 **라벨 조인이
중복 계상된다.** AIT 라벨은 줄 번호 단위이고 LANL 레드팀 라벨은 행 단위다. `docs/08`에서 이미
"중복 34줄로 이벤트 수를 4.5% 과다 계상"하는 사고를 겪었다. 같은 종류의 함정이다.

주 클래스를 하나 고르고 나머지는 `unmapped`에 남긴다. 예외는 auditd다(6.4절, 손실 L-09).

### 3.5 원본 보존과 출처 추적

ADR-0005는 "원본 필드는 손실 없이 `unmapped`에 보존한다"고 정했다. 여기에 두 가지를 더한다.

| 대상 | 위치 | 근거 |
|---|---|---|
| 원본 로그 한 줄 전문 | `raw_data` | `events/base_event.json` (optional) |
| 원본 타임스탬프 문자열 | `metadata.original_time` | `dictionary.json`. 설명이 "preserved as a pass-through string in its native format (e.g., Syslog timestamp)" |
| 원본 파일 상대 경로 | `metadata.log_name` | `dictionary.json` |
| 로그 생산자 | `metadata.log_provider` | `dictionary.json` |
| 원본 줄 번호 | **`unmapped.src_line`** | **OCSF에 대응 속성 없음** |

마지막 항목이 이 스펙에서 가장 실무적으로 위험한 지점이다. **AIT 그라운드트루스는 줄 번호로만
조인된다.** 정규화기가 줄 번호를 흘리면 AIT 라벨 전량이 조인 불가가 된다. `metadata.uid`에
`<경로>#<줄번호>` 문자열을 넣는 것만으로는 부족하다 - 정수 비교 조인이 필요하므로 별도 정수
필드로도 남긴다.

`raw_data` 전량 보존은 대용량 소스에서 산출물이 원본보다 커진다. LANL `auth.txt`(10.5억 행)는
`raw_data`를 끄고 출처 필드만 남긴다.

### 3.6 정규화 계층에 LLM을 넣지 않는다 (ADR-0003)

필드 매핑, 열거값 변환, 클래스 판별은 전부 규칙 테이블이다. **LLM이 `class_uid`나 `activity_id`를
고르는 경로를 만들지 않는다.** 정규화 결과가 결정론 계층의 입력이므로, 여기에 비결정성이 들어오면
감사 추적성이 그 지점에서 끊긴다.

같은 이유로 `severity_id`는 소스가 준 값만 옮긴다. 상황도 색상 등급과 무관하다.

### 3.7 프롬프트 인젝션 전제

`process.cmd_line`, `file.path`, `http_request.user_agent`, `http_request.url`, DNS `query.hostname`,
`message`는 **공격자가 내용을 통제하는 필드**다. AIT dnsmasq 로그의 질의명에는 base32 유사
페이로드가 그대로 들어 있는 것을 실측으로 확인했다. LLM 컨텍스트에 실을 때 신뢰 불가 데이터로
감싼다(`docs/00-architecture.md` N 계층).

---

## 4. 클래스 목록

전부 고정 커밋의 클래스 정의 파일에서 `uid`를 직접 읽어 확인했다. `verified: true`.

| 클래스 | 카테고리 | 카테고리 uid | 클래스 uid | **class_uid** | 정의 파일 |
|---|---|---|---|---|---|
| File System Activity | system | 1 | 1 | **1001** | `events/system/file_activity.json` |
| Process Activity | system | 1 | 7 | **1007** | `events/system/process_activity.json` |
| Detection Finding | findings | 2 | 4 | **2004** | `events/findings/detection_finding.json` |
| Authentication | iam | 3 | 2 | **3002** | `events/iam/authentication.json` |
| Network Activity | network | 4 | 1 | **4001** | `events/network/network_activity.json` |
| HTTP Activity | network | 4 | 2 | **4002** | `events/network/http_activity.json` |
| DNS Activity | network | 4 | 3 | **4003** | `events/network/dns_activity.json` |
| Email Activity | network | 4 | 9 | **4009** | `events/network/email_activity.json` |
| Tunnel Activity | network | 4 | 14 | **4014** | `events/network/tunnel_activity.json` |

### 4.1 activity_id 열거

`0: Unknown`과 `99: Other`는 클래스 파일이 아니라 `dictionary.json`의 기본 `activity_id`에서 온다.
클래스 파일은 1부터 시작하는 값만 정의한다. 확인 완료.

| 클래스 | activity_id |
|---|---|
| File System Activity (1001) | 1 Create, 2 Read, 3 Update, 4 Delete, 5 Rename, 6 Set Attributes, 7 Set Security, 8 Get Attributes, 9 Get Security, 10 Encrypt, 11 Decrypt, 12 Mount, 13 Unmount, 14 Open |
| Process Activity (1007) | 1 Launch, 2 Terminate, 3 Open, 4 Inject, 5 Set User ID |
| Authentication (3002) | 1 Logon, 2 Logoff, 3 Authentication Ticket, 4 Service Ticket Request, 5 Service Ticket Renew, 6 Preauth, 7 Account Switch |
| Network Activity (4001) | 1 Open, 2 Close, 3 Reset, 4 Fail, 5 Refuse, 6 Traffic, 7 Listen |
| DNS Activity (4003) | **1 Query, 2 Response, 6 Traffic** (3,4,5 없음) |
| HTTP Activity (4002) | 1 Connect, 2 Delete, 3 Get, 4 Head, 5 Options, 6 Post, 7 Put, 8 Trace, 9 Patch, 10~40 WebDAV 확장 |
| Tunnel Activity (4014) | 0 Unknown, 1 Open, 2 Close, 3 Renew, 99 Other |

DNS의 3, 4, 5가 비어 있는 것에 주의한다. dnsmasq의 `forwarded`는 여기에 맞는 값이 없어 99로 간다.

### 4.2 제약 조건

두 개가 실제로 걸린다.

- **Authentication**: `at_least_one: [service, dst_endpoint]`. 그리고 **`user`가 required다.**
  `actor`가 아니다. 인증 주체를 `actor.user`에 넣으면 스키마 위반이다. 합성 트랙이 이 실수를
  하고 있다(5.1절).
- **Network 계열**: `at_least_one: [dst_endpoint, src_endpoint]` (`events/network/network.json`).

### 4.3 자주 쓰는 열거값

전부 `dictionary.json` 또는 해당 클래스 파일에서 확인.

| 열거 | 값 |
|---|---|
| `severity_id` | 0 Unknown, 1 Informational, 2 Low, 3 Medium, 4 High, 5 Critical, 6 Fatal, 99 Other |
| `status_id` | 0 Unknown, 1 Success, 2 Failure, 99 Other |
| `logon_type_id` | 0 Unknown, 1 System, 2 Interactive, 3 Network, 4 Batch, 5 OS Service, **6 없음**, 7 Unlock, 8 Network Cleartext, 9 New Credentials, 10 Remote Interactive, 11 Cached Interactive, 12 Cached Remote Interactive, 13 Cached Unlock, 99 Other |
| `auth_protocol_id` | 0 Unknown, 1 NTLM, 2 Kerberos, 3 Digest, 4 OpenID, 5 SAML, 6 OAUTH 2.0, 7 PAP, 8 CHAP, 9 EAP, 10 RADIUS, 11 Basic Authentication, 12 LDAP, 99 Other |
| `integrity_id` | 0 Unknown, 1 Untrusted, 2 Low, 3 Medium, 4 High, 5 System, 6 Protected, 99 Other |
| `file.type_id` | 0 Unknown, 1 Regular File, 2 Folder, 3 Character Device, 4 Block Device, 5 Local Socket, 6 Named Pipe, 7 Symbolic Link, 8 Executable File, 99 Other |

`auth_protocol_id`에 **Negotiate(SPNEGO)와 SSH publickey가 없다.** LANL 인증의 41%가 Negotiate이고
AIT sshd 로그인이 전부 publickey/password다. 둘 다 99로 간다. 이것은 스키마의 한계이지 매핑 실수가
아니므로 원값을 `auth_protocol` 문자열에 남긴다.

`logon_type_id`가 Windows 로그온 타입에서 유래한다는 점도 기억해 둘 것. Linux 소스(AIT)에 그대로
쓰면 의미가 늘어난다.

### 4.4 엔티티 해석과 observables

`docs/00-architecture.md`의 I 계층 필수 기능인 "IP ↔ 호스트 ↔ 계정 ↔ 자산 ID 통합"은
`observables[]`에 조인 키를 명시적으로 실어 구현한다. L2 임무 온톨로지 조인은 이 배열을 읽는다.

`observable.type_id`는 `dictionary.json`의 타입 정의에 붙은 `observable` 마커에서 확인했다:
1 Hostname, 2 IP Address, 3 MAC Address, 4 User Name, 5 Email Address, 6 URL String, 7 File Name,
8 Hash, 9 Process Name, 10 Resource UID, 11 Port, 12 Subnet, 13 Command Line, **14 Country**,
15 Process ID, 16 User Agent, 19 Credential UID, 45 File Path.

**Country가 observable로 정의되어 있다는 점에 주의한다.** OCSF 관점에서는 국가 코드가 1급
관측치지만, 이 프로젝트에서는 아니다. 다음 절 참조.

---

## 5. 지오로케이션 (ADR-0002)

**결론: 스키마에 자리는 만들되, 그 자리를 읽는 코드를 만들지 않는다.**

| 항목 | 내용 |
|---|---|
| 보관 위치 | `src_endpoint.location.country`, `dst_endpoint.location.country`, `device.location.country` |
| 확인 | `objects/endpoint.json`에 `location`, `objects/device.json`에 `location`(device는 endpoint를 확장), `objects/location.json`에 `country` |
| 값 형식 | ISO 3166-1 Alpha-2 대문자 두 글자. `dictionary.json`이 명시 |
| 채우는 필드 | `country` **하나만** |
| 채우지 않는 필드 | `lat`, `long`, `coordinates`, `city`, `region`, `postal_code`, `isp`, `provider`, `geohash` |

### 읽으면 안 되는 곳

- 우선순위 스코어
- 임무 저하도 전파
- 자산 상태 판정
- 자동 대응 (애초에 자동 대응 경로가 없다 - ADR-0004)
- 경량 ML 분류기의 특징 벡터
- LLM 프롬프트 컨텍스트

### 어떻게 강제하나

선언만으로는 지켜지지 않는다. 두 가지를 건다.

1. 정규화 산출물의 소비자 코드에서 `location.*` 접근을 금지 목록으로 관리한다.
2. **회귀 테스트에 "지오 필드를 흔들어도 결정론 계층 출력이 불변"인 케이스를 넣는다.**
   합성 시나리오 `attack-chain.json`의 `geo_country: "XX"`가 첫 시험 대상이다. C2 목적지의
   국가 코드를 KR로 바꾸든 XX로 두든 임무 저하도가 소수점까지 동일해야 한다.

두 번째가 없으면 ADR-0002는 문서상의 다짐일 뿐이다.

---

## 6. 소스별 매핑

세 소스는 성격이 완전히 다르다. 그 차이가 이 스펙의 실제 내용이다.

| 소스 | 성격 | 정규화 난점 |
|---|---|---|
| 합성 (defnet-01) | 이미 OCSF 형태 | **형태만 OCSF이고 필수 필드가 빠져 있다** |
| LANL cyber1 | 동종 CSV 5종 | **익명화로 의미가 사라진 필드가 많다** |
| AIT-LDS v2.0 | 이종 텍스트 로그 다수 | **줄 번호 라벨, 연도·타임존 없는 타임스탬프** |

### 6.1 합성 텔레메트리 - 부적합 목록

`scenarios/defnet-01/synthetic/events.jsonl` 8,012건을 실제로 읽고 확인했다. 겉모습은 OCSF지만
**required 필드 세 개가 빠져 있다.** 이 파일들은 이번 작업의 소유 범위 밖이므로 수정하지 않고
목록만 남긴다.

| # | 문제 | 등급 | 고칠 방법 |
|---|---|---|---|
| 1 | `category_uid` 없음 | **required 위반** | `class_uid / 1000`의 몫 |
| 2 | `type_uid` 없음 | **required 위반** | `class_uid * 100 + activity_id` |
| 3 | `activity_id` 없음 | **required 위반** | 스트림별 규칙 (process→1, file read→2, auth→1, network→6) |
| 4 | `event_uid`가 최상위 키 | 비표준 | `metadata.uid`로 이동 |
| 5 | `time_iso`가 최상위 키 | 비표준 | `datetime` 프로파일의 `time_dt`. 다만 현재 값에 타임존 지정자가 없어 RFC-3339가 아니다. `Z`를 붙여야 한다 |
| 6 | `metadata.version = "1.1.0"` | 버전 불일치 | `"1.9.0"` |
| 7 | 인증 주체가 `actor.user`에 있다 | **스키마 위반** | `user`로 이동. Authentication에서 `user`는 required |
| 8 | Authentication에 `service`도 `dst_endpoint`도 없다 | **constraint 위반** | `dst_endpoint.hostname` = 현재 `device.hostname` 값 |
| 9 | `status_id` 없음 | recommended 누락 | `unmapped.result`에서 유도 |
| 10 | `metadata.profiles` 선언 없음 | 권고 누락 | `["host", "datetime"]` |

7번은 특히 조용하다. `actor.user.name`도 유효한 OCSF 경로라 스키마 검증기 없이는 눈에 띄지 않는데,
Authentication 클래스에서 `actor`는 host 프로파일의 optional이고 `user`가 required다. **인증
주체가 optional 자리에 들어가 있으면 다운스트림의 계정 중심 질의가 전부 빈다.**

`unmapped` 확장 필드의 실제 목표는 다음과 같다.

| 스트림 | 원본 (`unmapped.*`) | OCSF |
|---|---|---|
| process | `process_name`, `pid`, `cmdline`, `parent` | `process.name`, `process.pid`, `process.cmd_line`, `process.parent_process.name` |
| process | `integrity` (medium/high/system) | `process.integrity_id` (3/4/5) |
| file | `path`, `size_bytes` | `file.path` + `file.name`, `file.size` |
| file | `action` (read/write) | `activity_id` 2 / 3 |
| auth | `logon_type` (interactive/network/service) | `logon_type_id` 2 / 3 / 5 |
| auth | `src_host`, `result` | `src_endpoint.hostname`, `status_id` |
| network | `dst_host`, `dst_port` | `dst_endpoint.hostname` 또는 `.ip`, `dst_endpoint.port` |
| network | `bytes_out`, `bytes_in` | `traffic.bytes_out`, `traffic.bytes_in` |
| network | `geo_country` | `dst_endpoint.location.country` (**보관만**) |

`dst_host`에 호스트명(`DC01`)과 IP(`203.0.113.44`)가 섞여 있다. 판별 규칙이 필요하다.

**매핑 불가 3건**:

- `interval_sec` (비콘 주기) - OCSF에 주기성/비콘 간격 속성이 없다. `connection_info`에도
  `traffic`에도 없다. 애초에 이것은 단일 이벤트의 속성이 아니라 **이벤트 열의 통계량**이다.
  결정론 계층의 파생 특징으로 다뤄야 하고 정규화 산출물에 있으면 안 된다.
- `distinct_targets` (고유 목적지 수) - `count`가 있어 보이지만 `count`는 "집계된 이벤트 수"이지
  "고유 대상 수"가 아니다. 의미가 다른 속성에 넣으면 다운스트림이 표준 의미로 오독한다.
- `target` (`lsass.exe` 같은 대상 프로세스) - 의미상 `activity_id: 3 (Open)`으로 재모델링하면
  `process`=대상, `actor.process`=주체가 되어 정확히 맞는다. 그러나 생성기가 activity를 Launch로
  고정해 두어 현재 형태로는 자리가 없다. 재모델링은 생성기 수정 사안이다.

라벨(`labels.jsonl`)은 `technique` → `attacks[].technique.uid`, `tactic` → `attacks[].tactic.uid`로
간다(`objects/attack.json`, `objects/technique.json` 확인). `campaign`은 전용 속성이 없어
`metadata.correlation_uid`가 근사치다. `stage`(킬체인 스텝 이름)는 **대응 속성이 없다** -
`finding_info.kill_chain`은 Detection Finding 전용이라 텔레메트리 이벤트에 붙일 수 없다.

### 6.2 LANL cyber1 - 익명화가 정규화의 본체다

컬럼 순서는 `csr.lanl.gov/data/cyber1/`의 파일별 설명과 로컬 원본 선두 행을 **둘 다** 대조해
확인했다. 결측은 `?`.

| 파일 | 컬럼 | OCSF 클래스 |
|---|---|---|
| `auth.txt` | time, src_user@domain, dst_user@domain, src_computer, dst_computer, auth_type, logon_type, auth_orientation, success/failure | **3002** |
| `proc.txt` | time, user@domain, computer, process_name, start/end | **1007** |
| `flows.txt` | time, duration, src_computer, src_port, dst_computer, dst_port, protocol, packet_count, byte_count | **4001** |
| `dns.txt` | time, src_computer, computer_resolved | **4003** |
| `redteam.txt` | time, user@domain, src_computer, dst_computer | **없음 (라벨)** |

#### 열거값 변환

`analysis/lanl/auth-rtsrc-hosts.csv`(48,196행 슬라이스)에서 실제 등장 값을 셌다. 이 슬라이스는
레드팀 출발지 4개 호스트만 담으므로 전체 데이터셋의 값 집합과 다를 수 있다.

| 원본 `auth_type` | 건수 | → `auth_protocol_id` |
|---|---|---|
| Negotiate | 20,040 | **99 (Other)** + `auth_protocol="Negotiate"` |
| Kerberos | 18,386 | 2 |
| `?` | 7,094 | 0 |
| NTLM | 2,676 | 1 |

| 원본 `logon_type` | 건수 | → `logon_type_id` |
|---|---|---|
| Network | 21,814 | 3 |
| Service | 19,811 | 5 |
| `?` | 6,250 | 0 |
| Interactive | 98 | 2 |
| Unlock | 94 | 7 |
| RemoteInteractive | 46 | 10 |
| NewCredentials | 44 | 9 |
| CachedInteractive | 39 | 11 |

| 원본 `auth_orientation` | 건수 | → `activity_id` |
|---|---|---|
| LogOn | 41,131 | 1 |
| TGS | 5,435 | 4 (Service Ticket Request) |
| LogOff | 844 | 2 |
| TGT | 660 | 3 (Authentication Ticket) |
| AuthMap | 100 | **99** |
| ScreenLock | 17 | **99** |
| ScreenUnlock | 9 | **99** |

7개 값 중 3개가 99로 떨어진다. `activity_name`에 원값을 반드시 남긴다. `ScreenUnlock`은
`logon_type_id: 7 (Unlock)`이 있어서 혼동하기 쉬운데, 그것은 **로그온 종류**이지 **활동**이
아니다. 활동 축에는 대응이 없다.

#### 매핑 불가 - 익명화가 지운 것들

이 부분이 논문에 쓸 내용이다. LANL 문서 원문:
"All other users, computers, process, ports, times, and other details were de-identified as a
unified set across all the data elements." 단 예외가 있다 - **잘 알려진 시스템 계정(SYSTEM,
Local Service)과 잘 알려진 포트(80, 443 등)는 가명화하지 않았다.** 즉 한 필드 안에 가명과
실값이 섞여 있다.

| 잃은 것 | 왜 매핑할 수 없나 |
|---|---|
| **실제 신원** | `U620@DOM1`, `C17693`, `P16`은 가명이다. OCSF에 "이 식별자는 가명"임을 표시하는 속성이 **없다.** `user.name`에 넣으면 다운스트림은 실제 계정명으로 읽는다. 프로젝트 규약으로 `metadata.labels`에 `pseudonymized`를 붙이고, 엔티티 해석기가 이 라벨을 보면 외부 자산 대장 조인을 시도하지 않게 한다 |
| **IP 주소** | 데이터셋에 아예 없다. `src_endpoint.ip` / `dst_endpoint.ip`를 채울 값이 존재하지 않는다 |
| **절대 시각** | 수집 시점이 비공개다. `time`은 UTC epoch ms가 필수이므로 합성 앵커를 주입해야 한다 |
| **포트 (가명화분)** | `N10451`은 정수가 아니다. OCSF `port`는 `port_t`(정수형)이라 **타입 자체가 안 맞는다** |
| **프로세스 맥락** | `pid`, `cmd_line`, 실행 경로, 부모 프로세스가 전부 없다. 프로세스명도 가명 |
| **DNS 질의명** | 해석 대상이 도메인이 아니라 컴퓨터 가명이다. `query.hostname`은 타입(`hostname_t`)이 맞아서 넣을 수는 있는데 의미가 다르다 |
| **DNS 응답 일체** | rrtype, rcode, answers, 응답 서버 전부 없다 |

포트 항목은 조금 더 설명이 필요하다. `N10451`을 `10451`로 잘라 넣고 싶어지는데, **그러면 실제
포트 10451과 구별할 수 없게 된다.** 잘 알려진 포트는 가명화되지 않았으므로 같은 컬럼에 실값이
섞여 있기 때문이다. 규칙은 이렇게 정한다: 숫자면 `port`에 넣고, `N` 접두면 `port`는 null로 두고
`unmapped.src_port_raw` / `unmapped.dst_port_raw`에 원문자열을 보존한다.

또 하나 눈에 띈 것: `dst_user@domain` 자리에 `U1723@C1759`처럼 **도메인 자리에 컴퓨터 id가 오는
경우**가 있다. `user.domain`에 호스트명이 들어간다. 도메인 기반 집계를 하면 조용히 오염된다.

#### redteam.txt는 이벤트가 아니다

`redteam.txt`는 OCSF 이벤트로 정규화하지 않는다. `auth.txt`에 붙는 **주석**이다. 조인 키를
명시적으로 고정한다.

- 기본: `(시각, 계정, 출발지, 목적지)` 4필드 → **701 / 715** 매칭
- 대안: `(시각, 계정, 출발지)` 3필드 → 715 / 715 매칭
- **채택: 4필드.** 3필드를 쓰면 14건이 목적지가 다른 행에 붙어 `dst_endpoint` 기반 특징에 잘못된
  학습 신호를 준다. 근거는 `docs/08-lanl-ground-truth.md` 3.5절
- 원본 749줄 중 34줄이 중복이므로 고유 **715**건을 쓴다

`attacks[]`는 채우지 않는다. LANL 라벨에 ATT&CK 기법 id가 없다.

### 6.3 AIT-LDS v2.0 - 형식 다양성 시험대

`russellmitchell.zip`(7.1GB)을 **해제하지 않고 zip 엔트리 스트림으로 직접 표본을 읽어** 형식을
확인했다. 원본 무수정(CLAUDE.md 작업 규칙). 호스트 22개, 로그 트리 7,184 경로.

이 데이터셋을 1순위 파이프라인 개발용으로 고른 이유가 여기서 확인된다. LANL은 동종 CSV 5종,
OpTC는 단일 JSON 스키마라 **정규화기의 형식 커버리지를 시험하지 못한다.** AIT는 한 테스트베드
안에 텍스트 syslog, key=value(auditd), Apache combined, JSON Lines(Suricata), 반정형(openvpn)이
전부 들어 있다.

| 로그 | 예시 경로 | 클래스 | 비고 |
|---|---|---|---|
| Linux auth (syslog) | `gather/intranet_server/logs/auth.log` | 3002 | sshd, su, sudo, CRON, pam_unix |
| auditd | `gather/*/logs/audit/audit.log` | 3002 / 1007 / 1001 | type으로 분기 |
| Apache access (combined) | `gather/*/logs/apache2/*-access.log.N` | 4002 | |
| dnsmasq | `gather/inet-{dns,firewall}/logs/dnsmasq.log` | 4003 | |
| OpenVPN | `gather/vpn/logs/openvpn.log` | 4014 | |
| Suricata eve.json | `gather/*/logs/suricata/eve.json` | event_type별 분기 | |
| exim4 / mail | `gather/*_mail/logs/exim4/mainlog` | 4009 | 필드 매핑은 다음 단계 |
| kern.log, syslog, messages | | 미정 | shorewall 차단은 4001 + `action_id: 2` 후보 |
| journal/*.journal, *.pcap | | **제외** | 바이너리, syslog와 중복, Suricata로 대체 |
| `attacker_0/logs/*` | | **제외** | 아래 참조 |

#### attacker_0 로그를 정규화하지 않는 이유

`attacks.log`, `dnsteal.log`, `sm.log`는 **공격자 측 실행 기록과 Kyoushi 상태기계 로그**다.
방어 측 텔레메트리가 아니다. 이것을 탐지 입력에 섞으면 라벨 누출이 된다.
`docs/08` 5절의 "이들로 라벨을 만들면 순환 논리"와 같은 함정이다. 그라운드트루스 보조 자료로만 쓴다.

#### 라벨 트리

```
labels/<host>/logs/<원본과 동일한 상대 경로>
{"line": 145, "labels": ["attacker_change_user", "escalate"],
 "rules": {"escalate": ["attacker.escalate.su.login"]}}
```

조인 키는 **(호스트, 로그 상대 경로, 1-based 줄 번호)** 세 개다. 3.5절의 `unmapped.src_line`이
여기 걸린다.

라벨이 붙은 파일은 **8종뿐이다**: `inet-firewall/dnsmasq.log`, `internal_share/audit/audit.log`,
`intranet_server/apache2/*-access.log.N`, `intranet_server/apache2/*-error.log.N`,
`intranet_server/audit/audit.log`, `intranet_server/auth.log`,
`monitoring/logstash/intranet-server/*-system.cpu.log`, `vpn/openvpn.log`.

**나머지 로그는 비라벨이다. 라벨 없는 파일을 음성으로 간주하면 안 된다.** mail, syslog, Suricata에
공격 흔적이 있어도 라벨이 없다.

라벨 어휘(`attacker_change_user`, `escalate`, `dnsteal`, `foothold`, `dnsteal-received`,
`attacker_vpn`)는 **ATT&CK ID가 아니다.** `metadata.labels`에 원문 그대로 넣고 `attacks[]`는
비워 둔다. 자동 변환하면 근거 없는 기법 인용이 된다(ADR-0009와 정면 충돌).

#### 소스별 매핑 요점

**auth.log (Linux syslog)** - `Jan 23 16:30:46 intranet-server sshd[25184]: Accepted publickey for jhall from 172.19.131.174 port 49828 ssh2: RSA SHA256:...`

- `Accepted`/`Failed` → `activity_id: 1`, `status_id: 1/2`
- `su`/`sudo` → **`activity_id: 7 (Account Switch)`**. AIT 라벨이 정확히 이 줄에
  `attacker_change_user`, `escalate`를 붙인다. 클래스가 딱 맞는 드문 경우다
- `sshd[25184]` → `actor.process.name` + `actor.process.pid`
- `publickey`/`password` → `auth_protocol_id: 99` + 원값 문자열
- 매핑 불가: sudo의 `COMMAND=/bin/cat /etc/shadow`(Authentication 클래스에 `process`도 `cmd_line`도
  없다), `TTY=`/`PWD=`, SSH 공개키 지문(`certificate`/`authentication_token`은 인증서·토큰 객체이지
  키 지문이 아니다)
- 판단 보류: `pam_unix(cron:session)` 계열. cron 세션 개폐를 Logon/Logoff로 넣으면 로그온 통계가
  cron 노이즈로 오염된다. `semantics_reviewed` 대상

**auditd** - `type=USER_ACCT msg=audit(1642723741.072:375): pid=10125 uid=0 auid=4294967295 ses=4294967295 msg='op=PAM:accounting acct="root" exe="/usr/sbin/cron" ... res=success'`

- **AIT 소스 중 유일하게 절대 시각이 온전하다.** 다른 파일의 연도 추정을 교차 검증하는 기준으로 쓴다
- `:375` 일련번호 → `metadata.uid`. 같은 논리 이벤트의 여러 줄이 이 번호를 공유한다
- 매핑 불가: **`auid`**. OCSF `user` 객체에 "audit uid" 개념이 없다. `user.uid`에 넣으면 실효
  uid와 구별되지 않는다. 게다가 `4294967295`(-1, 미설정) 센티널이 흔해서 그대로 넣으면
  **존재하지 않는 계정 id가 생긴다.** `unmapped.auid`로 보존하고 센티널은 null로 접는다
- 매핑 불가: `ses`(동일한 센티널 문제 + OCSF `session`은 로그온 세션이라 수명 정의가 다르다),
  `terminal=`, `op=PAM:accounting` 같은 PAM 단계

**Apache access (combined)** - `10.143.2.91 - - [24/Jan/2022:07:34:57 +0000] "GET / HTTP/1.1" 200 6203 "-" "Mozilla/5.0 ..."`

- 메서드 → `activity_id` (GET 3, POST 6, PUT 7, HEAD 4, DELETE 2, OPTIONS 5, PATCH 9)
- `http_request.url.path`, `.version`, `.referrer`, `.user_agent` / `http_response.code`, `.length`
- 상태 코드 → `status_id` (1xx~3xx → 1, 4xx/5xx → 2)
- **타임존 오프셋이 있다.** syslog 계열과 달리 추정이 필요 없다
- vhost는 로그 줄이 아니라 **파일 이름**에서 얻어 `dst_endpoint.hostname`에 넣는다. 파생 규칙임을 표시
- 매핑 불가: identd/remote user 필드(항상 `-`), 요청 처리 시간(combined 포맷에 없음)

**dnsmasq** - `Jan 21 00:00:09 dnsmasq[3468]: query[A] 3x6-.596-.<base32 유사>.customers_2017.xlsx.email-19.kennedy-mendoza.info from 10.143.0.103`

- `query[A]` → `activity_id: 1`, `reply ... is ...` → 2, **`forwarded ... to ...` → 99**
  (DNS Activity에 3,4,5가 없다)
- `answers[].rdata` (`objects/dns_answer.json` → `objects/dns_resource_record.json`)
- 매핑 불가: **rcode 부재**(dnsmasq 기본 로그에 응답 코드가 없어 NXDomain 급증 신호를 못 만든다),
  **transaction_id 부재**(query 줄과 reply 줄을 확정적으로 짝지을 수 없다. 이름 문자열 매칭에
  의존해야 하는데 같은 이름을 여러 클라이언트가 동시에 질의하면 모호해진다), 질의/응답 소요 시간

**OpenVPN** - `2022-01-21 06:30:01 192.168.230.95:60795 [twhite] Peer Connection Initiated with [AF_INET]192.168.230.95:60795`

- `Peer Connection Initiated` → `activity_id: 1 (Open)`, soft reset/restart → 3 (Renew), 그 외 99
- 연도는 있으나 **타임존이 없다**
- 매핑 불가: `TLS: soft reset sec=3308/3308 bytes=45748/-1 pkts=649/0`(`-1`과 `0`이 섞인 방향 불명
  값이라 `traffic.bytes_out`에 넣는 것은 추정), `VERIFY OK: ... CN=OpenVPN CA`(Tunnel Activity에
  `certificate` 속성이 없다), `tunnel_type_id`(split/full 여부가 로그에 없다. 0으로 두고 추정하지 않는다)
- **가장 아픈 것: 터널 내부 할당 IP가 표본 줄에 없다.** `tunnel_interface`를 채울 수 없어
  VPN 사용자와 내부 이벤트를 잇는 고리가 끊긴다. AIT 공격자가 VPN으로 들어오므로 이 고리가
  필요하다. 전체 로그를 훑어 status 로그가 따로 있는지 확인해야 한다 (손실 L-12)

**Suricata eve.json** - JSON Lines, `event_type`으로 분기

| event_type | 클래스 |
|---|---|
| `alert` | **2004** Detection Finding |
| `dns` | 4003 |
| `http` | 4002 |
| `flow`, `netflow`, `tls` | 4001 |
| `stats` | **제외** (성능 계측 지표. 보안 이벤트가 아니다) |

- `alert.signature` → `finding_info.title`, `alert.signature_id` → `finding_info.uid`
- `alert.action` → `action_id` (allowed 1, blocked 2), `is_alert: true`
- 타임스탬프에 타임존이 포함되어 있다
- **`fast.log`는 정규화하지 않는다.** `eve.json` alert의 저해상도 중복이다. 둘 다 넣으면 경보가
  두 배로 계상된다
- 매핑 불가: `alert.category`/`severity`/`Priority`(ET 룰셋 자체 분류. OCSF `severity_id` 6단계로
  접으면 원 등급이 사라진다. **접기 규칙을 사람이 정하기 전까지 `severity_id`는 0으로 둔다.**
  임의 매핑하면 근거 없는 값이 우선순위 계산에 흘러든다), `alert.gid`/`rev`,
  **ATT&CK 기법**(ET 오픈 룰에 ATT&CK 매핑이 없다. `attacks[]`를 채우면 날조가 된다)

---

## 7. 손실 목록

**정규화는 정보를 잃는다. 무엇을 잃는지 적지 않은 매핑 스펙은 쓸모가 없다.**

| id | 소스 | 잃는 것 | 회복 | 영향 |
|---|---|---|---|---|
| L-01 | LANL | 실제 신원 (가명 U###/C###/P###) | 불가 | **L1↔L2 조인이 실증이 아니라 가정이 된다.** 논문에 "LANL 자산을 임무에 매핑했다"고 쓸 수 없다 |
| L-02 | LANL | IP 주소 전체 | 불가 | I 계층 필수 기능인 IP↔호스트 통합이 성립하지 않는다. DHCP 재할당 처리 로직을 LANL로 검증할 수 없다 |
| L-03 | LANL | 절대 시각 | 불가 | 타임존·근무시간·주말 같은 시간 특징이 무의미. 상황도 타임라인은 상대 시각으로만 표시 |
| L-04 | LANL | 가명화된 포트 (`N####`) | 불가 | 서비스 식별이 잘 알려진 포트로만 가능. 비표준 포트 C2 탐지 불가 |
| L-05 | LANL | 프로세스 맥락 (pid, cmdline, 경로, 부모) | 불가 | **ATT&CK 실행 계열 기법을 LANL로 판별할 수 없다.** 기법 라벨링은 OpTC/AIT 몫 |
| L-06 | LANL | DNS 질의명 | 불가 | DNS 기반 탐지 전 계열 불가 |
| L-07 | LANL | 라벨 14건의 목적지 일치 | 부분 | 라벨 1.96% 손실을 감수하고 목적지 특징 오염을 피한다 (`docs/08` 3.5절) |
| L-08 | AIT | 연도와 타임존 | 부분 | auditd epoch로 교차 보정 가능. **보정 근거를 기록하지 않으면 재현 불가** |
| L-09 | AIT | auditd 다중 줄 이벤트의 구조 | 부분 | 아래 별도 설명 |
| L-10 | AIT | Suricata 경보 등급의 원 해상도 | 부분 | 접기 규칙 확정 전까지 경보 등급 기반 정렬을 하지 않는다 |
| L-11 | AIT | sudo 커맨드라인 | 가능 | audit.log EXECVE로 대체. 단 두 로그의 시각 정합이 전제 |
| L-12 | AIT | VPN 터널 내부 IP | 미확인 | VPN 사용자와 내부 이벤트를 잇는 고리가 끊긴다 |
| L-13 | 합성 | 비콘 주기, 스캔 폭 | 가능 | 결정론 계층이 이벤트 열에서 재계산 |
| L-14 | 공통 | 라벨 어휘의 원 의미 | 가능 | `metadata.labels`에 원문 보존. 사람이 매핑표를 만든 뒤에만 `attacks[]` 채움 |
| L-15 | 공통 | 미제공 속성의 추정 주입 (`file.type_id=1` 등) | 가능 | 추정 주입 필드 목록을 산출물 메타에 명시. 안 하면 관측값과 구별 안 됨 |

### L-09를 따로 설명한다

auditd는 **하나의 논리 이벤트가 SYSCALL / EXECVE / PATH / CWD 여러 줄로 나뉜다.** 3.4절의
"한 줄은 한 이벤트" 정책과 정면으로 충돌한다.

- 줄 단위로 정규화하면 → execve 인자와 대상 파일이 서로 다른 OCSF 이벤트로 흩어진다
- 재조립하면 → 라벨(줄 번호) 조인이 1:N이 되어 그라운드트루스가 중복 계상된다

**둘 중 하나를 포기해야 한다.** 현재 결정은 줄 단위 유지 + 일련번호(`msg=audit(...:375)`)를
`metadata.uid`에 넣어 **재조립 가능성만 남긴다**는 것이다. 재조립이 필요한 분석은 정규화 산출물
위에서 별도로 수행하고, 라벨 조인은 언제나 줄 단위로 한다.

이 절충을 명시하지 않으면 나중에 "AIT auditd 탐지율"이라는 숫자가 무엇을 센 것인지 알 수 없게 된다.

---

## 8. 매핑 커버리지

ADR-0005는 "매핑 커버리지(원본 필드 중 OCSF로 매핑된 비율)를 데이터셋별로 기록한다"고 정했다.
정의를 명확히 해 둔다.

```
커버리지 = (OCSF 표준 속성으로 매핑된 원본 필드 수) / (원본 필드 총수)
```

- **`unmapped`에 보존한 필드는 분자에 넣지 않는다.** 보존은 매핑이 아니다.
- **소스별, 스트림별로 따로 낸다.** 합산 수치는 의미가 없다. LANL auth의 9개 컬럼과 AIT
  Suricata의 수십 개 필드를 같은 분모에 넣으면 아무 말도 아닌 숫자가 나온다.
- 현재 **미측정**이다. 정규화기 구현 후 산출한다.

---

## 9. 아직 검증되지 않은 것

논문·제안서에 쓰기 전에 소진할 체크리스트다.

| id | 항목 | 현재 상태 |
|---|---|---|
| V-1 | **`semantics_reviewed`가 전 항목 false** | 클래스 번호는 맞지만 "이 필드를 여기 넣는 게 옳은가"는 아무도 검토하지 않았다 |
| V-2 | Suricata `alert.severity` → `severity_id` 접기 규칙 | 미정. 현재 `severity_id: 0` |
| V-3 | AIT 라벨 어휘 → ATT&CK 매핑표 | 미작성. **자동 변환 금지** |
| V-4 | OpenVPN 터널 내부 IP를 담는 줄 형식 존재 여부 | 표본만 봤다. 전량 확인 필요 (L-12) |
| V-5 | AIT exim4/mail → Email Activity(4009) 필드 매핑 | 클래스 번호만 확정 |
| V-6 | LANL 열거값 집합의 완전성 | 48,196행 슬라이스에서 셌다. 10.5억 행 전체의 값 집합은 다를 수 있다 |
| V-7 | kern.log / shorewall 차단 → Network Activity + `action_id: 2` | 후보만 세웠다 |
| V-8 | OpTC eCAR → OCSF | **이번 범위 밖.** 별도 절로 추가해야 한다 |
| V-9 | 지오 필드 불변성 회귀 테스트 | 미작성. 이것이 없으면 ADR-0002는 문서상의 다짐일 뿐 |

---

## 10. 다음 작업

1. `semantics_reviewed` 채우기. 클래스 선택이 도메인 의미상 맞는지 항목별 검토
2. 합성 트랙 부적합 10건 수정 (`scripts/New-SyntheticTelemetry.ps1` 소유자 작업)
3. OCSF 스키마 검증기를 CI에 넣기. required 필드 누락이 조용히 통과하는 현재 상태를 막는다
4. OpTC eCAR 매핑 절 추가
5. 지오 필드 불변성 회귀 테스트 작성 (V-9)
6. 정규화기 구현 후 커버리지 측정 (8절)
