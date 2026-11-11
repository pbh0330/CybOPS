# 모바일 M2 - 터치 동등성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰에서 상황도를 **읽는 것**만이 아니라 **쓰는 것**까지 된다. 겹친 마커를 고를 수 있고, 자산을 지울 수 있고, 마우스에만 있던 정보가 탭으로도 나오고, 누를 것은 손가락 크기다.

**Architecture:** M1 이 만든 것 위에 얹는다 — `useCompact()`, `data-compact="1"`, 하단 시트(`Sheet.jsx`), `⋯` 포털 메뉴. 새 컴포넌트는 만들지 않고 **이미 있는 시트와 인스펙터에 경로를 더한다.** 겹친 마커는 지도 위에서 펼치지 않고 시트가 목록으로 받는다.

**Tech Stack:** React 18, maplibre-gl 5(DOM 마커), 순수 CSS. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-compact-design.md` (5절)

## Global Constraints

- **데스크톱(> 860px)은 변하지 않는다.** 새 CSS 는 `[data-compact="1"]` 또는 `@media (max-width: 860px|560px)` 안에만 쓰고, 기존 규칙은 고치지 않는다. M1 이 1600×900 에서 사각형과 `outerHTML` 이 문자 단위로 같음을 측정해 두었으니 같은 방식으로 확인한다.
- **컨트롤과 레일은 DOM 에 정확히 하나씩 존재한다.** M1 의 `railEl`/포털 규칙을 그대로 지킨다.
- 크롬은 무채색, 빨강(`#ff4d5e`)은 공격 전용(ADR-0024/0025).
- 엔진(`ui/src/engine.js`, `attack.js`, `game.js`)을 건드리지 않는다. `node ui/tools/parity.mjs` 는 1622 값 0 불일치를 유지한다.
- `npm test` 는 현재 **90개**이고 줄어들면 안 된다.
- 삭제는 사람이 누르는 버튼이어야 한다. 자동 실행 경로를 만들지 않는다(ADR-0004).
- 브라우저 확인은 **동일 출처 iframe** 으로 한다 — 이 환경에서 `browser_resize` 가 페이지에 안 먹는다(M1 에서 두 번 확인됨). `localhost:5180` 의 부모 문서를 비우고 `<iframe src="/">` 를 390×844 로 띄워 `contentWindow`/`contentDocument` 로 측정한다.
- 커밋 트레일러 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: 겹친 마커를 시트 목록으로 받는다

**문제(실측)**: 390px 에서 마커가 서로 겹쳐, 위에 있는 마커가 히트 테스트를 가로채 아래 것을 탭할 수 없다. tacnet-01 의 지휘소 주변에서 재현된다.

**Files:**
- Modify: `ui/src/ui/MapPane.jsx`, `ui/src/App.jsx`, `ui/src/ui/Rail.jsx`, `ui/src/style.css`
- Test: `ui/src/__tests__/mapLayers.test.js` (순수 함수만)

**Interfaces:**
- Produces: `ui/src/mapLayers.js` 에 `export function stackAt(points, id, radiusPx)` → 같은 지점에 겹친 자산 id 배열(자기 자신 포함, 정렬됨). `points` 는 `[{ id, x, y }]` 화면 좌표.
- Produces: `MapPane` 의 `onSelect(id, stack)` — 두 번째 인자는 겹친 id 배열(1개면 지금과 같다).

- [ ] **Step 1: 순수 함수부터 테스트를 쓴다**

`ui/src/__tests__/mapLayers.test.js` 에 추가:

