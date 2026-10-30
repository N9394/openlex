"use strict"
/**
 * Permissions — the lawyer decides what the agent may do without asking.
 *
 * Every tool call the agent makes passes through authorize() before it is
 * dispatched (agent.js, right after the firm's before_tool hook). The
 * decision, in this order — DENY WINS:
 *
 *   1. deny rules (firm, then user)            → refused, never asked
 *   2. ask rules of the firm                   → asked, "always" not offered
 *   3. allow rules: firm, user, this matter    → allowed
 *   4. ask rules of the user                   → asked
 *   5. built-in defaults (BUILTIN below)       → allow (read-only) or ask
 *
 * An "ask" is answered by the person at the front end that started the run
 * (Word pane, terminal app, `openlex ask` in a terminal): the engine sends
 * a `permission` event on the run's stream and waits for
 * POST /api/permissions/answer. No answer within the timeout, a closed
 * connection, or a caller that cannot answer (scripts, --json, scheduled
 * monitors, the MCP server) = deny. A refused call goes back to the model
 * as a tool ERROR, so the agent carries on and says what it could not do.
 *
 * Rules live in the harness map (openlex.json, harness.js) as the section
 * "permissions"; the firm can lock it:
 *
 *   "permissions": {
 *     "allow": ["write_file", "web_fetch:eur-lex.europa.eu", "mcp:dms:*"],
 *     "ask":   ["search_ris"],
 *     "deny":  ["run_bash"],
 *     "matters": { "m_abc": { "allow": ["write_file:Acme/**"] } }
 *   }
 *
 * Patterns: a tool name (globs allowed: "export_*"), optionally
 * ":argument" — a path glob for file tools ("*" within a folder, "**"
 * across folders), a host for web tools ("*.europa.eu" includes
 * europa.eu), the command for run_bash ("git *"), source names for
 * search_sources, and "server:tool" for connectors ("mcp:dms:*"; "mcp:*"
 * is every connector). "Always allow" answers are written to the user
 * layer: everywhere → permissions.allow, this matter only →
 * permissions.matters[<id>].allow, this working folder only → a
 * path-scoped allow rule ("write_file:~/Clients/Alpine/**").
 *
 * Working folder (folder.js): a file tool aimed outside the working folder
 * and the workspace, or at a protected place (hidden files, system
 * folders, OpenLex's data, the firm's configuration), is refused before
 * any rule is looked at — never asked. A path pattern that starts with
 * "~/" or "/" (or "C:\\") is matched against the full path, others against
 * the path inside the working folder or workspace. Deleting a file is
 * asked every time: no rule, --allow or --yes skips that question.
 *
 * Every decision is audited (tool, decision, who decided; never arguments
 * or content).
 */

const crypto = require('crypto')
const path = require('path')
const { AsyncLocalStorage } = require('async_hooks')

const DECISIONS = ['once', 'deny', 'always', 'always_matter', 'always_folder']
const LISTS = ['allow', 'ask', 'deny']
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * What each built-in tool may do without asking. One line per tool; the
 * comment above each group says why. Anything not listed (and every
 * connector tool, mcp__…) is "ask".
 */
