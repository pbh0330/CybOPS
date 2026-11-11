import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ADR-0025 3번: "가상 훈련 시나리오 · 실제 부대 배치 아님" 은 항상 보이고 끌 수
// 없다. 이 화면이 실제 부대 배치가 아니라는 고지는 이 한 줄뿐이다.
//
// 이 저장소에는 jsdom 이 없다(vitest 환경이 'node'). 가려짐 자체는 레이아웃이
// 있어야 재므로 여기서 재지 않는다. 대신 **가려지지 않게 만든 구조**를 검사한다.
// 실측은 390x843 에서 따로 했고 숫자는 아래 상수에 적어 둔다
// (docs/design/screens/2026-10-14-watermark-{peek,half,full}.png).

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = src('../style.css')
const app = src('../App.jsx')
const mapPane = src('../ui/MapPane.jsx')
const sheetSrc = src('../ui/Sheet.jsx')

const NOTICE = '가상 훈련 시나리오 · 실제 부대 배치 아님'

// 390x843 실측(Chrome, tacnet-01 지리 뷰). 상자는 221x33, peek 에서 아래끝이
// 뷰포트 바닥에서 175px 이고 peek 시트는 56px 다.
const BOX_H = 33
const PEEK_RESTING = 175

// ---------------------------------------------------------------- CSS 읽기

// 주석은 떼고 읽는다. 이 파일의 주석은 규칙만큼 길고 50dvh 같은 값을 설명으로
// 인용하므로, 주석을 세면 "값이 몇 군데 있는가" 가 틀린 답을 낸다.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')

// `sel { ... }` 의 선언부를 돌려준다. 같은 선택자가 여러 번이면 전부.
function blocks(sel) {
  const out = []
  const needle = sel
  let at = 0
  for (;;) {
    at = cssCode.indexOf(needle, at)
    if (at < 0) return out
    const open = cssCode.indexOf('{', at)
    const close = cssCode.indexOf('}', open)
    // 선택자와 `{` 사이에 다른 선택자가 끼어들면 그 자리는 이 규칙이 아니다
    const between = cssCode.slice(at + needle.length, open)
    if (open > 0 && close > open && /^[\s,]*$/.test(between)) {
      out.push(cssCode.slice(open + 1, close))
    }
    at += needle.length
  }
}

