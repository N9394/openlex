"use strict"
/**
 * Drafting (the old app's "Workshop", now a chat tool: /draft). Two ways in:
 *
 *   /draft <what to write>           OpenLex writes a first draft — from the
 *                                    instructions, the attached documents as
 *                                    precedents or facts, and the matter
 *   /draft with a document attached  the document becomes the draft to work
 *   (no instructions, or "template") on (the old Workshop's upload)
 *
 * and then, on the draft card:
 *   - variables   names, dates, amounts, addresses … that should be fill-ins
 *                 (placeholders like [NAME] or ____ found by rule, values found
 *                 by the model and kept only when they are in the text word for
 *                 word); fill them in → every occurrence is replaced
 *   - revise      the whole draft or one passage, by an instruction ("make the
 *                 notice period three months"); before/after is shown; every
 *                 change is a new version, so any earlier one comes back
 *   - suggest     three to five improvements for a passage, each usable as an
 *                 instruction
 *   - check       a passage against the law: a search query in the law's
 *                 language, the law packs on this computer (official online
 *                 sources only when the matter's data rules allow web access),
 *                 a verdict (supported / issue / nothing found) and a second
 *                 check whether the clause is unlawful
 *   - export      Word, PDF, Markdown; "Send to Word" inserts it at the cursor
 *
 * Kept on this computer: ~/.lexvault/drafts/<id>.json with every version
 * (the old Workshop lost everything after two hours). No statute citations
 * from memory in the drafted text.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const wf = require('./workflows')

const DIR = path.join(DATA_DIR, 'drafts')
const ID_RE = /^dr_[a-f0-9]{16}$/
const MAX_TEXT = 400000
const MAX_VERSIONS = 50
const SOURCE_CHARS = 30000

const str = (v, max = 600) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '')
const langNameOf = (t) => { const an = require('./analysis'); return require('./workflows_docs').LANGS[an.detectLanguage(t)] || 'English' }

function file(id) { if (!ID_RE.test(String(id || ''))) throw new Error('unknown draft'); return path.join(DIR, `${id}.json`) }
function get(id) { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')) } catch (err) { if (/unknown draft/.test(err.message)) throw err; throw new Error('unknown draft') } }
function write(d) { fs.mkdirSync(DIR, { recursive: true }); d.updatedAt = new Date().toISOString(); fs.writeFileSync(file(d.id), JSON.stringify(d)); return d }
const current = (d) => d.versions[d.versions.length - 1].text

/** A new version (the earlier ones stay). */
function addVersion(d, text, note) {
  const t = String(text || '')
  if (!t.trim()) throw new Error('the draft would be empty')
  if (t.length > MAX_TEXT) throw new Error('the draft is too long (over 400,000 characters)')
  d.versions.push({ n: (d.versions[d.versions.length - 1]?.n || 0) + 1, text: t, note: str(note, 300), at: new Date().toISOString() })
  if (d.versions.length > MAX_VERSIONS) d.versions = [d.versions[0], ...d.versions.slice(-(MAX_VERSIONS - 1))]
  return d
}

