# DARPA OpTC 최소 취득 세트

작성: 2026-09-06 · 원자료 `analysis/optc/redteam-groundtruth.json`
· 그라운드트루스 원본 `F:\mc-cycop-data\raw\optc\OpTCRedTeamGroundTruth.pdf`

## 왜 필요한가

ADR-0011에서 **E1-b(공격 진행 연쇄·전파 예측)를 통째로 OpTC에 맡겼다.** LANL 라벨에
측면이동이 없다는 실측 결과 때문이다(`08-lanl-ground-truth.md`). OpTC가 없으면 그 실험은
수행하지 않는다 - 합성 데이터로 대체하지 않는다(`CLAUDE.md` 규칙 11). 즉 지금 상태로
굳으면 기여 항목 하나가 통째로 빠진다.

그라운드트루스 PDF를 받아 확인한 결과, **OpTC에는 LANL에 없던 피벗 연쇄가 명시적으로
기록되어 있다.**

```
Day 1: Sysclient0201 → Sysclient0402 → Sysclient0660 → DC1 → 14개 스테이션
```

Day 1 로그 원문: "Pivoted to Sysclient0402 with WMI ... Pivoted to Sysclient0660 via WMI
... Used WMI to pivot to DC1 ... On DC1, ran Mimikatz. Obtained user hashes with lsadump.
Pivoted to 14 stations."

이것이 임무 그래프의 전파 주장을 검증할 수 있는 형태다. LANL은 출발지 4개와 목적지
301개의 교집합이 0이라 이런 연쇄가 아예 없었다.

## 취득 대상: 30개 호스트 × 3일

레드팀 활동 일자는 **2019-09-23, 09-24, 09-25** 사흘이다.

| 일자 | 시나리오 | 호스트 |
|---|---|---|
| Day 1 (09/23) | Plain PowerShell Empire | **18** |
| Day 2 (09/24) | Custom PowerShell Empire | **11** |
| Day 3 (09/25) | Malicious Upgrade | **2** |
| **합집합** | | **30** |

```
DC1
SysClient0005  SysClient0010  SysClient0051  SysClient0069  SysClient0104
SysClient0170  SysClient0201  SysClient0203  SysClient0205  SysClient0255
SysClient0321  SysClient0351  SysClient0355  SysClient0358  SysClient0402
SysClient0419  SysClient0462  SysClient0501  SysClient0503  SysClient0559
SysClient0609  SysClient0618  SysClient0660  SysClient0771  SysClient0811
SysClient0851  SysClient0874  SysClient0955  SysClient0974
```

Day 1의 진입점은 `SysClient0201`(수동 접속 → PowerShell Empire stager 다운로드),
경유는 `0402` → `0660` → `DC1`이고, `DC1`에서 lsadump로 해시를 얻은 뒤 14개 스테이션으로
확산한다. Day 3은 호스트 2개뿐이라 규모가 작다.

## 무엇을 받는가

Google Drive: `https://drive.google.com/drive/u/0/folders/1n3kkS3KR31KUegn42yk3-e6JkZvf0Caa`

| 폴더 | 받는가 | 이유 |
|---|---|---|
| `ecar/evaluation/` | **받는다 (해당 번들만)** | 레드팀 구간 엔드포인트 텔레메트리. 핵심 |
| `ecar-bro/evaluation/` | **전량 받는다 (0.61GB)** | FLOW-START에 bro-id가 붙어 있어 호스트↔네트워크 피벗이 가능 |
| `bro/` (09/23~25) | **받는다 (7.21GB)** | 해당 3일치 네트워크 센서 |
| `ecar/benign/` | **보류** | 음성 표본용. 필요량이 정해진 뒤 일부만 |
| `ecar/short/` | **받지 않는다** | 결측 이벤트 |
| `ecar-bro/short/`, `ecar-bro/benign/` | 보류 | 위와 동일 |

전량 약 1TB를 받는 것은 **불가능하다.** 회선 실측이 약 0.6~1.0 MB/s라 1TB면 12~19일이고,
F: 여유가 906GB라 AIT 130GB와 함께면 애초에 들어가지 않는다. 부분 취득은 선택이 아니라
전제 조건이며, `05-data-lifecycle.md`의 수명주기 정책과도 일치한다.

## 실측 (2026-09-06) - 추정치를 폐기한다