```js
import { stackAt } from '../mapLayers.js'

describe('stackAt', () => {
  const pts = [
    { id: 'A', x: 100, y: 100 },
    { id: 'B', x: 108, y: 104 },   // 9px 거리
    { id: 'C', x: 160, y: 100 },   // 60px 거리
  ]
  it('collects what is within the radius, including itself, sorted', () => {
    expect(stackAt(pts, 'A', 22)).toEqual(['A', 'B'])
  })
  it('a lone marker returns just itself', () => {
    expect(stackAt(pts, 'C', 22)).toEqual(['C'])
  })
  it('an unknown id returns an empty array rather than throwing', () => {
    expect(stackAt(pts, 'ZZZ', 22)).toEqual([])
  })
  it('is symmetric: B sees A too', () => {
    expect(stackAt(pts, 'B', 22)).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다** — `cd ui; npx vitest run mapLayers` 에서 `stackAt is not a function`.

- [ ] **Step 3: 순수 함수를 만든다**

`ui/src/mapLayers.js` 에. 반지름은 화면 픽셀이고 호출자가 준다.

```js
// Which markers share a tap. Screen-space, because overlap is a screen
// problem: the same two assets are distinct at z15 and one blob at z11.
export function stackAt(points, id, radiusPx) {
  const self = (points || []).find((p) => p.id === id)
  if (!self) return []
  const r2 = Number(radiusPx) * Number(radiusPx)
  return (points || [])
    .filter((p) => {
      const dx = p.x - self.x, dy = p.y - self.y
      return dx * dx + dy * dy <= r2
    })
    .map((p) => p.id)
    .sort()
}
```

- [ ] **Step 4: MapPane 이 탭에서 겹침을 계산한다**

마커 클릭 핸들러에서, `map.project([lon, lat])` 로 **모든 자산의 화면 좌표**를 구해 `stackAt(points, r.id, 22)` 를 부르고 `onSelect(r.id, stack)` 으로 넘긴다. 22px 은 마커 반지름 정도다 — 상수로 이름을 붙여 둔다(`const TAP_RADIUS_PX = 22`).

컴팩트가 아닐 때도 같은 계산을 하되, 데스크톱에서는 마우스가 정확하므로 `stack` 이 여러 개여도 **App 이 무시한다**(다음 단계). 즉 분기는 App 한 곳에만 둔다.

- [ ] **Step 5: App 이 컴팩트에서만 목록을 띄운다**

`onSelect(id, stack)` 에서: 기존대로 선택을 세우고, **컴팩트이고 `stack.length > 1`** 이면 `setStack(stack)`, 아니면 `setStack(null)`. `Rail` 에 `stack` 을 넘긴다. 선택이 바뀌거나 시나리오가 바뀌면 `stack` 을 비운다.

- [ ] **Step 6: Rail 이 목록을 그린다**

`Inspect` 위에, `stack` 이 있을 때만:

```jsx
{stack && stack.length > 1 && (
  <div className="stack-pick">
    <div className="stack-pick-head">이 위치에 자산 {stack.length}</div>
    {stack.map((id) => (
      <button key={id} type="button" className={id === data?.id ? 'on' : ''}
        onClick={() => onPick(id)}>{assetName(graph, id).ko}<em>{id}</em></button>
    ))}
  </div>
)}
```

`assetName` 은 Rail 이 이미 쓰는 헬퍼다(없으면 그 파일의 기존 이름 조회 방식을 따른다). 버튼 높이는 컴팩트에서 44px 이상.

CSS 는 컴팩트 블록 안에 무채색으로. 선택된 항목은 색이 아니라 `--surface-raised` 와 굵기로 구분한다.

- [ ] **Step 7: 확인**

iframe 390×844, tacnet-01 지리 뷰에서 지휘소 부근 마커를 탭 → 시트가 half 로 올라오고 `이 위치에 자산 N` 목록이 보인다. 두 번째 항목을 누르면 그 자산이 선택되고 지도에서 `is-selected` 가 옮겨 간다. 1600×900 에서는 같은 탭이 목록 없이 바로 그 자산을 연다.

- [ ] **Step 8: 게이트와 커밋**

`cd ui; npx vitest run`(94개 이상), `npm run build`, `node ui\tools\parity.mjs`, `Invoke-Gates.ps1`.

```
ui: 겹친 마커는 시트가 받는다 - 이 위치에 무엇이 있는지 목록으로 고른다
```

---

### Task 2: 인스펙터 삭제 버튼과 탭으로 읽는 정보

**Files:**
- Modify: `ui/src/ui/Rail.jsx`, `ui/src/style.css`

**주의**: 스펙 5절은 "`Delete` 키로 자산 삭제"를 전제하지만 **그런 경로는 없다.** 삭제는 팔레트의 지우개 도구 + 탭(`ui/src/editor.js:263` `handleTap`)이다. 즉 이것은 없는 기능을 만드는 것이 아니라, 폰에서 도구를 바꾸지 않고도 지울 수 있게 하는 일이다.

- [ ] **Step 1: 삭제 버튼**

편집 모드이고 선택이 자산일 때, `Inspect` 의 구성 블록 끝에 버튼 하나. 누르면 곧바로 지우지 않고 **같은 자리에서 확인을 묻는다**(`정말 지울까` + `지운다`/`취소`). 확인 시 `editor.current.removeAsset(id)` 를 부르고 선택을 비운다.

`button.danger` 클래스가 이미 있다(`style.css` 의 `button.danger`). 그것을 쓴다 — 새 색을 만들지 않는다.

관측 모드에서는 버튼이 없다. 교전 중에도 없다(그래프를 바꾸는 행위다).

- [ ] **Step 2: 호버로만 나오던 것을 탭으로도**

`title` 속성으로만 보이는 정보가 두 곳 있다(`Rail.jsx`, `MapPane.jsx` — `grep -n 'title=' ui/src` 로 현재 위치를 확인할 것). 컴팩트에서 그 요소를 탭하면 같은 문자열이 한 줄로 펼쳐지게 한다. 새 툴팁 컴포넌트를 만들지 말고, `<details>`/`<summary>` 나 기존 `.rail-caption` 스타일을 재사용한다.

- [ ] **Step 3: 44px 타깃**

컴팩트 블록 안에서 `.rail button, .sheet button, .stack-pick button, .inspect button { min-height: 44px }` 형태로 한 번에 건다. 다만 **세그먼트 컨트롤(`.seg`)과 탭은 이미 46px** 이므로 중복으로 키우지 않는다 — 실제 높이를 재고 필요한 것만 올린다.

- [ ] **Step 4: 확인**

390×844 편집 모드에서 자산을 놓고, 인스펙터에서 삭제 → 확인 → 그래프에서 사라진다. 되돌리기로 돌아온다. 관측 모드에서는 버튼이 없다. 모든 버튼 높이 ≥ 44px 을 측정해 보고에 최소값을 적는다. 1600×900 회귀.

- [ ] **Step 5: 게이트와 커밋**

```
ui: 폰에서도 지우고 읽는다 - 인스펙터 삭제 버튼, 호버 정보의 탭 경로, 44px 타깃
```

---

### Task 3: 팔레트 가로 스크롤과 터치 드래그

**Files:**
- Modify: `ui/src/style.css`, `ui/src/ui/MapPane.jsx`(필요시)

- [ ] **Step 1: 팔레트를 가로 줄로**

M1 은 컴팩트 편집 모드에서 팔레트를 `max-height: 30dvh` 로 묶어 세로 스크롤시켜 두었다(캔버스가 0px 이 되는 것을 막은 임시 조치). 이제 **가로 한 줄**로 바꾼다: `display: flex; overflow-x: auto; gap; scroll-snap-type: x proximity;` 각 항목 `flex: none`. 높이는 내용에 맞추고 `max-height` 는 걷어낸다.

캔버스가 남는 높이를 갖는지 다시 측정한다(M1 이 273.91px 였다 — 팔레트가 가로가 되면 더 커져야 한다).

- [ ] **Step 2: 마커 터치 드래그를 실제로 확인한다**

M1 에서 마커 드래그는 마우스로만 확인됐다. iframe 390px 편집 모드에서 **포인터 이벤트(pointerType: 'touch')** 로 마커를 끌어 위치가 바뀌는지, 그리고 끌고 난 뒤의 클릭이 선택을 흔들지 않는지 확인한다. 흔들리면 `MapPane` 의 탭 오인 가드를 포인터 기준으로 고친다(지금은 `click` 기준이다).

여기서 실제로 깨지면 그 수정이 이 태스크의 본체다. 안 깨지면 확인만 하고 넘어간다 — 보고에 어느 쪽인지 분명히 적는다.

- [ ] **Step 3: 게이트와 커밋**

```
ui: 팔레트는 가로로 넘기고, 마커는 손가락으로도 끌린다
```
