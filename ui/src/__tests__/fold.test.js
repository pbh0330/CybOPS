import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FOLD_SLACK, FOLD_INIT, foldStep, observeWidth } from '../fold.js'

// jsdom 은 이 저장소에 없다. vitest 환경이 'node' 이고(vitest.config.js) 컴포넌트
// 검사는 전부 순수 함수 + 소스 단언으로 한다. 그래서 `ResizeObserver` 를 폴리필할
// 자리도 없고, 그럴 필요도 없다 - `observeWidth` 가 전역을 `env` 인자로 받으므로
// 관찰자가 있는 환경과 없는 환경을 **둘 다** 가짜 객체로 직접 만들어 본다.
// 없는 환경에서 던지지 않는 것이 ADR-0018(정적 번들, 구형 브라우저)의 요구다.

const M = (scrollWidth, clientWidth) => ({ scrollWidth, clientWidth })
const SIG = 'e|s'

describe('foldStep - 넘치면 접고 안 넘치면 편다', () => {
  it('내용이 상자 안이면 펴 둔다', () => {
    const s = foldStep(FOLD_INIT, M(690, 1010), SIG)
    expect(s.folded).toBe(false)
    expect(s.needed).toBe(0)
  })

  it('내용이 상자를 넘으면 접고, 넘친 내용 폭을 기억한다', () => {
    const s = foldStep(FOLD_INIT, M(1468, 1010), SIG)
    expect(s.folded).toBe(true)
    expect(s.needed).toBe(1468)
  })

  it('여유 안쪽의 넘침은 넘침이 아니다 - 서브픽셀 반올림이기 때문', () => {
    expect(foldStep(FOLD_INIT, M(1010 + FOLD_SLACK, 1010), SIG).folded).toBe(false)
    expect(foldStep(FOLD_INIT, M(1010 + FOLD_SLACK + 1, 1010), SIG).folded).toBe(true)
  })

  it('상자 폭 0 은 판정하지 않는다 - 레이아웃 전이거나 display:none 이다', () => {
    const folded = foldStep(FOLD_INIT, M(1468, 1010), SIG)
    expect(foldStep(folded, M(0, 0), SIG)).toBe(folded)
    expect(foldStep(FOLD_INIT, M(0, 0), SIG).folded).toBe(false)
  })
})

describe('foldStep - 되돌아오는 길은 상자 폭만 본다', () => {
  const folded = foldStep(FOLD_INIT, M(1468, 1010), SIG)

  it('접힌 뒤의 내용 폭은 판정에 들어가지 않는다', () => {
    // 접으면 컨트롤 넷이 패널로 가서 내용이 690 으로 줄지만, 그것은 접었다는
    // 사실의 결과다. 이것을 "이제 들어간다" 로 읽으면 무한 루프가 된다.
    expect(foldStep(folded, M(690, 1010), SIG)).toBe(folded)
  })

  it('기억한 내용 폭 + 여유만큼 상자가 커져야 펴진다', () => {
    expect(foldStep(folded, M(690, 1468 + FOLD_SLACK - 1), SIG).folded).toBe(true)
    expect(foldStep(folded, M(690, 1468 + FOLD_SLACK), SIG).folded).toBe(false)
  })

  it('들어가는 임계값과 나오는 임계값이 다르다 - 그것이 히스테리시스다', () => {
    // 같은 상자 폭 1470: 펴진 상태에서는 접히고(1468 <= 1470+4 이므로 아니다)
    // ... 경계를 정확히 쓴다. 내용 1468 기준으로 접히는 상자 폭의 최대값은
    // 1463(1468 > 1463+4)이고, 펴지는 상자 폭의 최소값은 1472 다.
    expect(foldStep(FOLD_INIT, M(1468, 1463), SIG).folded).toBe(true)
    expect(foldStep(FOLD_INIT, M(1468, 1464), SIG).folded).toBe(false)
    expect(foldStep(folded, M(690, 1471), SIG).folded).toBe(true)
    expect(foldStep(folded, M(690, 1472), SIG).folded).toBe(false)
  })
})

