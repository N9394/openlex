"use strict"
/**
 * SAOS — Polish court judgments from the Court Decisions Analysis System
 * (System Analizy Orzeczeń Sądowych, saos.org.pl), run by ICM at the
 * University of Warsaw. A research collection, not an official court
 * service: current judgments of the common courts, the Supreme Court up to
 * about 2016 and the Constitutional Tribunal up to about 2015; no
 * administrative courts. Documented open API, no key.
 *
 *   GET /api/search/judgments?all=…&pageSize=N&sortingField=JUDGMENT_DATE&sortingDirection=DESC
 *   GET /api/search/judgments?caseNumber=I ACa 756/12
 *   GET /api/judgments/{id}
 *
 * Judgments are official documents without copyright (art. 4 of the Polish
 * Copyright Act); SAOS states no licence for its collection, so OpenLex
 * labels it a community source. SAOS's robots.txt asks crawlers to stay
 * out of /api/; OpenLex does not crawl: one look-up per question, one
 * request at a time, a second apart.
 */

const { getJson, htmlToText, strip, SourceError } = require('./http')
const { paced } = require('./pace')

const BASE = () => (process.env.OPENLEX_SAOS_API || 'https://www.saos.org.pl/api').replace(/\/+$/, '')
const SITE = 'https://www.saos.org.pl'
const LABEL = 'SAOS (Polish court judgments)'
const GAP_MS = 1000

const call = (url) => paced('saos', GAP_MS, () => getJson(url, { label: LABEL }))

const COURTS = { SUPREME: 'Sąd Najwyższy', CONSTITUTIONAL_TRIBUNAL: 'Trybunał Konstytucyjny', NATIONAL_APPEAL_CHAMBER: 'Krajowa Izba Odwoławcza', ADMINISTRATIVE: 'sąd administracyjny', COMMON: 'sąd powszechny' }
const TYPES = { SENTENCE: 'wyrok', DECISION: 'postanowienie', RESOLUTION: 'uchwała', REGULATION: 'zarządzenie', REASONS: 'uzasadnienie' }
const CASE_RE = /^[IVXL]{1,6}\s+[A-Za-zÓóŁł]{1,6}(?:\s+[A-Za-z]{1,4})?\s+\d{1,6}\/\d{2,4}$/

const courtOf = (x) => x.division?.court?.name || COURTS[x.courtType] || 'court'
const caseOf = (x) => (x.courtCases || []).map((c) => c.caseNumber).filter(Boolean).join(', ')
const day = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d).split('-').reverse().join('.') : d || '')

function item(x) {
  const ref = String(x.id)
  const type = TYPES[x.judgmentType] || ''
  return {
    ref,
    title: [courtOf(x), day(x.judgmentDate), caseOf(x), type ? `(${type})` : ''].filter(Boolean).join(', ').replace(/, \(/, ' ('),
    citation: connector.citation(ref, { court: courtOf(x), date: x.judgmentDate, caseNumber: caseOf(x), type }),
    url: `${SITE}/judgments/${ref}`,
    snippet: strip(String(x.textContent || '').replace(/<\/?em>/g, '')).slice(0, 600),
    date: x.judgmentDate || null,
    inForce: null,
  }
}

const connector = {
  id: 'saos',
  label: LABEL,
  country: 'PL',
  jurisdictions: ['PL'],
  kind: 'caselaw',
  community: true,
  description: 'Polish court judgments from SAOS (University of Warsaw): current common-court judgments, the Supreme Court to about 2016, the Constitutional Tribunal to about 2015; a research collection, not an official court service',
  licence: 'Judgments are official documents without copyright (art. 4 of the Polish Copyright Act); SAOS (ICM, University of Warsaw) states no licence for its collection',
  licenceUrl: 'https://www.saos.org.pl/help/index.php/dokumentacja-api',
  homepage: 'https://www.saos.org.pl',
  needsKey: false,
  guide: 'saos',
  hosts: ['www.saos.org.pl'],
  sample: 'rękojmia za wady',
  de: { label: 'SAOS (polnische Gerichtsentscheidungen)', description: 'Polnische Gerichtsentscheidungen aus SAOS (Universität Warschau): aktuelle Urteile der ordentlichen Gerichte, Oberstes Gericht bis etwa 2016, Verfassungsgericht bis etwa 2015; eine Forschungssammlung, kein amtlicher Gerichtsdienst' },

  async search(query, { limit = 8 } = {}) {
    const q = String(query).trim()
    const size = String(Math.max(1, Math.min(limit, 20)))
    const params = CASE_RE.test(q)
      ? { caseNumber: q, pageSize: size }
      : { all: q, pageSize: size, sortingField: 'JUDGMENT_DATE', sortingDirection: 'DESC' }
    const json = await call(`${BASE()}/search/judgments?${new URLSearchParams(params)}`)
    if (!Array.isArray(json?.items)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no items')
    return json.items.slice(0, limit).map(item)
  },

  /** The full judgment (the reasons too, when SAOS has them). */
  async get(ref) {
    const id = String(ref || '').trim().replace(/^.*\/judgments\//, '')
    if (!/^\d{1,9}$/.test(id)) throw new SourceError(`${LABEL}: give the number of a judgment from a search result`, 'bad')
    const json = await call(`${BASE()}/judgments/${id}`)
    const x = json?.data
    if (!x) throw new SourceError(`${LABEL} has no such judgment`, 'notfound')
    const base = item({ ...x, textContent: '' })
    const head = [
      base.title,
      x.judges?.length ? `Judges: ${x.judges.map((j) => j.name).join(', ')}` : '',
      x.legalBases?.length ? `Legal bases: ${x.legalBases.join('; ')}` : '',
      x.keywords?.length ? `Keywords: ${x.keywords.join(', ')}` : '',
    ].filter(Boolean).join('\n')
    const body = htmlToText(String(x.textContent || '').replace(/<span class="anon-block">([\s\S]*?)<\/span>/g, '$1'))
    return {
      ref: id,
      title: base.title,
      citation: base.citation,
      url: base.url,
      text: `${head}\n\n${body}`.trim(),
      date: x.judgmentDate || null,
      ...(x.source?.judgmentUrl ? { note: `SAOS took this judgment from the court's own publication: ${x.source.judgmentUrl}` } : {}),
    }
  },

  /** "Sąd Okręgowy w Łodzi, 25.08.2026, VIII U 3041/24 (SAOS 551289)". */
  citation(ref, x = {}) {
    const what = [x.court, day(x.date), x.caseNumber].filter(Boolean).join(', ')
    return `${what ? `${what} ` : ''}(SAOS ${ref})`
  },
}

module.exports = connector
