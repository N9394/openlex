"use strict"
/**
 * Document analysis — one document, read the way a lawyer reads it first:
 *
 *   summary      what the document is, the parties, its purpose
 *   key terms    price, term, caps … as written
 *   deadlines    dates and periods, with importance (sorted: next first)
 *   obligations  who has to do what
 *   risks        high / medium / low, a one-line why and a suggested fix
 *   clauses      notable clauses, and clauses that seem to be missing
 *
 * The same engine workflow serves every front end (POST /api/workflows/run
 * {type: "analyse"}, `openlex analyse`, the /analyse skill through the
 * analyse_document tool).
 *
 * Trust rules (deterministic, after the model has answered):
 *   - every finding carries a verbatim quote; a quote that is not in the
 *     document drops the finding (counted, never shown as fact)
 *   - the location ("§ 7 · page 2") is computed from where the quote sits
 *     in the text; the model's own location is only a fallback
 *   - a date must be the one its quote states (else it stays a period)
 *   - party names must appear in the document
 *   - law is searched only for high and medium risks: the local law packs
 *     always, the official online sources (RIS, EUR-Lex) only when the
 *     matter's data rules allow web access
 *   - a second pass (the "judge" role) checks every suggested fix against
 *     its quote and the law found; a fix it rejects is removed, not shown
 *
 * Model-agnostic: plain chat + JSON in the reply (works with the text-JSON
 * protocol of local models and with hosted models alike). Long documents
 * are split into parts sized for the model's context, like the review
 * workflow. Everything is written in the document's language.
 *
 * Output (matter folder): analysis-<document>.md (readable),
 * analysis-<document>.docx (Word report with locations and sources),
 * analysis-<document>.json (structured; the matter overview reads it).
 */

const path = require('path')
const wf = require('./workflows')
const { docxBuffer } = require('./docx_write')

const LEVELS = ['high', 'medium', 'low']
const MAX_LAW_SEARCHES = 6
const QUOTE_MAX = 300

// ── language ─────────────────────────────────────────────────────────────
const STOPWORDS = {
  en: 'the and of to shall is in be by with this any or for are such which'.split(' '),
  de: 'der die das und ist nicht mit wird den des sich auf für zu eine ein vom im dem gemäß'.split(' '),
  fr: 'le la les et des du est une pour dans par sur qui au aux sont'.split(' '),
  it: 'il che di del della per sono una con non gli alla delle è'.split(' '),
  es: 'el los las del que por con una para se al su como'.split(' '),
  nl: 'het een van en dat met voor niet zijn wordt deze door bij'.split(' '),
  pl: 'w z na się nie do jest oraz przez że lub umowy'.split(' '),
  cs: 'se na je že do smlouvy nebo který této podle'.split(' '),
  sk: 'sa na je že do zmluvy alebo ktorý tejto podľa'.split(' '),
  ro: 'și în cu pe care este din sau pentru contractului'.split(' '),
  hu: 'az és hogy nem egy van vagy szerint szerződés'.split(' '),
  pt: 'os do da que em para com não contrato pelo'.split(' '),
}

/** Language of a text by its most frequent function words → ISO code (en when unsure). */
function detectLanguage(text) {
  const sample = String(text || '').slice(0, 20000).toLowerCase()
  if ((sample.match(/[α-ω]/g) || []).length > 200) return 'el'
  const counts = new Map()
  for (const w of sample.split(/[^\p{L}]+/u)) if (w) counts.set(w, (counts.get(w) || 0) + 1)
  let best = 'en'
  let bestScore = 0
  for (const [lang, words] of Object.entries(STOPWORDS)) {
    const score = words.reduce((n, w) => n + (counts.get(w) || 0), 0)
    if (score > bestScore) { best = lang; bestScore = score }
  }
  return best
}

