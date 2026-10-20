"use strict"
/**
 * Legal workflows over a whole matter (Phase 4).
 *
 *   review      — answer a checklist (playbook) for every document
 *   chronology  — extract dated events from every document, merged + sorted
 *
 * Documents: the matter's firm-library folders (+ an optional extra folder).
 * Model: whatever llm.js routes to, under the matter's data policy.
 *
 * Verification (the anti-hallucination rule, deterministic): every finding
 * and every event must carry a quote that appears verbatim in its source
 * document (whitespace/quote-style normalised). Anything that fails is
 * dropped and counted as "unverified" in the report — never shown as fact.
 *
 * Output: Markdown + CSV in the matter's workspace folder.
 */

const fs = require('fs')
const path = require('path')
const { docxText } = require('./docx_text')
const { pdfText } = require('./pdf_text')

const EXTS = new Set(['.docx', '.pdf', '.txt', '.md'])
const PART_CHARS = 12000 // per model call; documents are split on paragraph boundaries

// Built-in checklist for commercial contracts. Firms add their own as
// workspace playbooks/<name>.json: { "title": "...", "checks": [{ "id", "question", "severity" }] }
const DEFAULT_PLAYBOOK = {
  title: 'Commercial contract basics',
  checks: [
    { id: 'governing_law', question: 'Which law governs the contract, and which courts or arbitration have jurisdiction?', severity: 'medium' },
    { id: 'liability_cap', question: 'Is liability capped or excluded? At what amount, and with which carve-outs (intent, gross negligence)?', severity: 'high' },
    { id: 'termination', question: 'Can a party terminate for convenience or only for cause? Notice periods?', severity: 'high' },
    { id: 'change_of_control', question: 'Is there a change-of-control clause (consent, termination right) that a transaction would trigger?', severity: 'high' },
    { id: 'assignment', question: 'Can the contract be assigned or transferred, and is consent required?', severity: 'medium' },
    { id: 'exclusivity', question: 'Are there exclusivity, non-compete or non-solicitation obligations?', severity: 'high' },
    { id: 'renewal', question: 'Does the contract renew automatically? Term and renewal notice deadlines?', severity: 'medium' },
    { id: 'data_protection', question: 'Does the contract address personal data / GDPR (processing agreement, transfers)?', severity: 'medium' },
  ],
}

// ── documents ────────────────────────────────────────────────────────────
function matterFolders(matterId, extraFolder) {
  const lib = require('./library').status()
  const folders = lib.folders.filter((f) => f.matterId && f.matterId === matterId).map((f) => f.path)
  if (extraFolder) folders.push(path.resolve(extraFolder))
  return [...new Set(folders)]
}

function listDocs(folders) {
  const out = []
  const walk = (dir) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(p)
    }
  }
  folders.forEach(walk)
  return out.sort()
}

async function readDoc(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.docx') return docxText(file)
  if (ext === '.pdf') return pdfText(file)
  return fs.readFileSync(file, 'utf8')
}

function parts(text) {
  if (text.length <= PART_CHARS) return [text]
  const out = []
  let cur = ''
  for (const para of text.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length > PART_CHARS) { out.push(cur); cur = '' }
    cur += (cur ? '\n\n' : '') + para
    while (cur.length > PART_CHARS) { out.push(cur.slice(0, PART_CHARS)); cur = cur.slice(PART_CHARS) }
  }
  if (cur.trim()) out.push(cur)
  return out
}