Drive 폴더를 로그인 없이 전부 열거하고 파일별 정확한 바이트 수를 측정했다.
방법은 두 단계이고 **대역폭을 사실상 쓰지 않는다.**

1. `drive.google.com/embeddedfolderview?id=<폴더ID>` - 공개 폴더의 평문 HTML 목록.
   폴더당 수 KB. 파일 ID와 이름은 나오지만 **크기는 안 나온다.**
2. `drive.usercontent.google.com/download?id=<파일ID>&export=download` 에
   `Range: bytes=0-0`. 작은 파일은 206과 함께 `Content-Range: bytes 0-0/<총길이>`를,
   100MB 넘는 파일은 바이러스 검사 경고 HTML(약 2.4KB)을 준다. 후자는 `confirm=t`를
   붙여 한 번 더 물으면 역시 206이 온다. **파일당 1바이트.**

전체 목록 1,001개 파일을 이 방식으로 재는 데 실제로 받은 양은 수 MB다.

### 치명적인 발견: eCAR은 호스트 단위가 아니다

이전 문서는 "30/500 호스트라면 산술적으로 6%"라고 적었다. **틀렸다.**

```
ecar/evaluation/<일자>/AIA-<N>-<M>/AIA-<N>-<M>.ecar-last.json.gz
```

파일은 **25대씩 묶인 `AIA-N-M` 번들 단위**다. 번들은 1-25, 51-75, 101-125 …
951-975의 20개이고(홀수 50블록만 - 이것이 "500대분"의 실체다), 레드팀 호스트 29대는
이 중 **18개 번들에 흩어져 있다.** 즉 6%가 아니라 **90%**다.

| 번들 | 레드팀 호스트 | | 번들 | 레드팀 호스트 |
|---|---|---|---|---|
| AIA-1-25 | 0005, 0010 | | AIA-451-475 | 0462 |
| AIA-51-75 | 0051, 0069 | | AIA-501-525 | 0501, 0503 |
| AIA-101-125 | 0104 | | AIA-551-575 | 0559 |
| AIA-151-175 | 0170 | | AIA-601-625 | 0609, 0618 |
| AIA-201-225 | 0201, 0203, 0205 | | AIA-651-675 | 0660 |
| AIA-251-275 | 0255 | | AIA-751-775 | 0771 |
| AIA-301-325 | 0321 | | AIA-801-825 | 0811 |
| AIA-351-375 | 0351, 0355, 0358 | | AIA-851-875 | 0851, 0874 |
| AIA-401-425 | 0402, 0419 | | AIA-951-975 | 0955, 0974 |

빠지는 것은 `AIA-701-725`와 `AIA-901-925` 둘뿐이다. **호스트를 좁혀도 용량은 거의
줄지 않는다.** 진짜로 줄이는 축은 호스트가 아니라 **일자**다.

### 두 번째 함정: `ecar-last`만 받으면 데이터가 빠진다

번들 폴더에는 `AIA-N-M.ecar-last.json.gz` 외에
`AIA-N-M.ecar-2019-12-08T01-48-29.200.json.gz` 같은 타임스탬프 파일이 같이 있다.
중복처럼 보이지만 **같은 내보내기를 쪼갠 조각**이다. 근거: 분할 수와 무관하게
폴더별 합계가 일정하다(`23Sep-Night`의 열 개 번들이 전부 3.6~4.0GB).
`-last`만 받으면 224GB가 140GB로 줄지만 그만큼이 그냥 없어진다.

### 실측 총량

| 단계 | 대상 | 파일 | 용량 |
|---|---|---|---|
| 1 | `ecar-bro/evaluation/` 전량 | 80 | **0.61 GB** |
| 2 | `ecar/evaluation/23Sep19-red/` 18개 번들 | 25 | **33.48 GB** |
| 3 | `ecar/evaluation/25Sept/` 18개 번들 | 26 | **26.36 GB** |
| 4 | `ecar/evaluation/24Sep19/` 18개 번들 | 42 | **95.54 GB** |
| 5 | `ecar/evaluation/23Sep-Night`+`23Sep-night` 18개 번들 | 32 | **68.90 GB** |
| 6 | `bro/2019-09-23…25/` | 796 | **7.21 GB** |
| | **합계** | **1,001** | **232.10 GB** |

참고로 `ecar/evaluation/` 전량은 139개 파일 249.61GB다. 즉 호스트 선별로 절약되는 양은
17.5GB뿐이다. 0.6~1.0 MB/s 실측 회선에서 232GB는 **66~110시간**이다.

