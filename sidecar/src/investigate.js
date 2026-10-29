"use strict"
/**
 * Investigation over several documents (the old app's "Investigate" page,
 * now a chat tool: /investigate). The lawyer asks one question about many
 * documents — "what are the liability triggers?", "how can we get out?" —
 * and gets an answer across all of them, with every finding quoted.
 *
 * Two passes, on the batch machinery (batch.js, kind "investigate"), so a
 * folder or a data room runs in the background with progress, Stop and
 * Resume, and an estimate before a big cloud run:
 *
 *   per document (one by one)
 *     1. smart scan   a long document: the model picks the sections that
 *                     matter for the question from the outline (headings and
 *                     a short preview); a short one is read whole
 *     2. deep reading the picked sections: findings for the question, each
 *                     with a word-for-word quote (checked against the text;
 *                     a quote that is not there drops the finding, counted)
 *     3. law search   for high and medium findings: the law packs on this
 *                     computer, official online sources only when the
 *                     matter's data rules allow web access
 *   after the last document
 *     4. comparison   across the documents: the answer to the question, what
 *                     they share, where they conflict, gaps
 *     5. check        a second pass (the "judge") tests every statement of
 *                     the comparison against the quoted findings; one it
 *                     cannot support is removed — and listed as removed, not
 *                     silently deleted as the old page did
 *
 * What the old page did and this does not: the fake relevance score and the
 * keyword guess of a finding's type (the model now says it), the global
 * one-call-at-a-time lock. Results are kept (the old ones were lost on
 * reload): ~/.lexvault/investigations/<id>.json; exports Word, PDF, CSV.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const wf = require('./workflows')

const DIR = path.join(DATA_DIR, 'investigations')
const ID_RE = /^inv_[a-f0-9]{16}$/
const PART_RE = /^ivd_[a-f0-9]{16}$/
const QUOTE_MAX = 300
const MAX_LAW_PER_DOC = 4
const KINDS = ['risk', 'obligation', 'right', 'deadline', 'fact', 'opportunity']

/** The four questions the old page offered, in plain words (EN + DE). */
const PRESETS = {
  liability: { en: 'What can make a party liable: liability, indemnities, damages, penalties and the consequences of a breach?', de: 'Was kann eine Partei haftbar machen: Haftung, Freistellungen, Schadenersatz, Vertragsstrafen und Folgen einer Vertragsverletzung?' },
  exit: { en: 'How can each party get out: termination rights, notice periods, early-termination costs and conditions?', de: 'Wie kommt jede Partei heraus: Kündigungsrechte, Kündigungsfristen, Kosten und Bedingungen einer vorzeitigen Beendigung?' },
  obligations: { en: 'What does each party have to do: key obligations, deliverables, deadlines and compliance duties?', de: 'Was muss jede Partei tun: wesentliche Pflichten, Leistungen, Fristen und Compliance-Pflichten?' },
  advantages: { en: 'Where does our side have an advantage: favourable terms, rights, options and negotiation leverage?', de: 'Wo hat unsere Seite einen Vorteil: günstige Bedingungen, Rechte, Optionen und Verhandlungsspielraum?' },
}
const PRESET_WORDS = { liability: 'liability', haftung: 'liability', exit: 'exit', termination: 'exit', kündigung: 'exit', ausstieg: 'exit', obligations: 'obligations', pflichten: 'obligations', advantages: 'advantages', vorteile: 'advantages' }

/** "/investigate haftung" → the liability question; anything else is the lawyer's own question. */
function questionFor(text, lang = 'en') {
  const t = String(text || '').trim()
  const preset = PRESET_WORDS[t.toLowerCase()]
  if (preset) return { question: PRESETS[preset][/^de/.test(lang) ? 'de' : 'en'], preset }
  return { question: t.slice(0, 1000), preset: null }
}

