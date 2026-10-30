"use strict"
/**
 * What the redaction check looks for, per country — one data-driven list.
 *
 * Each entry:
 *   id          stable name ("at.svnr")
 *   country     ISO code or "*" (any country)
 *   kind        placeholder kind: [[KIND_n]] (EMAIL, PHONE, IBAN, BIC, CARD,
 *               ID, TAXID, REGNO, CASENO, DATE, ADDRESS)
 *   label       { en, de } what the lawyer reads in the check
 *   re          the pattern (global flag; group 1, when present, is the part hidden)
 *   validate    optional: (match) → true when the check digits/date are right
 *   context     optional: a pattern that must appear just before the match
 *               (within `window` characters) — for numbers that look like any number
 *   confidence  0..1; below 0.5 a finding is shown in the check but not ticked
 *               and not hidden automatically
 *
 * Add a country by adding entries here (and tests in test/redaction.test.js).
 * Checksums cut false positives; a valid checksum is no proof that the
 * number belongs to a person.
 */

const digits = (s) => String(s).replace(/\D/g, '')
const D = (s, i) => +s[i]

// ── check digits ────────────────────────────────────────────────────────

/** IBAN: ISO 13616 mod 97 = 1. */
function ibanOk(m) {
  const s = String(m).replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  const r = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of r) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const c of v) rem = (rem * 10 + +c) % 97
  }
  return rem === 1
}

