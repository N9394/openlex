"use strict"
/**
 * Conversation sessions — one OpenLex, three windows.
 *
 * A session is one conversation: the questions and answers, persisted as
 * JSONL in the shared data dir (~/.lexvault/sessions/<id>.jsonl) so the
 * thread survives engine restarts and shows up in every window. Its id is
 * the document id by default (the Word pane), or the `sessionId` a window
 * sends with POST /api/chat (the terminal app and the desktop app keep one
 * per matter conversation), so a conversation started in one window can be
 * listed, read and continued in another:
 *
 *   GET /api/sessions?matterId=…   the conversations of a matter (any window), newest first
 *   GET /api/session?id=…          one conversation: its questions and answers
 *   POST /api/session/clear        forget one ({ sessionId } or { docId })
 *
 * Each line carries what a window needs to show the turn again later: when
 * (`at`), which window (`client`), the matter, and for answers the law it
 * was based on (`sources`), where the data went (`data`, `online`) and
 * whether it was stopped. Never document text.
 *
 * runAction injects the last MAX_TURNS exchanges as a CONVERSATION block
 * (droppable-first under compaction — it's context, not correctness), so
 * follow-ups like "now make §7 stronger too" work.
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')

const MAX_TURNS = 10           // exchanges the model sees (user + assistant per turn)
const MAX_TURN_CHARS = 1200    // per-message cap when injected into ctx
const MAX_KEEP = 100           // exchanges kept on disk (what the windows show)
const MAX_STORED_CHARS = 40000 // per message on disk

const DIR = () => path.join(DATA_DIR, 'sessions')

/** The file-safe form of an id ("tui:m_1" → "tui_m_1"); the same id twice gives the same file. */
const safeId = (id) => String(id || 'default').replace(/[^\w\-.]/g, '_').slice(0, 80)

function sessionPath(id) {
  return path.join(DIR(), `${safeId(id)}.jsonl`)
}

function readLines(file) {
  try {
    const out = []
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const m = JSON.parse(line)
        if (m && m.role && typeof m.content === 'string') out.push(m)
      } catch { /* skip corrupt line */ }
    }
    return out
  } catch {
    return []
  }
}

/** Small, safe copies of what an answer was based on and where its data went. */
const str = (v, n) => (v == null ? '' : String(v).slice(0, n))
function compactSources(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, 20).map((s) => ({ chunk_id: str(s?.chunk_id, 120) || null, source_name: str(s?.source_name, 120), section: str(s?.section, 80), snippet: str(s?.snippet, 200) }))
}
function compactData(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, 10).map((m) => ({ provider: str(m?.provider, 40), label: str(m?.label, 60), model: str(m?.model, 80) || null, local: !!m?.local, region: str(m?.region, 30) || null, redacted: !!m?.redacted, calls: Math.max(1, +m?.calls || 1) }))
}

class Session {
  constructor(id) {
    this.docId = id
    this.id = safeId(id)
    this.path = sessionPath(id)
  }

  /** Every stored message, oldest first: [{ role, content, at?, client?, matterId?, … }]. */
  history() {
    return readLines(this.path)
  }

  /** The rolling history the model sees: [{role, content}] in chronological order. */
  load() {
    return this.history().slice(-MAX_TURNS * 2)
  }

  /**
   * Append one exchange (question + answer). `meta`: { matterId, client,
   * agent, sources, data, online, stopped } — what a window shows again later.
   */
  append(userMessage, assistantText, meta = {}) {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true })
      const base = { at: new Date().toISOString(), ...(meta.client ? { client: str(meta.client, 20) } : {}), ...(meta.matterId ? { matterId: str(meta.matterId, 80) } : {}) }
      const sources = compactSources(meta.sources)
      const data = compactData(meta.data)
      const online = Array.isArray(meta.online) ? [...new Set(meta.online.map((x) => str(x, 80)).filter(Boolean))].slice(0, 10) : []
      const entry = [
        { role: 'user', content: String(userMessage || '').slice(0, MAX_STORED_CHARS), ...base },
        {
          role: 'assistant',
          content: String(assistantText || '').slice(0, MAX_STORED_CHARS),
          ...base,
          ...(meta.agent ? { agent: str(meta.agent, 40) } : {}),
          ...(sources.length ? { sources } : {}),
          ...(data.length ? { data } : {}),
          ...(online.length ? { online } : {}),
          ...(meta.stopped ? { stopped: true } : {}),
        },
      ]
      fs.appendFileSync(this.path, entry.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8')
      this.trim()
    } catch { /* persistence is best-effort */ }
  }

  /** Keep only the last MAX_KEEP exchanges (rewrite the file). */
  trim() {
    try {
      const all = this.history()
      const keep = all.slice(-MAX_KEEP * 2)
      if (keep.length === all.length) return
      fs.writeFileSync(this.path, keep.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8')
    } catch { /* best-effort */ }
  }

  clear() {
    try { fs.unlinkSync(this.path) } catch { /* already empty */ }
  }

  /** The CONVERSATION block injected into the system prompt. */
  contextBlock() {
    const history = this.load()
    if (!history.length) return ''
    const lines = ['CONVERSATION (earlier turns — brief context, use it, do not repeat work already done):']
    for (const m of history.slice(-MAX_TURNS)) {
      const label = m.role === 'user' ? 'USER' : 'ASSISTANT'
      const content = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TURN_CHARS)
      if (content) lines.push(`${label}: ${content}`)
    }
    return '\n' + lines.join('\n')
  }
}