const str = (v, max = 600) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '')
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
const langNameOf = (lang) => require('./workflows_docs').LANGS[lang] || 'English'

function save(dir, id, obj) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(obj)) }

// ── pass 1: one document ─────────────────────────────────────────────────
function scanPrompt(name, question, sections, langName) {
  const list = sections.map((s) => `[${s.i}] ${s.heading || '(no heading)'} — ${s.chars} chars — "${s.preview}"`).join('\n')
  return [
    { role: 'system', content: 'You help a lawyer find the parts of a long document that answer a question. Judge only from the outline given.' },
    { role: 'user', content: `QUESTION: ${question}\nDOCUMENT: ${name}\nSECTIONS (index, heading, size, start):\n${list}\n\nSelect the sections that are relevant to the question. Skip boilerplate (definitions, notices, general provisions) unless the question is about them. Reply with JSON only: {"selected": [<indexes>], "reasoning": "<one sentence in ${langName}>"}` },
  ]
}

function readPrompt(name, question, part, idx, total, langName, outline) {
  return [
    { role: 'system', content: `You investigate legal documents for a lawyer. Answer only from the document text. Never invent facts, dates, amounts or law. Copy every quote exactly, word for word. Write in ${langName}.` },
    { role: 'user', content: `QUESTION: ${question}\nDOCUMENT: ${name}${total > 1 ? ` (selected part ${idx + 1} of ${total})` : ''}${outline ? `\nOUTLINE OF THE WHOLE DOCUMENT (orientation only):\n${outline}` : ''}\n"""\n${part}\n"""\n\nFind everything in this text that answers the question. Every finding needs "quote": the exact words from the document (max ${QUOTE_MAX} characters) and "location": the clause or section number, or [Page N] if visible.\nReply with JSON only, one object:\n{"relevant": true|false, "summary": "<what this document says about the question, 2-4 sentences in ${langName}>",\n "findings": [{"title": "<short>", "kind": "risk|obligation|right|deadline|fact|opportunity", "level": "high|medium|low", "party": "<who it concerns, or empty>", "detail": "<one or two sentences: what it means for the question>", "law_query": "<search words with statutory terms in ${langName}, or empty>", "quote": "", "location": ""}]}` },
  ]
}

/**
 * Pass 1 for one document (the batch runner calls this per file).
 * → what the batch keeps per file: { resultId, relevant, findings, high, medium }
 */