단계 순서는 "작고 결정적인 것부터"다. 1은 호스트↔네트워크 피벗 키라서 0.61GB로
가장 싸고, 2는 `0201 → 0402 → 0660 → DC1` 연쇄가 들어 있는 구간이다.
**2단계 33.5GB만 받아도 이 문서가 주장하는 장면 하나는 성립한다.**

### 실행

계획은 `configs/manifests/optc.json`에 파일 ID·바이트 수까지 들어 있고,
스크립트는 그것을 실행만 한다.

```powershell
.\scripts\fetch-optc.ps1 -List             # 계획만 출력, 아무것도 받지 않음
.\scripts\fetch-optc.ps1 -Phase 1,2 -Confirm   # 실제 취득 (-Confirm 없이는 시작 안 함)
```

`gdown`(6.2.0)은 설치해 뒀으나 **결국 필요 없었다.**
`drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t`가
Range 요청에 206으로 답하므로 `curl -C -` 이어받기가 그대로 된다. LANL·AIT에서 얻은
취득 규칙(단일 연결, `--retry` 금지, 축소 감지)을 그대로 쓸 수 있다는 뜻이다.

### 저장할 때 주의 두 가지

- **bro 파일명에 콜론이 있다** (`communication.00:00:00-01:00:00.log.gz`).
  NTFS는 `:`를 대체 데이터 스트림 구분자로 읽으므로 그 이름으로는 파일을 못 만든다.
  `-`로 바꿔 저장하고 원래 경로는 매니페스트 `drive_path`에 남긴다.
- **`23Sep-Night`와 `23Sep-night`는 다른 폴더다.** 같은 밤 구간을 호스트 범위로 나눈
  것이고(Night = AIA-1-25…451-475, night = AIA-501-525…951-975), Windows 경로는
  대소문자를 구분하지 않아 어차피 한 디렉터리가 된다. AIA 범위가 겹치지 않아 충돌은
  없지만, 사고가 아니라 의도로 합친다는 것을 매니페스트에 명시했다.

## 라벨: PDF를 기계가 읽을 수 있게 바꿨다

세 데이터셋 중 **OpTC만 그라운드트루스가 산문**이다. LANL은 `redteam.txt.gz`가, AIT는
`labels/` 트리가 라벨이지만 OpTC는 영어 7페이지다. 문단을 상대로는 아무것도 평가할 수
없으므로 먼저 구조화했다.

```powershell
python scripts\build_optc_labels.py
```

| 산출물 | 내용 |
|---|---|
| `analysis/optc/redteam-events.jsonl` | 레드팀 로그 1줄 = 1행. 시각·호스트·에이전트·행위 태그·ATT&CK 후보 |
| `analysis/optc/redteam-labels.json` | 호스트/에이전트 목록, 피벗 체인, 일자별 요약 |

**101건 전부 분류됐다(미분류 0).** 추출된 호스트 30개는 앞 절의 독립 추출과 정확히
일치해 교차 검증이 됐다.

| 행위 태그 | 건수 | | 행위 태그 | 건수 |
|---|---|---|---|---|
| lateral_movement | 33 | | defense_evasion | 11 |
| c2 | 22 | | credential_access | 11 |
| execution | 17 | | exfiltration | 10 |
| privilege_escalation | 16 | | initial_access | 9 |
| discovery_host | 14 | | discovery_network | 9 |
| process_injection | 8 | | persistence | 7 |
| collection | 7 | | discovery_account | 4 |

초기 침해부터 흔적 삭제까지 킬체인 전 구간이 덮인다. LANL이 자격증명 오남용 한 종류만
갖는 것과 대비된다.

### 만드는 과정에서 겪은 것 두 가지

1. **PDF 줄바꿈을 무시해 텍스트 절반을 잃었다.** 타임스탬프로 시작하는 줄만 취하고
   이어지는 줄을 버렸더니 53%가 미분류로 나왔다. 이어붙이기를 넣자 10%로 떨어졌다.
   *분류기가 나쁜 게 아니라 입력이 잘린 것이었다.*
2. **Day 3은 도구가 다르다.** Day 1·2는 PowerShell Empire, **Day 3은 Meterpreter**다.
   Empire 기준으로 만든 규칙이 Day 3에서 전부 빗나갔다. Meterpreter 규칙
   (getsystem, named pipe impersonation, enum_shares, timestomp 등)을 추가해 0%가 됐다.
   시나리오가 같다고 가정하면 하루치가 통째로 라벨 없이 남는다.

