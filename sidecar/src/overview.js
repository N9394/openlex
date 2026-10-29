"use strict"
/**
 * Matter overview and recall — everything OpenLex already stores about a
 * matter, brought back as plain, readable cards:
 *
 *   Summary · Documents · Key findings and risks · Deadlines (next first) ·
 *   Decisions and approvals · Open questions · Notes · Sources used ·
 *   Recent activity
 *
 * Built only from what is on disk — no model call:
 *   matters.json (the matter), the matter's folders and linked Word
 *   documents, analysis-*.json (analyse workflow), the latest review and
 *   chronology CSVs, lists (checklists, deadlines), plans (approvals,
 *   checkpoint decisions), grids, notes (the agent's "remember" facts and
 *   the matter folder's notes.md), conversations, saved web pages and
 *   downloads (provenance files), and the usage log (metadata only — it
 *   never holds content).
 *
 * Every item says where it came from (which run, document, quote) and when.
 *
 *   overview(id)              → { matter, cards: [{ id, title, items, more, empty }] }
 *   recall(id, q)             → keyword + recency search over the same items
 *   exportMemo(id, format)    → "Matter memo" (.docx | .pdf | .md) in the matter folder
 *   handle(method, path, …)   → the local API routes (server.js)
 *
 * The optional recall summary is the only model call here: on request,
 * over the hits only, under the matter's data rules (llm.js enforces them).
 */

const fs = require('fs')
const path = require('path')
const wf = require('./workflows')

const CARDS = [
  { id: 'summary', title: 'Summary', empty: 'Nothing recorded yet.' },
  { id: 'documents', title: 'Documents', empty: 'No documents yet. Add a folder to the matter or link a Word document.' },
  { id: 'findings', title: 'Key findings and risks', empty: 'No findings yet. Analyse a document or run a review.' },
  { id: 'deadlines', title: 'Deadlines', empty: 'No upcoming deadlines found.' },
  { id: 'decisions', title: 'Decisions and approvals', empty: 'No decisions recorded yet.' },
  { id: 'questions', title: 'Open questions', empty: 'No open questions.' },
  { id: 'notes', title: 'Notes', empty: 'No notes yet.' },
  { id: 'sources', title: 'Sources used', empty: 'No law or web sources recorded yet.' },
  { id: 'activity', title: 'Recent activity', empty: 'No activity yet.' },
]
const CARD_TITLE = Object.fromEntries(CARDS.map((c) => [c.id, c.title]))
CARD_TITLE.details = 'Details from the documents'
CARD_TITLE.conversation = 'Conversations'
const LIMITS = { summary: 20, documents: 25, findings: 12, deadlines: 12, decisions: 10, questions: 10, notes: 12, sources: 12, activity: 15 }
const DOC_EXTS = new Set(['.docx', '.pdf', '.txt', '.md', '.eml', '.msg', '.xlsx', '.doc', '.rtf'])
const OUTPUT_RE = /^(analysis-|review-|chronology-|compare-|plan-|grid-|matter-memo-)|\.(check\.md|review\.docx)$/i
const RANK = { high: 0, medium: 1, low: 2 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-29" / ISO → "29 Oct 2026" (fixed English, independent of the machine's locale). */
function day(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/)
  if (!m) return ''
  return `${m[3] ? `${+m[3]} ` : ''}${MONTHS[+m[2] - 1] || m[2]} ${m[1]}`
}
const one = (s, n = 400) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const mtime = (p) => { try { return fs.statSync(p).mtime.toISOString() } catch { return null } }

function matterOrThrow(id) {
  const m = id ? require('./matters').get(id) : null
  if (!m) throw new Error(id ? `unknown matter: ${id}` : 'which matter? pass its id')
  return m
}

/** The matter's workspace folder (absolute), and its files one level deep. */
function folderOf(matterId) {
  const ws = require('./workspace')
  try { return ws.resolve(ws.matterFolder(wf.matterLabel(matterId))) } catch { return null }
}
function filesIn(dir, depth = 1) {
  const out = []
  const walk = (d, level) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (level < depth) walk(p, level + 1) } else out.push({ name: e.name, path: p, at: mtime(p) })
    }
  }
  if (dir) walk(dir, 0)
  return out
}
const latest = (files, re) => files.filter((f) => re.test(f.name)).sort((a, b) => b.name.localeCompare(a.name) || String(b.at).localeCompare(String(a.at)))[0] || null

