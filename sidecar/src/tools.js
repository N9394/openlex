"use strict"
const path = require('path')
/**
 * Tool definitions + dispatch for the agent (spec §3.3).
 *
 * Every tool returns COMPRESSED output sized to fit the 8K budget. The
 * system prompt lists tools in the same shape Lotus was fine-tuned on
 * (search_legal_database with query/query2/query3), so routing stays in
 * the model's sweet spot.
 */

const { lawDigest } = require('./compress')
const { compressToolOutput } = require('./compression')
const { getCatalogText, getSchemas } = require('./catalog')

/** Language for EU texts: explicit, else the document's language, else English. */
function euLang(explicit, doc) {
  const want = String(explicit || '').toLowerCase().slice(0, 2)
  if (/^[a-z]{2}$/.test(want)) return want
  try {
    const j = String(doc?.jurisdiction?.() || '').toUpperCase()
    const byJur = { AT: 'de', DE: 'de', CH: 'de', SK: 'sk', CZ: 'cs', RO: 'ro', CY: 'el', GR: 'el', FR: 'fr', IT: 'it', ES: 'es', PL: 'pl', HU: 'hu', NL: 'nl' }
    if (byJur[j]) return byJur[j]
  } catch { /* no doc */ }
  return 'en'
}

/** Workspace folder name for the active matter (policy.withMatter context). */
function currentMatterName() {
  const id = require('./policy').currentMatter()
  const m = id ? require('./matters').get(id) : null
  return m ? (m.number ? `${m.number} ${m.title}` : m.title) : 'default'
}

