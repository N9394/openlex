"use strict"
/**
 * Candidate generation for the redaction check, version 2 (redaction_v2.js).
 *
 * GOWA has one decision head and no tagger: it can only classify what is
 * put in front of it. Names that no source proposes are not seen, so the
 * candidate sources aim for recall, and the decision model (stage 2)
 * sorts out what is personal data.
 *
 * A candidate source is pluggable:
 *   { id, label, available() → boolean, find(text, { signal }) → Promise<[{ kind, start, end, confidence }]> }
 *
 * Built in:
 *   gliner   the optional on-device name finder (pii_ner.js), when installed
 *   names    a common first name followed by capitalised words ("Jana Nováková")
 *   ngrams   runs of capitalised words that do not start a sentence ("Alpenbau",
 *            "Huber Maschinen"), also every German noun — stage 2 filters them
 * The patterns, the matter's and the firm's lists and the title / legal-form
 * heuristics come from pii_detect.scan() as before.
 *
 *   register(source) · unregister(id) · list() · find(text, opts)
 */

const { isFirstName } = require('./pii_names')

const sources = new Map()

function register(src) {
  if (!src || typeof src.id !== 'string' || typeof src.find !== 'function') throw new Error('a candidate source needs { id, find(text) }')
  sources.set(src.id, { available: () => true, label: src.id, ...src })
}
function unregister(id) { sources.delete(id) }
function list() { return [...sources.values()].map((s) => ({ id: s.id, label: s.label, available: !!safe(() => s.available()) })) }
function safe(fn) { try { return fn() } catch { return false } }

// Words that start a sentence or a clause and are not names, plus legal words
// that are always capitalised in German or English headings.
const STOP = new Set(('Herr Herrn Frau Fräulein Mr Mrs Ms Miss Dr Prof Mag Pan Pani Doamna Domnul Der Die Das Den Dem Des Ein Eine Einer Eines Einem Und Oder Aber Wenn Falls Soweit Sofern Nach Gemäß Laut Bei Mit Von Zu Zur Zum Im In Am An Auf Aus Für Gegen Über Unter Vor Zwischen Durch Dieser Diese Dieses Jeder Jede Alle Es Er Sie Wir Ihr Ich Sehr Hiermit Hierzu Ferner Sowie Zudem Außerdem Insbesondere Daher Somit Gegebenenfalls Ggf ' +
  'The A An And Or But If When Where Unless Until Upon Under Over After Before Between By For From In On Of To With Without This That These Those Each Every Any All Such It He She We They I You Our Your Their Its Hereby Further Furthermore Moreover However Therefore Notwithstanding Subject Pursuant Provided ' +
  'Le La Les Un Une Des Et Ou Si Dans Pour Par Sur Avec Sans Ce Cette Il Elle Nous Vous Ils ' +
  'Vertrag Vertrags Vertrages Verträge Vereinbarung Parteien Partei Vertragsparteien Klausel Absatz Artikel Gesetz Gesetzes Recht Rechts Haftung Kündigung Frist Fristen Zahlung Rechnung Gericht Gerichts Gerichtsstand Datum Seite Anlage Anhang Leistung Leistungen Preis Vergütung Gesellschaft Geschäftsführer Auftraggeber Auftragnehmer Käufer Verkäufer Mieter Vermieter Kunde Kunden Lieferant Schaden Schäden Ansprüche Anspruch Verpflichtung Pflichten Bestimmungen Regelung Regelungen Bedingungen Bestimmung Änderungen Änderung Schriftform Wirksamkeit Laufzeit Beginn Ende Jahr Jahre Monat Monate Tag Tage Woche Wochen ' +
  'Agreement Contract Party Parties Clause Section Article Schedule Annex Exhibit Act Law Court Liability Termination Payment Invoice Price Fee Fees Services Service Company Customer Supplier Buyer Seller Tenant Landlord Date Term Notice Notices Damages Obligations Confidential Information Effective Date').split(/\s+/))

