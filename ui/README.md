# ui - 상황도 (정적 웹 번들)

스택은 [ADR-0018](../docs/adr/0018-ui-stack-cytoscape-static-bundle.md)에서 확정했다:
**Cytoscape.js + milsymbol + Vite 정적 번들.** 서버가 없어도 열린다.

## 이 화면이 하지 않는 것

**임무 저하도를 계산하지 않는다.** 숫자는 전부 결정론 엔진이 만든 것을 읽어 온다
(ADR-0003). 같은 규칙을 PowerShell과 JS로 두 번 구현하면 반드시 어긋나고, 어긋나는 순간
화면은 아무것의 근거도 되지 못한다. 값이 이상하면 고칠 곳은 엔진이다.

**LLM이 관여하지 않는다.** 현재 화면에 LLM 출력은 없다. 나중에 브리핑 계층이 붙어도
상태 표시와 분리된 영역에 두고, 근거 인용 없는 문장은 "미검증"으로 구분한다(ADR-0009).

**자동 대응 버튼이 없다.** 차단·격리는 사람 승인을 거치는 흐름으로만 그린다(ADR-0004).
현재는 what-if(격리 비용) 표시까지만 계획돼 있다.

## 준비

```powershell
# 1) 데이터 생성 (엔진 실행 결과를 public/data 에 굽는다)
cd F:\F\other_class\CybOPS
.\scripts\Export-ReplayData.ps1                  # tacnet-01 (시간축)
.\scripts\Export-ReplayData.ps1 -Scenario scenarios\defnet-01\mission.json -Timeline ''

# 2) 의존성 설치 (Node.js 필요)
cd ui
npm install
npm run dev        # http://localhost:5180
```

배포용:

```powershell
npm run build      # dist/ 생성. 그대로 웹서버에 올리거나 브라우저로 열면 된다
```

`vite.config.js`의 `base: './'` 때문에 `dist/index.html`을 파일로 직접 열어도 동작한다.
시연 노트북에 폴더만 복사하면 되고 네트워크가 필요 없다(ADR-0012 DIL).

## 화면 구성

| 영역 | 내용 |
|---|---|
| 좌측 캔버스 | 임무 의존 그래프. 좌표계는 의존 위상이고 지도가 아니다(ADR-0001) |
| 상단 토글 | **임무 의존** ↔ **전송로**. 두 의미를 한 화면에 겹치지 않는다 |
| 우측 상단 | 임무 저하도. 막대를 공격/환경/상호작용으로 나눠 그린다 |
| 우측 중단 | 현재 단절 목록과 **원인 라벨**. `unknown`을 공격으로 표기하지 않는다 |
| 하단 | 시간축 스크럽. 재생(Space), 좌우 화살표로 한 스텝씩 |

### 색 규칙

- **붉은색은 공격에만 쓴다.** 기동·지형 단절이 적의 소행처럼 보이면 안 된다(ADR-0012 2항).
- 노드 채우기 = 임무 저하도, 테두리 = 원인.
- **점선 테두리 = 기동·지형·미상으로 단절된 자산**. 공격이 아니다.
- 노드에는 장비 아이콘 하나만 그린다. 2525 식별과 소속 부대는 노드를 선택하면
  우측 패널에 나온다. 겹쳐 그리면 읽는 데 시간이 더 걸린다.

## 데이터 계약

`public/data/<scenario>.replay.json` (생성기: `scripts/Export-ReplayData.ps1`, `contract: 1`)

```
{ scenario_id, method, step, graph, attack,
  steps: [ { t, time_iso, label, note, compromise,
             asset, service, task, mission,
             mission_active, mission_attack, mission_env,
             active_phases, asset_outage, link_outage } ] }
```

`graph`는 시나리오 `mission.json` 원본 그대로다. 필드를 바꾸면 UI가 깨지므로
엔진 `-Json` 출력과 함께 관리한다.

`public/data/symbology-2525.json`은 `configs/symbology-2525.json`의 복사본이며
export 스크립트가 자동으로 옮긴다. 없으면 심볼 없이 도형으로 그린다.