// Report labels shown to the lawyer, in the document's language (English otherwise).
const LABELS = {
  en: {
    title: 'Analysis', glance: 'At a glance', what: 'What it is', parties: 'Parties', purpose: 'Purpose',
    risks: 'Risks', high: 'High risk', medium: 'Medium risk', low: 'Low risk', why: 'Why it matters', fix: 'Suggested fix',
    where: 'Where', quote: 'Quote', law: 'Law', deadlines: 'Deadlines and dates', date: 'Date', importance: 'Importance',
    obligations: 'Who has to do what', keyTerms: 'Key terms', clauses: 'Notable and missing clauses', notable: 'Notable',
    missing: 'Possibly missing (not found in the text — please check)', checks: 'How this was checked', language: 'Language',
    noRisks: 'No risks found.', noDates: 'No dates or deadlines found.', none: 'Nothing found.',
    fixChecked: 'checked by a second pass', fixCorrected: 'corrected by a second pass', fixUnchecked: 'not double-checked',
    fixRemoved: 'No safe fix suggested — the second pass rejected the first proposal. Decide how to handle this.',
    note: 'Every finding below quotes the document word for word; findings whose quote could not be found were removed. Summaries and suggested fixes are written by AI — check them before relying on them.',
    verified: 'findings checked against the text', dropped: 'removed (quote not found in the document)',
    webOff: 'Official online sources (RIS, EUR-Lex) were not searched: this matter’s data rules do not allow web access.',
    lawCount: 'law searches for high and medium risks', parts: 'Document read in', partsUnit: 'parts',
    period: 'period', whatCol: 'What', term: 'Term', value: 'As written',
    lv: { high: 'high', medium: 'medium', low: 'low' },
  },
  de: {
    title: 'Analyse', glance: 'Auf einen Blick', what: 'Worum es geht', parties: 'Parteien', purpose: 'Zweck',
    risks: 'Risiken', high: 'Hohes Risiko', medium: 'Mittleres Risiko', low: 'Geringes Risiko', why: 'Warum es wichtig ist', fix: 'Vorschlag',
    where: 'Fundstelle', quote: 'Zitat', law: 'Rechtsgrundlage', deadlines: 'Fristen und Termine', date: 'Datum', importance: 'Bedeutung',
    obligations: 'Wer muss was tun', keyTerms: 'Wesentliche Bedingungen', clauses: 'Auffällige und fehlende Klauseln', notable: 'Auffällig',
    missing: 'Möglicherweise fehlend (im Text nicht gefunden — bitte prüfen)', checks: 'Wie geprüft wurde', language: 'Sprache',
    noRisks: 'Keine Risiken gefunden.', noDates: 'Keine Fristen oder Termine gefunden.', none: 'Nichts gefunden.',
    fixChecked: 'in einem zweiten Durchgang geprüft', fixCorrected: 'im zweiten Durchgang korrigiert', fixUnchecked: 'nicht gegengeprüft',
    fixRemoved: 'Kein sicherer Vorschlag — der zweite Durchgang hat den ersten Vorschlag verworfen. Bitte selbst entscheiden.',
    note: 'Jede Feststellung zitiert das Dokument wörtlich; Feststellungen, deren Zitat nicht gefunden wurde, wurden entfernt. Zusammenfassungen und Vorschläge stammen von der KI — bitte vor Verwendung prüfen.',
    verified: 'Feststellungen am Text geprüft', dropped: 'entfernt (Zitat nicht im Dokument gefunden)',
    webOff: 'Offizielle Online-Quellen (RIS, EUR-Lex) wurden nicht durchsucht: Die Datenregeln dieser Akte erlauben keinen Web-Zugriff.',
    lawCount: 'Rechtsrecherchen zu hohen und mittleren Risiken', parts: 'Dokument gelesen in', partsUnit: 'Teilen',
    period: 'Frist', whatCol: 'Was', term: 'Begriff', value: 'Wortlaut',
    lv: { high: 'hoch', medium: 'mittel', low: 'gering' },
  },
}
const labelsFor = (lang) => LABELS[lang] || LABELS.en

// ── locations ────────────────────────────────────────────────────────────
// A heading-like start of a line: "§ 7", "Art. 3", "Section 4.2", "Clause 9", "4.2", "IV.".
const HEADING_RE = /^\s*(§\s*\d+[a-z]?(?:\s*(?:Abs\.?|para\.?)\s*\d+)?|(?:Art(?:\.|ikel|icle)?|Section|Clause|Klausel|Punkt|Ziffer|Article)\s+\d+(?:\.\d+)*|\d+(?:\.\d+)+\.?|\d+\.(?=\s)|[IVX]+\.(?=\s))/i

/** Normalised text plus a map from each normalised character back to the original index. */
function normWithMap(text) {
  const src = String(text || '')
  let out = ''
  const map = []
  let space = false
  for (let i = 0; i < src.length; i++) {
    let c = src[i]
    if (/\s/.test(c)) { if (!space && out.length) { out += ' '; map.push(i) } space = true; continue }
    space = false
    if (/[‘’‚‛]/.test(c)) c = "'"
    else if (/[“”„‟«»]/.test(c)) c = '"'
    else if (/[–—]/.test(c)) c = '-'
    out += c.toLowerCase()
    map.push(i)
  }
  return { norm: out, map }
}

/**
 * Where a quote sits in the text: { pos, section, page, text } or null.
 * section = the nearest heading-like line start at or before the quote,
 * page = the last "[Page N]" marker (PDF text) before it.
 */
function locate(text, quote, cache) {
  const src = String(text || '')
  const nm = cache?.nm || normWithMap(src)
  if (cache && !cache.nm) cache.nm = nm
  const first = wf.norm(quote).split(/\s*(?:\.\.\.|…)\s*/).filter(Boolean)[0]
  if (!first) return null
  const at = nm.norm.indexOf(first)
  if (at < 0) return null
  const pos = nm.map[at]
  const before = src.slice(0, pos)
  const pages = [...before.matchAll(/\[Page (\d+)(?: · OCR)?\]/g)]
  const page = pages.length ? Number(pages[pages.length - 1][1]) : null
  // Lines from the quote's own line backwards: the first heading-like start wins.
  const end = src.indexOf('\n', pos)
  const lines = src.slice(0, end < 0 ? src.length : end).split('\n')
  let section = null
  for (let i = lines.length - 1, seen = 0; i >= 0 && seen < 400; i--, seen++) {
    const m = lines[i].match(HEADING_RE)
    if (m) {
      const line = lines[i].trim()
      section = line.length <= 70 && !/[.;,]$/.test(line) ? line : m[1].trim()
      break
    }
  }
  return { pos, section, page, text: locationText(section, page) }
}

