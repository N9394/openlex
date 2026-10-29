"use strict"
/**
 * opencaselaw.ch — Swiss court decisions (federal courts and all 26
 * cantons, about a million decisions, updated daily) from a community
 * project that collects them from the courts' official publication
 * channels and publishes them under CC0 (the ECtHR part excepted). Free,
 * no key, through its published MCP server (mcp.opencaselaw.ch/mcp,
 * Streamable HTTP), read with the engine's MCP client (mcp_http.js).
 *
 * Tool names come from the server's own tools/list, so a renamed tool on
 * their side does not need a new OpenLex release:
 *   search_decisions { query, limit, language? }      → structured results
 *   get_decision     { decision_id, full_text }       → one decision
 *   get_erwaegung    { decision_id, e_number }        → one consideration ("E. 2")
 * Every result links to the court's own publication (source_url) where
 * there is one; "Check the official version" means that page.
 */

const { SourceError, strip } = require('./http')
const { McpSession, resultJson, resultText } = require('./mcp_http')
const { paced } = require('./pace')

const LABEL = 'opencaselaw.ch'
const URL_ = () => process.env.OPENLEX_OPENCASELAW_URL || 'https://mcp.opencaselaw.ch/mcp'
const GAP_MS = 300 // no published limit: a few requests a second at most, one at a time
const KEEP_MS = 10 * 60000
const MAX_TEXT = 60000

let cached = null // { session, tools, at, url }

/** A session with its tools (kept ten minutes: the server is stateless). */
async function session() {
  if (cached && cached.url === URL_() && Date.now() - cached.at < KEEP_MS) return cached
  const s = new McpSession({ url: URL_(), label: LABEL })
  const send = s.send.bind(s)
  s.send = (...a) => paced('opencaselaw', GAP_MS, () => send(...a))
  await s.open()
  const tools = await s.tools()
  cached = { session: s, tools, at: Date.now(), url: URL_() }
  return cached
}

const findTool = (tools, names, re) => names.map((n) => tools.find((t) => t.name === n)).find(Boolean) || (re ? tools.find((t) => re.test(t.name)) : null)
const has = (t, p) => Object.prototype.hasOwnProperty.call(t?.inputSchema?.properties || {}, p)

