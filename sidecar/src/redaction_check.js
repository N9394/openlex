"use strict"
/**
 * Redaction check ("Schwärzen mit Prüfung") — the lawyer sees what will be
 * hidden before a question or a document goes to an online AI service.
 *
 *   needed(matterId)         is a check due? (not when everything stays on this computer)
 *   prepare({ matterId, items }) → a check: per document the findings, grouped
 *   confirm(id, decisions)   the lawyer's choices: remembered for the matter,
 *                            the check is confirmed, the AI record notes it
 *   cancel(id)
 *   gate(matterId, reviewId) for an entry point: { needed, block, review }
 *   within(gate, fn)         run fn with the confirmed check in context (llm.js
 *                            refuses an online call in a checked request without it)
 *
 * Settings (harness.js section "redaction", openlex.json):
 *   { "check": true,              on by default; the firm can lock the section
 *     "terms": ["…"],             firm-wide names to hide everywhere
 *     "patterns": [{ "regex": "…", "kind": "ID", "label": "Client number" }] }
 *
 * Only counts go to the AI record — never what was hidden.
 */

const crypto = require('crypto')
const detect = require('./pii_detect')

const TTL_MS = 6 * 3600 * 1000
const MAX_TEXT = 1_000_000 // characters of one document the check window gets
const reviews = new Map() // id → check

// ── settings ────────────────────────────────────────────────────────────

function settings() {
  let h = {}
  let locked = false
  try {
    const harness = require('./harness')
    const all = harness.load()
    h = all.redaction || {}
    locked = all.locked.includes('redaction')
  } catch { /* defaults */ }
  return { check: h.check !== false, locked, terms: Array.isArray(h.terms) ? h.terms.filter((t) => typeof t === 'string' && t.trim().length >= 2) : [], patterns: Array.isArray(h.patterns) ? h.patterns : [] }
}

/** Switch the check on or off for this user (refused when the firm locked it). */
function setCheck(on) {
  const harness = require('./harness')
  if (harness.load().locked.includes('redaction')) throw new Error('Your firm has set the redaction check; it cannot be changed here.')
  const cur = harness.layers().user.data?.redaction || {}
  harness.setUserSection('redaction', { ...cur, check: !!on })
  return settings()
}

function firmRules() {
  const s = settings()
  return { terms: s.terms, patterns: detect.firmPatterns(s.patterns) }
}

// ── when ────────────────────────────────────────────────────────────────

/** May this matter's data go to an online AI service at all (by policy and by routes)? */
function cloudPossible(matterId) {
  const policy = require('./policy')
  const rule = policy.ruleFor(matterId)
  let privileged = false
  try { privileged = !!(matterId && require('./matters').get(matterId)?.privileged) } catch { /* no matter */ }
  if (privileged || rule.mode === 'local-only') return false
  try {
    const routing = require('./routing')
    for (const role of [null, 'plan', 'write', 'judge']) {
      for (const c of routing.candidates({ role, matterId })) {
        if (!c.provider.local && c.provider.kind !== 'local' && policy.check(c.provider, matterId).allowed) return true
      }
    }
  } catch { return true } // when in doubt, check
  return false
}

/** Is a check due before this matter's content goes online? */
function needed(matterId) {
  if (!cloudPossible(matterId)) return { needed: false, local: true }
  const s = settings()
  if (!s.check) return { needed: false, off: true, locked: s.locked }
  return { needed: true, locked: s.locked }
}

/** Are names hidden for online calls of this matter (the old per-rule switch, or the check)? */
function hidingOn(matterId) {
  const rule = require('./policy').ruleFor(matterId)
  if (rule.redact) return true
  return rule.mode !== 'local-only' && settings().check
}

// ── the check ───────────────────────────────────────────────────────────

function prune() {
  const now = Date.now()
  for (const [id, r] of reviews) if (now - r.at > TTL_MS) reviews.delete(id)
}

const keyOf = (kind, text) => `${detect.GROUPS[kind] === 'people' ? 'people' : kind}:${detect.norm(text)}`

/**
 * Look through the question and the documents for what to hide.
 * @param {object} p
 *   matterId
 *   items   [{ name, text }] — the question, each document
 *   signal  stops the name finder
 * @returns the check: { id, matterId, basic, finder, items: [{ id, name, chars, text, truncated, detection, findings }], entries }
 *   detection per text: 'model' when the name finder really went through
 *   it, else 'basic'. basic: any text without the name finder. finder: why —
 *   'used' | 'failed' (installed, but it did not run) | 'not-installed' |
 *   'unavailable' (no ONNX runtime in this build or on this computer).
 */