const BUILTIN = {
  // Reading the open document and the agent's own notes: nothing leaves, nothing changes.
  get_document_map: 'allow',
  get_range_text: 'allow',
  get_clause_analysis: 'allow',
  remember: 'allow',
  recall: 'allow',
  risk_scorecard: 'allow', // only shows a card in the front end
  run_playbook: 'allow', // reads a playbook file and matches it against the document
  // Reads the document and writes only its own report files into the matter
  // folder (earlier versions are kept); its law lookups follow the data policy.
  analyse_document: 'allow',
  // A file the lawyer attached in a chat (chose it themselves): read on this
  // computer into text; where that text may go is the data policy's call.
  read_attachment: 'allow',

  // Proposed changes: each suggestion card is reviewed by the lawyer anyway.
  propose_suggestions: 'allow',

  // The law: local law packs and the official sources (RIS, EUR-Lex), read-only.
  // Their web access is still governed by the data policy (web/guard.js).
  search_law: 'allow',
  get_law_section: 'allow',
  search_ris: 'allow',
  search_eurlex: 'allow',
  get_eu_law: 'allow',
  // Law sources (connectors/): official ones like RIS; asked first when a
  // paid gateway (the lawyer's own subscription, e.g. Ansvar) would be used.
  search_law_sources: 'law_sources',
  get_law_source: 'law_sources',
  // Setting sources up: reading the list is free; switching one on is asked;
  // the key field only shows a secure input (the lawyer types the key).
  law_sources_status: 'allow',
  enable_law_source: 'ask',
  request_law_source_key: 'allow',

  // The firm's own knowledge, indexed on this computer.
  search_firm_library: 'allow',
  find_clause: 'allow',

  // Reading the workspace folder (the sandbox never reaches outside it).
  read_file: 'allow',
  list_directory: 'allow',
  search_local_files: 'allow',
  search_docs: 'allow',

  // The agent's own housekeeping. delegate_task runs a fresh model call
  // WITHOUT tools (same model, same data policy), so it cannot act.
  get_tool_schemas: 'allow',
  tool_picker: 'allow',
  compress_context: 'allow',
  delegate_task: 'allow',

  // Connected data sources: allowed when every source searched is on this
  // computer or the firm network; asked when the query goes outside.
  search_sources: 'sources',

  // Writes files into the workspace.
  write_file: 'ask',
  append_file: 'ask',
  rename_file: 'ask',
  export_document: 'ask',

  // Deletes a file (a copy is kept). Asked every time, whatever the rules say.
  delete_file: 'ask',

  // Changes the lawyer's calendar.
  sync_calendar: 'ask',

  // Runs a program (also needs features.shell, off by default).
  run_bash: 'ask',

  // Opens the web: the address (and the lawyer's saved logins) leave this computer.
  web_fetch: 'ask',
  web_save: 'ask',
  download_to_matter: 'ask',
}

/** How a tool is described to the lawyer: group → title, risk. */
const KINDS = {
  file: { title: 'OpenLex wants to save a file', risk: 'writes a file' },
  file_delete: { title: 'OpenLex wants to delete a file', risk: 'deletes a file (a copy is kept so it can be restored)' },
  file_rename: { title: 'OpenLex wants to rename a file', risk: 'renames or moves a file' },
  calendar: { title: 'OpenLex wants to add to your calendar', risk: 'changes your calendar' },
  command: { title: 'OpenLex wants to run a command', risk: 'runs a command' },
  web: { title: 'OpenLex wants to open a web page', risk: 'sends data to the web' },
  sources: { title: 'OpenLex wants to search an outside source', risk: 'sends data to the web' },
  connector: { title: 'OpenLex wants to use a connector', risk: 'uses a connector' },
  other: { title: 'OpenLex wants to use a tool', risk: 'does something OpenLex cannot check in advance' },
}
const FILE_TOOLS = new Set(['write_file', 'append_file', 'read_file', 'list_directory', 'search_local_files', 'search_docs', 'export_document', 'delete_file', 'rename_file'])
/** File tools that change something (asked first; refused outside the allowed places). */
const CHANGING = new Set(['write_file', 'append_file', 'delete_file', 'rename_file'])
/** File tools checked against the working folder / workspace before any rule (export_document writes into the matter folder by name). */
const SANDBOXED = new Set(['write_file', 'append_file', 'read_file', 'list_directory', 'search_local_files', 'search_docs', 'delete_file', 'rename_file'])
const WEB_TOOLS = new Set(['web_fetch', 'web_save', 'download_to_matter'])

function kindOf(tool) {
  if (String(tool).startsWith('mcp__')) return 'connector'
  if (tool === 'delete_file') return 'file_delete'
  if (tool === 'rename_file') return 'file_rename'
  if (FILE_TOOLS.has(tool)) return 'file'
  if (WEB_TOOLS.has(tool)) return 'web'
  if (tool === 'run_bash') return 'command'
  if (tool === 'sync_calendar') return 'calendar'
  if (tool === 'search_sources' || tool === 'search_law_sources' || tool === 'get_law_source' || tool === 'law_sources_status' || tool === 'enable_law_source' || tool === 'request_law_source_key') return 'sources'
  return 'other'
}

// ── patterns ─────────────────────────────────────────────────────────────
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/** Glob → RegExp. sep: "/" makes "*" stop at folders ("**" crosses them); null lets "*" match anything. */
function globRe(glob, sep = null) {
  let re = ''
  const g = String(glob)
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') { re += '(?:/)?'; i++ } } else if (c === '*') re += sep ? '[^/]*' : '.*'
    else if (c === '?') re += sep ? '[^/]' : '.'
    else re += escapeRe(c)
  }
  return new RegExp(`^${re}$`, 'i')
}
const cleanPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '')
function hostOf(url) { try { return new URL(String(url)).hostname.toLowerCase() } catch { return '' } }
function hostMatch(pattern, host) {
  const p = String(pattern).toLowerCase()
  if (!host) return false
  if (p.startsWith('*.') && host === p.slice(2)) return true
  return globRe(p).test(host)
}