// Sessions and notes are kept per document id: the linked Word documents
// plus the terminal app's conversation for this matter.
function docIds(m) {
  return [...(m.docs || []).map((d) => ({ docId: d.docId, title: d.title || 'Word document' })), { docId: `tui:${m.id}`, title: 'the terminal app' }]
}

// ── collecting items ─────────────────────────────────────────────────────
/**
 * Every item OpenLex has stored for the matter.
 * item = { card, title, detail?, quote?, location?, level?, date?, status?, at, from: { kind, label, file?, document? }, overview }
 * overview=false items are found by recall but not shown on the cards.
 */
function collect(id, { now = new Date() } = {}) {
  const m = matterOrThrow(id)
  const today = now.toISOString().slice(0, 10)
  const items = []
  const add = (it) => items.push({ overview: true, ...it })
  const folder = folderOf(id)
  const files = filesIn(folder)
  const policyRule = m.policy || { mode: 'local-only' }

  // ── the matter itself ──
  const matterFrom = { kind: 'matter', label: 'Matter details' }
  add({ card: 'summary', title: `${m.number ? `${m.number} · ` : ''}${m.title}${m.client ? ` — client: ${m.client}` : ''}`, detail: `Status: ${m.status || 'open'} · opened ${day(m.createdAt)}`, at: m.updatedAt || m.createdAt, from: matterFrom })
  add({
    card: 'summary',
    title: m.privileged ? 'Privileged: nothing from this matter leaves this computer.'
      : policyRule.mode === 'local-only' ? 'Data rules: stays on this computer (local AI only, no web).'
        : `Data rules: may use ${(policyRule.providers || []).filter((p) => p !== 'web').join(', ') || 'local AI only'}${(policyRule.providers || []).includes('web') ? '; web access allowed' : '; no web access'}.`,
    at: m.updatedAt || m.createdAt,
    from: { kind: 'matter', label: 'Data rules' },
  })

  // ── documents ──
  const seenDocs = new Set()
  for (const f of wf.listDocs(wf.matterFolders(id))) {
    seenDocs.add(path.basename(f).toLowerCase())
    add({ card: 'documents', title: path.basename(f), detail: path.dirname(f), at: mtime(f), from: { kind: 'folder', label: 'Matter folder', file: f } })
  }
  for (const d of m.docs || []) add({ card: 'documents', title: d.title || 'Word document', detail: 'Linked Word document', at: d.boundAt, from: { kind: 'word', label: 'Linked in Word', document: d.title } })
  for (const f of files) {
    if (!DOC_EXTS.has(path.extname(f.name).toLowerCase()) || OUTPUT_RE.test(f.name) || f.name.toLowerCase() === 'notes.md' || seenDocs.has(f.name.toLowerCase())) continue
    seenDocs.add(f.name.toLowerCase())
    add({ card: 'documents', title: f.name, detail: path.relative(folder, path.dirname(f.path)) ? `In the matter's workspace folder (${path.relative(folder, path.dirname(f.path))})` : "In the matter's workspace folder", at: f.at, from: { kind: 'file', label: 'Workspace folder', file: f.path } })
  }

  // ── analyses ──
  for (const f of files.filter((x) => /^analysis-.*\.json$/i.test(x.name))) {
    const a = readJson(f.path)
    if (!a || a.kind !== 'analysis' || !a.document) continue
    const doc = a.document.name
    const from = { kind: 'analysis', label: `Analysis of ${doc}`, file: f.path.replace(/\.json$/i, '.md'), document: doc }
    const at = a.createdAt || f.at
    if (!seenDocs.has(String(doc).toLowerCase())) { seenDocs.add(String(doc).toLowerCase()); add({ card: 'documents', title: doc, detail: 'Analysed', at, from }) }
    const s = a.summary || {}
    if (s.what || s.purpose) add({ card: 'summary', title: `${doc}: ${one(s.what || s.purpose, 300)}`, detail: [s.what && s.purpose ? one(s.purpose, 300) : '', (s.parties || []).length ? `Parties: ${s.parties.map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('; ')}` : ''].filter(Boolean).join(' · '), at, from })
    for (const r of a.risks || []) {
      add({ card: 'findings', title: r.title, level: r.level, detail: [r.why, r.fix ? `Suggested fix: ${r.fix}` : ''].filter(Boolean).join(' · '), quote: r.quote, location: r.location?.text, at, from })
      if (r.fixCheck === 'removed') add({ card: 'questions', title: `How to handle: ${r.title}?`, detail: 'The suggested fix did not pass the second check — decide how to handle this risk.', quote: r.quote, location: r.location?.text, at, from })
      for (const src of r.sources || []) add({ card: 'sources', title: `${src.title}${src.section ? ` ${src.section}` : ''}`, detail: [src.snippet, src.url].filter(Boolean).join(' · ') || `Found for: ${r.title}`, at, from: { ...from, label: `${from.label} — for "${one(r.title, 60)}"` } })
    }
    for (const d of a.deadlines || []) add({ card: 'deadlines', title: d.what, date: d.date || null, detail: d.date ? '' : `Period: ${d.when}`, level: d.importance, quote: d.quote, location: d.location?.text, at, from })
    for (const o of a.obligations || []) add({ card: 'details', title: `${o.party}: ${o.duty}`, quote: o.quote, location: o.location?.text, at, from, overview: false })
    for (const t of a.keyTerms || []) add({ card: 'details', title: `${t.term}: ${t.value || one(t.quote, 120)}`, quote: t.quote, location: t.location?.text, at, from, overview: false })
    for (const c of a.clauses || []) {
      if (c.kind === 'missing') add({ card: 'questions', title: `Is there really no ${c.title} clause?`, detail: c.note || 'The analysis did not find it in the text — please check.', at, from })
      else add({ card: 'details', title: c.title, detail: c.note, quote: c.quote, location: c.location?.text, at, from, overview: false })
    }
    add({ card: 'activity', title: `Analysed ${doc}`, detail: `${(a.risks || []).length} risks, ${(a.deadlines || []).length} dates`, at, from })
  }

  // ── latest review and chronology ──
  const { parseCsv } = require('./lists')
  const review = latest(files, /^review-\d{4}-\d{2}-\d{2}\.csv$/)
  if (review) {
    const from = { kind: 'review', label: 'Matter review', file: review.path.replace(/\.csv$/, '.md') }
    const rows = parseCsv(fs.readFileSync(review.path, 'utf8')).slice(1)
    for (const [document, check, risk, answer, quote, location] of rows) {
      if (!answer) continue
      add({ card: 'findings', title: `${document}: ${answer}`, level: RANK[risk] !== undefined ? risk : 'medium', detail: check ? `Checklist: ${check.replace(/_/g, ' ')}` : '', quote, location, at: review.at, from: { ...from, document }, overview: risk !== 'low' })
    }
    add({ card: 'activity', title: 'Matter review', detail: `${rows.length} findings`, at: review.at, from })
  }
  const chrono = latest(files, /^chronology-\d{4}-\d{2}-\d{2}\.csv$/)
  if (chrono) {
    const from = { kind: 'chronology', label: 'Chronology', file: chrono.path.replace(/\.csv$/, '.md') }
    const rows = parseCsv(fs.readFileSync(chrono.path, 'utf8')).slice(1)
    for (const [d, event, document, quote] of rows) {
      if (!event) continue
      add({ card: 'deadlines', title: event, date: d || null, quote, at: chrono.at, from: { ...from, document } })
    }
    add({ card: 'activity', title: 'Chronology', detail: `${rows.length} dated events`, at: chrono.at, from })
  }

  // ── lists (checklists, trackers) ──
  const lists = require('./lists')
  for (const summary of lists.all(id)) {
    let list
    try { list = lists.get(summary.id) } catch { continue }
    const from = { kind: 'list', label: `Checklist "${list.title}"` }
    for (const it of list.items) {
      const open = it.status === 'open' || it.status === 'blocked'
      const changed = [...list.audit].reverse().find((x) => x.item === it.id)
      const base = { title: it.text, detail: [it.owner ? `Owner: ${it.owner}` : '', it.note].filter(Boolean).join(' · '), quote: it.source?.quote, location: it.source?.location, status: it.status, at: changed?.at || list.updatedAt, from: { ...from, document: it.source?.document } }
      if (it.due && open) add({ ...base, card: 'deadlines', date: it.due, overdue: it.due < today })
      if (it.status === 'blocked') add({ ...base, card: 'questions', detail: ['Blocked', base.detail].filter(Boolean).join(' · ') })
      if (!it.due && it.status === 'open') add({ ...base, card: 'details', overview: false })
    }
    for (const e of list.audit) {
      if (e.action === 'change' && e.field === 'status' && e.to === 'done') {
        const it = list.items.find((x) => x.id === e.item)
        add({ card: 'decisions', title: `Done: ${it?.text || 'a checklist item'}`, detail: e.by ? `Marked done by ${e.by}` : '', at: e.at, from })
      }
    }
    add({ card: 'activity', title: `Checklist "${list.title}" updated`, detail: `${summary.open} open of ${summary.items}`, at: list.updatedAt, from })
  }

  // ── plans: approvals, checkpoint decisions, waiting questions ──
  const plans = require('./plan')
  for (const p of plans.list(id)) {
    let plan
    try { plan = plans.get(p.id) } catch { continue }
    const from = { kind: 'plan', label: `Plan "${one(plan.goal, 80)}"`, file: plan.report || undefined }
    if (plan.approvedAt) add({ card: 'decisions', title: `Plan approved: ${one(plan.goal, 200)}`, detail: `${plan.steps.length} steps`, at: plan.approvedAt, from })
    for (const s of plan.steps || []) {
      if (s.decision) add({ card: 'decisions', title: `${s.decision.decision === 'stop' ? 'Stopped' : 'Continued'} at: ${one(s.args?.question || s.title, 200)}`, detail: s.decision.note || '', at: s.decision.at, from })
      if (s.status === 'waiting') add({ card: 'questions', title: one(s.args?.question || s.title, 300), detail: 'Waiting for your decision before the plan continues.', at: plan.updatedAt, from })
      if (s.result?.summary && !s.decision) add({ card: 'details', title: `${s.title}: ${one(s.result.summary, 300)}`, at: plan.updatedAt, from, overview: false })
    }
    add({ card: 'activity', title: `Plan ${plan.status}: ${one(plan.goal, 120)}`, at: plan.updatedAt, from })
  }

  // ── grids: answers stay searchable ──
  const grid = require('./grid')
  for (const g of grid.list(id)) {
    let full
    try { full = grid.get(g.id) } catch { continue }
    const from = { kind: 'grid', label: `Grid "${full.title}"` }
    for (const [k, cell] of Object.entries(full.cells || {})) {
      if (!cell || !['ok', 'edited'].includes(cell.status) || !cell.value) continue
      const cut = k.lastIndexOf('::')
      const doc = k.slice(0, cut)
      const colId = k.slice(cut + 2)
      const col = full.columns.find((c) => c.id === colId)
      add({ card: 'details', title: `${path.basename(doc)} — ${col?.label || colId}: ${one(cell.value, 200)}`, quote: cell.quote, location: cell.location, at: cell.at || full.updatedAt, from: { ...from, document: path.basename(doc) }, overview: false })
    }
    add({ card: 'activity', title: `Grid "${full.title}" updated`, detail: `${full.documents.length} documents × ${full.columns.length} questions`, at: full.updatedAt, from })
  }

  // ── notes and conversations ──
  const memory = require('./memory')
  const { Session } = require('./session')
  for (const { docId, title } of docIds(m)) {
    for (const f of memory.factsFor(docId)) {
      add({ card: 'notes', title: `${f.entity ? `${f.entity}: ` : ''}${one(f.claim, 300)}`, location: f.section ? `§ ${f.section}` : '', at: f.at, from: { kind: 'note', label: `Noted while working on ${title}`, document: title } })
    }
    const s = new Session(docId)
    const turns = s.load()
    if (!turns.length) continue
    const at = mtime(s.path)
    const from = { kind: 'conversation', label: `Conversation in ${title}`, document: title }
    for (let i = 0; i < turns.length; i += 2) {
      const q = turns[i]
      const ans = turns[i + 1]
      if (q?.role !== 'user') continue
      add({ card: 'conversation', title: `Asked: ${one(q.content, 200)}`, detail: ans ? one(ans.content, 400) : '', at, from, overview: false })
    }
    const last = [...turns].reverse().find((t) => t.role === 'user')
    if (last) add({ card: 'activity', title: `Asked: ${one(last.content, 120)}`, at, from })
  }
  const notesFile = files.find((f) => f.name.toLowerCase() === 'notes.md')
  if (notesFile) {
    const from = { kind: 'note', label: 'notes.md in the matter folder', file: notesFile.path }
    // One note per bullet line ("- …", "* …", "1. …").
    for (const line of fs.readFileSync(notesFile.path, 'utf8').split('\n')) {
      const b = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.+)$/)
      if (b && b[1].trim()) add({ card: 'notes', title: one(b[1], 300), at: notesFile.at, from })
    }
  }

  // ── web pages saved and files downloaded (provenance records) ──
  for (const f of filesIn(folder, 2).filter((x) => x.name === 'provenance.json' || x.name.endsWith('.provenance.json'))) {
    const p = readJson(f.path)
    if (!p) continue
    add({ card: 'sources', title: p.title || p.file || p.finalUrl || p.url, detail: [p.finalUrl || p.url, p.sha256 && typeof p.sha256 === 'string' ? `sha256 ${p.sha256.slice(0, 12)}…` : ''].filter(Boolean).join(' · '), at: p.fetchedAt || f.at, from: { kind: 'web', label: p.file ? 'Downloaded into the matter' : 'Web page saved into the matter', file: f.path } })
  }

  // ── other outputs in the matter folder (activity) ──
  for (const f of files) {
    if (!/^(compare-.*\.md|.*\.check\.md|plan-[^-]+\.md|matter-memo-.*)$/i.test(f.name)) continue
    const what = f.name.startsWith('compare-') ? 'Compared two versions' : f.name.endsWith('.check.md') ? 'Translated a document' : f.name.startsWith('matter-memo-') ? 'Matter memo exported' : 'Plan report written'
    add({ card: 'activity', title: what, detail: f.name, at: f.at, from: { kind: 'file', label: 'Workspace folder', file: f.path } })
  }

  // ── the usage log (metadata only: provider, decision — never content) ──
  for (const e of auditFor(id)) add({ card: 'activity', title: e.title, detail: e.detail, at: e.at, from: { kind: 'audit', label: 'Usage log (records no content)' } })

  return { matter: m, items, today }
}

