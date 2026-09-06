# 현재 상태 - 2026-09-06 세션 종료 시점

작업 시작 전 이 파일부터 읽는다.

## 한눈에

| | |
|---|---|
| 데이터 | LANL **5/5 완료·검증**, AIT **1/8 완료(의도된 범위)**, OpTC 그라운드트루스만 |
| 라벨 | 세 데이터셋 모두 확보. OpTC는 PDF→JSONL 구조화 완료(101건, 미분류 0) |
| 결정 | **Q1~Q6 전부 확정**(ADR-0012~0018). 미결 없음 |
| 모델 | **시간축 온톨로지 완료**(ADR-0017) - `scenarios/tacnet-01/`, 원인 분해 동작 |
| UI | **동작함**. `ui/` Vite + Cytoscape 정적 번들, 시간축 리본 + 원인 분해 패널 |
| 다음 | what-if 인터랙션 → LLM 브리핑 계층 → 지리 레이어 → 탐지 실험 E1 |
| 도구 | Figma pro/Full 좌석. Node 24.20.0 **포터블 설치**, Python 3.12, Git 2.55 |

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

기획 문서 완료. **오프라인 트랙 동작 확인 완료 - 인터넷 없이 개발 가능.**
데이터는 **LANL 5/5 완료·검증**, AIT 1/8(의도된 범위), OpTC는 그라운드트루스만.
모델은 **전술망 시간축까지 구현 완료**(ADR-0017).

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

### DARPA OpTC - 그라운드트루스만 확보, 본 데이터 미착수 ★다음 취득 대상

- ✅ `OpTCRedTeamGroundTruth.pdf` + README/ecar.md/errata.md → `F:\mc-cycop-data\raw\optc\`
  (GitHub 저장소에 있어 Google Drive를 거치지 않았다)
- ✅ **라벨 구조화 완료** → `analysis/optc/` (101건 전량 분류)
- ❌ 본 데이터: Google Drive 약 1TB → **30개 호스트 × 3일 최소 세트**만 받는다
  ([09-optc-acquisition.md](docs/09-optc-acquisition.md))
- 선행 조건 두 가지:
  1. Drive 폴더 목록 조회 - `ecar/evaluation/`의 분할 방식과 파일 크기 확인.
     **대역폭을 거의 쓰지 않으므로 먼저 할 것.**
  2. `gdown` 설치 (Python 3.12 준비됨: `pip install gdown`)

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
scenarios/defnet-01/mission.json       임무 온톨로지 (자산 16, 서비스 5, 작업 4, 임무 2)
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
- **ESX01 격리 what-if는 시작부터 70.1% 저하** - 봉쇄가 공격보다 비싸다. ADR-0004의 근거.
- 초기 모델링 오류를 실측으로 발견: 의존을 자산에 직접 걸면 이중화를 우회한다.
  서비스 id로 걸도록 수정했고 검증기가 이 실수를 잡는다.
- **전술망(tacnet-01): 300분 구간에서 공격 단독 0%, 환경 단독 0%, 실제 저하 52.63%.**
  도달 불가능한 이중화는 이중화가 아니다. 시간축을 넣은 실질적 이유이자 데모 장면이다.
- 시간축에서도 같은 종류의 모델링 오류를 실측으로 잡았다 - 관측반 태블릿이 위성 단절을
  우회 중계했고(→ `Asset.transit`), 침해된 중대 단말의 임무 영향이 0이었다
  (→ `task_deg >= impact(performed_at)`). 상세는 `docs/11-tactical-time-axis.md` 3절.

### 알려진 제약

**합성 데이터로 탐지 성능을 주장하지 않는다.** 악성 비율 0.15%로 실데이터보다 두 자릿수
높다. 용도는 개발·회귀 테스트·구성 타당성 검사까지. 상세는 `docs/07-synthetic-data.md` 6절.

미해결 경고 2건: `FW01`, `SW01`이 어떤 엣지에도 연결되지 않았다. 방화벽·스위치를
의존 그래프에 어떻게 넣을지 미정.

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
docs/09-optc-acquisition.md  OpTC 최소 취득 세트 + 라벨 구조화
docs/10-limitations.md       못하는 것 (구조적 / 자원 / 미결)
docs/11-tactical-time-axis.md 전술망 시간축 실측 - 원인 분해, 도달성, 잡은 오류 2건
docs/13-adversary-comparison.md 공격자 3종 비교 실측 - **LLM이 greedy에 0승 6패(0.57배)**
docs/99-open-questions.md    남은 미결 = Q5 하나
docs/adr/0001~0017           결정 기록 (0017 = 시간축 임무 그래프)

scripts/
  fetch-ait.ps1              AIT 취득 (범위 축소됨, $deferred 참조)
  fetch-lanl.ps1             LANL 서명 URL 취득
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
   | 120분 | 지휘소 이동, 공격 없음 | 59.99% | **0%** | 59.99% | 0% |
   | 300분 | 위성 단절(미상) + BN-SRV 장악 | 52.63% | **0%** | **0%** | **52.63%** |
   | 390분 | TOC-SRV 장악, 환경 정상 | 52.63% | 52.63% | 0% | 0% |

   300분이 이 과제의 데모 장면이다 - **어느 원인 하나만으로는 이 저하가 생기지 않는다.**
   도달 불가능한 이중화는 이중화가 아니기 때문이고, 정적 그래프로는 표현 자체가 안 된다.
   `defnet-01` 회귀 확인 완료(DC01 0.0% / DC01+DC02 80.5% / ESX01 격리 70.1%, 전부 동일).

2. **`Asset.type` → SIDC 매핑 테이블** (ADR-0013)
3. **상황도 UI + 시간축 리플레이** - 데모 그 자체
4. **what-if 인터랙션** - 가장 설득력 있는 장면. 숫자는 이미 있다(ESX01 격리 = 70.1% 저하)
5. **LLM 브리핑 계층** - Ollama 등 설치 후 7~8B 4비트부터
6. 탐지 실험 E1 - 논문 자산. 화면에는 거의 안 보인다

**병행 가능 (대역폭만 씀)**
- OpTC Drive 폴더 목록 조회 → 최소 세트 실제 용량 확정 (`09-optc-acquisition.md`)
- `pip install gdown` 후 30개 호스트 × 3일 취득

**남은 자잘한 것**
- `FW01`/`SW01`이 어떤 엣지에도 연결되지 않았다 - 검증기 경고 2건 미해결
- 전파 함수 3종(max/weighted/noisyor) 비교 → E2 (`noisyor`가 99.9%로 과하게 나온다)
- OCSF 매핑 스펙 - AIT `labels/` 트리 형식 확인 후 착수

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