function locationText(section, page, lang = 'en') {
  const pageWord = lang === 'de' ? 'Seite' : 'page'
  return [section, page ? `${pageWord} ${page}` : null].filter(Boolean).join(' · ')
}

// ── model I/O ────────────────────────────────────────────────────────────
/** The first JSON object in a model reply (fences, <think> and prose tolerated). */
function firstObject(reply) {
  const s = String(reply || '').replace(/<think>[\s\S]*?<\/think>/g, '')
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false
    for (let j = i; j < s.length; j++) {
      const c = s[j]
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
      if (c === '"') inStr = true
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) {
          try { const v = JSON.parse(s.slice(i, j + 1)); if (v && typeof v === 'object' && !Array.isArray(v)) return v } catch { /* keep scanning */ }
          break
        }
      }
    }
  }
  throw new Error('no JSON object in model reply')
}

async function askObject(messages, maxTokens, role) {
  const { chat } = require('./llm')
  const reply = await chat(messages, { maxTokens, temperature: 0, role })
  try { return firstObject(reply) } catch {
    const again = await chat([...messages, { role: 'assistant', content: reply }, { role: 'user', content: 'Reply again with ONLY the JSON object, no prose.' }], { maxTokens, temperature: 0, role })
    return firstObject(again)
  }
}

/**
 * Characters per model call. Hosted models: 12000 like the review workflow;
 * a model with a small context window (profile ctx, or an unknown local
 * model) gets smaller parts so the reply still fits.
 */
function partChars(matterId) {
  try {
    const p = require('./routing').primary({ role: 'analyze', matterId })
    const ctx = p.ctx || require('./models').profileFor({ kind: p.kind === 'local' ? 'local' : 'hosted', model: p.model }).ctx
    if (ctx) return Math.max(2500, Math.min(12000, (ctx - 3500) * 3))
    return p.kind === 'local' ? 6000 : 12000
  } catch { return 12000 }
}

function splitParts(text, size) {
  if (text.length <= size) return [text]
  const out = []
  let cur = ''
  for (const para of text.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length > size) { out.push(cur); cur = '' }
    cur += (cur ? '\n\n' : '') + para
    while (cur.length > size) { out.push(cur.slice(0, size)); cur = cur.slice(size) }
  }
  if (cur.trim()) out.push(cur)
  return out
}

function analysePrompt(name, part, idx, total, langName) {
  return [
    { role: 'system', content: `You analyse legal documents for a lawyer. Answer only from the document text. Never guess or invent facts, dates, amounts or law. Copy every quote exactly, word for word. Write all your text in ${langName}, the language of the document.` },
    { role: 'user', content: `DOCUMENT: ${name}${total > 1 ? ` (part ${idx + 1} of ${total})` : ''}\n"""\n${part}\n"""\n\nAnalyse this document for a lawyer. Write every text field in ${langName}. Every item needs "quote": the exact words copied from the document (max ${QUOTE_MAX} characters), and "location": the clause or section number, or [Page N] if visible.${idx > 0 ? ' "summary" may be left out for this part.' : ''}\nReply with JSON only, one object:\n{"summary": {"what": "<what kind of document, one sentence>", "parties": [{"name": "<as written>", "role": "<e.g. landlord>"}], "purpose": "<one or two sentences>"},\n "key_terms": [{"term": "<e.g. rent>", "value": "<as written>", "quote": "", "location": ""}],\n "dates": [{"date": "<YYYY-MM-DD, or empty when the text gives a period, not a date>", "when": "<the date or period as written>", "what": "<what is due or happens>", "importance": "high|medium|low", "quote": "", "location": ""}],\n "obligations": [{"party": "<who>", "duty": "<what they must do>", "quote": "", "location": ""}],\n "risks": [{"title": "<short>", "level": "high|medium|low", "why": "<one line: why it matters and for whom>", "fix": "<one line: the change you suggest>", "law_query": "<search words with statutory terms in ${langName}, or empty>", "quote": "", "location": ""}],\n "clauses": [{"title": "<clause>", "kind": "notable|missing", "note": "<one line>", "quote": "<exact words; empty for a missing clause>", "location": ""}]}` },
  ]
}

function judgePrompt(name, risks, langName) {
  const list = risks.map((r, i) => `[${i}] ${r.level.toUpperCase()} — ${r.title}\nRISK: ${r.why}\nCLAUSE: "${r.quote}"\nSUGGESTED FIX: ${r.fix}${r.sources.length ? `\nLAW FOUND: ${r.sources.map((s) => `${s.title}${s.section ? ' ' + s.section : ''}: ${s.snippet || ''}`).join(' | ').slice(0, 700)}` : ''}`)
  return [
    { role: 'system', content: 'You double-check a contract analysis for a lawyer. You are a safety net, not a second drafter. Judge only from the clause text and the law shown.' },
    { role: 'user', content: `DOCUMENT: ${name}\nCHECK THE SUGGESTED FIXES below. For each: does the risk description match the quoted clause, and is the suggested fix a sensible, lawful change (as far as the law shown says) written in ${langName}?\n\n${list.join('\n\n')}\n\nReply with JSON only: [{"i": <number>, "verdict": "ok|revise|drop", "fix": "<the corrected fix, only for revise>", "note": "<short reason>"}]. Use "drop" only when the fix is wrong or would harm the client; when in doubt, "ok".` },
  ]
}

