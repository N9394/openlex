"use strict"
/**
 * Agent profiles — named ways of working the harness can switch between.
 *
 *   "agents": {
 *     "drafter": {
 *       "title": "Drafting partner",
 *       "description": "Drafts and redrafts clauses in the firm's style.",
 *       "instructions": "Prefer the firm's own clause wording (find_clause). Keep defined terms. …",
 *       "tools": ["find_clause", "search_firm_library", "search_law", "get_law_section"],
 *       "routes": { "write": "anthropic:claude-opus-5-5", "plan": "local" },
 *       "depth": "deep",
 *       "skills": ["rebalance-clause"]
 *     }
 *   }
 *
 * Use: "@drafter …" at the start of a chat message, `agent` in /api/chat,
 * or a matter's default agent (matter.agent). Profiles combine with
 * skills: "@drafter /rebalance-clause make §7 fairer".
 *
 *   instructions  added to the system prompt (after the legal RULES, which
 *                 always stay: sources, citations, verbatim anchors)
 *   tools         allow-list (intersected with a skill's allow-list)
 *   routes        role → target, tried before the routing map's role
 *                 routes (rules and the data policy still apply first)
 *   depth         fast | balanced | deep | ultra (tool hops and budget)
 *   skills        skills this agent suggests first
 *
 * Built-in profiles below; the firm and user layers of openlex.json add
 * profiles or override these by name.
 */

const { AsyncLocalStorage } = require('async_hooks')

const NAME_RE = /^[a-z][a-z0-9-]{1,31}$/
const DEPTHS = ['fast', 'balanced', 'deep', 'ultra']
const MODEL_ROLES = ['plan', 'analyze', 'write', 'draft', 'summarize']

const BUILT_IN = {
  associate: {
    title: 'Associate',
    description: 'The default: reads the document, searches the law, answers and proposes changes.',
    instructions: '',
  },
  researcher: {
    title: 'Researcher',
    description: 'Answers legal questions from statute and EU law with exact citations; no edits to the document.',
    instructions: 'You are doing legal research. Search before you answer (search_law in the jurisdiction\'s language, search_ris for current Austrian federal law, search_eurlex then get_eu_law for EU law, search_law_sources then get_law_source for German federal, Slovak and Czech law and any gateway the lawyer connected) and read the full section you rely on (get_law_section). Answer as a short memo: question, short answer, legal basis with the decisive words quoted, analysis, open points. Never propose document changes. If the sources don\'t answer the question, say so.',
    tools: ['search_law', 'get_law_section', 'search_ris', 'search_eurlex', 'get_eu_law', 'search_law_sources', 'get_law_source', 'web_fetch', 'web_save', 'search_firm_library', 'recall', 'write_file'],
    depth: 'deep',
  },
  reviewer: {
    title: 'Reviewer',
    description: 'Reviews the document for the client\'s risks and proposes granular, anchored fixes.',
    instructions: 'You are reviewing for risk. Work clause by clause, flag what disadvantages the client, ground legal points in a law search, and propose one granular suggestion per issue with the exact original text as anchor. Rank by severity.',
  },
  drafter: {
    title: 'Drafter',
    description: 'Drafts and redrafts clauses, preferring the firm\'s own wording.',
    instructions: 'You are drafting. First look for the firm\'s own wording (find_clause, search_firm_library) and follow it; keep the document\'s defined terms, numbering and language. Produce complete, signable text. Check mandatory law with search_law when the clause touches it.',
    skills: ['rebalance-clause'],
  },
}

const store = new AsyncLocalStorage()

function clean(name, a) {
  if (!NAME_RE.test(name)) throw new Error(`agent name "${name}" must be 2–32 lowercase letters, digits or dashes`)
  const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])
  // "model": where the agent runs, as one choice (the app's form): it
  // becomes the route of every role the agent's own work uses, unless
  // routes says otherwise. Rules and the data policy still come first.
  const model = typeof a.model === 'string' && a.model.trim() ? a.model.trim() : null
  const fromModel = model ? Object.fromEntries(MODEL_ROLES.map((r) => [r, model])) : {}
  const routes = a.routes && typeof a.routes === 'object' && !Array.isArray(a.routes) ? a.routes : {}
  const out = {
    name,
    title: String(a.title || name).slice(0, 60),
    description: String(a.description || '').slice(0, 300),
    instructions: String(a.instructions || '').slice(0, 8000),
    tools: list(a.tools),
    routes: { ...fromModel, ...routes },
    depth: DEPTHS.includes(a.depth) ? a.depth : null,
    skills: list(a.skills),
    ...(model ? { model } : {}),
  }
  return out
}

