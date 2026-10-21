"use strict"
/**
 * Document workflows (Phase 4): contract translation and version comparison.
 *
 *   translate — paragraph-aligned translation into a target language, as a
 *               Word file plus a side-by-side review table. Deterministic
 *               checks per paragraph: every number (amounts, dates, section
 *               and article numbers) must survive, glossary terms must be
 *               used, nothing may be dropped. Failures are flagged for the
 *               lawyer, never silently accepted.
 *   compare   — paragraph + word level diff of two versions (deterministic,
 *               works offline without any model), then the model rates each
 *               change's materiality in one line. The diff is the source of
 *               truth; the model only annotates it.
 *
 * Outputs go to the matter's workspace folder (.docx + .md).
 */

const path = require('path')
const wf = require('./workflows')
const { docxBuffer } = require('./docx_write')

const LANGS = {
  en: 'English', de: 'German', fr: 'French', it: 'Italian', es: 'Spanish', nl: 'Dutch', pl: 'Polish',
  cs: 'Czech', sk: 'Slovak', ro: 'Romanian', hu: 'Hungarian', hr: 'Croatian', sl: 'Slovenian', el: 'Greek', pt: 'Portuguese',
}
const BATCH_CHARS = 5000

// ── shared ───────────────────────────────────────────────────────────────
function paragraphs(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split(/\n+/).map((p) => p.trim()).filter(Boolean)
}

/** Resolve a document: absolute path, or a file name inside the matter's folders. */
function resolveDoc(matterId, file) {
  if (!file) throw new Error('no document given')
  if (path.isAbsolute(file)) return file
  const docs = wf.listDocs(wf.matterFolders(matterId))
  const hit = docs.find((d) => path.basename(d) === file) || docs.find((d) => path.basename(d).toLowerCase().includes(String(file).toLowerCase()))
  if (!hit) throw new Error(`"${file}" is not in this matter's folders`)
  return hit
}

const stamp = () => new Date().toISOString().slice(0, 10)
const safeBase = (f) => path.basename(f).replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 80)

// ── translation checks ───────────────────────────────────────────────────
/**
 * Numbers as a multiset of digit strings. "EUR 1.250.000,00" and
 * "EUR 1,250,000.00" both → ["125000000"]; "§ 12 Abs 3" → ["12","3"].
 * Separators differ by language, digits must not.
 */
