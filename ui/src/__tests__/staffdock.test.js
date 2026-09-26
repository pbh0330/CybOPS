import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import { computeStep } from '../derive.js'
import { ask, graphFingerprint } from '../staff.js'
import { catalog } from '../staff.js'
import {
  LOG_MAX, storeKey, tieRuns, selectableIds, optionsOf, initialArgs, pushLog, readLog,
  staleOf, staleWhy, staleText,
  FALLBACK_QUERY, errKo, llmNoteOf, fallbackNote, noteWith, runQuestion, entryOf,
} from '../ui/StaffDock.jsx'
import { splitSentences, citesOf, stripCites, citeStats, factMap, factText } from '../ui/cite.jsx'

const g = replay.graph
const s = computeStep({ payload: replay, graph: g, idx: 12 })
const observe = { graph: g, step: s, method: replay.method || 'weighted' }
// 시계를 건드리지 않는 그래프 편집 - 교전장에서 사람이 실제로 하는 일이다.
const cutTocSrv = { ...g, links: g.links.filter((l) => l.a !== 'TOC-SRV' && l.b !== 'TOC-SRV') }

describe('storeKey', () => {
  it('is per scenario and not part of the engagement history', () => {
    expect(storeKey('tacnet-01')).toBe('mccycop:staff:tacnet-01')
    expect(storeKey('sandbox-01')).not.toBe(storeKey('tacnet-01'))
  })
})

describe('tieRuns', () => {
  const table = (cols, rows) => ({ cols, rows: rows.map((cells, i) => ({ id: `n${i}`, cells })) })

  it('marks a run of equal values and leaves a strict order alone', () => {
    // 관측 모드의 실제 모양: 후보 다수가 임무 비용 0 으로 같다.
    const t = table(['순위', '자산', 'ID', '임무 비용'], [
      [1, 'a', 'A', '+0.0%p'],
      [2, 'b', 'B', '+0.0%p'],
      [3, 'c', 'C', '+0.0%p'],
      [4, 'd', 'D', '+4.0%p'],
    ])
    const runs = tieRuns(t)
    expect(runs.slice(0, 3)).toEqual([{ first: 1, size: 3 }, { first: 1, size: 3 }, { first: 1, size: 3 }])
    expect(runs[3]).toBe(null)
  })

  it('reads the LAST column, which is 순이득 when a game is scoring', () => {
    const t = table(['순위', '자산', 'ID', '임무 비용', '막는 공격 수', '최대 차단 이득', '순이득'], [
      [1, 'a', 'A', '+0.0%p', 2, '10%', '+10.0%p'],
      [2, 'b', 'B', '+3.0%p', 1, '13%', '+10.0%p'],
      [3, 'c', 'C', '+1.0%p', 0, '0%', '+0.0%p'],
    ])
    expect(tieRuns(t).map((r) => (r ? r.size : 0))).toEqual([2, 2, 0])
  })

  it('takes the lowest rank in the run, even when the table is not rank-sorted', () => {
    // compare_defense 는 두 행을 입력 순서대로 되돌려 준다.
    const t = table(['순위', '자산', 'ID', '임무 비용'], [
      [7, 'b', 'B', '+0.0%p'],
      [3, 'a', 'A', '+0.0%p'],
    ])
    expect(tieRuns(t)[0]).toEqual({ first: 3, size: 2 })
  })

  it('says nothing about a table that is not a ranking', () => {
    const t = table(['대상', 'ID', '원인', '비고'], [['a', 'A', '지형', ''], ['b', 'B', '지형', '']])
    expect(tieRuns(t)).toEqual([null, null])
    expect(tieRuns(null)).toEqual([])
  })

  it('marks the real observe-mode containment table', () => {
    const a = ask(observe, 'containment_top', { k: 8 })
    const runs = tieRuns(a.table)
    expect(runs.length).toBe(a.table.rows.length)
    // 동률이 있다면 같은 first 를 공유하고, 번호는 그 행의 순위가 아니다.
    for (let i = 0; i < runs.length; i += 1) {
      if (!runs[i]) continue
      expect(runs[i].size).toBeGreaterThan(1)
      expect(Number(runs[i].first)).toBeLessThanOrEqual(Number(a.table.rows[i].cells[0]))
    }
  })
})

