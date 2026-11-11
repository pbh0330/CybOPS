# AI 기반 SOC 센터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상황도와 나란히 서는 두 번째 최상위 화면을 만든다. 시계가 흘러가고 경보가 쌓이는 실시간 관제 콘솔이고, 경보 출처는 시나리오 리플레이·합성 잡음·AWS 운영 셋이다.

**Architecture:** 순수 모듈 셋(`clock.js`, `alerts.js`, `triage.js`)이 React 바깥에서 돌고, 엔진(`engine.js`)은 한 줄도 건드리지 않는다. 화면은 좌측 내비를 가진 셸이고 여섯 화면을 담는다. LLM 은 기존 참모 파이프라인을 재사용하며 provider 만 어댑터로 가른다.

**Tech Stack:** React 18, Vite 5, vitest 3, Cytoscape 3.30, maplibre-gl 5. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-10-ai-soc-center-design.md`

## Global Constraints

스펙에서 그대로 옮긴다. 모든 태스크의 요구사항에 묵시적으로 포함된다.

- **엔진을 고치지 않는다.** `ui/src/engine.js` 의 `runChain`, `serviceDegFor`, `reach` 는 수정 금지. `node ui/tools/parity.mjs` 가 **1622 값 / 0 불일치**를 유지해야 한다.
- **격리·차단을 실행하는 코드 경로를 만들지 않는다** (ADR-0004). 이관은 건의이고 기록일 뿐이다.
- **LLM 출력이 상태값을 정하는 경로를 만들지 않는다** (ADR-0003). 숫자는 전부 엔진이 낸다.
- **모든 LLM 문장은 `[F#]` 근거를 인용한다** (ADR-0009).
- **지오로케이션은 어떤 판단에도 들어가지 않는다** (ADR-0002). 국가 코드는 보관만, 집계 위젯에도 쓰지 않는다.
- **크롬은 무채색이다** (ADR-0024). 채도를 쓰는 것은 여덟 원인색뿐. **빨강은 적대 행위 효과 전용** (ADR-0012) 이므로 심각도는 **P1 만 빨강**, P2~P4 는 무채색 농도.
- **워터마크는 끌 수 없다** (ADR-0025). 합성 경보 고지도 같은 성질이다.
- **이모지를 쓰지 않는다.** 코드, 주석, UI 문자열, 커밋 메시지 전부.
- **em 대시(`—`)를 쓰지 않는다.** 하이픈이나 쉼표를 쓴다.
- **서버측 상태를 두지 않는다** (ADR-0029 4항). 분류 상태와 감사 로그는 메모리 + `localStorage`.
- **합성 데이터로 탐지 성능을 주장하지 않는다** (`docs/07-synthetic-data.md` 6절).
- PowerShell 5.1: `&&` 금지(`;` 또는 `if ($?)`), 한글 들어간 `.ps1` 은 BOM 필요(`scripts\Add-Bom.ps1`), **변수 이름 대소문자 충돌 금지**(`scripts\Test-CaseCollisions.ps1`).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

스펙이 함의하지만 어느 태스크의 시험도 건드리지 않는 입력들이다. 각 줄의 시험을 해당 태스크 안에 넣어 뒀다.

1. **리플레이에 `gt` 가 비었거나 `compromise` 키가 그래프에 없는 자산을 가리키는 step.** 경보 생성이 던지지 않고 그 step 을 건너뛰거나 기법 없이 만들어야 한다. → Task 2
2. **시계가 뒤로 가거나 같은 ms 로 두 번 전진하는 경우.** 배속 변경과 일시정지 사이에서 실제로 생긴다. 경보가 중복되거나 역행하면 안 된다. → Task 3
3. **`localStorage` 가 던지는 환경**(사생활 모드, 할당량 초과). 분류 상태와 감사 로그가 메모리로만이라도 돌아야 한다. → Task 4
4. **감사 로그가 비어 있는 채로 JSON 내보내기**, 그리고 수천 줄로 커진 뒤의 내보내기. 둘 다 유효한 JSON 이어야 한다. → Task 4
5. **운영 경보 응답에 원본 IP 형태의 문자열이 섞여 들어오는 경우.** 프록시가 해시를 빠뜨렸거나 다른 필드에 남겼을 때 화면이 그것을 띄우면 안 된다. → Task 9

---

## 파일 구조

### 새로 만드는 것

| 파일 | 책임 |
|---|---|
| `ui/src/rng.js` | 시드 고정 PRNG(xorshift32) 하나. 다른 일 안 한다 |
| `ui/src/clock.js` | 누적 틱 시계. 순수. `performance.now()` 를 읽지 않는다 |
| `ui/src/alerts.js` | step → 경보 변환, 심각도 파생, 합성 잡음 생성 |
| `ui/src/triage.js` | 분류 상태기계 + 추가 전용 감사 로그 |
| `ui/src/links.js` | `sandbox.js` 에서 옮겨 오는 링크 규칙 묶음 |
| `ui/src/place.js` | `sandbox.js` 에서 옮겨 오는 자산 배치 둘 |
| `ui/src/theme.js` | 밝게/어둡게 모드. `SkinToggle.jsx` 와 같은 모양의 순수 모듈 |
| `ui/src/soc/Shell.jsx` | 좌측 내비 + 화면 라우팅 |
| `ui/src/soc/Dashboard.jsx` | 개요 |
| `ui/src/soc/AlertQueue.jsx` | 경보 큐 전체 페이지 |
| `ui/src/soc/IncidentDetail.jsx` | 인시던트 상세 |
| `ui/src/soc/AttackCoverage.jsx` | ATT&CK 전술×기법 행렬 |
| `ui/src/soc/AssetList.jsx` | 자산 목록 |
| `ui/src/soc/AuditLog.jsx` | 감사 로그 전체 페이지 |
| `ui/src/llm/index.mjs` | provider 선택 |
| `ui/src/llm/ollama.mjs` | 현행 Ollama 호출을 옮긴 것 |
| `ui/src/llm/anthropic.mjs` | 동일 출처 프록시로만 가는 Claude 어댑터 |
| `ui/src/soc-events.js` | 운영 경보 폴링과 정규화 |

### 지우는 것

`ui/src/sandbox.js`(분해 후 삭제), `ui/src/ui/Readiness.jsx`, 시나리오 `sandbox-01`.

---

## Task 1: sandbox 분해 - 살릴 것을 먼저 옮긴다

교전장을 지우기 전에 **살아남아야 할 것을 먼저 꺼낸다.** 순서를 뒤집으면 추천연결 오버레이가 한 커밋 동안 죽는다.

**Files:**
- Create: `ui/src/links.js`, `ui/src/place.js`
- Modify: `ui/src/sandbox.js`(축소), `ui/src/App.jsx`, `ui/src/derive.js`, `ui/src/editor.js`, `ui/src/ui/Rail.jsx`
- Test: `ui/src/__tests__/links.test.js`(신규), `ui/src/__tests__/sandbox.test.js`(이관)

**Interfaces:**
- Produces: `links.js` 가 `BEARER_ORDER`, `loadRules(base?)`, `rules()`, `ruleGap(rules, type)`, `siteOf(a)`, `linkCandidates(g, rules, assetId)`, `linkException(l)`, `linkFitsRules(g, rules, l)`, `missionCandidates(g, rules, assetId)` 를 내보낸다. 시그니처는 현재와 **한 글자도 바뀌지 않는다.**
- Produces: `place.js` 가 `placeNear(g, anchorId)`, `placeFree(g)` 를 내보낸다.

- [ ] **Step 1: 옮기기 전 상태를 기록한다**

```bash
cd /f/F/other_class/CybOPS
npx --prefix ui vitest run --reporter=basic 2>&1 | tail -3
```
Expected: 476 passed. 이 숫자가 Task 1 끝에서도 같아야 한다 (시험을 옮기기만 하므로).

- [ ] **Step 2: `links.js` 를 만든다**

`ui/src/sandbox.js` 의 다음을 **잘라내어** 그대로 옮긴다: `BEARER_ORDER`, `loadRules`, `rules`, `rulesCache`, `ruleGap`, `byId`, `linked`, `siteOf`, `linkCandidates`, `EXEMPTABLE`, `linkException`, `linkFitsRules`, `missionCandidates`.

파일 머리에 이 주석을 쓴다.

```js
// 링크 규칙. 파일 이름이 sandbox 였을 뿐 교전장 전용이 아니었다.
//
// linkCandidates 와 linkFitsRules 는 쪼개지 않는다. 원래 sandbox.js 에서
// linkFitsRules 위에 붙어 있던 주석이 이유를 적고 있고, 그 이유는 옮긴 뒤에도
// 그대로다: 인스펙터의 `규칙 밖` 표시와 오버레이의 점선 유령 선이 같은 술어
// 하나를 쓰기 때문에 플래그와 선이 어긋날 수 없다. 둘을 따로 두면 그 성질이
// 사라진다.
```

`linkFitsRules` 위의 기존 주석도 **함께 옮긴다.** 그 주석이 이 성질의 유일한 기록이다.

- [ ] **Step 3: `place.js` 를 만든다**

`sandbox.js` 에서 `extentOf`, `pos`, `placeNear`, `placeFree` 를 잘라내어 옮긴다. 머리 주석:

```js
// 새 자산을 어디에 놓을지. 편집 모드 전체에서 쓰고 교전장과 무관하다.
// 좌표는 표시 전용이고 엔진에 들어가지 않는다 (ADR-0002, Test-GeoInvariance).
```

- [ ] **Step 4: import 를 고친다**

```
ui/src/derive.js      ruleGap, linkCandidates, linkFitsRules  -> './links.js'
ui/src/ui/Rail.jsx    ruleGap, linkCandidates, linkException,
                      linkFitsRules, missionCandidates, BEARER_ORDER -> '../links.js'
ui/src/editor.js      placeNear, placeFree -> './place.js'
ui/src/App.jsx        loadRules -> './links.js' (나머지 sandbox import 는 Task 2 에서)
```

- [ ] **Step 5: 시험을 옮긴다**

`ui/src/__tests__/sandbox.test.js` 에서 링크 규칙과 배치를 다루는 describe 블록을 `ui/src/__tests__/links.test.js` 로 옮기고 import 를 `../links.js` / `../place.js` 로 고친다. **교전장 준비도(`readiness`) 블록은 건드리지 않는다** - Task 2 에서 통째로 지운다.

- [ ] **Step 6: 개수가 같은지 확인한다**

```bash
npx --prefix ui vitest run --reporter=basic 2>&1 | tail -3
```
Expected: **476 passed.** 옮기기만 했으므로 한 개도 늘거나 줄면 안 된다. 줄었으면 describe 블록을 빠뜨린 것이다.

- [ ] **Step 7: 추천연결 오버레이가 살아 있는지 눈으로 본다**

개발 서버(`npm --prefix ui run dev -- --port 5180 --strictPort --host`)에서 `tacnet-01` 편집 모드로 들어가 자산 하나를 클릭한다. 점선 유령 선이 뜨면 통과다. 안 뜨면 `App.jsx:262` 근처의 `linkGhosts` 계산이 끊긴 것이다.

- [ ] **Step 8: 커밋**

```bash
git add ui/src/links.js ui/src/place.js ui/src/sandbox.js ui/src/App.jsx ui/src/derive.js ui/src/editor.js ui/src/ui/Rail.jsx ui/src/__tests__/
git commit -m "$(cat <<'EOF'
ui: 링크 규칙과 자산 배치를 sandbox.js 밖으로 꺼낸다

교전장을 지우기 전에 살아남아야 할 것을 먼저 옮긴다. 순서를 뒤집으면 추천연결
오버레이가 한 커밋 동안 죽는다.

linkCandidates 와 linkFitsRules 는 붙여서 옮겼다. 원래 주석이 적고 있듯 인스펙터의
규칙 밖 표시와 오버레이의 점선이 같은 술어 하나를 쓰기 때문에 둘이 어긋날 수 없고,
쪼개면 그 성질이 사라진다.

시험 476개 그대로. 옮기기만 했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 교전장을 지운다

**Files:**
- Delete: `ui/src/sandbox.js`, `ui/src/ui/Readiness.jsx`, `ui/src/__tests__/sandbox.test.js`
- Modify: `ui/src/App.jsx`, `ui/src/facts.js`, `ui/src/staff.js`, `ui/src/ui/Topbar.jsx`, `ui/src/ui/Wargame.jsx`, `ui/src/ui/BoardToolbar.jsx`, `ui/src/style.css`, `eval/golden/staff/tacnet-01.jsonl`
- Modify: `ui/src/__tests__/facts.test.js`, `ui/src/__tests__/staff.test.js`, `ui/src/__tests__/editor.test.js`
- Modify: `docs/adr/0026-*.md`, `docs/adr/0027-sandbox-readiness.md`, `docs/adr/0028-llm-staff.md`, `docs/adr/README.md`

**Interfaces:**
- Consumes: Task 1 의 `links.js`, `place.js`
- Produces: 없음. 제거 태스크다.

- [ ] **Step 1: 지울 대상의 소비자를 다시 센다**

```bash
cd /f/F/other_class/CybOPS
for f in makeSandbox readiness listPlans savePlan loadPlan deletePlan validateImport SANDBOX_ID TEMPLATE_ID; do
  printf "%-16s " "$f"; grep -rl "\b$f\b" ui/src eval scripts 2>/dev/null | tr '\n' ' '; echo
done
```
Expected: Task 1 이후이므로 `links.js`/`place.js` 는 안 나와야 한다. 나오면 Task 1 이 덜 끝난 것이다.

- [ ] **Step 2: 골든셋에서 교전장 항목 셋을 뺀다**

```bash
node -e "
const fs=require('fs'), p='eval/golden/staff/tacnet-01.jsonl';
const L=fs.readFileSync(p,'utf8').trim().split('\n').map(JSON.parse);
const keep=L.filter(x=>x.ctx!=='sandbox');
console.log('전', L.length, '후', keep.length, '뺀 id:', L.filter(x=>x.ctx==='sandbox').map(x=>x.id).join(', '));
fs.writeFileSync(p, keep.map(x=>JSON.stringify(x)).join('\n')+'\n');
"
```
Expected: `전 41 후 38 뺀 id: tacnet-01:staff:28, tacnet-01:staff:29, tacnet-01:staff:30`

- [ ] **Step 3: 참모 카탈로그에서 `readiness_gap` 을 지운다**

`ui/src/staff.js` 에서 `readiness_gap` QUERIES 항목 전체(563줄 근처)와 `import { readiness } from './sandbox.js'` 를 지운다. `needs: 'sandbox'` 를 쓰는 다른 항목이 없는지 확인하고, 없으면 `catalog(ctx)` 의 `sandbox` 분기도 지운다.

`ui/src/facts.js` 에서 `readinessFacts` 와 `import { readiness as readinessOf }` 를 지우고, `staff.js` 의 `readinessFacts` import 도 지운다.

- [ ] **Step 4: 평가기가 자동으로 따라오는지 확인한다**

```bash
node ui/tools/staff-eval.mjs 2>&1 | tail -6
```
Expected: 카탈로그 회귀가 **30/30 covering 6/6** 으로 줄어든다. U8 이 하드코딩된 `6`/`21` 을 `QUERY_IDS.length` 로 바꿔 놨으므로 손으로 고칠 숫자가 없어야 한다. 숫자를 손으로 고쳐야 한다면 U8 의 작업이 덜 된 것이니 그 자리를 고친다.

- [ ] **Step 5: UI 에서 교전장을 들어낸다**

- `ui/src/ui/Readiness.jsx` 삭제, `Rail.jsx` 의 렌더 지점 삭제
- `ui/src/ui/Wargame.jsx`: `readyState` useMemo 와 `StartCard` 의 잠금 문구 둘 삭제. 게이트가 사라지므로 시작 카드는 항상 열린다
- `ui/src/ui/Topbar.jsx`: `SANDBOX_ID` import 와 `scenarioLabel` 의 교전장 분기 삭제
- `ui/src/ui/BoardToolbar.jsx`: `sandboxTools` 블록 전체와 `sandbox`, `plans`, `onSavePlan`, `onLoadPlan`, `onDeletePlan`, `onImport` prop 삭제
- `ui/src/App.jsx`: `makeSandbox`, `TEMPLATE_ID`, `SANDBOX_ID`, 플랜 4종, `validateImport` 호출부와 `isSandbox` 상태 전부 삭제
- `ui/src/style.css`: `readiness card` 주석이 붙은 규칙 블록(511줄 근처) 삭제
- `ui/src/sandbox.js` 삭제

- [ ] **Step 6: 교전이 저작 시나리오에서 도는지 확인한다**

이것이 이 태스크의 핵심 회귀다. 스펙 9.3 이 `Wargame.jsx:373` 을 근거로 "게이트는 `sandbox && graph` 일 때만 걸리므로 저작 시나리오는 영향 없다" 고 주장한다. 그 주장을 시험한다.

`ui/src/__tests__/wargame.test.js` 에 추가:

```js
it('저작 시나리오는 준비도 게이트 없이 교전을 연다', () => {
  // 교전장이 사라졌으므로 ready 라는 개념 자체가 없다. 시작 카드가
  // 잠기는 경로가 코드에 남아 있지 않은 것을 고정한다.
  const src = readFileSync(fileURLToPath(new URL('../ui/Wargame.jsx', import.meta.url)), 'utf8')
  expect(src).not.toMatch(/readyState|readiness/)
})
```

- [ ] **Step 7: 전체 시험**

```bash
npx --prefix ui vitest run --reporter=basic 2>&1 | tail -4
node ui/tools/parity.mjs 2>&1 | tail -2
node ui/tools/verify-scenarios.mjs 2>&1 | tail -2
```
Expected: vitest 통과(개수는 줄어든다 - 교전장 시험 23개가 빠지고 1개가 는다), 패리티 **1622 / 0**, verify-scenarios 통과.

- [ ] **Step 8: ADR 을 고친다**

- `docs/adr/0027-sandbox-readiness.md`: 상단 상태를 `**상태**: 폐기 (2026-11-10). 교전장이 없어졌으므로 입장 조건도 없다. 이 문서의 세 조건과 프로브 기법은 교전장이 돌아오면 다시 읽을 가치가 있어 본문은 지우지 않는다.` 로 바꾼다. **본문은 지우지 않는다** - 측정으로 얻은 내용이다.
- `docs/adr/0026-*.md`: 입장 조건 절에서 ADR-0027 참조를 제거하고 "저작 시나리오는 항상 열린다" 로 고친다
- `docs/adr/0028-llm-staff.md`: 카탈로그 표에서 `readiness_gap` 행을 지우고 `needs: 'sandbox'` 설명을 지운다
- `docs/adr/README.md`: 0027 행에 폐기 표시

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "$(cat <<'EOF'
ui: 교전장을 걷어낸다 - 교전 모드는 남는다

교전장 sandbox-01 과 그 입장 조건(ADR-0027)을 지운다. 골든셋에서 ctx=sandbox
항목 셋이 빠져 41 -> 38 이 되고, 참모 카탈로그가 7종 -> 6종이 된다. U8 이
하드코딩된 숫자를 QUERY_IDS.length 로 바꿔 둬서 평가기는 손댈 것이 없었다.

교전 모드는 남는다. Wargame.jsx 의 준비도 게이트가 sandbox 일 때만 걸렸고
저작 시나리오는 언제나 ready 로 지나갔다. 그 주장을 시험으로 고정했다.

ADR-0027 은 폐기 표시만 하고 본문은 지우지 않는다. 세 조건과 자기 루프 프로브는
측정으로 얻은 내용이라 교전장이 돌아오면 다시 읽을 가치가 있다.

패리티 1622/0 그대로. 엔진을 안 건드렸다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 시계와 난수 - 순수 모듈 둘

**Files:**
- Create: `ui/src/rng.js`, `ui/src/clock.js`
- Test: `ui/src/__tests__/clock.test.js`

**Interfaces:**
- Produces: `rng.js` 가 `makeRng(seed)` 를 내보낸다. 반환값은 `() => number`(0 이상 1 미만).
- Produces: `clock.js` 가 `makeClock({ t0, t1, rate })`, `advance(clock, elapsedMs, marks)`, `setRate(clock, rate)`, `RATES` 를 내보낸다. `marks` 는 오름차순 시나리오 시각 배열이다. `advance` 는 `{ clock, crossed }` 를 돌려주고 **입력 clock 을 변형하지 않는다.**

- [ ] **Step 1: 실패하는 시험을 쓴다**

`ui/src/__tests__/clock.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { makeRng } from '../rng.js'
import { makeClock, advance, setRate, RATES } from '../clock.js'

describe('rng', () => {
  it('같은 시드는 같은 열을 낸다', () => {
    const a = makeRng('tacnet-01'), b = makeRng('tacnet-01')
    const xs = Array.from({ length: 50 }, () => a())
    const ys = Array.from({ length: 50 }, () => b())
    expect(xs).toEqual(ys)
  })
  it('다른 시드는 다른 열을 낸다', () => {
    const a = makeRng('tacnet-01'), b = makeRng('defnet-01')
    expect(Array.from({ length: 20 }, () => a())).not.toEqual(Array.from({ length: 20 }, () => b()))
  })
  it('0 이상 1 미만이다', () => {
    const r = makeRng('x')
    for (let i = 0; i < 500; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
})

describe('clock', () => {
  const marks = [0, 60, 150, 405]
  const mk = () => makeClock({ t0: 0, t1: 405, rate: 15 })

  it('멈춘 상태에서 시작한다', () => {
    expect(mk().running).toBe(false)
    expect(mk().t).toBe(0)
  })

  it('advance 는 입력을 변형하지 않는다', () => {
    const c = { ...mk(), running: true }
    const before = JSON.stringify(c)
    advance(c, 1000, marks)
    expect(JSON.stringify(c)).toBe(before)
  })

  it('멈춰 있으면 전진하지 않는다', () => {
    const { clock, crossed } = advance(mk(), 5000, marks)
    expect(clock.t).toBe(0)
    expect(crossed).toEqual([])
  })

  it('배속만큼 시나리오 시각이 간다', () => {
    const { clock } = advance({ ...mk(), running: true }, 1000, marks)
    expect(clock.t).toBe(15)
  })

  // Review Focus 2: 역행과 0ms 전진
  it('음수 경과는 시각을 되돌리지 않는다', () => {
    const c = { ...mk(), running: true, t: 100 }
    const { clock, crossed } = advance(c, -5000, marks)
    expect(clock.t).toBe(100)
    expect(crossed).toEqual([])
  })
  it('0ms 전진은 같은 표식을 두 번 내지 않는다', () => {
    let c = { ...mk(), running: true }
    const a = advance(c, 4000, marks)   // t 0 -> 60
    const b = advance(a.clock, 0, marks)
    expect(a.crossed).toContain(60)
    expect(b.crossed).toEqual([])
  })

  it('배속을 올려도 표식을 건너뛰지 않는다', () => {
    // x60 으로 한 틱에 시나리오 60초가 지난다. 그 사이 표식이 전부 나와야 한다.
    const c = { ...mk(), running: true, rate: 60 }
    const { clock, crossed } = advance(c, 3000, marks)   // 180초
    expect(clock.t).toBe(180)
    expect(crossed).toEqual([60, 150])
  })

  it('끝을 넘지 않고 멈춘 뒤에도 시각은 계속 간다', () => {
    const c = { ...mk(), running: true, t: 400 }
    const { clock, crossed } = advance(c, 1000, marks)   // 400 -> 415
    expect(clock.t).toBe(415)
    expect(clock.pastEnd).toBe(true)
    expect(crossed).toEqual([405])
  })

  it('배속 셋뿐이고 모르는 값은 무시한다', () => {
    expect(RATES).toEqual([1, 15, 60])
    expect(setRate(mk(), 60).rate).toBe(60)
    expect(setRate(mk(), 7).rate).toBe(15)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx --prefix ui vitest run src/__tests__/clock.test.js 2>&1 | tail -5
```
Expected: FAIL - `Failed to resolve import "../rng.js"`

- [ ] **Step 3: `rng.js` 를 쓴다**

```js
// 시드 고정 PRNG. 합성 경보가 매번 같은 열로 나와야 시연이 재현된다.
// xorshift32 를 쓰는 이유는 단순함뿐이다. 암호용이 아니고, 그렇게 쓰지 않는다.

const hash = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function makeRng(seed) {
  let x = hash(String(seed)) || 1
  return () => {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x / 4294967296
  }
}
```

- [ ] **Step 4: `clock.js` 를 쓴다**

```js
// 압축 재생 시계. 시나리오 시각이 벽시계로 흐른다.
//
// performance.now() 를 읽지 않는다. 바깥에서 경과 ms 를 받아 누적 틱을 전진시킬
// 뿐이고, 그래서 시험이 시간에 의존하지 않는다. React 쪽의 rAF 루프가 advance 를
// 부르는 유일한 지점이다.
//
// 재생/정지가 있는 이유는 하나다. 심사장에서 발표자가 "여기를 보십시오" 하고
// 멈출 수 있어야 한다. 흐르기만 하는 화면은 시연이 안 된다.

export const RATES = [1, 15, 60]
const DEFAULT_RATE = 15

export function makeClock({ t0 = 0, t1 = 0, rate = DEFAULT_RATE } = {}) {
  return { t: t0, t0, t1, rate: RATES.includes(rate) ? rate : DEFAULT_RATE, running: false, pastEnd: t0 > t1 }
}

export function setRate(clock, rate) {
  return { ...clock, rate: RATES.includes(rate) ? rate : clock.rate }
}

// marks 는 오름차순 시나리오 시각 배열. 이번 전진에서 넘어간 것을 전부 돌려준다.
// 배속을 올려도 건너뛰지 않는 것이 이 함수의 유일한 어려운 요구다.
export function advance(clock, elapsedMs, marks = []) {
  if (!clock.running || !(elapsedMs > 0)) return { clock, crossed: [] }
  const next = clock.t + (elapsedMs / 1000) * clock.rate
  const crossed = marks.filter((m) => m > clock.t && m <= next)
  return { clock: { ...clock, t: next, pastEnd: next >= clock.t1 }, crossed }
}
```

- [ ] **Step 5: 통과를 확인한다**

```bash
npx --prefix ui vitest run src/__tests__/clock.test.js 2>&1 | tail -4
```
Expected: PASS, 11 tests.

- [ ] **Step 6: 커밋**

```bash
git add ui/src/rng.js ui/src/clock.js ui/src/__tests__/clock.test.js
git commit -m "$(cat <<'EOF'
soc: 시계와 시드 난수 - 순수 모듈 둘

시계가 performance.now() 를 읽지 않는다. 바깥에서 경과 ms 를 받아 누적 틱을
전진시킬 뿐이라 시험이 시간에 의존하지 않는다.

배속을 올려도 표식을 건너뛰지 않는 것이 advance 의 유일한 어려운 요구다. x60 으로
한 틱에 시나리오 1분이 지나면 그 사이 경보가 전부 crossed 에 담겨 나온다.

음수 경과와 0ms 전진도 고정했다. 배속 변경과 일시정지 사이에서 실제로 생기는
입력이고, 그때 경보가 중복되거나 시각이 역행하면 안 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 경보 모델

**Files:**
- Create: `ui/src/alerts.js`
- Test: `ui/src/__tests__/alerts.test.js`

**Interfaces:**
- Consumes: `makeRng` (Task 3)
- Produces: `alertsFromReplay(payload)` → `Alert[]`, `synthNoise(payload, scenarioId, ratio)` → `Alert[]`, `buildAlerts(payload, scenarioId, ratio)` → 시각 오름차순 `Alert[]`, `severityOf(prev, step)` → `'P1'|'P2'|'P3'|'P4'`, `SEV_CUTS`
- `Alert` 모양: `{ id, t, at, title, detail, technique, tactic, assets, severity, origin }`. `origin` 은 `'scenario' | 'synthetic' | 'ops'`.

- [ ] **Step 1: tacnet-01 의 실제 증분 분포를 잰다**

스펙 13절 1번이 요구하는 측정이다. 지어낸 임계값을 쓰지 않는다.

```bash
cd /f/F/other_class/CybOPS
node -e "
const d=require('./ui/public/data/tacnet-01.replay.json');
let prev=null; const ds=[];
for (const s of d.steps) {
  if (prev && Object.keys(s.compromise||{}).length) {
    let m=0; for (const k of Object.keys(s.mission||{})) m=Math.max(m,(s.mission[k]||0)-(prev.mission[k]||0));
    ds.push({t:s.t, d:+m.toFixed(4), label:s.label});
  }
  prev=s;
}
ds.sort((a,b)=>b.d-a.d);
console.log('침해 있는 step', ds.length, '건의 최대 임무 증분:');
ds.forEach(x=>console.log('  ', String(x.d).padStart(8), 't='+x.t, x.label));
"
```

측정한 분포를 보고 임계값 넷을 정한다. 기본 제안은 `0.25 / 0.10 / 0.02` 이지만 **분포가 그것과 맞지 않으면 분포를 따른다.** 정한 값과 그 근거를 Step 3 의 `SEV_CUTS` 주석에 실제 수치와 함께 적는다.

- [ ] **Step 2: 실패하는 시험을 쓴다**

`ui/src/__tests__/alerts.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { alertsFromReplay, synthNoise, buildAlerts, severityOf, SEV_CUTS } from '../alerts.js'

const payload = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/data/tacnet-01.replay.json', import.meta.url)), 'utf8'))

describe('시나리오 경보', () => {
  const as = alertsFromReplay(payload)

  it('침해가 있는 step 만 경보가 된다', () => {
    const withC = payload.steps.filter((s) => Object.keys(s.compromise || {}).length).length
    expect(as.length).toBe(withC)
    expect(as.length).toBeGreaterThan(0)
  })

  it('출처는 전부 scenario 다', () => {
    expect([...new Set(as.map((a) => a.origin))]).toEqual(['scenario'])
  })

  it('step 의 라벨과 ATT&CK 을 그대로 가져온다', () => {
    const a = as.find((x) => x.t === 150)
    expect(a.title).toBe('노획 단말 비인가 접속')
    expect(a.technique).toBe('T1078')
    expect(a.tactic).toBe('initial-access')
    expect(a.assets).toEqual(['CO2-VEH'])
  })

  it('시각 오름차순이고 id 가 유일하다', () => {
    const ts = as.map((a) => a.t)
    expect([...ts].sort((x, y) => x - y)).toEqual(ts)
    expect(new Set(as.map((a) => a.id)).size).toBe(as.length)
  })

  // Review Focus 1
  it('gt 가 비어도 던지지 않고 기법 없이 만든다', () => {
    const p = { ...payload, steps: [
      { t: 0, time_iso: '2026-09-10T06:00:00+09:00', label: 'a', compromise: {}, mission: {} },
      { t: 10, time_iso: '2026-09-10T06:00:10+09:00', label: 'b', gt: [], compromise: { X: 1 }, mission: {} },
    ] }
    const r = alertsFromReplay(p)
    expect(r).toHaveLength(1)
    expect(r[0].technique).toBe(null)
    expect(r[0].tactic).toBe(null)
  })

  it('gt 자체가 없어도 던지지 않는다', () => {
    const p = { ...payload, steps: [
      { t: 0, time_iso: 'x', label: 'a', compromise: {}, mission: {} },
      { t: 10, time_iso: 'y', label: 'b', compromise: { X: 1 }, mission: {} },
    ] }
    expect(() => alertsFromReplay(p)).not.toThrow()
    expect(alertsFromReplay(p)[0].technique).toBe(null)
  })
})

describe('심각도', () => {
  it('임계값 넷이 내림차순이다', () => {
    expect(SEV_CUTS.P1).toBeGreaterThan(SEV_CUTS.P2)
    expect(SEV_CUTS.P2).toBeGreaterThan(SEV_CUTS.P3)
    expect(SEV_CUTS.P3).toBeGreaterThan(0)
  })
  it('임무 증분에서 파생한다', () => {
    const prev = { mission: { A: 0, B: 0 } }
    expect(severityOf(prev, { mission: { A: SEV_CUTS.P1 + 0.01, B: 0 } })).toBe('P1')
    expect(severityOf(prev, { mission: { A: SEV_CUTS.P2, B: 0 } })).toBe('P2')
    expect(severityOf(prev, { mission: { A: SEV_CUTS.P3, B: 0 } })).toBe('P3')
    expect(severityOf(prev, { mission: { A: 0, B: 0 } })).toBe('P4')
  })
  it('가장 큰 증분 하나를 쓴다. 우선순위 가중을 안 쓴다', () => {
    const prev = { mission: { A: 0, B: 0 } }
    expect(severityOf(prev, { mission: { A: 0, B: SEV_CUTS.P1 + 0.01 } })).toBe('P1')
  })
  it('첫 step 은 이전이 없으므로 저하 자체를 증분으로 본다', () => {
    expect(severityOf(null, { mission: { A: SEV_CUTS.P1 + 0.01 } })).toBe('P1')
  })
})

describe('합성 잡음', () => {
  it('같은 시드가 같은 열을 낸다', () => {
    const a = synthNoise(payload, 'tacnet-01', 2)
    const b = synthNoise(payload, 'tacnet-01', 2)
    expect(a.map((x) => [x.t, x.title, x.assets[0]])).toEqual(b.map((x) => [x.t, x.title, x.assets[0]]))
  })
  it('출처가 synthetic 이고 임무 영향이 없다', () => {
    const a = synthNoise(payload, 'tacnet-01', 2)
    expect([...new Set(a.map((x) => x.origin))]).toEqual(['synthetic'])
    expect(a.every((x) => x.severity === 'P4')).toBe(true)
  })
  it('비율을 따른다', () => {
    const real = alertsFromReplay(payload).length
    expect(synthNoise(payload, 'tacnet-01', 2).length).toBe(real * 2)
    expect(synthNoise(payload, 'tacnet-01', 0).length).toBe(0)
  })
})

describe('합친 열', () => {
  const all = buildAlerts(payload, 'tacnet-01', 2)
  it('시각 오름차순이다', () => {
    const ts = all.map((a) => a.t)
    expect([...ts].sort((x, y) => x - y)).toEqual(ts)
  })
  it('id 가 전부 유일하다', () => {
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length)
  })
  it('두 출처가 섞여 있고 구별된다', () => {
    expect(new Set(all.map((a) => a.origin))).toEqual(new Set(['scenario', 'synthetic']))
  })
})

describe('소스에 국가나 IP 축이 없다 (ADR-0002)', () => {
  it('alerts.js 가 country 나 geo 를 읽지 않는다', () => {
    const src = readFileSync(fileURLToPath(new URL('../alerts.js', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/\bcountry\b|\bgeoip\b|\bclientIp\b/i)
  })
})
```

- [ ] **Step 3: 실패를 확인하고 `alerts.js` 를 쓴다**

```bash
npx --prefix ui vitest run src/__tests__/alerts.test.js 2>&1 | tail -4
```
Expected: FAIL - `Failed to resolve import "../alerts.js"`

그 다음 `ui/src/alerts.js` 를 쓴다. 뼈대는 아래와 같고, `SEV_CUTS` 의 값과 주석은 **Step 1 에서 실제로 잰 분포**로 채운다.

```js
// 경보는 리플레이를 다르게 읽는 방식이지 새 진실이 아니다. 새 데이터 파일을
// 만들지 않는다. step 하나가 이미 경보가 필요로 하는 것을 전부 들고 있다.
import { makeRng } from './rng.js'

// 심각도는 사람이 매기지 않는다. 그 step 이 임무에 입힌 저하 증분에서 파생한다.
// 손으로 적은 등급은 엔진이 계산하는 것과 어긋날 수 있고, 어긋나면 어느 쪽이
// 맞는지 아무도 모른다.
//
// 이 넷은 이 모듈의 유일한 임의 상수다. 근거는 tacnet-01 의 실제 증분 분포이고
// 측정값은 ADR-0034 에 적는다.
// <여기에 Step 1 의 실측 분포를 요약해서 적는다. 예: 침해 step N 건의 최대
//  임무 증분은 ... 이고, 그래서 경계를 ... 에 둔다.>
export const SEV_CUTS = { P1: 0.25, P2: 0.10, P3: 0.02 }

// 우선순위 가중을 쓰지 않는다. P1 임무의 2% 저하와 P3 임무의 25% 저하 중
// 무엇이 급한지는 이 화면이 답할 질문이 아니고, 섞으면 숫자의 출처가 흐려진다.
// 임무별 우선순위는 상세 패널에 따로 보인다.
export function severityOf(prev, step) {
  const cur = step.mission || {}
  const old = (prev && prev.mission) || {}
  let d = 0
  for (const k of Object.keys(cur)) d = Math.max(d, Number(cur[k] || 0) - Number(old[k] || 0))
  if (d >= SEV_CUTS.P1) return 'P1'
  if (d >= SEV_CUTS.P2) return 'P2'
  if (d >= SEV_CUTS.P3) return 'P3'
  return 'P4'
}

export function alertsFromReplay(payload) {
  const steps = payload.steps || []
  const out = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const assets = Object.keys(s.compromise || {})
    if (!assets.length) continue          // 아무도 새로 침해되지 않은 시점은 사건이 아니다
    const gt = (Array.isArray(s.gt) && s.gt[0]) || null
    out.push({
      id: `sc:${s.t}`,
      t: Number(s.t),
      at: s.time_iso || null,
      title: s.label || '(라벨 없음)',
      detail: s.note || '',
      technique: gt ? gt.technique || null : null,
      tactic: gt ? gt.tactic || null : null,
      assets,
      severity: severityOf(steps[i - 1] || null, s),
      origin: 'scenario',
    })
  }
  return out
}

// 28건이 전부 참이면 분류할 것이 없다. 관제의 본질은 신호와 잡음을 가르는 일이다.
//
// 합성 경보는 엔진을 거치지 않는다. 침해가 아니므로 compromise 가 없고, 따라서
// 임무 영향도 격리 후보도 없다. 전부 P4 다.
const NOISE = [
  ['정기 점검 포트 스캔', '정비창의 주기 점검'],
  ['인증 실패 3회 후 성공', '단말 재부팅 뒤 재로그인'],
  ['대용량 전송 시작', '지도 타일 캐시 갱신'],
  ['비표준 포트 접속', '점검용 임시 포트'],
  ['설정 파일 변경', '정비 일정에 따른 변경'],
]

export function synthNoise(payload, scenarioId, ratio = 2) {
  const real = alertsFromReplay(payload)
  if (!real.length || ratio <= 0) return []
  const rnd = makeRng(`${scenarioId}:noise`)
  const assets = (payload.graph && payload.graph.assets || []).map((a) => a.id)
  const t0 = real[0].t, t1 = real[real.length - 1].t
  const span = Math.max(1, t1 - t0)
  const out = []
  for (let i = 0; i < real.length * ratio; i++) {
    const [title, detail] = NOISE[Math.floor(rnd() * NOISE.length)]
    const t = Math.round(t0 + rnd() * span)
    out.push({
      id: `sy:${i}`,
      t,
      at: null,
      title,
      detail,
      technique: null,
      tactic: null,
      assets: assets.length ? [assets[Math.floor(rnd() * assets.length)]] : [],
      severity: 'P4',
      origin: 'synthetic',
    })
  }
  return out
}

export function buildAlerts(payload, scenarioId, ratio = 2) {
  return [...alertsFromReplay(payload), ...synthNoise(payload, scenarioId, ratio)]
    .sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx --prefix ui vitest run src/__tests__/alerts.test.js 2>&1 | tail -4
```
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add ui/src/alerts.js ui/src/__tests__/alerts.test.js
git commit -m "$(cat <<'EOF'
soc: 경보 모델 - 리플레이를 다르게 읽는다

새 데이터 파일을 만들지 않는다. step 하나가 이미 time_iso, label, ATT&CK gt,
compromise, 임무 저하를 전부 들고 있다.

심각도는 사람이 매기지 않고 그 step 의 임무 저하 증분에서 파생한다. 임계값 넷은
tacnet-01 의 실제 분포를 재서 정했고 측정값을 주석에 적었다. 우선순위 가중은
쓰지 않는다 - 섞으면 숫자의 출처가 흐려진다.

28건이 전부 참이면 분류할 것이 없으므로 합성 잡음을 시드 고정으로 섞는다. 합성은
엔진을 거치지 않고 전부 P4 이며 임무 영향이 없다.

gt 가 비었거나 아예 없는 step 도 던지지 않고 기법 없이 만든다. 리플레이가 항상
완전하다는 보장이 없다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 분류 상태기계와 감사 로그

**Files:**
- Create: `ui/src/triage.js`
- Test: `ui/src/__tests__/triage.test.js`

**Interfaces:**
- Produces: `STATES`, `TRANSITIONS`, `canMove(from, to)`, `makeTriage(store?)`, `stateOf(state, alertId)`, `move(state, alertId, to, note?)`, `exportLog(state)` → JSON 문자열, `counts(state, alerts)` → 출처별 상태 집계
- `move` 는 `{ state, ok, why }` 를 돌려주고 **입력 state 를 변형하지 않는다.**

- [ ] **Step 1: 실패하는 시험을 쓴다**

`ui/src/__tests__/triage.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STATES, canMove, makeTriage, move, exportLog, counts } from '../triage.js'

const throwingStore = { getItem() { throw new Error('private') }, setItem() { throw new Error('private') } }
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }

describe('상태기계', () => {
  it('상태는 넷이다. 종결요청은 없다', () => {
    expect(STATES).toEqual(['미접수', '접수', '이관', '종결'])
  })
  it('허용된 전이만 통과한다', () => {
    expect(canMove('미접수', '접수')).toBe(true)
    expect(canMove('접수', '이관')).toBe(true)
    expect(canMove('이관', '종결')).toBe(true)
    expect(canMove('미접수', '종결')).toBe(true)    // 오탐 종결
    expect(canMove('접수', '종결')).toBe(true)      // 오탐 종결
    expect(canMove('종결', '접수')).toBe(false)     // 되돌리기 없음
    expect(canMove('미접수', '이관')).toBe(false)   // 접수를 건너뛸 수 없다
  })
  it('거부된 전이는 사유와 함께 돌려주고 상태를 안 바꾼다', () => {
    const s0 = makeTriage(memStore())
    const a = move(s0, 'x', '접수')
    const b = move(a.state, 'x', '접수')
    expect(b.ok).toBe(false)
    expect(b.why).toMatch(/접수/)
    expect(b.state.log.length).toBe(a.state.log.length)
  })
  it('move 는 입력을 변형하지 않는다', () => {
    const s0 = makeTriage(memStore())
    const before = JSON.stringify(s0)
    move(s0, 'x', '접수')
    expect(JSON.stringify(s0)).toBe(before)
  })
})

describe('감사 로그', () => {
  it('추가만 된다. 수정·삭제 함수가 없다', async () => {
    const mod = await import('../triage.js')
    for (const name of Object.keys(mod)) {
      expect(name).not.toMatch(/delete|remove|edit|update|clear|reset/i)
    }
  })
  it('seq 가 단조 증가한다', () => {
    let s = makeTriage(memStore())
    s = move(s, 'a', '접수').state
    s = move(s, 'b', '접수').state
    s = move(s, 'a', '이관').state
    const seqs = s.log.map((e) => e.seq)
    expect(seqs).toEqual([1, 2, 3])
  })
  it('한 줄이 누가 무엇을 언제 바꿨는지 담는다', () => {
    const s = move(makeTriage(memStore()), 'a', '접수', '사람 확인').state
    const e = s.log[0]
    expect(e.alertId).toBe('a')
    expect(e.from).toBe('미접수')
    expect(e.to).toBe('접수')
    expect(e.note).toBe('사람 확인')
    expect(typeof e.at).toBe('string')
  })

  // Review Focus 4
  it('빈 로그도 유효한 JSON 이다', () => {
    const j = exportLog(makeTriage(memStore()))
    expect(() => JSON.parse(j)).not.toThrow()
    expect(JSON.parse(j).log).toEqual([])
  })
  it('수천 줄도 유효한 JSON 이다', () => {
    let s = makeTriage(memStore())
    for (let i = 0; i < 3000; i++) s = move(s, 'a' + i, '접수').state
    const parsed = JSON.parse(exportLog(s))
    expect(parsed.log).toHaveLength(3000)
    expect(parsed.log[2999].seq).toBe(3000)
  })
})

// Review Focus 3
describe('localStorage 가 던지는 환경', () => {
  it('makeTriage 가 던지지 않는다', () => {
    expect(() => makeTriage(throwingStore)).not.toThrow()
  })
  it('전이가 메모리로는 계속 돈다', () => {
    const s = move(makeTriage(throwingStore), 'a', '접수')
    expect(s.ok).toBe(true)
    expect(s.state.log).toHaveLength(1)
  })
})

describe('집계는 출처를 섞지 않는다', () => {
  it('출처별로 따로 센다', () => {
    const alerts = [
      { id: 'a', origin: 'scenario' }, { id: 'b', origin: 'scenario' },
      { id: 'c', origin: 'synthetic' }, { id: 'd', origin: 'ops' },
    ]
    let s = makeTriage(memStore())
    s = move(s, 'a', '접수').state
    const c = counts(s, alerts)
    expect(c.byOrigin.scenario.total).toBe(2)
    expect(c.byOrigin.synthetic.total).toBe(1)
    expect(c.byOrigin.ops.total).toBe(1)
    expect(c.byOrigin.scenario.접수).toBe(1)
    expect(c.byOrigin.scenario.미접수).toBe(1)
    // 하나로 합친 수를 내보내지 않는다
    expect(c.total).toBeUndefined()
  })
})

describe('조치를 실행하는 경로가 없다 (ADR-0004)', () => {
  it('triage.js 가 fetch 도 네트워크도 부르지 않는다', () => {
    const src = readFileSync(fileURLToPath(new URL('../triage.js', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/)
  })
  it('격리·차단을 뜻하는 이름이 없다', () => {
    const src = readFileSync(fileURLToPath(new URL('../triage.js', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/\bisolate\b|\bcontain\b|\bblock\s*\(|\bquarantine\b/i)
  })
})
```

- [ ] **Step 2: 실패를 확인하고 `triage.js` 를 쓴다**

```bash
npx --prefix ui vitest run src/__tests__/triage.test.js 2>&1 | tail -4
```
Expected: FAIL.

```js
// 분류 상태기계와 추가 전용 감사 로그.
//
// 이관은 실행이 아니라 건의다. ADR-0004 는 차단·격리 실행에 사람 승인을 요구하고
// 자동 실행 경로를 코드에 넣는 것을 금지한다. 그래서 이 모듈에는 네트워크를 부르는
// 코드가 없고, 그것을 시험이 고정한다. 버튼 라벨이 `격리` 가 아니라 `이관 건의` 인
// 것도 같은 결정의 일부다.
//
// 참고 화면(이글루 SPiDER TM)의 `종결요청` 은 뺐다. 승인자가 한 명인 데모에서
// 요청과 종결 사이에 아무도 없다.

export const STATES = ['미접수', '접수', '이관', '종결']
export const TRANSITIONS = {
  미접수: ['접수', '종결'],
  접수: ['이관', '종결'],
  이관: ['종결'],
  종결: [],
}
const KEY = 'mccycop:soc:triage'

export const canMove = (from, to) => (TRANSITIONS[from] || []).includes(to)

const save = (state) => {
  try { state.store.setItem(KEY, JSON.stringify({ at: state.at, log: state.log })) } catch { /* 사생활 모드나 할당량 */ }
}

export function makeTriage(store) {
  const s = { store: store || fallbackStore(), at: {}, log: [], seq: 0 }
  try {
    const raw = s.store.getItem(KEY)
    if (raw) { const p = JSON.parse(raw); s.at = p.at || {}; s.log = p.log || []; s.seq = s.log.length }
  } catch { /* 읽을 수 없으면 빈 상태로 시작한다. 고장이 아니다 */ }
  return s
}

function fallbackStore() {
  try { if (typeof localStorage !== 'undefined') return localStorage } catch { /* 접근 자체가 던진다 */ }
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
}

export const stateOf = (state, alertId) => state.at[alertId] || '미접수'

export function move(state, alertId, to, note = '') {
  const from = stateOf(state, alertId)
  if (!canMove(from, to)) {
    return { state, ok: false, why: `${from} 에서 ${to} 로는 갈 수 없다` }
  }
  const seq = state.seq + 1
  const next = {
    ...state,
    at: { ...state.at, [alertId]: to },
    log: [...state.log, { seq, at: new Date().toISOString(), alertId, from, to, note }],
    seq,
  }
  save(next)
  return { state: next, ok: true, why: '' }
}

export function exportLog(state) {
  return JSON.stringify({ exported_at: new Date().toISOString(), log: state.log }, null, 1)
}

// 집계는 출처를 섞지 않는다. 합성이 실측 숫자에 들어가는 경로를 만들지 않는 것이
// docs/07 6절의 요구다. 그래서 합친 total 을 애초에 내보내지 않는다.
export function counts(state, alerts) {
  const byOrigin = {}
  for (const a of alerts) {
    const o = a.origin || 'scenario'
    byOrigin[o] = byOrigin[o] || { total: 0, 미접수: 0, 접수: 0, 이관: 0, 종결: 0 }
    byOrigin[o].total += 1
    byOrigin[o][stateOf(state, a.id)] += 1
  }
  return { byOrigin }
}
```

- [ ] **Step 3: 통과를 확인한다**

```bash
npx --prefix ui vitest run src/__tests__/triage.test.js 2>&1 | tail -4
```
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add ui/src/triage.js ui/src/__tests__/triage.test.js
git commit -m "$(cat <<'EOF'
soc: 분류 상태기계와 추가 전용 감사 로그

이관은 실행이 아니라 건의다. 이 모듈에는 네트워크를 부르는 코드가 없고 격리를
뜻하는 이름도 없으며, 그것을 시험이 고정한다 (ADR-0004).

감사 로그는 추가만 된다. 수정도 삭제도 하는 함수를 내보내지 않고, 그것도 시험이
이름으로 고정한다. enigmart 쪽 포트폴리오의 immutable audit trail 을 가져왔다.

집계는 출처를 섞지 않는다. 합친 total 을 애초에 내보내지 않아서 섞을 수가 없다
(docs/07 6절).

localStorage 가 던지는 환경(사생활 모드, 할당량)에서도 메모리로 계속 돈다. 빈 로그와
3000줄 로그 둘 다 유효한 JSON 으로 나가는 것을 고정했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 테마 두 모드

**Files:**
- Create: `ui/src/theme.js`, `ui/src/ui/ThemeToggle.jsx`
- Modify: `ui/src/tokens.mjs`, `ui/src/style.css`, `ui/tools/token-parity.mjs`, `docs/design/tokens.md`, `ui/src/main.jsx`
- Test: `ui/src/__tests__/theme.test.js`

**Interfaces:**
- Consumes: U11 의 `tokens.mjs` (`CAUSE`, `CHROME`)
- Produces: `THEME_KEY`, `THEME_ATTR`, `DEFAULT_THEME`, `THEMES`, `readTheme(store)`, `applyTheme(id, root, store)`. `SkinToggle.jsx` 와 **같은 모양**으로 만든다.
- Produces: `tokens.mjs` 가 `CAUSE_LIGHT` 를 추가로 내보낸다. 키 집합은 `CAUSE` 와 **같아야 한다.**

- [ ] **Step 1: 라이트 모드 원인색 여덟을 측정으로 정한다**

스펙 13절 5번이 요구하는 측정이다. 다크 값을 그대로 쓰면 밝은 배경에서 대비가 무너지는 색이 나올 것이라 예상하지만, **예상이 아니라 재서 적는다.**

```bash
cd /f/F/other_class/CybOPS
node -e "
const { CAUSE } = require('./ui/src/tokens.mjs');
const lin=(c)=>{c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const L=(h)=>{const n=parseInt(h.slice(1),16); return 0.2126*lin(n>>16&255)+0.7152*lin(n>>8&255)+0.0722*lin(n&255)};
const ratio=(a,b)=>{const [x,y]=[L(a),L(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05)};
console.log('다크 값을 흰 배경(#ffffff)에 놓았을 때의 대비:');
for (const [k,v] of Object.entries(CAUSE)) {
  const r=ratio(v,'#ffffff');
  console.log('  ', k.padEnd(14), v, r.toFixed(2)+':1', r>=4.5?'통과':'### 미달');
}
"
```

미달한 색마다 **색상(hue)을 유지하면서 명도만 낮춰** 4.5:1 을 넘는 값을 찾는다. 여덟이 서로 구별되는지도 확인한다. 정한 값과 측정한 대비를 ADR-0037 에 표로 적는다.

- [ ] **Step 2: 실패하는 시험을 쓴다**

`ui/src/__tests__/theme.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CAUSE, CAUSE_LIGHT } from '../tokens.mjs'
import { THEMES, DEFAULT_THEME, THEME_ATTR, readTheme, applyTheme } from '../theme.js'

const fakeRoot = () => {
  const attrs = new Map()
  return { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k),
           getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null) }
}
const fakeStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255) }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('테마 정체', () => {
  it('두 모드이고 기본은 지금 동작이다', () => {
    expect(THEMES.map(([id]) => id)).toEqual(['dark', 'light'])
    expect(DEFAULT_THEME).toBe('dark')
  })
  it('기본 모드는 속성을 붙이지 않는다', () => {
    const root = fakeRoot()
    applyTheme('dark', root, fakeStore())
    expect(root.getAttribute(THEME_ATTR)).toBe(null)
  })
  it('store 가 던져도 속성은 붙는다', () => {
    const root = fakeRoot()
    const bad = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }
    expect(applyTheme('light', root, bad)).toBe('light')
    expect(root.getAttribute(THEME_ATTR)).toBe('light')
  })
  it('round-trip', () => {
    const root = fakeRoot(), store = fakeStore()
    applyTheme('light', root, store)
    expect(readTheme(store)).toBe('light')
  })
})

describe('두 모드의 토큰', () => {
  it('키 집합이 같다. 한쪽에만 있는 색이 없다', () => {
    expect(Object.keys(CAUSE_LIGHT).sort()).toEqual(Object.keys(CAUSE).sort())
  })
  it('라이트 원인색 여덟이 흰 배경에서 4.5:1 을 넘는다', () => {
    for (const [k, v] of Object.entries(CAUSE_LIGHT)) {
      expect(ratio(v, '#ffffff'), `${k} ${v}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('여덟이 서로 다르다', () => {
    expect(new Set(Object.values(CAUSE_LIGHT)).size).toBe(Object.keys(CAUSE_LIGHT).length)
  })
})

describe('심각도 색 - P1 만 채도를 쓴다', () => {
  const css = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8')
  const sev = (p) => (css.match(new RegExp(`--sev-${p}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1]
  const chroma = (h) => { const n = parseInt(h.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255
    return Math.max(r, g, b) - Math.min(r, g, b) }
  it('네 등급이 전부 정의돼 있다', () => {
    for (const p of ['p1', 'p2', 'p3', 'p4']) expect(sev(p), p).toBeTruthy()
  })
  it('P1 만 채도를 갖는다. P2~P4 는 무채색이다', () => {
    expect(chroma(sev('p1'))).toBeGreaterThan(40)
    for (const p of ['p2', 'p3', 'p4']) expect(chroma(sev(p)), p).toBeLessThanOrEqual(12)
  })
})

describe('와이어 모드는 다크 전용', () => {
  it('라이트에서 비활성이고 사유가 붙는다', () => {
    const src = readFileSync(fileURLToPath(new URL('../ui/MapPane.jsx', import.meta.url)), 'utf8')
    // U7 이 측정한 대비 바닥값이 어두운 배경 전제라 라이트에서 성립하지 않는다.
    expect(src).toMatch(/wireDisabledWhyLight|라이트 모드에서는/)
  })
})
```

- [ ] **Step 3: 실패를 확인하고 구현한다**

```bash
npx --prefix ui vitest run src/__tests__/theme.test.js 2>&1 | tail -5
```
Expected: FAIL.

구현할 것 다섯.

1. `ui/src/tokens.mjs` 에 `CAUSE_LIGHT` 를 추가한다. Step 1 에서 측정한 값과 대비 수치를 주석에 적는다.
2. `ui/src/style.css` 의 `:root` 아래에 `:root[data-theme="light"]` 블록을 만들고 크롬 토큰과 원인색을 라이트 값으로 재지정한다. **크롬은 무채색을 유지한다** - 흰 배경도 무채색이다. 그리고 `--sev-p1` ~ `--sev-p4` 넷을 양쪽 모드에 정의한다. P1 은 `var(--attack)`, P2~P4 는 무채색 농도.
3. `ui/src/theme.js` 를 `ui/src/ui/SkinToggle.jsx` 와 같은 모양으로 쓴다(주입 가능한 root 와 store, 기본 모드는 속성 제거).
4. `ui/src/ui/ThemeToggle.jsx` 를 만들고 `BoardToolbar` 의 `into()` 포털을 통과하도록 `skinSeg` 옆에 둔다.
5. `ui/src/ui/MapPane.jsx` 의 와이어 모드 토글에 라이트 모드 비활성 분기와 사유 문구를 넣는다.

- [ ] **Step 4: 토큰 게이트를 두 모드로 늘린다**

`ui/tools/token-parity.mjs` 가 `CAUSE` 만 대조하고 있다. `CAUSE_LIGHT` 와 `:root[data-theme="light"]` 블록, `docs/design/tokens.md` 의 라이트 표까지 대조하도록 늘린다. **모드가 둘이 되면 한쪽만 고치고 다른 쪽을 잊는 사고가 반드시 난다.**

- [ ] **Step 5: 게이트를 일부러 깨뜨려 본다**

라이트 값 하나를 한 글자 바꾸고 게이트가 잡는지 본다. 잡으면 되돌린다.

```bash
node ui/tools/token-parity.mjs 2>&1 | tail -4
```
Expected (깨뜨린 상태): `MISMATCH` 한 줄과 `exit=1`. 되돌린 뒤: `compared NN values, 0 mismatch(es)`.

- [ ] **Step 6: 전체 시험과 커밋**

```bash
npx --prefix ui vitest run --reporter=basic 2>&1 | tail -3
node ui/tools/token-parity.mjs 2>&1 | tail -2
git add ui/src/theme.js ui/src/ui/ThemeToggle.jsx ui/src/tokens.mjs ui/src/style.css ui/tools/token-parity.mjs docs/design/tokens.md ui/src/main.jsx ui/src/ui/MapPane.jsx ui/src/__tests__/theme.test.js
git commit -m "$(cat <<'EOF'
ui: 테마 두 모드 - 밝게 / 어둡게

ADR-0024 의 알맹이는 "배경이 검다" 가 아니라 "크롬에 색조가 없다" 이고 흰 배경도
무채색이다. 바뀌는 것은 원인색 여덟이 라이트 값을 하나씩 더 갖는 것뿐이다.

라이트 값은 재서 정했다. 다크 값을 흰 배경에 놓았을 때의 대비를 먼저 재고, 미달한
색만 색상을 유지한 채 명도를 낮춰 4.5:1 을 넘겼다. 측정값은 ADR-0037 에 적었다.

심각도는 참고 화면의 빨강·주황·노랑·초록 4색 램프를 가져오지 않는다. P1 만 빨강이고
P2~P4 는 무채색 농도다. P1 은 정의상 적대 행위가 임무에 입힌 가장 큰 효과라서
ADR-0012 의 빨강과 뜻이 같다.

U11 의 token-parity 게이트를 두 모드 검사로 늘렸다. 모드가 둘이 되면 한쪽만 고치고
다른 쪽을 잊는 사고가 반드시 난다. 일부러 깨뜨려 잡히는 것을 보고 되돌렸다.

기본은 다크, 즉 지금 동작이다. 와이어 모드는 다크 전용으로 두고 라이트에서 사유와
함께 비활성한다 - U7 이 측정한 대비 바닥값이 어두운 배경 전제다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: SOC 셸과 최상위 전환

**Files:**
- Create: `ui/src/soc/Shell.jsx`, `ui/src/soc/nav.js`
- Modify: `ui/src/App.jsx`, `ui/src/ui/Topbar.jsx`, `ui/src/style.css`
- Test: `ui/src/__tests__/soc-nav.test.js`

**Interfaces:**
- Consumes: `clock.js`, `alerts.js`, `triage.js` (Task 3~5)
- Produces: `nav.js` 가 `NAV` 와 `SCREENS` 를 내보낸다. `NAV` 는 `[{ group, items: [{ id, label, badge? }] }]`, `SCREENS` 는 `{ [id]: '파일이름.jsx' }`. 두 키 집합이 같아야 한다. `Shell.jsx` 가 `{ screen, onScreen, alerts, triage, clock, ... }` 를 받는다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NAV, SCREENS } from '../soc/nav.js'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

describe('SOC 내비', () => {
  it('세 묶음이다', () => {
    expect(NAV.map((g) => g.group)).toEqual(['관제', '분석', '기록'])
  })
  it('여섯 화면이다', () => {
    const ids = NAV.flatMap((g) => g.items.map((i) => i.id))
    expect(ids).toEqual(['dashboard', 'alerts', 'incident', 'attack', 'assets', 'audit'])
  })
  // Review Focus: 내비에 빈 항목을 걸지 않는다
  it('모든 항목이 실제 파일로 연결된다', () => {
    for (const id of Object.keys(SCREENS)) {
      expect(existsSync(here(`../soc/${SCREENS[id]}`)), `${id} -> ${SCREENS[id]}`).toBe(true)
    }
  })
  it('내비 항목과 화면 표의 키가 정확히 같다', () => {
    const ids = NAV.flatMap((g) => g.items.map((i) => i.id)).sort()
    expect(Object.keys(SCREENS).sort()).toEqual(ids)
  })
  it('데이터가 없는 화면을 만들지 않았다', () => {
    const ids = NAV.flatMap((g) => g.items.map((i) => i.id))
    for (const banned of ['vulnerabilities', 'threatintel', 'iam', 'playbooks', 'automation']) {
      expect(ids).not.toContain(banned)
    }
  })
})
```

- [ ] **Step 2: 실패를 확인하고 `nav.js` 와 `Shell.jsx` 를 쓴다**

```bash
npx --prefix ui vitest run src/__tests__/soc-nav.test.js 2>&1 | tail -4
```
Expected: FAIL.

```js
// ui/src/soc/nav.js
//
// 내비에 비어 있는 항목을 걸지 않는다. 눌러서 빈 화면이 나오면 그 화면 하나가
// 아니라 화면 전체의 신뢰가 깎인다. 그래서 여기 있는 여섯은 전부 우리 데이터로
// 실제 채워지는 것이고, 참고 화면(enigmart)의 취약점 관리·위협 인텔·접근 제어는
// 뒤에 데이터가 없어서 만들지 않았다. 이유는 설계서 7.2 에 적혀 있다.

export const NAV = [
  { group: '관제', items: [
    { id: 'dashboard', label: '대시보드' },
    { id: 'alerts', label: '경보', badge: 'unhandled' },
    { id: 'incident', label: '인시던트', badge: 'open' },
  ] },
  { group: '분석', items: [
    { id: 'attack', label: 'ATT&CK' },
    { id: 'assets', label: '자산', badge: 'assets' },
  ] },
  { group: '기록', items: [
    { id: 'audit', label: '감사 로그' },
  ] },
]

export const SCREENS = {
  dashboard: 'Dashboard.jsx',
  alerts: 'AlertQueue.jsx',
  incident: 'IncidentDetail.jsx',
  attack: 'AttackCoverage.jsx',
  assets: 'AssetList.jsx',
  audit: 'AuditLog.jsx',
}
```

`Shell.jsx` 는 좌측 내비와 화면 전환, 상단의 시계·배속·재생정지, 하단 상태 바를 그린다. 하단 상태 바에는 **엔진 상태**(리플레이 t, 출처별 경보 수, 모델 연결 여부, 패리티)를 적는다. 참고 화면의 EPS·NetFlow·EDR 센서는 우리에게 없다.

- [ ] **Step 3: 최상위 전환을 붙인다**

`ui/src/App.jsx` 에 `surface` 상태(`'cop' | 'soc'`)를 두고 `Topbar` 좌측에 토글을 그린다. `?surface=soc` 딥링크도 받는다(기존 `pick()` 규약을 따른다).

- [ ] **Step 4: 여섯 화면의 뼈대를 만든다**

Task 8 이 내용을 채운다. 여기서는 각 파일이 제목과 "이 화면은 Task 8 에서 채운다" 가 아니라 **최소한의 실제 내용**을 그리게 한다. 빈 화면을 만들지 않는 것이 이 태스크의 시험이 요구하는 것이다. 최소 내용은 각각 이렇다.

- `Dashboard.jsx`: 출처별 경보 수와 상태별 처리 현황 숫자
- `AlertQueue.jsx`: 경보 표(시각·자산·기법·심각도·출처·상태)
- `IncidentDetail.jsx`: 선택된 경보의 제목·시각·기법·자산과 분류 버튼 셋
- `AttackCoverage.jsx`: 시나리오에 등장한 전술×기법 목록
- `AssetList.jsx`: 자산 표(id·유형·현재 침해도·연관 경보 수)
- `AuditLog.jsx`: 감사 로그 표와 JSON 내보내기 버튼

- [ ] **Step 5: 브라우저에서 여섯 화면을 전부 눌러 본다**

개발 서버에서 SOC 로 전환하고 내비 여섯을 차례로 누른다. **빈 화면이 하나도 없어야 하고 콘솔 오류가 0 이어야 한다.**

- [ ] **Step 6: 시험과 커밋**

```bash
npx --prefix ui vitest run --reporter=basic 2>&1 | tail -3
git add ui/src/soc ui/src/App.jsx ui/src/ui/Topbar.jsx ui/src/style.css ui/src/__tests__/soc-nav.test.js
git commit -m "$(cat <<'EOF'
soc: 셸과 최상위 전환 - 상황도 옆에 두 번째 화면

참고 화면 다섯 장이 전부 좌측 내비를 가진 셸 구조다. SOC 도 그렇게 간다. 최상위
토글로 들어오면 그 안에서 또 전환된다.

내비에 비어 있는 항목을 걸지 않는다. 여섯은 전부 우리 데이터로 실제 채워지는
것이고, 취약점 관리와 위협 인텔은 뒤에 데이터가 없어서 만들지 않았다. 내비 항목이
전부 실제 파일로 연결되는 것을 시험이 고정한다.

하단 상태 바는 참고 화면의 EPS·NetFlow·EDR 센서 자리를 쓰되 내용을 엔진 상태로
바꿨다. 그런 수집기가 우리에게 없다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 여섯 화면을 채운다

**Files:**
- Modify: `ui/src/soc/*.jsx` 여섯 개
- Modify: `ui/src/style.css`
- Test: `ui/src/__tests__/soc-aggregate.test.js`

**Interfaces:**
- Consumes: Task 4 의 `buildAlerts`, Task 5 의 `counts`/`stateOf`/`move`/`exportLog`, 기존 `engine.js` 의 `runStep`·`containmentCandidates`, 기존 `facts.js`

- [ ] **Step 1: 집계가 출처를 안 섞는 시험을 쓴다**

```js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { crisisLevel, topBy } from '../soc/metrics.js'

describe('위기단계', () => {
  it('다섯 단계이고 임무 저하에서 파생한다', () => {
    expect(crisisLevel(0)).toBe('정상')
    expect(crisisLevel(1)).toBe('심각')
    const names = [0, .1, .3, .6, 1].map(crisisLevel)
    expect(new Set(names).size).toBeGreaterThan(1)
    expect(names.every((n) => ['정상', '관심', '주의', '경계', '심각'].includes(n))).toBe(true)
  })
})

describe('Top 집계', () => {
  const alerts = [
    { id: 'a', origin: 'scenario', assets: ['X'], technique: 'T1', severity: 'P1' },
    { id: 'b', origin: 'synthetic', assets: ['X'], technique: null, severity: 'P4' },
    { id: 'c', origin: 'scenario', assets: ['Y'], technique: 'T1', severity: 'P2' },
  ]
  it('축이 자산·기법이고 국가나 IP 가 아니다 (ADR-0002)', () => {
    expect(Object.keys(topBy(alerts))).toEqual(['asset', 'technique'])
  })
  it('출처별로 따로 센다', () => {
    const t = topBy(alerts)
    expect(t.asset.scenario.X).toBe(1)
    expect(t.asset.synthetic.X).toBe(1)
  })
})

describe('화면에 국가 축이 없다', () => {
  it('soc 아래 어떤 파일도 country 를 집계하지 않는다', () => {
    const dir = fileURLToPath(new URL('../soc/', import.meta.url))
    const { readdirSync } = require('node:fs')
    for (const f of readdirSync(dir)) {
      const src = readFileSync(dir + f, 'utf8')
      expect(src, f).not.toMatch(/\bcountry\b|\bgeoip\b/i)
    }
  })
})
```

- [ ] **Step 2: `metrics.js` 와 여섯 화면을 채운다**

화면별 내용은 설계서 7.3(대시보드)과 7.4(인시던트 상세)의 배치를 따른다. 특히 7.4 에서 가져오는 것과 바꾸는 것:

- **ATT&CK 칩**: 그대로 가져온다. `step.gt[].technique` 가 실제로 있다
- **감사 추적을 상세 안 우하단에** 두는 배치: 그대로 가져온다
- **대응 절차 체크리스트**: 아무것도 실행하지 않는다. 사람이 체크하고 체크가 감사 로그에 한 줄 남는다
- **`Contain Host` 버튼은 만들지 않는다.** 호스트를 격리하는 버튼이기 때문이다. 자리에 `이관 건의`
- **Evidence Artifacts, Affected User, Comments 는 뺀다.** 포렌식 아티팩트도 사용자 계정 모델도 없다
- 운영 경보 상세에는 "임무 영향 없음 · MC-CyCOP 자체 자산" 이라 쓴다

- [ ] **Step 3: 브라우저에서 확인한다**

1280×800 과 390×843 둘 다에서 여섯 화면을 본다. 확인할 것: 콘솔 오류 0, 가로 스크롤 없음, 하단 고지 문장(`합성 경보는 배경이고 탐지 성능의 근거가 아니다`)이 항상 보임, 심각도 색이 P1 만 빨강.

- [ ] **Step 4: 시험과 커밋**

```bash
npx --prefix ui vitest run --reporter=basic 2>&1 | tail -3
git add ui/src/soc ui/src/style.css ui/src/__tests__/soc-aggregate.test.js
git commit -m "$(cat <<'EOF'
soc: 여섯 화면을 채운다

인시던트 상세는 enigmart 의 incident-detail 배치를 거의 그대로 가져왔다. ATT&CK
칩과 상세 안 우하단의 감사 추적이 특히 그렇다. 두 군데만 바꿨다. Contain Host
버튼은 만들지 않았고(호스트를 격리하는 버튼이다, ADR-0004) 그 자리에 이관 건의가
들어간다. Response Playbook 은 아무것도 실행하지 않는 체크리스트로만 들어가고
체크가 감사 로그에 남는다.

Top5 의 축은 자산·임무·ATT&CK 기법이다. 참고 화면의 공격국가·공격자IP 는
ADR-0002 가 막고, 전술망에는 그 축 자체가 없다. soc 아래 어떤 파일도 country 를
집계하지 않는 것을 시험이 고정한다.

집계 위젯은 세 출처를 따로 센다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: LLM provider 어댑터와 AWS 관제 평면

**Files:**
- Create: `ui/src/llm/index.mjs`, `ui/src/llm/ollama.mjs`, `ui/src/llm/anthropic.mjs`, `ui/src/soc-events.js`
- Modify: `ui/src/staff-llm.mjs`, `ui/src/config.js`, `ui/tools/staff-eval.mjs`, `infra/demo-static.yaml`
- Test: `ui/src/__tests__/llm-adapter.test.js`, `ui/src/__tests__/soc-events.test.js`

**Interfaces:**
- Produces: 각 provider 가 `chat({ system, messages, schema, effort })` → `{ text, obj, ms }` 를 만족한다. 상위 코드는 어느 쪽인지 모른다.
- Produces: `soc-events.js` 가 `normalize(raw)` → `Alert[]`(`origin: 'ops'`), `fetchOps(since, fetchImpl)` 을 내보낸다.

- [ ] **Step 1: 어댑터 시험을 쓴다**

```js
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pickProvider } from '../llm/index.mjs'
import * as ollama from '../llm/ollama.mjs'
import * as anthropic from '../llm/anthropic.mjs'

describe('두 provider 가 같은 인터페이스를 만족한다', () => {
  for (const [name, mod] of [['ollama', ollama], ['anthropic', anthropic]]) {
    it(`${name} 이 chat 을 내보낸다`, () => {
      expect(typeof mod.chat).toBe('function')
      expect(mod.chat.length).toBeLessThanOrEqual(2)
    })
  }
  it('설정이 provider 를 고른다', () => {
    expect(pickProvider({ provider: 'anthropic' })).toBe(anthropic)
    expect(pickProvider({ provider: 'ollama' })).toBe(ollama)
    expect(pickProvider({})).toBe(ollama)          // 기본은 현행
    expect(pickProvider({ provider: '없는것' })).toBe(ollama)
  })
})

describe('키가 브라우저에 들어가지 않는다', () => {
  const src = readFileSync(fileURLToPath(new URL('../llm/anthropic.mjs', import.meta.url)), 'utf8')
  it('api.anthropic.com 을 직접 부르지 않는다', () => {
    expect(src).not.toMatch(/api\.anthropic\.com/)
  })
  it('키를 담을 이름이 없다', () => {
    expect(src).not.toMatch(/apiKey|api_key|ANTHROPIC_API_KEY|x-api-key/i)
  })
  it('동일 출처 경로로만 간다', () => {
    const urls = [...src.matchAll(/fetch\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) expect(u, u).toMatch(/^\$\{[^}]*\}\/|^\//)
  })
})

describe('모델 이름을 하드코딩하지 않는다 (ADR-0007)', () => {
  it('config 가 덮어쓴다', () => {
    const dir = fileURLToPath(new URL('../llm/', import.meta.url))
    for (const f of readdirSync(dir)) {
      const src = readFileSync(dir + f, 'utf8')
      const hits = [...src.matchAll(/claude-[a-z0-9-]+/g)].map((m) => m[0])
      // 기본값 하나는 허용한다. 호출부에 박히면 안 된다.
      expect(hits.length, `${f}: ${hits.join(', ')}`).toBeLessThanOrEqual(1)
    }
  })
})
```

- [ ] **Step 2: 운영 경보 시험을 쓴다**

```js
import { describe, it, expect } from 'vitest'
import { normalize, fetchOps } from '../soc-events.js'

// Review Focus 5
describe('운영 경보에 원본 IP 가 들어오면', () => {
  const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/
  it('어떤 필드에도 IPv4 를 남기지 않는다', () => {
    const raw = [{ at: '2026-11-10T06:00:00Z', rule: 'rate-limit', action: 'BLOCK',
                   fingerprint: 'a3f1c2', clientIp: '203.0.113.9',
                   detail: '203.0.113.9 에서 1분에 400회' }]
    const out = normalize(raw)
    expect(JSON.stringify(out)).not.toMatch(IPV4)
  })
  it('국가 코드도 버린다 (ADR-0002)', () => {
    const out = normalize([{ at: 'x', rule: 'r', action: 'BLOCK', fingerprint: 'f', country: 'KR' }])
    expect(JSON.stringify(out)).not.toMatch(/\bKR\b|country/)
  })
  it('출처가 ops 이고 임무 영향이 없다', () => {
    const out = normalize([{ at: 'x', rule: 'r', action: 'BLOCK', fingerprint: 'f' }])
    expect(out[0].origin).toBe('ops')
    expect(out[0].assets).toEqual([])
  })
  it('지문이 없으면 그 건을 버린다. 익명화되지 않은 것을 띄우지 않는다', () => {
    expect(normalize([{ at: 'x', rule: 'r', action: 'BLOCK' }])).toEqual([])
  })
})

describe('폴링', () => {
  it('동일 출처 경로로만 간다', async () => {
    let seen = null
    const fake = async (u) => { seen = u; return { ok: true, json: async () => ({ events: [] }) } }
    await fetchOps(0, fake)
    expect(seen).toMatch(/^\/api\/soc\/events/)
  })
  it('프록시가 죽어도 던지지 않고 빈 배열을 준다', async () => {
    const dead = async () => { throw new Error('ECONNREFUSED') }
    await expect(fetchOps(0, dead)).resolves.toEqual([])
  })
})
```

- [ ] **Step 3: 실패를 확인하고 구현한다**

```bash
npx --prefix ui vitest run src/__tests__/llm-adapter.test.js src/__tests__/soc-events.test.js 2>&1 | tail -5
```
Expected: FAIL.

`ollama.mjs` 는 `staff-llm.mjs` 의 현행 `/api/chat` 호출을 **그대로** 옮긴다. `anthropic.mjs` 는 동일 출처 `/api/llm` 으로만 가고 구조화 출력을 `output_config.format` 으로 번역한다. `soc-events.js` 의 `normalize` 는 **허용 목록 방식**으로 필드를 고른다(`at`, `rule`, `action`, `fingerprint`, `severity`). 버릴 것을 지우는 방식이 아니라 가져올 것만 가져오는 방식이어야 새 필드가 추가돼도 새지 않는다.

- [ ] **Step 4: 평가를 양쪽에서 돌린다 (ADR-0007 의 조건)**

`ui/tools/staff-eval.mjs` 에 `--provider` 를 붙이고 골든셋 38항목을 양쪽에서 돌린다. 결과를 `eval/results/` 에 각각 남긴다. **한쪽만 돌린 결과를 "평가했다" 라고 적지 않는다.**

- [ ] **Step 5: infra 템플릿에 조건부 리소스를 더한다**

`infra/demo-static.yaml` 에 WAF, CloudTrail, `soc-events` Lambda, `llm-proxy` Lambda 를 **조건부 리소스**로 더한다. **이 저장소의 어떤 스크립트도 AWS 자원을 만들지 않는다** (ADR-0029). 스택을 치는 것은 사람이다.

- [ ] **Step 6: 시험과 커밋**

```bash
npx --prefix ui vitest run --reporter=basic 2>&1 | tail -3
git add ui/src/llm ui/src/soc-events.js ui/src/staff-llm.mjs ui/src/config.js ui/tools/staff-eval.mjs infra/demo-static.yaml ui/src/__tests__/
git commit -m "$(cat <<'EOF'
soc: LLM provider 어댑터와 AWS 관제 평면

ADR-0007 을 개정하지 않는다. 그 ADR 이 이미 "개발 중 API 사용은 어댑터 뒤에 있는
한 문제없다" 고 적고 있고, 조건 셋(어댑터 뒤, 공통 분모만, 평가에 온프렘 후보
포함)을 전부 지킨다.

키가 브라우저에 들어가지 않는다. config.js 가 이미 적어 둔 proxied 자세(/api/llm
동일 출처)로만 가고, api.anthropic.com 을 직접 부르는 코드도 키를 담을 이름도 없는
것을 시험이 고정한다.

운영 경보 정규화는 허용 목록 방식이다. 버릴 것을 지우는 방식이 아니라 가져올 것만
가져온다 - 프록시에 새 필드가 생겨도 새지 않는다. 지문이 없는 건은 버린다.
익명화되지 않은 것을 화면에 띄우느니 안 띄운다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 마무리

아홉 태스크가 끝나면 ADR 넷을 쓴다. 0034(SOC 콘솔), 0035(합성 경보 표기), 0036(Claude provider), 0037(테마 두 모드), 0038(AWS 관제 평면). 각 ADR 의 숫자는 **구현 중에 실제로 잰 값**으로 채운다. 설계서 13절의 미해결 여섯이 그 자리다.

그 다음 전체 게이트.

```bash
npm --prefix ui run build
.\scripts\Invoke-Gates.ps1
node ui/tools/parity.mjs        # 1622 / 0 유지
node ui/tools/token-parity.mjs  # 두 모드
node ui/tools/verify-scenarios.mjs
```