async function prepare({ matterId = null, items = [], signal } = {}) {
  prune()
  const ner = require('./pii_ner')
  const { terms, keep, patterns } = require('./redact').termsFor(matterId)
  const st = ner.status()
  const model = st.installed && st.available
  let failed = false
  const list = []
  for (const [i, it] of (Array.isArray(items) ? items : []).slice(0, 60).entries()) {
    const full = String(it?.text || '')
    if (!full.trim()) continue
    const text = full.length > MAX_TEXT ? full.slice(0, MAX_TEXT) : full
    let found = []
    let ran = false
    if (model) {
      try { ({ findings: found, ran } = await ner.run(text, { signal })) } catch (err) { console.warn('[redaction] name finder failed:', err.message) }
      if (!ran) failed = true // what it found before it stopped still counts; the check says "basic"
    }
    list.push({ id: `d${i + 1}`, name: String(it.name || `Document ${i + 1}`).slice(0, 200), chars: full.length, text, truncated: full.length > text.length, detection: ran ? 'model' : 'basic', model: found, findings: detect.scan(text, { terms, keep, patterns, model: found, all: true }) })
  }
  // A person or organisation found in one text counts in the others too
  // ("Huber" in the question, "Mag. Johann Huber" in the contract).
  const seen = new Map()
  for (const it of list) for (const f of it.findings) if (['PERSON', 'ORG'].includes(f.kind) && f.on && f.source !== 'term' && f.source !== 'firm') seen.set(detect.norm(f.text), { text: f.text, kind: f.kind, source: 'found' })
  if (seen.size && list.length > 1) {
    const extra = [...seen.values()]
    for (const it of list) it.findings = detect.scan(it.text, { terms: [...terms, ...extra], keep, patterns, model: it.model, all: true })
  }
  for (const it of list) delete it.model
  // One entry per distinct thing (same kind group, same text), with every place it appears.
  const entries = new Map()
  for (const it of list) {
    for (const f of it.findings) {
      const key = keyOf(f.kind, f.text)
      const e = entries.get(key) || { key, kind: f.kind, group: f.group, text: f.text, label: f.label, confidence: 0, sources: [], on: false, count: 0, at: [] }
      e.count++
      e.confidence = Math.max(e.confidence, f.confidence)
      if (!e.sources.includes(f.source)) e.sources.push(f.source)
      e.on = e.on || f.on
      if (e.at.length < 200) e.at.push({ item: it.id, start: f.start, end: f.end })
      f.key = key
      entries.set(key, e)
    }
  }
  const order = detect.GROUP_ORDER
  // "With name finder" only when the model really went through every text of this check.
  const basic = !list.length ? !model : list.some((it) => it.detection !== 'model')
  const finder = !st.available ? 'unavailable' : !st.installed ? 'not-installed' : failed ? 'failed' : 'used'
  const review = {
    id: `rc_${crypto.randomBytes(8).toString('hex')}`, matterId: matterId || null, at: Date.now(), status: 'open',
    basic, finder, runtime: st.available ? null : st.runtime?.reason || 'load-failed', items: list,
    entries: [...entries.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.count - a.count || a.text.localeCompare(b.text)),
  }
  reviews.set(review.id, review)
  return review
}

function get(id) {
  prune()
  const r = reviews.get(String(id || ''))
  if (!r) { const e = new Error('This check has expired; please check again.'); e.code = 'CHECK_EXPIRED'; throw e }
  return r
}

/**
 * The lawyer's decisions.
 * @param {string} id
 * @param {object} d
 *   off   [key] — entries the lawyer unticked
 *   on    [key] — entries the lawyer ticked that were not ticked
 *   add   [{ text, kind? }] — "also hide this" (applies everywhere in the matter)
 */
