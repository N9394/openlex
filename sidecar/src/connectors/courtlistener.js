"use strict"
/**
 * CourtListener — US case law (federal and state courts) from the Free Law
 * Project, a non-profit (courtlistener.com, REST API v4). Court opinions
 * are public domain; the collection is the Free Law Project's, under its
 * terms. A community source: kept by a non-profit, not by a court.
 *
 * The API needs the lawyer's own free token (sign up, then copy it from
 * the profile page), sent as "Authorization: Token …". The free token has
 * a small allowance, so OpenLex sends one request at a time, 12 seconds
 * apart (5 a minute). Free Law Project memberships ($10–100 a month) raise
 * the allowance.
 *
 *   GET /api/rest/v4/search/?q=…&type=o        opinions search
 *   GET /api/rest/v4/clusters/{id}/            one case (names, date, citations, opinions)
 *   GET /api/rest/v4/opinions/{id}/            the text of an opinion
 */

const { getJson, htmlToText, strip, SourceError } = require('./http')
const { paced } = require('./pace')

const BASE = () => (process.env.OPENLEX_COURTLISTENER_API || 'https://www.courtlistener.com').replace(/\/+$/, '')
const SITE = 'https://www.courtlistener.com'
const LABEL = 'CourtListener'
const GAP_MS = 12000

const call = (fn) => paced('courtlistener', GAP_MS, fn)
const hdr = (key) => ({ Authorization: `Token ${String(key || '').replace(/^Token\s+/i, '').trim()}` })
const api = (path, key) => call(() => getJson(`${BASE()}/api/rest/v4${path}`, { label: LABEL, headers: hdr(key) }))
const idOf = (url) => (String(url || '').match(/\/(\d+)\/?$/) || [])[1] || null
const cite = (c) => (typeof c === 'string' ? c : c && c.volume ? `${c.volume} ${c.reporter} ${c.page}` : '')

const connector = {
  id: 'courtlistener',
  label: 'CourtListener (US case law)',
  country: 'US',
  jurisdictions: ['US'],
  kind: 'caselaw',
  community: true,
  description: 'US court decisions, federal and state, collected by the Free Law Project (a non-profit), with citations',
  licence: 'Court opinions are public domain; collection by the Free Law Project, under its terms of use',
  licenceUrl: 'https://www.courtlistener.com/terms/',
  homepage: 'https://www.courtlistener.com',
  needsKey: true,
  needsKeyWords: 'needs your free CourtListener token',
  keyHelp: 'Free: open https://www.courtlistener.com/sign-in/ and create an account, then open https://www.courtlistener.com/profile/api/ and copy your API token. Paste it here. The free token allows a few searches a minute; a Free Law Project membership ($10–100 a month) allows more.',
  guide: 'courtlistener',
  hosts: ['www.courtlistener.com'],
  sample: 'qualified immunity',
  de: {
    label: 'CourtListener (US-Rechtsprechung)',
    description: 'US-Gerichtsentscheidungen von Bundes- und Staatsgerichten, gesammelt vom Free Law Project (gemeinnützig), mit Fundstellen',
    needsKeyWords: 'braucht Ihr kostenloses CourtListener-Token',
    keyHelp: 'Kostenlos: auf https://www.courtlistener.com/sign-in/ ein Konto anlegen, dann auf https://www.courtlistener.com/profile/api/ das API-Token kopieren und hier einfügen.',
  },

  checkKey(key) {
    if (!/^(Token\s+)?[0-9a-f]{40}$/i.test(String(key).trim())) throw new SourceError('That does not look like a CourtListener token (40 letters and digits from your profile page)', 'key')
  },

  async search(query, { limit = 8 } = {}, { key = null } = {}) {
    const j = await api(`/search/?${new URLSearchParams({ q: String(query), type: 'o' })}`, key)
    if (!Array.isArray(j?.results)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no results')
    return j.results.slice(0, limit).map((r) => {
      const cites = (r.citation || []).map(cite).filter(Boolean)
      const snip = (r.opinions || []).map((o) => strip(o.snippet || '')).find(Boolean) || ''
      return {
        ref: String(r.cluster_id),
        title: strip(r.caseName || r.caseNameFull || `Case ${r.cluster_id}`),
        citation: connector.citation(String(r.cluster_id), { name: r.caseName, cites, court: r.court_citation_string, date: r.dateFiled }),
        url: r.absolute_url ? `${SITE}${r.absolute_url}` : `${SITE}/opinion/${r.cluster_id}/`,
        snippet: [r.court, r.docketNumber ? `No. ${r.docketNumber}` : '', snip].filter(Boolean).join(' · ').slice(0, 600),
        date: r.dateFiled || null,
        inForce: null,
      }
    })
  },

  /** The text of a case (ref: the cluster id from a search result). */
  async get(ref, opts = {}, { key = null } = {}) {
    const id = String(ref || '').trim()
    if (!/^\d{1,12}$/.test(id)) throw new SourceError(`${LABEL}: give the case number from a search result`, 'bad')
    const cl = await api(`/clusters/${id}/`, key)
    const first = (cl.sub_opinions || []).map(idOf).find(Boolean)
    let text = ''
    if (first) {
      const op = await api(`/opinions/${first}/`, key)
      text = op.plain_text && op.plain_text.trim() ? op.plain_text.trim() : htmlToText(op.html_with_citations || op.html || op.html_lawbox || op.html_columbia || op.xml_harvard || '')
    }
    if (!text) text = strip(cl.syllabus || cl.summary || '')
    if (text.length > 120000) text = text.slice(0, 120000)
    const cites = (cl.citations || []).map(cite).filter(Boolean)
    return {
      ref: id,
      title: strip(cl.case_name || cl.case_name_full || `Case ${id}`),
      citation: connector.citation(id, { name: cl.case_name, cites, date: cl.date_filed }),
      url: cl.absolute_url ? `${SITE}${cl.absolute_url}` : `${SITE}/opinion/${id}/`,
      text,
      date: cl.date_filed || null,
      ...(text ? {} : { note: 'CourtListener has no text for this case; open the link to read it.' }),
    }
  },

  /** "Miranda v. Arizona, 384 U.S. 436 (1966) (CourtListener 107252)". */
  citation(ref, x = {}) {
    const year = x.date ? String(x.date).slice(0, 4) : ''
    const name = x.name ? strip(x.name) : ''
    const cites = (x.cites || []).slice(0, 1).join('')
    const head = [name, cites].filter(Boolean).join(', ')
    return `${head}${year ? ` (${x.court ? `${x.court} ` : ''}${year})` : ''}${head ? ' ' : ''}(CourtListener ${ref})`
  },
}

module.exports = connector