// ── normalising model output ─────────────────────────────────────────────
const str = (v, max = 600) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '')
function level(v, fallback = 'medium') {
  const s = str(v, 20).toLowerCase()
  if (/^(high|critical|severe|red|hoch|kritisch|élevé|alto|wysokie|vysok)/.test(s)) return 'high'
  if (/^(medium|moderate|yellow|amber|mittel|moyen|medio|średnie|stredn|střední)/.test(s)) return 'medium'
  if (/^(low|minor|green|gering|niedrig|faible|basso|bajo|niskie|nízk)/.test(s)) return 'low'
  return fallback
}
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])

// ── law search (only for high and medium risks) ──────────────────────────
const EU_RE = /\b(gdpr|dsgvo|rgpd|regulation|verordnung|directive|richtlinie|eu|eur-lex|\d{4}\/\d{2,4})\b/i

/** Local law packs (search_law): on this computer, allowed under every data rule. */
async function searchLocal({ query, jurisdiction }) {
  const tools = require('./tools')
  const ctx = { doc: { jurisdiction: () => jurisdiction || '', text: '' }, search: require('./search'), embeddings: require('./embeddings') }
  const r = await tools.dispatch(ctx, 'search_law', { query, jurisdiction: jurisdiction || '' })
  return (r.lawSources || []).slice(0, 2).map((s) => ({ kind: 'law', title: s.source_name, section: s.section, snippet: s.snippet, ref: s.chunk_id }))
}

/** Official online sources: RIS for Austrian law, EUR-Lex for EU acts. Only called when the data rules allow web access. */
async function searchWeb({ query, jurisdiction }) {
  const tools = require('./tools')
  const out = []
  const ctx = { doc: { jurisdiction: () => jurisdiction || '' } }
  if (jurisdiction === 'AT') {
    const r = await tools.dispatch(ctx, 'search_ris', { query, limit: 3 })
    for (const s of (r.webSources || []).slice(0, 2)) out.push({ kind: 'ris', title: s.title, url: s.url, snippet: s.inForce === false ? 'not in force' : '' })
  }
  if (EU_RE.test(query)) {
    const r = await tools.dispatch(ctx, 'search_eurlex', { query })
    for (const s of (r.webSources || []).slice(0, 2)) out.push({ kind: 'eurlex', title: s.title, url: s.url, snippet: s.inForce === false ? 'not in force' : '' })
  }
  return out
}

// The law search functions in use (tests swap them for offline fakes).
const lawSources = { local: searchLocal, web: searchWeb }
function setLawSources(s = {}) {
  lawSources.local = s.local || searchLocal
  lawSources.web = s.web || searchWeb
}

function webAllowed(matterId) {
  try { return require('./policy').check({ id: 'web', local: false }, matterId).allowed } catch { return false }
}

// ── the run ──────────────────────────────────────────────────────────────
const safeBase = (f) => path.basename(f).replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 80)

/**
 * Analyse one or more documents.
 * @param {object} o
 *   matterId, file | files (paths or names in the matter's folders), or
 *   text + name (e.g. the open Word document), onProgress, signal,
 *   sources: { local, web } — law search functions (tests inject fakes)
 * @returns {{ analyses: object[], files: string[], stats: object, summary: string }}
 */
async function runAnalyse(o = {}) {
  const inputs = []
  if (typeof o.text === 'string' && o.text.trim()) inputs.push({ name: String(o.name || 'Document').slice(0, 120), text: o.text })
  const list = Array.isArray(o.files) ? o.files : o.file ? [o.file] : []
  for (const f of list) inputs.push({ file: require('./workflows_docs').resolveDoc(o.matterId, String(f)) })
  if (!inputs.length) throw new Error('No document: pass a file (or files) to analyse.')
  const analyses = []
  const files = []
  for (const [i, input] of inputs.entries()) {
    if (o.signal?.aborted) break
    const a = await analyseOne({ matterId: o.matterId, onProgress: o.onProgress, signal: o.signal, sources: o.sources, file: input.file, text: input.text, name: input.name, index: i, total: inputs.length })
    analyses.push(a)
    files.push(...Object.values(a.files))
  }
  const stats = analyses.length === 1 ? analyses[0].stats : {
    documents: analyses.length,
    verified: analyses.reduce((n, a) => n + a.stats.verified, 0),
    dropped: analyses.reduce((n, a) => n + a.stats.dropped, 0),
    high: analyses.reduce((n, a) => n + a.stats.high, 0),
    medium: analyses.reduce((n, a) => n + a.stats.medium, 0),
    low: analyses.reduce((n, a) => n + a.stats.low, 0),
  }
  return { analyses, files, stats, count: analyses.reduce((n, a) => n + a.risks.length, 0), summary: analyses.map(brief).join('\n\n') }
}