async function investigateOne({ matterId = null, file, attachments, name, options = {}, signal, onProgress } = {}) {
  const read = require('./read')
  const an = require('./analysis')
  let text = ''
  let meta = null
  if (Array.isArray(attachments) && attachments.length) { const a = require('./attachments').load(attachments)[0]; text = a.text; meta = a.meta; name = a.name }
  else if (file) { const r = await read.readDocument({ file }); text = r.text; meta = r; name = name || path.basename(file) }
  text = String(text || '')
  if (!text.trim()) throw new Error(`${name}: no text found`)
  const question = str(options.question, 1000)
  if (!question) throw new Error('no question to investigate')
  const lang = an.detectLanguage(`${question}\n${text.slice(0, 4000)}`)
  const langName = langNameOf(an.detectLanguage(text))
  let jurisdiction = new (require('./doc').Document)(text.slice(0, 4000), 'investigate').jurisdiction()
  if (jurisdiction === 'US' && lang !== 'en') jurisdiction = ''
  const stats = { verified: 0, dropped: 0, lawSearches: 0, sections: null, selected: null, errors: [], web: false }

  // 1. smart scan: a long document is narrowed to the sections that matter.
  const st = require('./strategy').forModel({ tokens: read.tokensFor(text), role: 'analyze', matterId })
  let body = text
  let outline = ''
  let scan = null
  if (!(st.mode === 'full' && st.kind === 'cloud') && text.length > st.partChars) {
    const doc = new (require('./doc').Document)(text, 'investigate')
    const secs = doc.map().sections.map((s, i) => ({ i, heading: s.heading, chars: s.chars, preview: str(doc.section(s.index)?.text || '', 150) }))
    // Group the paragraph-level sections into chapters under their headings (the outline the model reads).
    const chapters = []
    for (const s of secs) {
      if (s.heading || !chapters.length) chapters.push({ i: chapters.length, heading: s.heading, chars: 0, preview: s.preview, members: [] })
      const c = chapters[chapters.length - 1]
      c.members.push(s.i)
      c.chars += s.chars
    }
    outline = chapters.filter((c) => c.heading).slice(0, 120).map((c) => c.heading).join('\n').slice(0, 4000)
    stats.sections = chapters.length
    onProgress?.({ step: 'scan', name, sections: chapters.length })
    let selected = null
    try {
      const shown = chapters.slice(0, 400)
      const o = await an.askObject(scanPrompt(name, question, shown, langName), 800, 'extract')
      const idx = (Array.isArray(o.selected) ? o.selected : Array.isArray(o.selectedSections) ? o.selectedSections : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < chapters.length)
      if (idx.length) selected = [...new Set(idx)].sort((a, b) => a - b)
      scan = { reasoning: str(o.reasoning, 400), selected: (selected || []).map((n) => chapters[n].heading || `#${n + 1}`) }
    } catch (err) {
      if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
      stats.errors.push(`scan: ${err.message}`)
    }
    if (selected) {
      body = selected.map((n) => chapters[n].members.map((m) => doc.section(doc.map().sections[m].index)?.text || '').join('\n\n')).join('\n\n')
      stats.selected = selected.length
    }
  }

  // 2. deep reading of what was selected (in parts that fit the model).
  const parts = an.splitParts(body, st.mode === 'full' && st.kind === 'cloud' ? Math.max(body.length, 1) : st.partChars)
  const raw = { summary: [], findings: [], relevant: false }
  for (const [pi, part] of parts.entries()) {
    if (signal?.aborted) break
    onProgress?.({ step: 'read', name, index: pi + 1, total: parts.length })
    try {
      const o = await an.askObject(readPrompt(name, question, part, pi, parts.length, langName, parts.length > 1 ? outline : ''), 3000, 'analyze')
      if (o.relevant === true || arr(o.findings).length) raw.relevant = true
      if (str(o.summary)) raw.summary.push(str(o.summary, 1200))
      raw.findings.push(...arr(o.findings))
    } catch (err) {
      if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
      stats.errors.push(`part ${pi + 1}: ${err.message}`)
    }
  }
  if (!raw.summary.length && !raw.findings.length && stats.errors.length) throw new Error(`${name}: the model gave no usable answer (${stats.errors[0]})`)

  // Every finding must quote the document word for word.
  const cache = {}
  const seen = new Set()
  const findings = []
  for (const it of raw.findings) {
    const title = str(it.title, 160)
    const quote = str(it.quote, QUOTE_MAX + 50)
    if (!title) continue
    if (!wf.quoteInSource(quote, text)) { stats.dropped++; continue }
    const k = `${wf.norm(title)}|${wf.norm(quote)}`
    if (seen.has(k)) continue
    seen.add(k)
    stats.verified++
    const loc = an.locate(text, quote, cache)
    const kind = KINDS.find((x) => x === str(it.kind, 20).toLowerCase()) || 'fact'
    findings.push({ title, kind, level: an.level(it.level ?? it.severity), party: str(it.party, 120), detail: str(it.detail || it.why, 500), lawQuery: str(it.law_query, 200), quote, location: { section: loc?.section || str(it.location, 80) || null, page: loc?.page || null, text: loc?.text || str(it.location, 80) }, pos: loc?.pos ?? Number.MAX_SAFE_INTEGER, sources: [] })
  }
  const rank = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => rank[a.level] - rank[b.level] || a.pos - b.pos)
  findings.forEach((f, i) => { f.id = `F${i + 1}`; delete f.pos })

  // 3. the law for what matters most.
  const targets = findings.filter((f) => f.level !== 'low' && (f.kind === 'risk' || f.lawQuery)).slice(0, MAX_LAW_PER_DOC)
  for (const f of targets) {
    if (signal?.aborted) break
    onProgress?.({ step: 'law', name: f.title })
    const r = await an.lawLookup({ query: f.lawQuery || `${f.title} ${f.detail}`.slice(0, 200), jurisdiction, language: lang, matterId })
    stats.lawSearches++
    stats.web = r.web
    f.sources = r.sources
    for (const e of r.errors) stats.errors.push(`law search: ${e}`)
  }

  const id = `ivd_${crypto.randomBytes(8).toString('hex')}`
  const result = { id, name, matterId, ...(meta?.id ? { attachmentId: meta.id } : {}), ...(file ? { path: file } : {}), pages: meta?.pages || read.pagesOf(text), language: lang, jurisdiction: jurisdiction || null, relevant: raw.relevant || findings.length > 0, summary: raw.summary.join(' ').slice(0, 2400), findings, scan, stats, readMode: parts.length > 1 ? 'parts' : 'full' }
  save(path.join(DIR, 'docs'), id, result)
  return { resultId: id, relevant: result.relevant, findings: findings.length, high: findings.filter((f) => f.level === 'high').length, medium: findings.filter((f) => f.level === 'medium').length }
}