/** The usage log for one matter, grouped per day, provider and decision. */
function auditFor(matterId) {
  const { AUDIT_PATH } = require('./policy')
  let raw = ''
  try {
    const size = fs.statSync(AUDIT_PATH).size
    const fd = fs.openSync(AUDIT_PATH, 'r')
    const len = Math.min(size, 2 * 1024 * 1024)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
    raw = buf.toString('utf8')
  } catch { return [] }
  const groups = new Map()
  for (const line of raw.split('\n')) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (!e || e.matter !== matterId) continue
    const d = String(e.ts || '').slice(0, 10)
    const who = e.provider === 'web' ? `web (${e.model || 'site'})` : e.provider === 'local' ? 'the local AI' : e.provider
    const k = `${d}|${who}|${e.decision}`
    const g = groups.get(k) || { d, who, decision: e.decision, n: 0, at: e.ts }
    g.n++
    if (String(e.ts) > String(g.at)) g.at = e.ts
    groups.set(k, g)
  }
  return [...groups.values()].map((g) => ({
    title: g.decision === 'blocked' ? `Blocked by the data rules: ${g.n} request${g.n === 1 ? '' : 's'} to ${g.who}` : `${g.n} request${g.n === 1 ? '' : 's'} to ${g.who}`,
    detail: day(g.d),
    at: g.at,
  }))
}

