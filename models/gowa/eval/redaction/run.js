#!/usr/bin/env node
"use strict"
/**
 * Redaction check — end-to-end evaluation on the gold set (gold/*.jsonl).
 *
 * Scores what the lawyer would actually get from the engine, not the model alone:
 * candidate collection (patterns, lists, heuristics, pii_candidates) + GOWA's
 * decisions + the harness rules in redaction_v2.js. Every gold entity ends in
 * one of four outcomes:
 *   hidden   ticked findings cover all of it
 *   partial  ticked findings cover part of it (the rest stays visible = a leak)
 *   shown    found, but not ticked (the lawyer sees it in the check and must tick it)
 *   missed   nothing found (the dangerous case: nobody is prompted to look)
 *
 * Modes (all on the same gold):
 *   v1          version 1: pii_detect.scan alone
 *   candidates  every candidate any source proposes — the ceiling GOWA can reach
 *               (GOWA only classifies what it is shown)
 *   oracle      version 2 with a perfect model built from the gold answers — what is left
 *               missing here is the harness's gap, not the model's
 *   gowa        version 2 with the GOWA model given by --model (a release folder
 *               with model.onnx, tokenizer.json, tokenizer_config.json, gowa-model.json)
 *
 * Built around the model's weaknesses: gold entities carry weakness tags
 * (w1 no clue … w9 foreign, see README.md); the report breaks every number down
 * by tag and names the harness piece that has to cover each gap, and it flags
 *   dangerous drop  a gold entity that was a candidate but GOWA confidently threw out
 *   regression      hidden by version 1, not hidden with GOWA
 *
 *   node models/gowa/eval/redaction/run.js                         # v1 + candidates
 *   node models/gowa/eval/redaction/run.js --model /path/release   # + gowa
 *   options: --lang de,cs  --out report.md  --json report.json  --list missed|partial|drops|false
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const HERE = __dirname
const SIDECAR = path.resolve(HERE, '../../../../sidecar')
const MARK = /\[\[(PERSON|ORG|ADDRESS|ID|IBAN|EMAIL|PHONE|DATE|OTHER|NOT|OPT)\|([a-z0-9,]*)\|([^\]]+)\]\]/g
const FIXED = new Set(['IBAN', 'EMAIL', 'PHONE', 'ID', 'DATE'])
const TAGS = {
  w1: ['no clue (no title / role word, unknown first name, lower case)', 'candidate sources: first-name lists per country, lower-case e-mail parts, every capitalised token'],
  w2: ['inflected form', 'propagation: once a name is ticked, tick its declined forms (stem match per language)'],
  w3: ['later mention (surname alone, initials)', 'propagation across the document and the matter: surname / initials of a ticked name'],
  w4: ['no cue context (table, header, signature, ALL CAPS)', 'candidate sources for upper-case lines and table cells; persons fail closed (unsure → ticked)'],
  w5: ['lookalike (surname = common word, person-named firm)', 'GOWA context + rule: a token that is part of a ticked name elsewhere is never dropped'],
  w6: ['boundary (multi-part, split over lines)', 'span merging: adjacent name / address parts become one finding'],
  w8: ['fixed shape (IBAN, e-mail, phone, IDs, date of birth)', 'patterns with checksums — never the model'],
  w9: ['foreign name / address', 'name lists of all supported languages in every document'],
}

function args(argv) {
  const a = { list: [] }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--model') a.model = argv[++i]
    else if (k === '--lang') a.lang = argv[++i].split(',')
    else if (k === '--out') a.out = argv[++i]
    else if (k === '--json') a.json = argv[++i]
    else if (k === '--list') a.list.push(argv[++i])
    else if (k === '--gold') a.gold = argv[++i]
    else throw new Error(`unknown option ${k}`)
  }
  return a
}

/** Strip the markup; return the plain text and the gold spans. */
function parse(marked) {
  let text = ''
  let at = 0
  const spans = []
  for (const m of marked.matchAll(MARK)) {
    text += marked.slice(at, m.index)
    const start = text.length
    text += m[3]
    spans.push({ kind: m[1], tags: m[2] ? m[2].split(',') : [], start, end: text.length, text: m[3] })
    at = m.index + m[0].length
  }
  text += marked.slice(at)
  if (text.includes('[[') || text.includes(']]')) throw new Error('stray markup')
  return { text, spans }
}

function loadGold(dir, langs) {
  const docs = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    for (const [i, line] of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').entries()) {
      if (!line.trim()) continue
      const d = JSON.parse(line)
      if (langs && !langs.includes(d.lang)) continue
      try { docs.push({ ...d, ...parse(d.text) }) } catch (e) { throw new Error(`${f}:${i + 1} ${d.id}: ${e.message}`) }
    }
  }
  return docs
}

