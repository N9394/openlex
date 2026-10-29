"use strict"
/**
 * Due diligence over a data room (the old app's M&A pages, now a chat tool:
 * /diligence). A folder of documents (or the documents attached in the
 * chat) becomes:
 *
 *   - a review grid (grid.js): one row per document, the due-diligence
 *     questions as columns — kind of document, parties, governing law, term,
 *     change of control, assignment, termination, liability, exclusivity, IP,
 *     data protection, guarantees, disputes — every answer quoted from its
 *     document (a quote that is not there is flagged, never shown as fact)
 *   - red flags per document in the old pipeline's four tiers (deal breaker,
 *     price-affecting, standard, for information) and its categories, each
 *     with a word-for-word quote; a change-of-control clause the grid finds
 *     is always a flag
 *   - the summary after the last document: flags by tier, category and
 *     document, the deal breakers, what a data room for this kind of deal
 *     usually has and this one lacks, and a short summary for the partner
 *
 * It runs on the batch machinery (batch.js, kind "diligence"): one document
 * at a time in the background, progress, Stop and Resume, an estimate and a
 * confirmation before a big cloud run. Exports: CSV and Excel (grid, red
 * flags, sources), Word and PDF (the report).
 *
 * What the old pages had and this leaves out on purpose: the three sign-off
 * checkpoints and the stage machine (its "reject" only paused), warranty
 * heat-map scores, W&I readiness and premium guesses (numbers a model makes
 * up), plan estimates by the model. Not yet ported: the per-warranty
 * negotiation playbook and redline (use /draft on the clause).
 * The old prompts' rule stays: no statute citations from memory.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const wf = require('./workflows')

const DIR = path.join(DATA_DIR, 'diligence')
const ID_RE = /^dd_[a-f0-9]{16}$/
const PART_RE = /^ddd_[a-f0-9]{16}$/
const TIERS = ['deal_breaker', 'price_affecting', 'standard', 'informational']
const CATEGORIES = ['financial', 'legal', 'regulatory', 'operational', 'environmental', 'tax', 'employment', 'ip', 'litigation', 'compliance', 'data_protection']
const DOC_TYPES = ['share purchase agreement', 'disclosure letter', 'financial statement', 'corporate document', 'commercial contract', 'employment', 'real estate', 'intellectual property', 'tax', 'insurance', 'litigation', 'regulatory', 'environmental', 'financing', 'other']
const NO_CITATION = 'Do NOT cite statute sections, case names or article numbers from memory: a made-up citation is worse than none.'

/** The due-diligence questions: the grid's columns. */
const COLUMNS = [
  { id: 'doc_type', label: 'Kind of document', type: 'choice', options: DOC_TYPES, prompt: 'What kind of document is this?' },
  { id: 'parties', label: 'Parties', prompt: 'Who are the parties (names as written, with their roles)?' },
  { id: 'governing_law', label: 'Governing law', prompt: 'Which law governs it, and which courts or arbitration decide disputes?' },
  { id: 'term', label: 'Term and renewal', prompt: 'How long does it run? Does it renew automatically, and what are the notice periods?' },
  { id: 'change_of_control', label: 'Change of control', type: 'yesno', prompt: 'Does a change of control, merger or sale of the business give the other party a right (consent, termination, renegotiation)?' },
  { id: 'assignment', label: 'Assignment needs consent', type: 'yesno', prompt: 'Does assigning or transferring this contract need the other party\'s consent (or is it excluded)?' },
  { id: 'termination', label: 'Termination', prompt: 'Who can terminate, for what reasons, with what notice, and at what cost?' },
  { id: 'liability', label: 'Liability and caps', prompt: 'Is liability limited or excluded? Caps, amounts, carve-outs (intent, gross negligence)?' },
  { id: 'exclusivity', label: 'Exclusivity / non-compete', type: 'yesno', prompt: 'Are there exclusivity, non-compete or non-solicitation obligations?' },
  { id: 'ip', label: 'IP', prompt: 'Who owns the intellectual property created or used, and are there licences?' },
  { id: 'data_protection', label: 'Data protection', type: 'yesno', prompt: 'Does it deal with personal data (processing agreement, GDPR, transfers)?' },
  { id: 'guarantees', label: 'Guarantees and security', prompt: 'Are there guarantees, securities, indemnities or warranties given? By whom, for what amount?' },
  { id: 'disputes', label: 'Disputes and claims', prompt: 'Does it mention any dispute, claim, litigation, default or breach that has happened?' },
]

