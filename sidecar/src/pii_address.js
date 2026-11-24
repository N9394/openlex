"use strict"
/**
 * Address glue: one address, one finding.
 *
 * Addresses come in pieces — a street from a pattern, a town the decision model ticked, a
 * postcode nobody proposed, "Flat 3" or "bât. C" in front. Hidden piece by piece, the postcode or
 * the flat number stays visible. This pass joins the pieces of each address into one ticked
 * finding:
 *
 *   a line is cut at hard stops (| ; : ( ) tabs, wide gaps) and then into comma segments;
 *   a segment is part of an address when it is a street (a house number with a word, or a
 *   street word such as rue / ul. / Str. / nám.), a postcode with its town (or a UK / Irish
 *   town with its postcode), a flat / block / building part, an already ticked address
 *   piece, or — after an address — a country;
 *   neighbouring address segments become one finding when the run holds an anchor (a
 *   postcode or an address piece that was already ticked) and a street, postcode or
 *   building part; a run continues on the next line when that line starts with a postcode
 *   and town, a house number or a flat / apartment / jud. part.
 *
 * Lead words inside a segment ("lives at", "bytem", "demeurant", "so sídlom") and trailing
 * words ("and", "on 15 October") are cut off at the first lower-case word that is not a street
 * word. It only ever adds or widens ticks; it never unticks or drops anything, and it leaves
 * alone an address that the decision model said is not personal data (a court's address).
 *
 *   glue(text, findings) → findings (a new array)
 */

const L = '\\p{Lu}[\\p{L}\\p{M}\'’.-]*'
// Lower-case words that belong to street names and address parts (stay inside a segment).
const STREET_WORDS = new Set(('rue avenue av. boulevard bd bd. place cours quai allée impasse chemin route voie square passage ' +
  'de la le les des du d\' l\' sur sous lès en ' +
  'ul. ulica ulicy al. aleja alei pl. plac os. osiedle vul. kv. m. lok. ' +
  'nám. náměstí námestie nábřeží nábrežie tř. třída trieda triede cesta nivy sady ulice ' +
  'str. strada bd. bdul. calea aleea șos. şos. piața nr. nr bl. sc. et. ap. jud. sector cel și şi lui ' +
  'utca u. út útja tér tere körút krt. köz sor sétány rakpart fasor fszt. em. ' +
  'straße strasse str. gasse weg platz allee ring an der am im auf dem zum zur bei ' +
  'nad pod u na v ve ' +
  'upon bât. bât sugárút lakótelep dűlő park ' +
  'stycznia lutego marca kwietnia maja czerwca lipca sierpnia września października listopada grudnia ' +
  'ledna února března dubna května června července srpna září října listopadu prosince ' +
  'januára februára marca apríla mája júna júla augusta septembra októbra novembra decembra ' +
  'ianuarie februarie martie aprilie mai iunie iulie august septembrie octombrie noiembrie decembrie').split(/\s+/))