/** Characters of [s,e) covered by the given ranges, ignoring whitespace and punctuation. */
function coverage(text, s, e, ranges) {
  let need = 0
  let got = 0
  for (let i = s; i < e; i++) {
    if (!/[\p{L}\p{N}@]/u.test(text[i])) continue
    need++
    if (ranges.some((r) => r.start <= i && i < r.end)) got++
  }
  return need ? got / need : 1
}
const overlaps = (a, list) => list.some((r) => a.start < r.end && r.start < a.end)

function setupEngine(model) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-redeval-'))
  process.env.LEXVAULT_DATA_DIR = data
  const req = (m) => require(path.join(SIDECAR, 'src', m))
  const eng = { detect: req('pii_detect'), candidates: req('pii_candidates'), v2: req('redaction_v2'), harness: req('harness'), gowa: req('gowa') }
  eng.harness.setUserSection('decide', { tasks: { redaction: true } })
  if (model) {
    const dest = path.join(data, 'models', eng.gowa.MANIFEST.id)
    fs.mkdirSync(dest, { recursive: true })
    for (const f of eng.gowa.REQUIRED) {
      const src = path.join(path.resolve(model), f)
      if (!fs.existsSync(src)) throw new Error(`--model: ${f} missing in ${model}`)
      fs.symlinkSync(src, path.join(dest, f))
    }
  }
  return eng
}

// The oracle: a perfect decision model built from the gold answers. It shows how far the harness
// gets when the model is never wrong, so every gap left in "oracle" is the harness's, not GOWA's.
const ORACLE_KIND = { PERSON: 'person', ORG: 'organisation', ADDRESS: 'address', ID: 'id_number', IBAN: 'id_number', DATE: 'other_personal', EMAIL: 'other_personal', PHONE: 'other_personal', OTHER: 'other_personal' }
let oracleDoc = null
const squash = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase()
/** The doc without whitespace, and a map back to the original positions. */
function compact(text) {
  let flat = ''
  const at = []
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { flat += text[i]; at.push(i) }
  return { flat, at }
}
function oracleRule(state, _instructions, options) {
  const m = state.match(/^(.*?)⟦ (.+?) ⟧/s)
  if (!m || !oracleDoc) return null
  const pick = (answer) => options.findIndex((o) => o.startsWith(answer.replace('_', ' ')) || o.startsWith(answer))
  // Where is this occurrence? Match the text just before it plus the candidate, whitespace ignored.
  oracleDoc.flat ??= compact(oracleDoc.text)
  const before = m[1].replace(/^…/, '').replace(/\s+/g, '').slice(-40)
  const cand = m[2].replace(/\s+/g, '')
  const { flat, at } = oracleDoc.flat
  const k = flat.indexOf(before + cand)
  if (k >= 0 && flat.indexOf(before + cand, k + 1) < 0) {
    const s0 = at[k + before.length]
    const e0 = at[k + before.length + cand.length - 1] + 1
    const g = oracleDoc.spans.find((g) => g.kind !== 'OPT' && g.start < e0 && s0 < g.end)
    return pick(!g || g.kind === 'NOT' ? 'not_personal' : ORACLE_KIND[g.kind])
  }
  // Not locatable (repeated passage): decide by the text.
  const c = squash(m[2])
  const g = oracleDoc.spans.find((g) => g.kind !== 'NOT' && g.kind !== 'OPT' && (squash(g.text) === c || squash(g.text).includes(c)))
  return pick(g ? ORACLE_KIND[g.kind] : 'not_personal')
}

async function runDoc(eng, doc, mode) {
  const { text } = doc
  if (mode === 'v1') {
    const f = eng.detect.scan(text, { all: true })
    return { findings: f, candidates: f }
  }
  const base = eng.detect.scan(text, { all: true })
  const { found } = await eng.candidates.find(text, {})
  const cands = [...base, ...found]
  if (mode === 'candidates') return { findings: cands.map((c) => ({ ...c, on: true })), candidates: cands }
  if (mode === 'oracle') {
    oracleDoc = doc
    if (!eng.oracle) eng.oracle = require(path.join(SIDECAR, 'test', 'fixtures', 'scripted_gowa')).scripted(oracleRule)
    eng.gowa._setTestBackend(eng.oracle)
  } else eng.gowa._setTestBackend(null)
  const r = await eng.v2.findings(text, { cache: new Map() })
  if (r.stats.failed) throw new Error(`GOWA failed on ${doc.id}`)
  return { findings: r.findings, candidates: cands, stats: r.stats }
}