function numbersIn(text) {
  const out = []
  // Dates first: "30.10.2026" and "30 October 2026" are the same date.
  const t = wf.canonicalDates(text).replace(/⟦(\d{4})-(\d{2})-(\d{2})⟧/g, (m0, y, mo, d) => { out.push(`date:${y}${mo}${d}`); return ' ' })
  for (const m of t.matchAll(/\d[\d.,'’   ]*\d|\d/g)) {
    // A group like "12, 13" (list) is two numbers, "1.250.000,00" is one:
    // split on ", " / "; " but keep grouped separators.
    for (const part of m[0].split(/[,;]\s+/)) {
      const digits = part.replace(/\D/g, '')
      if (digits) out.push(digits.replace(/^0+(?=\d)/, ''))
    }
  }
  return out.sort()
}

function sameNumbers(a, b) {
  const x = numbersIn(a)
  const y = numbersIn(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

function loadGlossary(name, target) {
  if (!name) return {}
  const ws = require('./workspace')
  const raw = ws.readFile(`glossaries/${String(name).replace(/[^\w\-.]/g, '')}.json`, 200000)
  if (raw === null) throw new Error(`no glossary "${name}" in the workspace glossaries/ folder`)
  const g = JSON.parse(raw)
  // { "terms": { "Auftragnehmer": "Contractor" } } or per language { "en": {…} }
  return g[target] || g.terms || g
}

function glossaryMisses(source, translation, glossary) {
  const misses = []
  const s = source.toLowerCase()
  const t = translation.toLowerCase()
  for (const [from, to] of Object.entries(glossary || {})) {
    if (typeof to !== 'string' || !from) continue
    if (s.includes(from.toLowerCase()) && !t.includes(to.toLowerCase())) misses.push(`${from} → ${to}`)
  }
  return misses
}

function translatePrompt(batch, targetName, glossary, docName) {
  const terms = Object.entries(glossary || {}).filter(([, v]) => typeof v === 'string')
  return [
    { role: 'system', content: `You are a legal translator. Translate contract and statute text into ${targetName}. Translate every paragraph completely: never summarise, merge, split or omit. Keep numbering, section and article references, amounts, dates, party names and defined terms exactly; use the same ${targetName} term for a defined term every time.${terms.length ? ' Use this firm glossary: ' + terms.map(([a, b]) => `"${a}" → "${b}"`).join('; ') + '.' : ''}` },
    { role: 'user', content: `DOCUMENT: ${docName}\nTranslate each paragraph into ${targetName}. Reply with JSON only: [{"i": <paragraph number>, "t": "<translation>"}] — one object per paragraph, same numbers.\n\n${batch.map(({ i, text }) => `[${i}] ${text}`).join('\n\n')}` },
  ]
}

function batches(paras) {
  const out = []
  let cur = []
  let size = 0
  paras.forEach((text, i) => {
    if (cur.length && size + text.length > BATCH_CHARS) { out.push(cur); cur = []; size = 0 }
    cur.push({ i, text })
    size += text.length
  })
  if (cur.length) out.push(cur)
  return out
}

async function translateBatch(batch, targetName, glossary, docName) {
  const items = await wf.askJson(translatePrompt(batch, targetName, glossary, docName), Math.min(8000, 400 + Math.ceil(batch.reduce((n, b) => n + b.text.length, 0) / 2)), 'translate')
  const got = new Map()
  for (const it of Array.isArray(items) ? items : []) {
    const i = Number(it?.i)
    if (Number.isInteger(i) && typeof it.t === 'string' && it.t.trim()) got.set(i, it.t.trim())
  }
  return got
}

const looksLikeHeading = (p) => p.length < 90 && !/[.;:,]$/.test(p) && /^(§|Art\.?|Article|Artikel|Section|Clause|Klausel|Punkt|[IVX]+\.|\d+(\.\d+)*\.?\s)/i.test(p)

async function runTranslate({ matterId, file, target = 'en', glossary: glossaryName, onProgress, signal } = {}) {
  const targetName = LANGS[target] || target
  const src = resolveDoc(matterId, file)
  const name = path.basename(src)
  const paras = paragraphs(await wf.readDoc(src))
  if (!paras.length) throw new Error(`${name}: no text found (scanned PDF where OCR found nothing?)`)
  const glossary = loadGlossary(glossaryName, target)
  const out = new Array(paras.length).fill(null)
  const bs = batches(paras)
  for (const [bi, batch] of bs.entries()) {
    if (signal?.aborted) break
    onProgress?.({ step: 'translate', index: bi + 1, total: bs.length, name })
    let got
    try { got = await translateBatch(batch, targetName, glossary, name) } catch { got = new Map() }
    // Paragraphs the model skipped or whose numbers changed get one retry
    // on their own — small batches are where models stop dropping text.
    for (const { i, text } of batch) {
      let t = got.get(i)
      if (!t || !sameNumbers(text, t)) {
        try { t = (await translateBatch([{ i, text }], targetName, glossary, name)).get(i) || t } catch { /* keep first */ }
      }
      out[i] = t || null
    }
  }
  const flags = []
  paras.forEach((p, i) => {
    const t = out[i]
    if (!t) { flags.push({ i, issue: 'not translated (model returned nothing)' }); return }
    if (!sameNumbers(p, t)) flags.push({ i, issue: `numbers differ: ${numbersIn(p).join(' ')} → ${numbersIn(t).join(' ')}` })
    const miss = glossaryMisses(p, t, glossary)
    if (miss.length) flags.push({ i, issue: `glossary not used: ${miss.join(', ')}` })
  })

  const ws = require('./workspace')
  const folder = ws.matterFolder(wf.matterLabel(matterId))
  const base = `${safeBase(name)}.${target}`
  const translated = docxBuffer(paras.map((p, i) => ({
    text: out[i] || `[NOT TRANSLATED] ${p}`,
    style: looksLikeHeading(p) ? 'Heading2' : null,
  })))
  const flagged = new Set(flags.map((f) => f.i))
  const review = docxBuffer([
    { text: `${name} → ${targetName}`, style: 'Title' },
    { text: `${stamp()} · ${paras.length} paragraphs · ${flags.length} flags · machine translation for review, not a certified translation` },
    { table: [['Original', targetName], ...paras.map((p, i) => [
      flagged.has(i) ? [{ text: `⚑ ${flags.filter((f) => f.i === i).map((f) => f.issue).join('; ')}\n`, bold: true, color: 'C00000' }, { text: p }] : p,
      out[i] || '',
    ])] },
  ])
  const md = [`# Translation check — ${name} → ${targetName}`, '', `${stamp()} · ${paras.length} paragraphs · ${flags.length} flags`, '',
    ...(flags.length ? flags.map((f) => `- ¶${f.i + 1}: ${f.issue}\n  > ${paras[f.i].slice(0, 200)}`) : ['No issues: every paragraph translated, all numbers preserved, glossary respected.'])]
  const files = [
    ws.writeFileBinary(`${folder}/${base}.docx`, translated),
    ws.writeFileBinary(`${folder}/${base}.review.docx`, review),
    ws.writeFile(`${folder}/${base}.check.md`, md.join('\n')),
  ]
  return { files, stats: { paragraphs: paras.length, translated: out.filter(Boolean).length, flags: flags.length }, flags }
}

// ── comparison ───────────────────────────────────────────────────────────
/** LCS-based diff of two token arrays → [{ op: '='|'-'|'+', a, b }] runs. */
function diff(a, b, eq = (x, y) => x === y) {
  const n = a.length
  const m = b.length
  // Trim common prefix/suffix first: keeps the DP table small for edits.
  let pre = 0
  while (pre < n && pre < m && eq(a[pre], b[pre])) pre++
  let suf = 0
  while (suf < n - pre && suf < m - pre && eq(a[n - 1 - suf], b[m - 1 - suf])) suf++
  const A = a.slice(pre, n - suf)
  const B = b.slice(pre, m - suf)
  if (A.length * B.length > 4e6) throw new Error('documents too different to compare paragraph by paragraph')
  const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1))
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) {
    dp[i][j] = eq(A[i], B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  }
  const ops = []
  for (let k = 0; k < pre; k++) ops.push({ op: '=', a: a[k], b: b[k] })
  let i = 0
  let j = 0
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && eq(A[i], B[j])) { ops.push({ op: '=', a: A[i], b: B[j] }); i++; j++ }
    // Ties go to deletion first: redlines read "old → new".
    else if (i < A.length && (j >= B.length || dp[i + 1][j] >= dp[i][j + 1])) { ops.push({ op: '-', a: A[i] }); i++ }
    else { ops.push({ op: '+', b: B[j] }); j++ }
  }
  for (let k = n - suf; k < n; k++) ops.push({ op: '=', a: a[k], b: b[k - n + m] })
  return ops
}