/** What a data room for this kind of deal usually contains (kinds of document; deterministic, a reminder — not a rule). */
const EXPECTED = {
  share_purchase: ['corporate document', 'financial statement', 'commercial contract', 'employment', 'tax', 'insurance', 'intellectual property', 'real estate'],
  asset_purchase: ['commercial contract', 'intellectual property', 'real estate', 'employment', 'financial statement'],
  merger: ['corporate document', 'financial statement', 'commercial contract', 'employment', 'tax', 'regulatory'],
  joint_venture: ['corporate document', 'commercial contract', 'intellectual property', 'financial statement'],
}
const DEAL_WORDS = { share: 'share_purchase', shares: 'share_purchase', spa: 'share_purchase', anteilskauf: 'share_purchase', asset: 'asset_purchase', assets: 'asset_purchase', apa: 'asset_purchase', merger: 'merger', verschmelzung: 'merger', jv: 'joint_venture', 'joint-venture': 'joint_venture' }

const str = (v, max = 600) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '')
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
const save = (dir, id, obj) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(obj)) }

/** "/diligence buyer share" → options. */
function optionsFor(text = '') {
  const words = String(text).toLowerCase().split(/[\s,]+/).filter(Boolean)
  const perspective = words.some((w) => /^(seller|verkäufer|sell)/.test(w)) ? 'seller' : words.some((w) => /^(target|zielgesellschaft)/.test(w)) ? 'target' : 'buyer'
  const dealType = words.map((w) => DEAL_WORDS[w]).find(Boolean) || 'share_purchase'
  const rest = words.filter((w) => !DEAL_WORDS[w] && !/^(seller|verkäufer|sell|buyer|käufer|buy|target|zielgesellschaft)/.test(w)).join(' ')
  return { perspective, dealType, ...(rest ? { focus: rest.slice(0, 200) } : {}) }
}

// ── before the run: the grid for these documents ─────────────────────────
async function prepare(job) {
  const grid = require('./grid')
  const names = Object.fromEntries(job.files.map((f) => [f.file, f.name]))
  const g = grid.create({ matterId: job.matterId, title: `Due diligence ${job.createdAt.slice(0, 10)}`, columns: COLUMNS, documents: job.files.filter((f) => f.status !== 'skipped').map((f) => f.file), names })
  job.options = { ...optionsFor(''), ...(job.options || {}), gridId: g.id }
}

// ── one document ─────────────────────────────────────────────────────────
function flagPrompt(name, part, idx, total, o, langName) {
  return [
    { role: 'system', content: `You review documents in a data room for a lawyer acting for the ${o.perspective} in a ${String(o.dealType).replace('_', ' ')}. Answer only from the document text. Copy every quote exactly, word for word. ${NO_CITATION} Write in ${langName}.` },
    { role: 'user', content: `DOCUMENT: ${name}${total > 1 ? ` (part ${idx + 1} of ${total})` : ''}\n"""\n${part}\n"""\n${o.focus ? `\nThe lawyer asks to look especially at: ${o.focus}\n` : ''}\nList the red flags for the transaction: what could stop the deal, change the price, or needs a warranty, indemnity or condition. Be precise and conservative — only genuine issues.\nReply with JSON only: {"summary": "<what this document is and why it matters for the deal, one or two sentences>", "flags": [{"title": "<short>", "tier": "deal_breaker|price_affecting|standard|informational", "category": "${CATEGORIES.join('|')}", "why": "<one line: the consequence for the ${o.perspective}>", "action": "<one line: what to do — ask, warranty, indemnity, condition, price>", "quote": "<exact words, max 300 chars>", "location": "<clause or [Page N]>"}]}` },
  ]
}

const tierOf = (v) => {
  const s = str(v, 30).toLowerCase()
  if (/break|kill|critical|stop/.test(s)) return 'deal_breaker'
  if (/price|high|significant/.test(s)) return 'price_affecting'
  if (/info|low|minor/.test(s)) return 'informational'
  return 'standard'
}