const WORD = "\\p{Lu}[\\p{Ll}\\p{Lu}'’-]*\\p{Ll}[\\p{Ll}'’-]*"
const PARTICLE = '(?:von|van|de|der|den|zu|da|di|del|la|le|y)'
const RUN_RE = new RegExp(`(?<![\\p{L}\\d])${WORD}(?:\\s(?:${PARTICLE}\\s)?${WORD}){0,3}(?![\\p{L}\\d])`, 'gu')

/** Does position i start a sentence (text start, after . ! ? : ; a line break or a list marker)? */
function sentenceStart(text, i) {
  const before = text.slice(Math.max(0, i - 6), i)
  return i === 0 || /(?:[.!?:;]\s+|\n\s*|^\s*|[(\-–•]\s*|\d[.)]\s+)$/.test(before)
}

/** Capitalised runs, minus sentence-initial stop words; single words at a sentence start are skipped. */
function ngrams(text, { max = 4000 } = {}) {
  const out = []
  for (const m of text.matchAll(RUN_RE)) {
    let words = m[0].split(/\s+/)
    let start = m.index
    // Leading stop words and the particles they leave behind ("Zwischen der Alpenbau" → "Alpenbau").
    while (words.length && (STOP.has(words[0]) || new RegExp(`^${PARTICLE}$`).test(words[0]))) { start += words[0].length + 1; words = words.slice(1) }
    while (words.length && STOP.has(words[words.length - 1])) words = words.slice(0, -1)
    if (!words.length) continue
    // A sentence's first word is capitalised anyway: it does not count ("Kann Huber …" → "Huber").
    // Names at a sentence start are still proposed by the first-name source and the lists.
    if (sentenceStart(text, start)) { start += words[0].length + 1; words = words.slice(1) }
    if (!words.length) continue
    const value = words.join(' ')
    if (value.length < 3) continue
    out.push({ kind: 'OTHER', start, end: start + value.length, confidence: 0.3 })
    if (out.length >= max) break
  }
  return out
}

/** A first name followed by one to three capitalised words → a likely person. */
function names(text, { extra = null } = {}) {
  const out = []
  for (const m of text.matchAll(RUN_RE)) {
    const words = m[0].split(/\s+/)
    for (let i = 0; i < words.length - 1; i++) {
      if (!isFirstName(words[i], extra)) continue
      const start = m.index + words.slice(0, i).join(' ').length + (i ? 1 : 0)
      const value = words.slice(i).filter((w, j) => j === 0 || !STOP.has(w)).join(' ')
      if (value.split(' ').length < 2) continue
      out.push({ kind: 'PERSON', start, end: start + value.length, confidence: 0.6 })
      break
    }
  }
  return out
}

register({ id: 'names', label: 'Common first names', find: async (text) => names(text) })
register({ id: 'ngrams', label: 'Capitalised words', find: async (text) => ngrams(text) })
register({
  id: 'gliner',
  label: 'GLiNER-X small (name finder)',
  available: () => require('./pii_ner').status().installed,
  find: (text, opts) => require('./pii_ner').find(text, opts),
})

/**
 * Candidates from every available source (or the ones named in `only`).
 * @returns {Promise<{ found: Array<{ kind, start, end, confidence, source }>, used: string[] }>}
 */
async function find(text, { signal, only = null, skip = [] } = {}) {
  const found = []
  const used = []
  for (const s of sources.values()) {
    if ((only && !only.includes(s.id)) || skip.includes(s.id) || !safe(() => s.available())) continue
    try {
      for (const f of await s.find(text, { signal }) || []) if (f && f.end > f.start) found.push({ ...f, source: s.id })
      used.push(s.id)
    } catch (err) { console.warn(`[redaction] candidate source ${s.id} failed:`, err.message) }
  }
  return { found, used }
}

module.exports = { register, unregister, list, find, ngrams, names, STOP }