/** All profiles: built-in, then openlex.json (firm, user) by name. Invalid ones are listed with an error. */
function list() {
  const fromConfig = (() => { try { return require('./harness').load().agents || {} } catch { return {} } })()
  const merged = { ...BUILT_IN }
  for (const [name, a] of Object.entries(fromConfig)) merged[name] = a && typeof a === 'object' ? { ...(BUILT_IN[name] || {}), ...a, source: BUILT_IN[name] ? 'built-in+config' : 'config' } : a
  return Object.entries(merged).map(([name, a]) => {
    try { return { ...clean(name, a || {}), source: a?.source || 'built-in' } } catch (err) { return { name, error: err.message } }
  })
}

function get(name) {
  const a = list().find((x) => x.name === String(name || '').toLowerCase())
  if (!a) throw new Error(`no agent profile "${name}" (${list().map((x) => x.name).join(', ')})`)
  if (a.error) throw new Error(`agent profile "${name}" is invalid: ${a.error}`)
  return a
}

/**
 * "@researcher is X allowed?" → { agent, message }; anything else → null.
 * "@" is hard to type on German/Austrian keyboards in a terminal, so a
 * no-symbol form works too: "as researcher: is X allowed?" (or "als …:"),
 * matched case-insensitively against profile names and titles.
 */
function parseInvocation(message) {
  return matchInvocation(message, list())
}

/** parseInvocation against a given profile list (the terminal app uses /api/agents). */
function matchInvocation(message, profiles) {
  const text = String(message || '')
  const usable = (profiles || []).filter((x) => x && x.name && !x.error)
  const at = text.match(/^\s*@([A-Za-z][A-Za-z0-9-]{1,31})(?:\s+|$)([\s\S]*)$/)
  if (at) {
    const a = usable.find((x) => x.name === at[1].toLowerCase())
    return a ? { agent: a, message: at[2].trim() } : null
  }
  const as = text.match(/^\s*(?:as|als)\s+(?:(?:the|an?|der|die)\s+)?([^:\n]{2,60}?)\s*:\s*([\s\S]*)$/i)
  if (as) {
    const want = as[1].trim().toLowerCase()
    const a = usable.find((x) => x.name === want || String(x.title || '').toLowerCase() === want)
    return a ? { agent: a, message: as[2].trim() } : null
  }
  return null
}

/** Validate an agents section; returns problems (empty = fine). */
function validate(agents = {}) {
  const problems = []
  const routing = require('./routing')
  const tools = require('./tools').TOOLS
  for (const [name, a] of Object.entries(agents || {})) {
    try { clean(name, a || {}) } catch (err) { problems.push(`agents.${name}: ${err.message}`); continue }
    if (a.model !== undefined) for (const p of routing.validate({ roles: { write: a.model } })) problems.push(`agents.${name}.model: ${p.replace(/^roles\.write: /, '')}`)
    if (a.depth !== undefined && !DEPTHS.includes(a.depth)) problems.push(`agents.${name}.depth: one of ${DEPTHS.join(', ')}`)
    for (const t of a.tools || []) if (!tools[t]) problems.push(`agents.${name}.tools: unknown tool "${t}"`)
    for (const p of routing.validate({ roles: a.routes || {} })) problems.push(`agents.${name}.${p}`)
  }
  return problems
}

/** Run fn with an agent profile active (routing and budgets read it). */
function run(agent, fn) {
  return agent ? store.run(agent, fn) : fn()
}
function current() {
  return store.getStore() || null
}

function promptBlock(agent) {
  if (!agent || !agent.instructions) return ''
  return `\n\nAGENT PROFILE: ${agent.title}\n${agent.instructions}\n`
}

/** Combined tool allow-list of an agent and a skill (null = no restriction). */
function allowedTools(agent, skill) {
  const skills = require('./skills')
  const a = agent?.tools?.length ? new Set([...agent.tools, ...skills.ALWAYS_ALLOWED]) : null
  const s = skill ? skills.allowedTools(skill) : null
  if (a && s) return new Set([...a].filter((t) => s.has(t)))
  return a || s
}

