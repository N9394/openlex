"use strict"
/**
 * Tool catalog for lazy loading. Compact catalog (~100 tokens total)
 * in the system prompt. Model calls tool_picker to get relevant tool
 * names, then get_tool_schemas to load full definitions.
 *
 * Based on Cursor/MCP-Zero patterns — 80%+ token savings on tool schemas.
 */

// Compact catalog — always in system prompt (~10 tokens per tool)
const CATALOG = [
  { name: 'get_document_map', desc: 'Heading outline with paragraph ranges' },
  { name: 'get_range_text', desc: 'Section text (verbatim clause + structured table)' },
  { name: 'get_clause_analysis', desc: 'Structured: parties, obligations, favoring — plus full clause text' },
  { name: 'search_law', desc: 'Hybrid law search by jurisdiction + query' },
  { name: 'get_law_section', desc: 'Full text of a law chunk by id' },
  { name: 'search_firm_library', desc: "Search the firm's own precedents, templates and past work" },
  { name: 'find_clause', desc: "The firm's standard clauses by type, most-used wording first" },
  { name: 'search_sources', desc: "The firm's connected data sources (its databases, subscribed legal databases and commentaries, DMS)" },
  { name: 'search_ris', desc: 'Live official Austrian federal law (RIS), current versions' },
  { name: 'search_eurlex', desc: 'Official EU law (EUR-Lex): find acts by number, name or title' },
  { name: 'get_eu_law', desc: 'Text of an EU act / one article by CELEX' },
  { name: 'search_law_sources', desc: 'Connected law sources live (AT, EU, DE, SK, CZ, gateways): search with citations' },
  { name: 'get_law_source', desc: 'Text of one law-source document or section, with citation' },
  { name: 'download_to_matter', desc: 'Download a file into the matter with provenance' },
  { name: 'web_fetch', desc: 'Read a public web page with the lawyer\'s saved logins' },
  { name: 'web_save', desc: 'Save a web page to the matter with provenance' },
  { name: 'propose_suggestions', desc: 'Emit suggestions for the current section' },
  { name: 'remember', desc: 'Persist a document fact' },
  { name: 'recall', desc: 'Read back persisted facts' },
  { name: 'delegate_task', desc: 'Spawn focused analysis in fresh context' },
  { name: 'tool_picker', desc: 'Get relevant tool names for a task' },
  { name: 'compress_context', desc: 'Compress bloated context' },
  { name: 'write_file', desc: 'Save a file in the working folder or a matter folder (asks the lawyer)' },
  { name: 'read_file', desc: 'Read a file of the working folder or workspace (Word, PDF, text)' },
  { name: 'list_directory', desc: 'List the files of the working folder or workspace' },
  { name: 'search_local_files', desc: 'Search the files of the working folder or workspace' },
  { name: 'rename_file', desc: 'Rename or move a file (asks the lawyer)' },
  { name: 'delete_file', desc: 'Delete a file, a copy is kept (asks the lawyer every time)' },
  { name: 'export_document', desc: 'Export document to CSV/XML/JSON/MD/PDF' },
  { name: 'run_playbook', desc: 'Run review playbook from workspace' },
  { name: 'analyse_document', desc: 'Full verified analysis of a document (risks, deadlines, obligations) saved to the matter' },
]

