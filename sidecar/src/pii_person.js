"use strict"
/**
 * Name glue: one person, one finding.
 *
 * Candidates often hold only part of a name — the surname a capitalised-word source proposed,
 * the name spread from "Fischer" — so "Kerstin" in "Kerstin Fischer" stays visible. This pass
 * widens every ticked person finding over the parts of the same name right next to it:
 *
 *   to the left:  an initial (A., H.-K.), a title (Mr, Frau, Bc., Mgr., domnul), a particle
 *                 (Ó, Ní, von, de), a known first name, or — for a single surname in a
 *                 name slot (line start, after "Name:", "|", "(", "2.", a title) — the
 *                 capitalised word before it ("Chen Jiayi", "Oleksandrem Melnykiem");
 *                 in capitals, the capital words of the same name ("EDITH MARGARET LORD");
 *   to the right: a first name after a family name ("Huber Andreas", "NOWAK, Zdeněk").
 *
 * A single surname that a spread marked as an organisation ("Koch" from "Koch Logistik") and that
 * follows a first name becomes the person it is ("Thomas Koch"). It only adds or widens ticks.
 *
 *   glue(text, findings) → findings (a new array)
 */

const { isFirstName } = require('./pii_names')
const { STOP } = require('./pii_candidates')

const TITLES = new Set(('Mr Mrs Ms Miss Mx Dr Prof Sir Dame Lord Lady Herr Herrn Frau Fräulein Mag. Dr. Prof. Dipl.-Ing. Ing. Bc. Mgr. JUDr. MUDr. PhDr. RNDr. PaedDr. doc. ' +
  'Pan Pani Panie Pana Panu Panem Pán Pani Pánovi Paní domnul doamna dl. dna. d-l d-na M. Mme Mlle Maître Me úr. dr.').split(' '))
const PARTICLES = new Set('Ó Ní Nic Uí Mac Mc van von zu de da di del della der den la le y bin al'.split(' '))
const CAPS_STOP = new Set(('BETWEEN AND OR BY OF THE IN ON TO FROM FOR WITH CLAIMANT DEFENDANT RESPONDENT APPLICANT PLAINTIFF ' +
  'MR MRS MS DR NAME SIGNED DATED WITNESS ATTORNEY POWER LASTING ENDURING WILL TESTAMENT DEED ORDER CLAIM CASE COURT ' +
  'HERR FRAU KLÄGER KLÄGERIN BEKLAGTE BEKLAGTER ZWISCHEN UND GEGEN VOLLMACHT TESTAMENT').split(' '))