function docResult(id) {
  if (!PART_RE.test(String(id || ''))) throw new Error('unknown document result')
  return JSON.parse(fs.readFileSync(path.join(DIR, 'docs', `${id}.json`), 'utf8'))
}

// ── pass 2: across the documents ─────────────────────────────────────────
function comparePrompt(question, docs, langName) {
  const blocks = docs.map((d, i) => `DOCUMENT ${i + 1}: ${d.name}\nSUMMARY: ${d.summary || '(nothing relevant)'}\nFINDINGS:\n${d.findings.slice(0, 25).map((f) => `- [${f.id}] ${f.level} ${f.kind}: ${f.title} — ${f.detail} (${f.location.text || 'no place'})`).join('\n') || '- none'}`).join('\n\n').slice(0, 60000)
  return [
    { role: 'system', content: `You compare findings from several legal documents for a lawyer. Use only the findings given; never add facts or law. Write in ${langName}.` },
    { role: 'user', content: `QUESTION: ${question}\n\n${blocks}\n\nAnswer the question across the documents. Refer to findings by their [id] with the document number, e.g. "1:F2".\nReply with JSON only:\n{"answer": "<the direct answer to the question, 3-6 sentences>",\n "common": [{"point": "<what the documents share>", "refs": ["1:F1", "2:F3"]}],\n "conflicts": [{"topic": "<short>", "detail": "<how the documents differ or contradict each other>", "refs": []}],\n "gaps": [{"topic": "<short>", "detail": "<what one document covers and another does not>", "refs": []}],\n "favourable": "<which document is more favourable or riskier, for whom — one or two sentences, or empty>"}` },
  ]
}

function checkPrompt(question, claims, evidence, langName) {
  return [
    { role: 'system', content: 'You double-check a comparison of legal documents for a lawyer. You are a safety net. Judge only from the quoted findings given.' },
    { role: 'user', content: `QUESTION: ${question}\nQUOTED FINDINGS (the evidence):\n${evidence}\n\nSTATEMENTS TO CHECK:\n${claims.map((c, i) => `[${i}] ${c.text}`).join('\n')}\n\nFor each statement: is it supported by the quoted findings? Statements about what a document says need a finding that says it. Reply with JSON only: [{"i": <number>, "verdict": "supported|unsupported", "note": "<short reason in ${langName}, only for unsupported>"}]. When in doubt, "supported".` },
  ]
}

