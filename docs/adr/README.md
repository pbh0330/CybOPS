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