// Full tool schemas — loaded on demand via get_tool_schemas
const SCHEMAS = {
  get_document_map: {
    input: {},
    description: 'Heading outline with paragraph ranges. Cheap, use first.',
  },
  get_range_text: {
    input: { index: 'number', heading: 'string (optional)' },
    description: 'Section text. Use heading instead of index when you know the clause name.',
  },
  get_clause_analysis: {
    input: { index: 'number' },
    description: 'Structured: parties, rights, obligations, favoring — plus full verbatim clause text.',
  },
  search_law: {
    input: { jurisdiction: 'string', query: 'string', query2: 'string', query3: 'string' },
    description: 'Hybrid law search. Up to 3 queries in the jurisdiction language with statutory terms.',
  },
  find_clause: {
    input: { type: 'string (optional — liability, termination, governing_law, …)', query: 'string (optional)', language: 'string (optional)' },
    description: "The firm's own clauses from its precedents, most-used wording first, with source documents.",
  },
  search_ris: {
    input: { query: 'string (German statutory terms)', limit: 'number (optional)' },
    description: 'Live search of Austrian federal law in the official RIS, with in-force dates. Needs web access in the data policy.',
  },
  search_eurlex: {
    input: { query: 'string', language: 'string (optional)' },
    description: 'EU law from the official EU Publications Office: by reference ("2016/679"), common name ("GDPR") or title words. CELEX, in-force, consolidated version.',
  },
  get_eu_law: {
    input: { celex: 'string', article: 'string (optional)', language: 'string (optional)' },
    description: 'Text of an EU act by CELEX (consolidated when available), optionally one article.',
  },
  search_law_sources: {
    input: { query: 'string', jurisdiction: 'string (optional — AT, EU, DE, SK, CZ)', sources: 'array (optional — ris, eurlex, neuris, slovlex, esbirka, ansvar)' },
    description: 'Live search of the connected law sources; results carry source, citation, URL, retrieval date and licence. Needs web access in the data policy.',
  },
  get_law_source: {
    input: { source: 'string', ref: 'string', article: 'string (optional)', language: 'string (optional)' },
    description: 'Text of one document (or one section) from a law source, with its citation.',
  },
  download_to_matter: {
    input: { url: 'string' },
    description: 'Download a file into the matter folder with provenance (URL, time, sha256).',
  },
  web_fetch: {
    input: { url: 'string' },
    description: 'Read a public web page (text + links). Needs web access in the data policy.',
  },
  web_save: {
    input: { url: 'string' },
    description: 'Save a web page into the matter folder with screenshot + provenance for citation.',
  },
  search_firm_library: {
    input: { query: 'string' },
    description: "Search the firm's own documents (precedents, templates, know-how) for this matter and firm-wide. Cite results by file name.",
  },
  search_sources: {
    input: { query: 'string', kind: 'string (optional — law, caselaw, commentary, firm)', jurisdiction: 'string (optional)', sources: 'array (optional — source names)' },
    description: "Search the firm's connected data sources configured in openlex.json; results name their source and citation.",
  },
  get_law_section: {
    input: { chunk_id: 'string' },
    description: 'Full text of a law chunk by id (cite or judge).',
  },
  propose_suggestions: {
    input: { suggestions: 'array' },
    description: 'Emit suggestions for the current section.',
  },
  remember: {
    input: { entity: 'string', claim: 'string', section: 'string' },
    description: 'Persist a document fact.',
  },
  recall: {
    input: { topic: 'string' },
    description: 'Read back persisted facts.',
  },
  delegate_task: {
    input: { task: 'string (focused task description)', tools: 'array (tool names needed)', context: 'string (minimum necessary context)' },
    description: 'Spawn focused analysis in fresh context. Returns compressed result. Use for deep clause analysis or law search.',
  },
  tool_picker: {
    input: { task: 'string (what you need to do)' },
    description: 'Get relevant tool names for a task. Call get_tool_schemas after to load definitions.',
  },
  compress_context: {
    input: {},
    description: 'Compress bloated context. Call when you feel low on output space.',
  },
  write_file: {
    input: { path: 'string', content: 'string' },
    description: 'Create/overwrite a file in the working folder (relative paths) or a matter folder. The lawyer is asked first.',
  },
  read_file: {
    input: { path: 'string', start: 'number (optional)' },
    description: 'Read a file of the working folder or the workspace: Word, PDF, text (8000 characters; start reads on).',
  },
  list_directory: {
    input: { path: 'string (optional)' },
    description: 'List the files of the working folder (or the workspace), or of a subfolder.',
  },
  search_local_files: {
    input: { query: 'string', directory: 'string (optional)' },
    description: 'Word search across the files of the working folder (or the workspace), Word and PDF included.',
  },
  delete_file: {
    input: { path: 'string' },
    description: 'Delete one file; the lawyer is asked every time and a copy is kept.',
  },
  rename_file: {
    input: { path: 'string', to: 'string' },
    description: 'Rename or move one file (never overwrites); the lawyer is asked first.',
  },
  export_document: {
    input: { format: 'string (csv|xml|json|md|pdf)', matter: 'string' },
    description: 'Export document to workspace file.',
  },
  run_playbook: {
    input: { name: 'string' },
    description: 'Run a review playbook from workspace playbooks/ folder.',
  },
  analyse_document: {
    input: { file: 'string (optional — a document in the matter folders; default: the open document)' },
    description: 'Full analysis: summary, key terms, deadlines, obligations, risks with fixes, clauses — quotes verified; saves .md/.docx/.json in the matter folder.',
  },
}

function getCatalogText() {
  // Connector tools (MCP servers the user configured) follow the built-ins.
  const mcp = require('./mcp/client').catalogLines()
  // The firm's connected sources, so the agent knows what search_sources can reach.
  let src = []
  try { src = require('./sources').list().filter((s) => !s.error) } catch { /* none */ }
  const lines = CATALOG.filter((t) => t.name !== 'search_sources' || src.length).map((t) => `- ${t.name}: ${t.desc}${t.name === 'search_sources' ? ` — ${src.map((s) => `${s.name} (${s.kind}${s.jurisdictions.length ? `, ${s.jurisdictions.join('/')}` : ''})`).join(', ')}` : ''}`)
  return [...lines, ...mcp].join('\n')
}

function getSchemas(toolNames) {
  const result = {}
  for (const name of toolNames) {
    if (SCHEMAS[name]) result[name] = SCHEMAS[name]
    else if (String(name).startsWith('mcp__')) {
      const sch = require('./mcp/client').schemaFor(name)
      if (sch) result[name] = sch
    }
  }
  return result
}

module.exports = { CATALOG, SCHEMAS, getCatalogText, getSchemas }