/** After the last document (the batch's finish step): comparison, check, the stored investigation. */
async function finish(job, signal) {
  const an = require('./analysis')
  const docs = job.files.filter((f) => f.status === 'done' && f.resultId).map((f) => docResult(f.resultId))
  const question = str(job.options?.question, 1000)
  const lang = docs[0]?.language || an.detectLanguage(question)
  const langName = langNameOf(lang)
  const relevant = docs.filter((d) => d.relevant)
  const stats = { documents: docs.length, relevant: relevant.length, verified: docs.reduce((n, d) => n + d.stats.verified, 0), dropped: docs.reduce((n, d) => n + d.stats.dropped, 0), lawSearches: docs.reduce((n, d) => n + d.stats.lawSearches, 0), checked: 0, removed: 0, errors: [] }
  let comparison = { answer: '', common: [], conflicts: [], gaps: [], favourable: '' }
  const removed = []
  if (relevant.length) {
    try {
      const o = await an.askObject(comparePrompt(question, relevant, langName), 3000, 'analyze')
      const refs = (r) => (Array.isArray(r) ? r.map((x) => str(x, 20)).filter((x) => /^\d+:F\d+$/.test(x)) : [])
      const docName = (ref) => relevant[Number(ref.split(':')[0]) - 1]?.name
      const withDocs = (x) => { const rs = refs(x.refs); return { refs: rs, documents: [...new Set(rs.map(docName).filter(Boolean))] } }
      comparison = {
        answer: str(o.answer, 3000),
        common: arr(o.common).map((x) => ({ point: str(x.point || x.detail, 500), ...withDocs(x) })).filter((x) => x.point),
        conflicts: arr(o.conflicts).map((x) => ({ topic: str(x.topic, 160), detail: str(x.detail, 600), ...withDocs(x) })).filter((x) => x.topic || x.detail),
        gaps: arr(o.gaps).map((x) => ({ topic: str(x.topic, 160), detail: str(x.detail, 600), ...withDocs(x) })).filter((x) => x.topic || x.detail),
        favourable: str(o.favourable, 800),
      }
    } catch (err) {
      if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) throw err
      stats.errors.push(`comparison: ${err.message}`)
      comparison.answer = relevant.map((d) => `${d.name}: ${d.summary}`).join('\n')
    }
    // 5. the check: every statement of the comparison against the quoted findings.
    const claims = [
      ...comparison.common.map((x, i) => ({ list: 'common', i, text: x.point })),
      ...comparison.conflicts.map((x, i) => ({ list: 'conflicts', i, text: `${x.topic}: ${x.detail}` })),
      ...comparison.gaps.map((x, i) => ({ list: 'gaps', i, text: `${x.topic}: ${x.detail}` })),
    ]
    if (claims.length && !signal?.aborted) {
      const evidence = relevant.map((d, di) => d.findings.slice(0, 25).map((f) => `${di + 1}:${f.id} (${d.name}) ${f.title}: "${f.quote}"`).join('\n')).join('\n').slice(0, 40000)
      try {
        const items = await wf.askJson(checkPrompt(question, claims, evidence, langName), 1500, 'judge')
        const drop = new Set()
        for (const it of Array.isArray(items) ? items : []) {
          const c = claims[Number(it?.i)]
          if (!c) continue
          stats.checked++
          if (/^unsupp|^no|^drop/i.test(str(it.verdict, 20))) { drop.add(`${c.list}:${c.i}`); removed.push({ text: c.text, note: str(it.note, 300) }) }
        }
        for (const list of ['common', 'conflicts', 'gaps']) comparison[list] = comparison[list].filter((_, i) => !drop.has(`${list}:${i}`))
        stats.removed = removed.length
      } catch (err) { stats.errors.push(`check: ${err.message}`) }
    }
  }
  const id = `inv_${crypto.randomBytes(8).toString('hex')}`
  const inv = {
    kind: 'investigation', id, createdAt: new Date().toISOString(), matterId: job.matterId || null, batchId: job.id,
    question, preset: job.options?.preset || null, language: lang,
    documents: docs.map((d) => ({ name: d.name, attachmentId: d.attachmentId || null, pages: d.pages, relevant: d.relevant, summary: d.summary, findings: d.findings, scan: d.scan, readMode: d.readMode, stats: d.stats })),
    skipped: job.files.filter((f) => f.status !== 'done').map((f) => ({ name: f.name, status: f.status, note: f.note || '' })),
    comparison, removed, stats,
  }
  save(DIR, id, inv)
  return { kind: 'investigation', id }
}