async function reviewOne({ matterId = null, file, attachments, name, options = {}, signal, onProgress } = {}) {
  const an = require('./analysis')
  const read = require('./read')
  const docKey = Array.isArray(attachments) && attachments.length ? `att:${attachments[0]}` : file
  const text = String(await wf.readDoc(docKey))
  if (!text.trim()) throw new Error(`${name}: no text found`)
  const langName = require('./workflows_docs').LANGS[an.detectLanguage(text)] || 'English'
  const stats = { verified: 0, dropped: 0, errors: [] }

  // 1. the grid row: every due-diligence question for this document.
  onProgress?.({ step: 'grid', name })
  const grid = require('./grid')
  let row = {}
  if (options.gridId) {
    const r = await grid.run(options.gridId, { documents: [docKey], signal })
    for (const e of r.stats.errors) stats.errors.push(e)
    const g = r.grid
    for (const c of g.columns) row[c.id] = g.cells[grid.key(g.documents.find((d) => d === docKey || d === path.resolve(String(docKey))) || docKey, c.id)] || null
  }

  // 2. red flags, quoted.
  const st = require('./strategy').forModel({ tokens: read.tokensFor(text), role: 'analyze', matterId })
  const parts = an.splitParts(text, st.mode === 'full' && st.kind === 'cloud' ? text.length : st.partChars)
  const raw = { summary: '', flags: [] }
  for (const [pi, part] of parts.entries()) {
    if (signal?.aborted) break
    onProgress?.({ step: 'flags', name, index: pi + 1, total: parts.length })
    try {
      const o = await an.askObject(flagPrompt(name, part, pi, parts.length, options, langName), 2500, 'analyze')
      if (!raw.summary && str(o.summary)) raw.summary = str(o.summary, 600)
      raw.flags.push(...arr(o.flags || o.risks))
    } catch (err) {
      if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
      stats.errors.push(`part ${pi + 1}: ${err.message}`)
    }
  }
  const cache = {}
  const seen = new Set()
  const flags = []
  for (const it of raw.flags) {
    const title = str(it.title, 160)
    const quote = str(it.quote, 350)
    if (!title) continue
    if (!wf.quoteInSource(quote, text)) { stats.dropped++; continue }
    const k = wf.norm(title)
    if (seen.has(k)) continue
    seen.add(k)
    stats.verified++
    const loc = an.locate(text, quote, cache)
    const cat = str(it.category, 30).toLowerCase().replace(/\s+/g, '_')
    flags.push({ title, tier: tierOf(it.tier || it.severity), category: CATEGORIES.includes(cat) ? cat : 'legal', why: str(it.why || it.description, 400), action: str(it.action || it.recommendation, 400), quote, location: loc?.text || str(it.location, 80), from: 'review' })
  }
  // A change of control the grid found is always a flag (the classic data-room finding).
  const coc = row.change_of_control
  if (coc && coc.value === 'Yes' && coc.status === 'ok' && !flags.some((f) => /control|kontroll|übernahme|merger/i.test(f.title))) {
    flags.push({ title: 'Change-of-control clause', tier: 'price_affecting', category: 'legal', why: 'The transaction may give the other party a right to consent, terminate or renegotiate.', action: 'Get the other party\'s consent or a waiver before closing, or make it a condition.', quote: coc.quote, location: coc.location || '', from: 'grid' })
  }
  const rank = Object.fromEntries(TIERS.map((t, i) => [t, i]))
  flags.sort((a, b) => rank[a.tier] - rank[b.tier])
  const id = `ddd_${crypto.randomBytes(8).toString('hex')}`
  const docType = row.doc_type?.status === 'ok' || row.doc_type?.status === 'unverified' ? row.doc_type.value : ''
  save(path.join(DIR, 'docs'), id, { id, name, file: docKey, docType, summary: raw.summary, flags, row: Object.fromEntries(Object.entries(row).map(([k, c]) => [k, c ? { value: c.value, status: c.status, quote: c.quote, location: c.location } : null])), stats, pages: read.pagesOf(text) })
  return { resultId: id, docType, flags: flags.length, dealBreakers: flags.filter((f) => f.tier === 'deal_breaker').length, priceAffecting: flags.filter((f) => f.tier === 'price_affecting').length }
}