// ── making agents in the app (no JSON) ───────────────────────────────────

/**
 * What an agent may use, in plain words (the form's checkboxes) → tools.
 * Reading the document and taking notes are always allowed (skills.ALWAYS_ALLOWED).
 */
const TOOL_GROUPS = [
  { id: 'law', en: 'The law collection on this computer', de: 'Die Gesetzessammlung auf diesem Computer', tools: ['search_law', 'get_law_section'] },
  { id: 'austria', en: 'Austrian law online (RIS)', de: 'Österreichisches Recht online (RIS)', tools: ['search_ris'] },
  { id: 'eu', en: 'EU law online (EUR-Lex)', de: 'EU-Recht online (EUR-Lex)', tools: ['search_eurlex', 'get_eu_law'] },
  { id: 'otherLaw', en: 'German, Slovak and Czech law, and law databases you connected', de: 'Deutsches, slowakisches und tschechisches Recht sowie verbundene Rechtsdatenbanken', tools: ['search_law_sources', 'get_law_source'] },
  { id: 'firm', en: 'The firm\'s library and clause bank', de: 'Die Bibliothek und Klauselsammlung der Kanzlei', tools: ['search_firm_library', 'find_clause', 'search_sources'] },
  { id: 'documents', en: 'The matter\'s documents', de: 'Die Dokumente der Akte', tools: ['get_document_map', 'search_docs', 'read_file', 'list_directory', 'search_local_files'] },
  { id: 'web', en: 'Web pages (asks first)', de: 'Webseiten (fragt vorher)', tools: ['web_fetch', 'web_save'] },
  { id: 'memory', en: 'Notes from earlier work', de: 'Notizen aus früherer Arbeit', tools: ['recall'] },
  { id: 'files', en: 'Save files (asks first)', de: 'Dateien speichern (fragt vorher)', tools: ['write_file', 'append_file', 'export_document'] },
]
const groupTools = (ids) => [...new Set(TOOL_GROUPS.filter((g) => (ids || []).includes(g.id)).flatMap((g) => g.tools))]
/** The groups an allow-list covers (an empty list = everything). */
function groupsOf(tools) {
  if (!tools || !tools.length) return TOOL_GROUPS.map((g) => g.id)
  return TOOL_GROUPS.filter((g) => g.tools.some((t) => tools.includes(t))).map((g) => g.id)
}

const CITE = 'Cite a source for every legal point (the statute and section, the case, or the clause of the document) and quote the decisive words exactly.'
/** Starting points for the form ("Templates"). A panel can use them by name without saving. */
const TEMPLATES = {
  'claimant-counsel': { title: 'Claimant\'s counsel', description: 'Argues for the claimant: the strongest case, with sources.', instructions: `You act for the claimant. Build the strongest legally sound case for the claimant's position: the claims, their legal basis, the evidence that supports them, and answers to the obvious defences. Be an advocate, but never invent facts or law. ${CITE}`, groups: ['law', 'austria', 'eu', 'otherLaw', 'documents', 'firm'], depth: 'balanced' },
  'defendant-counsel': { title: 'Defendant\'s counsel', description: 'Argues for the defendant: defences, weaknesses of the claim, with sources.', instructions: `You act for the defendant. Find every defence: missing elements of the claim, limitation periods, exclusions, contributory fault, procedural points, and the weaknesses of the claimant's evidence. Be an advocate, but never invent facts or law. ${CITE}`, groups: ['law', 'austria', 'eu', 'otherLaw', 'documents', 'firm'], depth: 'balanced' },
  'devils-advocate': { title: 'Devil\'s advocate', description: 'Attacks the position on the table and finds what could go wrong.', instructions: `You are the devil's advocate. Take the position that is currently favoured and attack it: what a court, the other side or a regulator would say against it, which facts are missing, which risks are underrated. Say what would change your mind. ${CITE}`, groups: ['law', 'austria', 'eu', 'otherLaw', 'documents'], depth: 'balanced' },
  drafter: { title: 'Drafter', description: 'Drafts and redrafts clauses, preferring the firm\'s own wording.', instructions: BUILT_IN.drafter.instructions, groups: ['firm', 'law', 'documents'], depth: 'balanced' },
  researcher: { title: 'Researcher', description: BUILT_IN.researcher.description, instructions: BUILT_IN.researcher.instructions, groups: ['law', 'austria', 'eu', 'otherLaw', 'firm', 'web', 'memory'], depth: 'deep' },
  'compliance-checker': { title: 'Compliance checker', description: 'Checks against mandatory law and regulation (consumer law, data protection, sector rules).', instructions: `You check compliance. Go through the document or the plan point by point against mandatory law and regulation (consumer protection, data protection/GDPR, competition, sector rules, formal requirements). For each problem: what it is, the rule it breaks, how serious it is, and the fix. Say clearly when you found nothing. ${CITE}`, groups: ['law', 'austria', 'eu', 'otherLaw', 'documents'], depth: 'deep' },
}
function templates() {
  return Object.entries(TEMPLATES).map(([name, t]) => ({ name, title: t.title, description: t.description, instructions: t.instructions, groups: t.groups, depth: t.depth }))
}
/** A template as a usable profile (a panel's "claimant-counsel" without saving one first). */
function fromTemplate(name) {
  const t = TEMPLATES[name]
  return t ? { ...clean(name, { title: t.title, description: t.description, instructions: t.instructions, tools: groupTools(t.groups), depth: t.depth }), source: 'template' } : null
}
/** A profile, or the template of that name. */
function resolve(name) {
  try { return get(name) } catch (err) { const t = fromTemplate(String(name || '').toLowerCase()); if (t) return t; throw err }
}

