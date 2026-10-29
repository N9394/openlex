"use strict"
/**
 * Documents attached in a chat (the desktop app's paperclip or drop, the
 * terminal app, `openlex ask --file`): read once on this computer
 * (read.js: Word, PDF with on-device OCR, Excel, e-mail, text), kept as
 * text, and referred to by id in later turns, the analysis and DocumentView.
 *
 *   ~/.lexvault/attachments/<id>.json   { id, name, kind, bytes, chars, pages, ocrPages, tokens, matterId, sessionId, at }
 *   ~/.lexvault/attachments/<id>.txt    the text
 *
 * Attaching goes through the permissions broker (tool "read_attachment":
 * allowed by default because the lawyer chose the file, refused when a firm
 * rule says "deny read_attachment") and is audited. Nothing leaves this
 * computer when a file is attached: where its text may go later is the
 * matter's data policy, checked before every model call (policy.js). The
 * reply says that in words (`where`).
 * Kept 30 days (attachments are copies; the lawyer's file stays where it is).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')

const DIR = path.join(DATA_DIR, 'attachments')
const KEEP_DAYS = 30
const ID_RE = /^att_[a-f0-9]{16}$/

const file = (id, ext) => path.join(DIR, `${id}.${ext}`)
function validId(id) { if (!ID_RE.test(String(id || ''))) throw new Error('unknown attachment'); return String(id) }

/** Where this matter's documents may go, in words (the data policy). */
function where(matterId) {
  const policy = require('./policy')
  const rule = policy.ruleFor(matterId)
  let privileged = false
  try { privileged = !!(matterId && require('./matters').get(matterId)?.privileged) } catch { /* no matter */ }
  if (privileged || rule.mode === 'local-only') return { local: true, text: 'Stays on this computer: your client-data rule only allows the AI on this computer.' }
  const label = (id) => { try { return require('./providers/catalog').getProvider(id)?.label || id } catch { return id } }
  const names = (rule.providers || []).map(label).join(', ')
  return { local: false, text: `May be sent to ${names || 'the AI services your client-data rule allows'}${rule.regions ? ` (regions: ${rule.regions.join(', ')})` : ''}${rule.redact ? ', with names hidden' : ''}, when you ask about it.` }
}

function prune() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400000
    for (const f of fs.readdirSync(DIR)) {
      const p = path.join(DIR, f)
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true })
    }
  } catch { /* nothing to prune */ }
}

/**
 * Attach one file: { name, buffer } (bytes from the window) or { file } (a
 * document in the matter's folders), plus matterId, sessionId.
 * @returns the attachment summary (no text) + strategy + where
 */
async function add({ name, buffer, file: f, matterId = null, sessionId = null, ocr = true } = {}) {
  const perms = require('./permissions')
  const label = String(name || (f ? path.basename(f) : 'document')).slice(0, 200)
  const gate = await perms.authorize({ tool: 'read_attachment', args: { name: label }, matterId })
  if (!gate.allowed) { const e = new Error(`Attaching ${label} is not allowed by your firm's rules.`); e.code = 'NOT_ALLOWED'; throw e }
  let src
  if (buffer) src = { buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), name: label }
  else if (f) src = { file: require('./workflows_docs').resolveDoc(matterId, String(f)), name: label }
  else throw new Error('nothing to attach: send the file (name + data) or a document of the matter (file)')
  const r = await require('./read').readDocument(src, { ocr })
  if (!r.text.trim()) { const e = new Error(`${label}: no text found${r.kind === 'pdf' ? ' (a scan where text recognition found nothing?)' : ''}`); e.code = 'EMPTY'; throw e }
  fs.mkdirSync(DIR, { recursive: true })
  prune()
  const id = `att_${crypto.randomBytes(8).toString('hex')}`
  const meta = { id, name: r.name, kind: r.kind, bytes: r.bytes, chars: r.chars, pages: r.pages, ocrPages: r.ocrPages, tokens: r.tokens, ...(r.attachments ? { attachments: r.attachments } : {}), matterId: matterId || null, sessionId: sessionId || null, at: new Date().toISOString() }
  fs.writeFileSync(file(id, 'txt'), r.text, 'utf8')
  fs.writeFileSync(file(id, 'json'), JSON.stringify(meta, null, 2))
  return describe(meta, r.text)
}

/** The summary a window shows: meta + outline + how it will be read + where it may go. */
function describe(meta, text) {
  const { Document } = require('./doc')
  const doc = new Document(text.length > 400000 ? text.slice(0, 400000) : text, meta.id)
  const headings = doc.map().sections.filter((s) => s.heading).slice(0, 30).map((s) => s.heading)
  const strategy = require('./strategy')
  const s = strategy.forModel({ tokens: meta.tokens, role: 'plan', matterId: meta.matterId })
  return {
    ...meta,
    preview: text.replace(/\[Page \d+(?: · OCR)?\]\n?/g, '').slice(0, 400),
    outline: headings,
    strategy: { kind: s.kind, mode: s.mode, ctx: s.ctx, cache: s.cache, label: s.label, text: strategy.explain(s, { name: meta.name, pages: meta.pages }) },
    where: where(meta.matterId),
  }
}

function meta(id) {
  return JSON.parse(fs.readFileSync(file(validId(id), 'json'), 'utf8'))
}

function text(id) {
  return fs.readFileSync(file(validId(id), 'txt'), 'utf8')
}

/** { name, text } for each id (unknown ids throw). */
function load(ids = []) {
  return (Array.isArray(ids) ? ids : [ids]).slice(0, 50).map((id) => ({ id, name: meta(id).name, text: text(id), meta: meta(id) }))
}

/** One combined text for the chat's document model ("=== name ===" between files). */
function combined(ids = []) {
  const list = load(ids)
  if (list.length === 1) return { text: list[0].text, names: [list[0].name], list }
  return { text: list.map((a) => `=== ${a.name} ===\n${a.text}`).join('\n\n'), names: list.map((a) => a.name), list }
}

module.exports = { add, meta, text, load, combined, describe, where, DIR, ID_RE }
