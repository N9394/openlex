"use strict"
/**
 * Per-document conversation sessions (Batch 1 — conversation memory).
 *
 * Rolling history of the last MAX_TURNS exchanges, persisted as JSONL in
 * the shared data dir (~/.lexvault/sessions/<docId>.jsonl) so the thread
 * survives sidecar restarts. runAction injects the history as a
 * CONVERSATION block (droppable-first under compaction — it's context,
 * not correctness); the pane already displays the full thread.
 *
 * Follow-ups like "now make §7 stronger too" become real because the
 * model sees the earlier turns.
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')

const MAX_TURNS = 10          // exchanges kept (user + assistant per turn)
const MAX_TURN_CHARS = 1200   // per-message cap when injected into ctx

function sessionPath(docId) {
  const safe = String(docId || 'default').replace(/[^\w\-.]/g, '_').slice(0, 80)
  return path.join(DATA_DIR, 'sessions', `${safe}.jsonl`)
}

class Session {
  constructor(docId) {
    this.docId = docId
    this.path = sessionPath(docId)
  }

  /** Load the rolling history: [{role, content}] in chronological order. */
  load() {
    try {
      if (!fs.existsSync(this.path)) return []
      const raw = fs.readFileSync(this.path, 'utf8')
      const out = []
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const m = JSON.parse(line)
          if (m && m.role && typeof m.content === 'string') out.push(m)
        } catch { /* skip corrupt line */ }
      }
      return out.slice(-MAX_TURNS * 2)
    } catch {
      return []
    }
  }

  /** Append one exchange (user message + assistant answer), trimmed. */
  append(userMessage, assistantText) {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true })
      const entry = [
        { role: 'user', content: String(userMessage || '').slice(0, MAX_TURN_CHARS * 2) },
        { role: 'assistant', content: String(assistantText || '').slice(0, MAX_TURN_CHARS * 2) },
      ]
      fs.appendFileSync(this.path, entry.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8')
      this.trim()
    } catch { /* persistence is best-effort */ }
  }

  /** Keep only the last MAX_TURNS exchanges (rewrite the file). */
  trim() {
    try {
      const all = this.load()
      const keep = all.slice(-MAX_TURNS * 2)
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

module.exports = { Session, MAX_TURNS }