// ── the overview ─────────────────────────────────────────────────────────
function sortCard(id, items, today) {
  const byAt = (a, b) => String(b.at || '').localeCompare(String(a.at || ''))
  if (id === 'findings') return items.sort((a, b) => (RANK[a.level] ?? 3) - (RANK[b.level] ?? 3) || byAt(a, b))
  if (id === 'documents') return items.sort((a, b) => a.title.localeCompare(b.title))
  if (id === 'summary') return items
  if (id === 'deadlines') {
    // Next first: overdue open items, then upcoming dates, then periods without a date.
    const group = (x) => (x.overdue ? 0 : x.date ? 1 : 2)
    return items
      .filter((x) => x.overdue || !x.date || x.date >= today)
      .sort((a, b) => group(a) - group(b) || String(a.date || '').localeCompare(String(b.date || '')) || (RANK[a.level] ?? 3) - (RANK[b.level] ?? 3))
  }
  return items.sort(byAt)
}

/** Readable cards for one matter. */
function overview(id, { now = new Date() } = {}) {
  const { matter, items, today } = collect(id, { now })
  const cards = CARDS.map((c) => {
    let list = sortCard(c.id, items.filter((x) => x.overview && x.card === c.id), today)
    if (c.id === 'sources') {
      const seen = new Set()
      list = list.filter((x) => { const k = `${x.title}|${x.detail}`; if (seen.has(k)) return false; seen.add(k); return true })
    }
    const max = LIMITS[c.id]
    return { id: c.id, title: c.title, items: list.slice(0, max).map(clean), more: Math.max(0, list.length - max), empty: c.empty }
  })
  return {
    matter: { id: matter.id, title: matter.title, number: matter.number || '', client: matter.client || '', status: matter.status, privileged: !!matter.privileged },
    generatedAt: now.toISOString(),
    cards,
  }
}

