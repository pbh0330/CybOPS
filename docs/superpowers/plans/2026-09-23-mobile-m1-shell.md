# 모바일 M1 - 컴팩트 껍데기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 좁은 화면(≤ 860px)에서 상황도가 단일 컬럼 무대 + 하단 시트로 서고, 데스크톱 레이아웃은 한 픽셀도 바뀌지 않는다.

**Architecture:** `matchMedia` 를 구독하는 훅이 `.app` 에 `data-compact="1"` 을 달고, CSS 가 그 속성으로 레이아웃을 갈아끼운다. 레일 내용은 **같은 React 노드를 다른 컨테이너에 렌더**한다(두 벌 존재 금지). 시트의 스냅 계산만 순수 함수로 떼어 테스트한다.

**Tech Stack:** React 18, Vite 5, vitest 3, 순수 CSS(새 라이브러리 없음).

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-compact-design.md`

## Global Constraints

- **데스크톱(> 860px) 레이아웃은 변하지 않는다.** 모든 컴팩트 규칙은 `[data-compact="1"]` 또는 `@media (max-width: 860px)` 안에만 쓴다. 기존 선택자의 값을 고치지 않는다.
- 크롬은 무채색, 빨강(`#ff4d5e`)은 공격 전용(ADR-0024/0025).
- 새 npm 의존성을 추가하지 않는다.
- 엔진(`ui/src/engine.js`, `attack.js`)을 건드리지 않는다. `node ui/tools/parity.mjs` 는 1622 값 0 불일치를 유지한다.
- `npm test` 는 현재 75개이고, 이 계획이 끝나면 77개 이상이어야 한다(줄어들면 안 된다).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Playwright MCP 는 저장소 루트와 `.playwright-mcp/` 아래에만 쓸 수 있다. 개발 서버는 이미 `http://localhost:5180` 에 떠 있을 수 있으니 먼저 확인하고 재사용한다.

---

### Task 1: `useCompact` 훅과 `data-compact` 배선

**Files:**
- Create: `ui/src/useCompact.js`
- Modify: `ui/src/App.jsx`
- Test: `ui/src/__tests__/sheet.test.js` (이 태스크에서 만들고 Task 2 가 이어 쓴다)

**Interfaces:**
- Produces: `export const COMPACT_QUERY = '(max-width: 860px)'`, `export function useCompact()` → `boolean`. Task 2·3 이 이 훅을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// ui/src/__tests__/sheet.test.js
import { describe, it, expect } from 'vitest'
import { COMPACT_QUERY } from '../useCompact.js'