### 이 라벨의 한계 - 반드시 읽을 것

**이것은 레드팀 운용자의 행위 기록이지 텔레메트리 이벤트 라벨이 아니다.**

eCAR 레코드에 붙이려면 `(hostname, 시간 창, actor pid)`로 매칭해야 하고, 그 결과는
근사치다. 그라운드트루스는 운용자 행위 1건당 1줄이지만 엔드포인트 센서는 그 1건에 대해
수십~수백 이벤트를 낸다. **라벨된 이벤트가 아니라 라벨된 구간(window)으로 다뤄야 한다.**

ATT&CK 매핑은 키워드 휴리스틱이다. 보고 전에 검토해야 하며 그대로 인용하면 안 된다.

## 아직 확정하지 못한 것

- **DC1의 eCAR 데이터가 어디 있는지 모른다.** 번들 이름은 `SysClientNNNN` 번호 기준이라
  `DC1`은 이름만으로 추론이 안 된다. 2단계를 받은 뒤 `hostname` 필드를 실제로 훑어
  확인해야 한다. 없으면 Day 1 피벗 체인의 마지막 구간(DC1에서 Mimikatz/lsadump)은
  네트워크 측(bro)으로만 관측된다 - **E1-b 주장의 강도가 달라지는 지점이므로 먼저 확인할 것.**
- **`bro/2019-09-25-day.tgz`(81MB)와 `bro/2019-09-25/`(1.72GB, 218개 파일)의 관계.**
  묶음본인지 다른 내용인지 모른다. 81MB뿐이라 6단계에 같이 넣어 두고 받은 뒤 비교한다.
- **`ecar/benign/` 필요량.** 음성 표본을 얼마나 쓸지 정해진 뒤에 일부만 받는다.
  현재 계획 232.10GB에는 들어 있지 않다.

해소된 것: 실제 용량(위 실측 절), 취득 도구(`curl` + Drive `confirm=t`로 충분).

## 데이터 형식 메모

eCAR은 MITRE CAR을 확장한 이벤트 모델이다. `object`-`action`-`properties` 3튜플에
`hostname` / `principal` / `pid` / `actorID` 메타데이터가 붙는다. OCSF 정규화(ADR-0005)
시 `object`+`action`을 OCSF class로, `properties`를 확장 속성으로 매핑하는 것이 자연스럽다.

`errata.md`에 기록된 알려진 결함 4건은 파이프라인 설계 시 반영해야 한다.

- 프로세스 객체 중복 - 여러 소스가 정리되지 않았고 상관된 객체 하나만 유효
- 모듈 로드(DLL)에 실행 파일 해시 누락
- FLOW OPEN 이벤트의 `acuity_level`이 0 (1~5 기대)
- 경로 표기가 `C:` 와 `/device/HardDisk0/` 사이에서 혼용

## 정정 사항

`01-datasets.md`에 "Windows 호스트 1,000대 규모"라고 적어뒀는데 **틀렸다.** README 원문:

> "Due to constraints in collection data space during the evaluation, data from five hundred
> hosts was collected rather than from the full set of one-thousand hosts."

시스템은 1,000대로 확장했으나 **실제 수집된 데이터는 500대분**이다. 규모를 인용할 때
1,000을 쓰면 안 된다.

## 취득 결과 (2026-09-07) - 그리고 크기 검사가 놓친 것

Phase 1, 2, 6 을 받았다. **900개 `.gz` + 문서, 41.3 GB.** 로그 마지막 줄은
`=== fetch-optc end: 0 file(s) incomplete ===` 였다.

**그 줄이 틀렸다.** `Test-GzipIntegrity.ps1` 로 900개를 전부 해제해 보니 **6개가
gzip 이 아니었다.** 매직 넘버가 `1F 8B` 가 아니라 `<html lang="en"` 이었고, 내용은
Google Drive 의 **HTTP 503 에러 페이지**였다.