/** What the ":argument" part of a pattern is matched against, per tool. */
function subjectOf(tool, args = {}) {
  if (String(tool).startsWith('mcp__')) { const [, server = '', ...rest] = String(tool).split('__'); return { type: 'mcp', value: `${server}:${rest.join('__')}` } }
  if (WEB_TOOLS.has(tool)) return { type: 'host', value: hostOf(args.url) }
  if (tool === 'run_bash') return { type: 'command', value: String(args.command || '').trim() }
  if (tool === 'search_local_files' || tool === 'search_docs') return pathSubject(args.directory)
  if (tool === 'export_document') return { type: 'path', value: cleanPath(args.matter), abs: null }
  if (FILE_TOOLS.has(tool)) return pathSubject(args.path)
  if (tool === 'search_sources') return { type: 'list', value: searchedSources(args).map((s) => s.name) }
  if (tool === 'search_law_sources' || tool === 'get_law_source') return { type: 'list', value: lawSources(tool, args).map((c) => c.id) }
  return { type: 'none', value: '' }
}

/** A path argument: as written (relative) and where it really is (abs, forward slashes; null when outside). */
function pathSubject(p) {
  const loc = require('./folder').tryLocate(p || '')
  return { type: 'path', value: cleanPath(p), abs: loc ? loc.abs.replace(/\\/g, '/') : null }
}

/** "~/Clients/Alpine/**", "/Users/…", "C:\\…": a pattern for the full path. */
const isAbsPattern = (a) => /^(~(\/|\\|$)|\/|[A-Za-z]:[\\/])/.test(a)
function matchPath(arg, subject) {
  if (!isAbsPattern(arg)) return globRe(cleanPath(arg), '/').test(subject.value)
  if (!subject.abs) return false
  const full = require('./folder').expandHome(arg).replace(/\\/g, '/')
  if (globRe(full, '/').test(subject.abs)) return true
  // "~/Alpine/**" also covers the folder itself.
  return full.endsWith('/**') && globRe(full.slice(0, -3), '/').test(subject.abs)
}

/** Does one pattern cover this tool call? */
function matchPattern(pattern, tool, subject) {
  const s = String(pattern || '').trim()
  if (!s) return false
  const i = s.indexOf(':')
  const name = i < 0 ? s : s.slice(0, i)
  const arg = i < 0 ? null : s.slice(i + 1)
  const isMcp = String(tool).startsWith('mcp__')
  if (name.toLowerCase() === 'mcp') {
    if (!isMcp) return false
    if (arg === null || arg === '*') return true
    const [server, t = '*'] = arg.split(':')
    const [sv, tv] = subject.value.split(':')
    return globRe(server).test(sv) && globRe(t).test(tv)
  }
  if (!globRe(name).test(tool)) return false
  if (arg === null || arg === '*' || arg === '**') return true
  if (subject.type === 'path') return matchPath(arg, subject)
  if (subject.type === 'host') return hostMatch(arg, subject.value)
  if (subject.type === 'command') {
    // "git *" also covers a bare "git".
    if (arg.endsWith(' *') && subject.value === arg.slice(0, -2)) return true
    return globRe(arg).test(subject.value)
  }
  if (subject.type === 'list') return subject.value.length > 0 && subject.value.every((v) => arg.split(',').some((a) => globRe(a.trim()).test(v)))
  return false
}

function validPattern(p) {
  if (typeof p !== 'string' || !p.trim()) return 'must be a non-empty text'
  const name = p.split(':')[0]
  if (!/^[\w*?.-]+$/.test(name)) return `"${p}": the tool name may only contain letters, digits, _ - . * ?`
  return null
}