describe('selectableIds', () => {
  it('covers every ref kind a fact can carry except the turn', () => {
    const ids = selectableIds(g)
    expect(ids.has(g.missions[0].id)).toBe(true)
    expect(ids.has(g.assets[0].id)).toBe(true)
    expect(ids.has(g.links[0].id)).toBe(true)
    expect(ids.has('0')).toBe(false)     // gameFacts 의 {kind:'turn'} 은 노드가 아니다
    expect(selectableIds(null).size).toBe(0)
  })

  it('accepts every asset/mission ref the state summary produces', () => {
    const ids = selectableIds(g)
    const refs = ask(observe, 'state_summary').facts.map((f) => f.ref).filter(Boolean)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      if (r.kind === 'turn') continue
      expect(ids.has(r.id)).toBe(true)
    }
  })
})

describe('arguments', () => {
  it('opens the selects on values the graph actually has', () => {
    const a = initialArgs(g)
    const assets = g.assets.map((x) => x.id)
    expect(g.missions.map((m) => m.id)).toContain(a.missionId)
    expect(assets).toContain(a.assetId)
    expect(a.aId).not.toBe(a.bId)   // compare_defense 의 distinctFrom 을 먼저 만족시킨다
    expect(() => ask(observe, 'mission_why', { missionId: a.missionId })).not.toThrow()
    expect(() => ask(observe, 'compare_defense', { aId: a.aId, bId: a.bId })).not.toThrow()
  })

  it('labels each option with its id so the select and the fact agree', () => {
    const opts = optionsOf(g, 'asset')
    expect(opts.length).toBe(g.assets.length)
    expect(opts[0].label).toContain(opts[0].id)
    expect(optionsOf(g, 'int')).toEqual([])
  })
})

describe('the log', () => {
  it('keeps the newest ten and drops the eleventh', () => {
    let log = []
    for (let i = 0; i < 13; i += 1) log = pushLog(log, { at: i })
    expect(log.length).toBe(LOG_MAX)
    expect(log[0].at).toBe(12)
    expect(log[LOG_MAX - 1].at).toBe(3)
  })

  it('drops anything stored that is not shaped like an Answer', () => {
    expect(readLog('not json')).toEqual([])
    expect(readLog('{"query":"x"}')).toEqual([])
    expect(readLog(JSON.stringify([{ query: 'state_summary' }, null, 7]))).toEqual([])
    const ok = JSON.stringify([{ query: 'state_summary', facts: [], at: 1 }])
    expect(readLog(ok).length).toBe(1)
  })

  // `at` 은 카드의 React key 이자 목록의 유일한 순서다. 숫자가 아니면 그런
  // 카드가 전부 key={undefined} 로 그려진다 - 예전 빌드가 쓴 기록이 그랬다.
  it('requires a numeric at, so no card ends up without a key', () => {
    const noAt = JSON.stringify([{ query: 'state_summary', facts: [] }])
    expect(readLog(noAt)).toEqual([])
    expect(readLog(JSON.stringify([{ query: 'state_summary', facts: [], at: '1' }]))).toEqual([])
    expect(readLog(JSON.stringify([{ query: 'state_summary', facts: [], at: null }]))).toEqual([])
    const mixed = JSON.stringify([
      { query: 'state_summary', facts: [], at: 2 },
      { query: 'state_summary', facts: [] },
      { query: 'state_summary', facts: [], at: 1 },
    ])
    expect(readLog(mixed).map((a) => a.at)).toEqual([2, 1])
  })
})