describe('compact breakpoint', () => {
  it('is a max-width query at 860px', () => {
    expect(COMPACT_QUERY).toBe('(max-width: 860px)')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```
cd ui; npx vitest run sheet
```
기대: `Failed to resolve import "../useCompact.js"`.

- [ ] **Step 3: 훅을 만든다**

```js
// ui/src/useCompact.js
//
// One signal, two consumers: CSS gets it as a data attribute on .app, and the
// few things CSS cannot do (which view opens by default, whether the sheet
// exists at all) read the boolean. Keeping both on one matchMedia means they
// can never disagree about what "compact" is.

import { useEffect, useState } from 'react'

export const COMPACT_QUERY = '(max-width: 860px)'

export function useCompact() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(COMPACT_QUERY).matches
      : false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(COMPACT_QUERY)
    const onChange = (e) => setCompact(e.matches)
    setCompact(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return compact
}
```

- [ ] **Step 4: App 에 배선한다**

`ui/src/App.jsx`: `import { useCompact } from './useCompact.js'`, 컴포넌트 안에서
`const compact = useCompact()`, 그리고 루트를
`<div className="app" data-compact={compact ? '1' : undefined}>` 로 바꾼다.

`data-compact={compact ? '1' : undefined}` 로 쓴다 - `'0'` 을 넣으면 CSS 에서
`[data-compact]` 존재 검사를 하는 실수가 조용히 통과한다.

- [ ] **Step 5: 테스트가 통과하는지 본다**

```
cd ui; npx vitest run
```
기대: 76개 통과(기존 75 + 1).

- [ ] **Step 6: 커밋**

```
ui: 컴팩트 신호 하나 - matchMedia 860px 을 data-compact 으로 내보낸다
```

---

### Task 2: 하단 시트 (`Sheet.jsx` + `snapTo`)

**Files:**
- Create: `ui/src/ui/Sheet.jsx`
- Modify: `ui/src/__tests__/sheet.test.js`, `ui/src/style.css`

**Interfaces:**
- Consumes: Task 1 의 `useCompact`(App 이 이미 호출하므로 Sheet 는 컴팩트에서만 렌더된다).
- Produces: `export function snapTo(y, points)` → `points` 중 `y` 에 가장 가까운 값.
  `export default function Sheet({ peek, children, raised, onStateChange })`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// ui/src/__tests__/sheet.test.js 에 추가
import { snapTo } from '../ui/Sheet.jsx'

describe('snapTo', () => {
  it('picks the nearest snap point', () => {
    expect(snapTo(10, [0, 100, 300])).toBe(0)
    expect(snapTo(60, [0, 100, 300])).toBe(100)
    expect(snapTo(140, [0, 100, 300])).toBe(100)
    expect(snapTo(260, [0, 100, 300])).toBe(300)
  })
  it('ties go to the lower point, so a half-drag never jumps past the middle', () => {
    expect(snapTo(50, [0, 100])).toBe(0)
  })
  it('clamps outside the range', () => {
    expect(snapTo(-40, [0, 100, 300])).toBe(0)
    expect(snapTo(9999, [0, 100, 300])).toBe(300)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```
cd ui; npx vitest run sheet
```
기대: `snapTo is not a function` 또는 import 실패.

- [ ] **Step 3: 시트를 만든다**

```jsx
// ui/src/ui/Sheet.jsx
//
// The rail's content does not change on a phone - only where it lives. So this
// is a container, not a second rail: App passes the same children it would
// have put in <aside class="rail">.

import { useEffect, useRef, useState } from 'react'

// Nearest snap point. Ties go to the lower (more closed) point so that letting
// go halfway never opens further than the user dragged.
export function snapTo(y, points) {
  const sorted = [...points].sort((a, b) => a - b)
  let best = sorted[0]
  let bestDist = Infinity
  for (const p of sorted) {
    const d = Math.abs(p - y)
    if (d < bestDist) { bestDist = d; best = p }
  }
  return best
}

const STATES = ['peek', 'half', 'full']

export default function Sheet({ peek, children, raised, onStateChange }) {
  const [state, setState] = useState('peek')
  const ref = useRef(null)
  const drag = useRef(null)

  // A selection raises the sheet, but only from peek: once the user has set a
  // height, nothing takes it away from them.
  useEffect(() => {
    if (raised && state === 'peek') setState('half')
  }, [raised])          // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (onStateChange) onStateChange(state) }, [state, onStateChange])

  function heights() {
    const h = typeof window !== 'undefined' ? window.innerHeight : 800
    return { peek: 56, half: Math.round(h * 0.5), full: Math.round(h * 0.86) }
  }

  function onPointerDown(e) {
    const el = ref.current
    if (!el) return
    drag.current = { startY: e.clientY, startH: el.getBoundingClientRect().height }
    el.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    const el = ref.current
    if (!el || !drag.current) return
    const next = drag.current.startH + (drag.current.startY - e.clientY)
    el.style.height = Math.max(56, next) + 'px'
  }

  function onPointerUp(e) {
    const el = ref.current
    if (!el || !drag.current) return
    const hs = heights()
    const now = el.getBoundingClientRect().height
    const target = snapTo(now, [hs.peek, hs.half, hs.full])
    const name = STATES.find((s) => hs[s] === target) || 'peek'
    el.style.height = ''
    drag.current = null
    el.releasePointerCapture(e.pointerId)
    setState(name)
  }

  function cycle() {
    setState((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'))
  }

  return (
    <div className="sheet" data-state={state} ref={ref}>
      <button
        type="button" className="sheet-grip" onClick={cycle}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        aria-label="패널 높이"
      >
        <span className="sheet-bar" />
        <span className="sheet-peek">{peek}</span>
      </button>
      <div className="sheet-body">{children}</div>
    </div>
  )
}
```

- [ ] **Step 4: CSS 를 더한다**

`ui/src/style.css` 끝에 새 절로. 색은 쓰지 않는다 - 기존 표면 토큰만 쓴다.

```css
/* ------------------------------------------------------- compact: sheet */

.sheet { display: none; }

[data-compact="1"] .sheet {
  display: flex; flex-direction: column;
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  background: var(--surface-chrome);
  border-top: 1px solid var(--line-strong);
  border-radius: 12px 12px 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  transition: height .18s ease;
}
[data-compact="1"] .sheet[data-state="peek"] { height: 56px; }
[data-compact="1"] .sheet[data-state="half"] { height: 50dvh; }
[data-compact="1"] .sheet[data-state="full"] { height: 86dvh; }

.sheet-grip {
  flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px;
  background: none; border: none; border-radius: 12px 12px 0 0;
  padding: 8px 12px 6px; width: 100%; min-height: 44px;
  touch-action: none;                 /* the grip drags; the page must not */
}
.sheet-bar { width: 36px; height: 4px; border-radius: 2px; background: var(--line-strong); }
.sheet-peek {
  font-size: 12px; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
.sheet-body {
  flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
[data-compact="1"] .sheet[data-state="peek"] .sheet-body { display: none; }
```

- [ ] **Step 5: 테스트가 통과하는지 본다**

```
cd ui; npx vitest run
```
기대: 80개 통과(76 + `snapTo` 4개).

- [ ] **Step 6: 커밋**

```
ui: 하단 시트 - 엿보기·절반·전체 세 단, 손잡이를 끌면 가장 가까운 단으로 선다
```

---

### Task 3: 단일 컬럼 무대와 레일 이사

**Files:**
- Modify: `ui/src/App.jsx`, `ui/src/style.css`

**Interfaces:**
- Consumes: Task 1 `useCompact`, Task 2 `Sheet`.
- Produces: 컴팩트에서 `<Rail>` 의 자식이 `<Sheet>` 안에 렌더된다. **레일 내용이 두 벌
  존재하면 안 된다.**

- [ ] **Step 1: App 의 렌더를 가른다**

`ui/src/App.jsx` 에서 지금 `<Rail ... />` 을 부르는 자리(약 474행)를 다음 모양으로 바꾼다.
`railEl` 을 **한 번만** 만들고 둘 중 한 곳에 넣는다:

```jsx
const railEl = (
  <Rail
    graph={graph} step={step} scenarioId={scenarioId} edited={edited}
    when={when} tab={tab} onTab={setTab}
    requests={requests} onRequest={onRequest}
    selectedData={selectedData} onToast={setToast} mode={mode}
    editor={editorRef} rules={rules} sandbox={isSandbox}
    payload={payload} idx={idx} onSeekIdx={(i) => setIdx(i)}
    wargameSlot={mode === 'wargame' ? (
      <Wargame
        key={scenarioId}
        graph={graph} payload={payload} idx={idx} game={game} onGame={setGame}
        onSeekIdx={(i) => setIdx(i)} onToast={setToast} onMode={setMode}
        sandbox={isSandbox}
      />
    ) : null}
  />
)
```

그리고 `.main` 안에서는 `{!compact && railEl}`, `.app` 의 마지막에
`{compact && <Sheet peek={peekText} raised={!!selectedData}>{railEl}</Sheet>}`.

`peekText` 는 기존 `kpiOf`/`missionRows` 파생값을 재사용해 만든다(새 계산을 만들지 않는다).
교전 중이면 `턴 {n}/{m} · 점수 {s}`, 아니면 우선순위 최상위 임무 한 줄
(`지휘통제 P1 0.0%`). 파생 함수가 없으면 `derive.js` 의 기존 export 로 조합하고, 그
조합 로직은 App 안에 두지 말고 `derive.js` 에 `export function peekLine(graph, step, game)`
으로 추가한 뒤 테스트를 한 개 붙인다.

- [ ] **Step 2: 레이아웃 CSS**

```css
/* ------------------------------------------------- compact: single column */

@media (max-width: 860px) {
  .app { height: 100dvh; }
  .main { grid-template-columns: 1fr; }
  .main.is-editing { grid-template-columns: 1fr; }
  .rail { display: none; }          /* 내용은 시트로 갔다 */
  .board { min-width: 0; }
  /* 시트 엿보기(56px)와 타임라인이 무대를 가리지 않게 */
  .main { padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px)); }
}
```

`.app { height: 100vh }` 는 그대로 두고 컴팩트에서만 `100dvh` 로 덮는다 - `dvh` 를 모르는
브라우저는 기존 값을 쓴다.

- [ ] **Step 3: 폰 기본 뷰를 지도로**

`view` 상태 초기화 지점을 찾아, **컴팩트이고 `graph.geo.georef` 가 있을 때만** `'geo'` 로
시작하게 한다. 이미 사용자가 뷰를 바꿨으면 덮지 않는다(초기값 한 번만).

georef 가 없는 시나리오(`defnet-01`)에서는 그래프가 기본이다 - 없는 뷰를 기본으로 둘 수
없다. 시나리오를 바꿀 때도 같은 규칙이 적용되는지 확인한다.

- [ ] **Step 4: 눈으로 확인한다**

개발 서버(`http://localhost:5180`, 없으면 `cd ui; npm run dev`)를 Playwright 로 연다.

1. 390×844: 무대가 전체 폭이고 지도가 먼저 보인다. 시트 엿보기 한 줄이 보인다.
   손잡이를 탭하면 절반, 한 번 더 탭하면 전체, 한 번 더 탭하면 엿보기로 돌아온다.
2. 지도에서 자산을 탭하면 시트가 절반으로 올라오고 인스펙터가 보인다.
3. 1600×900 으로 되돌리면 **예전과 똑같다** - 레일이 오른쪽에 380px 로 서 있고 시트는
   없다.

스크린샷: `docs/design/screens/2026-09-23-mobile-390-stage.png`,
`...-390-sheet-half.png`, `...-1600-regression.png`.

- [ ] **Step 5: 게이트**

```
cd ui; npx vitest run; npm run build
node ui\tools\parity.mjs
powershell -ExecutionPolicy Bypass -File scripts\Invoke-Gates.ps1
```
기대: 테스트 81개 이상, 빌드 성공, 불일치 0, 게이트 9/9.

- [ ] **Step 6: 커밋**

```
ui: 좁은 화면은 단일 컬럼 - 레일이 시트로 들어가고 폰은 지도로 연다
```

---

### Task 4: 상단바 `⋯` 메뉴와 타임라인 축소

**Files:**
- Modify: `ui/src/ui/Topbar.jsx`, `ui/src/ui/Timeline.jsx`, `ui/src/style.css`

- [ ] **Step 1: 상단바**

컴팩트에서 상단바에 남는 것: 브랜드(`MC-CyCOP`), 시나리오 셀렉트, `⋯` 버튼.
`⋯` 를 누르면 아래로 펼쳐지는 패널에 나머지가 세로로 들어간다 - 뷰 전환, 모드, 라벨 토글,
배속, 교전장 도구. **새 컴포넌트를 만들지 말고** 기존 컨트롤을 그대로 그 패널 안에 옮긴다
(같은 노드를 한 번만 렌더한다. Task 3 의 `railEl` 과 같은 원칙).

패널은 바깥을 탭하거나 Esc 로 닫힌다. `aria-expanded` 를 단다.

KPI 띠는 상단바 밖 한 줄로 내리고:

```css
@media (max-width: 860px) {
  .topbar { height: 56px; padding: 0 12px; padding-top: env(safe-area-inset-top, 0px); }
  .kpis { overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }
  .kpi { scroll-snap-align: start; flex: none; }
}
```

- [ ] **Step 2: 타임라인**

컴팩트에서 남는 것: 이전/재생/다음, 시각, 잠금 배지. `≤ 560px` 에서 스파크라인을 숨긴다.
배속 컨트롤은 상단바 `⋯` 로 갔으므로 여기서는 숨긴다(**지우지 않는다** - 데스크톱에는
그대로 있어야 한다).

- [ ] **Step 3: 확인**

390×844 에서 상단바가 한 줄이고 브랜드가 접히지 않는다. `⋯` 가 열리고 닫힌다. KPI 를
옆으로 넘길 수 있다. 1600×900 회귀 확인.
스크린샷 `docs/design/screens/2026-09-23-mobile-390-topbar.png`.

- [ ] **Step 4: 게이트와 커밋**

```
cd ui; npx vitest run; npm run build
powershell -ExecutionPolicy Bypass -File scripts\Invoke-Gates.ps1
```

```
ui: 좁은 화면 상단바는 한 줄 - 나머지 컨트롤은 점 세 개 뒤로, KPI 는 옆으로 넘긴다
```