// ── verification ─────────────────────────────────────────────────────────
const norm = (s) => String(s || '')
  .replace(/[‘’‚‛]/g, "'")
  .replace(/[“”„‟«»]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

/** A quote verifies if (normalised) it occurs in the source. Ellipses split it into parts that must all occur in order. */
function quoteInSource(quote, source) {
  const q = norm(quote)
  if (q.length < 8) return false
  const src = norm(source)
  let from = 0
  for (const piece of q.split(/\s*(?:\.\.\.|…)\s*/).filter(Boolean)) {
    const at = src.indexOf(piece, from)
    if (at < 0) return false
    from = at + piece.length
  }
  return true
}

// ── model I/O ────────────────────────────────────────────────────────────
/**
 * JSON from a model reply: tolerant of fences, <think> blocks, prose, a
 * wrapping object ({"events": [...]}) and several top-level values.
 * Returns an array of items.
 */
function extractJson(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '')
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : s
  const values = []
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '[' && body[i] !== '{') continue
    // Balanced scan (string-aware) to the matching close bracket.
    let depth = 0, inStr = false, esc = false, end = -1
    for (let j = i; j < body.length; j++) {
      const c = body[j]
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
      if (c === '"') inStr = true
      else if (c === '[' || c === '{') depth++
      else if (c === ']' || c === '}') { depth--; if (depth === 0) { end = j; break } }
    }
    if (end < 0) break
    try { values.push(JSON.parse(body.slice(i, end + 1))); i = end } catch { /* not JSON here, keep scanning */ }
  }
  if (!values.length) throw new Error('no JSON in model reply')
  const items = []
  for (const v of values) {
    if (Array.isArray(v)) items.push(...v)
    else if (v && typeof v === 'object') {
      const arr = Object.values(v).find(Array.isArray)
      if (arr && Object.keys(v).length <= 2) items.push(...arr) // {"events": [...]}, {"findings": [...]}
      else items.push(v)
    }
  }
  return items
}

// ── dates in quotes (chronology verification) ────────────────────────────
const MONTHS = {
  jan: 1, jän: 1, jänner: 1, januar: 1, january: 1, janvier: 1, gennaio: 1, ianuarie: 1,
  feb: 2, februar: 2, february: 2, février: 2, fevrier: 2, febbraio: 2, februarie: 2,
  mär: 3, märz: 3, maerz: 3, mar: 3, march: 3, mars: 3, marzo: 3, martie: 3,
  apr: 4, april: 4, avril: 4, aprile: 4, aprilie: 4,
  mai: 5, may: 5, maggio: 5,
  jun: 6, juni: 6, june: 6, juin: 6, giugno: 6, iunie: 6,
  jul: 7, juli: 7, july: 7, juillet: 7, luglio: 7, iulie: 7,
  aug: 8, august: 8, août: 8, aout: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, settembre: 9, septembrie: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, octobre: 10, ottobre: 10, octombrie: 10,
  nov: 11, november: 11, novembre: 11, noiembrie: 11,
  dez: 12, dec: 12, dezember: 12, december: 12, décembre: 12, decembre: 12, dicembre: 12, decembrie: 12,
  // Czech, Slovak, Polish, Spanish, Dutch, Portuguese, Hungarian, Greek
  // (nominative + genitive), so translated dates can be checked too.
  leden: 1, ledna: 1, január: 1, januára: 1, stycznia: 1, enero: 1, januari: 1, janeiro: 1, ιανουαρίου: 1,
  únor: 2, února: 2, február: 2, februára: 2, lutego: 2, febrero: 2, februari: 2, fevereiro: 2, φεβρουαρίου: 2,
  březen: 3, března: 3, marec: 3, marca: 3, maart: 3, março: 3, március: 3, μαρτίου: 3,
  duben: 4, dubna: 4, apríl: 4, apríla: 4, kwietnia: 4, abril: 4, április: 4, απριλίου: 4,
  květen: 5, května: 5, máj: 5, mája: 5, maja: 5, mayo: 5, mei: 5, maio: 5, május: 5, μαΐου: 5,
  červen: 6, června: 6, jún: 6, júna: 6, czerwca: 6, junio: 6, junho: 6, június: 6, ιουνίου: 6,
  červenec: 7, července: 7, júl: 7, júla: 7, lipca: 7, julio: 7, julho: 7, július: 7, ιουλίου: 7,
  srpen: 8, srpna: 8, augusta: 8, sierpnia: 8, augustus: 8, augusztus: 8, αυγούστου: 8,
  září: 9, septembra: 9, września: 9, septiembre: 9, setiembre: 9, setembro: 9, szeptember: 9, σεπτεμβρίου: 9,
  říjen: 10, října: 10, október: 10, októbra: 10, października: 10, octubre: 10, outubro: 10, οκτωβρίου: 10,
  listopad: 11, listopadu: 11, novembra: 11, listopada: 11, noviembre: 11, novembro: 11, νοεμβρίου: 11,
  prosinec: 12, prosince: 12, decembra: 12, grudnia: 12, diciembre: 12, dezembro: 12, δεκεμβρίου: 12,
}
const pad = (n) => String(n).padStart(2, '0')