function get(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('unknown investigation')
  return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'))
}

// ── report ───────────────────────────────────────────────────────────────
const W = {
  en: { title: 'Investigation', question: 'Question', answer: 'Answer', across: 'Across the documents', common: 'What the documents share', conflicts: 'Where they differ', gaps: 'Gaps', favourable: 'More favourable or riskier', doc: 'Document', notRelevant: 'Nothing in this document answers the question.', findings: 'Findings', checks: 'How this was checked', kind: 'Kind', level: 'Level', finding: 'Finding', detail: 'What it means', where: 'Where', quote: 'Quote', law: 'Law', removed: 'Removed by the check (not supported by the quotes)', note: 'Every finding quotes its document word for word; findings whose quote was not found were removed. The comparison was checked against the quotes. Written by AI — check before relying on it.', skipped: 'Not read' },
  de: { title: 'Untersuchung', question: 'Frage', answer: 'Antwort', across: 'Über alle Dokumente', common: 'Was die Dokumente gemeinsam haben', conflicts: 'Wo sie sich unterscheiden', gaps: 'Lücken', favourable: 'Günstiger oder riskanter', doc: 'Dokument', notRelevant: 'Dieses Dokument enthält nichts zur Frage.', findings: 'Feststellungen', checks: 'Wie geprüft wurde', kind: 'Art', level: 'Stufe', finding: 'Feststellung', detail: 'Bedeutung', where: 'Fundstelle', quote: 'Zitat', law: 'Rechtsgrundlage', removed: 'Bei der Prüfung entfernt (durch die Zitate nicht belegt)', note: 'Jede Feststellung zitiert ihr Dokument wörtlich; Feststellungen ohne auffindbares Zitat wurden entfernt. Der Vergleich wurde an den Zitaten geprüft. Von der KI erstellt — bitte vor Verwendung prüfen.', skipped: 'Nicht gelesen' },
}