function confirm(id, d = {}) {
  const r = get(id)
  const off = new Set(Array.isArray(d.off) ? d.off.map(String) : [])
  const on = new Set(Array.isArray(d.on) ? d.on.map(String) : [])
  const add = (Array.isArray(d.add) ? d.add : [])
    .map((a) => ({ text: String(a?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200), kind: detect.KINDS.includes(String(a?.kind || '').toUpperCase()) ? String(a.kind).toUpperCase() : 'OTHER' }))
    .filter((a) => a.text.length >= 2)
    .slice(0, 200)
  const hide = []
  const keep = []
  let unticked = 0
  let ticked = 0
  for (const e of r.entries) {
    const final = e.on ? !off.has(e.key) : on.has(e.key)
    if (e.on && !final) unticked++
    if (!e.on && final) ticked++
    if (final) hide.push(e)
    else if (e.on) keep.push(e.text)
  }
  // What the matter remembers: names, organisations, addresses, anything the
  // lawyer ticked or added (patterns find the numbers again by themselves).
  const learn = [
    ...hide.filter((e) => ['PERSON', 'ORG', 'ADDRESS', 'OTHER'].includes(e.kind) && !e.sources.every((s) => s === 'term' || s === 'firm')),
    ...hide.filter((e) => e.confidence < detect.THRESHOLD),
  ].map((e) => ({ text: e.text, kind: e.kind }))
  const terms = [...new Map([...learn, ...add].map((t) => [detect.norm(t.text), t])).values()]
  if (r.matterId) {
    try { require('./matters').learnRedaction(r.matterId, { hide: terms, keep }) } catch (err) { console.warn('[redaction] matter list not updated:', err.message) }
  }
  const hidden = {}
  for (const e of hide) hidden[e.kind] = (hidden[e.kind] || 0) + 1
  for (const a of add) hidden[a.kind] = (hidden[a.kind] || 0) + 1
  const changed = unticked + ticked + add.length > 0
  Object.assign(r, { status: 'confirmed', confirmedAt: Date.now(), terms, keep, hidden, changed, decisions: { unticked, ticked, added: add.length } })
  require('./policy').audit({ call: 'redaction-check', matter: r.matterId, decision: 'checked', documents: r.items.length, hidden, changed, unticked, ticked, added: add.length, detection: r.basic ? 'basic' : 'with-model' })
  // The text of the check is not needed any more.
  for (const it of r.items) { it.text = ''; it.findings = [] }
  return { id: r.id, status: r.status, hidden, changed }
}

function cancel(id) {
  const r = reviews.get(String(id || ''))
  if (!r) return { ok: true }
  reviews.delete(r.id)
  require('./policy').audit({ call: 'redaction-check', matter: r.matterId, decision: 'cancelled', documents: r.items.length })
  return { ok: true }
}

/** What the window shows: the check without internal fields. */
function view(r, { lang = 'en' } = {}) {
  const de = /^de/i.test(lang)
  return {
    id: r.id, matterId: r.matterId, status: r.status, basic: r.basic, detection: r.basic ? 'basic' : 'with-model', finder: r.finder, runtime: r.runtime,
    items: r.items.map((it) => ({ id: it.id, name: it.name, chars: it.chars, truncated: it.truncated, detection: it.detection, text: it.text, findings: it.findings.map((f) => ({ key: f.key, kind: f.kind, group: f.group, start: f.start, end: f.end, on: f.on, confidence: f.confidence, source: f.source })) })),
    entries: r.entries.map((e) => ({ key: e.key, kind: e.kind, group: e.group, text: e.text, label: e.label?.[de ? 'de' : 'en'] || e.label?.en || e.kind, confidence: e.confidence, sources: e.sources, on: e.on, count: e.count, at: e.at })),
    groups: detect.GROUP_ORDER,
  }
}

// ── the gate ────────────────────────────────────────────────────────────

/**
 * For an entry point (chat, analysis, batch, panel, Word review): is a check
 * due, and is it done? `block` → do not start; ask the window for a check.
 */
function gate(matterId, reviewId) {
  const n = needed(matterId)
  if (!n.needed) return { needed: false, block: false, local: !!n.local, off: !!n.off }
  let review = null
  if (reviewId) { try { review = get(reviewId) } catch { review = null } }
  const ok = review && review.status === 'confirmed' && (review.matterId || null) === (matterId || null)
  return { needed: true, block: !ok, review: ok ? review : null }
}

/** Run fn as a checked request: llm.js finds the check (and its terms) in context. */
function within(g, fn) {
  if (!g?.needed) return fn()
  return require('./policy').withRedaction({ gated: true, review: g.review || null }, fn)
}

/** llm.js: may this online call go out? Throws CHECK_NEEDED inside a checked request without a confirmed check. */
function assertChecked(matterId) {
  const ctx = require('./policy').redactionContext()
  if (!ctx?.gated) return
  if (ctx.review?.status === 'confirmed') return
  if (!needed(matterId).needed) return
  const e = new Error('Please check what is hidden before this goes to the online AI (redaction check).')
  e.code = 'CHECK_NEEDED'
  throw e
}

/** For the AI record of one online call: was it checked, and did the lawyer change anything? */
function callNote() {
  const ctx = require('./policy').redactionContext()
  if (ctx?.review?.status === 'confirmed') return { check: ctx.review.changed ? 'checked-changed' : 'checked' }
  return { check: 'automatic' }
}

module.exports = { settings, setCheck, firmRules, needed, hidingOn, cloudPossible, prepare, get, confirm, cancel, view, gate, within, assertChecked, callNote }