async function analyseOne({ matterId, file, text, name, onProgress, signal, sources = {}, index = 0, total = 1 }) {
  name = name || path.basename(file)
  onProgress?.({ step: 'read', index: index + 1, total, name })
  if (file) text = await wf.readDoc(file)
  text = String(text || '')
  if (!text.trim()) throw new Error(`${name}: no text found (scanned PDF where OCR found nothing?)`)
  const lang = detectLanguage(text)
  const langName = require('./workflows_docs').LANGS[lang] || 'English'
  let jurisdiction = new (require('./doc').Document)(text.slice(0, 4000), 'analysis').jurisdiction()
  if (jurisdiction === 'US' && lang !== 'en') jurisdiction = ''

  const ps = splitParts(text, partChars(matterId))
  const stats = { parts: ps.length, verified: 0, dropped: 0, lawSearches: 0, web: false, errors: [] }
  const raw = { summary: null, key_terms: [], dates: [], obligations: [], risks: [], clauses: [] }
  for (const [pi, part] of ps.entries()) {
    if (signal?.aborted) break
    onProgress?.({ step: 'analyse', index: pi + 1, total: ps.length, name })
    let obj
    try { obj = await askObject(analysePrompt(name, part, pi, ps.length, langName), 3500, 'analyze') } catch (err) {
      if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
      stats.errors.push(`part ${pi + 1}: ${err.message}`)
      continue
    }
    if (!raw.summary && obj.summary && typeof obj.summary === 'object') raw.summary = obj.summary
    for (const k of ['key_terms', 'dates', 'obligations', 'risks', 'clauses']) raw[k].push(...arr(obj[k] ?? obj[k.replace('_', '')] ?? obj[k === 'key_terms' ? 'keyTerms' : k]))
  }
  if (!raw.summary && !Object.values(raw).some((v) => Array.isArray(v) && v.length) && stats.errors.length) {
    throw new Error(`${name}: the model gave no usable answer (${stats.errors[0]})`)
  }

  // ── verify: quotes, locations, dates, parties ──
  onProgress?.({ step: 'verify', name })
  const cache = {}
  const seen = new Set()
  const where = (it) => {
    const loc = locate(text, it.quote, cache)
    const fallback = str(it.location, 80)
    return loc
      ? { section: loc.section || (fallback || null), page: loc.page, text: locationText(loc.section || fallback || null, loc.page, lang), pos: loc.pos }
      : { section: fallback || null, page: null, text: fallback, pos: Number.MAX_SAFE_INTEGER }
  }
  const verified = (kind, it) => {
    const quote = str(it.quote, QUOTE_MAX + 50)
    if (!wf.quoteInSource(quote, text)) { stats.dropped++; return null }
    const key = `${kind}|${wf.norm(quote)}|${wf.norm(it.title || it.term || it.what || it.duty || '')}`
    if (seen.has(key)) return null
    seen.add(key)
    stats.verified++
    return { quote, location: where({ ...it, quote }) }
  }

  const keyTerms = []
  for (const it of raw.key_terms) {
    const term = str(it.term, 120)
    if (!term) continue
    const v = verified('term', it)
    if (v) keyTerms.push({ term, value: str(it.value, 300), ...v })
  }

  const deadlines = []
  for (const it of raw.dates) {
    const what = str(it.what || it.event, 300)
    if (!what) continue
    const v = verified('date', it)
    if (!v) continue
    // The date must be the one the quote states; anything else stays a period.
    const stated = wf.datesInText(v.quote)
    const given = wf.parseDate(str(it.date, 10))
    let date = null
    if (stated.length === 1) date = wf.parseDate(stated[0])
    else if (stated.length > 1 && given && stated.includes(given.display)) date = given
    deadlines.push({ date: date ? date.display : null, when: str(it.when, 120) || (date ? date.display : ''), what, importance: level(it.importance), ...v })
  }
  const rank = { high: 0, medium: 1, low: 2 }
  deadlines.sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || (a.date && b.date ? a.date.localeCompare(b.date) : 0) || rank[a.importance] - rank[b.importance] || a.location.pos - b.location.pos)

  const obligations = []
  for (const it of raw.obligations) {
    const duty = str(it.duty || it.obligation, 400)
    if (!duty) continue
    const v = verified('obligation', it)
    if (v) obligations.push({ party: str(it.party, 120) || '—', duty, ...v })
  }
  obligations.sort((a, b) => a.location.pos - b.location.pos)

  const risks = []
  for (const it of raw.risks) {
    const title = str(it.title, 160)
    if (!title) continue
    const v = verified('risk', it)
    if (v) risks.push({ title, level: level(it.level ?? it.severity ?? it.risk), why: str(it.why || it.description, 400), fix: str(it.fix || it.recommendation, 600), lawQuery: str(it.law_query, 200), ...v, sources: [], fixCheck: 'unchecked' })
  }
  risks.sort((a, b) => rank[a.level] - rank[b.level] || a.location.pos - b.location.pos)
  risks.forEach((r, i) => { r.id = `R${i + 1}` })

  const clauses = []
  for (const it of raw.clauses) {
    const title = str(it.title, 160)
    if (!title) continue
    const kind = /missing|absent|fehl/i.test(str(it.kind, 20)) ? 'missing' : 'notable'
    if (kind === 'missing') {
      // Nothing to quote for a missing clause: shown as "please check", never as fact.
      if (seen.has(`missing|${wf.norm(title)}`)) continue
      seen.add(`missing|${wf.norm(title)}`)
      clauses.push({ title, kind, note: str(it.note, 300), quote: '', location: { section: null, page: null, text: '', pos: Number.MAX_SAFE_INTEGER } })
      continue
    }
    const v = verified('clause', it)
    if (v) clauses.push({ title, kind, note: str(it.note, 300), ...v })
  }
  clauses.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'notable' ? -1 : 1) || a.location.pos - b.location.pos)

  const s = raw.summary || {}
  const folded = wf.norm(text)
  const parties = arr(s.parties).map((p) => ({ name: str(p.name, 160), role: str(p.role, 80) }))
    .filter((p) => p.name && folded.includes(wf.norm(p.name)))
  const summary = { what: str(s.what, 400), parties, purpose: str(s.purpose, 600) }

  // ── law: only for high and medium risks ──
  const local = sources.local || lawSources.local
  const web = sources.web || lawSources.web
  stats.web = webAllowed(matterId)
  const targets = risks.filter((r) => r.level !== 'low').slice(0, MAX_LAW_SEARCHES)
  for (const [ri, r] of targets.entries()) {
    if (signal?.aborted) break
    onProgress?.({ step: 'law', index: ri + 1, total: targets.length, name: r.title })
    const query = r.lawQuery || `${r.title} ${r.why}`.slice(0, 200)
    const found = []
    try { found.push(...await local({ query, jurisdiction, language: lang, risk: r })) } catch (err) { stats.errors.push(`law search: ${err.message}`) }
    if (stats.web) {
      try { found.push(...await web({ query, jurisdiction, language: lang, risk: r })) } catch (err) { stats.errors.push(`online law search: ${err.message}`) }
    }
    stats.lawSearches++
    const keys = new Set()
    r.sources = found.filter((x) => x && x.title).filter((x) => { const k = `${x.title}|${x.section || ''}`; if (keys.has(k)) return false; keys.add(k); return true })
      .slice(0, 3).map((x) => ({ kind: x.kind || 'law', title: str(x.title, 200), section: str(x.section, 80), snippet: str(x.snippet, 240), url: str(x.url, 400), ref: str(x.ref, 80) }))
  }

  // ── judge: double-check every suggested fix ──
  const withFix = risks.filter((r) => r.fix)
  if (withFix.length && !signal?.aborted) {
    onProgress?.({ step: 'judge', total: withFix.length, name })
    try {
      const items = await wf.askJson(judgePrompt(name, withFix, langName), 2000, 'judge')
      for (const it of Array.isArray(items) ? items : []) {
        const r = withFix[Number(it?.i)]
        if (!r) continue
        const verdict = str(it.verdict || it.status, 20).toLowerCase()
        if (verdict === 'drop') { r.fixCheck = 'removed'; r.rejectedFix = r.fix; r.fix = ''; r.fixNote = str(it.note, 300) }
        else if (verdict === 'revise' && str(it.fix, 600)) { r.fixCheck = 'corrected'; r.fix = str(it.fix, 600); r.fixNote = str(it.note, 300) }
        else if (verdict === 'ok' || verdict === 'verified') r.fixCheck = 'checked'
      }
    } catch (err) { stats.errors.push(`second pass: ${err.message}`) }
  }

  for (const lv of LEVELS) stats[lv] = risks.filter((r) => r.level === lv).length
  const analysis = {
    version: 1,
    kind: 'analysis',
    createdAt: new Date().toISOString(),
    matterId: matterId || null,
    document: { name, ...(file ? { path: file } : {}), chars: text.length, language: lang, languageName: langName, jurisdiction: jurisdiction || null },
    summary, keyTerms, deadlines, obligations, risks, clauses, stats,
  }

  onProgress?.({ step: 'write', name })
  const ws = require('./workspace')
  const folder = ws.matterFolder(wf.matterLabel(matterId))
  const base = `analysis-${safeBase(name)}`
  const out = {
    md: ws.writeFile(`${folder}/${base}.md`, toMarkdown(analysis)),
    docx: ws.writeFileBinary(`${folder}/${base}.docx`, toDocx(analysis)),
  }
  out.json = ws.resolve(`${folder}/${base}.json`)
  analysis.files = { ...out }
  const stored = stripPos(analysis)
  ws.writeFile(`${folder}/${base}.json`, JSON.stringify(stored, null, 2))
  return stored
}