const INITIALS = /^\p{Lu}\.(?:[-\s]?\p{Lu}\.)*$/u
const TITLECASE = /^\p{Lu}[\p{Ll}'’-]*\p{Ll}$/u
const CAPS = /^\p{Lu}[\p{Lu}'’-]*\p{Lu}$/u
const title = (w) => w.charAt(0) + w.slice(1).toLowerCase()
const firstName = (w) => isFirstName(w) || (CAPS.test(w) && isFirstName(title(w)))

/** The token right before `pos` on the same line, if only one space separates it. */
function before(text, pos) {
  // "Elena-Cristina": a first name joined by a hyphen
  if (text[pos - 1] === '-') {
    const h = text.slice(Math.max(0, pos - 40), pos - 1).match(/(\p{Lu}[\p{Ll}'’]+)$/u)
    if (h) return { w: h[1], start: pos - 1 - h[1].length, end: pos - 1, hyphen: true }
  }
  const m = text.slice(Math.max(0, pos - 60), pos).match(/(?:^|[\s(|:;,„“"'])([^\s(|:;,„“"']+)[  ]$/u)
  if (!m) return null
  const w = m[1]
  return { w, start: pos - 1 - w.length, end: pos - 1 }
}
function after(text, pos) {
  const m = text.slice(pos, pos + 60).match(/^(,? )([^\s,;:|()]+)/u)
  if (!m) return null
  const w = m[2].replace(/[.)]$/u, '')
  return { w, start: pos + m[1].length, end: pos + m[1].length + w.length, comma: m[1].startsWith(',') }
}
/** Is `pos` at a name slot: line start, after a label colon, a table bar, a bracket, a list number, a dash or a title? */
function slot(text, pos, end = null) {
  const left = text.slice(Math.max(0, pos - 40), pos)
  if (/(?:[:|(;–—]\s*|\d\.\s+|\t|\s{3,})$/u.test(left)) return true
  const b = before(text, pos)
  if (b && TITLES.has(b.w)) return true
  // a line start only when the name fills its slot ("Kerstin Fischer | …", not "Kann Huber kündigen?")
  return /(?:^|\n)$/u.test(left) && (end === null || slotEnd(text, end))
}
/** Does a name slot end at `pos` (end of line, a table bar, a comma, a bracket)? */
const slotEnd = (text, pos) => /^(?:\s*(?:\||\n|$)|,|\s*\(|\s{3,})/u.test(text.slice(pos, pos + 10))

function widen(text, f) {
  let { start, end } = f
  const words = f.text.trim().split(/\s+/u)
  const caps = CAPS.test(f.text.replace(/['’]s$/u, ''))
  const lastIsFirst = firstName(words[words.length - 1].replace(/['’]s$/u, ''))
  for (let step = 0; step < 4; step++) {
    const b = before(text, start)
    if (!b) break
    const w = b.w
    const ok = INITIALS.test(w) || TITLES.has(w) || PARTICLES.has(w) || firstName(w) || (b.hyphen && TITLECASE.test(w)) ||
      (caps && CAPS.test(w) && !CAPS_STOP.has(w) && w.length > 1) ||
      // a surname before a first name ("dr. Halász Krisztina", "Huber Andreas"), or the unknown first name before a surname in a name slot
      (step === 0 && TITLECASE.test(w) && !STOP.has(w) && !TITLES.has(w) && (lastIsFirst && words.length === 1 || (words.length <= 2 && slot(text, b.start, end))))
    if (!ok) break
    start = b.start
  }
  // initials go on: "A. H." + "-K."
  const ini = text.slice(end, end + 6).match(/^-\p{Lu}\./u)
  if (ini && INITIALS.test(words[words.length - 1])) end += ini[0].length
  const a = after(text, end)
  if (a && !/^\p{Ll}/u.test(f.text)) {
    if (firstName(a.w) && !firstName(text.slice(start, end).split(/\s+/u)[0]) && (a.comma ? CAPS.test(words[0]) || slot(text, start) : true)) end = a.end // "Huber Andreas", "NOWAK, Zdeněk"
    else if (!a.comma && TITLECASE.test(a.w.replace(/-.*/u, '')) && !STOP.has(a.w) && (lastIsFirst || (words.length === 1 && slot(text, start) && slotEnd(text, a.end)))) end = a.end // "Mme Claire Meunier", "| Kim Ji-woo |"
  }
  return { start, end }
}

function glue(text, findings) {
  const out = findings.map((f) => ({ ...f }))
  let changed = false
  for (const f of out) {
    const person = f.kind === 'PERSON'
    const orgSurname = f.kind === 'ORG' && f.source === 'spread' && !/\s/u.test(f.text.trim())
    if (!f.on || !(person || orgSurname)) continue
    if (orgSurname) {
      const b = before(text, f.start)
      if (!b || !(firstName(b.w) || (TITLECASE.test(b.w) && !STOP.has(b.w) && slot(text, b.start)))) continue
    }
    const w = widen(text, f)
    if (w.start === f.start && w.end === f.end) continue
    Object.assign(f, { start: w.start, end: w.end, text: text.slice(w.start, w.end), kind: 'PERSON', group: require('./pii_detect').GROUPS.PERSON, label: require('./pii_detect').KIND_LABELS.PERSON, widened: true })
    changed = true
  }
  // Two ticked parts of one name next to each other ("SOKOL" + ", " + "Matej") become one.
  out.sort((a, b) => a.start - b.start)
  for (let i = 0; i + 1 < out.length; i++) {
    const x = out[i], y = out[i + 1]
    if (x.on && y.on && x.kind === 'PERSON' && y.kind === 'PERSON' && y.start >= x.end && /^(?:[ \u00a0]|, )$/u.test(text.slice(x.end, y.start)) &&
        (firstName(y.text) || firstName(x.text) || INITIALS.test(y.text))) {
      Object.assign(x, { end: y.end, text: text.slice(x.start, y.end), widened: true })
      out.splice(i + 1, 1)
      i--
      changed = true
    }
  }
  if (!changed) return findings
  // Findings now inside a widened name go into it.
  const wide = out.filter((f) => f.widened)
  return out.filter((f) => f.widened || !(f.on && wide.some((w) => w.start <= f.start && f.end <= w.end && (f.kind === 'PERSON' || f.source === 'spread' || f.source === 'names'))))
    .sort((a, b) => a.start - b.start || b.end - a.end)
}

module.exports = { glue }
