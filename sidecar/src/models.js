"use strict"
/**
 * Model profiles: what the harness needs to know about a model to drive
 * it well, looked up by the model's name instead of hard-coded checks.
 *
 *   thinking      native  the model thinks in its own trace when a call asks for it
 *                 inline  no native thinking; a one-line "reasoning" field in the tool JSON
 *                 off     never think (plain answers only)
 *   tools         native  the provider's tool-calling API (hosted models)
 *                 json    the text-JSON tool protocol in the system prompt
 *   temperature   number, or null to never send one (models that reject it)
 *   ctx           context window to budget against (null: provider / RAM tier decides)
 *   maxOutput     cap on output tokens per call (null: the call decides)
 *   thinkingBudget  local only: llama-server --reasoning-budget tokens
 *   instructions  extra system-prompt lines for this model (quirks, format reminders)
 *   prompts       staged  instructions arrive at the turn that needs them (prompts.js)
 *                 all     every instruction block on every call (models tuned on the old prompt)
 *
 * Profiles come from the built-ins below and from the harness map
 * (openlex.json → "models"). A map entry with a built-in's name changes
 * that built-in field by field; a new name adds a profile, tried before
 * the built-ins. The first profile whose `match` fits the model name
 * (case-insensitive regular expressions) and whose `kind` fits the
 * provider wins; otherwise the generic local or hosted profile applies.
 */

const BUILTIN = {
  'lotus-2': {
    kind: 'local', match: ['lotus-2'],
    thinking: 'native', tools: 'json', thinkingBudget: 400, prompts: 'all',
    notes: 'Lotus 2: thinking trained in, closes its own trace; single tool call per hop. Gets every prompt block at once until a LegalBench run confirms staged prompts.',
  },
  lotus: {
    kind: 'local', match: ['lotus'],
    thinking: 'inline', tools: 'json', prompts: 'all',
    notes: 'Lotus 1: fine-tuned on inline reasoning only; native thinking runs away.',
  },
  'qwen3-local': {
    kind: 'local', match: ['qwen3'],
    thinking: 'inline', tools: 'json', thinkingBudget: 400,
    notes: 'Qwen3 / 3.5 GGUFs: native thinking is unbounded without --reasoning-budget; inline is the safe default.',
  },
  'openai-reasoning': {
    kind: 'hosted', match: ['^(openai/)?o\\d', '^(openai/)?gpt-5'],
    thinking: 'native', tools: 'native', temperature: null,
    notes: 'OpenAI reasoning models reject a temperature.',
  },
  claude: {
    kind: 'hosted', match: ['claude'],
    thinking: 'native', tools: 'native',
  },
  'deepseek-reasoner': {
    kind: 'hosted', match: ['deepseek-r1', 'deepseek-reasoner'],
    thinking: 'native', tools: 'json', temperature: null,
    notes: 'R1-style models: weak native tool calling; the JSON protocol is more reliable.',
  },
  'small-hosted': {
    kind: 'hosted', match: ['(^|[/:_-])(1|2|3|4|7|8|9)b\\b', 'mini\\b', 'nano\\b', 'haiku'],
    thinking: 'native', tools: 'native',
    instructions: 'Keep each tool call to one JSON object. Quote the document verbatim when you cite it.',
    notes: 'Small hosted models: same protocol, tighter reminders.',
  },
}

const GENERIC = {
  local: { name: 'generic-local', kind: 'local', match: [], thinking: 'inline', tools: 'json', temperature: undefined, ctx: null, maxOutput: null, thinkingBudget: 400, instructions: '', prompts: 'staged' },
  hosted: { name: 'generic-hosted', kind: 'hosted', match: [], thinking: 'native', tools: 'native', temperature: undefined, ctx: null, maxOutput: null, thinkingBudget: null, instructions: '', prompts: 'staged' },
}

const THINKING = ['native', 'inline', 'off']
const TOOLS = ['native', 'json']