/** JSON without the internal sort positions. */
function stripPos(a) {
  const clean = (x) => ({ ...x, location: x.location ? { section: x.location.section, page: x.location.page, text: x.location.text } : x.location })
  return { ...a, keyTerms: a.keyTerms.map(clean), deadlines: a.deadlines.map(clean), obligations: a.obligations.map(clean), risks: a.risks.map(clean), clauses: a.clauses.map(clean) }
}

// ── rendering ────────────────────────────────────────────────────────────
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const cell = (s) => oneLine(s).replace(/\|/g, '/')

function fixLine(r, L) {
  if (r.fixCheck === 'removed') return L.fixRemoved
  if (!r.fix) return ''
  const how = r.fixCheck === 'checked' ? L.fixChecked : r.fixCheck === 'corrected' ? L.fixCorrected : L.fixUnchecked
  return `${r.fix} (${how})`
}

function sourceLine(s) {
  return `${s.title}${s.section ? ` ${s.section}` : ''}${s.snippet ? ` — ${s.snippet}` : ''}${s.url ? ` (${s.url})` : ''}`
}

function headline(a, L) {
  const st = a.stats
  return `${a.createdAt.slice(0, 10)} · ${L.language}: ${a.document.languageName} · ${L.risks}: ${st.high} ${L.lv.high}, ${st.medium} ${L.lv.medium}, ${st.low} ${L.lv.low} · ${st.verified} ${L.verified} · ${st.dropped} ${L.dropped}`
}

