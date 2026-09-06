# MC-CyCOP

임무중심 사이버 공동상황도(Mission-Centric Cyber Common Operational Picture).
LLM을 결합한 국방 사이버 통합운영 관제 상황도의 연구·프로토타입 저장소.

핵심 전제 한 줄: **지도의 좌표계는 위도·경도가 아니라 임무-자산 의존성 그래프다.**

## 현재 상태

기획·설계 문서 완료. **오프라인 합성 트랙 동작** - 네트워크 없이 아래가 전부 돌아간다.

```powershell
.\scripts\Test-Ontology.ps1                            # 온톨로지 검증
.\scripts\New-SyntheticTelemetry.ps1                   # 합성 OCSF 이벤트 생성
.\scripts\Show-MissionReplay.ps1                       # 시간축 상황도 리플레이
.\scripts\Show-MissionReplay.ps1 -WhatIfIsolate ESX01  # 봉쇄 비용 what-if
```

진행 상황과 다음 할 일은 [STATE.md](STATE.md)에 있다.

## 문서

| 문서 | 내용 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 세션 상시 지시문. 확정 규칙 요약 |
| [docs/00-architecture.md](docs/00-architecture.md) | 계층 아키텍처, 3트랙 구성 |
| [docs/01-datasets.md](docs/01-datasets.md) | 공개 데이터셋 목록과 함정 |
| [docs/02-research-plan.md](docs/02-research-plan.md) | 논문/과제 계획서 |
| [docs/03-mission-ontology.md](docs/03-mission-ontology.md) | 임무-자산 온톨로지 스키마 |
| [docs/04-evaluation.md](docs/04-evaluation.md) | 평가 프로토콜 |
| [docs/05-data-lifecycle.md](docs/05-data-lifecycle.md) | 데이터셋 취득·파생·삭제 절차 |
| [docs/06-design-workflow.md](docs/06-design-workflow.md) | Figma MCP 사용 규칙 |
| [docs/07-synthetic-data.md](docs/07-synthetic-data.md) | 오프라인 합성 트랙, 한계, 인코딩 함정 |
| [docs/99-open-questions.md](docs/99-open-questions.md) | 미확정 사항 |
| [docs/adr/](docs/adr/) | 아키텍처 결정 기록 |

## 다음 단계

1. git 설치 후 `git init`
2. `docs/99-open-questions.md`의 3개 갈림길 확정 (대상 망, 심볼 체계, 산출물 성격)
3. `docs/02-research-plan.md`의 출처 검증 체크리스트 소진
4. 트랙 A 착수: OCSF 정규화 파이프라인 스켈레톤 + OpTC 1일치 샘플 리플레이