const TOOLS = {
  get_document_map: {
    description: 'Heading outline with paragraph ranges. Cheap, use first.',
    input: {},
  },
  get_range_text: {
    description: 'Section text. Structured clause table + FULL verbatim text — quotes/cites are always verbatim, no raw flag needed. Use heading instead of index when you know the clause name (e.g. "force majeure").',
    input: { index: 'number', heading: 'string (optional — case-insensitive, matches the clause title)' },
  },
  get_clause_analysis: {
    description: 'Structured: parties, rights, obligations, favoring — plus the full verbatim clause text.',
    input: { index: 'number' },
  },
  search_law: {
    description: 'Hybrid law search. Up to 3 queries in the jurisdiction language with statutory terms.',
    input: { jurisdiction: 'string', query: 'string', query2: 'string', query3: 'string' },
  },
  search_firm_library: {
    description: "Search the firm's own documents (precedents, templates, know-how) indexed locally — this matter's folders plus firm-wide ones. Cite results by file name.",
    input: { query: 'string' },
  },
  search_sources: {
    description: "Search the firm's connected data sources: its own databases, the legal databases and commentaries it subscribes to, DMS and document folders (configured in openlex.json). Filter by kind (law, caselaw, commentary, firm) or jurisdiction. Every result names its source and citation; cite them exactly.",
    input: { query: 'string', kind: 'string (optional — law, caselaw, commentary, firm)', jurisdiction: 'string (optional — AT, DE, …)', sources: 'array (optional — source names)' },
  },
  find_clause: {
    description: "The firm's own clauses from its precedents, by type (governing_law, disputes, liability, indemnity, termination, term, confidentiality, force_majeure, ip, data_protection, payment, warranty, penalty, non_compete, assignment, change_of_control, notices, severability, entire_agreement, insurance, subcontracting) and/or words. Most-used wording first, with the documents it appears in. Prefer the firm's standard wording when drafting or proposing a rewrite.",
    input: { type: 'string (optional — clause type id)', query: 'string (optional — words to match)', language: 'string (optional — de, en, …)' },
  },
  search_ris: {
    description: 'Live search of Austrian federal law in the official RIS (current versions, with in-force dates). Needs web access allowed by the data policy.',
    input: { query: 'string (German statutory terms)', limit: 'number (optional, ≤20)' },
  },
  search_eurlex: {
    description: 'EU law from the official EU Publications Office (EUR-Lex data): find an act by reference ("2016/679", "Regulation (EC) No 593/2008"), common name ("GDPR", "Rome I", "AI Act") or title words. Returns CELEX numbers, in-force status and the latest consolidated version. Needs web access allowed by the data policy.',
    input: { query: 'string', language: 'string (optional — en, de, fr, …; default: the document language)' },
  },
  get_eu_law: {
    description: 'Text of an EU act by CELEX number (consolidated version when available), optionally one article. Use after search_eurlex. Cite as "Article N of Regulation (EU) …".',
    input: { celex: 'string (e.g. 32016R0679)', article: 'string (optional — article number)', language: 'string (optional)' },
  },
  search_law_sources: {
    description: 'Live search of the law sources the lawyer has connected: official statutes and case law of many countries (AT, DE, CH, EU, CZ, SK, PL, RO, NL, FR, UK, US …), community sources and gateways with the lawyer\'s own account. Law-source results are look-ups, not advice: tell the lawyer to check the official version before relying on it. Pick by jurisdiction (two letters) and kind (law or caselaw), or name sources (law_sources_status lists them). Only the search words leave this computer. Every result names its source, citation, URL, retrieval date and licence; cite exactly that.',
    input: { query: 'string (statutory terms in the law\'s language, or a law number like 513/1991)', jurisdiction: 'string (optional — AT, EU, DE, CH, CZ, SK, PL, RO, NL, FR, UK, US …)', kind: 'string (optional — law or caselaw)', sources: 'array (optional — source ids from law_sources_status)', date: 'string (optional — YYYY-MM-DD: the text on that date, where the source has history)' },
  },
  get_law_source: {
    description: 'Text of one document from a law source (use the source and ref from search_law_sources), optionally one section ("§ 433") or article, or the text on a past date. Cite it as the citation returned.',
    input: { source: 'string (the source id from search_law_sources)', ref: 'string (the ref from search_law_sources)', article: 'string (optional — section or article number)', date: 'string (optional — YYYY-MM-DD)', language: 'string (optional — EUR-Lex only)' },
  },
  law_sources_status: {
    description: 'Which law sources are connected (per country), which are switched off, which need the lawyer\'s free key, and whether OpenLex works fully offline. Use it when a question needs a country you have no connected source for, then propose connecting the best free one (enable_law_source, or request_law_source_key for a free key).',
    input: { jurisdiction: 'string (optional — two letters)' },
  },
  enable_law_source: {
    description: 'Switch a law source on (the lawyer is asked first). Only free official or community sources; never a paid one without the lawyer asking.',
    input: { source: 'string (the source id from law_sources_status)' },
  },
  request_law_source_key: {
    description: 'Ask the lawyer for a source\'s free key: OpenLex shows a secure field (the key goes straight into this computer\'s keychain and never into this conversation) and the steps to get it. Never ask the lawyer to type or paste a key into the chat.',
    input: { source: 'string (the source id from law_sources_status)' },
  },
  download_to_matter: {
    description: 'Download a file (PDF, Word, …) from a public or signed-in site into the matter folder with provenance (URL, time, sha256). Needs web access allowed by the data policy.',
    input: { url: 'string' },
  },
  web_fetch: {
    description: 'Read a public web page (text + links) in the browser, using the lawyer\'s saved logins. Needs web access allowed by the data policy.',
    input: { url: 'string' },
  },
  web_save: {
    description: 'Save a web page into the matter folder with screenshot and provenance (URL, time, hashes) so it can be cited later.',
    input: { url: 'string' },
  },
  get_law_section: {
    description: 'Full text of a law chunk by id (cite or judge).',
    input: { chunk_id: 'string' },
  },
  propose_suggestions: {
    description: 'Emit suggestions for the current section.',
    input: { suggestions: 'array' },
  },
  remember: {
    description: 'Persist a document fact.',
    input: { entity: 'string', claim: 'string', section: 'string' },
  },
  recall: {
    description: 'Read back persisted facts.',
    input: { topic: 'string' },
  },
  write_file: {
    description: 'Create/overwrite a file (e.g. obligations.csv, deadlines.ics) in the working folder (relative paths) or a matter folder of the workspace. The lawyer is asked first; nothing outside those places is writable.',
    input: { path: 'string', content: 'string' },
  },
  append_file: {
    description: 'Append content to an existing file in the working folder or the workspace (the lawyer is asked first).',
    input: { path: 'string', content: 'string' },
  },
  read_file: {
    description: 'Read a file of the working folder (relative paths) or the workspace: Word (.docx), PDF, text, Markdown, CSV. Returns up to 8000 characters; pass start to read on.',
    input: { path: 'string', start: 'number (optional — character to start from)' },
  },
  list_directory: {
    description: 'List the files of the working folder (or the workspace without one), or of a subfolder.',
    input: { path: 'string (optional)' },
  },
  search_local_files: {
    description: 'Word-match search across the files of the working folder (or the workspace), Word and PDF included. Returns file + line matches.',
    input: { query: 'string', directory: 'string (optional)' },
  },
  delete_file: {
    description: 'Delete one file in the working folder or the workspace. The lawyer is asked every time; a copy is kept so it can be restored. Only when the lawyer asked for it.',
    input: { path: 'string' },
  },
  rename_file: {
    description: 'Rename or move one file within the working folder or the workspace (never overwrites). The lawyer is asked first.',
    input: { path: 'string', to: 'string (new name, or a path)' },
  },
  export_document: {
    description: 'Deterministic export of the current document (inventory, obligations, deadlines) into the workspace: format csv|xml|json|md|dat|ics|pdf, into a matter subfolder. Use when the user asks for checklists, exports, discovery lists, calendar files, or a PDF worklist.',
    input: { format: 'string (csv|xml|json|md|dat|ics|pdf)', matter: 'string' },
  },
  sync_calendar: {
    description: 'Add the contract\'s dated deadlines to the user\'s calendar (Apple Calendar or Outlook, per Settings). Use when the user asks to put deadlines/due dates in their calendar.',
    input: { matter: 'string' },
  },
  analyse_document: {
    description: 'Full document analysis (the analyse workflow): summary, key terms, deadlines, obligations per party, risks high/medium/low with a suggested fix, notable/missing clauses — every finding verified against a verbatim quote, law looked up for high and medium risks, fixes double-checked. Saves analysis .md/.docx/.json in the matter folder and returns a short summary. Use when the lawyer asks to analyse a whole document (/analyse).',
    input: { file: 'string (optional — a document in the matter folders; default: the open document)' },
  },
  risk_scorecard: {
    description: 'Emit an overall contract risk score (0-100) with a category breakdown. Call after reviewing a document when the user asks for a risk assessment or scorecard.',
    input: { score: 'number 0-100', categories: 'object (e.g. {liability: 40, termination: 30, ip: 10, data: 20})', summary: 'string (one sentence)' },
  },
  run_playbook: {
    description: 'Run a review playbook from the workspace playbooks/ folder (JSON: [{pattern, severity, message}]). Returns the matching findings for the document.',
    input: { name: 'string (playbook file name without .json)' },
  },
  run_bash: {
    description: 'Run a shell command in the workspace folder. Allowed: ls, find, grep, wc, cat, head, tail, sort, uniq, diff, file, stat, git, python3, node, npm, pip, curl, mkdir, cp, mv, tree, du, echo, which, type, date. 10s timeout. No metacharacters (; | & ` $).',
    input: { command: 'string' },
  },
  search_docs: {
    description: 'Word-match search across workspace files. Returns file + line matches. Alias for search_local_files.',
    input: { query: 'string', directory: 'string (optional)' },
  },
  delegate_task: {
    description: 'Spawn focused analysis in fresh context. Returns compressed result. Use for deep clause analysis or law search when you need clean context.',
    input: { task: 'string (focused task description)', tools: 'array (tool names needed)', context: 'string (minimum necessary context)' },
  },
  get_tool_schemas: {
    description: 'Full input definitions for the named tools (built-in or connector mcp__… tools).',
    input: { names: 'array of tool names' },
  },
  tool_picker: {
    description: 'Get relevant tool names for a task. Call get_tool_schemas after to load definitions.',
    input: { task: 'string (what you need to do)' },
  },
  compress_context: {
    description: 'Compress bloated context. Call when you feel low on output space.',
    input: {},
  },
}