function clean(x) {
  const out = { title: x.title }
  for (const k of ['detail', 'quote', 'location', 'level', 'date', 'status']) if (x[k]) out[k] = k === 'quote' ? one(x[k], 400) : x[k]
  if (x.overdue) out.overdue = true
  out.at = x.at || null
  out.from = Object.fromEntries(Object.entries(x.from || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  return out
}

// ── recall ───────────────────────────────────────────────────────────────
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
const STOP = new Set('the a an and or of to for in on with is are be was what which who when where how do does did we our my me any about der die das und oder ein eine ist sind wie was wer wann wo zu von mit fur im am'.split(' '))

/**
 * Keyword + recency search over everything stored for the matter.
 * Score: each query word found in the title (3), the detail (2), the quote
 * or location (1), the origin (1); +2 when every word is found; +3 for the
 * exact phrase; then a recency bonus that halves about every three weeks.
 */
function recall(id, q, { limit = 15, now = new Date() } = {}) {
  const query = String(q || '').trim()
  if (!query) throw new Error('what should OpenLex look for? (q)')
  const { matter, items } = collect(id, { now })
  const words = [...new Set(fold(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)))]
  const phrase = fold(query).replace(/\s+/g, ' ')
  const hits = []
  for (const it of items) {
    if (it.card === 'activity' && it.from?.kind === 'audit') continue
    const f = { title: fold(it.title), detail: fold(it.detail), quote: fold(`${it.quote || ''} ${it.location || ''} ${it.date || ''}`), from: fold(`${it.from?.label || ''} ${it.from?.document || ''}`) }
    let score = 0
    let found = 0
    for (const w of words) {
      const s = (f.title.includes(w) ? 3 : 0) + (f.detail.includes(w) ? 2 : 0) + (f.quote.includes(w) ? 1 : 0) + (f.from.includes(w) ? 1 : 0)
      if (s) found++
      score += s
    }
    if (!score) continue
    if (words.length > 1 && found === words.length) score += 2
    if (phrase.length > 3 && `${f.title} ${f.detail} ${f.quote}`.includes(phrase)) score += 3
    const ageDays = it.at ? Math.max(0, (now - new Date(it.at)) / 86400000) : 365
    score += 1.5 * Math.pow(0.5, ageDays / 21)
    hits.push({ ...clean(it), card: it.card, cardTitle: CARD_TITLE[it.card] || it.card, score: Math.round(score * 100) / 100 })
  }
  hits.sort((a, b) => b.score - a.score || String(b.at || '').localeCompare(String(a.at || '')) || a.title.localeCompare(b.title))
  return { matter: { id: matter.id, title: matter.title }, query, total: hits.length, hits: hits.slice(0, limit) }
}

/** Optional: a short answer written from the hits only, under the matter's data rules. */
async function summarizeHits(id, r) {
  if (!r.hits.length) return { summary: '', summaryNote: 'Nothing found to summarise.' }
  const { chat } = require('./llm')
  const notes = r.hits.map((h, i) => `[${i + 1}] ${h.cardTitle}: ${h.title}${h.detail ? ` — ${h.detail}` : ''}${h.quote ? ` — "${h.quote}"` : ''}${h.location ? ` (${h.location})` : ''} — from ${h.from.label || h.from.kind}${h.at ? `, ${day(h.at)}` : ''}`)
  const text = await require('./policy').withMatter(id, () => chat([
    { role: 'system', content: 'You help a lawyer recall what is already known about a matter. Use only the numbered notes given. Cite the [number] of every note you use. If the notes do not answer the question, say so plainly. Never add facts or law that are not in the notes.' },
    { role: 'user', content: `QUESTION: ${r.query}\n\nNOTES:\n${notes.join('\n')}\n\nAnswer in two to five plain sentences, in the language of the question.` },
  ], { maxTokens: 500, temperature: 0, role: 'summarize' }))
  return { summary: String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), summaryNote: `Written by AI from the ${r.hits.length} results below only.` }
}