// 카드가 아직 화면과 같은 기준인가. 시각과 그래프 둘 다 봐야 한다 - 시각만
// 보던 구현은 교전장에서 흔한 실패를 통째로 놓쳤다.
describe('staleOf', () => {
  const fp = graphFingerprint(g)
  const fresh = ask(observe, 'state_summary', {})

  it('says nothing when both the clock and the graph still match', () => {
    expect(staleOf(fresh, fresh.t, fp)).toEqual({ time: false, graph: false, unknown: false, stale: false })
  })

  it('marks a seek and names the clock as what moved', () => {
    const st = staleOf(fresh, fresh.t + 60, fp)
    expect(st.stale).toBe(true)
    expect(st.time).toBe(true)
    expect(st.graph).toBe(false)
    expect(staleWhy(st)).toBe('기준 시각이 다름')
    expect(staleText(st, 't+180', 't+240')).toContain('t+240')
  })

  it('marks a graph edit at an UNCHANGED clock - the case t alone could not see', () => {
    const edited = ask({ graph: cutTocSrv, step: s }, 'state_summary', {})
    expect(edited.t).toBe(fresh.t)                    // 시계는 그대로였다
    const st = staleOf(fresh, fresh.t, graphFingerprint(cutTocSrv))
    expect(st.stale).toBe(true)
    expect(st.time).toBe(false)
    expect(st.graph).toBe(true)
    expect(staleWhy(st)).toBe('기준 그래프가 다름')
    expect(staleText(st, 't+180', 't+180')).toContain('편집')
  })

  it('names both when both moved', () => {
    const st = staleOf(fresh, fresh.t + 60, graphFingerprint(cutTocSrv))
    expect(st).toEqual({ time: true, graph: true, unknown: false, stale: true })
    expect(staleWhy(st)).toBe('기준 시각과 그래프가 모두 다름')
    const text = staleText(st, 't+180', 't+240')
    expect(text).toContain('t+240')
    expect(text).toContain('편집')
  })

  it('does not trust a card from an older build, and says it cannot check rather than claiming a change', () => {
    const legacy = { query: 'state_summary', facts: [], at: 1 }
    for (const a of [legacy, { ...legacy, t: fresh.t }, { ...legacy, gfp: fp }]) {
      const st = staleOf(a, fresh.t, fp)
      expect(st.stale).toBe(true)
      expect(st.unknown).toBe(true)
      expect(staleWhy(st)).toBe('기준을 확인할 수 없음')
      expect(staleText(st, '알 수 없는 시각', 't+180')).toContain('확인할 수 없다')
    }
    expect(staleOf(null, fresh.t, fp).stale).toBe(true)
  })
})

// ---------------------------------------------------------------- 인용 렌더링
//
// 레일의 브리핑과 참모 답변은 같은 렌더러를 쓴다 (cite.jsx). 두 벌이 되면
// "인용 없는 문장은 미검증" 규칙이 한쪽에서만 바뀐다 - ADR-0009 가 화면에서
// 지켜지는지는 이 함수들이 정한다.
describe('인용 분해 (cite.jsx)', () => {
  it('브리핑 팩 형식 - 마침표로 끝나는 문장을 줄 단위로 가른다', () => {
    const text = '임무 M-C2의 저하도는 100%다 [F2]{확신}.\n격리 비용은 +71.4%p 다 [F15]{확신}.'
    expect(splitSentences(text).length).toBe(2)
    expect(citeStats(text)).toEqual({ sentences: 2, cited: 2, unverified: 0 })
  })

  it('narrate 형식 - 마침표 없이 [F#] 으로 끝나는 문장도 가른다', () => {
    // 프롬프트가 요구하는 형식이 이것이다: "... 막는다 [F2]". 마침표만 보고
    // 가르면 두 문장이 한 문장이 되고, 인용 없는 문장이 인용 있는 문장에
    // 묻혀 미검증 배지를 피한다.
    const text = 'TOC-SRV 가 끊겼다 [F1] 임무 M-C2 가 100% 저하됐다 [F2] 이건 근거가 없다'
    expect(splitSentences(text).length).toBe(3)
    expect(citeStats(text)).toEqual({ sentences: 3, cited: 2, unverified: 1 })
  })

  it('한 문장이 같은 근거를 두 번 인용해도 칩은 하나다', () => {
    expect(citesOf('가 [F2] 나 [F2] 다 [F3]')).toEqual(['F2', 'F3'])
  })

  it('본문에서 인용 표시를 지우되 마침표 앞 공백까지 거둔다', () => {
    expect(stripCites('임무가 저하됐다 [F2].')).toBe('임무가 저하됐다.')
    expect(stripCites(null)).toBe('')
  })

  it('근거는 Map 으로도 배열로도 들어온다 - 레일과 참모가 서로 다른 모양을 준다', () => {
    const m = factMap([{ id: 'F1', text: '가' }, { id: 'F2', text: '나', ref: { id: 'TOC-SRV' } }])
    expect(factText(m.get('F2'))).toBe('나')
    const raw = new Map([['F1', '가']])
    expect(factMap(raw)).toBe(raw)
    expect(factText(raw.get('F1'))).toBe('가')
    expect(factText(undefined)).toBe('')
  })

  it('빈 서술은 0문장이지 미검증 1문장이 아니다', () => {
    expect(citeStats('')).toEqual({ sentences: 0, cited: 0, unverified: 0 })
  })
})

