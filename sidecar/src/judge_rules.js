"use strict"
/**
 * Rule checks for the judge — no model needed.
 *
 * The judge is an agent with its own fresh context that rechecks another
 * agent's work. Before it runs, these checks look for the mistakes an LLM
 * makes most often when it restates a source: every number, date and
 * section reference (§ 16, Art. 6, čl. 6) in a claim should appear in the
 * source it relies on. What does not appear is handed to the judge as a
 * list of POSSIBLE mismatches — pointers to check, which can be wrong
 * (a number may be computed, a date may be written differently). The judge
 * decides; if the judge is unavailable, the lawyer sees the list.
 *
 *   extract(text)                → { numbers, dates, sections }
 *   mismatches(claim, sources)   → [{ kind, value, text, message }]
 *   proposalChanges(passage, proposal, summary) → numbers/dates the proposal
 *                                  introduces that neither the clause nor the summary mentions
 *   forPrompt(list)              → lines for the judge's context
 */

// ── dates ────────────────────────────────────────────────────────────────
// Month names (nominative and common inflected forms) in DE, EN, FR, CS, SK, PL, RO, HU, IT.
const MONTHS = [
  ['jan', 'january', 'januar', 'jänner', 'janvier', 'leden', 'ledna', 'január', 'januára', 'styczeń', 'stycznia', 'ianuarie', 'gennaio'],
  ['feb', 'february', 'februar', 'feber', 'février', 'únor', 'února', 'február', 'februára', 'luty', 'lutego', 'februarie', 'febbraio'],
  ['mar', 'march', 'märz', 'mars', 'březen', 'března', 'marec', 'marca', 'marzec', 'martie', 'március', 'marzo'],
  ['apr', 'april', 'avril', 'duben', 'dubna', 'apríl', 'apríla', 'kwiecień', 'kwietnia', 'aprilie', 'április', 'aprile'],
  ['may', 'mai', 'květen', 'května', 'máj', 'mája', 'maj', 'maja', 'május', 'maggio'],
  ['jun', 'june', 'juni', 'juin', 'červen', 'června', 'jún', 'júna', 'czerwiec', 'czerwca', 'iunie', 'június', 'giugno'],
  ['jul', 'july', 'juli', 'juillet', 'červenec', 'července', 'júl', 'júla', 'lipiec', 'lipca', 'iulie', 'július', 'luglio'],
  ['aug', 'august', 'août', 'srpen', 'srpna', 'sierpień', 'sierpnia', 'augusztus', 'agosto'],
  ['sep', 'sept', 'september', 'septembre', 'září', 'septembra', 'wrzesień', 'września', 'septembrie', 'szeptember', 'settembre'],
  ['oct', 'october', 'oktober', 'octobre', 'říjen', 'října', 'október', 'októbra', 'październik', 'października', 'octombrie', 'ottobre'],
  ['nov', 'november', 'novembre', 'listopad', 'listopadu', 'novembra', 'listopada', 'noiembrie'],
  ['dec', 'december', 'dezember', 'décembre', 'prosinec', 'prosince', 'decembra', 'grudzień', 'grudnia', 'decembrie', 'dicembre'],
]
const MONTH_OF = new Map()
MONTHS.forEach((names, i) => names.forEach((n) => MONTH_OF.set(n, i + 1)))
const MONTH_RE = [...MONTH_OF.keys()].sort((a, b) => b.length - a.length).map((m) => m.replace(/\./g, '\\.')).join('|')

const pad = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null)
const year4 = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y))