// ── rendering ────────────────────────────────────────────────────────────
function itemLines(x, { quoteMax = 200 } = {}) {
  const head = `${x.overdue ? '[overdue] ' : ''}${x.level ? `[${x.level}] ` : ''}${x.date ? `${day(x.date)} — ` : ''}${x.title}${x.location ? ` (${x.location})` : ''}`
  const lines = [head]
  if (x.detail) lines.push(x.detail)
  if (x.quote) lines.push(`"${one(x.quote, quoteMax)}"`)
  lines.push(`from ${x.from?.label || x.from?.kind || 'OpenLex'}${x.at ? ` · ${day(x.at)}` : ''}`)
  return lines
}

function matterLine(m) {
  return `${m.number ? `${m.number} · ` : ''}${m.title}${m.client ? ` — client: ${m.client}` : ''}`
}

/** Plain text for a terminal. */
function toText(ov) {
  const out = [matterLine(ov.matter), `Matter overview · ${day(ov.generatedAt)}`, '']
  for (const c of ov.cards) {
    out.push(c.title.toUpperCase())
    if (!c.items.length) out.push(`  ${c.empty}`)
    for (const x of c.items) {
      const [head, ...rest] = itemLines(x)
      out.push(`  • ${head}`, ...rest.map((l) => `      ${l}`))
    }
    if (c.more) out.push(`  … and ${c.more} more (search them with recall)`)
    out.push('')
  }
  return out.join('\n')
}