/**
 * Replace full dates in a text with canonical ⟦YYYY-MM-DD⟧ tokens — "30.10.2026",
 * "30 October 2026", "30 de octubre de 2026", "2026. október 30." all become
 * ⟦2026-10-30⟧. Used to compare a translation's numbers with the original.
 */
function canonicalDates(text) {
  const ok = (y, m, d) => y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
  const tok = (y, m, d) => (ok(+y, +m, +d) ? `⟦${y}-${pad(+m)}-${pad(+d)}⟧` : null)
  const mon = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
  let t = String(text || '')
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m0, y, mo, d) => tok(y, mo, d) || m0)
  t = t.replace(/\b(\d{1,2})[./]\s?(\d{1,2})[./]\s?(\d{4})\b/g, (m0, d, mo, y) => tok(y, mo, d) || m0)
  t = t.replace(new RegExp(`\\b(\\d{1,2})\\.?\\s+(?:de\\s+|of\\s+)?(${mon})\\.?\\s+(?:de\\s+)?(\\d{4})`, 'giu'), (m0, d, name, y) => tok(y, MONTHS[name.toLowerCase()], d) || m0)
  t = t.replace(new RegExp(`\\b(${mon})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'giu'), (m0, name, d, y) => tok(y, MONTHS[name.toLowerCase()], d) || m0)
  t = t.replace(new RegExp(`\\b(\\d{4})\\.\\s+(${mon})\\s+(\\d{1,2})\\.?`, 'giu'), (m0, y, name, d) => tok(y, MONTHS[name.toLowerCase()], d) || m0)
  return t
}

/** Dates written in a quote, as YYYY-MM-DD / YYYY-MM strings. */
function datesInText(text) {
  const t = String(text || '').toLowerCase()
  const out = new Set()
  const ok = (y, m, d) => y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && (!d || d <= new Date(Date.UTC(y, m, 0)).getUTCDate())
  for (const [, y, m, d] of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) if (ok(+y, +m, +d)) out.add(`${y}-${m}-${d}`)
  for (const [, d, m, y] of t.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/g)) if (ok(+y, +m, +d)) out.add(`${y}-${pad(m)}-${pad(d)}`)
  const mon = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
  for (const [, d, name, y] of t.matchAll(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${mon})\\.?\\s+(\\d{4})\\b`, 'gu'))) if (ok(+y, MONTHS[name], +d)) out.add(`${y}-${pad(MONTHS[name])}-${pad(d)}`)
  for (const [, name, d, y] of t.matchAll(new RegExp(`\\b(${mon})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gu'))) if (ok(+y, MONTHS[name], +d)) out.add(`${y}-${pad(MONTHS[name])}-${pad(d)}`)
  if (!out.size) for (const [, name, y] of t.matchAll(new RegExp(`\\b(${mon})\\.?\\s+(\\d{4})\\b`, 'gu'))) if (ok(+y, MONTHS[name])) out.add(`${y}-${pad(MONTHS[name])}`)
  return [...out]
}

async function askJson(messages, maxTokens) {
  const { chat } = require('./llm')
  const reply = await chat(messages, { maxTokens, temperature: 0 })
  try { return extractJson(reply) } catch {
    // One repair attempt: ask for the JSON only.
    const again = await chat([...messages, { role: 'assistant', content: reply }, { role: 'user', content: 'Reply again with ONLY the JSON, no prose.' }], { maxTokens, temperature: 0 })
    return extractJson(again)
  }
}

function reviewPrompt(playbook, docName, part, idx, total) {
  const checks = playbook.checks.map((c) => `- ${c.id}: ${c.question}${c.standard ? ` (firm standard: ${c.standard})` : ''}`).join('\n')
  return [
    { role: 'system', content: 'You review legal documents for a law firm. Answer only from the document text. Never guess. Every finding must quote the document verbatim (copy the exact words).' },
    { role: 'user', content: `DOCUMENT: ${docName}${total > 1 ? ` (part ${idx + 1} of ${total})` : ''}\n"""\n${part}\n"""\n\nCHECKLIST:\n${checks}\n\nFor each checklist item that this text addresses, return one object. Skip items it does not address.\nReply with JSON only: [{"check": "<id>", "answer": "<one or two sentences>", "quote": "<exact words from the document, max 300 chars>", "location": "<clause/section number or [Page N] if visible>", "risk": "high|medium|low"}]` },
  ]
}

function chronologyPrompt(docName, part, idx, total) {
  return [
    { role: 'system', content: 'You extract a chronology for a lawyer. Only events with a date that is stated in the text. Never infer dates. Quote the document verbatim for every event.' },
    { role: 'user', content: `DOCUMENT: ${docName}${total > 1 ? ` (part ${idx + 1} of ${total})` : ''}\n"""\n${part}\n"""\n\nList every dated event (signing, deadlines, notices, payments, meetings, filings, terminations).\nReply with JSON only: [{"date": "YYYY-MM-DD or YYYY-MM or YYYY", "event": "<what happened or is due>", "quote": "<exact words from the document containing the date, max 300 chars>"}]` },
  ]
}

// ── runs ─────────────────────────────────────────────────────────────────
// Starter playbooks shipped with OpenLex (sidecar/playbooks). A firm file
// with the same name in the workspace playbooks/ folder takes precedence.
const BUNDLED_PLAYBOOKS = path.join(__dirname, '..', 'playbooks')

function bundledPlaybooks() {
  try { return fs.readdirSync(BUNDLED_PLAYBOOKS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) } catch { return [] }
}

function loadPlaybook(name) {
  if (!name) return DEFAULT_PLAYBOOK
  const ws = require('./workspace')
  const file = String(name).replace(/[^\w\-.]/g, '')
  let raw = ws.readFile(`playbooks/${file}.json`, 200000)
  if (raw === null && bundledPlaybooks().includes(file)) raw = fs.readFileSync(path.join(BUNDLED_PLAYBOOKS, `${file}.json`), 'utf8')
  if (raw === null) throw new Error(`no playbook "${name}" in the workspace playbooks/ folder or the bundled playbooks`)
  const pb = JSON.parse(raw)
  if (!Array.isArray(pb.checks) || !pb.checks.length) throw new Error(`playbook "${name}" has no "checks" (LLM checklist format: { "checks": [{ "id", "question" }] })`)
  return { title: pb.title || name, checks: pb.checks.filter((c) => c && c.id && c.question) }
}

/**
 * Playbook builder (Phase 7.2): derive a review checklist from the firm's
 * own precedents — the questions to ask and the firm's standard position
 * on each, as written in those documents. Returns a draft for the lawyer
 * to edit; savePlaybook() stores it in the workspace playbooks/ folder.
 */
async function draftPlaybook({ files = [], matterId = null, folder, title, focus = '' } = {}) {
  let docs = files.map((f) => path.resolve(String(f)))
  if (!docs.length) docs = listDocs(matterFolders(matterId, folder))
  if (!docs.length) throw new Error('No precedent documents: pass files, or a matter/folder with documents.')
  docs = docs.slice(0, 5)
  const texts = []
  for (const d of docs) {
    try { texts.push(`=== ${path.basename(d)} ===\n${String(await readDoc(d)).slice(0, 9000)}`) } catch { /* unreadable: skip */ }
  }
  if (!texts.length) throw new Error('none of the documents could be read')
  const items = await askJson([
    { role: 'system', content: 'You build review checklists (playbooks) for a law firm from its own precedent documents. Only state positions that the precedents actually contain. Never invent law.' },
    { role: 'user', content: `PRECEDENTS (the firm's standard documents):\n${texts.join('\n\n')}\n\n${focus ? `FOCUS: ${String(focus).slice(0, 500)}\n\n` : ''}Write 6–15 checklist items a lawyer should check when reviewing a counterparty's draft of this kind of contract. For each: the question, the firm's standard position as the precedents show it, a short verbatim quote from a precedent that shows it, and the severity if a draft deviates.\nReply with JSON only: [{"id": "<snake_case>", "question": "<question>", "standard": "<firm position, one sentence>", "quote": "<exact words from a precedent>", "severity": "high|medium|low"}]` },
  ], 3000)
  const all = texts.join('\n')
  const seen = new Set()
  const checks = []
  for (const it of Array.isArray(items) ? items : []) {
    const id = String(it.id || it.question || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
    if (!id || !it.question || seen.has(id)) continue
    seen.add(id)
    // A standard is only kept with proof from the precedents (verbatim quote).
    const proven = quoteInSource(it.quote, all)
    checks.push({ id, question: String(it.question).slice(0, 300), ...(proven && it.standard ? { standard: String(it.standard).slice(0, 300), source: String(it.quote).slice(0, 300) } : {}), severity: ['high', 'medium', 'low'].includes(it.severity) ? it.severity : 'medium' })
  }
  if (!checks.length) throw new Error('the model returned no usable checklist items')
  return { playbook: { title: String(title || 'Firm playbook').slice(0, 120), checks }, documents: docs.map((d) => path.basename(d)), unproven: checks.filter((c) => !c.standard).length }
}

function savePlaybook(name, playbook) {
  const file = String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  if (!file) throw new Error('playbook name required')
  if (!playbook || !Array.isArray(playbook.checks) || !playbook.checks.length) throw new Error('playbook needs checks: [{ id, question }]')
  const checks = playbook.checks.filter((c) => c && c.id && c.question)
  if (!checks.length) throw new Error('every check needs an id and a question')
  const ws = require('./workspace')
  const out = ws.writeFile(`playbooks/${file}.json`, JSON.stringify({ title: playbook.title || file, checks }, null, 2))
  return { name: file, file: out, checks: checks.length }
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

async function runReview({ matterId, folder, playbook: pbName, onProgress, signal } = {}) {
  const playbook = loadPlaybook(pbName)
  const docs = listDocs(matterFolders(matterId, folder))
  if (!docs.length) throw new Error('No documents: add a folder to the firm library for this matter, or pass a folder.')
  const findings = []
  const stats = { documents: docs.length, verified: 0, unverified: 0, errors: [] }
  for (const [i, file] of docs.entries()) {
    if (signal?.aborted) break
    const name = path.basename(file)
    onProgress?.({ step: 'document', index: i + 1, total: docs.length, name })
    let text
    try { text = await readDoc(file) } catch (err) { stats.errors.push(`${name}: ${err.message}`); continue }
    const ps = parts(text)
    for (const [pi, part] of ps.entries()) {
      let items
      try { items = await askJson(reviewPrompt(playbook, name, part, pi, ps.length), 2500) } catch (err) { stats.errors.push(`${name}: ${err.message}`); continue }
      for (const it of Array.isArray(items) ? items : []) {
        const check = playbook.checks.find((c) => c.id === it.check)
        if (!check) continue
        if (!quoteInSource(it.quote, text)) { stats.unverified++; continue }
        stats.verified++
        findings.push({ document: name, check: check.id, question: check.question, answer: String(it.answer || ''), quote: String(it.quote), location: String(it.location || ''), risk: ['high', 'medium', 'low'].includes(it.risk) ? it.risk : check.severity || 'medium' })
      }
    }
  }
  return { playbook, findings, stats, ...writeReview(matterId, playbook, findings, stats, docs) }
}

function writeReview(matterId, playbook, findings, stats, docs) {
  const ws = require('./workspace')
  const folder = ws.matterFolder(matterLabel(matterId))
  const stamp = new Date().toISOString().slice(0, 10)
  const csv = ['document,check,risk,answer,quote,location', ...findings.map((f) => [f.document, f.check, f.risk, f.answer, f.quote, f.location].map(csvCell).join(','))].join('\n')
  const md = [`# Matter review — ${playbook.title}`, '', `${stamp} · ${stats.documents} documents · ${stats.verified} verified findings · ${stats.unverified} dropped (quote not found in the document)`, '']
  for (const check of playbook.checks) {
    md.push(`## ${check.question}`, '')
    const rows = findings.filter((f) => f.check === check.id)
    const missing = docs.map((d) => path.basename(d)).filter((d) => !rows.some((r) => r.document === d))
    for (const r of rows) md.push(`- **${r.document}**${r.location ? ` (${r.location})` : ''} — ${r.answer} *[${r.risk}]*`, `  > ${r.quote.replace(/\n/g, ' ')}`)
    if (missing.length) md.push(`- Not addressed / not found: ${missing.join(', ')}`)
    md.push('')
  }
  if (stats.errors.length) md.push('## Errors', '', ...stats.errors.map((e) => `- ${e}`))
  const csvPath = ws.writeFile(`${folder}/review-${stamp}.csv`, csv)
  const mdPath = ws.writeFile(`${folder}/review-${stamp}.md`, md.join('\n'))
  return { files: [mdPath, csvPath] }
}

function parseDate(d) {
  const m = String(d || '').trim().match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/)
  if (!m) return null
  const [, y, mo, da] = m
  if (+y < 1900 || +y > 2200 || (mo && (+mo < 1 || +mo > 12))) return null
  // Real calendar check (no 30 February): day must exist in that month.
  if (da && (+da < 1 || +da > new Date(Date.UTC(+y, +mo, 0)).getUTCDate())) return null
  return { sort: `${y}-${mo || '00'}-${da || '00'}`, display: [y, mo, da].filter(Boolean).join('-') }
}

async function runChronology({ matterId, folder, onProgress, signal } = {}) {
  const docs = listDocs(matterFolders(matterId, folder))
  if (!docs.length) throw new Error('No documents: add a folder to the firm library for this matter, or pass a folder.')
  const events = []
  const stats = { documents: docs.length, verified: 0, unverified: 0, errors: [] }
  for (const [i, file] of docs.entries()) {
    if (signal?.aborted) break
    const name = path.basename(file)
    onProgress?.({ step: 'document', index: i + 1, total: docs.length, name })
    let text
    try { text = await readDoc(file) } catch (err) { stats.errors.push(`${name}: ${err.message}`); continue }
    const ps = parts(text)
    for (const [pi, part] of ps.entries()) {
      let items
      try { items = await askJson(chronologyPrompt(name, part, pi, ps.length), 2500) } catch (err) { stats.errors.push(`${name}: ${err.message}`); continue }
      for (const it of Array.isArray(items) ? items : []) {
        let date = parseDate(it.date)
        if (!it.event || !quoteInSource(it.quote, text)) { stats.unverified++; continue }
        // The date must be the one the quote states: models misread months.
        // One date in the quote → use it (exact, full precision); several →
        // the model's date must be among them; none parseable → keep the
        // model's date but mark it unchecked.
        const stated = datesInText(it.quote)
        let checked = true
        if (stated.length === 1) date = parseDate(stated[0])
        else if (stated.length > 1) { if (!date || !stated.includes(date.display)) { stats.unverified++; continue } }
        else checked = false
        if (!date) { stats.unverified++; continue }
        if (date.display !== String(it.date || '')) stats.corrected = (stats.corrected || 0) + 1
        stats.verified++
        events.push({ ...date, event: String(it.event), quote: String(it.quote), document: name, checked })
      }
    }
  }
  // Same date + same document + same quote → one event.
  const seen = new Set()
  const merged = events.filter((e) => { const k = `${e.sort}|${e.document}|${norm(e.quote)}`; if (seen.has(k)) return false; seen.add(k); return true })
  merged.sort((a, b) => a.sort.localeCompare(b.sort) || a.document.localeCompare(b.document))

  const ws = require('./workspace')
  const folderRel = ws.matterFolder(matterLabel(matterId))
  const stamp = new Date().toISOString().slice(0, 10)
  const csv = ['date,event,document,quote', ...merged.map((e) => [e.display, e.event, e.document, e.quote].map(csvCell).join(','))].join('\n')
  const md = [`# Chronology`, '', `${stats.documents} documents · ${merged.length} events · ${stats.unverified} dropped (quote not found or date not stated in it) · ${stats.corrected || 0} dates taken from the quote instead of the model${merged.some((e) => !e.checked) ? ' · (?) = date not checkable against the quote' : ''} · ${stamp}`, '', '| Date | Event | Source |', '|---|---|---|',
    ...merged.map((e) => `| ${e.display}${e.checked ? '' : ' (?)'} | ${e.event.replace(/\|/g, '/')} | ${e.document}: "${e.quote.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 160)}" |`)]
  if (stats.errors.length) md.push('', '## Errors', '', ...stats.errors.map((e) => `- ${e}`))
  const files = [ws.writeFile(`${folderRel}/chronology-${stamp}.md`, md.join('\n')), ws.writeFile(`${folderRel}/chronology-${stamp}.csv`, csv)]
  return { events: merged, stats, files }
}

function matterLabel(matterId) {
  const m = matterId ? require('./matters').get(matterId) : null
  return m ? (m.number ? `${m.number} ${m.title}` : m.title) : 'default'
}

module.exports = { runReview, runChronology, draftPlaybook, savePlaybook, parts, quoteInSource, extractJson, parseDate, datesInText, loadPlaybook, bundledPlaybooks, DEFAULT_PLAYBOOK, readDoc, listDocs, matterFolders, matterLabel, askJson, csvCell, norm, canonicalDates, MONTHS }