function score(doc, out) {
  const ticked = out.findings.filter((f) => f.on)
  const rows = []
  for (const g of doc.spans) {
    if (g.kind === 'OPT') continue
    if (g.kind === 'NOT') {
      rows.push({ g, outcome: coverage(doc.text, g.start, g.end, ticked) > 0 ? 'false_hide' : 'ok' })
      continue
    }
    const c = coverage(doc.text, g.start, g.end, ticked)
    const outcome = c >= 1 ? 'hidden' : c > 0 ? 'partial' : overlaps(g, out.findings) ? 'shown' : 'missed'
    rows.push({ g, outcome, candidate: overlaps(g, out.candidates) })
  }
  const real = doc.spans.filter((g) => g.kind !== 'NOT')
  const extra = ticked.filter((f) => !overlaps(f, real)).length
  return { rows, extra, ticked: ticked.length }
}

function tally(rows, key) {
  const t = {}
  for (const r of rows) {
    for (const k of [].concat(key(r))) {
      t[k] ??= { n: 0, hidden: 0, partial: 0, shown: 0, missed: 0 }
      t[k].n++
      t[k][r.outcome]++
    }
  }
  return t
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–')

async function main() {
  const a = args(process.argv)
  const docs = loadGold(a.gold || path.join(HERE, 'gold'), a.lang)
  if (!docs.length) throw new Error('no gold documents')
  const eng = setupEngine(a.model)
  const modes = ['v1', 'candidates', 'oracle', ...(a.model ? ['gowa'] : [])]
  const res = {}
  for (const mode of modes) {
    const all = []
    let extra = 0
    let ticked = 0
    let leakDocs = 0
    const t0 = Date.now()
    for (const doc of docs) {
      const out = await runDoc(eng, doc, mode)
      const s = score(doc, out)
      s.rows.forEach((r) => { r.doc = doc.id; r.lang = doc.lang; r.doctype = doc.doctype })
      all.push(...s.rows)
      extra += s.extra
      ticked += s.ticked
      if (s.rows.some((r) => r.outcome === 'missed' || r.outcome === 'partial')) leakDocs++
    }
    const ents = all.filter((r) => r.g.kind !== 'NOT')
    const nots = all.filter((r) => r.g.kind === 'NOT')
    res[mode] = {
      rows: all, ents, ms: Date.now() - t0,
      total: tally(ents, () => 'all'), kind: tally(ents, (r) => r.g.kind), tag: tally(ents, (r) => r.g.tags.length ? r.g.tags : ['untagged']),
      lang: tally(ents, (r) => r.lang), doctype: tally(ents, (r) => r.doctype),
      falseHide: nots.filter((r) => r.outcome === 'false_hide').length, nots: nots.length, extra, ticked, leakDocs, docs: docs.length,
    }
  }
  if (res.gowa) {
    const v1 = new Map(res.v1.ents.map((r) => [`${r.doc}:${r.g.start}`, r.outcome]))
    res.gowa.drops = res.gowa.ents.filter((r) => r.candidate && r.outcome === 'missed')
    res.gowa.regressions = res.gowa.ents.filter((r) => v1.get(`${r.doc}:${r.g.start}`) === 'hidden' && r.outcome !== 'hidden')
  }
  const md = report(res, modes, docs)
  if (a.out) fs.writeFileSync(a.out, md)
  process.stdout.write(md)
  for (let what of a.list) {
    const [mn, w] = what.includes(':') ? what.split(':') : [res.gowa ? 'gowa' : 'v1', what]
    const m = res[mn]
    what = w
    const pick = what === 'drops' ? m.drops || [] : what === 'false' ? m.rows.filter((r) => r.outcome === 'false_hide') : m.ents.filter((r) => r.outcome === what)
    console.log(`\n## ${what} (${mn})`)
    for (const r of pick) console.log(`${r.doc}\t${r.g.kind}\t${r.g.tags.join(',')}\t${r.g.text}`)
  }
  if (a.json) fs.writeFileSync(a.json, JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { ...v, rows: undefined, ents: undefined, drops: v.drops?.length, regressions: v.regressions?.length }])), null, 2))
  process.exitCode = gates(res).every((g) => g.pass) ? 0 : 1
}