/** Validate a permissions section; returns problems (empty = fine). */
function validate(section) {
  const problems = []
  if (section === null || section === undefined) return problems
  if (typeof section !== 'object' || Array.isArray(section)) return ['permissions: must be an object { allow, ask, deny, matters }']
  for (const k of Object.keys(section)) if (![...LISTS, 'matters'].includes(k)) problems.push(`permissions: unknown key "${k}" (allow, ask, deny, matters)`)
  const checkLists = (obj, where, keys) => {
    for (const k of keys) {
      if (obj[k] === undefined) continue
      if (!Array.isArray(obj[k])) { problems.push(`${where}.${k}: must be a list of patterns`); continue }
      obj[k].forEach((p, i) => { const e = validPattern(p); if (e) problems.push(`${where}.${k}[${i}]: ${e}`) })
    }
  }
  checkLists(section, 'permissions', LISTS)
  if (section.matters !== undefined) {
    if (!section.matters || typeof section.matters !== 'object' || Array.isArray(section.matters)) problems.push('permissions.matters: must be an object keyed by matter id')
    else {
      for (const [id, m] of Object.entries(section.matters)) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) { problems.push(`permissions.matters.${id}: must be an object { allow }`); continue }
        for (const k of Object.keys(m)) if (k !== 'allow') problems.push(`permissions.matters.${id}: only "allow" is supported per matter`)
        checkLists(m, `permissions.matters.${id}`, ['allow'])
      }
    }
  }
  return problems
}

// ── rules from the harness layers ─────────────────────────────────────────
/**
 * The firm's and the user's rules, kept apart (deny from either layer wins;
 * a firm "ask" cannot be silenced by the user). A locked section ignores
 * the user layer, including per-matter answers.
 */
function rules() {
  const harness = require('./harness')
  const cfg = harness.load()
  const layers = harness.layers()
  const pick = (data) => {
    const s = data && typeof data.permissions === 'object' && !Array.isArray(data.permissions) ? data.permissions : {}
    return { allow: asList(s.allow).filter((x) => typeof x === 'string'), ask: asList(s.ask).filter((x) => typeof x === 'string'), deny: asList(s.deny).filter((x) => typeof x === 'string'), matters: s.matters && typeof s.matters === 'object' ? s.matters : {} }
  }
  const locked = cfg.locked.includes('permissions')
  return { firm: pick(layers.firm.data), user: locked ? pick(null) : pick(layers.user.data), locked }
}

/** Configured data sources that a search_sources call would query. */
function searchedSources(args = {}) {
  let all = []
  try { all = require('./sources').list() } catch { return [] }
  const want = Array.isArray(args.sources) && args.sources.length ? new Set(args.sources.map(String)) : null
  return all.filter((s) => !s.error && (!want || want.has(s.name)) && (!args.kind || s.kind === args.kind))
}

/** Law sources (connectors/) a search_law_sources / get_law_source call would contact. */
function lawSources(tool, args = {}) {
  try {
    const ls = require('./connectors')
    if (tool === 'get_law_source') { const c = ls.CONNECTORS.find((x) => x.id === String(args.source || '').toLowerCase()); return c ? [c] : [] }
    const list = Array.isArray(args.sources) ? args.sources : typeof args.sources === 'string' && args.sources ? args.sources.split(/[\s,]+/) : undefined
    return ls.planned({ sources: list, jurisdiction: args.jurisdiction })
  } catch { return [] }
}

/**
 * The decision for one call, without asking anyone.
 * @returns {{ decision: 'allow'|'deny'|'ask', source: 'firm'|'user'|'matter'|'default', rule?: string, canAlways: boolean }}
 */
function evaluate(tool, args = {}, { matterId = null } = {}) {
  // Outside the working folder and the workspace, or a protected place: refused, never asked.
  const where = sandbox(tool, args)
  if (where.refused) return { decision: 'deny', source: 'sandbox', reason: where.refused, canAlways: false }
  const r = rules()
  const subject = subjectOf(tool, args)
  const hit = (list) => asList(list).find((p) => matchPattern(p, tool, subject))
  let rule
  if ((rule = hit(r.firm.deny))) return { decision: 'deny', source: 'firm', rule, canAlways: false }
  if ((rule = hit(r.user.deny))) return { decision: 'deny', source: 'user', rule, canAlways: false }
  // A delete is asked every time: no allow rule skips it, no "always" is offered.
  if (tool === 'delete_file') return { decision: 'ask', source: (rule = hit(r.firm.ask)) ? 'firm' : 'default', ...(rule ? { rule } : {}), canAlways: false, area: where.area, root: where.root }
  if ((rule = hit(r.firm.ask))) return { decision: 'ask', source: 'firm', rule, canAlways: false }
  if ((rule = hit(r.firm.allow))) return { decision: 'allow', source: 'firm', rule, canAlways: false }
  if ((rule = hit(r.user.allow))) return { decision: 'allow', source: 'user', rule, canAlways: false }
  if (matterId && (rule = hit(r.firm.matters?.[matterId]?.allow) || hit(r.user.matters?.[matterId]?.allow))) return { decision: 'allow', source: 'matter', rule, canAlways: false }
  const canAlways = !r.locked
  if ((rule = hit(r.user.ask))) return { decision: 'ask', source: 'user', rule, canAlways, area: where.area, root: where.root }
  let d = String(tool).startsWith('mcp__') ? 'ask' : BUILTIN[tool] || 'ask'
  if (d === 'ask' && where.area) return { decision: 'ask', source: 'default', canAlways, area: where.area, root: where.root }
  if (d === 'law_sources') d = lawSources(tool, args).some((c) => c.gateway) ? 'ask' : 'allow'
  if (d === 'sources') {
    const list = searchedSources(args)
    d = list.length && list.every((s) => s.local === true) ? 'allow' : list.length ? 'ask' : 'allow' // nothing configured → the tool only says so
  }
  return { decision: d, source: 'default', canAlways }
}

