"use strict"
/**
 * Open Legal Data — German court decisions from all court levels (federal
 * courts and the Länder), collected by the Open Legal Data project
 * (de.openlegaldata.io; code MIT, dumps ODbL). Free API, no key needed; a
 * free account token raises the limits ("Authorization: Token <key>").
 *
 * A community source, said so in /law: the project gathers decisions from
 * the courts' own publication portals, and some of those portals ask bots
 * not to collect them (robots rules). Court decisions themselves are
 * official works without copyright (§ 5 UrhG).
 *
 *   GET /api/cases/search/?text=…&page_size=N   full-text search (snippets)
 *   GET /api/cases/{id}/                         one decision with its text (HTML)
 */

const { getJson, htmlToText, strip, SourceError } = require('./http')
const { paced } = require('./pace')

const BASE = () => (process.env.OPENLEX_OLDP_API || 'https://de.openlegaldata.io').replace(/\/+$/, '')
const SITE = 'https://de.openlegaldata.io'
const LABEL = 'Open Legal Data'
const GAP_MS = 500

const headers = (key) => (key ? { Authorization: `Token ${key}` } : {})
const call = (path, key) => paced('openlegaldata', GAP_MS, () => getJson(`${BASE()}${path}`, { label: LABEL, headers: headers(key) }))
const deDate = (d) => (/^\d{4}-\d\d-\d\d$/.test(String(d)) ? String(d).split('-').reverse().join('.') : d || '')

const connector = {
  id: 'openlegaldata',
  label: 'Open Legal Data (German case law)',
  country: 'DE',
  jurisdictions: ['DE'],
  kind: 'caselaw',
  community: true,
  description: 'German court decisions of all court levels, federal and Länder (over 400,000), collected from the courts\' publication portals by the Open Legal Data project',
  licence: 'Court decisions are official works, free of copyright (§ 5 UrhG); collection by Open Legal Data (community project, database dumps under ODbL)',
  licenceUrl: 'https://de.openlegaldata.io/pages/legal/',
  homepage: 'https://de.openlegaldata.io',
  needsKey: false,
  optionalKey: true,
  keyHelp: 'Optional: works without a key. A free token raises the limits: open de.openlegaldata.io, sign up, then copy the API token from your account page and paste it here.',
  guide: 'openlegaldata',
  hosts: ['de.openlegaldata.io'],
  sample: 'Kaufvertrag Mangel',
  de: {
    label: 'Open Legal Data (deutsche Rechtsprechung)',
    description: 'Deutsche Gerichtsentscheidungen aller Instanzen, Bund und Länder (über 400.000), vom Projekt Open Legal Data aus den Veröffentlichungsportalen der Gerichte gesammelt',
    keyHelp: 'Optional: funktioniert ohne Schlüssel. Ein kostenloses Token erhöht die Grenzen: de.openlegaldata.io öffnen, registrieren, das API-Token auf Ihrer Kontoseite kopieren und hier einfügen.',
  },

  checkKey(key) {
    if (/\s/.test(String(key)) || String(key).length < 20) throw new SourceError(`${LABEL}: this does not look like an API token (copy it from your account page)`, 'key')
  },

  async search(query, { limit = 8 } = {}, { key = null } = {}) {
    const json = await call(`/api/cases/search/?${new URLSearchParams({ text: String(query), page_size: String(Math.min(limit, 20)) })}`, key)
    if (!Array.isArray(json?.results)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no results list')
    return json.results.slice(0, limit).map((r) => ({
      ref: String(r.id),
      title: [r.court, r.decision_type, deDate(r.date)].filter(Boolean).join(', '),
      citation: connector.citation(r.id, { court: r.court, type: r.decision_type, date: r.date }),
      url: `${SITE}/case/${r.slug}`,
      snippet: (r.snippets || []).map((s) => strip(String(s.text).replace(/<\/?em>/g, ''))).join(' … ').slice(0, 600),
      date: r.date || null,
      inForce: null,
    }))
  },

  /** The decision's full text (Tenor, Gründe …). */
  async get(ref, { article = null } = {}, { key = null } = {}) {
    const id = String(ref || '').trim().replace(/^.*\/case\//, '')
    if (!/^\d{1,9}$/.test(id)) throw new SourceError(`${LABEL}: give the number from a search result`, 'bad')
    const c = await call(`/api/cases/${id}/`, key)
    let text = htmlToText(c.content || '')
    if (article) {
      const n = String(article).replace(/^\s*(rn\.?|randnummer)\s*/i, '').trim()
      const m = new RegExp(`(^|\\n)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`).exec(text)
      if (m) text = text.slice(m.index + m[1].length).split(/\n\d{1,4}\n/).slice(0, 1).join('')
    }
    const court = c.court?.name || ''
    return {
      ref: id,
      title: [court, c.type, c.date ? `vom ${deDate(c.date)}` : '', c.file_number ? `– ${c.file_number}` : ''].filter(Boolean).join(' '),
      citation: connector.citation(id, { court, type: c.type, date: c.date, fileNumber: c.file_number, ecli: c.ecli }),
      url: `${SITE}/case/${c.slug}`,
      sourceUrl: c.source_url || null,
      text,
      date: c.date || null,
      ...(c.source_url ? { note: `Published by the court at ${c.source_url}` } : {}),
    }
  },

  /** "BGH, Urteil vom 13.04.2011 – VIII ZR 220/10 (Open Legal Data, 426410)". */
  citation(ref, x = {}) {
    const head = [x.court, x.type ? `${x.type}${x.date ? ` vom ${deDate(x.date)}` : ''}` : x.date ? deDate(x.date) : ''].filter(Boolean).join(', ')
    const ecli = x.ecli ? `, ${x.ecli}` : ''
    return `${head}${x.fileNumber ? ` – ${x.fileNumber}` : ''}${ecli} (Open Legal Data, ${ref})`.trim()
  },
}

module.exports = connector
