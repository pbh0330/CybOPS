import { describe, it, expect } from 'vitest'
import replay from '../../public/data/tacnet-01.replay.json'
import { computeStep } from '../derive.js'
import { ask, graphFingerprint } from '../staff.js'
import {
  LOG_MAX, storeKey, tieRuns, selectableIds, optionsOf, initialArgs, pushLog, readLog,
  staleOf, staleWhy, staleText,
} from '../ui/StaffDock.jsx'

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