/**
 * Where a file tool would act: { area: 'folder'|'workspace', root } or
 * { refused: "plain reason" }; {} for every other tool.
 */
function sandbox(tool, args = {}) {
  if (!SANDBOXED.has(tool)) return {}
  const fo = require('./folder')
  const write = CHANGING.has(tool)
  const targets = tool === 'search_local_files' || tool === 'search_docs' ? [args.directory || ''] : tool === 'rename_file' ? [args.path, args.to] : [args.path || '']
  let first = null
  for (const [i, t] of targets.entries()) {
    if (tool === 'rename_file' && i === 1) {
      const to = String(t ?? '').trim()
      if (!to) continue
      // A bare new name stays next to the file.
      const dest = /[\\/]/.test(to) || to.startsWith('~') ? to : path.join(path.dirname(first?.abs || ''), to)
      try { fo.locate(dest, { write }) } catch (err) { return { refused: err.message } }
      continue
    }
    try { const loc = fo.locate(t, { write }); first = first || loc } catch (err) { return { refused: err.message } }
  }
  return first ? { area: first.area, root: first.root, loc: first } : {}
}

// ── describing a call in plain words ──────────────────────────────────────
const short = (s, n = 80) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
function where(p) { const d = path.posix.dirname(cleanPath(p)); return d && d !== '.' ? `${d}/` : 'the workspace folder' }

/** "in this folder: ~/Clients/Alpine" or "in ~/Clients/Alpine/2024 (inside this folder)". */
function inFolder(loc) {
  const fo = require('./folder')
  const dir = path.dirname(loc.abs)
  return fo.within(loc.root, dir) && fo.within(dir, loc.root) ? `in this folder: ${fo.tilde(loc.root)}` : `in ${fo.tilde(dir)} (inside this folder)`
}