/** Group paragraph ops into change hunks: runs of '-'/'+' between equal paragraphs. */
function hunks(ops) {
  const out = []
  let cur = null
  ops.forEach((o) => {
    if (o.op === '=') { cur = null; return }
    if (!cur) { cur = { removed: [], added: [] }; out.push(cur) }
    if (o.op === '-') cur.removed.push(o.a)
    else cur.added.push(o.b)
  })
  return out.map((h) => ({ ...h, kind: !h.removed.length ? 'added' : !h.added.length ? 'deleted' : 'changed' }))
}

/** Word-level runs for one changed hunk: [{ text, del|ins }]. */
function wordRuns(oldText, newText) {
  const tok = (s) => s.match(/\s+|[^\s]+/g) || []
  const ops = diff(tok(oldText), tok(newText))
  const runs = []
  for (const o of ops) {
    const text = o.op === '+' ? o.b : o.a
    const kind = o.op === '=' ? 'same' : o.op === '-' ? 'del' : 'ins'
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.text += text
    else runs.push({ text, kind })
  }
  return runs
}

async function rateChanges(hs, nameA, nameB) {
  const list = hs.map((h, i) => `[${i}] ${h.kind.toUpperCase()}\nOLD: ${h.removed.join(' / ').slice(0, 700) || '—'}\nNEW: ${h.added.join(' / ').slice(0, 700) || '—'}`)
  const ratings = new Map()
  for (let start = 0; start < list.length; start += 12) {
    const items = await wf.askJson([
      { role: 'system', content: 'You compare two versions of a legal document for a lawyer. Judge each change only from the OLD and NEW text shown. Never invent content.' },
      { role: 'user', content: `${nameA} → ${nameB}\n\n${list.slice(start, start + 12).join('\n\n')}\n\nFor each change reply with JSON only: [{"i": <number>, "materiality": "high|medium|low|editorial", "summary": "<one sentence: what changed legally and whom it favours>"}]` },
    ], 2500)
    for (const it of Array.isArray(items) ? items : []) {
      const i = Number(it?.i)
      if (Number.isInteger(i) && i >= 0 && i < hs.length && typeof it.summary === 'string') {
        ratings.set(i, { materiality: ['high', 'medium', 'low', 'editorial'].includes(it.materiality) ? it.materiality : 'medium', summary: it.summary.trim() })
      }
    }
  }
  return ratings
}