// ------------------------------------------------------------ 질의창 컨트롤러
//
// 질문 -> routeQuestion -> validate -> ask -> narrate.
// 이 기계에는 Ollama 가 없고 데모 노트북에도 없을 수 있다. 전송과 두 호출이
// 전부 주입 가능하므로 아래는 모델 없이 전 경로를 돈다.
describe('runQuestion', () => {
  const spec = catalog(observe)
  // 모델 대신 쓰는 것들. 엔진 호출 여부를 세는 것이 요점이다 - 기권과 전송
  // 오류에서 엔진이 도는 것은 "묻지 않은 답"이다.
  const routeOf = (out) => async () => ({ ms: 5, attempts: 1, ...out })
  const narrateOf = (out) => async () => ({ ms: 7, ...out })
  const spyAsk = () => {
    const calls = []
    const fn = (c, q, a) => { calls.push({ q, args: a }); return ask(c, q, a) }
    fn.calls = calls
    return fn
  }

  it('정상 경로: 라우팅 -> 검증 -> 엔진 -> 서술', async () => {
    const askFn = spyAsk()
    const res = await runQuestion(observe, 'M-C2 왜 저하됐나', {
      spec,
      route: routeOf({ query: 'mission_why', args: { missionId: 'M-C2' } }),
      narrate: narrateOf({ text: '임무 M-C2 의 저하도는 100%다 [F1]' }),
      ask: askFn,
    })
    expect(res.kind).toBe('answer')
    expect(res.fallback).toBe(null)
    expect(res.narrateErr).toBe(null)
    expect(res.answer.query).toBe('mission_why')
    expect(askFn.calls).toEqual([{ q: 'mission_why', args: { missionId: 'M-C2' } }])
    expect(res.ms).toBe(12)
  })

  it('기권은 오류가 아니고, 엔진을 돌리지 않는다', async () => {
    const askFn = spyAsk()
    const res = await runQuestion(observe, '지금 차단해라', {
      spec,
      route: routeOf({ abstain: true, why: '대응 실행은 사람이 승인한다' }),
      narrate: narrateOf({ text: '여기까지 오면 안 된다 [F1]' }),
      ask: askFn,
    })
    expect(res.kind).toBe('abstain')
    expect(res.why).toContain('사람이 승인')
    expect(askFn.calls).toEqual([])
    expect(res.text).toBeUndefined()
  })

  it('전송 오류와 제한 시간 초과는 엔진을 돌리지 않고 사유를 남긴다', async () => {
    for (const code of ['transport', 'timeout']) {
      const askFn = spyAsk()
      const res = await runQuestion(observe, '상황 요약', {
        spec,
        ask: askFn,
        route: routeOf({ error: code, why: '모델 호출이 실패했다: fetch failed' }),
        narrate: narrateOf({ text: '올 리 없다 [F1]' }),
      })
      expect(res.kind).toBe('error')
      expect(res.error).toBe(code)
      expect(askFn.calls).toEqual([])
      expect(errKo(code)).not.toBe(code)     // 코드가 한국어로 읽힌다
    }
  })

  it('라우팅이 끝내 실패하면 요약으로 떨어뜨리고, 그랬다고 note 에 적는다', async () => {
    for (const code of ['unparsable', 'bad_shape', 'unknown_query', 'bad_args']) {
      const askFn = spyAsk()
      const res = await runQuestion(observe, '뭐라고 물어야 하지', {
        spec,
        ask: askFn,
        route: routeOf({ error: code, why: `받은 응답: ${code}` }),
        narrate: narrateOf({ text: '현 시각 상황이다 [F1]' }),
      })
      expect(res.kind).toBe('answer')
      expect(res.answer.query).toBe(FALLBACK_QUERY)
      expect(askFn.calls).toEqual([{ q: 'state_summary', args: {} }])
      expect(res.fallback.error).toBe(code)
      const note = noteWith(res.fallback, res.answer.note)
      expect(note).toContain('질의를 고르지 못해 요약으로 답했다')
      expect(note).toContain(errKo(code))
    }
  })

  // 라우터는 id 가 카탈로그에 있는지만 봤다. 값이 이 그래프의 노드인지는
  // staff.validate 가 본다 - 그것이 문지기다 (ADR-0003).
  it('모델이 없는 자산을 인자로 주면 검증이 막고, 엔진은 그 인자를 보지 못한다', async () => {
    const askFn = spyAsk()
    const res = await runQuestion(observe, '유령 자산은 어떤가', {
      spec,
      ask: askFn,
      route: routeOf({ query: 'asset_impact', args: { assetId: 'GHOST-1' } }),
      narrate: narrateOf({ text: '현 시각 상황이다 [F1]' }),
    })
    expect(res.kind).toBe('answer')
    expect(res.answer.query).toBe(FALLBACK_QUERY)
    expect(askFn.calls).toEqual([{ q: 'state_summary', args: {} }])
    expect(res.fallback.from).toBe('asset_impact')
    expect(res.fallback.error).toBe('validate')
    expect(res.fallback.why).toContain('GHOST-1')
    expect(fallbackNote(res.fallback)).toContain('asset_impact')
  })

  it('검증은 인자를 조용히 고치지 않는다 - 잘못된 k 도 요약으로 떨어진다', async () => {
    const askFn = spyAsk()
    const res = await runQuestion(observe, '상위 몇 개', {
      spec,
      ask: askFn,
      route: routeOf({ query: 'containment_top', args: { k: -3 } }),
      narrate: narrateOf({ text: '현 시각 상황이다 [F1]' }),
    })
    expect(res.answer.query).toBe(FALLBACK_QUERY)
    expect(askFn.calls[0].args).toEqual({})
  })

  it('서술이 실패해도 사실과 표는 남는다 - 조용히 넘어가지 않는다', async () => {
    const res = await runQuestion(observe, '상황 요약', {
      spec,
      route: routeOf({ query: 'state_summary', args: {} }),
      narrate: narrateOf({ error: 'empty', why: '모델이 빈 문장을 돌려주었다.' }),
    })
    expect(res.kind).toBe('answer')
    expect(res.text).toBe(null)
    expect(res.narrateErr).toEqual({ error: 'empty', why: '모델이 빈 문장을 돌려주었다.' })
    expect(res.answer.facts.length).toBeGreaterThan(0)
  })

  it('폴백 질의마저 엔진이 거부하면 오류로 보인다 (그래프 없음)', async () => {
    const res = await runQuestion({ graph: null }, '상황 요약', {
      spec: [],
      route: routeOf({ error: 'unparsable', why: '빈 응답' }),
      narrate: narrateOf({ text: '올 리 없다 [F1]' }),
    })
    expect(res.kind).toBe('error')
    expect(res.error).toBe('engine')
  })

  // 여기만 진짜 Task 1 함수를 쓴다. 가짜는 전송 한 겹뿐이므로 프롬프트 조립,
  // JSON 해석, 카탈로그 대조, 그리고 이 파일의 문지기까지 함께 돈다.
  it('전송만 가짜로 두고 routeQuestion/narrate 를 그대로 태운다', async () => {
    const routeTx = async () => ({ text: '```json\n{"query":"mission_why","args":{"missionId":"M-C2"}}\n```', ms: 11 })
    const narrateTx = async () => ({ text: '{"text":"임무 M-C2 의 저하도가 가장 크다 [F1] 원인은 상호작용이다 [F2]"}', ms: 13 })
    const res = await runQuestion(observe, 'M-C2 왜 이런가', {
      spec,
      routeOpts: { transport: routeTx },
      narrateOpts: { transport: narrateTx },
    })
    expect(res.kind).toBe('answer')
    expect(res.answer.query).toBe('mission_why')
    expect(res.answer.args).toEqual({ missionId: 'M-C2' })
    expect(citeStats(res.text)).toEqual({ sentences: 2, cited: 2, unverified: 0 })
    expect(res.ms).toBe(24)
  })

  it('카탈로그 밖 id 는 진짜 routeQuestion 이 막고, 화면은 요약으로 답한다', async () => {
    const routeTx = async () => ({ text: '{"query":"rm -rf","args":{}}', ms: 3 })
    const narrateTx = async () => ({ text: '{"text":"현 시각 상황이다 [F1]"}', ms: 4 })
    const res = await runQuestion(observe, '아무거나', {
      spec,
      routeOpts: { transport: routeTx, retries: 0 },
      narrateOpts: { transport: narrateTx },
    })
    expect(res.kind).toBe('answer')
    expect(res.answer.query).toBe(FALLBACK_QUERY)
    expect(res.fallback.error).toBe('unknown_query')
  })
})

