# DARPA OpTC 최소 취득 세트

작성: 2026-09-06 · 원자료 `analysis/optc/redteam-groundtruth.json`
· 그라운드트루스 원본 `F:\mc-cycop-data\raw\optc\OpTCRedTeamGroundTruth.pdf`

## 왜 필요한가

ADR-0011에서 **E1-b(공격 진행 연쇄·전파 예측)를 통째로 OpTC에 맡겼다.** LANL 라벨에
측면이동이 없다는 실측 결과 때문이다(`08-lanl-ground-truth.md`). OpTC가 없으면 그 실험은
수행하지 않는다 — 합성 데이터로 대체하지 않는다(`CLAUDE.md` 규칙 11). 즉 지금 상태로
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
| `ecar/evaluation/` | **받는다 (30개 호스트분)** | 레드팀 구간 엔드포인트 텔레메트리. 핵심 |
| `ecar-bro/evaluation/` | **받는다 (30개 호스트분)** | FLOW-START에 bro-id가 붙어 있어 호스트↔네트워크 피벗이 가능 |
| `bro/` (09/23~25) | **받는다** | 해당 3일치 네트워크 센서 |
| `ecar/benign/` | **보류** | 음성 표본용. 필요량이 정해진 뒤 일부만 |
| `ecar/short/` | **받지 않는다** | 결측 이벤트 |
| `ecar-bro/short/`, `ecar-bro/benign/` | 보류 | 위와 동일 |

전량 약 1TB를 받는 것은 **불가능하다.** 회선 실측이 약 0.6~1.0 MB/s라 1TB면 12~19일이고,
F: 여유가 909GB라 AIT 130GB와 함께면 애초에 들어가지 않는다. 부분 취득은 선택이 아니라
전제 조건이며, `05-data-lifecycle.md`의 수명주기 정책과도 일치한다.

## 아직 확정하지 못한 것

- **실제 용량.** `ecar/evaluation/`의 파일 단위 분할 방식(호스트별인지 일자별인지)과
  개별 파일 크기를 Drive 목록으로 확인해야 한다. 30/500 호스트라면 산술적으로는
  평가 구간의 6% 수준이지만, 파일이 호스트 단위로 쪼개져 있지 않으면 이 계산이 무너진다.
  **목록 조회는 대역폭을 거의 쓰지 않으므로 AIT와 병행 가능하다.**
- **취득 도구.** Drive 대용량 다운로드는 `gdown` 등이 필요하다. Python 3.12는 설치했다.

## 데이터 형식 메모

eCAR은 MITRE CAR을 확장한 이벤트 모델이다. `object`-`action`-`properties` 3튜플에
`hostname` / `principal` / `pid` / `actorID` 메타데이터가 붙는다. OCSF 정규화(ADR-0005)
시 `object`+`action`을 OCSF class로, `properties`를 확장 속성으로 매핑하는 것이 자연스럽다.

`errata.md`에 기록된 알려진 결함 4건은 파이프라인 설계 시 반영해야 한다.

- 프로세스 객체 중복 — 여러 소스가 정리되지 않았고 상관된 객체 하나만 유효
- 모듈 로드(DLL)에 실행 파일 해시 누락
- FLOW OPEN 이벤트의 `acuity_level`이 0 (1~5 기대)
- 경로 표기가 `C:` 와 `/device/HardDisk0/` 사이에서 혼용

## 정정 사항

`01-datasets.md`에 "Windows 호스트 1,000대 규모"라고 적어뒀는데 **틀렸다.** README 원문:

> "Due to constraints in collection data space during the evaluation, data from five hundred
> hosts was collected rather than from the full set of one-thousand hosts."

시스템은 1,000대로 확장했으나 **실제 수집된 데이터는 500대분**이다. 규모를 인용할 때
1,000을 쓰면 안 된다.
