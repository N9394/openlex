"use strict"
/**
 * Clause library (Phase 2) — the firm's own clauses, built from the
 * documents in the firm library. No model involved: documents are split
 * at clause headings (§ 7, Art. 7, 7., 7.1, Section 7, Clause 7 …), each
 * clause is typed by multilingual keywords (heading counts triple), and
 * identical wording across documents is counted — "the firm's standard
 * liability clause, used in 14 contracts".
 *
 * Scoping follows the firm library: clauses from firm-wide folders are
 * visible everywhere, clauses from a matter's folders only in that matter.
 * Stored locally in ~/.lexvault/clauses.json (0600), updated incrementally
 * whenever the library re-indexes a file.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')

const STORE = path.join(DATA_DIR, 'clauses.json')
const MIN_CHARS = 80
const MAX_CHARS = 6000

// Clause types: [id, label, regex]. Terms in EN, DE, FR, IT, CS/SK, RO.
const TYPES = [
  ['governing_law', 'Governing law', /governing law|applicable law|laws of|anwendbares recht|rechtswahl|es gilt (?:das )?\w+ recht|unterliegt dem \w+ recht|droit applicable|legge applicabile|rozhodné právo|rozhodné právo|legea aplicabilă/i],
  ['disputes', 'Jurisdiction & disputes', /jurisdiction|arbitration|dispute|courts? of|gerichtsstand|schiedsgericht|schiedsverfahren|streitigkeit|tribunal|arbitrage|foro competente|arbitrato|rozhodčí|príslušný súd|soluționarea litigiilor/i],
  ['liability', 'Liability & limitation', /liabilit|liable|limitation of|haftung|haftet|haftungsbeschränkung|schadenersatz|responsabilit|odpovědnost|zodpovednosť|răspundere/i],
  ['indemnity', 'Indemnity', /indemnif|hold harmless|freistellung|schad- und klaglos|schadlos|garantie d'éviction|manleva|odškodn/i],
  ['termination', 'Termination', /terminat|kündigung|beendigung|rücktritt|auflösung|résiliation|recesso|risoluzione|výpověď|ukončen|odstúpen|reziliere|încetare/i],
  ['term', 'Term & renewal', /\bterm\b|duration|renewal|laufzeit|vertragsdauer|verlänger|durée|reconduction|durata|rinnovo|doba trvání|trvanie|durata contractului/i],
  ['confidentiality', 'Confidentiality', /confidential|non-disclosure|geheimhaltung|vertraulich|verschwiegenheit|confidentialit|riservatezza|mlčenlivost|dôvernosť|confidențialitate/i],
  ['force_majeure', 'Force majeure', /force majeure|höhere gewalt|act of god|forza maggiore|vyšší moc|vis maior|forță majoră/i],
  ['ip', 'Intellectual property', /intellectual property|copyright|patent|trademark|licen[cs]e|geistiges eigentum|urheberrecht|nutzungsrecht|werknutzung|propriété intellectuelle|proprietà intellettuale|duševní vlastnictví|duševné vlastníctvo|proprietate intelectuală/i],
  ['data_protection', 'Data protection', /data protection|personal data|gdpr|dsgvo|datenschutz|personenbezogen|auftragsverarbeit|données personnelles|dati personali|osobní údaje|osobné údaje|date cu caracter personal/i],
  ['payment', 'Price & payment', /payment|price|fee|remuneration|invoice|vergütung|entgelt|zahlung|rechnung|preis|honorar|paiement|prix|pagamento|corrispettivo|platba|cena|odměna|plata|preț/i],
  ['warranty', 'Warranty', /warrant|guarantee|defect|gewährleistung|garantie|mangel|mängel|vices cachés|garanzia|vizi|záruka|vady|garanție/i],
  ['penalty', 'Contractual penalty', /penalt|liquidated damages|vertragsstrafe|konventionalstrafe|pönale|pénalité|clausola penale|smluvní pokuta|zmluvná pokuta|penalitate/i],
  ['non_compete', 'Non-compete & non-solicitation', /non-compet|non-solicit|restrictive covenant|wettbewerbsverbot|konkurrenzklausel|abwerbeverbot|non-concurrence|non concorrenza|zákaz konkurence|zákaz konkurencie|neconcurență/i],
  ['assignment', 'Assignment & transfer', /assign|transfer of (?:the )?(?:agreement|contract|rights)|abtretung|übertragung|vertragsübernahme|cession|cessione|postoupení|postúpenie|cesiune/i],
  ['change_of_control', 'Change of control', /change of control|kontrollwechsel|change of ownership|changement de contrôle|cambio di controllo|změna kontroly/i],
  ['notices', 'Notices', /\bnotices?\b|mitteilungen|zustellung|schriftform|notifications?|comunicazioni|oznámení|doručovanie|notificări/i],
  ['severability', 'Severability', /severab|salvatorisch|teilunwirksamkeit|unwirksamkeit einzelner|divisibilit|nullité partielle|clausola di salvaguardia|oddělitelnost|neplatnost/i],
  ['entire_agreement', 'Entire agreement', /entire agreement|whole agreement|vollständigkeit|nebenabreden|intégralité|intero accordo|úplnost|clauza de integralitate/i],
  ['insurance', 'Insurance', /insurance|versicherung|assurance|assicurazione|pojištění|poistenie|asigurare/i],
  ['subcontracting', 'Subcontracting', /subcontract|subunternehm|sous-trait|subappalt|subdodav|subcontract/i],
]

// A line that starts a clause: § 7 / Art. 7 / Artikel 7 / Article 7 / Section 7 / Clause 7 / 7. / 7.1 / VII.
const HEADING = /^(?:§§?\s*\d+[a-z]?\b|(?:Art(?:\.|ikel|icle|icolo|ículo|icolul)?|Section|Clause|Klausel|Punkt|Článek|Článok|Ziffer)\s*\d+[a-z]?\b|\d{1,2}(?:\.\d{1,2}){0,2}\.?\s+\S|[IVX]{1,5}\.\s+\S)/u

let cache = null

function load() {
  if (cache) return cache
  try { cache = JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch { cache = { files: {} } }
  if (!cache.files) cache.files = {}
  return cache
}

function save() {
  fs.mkdirSync(path.dirname(STORE), { recursive: true })
  const tmp = `${STORE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 })
  fs.renameSync(tmp, STORE)
}

const norm = (s) => String(s || '').toLowerCase().replace(/[‘’‚‛]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/\s+/g, ' ').trim()
// Wording identity ignores the clause number: "§ 9 Haftung …" == "§ 12 Haftung …".
const wordingKey = (text) => crypto.createHash('sha1').update(norm(text).replace(/^(?:§§?\s*\d+[a-z]?|(?:art\w*|section|clause|klausel|punkt|ziffer)\.?\s*\d+[a-z]?|\d{1,2}(?:\.\d{1,2}){0,2}\.?|[ivx]{1,5}\.)\s*/i, '')).digest('hex').slice(0, 16)