/** "Claimant's counsel" → "claimants-counsel". */
function slug(title) {
  const s = String(title || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
  return /^[a-z]/.test(s) ? (s.length >= 2 ? s : `${s}-agent`) : `agent-${s || 'new'}`.slice(0, 32)
}

/** Who may change agents where: { user, firm, locked } */
function where() {
  const h = require('./harness')
  const cfg = h.load()
  let firmFile = null
  try { firmFile = h.layers().firm.path } catch { firmFile = null }
  return { locked: (cfg.locked || []).includes('agents'), firm: !!firmFile, firmFile, user: h.USER_PATH }
}

/**
 * Save an agent from the form: { name?, title, description, instructions,
 * groups | tools, model, depth } into the user layer (scope "user") or the
 * firm's openlex.json (scope "firm"). `rename`: the old name, removed.
 */
function save(form = {}, { scope = 'user', rename = null } = {}) {
  const h = require('./harness')
  const w = where()
  if (scope === 'user' && w.locked) throw new Error('Your firm has fixed the list of agents; ask whoever looks after OpenLex at your firm to add this one.')
  const title = String(form.title || '').trim()
  if (!title) throw new Error('Give the agent a name.')
  if (!String(form.instructions || '').trim()) throw new Error('Say in a few sentences what the agent does.')
  const name = form.name ? String(form.name).toLowerCase() : slug(title)
  const tools = Array.isArray(form.tools) ? form.tools : Array.isArray(form.groups) ? groupTools(form.groups) : []
  const depth = { fast: 'fast', balanced: 'balanced', deep: 'deep', thorough: 'deep' }[form.depth] || 'balanced'
  const entry = { title: title.slice(0, 60), description: String(form.description || '').trim().slice(0, 300), instructions: String(form.instructions).trim().slice(0, 8000), tools, depth, ...(form.model ? { model: String(form.model) } : {}) }
  const problems = validate({ [name]: entry })
  if (problems.length) throw new Error(problems.join('; '))
  const layer = scope === 'firm' ? h.layers().firm.data || {} : h.layers().user.data || {}
  const next = { ...(layer.agents || {}) }
  if (rename && rename !== name) delete next[rename]
  next[name] = entry
  if (scope === 'firm') h.setFirmSection('agents', next)
  else h.setUserSection('agents', next)
  return get(name)
}

/** Remove an agent of the user (or firm) layer; built-ins come back as they were. */
function remove(name, { scope = 'user' } = {}) {
  const h = require('./harness')
  if (scope === 'user' && where().locked) throw new Error('Your firm has fixed the list of agents.')
  const layer = scope === 'firm' ? h.layers().firm.data || {} : h.layers().user.data || {}
  const next = { ...(layer.agents || {}) }
  if (!next[name]) throw new Error(`"${name}" is not one of ${scope === 'firm' ? 'the firm\'s' : 'your'} agents`)
  delete next[name]
  const v = Object.keys(next).length ? next : null
  if (scope === 'firm') h.setFirmSection('agents', v)
  else h.setUserSection('agents', v)
  return { removed: name }
}

/**
 * "Make an agent from this conversation": what the lawyer asked for in a
 * conversation, proposed as an agent (title, what it does, sources). The
 * lawyer confirms in the form; nothing is saved here.
 */
async function propose({ sessionId, matterId = null } = {}) {
  const { Session } = require('./session')
  const asks = new Session(String(sessionId || '')).history().filter((m) => m.role === 'user').map((m) => String(m.content || '').trim()).filter(Boolean).slice(-12)
  if (!asks.length) throw new Error('This conversation has no questions yet.')
  const fallback = { title: 'My agent', description: `Works the way you asked in “${asks[0].slice(0, 60)}”.`, instructions: `Work the way the lawyer asked in this conversation:\n${asks.map((a) => `- ${a.slice(0, 300)}`).join('\n')}\n${CITE}`, groups: ['law', 'austria', 'eu', 'otherLaw', 'documents', 'firm'], depth: 'balanced' }
  try {
    const raw = await require('./policy').withMatter(matterId, () => require('./llm').chat([
      { role: 'system', content: `A lawyer wants a reusable AI agent that works the way they asked in a conversation. From their requests, write the agent. Reply with JSON only: {"title": "2-4 words", "description": "one sentence", "instructions": "3-8 sentences in the second person: the agent's job, how it works, what it must always do (cite sources)", "groups": [ids from: ${TOOL_GROUPS.map((g) => g.id).join(', ')}], "depth": "fast|balanced|deep"}. Write in the language of the requests. Never include client names or facts of the case in the instructions.` },
      { role: 'user', content: asks.map((a, i) => `${i + 1}. ${a.slice(0, 800)}`).join('\n') },
    ], { maxTokens: 900, role: 'summarize' }))
    const m = String(raw).match(/\{[\s\S]*\}/)
    const p = JSON.parse(m ? m[0] : raw)
    const out = { title: String(p.title || fallback.title).slice(0, 60), description: String(p.description || '').slice(0, 300), instructions: String(p.instructions || '').slice(0, 8000) || fallback.instructions, groups: (Array.isArray(p.groups) ? p.groups : []).filter((g) => TOOL_GROUPS.some((x) => x.id === g)), depth: DEPTHS.includes(p.depth) ? p.depth : 'balanced' }
    if (!out.groups.length) out.groups = fallback.groups
    return { proposal: out, asks: asks.length }
  } catch (err) {
    return { proposal: fallback, asks: asks.length, note: 'Proposed from your questions as they are (the AI could not be asked).' }
  }
}

/** GET /api/agents and POST /api/agents/save|delete|propose → { status, json } or null. */
async function handle(method, p, params, body = {}) {
  if (p !== '/api/agents' && !p.startsWith('/api/agents/')) return null
  try {
    if (method === 'GET' && p === '/api/agents') {
      const lang = /^de/i.test(String((params && typeof params.get === 'function' ? params.get('lang') : params?.lang) || '')) ? 'de' : 'en'
      const all = list().map((a) => (a.error ? a : { ...a, groups: groupsOf(a.tools) }))
      return { status: 200, json: { agents: all, templates: templates(), groups: TOOL_GROUPS.map((g) => ({ id: g.id, label: g[lang], tools: g.tools })), depths: ['fast', 'balanced', 'deep'], where: (({ firmFile, ...w }) => w)(where()) } }
    }
    if (method !== 'POST') return { status: 405, json: { error: 'use POST' } }
    if (p === '/api/agents/save') return { status: 200, json: { agent: save(body.agent || body, { scope: body.scope === 'firm' ? 'firm' : 'user', rename: body.rename || null }) } }
    if (p === '/api/agents/delete') return { status: 200, json: remove(String(body.name || ''), { scope: body.scope === 'firm' ? 'firm' : 'user' }) }
    if (p === '/api/agents/propose') return { status: 200, json: await propose({ sessionId: body.sessionId, matterId: body.matterId || null }) }
    return { status: 404, json: { error: 'not found' } }
  } catch (err) {
    return { status: 400, json: { error: err.message } }
  }
}

module.exports = { list, get, resolve, parseInvocation, matchInvocation, validate, run, current, promptBlock, allowedTools, save, remove, propose, templates, fromTemplate, groupsOf, groupTools, handle, slug, BUILT_IN, DEPTHS, TOOL_GROUPS, TEMPLATES }
