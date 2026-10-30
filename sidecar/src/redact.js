"use strict"
/**
 * Redact-before-send — names and numbers are hidden (pseudonymised) for
 * online AI calls.
 *
 * Before a request leaves the machine, what pii_detect.js finds is replaced
 * with placeholders ([[PERSON_1]], [[IBAN_2]] …); the reply is restored
 * locally, so the lawyer sees real names and the provider gets placeholders.
 *
 * What gets replaced:
 *   - the matter's list: client, parties, people, and what the lawyer ticked
 *     or added in a redaction check (matters.js redactTerms, redactKinds)
 *   - the firm's list and patterns (openlex.json → "redaction")
 *   - patterns with check digits: e-mail, phone, IBAN, cards, national IDs,
 *     register and court numbers, addresses, dates of birth (pii_patterns.js)
 *   - titles before names and legal forms after company names
 * What the lawyer unticked in a check (redactKeep) stays as it is.
 *
 * Placeholders are stable per matter (kept on this computer in
 * <data>/redaction/<matter>.json, readable only by this user): "Huber" is
 * [[PERSON_3]] in every call and every document of the matter, so answers
 * and exports are restored consistently.
 *
 * Pseudonymised text is still personal data. This is a help, not a
 * guarantee: names nobody listed and indirect details (a rare job title, a
 * unique event) can still leave — the check and the guide say so.
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')
const detect = require('./pii_detect')

const STORE_DIR = path.join(DATA_DIR, 'redaction')
const SAFE_ID = /^[\w-]{1,80}$/

// ── stable placeholders per matter ──────────────────────────────────────
// One state object per matter in this process, so parallel calls (a panel)
// never hand out the same number twice.
const states = new Map()

function stateFor(matterId) {
  const key = matterId || ''
  if (states.has(key)) return states.get(key)
  const st = { matterId: matterId || null, map: new Map(), orig: new Map(), counts: {} }
  if (matterId && SAFE_ID.test(matterId)) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(STORE_DIR, `${matterId}.json`), 'utf8'))
      for (const [k, ph] of Object.entries(d.map || {})) st.map.set(k, ph)
      for (const [ph, o] of Object.entries(d.orig || {})) st.orig.set(ph, o)
      st.counts = d.counts && typeof d.counts === 'object' ? d.counts : {}
    } catch { /* first use */ }
  }
  states.set(key, st)
  return st
}

function saveState(st) {
  if (!st.matterId || !SAFE_ID.test(st.matterId)) return
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 })
    const file = path.join(STORE_DIR, `${st.matterId}.json`)
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, map: Object.fromEntries(st.map), orig: Object.fromEntries(st.orig), counts: st.counts }), { mode: 0o600 })
    fs.renameSync(tmp, file)
  } catch (err) { console.warn('[redact] placeholders not saved:', err.message) }
}

/** Forget a matter's placeholders (tests; a closed matter). */
function forget(matterId) {
  states.delete(matterId || '')
  if (matterId && SAFE_ID.test(matterId)) fs.rmSync(path.join(STORE_DIR, `${matterId}.json`), { force: true })
}

class Redactor {
  /**
   * @param {string[]|object} opts  a list of terms (old form), or
   *   { terms: [string|{text,kind}], keep: [string], patterns: [entries], matterId }
   */
  constructor(opts = []) {
    const o = Array.isArray(opts) ? { terms: opts } : (opts || {})
    this.terms = (o.terms || []).map((t) => (typeof t === 'string' ? { text: t.trim() } : { ...t, text: String(t.text || '').trim() })).filter((t) => t.text.length >= 2)
    this.keep = o.keep || []
    this.patterns = o.patterns || []
    this.state = o.matterId !== undefined ? stateFor(o.matterId) : { matterId: null, map: new Map(), orig: new Map(), counts: {} }
    this.used = new Map() // placeholder → kind, for this call's record
  }