/** Plain text from a model reply: no fences, no <think>, no "Here is …" line. */
function cleanText(reply) {
  let s = String(reply || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const fence = /^```[\w-]*\n([\s\S]*?)\n```$/m.exec(s)
  if (fence && fence[1].length > s.length * 0.6) s = fence[1]
  s = s.replace(/^(here is|here's|hier ist|anbei)[^\n]*:\s*\n+/i, '')
  return s.trim()
}

async function ask(messages, maxTokens, role = 'draft') {
  const { chat } = require('./llm')
  return chat(messages, { maxTokens, temperature: 0.2, role })
}

// ── create ───────────────────────────────────────────────────────────────
function draftPrompt(instruction, sources, matterTitle, langName) {
  const src = sources.map((s) => `=== ${s.name} ===\n${s.text.slice(0, Math.floor(SOURCE_CHARS / sources.length))}`).join('\n\n')
  return [
    { role: 'system', content: `You draft legal documents for a lawyer. Write the complete document, ready to edit: a title, numbered clauses with headings, formal language. Use [SQUARE BRACKET PLACEHOLDERS] for facts you were not given (names, dates, amounts). Do not cite statute sections from memory. Write in ${langName}. Reply with the document only, in Markdown (# title, ## clause headings), no comments before or after.` },
    { role: 'user', content: `${matterTitle ? `MATTER: ${matterTitle}\n` : ''}WHAT TO DRAFT: ${instruction}${src ? `\n\nDOCUMENTS TO USE (precedents or facts; follow their style where it fits, take facts only from them):\n${src}` : ''}` },
  ]
}

/**
 * Start a draft. { matterId, instruction, attachments, files, title, sessionId, message }
 * With documents and no instruction (or "template"), the first document is the draft.
 */
async function create({ matterId = null, instruction = '', attachments = [], files = [], title = '', sessionId = null, message = '', onProgress, signal } = {}) {
  const sources = []
  if (Array.isArray(attachments) && attachments.length) for (const a of require('./attachments').load(attachments.slice(0, 10))) sources.push({ name: a.name, text: a.text, attachmentId: a.id })
  for (const f of (Array.isArray(files) ? files : []).slice(0, 10)) {
    const p = require('./workflows_docs').resolveDoc(matterId, String(f))
    sources.push({ name: path.basename(p), text: String(await wf.readDoc(p)), path: p })
  }
  const inst = String(instruction || '').trim()
  const fromDocument = sources.length && (!inst || /^(template|vorlage|edit|bearbeiten)$/i.test(inst))
  let text
  let note
  if (fromDocument) {
    text = sources[0].text
    note = `from ${sources[0].name}`
  } else {
    if (!inst) throw new Error('Say what to draft (for example: /draft a non-disclosure agreement between two companies, Austrian law) — or attach a document to work on.')
    let matterTitle = ''
    try { matterTitle = matterId ? require('./matters').get(matterId)?.title || '' : '' } catch { /* none */ }
    onProgress?.({ step: 'write', text: 'Writing the first draft' })
    text = cleanText(await ask(draftPrompt(inst, sources, matterTitle, langNameOf(inst)), 6000))
    if (signal?.aborted) throw new Error('stopped')
    note = 'first draft'
  }
  const firstLine = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || 'Draft'
  const d = {
    kind: 'draft', id: `dr_${crypto.randomBytes(8).toString('hex')}`, matterId: matterId || null,
    title: str(title, 160) || (fromDocument ? sources[0].name.replace(/\.[^.]+$/, '') : firstLine.slice(0, 120)),
    instruction: inst.slice(0, 2000), sources: sources.map((s) => ({ name: s.name, ...(s.attachmentId ? { attachmentId: s.attachmentId } : {}) })),
    createdAt: new Date().toISOString(), versions: [], variables: null, checks: [],
  }
  addVersion(d, text, note)
  write(d)
  if (sessionId) {
    try {
      const { Session } = require('./session')
      new Session(String(sessionId)).append(String(message || `/draft ${inst}`).slice(0, 2000), `Draft: ${d.title}\n\n${text.slice(0, 1500)}`, { matterId, client: 'app', results: [{ kind: 'draft', id: d.id, name: d.title }] })
    } catch { /* best effort */ }
  }
  return d
}

// ── variables (contract → template) ──────────────────────────────────────
const PLACEHOLDER_RE = /\[[A-ZÄÖÜ0-9][A-ZÄÖÜ0-9 _./-]{1,60}\]|<<[^<>\n]{1,60}>>|\{\{[^{}\n]{1,60}\}\}|_{4,}/g
const VAR_TYPES = ['name', 'company', 'date', 'address', 'amount', 'duration', 'jurisdiction', 'other']

function countOf(text, value) {
  if (!value) return 0
  let n = 0
  for (let i = text.indexOf(value); i >= 0; i = text.indexOf(value, i + value.length)) n++
  return n
}

async function variables(id, { signal } = {}) {
  const d = get(id)
  const text = current(d)
  const out = []
  const seen = new Set()
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    out.push({ name: m[0].replace(/^[[<{]+|[\]>}]+$/g, '').replace(/_+/g, ' ').trim() || 'blank', type: 'other', value: m[0], placeholder: true, occurrences: countOf(text, m[0]) })
  }
  // The model finds filled-in values (names, dates, amounts); kept only when they are in the text word for word.
  const chunks = []
  for (let i = 0; i < text.length && chunks.length < 12; i += 18000) chunks.push(text.slice(i, i + 20000))
  for (const part of chunks) {
    if (signal?.aborted) break
    try {
      const items = await wf.askJson([
        { role: 'system', content: 'You turn a filled-in legal document into a reusable template. Copy every value exactly as it appears in the text.' },
        { role: 'user', content: `TEXT:\n"""\n${part}\n"""\nList the filled-in values that should become fill-ins in a template: party names, companies, dates, addresses, amounts, durations, places of jurisdiction. Not legal terms, not headings.${out.length ? ` Already found: ${out.map((v) => v.value).join(', ').slice(0, 1000)}.` : ''}\nReply with JSON only: [{"name": "<what it is, e.g. Seller>", "type": "${VAR_TYPES.join('|')}", "value": "<exact text>"}]` },
      ], 1500, 'extract')
      for (const it of Array.isArray(items) ? items : []) {
        const value = String(it?.value ?? it?.currentValue ?? '').trim().slice(0, 200)
        if (value.length < 2 || seen.has(value) || !text.includes(value)) continue
        seen.add(value)
        out.push({ name: str(it.name, 80) || value, type: VAR_TYPES.includes(it.type) ? it.type : 'other', value, placeholder: false, occurrences: countOf(text, value) })
      }
    } catch (err) {
      if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
    }
  }
  d.variables = out.slice(0, 200)
  write(d)
  return d
}

/** Fill in: { values: { "<current value>": "<new value>" } } → a new version with every occurrence replaced. */
function fill(id, { values = {} } = {}) {
  const d = get(id)
  let text = current(d)
  let n = 0
  // Longest first, so "Alpha Software GmbH" is replaced before "Alpha".
  for (const [from, to] of Object.entries(values).filter(([f, t]) => f && typeof t === 'string' && t.trim() && f !== t).sort((a, b) => b[0].length - a[0].length)) {
    const c = countOf(text, from)
    if (!c) continue
    text = text.split(from).join(to.trim())
    n += c
  }
  if (!n) throw new Error('nothing to fill in: type a new value for at least one fill-in')
  addVersion(d, text, `${n} fill-in${n === 1 ? '' : 's'} replaced`)
  if (d.variables) d.variables = d.variables.map((v) => (values[v.value] ? { ...v, value: values[v.value].trim(), occurrences: countOf(text, values[v.value].trim()), filled: true } : v))
  return write(d)
}

// ── revise, suggest, check ───────────────────────────────────────────────
/** The passage to work on: given text must be in the draft (whitespace forgiven); none = the whole draft. */
function passageOf(text, section) {
  const s = String(section || '').trim()
  if (!s) return { start: 0, end: text.length, text, whole: true }
  const at = text.indexOf(s)
  if (at >= 0) return { start: at, end: at + s.length, text: s, whole: false }
  throw new Error('That passage is not in the current version of the draft (it may have changed). Select it again.')
}

async function revise(id, { instruction = '', section = '' } = {}) {
  const d = get(id)
  const text = current(d)
  const inst = String(instruction || '').trim()
  if (!inst) throw new Error('Say what to change.')
  const p = passageOf(text, section)
  const langName = langNameOf(p.text)
  const reply = await ask([
    { role: 'system', content: `You are a careful legal editor. Rewrite the text according to the instruction. Keep the structure and numbering, change only what the instruction asks, keep [PLACEHOLDERS], formal language. Do not add statute citations. Write in ${langName}. Reply with the rewritten text only.` },
    { role: 'user', content: `INSTRUCTION: ${inst}\n\n${p.whole ? 'DOCUMENT' : 'PASSAGE'}:\n"""\n${p.text}\n"""` },
  ], p.whole ? 8000 : 2000)
  const after = cleanText(reply)
  if (!after) throw new Error('The AI gave no text back. Try again or rephrase the instruction.')
  addVersion(d, text.slice(0, p.start) + after + text.slice(p.end), inst)
  write(d)
  return { draft: d, before: p.text, after, whole: p.whole }
}

async function suggest(id, { section = '' } = {}) {
  const d = get(id)
  const p = passageOf(current(d), section)
  const langName = langNameOf(p.text)
  const items = await wf.askJson([
    { role: 'system', content: `You advise a lawyer on improving a draft. Write in ${langName}.` },
    { role: 'user', content: `TEXT:\n"""\n${p.text.slice(0, 20000)}\n"""\nSuggest 3 to 5 specific improvements, each as a short instruction that could be given to an editor ("Add a notice period of three months to the termination clause"). Look for missing protections, unclear wording, missing clauses, data protection and consumer rules, enforceability.\nReply with JSON only: ["<instruction>", …]` },
  ], 1000, 'extract')
  const out = (Array.isArray(items) ? items : []).map((x) => (typeof x === 'string' ? x : x?.instruction || x?.suggestion || '')).map((x) => str(x, 300)).filter(Boolean).slice(0, 5)
  return { suggestions: out }
}

const LAW_LANG = { AT: 'German', DE: 'German', CH: 'German', SK: 'Slovak', CZ: 'Czech', RO: 'Romanian', FR: 'French', GR: 'Greek', CY: 'Greek' }

async function check(id, { section = '', jurisdiction = '' } = {}) {
  const an = require('./analysis')
  const d = get(id)
  const p = passageOf(current(d), section)
  const clause = p.text.slice(0, 6000)
  const jur = String(jurisdiction || '').toUpperCase().slice(0, 6) || new (require('./doc').Document)(current(d).slice(0, 4000), 'draft').jurisdiction() || ''
  const langName = langNameOf(clause)
  // 1. a search query in the law's language.
  let query = ''
  try {
    const o = await an.askObject([
      { role: 'system', content: 'You write search queries for a statute database.' },
      { role: 'user', content: `CLAUSE:\n"""\n${clause.slice(0, 3000)}\n"""\nWrite one search query (5-12 words, statutory terms) in ${LAW_LANG[jur] || langName} to find the law that governs this clause${jur ? ` in ${jur}` : ''}. Reply with JSON only: {"query": "…"}` },
    ], 200, 'extract')
    query = str(o.query, 200)
  } catch (err) {
    if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
  }
  query = query || clause.slice(0, 160)
  // 2. the law.
  const law = await an.lawLookup({ query, jurisdiction: jur, language: an.detectLanguage(clause), matterId: d.matterId })
  // 3. the verdict, from the law found only.
  let verdict = { status: 'no_match', explanation: 'No law on this computer matched this clause. Check it yourself.' }
  if (law.sources.length) {
    const o = await an.askObject([
      { role: 'system', content: `You check a contract clause against the law shown, for a lawyer. Judge only from the law shown; never from memory. Write in ${langName}.` },
      { role: 'user', content: `CLAUSE:\n"""\n${clause}\n"""\nLAW FOUND:\n${law.sources.map((s, i) => `[${i + 1}] ${s.title}${s.section ? ` ${s.section}` : ''}: ${s.snippet}`).join('\n')}\n\nIs the clause consistent with the law found? Reply with JSON only: {"status": "supported|issue|no_match", "explanation": "<2-4 sentences, naming the provisions shown>"}` },
    ], 800, 'analyze')
    verdict = { status: ['supported', 'issue', 'no_match'].includes(str(o.status, 20)) ? str(o.status, 20) : 'no_match', explanation: str(o.explanation, 1200) }
  }
  // 4. a second check: is the clause unlawful?
  let judge = null
  if (law.sources.length && verdict.status !== 'no_match') {
    try {
      const o = await an.askObject([
        { role: 'system', content: 'You are a safety net for a lawyer. Judge only from the law shown.' },
        { role: 'user', content: `CLAUSE:\n"""\n${clause.slice(0, 3000)}\n"""\nLAW:\n${law.sources.map((s) => `${s.title} ${s.section}: ${s.snippet}`).join('\n')}\nWould this clause be void or unlawful under the law shown? Reply with JSON only: {"unlawful": true|false, "severity": "critical|moderate|minor|none", "note": "<one sentence>"}` },
      ], 300, 'judge')
      judge = { unlawful: o.unlawful === true || o.illegal === true, severity: ['critical', 'moderate', 'minor', 'none'].includes(str(o.severity, 20)) ? str(o.severity, 20) : 'none', note: str(o.note || o.judgeNote, 400) }
      if (judge.unlawful && verdict.status === 'supported') verdict.status = 'issue'
    } catch (err) {
      if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
    }
  }
  const result = { at: new Date().toISOString(), passage: clause.slice(0, 600), whole: p.whole, jurisdiction: jur || null, query, sources: law.sources, web: law.web, ...verdict, judge }
  d.checks = [result, ...(d.checks || [])].slice(0, 30)
  write(d)
  return { draft: d, check: result }
}

function edit(id, { text, note = 'edited by hand' } = {}) {
  const d = get(id)
  if (String(text) === current(d)) return d
  addVersion(d, text, note)
  return write(d)
}

function restore(id, { n } = {}) {
  const d = get(id)
  const v = d.versions.find((x) => x.n === Number(n))
  if (!v) throw new Error('no such version')
  addVersion(d, v.text, `back to version ${v.n}`)
  return write(d)
}

function list(matterId) {
  let names = []
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) } catch { return [] }
  return names.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) } catch { return null } })
    .filter((d) => d && (matterId === undefined || (d.matterId || null) === (matterId || null)))
    .map((d) => ({ id: d.id, title: d.title, matterId: d.matterId, versions: d.versions.length, updatedAt: d.updatedAt }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

// ── export ───────────────────────────────────────────────────────────────
const HEADING = /^(§\s*\d+[a-z]?|(?:Art(?:\.|ikel|icle)?|Section|Clause|Klausel|Punkt|Ziffer)\s+\d+(?:\.\d+)*|\d+(?:\.\d+)*\.?)\s+\S.{0,80}$/i

/** Word: # lines and short numbered headings become headings; "- " lines bullets. */
function toDocx(d) {
  const { docxBuffer } = require('./docx_write')
  const blocks = []
  const lines = current(d).split('\n')
  let titled = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) { blocks.push({ text: h[2].replace(/\*\*/g, ''), style: h[1].length === 1 && !titled ? 'Title' : h[1].length <= 2 ? 'Heading1' : 'Heading2' }); if (h[1].length === 1) titled = true; continue }
    if (HEADING.test(line.trim()) && line.length < 90 && !/[.;,]$/.test(line.trim())) { blocks.push({ text: line.trim().replace(/\*\*/g, ''), style: 'Heading2' }); continue }
    const parts = line.replace(/^\s*[-*]\s+/, '• ').split(/(\*\*[^*]+\*\*)/).filter(Boolean)
    blocks.push({ runs: parts.map((p) => (/^\*\*.*\*\*$/.test(p) ? { text: p.slice(2, -2), bold: true } : { text: p })) })
  }
  return docxBuffer(blocks.length ? blocks : [{ text: d.title, style: 'Title' }])
}