function toolDescriptions() {
  return Object.entries(TOOLS)
    .map(([name, t]) => `- ${name}(${JSON.stringify(t.input)}): ${t.description}`)
    .join('\n')
}

/**
 * Resolve a section from a tool call: by numeric index, or by heading text
 * (case-insensitive substring over the heading, then the first line, then
 * the body). Heading lookup is the model's escape hatch from index
 * confusion — the single most common cause of "the clause isn't in the
 * document" answers.
 */
function resolveSection(doc, args) {
  const idx = +args.index
  if (Number.isInteger(idx) && idx >= 0 && doc.section(idx)) return doc.section(idx)
  const query = String(args.heading || args.query || '').trim().toLowerCase()
  if (query) {
    const map = doc.map()
    const byHeading = map.sections.find((s) => s.heading && s.heading.toLowerCase().includes(query))
    if (byHeading) return doc.section(byHeading.index)
    const byFirstLine = doc.sections.find((s) => String(s.text.split('\n')[0] || '').toLowerCase().includes(query))
    if (byFirstLine) return byFirstLine
    const byBody = doc.sections.find((s) => String(s.text).toLowerCase().includes(query))
    if (byBody) return byBody
  }
  return null
}

function sectionHelp(doc) {
  const n = doc.sections.length
  const headings = doc.map().sections.slice(0, 25).map((s) => `${s.index}:${s.heading || '(untitled)'}`).join(' | ')
  return n === 1
    ? 'ERROR: use get_range_text with index 0 (or heading for a clause name)'
    : `ERROR: no section matched — available: 0..${n - 1} (${headings})`
}

/**
 * Execute a tool call.
 * @returns {{output:string}} compressed, context-budgeted output
 */