/** One plain-language line, e.g. "Save obligations.csv in Acme/" or "Save obligations.csv in this folder: ~/Clients/Alpine". */
function summarize(tool, args = {}) {
  const a = args || {}
  const loc = SANDBOXED.has(tool) ? sandbox(tool, a).loc : null
  if (loc && loc.area === 'folder') {
    const name = path.basename(loc.abs)
    switch (tool) {
      case 'write_file': return `Save ${name} ${inFolder(loc)}`
      case 'append_file': return `Add to ${name} ${inFolder(loc)}`
      case 'delete_file': return `Delete ${name} ${inFolder(loc)} (a copy is kept)`
      case 'rename_file': return `Rename ${name} to ${path.basename(String(a.to || '')) || 'a new name'} ${inFolder(loc)}`
      default: break
    }
  }
  switch (tool) {
    case 'delete_file': return `Delete ${path.posix.basename(cleanPath(a.path)) || 'a file'} in ${where(a.path)} (a copy is kept)`
    case 'rename_file': return `Rename ${path.posix.basename(cleanPath(a.path)) || 'a file'} to ${path.basename(String(a.to || '')) || 'a new name'} in ${where(a.path)}`
    case 'write_file': return `Save ${path.posix.basename(cleanPath(a.path)) || 'a file'} in ${where(a.path)}`
    case 'append_file': return `Add to ${path.posix.basename(cleanPath(a.path)) || 'a file'} in ${where(a.path)}`
    case 'export_document': return `Export the document as ${String(a.format || 'a file').toUpperCase()} into ${a.matter ? `${short(a.matter, 40)}/` : 'the matter folder'}`
    case 'sync_calendar': return 'Add the contract\'s deadlines to your calendar'
    case 'read_attachment': return `Read the attached file ${short(a.name, 60)}`
    case 'run_bash': return `Run the command: ${short(a.command, 100)}`
    case 'web_fetch': return `Read the web page ${hostOf(a.url) || short(a.url, 60)}`
    case 'web_save': return `Save the web page from ${hostOf(a.url) || short(a.url, 60)} into the matter folder`
    case 'download_to_matter': return `Download ${path.posix.basename(String(a.url || '').split(/[?#]/)[0]) || 'a file'} from ${hostOf(a.url) || 'the web'} into the matter folder`
    case 'search_law_sources': return `Look up "${short(a.query, 60)}" in ${lawSources(tool, a).map((c) => c.label).join(', ') || 'the law sources'}`
    case 'get_law_source': return `Open a document from ${lawSources(tool, a).map((c) => c.label).join(', ') || 'a law source'}`
    case 'enable_law_source': { let l = short(a.source, 30); try { l = require('./connectors').connector(a.source).label } catch { /* unknown */ } return `Switch on the law source ${l}` }
    case 'request_law_source_key': return `Ask you for the key of ${short(a.source, 30)} in a secure field`
    case 'law_sources_status': return 'See which law sources are connected'
    case 'search_sources': return `Search ${searchedSources(a).filter((s) => !s.local).map((s) => s.title || s.name).join(', ') || 'a connected source'} for "${short(a.query, 60)}"`
    default:
      if (String(tool).startsWith('mcp__')) { const [, server, ...t] = String(tool).split('__'); return `Use "${t.join('__')}" from the ${server} connector` }
      return `Use the tool ${tool}`
  }
}

/** Arguments for the front end: strings trimmed, nothing huge. */
function trimArgs(args = {}) {
  const out = {}
  for (const [k, v] of Object.entries(args || {}).slice(0, 12)) {
    if (typeof v === 'string') out[k] = v.length > 300 ? `${v.slice(0, 300)}… (${v.length} characters)` : v
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
    else { const s = JSON.stringify(v); out[k] = s.length > 300 ? `${s.slice(0, 300)}…` : v }
  }
  return out
}

/** The rule an "Always allow" answer saves: as narrow as is still useful. */
function suggestPattern(tool, args = {}) {
  const s = subjectOf(tool, args)
  if (s.type === 'mcp') return `mcp:${s.value}`
  if (s.type === 'host' && s.value) return `${tool}:${s.value}`
  if (s.type === 'command' && s.value) return `run_bash:${s.value.split(/\s+/)[0]} *`
  if (s.type === 'list' && s.value.length) return `${tool}:${s.value.join(',')}`
  return tool
}

// ── asking ────────────────────────────────────────────────────────────────
const store = new AsyncLocalStorage()
const pending = new Map() // id → { resolve, event }

/**
 * Run fn with an answering front end attached. Everything the agent does
 * inside fn may ask through it.
 * @param {{ ask?: (event) => void, signal?: AbortSignal, allow?: string[], yes?: boolean, timeoutMs?: number, client?: string }} opts
 *   ask:   sends the permission event to the person (null = nobody can answer → deny)
 *   allow: patterns pre-approved for this run (CLI --allow); yes: approve every "ask" (CLI --yes). Deny rules still win.
 */
function session(opts, fn) {
  return store.run({ ...opts, allow: asList(opts?.allow).map(String) }, fn)
}

function audit(entry) {
  require('./policy').audit({ provider: 'permissions', model: null, ...entry })
}

/**
 * Decide one tool call, asking the lawyer when needed.
 * @returns {Promise<{ allowed: boolean, by: string, output?: string }>}  output = the tool ERROR text for the model when refused
 */
