// Runtime configuration (ADR-0018 static bundle, ADR-0007 swappable model).
//
// WHY A RUNTIME FILE AND NOT A BUILD FLAG
//
// The bundle is a static one that has to run in three places: a developer's
// machine, a demo laptop with no network, and a web server other people open.
// Those three want different answers to one question - where is the model? - and
// a build-time constant would mean three builds of the same artifact, which is
// three chances for the demo to be the one that was not rebuilt.
//
// So config.json is fetched at startup and sits next to the data files. Editing
// it is a deploy step, not a rebuild.
//
// WHAT THE HOSTED CASE ACTUALLY NEEDS
//
// The wargame's LLM attacker calls an Ollama-compatible endpoint from the
// BROWSER. On a laptop that is 127.0.0.1:11434 and it is the operator's own
// model. Serve the same bundle from a public host and that address still means
// "the viewer's own machine" - so a visitor with no Ollama sees a failure, and a
// visitor who does have one gets their own GPU driving a scenario they are
// looking at on someone else's server. Neither is what anyone intended.
//
// Three postures, all expressible here:
//
//   local     endpoint 127.0.0.1:11434            (default; what the demo uses)
//   proxied   endpoint /api/llm on the same origin (server owns the model)
//   off       llm.enabled = false                  (greedy and random only)
//
// Nothing else on the screen depends on a model. Briefings are pre-generated
// JSON produced by scripts/New-BriefingPack.ps1 and shipped with the bundle, so
// a hosted copy with llm.enabled = false still shows every number, every
// briefing and every citation. What goes away is the live attacker and, since
// S2, the staff's free-text question box and its sentences - the staff's query
// buttons, facts and tables are engine output and need no model (ADR-0028 §4).

const DEFAULTS = {
  llm: {
    enabled: true,
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen2.5:7b-instruct-q4_K_M',
    // The model's default role is the staff officer (ADR-0028). The LLM
    // attacker of ADR-0019 is not deleted - the engine, the prompt and the
    // chooser all stay - it just does not appear in the start card unless
    // this is true. Putting it back is this one flag, which is the point:
    // ADR-0019 was not overturned, its default was moved.
    attacker_enabled: false,
    // Shown in the UI when the endpoint cannot be reached. Two surfaces read
    // it now - the staff's question box and the wargame's start card - so it
    // has to say what still works on both, not just in the wargame.
    // Deployments that deliberately run without a model should say so here
    // rather than letting the reader think something is broken.
    unavailable_note: '이 배포본에는 모델 서버가 없다. 참모의 질의 버튼·사실·표와 미리 생성된 브리핑, greedy/random 교전은 그대로 동작한다. 빠지는 것은 서술 문장과 자연어 질문뿐이다.',
  },
  // Map tiles are the one CDN exception (ADR-0025). An on-prem deployment
  // points these at its own tile server; nothing else in the bundle leaves
  // the box. Keyless public sources by default.
  map: {
    style: 'https://tiles.openfreemap.org/styles/dark',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    satellite_attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    dem: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    dem_attribution: 'Terrain: AWS Terrain Tiles (Mapzen), SRTM/USGS/NRCan',
  },
}

let loaded = null

function merge(base, over) {
  const out = { ...base }
  for (const k of Object.keys(over || {})) {
    const v = over[k]
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? merge(base[k] || {}, v) : v
  }
  return out
}

export async function loadConfig() {
  if (loaded) return loaded
  let file = {}
  try {
    const res = await fetch('./config.json', { cache: 'no-store' })
    if (res.ok) file = await res.json()
  } catch {
    // No config.json is the normal case for a bundle opened from disk.
  }
  loaded = merge(DEFAULTS, file)
  return loaded
}

export function config() {
  return loaded || DEFAULTS
}

// One cheap request that answers "is there a model behind that address".
// Without it the first failure is a click that hangs for the connect timeout
// and then reports something the reader cannot act on.
export async function probeLlm(cfg) {
  const c = cfg || config()
  if (!c.llm || !c.llm.enabled) return { ok: false, why: 'disabled', note: c.llm && c.llm.unavailable_note }
  const base = String(c.llm.endpoint || '').replace(/\/+$/, '')
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 2500)
    const res = await fetch(`${base}/api/tags`, { signal: ctl.signal })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` }
    const j = await res.json()
    const names = (j.models || []).map((m) => m.name)
    return { ok: true, models: names, has: names.includes(c.llm.model) }
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) }
  }
}