function toMarkdown(a) {
  const L = labelsFor(a.document.language)
  const md = [`# ${L.title}: ${a.document.name}`, '', headline(a, L), '', `> ${L.note}`, '', `## ${L.glance}`, '']
  if (a.summary.what) md.push(`**${L.what}:** ${a.summary.what}`, '')
  if (a.summary.parties.length) md.push(`**${L.parties}:** ${a.summary.parties.map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('; ')}`, '')
  if (a.summary.purpose) md.push(`**${L.purpose}:** ${a.summary.purpose}`, '')

  md.push(`## ${L.risks}`, '')
  if (!a.risks.length) md.push(L.noRisks, '')
  for (const r of a.risks) {
    md.push(`### ${L[r.level]} — ${r.title}`, '')
    if (r.why) md.push(`- **${L.why}:** ${r.why}`)
    const fix = fixLine(r, L)
    if (fix) md.push(`- **${L.fix}:** ${fix}`)
    if (r.location.text) md.push(`- **${L.where}:** ${r.location.text}`)
    for (const s of r.sources) md.push(`- **${L.law}:** ${sourceLine(s)}`)
    md.push(`- **${L.quote}:**`, `  > ${oneLine(r.quote)}`, '')
  }

  md.push(`## ${L.deadlines}`, '')
  if (!a.deadlines.length) md.push(L.noDates, '')
  else {
    md.push(`| ${L.date} | ${L.whatCol} | ${L.importance} | ${L.where} |`, '|---|---|---|---|')
    for (const d of a.deadlines) md.push(`| ${d.date || `${cell(d.when)} (${L.period})`} | ${cell(d.what)} — "${cell(d.quote).slice(0, 160)}" | ${L.lv[d.importance]} | ${cell(d.location.text)} |`)
    md.push('')
  }

  md.push(`## ${L.obligations}`, '')
  if (!a.obligations.length) md.push(L.none, '')
  const parties = [...new Set(a.obligations.map((o) => o.party))]
  for (const p of parties) {
    md.push(`### ${p}`, '')
    for (const o of a.obligations.filter((x) => x.party === p)) md.push(`- ${o.duty}${o.location.text ? ` (${o.location.text})` : ''}`, `  > ${oneLine(o.quote)}`)
    md.push('')
  }

  md.push(`## ${L.keyTerms}`, '')
  if (!a.keyTerms.length) md.push(L.none, '')
  else {
    md.push(`| ${L.term} | ${L.value} | ${L.where} |`, '|---|---|---|')
    for (const t of a.keyTerms) md.push(`| ${cell(t.term)} | ${cell(t.value || t.quote)} | ${cell(t.location.text)} |`)
    md.push('')
  }

  md.push(`## ${L.clauses}`, '')
  if (!a.clauses.length) md.push(L.none, '')
  for (const c of a.clauses) {
    if (c.kind === 'missing') md.push(`- **${L.missing}:** ${c.title}${c.note ? ` — ${c.note}` : ''}`)
    else md.push(`- **${L.notable}:** ${c.title}${c.note ? ` — ${c.note}` : ''}${c.location.text ? ` (${c.location.text})` : ''}`, `  > ${oneLine(c.quote)}`)
  }
  md.push('', `## ${L.checks}`, '',
    `- ${a.stats.verified} ${L.verified}; ${a.stats.dropped} ${L.dropped}.`,
    `- ${a.stats.lawSearches} ${L.lawCount}.`,
    ...(a.stats.parts > 1 ? [`- ${L.parts} ${a.stats.parts} ${L.partsUnit}.`] : []),
    ...(a.stats.web ? [] : [`- ${L.webOff}`]),
    ...a.stats.errors.map((e) => `- ${e}`))
  return md.join('\n') + '\n'
}