function toMarkdown(ov) {
  const out = [`# Matter memo — ${matterLine(ov.matter)}`, '', `Matter overview · ${day(ov.generatedAt)} · every item names where it came from.`, '']
  for (const c of ov.cards) {
    out.push(`## ${c.title}`, '')
    if (!c.items.length) out.push(c.empty)
    for (const x of c.items) {
      const [head, ...rest] = itemLines(x)
      out.push(`- **${head}**`)
      for (const l of rest) out.push(l.startsWith('"') ? `  > ${l.slice(1, -1)}` : `  ${l.startsWith('from ') ? `*${l}*` : l}`)
    }
    if (c.more) out.push(`- … and ${c.more} more`)
    out.push('')
  }
  return out.join('\n')
}

function recallText(r) {
  const out = [`${r.total} result${r.total === 1 ? '' : 's'} for "${r.query}" in ${r.matter.title}`, '']
  if (r.summary) out.push(r.summary, `(${r.summaryNote})`, '')
  if (r.summaryError) out.push(`(Not summarised: ${r.summaryError})`, '')
  for (const h of r.hits) {
    const [head, ...rest] = itemLines(h)
    out.push(`• ${head}`, `    ${h.cardTitle}`, ...rest.map((l) => `    ${l}`), '')
  }
  if (!r.hits.length) out.push('Nothing stored for this matter matches. Try other words.')
  return out.join('\n')
}