describe('foldStep - 같은 입력은 같은 객체', () => {
  it('값이 안 바뀌면 같은 참조를 돌려준다 - setState 가 거기서 멈춘다', () => {
    const a = foldStep(FOLD_INIT, M(690, 1010), SIG)
    expect(foldStep(a, M(690, 1010), SIG)).toBe(a)
    const b = foldStep(FOLD_INIT, M(1468, 1010), SIG)
    expect(foldStep(b, M(1468, 1010), SIG)).toBe(b)
  })

  it('관찰 콜백을 같은 측정값으로 40번 불러도 상태가 안 바뀐다', () => {
    let s = foldStep(FOLD_INIT, M(1468, 1010), SIG)
    const first = s
    for (let i = 0; i < 40; i++) s = foldStep(s, M(690, 1010), SIG)
    expect(s).toBe(first)
    expect(s.folded).toBe(true)
  })
})

describe('진동 없음 - 접으면 내용이 좁아지는 실제 DOM 을 흉내내어 수렴을 본다', () => {
  // 이 태스크에서 틀리기 가장 쉬운 자리: 패널로 옮기면 툴바가 좁아져 넘침이
  // 사라지고, 그러면 다시 인라인으로 돌아오고, 다시 넘친다. 그 고리를 그대로
  // 돌려 본다 - 내용 폭이 접힘 여부의 함수다.
  const run = (box, inlineW, foldedW, steps = 60) => {
    let s = FOLD_INIT
    const trace = []
    for (let i = 0; i < steps; i++) {
      s = foldStep(s, M(s.folded ? foldedW : inlineW, box), SIG)
      trace.push(s.folded)
    }
    const flips = trace.filter((v, i) => i > 0 && v !== trace[i - 1]).length
    return { folded: s.folded, flips, settled: trace.slice(-20).every((v) => v === s.folded) }
  }

  it('1600x900 의 실측값(내용 1468 / 접힌 뒤 690 / 상자 1010)에서 한 번 접고 멈춘다', () => {
    const r = run(1010, 1468, 690)
    expect(r.folded).toBe(true)
    expect(r.flips).toBe(0) // 첫 걸음에 접히고 그 뒤로 안 움직인다
    expect(r.settled).toBe(true)
  })

  it('상자 폭 600~1700 어디에서도 수렴한다 - 뒤집힘은 많아야 한 번', () => {
    for (let box = 600; box <= 1700; box += 10) {
      const r = run(box, 1468, 690)
      expect(r.settled, `box=${box}`).toBe(true)
      expect(r.flips, `box=${box}`).toBeLessThanOrEqual(1)
      // 어느 쪽으로 수렴했든 그 상태가 그 폭에서 옳아야 한다. 펴진 채로
      // 시작하므로 기준은 "인라인 내용이 그 상자에 들어가는가" 하나다.
      expect(r.folded, `box=${box}`).toBe(1468 > box + FOLD_SLACK)
    }
  })

  it('접힌 내용조차 상자를 넘는 좁은 폭에서도 접힌 채로 멈춘다', () => {
    // compact 밑이 아닌 좁은 데스크톱. 더 접을 것이 없으므로 접힌 채로 있고,
    // 남은 넘침은 .board-toolbar 의 overflow-x: auto 가 받는다.
    const r = run(500, 1468, 690)
    expect(r.folded).toBe(true)
    expect(r.settled).toBe(true)
  })

  it('저장된 구성이 생겨 인라인 폭이 늘어난 경우도 수렴한다', () => {
    // 구성이 하나라도 있으면 삭제 select 가 더 붙는다(최악의 폭). 펴진 상태에서
    // 그 폭이 들어오면 접고, 되돌아오는 임계값도 그만큼 올라간다.
    const r = run(1480, 1468, 690)
    expect(r.folded).toBe(false)
    const wider = run(1480, 1560, 690)
    expect(wider.folded).toBe(true)
    expect(wider.settled).toBe(true)
    expect(wider.flips).toBeLessThanOrEqual(1)
  })
})

describe('foldStep - 구조 서명', () => {
  it('서명이 바뀌면 기억한 폭을 버린다 - 편집 모드를 나오면 툴바가 짧아진다', () => {
    const folded = foldStep(FOLD_INIT, M(1468, 1010), SIG)
    const after = foldStep(folded, M(420, 1010), '-|s')
    expect(after.folded).toBe(false)
    expect(after.needed).toBe(0)
    expect(after.sig).toBe('-|s')
  })

  it('서명이 같으면 기억을 들고 간다', () => {
    const folded = foldStep(FOLD_INIT, M(1468, 1010), SIG)
    expect(foldStep(folded, M(690, 1010), SIG).needed).toBe(1468)
  })
})