const DATE_RES = [
  // 2026-10-30
  { re: /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, f: (m) => [ymd(+m[1], +m[2], +m[3])] },
  // 30.10.2026, 30. 10. 2026 (DE/CS/SK/PL/HU-style day first), 2026.10.30 (HU)
  { re: /(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?![\d])/g, f: (m) => [ymd(year4(m[3]), +m[2], +m[1])] },
  { re: /(?<![\d.])(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})\.?(?!\d)/g, f: (m) => [ymd(+m[1], +m[2], +m[3])] },
  // 30/10/2026 or 10/30/2026: both readings
  { re: /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\d/])/g, f: (m) => [ymd(+m[3], +m[2], +m[1]), ymd(+m[3], +m[1], +m[2])] },
  // 30. Oktober 2026, 30 October 2026, 30 octombrie 2026
  { re: new RegExp(`(?<![\\p{L}\\d])(\\d{1,2})\\.?\\s+(${MONTH_RE})\\.?,?\\s+(\\d{4})(?!\\d)`, 'giu'), f: (m) => [ymd(+m[3], MONTH_OF.get(m[2].toLowerCase()), +m[1])] },
  // October 30, 2026
  { re: new RegExp(`(?<![\\p{L}])(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, 'giu'), f: (m) => [ymd(+m[3], MONTH_OF.get(m[1].toLowerCase()), +m[2])] },
  // 2026. október 30. (HU)
  { re: new RegExp(`(?<!\\d)(\\d{4})\\.\\s+(${MONTH_RE})\\s+(\\d{1,2})\\.?`, 'giu'), f: (m) => [ymd(+m[1], MONTH_OF.get(m[2].toLowerCase()), +m[3])] },
]

function dates(text) {
  const out = []
  for (const { re, f } of DATE_RES) {
    for (const m of String(text).matchAll(re)) {
      const values = f(m).filter(Boolean)
      if (values.length) out.push({ text: m[0].trim(), values, start: m.index, end: m.index + m[0].length })
    }
  }
  return dropOverlaps(out)
}

// ── section references ───────────────────────────────────────────────────
// § 16, §§ 16 und 17, § 16a, Art. 6, Article 6(1), Artikel 6, čl. 6, art. 6, Section 16, Sec. 16.
const SEC_RE = /(§§?|(?<![\p{L}])(?:Art(?:\.|ikel|icle|icolo|ículo|icolul|ykuł|\.)?|čl\.|Čl\.|článek|článok|cikk|Section|Sec\.|Rule|Regulation))\s*(\d+[a-z]?)((?:\s*(?:,|und|and|a|i|és|și|et|bis|to|-|–)\s*\d+[a-z]?)*)/giu
function sections(text) {
  const out = []
  for (const m of String(text).matchAll(SEC_RE)) {
    const art = /^§/.test(m[1]) ? '§' : /^(sec|section|rule|regulation)/i.test(m[1]) ? 'sec' : 'art'
    const nums = [m[2], ...String(m[3] || '').split(/[^\da-z]+/i).filter((x) => /^\d+[a-z]?$/i.test(x))]
    // A range "§§ 3 bis 7" lists only its ends; the source may list them all — the ends are what we check.
    out.push({ text: m[0].trim(), values: nums.map((n) => `${art}${n.toLowerCase()}`), start: m.index, end: m.index + m[0].length })
  }
  return out
}

// ── numbers ──────────────────────────────────────────────────────────────
const NUM_RE = /(?<![\p{L}\d.,])(\d{1,3}(?:[.,'’   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?![\d])/gu

/** Every value a written number may mean ("100.000" is 100000 in German, 100 in English; both count). */
function numberValues(s) {
  const t = s.replace(/[\u00a0\u202f ’']/g, '_')
  const vals = new Set()
  if (/^\d{1,3}(?:[_.,]\d{3})+(?:[.,]\d+)?$/.test(t)) {
    const groupSep = t.match(/[_.,]/)[0]
    // "100.000,50": the first separator groups; a different last one is the decimal mark.
    const lastIdx = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','))
    const lastSep = lastIdx >= 0 ? t[lastIdx] : null
    if (lastSep && lastSep !== groupSep) vals.add(Number(`${t.slice(0, lastIdx).replace(/[_.,]/g, '')}.${t.slice(lastIdx + 1)}`))
    else vals.add(Number(t.replace(/[_.,]/g, '')))
    // One "." or "," may also be a decimal mark ("1,500" is 1.5 in German).
    if ((t.match(/[_.,]/g) || []).length === 1 && groupSep !== '_') vals.add(Number(t.replace(groupSep, '.')))
  } else {
    vals.add(Number(t.replace(',', '.')))
  }
  return [...vals].filter((v) => Number.isFinite(v))
}

function numbers(text, skip = []) {
  const out = []
  for (const m of String(text).matchAll(NUM_RE)) {
    const start = m.index
    const end = start + m[0].length
    if (skip.some((s) => start < s.end && s.start < end)) continue
    out.push({ text: m[0], values: numberValues(m[0]), start, end })
  }
  return out
}

function dropOverlaps(list) {
  const taken = []
  for (const x of [...list].sort((a, b) => (b.end - b.start) - (a.end - a.start))) if (!taken.some((t) => x.start < t.end && t.start < x.end)) taken.push(x)
  return taken.sort((a, b) => a.start - b.start)
}

/** Numbers, dates and section references in a text (numbers inside dates and references are not counted twice). */
function extract(text) {
  const t = String(text || '')
  const d = dates(t)
  const s = sections(t)
  return { dates: d, sections: s, numbers: numbers(t, [...d, ...s]) }
}

// ── comparing ────────────────────────────────────────────────────────────
function valueSet(texts) {
  const all = { numbers: new Set(), dates: new Set(), sections: new Set() }
  for (const t of texts) {
    const e = extract(t)
    for (const k of Object.keys(all)) for (const x of e[k]) for (const v of x.values) all[k].add(typeof v === 'number' ? String(v) : v)
    // A date in the source also counts as its year, month and day numbers ("by 2026" against "31.12.2026").
    for (const x of e.dates) for (const v of x.values) for (const part of v.split('-')) all.numbers.add(String(Number(part)))
    // Section numbers count as plain numbers too (a law chunk headed "16." for "§ 16").
    for (const x of e.sections) for (const v of x.values) { const n = v.replace(/^(§|art|sec)/, ''); all.numbers.add(String(Number.parseInt(n, 10))); all.sections.add(`any${n}`) }
  }
  return all
}

const UNIT_AFTER = /^\s?(?:%|‰|€|\$|£|eur|euro|chf|czk|kč|pln|zł|ron|lei|huf|ft|usd|gbp|days?|weeks?|months?|years?|hours?|tage?n?|wochen?|monate?n?|jahre?n?|stunden?|werktage?n?|jours?|mois|ans?|semaines?|dn[íůy]|dní|týdn[ůy]|měsíc[eůí]?|mesiac[eov]?|rok[uy]?|let|dni|tygodni[e]?|miesi[ęą]c[ey]?|lat|zile|luni|ani|nap|hét|hónap|év)\b/iu
const UNIT_BEFORE = /(?:€|\$|£|eur|euro|chf|czk|pln|ron|huf|usd|gbp)\s?$/iu
function unitAround(text, n) {
  return UNIT_AFTER.test(text.slice(n.end, n.end + 14)) || UNIT_BEFORE.test(text.slice(Math.max(0, n.start - 6), n.start))
}

const WORDS = {
  number: (v) => `The number “${v}” does not appear in the cited source.`,
  date: (v) => `The date “${v}” does not appear in the cited source.`,
  section: (v) => `The reference “${v}” does not appear in the cited source.`,
}

/**
 * Numbers, dates and references in `claim` that none of the sources contains.
 * @param {string} claim
 * @param {string|string[]} sources
 * @param {object} opts  ignore: [string] texts whose numbers count as known (the question)
 * @returns {Array<{ kind: 'number'|'date'|'section', value: string, message: string }>}
 */
function mismatches(claim, sources, { ignore = [], max = 12 } = {}) {
  const src = (Array.isArray(sources) ? sources : [sources]).map((s) => String(s || '')).filter(Boolean)
  if (!src.length) return []
  const known = valueSet([...src, ...ignore.map(String)])
  const c = extract(claim)
  const out = []
  const seen = new Set()
  const add = (kind, value) => { const k = `${kind}:${value}`; if (seen.has(k) || out.length >= max) return; seen.add(k); out.push({ kind, value, message: WORDS[kind](value) }) }
  for (const d of c.dates) if (!d.values.some((v) => known.dates.has(v))) add('date', d.text)
  for (const s of c.sections) {
    // Each referenced number must appear as a reference of the same kind, or (for "Art."/"Section") of any kind.
    const missing = s.values.filter((v) => !known.sections.has(v) && !known.sections.has(`any${v.replace(/^(§|art|sec)/, '')}`))
    if (missing.length) add('section', s.text)
  }
  for (const n of c.numbers) {
    // Single digits ("2 parties", "1." list markers) are too common to be worth a flag — unless they
    // carry a unit or a currency ("6 Monate", "3 %", "EUR 5"): periods and amounts matter.
    if (n.values.every((v) => Number.isInteger(v) && v < 10) && !unitAround(claim, n)) continue
    if (!n.values.some((v) => known.numbers.has(String(v)))) add('number', n.text)
  }
  return out
}

/**
 * Concrete facts a proposed rewrite brings in that neither the current clause
 * nor the summary mentions (a silently changed amount, period or date).
 */
function proposalChanges(passage, proposal, summary = '') {
  return mismatches(proposal, [passage, summary]).filter((m) => m.kind !== 'section').map((m) => ({
    ...m, message: m.kind === 'date' ? `The proposal introduces the date “${m.value}”, which is not in the clause and the summary does not mention it.` : `The proposal introduces the number “${m.value}”, which is not in the clause and the summary does not mention it.`,
  }))
}

/** Lines for the judge's context. */
function forPrompt(list) {
  return (list || []).map((m) => `- ${m.message}`).join('\n')
}

module.exports = { extract, mismatches, proposalChanges, forPrompt, numberValues, dates, sections }
