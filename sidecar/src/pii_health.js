"use strict"
/**
 * Health data candidates: "type 1 diabetes", "on long-term sick leave since 08/2026 (back injury)",
 * "úzkostné poruše", "ciąży (14. tydzień)", "arrêt maladie depuis le 12/08 (burn-out)".
 *
 * Health is special-category data (GDPR Art. 9) and rarely has a shape a pattern could catch. This
 * source finds health words in the 8 languages and grows each hit into its phrase:
 *
 *   - modifiers next to it (type 1, chronic, early-stage, long-term, mental, treatment, card…),
 *   - connectors between health words (maladie de Parkinson, Grad der Behinderung),
 *   - two health phrases close together (Gehbehinderung, Pflegestufe 2),
 *   - a bracket right after it ("(back injury)", "(14. tydzień)") and "since <date>".
 *
 * Every hit is a candidate of kind OTHER for the decision model: law text that only talks about
 * illness in general ("an employee on sick leave is entitled…") is for the model to leave visible.
 *
 *   health(text) → [{ kind: 'OTHER', start, end, confidence }]
 */

// One token is a health word when one of these matches its start (case-insensitive).
const HEALTH = new RegExp('^(?:' + [
  // en
  'diabet', 'asthma', 'depressi', 'anxiety', 'burn-?out', 'parkinson', 'alzheimer', 'dementia', 'cancer', 'tumou?r', 'leuka?emia',
  'oncolog', 'chemotherap', 'radiotherap', 'macular', 'sclerosis', 'epilep', 'schizophren', 'bipolar', 'autis', 'adhd$', 'hiv$', 'hepatitis',
  'injur', 'fractur', 'disabilit', 'disabled', 'handicap', 'wheelchair', 'pregnan', 'miscarriage', 'psychiatr', 'psycholog', 'psychotherap',
  'therap', 'illness', 'disease', 'disorder', 'syndrome', 'diagnos', 'medication', 'hospitali[sz]', 'impairment', 'deaf', 'ptsd$', 'addiction',
  'alcoholism', 'arthritis', 'migraine', 'insomnia', 'stroke$', 'surgery', 'burns?$',
  // de
  'asthma', 'angststörung', 'demenz', 'krebs', 'onkolog', 'sklerose', 'schizophren', 'behinder', 'schwerbehind', 'rollstuhl', 'rollator',
  'pflegestufe', 'pflegegrad', 'pflegebedürft', 'schwanger', 'fehlgeburt', 'krankheit', 'erkrank', 'krankgeschrieb', 'krankschreib',
  'krankenstand', 'arbeitsunfähig', 'verletz', 'medikament', 'bandscheib', 'herzinfarkt', 'schlaganfall', 'kur$', 'reha',
  // cs, sk
  'astm', 'deprese', 'depresi', 'úzkost', 'vyhoření', 'demenc', 'rakovin', 'nádor', 'chemoterap', 'skleróz', 'schizofren',
  'postižen', 'postihnut', 'invalid', 'zťp$', 'ztp$', 'těhotn', 'tehotn', 'potrat', 'terapi', 'nemoc', 'chorob', 'onemocn', 'ochoren',
  'úzkostn', 'neschopnost', 'práceneschopn', 'úraz', 'zranění', 'zranen', 'diagnóz', 'léčb', 'liečb',
  // pl
  'cukrzyc', 'depresj', 'demencj', 'nowotw', 'chemioterap', 'stwardnien', 'padaczk', 'autyz', 'niepełnospraw', 'inwalid',
  'ciąż', 'poronien', 'chor(?:y|a|ego|ej|emu|ym|zy)$', 'leczeni', 'l4$',
  // ro
  'anxiet', 'demenț', 'oncolog', 'chimioterap', 'scleroz', 'dizabilit', 'invaliditat', 'gravid', 'însărcinat', 'psihiatr', 'psiholog',
  'boal', 'afecțiun', 'diagnostic',
  // hu
  'cukorbeteg', 'asztm', 'depresszi', 'szorong', 'demenci', 'rákos', 'daganat', 'onkológ', 'kemoterápi', 'szklerózis', 'epilepszi',
  'skizofrén', 'autizm', 'fogyatékos', 'rokkant', 'terhes', 'vetél', 'pszichiátri', 'pszichológ', 'terápi', 'betegség', 'táppénz',
  'sérül', 'diagnóz', 'gyógyszer',
  // fr
  'diabét', 'asthm', 'dépress', 'anxi', 'démence', 'tumeur', 'chimiothérap', 'sclérose', 'épilep', 'schizophr', 'vih$', 'rqth$',
  'invalidit', 'grossesse', 'fausse-couche', 'thérap', 'maladie', 'malade', 'blessure', 'diagnost', 'médicament', 'hospitalis',
].join('|') + ')', 'iu')