function docResult(id) {
  if (!PART_RE.test(String(id || ''))) throw new Error('unknown document result')
  return JSON.parse(fs.readFileSync(path.join(DIR, 'docs', `${id}.json`), 'utf8'))
}

// ── after the last document ──────────────────────────────────────────────
function summaryPrompt(o, docs, langName) {
  const lines = docs.flatMap((d) => d.flags.filter((f) => f.tier !== 'informational').slice(0, 12).map((f) => `- [${f.tier}] ${d.name}: ${f.title} — ${f.why}`)).join('\n').slice(0, 30000)
  return [
    { role: 'system', content: `You summarise a due-diligence review for the partner. Use only the flags given. ${NO_CITATION} Write in ${langName}.` },
    { role: 'user', content: `We act for the ${o.perspective} in a ${String(o.dealType).replace('_', ' ')}. ${docs.length} documents reviewed.\nRED FLAGS:\n${lines || '- none'}\n\nReply with JSON only: {"summary": "<3-5 sentences: the overall picture and what matters most>", "priorities": ["<up to 5 next steps, most important first>"], "readiness": "ready|conditional|not_ready"}` },
  ]
}

async function finish(job, signal) {
  const an = require('./analysis')
  const docs = job.files.filter((f) => f.status === 'done' && f.resultId).map((f) => docResult(f.resultId))
  const o = job.options || {}
  const flags = docs.flatMap((d) => d.flags.map((f) => ({ ...f, document: d.name })))
  const byTier = Object.fromEntries(TIERS.map((t) => [t, flags.filter((f) => f.tier === t).length]))
  const byCategory = {}
  for (const f of flags) byCategory[f.category] = (byCategory[f.category] || 0) + 1
  const types = new Set(docs.map((d) => d.docType).filter(Boolean))
  const missing = (EXPECTED[o.dealType] || EXPECTED.share_purchase).filter((t) => !types.has(t))
  const lang = an.detectLanguage(docs.map((d) => d.summary).join(' ') || 'en')
  const langName = require('./workflows_docs').LANGS[lang] || 'English'
  let overview = { summary: '', priorities: [], readiness: '' }
  const errors = []
  if (docs.length && !signal?.aborted) {
    try {
      const r = await an.askObject(summaryPrompt(o, docs, langName), 1500, 'analyze')
      overview = { summary: str(r.summary, 2000), priorities: (Array.isArray(r.priorities) ? r.priorities : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 5), readiness: ['ready', 'conditional', 'not_ready'].includes(str(r.readiness, 20)) ? str(r.readiness, 20) : '' }
    } catch (err) {
      if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
      errors.push(`summary: ${err.message}`)
    }
  }
  const id = `dd_${crypto.randomBytes(8).toString('hex')}`
  const dd = {
    kind: 'diligence', id, createdAt: new Date().toISOString(), matterId: job.matterId || null, batchId: job.id, gridId: o.gridId || null,
    perspective: o.perspective || 'buyer', dealType: o.dealType || 'share_purchase', focus: o.focus || '', language: lang,
    documents: docs.map((d) => ({ name: d.name, docType: d.docType, summary: d.summary, flags: d.flags, row: d.row, pages: d.pages, stats: d.stats })),
    skipped: job.files.filter((f) => f.status !== 'done').map((f) => ({ name: f.name, status: f.status, note: f.note || '' })),
    byTier, byCategory, missing, overview,
    stats: { documents: docs.length, flags: flags.length, verified: docs.reduce((n, d) => n + d.stats.verified, 0), dropped: docs.reduce((n, d) => n + d.stats.dropped, 0), errors },
  }
  save(DIR, id, dd)
  return { kind: 'diligence', id }
}

function get(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('unknown due-diligence review')
  return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'))
}

// ── report ───────────────────────────────────────────────────────────────
const TIER_WORDS = { deal_breaker: 'Deal breaker', price_affecting: 'Price-affecting', standard: 'Standard', informational: 'For information' }
const READY_WORDS = { ready: 'ready to sign', conditional: 'ready with conditions', not_ready: 'not ready' }