function toDocx(a) {
  const L = labelsFor(a.document.language)
  const b = [{ text: `${L.title}: ${a.document.name}`, style: 'Title' }, { text: headline(a, L) }, { runs: [{ text: L.note, color: '595959' }] }]
  b.push({ text: L.glance, style: 'Heading1' })
  const glance = []
  if (a.summary.what) glance.push([L.what, a.summary.what])
  if (a.summary.parties.length) glance.push([L.parties, a.summary.parties.map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('\n')])
  if (a.summary.purpose) glance.push([L.purpose, a.summary.purpose])
  if (glance.length) b.push({ table: [['', ''], ...glance] })

  b.push({ text: L.risks, style: 'Heading1' })
  if (!a.risks.length) b.push({ text: L.noRisks })
  const color = { high: 'C00000', medium: 'B26B00', low: '1F6F3F' }
  for (const r of a.risks) {
    b.push({ runs: [{ text: `${L[r.level]} — `, bold: true, color: color[r.level] }, { text: r.title, bold: true }], style: 'Heading2' })
    const rows = []
    if (r.why) rows.push([L.why, r.why])
    const fix = fixLine(r, L)
    if (fix) rows.push([L.fix, fix])
    if (r.location.text) rows.push([L.where, r.location.text])
    rows.push([L.quote, `"${oneLine(r.quote)}"`])
    for (const s of r.sources) rows.push([L.law, sourceLine(s)])
    b.push({ table: [['', ''], ...rows] })
  }

  b.push({ text: L.deadlines, style: 'Heading1' })
  if (!a.deadlines.length) b.push({ text: L.noDates })
  else b.push({ table: [[L.date, `${L.whatCol} · ${L.importance} · ${L.where}`], ...a.deadlines.map((d) => [d.date || `${d.when} (${L.period})`, `${d.what}\n${L.lv[d.importance]}${d.location.text ? ` · ${d.location.text}` : ''}\n"${oneLine(d.quote).slice(0, 200)}"`])] })

  b.push({ text: L.obligations, style: 'Heading1' })
  if (!a.obligations.length) b.push({ text: L.none })
  else b.push({ table: [[L.parties, `${L.obligations} · ${L.where}`], ...a.obligations.map((o) => [o.party, `${o.duty}${o.location.text ? ` (${o.location.text})` : ''}\n"${oneLine(o.quote).slice(0, 200)}"`])] })

  b.push({ text: L.keyTerms, style: 'Heading1' })
  if (!a.keyTerms.length) b.push({ text: L.none })
  else b.push({ table: [[L.term, `${L.value} · ${L.where}`], ...a.keyTerms.map((t) => [t.term, `${t.value || oneLine(t.quote)}${t.location.text ? ` (${t.location.text})` : ''}`])] })

  b.push({ text: L.clauses, style: 'Heading1' })
  if (!a.clauses.length) b.push({ text: L.none })
  for (const c of a.clauses) {
    b.push({ runs: [{ text: `${c.kind === 'missing' ? L.missing : L.notable}: `, bold: true }, { text: `${c.title}${c.note ? ` — ${c.note}` : ''}${c.location.text ? ` (${c.location.text})` : ''}` }] })
    if (c.quote) b.push({ runs: [{ text: `"${oneLine(c.quote)}"`, color: '595959' }] })
  }
  b.push({ text: L.checks, style: 'Heading1' },
    { text: `${a.stats.verified} ${L.verified}; ${a.stats.dropped} ${L.dropped}.` },
    { text: `${a.stats.lawSearches} ${L.lawCount}.` },
    ...(a.stats.web ? [] : [{ text: L.webOff }]),
    ...a.stats.errors.map((e) => ({ text: e })))
  return docxBuffer(b)
}

/** A few plain lines for a terminal, the agent or a notification. */
function brief(a) {
  const L = labelsFor(a.document.language)
  const lines = [`${a.document.name}: ${a.summary.what || L.title}`]
  lines.push(`${L.risks}: ${a.stats.high} ${L.lv.high}, ${a.stats.medium} ${L.lv.medium}, ${a.stats.low} ${L.lv.low} · ${a.stats.verified} ${L.verified} · ${a.stats.dropped} ${L.dropped}`)
  for (const r of a.risks.filter((x) => x.level !== 'low').slice(0, 5)) lines.push(`- [${L.lv[r.level]}] ${r.title}${r.location.text ? ` (${r.location.text})` : ''}${r.fix ? ` — ${L.fix}: ${r.fix}` : ''}`)
  const next = a.deadlines.find((d) => d.date && d.date >= new Date().toISOString().slice(0, 10)) || a.deadlines[0]
  if (next) lines.push(`${L.deadlines}: ${next.date || next.when} — ${next.what}${a.deadlines.length > 1 ? ` (+${a.deadlines.length - 1})` : ''}`)
  return lines.join('\n')
}

module.exports = { runAnalyse, detectLanguage, locate, firstObject, level, toMarkdown, toDocx, brief, splitParts, partChars, setLawSources, LABELS, searchLocal, searchWeb }