// ── export ───────────────────────────────────────────────────────────────
/** "Matter memo" in the matter folder: docx | pdf | md. */
function exportMemo(id, format = 'docx', { now = new Date() } = {}) {
  const fmt = String(format || 'docx').toLowerCase()
  if (!['docx', 'pdf', 'md'].includes(fmt)) throw new Error('format must be docx, pdf or md')
  const ov = overview(id, { now })
  const ws = require('./workspace')
  const rel = `${ws.matterFolder(wf.matterLabel(id))}/matter-memo-${now.toISOString().slice(0, 10)}.${fmt}`
  if (fmt === 'md') return { file: ws.writeFile(rel, toMarkdown(ov)), format: fmt }
  if (fmt === 'pdf') {
    const { renderPdf } = require('./pdf')
    const sections = [{ title: `Matter memo — ${matterLine(ov.matter)}`, rows: [['Date', day(ov.generatedAt)], ['Note', 'Every item names where it came from.']] }]
    for (const c of ov.cards) {
      const rows = c.items.map((x) => {
        const [head, ...rest] = itemLines(x, { quoteMax: 300 })
        return [x.level || (x.date ? day(x.date) : '-'), [head, ...rest].join(' | ')]
      })
      if (!rows.length) rows.push(['', c.empty])
      if (c.more) rows.push(['', `… and ${c.more} more`])
      sections.push({ title: c.title, rows })
    }
    return { file: ws.writeFileBinary(rel, renderPdf(sections)), format: fmt }
  }
  const { docxBuffer } = require('./docx_write')
  const color = { high: 'C00000', medium: 'B26B00', low: '1F6F3F' }
  const blocks = [{ text: `Matter memo — ${matterLine(ov.matter)}`, style: 'Title' }, { text: `Matter overview · ${day(ov.generatedAt)} · every item names where it came from.` }]
  for (const c of ov.cards) {
    blocks.push({ text: c.title, style: 'Heading1' })
    if (!c.items.length) blocks.push({ runs: [{ text: c.empty, color: '595959' }] })
    for (const x of c.items) {
      const [head, ...rest] = itemLines(x, { quoteMax: 400 })
      blocks.push({ runs: [{ text: head, bold: true, ...(x.level ? { color: color[x.level] } : {}) }] })
      for (const l of rest) blocks.push({ runs: [{ text: l, ...(l.startsWith('from ') ? { color: '595959' } : {}) }] })
    }
    if (c.more) blocks.push({ text: `… and ${c.more} more` })
  }
  return { file: ws.writeFileBinary(rel, docxBuffer(blocks)), format: fmt }
}

// ── local API ────────────────────────────────────────────────────────────
const ROUTES = new Set(['/api/matters/overview', '/api/matters/recall', '/api/matters/overview/export'])

/**
 * GET  /api/matters/overview?id=[&format=text|md]
 * GET  /api/matters/recall?id=&q=[&limit=][&summary=1][&format=text]
 * POST /api/matters/overview/export { id, format: docx|pdf|md }
 * → { status, json } or null when the path is not one of these.
 */
async function handle(method, p, params, body = {}) {
  if (!ROUTES.has(p)) return null
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) ?? null
  try {
    if (method === 'GET' && p === '/api/matters/overview') {
      const ov = overview(get('id'))
      const format = get('format')
      return { status: 200, json: { ...ov, ...(format === 'text' ? { text: toText(ov) } : format === 'md' ? { markdown: toMarkdown(ov) } : {}) } }
    }
    if (method === 'GET' && p === '/api/matters/recall') {
      const id = get('id')
      const r = recall(id, get('q'), { limit: Math.min(50, parseInt(get('limit'), 10) || 15) })
      if (get('summary') === '1' || get('summary') === 'true') {
        try { Object.assign(r, await summarizeHits(id, r)) } catch (err) { r.summaryError = err.message }
      }
      if (get('format') === 'text') r.text = recallText(r)
      return { status: 200, json: r }
    }
    if (method === 'POST' && p === '/api/matters/overview/export') {
      return { status: 200, json: { ok: true, ...exportMemo(body.id, body.format) } }
    }
    return { status: 404, json: { error: 'not found' } }
  } catch (err) {
    return { status: /unknown matter/.test(err.message) ? 404 : 400, json: { error: err.message } }
  }
}

module.exports = { overview, recall, summarizeHits, exportMemo, collect, toText, toMarkdown, recallText, handle, day, CARDS }
