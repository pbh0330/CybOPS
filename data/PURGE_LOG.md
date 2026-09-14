# 삭제 이력

`docs/05-data-lifecycle.md` [4] PURGE. 삭제는 VERIFY 게이트 통과 후 사람이 확인해 실행한다.

| 일시 | 데이터셋 | 경로 | 파일 | 회수 | 게이트 | 확인자 |
|---|---|---|---|---|---|---|
| 2026-09-14 10:40 | DARPA OpTC eCAR (phase 2~5) | `F:\mc-cycop-data\raw\optc\ecar\` | 125 | 224.3 GB | `scripts/check_ecar_graph.py` PASS (09-14) | pbh0330 (대화에서 "225GB 지우고" 로 지시) |

## 2026-09-14 OpTC eCAR

남긴 것:

- 창 특징 `analysis/optc/ecar-windows-{60,300,900}.v3*.csv` + 요약 (gitignore, 로컬 + E: 백업)
- 그래프 파생물 `ecar-flow-edges-300.csv`, `ecar-proc-tree-300.csv`, `ecar-host-ip.csv` + 요약
  (host-ip 표와 요약은 저장소에, CSV 는 로컬 + E: 백업)
- 백업: `E:\mc-cycop-derived\optc-2026-09-14\` 12 파일 506 MB, SHA256 대조 12/12
- 재취득 정보: `configs/manifests/optc.json` `planned_files` 에 디스크에 있던 125개 전부의
  Drive id·바이트·SHA256. `fetch-optc.ps1` 이 그대로 다시 받는다(약 나흘).
- 지우지 않은 것: `bro/` 7.3 GB, `ecar-bro/` 0.7 GB, 그라운드트루스 PDF, 취득 로그.
- 보험: `E:\연구실_2026_08_31\OpTC.tar.gz` (IEEE 원시 ETW 판, 308 GB. 형식이 다르다.
  docs/19 12.8절)

이 뒤로 OpTC 에서 새 항목을 뽑으려면 재취득이다. 파생물을 원본처럼 쓰지 않는다.

매니페스트 `acquisition_log` 는 삭제 직전 989건이었다(09-11 18:16 이후 도착한 12개 미반영).
삭제 후 `_acquired.jsonl` 에서 12건을 합쳐 1001건으로 맞췄다(`adopted` 필드에 출처 표기).
`Write-OptcManifestLog.ps1 -Check` 는 디스크 대조 스크립트라 **삭제 후에는 ecar 에 대해
FAIL 이 정상**이다. 남은 원본(bro, ecar-bro)만 대조 대상이다.