function exportDraft(id, format) {
  const d = get(id)
  const fmt = String(format || '').toLowerCase()
  const ws = require('./workspace')
  const folder = ws.matterFolder(wf.matterLabel(d.matterId))
  const base = `draft-${require('./report').safeBase(d.title)}`
  let buf, mime, ext
  if (fmt === 'docx') { buf = toDocx(d); mime = require('./report').FORMATS.docx.mime; ext = 'docx' }
  else if (fmt === 'md') { buf = Buffer.from(current(d), 'utf8'); mime = 'text/markdown'; ext = 'md' }
  else if (fmt === 'pdf') {
    const { renderPdf } = require('./pdf')
    const blocks = []
    let cur = { title: d.title, rows: [] }
    for (const line of current(d).split('\n').map((l) => l.trim()).filter(Boolean)) {
      const h = /^#{1,4}\s+(.*)$/.exec(line)
      if (h || (HEADING.test(line) && line.length < 90 && !/[.;,]$/.test(line))) { if (cur.rows.length || cur.title !== d.title) blocks.push(cur); cur = { title: (h ? h[1] : line).replace(/\*\*/g, ''), rows: [] }; continue }
      cur.rows.push(['', line.replace(/\*\*/g, '').replace(/^[-*]\s+/, '• ')])
    }
    blocks.push(cur)
    buf = renderPdf(blocks); mime = 'application/pdf'; ext = 'pdf'
  } else throw new Error('format must be docx, pdf or md')
  const name = `${base}.${ext}`
  const fileOut = ws.writeFileBinary(`${folder}/${name}`, buf)
  return { file: fileOut, name, mime, bytes: buf.length, data: buf.toString('base64') }
}

