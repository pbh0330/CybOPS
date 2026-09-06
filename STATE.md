# 현재 상태 — 2026-09-05 (최종 갱신: 저장소 이전 + LANL auth.txt.gz 취득 착수)

작업 시작 전 이 파일부터 읽는다.

## 위치

| | 경로 |
|---|---|
| 저장소(코드·문서) | `F:\F\other_class\CybOPS` |
| 데이터 1순위 | `F:\mc-cycop-data\raw\` |
| 데이터 예비 | `C:\mc-cycop-data\raw\` (F: 여유가 부족할 때만) |
| 원격 | `git@github.com:pbh0330/CybOPS.git` — **푸시 완료** |

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

기획 문서 완료. **오프라인 합성 트랙 동작 확인 완료 — 인터넷 없이 개발 가능.**
데이터셋 취득은 AIT 일시정지, **LANL 4/5 완료** (`auth.txt.gz` 취득 진행 중).

## 지금 당장 돌려볼 수 있는 것

```powershell
cd F:\F\other_class\CybOPS
.\scripts\Test-Ontology.ps1                            # 온톨로지 검증
.\scripts\New-SyntheticTelemetry.ps1                   # 합성 데이터 생성
.\scripts\Show-MissionReplay.ps1                       # 시간축 상황도
.\scripts\Show-MissionReplay.ps1 -WhatIfIsolate ESX01  # 봉쇄 비용 what-if
```

전부 네트워크 없이 동작한다. 상세는 `docs/07-synthetic-data.md`.

---

## 1. 데이터 취득 현황

저장 위치: `F:\mc-cycop-data\raw\`

### AIT-LDS v2.0 — LANL 완료 후 자동 재개 대기

| 파일 | 현재 | 목표 | 상태 |
|---|---|---|---|
| russellmitchell.zip | **2,352,601,936 B (2.19 GB)** | 6.64 GB | 부분 취득, 이어받기 가능 |
| santos / fox / harrison / wardbeck / shaw / wheeler / wilson | 0 | 123 GB | 미착수 |

- 로그: `F:\mc-cycop-data\raw\ait-lds-v2\_acquire.log`
- **`Invoke-AcquireChain.ps1`이 auth.txt.gz 검증을 통과시키면 자동으로 착수한다.**
  수동 재개도 가능하고 언제 실행해도 안전하다 — 완료 파일은 건너뛰고 부분 파일은
  현재 지점부터 이어받는다:
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-ait.ps1
  ```
- 실측 속도 0.04~0.43 MB/s. 130GB 전량은 며칠 단위다. 회선이 약 12 Mbps(1.5 MB/s)라
  이게 상한이다.

### LANL Comprehensive — 5/5 완료 (2026-09-06)

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
> 대용량 파일을 브라우저로 받지 말 것 — `scripts/fetch-lanl.ps1`이 이어받기·정체 감지·
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

미완료 — `auth.txt.gz` (실제 크기 7,626,505,158 B = 7.10 GiB):

Chrome이 받는 중이다. 22:19 기준 1,134 MB (15.6%), 0.61 MB/s, **완료 예상 09-06 01:05.**
`auth.txt.gz`가 가장 중요하다. 레드팀 이벤트가 인증 로그와 맞물려야 측면이동 탐지가 성립한다.

#### 무인 취득 체인이 돌고 있다

`scripts/Invoke-AcquireChain.ps1`이 백그라운드(detached)에서 실행 중이다.

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

auth가 실패하면 **AIT를 시작하지 않는다.** 회선을 auth 재시도에 남겨두기 위해서다.

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
   디렉터리 항목이 수 분 뒤처진다 — 실제 1,049 MB인 파일을 914 MB로 보고했다. 이걸로
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

### 미착수

- DARPA TC — Google Drive 호스팅, 서브셋 단위
- DARPA OpTC — Google Drive, 약 1TB. 부분 취득 필요. `gdown` 등 별도 도구
- Security Datasets (Mordor) — 소용량

### 디스크 여유

C: 831.6 GB / F: 919.6 GB

---

## 1.5 오프라인 합성 트랙 — 동작 확인 완료

Python·Node·Java 모두 미설치. **가용 런타임은 Windows PowerShell 5.1뿐이다.**
그래서 참조 구현을 PowerShell로 작성했다. 데이터 아티팩트(JSON/JSONL)는 언어 독립이므로
나중에 Python으로 포팅해도 그대로 쓴다.

```
scenarios/defnet-01/mission.json       임무 온톨로지 (자산 16, 서비스 5, 작업 4, 임무 2)
scenarios/defnet-01/attack-chain.json  12단계 침투 시나리오 + 상태 궤적
scenarios/defnet-01/synthetic/         생성 결과 (events 8,012 / labels 12 / states 10)
scripts/New-SyntheticTelemetry.ps1     합성 텔레메트리 생성기
scripts/Invoke-MissionPropagation.ps1  결정론 전파 엔진 (D 계층)
scripts/Show-MissionReplay.ps1         시간축 리플레이 + what-if
scripts/Test-Ontology.ps1              온톨로지 검증기 (음성 테스트 통과)
scripts/Add-Bom.ps1                    PS 5.1 인코딩 사고 방지
```