  _placeholder(kind, original) {
    const st = this.state
    const key = `${kind}:${detect.norm(original)}`
    let ph = st.map.get(key)
    if (!ph) {
      st.counts[kind] = (st.counts[kind] || 0) + 1
      ph = `[[${kind}_${st.counts[kind]}]]`
      st.map.set(key, ph)
      st.orig.set(ph, original)
      this._dirty = true
    }
    this.used.set(ph, kind)
    return ph
  }

  redact(text) {
    const src = String(text ?? '')
    if (!src) return src
    const found = detect.scan(src, { terms: this.terms, keep: this.keep, patterns: this.patterns })
    let out = ''
    let at = 0
    for (const f of found) {
      if (f.start < at) continue
      // Text that is already a placeholder stays as it is.
      if (/^\[\[[A-Z]+_\d+\]\]$/.test(f.text)) continue
      out += src.slice(at, f.start) + this._placeholder(f.kind, f.text)
      at = f.end
    }
    out += src.slice(at)
    if (this._dirty) { saveState(this.state); this._dirty = false }
    return out
  }

  redactMessages(messages) {
    return messages.map((m) => ({ ...m, content: typeof m.content === 'string' ? this.redact(m.content) : m.content }))
  }

  /** Restore placeholders (also tolerates models dropping one bracket). */
  restore(text) {
    if (!this.state.orig.size) return text
    return String(text ?? '').replace(/\[?\[\[?([A-Z]+_\d+)\]\]?\]?/g, (m, id) => this.state.orig.get(`[[${id}]]`) ?? m)
  }

  /** Wrap a streaming callback: hold back a possibly split placeholder until it is complete. */
  streamRestorer(onContent) {
    let pending = ''
    return {
      push: (chunk) => {
        pending += chunk
        // Hold back a trailing, not-yet-closed placeholder ("[", "[[PAR", "[[PARTY_1]").
        const tail = pending.match(/\[\[?[A-Z]*(?:_\d*)?\]?$/)
        const cut = tail ? tail.index : pending.length
        const ready = pending.slice(0, cut)
        pending = pending.slice(cut)
        if (ready) onContent(this.restore(ready))
      },
      flush: () => { if (pending) { onContent(this.restore(pending)); pending = '' } },
    }
  }

  /** How many different things were hidden in this call. */
  get replaced() {
    return this.used.size
  }

  /** { PERSON: 2, IBAN: 1 } — counts only, for the AI record. */
  get hidden() {
    const out = {}
    for (const kind of this.used.values()) out[kind] = (out[kind] || 0) + 1
    return out
  }
}

/** The matter's list for the redactor and the check: { terms: [{ text, kind }], keep, patterns }. */
function termsFor(matterId) {
  let m = null
  try { m = matterId ? require('./matters').get(matterId) : null } catch { /* no matter */ }
  const kinds = m?.redactKinds || {}
  const terms = [
    ...(m?.redactTerms || []).map((t) => ({ text: t, kind: kinds[detect.norm(t)] || 'PARTY' })),
    ...(m?.client ? [{ text: m.client, kind: 'PARTY' }] : []),
  ]
  const firm = require('./redaction_check').firmRules()
  return {
    terms: [...terms, ...firm.terms.map((t) => ({ text: t, kind: 'PARTY', source: 'firm' }))],
    keep: m?.redactKeep || [],
    patterns: firm.patterns,
  }
}

/**
 * Redactor for a matter, or null when nothing is to be hidden: the matter's
 * rule asks for hidden names, or the redaction check is on for a matter that
 * may use online AI (redaction_check.js decides).
 */
function forMatter(matterId) {
  const check = require('./redaction_check')
  if (!check.hidingOn(matterId)) return null
  const t = termsFor(matterId)
  // Terms the lawyer added or ticked in this request's check (also when there is no matter).
  const ctx = require('./policy').redactionContext()
  const review = ctx?.review || null
  return new Redactor({ terms: [...t.terms, ...(review?.terms || [])], keep: [...t.keep, ...(review?.keep || [])], patterns: t.patterns, matterId: matterId || null })
}

module.exports = { Redactor, forMatter, termsFor, forget, STORE_DIR }