describe('observeWidth - ResizeObserver 가 없는 환경에서 던지지 않는다 (ADR-0018)', () => {
  const el = { tag: 'fake' }

  it('관찰자가 있으면 그것을 쓰고, 해제하면 disconnect 한다', () => {
    const log = []
    class RO {
      constructor(cb) { this.cb = cb; log.push('new') }
      observe(node) { log.push(['observe', node === el]) }
      disconnect() { log.push('disconnect') }
    }
    const off = observeWidth(el, () => {}, { ResizeObserver: RO })
    expect(log).toEqual(['new', ['observe', true]])
    off()
    expect(log).toEqual(['new', ['observe', true], 'disconnect'])
  })

  it('관찰자가 없으면 창 크기 이벤트로 대신 듣는다', () => {
    const on = []
    const env = {
      addEventListener: (t, f) => on.push(['on', t, f]),
      removeEventListener: (t, f) => on.push(['off', t, f]),
    }
    let n = 0
    const off = observeWidth(el, () => { n += 1 }, env)
    expect(on[0][1]).toBe('resize')
    on[0][2]()
    expect(n).toBe(1)
    off()
    expect(on[1][0]).toBe('off')
  })

  it('관찰자도 이벤트도 없는 환경에서 던지지 않고 해제 함수를 돌려준다', () => {
    let off
    expect(() => { off = observeWidth(el, () => {}, {}) }).not.toThrow()
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
    expect(() => observeWidth(el, () => {}, null)()).not.toThrow()
    expect(() => observeWidth(null, () => {})()).not.toThrow()
  })
})

// ---------------------------------------------------------------- 소스 단언

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const toolbar = src('../ui/BoardToolbar.jsx')
const topbar = src('../ui/Topbar.jsx')
const css = src('../style.css')
const app = src('../App.jsx')

// (max-width: 860px) 블록만 떼어 낸다 - 중괄호를 센다.
function compactBlock(text) {
  const at = text.indexOf('@media (max-width: 860px)')
  expect(at).toBeGreaterThan(-1)
  const open = text.indexOf('{', at)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(open, i) }
  }
  throw new Error('unbalanced')
}
const COMPACT = compactBlock(css)
const BASE = css.replace(COMPACT, '')

describe('포털은 하나뿐이다', () => {
  it('옮겨 가는 컨트롤 넷은 전부 into() 를 한 번씩만 통과한다', () => {
    for (const name of ['viewSeg', 'sandboxTools', 'labelsChk', 'contribChk']) {
      const wrapped = toolbar.match(new RegExp(`into\\(${name}\\)`, 'g')) || []
      expect(wrapped.length, name).toBe(1)
      // into() 를 거치지 않고 그대로 박아 넣은 자리가 없어야 한다. 있으면
      // 패널과 툴바에 같은 컨트롤이 둘 생긴다.
      const bare = toolbar.match(new RegExp(`\\{\\s*${name}\\s*\\}`, 'g')) || []
      expect(bare.length, name).toBe(0)
    }
  })

  it('지워진 컨트롤이 없다 - 접는 것과 없애는 것은 다르다', () => {
    for (const label of ['화면 맞춤', '교전장 비우기', '시나리오 내보내기', '구성 저장', 'JSON 불러오기', '기여 굵기', '라벨']) {
      expect(toolbar.includes(label), label).toBe(true)
    }
  })

  it('되돌릴 수 없는 `교전장 비우기` 는 패널로 숨기지 않는다', () => {
    // 숨은 메뉴에 들어가면 있는 줄도 모르고 찾다가 누른다. 툴바에 남긴다.
    const danger = toolbar.match(/className="danger"[\s\S]{0,120}/)
    expect(danger).not.toBeNull()
    expect(toolbar.includes('into(') && /into\([^)]*danger/.test(toolbar)).toBe(false)
  })
})