function reportOf(inv) {
  const L = W[inv.language === 'de' ? 'de' : 'en']
  const c = inv.comparison
  const st = inv.stats
  const sections = [
    { title: L.answer, text: [`**${L.question}:** ${inv.question}`, c.answer || '—', ...(c.favourable ? [`**${L.favourable}:** ${c.favourable}`] : [])] },
  ]
  if (c.common.length || c.conflicts.length || c.gaps.length) {
    sections.push({ title: L.across, text: [
      ...(c.common.length ? [`#### ${L.common}`, c.common.map((x) => `- ${x.point}${x.documents.length ? ` (${x.documents.join(', ')})` : ''}`).join('\n')] : []),
      ...(c.conflicts.length ? [`#### ${L.conflicts}`, c.conflicts.map((x) => `- **${x.topic}:** ${x.detail}${x.documents.length ? ` (${x.documents.join(', ')})` : ''}`).join('\n')] : []),
      ...(c.gaps.length ? [`#### ${L.gaps}`, c.gaps.map((x) => `- **${x.topic}:** ${x.detail}${x.documents.length ? ` (${x.documents.join(', ')})` : ''}`).join('\n')] : []),
    ] })
  }
  for (const d of inv.documents) {
    sections.push({
      title: `${L.doc}: ${d.name}`,
      text: d.relevant ? [d.summary] : [L.notRelevant],
      ...(d.findings.length ? { table: [[L.finding, L.detail, L.where, L.quote, L.law], ...d.findings.map((f) => [`${f.level.toUpperCase()} · ${f.title}`, f.detail, f.location.text || '', `"${f.quote}"`, f.sources.map((s) => [s.title, s.section].filter(Boolean).join(' ')).join('; ')])] } : {}),
    })
  }
  sections.push({ title: L.checks, text: [
    `- ${st.documents} documents, ${st.relevant} with something on the question.`,
    `- ${st.verified} findings checked word for word against their document; ${st.dropped} removed (quote not found).`,
    `- ${st.lawSearches} law searches.`,
    `- ${st.checked} statements of the comparison checked; ${st.removed} removed.`,
    ...inv.removed.map((r) => `- ${L.removed}: ${r.text}${r.note ? ` — ${r.note}` : ''}`),
    ...inv.skipped.map((s) => `- ${L.skipped}: ${s.name}${s.note ? ` — ${s.note}` : ''}`),
  ].join('\n') })
  const csv = [[L.doc, L.kind, L.level, L.finding, L.detail, L.where, L.quote, L.law]]
  for (const d of inv.documents) for (const f of d.findings) csv.push([d.name, f.kind, f.level, f.title, f.detail, f.location.text || '', f.quote, f.sources.map((s) => [s.title, s.section].filter(Boolean).join(' ')).join('; ')])
  return { title: `${L.title}: ${inv.question.slice(0, 100)}`, subtitle: `${inv.createdAt.slice(0, 10)} · ${st.documents} documents`, note: L.note, sections, csv }
}

function exportInvestigation(id, format) {
  const inv = get(id)
  return require('./report').save({ report: reportOf(inv), format, matterId: inv.matterId, base: `investigation-${inv.question.slice(0, 40)}` })
}

/** A few plain lines (terminal, notification, the conversation's text). */
function brief(inv) {
  const lines = [`Investigation: ${inv.question}`, inv.comparison.answer || '(nothing found)']
  for (const x of inv.comparison.conflicts.slice(0, 3)) lines.push(`- differs: ${x.topic}${x.detail ? ` — ${x.detail}` : ''}`)
  lines.push(`${inv.stats.documents} documents · ${inv.stats.verified} quoted findings · ${inv.stats.removed} statements removed by the check`)
  return lines.join('\n')
}

require('./batch').registerKind('investigate', {
  perDoc: [3000, 2000],
  // The question: the lawyer's own, or a preset word ("/investigate liability").
  prepare(job) {
    const o = job.options || {}
    const asked = questionFor(o.question || job.focus || '', o.lang || 'en')
    if (!asked.question) throw new Error('Ask a question to investigate (for example: /investigate which clauses limit our liability?) — or use a preset: liability, exit, obligations, advantages.')
    job.options = { ...o, question: asked.question, preset: o.preset || asked.preset }
  },
  extra: [8000, 2500],
  one: (o) => investigateOne(o),
  finish,
})

/** The local API: GET /api/investigation?id=, POST /api/investigation/export, GET /api/investigate/presets. */
function handle(method, p, params, body = {}) {
  const q = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  try {
    if (method === 'GET' && p === '/api/investigation') return { status: 200, json: { investigation: get(q('id')) } }
    if (method === 'GET' && p === '/api/investigate/presets') return { status: 200, json: { presets: Object.entries(PRESETS).map(([id, t]) => ({ id, ...t })) } }
    if (method === 'POST' && p === '/api/investigation/export') return { status: 200, json: exportInvestigation(body.id, body.format) }
    return null
  } catch (err) { return { status: 400, json: { error: err.message } } }
}

module.exports = { investigateOne, finish, get, docResult, exportInvestigation, reportOf, brief, questionFor, handle, PRESETS, DIR }