| 파일 | 크기 |
|---|---|
| `bro/2019-09-23/communication.04-00-00-05-00-00.log.gz` | 120,718 B |
| `bro/2019-09-24/communication.14-00-00-15-00-00.log.gz` | 119,500 B |
| `bro/2019-09-24/conn.02-00-00-03-00-00.log.gz` | 48,254,431 B |
| `bro/2019-09-24/dns.13-00-00-14-00-00.log.gz` | 253,811 B |
| `bro/2019-09-24/http.03-00-00-04-00-00.log.gz` | 14,481,843 B |
| `bro/2019-09-25/smtp.16-00-00-17-00-00.log.gz` | 18,893 B |

### 왜 크기 검사를 통과했는가

`fetch-optc.ps1` 의 성공 조건은 `최종 크기 == 매니페스트의 기대 크기` 였다. 여섯 개
전부 그 조건을 **정확히** 만족했다. 우연이 아니라 구조적으로 그렇게 된다.

1. `curl -sS -L -C - -o <target>` 로 첫 시도. Drive 가 과부하로 **503** 을 돌려주고,
   `--fail` 이 없으므로 curl 은 **에러 본문(HTML 약 1.6 KB)을 target 에 쓴다.**
2. 다음 시도에서 `-C -` 가 그 파일 크기부터 이어받는다. `Range: bytes=1600-`.
3. Drive 는 이번엔 정상 응답하고 **진짜 파일을 1600 바이트 지점부터** 보낸다.
4. 최종 파일 = `[503 HTML 1600 B][진짜 gzip 의 1600 바이트 이후]`.
   길이는 `1600 + (기대크기 - 1600)` = **기대크기와 정확히 같다.**

크기가 같고, 로그는 DONE 이고, SHA256 도 기록된다. 그 해시는 **쓰레기의 해시**다.
Drive 는 체크섬을 주지 않으므로 대조할 상대도 없다.

48 MB 짜리가 섞여 있는 것이 이 함정의 성격을 잘 보여준다. "에러 페이지면 작겠지"
라는 직관이 통하지 않는다. 앞 1.6 KB 만 에러 페이지이고 나머지 48 MB 는 진짜 데이터다.

### 고친 것

`scripts/fetch-optc.ps1`:

1. **`--fail` 추가.** HTTP 400 이상이면 curl 이 본문을 파일에 쓰지 않는다. 애초에
   나쁜 접두사가 생기지 않는다.
2. **매직 넘버 검사.** 크기가 맞아도 `.gz` 의 첫 두 바이트가 `1F 8B` 가 아니면
   `DONE` 이 아니라 `BAD` 로 기록하고 **그 파일을 지운다.** 남겨두면 다음 실행이
   그 위에 이어받아서 나쁜 접두사가 영원히 남는다.
3. **`-Only <rel_path>...`** 추가. 전체 계획을 다시 돌지 않고 특정 파일만 다시 받는다.

`scripts/Test-GzipIntegrity.ps1`:

4. **`-Recurse` 추가.** LANL cyber1 은 평평한 디렉터리 8개라 없어도 돌았다. OpTC 는
   트리라 900개 위에 앉아서 `No .gz files under` 로 죽었다. 에러 메시지는 이미
   `under` 라고 말하고 있었다.

### 남길 교훈

**바이트 수가 일치한다는 것은 파일이 맞다는 뜻이 아니다.** 이어받기를 쓰는 다운로더는
특히 그렇다 - 이어받기는 이미 있는 접두사를 **검증 없이 신뢰**하는 것이 정의다.
길이 검사와 내용 검사는 다른 검사이고, 둘 다 있어야 한다.