describe('entryOf', () => {
  it('답을 기존 카드와 같은 모양으로 남기고, 폴백 사유를 note 머리에 붙인다', async () => {
    const res = await runQuestion(observe, '유령 자산', {
      spec: catalog(observe),
      route: async () => ({ query: 'asset_impact', args: { assetId: 'GHOST-1' }, ms: 1, attempts: 2 }),
      narrate: async () => ({ text: '현 시각 상황이다 [F1]', ms: 2 }),
    })
    const e = entryOf(res, '유령 자산', 1758800000000)
    // readLog 가 받아들이는 모양 그대로여야 한다 - S1 카드와 한 컴포넌트가 그린다.
    expect(readLog(JSON.stringify([e])).length).toBe(1)
    expect(e.asked).toBe('유령 자산')
    expect(e.at).toBe(1758800000000)
    expect(typeof e.when).toBe('string')
    expect(e.text).toContain('[F1]')
    expect(e.note.startsWith('질의를 고르지 못해 요약으로 답했다')).toBe(true)
    expect(e.attempts).toBe(2)
  })

  it('폴백이 없으면 엔진의 note 만 남는다', () => {
    expect(noteWith(null, '사건 표가 비어 있다')).toBe('사건 표가 비어 있다')
    expect(noteWith(null, null)).toBe(null)
  })
})

// 모델이 없을 때 질의창이 왜 꺼졌는지 - 배포본이 스스로 쓴 문장이 먼저다.
describe('llmNoteOf', () => {
  const cfg = { llm: { unavailable_note: '이 배포본에는 모델 서버가 없다.' } }

  it('probe 가 아직 없으면(확인 중) 사유가 없다', () => {
    expect(llmNoteOf(null, cfg)).toBe('')
  })

  it('닿지 않으면 배포본의 문장에 실패 사유를 덧붙인다', () => {
    expect(llmNoteOf({ ok: false, why: 'fetch failed' }, cfg)).toBe('이 배포본에는 모델 서버가 없다. (fetch failed)')
  })

  it('llm.enabled=false 는 배포 의도이므로 코드 이름을 보이지 않는다', () => {
    expect(llmNoteOf({ ok: false, why: 'disabled' }, cfg)).toBe('이 배포본에는 모델 서버가 없다.')
  })

  it('모델이 있으면 사유가 없다', () => {
    expect(llmNoteOf({ ok: true, models: ['qwen2.5:7b'] }, cfg)).toBe('')
  })
})