async function authorize({ tool, args = {}, matterId = null }) {
  const ev = evaluate(tool, args, { matterId })
  const call = tool
  if (ev.source === 'sandbox') {
    audit({ matter: matterId, call, decision: 'blocked', by: 'sandbox' })
    return { allowed: false, by: 'sandbox', output: `ERROR: ${ev.reason}. This is never allowed, so nobody was asked. Do not retry; work with the files in the working folder or the matter folder, and tell the lawyer what you could not reach.` }
  }
  const summary = summarize(tool, args)
  const base = { matter: matterId, call, ...(ev.rule ? { rule: ev.rule } : {}) }
  if (ev.decision === 'allow') {
    audit({ ...base, decision: 'allowed', by: ev.source === 'default' ? 'default' : `rule:${ev.source}` })
    return { allowed: true, by: ev.source }
  }
  if (ev.decision === 'deny') {
    audit({ ...base, decision: 'blocked', by: `rule:${ev.source}` })
    return { allowed: false, by: 'rule', output: `ERROR: Not allowed by ${ev.source === 'firm' ? 'the firm\'s' : 'the lawyer\'s'} permission rules (deny "${ev.rule}"): ${summary}. Do not retry this tool; continue with what you have and say what could not be done.` }
  }
  const sess = store.getStore()
  const subject = subjectOf(tool, args)
  // A delete always needs a person: --yes and --allow do not cover it.
  if (sess && tool !== 'delete_file' && (sess.yes || sess.allow.some((p) => matchPattern(p, tool, subject)))) {
    audit({ ...base, decision: 'allowed', by: 'session' })
    return { allowed: true, by: 'session' }
  }
  if (!sess || typeof sess.ask !== 'function') {
    audit({ ...base, decision: 'blocked', by: 'non-interactive' })
    return { allowed: false, by: 'non-interactive', output: `ERROR: This needs the lawyer's permission (${summary}), but nobody can answer here (no interactive front end). Do not retry; continue without it and say what was not done. The lawyer can allow it with a rule ("openlex permissions allow ${suggestPattern(tool, args)}") or --allow for one run.` }
  }
  const answer = await ask(sess, { tool, args, matterId, summary, ev })
  const allowed = answer.decision !== 'deny'
  audit({ ...base, decision: allowed ? 'allowed' : 'blocked', by: answer.by, answer: answer.decision })
  if (allowed) return { allowed: true, by: 'lawyer' }
  const why = answer.by === 'timeout' ? 'no answer in time' : answer.by === 'disconnect' ? 'the lawyer closed the conversation' : 'the lawyer said no'
  return { allowed: false, by: answer.by, output: `ERROR: The lawyer declined: ${summary} (${why}). Do not retry this tool; continue without it and tell the lawyer what you could not do.` }
}