/** Split a document into clauses at heading lines. */
function split(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let cur = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || /^\[Page \d+( · OCR)?\]$/.test(line)) continue
    if (HEADING.test(line) && line.length < 400) {
      if (cur) out.push(cur)
      cur = { heading: line.length > 120 ? line.slice(0, 120) : line, lines: [line] }
    } else if (cur) cur.lines.push(line)
  }
  if (cur) out.push(cur)
  return out
    .map((c) => ({ heading: c.heading, text: c.lines.join('\n') }))
    .filter((c) => c.text.length >= MIN_CHARS)
    .map((c) => ({ ...c, text: c.text.slice(0, MAX_CHARS) }))
}

/** Best clause type by keyword score (heading ×3), or 'other'. */
function classify(heading, text) {
  let best = ['other', 0]
  for (const [id, , re] of TYPES) {
    const g = new RegExp(re.source, 'gi')
    const score = 3 * (String(heading).match(g) || []).length + Math.min(4, (String(text).match(g) || []).length)
    if (score > best[1]) best = [id, score]
  }
  return best[1] >= 2 ? best[0] : 'other'
}

function language(text) {
  const t = ` ${norm(text)} `
  const score = (words) => words.reduce((n, w) => n + (t.split(` ${w} `).length - 1), 0)
  const s = { de: score(['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'des']), en: score(['the', 'and', 'of', 'shall', 'to', 'is', 'not', 'any']), fr: score(['le', 'la', 'les', 'et', 'des', 'est', 'du']), it: score(['il', 'della', 'che', 'è', 'per', 'del']), cs: score(['a', 'je', 'se', 'v', 'na', 'smlouvy']), ro: score(['și', 'de', 'în', 'cu', 'contractului']) }
  return Object.entries(s).sort((a, b) => b[1] - a[1])[0][0]
}

/** (Re)build the clauses of one library file. */
function updateFile(file, text, matterId = '') {
  const c = load()
  c.files[file] = {
    matterId: matterId || '',
    clauses: split(text).map((x) => ({ heading: x.heading, text: x.text, type: classify(x.heading, x.text), key: wordingKey(x.text), lang: language(x.text) })),
  }
  save()
  return c.files[file].clauses.length
}

function removeFile(file) {
  const c = load()
  if (c.files[file]) { delete c.files[file]; save() }
}

const visible = (fileMatter, matterId) => !fileMatter || fileMatter === matterId

/**
 * Firm clauses, grouped by identical wording, most used first.
 * @returns [{ type, label, heading, text, lang, documents: [file names], uses }]
 */
function search({ type = null, query = '', matterId = null, lang = null, limit = 8 } = {}) {
  const groups = new Map()
  for (const [file, f] of Object.entries(load().files)) {
    if (!visible(f.matterId, matterId)) continue
    for (const cl of f.clauses) {
      if (type && cl.type !== type) continue
      if (lang && cl.lang !== lang) continue
      const g = groups.get(cl.key) || { ...cl, documents: [] }
      if (!g.documents.includes(path.basename(file))) g.documents.push(path.basename(file))
      groups.set(cl.key, g)
    }
  }
  const words = norm(query).split(' ').filter((w) => w.length > 2)
  const scored = [...groups.values()].map((g) => {
    const t = norm(`${g.heading} ${g.text}`)
    const hit = words.length ? words.filter((w) => t.includes(w)).length / words.length : 1
    return { ...g, uses: g.documents.length, score: hit * 10 + Math.log2(1 + g.documents.length) }
  }).filter((g) => !words.length || g.score >= 5)
  scored.sort((a, b) => b.score - a.score || b.uses - a.uses)
  const label = Object.fromEntries(TYPES.map(([id, l]) => [id, l]))
  return scored.slice(0, limit).map(({ key, score, ...g }) => ({ ...g, label: label[g.type] || 'Other' }))
}

/** Counts per type (for the pane), scoped like search. */
function overview(matterId = null) {
  const counts = {}
  let files = 0
  for (const f of Object.values(load().files)) {
    if (!visible(f.matterId, matterId)) continue
    files++
    for (const cl of f.clauses) counts[cl.type] = (counts[cl.type] || 0) + 1
  }
  return { files, types: TYPES.map(([id, label]) => ({ id, label, count: counts[id] || 0 })).concat([{ id: 'other', label: 'Other', count: counts.other || 0 }]) }
}

function _reset() { cache = null }

module.exports = { split, classify, updateFile, removeFile, search, overview, TYPES, STORE, _reset }
