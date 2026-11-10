// Token parity: the three places a colour is written must agree.
//
// Same disease as tools/parity.mjs, different organ. There the PowerShell
// engine and the JS port are two implementations of one rule set; here the
// cause palette is one value written in three files:
//
//   src/tokens.mjs        the source. JS imports this and nothing else.
//   src/style.css :root   CSS cannot import, so it needs the literal.
//   docs/design/tokens.md the table a human reads and diffs against Figma.
//
// The mirrors are not removable - CSS has no import for custom property
// values, and a design doc nobody can read is not a design doc - so the
// mirrors stay and this checks them. Edit one and leave the others and the
// gate says which file disagrees. That is the whole point: knowledge does not
// stop drift, a checker does (CLAUDE.md).
//
// Comparison is case-insensitive on the hex value. tokens.md is UPPERCASE on
// purpose, because that is how Figma prints variables, so uppercase is not an
// error here.
//
//   node tools/token-parity.mjs
//   node tools/token-parity.mjs --verbose

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAUSE_COLOR, CHROME } from '../src/tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const uiDir = join(here, '..')
const repoRoot = join(uiDir, '..')
const cssPath = join(uiDir, 'src', 'style.css')
const docPath = join(repoRoot, 'docs', 'design', 'tokens.md')
const verbose = process.argv.includes('--verbose')

// The name mapping is written out, not derived. tokens.md uses slash names
// (`cause/environment`) and the CSS uses short ones (`--env`), and the two
// differ by more than a separator: environment/env, interaction/inter,
// cause/* against status/ok. A rule guessed from the names would have to be
// patched the first time a token breaks it, and patching a guess is how a
// gate starts passing for the wrong reason.
const CAUSE_TOKENS = [
  { key: 'attack',      css: '--attack',      doc: 'cause/attack' },
  { key: 'mobility',    css: '--mobility',    doc: 'cause/mobility' },
  { key: 'terrain',     css: '--terrain',     doc: 'cause/terrain' },
  { key: 'maintenance', css: '--maintenance', doc: 'cause/maintenance' },
  { key: 'unknown',     css: '--unknown',     doc: 'cause/unknown' },
  { key: 'env',         css: '--env',         doc: 'cause/environment' },
  { key: 'inter',       css: '--inter',       doc: 'cause/interaction' },
  { key: 'ok',          css: '--ok',          doc: 'status/ok' },
]

// CHROME entries that reused an existing style.css token instead of inventing
// a name. Only these are mirrored three ways; the rest of CHROME has no
// counterpart in the CSS or the doc and is checked by the unit test only.
const CHROME_TOKENS = [
  { key: 'lineStrong',  css: '--line-strong',  doc: 'line/strong' },
  { key: 'textPrimary', css: '--text-primary', doc: 'text/primary' },
]

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase()

// --- style.css ------------------------------------------------------------
// Only the first :root block. The file has media-query and theme blocks after
// it and a literal in one of those is not what the app boots with.
function readCss() {
  const text = readFileSync(cssPath, 'utf8')
  const block = text.match(/:root\s*\{([\s\S]*?)\n\}/)
  if (!block) throw new Error(`no :root block in ${cssPath}`)
  const body = block[1]

  const vars = new Map()
  for (const m of body.matchAll(/^[ \t]*--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/gm)) {
    vars.set(`--${m[1]}`, m[2])
  }

  // The cause palette is a comment-delimited run inside :root, which is how a
  // ninth cause colour added to the CSS alone gets noticed. Without this the
  // gate could only see tokens the mapping already names, so the one edit it
  // most needs to catch - someone adding a colour to one file - would pass.
  const at = body.indexOf('/* cause palette')
  if (at < 0) throw new Error(`no "/* cause palette" marker in the :root block of ${cssPath}`)
  const rest = body.slice(at)
  const stop = rest.indexOf('\n\n')
  const region = stop < 0 ? rest : rest.slice(0, stop)
  const regionVars = [...region.matchAll(/^[ \t]*--([a-zA-Z0-9-]+)\s*:/gm)].map((m) => `--${m[1]}`)

  return { vars, regionVars }
}

// --- docs/design/tokens.md ------------------------------------------------
// Rows look like:  | `cause/attack` | `#FF4D5E` | 공격 ... |
const ROW = /^\|\s*`([^`]+)`\s*\|\s*`(#[0-9a-fA-F]{3,8})`\s*\|/gm

function readDoc() {
  const text = readFileSync(docPath, 'utf8')

  const all = new Map()
  for (const m of text.matchAll(ROW)) all.set(m[1], m[2])

  // The cause table carries "ADR 구속 - 변경 금지", so its row set is checked
  // on its own: a token that exists only in the doc is a mismatch too.
  const sections = text.split(/^## /m)
  const causeSection = sections.find((s) => s.startsWith('원인 색'))
  if (!causeSection) throw new Error(`no "## 원인 색" section in ${docPath}`)
  const causeRows = [...causeSection.matchAll(ROW)].map((m) => m[1])

  return { all, causeRows }
}

const css = readCss()
const doc = readDoc()

let compared = 0
let failures = 0
const fail = (line) => { failures++; console.log(`  MISMATCH ${line}`) }

function checkGroup(label, rows, source) {
  console.log(`\n${label} (${rows.length} tokens)`)
  for (const { key, css: cssName, doc: docName } of rows) {
    const a = source[key]
    const b = css.vars.get(cssName)
    const c = doc.all.get(docName)

    // A value missing on one side is reported as a missing value, not as a
    // difference against undefined, because the fix is different.
    const missing = []
    if (a === undefined) missing.push('tokens.mjs')
    if (b === undefined) missing.push(`style.css ${cssName}`)
    if (c === undefined) missing.push(`tokens.md ${docName}`)
    compared += 3
    if (missing.length) {
      fail(`${docName}: not defined in ${missing.join(', ')}`)
      continue
    }

    if (norm(a) !== norm(b) || norm(a) !== norm(c)) {
      fail(`${docName}: tokens.mjs=${a}  style.css(${cssName})=${b}  tokens.md=${c}`)
      continue
    }
    if (verbose) console.log(`  ok  ${docName.padEnd(18)} ${norm(a)}`)
  }
}

function checkKeySet(label, actual, expected) {
  const extra = actual.filter((k) => !expected.includes(k))
  const missing = expected.filter((k) => !actual.includes(k))
  compared += 1
  if (extra.length || missing.length) {
    fail(`${label} key set: extra=[${extra.join(', ')}] missing=[${missing.join(', ')}]`)
    return
  }
  if (verbose) console.log(`  ok  ${label} key set (${actual.length})`)
}

console.log('token parity: src/tokens.mjs  vs  src/style.css  vs  docs/design/tokens.md')

checkGroup('cause palette', CAUSE_TOKENS, CAUSE_COLOR)
checkGroup('chrome mirrors', CHROME_TOKENS, CHROME)

console.log('\nkey sets')
checkKeySet('tokens.mjs CAUSE_COLOR', Object.keys(CAUSE_COLOR), CAUSE_TOKENS.map((t) => t.key))
checkKeySet('style.css cause palette', css.regionVars, CAUSE_TOKENS.map((t) => t.css))
checkKeySet('tokens.md cause table', doc.causeRows, CAUSE_TOKENS.map((t) => t.doc))

console.log(`\ncompared ${compared} values, ${failures} mismatch(es)`)
process.exit(failures === 0 ? 0 : 1)