async function dispatch({ doc, memory, search, embeddings, packStore }, rawName, args) {
  // Small models shorten tool names under load ("search" for "search_law")
  // — normalize common aliases instead of failing the hop.
  const ALIASES = { search: 'search_law', law_search: 'search_law', search_laws: 'search_law' }
  const name = ALIASES[rawName] || rawName
  switch (name) {
    case 'get_document_map': {
      const map = await doc.map()
      return { output: 'DOCUMENT MAP\n' + map.sections.map((s) => `${s.index}:${'  '.repeat(Math.min(s.level, 2))}${s.heading || '(untitled)'}${s.flagged ? ' [FLAGGED]' : ''}`).join('\n') }
    }

    case 'get_range_text': {
      const section = resolveSection(doc, args)
      if (!section) return { output: sectionHelp(doc) }
      // Verbatim-only when the model asked for raw (quotes/cites).
      if (args.raw) {
        return { output: `SECTION ${section.index}\n${section.text.slice(0, 5000)}` }
      }
      // Default: the structured clause table PLUS the full verbatim text.
      // The model must never rewrite a clause it only saw compressed —
      // "the model never got to see the full clause" caused a rewrite
      // built on a 160-char fragment. Sections are ≤2K chars by
      // construction, so the full text always fits the budget.
      const { analyzeSection, formatClauseAnalysis } = require('./clause')
      const analysis = analyzeSection(section.text)
      const table = formatClauseAnalysis(analysis, section.index)
      return { output: `${table}\n\nFULL TEXT (SECTION ${section.index}):\n${section.text.slice(0, 4000)}` }
    }

    case 'get_clause_analysis': {
      // Structured extraction (B2): parties / obligations / rights /
      // prohibitions / warranties / values / dates / favoring — no LLM
      // call, ~400 tokens vs ~2K raw. The FULL VERBATIM text is appended
      // so a rewrite is never built on the compressed table alone — the
      // model must see every word of the clause it proposes to change.
      const section = resolveSection(doc, args)
      if (!section) return { output: sectionHelp(doc) }
      const { analyzeSection, formatClauseAnalysis } = require('./clause')
      const analysis = analyzeSection(section.text)
      const table = formatClauseAnalysis(analysis, section.index)
      return { output: `${table}\n\nFULL TEXT (SECTION ${section.index}):\n${section.text.slice(0, 4000)}` }
    }

    case 'search_firm_library': {
      const query = String(args.query || '').trim()
      if (!query) return { output: 'ERROR: search_firm_library requires a query' }
      const library = require('./library')
      if (!library.status().files) return { output: 'FIRM LIBRARY EMPTY — no folders indexed (Settings → Firm library).' }
      let hits
      try {
        hits = await library.search(query, { matterId: require('./policy').currentMatter(), limit: 6 })
      } catch (err) {
        return { output: `FIRM LIBRARY ERROR: ${err.message}` }
      }
      if (!hits.length) return { output: `NO RESULTS in the firm library for "${query}".` }
      const lines = hits.map((h) => `[${h.title} · part ${h.chunk + 1}] ${h.text.replace(/\s+/g, ' ').slice(0, 600)}`)
      return { output: lines.join('\n\n'), firmSources: hits.map((h) => ({ title: h.title, path: h.path, chunk: h.chunk })) }
    }

    case 'find_clause': {
      const cl = require('./clauses')
      const type = args.type && cl.TYPES.some(([id]) => id === args.type) ? args.type : null
      const hits = cl.search({ type, query: String(args.query || ''), lang: args.language ? String(args.language).slice(0, 2).toLowerCase() : null, matterId: require('./policy').currentMatter(), limit: 5 })
      if (!hits.length) return { output: `No firm clauses found${type ? ` of type ${type}` : ''}${args.query ? ` matching "${args.query}"` : ''}. (The clause library is built from the firm library folders in Settings.)` }
      return {
        output: hits.map((h, i) => `[${i + 1}] ${h.label} — "${h.heading}" — used in ${h.uses} document${h.uses === 1 ? '' : 's'} (${h.documents.slice(0, 4).join(', ')}${h.documents.length > 4 ? ', …' : ''})\n${h.text.slice(0, 1500)}`).join('\n\n'),
        firmSources: hits.map((h) => ({ title: h.documents[0], clause: h.heading, uses: h.uses })),
      }
    }

    case 'search_sources': {
      const query = String(args.query || '').trim()
      if (!query) return { output: 'ERROR: search_sources requires a query' }
      const src = require('./sources')
      if (!src.list().length) return { output: 'No data sources are configured (openlex.json → "sources"). Use search_law, search_firm_library or the official-source tools instead.' }
      const r = await src.search({ query, kind: args.kind || undefined, jurisdiction: args.jurisdiction || undefined, sources: Array.isArray(args.sources) ? args.sources : undefined, limit: 5 })
      const lines = r.results.slice(0, 10).map((x, i) => `[${i + 1}] (${x.source} · ${x.kind}) ${x.title}${x.citation ? ` — ${x.citation}` : ''}${x.date ? ` (${x.date})` : ''}${x.url ? `\n    ${x.url}` : ''}\n    ${x.text}`)
      const skipped = r.skipped.map((s) => `${s.source}: ${s.reason}`)
      return {
        output: (lines.length ? `RESULTS from ${r.searched.join(', ')}:\n${lines.join('\n')}` : `NO RESULTS in ${r.searched.join(', ') || 'any source'}.`) + (skipped.length ? `\nNot searched: ${skipped.join('; ')}` : ''),
        sourceResults: r.results.slice(0, 10).map((x) => ({ source: x.source, title: x.title, citation: x.citation, url: x.url })),
      }
    }

    case 'search_ris': {
      const query = String(args.query || '').trim()
      if (!query) return { output: 'ERROR: search_ris requires a query' }
      const blocked = require('./web/guard').checkWeb('data.bka.gv.at', 'search_ris') || await require('./web/guard').webHook('data.bka.gv.at', 'search_ris')
      if (blocked) return { output: blocked }
      try {
        const r = await require('./web/ris').searchBundesrecht(query, { limit: Math.min(20, parseInt(args.limit, 10) || 8) })
        if (!r.results.length) return { output: `RIS: no results for "${query}".${r.note ? ` (${r.note})` : ''}` }
        return {
          output: `RIS (official, ${r.total} hits${r.note ? `; ${r.note}` : ''}):\n` + r.results.map((x) => `- ${x.title}${x.abbreviation ? ` (${x.abbreviation})` : ''} — ${x.inForce ? 'in force' : `NOT in force since ${x.inForceUntil}`}${x.inForceFrom ? `, version from ${x.inForceFrom}` : ''}\n  ${x.url}`).join('\n'),
          webSources: r.results.map((x) => ({ title: x.title, url: x.url, inForce: x.inForce })),
        }
      } catch (err) {
        if (err.code === 'window') return { output: `RIS: not looked up. ${err.plain}.` }
        return { output: `RIS ERROR: ${err.message}` }
      }
    }

    case 'search_eurlex': {
      const query = String(args.query || '').trim()
      if (!query) return { output: 'ERROR: search_eurlex requires a query' }
      const blocked = require('./web/guard').checkWeb('publications.europa.eu', 'search_eurlex') || await require('./web/guard').webHook('publications.europa.eu', 'search_eurlex')
      if (blocked) return { output: blocked }
      const lang = euLang(args.language, doc)
      try {
        const r = await require('./web/eurlex').search(query, { lang, limit: 8 })
        if (!r.results.length) return { output: `EUR-Lex: no acts found for "${query}".${r.mode === 'title' ? ' Try the act number (e.g. 2016/679) or other title words.' : ''}` }
        return {
          output: `EUR-Lex (official EU Publications Office):\n` + r.results.map((x) => `- CELEX ${x.celex} — ${x.title || '(no title in this language)'} — ${x.inForce === false ? 'NOT in force' : x.inForce ? 'in force' : 'status unknown'}${x.consolidated ? `; consolidated ${x.consolidated.date || x.consolidated.celex} (${x.consolidated.celex})` : ''}\n  ${x.url}`).join('\n'),
          webSources: r.results.map((x) => ({ title: x.title || x.celex, url: x.url, inForce: x.inForce })),
        }
      } catch (err) {
        return { output: `EUR-Lex ERROR: ${err.message}` }
      }
    }

    case 'get_eu_law': {
      const celex = String(args.celex || '').trim()
      if (!celex) return { output: 'ERROR: get_eu_law requires a celex number (from search_eurlex)' }
      const blocked = require('./web/guard').checkWeb('publications.europa.eu', 'get_eu_law') || await require('./web/guard').webHook('publications.europa.eu', 'get_eu_law')
      if (blocked) return { output: blocked }
      try {
        const r = await require('./web/eurlex').text(celex, { lang: euLang(args.language, doc), article: args.article ? String(args.article) : null })
        const max = r.article ? 12000 : 8000
        return {
          output: `EU act ${r.celex}${r.article ? `, Article ${r.article}` : ''} (${r.lang}, ${r.url}):\n\n${r.text.slice(0, max)}${r.text.length > max ? '\n…[truncated — ask for a specific article]' : ''}`,
          webSources: [{ title: `${r.celex}${r.article ? ` Art. ${r.article}` : ''}`, url: r.url, inForce: true }],
          lawSources: [{ chunk_id: null, source_name: `CELEX ${r.celex}`, section: r.article ? `Art. ${r.article}` : '', snippet: String(r.text || '').replace(/\s+/g, ' ').slice(0, 140), url: r.url || null, origin: 'online', from: 'EUR-Lex' }],
        }
      } catch (err) {
        return { output: `EUR-Lex ERROR: ${err.message}` }
      }
    }

    case 'search_law_sources': {
      const query = String(args.query || '').trim()
      if (!query) return { output: 'ERROR: search_law_sources requires a query' }
      const ls = require('./connectors')
      const r = await ls.search({ query, jurisdiction: args.jurisdiction || undefined, kind: args.kind || undefined, date: args.date ? String(args.date).slice(0, 10) : undefined, sources: Array.isArray(args.sources) ? args.sources : typeof args.sources === 'string' && args.sources ? args.sources.split(/[\s,]+/) : undefined, lang: euLang(args.language, doc), limit: 5 })
      const day = (t) => String(t || '').slice(0, 10)
      const lines = r.results.slice(0, 12).map((x, i) => `[${i + 1}] ${x.sourceLabel} · ref ${x.ref}\n    ${x.title}${x.inForce === false ? ' (NOT in force)' : ''}\n    Cite as: ${x.citation || x.title}${x.snippet ? `\n    ${x.snippet.slice(0, 400)}` : ''}\n    ${x.url || ''} (retrieved ${day(x.retrieved)}; ${x.licence})`)
      const skipped = r.skipped.map((s) => `${s.source}: ${s.reason}`)
      const notes = (r.notes || []).map((n) => `\nNote (${n.source}): ${n.note}`).join('')
      return {
        output: (lines.length ? `LAW SOURCES (${r.searched.join(', ')}):\n${lines.join('\n')}${notes}\n${ls.NOTICE}` : `NO RESULTS${r.searched.length ? ` in ${r.searched.join(', ')}` : ' (no law source could be searched)'}.`) + (skipped.length ? `\nNot searched: ${skipped.join('; ')}` : ''),
        webSources: r.results.slice(0, 12).map((x) => ({ title: x.citation || x.title, url: x.url, inForce: x.inForce, source: x.source, licence: x.licence, retrieved: x.retrieved })),
      }
    }

    case 'law_sources_status': {
      const ls = require('./connectors')
      const J = args.jurisdiction ? String(args.jurisdiction).toUpperCase().replace(/^GB$/, 'UK') : null
      const all = await ls.status({ matterId: require('./policy').currentMatter() || null })
      const covers = (s) => s.country === J || (s.jurisdictions || []).includes(J)
      const list = (J ? all.filter(covers) : all).sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended))
      const off = await ls.offline()
      const line = (s) => `- ${s.id} [${s.country}, ${s.kind}${s.community ? ', community' : ''}${s.recommended ? ', recommended' : ''}]: ${s.status}${s.state === 'needs_key' || (s.optionalKey && !s.hasKey) ? ` — key help: ${s.keyHelp || s.guide}` : ''}${s.manual ? ` — pages: ${(s.pages || []).map((p) => p.url).join(', ')}` : ''}`
      const ready = list.filter((s) => s.state === 'ready')
      const rec = list.find((s) => s.recommended && s.state !== 'ready' && s.state !== 'off')
      const suggest = rec ? `\nSuggest first: ${rec.label} (free plan, 100 searches a day, sign in with the browser): request_law_source_key with source "${rec.id}". The official sources stay on as the second source.` : ''
      return { output: `LAW SOURCES${J ? ` for ${J}` : ''} (${ready.length} ready${off.on ? '; OpenLex works fully offline' : ''}):\n${list.map(line).join('\n') || '- none for this country'}${suggest}\nTo connect one: enable_law_source (switched off) or request_law_source_key (needs a free key or a sign-in). Paid plans only when the lawyer asks.` }
    }

    case 'enable_law_source': {
      const ls = require('./connectors')
      try {
        const r = ls.setEnabled(String(args.source || ''), true)
        const st = (await ls.status()).find((s) => s.id === r.id)
        return { output: `Switched on: ${st.status}${st.state === 'needs_key' ? `. It needs a key: use request_law_source_key.` : ''}` }
      } catch (err) { return { output: `LAW SOURCE ERROR: ${err.plain || err.message}` } }
    }

    case 'request_law_source_key': {
      const ls = require('./connectors')
      try {
        const c = ls.connector(String(args.source || ''))
        if (!c.needsKey && !c.optionalKey) return { output: `${c.label} needs no key.` }
        const keyRequest = { source: c.id, label: c.label, labelDe: c.de?.label || c.label, keyHelp: c.keyHelp || null, keyHelpDe: c.de?.keyHelp || null, guide: `${ls.GUIDE}#${c.guide || c.id}`, signIn: !!c.signIn }
        return { output: `A secure field for the ${c.label} key is now shown to the lawyer, with these steps: ${c.keyHelp || keyRequest.guide}. The key goes straight into this computer's keychain; do not ask for it in the chat. Tell the lawyer in one or two sentences what to do, then wait.`, keyRequest }
      } catch (err) { return { output: `LAW SOURCE ERROR: ${err.plain || err.message}` } }
    }

    case 'get_law_source': {
      const ls = require('./connectors')
      try {
        const r = await ls.get({ source: String(args.source || ''), ref: String(args.ref || ''), article: args.article ? String(args.article) : null, date: args.date ? String(args.date).slice(0, 10) : null, lang: euLang(args.language, doc) })
        const max = args.article ? 12000 : 8000
        return {
          output: `${r.sourceLabel}: ${r.title}${r.version ? ` (version ${r.version})` : ''}\nCite as: ${r.citation}\nSource: ${r.url || '—'} (retrieved ${String(r.retrieved).slice(0, 10)}; ${r.licence})\n${r.note ? `Note: ${r.note}\n` : ''}${ls.NOTICE}\n\n${String(r.text || '').slice(0, max)}${String(r.text || '').length > max ? '\n…[truncated — ask for one section or article]' : ''}`,
          webSources: [{ title: r.citation, url: r.url, inForce: true, source: r.source, licence: r.licence, retrieved: r.retrieved }],
          // What the answer is based on: the text read, and where it came from
          // (online, or the copy of that source kept on this computer).
          lawSources: [{ chunk_id: null, source_name: r.citation || r.title || r.sourceLabel, section: args.article ? String(args.article) : '', snippet: String(r.text || '').replace(/\s+/g, ' ').slice(0, 140), url: r.url || null, origin: r.local ? 'copy' : 'online', from: r.sourceLabel || r.source, ...(r.sourceLabelDe ? { fromDe: r.sourceLabelDe } : {}) }],
        }
      } catch (err) {
        return { output: `LAW SOURCE ERROR: ${err.plain || err.message}` }
      }
    }

    case 'download_to_matter': {
      const guard = require('./web/guard')
      let u
      try { u = await guard.assertPublicUrl(args.url) } catch (err) { return { output: `ERROR: ${err.message}` } }
      const blocked = guard.checkWeb(u.hostname, name) || await guard.webHook(u.hostname, name, u)
      if (blocked) return { output: blocked }
      try {
        const r = await require('./web/browser').downloadToMatter(u.href, require('./workspace').matterFolder(currentMatterName()))
        return { output: `DOWNLOADED ${r.file} (${r.contentType || 'unknown type'}, ${Math.round(r.bytes / 1024)} KB) from ${r.finalUrl} at ${r.fetchedAt}, sha256 ${r.sha256.slice(0, 12)}… → ${r.path}` }
      } catch (err) {
        return { output: `DOWNLOAD ERROR: ${err.message}` }
      }
    }

    case 'web_fetch':
    case 'web_save': {
      const guard = require('./web/guard')
      let u
      try { u = await guard.assertPublicUrl(args.url) } catch (err) { return { output: `ERROR: ${err.message}` } }
      const blocked = guard.checkWeb(u.hostname, name) || await guard.webHook(u.hostname, name, u)
      if (blocked) return { output: blocked }
      const browser = require('./web/browser')
      try {
        if (name === 'web_fetch') {
          const r = await browser.fetchPage(u.href)
          const links = r.links.slice(0, 15).map((l) => `- ${l.text}: ${l.href}`).join('\n')
          return { output: `PAGE ${r.finalUrl} (HTTP ${r.status})\nTITLE ${r.title}\n\n${r.text.slice(0, 8000)}${r.text.length > 8000 || r.truncated ? '\n…[truncated]' : ''}\n\nLINKS\n${links}` }
        }
        const r = await browser.saveToMatter(u.href, require('./workspace').matterFolder(currentMatterName()))
        return { output: `SAVED "${r.title}" (${r.finalUrl}) at ${r.fetchedAt} — page text, screenshot and provenance (sha256 ${r.sha256.text.slice(0, 12)}…) in ${path.dirname(r.files[0])}` }
      } catch (err) {
        return { output: `BROWSER ERROR: ${err.message}` }
      }
    }

    case 'search_law': {
      // Model-provided jurisdiction wins; otherwise the doc's detected one.
      // doc.jurisdiction() falls back to 'US' when nothing matches — a
      // German/Slovak/… query against the US-only filter then returns zero
      // rows. If the doc-default search comes up empty, retry once without
      // the filter: corpus-wide, the query language picks the right results.
      const explicit = String(args.jurisdiction || '').toUpperCase()
      const jurisdiction = explicit || String(doc.jurisdiction() || '').toUpperCase()
      const queries = [args.query, args.query2, args.query3].filter(Boolean)
      if (!queries.length) return { output: 'ERROR: search_law requires at least one query' }
      const vector = await embeddings.embedQueries(queries)
      const seen = new Map()
      let firstError = null
      for (const v of vector) {
        let { results, error } = await search.hybridSearch(v, { jurisdiction, limit: 5 })
        if (error) { firstError = firstError || error; continue }
        if (!results.length && !explicit) {
          ;({ results } = await search.hybridSearch(v, { limit: 5 }))
        }
        for (const r of results) if (!seen.has(r.id)) seen.set(r.id, r.payload || {})
      }
      if (firstError && !seen.size) return { output: `SEARCH ERROR: ${firstError} (is the law pack installed for ${jurisdiction}?)` }
      if (!seen.size) return { output: `NO RESULTS for ${jurisdiction} — nothing found in installed packs.` }
      const entries = [...seen.entries()]
      const digests = entries.slice(0, 8).map(([id, p]) => `[${id}] ${lawDigest({ source_name: p.source_name, section: p.section, content: p.content })}`)
      // Structured law sources for the pane ("which laws did the agent find")
      const lawSources = entries.slice(0, 8).map(([id, p]) => ({
        chunk_id: id,
        source_name: p.source_name || '',
        section: p.section || '',
        snippet: String(p.content || '').replace(/\s+/g, ' ').slice(0, 140),
        origin: 'local', // the law collection on this computer
      }))
      return {
        output: `SEARCH RESULTS (${entries.length} unique, top ${Math.min(8, seen.size)}):\n` + digests.join('\n'),
        lawSources,
      }
    }

    case 'get_law_section': {
      const chunk = await search.getChunk(String(args.chunk_id))
      if (!chunk) return { output: 'ERROR: chunk not found ' + args.chunk_id }
      const lawSources = [{
        chunk_id: String(args.chunk_id),
        source_name: chunk.source_name || '',
        section: chunk.section || '',
        snippet: String(chunk.content || '').replace(/\s+/g, ' ').slice(0, 140),
        origin: 'local',
      }]
      return {
        output: `FULL TEXT [${args.chunk_id}] ${chunk.source_name || ''} ${chunk.section || ''}:\n${String(chunk.content || '').slice(0, 2000)}`,
        lawSources,
      }
    }

    case 'propose_suggestions':
      return { output: 'OK — suggestions recorded for the Judge pass (' + (args.suggestions || []).length + ')' }

    case 'remember':
      memory.addFact(args.entity, args.claim, args.section)
      // Structured note → agent streams it as a clickable bookmark.
      // section may be omitted by the model — default '' so the pane
      // never renders "§undefined".
      return {
        output: `remembered (${args.section !== undefined && args.section !== '' ? '§' + args.section + ' ' : ''}${args.entity || ''}).`,
        note: { entity: String(args.entity || '').slice(0, 120), claim: String(args.claim || '').slice(0, 400), section: args.section ?? '' },
      }

    case 'recall': {
      const facts = memory.recall(args.topic)
      return { output: facts.length ? 'FACTS:\n' + facts.map((f) => `- ${f.entity}: ${f.claim}${f.section ? ` (§${f.section})` : ''}`).join('\n') : 'no stored facts.' }
    }

    // File tools (folder.js): the working folder of this request, or the
    // workspace without one. The agent may never change the firm's rules
    // or its own history: a manipulated document must not be able to
    // rewrite openlex.json, skills or playbooks through the agent.
    case 'write_file':
    case 'append_file': {
      const fo = require('./folder')
      try {
        const loc = fo.write(args.path, args.content, { append: name === 'append_file' })
        return { output: `${name === 'write_file' ? 'written' : 'appended'}: ${loc.abs}` }
      } catch (e) {
        return { output: `ERROR: ${e.message}${/configuration/.test(e.message) ? '. Save your output in a matter folder instead.' : ''}` }
      }
    }

    case 'read_file': {
      const fo = require('./folder')
      try {
        const r = await fo.read(args.path, { start: args.start })
        if (!r.text.trim()) return { output: `${r.loc.rel || args.path}: no readable text (perhaps a scanned document).` }
        return { output: r.text + (r.more !== null ? `\n…(${r.total} characters in total — read on with start: ${r.more})` : '') }
      } catch (e) {
        return { output: `ERROR: ${e.message}` }
      }
    }

    case 'list_directory': {
      const fo = require('./folder')
      try {
        const r = fo.list(args.path || '')
        const where = r.loc.area === 'folder' ? 'the working folder' : 'the workspace'
        if (!r.files.length) return { output: `${r.loc.rel ? `${r.loc.rel} in ${where}` : where} has no files${r.truncated ? ' that could be listed (the folder is very large)' : ''}` }
        const head = r.loc.area === 'folder' ? `FILES IN THE WORKING FOLDER${r.loc.rel ? ` (${r.loc.rel})` : ''}` : 'WORKSPACE FILES'
        const cap = r.truncated ? `\n…only the first ${r.files.length} files are shown (the folder is large). List a subfolder or search to find more.` : ''
        return { output: `${head}:\n` + r.files.map((f) => `${f.path} (${f.size} B)`).join('\n') + cap }
      } catch (e) {
        return { output: `ERROR: ${e.message}` }
      }
    }

    case 'search_local_files':
    case 'search_docs': {
      const fo = require('./folder')
      try {
        const r = await fo.search(args.query, args.directory)
        const where = r.loc.area === 'folder' ? 'the working folder' : 'the workspace'
        const cap = r.truncated ? `\n…the search stopped early (the folder is large or there are many matches). Search a subfolder or use more specific words.` : ''
        if (!r.hits.length) return { output: `NO MATCHES for "${args.query}" in ${where}${cap}` }
        return { output: `MATCHES for "${args.query}":\n` + r.hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n') + cap }
      } catch (e) {
        return { output: `ERROR: ${e.message}` }
      }
    }

    case 'delete_file': {
      const fo = require('./folder')
      try {
        const r = fo.remove(args.path)
        return { output: `deleted: ${r.loc.abs} (a copy is kept in OpenLex's history and can be restored)` }
      } catch (e) {
        return { output: `ERROR: ${e.message}` }
      }
    }

    case 'rename_file': {
      const fo = require('./folder')
      try {
        const r = fo.rename(args.path, args.to)
        return { output: `renamed: ${r.from.abs} → ${r.to.abs}` }
      } catch (e) {
        return { output: `ERROR: ${e.message}` }
      }
    }

    case 'export_document': {
      const { buildModel, exportFile } = require('./exporters')
      const ws = require('./workspace')
      const model = buildModel(doc, (args.matter || currentMatterName()))
      const out = exportFile(model, String(args.format || 'csv').toLowerCase())
      if (!out) return { output: 'ERROR: unknown format — use csv, xml, json, md, dat, ics or pdf' }
      try {
        const rel = `${ws.matterFolder((args.matter || currentMatterName()))}/${(args.matter || currentMatterName())}.${out.ext}`
        const p = Buffer.isBuffer(out.content) ? ws.writeFileBinary(rel, out.content) : ws.writeFile(rel, out.content)
        const counts = `${model.clauses.length} clauses · ${model.obligations.length} obligations · ${model.deadlines.length} deadlines`
        return { output: `exported ${out.ext.toUpperCase()} → ${p} (${counts})` }
      } catch (e) {
        return { output: `ERROR: ${e.message}` }
      }
    }

    case 'sync_calendar': {
      const { buildModel } = require('./exporters')
      const calendar = require('./calendar')
      const model = buildModel(doc, (args.matter || currentMatterName()))
      const result = await calendar.sync(model.deadlines, (args.matter || currentMatterName()))
      return { output: result }
    }

    case 'analyse_document': {
      const an = require('./analysis')
      const matterId = require('./policy').currentMatter()
      try {
        let input
        if (args.file) input = { file: String(args.file) }
        else {
          if (!String(doc?.text || '').trim()) return { output: 'ERROR: no open document — pass file (a document in the matter folders)' }
          const bound = require('./matters').forDoc(doc.docId)?.docs?.find((d) => d.docId === doc.docId)
          input = { text: doc.text, name: bound?.title || 'Word document' }
        }
        const r = await an.runAnalyse({ matterId, ...input })
        return { output: `ANALYSIS (verified quotes only; the lawyer can open the full report):\n${r.summary}\n\nSaved: ${r.files.join(', ')}` }
      } catch (e) {
        return { output: `ERROR: ${e.message}` }
      }
    }

    case 'risk_scorecard': {
      const score = Math.max(0, Math.min(100, +args.score || 0))
      const cats = args.categories || {}
      return {
        output: `risk scorecard recorded: ${score}/100`,
        scorecard: { score, categories: cats, summary: String(args.summary || '') },
      }
    }

    case 'run_playbook': {
      const ws = require('./workspace')
      const name = String(args.name || '').replace(/[^\w\-.]/g, '')
      const content = ws.readFile(`playbooks/${name}.json`, 200000)
      if (content === null) return { output: `ERROR: no playbook "${name}" in the workspace playbooks/ folder` }
      let rules
      try { rules = JSON.parse(content) } catch (e) { return { output: `ERROR: playbook ${name} is not valid JSON: ${e.message}` } }
      const findings = []
      const docText = String(doc.text || '')
      for (const rule of rules || []) {
        if (!rule || !rule.pattern) continue
        let re
        try { re = new RegExp(rule.pattern, 'ig') } catch { continue }
        let m, n = 0
        while ((m = re.exec(docText)) && n < 5) { findings.push({ rule: rule.message || rule.pattern, match: String(m[0]).slice(0, 120), severity: rule.severity || 'medium' }); n++ }
      }
      if (!findings.length) return { output: `playbook ${name}: no findings` }
      return { output: `PLAYBOOK ${name} — ${findings.length} finding(s):\n` + findings.map((f) => `[${f.severity}] ${f.rule}: "${f.match}"`).join('\n') }
    }

    case 'run_bash': {
      const ws = require('./workspace')
      try {
        const out = await ws.runBash(args.command)
        return { output: out }
      } catch (e) {
        return { output: `ERROR: ${e.message}` }
      }
    }

    case 'delegate_task': {
      // Delegate returns a signal — the actual delegation happens in agent.js
      // which spawns a fresh LLM call. This dispatch just validates the args.
      const task = String(args.task || '').trim()
      if (!task) return { output: 'ERROR: delegate_task requires a task description' }
      const tools = Array.isArray(args.tools) ? args.tools : []
      const context = String(args.context || '').trim()
      return { output: `[DELEGATE: task="${task.slice(0, 200)}" tools=[${tools.join(',')}] context=${context.length} chars]`, delegate: true, task, tools, context }
    }

    case 'get_tool_schemas': {
      const names = Array.isArray(args.names) ? args.names : [args.name || args.tool].filter(Boolean)
      if (!names.length) return { output: 'ERROR: get_tool_schemas requires names' }
      const schemas = getSchemas(names.map(String))
      return { output: Object.keys(schemas).length ? JSON.stringify(schemas, null, 1) : `No such tools: ${names.join(', ')}` }
    }

    case 'tool_picker': {
      const task = String(args.task || '').trim()
      if (!task) return { output: 'ERROR: tool_picker requires a task description' }
      const catalog = getCatalogText()
      return { output: `TOOL CATALOG (pick tools by name, then call get_tool_schemas):\n${catalog}` }
    }

    case 'compress_context': {
      // Compress returns a signal — the actual compression happens in agent.js
      return { output: '[COMPRESS: context compression requested]', compress: true }
    }

    default:
      // Connector tools from configured MCP servers (policy-checked inside).
      if (String(name).startsWith('mcp__')) return require('./mcp/client').callTool(name, args)
      return { output: 'ERROR: unknown tool ' + name }
  }
}

module.exports = { TOOLS, toolDescriptions, dispatch, resolveSection }