const decl = (text, prop) => {
  const m = text.match(new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*([^;}]+)`))
  return m ? m[1].trim() : null
}

// Sheet 가 가진 상태 목록이 이 검사의 입력이다. 상태가 하나 늘면 아래가 그것을
// 그대로 집어 든다 - 새 상태에 규칙이 없으면 실패한다.
const STATES = (() => {
  const m = sheetSrc.match(/const STATES = \[([^\]]+)\]/)
  expect(m, 'Sheet.jsx 의 STATES 를 못 찾았다').not.toBeNull()
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
})()

// `--sheet-h` 는 .app 의 data-sheet 로만 정해진다. 그 표를 읽어 둔다.
const SHEET_H = (() => {
  const table = {}
  const re = /\[data-compact="1"\]\[data-sheet="(\w+)"\]\s*\{([^}]*)\}/g
  let m
  while ((m = re.exec(cssCode))) {
    const v = decl(m[2], '--sheet-h')
    if (v) table[m[1]] = v
  }
  return table
})()

const PEEK_PX = (() => {
  const base = blocks('[data-compact="1"]').map((b) => decl(b, '--sheet-peek-h')).find(Boolean)
  expect(base, '--sheet-peek-h 선언이 없다').toBeTruthy()
  return Number(base.replace('px', ''))
})()

// 'var(--sheet-peek-h)' | '50dvh' -> px
function resolve(value, vh) {
  if (value.includes('--sheet-peek-h')) return PEEK_PX
  const dvh = value.match(/^([\d.]+)dvh$/)
  if (dvh) return (Number(dvh[1]) / 100) * vh
  const px = value.match(/^([\d.]+)px$/)
  if (px) return Number(px[1])
  throw new Error('모르는 높이 표기: ' + value)
}

// 올라가는 규칙. 선택자에 적힌 상태들과 bottom 식을 같이 본다.
const LIFT = (() => {
  const m = cssCode.match(/((?:\[data-compact="1"\]\[data-sheet="\w+"\] \.map-watermark,?\s*)+)\{([^}]*)\}/)
  expect(m, '워터마크를 시트 위로 올리는 규칙이 없다').not.toBeNull()
  const states = [...m[1].matchAll(/data-sheet="(\w+)"/g)].map((x) => x[1])
  return { states, body: m[2] }
})()

// ---------------------------------------------------------------- 끌 수 없다

describe('워터마크는 끌 수 없다 (ADR-0025 3번)', () => {
  it('문장은 저장소에 하나뿐이다 - 두 곳에 있으면 한쪽만 고쳐진다', () => {
    const count = (t) => t.split(NOTICE).length - 1
    expect(count(mapPane)).toBe(1)
    expect(count(app)).toBe(0)
    expect(count(sheetSrc)).toBe(0)
    // 주석이 문장을 인용하는 것은 사본이 아니다. 규칙이 content 로 두 번째를
    // 그리는 것이 사본이다.
    expect(count(cssCode)).toBe(0)
  })

  it('조건 없이 그려진다 - 시트 상태도, 어떤 모드도 그리기를 멈추지 못한다', () => {
    const line = mapPane.split('\n').find((l) => l.includes('className="map-watermark"'))
    expect(line).toBeTruthy()
    expect(line).toContain(NOTICE)
    expect(line.includes('&&')).toBe(false)
    expect(line.includes('?')).toBe(false)
  })

  it('숨기거나 투명하게 만드는 규칙이 없다', () => {
    for (const body of blocks('.map-watermark')) {
      expect(decl(body, 'display')).not.toBe('none')
      expect(decl(body, 'visibility')).toBeNull()
      const op = decl(body, 'opacity')
      if (op) expect(Number(op)).toBeGreaterThan(0.9)
    }
    expect(cssCode.includes('.map-watermark[hidden]')).toBe(false)
  })
})

// ------------------------------------------------------------- 높이는 한 곳

describe('시트 높이는 한 곳에서 온다', () => {
  it('세 상태의 높이가 --sheet-h 선언에만 있다', () => {
    expect(Object.keys(SHEET_H).sort()).toEqual([...STATES].sort())
    // 값 자체는 ADR-0030 의 것이고 이 태스크에서 바꾸지 않는다
    expect(PEEK_PX).toBe(56)
    expect(SHEET_H.half).toBe('50dvh')
    expect(SHEET_H.full).toBe('86dvh')
    // 같은 수가 다른 자리에 또 있으면 한쪽만 고쳐진다
    expect((cssCode.match(/50dvh/g) || []).length).toBe(1)
    expect((cssCode.match(/86dvh/g) || []).length).toBe(1)
  })

  it('시트의 height 와 .app 의 아래 여백이 그 값을 읽는다', () => {
    const heights = blocks('[data-compact="1"] .sheet').map((b) => decl(b, 'height')).filter(Boolean)
    expect(heights).toEqual(['var(--sheet-h)'])
    // 상태별 height 규칙이 남아 있으면 값이 두 곳이 된다
    expect(/\.sheet\[data-state="\w+"\]\s*\{[^}]*height\s*:/.test(cssCode)).toBe(false)
    // .app 이 비워 두는 띠가 정확히 peek 높이다. peek 시트가 .app 의 내용
    // 상자(= 지도 패널, = 워터마크)에 닿지 못하는 근거가 이 한 줄이다.
    const pad = blocks('.app').map((b) => decl(b, 'padding-bottom')).filter(Boolean)
    expect(pad).toEqual(['calc(var(--sheet-peek-h) + env(safe-area-inset-bottom, 0px))'])
  })
})

// --------------------------------------------------------- 시트 위로 올라간다

describe('워터마크가 시트 위로 올라간다', () => {
  it('peek 보다 높은 상태는 전부 올리는 규칙을 가진다', () => {
    const taller = STATES.filter((s) => SHEET_H[s] !== 'var(--sheet-peek-h)')
    expect(taller.length).toBeGreaterThan(0)
    for (const s of taller) expect(LIFT.states, `${s} 상태에 규칙이 없다`).toContain(s)
    // peek 은 올리지 않는다. 올리면 fixed 가 되어 타임라인 위로 내려앉는다.
    expect(LIFT.states.includes('peek')).toBe(false)
    expect(PEEK_RESTING).toBeGreaterThan(PEEK_PX)
  })

  it('올라간 자리는 --sheet-h 에서 계산되고 시트보다 위다', () => {
    expect(decl(LIFT.body, 'position')).toBe('fixed')
    const bottom = decl(LIFT.body, 'bottom')
    const m = bottom.match(/^calc\(var\(--sheet-h\)\s*\+\s*([\d.]+)px\)$/)
    expect(m, `bottom 이 --sheet-h 에서 안 나온다: ${bottom}`).not.toBeNull()
    expect(Number(m[1])).toBeGreaterThan(0)
  })

  it('세 상태 모두에서 안 가려지고 화면 안에 들어간다 - 300~1200px 높이 전부', () => {
    const gap = Number(decl(LIFT.body, 'bottom').match(/\+\s*([\d.]+)px/)[1])
    for (let vh = 300; vh <= 1200; vh += 1) {
      for (const s of STATES) {
        const sheetH = resolve(SHEET_H[s], vh)
        const bottom = LIFT.states.includes(s) ? sheetH + gap : PEEK_RESTING
        // 시트 윗끝보다 아래끝이 위에 있다 = 안 덮인다
        expect(bottom, `${s} @${vh}`).toBeGreaterThan(sheetH)
        // 위로도 안 넘친다 = 읽을 자리가 남는다
        expect(bottom + BOX_H, `${s} @${vh}`).toBeLessThanOrEqual(vh)
      }
    }
  })

  it('쌓임 순서가 시트보다 위다', () => {
    const sheetZ = Number(decl(blocks('[data-compact="1"] .sheet')[0], 'z-index'))
    expect(sheetZ).toBe(30)
    expect(Number(decl(LIFT.body, 'z-index'))).toBeGreaterThan(sheetZ)
  })

  it('상태는 Sheet 하나에서 나와 .app 에 적힌다 - 사본이 아니다', () => {
    expect(sheetSrc).toMatch(/onStateChange\(state\)/)
    expect(app).toMatch(/onStateChange=\{setSheetState\}/)
    expect(app).toMatch(/data-sheet=\{compact \? sheetState : undefined\}/)
  })
})

// ------------------------------------------------------------ 안 바뀐 것들

describe('데스크톱과 와이어 모드는 그대로다', () => {
  it('데스크톱 자리가 안 움직인다 - 올리는 규칙은 compact 안쪽뿐이다', () => {
    const base = blocks('.map-watermark')[0]
    expect(decl(base, 'position')).toBe('absolute')
    expect(decl(base, 'bottom')).toBe('56px')
    expect(decl(base, 'z-index')).toBe('5')
    expect(decl(base, 'pointer-events')).toBe('none')
    for (const s of LIFT.states) {
      expect(cssCode).toContain(`[data-compact="1"][data-sheet="${s}"] .map-watermark`)
    }
  })

  it('U7 이 대비를 잰 두 값이 그대로다 - 이 태스크는 자리만 옮겼다', () => {
    // 지도 모드 .78, 와이어 모드 .92. 색도 불투명도도 안 건드렸으므로 U7 의
    // 측정(와이어 최악 16.69:1, 지도 최악 13.35:1)이 그대로 선다.
    expect(decl(blocks('.map-watermark')[0], 'background')).toContain('rgba(7,10,16,.78)')
    const wire = blocks('.map-pane[data-wire="1"] .map-watermark')[0]
    expect(wire).toBeTruthy()
    expect(decl(wire, 'background')).toBe('rgba(7, 10, 16, .92)')
    expect(decl(wire, 'border-color')).toBe('var(--text-muted)')
  })
})