function ask(sess, { tool, args, matterId, summary, ev }) {
  const id = `perm_${crypto.randomBytes(9).toString('hex')}`
  const kind = KINDS[kindOf(tool)]
  // In the working folder, "always" means: in this folder.
  const inFolderArea = ev.area === 'folder' && ev.root
  const choices = inFolderArea
    ? ['once', ...(ev.canAlways ? ['always_folder'] : []), 'deny']
    : ['once', ...(ev.canAlways && matterId ? ['always_matter'] : []), ...(ev.canAlways ? ['always'] : []), 'deny']
  const fo = require('./folder')
  const event = {
    type: 'permission', id, tool, title: kind.title, summary, detail: trimArgs(args), risk: kind.risk,
    matterId: matterId || null, choices, always: ev.canAlways && !inFolderArea ? suggestPattern(tool, args) : null,
    ...(inFolderArea ? { folder: fo.tilde(ev.root), ...(ev.canAlways ? { alwaysFolder: `${tool}:${fo.tilde(ev.root)}/**` } : {}) } : {}),
    ...(ev.source === 'firm' ? { firmRule: true } : {}),
  }
  const timeoutMs = Number(sess.timeoutMs) || Number(process.env.OPENLEX_PERMISSION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  return new Promise((resolve) => {
    let timer = null
    const onAbort = () => finish({ decision: 'deny', by: 'disconnect' })
    const finish = (r) => {
      if (!pending.has(id)) return
      pending.delete(id)
      clearTimeout(timer)
      sess.signal?.removeEventListener?.('abort', onAbort)
      try { sess.ask({ type: 'permission_result', id, decision: r.decision, by: r.by }) } catch { /* stream closed */ }
      resolve(r)
    }
    pending.set(id, { event, choices, finish })
    if (sess.signal?.aborted) return onAbort()
    sess.signal?.addEventListener?.('abort', onAbort, { once: true })
    timer = setTimeout(() => finish({ decision: 'deny', by: 'timeout' }), timeoutMs)
    timer.unref?.()
    try { sess.ask(event) } catch { finish({ decision: 'deny', by: 'disconnect' }) }
  })
}

/**
 * The lawyer's answer to a pending request (POST /api/permissions/answer).
 * "always" / "always_matter" also save the suggested rule to the user layer.
 * @returns {{ ok: boolean, saved?: string, error?: string }}
 */
function answer(id, decision) {
  const p = pending.get(String(id || ''))
  if (!p) return { ok: false, error: 'no such permission request (answered already, timed out, or the run ended)' }
  if (!DECISIONS.includes(decision)) return { ok: false, error: `decision must be one of ${DECISIONS.join(', ')}` }
  if (!p.choices.includes(decision)) return { ok: false, error: `"${decision}" is not offered for this request (${p.choices.join(', ')})` }
  let saved
  if (decision === 'always' || decision === 'always_matter' || decision === 'always_folder') {
    try {
      saved = decision === 'always_folder' ? p.event.alwaysFolder : p.event.always
      addRule('allow', saved, decision === 'always_matter' ? { matterId: p.event.matterId } : {})
    } catch (err) {
      saved = undefined
      console.warn('[permissions] could not save the rule:', err.message)
    }
  }
  p.finish({ decision, by: 'lawyer' })
  return { ok: true, ...(saved ? { saved } : {}) }
}

/** Requests waiting for an answer (for front ends that reconnect). */
function waiting() {
  return [...pending.values()].map((p) => p.event)
}

// ── editing rules (CLI, settings screens) ─────────────────────────────────
function userSection() {
  const harness = require('./harness')
  const cur = harness.layers().user.data?.permissions
  return cur && typeof cur === 'object' && !Array.isArray(cur) ? JSON.parse(JSON.stringify(cur)) : {}
}
function saveUser(next) {
  const problems = validate(next)
  if (problems.length) throw new Error(problems.join('; '))
  const empty = !LISTS.some((k) => (next[k] || []).length) && !Object.keys(next.matters || {}).length
  require('./harness').setUserSection('permissions', empty ? null : next)
  try { require('./hub').publish('permissions-changed', {}, 'engine') } catch { /* no hub in tests */ }
}

/** Add a pattern to allow / ask / deny (user layer), optionally for one matter (allow only). */
function addRule(list, pattern, { matterId = null } = {}) {
  if (!LISTS.includes(list)) throw new Error(`list must be one of ${LISTS.join(', ')}`)
  const e = validPattern(pattern)
  if (e) throw new Error(e)
  const p = String(pattern).trim()
  const next = userSection()
  if (matterId) {
    if (list !== 'allow') throw new Error('per matter, only "allow" rules are kept')
    next.matters = next.matters || {}
    const m = next.matters[matterId] = next.matters[matterId] || { allow: [] }
    m.allow = [...new Set([...(m.allow || []), p])]
  } else {
    // A pattern sits in one list only: allowing it removes a deny, and vice versa.
    for (const k of LISTS) if (next[k]) next[k] = next[k].filter((x) => x !== p)
    next[list] = [...new Set([...(next[list] || []), p])]
  }
  saveUser(next)
  return list
}

/** Remove a pattern from the user layer (every list, or one matter's). Returns true when something was removed. */
function removeRule(pattern, { matterId = null } = {}) {
  const p = String(pattern || '').trim()
  const next = userSection()
  let removed = false
  const drop = (arr) => { const out = (arr || []).filter((x) => x !== p); if (out.length !== (arr || []).length) removed = true; return out }
  if (matterId) {
    const m = next.matters?.[matterId]
    if (m) { m.allow = drop(m.allow); if (!m.allow.length) delete next.matters[matterId] }
  } else {
    for (const k of LISTS) if (next[k]) next[k] = drop(next[k])
    for (const [id, m] of Object.entries(next.matters || {})) { m.allow = drop(m.allow); if (!m.allow.length) delete next.matters[id] }
  }
  if (removed) saveUser(next)
  return removed
}

/** Everything a settings screen shows: rules by layer, the defaults table, what is waiting. */
function describe() {
  const r = rules()
  return {
    firm: r.firm, user: r.user, locked: r.locked,
    defaults: Object.entries(BUILTIN).map(([tool, d]) => ({ tool, decision: d === 'sources' ? 'allow (local sources) / ask' : d === 'law_sources' ? 'allow (official sources) / ask (paid gateways)' : d, kind: kindOf(tool) })),
    pending: waiting(),
  }
}

module.exports = {
  BUILTIN, KINDS, DECISIONS, session, authorize, answer, evaluate, validate, matchPattern, subjectOf, summarize, suggestPattern, sandbox,
  rules, addRule, removeRule, describe, waiting, kindOf,
}