// German compounds end in a health word ("Gehbehinderung", "Lungenerkrankung", "Knieverletzung").
const COMPOUND = /\p{L}{3}(?:behinderung|erkrankung|krankheit|verletzung|beschwerden|störung|leiden)$/iu

// Words that belong to a health phrase but are not health words on their own.
const MODIFIER = new RegExp('^(?:' + [
  'type', 'typ', 'typu', 'stage', '[\\p{L}]+-(?:stage|term|grade|onset)', 'early', 'late', 'long-term', 'short-term', 'chronic', 'chronisch',
  'chronick', 'chroniczn', 'cronic', 'krónikus', 'chronique', 'severe', 'schwer', 'těžk', 'ťažk', 'ciężk', 'sever', 'súlyos', 'sévère',
  'mild', 'leicht', 'minor', 'acute', 'akut', 'mental', 'psychisch', 'duševn', 'psychiczn', 'psihic', 'mentális', 'psychique', 'medical',
  'ärztlich', 'lékařsk', 'lekársk', 'lekarsk', 'medical', 'medicale', 'orvosi', 'médical', 'treatment', 'behandlung', 'tratament',
  'kezelés', 'traitement', 'card', 'ausweis', 'preukaz', 'průkaz', 'legitymacj', 'carte', 'igazolvány', 'holder', 'držiteľ', 'držitel',
  'benefit', 'allowance', 'rente', 'dávk', 'ellátás', 'pension', 'zasiłek', 'indemnit', 'degeneration', 'dégénérescence', 'porucha',
  'poruch', 'poruš', 'störung', 'zpráv', 'správ', 'sick', 'leave', 'care', 'pflege', 'stufe', 'level', 'grade', 'grad', 'sluchov',
  'zrakov', 'pohybov', 'hearing', 'visual', 'back', 'left', 'right', 'stopnia', 'stupně', 'stupňa', 'gradul', 'fokú',
].join('|') + ')\\p{L}*$|^\\d', 'iu')
// Connectors only count between two words of the phrase.
const CONNECT = /^(?:of|de|d'|d’|des|du|la|der|des|with|mit|s|se|z|ze|cu|w|z|et|and|und|a|i|și|és)$/iu
// A Hungarian postposition right after a health word ("depresszió miatt", "kezelés alatt").
const POST = /^(?:miatt|alatt|következtében|óta)$/iu
// Fixed phrases whose words alone say nothing ("sick leave", "arrêt de travail").
const PHRASES = new RegExp('(?<![\\p{L}\\p{N}])(?:' + [
  String.raw`(?:on\s)?(?:(?:long|short)-term\s)?sick(?:\s|-)(?:leave|note|pay)`,
  String.raw`arr[êe]t\s(?:de\s)?(?:maladie|travail)`, String.raw`congé\s(?:de\s)?maladie`,
  String.raw`concediu(?:l)?\s(?:medical|de\sboal[ăa])`, String.raw`zwolnieni[ae]\slekarski\p{L}{0,3}`,
  String.raw`pracovní\sneschopnost\p{L}{0,3}`, String.raw`pracovn[áa]\sneschopnosť\p{L}{0,3}`,
  String.raw`grad\sder\sbehinderung`, String.raw`maladie\sde\s\p{Lu}\p{L}{2,20}`,
  String.raw`(?:reconnaissance\sde\sla\squalité\sde\s)?travailleur\shandicapé`, String.raw`(?:est|être|étant)\senceinte`,
].join('|') + ')(?![\\p{L}\\p{N}])', 'giu')

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’./-]{0,40}/gu
const BREAK = /[.;:!?|\n\t]|\s{3,}/u
const DATE_TOKEN = /^\d{1,4}(?:[./-]\d{1,4}){0,2}\.?$/u
const SINCE = /^(?:since|seit|od|depuis|din|from|von|ab|desde)$/iu

