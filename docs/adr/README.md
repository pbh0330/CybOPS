# 아키텍처 결정 기록 (ADR)

설계 수준의 결정을 여기 남긴다. 대화에만 남기지 않는다.

## 형식

각 ADR은 다음 절을 가진다: **상태 / 맥락 / 결정 / 근거 / 결과 / 대안 / 재검토 조건**.

상태값: `제안` / `채택` / `폐기` / `대체됨(ADR-XXXX에 의해)`

기존 ADR을 수정하지 않는다. 결정이 바뀌면 새 ADR을 쓰고 옛것을 `대체됨`으로 표시한다.
결정의 역사가 남아야 나중에 "왜 그때 그렇게 했나"에 답할 수 있다.

## 목록

| ID | 제목 | 상태 |
|---|---|---|
| [0001](0001-mission-graph-as-coordinate-system.md) | 좌표계는 임무-자산 의존성 그래프 | 채택 |
| [0002](0002-exclude-ip-geolocation-from-decisions.md) | IP 지오로케이션을 판단 로직에서 배제 | 채택 |
| [0003](0003-deterministic-engine-owns-state.md) | 상태 산출은 결정론 계층 전담, LLM은 설명 전담 | 채택 |
| [0004](0004-human-approval-for-response-actions.md) | 대응 실행은 사람 승인 필수 | 채택 |
| [0005](0005-ocsf-as-normalization-schema.md) | 정규화 스키마는 OCSF | 채택 |
| [0006](0006-rag-over-finetuning.md) | 파인튜닝 대신 RAG + 프롬프트 + 평가셋 | 채택 |
| [0007](0007-on-prem-model-adapter.md) | 온프렘 전제 + 모델 어댑터 계층 | 채택 |
| [0008](0008-no-accuracy-metric.md) | 평가에 accuracy 사용 금지 | 채택 |
| [0009](0009-evidence-citation-required.md) | LLM 응답의 근거 스팬 인용 강제 | 채택 |
| [0010](0010-dataset-lifecycle-purge.md) | 데이터셋 원본은 임시 자원, 파생 후 삭제 | 채택 |
| [0011](0011-lanl-labels-have-no-lateral-movement.md) | LANL 라벨로는 측면이동을 평가하지 않는다 | 채택 |
| [0012](0012-target-network-is-tactical.md) | 대상 망은 전술망이다 | 채택 |
| [0013](0013-adopt-mil-std-2525-symbology.md) | MIL-STD-2525 심볼 체계를 준용한다 | 채택 |
| [0014](0014-demo-first-then-paper.md) | 산출물 1순위는 프로토타입 데모 | 채택 |
| [0015](0015-no-human-subject-evaluation.md) | 전문가 평가 없이 계산 가능한 대조로 대체 | 채택 |
| [0016](0016-local-gpu-llm-sizing.md) | LLM은 로컬 GPU에서 4비트 7~14B | 채택 |
| [0017](0017-temporal-mission-graph.md) | 임무 그래프에 시간축을 넣는다 | 채택 |
| [0018](0018-ui-stack-cytoscape-static-bundle.md) | UI는 Cytoscape.js + 정적 번들 | 채택 |
| [0019](0019-adversary-simulation.md) | 적대 행위자 시뮬레이션 - 모델은 합법수만 고른다 | 채택 |
| [0020](0020-hard-and-soft-requirements.md) | hard 요구는 100% 전파한다 | 채택 |
| [0021](0021-hosting-posture-and-model-endpoint.md) | 호스팅 배치와 모델 엔드포인트는 런타임 설정 | 채택 |
| [0022](0022-verification-is-part-of-publishing.md) | 검증을 통과하지 못한 브리핑은 발행하지 않는다 | 채택 |
| [0023](0023-optc-labels-are-process-intervals.md) | OpTC 라벨은 구간이다 - Inria 수정판으로 교체 | 채택 |
| [0024](0024-ui-redesign-and-react.md) | 상황도 UI 개편 - 무채색 크롬, 채널 분리, React 도입 | 채택 |
| [0025](0025-real-terrain-geo-and-console-density.md) | 지리 뷰를 실지형 위에 올린다 - 지도 타일은 CDN 예외, 저채도 바탕 | 채택 |
| [0026](0026-wargame-rules.md) | 교전 규칙 - 턴, 승패, 점수, 격리의 의미, 참모의 권한 | 채택 |
| [0027](0027-sandbox-readiness.md) | 교전장 준비도 - 구조 둘과 엔진의 무공격 기준선 | 채택 |
| [0028](0028-llm-staff.md) | LLM 의 역할은 참모다 - 닫힌 질의 카탈로그, 검증된 인자, 모델 없이도 답 | 채택 |
| [0029](0029-aws-demo-posture.md) | AWS 시연 사본 - 정적 번들, 시연 시간에만 모델, 엔진은 클라이언트에 | 채택 |
| [0030](0030-mobile-compact.md) | 모바일 컴팩트 모드 - 신호 하나, 하단 시트, 폰 기본 뷰는 지도 | 채택 |
| [0031](0031-propagation-input-is-not-a-wargame-seed.md) | 전파 입력은 교전 거점이 아니다 - 시나리오가 따로 선언한다 | 채택 |
| [0032](0032-evaluation-integrity.md) | 평가 무결성 - 남의 실패에서 배운 금지 목록 | 채택 |
| [0031](0031-propagation-input-is-not-a-wargame-seed.md) | 전파 입력은 교전 거점이 아니다 - 시나리오가 교전 거점을 따로 선언한다 | 채택 |

0027 과 0028 은 예약해 두었다가 2026-09-23 에 채웠다. 0027 은 교전장 준비도(당초
"교전장 B - 분석"으로 예약했으나, 준비도 규칙이 먼저 필요해졌다), 0028 은 참모다.
0028 은 **S1 이 구현한 범위까지만** 서술한다 - 라우팅·서술·기권·평가셋은 S2, 교전 흡수는
S3 이고, 그 표가 문서 안에 있다.

0030 은 **아무것도 대체하지 않는다.** ADR-0001(좌표계는 임무 그래프)에 **모바일 한정 예외**
하나를 기록할 뿐이다 - 컴팩트 모드에서 georef 가 있는 시나리오는 지도로 연다. 데스크톱
기본 뷰는 그대로 그래프이므로 ADR-0001 은 그대로 유효하고, 상태를 바꾸지 않는다.

0032 도 **아무것도 대체하지 않는다.** ADR-0008(accuracy 금지)과 ADR-0009(근거 스팬 인용)가
지표 하나씩을 금지한 자리에, **지표를 만드는 절차** 쪽의 금지를 모아 둔 것이다. 기존 ADR 의
본문을 고치지 않는 규칙에 따라, 수치가 낡은 ADR 에는 개정 절을 붙인다 - 0014 와 0019 가
그 예다.