describe('판정은 뷰포트가 아니라 내용이다', () => {
  it('App 은 compact 와 넘침을 OR 로 합쳐 같은 패널로 보낸다', () => {
    expect(app).toMatch(/const foldTools = compact \|\| tbOver/)
    expect(app).toMatch(/menuNode=\{foldTools \? menuNode : null\}/)
    expect(app).toMatch(/onFold=\{setTbOver\}/)
  })

  it('넘침 신호는 COMPACT_QUERY 와 별개다 (ADR-0030)', () => {
    const fold = src('../fold.js')
    // 주석에서 언급하는 것은 좋다(그 둘이 다른 신호라는 설명이다). 코드가
    // 그것을 읽는 것이 안 된다 - 읽으면 임계값 하나에 둘이 묶인다.
    expect(fold.includes("from './useCompact.js'")).toBe(false)
    expect(fold.includes('matchMedia')).toBe(false)
    expect(/^\s*(import|export).*COMPACT_QUERY/m.test(fold)).toBe(false)
    expect(src('../useCompact.js')).toMatch(/COMPACT_QUERY = '\(max-width: 860px\)'/)
  })

  it('뷰(contribOk)는 구조 서명에 안 들어간다 - 패널 안에서 눌리는 것이다', () => {
    const sig = toolbar.match(/const sig = .*/)[0]
    expect(sig.includes('contribOk')).toBe(false)
    expect(sig.includes('editing')).toBe(true)
    expect(sig.includes('sandbox')).toBe(true)
    // 구성 목록과 캡션은 "다시 재기만" 하는 신호 쪽이다
    const probe = toolbar.match(/const probe = .*/)[0]
    expect(probe.includes('plans')).toBe(true)
    expect(probe.includes('editState')).toBe(true)
  })
})

describe('⋯ 패널은 좁은 화면 전용이 아니다', () => {
  it('패널과 그 버튼은 compact 이거나 접혔을 때 렌더된다', () => {
    expect(topbar).toMatch(/const hasMenu = compact \|\| folded/)
    expect(topbar.match(/\{hasMenu && \(/g).length).toBe(2)
    expect(topbar.includes('{compact && (')).toBe(false)
  })

  it('접혀 있다는 것과 그 이유를 운용자가 알 수 있다', () => {
    expect(topbar).toMatch(/tb-menu-why/)
    expect(topbar).toMatch(/menuLabel/)
    expect(css).toMatch(/\.tb-menu-why/)
  })

  it('모드 세그먼트는 좁은 화면에서만 패널에 들어간다 - 넓으면 상단바에 있다', () => {
    expect(topbar).toMatch(/\{!compact && modeSeg\}/)
    expect(topbar).toMatch(/\{compact && modeSeg\}/)
  })
})

describe('패널 CSS 는 구조와 터치 치수가 갈라져 있다', () => {
  it('구조 규칙은 미디어쿼리 밖에 있다', () => {
    expect(BASE).toMatch(/\.tb-menu \{[\s\S]*?position: absolute/)
    expect(BASE).toMatch(/\.tb-menu\[data-open="1"\] \{ display: flex; \}/)
    expect(BASE).toMatch(/\.tb-menu-btn \{/)
    expect(BASE).toMatch(/\.topbar \{\s*\n\s*position: relative;/)
  })

  it('44px 터치 치수는 compact 안에만 있다 - 마우스에는 필요 없다', () => {
    const base44 = (BASE.match(/\.tb-menu[^{]*\{[^}]*min-height: 44px/g) || [])
    expect(base44.length).toBe(0)
    expect(COMPACT).toMatch(/\.tb-menu \.chk \{ min-height: 44px/)
    expect(COMPACT).toMatch(/\.tb-menu-btn \{ width: 44px; height: 44px/)
  })

  it('툴바의 가로 스크롤은 모든 폭에서 마지막 안전망이다', () => {
    // 접기가 못 도는 환경(ResizeObserver 도 resize 도 없는 구형 브라우저)에서
    // 컨트롤이 상자 밖에 잘린 채 닿을 수 없게 되는 것을 막는다.
    expect(BASE).toMatch(/\.board-toolbar \{[\s\S]*?overflow-x: auto/)
  })

  it('0 폭 스페이서가 gap 을 가져가지 않는다 - 1280 에서 3px 이 거기서 나왔다', () => {
    expect(BASE).toMatch(/\.board-toolbar \.sp \{ flex: 1; margin: 0 -8px; \}/)
  })
})
