"use strict"
/**
 * Finds names, numbers and addresses in a text — all on this computer.
 *
 * Four sources, combined:
 *   term       the matter's list (client, parties, people, what the lawyer
 *              ticked or added in an earlier check) and the firm's list
 *   pattern    pii_patterns.js: e-mail, phone, IBAN, cards, IDs, register and
 *              court numbers, addresses, dates of birth (checksums where they exist)
 *   heuristic  titles before names ("Dr.", "Mag.", "Herr/Frau", "pan", "Mr.")
 *              and legal forms after names ("GmbH", "s.r.o.", "sp. z o.o.", "Kft.", "LLC")
 *   model      the optional on-device name finder (pii_ner.js), passed in as findings
 *
 *   scan(text, opts) → [{ id, kind, group, text, start, end, confidence, source, label, on }]
 *
 * It can miss things — above all indirect details (a rare job title, a
 * unique event) — and it can mark things that need not be hidden. That is
 * what the lawyer's check (redaction_check.js) is for.
 */

const { PATTERNS } = require('./pii_patterns')

/** Placeholder kinds → the groups the check shows. */
const GROUPS = {
  PERSON: 'people', PARTY: 'people',
  ORG: 'orgs',
  ADDRESS: 'addresses',
  ID: 'ids', TAXID: 'ids', REGNO: 'ids', CASENO: 'ids', IBAN: 'ids', BIC: 'ids', CARD: 'ids',
  EMAIL: 'contact', PHONE: 'contact',
  DATE: 'other', OTHER: 'other',
}
const GROUP_ORDER = ['people', 'orgs', 'addresses', 'ids', 'contact', 'other']
const KINDS = Object.keys(GROUPS)
const THRESHOLD = 0.5 // below: shown in the check, not ticked, not hidden automatically