// Words that end a segment even though they are in STREET_WORDS when they come first ("of", "on", "the" as lead words).
const LEAD_ONLY = new Set(['upon', 'on', 'the', 'of', 'en', 'v', 've', 'u', 'na', 'am', 'im', 'an', 'der', 'auf', 'dem', 'bei', 'zum', 'zur', 'de', 'la', 'le', 'les', 'des', 'du', 'sur', 'sous', 'lès', 'pod', 'nad'])
const KEYWORD_LEAD = /^(?:Flat|Apartment|Apt\.?|Unit|Block|Suite|Floor|Building|Bât\.|bât\.|Résidence|Residence|Lot|bl\.|sc\.|et\.|ap\.|kv\.|fszt\.|em\.|jud\.|Jud\.|sector|Sector|c\/o|Top|Stiege|Tür|m\.|lok\.)(?=\s|$)/u
const STREET_LEAD = /^(?:rue|avenue|av\.|boulevard|bd\.?|place|cours|quai|allée|impasse|chemin|route|ul\.|ulica|Ulica|al\.|aleja|Aleja|pl\.|plac|os\.|osiedle|vul\.|nám\.|náměstí|Nám\.|Náměstí|námestie|Námestie|tř\.|třída|Str\.|Strada|Bd\.|Bdul\.|Bulevardul|Calea|Aleea|Șos\.|Şos\.|Șoseaua|Piața|Rua|Via|Calle|Avenida)(?=\s|$)/u
const BUILDING = new RegExp(`^(?:The\\s+)?(?:${L}\\s+)*(?:House|Court|Rectory|Granary|Cottage|Lodge|Hall|Manor|Farm|Mill|Barn|Tower|Towers|Building|Centre|Center|Quay|Mews|Chambers|Mansions|Gardens|Residence)$`, 'u')
const STREET_END = /(?:\s(?:Street|Road|Lane|Close|Drive|Avenue|Way|Place|Terrace|Square|Crescent|Gardens|Grove|Row|Walk|Hill|Quay|Mews|Parade|Rise|Wynd|Boulevard)|(?:straße|strasse|gasse|weg|platz|allee|ring|ufer|damm)|\s(?:utca|út|tér|körút|sugárút|fasor|sor|köz))$/u
const HOUSE_NO = /(?:^|\s)\d{1,5}[a-zA-Z]?(?:\s?\/\s?\d{1,5}[a-zA-Z]?)?\.?(?=\s|$)/u
const ONLY_HOUSE_NO = /^\d{1,5}[a-zA-Z]?(?:\s?\/\s?\d{1,5}[a-zA-Z]?)?(?:\s?(?:bis|ter))?\.?$/u
const POST = '(?:(?:A|D|CH|F|B|L|H|CZ|SK|PL|RO|I|NL)-)?(?:\\d{3}\\s?\\d{2}|\\d{4,6}|\\d{2}-\\d{3}|\\d{4}-\\d{3})'
const UKPOST = '(?:[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}|[AC-FHKNPRTV-Y]\\d{2}\\s?[0-9AC-FHKNPRTV-Y]{4}|D6W\\s?[0-9AC-FHKNPRTV-Y]{4})'
const TOWN = `${L}(?:[\\s-](?:nad|pod|an der|am|im|in|bei|sur|sous|lès|de|la|le|du|des|cel|upon|on|\\d{1,2}|[–-]|${L}))*`
const PLACE = new RegExp(`^(?:${POST}\\s+${TOWN}|${TOWN}\\s+${UKPOST}|${UKPOST}|Dublin\\s\\d{1,2}[wW]?)$`, 'u')
const POSTCODE_IN = new RegExp(`(?:^|\\s)(?:${POST}|${UKPOST})(?=\\s|$)`, 'u')
const COUNTRIES = new Set(('Austria Österreich Rakousko Rakúsko Austria Ausztria Autriche Germany Deutschland Německo Nemecko Niemcy Germania Németország Allemagne ' +
  'Czechia Česko Česká_republika Czech_Republic Czechy Cehia Csehország Tchéquie Slovakia Slovensko Slovenská_republika Słowacja Slovacia Szlovákia Slovaquie ' +
  'Poland Polska Polsko Poľsko Polonia Lengyelország Pologne Romania România Rumunsko Rumunia Románia Roumanie Hungary Magyarország Maďarsko Węgry Ungaria Hongrie Ungarn ' +
  'France Francie Francúzsko Francja Franța Franciaország Frankreich Belgium Belgique Belgie België Belgien Portugal Portugalsko Portugalia Portugália ' +
  'Ireland Irsko Írsko Irlandia Irlanda Írország Irlande Irland United_Kingdom UK England Scotland Wales Spain España Španělsko Hiszpania Spania Espagne Spanien ' +
  'Italy Italia Itálie Taliansko Włochy Olaszország Italie Italien Netherlands Nederland Nizozemsko Holandia Pays-Bas Niederlande Switzerland Schweiz Suisse Švýcarsko Švajčiarsko Szwajcaria Elveția Svájc ' +
  'Ukraine Ukrajina Ukraina Ucraina Ukrajna Korea South_Korea Cyprus Kypr Cypr Cipru Ciprus Chypre Zypern USA United_States').split(/\s+/).map((c) => c.replace(/_/g, ' ')))

