"use strict"
/**
 * Matters — the unit lawyers work in, shared by the Word plugin and the
 * desktop App (both load this module; one file in the shared data dir).
 *
 *   ~/.lexvault/matters.json
 *   {
 *     "matters": [{ id, title, client, number, privileged, status,
 *                   docs: [{ docId, title, boundAt }], createdAt, updatedAt }],
 *     "active": { "app": "<matterId>", "word": "<matterId>" }
 *   }
 *
 * - A Word document is bound to at most one matter (docId → matter).
 * - Privileged matters get a local-only data policy on creation; the policy
 *   itself lives in policy.js so one place decides where data may go.
 * - Writes are atomic (temp file + rename) because two processes share it.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const policy = require('./policy')

const MATTERS_PATH = path.join(DATA_DIR, 'matters.json')
const STATUSES = ['open', 'on-hold', 'closed']
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(MATTERS_PATH, 'utf8'))
    return { matters: Array.isArray(d.matters) ? d.matters : [], active: d.active && typeof d.active === 'object' ? d.active : {} }
  } catch {
    return { matters: [], active: {} }
  }
}

function write(d) {
  fs.mkdirSync(path.dirname(MATTERS_PATH), { recursive: true })
  const tmp = `${MATTERS_PATH}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, MATTERS_PATH)
}

function withPolicy(m) {
  return { ...m, policy: policy.ruleFor(m.id) }
}

function list({ includeClosed = false } = {}) {
  return read().matters.filter((m) => includeClosed || m.status !== 'closed').map(withPolicy)
}

function get(id) {
  const m = read().matters.find((x) => x.id === id)
  return m ? withPolicy(m) : null
}

function create({ title, client, number, privileged } = {}) {
  title = str(title, 200)
  if (!title) throw new Error('matter title is required')
  const d = read()
  const now = new Date().toISOString()
  const m = {
    id: `m_${crypto.randomBytes(6).toString('hex')}`,
    title,
    client: str(client, 200),
    number: str(number, 80),
    privileged: !!privileged,
    status: 'open',
    docs: [],
    createdAt: now,
    updatedAt: now,
  }
  d.matters.push(m)
  write(d)
  if (m.privileged) policy.setRule(m.id, { mode: 'local-only' })
  return withPolicy(m)
}

function update(id, patch = {}) {
  const d = read()
  const m = d.matters.find((x) => x.id === id)
  if (!m) throw new Error(`unknown matter: ${id}`)
  if (patch.title !== undefined) { const t = str(patch.title, 200); if (!t) throw new Error('matter title is required'); m.title = t }
  if (patch.client !== undefined) m.client = str(patch.client, 200)
  if (patch.number !== undefined) m.number = str(patch.number, 80)
  // Default agent profile for this matter (agents.js); null clears it.
  if (patch.agent !== undefined) { if (patch.agent) require('./agents').get(patch.agent); m.agent = patch.agent ? String(patch.agent) : null }
  if (patch.redactTerms !== undefined) {
    // Names of parties/people to pseudonymise before cloud calls.
    m.redactTerms = (Array.isArray(patch.redactTerms) ? patch.redactTerms : String(patch.redactTerms).split(/[\n,;]/))
      .map((t) => str(t, 200)).filter((t) => t.length >= 2).slice(0, 1000)
  }
  if (patch.redactKeep !== undefined) {
    // What a redaction check said need not be hidden (the lawyer unticked it).
    m.redactKeep = (Array.isArray(patch.redactKeep) ? patch.redactKeep : String(patch.redactKeep).split(/[\n;]/))
      .map((t) => str(t, 200)).filter((t) => t.length >= 2).slice(0, 500)
  }
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new Error(`status must be one of: ${STATUSES.join(', ')}`)
    m.status = patch.status
  }
  if (patch.privileged !== undefined) {
    m.privileged = !!patch.privileged
    if (m.privileged) policy.setRule(m.id, { mode: 'local-only' })
  }
  m.updatedAt = new Date().toISOString()
  write(d)
  return withPolicy(m)
}

/**
 * Remember a redaction check's decisions for the matter: what was hidden
 * joins the list (with its kind), what was unticked is kept as it is next
 * time. Only on this computer, in matters.json.
 */
function learnRedaction(id, { hide = [], keep = [] } = {}) {
  const d = read()
  const m = d.matters.find((x) => x.id === id)
  if (!m) throw new Error(`unknown matter: ${id}`)
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const terms = Array.isArray(m.redactTerms) ? [...m.redactTerms] : []
  const kinds = m.redactKinds && typeof m.redactKinds === 'object' ? { ...m.redactKinds } : {}
  const have = new Set(terms.map(norm))
  for (const h of hide) {
    const t = str(h?.text, 200)
    if (t.length < 2) continue
    if (!have.has(norm(t))) { terms.push(t); have.add(norm(t)) }
    if (h.kind && h.kind !== 'PARTY') kinds[norm(t)] = String(h.kind)
  }
  const keepList = [...new Set([...(Array.isArray(m.redactKeep) ? m.redactKeep : []), ...keep.map((t) => str(t, 200)).filter((t) => t.length >= 2)])]
    .filter((t) => !have.has(norm(t)))
  // Hidden again after being kept: the newer decision wins.
  m.redactTerms = terms.slice(-1000)
  m.redactKinds = kinds
  m.redactKeep = keepList.slice(-500)
  m.updatedAt = new Date().toISOString()
  write(d)
  return withPolicy(m)
}

/** Bind a Word document to a matter (moves it if it was bound elsewhere). */
function bindDoc(id, docId, title) {
  docId = str(docId, 200)
  if (!docId) throw new Error('docId is required')
  const d = read()
  const target = d.matters.find((x) => x.id === id)
  if (!target) throw new Error(`unknown matter: ${id}`)
  for (const m of d.matters) m.docs = (m.docs || []).filter((x) => x.docId !== docId)
  target.docs.push({ docId, title: str(title, 200), boundAt: new Date().toISOString() })
  target.updatedAt = new Date().toISOString()
  write(d)
  return withPolicy(target)
}

function unbindDoc(docId) {
  const d = read()
  for (const m of d.matters) m.docs = (m.docs || []).filter((x) => x.docId !== docId)
  write(d)
}

function forDoc(docId) {
  if (!docId) return null
  const m = read().matters.find((x) => (x.docs || []).some((doc) => doc.docId === docId))
  return m ? withPolicy(m) : null
}

/** Active matter per client ('app' | 'word') — the App's LLM proxy uses it. */
function setActive(client, id) {
  if (!['app', 'word'].includes(client)) throw new Error(`unknown client: ${client}`)
  const d = read()
  if (id && !d.matters.some((x) => x.id === id)) throw new Error(`unknown matter: ${id}`)
  if (id) d.active[client] = id
  else delete d.active[client]
  write(d)
}

function active(client) {
  const id = read().active[client]
  return id ? get(id) : null
}

module.exports = { list, get, create, update, learnRedaction, bindDoc, unbindDoc, forDoc, setActive, active, MATTERS_PATH, STATUSES }