const KIND_LABELS = {
  PERSON: { en: 'Person', de: 'Person' }, PARTY: { en: 'Name from the matter', de: 'Name aus der Akte' }, ORG: { en: 'Organisation', de: 'Organisation' },
  ADDRESS: { en: 'Address', de: 'Anschrift' }, ID: { en: 'Identity number', de: 'Ausweis- oder Personennummer' }, TAXID: { en: 'Tax number', de: 'Steuernummer' },
  REGNO: { en: 'Register number', de: 'Registernummer' }, CASENO: { en: 'Court file number', de: 'Aktenzeichen' }, IBAN: { en: 'IBAN', de: 'IBAN' },
  BIC: { en: 'BIC', de: 'BIC' }, CARD: { en: 'Card number', de: 'Kartennummer' }, EMAIL: { en: 'E-mail', de: 'E-Mail' }, PHONE: { en: 'Phone', de: 'Telefon' },
  DATE: { en: 'Date of birth', de: 'Geburtsdatum' }, OTHER: { en: 'Other', de: 'Sonstiges' },
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

// ── heuristics ──────────────────────────────────────────────────────────

const CAP = "\\p{Lu}[\\p{Ll}'’-]+(?:-\\p{Lu}[\\p{Ll}'’-]+)?"
const TITLES = "(?:Herrn?|Frau|Fräulein|Dr\\.(?:\\s?(?:iur|jur|med|phil|rer\\.\\s?nat)\\.)?|Mag\\.(?:\\s?\\(FH\\))?(?:\\s?iur\\.)?|MMag\\.|DDr\\.|DI|Dipl\\.-Ing\\.|Dipl\\.-Kfm\\.|Prof\\.|Univ\\.-Prof\\.|Ing\\.|MUDr\\.|JUDr\\.|Mgr\\.|Bc\\.|PhDr\\.|RNDr\\.|Ph\\.D\\.|doc\\.|pan|pani|pana|panią|panem|paní|panu|pán|pána|pánovi|domnul|doamna|domnului|doamnei|dl\\.|dna\\.|d-na|d-l|Mr\\.?|Mrs\\.?|Ms\\.?|Miss|Hon\\.|ifj\\.|özv\\.)"
// Words after a title that are roles, not names.
const ROLE_WORDS = new Set(['klägerin', 'kläger', 'beklagte', 'beklagten', 'beklagter', 'antragsteller', 'antragstellerin', 'antragsgegner', 'antragsgegnerin', 'vorsitzende', 'vorsitzender', 'rechtsanwalt', 'rechtsanwältin', 'richter', 'richterin', 'notar', 'notarin', 'kollege', 'kollegin', 'präsident', 'präsidentin', 'bürgermeister', 'bürgermeisterin', 'geschäftsführer', 'geschäftsführerin', 'president', 'justice', 'judge', 'chairman', 'counsel', 'mandant', 'mandantin', 'zeuge', 'zeugin', 'sachverständige', 'sachverständiger', 'minister', 'ministerin', 'doktor', 'professor'])
const PERSON_RE = new RegExp(`(?<![\\p{L}])((?:${TITLES}[ \\t]+)+)((?:${CAP}|\\p{Lu}\\.)(?:[ \\t](?:(?:von|van|de|der|den|zu|da|di|del|la|le)[ \\t])?(?:${CAP}|\\p{Lu}\\.)){0,3})(?![\\p{L}])`, 'gu')

const FORMS = "(?:GmbH(?:\\s&\\sCo\\.?\\sKG)?|AG|KG|OG|OHG|SE|KGaA|e\\.\\s?U\\.|e\\.\\s?V\\.|UG(?:\\s\\(haftungsbeschränkt\\))?|PartG(?:\\smbB)?|spol\\.\\ss\\s?r\\.\\s?o\\.|s\\.\\s?r\\.\\s?o\\.|a\\.\\s?s\\.|v\\.\\s?o\\.\\s?s\\.|k\\.\\s?s\\.|sp\\.\\sz\\so\\.\\s?o\\.|sp\\.\\sj\\.|sp\\.\\sk\\.|sp\\.\\sp\\.|S\\.A\\.|SA|S\\.R\\.L\\.|SRL|S\\.C\\.S\\.|Kft\\.|Zrt\\.|Nyrt\\.|Bt\\.|Kkt\\.|LLC|L\\.L\\.C\\.|Inc\\.|Corp\\.|Corporation|Ltd\\.?|Limited|LLP|L\\.P\\.|plc|PLC|N\\.V\\.|B\\.V\\.|S\\.p\\.A\\.|S\\.r\\.l\\.|SAS|SARL)"
const FORM_END = new RegExp(`\\s${FORMS}$`, 'u')
const FORM_ONLY = new RegExp(`^${FORMS}$`, 'u')
const ORG_WORD = "(?:\\p{Lu}[\\p{L}\\d&'’.-]*|\\d+[\\p{L}\\d]*|&)"
// Spaces only between the words: an organisation's name does not continue on the next line.
const ORG_RE = new RegExp(`(?<![\\p{L}\\d])(${ORG_WORD}(?:[ \\t](?:${ORG_WORD}|und|and|a|i|és|și|şi|e|&[ \\t]Co\\.?|von|der|des|de|la|du)){0,5})[ \\t](${FORMS})(?![\\p{L}\\d])`, 'gu')
const LEAD_STOP = new Set(['die', 'der', 'das', 'den', 'dem', 'des', 'the', 'a', 'an', 'eine', 'einer', 'ein', 'firma', 'gesellschaft', 'společnost', 'spoločnosť', 'spółka', 'spółki', 'spółką', 'firmą', 'firma', 'societatea', 'societății', 'cég', 'társaság', 'mit', 'und', 'and', 'zwischen', 'between', 'von', 'bei', 'für', 'for', 'with', 'gegen', 'against', 'v.', 'vs.', 'gegenüber', 'sowie', 'als', 'as', 'by', 'to', 'of', 'in', 'zur', 'zum', 'beklagte', 'klägerin', 'kläger', 'beklagten', 'auftraggeber', 'auftragnehmer', 'käufer', 'käuferin', 'verkäufer', 'verkäuferin', 'mieter', 'mieterin', 'vermieter', 'vermieterin', 'lieferant', 'kunde', 'does', 'do', 'did', 'is', 'are', 'was', 'were', 'has', 'have', 'if', 'when', 'why', 'how', 'what', 'who', 'can', 'could', 'should', 'would', 'will', 'may', 'must', 'ist', 'hat', 'haben', 'wird', 'kann', 'soll', 'muss', 'darf', 'wenn', 'ob', 'wie', 'was', 'wer', 'warum', 'nach', 'gemäß', 'laut', 'durch', 'über', 'unter', 'auch', 'dass', 'bitte', 'please', 'check', 'prüfe', 'prüfen', 'schreibe', 'write', 'draft', 'entwirf', 'hier', 'here', 'dear', 'sehr', 'geehrte', 'liebe', 'an', 'am', 'im', 'vom', 'beim'])

// Table columns: the header says what a column holds ("DOB", "Né(e) le", "NI number", "Name"),
// so every cell below it is that kind — names and numbers in tables have no other clue.
const COLUMN_KINDS = [
  ['DATE', /^(?:dob|d\.o\.b\.?|date of birth|born|geb\.?|geboren(?: am)?|geburtsdatum|né(?:\(e\)|e)? le|date de naissance|data urodzenia|dátum narodenia|datum narození|narozen[áa]?|data nașterii|data naşterii|născut[ăa]?|születési (?:idő|dátum)|szül\.?)$/iu],
  ['ID', /(?:\bni\b(?: number| no\.?)?|nino|national insurance|ppsn?\b|pps number|n° ?ss|sécurité sociale|svnr|sv-?(?:nummer|nr\.?)|sozialversicherungsnummer|steuer-?id|pesel|rodné číslo|r\.\s?č\.|\bcnp\b|\btaj\b|adóazonosító|passport|reisepass|ausweis(?:nummer)?|id (?:number|no\.?)|personal (?:number|no\.?)|\bnip\b|číslo op|číslo dokladu)/iu],
  ['PERSON', /^(?:name|full name|employee|employee name|salarié(?:e)?|nom|nom et prénom|prénom et nom|jméno(?: a příjmení)?|meno(?: a priezvisko)?|imię i nazwisko|nazwisko i imię|nume(?: și prenume)?|nume și prenume|név|mitarbeiter(?:in)?|arbeitnehmer(?:in)?|dienstnehmer(?:in)?|zaměstnanec|zamestnanec|pracownik|angajat|munkavállaló|tenant|mieter(?:in)?|witness|zeuge|zeugin|beneficiary|heir|erbe|erbin|shareholder|gesellschafter(?:in)?|director|geschäftsführer(?:in)?)$/iu],
  ['ADDRESS', /^(?:address|home address|adresse|anschrift|wohnort|wohnadresse|adresa|adres|cím|domiciliu|bydliště|bydlisko)$/iu],
]
const CELL_OK = { DATE: /\d/, ID: /\d/, PERSON: /\p{Lu}/u, ADDRESS: /\p{L}.*\d|\d.*\p{L}/u }

function tableCells(text) {
  const out = []
  const lines = []
  let at = 0
  for (const line of text.split('\n')) { lines.push({ line, start: at }); at += line.length + 1 }
  const sep = (l) => (l.includes('|') ? '|' : l.includes('\t') ? '\t' : null)
  for (let i = 0; i < lines.length; i++) {
    const { line } = lines[i]
    const sp = sep(line)
    if (!sp || line.split(sp).length < 3) continue
    const kinds = line.split(sp).map((c) => { const t = c.trim(); const k = COLUMN_KINDS.find(([, re]) => re.test(t)); return k ? k[0] : null })
    if (!kinds.some(Boolean)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j]
      if (!row.line.trim() || sep(row.line) !== sp) break
      if (/^[\s|:+-]+$/.test(row.line)) continue // a separator line (|---|---|)
      let pos = row.start
      row.line.split(sp).forEach((cell, c) => {
        const kind = kinds[c]
        const lead = cell.length - cell.trimStart().length
        const value = cell.trim()
        if (kind && value && value.length <= 120 && CELL_OK[kind].test(value)) {
          out.push({ kind, start: pos + lead, end: pos + lead + value.length, confidence: kind === 'PERSON' ? 0.8 : 0.85, source: 'heuristic' })
        }
        pos += cell.length + sp.length
      })
      i = j
    }
  }
  return out
}