const HARD_STOP = /[|;:()[\]{}«»„“”"\t]| {3,}/gu
// A full stop ends a sentence (and an address) unless it closes an abbreviation, an initial or a number.
const ABBR = new Set(('nám tř str bd bdul gen ul al pl os sv st dr mr mrs ms nr bl sc et ap jud bât av prof ing mgr judr phdr mudr bc ' +
  'ii iii iv vi vii viii ix xi xii no čp č kv lok fszt em krt u e').split(' '))
for (const w of STREET_WORDS) if (w.endsWith('.')) ABBR.add(w.slice(0, -1))
function sentenceStops(line) {
  const out = []
  for (const m of line.matchAll(/\.(?=\s+\p{Lu})/gu)) {
    const before = (line.slice(0, m.index).match(/(\S+)$/u) || ['', ''])[1]
    const w = before.replace(/^[^\p{L}\d]+/u, '')
    if (/^\d+$/u.test(w) || /^\p{L}$/u.test(w) || ABBR.has(w.toLowerCase())) continue
    out.push({ index: m.index, length: 1 })
  }
  return out
}

function words(s) {
  const out = []
  const re = /\S+/gu
  let m
  while ((m = re.exec(s))) out.push({ w: m[0], start: m.index, end: m.index + m[0].length })
  return out
}
const bare = (w) => w.replace(/^[,.'’"„“]+|[,"“”]+$/gu, '').replace(/^[ldLD]['’](?=\p{L})/u, (x) => (/^[LD]/.test(x) ? 'X' : ''))
const isLowerWord = (w) => /^\p{Ll}/u.test(w) && !STREET_WORDS.has(w.toLowerCase()) && !STREET_WORDS.has(w.toLowerCase().replace(/[,.]$/, ''))

function span(seg, ws, a, b) {
  if (a >= b) return null
  const s = seg.start + ws[a].start
  let e = seg.start + ws[b - 1].end
  let text = seg.full.slice(s, e)
  const trail = text.match(/[.,]+$/u)
  if (trail && !/\d\.$/u.test(text) && !/\b(?:bât|bl|sc|et|ap|nr|em|fszt|Apt)\.$/u.test(text)) { e -= trail[0].length; text = text.slice(0, -trail[0].length) }
  return text ? { start: s, end: e, text } : null
}

/**
 * The address parts of a comma segment: `head` (from its start to the first plain lower-case word:
 * how an address goes on) and `tail` (after the last plain lower-case word: how one starts, lead
 * words such as "lives at" or "bytem" cut off). Without such words both are the whole segment.
 */
function core(seg) {
  const ws = words(seg.text)
  if (!ws.length) return null
  const lower = ws.map((x) => isLowerWord(bare(x.w)))
  const first = lower.indexOf(true)
  if (first < 0) { const whole = span(seg, ws, 0, ws.length); return { head: whole, tail: whole, plain: true } }
  let a = lower.lastIndexOf(true) + 1
  while (a < ws.length && LEAD_ONLY.has(bare(ws[a].w))) a++
  return { head: span(seg, ws, 0, first), tail: span(seg, ws, a, ws.length), plain: false }
}

function classify(c, ticked) {
  if (!c) return null
  const t = c.text.trim()
  const tickedHere = ticked.some((f) => f.kind === 'ADDRESS' && f.start < c.end && c.start < f.end)
  const kind = PLACE.test(t) ? 'place'
    : KEYWORD_LEAD.test(t) ? 'part'
      : STREET_LEAD.test(t) || (HOUSE_NO.test(t) && /\p{L}{2}/u.test(t)) || STREET_END.test(t) ? 'street'
        : ONLY_HOUSE_NO.test(t) ? 'number'
          : BUILDING.test(t) ? 'building'
            : COUNTRIES.has(t) ? 'country'
              : tickedHere ? 'ticked' : null
  return kind ? { ...c, kind, anchor: tickedHere || kind === 'place' } : null
}
// A court's, an authority's or a public body's address is public: it is not glued (pieces a
// pattern found stay as they are). Checked on the line before the address, the line itself and the address.
const AUTHORITY = /(?:gericht|soud\b|soudu|soudem|súd\b|súdu|súdom|sąd\b|sądu|sądem|sądzie|tribunal|judecători|curtea|bíróság|törvényszék|\bcourts?\b|sheriff|magistrát|úřad|úrad\b|úradu\b|úradom\b|urząd|urzęd|wydział|abteilung|senát|senat\b|finanzamt|kammer|ministerstv|ministerium|ministry|policie|polici|inspectorat|prefectur|préfecture|primări|mairie|baroul|izba|komora|kataster|katastr|notariat|nemocnic|krankenhaus|hospital|szpital|spital|kórház)/iu
const TOWN_ONLY = new RegExp(`^${L}(?:[\\s-]${L}){0,2}$`, 'u')

/** Address runs in the text: [{ start, end, parts }]. */
function runs(text, ticked) {
  const out = []
  let cur = null
  const flush = () => {
    if (cur && cur.parts.some((p) => p.anchor) && cur.parts.some((p) => ['street', 'place', 'part', 'building'].includes(p.kind)) &&
        cur.parts.some((p) => p.kind !== 'country' && p.kind !== 'number') && !AUTHORITY.test(around(cur))) out.push(cur)
    cur = null
  }
  const around = (r) => {
    const ls = text.lastIndexOf('\n', r.start - 1) + 1
    const prev = ls > 0 ? text.lastIndexOf('\n', ls - 2) + 1 : ls
    return text.slice(prev, r.end)
  }
  // A run may go on to the next line while it has no postcode and town yet, or after a trailing comma;
  // a lone town or name above a street ("Landgericht München I") does not start an address block.
  const lineOn = (commaEnd) => cur && (commaEnd || (!cur.parts.some((p) => p.kind === 'place') && cur.parts.some((p) => ['street', 'part', 'building', 'number'].includes(p.kind))))
  const push = (k) => {
    if (!cur) cur = { start: k.start, end: k.end, parts: [] }
    cur.parts.push(k)
    cur.end = k.end
  }
  const wholeTicked = (c) => ticked.some((f) => (f.kind === 'PERSON' || f.kind === 'ORG') && f.start <= c.start && c.end <= f.end)
  let lineStart = 0
  let prevLine = ''
  for (const line of text.split('\n')) {
    const base = lineStart
    lineStart += line.length + 1
    const stops = [...[...line.matchAll(HARD_STOP)].map((m) => ({ index: m.index, length: m[0].length })), ...sentenceStops(line)].sort((x, y) => x.index - y.index)
    const pieces = []
    let last = 0
    for (const m of stops) { if (m.index >= last) { pieces.push([last, m.index]); last = m.index + m.length } }
    pieces.push([last, line.length])
    const commaEnd = cur !== null && /,\s*$/u.test(prevLine)
    if (cur && !lineOn(commaEnd)) flush()
    let continues = cur !== null
    prevLine = line
    for (let pi = 0; pi < pieces.length; pi++) {
      const [ps, pe] = pieces[pi]
      if (pi > 0) { flush(); continues = false }
      const segs = []
      let s = ps
      for (let i = ps; i <= pe; i++) {
        if (i === pe || line[i] === ',') { if (line.slice(s, i).trim()) segs.push({ start: base + s, text: line.slice(s, i), full: text }); s = i + 1 }
      }
      const cores = segs.map(core)
      for (let si = 0; si < segs.length; si++) {
        const c = cores[si]
        if (!c) { flush(); continue }
        const lineFirst = continues && si === 0
        if (cur) {
          const h = classify(c.head, ticked)
          // on a new line the address goes on with a postcode, a number or a street part, or with anything after a trailing comma
          const okNext = h && h.kind !== 'country' ? (!lineFirst || commaEnd || ['place', 'number', 'part', 'street'].includes(h.kind)) : h && !lineFirst
          if (okNext && c.plain) { push(h); continue }
          if (okNext) push(h)
          flush()
        }
        let k = classify(c.tail, ticked)
        if (!k && c.tail && TOWN_ONLY.test(c.tail.text) && !wholeTicked(c.tail) && si + 1 < segs.length) {
          // a town written before a street that starts with a word ("Iași, Str. …", "Přerov, Komenského 12")
          const n = classify(cores[si + 1]?.head, ticked)
          if (n && n.kind === 'street' && !/^\d/u.test(n.text)) k = { ...c.tail, kind: 'town', anchor: false }
        }
        if (!k || k.kind === 'country') { flush(); continue }
        push(k)
      }
      continues = false
    }
    // the run goes on to the next line only if this line ends inside it (nothing after it but a comma)
    if (cur && !/^[\s,]*$/u.test(text.slice(cur.end, base + line.length))) flush()
  }
  flush()
  return out
}

function glue(text, findings) {
  const ticked = findings.filter((f) => f.on)
  // The decision model's "not personal data" stands: a court's or an authority's address that it
  // left unticked is not ticked again by gluing.
  const vetoed = findings.filter((f) => !f.on && f.decided && f.decided.answer === 'not_personal')
  const rs = runs(text, ticked).filter((r) => !vetoed.some((f) => f.start < r.end && r.start < f.end))
  if (!rs.length) return findings
  const kept = findings.filter((f) => !(f.kind === 'ADDRESS' && rs.some((r) => r.start <= f.start && f.end <= r.end)))
  const added = rs.map((r) => {
    const inside = findings.filter((f) => f.kind === 'ADDRESS' && f.start < r.end && r.start < f.end)
    return { kind: 'ADDRESS', group: 'addresses', label: require('./pii_detect').KIND_LABELS.ADDRESS, text: text.slice(r.start, r.end), start: r.start, end: r.end,
      confidence: Math.max(0.6, ...inside.map((f) => f.confidence || 0)), source: 'address', on: true }
  })
  return [...kept, ...added].sort((a, b) => a.start - b.start || b.end - a.end)
}

module.exports = { glue, runs }