/** The release gate. Numbers are proposals until the founder signs them off (see README.md). */
function gates(res) {
  const m = res.gowa || res.oracle || res.v1
  const k = (kind) => m.kind[kind] || { n: 0, hidden: 0, missed: 0 }
  const fixed = [...FIXED].reduce((s, x) => ({ n: s.n + k(x).n, hidden: s.hidden + k(x).hidden }), { n: 0, hidden: 0 })
  const out = [
    { name: 'fixed shapes (IBAN, e-mail, phone, IDs, date of birth) hidden ≥ 99%', pass: fixed.n === 0 || fixed.hidden / fixed.n >= 0.99, value: pct(fixed.hidden, fixed.n) },
    { name: 'persons missed (nobody prompted) ≤ 1%', pass: k('PERSON').missed / Math.max(1, k('PERSON').n) <= 0.01, value: pct(k('PERSON').missed, k('PERSON').n) },
    { name: 'persons hidden ≥ 95% in every language', pass: Object.values(tally(m.ents.filter((r) => r.g.kind === 'PERSON'), (r) => r.lang)).every((t) => t.hidden / t.n >= 0.95), value: Object.entries(tally(m.ents.filter((r) => r.g.kind === 'PERSON'), (r) => r.lang)).map(([l, t]) => `${l} ${pct(t.hidden, t.n)}`).join(', ') },
    { name: 'lookalikes wrongly hidden (NOT spans) ≤ 10%', pass: m.falseHide / Math.max(1, m.nots) <= 0.1, value: pct(m.falseHide, m.nots) },
  ]
  if (res.gowa) {
    out.push({ name: 'dangerous drops (candidate confidently thrown out) = 0', pass: res.gowa.drops.length === 0, value: String(res.gowa.drops.length) })
    out.push({ name: 'no regression vs version 1 (hidden by v1, not by GOWA) = 0', pass: res.gowa.regressions.length === 0, value: String(res.gowa.regressions.length) })
  }
  return out
}

function table(title, modes, res, key, label = (x) => x) {
  const keys = [...new Set(modes.flatMap((m) => Object.keys(res[m][key])))].sort()
  let s = `\n### ${title}\n\n| ${key} | n | ${modes.map((m) => `${m} hidden | ${m} missed`).join(' | ')} |\n|---|---|${modes.map(() => '---|---').join('|')}|\n`
  for (const k of keys) {
    const n = res[modes[0]][key][k]?.n || 0
    s += `| ${label(k)} | ${n} | ${modes.map((m) => { const t = res[m][key][k] || { n: 0 }; return `${pct(t.hidden, t.n)} | ${pct(t.missed, t.n)}` }).join(' | ')} |\n`
  }
  return s
}

function report(res, modes, docs) {
  const m = res.gowa || res.oracle || res.v1
  let s = `# Redaction check — evaluation\n\n${docs.length} documents, ${m.ents.length} entities, ${m.nots} lookalikes (${[...new Set(docs.map((d) => d.lang))].join(', ')}). ${new Date().toISOString().slice(0, 16)}Z\n\n`
  s += `## Release gate (${res.gowa ? 'with GOWA' : 'oracle: a perfect model — the harness ceiling'})\n\n`
  for (const g of gates(res)) s += `- ${g.pass ? 'PASS' : '**FAIL**'} — ${g.name}: ${g.value}\n`
  s += `\n## Outcomes\n\n| mode | hidden | partial | shown (unticked) | missed | docs with a leak | lookalikes hidden | extra ticks | time |\n|---|---|---|---|---|---|---|---|---|\n`
  for (const mo of modes) {
    const r = res[mo]
    const t = r.total.all
    s += `| ${mo} | ${pct(t.hidden, t.n)} | ${pct(t.partial, t.n)} | ${pct(t.shown, t.n)} | ${pct(t.missed, t.n)} | ${r.leakDocs}/${r.docs} | ${pct(r.falseHide, r.nots)} | ${r.extra} | ${(r.ms / 1000).toFixed(1)}s |\n`
  }
  s += `\n"candidates" is the ceiling: what no source proposes, GOWA never sees.\n`
  if (res.gowa) s += `\nDangerous drops: **${res.gowa.drops.length}** · regressions vs v1: **${res.gowa.regressions.length}** (list them with --list drops)\n`
  s += table('By weakness — where the harness has to cover the model', modes, res, 'tag', (k) => (TAGS[k] ? `${k} ${TAGS[k][0]}` : k))
  s += `\n| tag | the harness piece that covers it |\n|---|---|\n${Object.entries(TAGS).map(([k, v]) => `| ${k} | ${v[1]} |`).join('\n')}\n`
  s += table('By kind', modes, res, 'kind')
  s += table('By language', modes, res, 'lang')
  s += table('By document type', modes, res, 'doctype')
  return s
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(2) })