function tokens(text) {
  const out = []
  for (const m of text.matchAll(TOKEN)) {
    let w = m[0].replace(/[.,'’-]+$/u, '')
    if (!w) continue
    out.push({ w, start: m.index, end: m.index + w.length })
  }
  return out
}
/** Only spaces, a comma or a hyphen between two tokens, no sentence break? */
const joined = (text, a, b, comma = false) => {
  const gap = text.slice(a.end, b.start)
  return gap.length <= 4 && !BREAK.test(gap) && (comma ? /^[\s,()–-]*$/u.test(gap) : /^[\s-]*$/u.test(gap))
}

function health(text) {
  const toks = tokens(text)
  if (!toks.length) return []
  const tag = toks.map((t) => (HEALTH.test(t.w) || COMPOUND.test(t.w) ? 'H' : MODIFIER.test(t.w) ? 'M' : CONNECT.test(t.w) ? 'C' : POST.test(t.w) ? 'P' : ''))
  let k = 0
  for (const m of text.matchAll(PHRASES)) {
    while (k < toks.length && toks[k].start < m.index) k++
    for (let j = k; j < toks.length && toks[j].end <= m.index + m[0].length; j++) tag[j] = 'H'
  }
  const spans = []
  for (let i = 0; i < toks.length; i++) {
    if (tag[i] !== 'H') continue
    let a = i
    let b = i
    // left: modifiers, and connectors with a phrase word before them
    while (a > 0 && joined(text, toks[a - 1], toks[a])) {
      const t = tag[a - 1]
      // a number counts on the left only after a modifier ("type 1 diabetes", not "§ 8 Krankheit")
      if (t === 'M' && /^\d/u.test(toks[a - 1].w) && !(a > 1 && tag[a - 2] === 'M' && !/^\d/u.test(toks[a - 2].w) && joined(text, toks[a - 2], toks[a - 1]))) break
      if (t === 'H' || t === 'M') { a--; continue }
      if (t === 'C' && a > 1 && (tag[a - 2] === 'H' || tag[a - 2] === 'M') && joined(text, toks[a - 2], toks[a - 1])) { a -= 2; continue }
      break
    }
    // right: the same, and a postposition
    for (;;) {
      if (b + 1 >= toks.length || !joined(text, toks[b], toks[b + 1])) break
      const t = tag[b + 1]
      if (t === 'H' || t === 'M') { b++; continue }
      if (t === 'C' && b + 2 < toks.length && (tag[b + 2] === 'H') && joined(text, toks[b + 1], toks[b + 2])) { b += 2; continue }
      if (t === 'P') { b++; break }
      break
    }
    let start = toks[a].start
    let end = toks[b].end
    // "since 08/2026", "depuis le 12/08"
    const s = text.slice(end, end + 40).match(/^\s(since|seit|od|depuis(?:\sle)?|din|from|ab)\s(\d{1,4}(?:[./-]\d{1,4}){0,2})/iu)
    if (s) end += s[0].length
    // a bracket right after it
    const br = text.slice(end, end + 70).match(/^\s?\([^()\n]{1,60}\)/u)
    if (br) end += br[0].length
    spans.push({ start, end })
    while (i + 1 < toks.length && toks[i + 1].start < end) i++
  }
  // Two health phrases close together are one ("Gehbehinderung, Pflegestufe 2", "depresszió miatt áll pszichiátriai kezelés alatt").
  const merged = []
  for (const s of spans) {
    const p = merged[merged.length - 1]
    if (p) {
      const gap = text.slice(p.end, s.start)
      const words = gap.trim() ? gap.trim().split(/\s+/u).length : 0
      if (!BREAK.test(gap) && gap.length <= 30 && (/^[\s,]*$/u.test(gap) || words <= 2 && !/[,()]/u.test(gap))) { p.end = Math.max(p.end, s.end); continue }
    }
    merged.push({ ...s })
  }
  return merged.map((s) => ({ kind: 'OTHER', start: s.start, end: s.end, confidence: 0.5, label: { en: 'Health', de: 'Gesundheit' } }))
}

module.exports = { health }