/** Luhn (cards, CH UID uses mod 11 instead). */
function luhnOk(m) {
  const s = digits(m)
  if (s.length < 13 || s.length > 19 || /^(\d)\1+$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    let d = +s[s.length - 1 - i]
    if (i % 2) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

/** A real calendar date (yy two digits → any century). */
function dateOk(day, month, year) {
  if (month < 1 || month > 12 || day < 1) return false
  const dim = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day <= dim
}

/** AT Sozialversicherungsnummer: 3 digits serial, check digit, ddmmyy. */
function atSvnrOk(m) {
  const s = digits(m)
  if (s.length !== 10 || s[0] === '0') return false
  const w = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6]
  let sum = 0
  for (let i = 0; i < 10; i++) sum += D(s, i) * w[i]
  const check = sum % 11
  if (check === 10 || check !== D(s, 3)) return false
  const dd = +s.slice(4, 6); const mm = +s.slice(6, 8)
  // Day/month may be unknown in the register (01.01., or month 13–15 for refugees with unknown dates).
  return (mm >= 1 && mm <= 15) && dd >= 1 && dd <= 31
}

/** DE Steuer-ID: 11 digits, ISO 7064 MOD 11,10; one digit repeats 2–3 times in the first ten. */
function deTaxIdOk(m) {
  const s = digits(m)
  if (s.length !== 11 || s[0] === '0') return false
  const counts = {}
  for (const c of s.slice(0, 10)) counts[c] = (counts[c] || 0) + 1
  const rep = Object.values(counts).filter((n) => n > 1)
  if (rep.length !== 1 || rep[0] > 3) return false
  let product = 10
  for (let i = 0; i < 10; i++) {
    let sum = (D(s, i) + product) % 10
    if (sum === 0) sum = 10
    product = (sum * 2) % 11
  }
  let check = 11 - product
  if (check === 10) check = 0
  return check === D(s, 10)
}

/** DE Rentenversicherungs-/Sozialversicherungsnummer: 2 area, ddmmyy, letter, 2 serial, check. */
function deSvnrOk(m) {
  const s = String(m).replace(/\s+/g, '').toUpperCase()
  const x = /^(\d{2})(\d{2})(\d{2})(\d{2})([A-Z])(\d{2})(\d)$/.exec(s)
  if (!x) return false
  const dd = +x[2]; const mm = +x[3]
  if (!(dd >= 1 && dd <= 31 + 30) || !(mm >= 1 && mm <= 12)) return false
  const letter = String(x[5].charCodeAt(0) - 64).padStart(2, '0')
  const n = x[1] + x[2] + x[3] + x[4] + letter + x[6]
  const w = [2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1]
  let sum = 0
  for (let i = 0; i < 12; i++) { const p = D(n, i) * w[i]; sum += Math.floor(p / 10) + (p % 10) }
  return sum % 10 === +x[7]
}

/** EAN-13 check digit (CH AHV-Nr 756.xxxx.xxxx.xx). */
function ean13Ok(m) {
  const s = digits(m)
  if (s.length !== 13) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += D(s, i) * (i % 2 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === D(s, 12)
}

/** CH UID (CHE-123.456.789): mod 11 with weights 5,4,3,2,7,6,5,4. */
function chUidOk(m) {
  const s = digits(m)
  if (s.length !== 9) return false
  const w = [5, 4, 3, 2, 7, 6, 5, 4]
  let sum = 0
  for (let i = 0; i < 8; i++) sum += D(s, i) * w[i]
  const c = 11 - (sum % 11)
  if (c === 10) return false
  return (c === 11 ? 0 : c) === D(s, 8)
}

/** CZ/SK rodné číslo: yymmdd/xxx(x); 10 digits divisible by 11 (pre-1985: mod 11 = 10 → check 0). */
function rcOk(m) {
  const s = digits(m)
  if (s.length !== 10) return false
  const yy = +s.slice(0, 2); let mm = +s.slice(2, 4); const dd = +s.slice(4, 6)
  if (mm > 70) mm -= 70; else if (mm > 50) mm -= 50; else if (mm > 20) mm -= 20
  const year = yy < 54 ? 2000 + yy : 1900 + yy
  if (!dateOk(dd, mm, year)) return false
  const n = +s.slice(0, 9); const c = D(s, 9)
  const r = n % 11
  return (r === 10 ? 0 : r) === c
}

/** PL PESEL: weights 1,3,7,9,…; month carries the century. */
function peselOk(m) {
  const s = digits(m)
  if (s.length !== 11) return false
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
  let sum = 0
  for (let i = 0; i < 10; i++) sum += D(s, i) * w[i]
  if ((10 - (sum % 10)) % 10 !== D(s, 10)) return false
  let mm = +s.slice(2, 4); const dd = +s.slice(4, 6); let year = +s.slice(0, 2)
  if (mm > 80) { mm -= 80; year += 1800 } else if (mm > 60) { mm -= 60; year += 2200 } else if (mm > 40) { mm -= 40; year += 2100 } else if (mm > 20) { mm -= 20; year += 2000 } else year += 1900
  return dateOk(dd, mm, year)
}

/** PL NIP: weights 6,5,7,2,3,4,5,6,7; sum mod 11 = check (10 is invalid). */
function nipOk(m) {
  const s = digits(m)
  if (s.length !== 10) return false
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  let sum = 0
  for (let i = 0; i < 9; i++) sum += D(s, i) * w[i]
  const c = sum % 11
  return c !== 10 && c === D(s, 9)
}

/** RO CNP: weights 279146358279; mod 11 (10 → 1); a real birth date. */
function cnpOk(m) {
  const s = digits(m)
  if (s.length !== 13 || s[0] === '0') return false
  const w = '279146358279'
  let sum = 0
  for (let i = 0; i < 12; i++) sum += D(s, i) * +w[i]
  let c = sum % 11
  if (c === 10) c = 1
  if (c !== D(s, 12)) return false
  const cent = { 1: 1900, 2: 1900, 3: 1800, 4: 1800, 5: 2000, 6: 2000, 7: 1900, 8: 1900, 9: 1900 }[s[0]]
  return dateOk(+s.slice(5, 7), +s.slice(3, 5), cent + +s.slice(1, 3))
}

/** RO CUI/CIF: key 753217532, right-aligned; (sum*10) mod 11 (10 → 0). */
function cuiOk(m) {
  const s = digits(m)
  if (s.length < 2 || s.length > 10) return false
  const key = '753217532'
  const body = s.slice(0, -1).padStart(9, '0')
  let sum = 0
  for (let i = 0; i < 9; i++) sum += D(body, i) * +key[i]
  let c = (sum * 10) % 11
  if (c === 10) c = 0
  return c === D(s, s.length - 1)
}

/** HU TAJ: 9 digits; odd places ×3, even ×7; sum mod 10 = 9th digit. */
function tajOk(m) {
  const s = digits(m)
  if (s.length !== 9) return false
  let sum = 0
  for (let i = 0; i < 8; i++) sum += D(s, i) * (i % 2 ? 7 : 3)
  return sum % 10 === D(s, 8)
}

/** HU adóazonosító jel: 10 digits starting with 8; Σ d_i·i (i=1..9) mod 11 = 10th. */
function huTaxOk(m) {
  const s = digits(m)
  if (s.length !== 10 || s[0] !== '8') return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += D(s, i) * (i + 1)
  const c = sum % 11
  return c !== 10 && c === D(s, 9)
}

/** CZ/SK IČO: weights 8..2; check = (11 − sum mod 11) mod 10. */
function icoOk(m) {
  const s = digits(m).padStart(8, '0')
  if (s.length !== 8) return false
  let sum = 0
  for (let i = 0; i < 7; i++) sum += D(s, i) * (8 - i)
  return (11 - (sum % 11)) % 10 === D(s, 7)
}

/** US SSN: no 000/666/9xx area, no 00 group, no 0000 serial. */
function ssnOk(m) {
  const s = digits(m)
  if (s.length !== 9) return false
  const a = s.slice(0, 3); const g = s.slice(3, 5); const n = s.slice(5)
  return a !== '000' && a !== '666' && a[0] !== '9' && g !== '00' && n !== '0000'
}

/** US EIN: the IRS's assigned prefixes. */
const EIN_PREFIXES = new Set('01 02 03 04 05 06 10 11 12 13 14 15 16 20 21 22 23 24 25 26 27 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 71 72 73 74 75 76 77 80 81 82 83 84 85 86 87 88 90 91 92 93 94 95 98 99'.split(' '))
function einOk(m) {
  const s = digits(m)
  return s.length === 9 && EIN_PREFIXES.has(s.slice(0, 2))
}

/**
 * A phone number, not an amount, a date or a time span: it starts like one
 * (+, 00, 0, a bracket), or is grouped 3-3-3/3-3-4 (CZ, PL, SK, US), or
 * "Tel." stands before it.
 */
function phoneOk(m, before = '') {
  const t = String(m).trim()
  const s = digits(t)
  if (s.length < 8 || s.length > 15) return false
  if (/^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) return false
  if (/(?:€|EUR|USD|CHF|CZK|PLN|RON|HUF|Kč|zł|lei|Ft|\$)\s*$/i.test(before)) return false
  if (/(?:Tel\.?|Telefon|Phone|Mobil(?:e)?|Handy|Fax|tel\.|telefon|mobil|mob\.|telefonszám)\s*(?:\+|Nr\.?|No\.?)?\s*[:.]?\s*$/i.test(before)) return true
  if (/^(?:\+|00|0|\()/.test(t)) return true
  return /^\d{3}[ -]\d{3}[ -]\d{3,4}$/.test(t)
}

// ── building blocks ─────────────────────────────────────────────────────

const L = '\\p{Lu}[\\p{L}\'’-]*' // a capitalised word
const W = '[\\p{L}\'’.-]+' // any word
const NUM = '\\d{1,5}[a-zA-Z]?(?:\\s?[-/]\\s?\\d{1,5}[a-zA-Z]?)*' // house number: 12, 12a, 12/3/7, 12-14
const MONTHS = 'Jänner|Januar|Jan\\.?|Februar|Feber|Feb\\.?|März|Mär\\.?|April|Apr\\.?|Mai|Juni|Juli|August|Aug\\.?|September|Sept?\\.?|Oktober|Okt\\.?|November|Nov\\.?|Dezember|Dez\\.?|January|February|March|May|June|July|October|Oct\\.?|December|Dec\\.?|ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince|januára|februára|marca|apríla|mája|júna|júla|augusta|septembra|októbra|novembra|decembra|stycznia|lutego|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|septembrie|octombrie|noiembrie|decembrie|január|február|március|április|május|június|július|augusztus|szeptember|október|december'
const DATE = `(?:\\d{1,2}\\.\\s?\\d{1,2}\\.\\s?\\d{2,4}|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{4}\\.\\s?\\d{2}\\.\\s?\\d{2}\\.?|\\d{1,2}\\.?\\s(?:${MONTHS})\\s\\d{4}|(?:${MONTHS})\\s\\d{1,2},?\\s\\d{4})`
const re = (s, f = 'gu') => new RegExp(s, f)

// Street words per language family (the end of a street name, or its prefix).
const STREET_SUFFIX = '(?:[Ss]traße|[Ss]trasse|[Ss]tr\\.|[Gg]asse|[Ww]eg|[Pp]latz|[Aa]llee|[Rr]ing|[Uu]fer|[Dd]amm|[Ss]teig|[Zz]eile|[Kk]ai|[Pp]romenade|[Gg]ürtel|[Gg]raben|[Mm]arkt|[Hh]of|[Cc]haussee|[Gg]asse)'
const STREET_PREFIX_CEE = '(?:ul\\.|ulica|ulicy|al\\.|aleja|alei|pl\\.|plac|os\\.|osiedle|Str\\.|Strada|Bd\\.|Bdul\\.|Bulevardul|Calea|Aleea|Șos\\.|Şos\\.|Șoseaua|Piața|nám\\.|náměstí|námestie|tř\\.|třída)'
const STREET_SUFFIX_HU = '(?:utca|u\\.|út|útja|tér|tere|körút|krt\\.|köz|sor|sétány|rakpart|fasor)'
const STREET_SUFFIX_US = '(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Parkway|Pkwy|Terrace|Highway|Hwy|Square|Sq)'
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY'
const CITY = `${L}(?:[\\s-]${L}){0,2}(?:\\s\\d{1,2})?` // Wien, Frankfurt am Main (am is lower… see below), Praha 1
const CITY_DE = `${L}(?:\\s(?:am|an der|im|in der|bei|ob der)\\s${L}|[\\s-]${L}){0,2}`

// ── the list ────────────────────────────────────────────────────────────

const PATTERNS = [
  // Contact
  { id: 'email', country: '*', kind: 'EMAIL', label: { en: 'E-mail address', de: 'E-Mail-Adresse' }, re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, confidence: 0.99 },
  { id: 'phone', country: '*', kind: 'PHONE', label: { en: 'Phone number', de: 'Telefonnummer' }, re: /(?<![\w+./-])(?:\+|00)?\d{1,4}[ /.-]?\(?\d{1,5}\)?(?:[ /.-]?\d{2,6}){1,4}(?![\w/-]|\.\d)/g, validate: phoneOk, confidence: 0.75 },

  // Money and payment
  { id: 'iban', country: '*', kind: 'IBAN', label: { en: 'IBAN (bank account)', de: 'IBAN (Bankkonto)' }, re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, validate: ibanOk, confidence: 0.99 },
  { id: 'bic', country: '*', kind: 'BIC', label: { en: 'BIC / SWIFT code', de: 'BIC / SWIFT-Code' }, re: /\b[A-Z]{4}(?:AT|DE|CH|CZ|SK|PL|RO|HU|US|LI|IT|FR|NL|BE|LU|GB|IE|ES|SI|HR)[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g, context: /\b(?:BIC|SWIFT|Swift-Code|BIC-Code|kod SWIFT|cod SWIFT)\b[\s:.-]*$/i, window: 20, confidence: 0.95 },
  { id: 'card', country: '*', kind: 'CARD', label: { en: 'Card number', de: 'Kartennummer' }, re: /\b(?:\d[ -]?){12,18}\d\b/g, validate: luhnOk, confidence: 0.9 },

  // Dates of birth (only with the words around them)
  { id: 'dob', country: '*', kind: 'DATE', label: { en: 'Date of birth', de: 'Geburtsdatum' }, re: re(`(${DATE})`), context: /(?:geb\.|geboren(?:\s+am)?|Geburtsdatum|Geb\.-?Datum|born(?:\s+on)?|date of birth|DOB|d\.o\.b\.|nar\.|narozen[áa]?|narodený|narodená|dátum narodenia|datum narození|ur\.|urodzon[ya]|data urodzenia|născut[ăa]?|data nașterii|data naşterii|szül\.|született|születési idő)\s*[:,]?\s*(?:am|on|dne|dňa|dnia|în|la)?\s*$/iu, window: 40, confidence: 0.95 },

  // Addresses
  { id: 'addr.dach', country: 'AT DE CH', kind: 'ADDRESS', label: { en: 'Street address', de: 'Anschrift' }, re: re(`(?<![\\p{L}])(?!(?:Die|Der|Das|Den|Dem|Des|Eine|Einer|Ein|Jede|Diese|Dieser|Jeder|Unsere|Ihre|Seine)\\s)(?:${L}[\\s-](?:\\p{Lu}[\\p{Ll}ß]*?)?|\\p{Lu}[\\p{Ll}ß]*?)${STREET_SUFFIX}\\s${NUM}(?:\\s?/\\s?(?:Top|Stiege|Tür)\\s?\\d+)*(?:,?\\s(?:(?:A|D|CH)-)?\\d{4,5}\\s${CITY_DE})?`, 'gu'), confidence: 0.85 },
  { id: 'addr.dach2', country: 'AT DE CH', kind: 'ADDRESS', label: { en: 'Street address', de: 'Anschrift' }, re: re(`(?<![\\p{L}])(?:Am|An der|Auf der|Im|In der|Zum|Zur)\\s${L}\\s${NUM},?\\s(?:(?:A|D|CH)-)?\\d{4,5}\\s${CITY_DE}`, 'gu'), confidence: 0.8 },
  { id: 'addr.dach.zip', country: 'AT DE CH', kind: 'ADDRESS', label: { en: 'Postcode and town', de: 'Postleitzahl und Ort' }, re: re(`(?<=,\\s)(?:(?:A|D|CH)-)?\\d{4,5}\\s${CITY_DE}(?=[\\s,.;)]|$)`, 'gu'), confidence: 0.6 },
  { id: 'addr.cz', country: 'CZ SK', kind: 'ADDRESS', label: { en: 'Street address', de: 'Anschrift' }, re: re(`(?:${STREET_PREFIX_CEE}\\s)?${L}(?:\\s${L}){0,3}\\s\\d{1,5}(?:/\\d{1,5}[a-z]?)?,\\s\\d{3}\\s?\\d{2}\\s${CITY}`, 'gu'), confidence: 0.85 },
  { id: 'addr.pl', country: 'PL', kind: 'ADDRESS', label: { en: 'Street address', de: 'Anschrift' }, re: re(`(?:${STREET_PREFIX_CEE}\\s)${L}(?:\\s${L}){0,3}\\s${NUM}(?:\\s?(?:m\\.|lok\\.)\\s?\\d+)?(?:,?\\s\\d{2}-\\d{3}\\s${CITY})?`, 'gu'), confidence: 0.85 },
  { id: 'addr.pl.zip', country: 'PL', kind: 'ADDRESS', label: { en: 'Postcode and town', de: 'Postleitzahl und Ort' }, re: re(`(?<![\\d-])\\d{2}-\\d{3}\\s${CITY}`, 'gu'), confidence: 0.7 },
  { id: 'addr.ro', country: 'RO', kind: 'ADDRESS', label: { en: 'Street address', de: 'Anschrift' }, re: re(`(?:Str\\.|Strada|Bd\\.|Bdul\\.|Bulevardul|Calea|Aleea|Șos\\.|Şos\\.|Șoseaua|Piața)\\s${L}(?:\\s${W}){0,3}\\s?,?\\s(?:nr\\.?\\s?)\\d{1,5}[A-Z]?(?:,\\s(?:bl\\.|sc\\.|et\\.|ap\\.)\\s?\\w+){0,4}(?:,\\s(?:sector\\s\\d|${CITY}))?(?:,\\s(?:cod poștal\\s)?\\d{6})?`, 'gu'), confidence: 0.85 },
  { id: 'addr.hu', country: 'HU', kind: 'ADDRESS', label: { en: 'Street address', de: 'Anschrift' }, re: re(`(?:\\d{4}\\s${CITY},?\\s)?${L}(?:\\s${L}){0,2}\\s${STREET_SUFFIX_HU}\\s\\d{1,4}(?:/[A-Za-z0-9]+)?\\.?(?:\\s\\d+\\.\\s?em\\.(?:\\s\\d+\\.?)?)?`, 'gu'), confidence: 0.85 },
  { id: 'addr.us', country: 'US', kind: 'ADDRESS', label: { en: 'Street address', de: 'Anschrift' }, re: re(`\\b\\d{1,6}\\s(?:[NSEW]\\.?\\s)?${L}(?:\\s${L}){0,3}\\s${STREET_SUFFIX_US}\\.?(?:,?\\s(?:Suite|Ste\\.?|Apt\\.?|Unit|#)\\s?\\w+)?(?:,\\s${L}(?:\\s${L}){0,2},\\s(?:${US_STATES})\\s\\d{5}(?:-\\d{4})?)?`, 'gu'), confidence: 0.85 },
  { id: 'addr.us.zip', country: 'US', kind: 'ADDRESS', label: { en: 'Town, state and ZIP', de: 'Ort, Bundesstaat und ZIP' }, re: re(`\\b${L}(?:\\s${L}){0,2},\\s(?:${US_STATES})\\s\\d{5}(?:-\\d{4})?\\b`, 'gu'), confidence: 0.8 },

  // National identity and tax numbers
  { id: 'at.svnr', country: 'AT', kind: 'ID', label: { en: 'Austrian social security number', de: 'Sozialversicherungsnummer (AT)' }, re: /\b\d{4}\s?\d{6}\b/g, validate: atSvnrOk, confidence: 0.85 },
  { id: 'de.taxid', country: 'DE', kind: 'TAXID', label: { en: 'German tax ID (Steuer-ID)', de: 'Steuer-Identifikationsnummer' }, re: /\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/g, validate: deTaxIdOk, confidence: 0.75 },
  { id: 'de.svnr', country: 'DE', kind: 'ID', label: { en: 'German social insurance number', de: 'Sozialversicherungsnummer (DE)' }, re: /\b\d{2}\s?\d{6}\s?[A-Z]\s?\d{3}\b/g, validate: deSvnrOk, confidence: 0.9 },
  { id: 'ch.ahv', country: 'CH', kind: 'ID', label: { en: 'Swiss AHV number', de: 'AHV-Nummer' }, re: /\b756[.\s]?\d{4}[.\s]?\d{4}[.\s]?\d{2}\b/g, validate: ean13Ok, confidence: 0.95 },
  { id: 'czsk.rc', country: 'CZ SK', kind: 'ID', label: { en: 'Birth number (rodné číslo)', de: 'Geburtsnummer (rodné číslo)' }, re: /\b\d{6}\s?\/\s?\d{4}\b/g, validate: rcOk, confidence: 0.9 },
  { id: 'czsk.rc.plain', country: 'CZ SK', kind: 'ID', label: { en: 'Birth number (rodné číslo)', de: 'Geburtsnummer (rodné číslo)' }, re: /\b\d{10}\b/g, validate: rcOk, context: /(?:rodné číslo|rodné č\.|r\.\s?č\.|RČ|birth number)\s*[:.]?\s*$/iu, window: 25, confidence: 0.9 },
  { id: 'czsk.rc.old', country: 'CZ SK', kind: 'ID', label: { en: 'Birth number (rodné číslo)', de: 'Geburtsnummer (rodné číslo)' }, re: /\b\d{6}\s?\/\s?\d{3}\b/g, context: /(?:rodné číslo|rodné č\.|r\.\s?č\.|RČ|nar\.)\s*[:.]?\s*$/iu, window: 25, confidence: 0.8 },
  { id: 'pl.pesel', country: 'PL', kind: 'ID', label: { en: 'PESEL', de: 'PESEL' }, re: /\b\d{11}\b/g, validate: peselOk, confidence: 0.85 },
  { id: 'pl.nip', country: 'PL', kind: 'TAXID', label: { en: 'Polish tax number (NIP)', de: 'Steuernummer (NIP)' }, re: /\b(?:PL\s?)?\d{3}-\d{3}-\d{2}-\d{2}\b|\b\d{3}-\d{2}-\d{2}-\d{3}\b/g, validate: nipOk, confidence: 0.8 },
  { id: 'pl.nip.plain', country: 'PL', kind: 'TAXID', label: { en: 'Polish tax number (NIP)', de: 'Steuernummer (NIP)' }, re: /\b(?:PL\s?)?\d{10}\b/g, validate: nipOk, context: /\bNIP\s*[:.]?\s*$/iu, window: 12, confidence: 0.9 },
  { id: 'ro.cnp', country: 'RO', kind: 'ID', label: { en: 'Romanian personal number (CNP)', de: 'Personennummer (CNP)' }, re: /\b[1-9]\d{12}\b/g, validate: cnpOk, confidence: 0.9 },
  { id: 'hu.taj', country: 'HU', kind: 'ID', label: { en: 'Hungarian social security number (TAJ)', de: 'Sozialversicherungsnummer (TAJ)' }, re: /\b\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g, validate: tajOk, context: /(?:TAJ(?:-szám| szám)?|társadalombiztosítási azonosító(?: jel)?)\s*[:.]?\s*$/iu, window: 30, confidence: 0.9 },
  { id: 'hu.tax', country: 'HU', kind: 'TAXID', label: { en: 'Hungarian tax ID (adóazonosító jel)', de: 'Steuer-ID (adóazonosító jel)' }, re: /\b8\d{9}\b/g, validate: huTaxOk, confidence: 0.75 },
  { id: 'us.ssn', country: 'US', kind: 'ID', label: { en: 'US Social Security number', de: 'US-Sozialversicherungsnummer' }, re: /\b\d{3}-\d{2}-\d{4}\b/g, validate: ssnOk, confidence: 0.9 },
  { id: 'us.ssn.plain', country: 'US', kind: 'ID', label: { en: 'US Social Security number', de: 'US-Sozialversicherungsnummer' }, re: /\b\d{3}\s?\d{2}\s?\d{4}\b/g, validate: ssnOk, context: /(?:SSN|Social Security(?: No\.| Number| #)?)\s*[:#.]?\s*$/i, window: 25, confidence: 0.9 },
  { id: 'us.ein', country: 'US', kind: 'TAXID', label: { en: 'US employer ID (EIN)', de: 'US-Arbeitgeber-ID (EIN)' }, re: /\b\d{2}-\d{7}\b/g, validate: einOk, confidence: 0.75 },

  // Passports and identity cards (only with the words around them)
  { id: 'passport', country: '*', kind: 'ID', label: { en: 'Passport or ID card number', de: 'Reisepass- oder Ausweisnummer' }, re: /(?<![A-Z0-9])((?=[A-Z0-9 ]*\d)[A-Z0-9]{1,3}\s?[A-Z0-9]{5,9})\b/g, context: /(?:Reisepass(?:nummer|-Nr\.?)?|Pass(?:nummer|-Nr\.?|nr\.)|Personalausweis(?:nummer|-Nr\.?)?|Ausweis(?:nummer|-Nr\.?)|Identitätsausweis|passport(?: no\.?| number| #)?|ID card(?: no\.?| number)?|identity card(?: no\.?| number)?|driver'?s licen[cs]e(?: no\.?| number)?|Führerschein(?:nummer|-Nr\.?)?|číslo pasu|cestovní pas|č\.\s?OP|občanský průkaz|občiansky preukaz|číslo OP|numer paszportu|paszport(?:u)?(?: nr)?|dowód osobisty|dowodu osobistego|seria i numer|pașaport|paşaport|carte de identitate|CI seria|seria|útlevél(?:szám)?|személyi igazolvány(?:szám)?)\s*(?:Nr\.?|No\.?|number|nr\.?|číslo|szám|:|#)?\s*[:.]?\s*$/iu, window: 45, confidence: 0.9 },

  // Company register and tax numbers of businesses
  { id: 'at.fn', country: 'AT', kind: 'REGNO', label: { en: 'Company register number (FN)', de: 'Firmenbuchnummer (FN)' }, re: /\bFN\s?\d{1,6}\s?[a-z]\b/g, confidence: 0.95 },
  { id: 'at.uid', country: 'AT DE', kind: 'TAXID', label: { en: 'VAT number', de: 'UID-Nummer' }, re: /\b(?:ATU\d{8}|DE\d{9})\b/g, confidence: 0.9 },
  { id: 'de.hr', country: 'DE', kind: 'REGNO', label: { en: 'Commercial register number (HRB/HRA)', de: 'Handelsregisternummer (HRB/HRA)' }, re: /\b(?:HRB|HRA|GnR|PR|VR)\s?\d{1,6}(?:\s?[A-Z]{1,2}\b)?/g, confidence: 0.9 },
  { id: 'ch.uid', country: 'CH', kind: 'REGNO', label: { en: 'Swiss business ID (UID)', de: 'Unternehmens-Identifikationsnummer (UID)' }, re: /\bCHE-?\d{3}\.?\d{3}\.?\d{3}\b/g, validate: chUidOk, confidence: 0.95 },
  { id: 'czsk.ico', country: 'CZ SK', kind: 'REGNO', label: { en: 'Company ID (IČO)', de: 'Firmennummer (IČO)' }, re: /\b\d{2}\s?\d{3}\s?\d{3}\b/g, validate: icoOk, context: /(?:IČO?|IČ|ICO|IČ DPH|DIČ)\s*[:.]?\s*(?:CZ|SK)?\s*$/u, window: 15, confidence: 0.9 },
  { id: 'czsk.dic', country: 'CZ SK', kind: 'TAXID', label: { en: 'VAT number', de: 'UID-Nummer' }, re: /\b(?:CZ|SK)\d{8,10}\b/g, confidence: 0.85 },
  { id: 'pl.krs', country: 'PL', kind: 'REGNO', label: { en: 'Polish court register number (KRS)', de: 'Registernummer (KRS)' }, re: /\b\d{10}\b/g, context: /\bKRS(?:\s?(?:nr|numer|pod numerem))?\s*[:.]?\s*$/iu, window: 25, confidence: 0.9 },
  { id: 'pl.regon', country: 'PL', kind: 'REGNO', label: { en: 'Polish business number (REGON)', de: 'Unternehmensnummer (REGON)' }, re: /\b\d{9}(?:\d{5})?\b/g, context: /\bREGON\s*[:.]?\s*$/iu, window: 15, confidence: 0.9 },
  { id: 'ro.cui', country: 'RO', kind: 'TAXID', label: { en: 'Romanian business tax number (CUI)', de: 'Steuernummer (CUI)' }, re: /\b(?:RO\s?)?\d{2,10}\b/g, validate: cuiOk, context: /(?:CUI|CIF|C\.U\.I\.|cod (?:unic de înregistrare|fiscal))\s*[:.]?\s*$/iu, window: 30, confidence: 0.9 },
  { id: 'ro.onrc', country: 'RO', kind: 'REGNO', label: { en: 'Romanian trade register number', de: 'Handelsregisternummer (RO)' }, re: /\b[JFC]\d{2}\/\d{1,7}\/\d{4}\b/g, confidence: 0.95 },
  { id: 'hu.cg', country: 'HU', kind: 'REGNO', label: { en: 'Hungarian company register number', de: 'Firmenbuchnummer (HU)' }, re: /\b\d{2}-\d{2}-\d{6}\b/g, context: /(?:Cg\.|cégjegyzékszám(?:a)?|cégjegyzékszám:)\s*[:.]?\s*$/iu, window: 25, confidence: 0.9 },
  { id: 'hu.vat', country: 'HU', kind: 'TAXID', label: { en: 'Hungarian tax number (adószám)', de: 'Steuernummer (adószám)' }, re: /\b\d{8}-\d-\d{2}\b/g, confidence: 0.9 },

  // Court file numbers
  { id: 'case.ctx', country: '*', kind: 'CASENO', label: { en: 'Court file number', de: 'Aktenzeichen / Geschäftszahl' }, re: /([A-Za-zÀ-ž0-9][\wÀ-ž.]*(?:\s[\wÀ-ž.]+){0,4}\/\d{2,4}(?:[-/][\w]+)?)/gu, context: /(?:Az\.|AZ|Aktenzeichen|GZ|Gz\.|Geschäftszahl|Gesch\.\s?Z\.|sp\.\s?zn\.|spisová značka|č\.\s?j\.|sygn\.\s?akt|sygnatura(?: akt)?|dosar(?:ul)?(?: nr\.?)?|nr\. dosar|ügyszám|Case No\.?|Case Number|Docket No\.?|File No\.?)\s*[:.]?\s*$/iu, window: 30, confidence: 0.9 },
  { id: 'case.dach', country: 'AT DE', kind: 'CASENO', label: { en: 'Court file number', de: 'Aktenzeichen / Geschäftszahl' }, re: /\b(?:\d{1,3}|[IVX]{1,5})\s(?:[A-Z][a-z]{0,3}|[A-Z]{1,3}[a-z]{0,2})\s\d{1,5}\/\d{2,4}[a-z]?\b/g, confidence: 0.45 },
]

/** Same list, read by the guide and the settings: id, countries, label. */
function describe(lang = 'en') {
  return PATTERNS.map((p) => ({ id: p.id, countries: p.country === '*' ? ['*'] : p.country.split(' '), kind: p.kind, label: p.label[lang] || p.label.en, checksum: !!p.validate, needsContext: !!p.context }))
}

module.exports = {
  PATTERNS, describe,
  check: { ibanOk, luhnOk, atSvnrOk, deTaxIdOk, deSvnrOk, ean13Ok, chUidOk, rcOk, peselOk, nipOk, cnpOk, cuiOk, tajOk, huTaxOk, icoOk, ssnOk, einOk, phoneOk },
}