/** The local API: /api/draft[s] … → { status, json } or null (async: model calls). */
async function handle(method, p, params, body = {}) {
  const q = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  if (p !== '/api/drafts' && p !== '/api/draft' && !p.startsWith('/api/draft/')) return null
  try {
    if (method === 'GET' && p === '/api/drafts') return { status: 200, json: { drafts: list(q('matterId') || null) } }
    if (method === 'GET' && p === '/api/draft') return { status: 200, json: { draft: get(q('id')) } }
    if (method !== 'POST') return { status: 405, json: { error: 'use POST' } }
    const policy = require('./policy')
    const inMatter = (matterId, fn) => policy.withMatter(matterId || null, fn)
    const mOf = (id) => { try { return get(id).matterId } catch { return null } }
    switch (p) {
      case '/api/draft': return { status: 200, json: { draft: await inMatter(body.matterId, () => create(body)) } }
      case '/api/draft/variables': return { status: 200, json: { draft: await inMatter(mOf(body.id), () => variables(body.id)) } }
      case '/api/draft/fill': return { status: 200, json: { draft: fill(body.id, body) } }
      case '/api/draft/revise': return { status: 200, json: await inMatter(mOf(body.id), () => revise(body.id, body)) }
      case '/api/draft/suggest': return { status: 200, json: await inMatter(mOf(body.id), () => suggest(body.id, body)) }
      case '/api/draft/check': return { status: 200, json: await inMatter(mOf(body.id), () => check(body.id, body)) }
      case '/api/draft/edit': return { status: 200, json: { draft: edit(body.id, body) } }
      case '/api/draft/restore': return { status: 200, json: { draft: restore(body.id, body) } }
      case '/api/draft/export': return { status: 200, json: exportDraft(body.id, body.format) }
      default: return { status: 404, json: { error: 'not found' } }
    }
  } catch (err) {
    return { status: err.code === 'POLICY_BLOCKED' ? 403 : 400, json: { error: err.message, ...(err.code ? { code: err.code } : {}) } }
  }
}

module.exports = { create, get, list, variables, fill, revise, suggest, check, edit, restore, exportDraft, toDocx, handle, current, cleanText, DIR }
