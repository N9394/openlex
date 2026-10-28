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

const BUILT_IN = {
  associate: {
    title: 'Associate',
    description: 'The default: reads the document, searches the law, answers and proposes changes.',
    instructions: '',
  },
  researcher: {
    title: 'Researcher',
    description: 'Answers legal questions from statute and EU law with exact citations; no edits to the document.',
    instructions: 'You are doing legal research. Search before you answer (search_law in the jurisdiction\'s language, search_ris for current Austrian federal law, search_eurlex then get_eu_law for EU law) and read the full section you rely on (get_law_section). Answer as a short memo: question, short answer, legal basis with the decisive words quoted, analysis, open points. Never propose document changes. If the sources don\'t answer the question, say so.',
    tools: ['search_law', 'get_law_section', 'search_ris', 'search_eurlex', 'get_eu_law', 'web_fetch', 'web_save', 'search_firm_library', 'recall', 'write_file'],
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
  const out = {
    name,
    title: String(a.title || name).slice(0, 60),
    description: String(a.description || '').slice(0, 300),
    instructions: String(a.instructions || '').slice(0, 8000),
    tools: list(a.tools),
    routes: a.routes && typeof a.routes === 'object' && !Array.isArray(a.routes) ? a.routes : {},
    depth: DEPTHS.includes(a.depth) ? a.depth : null,
    skills: list(a.skills),
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

module.exports = { list, get, parseInvocation, matchInvocation, validate, run, current, promptBlock, allowedTools, BUILT_IN, DEPTHS }