### 이미 확인된 결과

- **DC01 단독 침해 시 임무 저하 0%**, DC02까지 뚫려야 55.9%. 이중화가 정상 동작하며,
  이것이 임무 좌표계 주장(C1)의 실증이다.
- **ESX01 격리 what-if는 시작부터 70.1% 저하** — 봉쇄가 공격보다 비싸다. ADR-0004의 근거.
- 초기 모델링 오류를 실측으로 발견: 의존을 자산에 직접 걸면 이중화를 우회한다.
  서비스 id로 걸도록 수정했고 검증기가 이 실수를 잡는다.

### 알려진 제약

**합성 데이터로 탐지 성능을 주장하지 않는다.** 악성 비율 0.15%로 실데이터보다 두 자릿수
높다. 용도는 개발·회귀 테스트·구성 타당성 검사까지. 상세는 `docs/07-synthetic-data.md` 6절.

미해결 경고 2건: `FW01`, `SW01`이 어떤 엣지에도 연결되지 않았다. 방화벽·스위치를
의존 그래프에 어떻게 넣을지 미정.

## 2. 문서 현황 — 완료

```
CLAUDE.md                    확정 규칙 10개 + 작업 규칙
README.md
STATE.md                     ← 이 파일
configs/datasets.yaml        경로·URL·라이선스·상태
configs/manifests/           재취득 지시서
scripts/fetch-ait.ps1        AIT 취득 (재실행 안전)
docs/00-architecture.md      계층도 + 3트랙
docs/01-datasets.md          데이터셋 + 함정
docs/02-research-plan.md     기여 C1~C5, 실험 E1~E4, 출처 검증 22항목
docs/03-mission-ontology.md  L2 스키마
docs/04-evaluation.md        평가 프로토콜
docs/05-data-lifecycle.md    수명주기 + ACQUIRE 실전 교훈
docs/06-design-workflow.md   Figma MCP
docs/07-synthetic-data.md    오프라인 합성 트랙 + 인코딩 함정
docs/99-open-questions.md    미확정 6건
docs/adr/0001~0010           결정 기록
scenarios/defnet-01/         임무 온톨로지 + 공격 시나리오 + 합성 데이터
scripts/                     생성기·전파엔진·리플레이·검증기 (1.5절)
```

**개발 환경** (2026-09-06 갱신)

| 도구 | 상태 |
|---|---|
| Python | ✅ **3.12.10** (`%LOCALAPPDATA%\Programs\Python\Python312`), pip 25.0.1, User PATH 등록 |
| Git | ✅ **2.55.0.3** (`C:\Program Files\Git\cmd`), Machine PATH 등록 |
| Node / Java / dotnet | 미설치 |

PowerShell 참조 구현은 그대로 유지한다. 대용량 스캔은 PowerShell 루프로는 불가능해
`Add-Type`으로 C#을 인라인 컴파일해 쓴다 — 10.5억 행을 약 11분에 훑는다
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
   | `auth.txt` 레코드 수 | **1,051,430,459** — 문서값과 차이 0, 파싱 실패 0 |
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

**오프라인에서 가능**
1. **Q1 확정: 국방망 vs 전술망** (`docs/99-open-questions.md`) — 판단만 하면 되는 일이고
   데이터셋 순위와 임무 그래프 구조를 동시에 결정한다. 다른 모든 작업의 선행 조건.
2. 임무 온톨로지 확장 — 시나리오 2번째 추가, FW01/SW01 모델링 결정
3. 전파 함수 3종(max/weighted/noisyor) 비교 실험 → `04-evaluation.md` E2
4. OCSF 매핑 스펙 작성 (합성 events.jsonl을 기준으로)
5. 상황도 UI 와이어프레임

**인터넷 복구 후**
6. Python 설치 → PowerShell 참조 구현을 포팅
7. git 설치 + `git init` + 첫 커밋 (**현재 버전관리 없음 — 디렉터리 지우면 전부 소실**)
8. LANL `auth.txt.gz` 취득 완료 → `.\scripts\Test-GzipIntegrity.ps1`로 검증 후 매니페스트 기록
9. AIT 재개: `.\scripts\fetch-ait.ps1`
10. Figma Education 신청 (아주대 이메일) — 현재 월 20회 한도

`auth.txt.gz`가 들어오면 LANL이 완결되고, `redteam.txt.gz`(그라운드트루스)를 `auth`/`proc`/`flows`와
시간축으로 조인하는 작업이 가능해진다. 이것이 실데이터 트랙(합성 트랙과 대비되는)의 출발점이다.

---

## 4. 재부팅 후 첫 확인 명령

```powershell
# 데이터 상태
Get-ChildItem F:\mc-cycop-data\raw -Recurse -File |
  Select-Object FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}

# AIT 로그 마지막
Get-Content F:\mc-cycop-data\raw\ait-lds-v2\_acquire.log -Tail 20

# Chrome 잔여 다운로드
Get-ChildItem "$env:USERPROFILE\Downloads" -Filter *.crdownload
```