/**
 * The matter a conversation belongs to: what its lines say, else the
 * terminal app's older ids ("tui_m_…"), else the matter its Word document
 * is bound to (`forDoc` = matters.forDoc).
 */
function matterOf(id, msgs, forDoc) {
  const tagged = [...msgs].reverse().find((m) => m.matterId)
  if (tagged) return tagged.matterId
  const tui = /^tui_(m_[0-9a-f]+)(?:_|$)/.exec(id)
  if (tui) return tui[1]
  try { return forDoc ? forDoc(id)?.id || null : null } catch { return null }
}

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

/**
 * The conversations of a matter (with matterId null: those without one),
 * newest first: [{ id, title, matterId, clients, turns, updatedAt }].
 */
function list({ matterId = null, forDoc = null, limit = 50 } = {}) {
  let files = []
  try { files = fs.readdirSync(DIR()).filter((f) => f.endsWith('.jsonl')) } catch { return [] }
  const out = []
  for (const f of files) {
    const id = f.slice(0, -'.jsonl'.length)
    const file = path.join(DIR(), f)
    const msgs = readLines(file)
    if (!msgs.length) continue
    const mid = matterOf(id, msgs, forDoc)
    if ((matterId || null) !== (mid || null)) continue
    let updatedAt = [...msgs].reverse().find((m) => m.at)?.at
    if (!updatedAt) { try { updatedAt = fs.statSync(file).mtime.toISOString() } catch { updatedAt = null } }
    const first = msgs.find((m) => m.role === 'user')
    out.push({
      id,
      title: clip(first?.content || 'Conversation', 80),
      matterId: mid,
      clients: [...new Set(msgs.map((m) => m.client).filter(Boolean))],
      turns: msgs.filter((m) => m.role === 'user').length,
      updatedAt,
    })
  }
  return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, Math.max(1, limit))
}

/** One conversation for a window: { id, matterId, messages }. */
function read(id, { forDoc = null } = {}) {
  const s = new Session(id)
  const messages = s.history()
  return { id: s.id, matterId: messages.length ? matterOf(s.id, messages, forDoc) : null, messages }
}

/**
 * The local API routes (server.js): GET /api/sessions?matterId=&limit=,
 * GET /api/session?id=, POST /api/session/clear { sessionId | docId }.
 * → { status, json }, or null for other paths.
 */
function handle(method, p, params, body = {}, { forDoc = null } = {}) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  if (p === '/api/sessions') {
    if (method !== 'GET') return { status: 405, json: { error: 'use GET' } }
    return { status: 200, json: { sessions: list({ matterId: get('matterId'), forDoc, limit: +(get('limit') || 50) }) } }
  }
  if (p === '/api/session') {
    if (method !== 'GET') return { status: 405, json: { error: 'use GET' } }
    const id = get('id')
    if (!id) return { status: 400, json: { error: 'id required' } }
    return { status: 200, json: read(id, { forDoc }) }
  }
  if (p === '/api/session/clear') {
    if (method !== 'POST') return { status: 405, json: { error: 'use POST' } }
    new Session(body?.sessionId || body?.docId || 'default').clear()
    return { status: 200, json: { ok: true } }
  }
  return null
}

module.exports = { Session, list, read, handle, safeId, MAX_TURNS, MAX_KEEP }
