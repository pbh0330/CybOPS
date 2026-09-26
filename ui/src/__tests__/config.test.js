import { describe, it, expect, afterEach, vi } from 'vitest'
import { config, probeLlm } from '../config.js'
import hosted from '../../public/config.hosted.example.json'
import aws from '../../public/config.aws.example.json'

// `loadConfig` is never called in this file, so `config()` is the shipped
// DEFAULTS - which is exactly what a bundle opened with no config.json gets.

describe('DEFAULTS.llm', () => {
  it('ships the LLM attacker off (ADR-0028 1절)', () => {
    expect(config().llm.attacker_enabled).toBe(false)
  })

  it('is an explicit false, not a missing key - the flag has to be readable in the file', () => {
    expect(Object.prototype.hasOwnProperty.call(config().llm, 'attacker_enabled')).toBe(true)
  })

  it('does not touch the endpoint or model defaults', () => {
    expect(config().llm.enabled).toBe(true)
    expect(config().llm.endpoint).toBe('http://127.0.0.1:11434')
  })
})

// The note is read on two surfaces now - the staff's question box and the
// wargame's start card - so a note that only talks about greedy/random leaves
// the reader of the disabled question box with no idea what still works.
const covers = (note) => ({
  staff: /질의 버튼/.test(note),
  briefing: /브리핑/.test(note),
  wargame: /greedy/.test(note),
  missing: /서술|문장/.test(note) && /질문/.test(note),
})

describe('unavailable_note', () => {
  it('names what still works on both surfaces and what does not', () => {
    const c = covers(config().llm.unavailable_note)
    expect(c).toEqual({ staff: true, briefing: true, wargame: true, missing: true })
  })

  for (const [name, file] of [['hosted', hosted], ['aws', aws]]) {
    it(`${name} example carries the same two-surface note`, () => {
      const c = covers(file.llm.unavailable_note)
      expect(c).toEqual({ staff: true, briefing: true, wargame: true, missing: true })
    })
    it(`${name} example carries the attacker flag`, () => {
      expect(file.llm.attacker_enabled).toBe(false)
    })
  }

  it('the AWS copy still says the model is only up during a demo', () => {
    expect(aws.llm.unavailable_note).toMatch(/시연 시간/)
  })
})

// The 다시 확인 control is only worth a button if a second call really asks
// again. Nothing in probeLlm caches; this pins that down, because a memoised
// probe would make the control a no-op that looks like it worked.
describe('probeLlm', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const cfg = { llm: { enabled: true, endpoint: 'http://127.0.0.1:11434', model: 'm' } }

  it('reports the reason without calling out when the model is disabled', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await probeLlm({ llm: { enabled: false, unavailable_note: 'n' } })
    expect(r).toEqual({ ok: false, why: 'disabled', note: 'n' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('re-asks on every call, so a model that came up mid-session is found', async () => {
    let up = false
    const fetchSpy = vi.fn(async () => {
      if (!up) throw new Error('fetch failed')
      return { ok: true, json: async () => ({ models: [{ name: 'm' }] }) }
    })
    vi.stubGlobal('fetch', fetchSpy)

    const first = await probeLlm(cfg)
    expect(first.ok).toBe(false)
    expect(first.why).toMatch(/fetch failed/)

    up = true
    const second = await probeLlm(cfg)
    expect(second).toEqual({ ok: true, models: ['m'], has: true })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('a probe that answers without the requested model is reachable but not ready', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ models: [{ name: 'other' }] }) }))
    const r = await probeLlm(cfg)
    expect(r.ok).toBe(true)
    expect(r.has).toBe(false)
  })

  it('an HTTP error is a reason, not a throw', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502 }))
    expect(await probeLlm(cfg)).toEqual({ ok: false, why: 'HTTP 502' })
  })
})