function reportOf(dd) {
  const flags = dd.documents.flatMap((d) => d.flags.map((f) => ({ ...f, document: d.name })))
  const grid = (() => { try { return dd.gridId ? require('./grid').rowsFor(require('./grid').get(dd.gridId)) : null } catch { return null } })()
  const sections = [
    { title: 'Summary', text: [
      `We act for the ${dd.perspective} in a ${dd.dealType.replace('_', ' ')}. ${dd.stats.documents} documents reviewed, ${dd.stats.flags} red flags: ${TIERS.map((t) => `${dd.byTier[t]} ${TIER_WORDS[t].toLowerCase()}`).join(', ')}.`,
      ...(dd.overview.summary ? [dd.overview.summary] : []),
      ...(dd.overview.readiness ? [`**Readiness:** ${READY_WORDS[dd.overview.readiness]}`] : []),
      ...(dd.overview.priorities.length ? [dd.overview.priorities.map((p, i) => `- ${i + 1}. ${p}`).join('\n')] : []),
    ] },
    { title: 'Red flags', ...(flags.length ? { table: [['Tier', 'Document', 'Flag', 'Why', 'What to do', 'Where', 'Quote'], ...flags.map((f) => [TIER_WORDS[f.tier], f.document, f.title, f.why, f.action, f.location, `"${f.quote}"`])] } : { text: 'No red flags found.' }) },
    ...(dd.missing.length ? [{ title: 'Not in the data room', text: [`A data room for a ${dd.dealType.replace('_', ' ')} usually also has: ${dd.missing.join(', ')}. Ask for them, or note why they are not needed.`] }] : []),
    ...(grid ? [{ title: 'Review grid', table: grid.table }] : []),
    { title: 'How this was checked', text: [
      `- Every red flag and every grid answer quotes its document word for word; ${dd.stats.dropped} flags were removed because their quote was not found.`,
      '- Grid answers marked UNVERIFIED quote text that was not found — check them.',
      '- No statutes were cited from memory. Written by AI — check before relying on it.',
      ...dd.skipped.map((s) => `- Not read: ${s.name}${s.note ? ` — ${s.note}` : ''}`),
    ].join('\n') },
  ]
  const csv = [['Tier', 'Category', 'Document', 'Flag', 'Why', 'What to do', 'Where', 'Quote'], ...flags.map((f) => [TIER_WORDS[f.tier], f.category, f.document, f.title, f.why, f.action, f.location, f.quote])]
  return {
    title: 'Due diligence', subtitle: `${dd.createdAt.slice(0, 10)} · ${dd.stats.documents} documents · for the ${dd.perspective}`,
    note: 'A first review by AI on this computer\'s rules for your data. Every finding quotes its document; check before relying on it.',
    sections, csv,
    sheets: [...(grid ? [{ name: 'Grid', rows: grid.table }, { name: 'Sources', rows: grid.sources }] : [])],
  }
}

function exportDiligence(id, format) {
  const dd = get(id)
  return require('./report').save({ report: reportOf(dd), format, matterId: dd.matterId, base: `due-diligence-${dd.createdAt.slice(0, 10)}` })
}

function brief(dd) {
  const lines = [`Due diligence: ${dd.stats.documents} documents, ${dd.stats.flags} red flags (${dd.byTier.deal_breaker} deal breakers, ${dd.byTier.price_affecting} price-affecting).`]
  if (dd.overview.summary) lines.push(dd.overview.summary)
  for (const d of dd.documents) for (const f of d.flags.filter((x) => x.tier === 'deal_breaker').slice(0, 3)) lines.push(`- ${d.name}: ${f.title}`)
  if (dd.missing.length) lines.push(`Not in the data room: ${dd.missing.join(', ')}`)
  return lines.join('\n')
}

require('./batch').registerKind('diligence', {
  perDoc: [4000, 2500],
  reads: 2, // the grid and the red flags each read the document
  extra: [6000, 1500],
  prepare,
  one: (o) => reviewOne(o),
  finish,
})

function handle(method, p, params, body = {}) {
  const q = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  try {
    if (method === 'GET' && p === '/api/diligence') return { status: 200, json: { diligence: get(q('id')) } }
    if (method === 'POST' && p === '/api/diligence/export') return { status: 200, json: exportDiligence(body.id, body.format) }
    return null
  } catch (err) { return { status: 400, json: { error: err.message } } }
}

module.exports = { prepare, reviewOne, finish, get, docResult, exportDiligence, reportOf, brief, optionsFor, handle, COLUMNS, TIERS, CATEGORIES, EXPECTED, DIR }