function heuristics(text) {
  const out = []
  out.push(...tableCells(text))
  for (const m of text.matchAll(PERSON_RE)) {
    let name = m[2]
    const start = m.index + m[1].length
    const words = name.split(/\s+/)
    if (words.length === 1 && ROLE_WORDS.has(words[0].toLowerCase())) continue
    if (ROLE_WORDS.has(words[0].toLowerCase())) continue
    name = name.replace(/\s+$/, '')
    out.push({ kind: 'PERSON', start, end: start + name.length, confidence: words.length > 1 ? 0.8 : 0.65, source: 'heuristic' })
  }
  for (const m of text.matchAll(ORG_RE)) {
    let lead = m[1]
    let start = m.index
    // Drop leading articles and role words: "zwischen der Alpenbau GmbH" → "Alpenbau GmbH".
    for (;;) {
      const w = /^(\S+)\s+/.exec(lead)
      if (!w || !LEAD_STOP.has(w[1].toLowerCase())) break
      lead = lead.slice(w[0].length); start += w[0].length
    }
    if (!lead || LEAD_STOP.has(lead.toLowerCase())) continue
    const end = m.index + m[0].length
    out.push({ kind: 'ORG', start, end, confidence: 0.8, source: 'heuristic' })
  }
  return out
}

// ── patterns ────────────────────────────────────────────────────────────