/** Validate one profile from the harness map; returns a list of problems. */
function check(name, p) {
  const out = []
  if (!p || typeof p !== 'object' || Array.isArray(p)) return [`${name}: must be an object`]
  if (p.match !== undefined && !Array.isArray(p.match)) out.push(`${name}: match must be a list of patterns`)
  for (const m of Array.isArray(p.match) ? p.match : []) { try { new RegExp(m, 'i') } catch { out.push(`${name}: bad pattern ${JSON.stringify(m)}`) } }
  if (p.kind !== undefined && !['local', 'hosted', 'any'].includes(p.kind)) out.push(`${name}: kind must be local, hosted or any`)
  if (p.thinking !== undefined && !THINKING.includes(p.thinking)) out.push(`${name}: thinking must be ${THINKING.join(', ')}`)
  if (p.tools !== undefined && !TOOLS.includes(p.tools)) out.push(`${name}: tools must be ${TOOLS.join(' or ')}`)
  if (p.prompts !== undefined && !['staged', 'all'].includes(p.prompts)) out.push(`${name}: prompts must be staged or all`)
  for (const k of ['ctx', 'maxOutput', 'thinkingBudget']) if (p[k] != null && !(Number.isInteger(p[k]) && p[k] > 0)) out.push(`${name}: ${k} must be a positive whole number`)
  if (p.temperature != null && !(typeof p.temperature === 'number' && p.temperature >= 0 && p.temperature <= 2)) out.push(`${name}: temperature must be 0–2 or null`)
  return out
}

/** All profiles in lookup order: map-defined new names first, then built-ins (with map changes applied). */
function all() {
  let custom = {}
  try { custom = require('./harness').load().models || {} } catch { custom = {} }
  const list = []
  for (const [name, p] of Object.entries(custom)) {
    if (BUILTIN[name] || check(name, p).length) continue
    list.push({ name, origin: 'map', ...p })
  }
  for (const [name, p] of Object.entries(BUILTIN)) {
    const over = custom[name] && !check(name, custom[name]).length ? custom[name] : null
    list.push({ name, origin: over ? 'built-in+map' : 'built-in', ...p, ...(over || {}) })
  }
  return list
}

function fits(p, kind, model) {
  if (p.kind && p.kind !== 'any' && p.kind !== kind) return false
  const name = String(model || '')
  return (p.match || []).some((m) => { try { return new RegExp(m, 'i').test(name) } catch { return false } })
}

/**
 * The profile for a model.
 * @param {{kind?: string, model?: string}} target  a provider (kind 'local' or a hosted kind) and model name
 */
function profileFor(target = {}) {
  const kind = target.kind === 'local' ? 'local' : 'hosted'
  // The local provider usually carries no model name: use the configured GGUF.
  const model = target.model || (kind === 'local' ? require('./local_models').currentName() : null)
  const hit = all().find((p) => fits(p, kind, model))
  return { ...GENERIC[kind], ...(hit || {}), model: model || null }
}

/** The profile for the local model (the configured or served GGUF name). */
function forLocal(model) {
  return profileFor({ kind: 'local', model })
}

/** Problems in a "models" section (the map, or a value about to be saved). */
function validate(section) {
  if (section == null) return []
  if (typeof section !== 'object' || Array.isArray(section)) return ['models: must be an object of named profiles']
  return Object.entries(section).flatMap(([n, p]) => [
    ...check(n, p),
    ...(!BUILTIN[n] && !(Array.isArray(p?.match) && p.match.length) ? [`${n}: a new profile needs a "match" list`] : []),
  ])
}

/** What each role's first-choice model gets: provider, model, profile. */
function explain({ matterId = null, agent = null } = {}) {
  const routing = require('./routing')
  return routing.ROLES.map((role) => {
    const p = routing.primary({ role, matterId, agent })
    const prof = profileFor({ kind: p.local ? 'local' : p.kind, model: p.model })
    return { role, provider: p.id, model: prof.model, profile: prof.name, thinking: prof.thinking, tools: prof.tools }
  })
}

module.exports = { profileFor, forLocal, all, validate, explain, check, BUILTIN, GENERIC }