async function runCompare({ matterId, fileA, fileB, rate = true, onProgress, signal } = {}) {
  const a = resolveDoc(matterId, fileA)
  const b = resolveDoc(matterId, fileB)
  const nameA = path.basename(a)
  const nameB = path.basename(b)
  onProgress?.({ step: 'read', name: `${nameA} / ${nameB}` })
  const pa = paragraphs(await wf.readDoc(a))
  const pb = paragraphs(await wf.readDoc(b))
  const hs = hunks(diff(pa, pb, (x, y) => wf.norm(x) === wf.norm(y)))
  let ratings = new Map()
  let rateError = null
  if (rate && hs.length && !signal?.aborted) {
    onProgress?.({ step: 'rate', total: hs.length })
    try { ratings = await rateChanges(hs, nameA, nameB) } catch (err) { rateError = err.message }
  }
  const order = { high: 0, medium: 1, low: 2, editorial: 3 }
  const rows = hs.map((h, i) => ({ ...h, i, ...(ratings.get(i) || {}) }))
  const counts = rows.reduce((c, r) => { c[r.materiality || 'unrated'] = (c[r.materiality || 'unrated'] || 0) + 1; return c }, {})

  const ws = require('./workspace')
  const folder = ws.matterFolder(wf.matterLabel(matterId))
  const base = `compare-${safeBase(nameA)}-vs-${safeBase(nameB)}-${stamp()}`
  const blocks = [
    { text: `${nameA} → ${nameB}`, style: 'Title' },
    { text: `${stamp()} · ${hs.length} changes${Object.keys(counts).length ? ' · ' + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') : ''}${rateError ? ` · materiality not rated (${rateError})` : ''}` },
  ]
  for (const r of [...rows].sort((x, y) => (order[x.materiality] ?? 4) - (order[y.materiality] ?? 4) || x.i - y.i)) {
    blocks.push({ text: `Change ${r.i + 1} · ${r.kind}${r.materiality ? ` · ${r.materiality}` : ''}`, style: 'Heading2' })
    if (r.summary) blocks.push({ runs: [{ text: r.summary, bold: true }] })
    const old = r.removed.join('\n')
    const neu = r.added.join('\n')
    const runs = r.kind === 'changed'
      ? wordRuns(old, neu).map((w) => ({ text: w.text, strike: w.kind === 'del', underline: w.kind === 'ins', color: w.kind === 'del' ? 'C00000' : w.kind === 'ins' ? '1F6F3F' : null }))
      : [{ text: old || neu, strike: r.kind === 'deleted', underline: r.kind === 'added', color: r.kind === 'deleted' ? 'C00000' : '1F6F3F' }]
    blocks.push({ runs })
  }
  if (!hs.length) blocks.push({ text: 'No differences in the text (formatting is not compared).' })
  const md = [`# ${nameA} → ${nameB}`, '', blocks[1].text, '',
    ...rows.map((r) => {
      const body = r.kind === 'changed'
        ? wordRuns(r.removed.join(' / '), r.added.join(' / ')).map((w) => (w.kind === 'del' ? `[-${w.text}-]` : w.kind === 'ins' ? `{+${w.text}+}` : w.text)).join('')
        : (r.kind === 'deleted' ? `[-${r.removed.join(' / ')}-]` : `{+${r.added.join(' / ')}+}`)
      return `## Change ${r.i + 1} · ${r.kind}${r.materiality ? ` · ${r.materiality}` : ''}\n\n${r.summary ? `**${r.summary}**\n\n` : ''}${body}\n`
    })]
  const files = [ws.writeFileBinary(`${folder}/${base}.docx`, docxBuffer(blocks)), ws.writeFile(`${folder}/${base}.md`, md.join('\n'))]
  return { files, changes: rows, stats: { paragraphsA: pa.length, paragraphsB: pb.length, changes: hs.length, ...counts, ...(rateError ? { rateError } : {}) } }
}

module.exports = { runTranslate, runCompare, numbersIn, sameNumbers, glossaryMisses, diff, hunks, wordRuns, paragraphs, LANGS }