const citeOf = (r, lang) => (lang === 'fr' ? r.citation_string_fr : lang === 'it' ? r.citation_string_it : r.citation_string_de) || r.citation_string_de || r.docket_number || r.decision_id
/** Line breaks the court texts put around inline references ("l'\nart. 18 al. 3 AMSL\n, une") taken out. */
const tidy = (t) => String(t).replace(/(['’(])\n/g, '$1').replace(/\n(?=[,.;:)])/g, '').trim()
const clean = (s) => strip(String(s || '').replace(/<br\s*\/?>/gi, ' ')).replace(/^Regest[eo]\s*/i, '')

function item(r, lang) {
  return {
    ref: r.decision_id,
    title: [r.court_name || r.court, r.docket_number, r.decision_date].filter(Boolean).join(', ') + (r.title ? `: ${clean(r.title).slice(0, 160)}${clean(r.title).length > 160 ? '…' : ''}` : ''),
    citation: connector.citation(r.decision_id, { cite: citeOf(r, lang) }),
    url: r.source_url || r.canonical_url || null,
    snippet: clean(r.regeste || r.snippet).slice(0, 600),
    date: r.decision_date || null,
    inForce: null,
    jurisdiction: 'CH',
  }
}

/** "2", "5.2.2" for "E. 2", "consid. 5.2.2", "Erwägung 3"; null otherwise. */
function eNumber(article) {
  const m = String(article || '').trim().match(/^(?:E\.?|Erw(?:ägung|\.)?|consid(?:érant|\.)?|cons\.)?\s*(\d+(?:\.\d+)*)$/i)
  return m ? m[1] : null
}

const connector = {
  id: 'opencaselaw',
  label: 'opencaselaw.ch',
  country: 'CH',
  jurisdictions: ['CH'],
  kind: 'caselaw',
  community: true,
  description: 'Swiss court decisions, federal and all 26 cantons (about a million, updated daily), collected from the courts\' official publications by a community project',
  licence: 'CC0 1.0 (decisions; the European Court of Human Rights part is excluded); court decisions are free of copyright (Art. 5 URG)',
  licenceUrl: 'https://opencaselaw.ch',
  homepage: 'https://opencaselaw.ch',
  needsKey: false,
  guide: 'opencaselaw',
  hosts: ['mcp.opencaselaw.ch'],
  sample: 'Mietzinserhöhung Kündigung',
  de: {
    label: 'opencaselaw.ch',
    description: 'Schweizer Gerichtsentscheide, Bund und alle 26 Kantone (rund eine Million, täglich aktualisiert), von einem Community-Projekt aus den amtlichen Publikationen der Gerichte gesammelt',
  },

  async search(query, { limit = 8, lang = null } = {}) {
    const { session: s, tools } = await session()
    const tool = findTool(tools, ['search_decisions', 'search'], /search.*decision/)
    if (!tool) throw new SourceError(`${LABEL} offers no search right now`, 'down', 'no search tool')
    const args = { query: String(query).slice(0, 500), limit: Math.min(limit, 20) }
    if (has(tool, 'fields')) args.fields = 'full'
    const r = await s.call(tool.name, args)
    const j = resultJson(r)
    const rows = Array.isArray(j?.results) ? j.results : Array.isArray(j) ? j : null
    if (!rows) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', resultText(r).slice(0, 120))
    return rows.slice(0, limit).map((x) => item(x, lang))
  },

  /** A decision (or one consideration of it with article: "E. 2"). */
  async get(ref, { article = null, lang = null } = {}) {
    const id = String(ref || '').trim()
    if (!id || id.length > 200) throw new SourceError(`${LABEL}: give the decision from a search result (for example bge_115 II 83)`, 'bad')
    const { session: s, tools } = await session()
    const e = article ? eNumber(article) : null
    if (article && !e) throw new SourceError(`${LABEL}: give the consideration as "E. 2"`, 'bad')
    const getDecision = findTool(tools, ['get_decision', 'fetch'], /^get_decision/)
    if (!getDecision) throw new SourceError(`${LABEL} offers no full texts right now`, 'down', 'no get tool')
    if (e) {
      const tool = findTool(tools, ['get_erwaegung'])
      if (tool) {
        const r = await s.call(tool.name, { decision_id: id, e_number: e }, { notFound: true })
        const j = resultJson(r)
        if (!j?.text) throw new SourceError(`${LABEL}: E. ${e} was not found in this decision`, 'notfound')
        return {
          ref: id,
          title: `${citeOf(j, lang)}`,
          citation: connector.citation(id, { cite: citeOf(j, lang) }),
          url: j.canonical_url || null,
          text: `E. ${e}\n${tidy(j.text)}`,
        }
      }
    }
    const r = await s.call(getDecision.name, has(getDecision, 'decision_id') ? { decision_id: id, full_text: true } : { id }, { notFound: true })
    const j = resultJson(r)
    if (!j || (!j.full_text && !j.regeste)) throw new SourceError(`${LABEL} has no such document`, 'notfound', resultText(r).slice(0, 120))
    let text = tidy(j.full_text || clean(j.regeste))
    if (e) { // no consideration tool: cut it out of the full text
      const m = new RegExp(`(^|\\n)\\s*${e.replace(/\./g, '\\.')}\\.?\\s[\\s\\S]*?(?=\\n\\s*\\d+(?:\\.\\d+)*\\.?\\s|$)`).exec(text)
      if (!m) throw new SourceError(`${LABEL}: E. ${e} was not found in this decision`, 'notfound')
      text = m[0].trim()
    }
    if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n…`
    return {
      ref: id,
      title: [j.court_name || j.court, j.docket_number, j.decision_date].filter(Boolean).join(', '),
      citation: connector.citation(id, { cite: citeOf(j, lang) }),
      url: j.source_url || j.canonical_url || null,
      text,
      date: j.decision_date || null,
    }
  },

  /** "BGE 115 II 83 (opencaselaw.ch)". */
  citation(ref, x = {}) {
    return `${x.cite || ref} (opencaselaw.ch)`
  },
}

module.exports = { ...connector, eNumber, _reset: () => { cached = null } }
