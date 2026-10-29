"use strict"
/**
 * Judilibre — French court decisions from the Cour de cassation's open
 * data (decisions of the Cour de cassation, the cours d'appel and, as they
 * are published, the tribunaux judiciaires), pseudonymised by the court.
 * Official API reached through PISTE with the lawyer's free key (the same
 * PISTE key as Légifrance; legifrance.js holds the token code). Licence
 * Ouverte 2.0. French law forbids reusing the judges' and court clerks'
 * identity data to evaluate, analyse, compare or predict their professional
 * practice (art. L111-13 of the Code de l'organisation judiciaire);
 * OpenLex only looks decisions up, per question.
 *
 *   GET /search?query=…&page_size=N      relevance search, highlights
 *   GET /decision?id=…                   full text with its zones
 */

const { strip, SourceError } = require('./http')
const { piste, parseKey } = require('./legifrance')

const API = () => (process.env.OPENLEX_JUDILIBRE_API || 'https://api.piste.gouv.fr/cassation/judilibre/v1.0').replace(/\/+$/, '')
const LABEL = 'Judilibre'
const SITE = 'https://www.courdecassation.fr/decision'
const REF_RE = /^[a-f0-9]{24}$/i

const COURTS = { cc: 'Cass.', ca: 'CA', tj: 'TJ', tcom: 'T. com.' }
const COURT_NAMES = { cc: 'Cour de cassation', ca: 'Cour d\'appel', tj: 'Tribunal judiciaire', tcom: 'Tribunal de commerce' }
const CHAMBERS = { civ1: '1re civ.', civ2: '2e civ.', civ3: '3e civ.', comm: 'com.', soc: 'soc.', cr: 'crim.', mi: 'ch. mixte', pl: 'ass. plén.', ordo: 'ord.', avis: 'avis' }
const CHAMBER_NAMES = { civ1: 'première chambre civile', civ2: 'deuxième chambre civile', civ3: 'troisième chambre civile', comm: 'chambre commerciale', soc: 'chambre sociale', cr: 'chambre criminelle', mi: 'chambre mixte', pl: 'assemblée plénière', ordo: 'ordonnance', avis: 'avis' }
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const frDate = (d) => { const m = String(d || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? `${+m[3] === 1 ? '1er' : +m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '' }
const place = (loc) => (loc ? String(loc).replace(/^(ca|tj|tcom)_/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-') : '')

/** "Cass. 3e civ., 20 déc. 2018, n° 17-18.194"; "CA Paris, 12 mars 2024, n° 21/01234". */
function citation(ref, d = {}) {
  if (!d.jurisdiction) return `${ref} (Judilibre)`
  const court = d.jurisdiction === 'cc' ? `Cass. ${CHAMBERS[d.chamber] || d.chamber || ''}`.trim() : [COURTS[d.jurisdiction] || d.jurisdiction, place(d.location)].filter(Boolean).join(' ')
  return [court, frDate(d.decision_date), d.number ? `n° ${d.number}` : ''].filter(Boolean).join(', ')
}

function titleOf(d) {
  const court = d.jurisdiction === 'cc' ? `Cour de cassation, ${CHAMBER_NAMES[d.chamber] || d.chamber || ''}`.replace(/, $/, '') : [COURT_NAMES[d.jurisdiction] || d.jurisdiction, place(d.location)].filter(Boolean).join(' de ')
  return [court, d.decision_date, d.number].filter(Boolean).join(', ')
}

const ZONES = { introduction: 'introduction', expose: 'expose', exposé: 'expose', facts: 'expose', moyens: 'moyens', grounds: 'moyens', motivations: 'motivations', reasons: 'motivations', reasoning: 'motivations', dispositif: 'dispositif', 'operative part': 'dispositif', ruling: 'dispositif', annexes: 'annexes', moyens_annexes: 'annexes' }

const call = (key, path) => piste(key, { label: LABEL, api: API(), path, paceKey: 'piste-judilibre' })

const connector = {
  id: 'judilibre',
  label: 'Judilibre',
  country: 'FR',
  jurisdictions: ['FR'],
  kind: 'caselaw',
  description: 'French court decisions from the Cour de cassation\'s open data (Cour de cassation, cours d\'appel, tribunaux judiciaires), pseudonymised by the court',
  licence: 'Licence Ouverte 2.0 (Etalab); Cour de cassation. No profiling of judges (art. L111-13 COJ)',
  licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  homepage: 'https://www.courdecassation.fr/acces-rapide-judilibre',
  needsKey: true,
  keyId: 'piste',
  needsKeyWords: 'needs your free PISTE key',
  keyHelp: 'Free, about 10 minutes: 1. Create an account at piste.gouv.fr. 2. Create an application. 3. Subscribe it to the Légifrance and Judilibre APIs and accept their terms (CGU). 4. Copy the client id and the client secret. 5. Paste them here as id:secret. One key serves Légifrance and Judilibre.',
  guide: 'piste',
  hosts: ['api.piste.gouv.fr', 'oauth.piste.gouv.fr'],
  de: {
    label: 'Judilibre (Frankreich)',
    description: 'Französische Gerichtsentscheidungen aus den offenen Daten der Cour de cassation (Cour de cassation, Berufungsgerichte, Tribunaux judiciaires), vom Gericht pseudonymisiert',
    needsKeyWords: 'braucht Ihren kostenlosen PISTE-Schlüssel',
    keyHelp: 'Kostenlos, etwa 10 Minuten: 1. Konto auf piste.gouv.fr anlegen. 2. Eine Anwendung anlegen. 3. Sie für die APIs Légifrance und Judilibre abonnieren und deren Bedingungen (CGU) annehmen. 4. Client-ID und Client-Secret kopieren. 5. Hier als id:secret einfügen. Ein Schlüssel gilt für Légifrance und Judilibre.',
  },
  sample: 'clause abusive',
  checkKey: (key) => { parseKey(key) },

  async search(query, { limit = 8 } = {}, { key } = {}) {
    const q = new URLSearchParams({ query: String(query).slice(0, 300), page_size: String(Math.min(Math.max(limit, 1), 20)), resolve_references: 'false' })
    const json = await call(key, `/search?${q}`)
    if (!Array.isArray(json?.results)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no results list')
    return json.results.slice(0, limit).map((d) => {
      const hl = Object.values(d.highlights || {}).flat().map(strip).filter(Boolean)
      return {
        ref: d.id,
        title: titleOf(d),
        citation: citation(d.id, d),
        url: `${SITE}/${d.id}`,
        snippet: [d.solution ? `${d.solution}` : '', strip(d.summary || '') || hl.slice(0, 2).join(' … ')].filter(Boolean).join(' · ').slice(0, 700),
        date: d.decision_date || null,
        inForce: null,
      }
    })
  },

  /** The decision in full, or one part of it (article: "dispositif", "motivations", "moyens", "exposé"). */
  async get(ref, { article = null } = {}, { key } = {}) {
    const id = String(ref || '').trim()
    if (!REF_RE.test(id)) throw new SourceError(`${LABEL}: give the identifier from a search result`, 'bad')
    const d = await call(key, `/decision?${new URLSearchParams({ id, resolve_references: 'false' })}`)
    if (!d?.id || typeof d.text !== 'string') throw new SourceError(`${LABEL} has no such document`, 'notfound')
    let text = d.text
    if (article) {
      const z = ZONES[String(article).trim().toLowerCase()]
      const spans = z ? d.zones?.[z] || (z === 'annexes' ? d.zones?.moyens_annexes : null) : null
      if (!z || !Array.isArray(spans) || !spans.length) throw new SourceError(`${LABEL}: this decision has no part "${article}" (try dispositif, motivations, moyens or exposé)`, 'notfound')
      text = spans.map((s) => d.text.slice(s.start, s.end).trim()).join('\n')
    }
    return {
      ref: d.id,
      title: titleOf(d),
      citation: citation(d.id, d),
      url: `${SITE}/${d.id}`,
      text: text.length > 60000 ? text.slice(0, 60000) : text,
      date: d.decision_date || null,
    }
  },

  citation,
}

module.exports = connector