`docs/05-data-lifecycle.md` 의 VERIFY 게이트에 이 항목이 이미 있었다("크기만 믿지
않는다"). 이번에는 그 게이트를 통과시키는 스크립트 자체가 크기만 보고 있었다.

### 최종 상태 (2026-09-07 16:02)

수리 후 전수 재검증했다.

```
Test-GzipIntegrity.ps1 -Path F:\mc-cycop-data\raw\optc -NoHash -ExpectedLastTimestamp 0
  900 files, gzip OK 900, FAILED 0
  All files passed gzip integrity check.

Write-OptcManifestLog.ps1
  _acquired.jsonl        907 line(s)
  distinct rel_path      901   (superseded by re-fetch: 6)
  present on disk        901
  missing from disk        0
  size mismatch            0
  records without sha256   0
  bytes accounted for  41.30 GB
  RESULT: PASS
```

`configs/manifests/optc.json` 의 `acquisition_log` 에 901건이 들어갔고 `status` 는
`acquired (phases 1,2,6)` 다. 파일별 Drive id, 바이트 수, SHA256, phase, 취득 시각이
전부 있다. **원본을 지워도 이것으로 재취득하고 대조할 수 있다**(ADR-0010).

두 가지 기록:

- **`_acquired.jsonl` 은 append-only 라 907줄이고 rel_path 는 901개다.** 재취득한 6개가
  두 번씩 들어 있고, 옛 레코드의 SHA256 은 HTML 섞인 파일의 해시다.
  `Write-OptcManifestLog.ps1` 이 rel_path 별 최신 레코드만 남긴다.
- **900개 중 6개는 gzip 으로는 정상인데 해제하면 0 바이트다.** 그 시간대에 트래픽이
  없었던 bro 캡처 창이고 손상이 아니다. 매니페스트에 `files_empty: 6` 으로 따로
  적는다 - 파일 수를 데이터 수로 착각하지 않으려고 세는 것이다.
- 사고 당시 로그는 `_gzipcheck-2026-09-07-incident.log` 로 남겼다.

## DC1 의 eCAR 은 없다 (2026-09-07) - 미결 1건 해소

`configs/manifests/optc.json` 의 `open_questions` 첫 항목이었고, STATE.md 가 "2단계 취득
후 가장 먼저 확인할 것" 으로 적어둔 항목이다.

### 방법

`scripts/Measure-OptcHosts.ps1`. eCAR 레코드는 한 줄에 JSON 객체 하나이고 `hostname`
필드를 갖는다. JSON 을 파싱하지 않고 `"hostname":"` 리터럴을 바이트로 훑는다 - 해제하면
380 GB 이고, 파싱하면 이 작업이 하루가 된다. `Measure-AuthJoin.ps1` 이 인라인 C# 스캐너를
쓰는 것과 같은 이유다.

### 결과

```
파일 25개, 해제 380 GB, 3,299 초
  distinct hosts   : 450
  SysClient hosts  : 450
  non-SysClient    : 0
```

**비-SysClient 호스트가 한 건도 없다.** 번들 18개가 각각 정확히 25개 호스트를 담고 있고,
그 25개가 번들 이름의 번호 구간(`AIA-N-M`)과 정확히 일치한다. 즉 eCAR 번들링은 SysClient
번호로만 이루어지며 DC1 이 끼어들 자리가 없다.

### 그런데 DC1 은 실재한다

bro DNS 로그에서 찾았다.

```
dc1.systemia.com     DNS 참조 64줄 (09-23 23, 09-24 24, 09-25 17)
연관 IP              142.20.61.130, 109.172.36.2
```

정리하면 **DC1 은 환경에 있고 네트워크 센서에는 보이지만 엔드포인트 센서 데이터가
없다.**

### E1 에 미치는 영향

Day 1 피벗 체인의 마지막 구간(DC1 lsadump)은 **엔드포인트 탐지의 평가 대상이 될 수 없다.**
`docs/04-evaluation.md` 의 E1-b 는 이 구간을 빼고 정의하거나, 네트워크 측 관측만으로
정의해야 한다. 관측이 없는 구간에 대한 재현율은 모델의 성질이 아니라 데이터의 성질이다.

DNS 64줄은 많지 않다. E1-b 를 네트워크 측으로 정의한다면 `conn` 로그에서 위 두 IP 로
가는 흐름을 먼저 세어 관측량을 확인해야 한다. 그 측정은 E1 설계 시점에 한다.

### 남는 불확실성 - 정확히 이만큼이다

받은 것은 레드팀 호스트를 담은 18개 번들이고, `AIA-701-725` 와 `AIA-901-925` 2개는
레드팀 호스트가 없어 계획에서 제외했다(위 "실측 총량" 절). 그 2개는 스캔하지 않았다.

따라서 정확한 진술은 **"수집된 500대 중 450대에 DC1 이 없다"** 이지 "OpTC 에 DC1 eCAR 이
존재하지 않는다" 가 아니다. 다만 18개 번들 전부가 예외 없이 자기 번호 구간의 SysClient
25대만 담고 있었으므로, 남은 2개가 규칙을 깨고 DC1 을 담고 있을 가능성은 낮다.

확정이 필요하면 그 2개를 받아 같은 스캐너를 돌린다(`fetch-optc.ps1 -Only ...`).
**지금은 확정하지 않고 위 진술의 범위를 그대로 적어둔다.**