function patterns(text, extra = []) {
  const out = []
  for (const p of [...PATTERNS, ...extra]) {
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`)
    let m
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex++; continue }
      const sub = m[1] !== undefined && p.re.source.startsWith('(') ? m[1] : m[0]
      const start = m.index + (sub === m[0] ? 0 : m[0].indexOf(sub))
      const value = p.keepDot && /(?:\br|\d)\.$/.test(sub.trimEnd()) ? sub.trimEnd() : sub.replace(/[\s,.;:]+$/, '')
      if (!value) continue
      const before = text.slice(Math.max(0, start - (p.window || 40)), start)
      // Without the words before it, try again one character later ("Az. 2 O 123/20": the match must not swallow "Az.").
      if (p.context && !p.context.test(before)) { re.lastIndex = m.index + 1; continue }
      if (p.validate && !p.validate(value, before)) continue
      out.push({ kind: p.kind, start, end: start + value.length, confidence: p.confidence ?? 0.8, source: p.firm ? 'firm' : 'pattern', label: p.label, pattern: p.id })
    }
  }
  return out
}

// ── terms ───────────────────────────────────────────────────────────────

/** A listed person's last name counts too ("Huber" for "Mag. Johann Huber"). */
function withLastNames(terms) {
  const out = [...terms]
  for (const t of terms) {
    const kind = t.kind || 'PARTY'
    const value = String(t.text || '').trim()
    if (!['PERSON', 'PARTY'].includes(kind) || FORM_END.test(value)) continue
    const words = value.split(/\s+/)
    const last = words[words.length - 1]
    if (words.length > 1 && last.length >= 4 && /^\p{Lu}\p{Ll}/u.test(last) && !FORM_ONLY.test(last)) out.push({ text: last, kind: 'PERSON', source: t.source })
  }
  return out
}

function termHits(text, terms) {
  const out = []
  const list = [...new Map(withLastNames(terms).filter((t) => t && String(t.text || '').trim().length >= 2).map((t) => [norm(t.text), t])).values()]
    .sort((a, b) => b.text.length - a.text.length)
  for (const t of list) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(String(t.text).trim()).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu')
    // "found": seen in another text of the same check — as certain as a finding, not a listed term.
    for (const m of text.matchAll(re)) out.push({ kind: t.kind || 'PARTY', start: m.index, end: m.index + m[0].length, confidence: t.source === 'found' ? 0.8 : 1, source: t.source === 'found' ? 'spread' : (t.source || 'term') })
  }
  return out
}

// Case endings a name can carry in our languages (DE/EN genitive, CS/SK/PL declension,
// RO article, HU case suffixes). Matched after a name's stem, so "Nováková" also finds
// "Novákové"/"Novákovou", "Kowalski" "Kowalskiego", "Popescu" "Popescului", "Kovács" "Kovácsnak".
const NAME_ENDINGS = ["s", "'s", "’s", "es", "a", "á", "e", "é", "i", "í", "o", "u", "y", "ý", "ą", "ę", "ou", "ovi", "owi", "em", "om", "ej", "ého", "ému", "ým", "ých", "ými", "iego", "iemu", "im", "ich", "ul", "ului", "ei", "lui", "ăi", "nak", "nek", "val", "vel", "tól", "től", "ról", "ről", "hoz", "hez", "höz", "nál", "nél", "ért", "t", "ot", "et", "at", "ban", "ben", "ra", "re"]
  .sort((a, b) => b.length - a.length)
const STEM_DROP = /(?:ov[áa]|[aáeéiíoóuůyýăą])$/u

/** Regex source for a name word in its inflected forms, as written and in capitals. */
function nameForms(word) {
  const stems = new Set([word])
  const m = STEM_DROP.exec(word)
  if (m && word.length - 1 >= 4) stems.add(word.slice(0, -1)) // Nováková → Novákov, Kowalski → Kowalsk
  if (/ov[áa]$/u.test(word) && word.length - 3 >= 4) stems.add(word.slice(0, -3) + 'ov')
  const alt = (list) => [...list].sort((a, b) => b.length - a.length).map(escapeRe).join('|')
  const ends = alt(NAME_ENDINGS)
  const up = (s) => s.toLocaleUpperCase()
  return `(?:(?:${alt(stems)})(?:${ends})?|(?:${alt([...stems].map(up))})(?:${alt(NAME_ENDINGS.map(up))})?)`
}

/**
 * Other places where a found person or organisation appears again:
 *   the full name and its parts in their inflected forms and in capitals
 *   ("Nováková" → "Novákové", "NOVÁKOVÁ"; "Kowalski" → "Kowalskiego"),
 *   the last name alone ("Huber" after "Mag. Johann Huber"), with an initial before it ("J. Huber"),
 *   a known first name alone ("Jana" in "Hi Jana,"), the initials ("J. N.", "JN"),
 *   an organisation's name without its legal form.
 * Built for the decision model's weak spots (later mentions, declension, capitals, no clue):
 * once a name is found anywhere, every form of it is found everywhere.
 */
// Words that may stand before a last name without being part of it.
const LEAD_NOT = `(?:${[...require('./pii_candidates').STOP].filter((w) => /^\p{Lu}\p{Ll}+$/u.test(w)).map(escapeRe).join('|')}|Dear|Liebe|Lieber|Sehr|Geehrte|Hallo|Hello|Hi|Bonjour|Ahoj|Dobrý|Dzień|Szia|Bună)[ \\t]`
function spread(text, found, keep) {
  const { isFirstName } = require('./pii_names')
  const out = []
  const seen = new Set()
  const add = (key, src, kind, confidence, source) => {
    if (seen.has(key)) return
    seen.add(key)
    for (const m of text.matchAll(new RegExp(src, 'gu'))) out.push({ kind, start: m.index, end: m.index + m[0].length, confidence, source })
  }
  const B = '(?<![\\p{L}\\p{N}])'
  const E = '(?![\\p{L}\\p{N}])'
  for (const f of found) {
    if (!['PERSON', 'ORG', 'PARTY'].includes(f.kind)) continue
    const value = text.slice(f.start, f.end)
    if (keep.has(norm(value))) continue
    const listed = f.source === 'term' || f.source === 'firm'
    // 'spread': a form of a name found elsewhere — the decision model never overrules it.
    const source = 'spread'
    const isOrg = f.kind === 'ORG' || FORM_END.test(value)
    if (isOrg) {
      if (!listed) add(`ORG:${norm(value)}`, `${B}${escapeRe(value)}${E}`, 'ORG', f.confidence, source)
      const core = value.replace(FORM_END, '')
      if (core !== value && core.length >= 4 && !keep.has(norm(core))) {
        add(`ORG:${norm(core)}`, `${B}(?:${escapeRe(core)}|${escapeRe(core.toLocaleUpperCase())})${E}`, 'ORG', Math.min(f.confidence, 0.6), source)
      }
      continue
    }
    const kind = f.kind === 'PARTY' ? 'PERSON' : f.kind
    const words = value.split(/[\s,;]+/).filter((w) => /^\p{Lu}/u.test(w) && !/^\p{Lu}\.$/u.test(w))
    if (!words.length) continue
    // The whole name (each word in its forms), so "Jany Novákové" and "JANA NOVÁKOVÁ" are found.
    if (!listed || words.length > 1) add(`P:${norm(value)}`, `${B}${words.map(nameForms).join('\\s+')}${E}`, kind, f.confidence, source)
    if (words.length < 2) continue
    const conf = Math.min(f.confidence, 0.6)
    for (const [i, w] of words.entries()) {
      if (w.length < 3 || FORM_ONLY.test(w) || keep.has(norm(w))) continue
      if (i === 0 && !isFirstName(w)) continue // a first word that is not a known first name may be an ordinary word
      // Initials before or after belong to the name ("J. Huber", "ZAUNER M.", "K. István", "Mateus O.").
      // A capitalised word right before the last name is taken along ("Siobhan Baker" when only "Baker" was known).
      const lead = i === words.length - 1 ? `(?:(?!${LEAD_NOT})\\p{Lu}\\p{Ll}+[ \\t])?` : ''
      add(`P1:${norm(w)}`, `${B}${lead}(?:\\p{Lu}\\.[ \\t]?)*${nameForms(w)}(?:[ \\t]\\p{Lu}\\.)?${E}`, kind, i === 0 ? 0.55 : conf, source)
      // Lower case, where a name stands alone on a line or before a comma (e-mail sign-offs: "petr", "natalia z.").
      const lw = escapeRe(w.toLocaleLowerCase())
      add(`L:${norm(w)}`, `(?<=(?:^|\\n)[ \\t>]*)${lw}(?:\\s\\p{Ll}\\.)?(?=[ \\t]*(?:\\n|$|,))`, kind, 0.55, source)
    }
    // Initials: "J. N.", "J.N.", "JN" (capitals only).
    const ini = words.map((w) => escapeRe(w[0]))
    add(`I:${ini.join('')}`, `${B}(?:${ini.join('\\.\\s?')}\\.|${ini.join('')})${E}`, kind, 0.55, source)
  }
  return out
}

/** Keep the best of overlapping findings: the longer span, then the more certain. */
function resolve(list) {
  // The lists first (the lawyer's and the firm's words win), then the longer span, then the more certain.
  // An e-mail address or account number holding a listed name stays one piece.
  const listed = (f) => (f.source === 'pattern' && ['EMAIL', 'IBAN', 'CARD'].includes(f.kind) ? 2 : f.source === 'term' || f.source === 'firm' ? 1 : 0)
  const sorted = [...list].sort((a, b) => listed(b) - listed(a) || (b.end - b.start) - (a.end - a.start) || b.confidence - a.confidence)
  const taken = []
  const overlaps = (f) => taken.some((t) => f.start < t.end && t.start < f.end)
  for (const f of sorted) if (f.end > f.start && !overlaps(f)) taken.push(f)
  return taken.sort((a, b) => a.start - b.start)
}

/**
 * All findings in a text.
 * @param {string} text
 * @param {object} opts
 *   terms     [{ text, kind?, source? }] — the matter's and the firm's lists (always hidden)
 *   keep      [string] — texts the lawyer said need not be hidden (unticked earlier)
 *   patterns  extra pattern entries (the firm's, from openlex.json)
 *   model     findings from the name finder: [{ kind, start, end, confidence }]
 *   all       true: also findings below the threshold (the check shows them unticked)
 */
function scan(text, opts = {}) {
  text = String(text ?? '')
  if (!text) return []
  const keep = new Set((opts.keep || []).map(norm))
  const terms = (opts.terms || []).map((t) => (typeof t === 'string' ? { text: t } : t))
  let raw = [
    ...termHits(text, terms),
    ...patterns(text, opts.patterns || []),
    ...heuristics(text),
    ...(opts.model || []).map((f) => ({ ...f, source: 'model' })),
  ]
  raw = raw.concat(spread(text, raw, keep))
  if (!opts.all) raw = raw.filter((f) => f.source === 'term' || f.source === 'firm' || (f.confidence >= THRESHOLD && !keep.has(norm(text.slice(f.start, f.end)))))
  return resolve(raw).map((f, i) => {
    const value = text.slice(f.start, f.end)
    const kept = f.source !== 'term' && f.source !== 'firm' && keep.has(norm(value))
    return {
      id: `f${i + 1}`, kind: f.kind, group: GROUPS[f.kind] || 'other', text: value, start: f.start, end: f.end,
      confidence: Math.round(f.confidence * 100) / 100, source: f.source,
      label: f.label || KIND_LABELS[f.kind] || KIND_LABELS.OTHER, ...(f.pattern ? { pattern: f.pattern } : {}),
      on: !kept && f.confidence >= THRESHOLD,
    }
  })
}

/** Firm patterns from openlex.json → pattern entries (invalid ones are skipped). */
function firmPatterns(list = []) {
  const out = []
  for (const [i, p] of (Array.isArray(list) ? list : []).entries()) {
    try {
      const src = typeof p === 'string' ? p : p?.regex || p?.pattern
      if (!src || src.length > 500) continue
      const kind = KINDS.includes(String(p?.kind || '').toUpperCase()) ? String(p.kind).toUpperCase() : 'OTHER'
      out.push({ id: `firm.${i + 1}`, country: '*', kind, label: { en: p?.label || 'Firm rule', de: p?.labelDe || p?.label || 'Regel der Kanzlei' }, re: new RegExp(src, `g${p?.caseSensitive ? '' : 'i'}u`), confidence: 0.95, firm: true })
    } catch { /* an invalid firm pattern is ignored */ }
  }
  return out
}

module.exports = { scan, firmPatterns, heuristics, GROUPS, GROUP_ORDER, KINDS, KIND_LABELS, THRESHOLD, norm }
