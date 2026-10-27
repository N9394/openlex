"use strict"
/**
 * Routing map — which model handles which role.
 *
 *   "routes": {
 *     "roles":    { "plan": "anthropic", "write": "anthropic:claude-opus-5-5", "judge": "local", "translate": "mistral" },
 *     "rules":    [
 *       { "when": { "privileged": true }, "use": "local" },
 *       { "when": { "role": "write", "minChars": 60000 }, "use": "vertex:gemini-3-pro" },
 *       { "when": { "matters": ["<matterId>"] }, "use": ["azure", "local"] }
 *     ],
 *     "fallback": ["local"]
 *   }
 *
 * Roles: plan, analyze, write, judge, extract, translate, summarize, draft.
 * A target is "<provider>" or "<provider>:<model>" (catalog ids: local,
 * anthropic, openai, azure, mistral, openrouter, bedrock, vertex, custom).
 *
 * Candidate order for a call: the first matching rule's targets, then the
 * active agent profile's route for the role (agents.js), then the role's target, then the active provider (Settings), then the fallback
 * list. llm.js walks the candidates in order: the data policy and missing
 * keys skip a candidate, and a failed call (network, 5xx, rate limit)
 * moves on to the next one before anything was streamed. With no routes
 * configured the only candidate is the active provider, exactly as before.
 *
 * Rule conditions (all given ones must match): role (string or list),
 * matters (ids), privileged (bool), minChars / maxChars (prompt size),
 * policy ("local-only" | "allow-list").
 */

const settings = require('./providers/settings')
const { PROVIDERS } = require('./providers/catalog')

const ROLES = ['plan', 'analyze', 'write', 'judge', 'extract', 'translate', 'summarize', 'draft']
// Agent-loop phases → roles (agent.js passes phase, not role).
const PHASE_ROLE = { planning: 'plan', analyzing: 'analyze', writing: 'write' }

function parseTarget(t) {
  const s = String(t || '').trim()
  if (!s) return null
  const i = s.indexOf(':')
  const id = i < 0 ? s : s.slice(0, i)
  const model = i < 0 ? null : s.slice(i + 1).trim() || null
  if (!PROVIDERS[id]) throw new Error(`routing: unknown provider "${id}" in "${s}" (known: ${Object.keys(PROVIDERS).join(', ')})`)
  return { id, model }
}

const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v])

/** Validate a routes section; returns a list of problems (empty = fine). */
function validate(routes = {}) {
  const problems = []
  const check = (t, where) => { try { parseTarget(t) } catch (err) { problems.push(`${where}: ${err.message}`) } }
  for (const [role, t] of Object.entries(routes.roles || {})) {
    if (!ROLES.includes(role)) problems.push(`roles: unknown role "${role}" (${ROLES.join(', ')})`)
    asList(t).forEach((x) => check(x, `roles.${role}`))
  }
  asList(routes.rules).forEach((r, i) => {
    if (!r || typeof r !== 'object' || !r.use) { problems.push(`rules[${i}]: needs "use"`); return }
    asList(r.use).forEach((x) => check(x, `rules[${i}].use`))
    for (const k of Object.keys(r.when || {})) if (!['role', 'matters', 'privileged', 'minChars', 'maxChars', 'policy'].includes(k)) problems.push(`rules[${i}].when: unknown condition "${k}"`)
    for (const role of asList(r.when?.role)) if (!ROLES.includes(role)) problems.push(`rules[${i}].when.role: unknown role "${role}"`)
  })
  asList(routes.fallback).forEach((x) => check(x, 'fallback'))
  return problems
}

function matches(when = {}, ctx) {
  if (when.role !== undefined && !asList(when.role).includes(ctx.role)) return false
  if (when.matters !== undefined && !asList(when.matters).includes(ctx.matterId)) return false
  if (when.privileged !== undefined && !!when.privileged !== !!ctx.privileged) return false
  if (when.minChars !== undefined && !(ctx.chars >= Number(when.minChars))) return false
  if (when.maxChars !== undefined && !(ctx.chars <= Number(when.maxChars))) return false
  if (when.policy !== undefined && when.policy !== ctx.policyMode) return false
  return true
}

function context({ role, phase, matterId, chars = 0 } = {}) {
  const r = role || PHASE_ROLE[phase] || null
  let privileged = false
  let policyMode = null
  try { privileged = !!(matterId && require('./matters').get(matterId)?.privileged) } catch { /* unknown matter */ }
  try { policyMode = require('./policy').ruleFor(matterId).mode } catch { /* default */ }
  return { role: r, matterId: matterId || null, chars, privileged, policyMode }
}

/**
 * Ordered, de-duplicated provider candidates for one call.
 * @returns {Array<{provider: object, reason: string}>}
 */
function candidates(opts = {}) {
  const routes = require('./harness').load().routes || {}
  const ctx = context(opts)
  const out = []
  const seen = new Set()
  const add = (t, reason) => {
    let pt
    try { pt = parseTarget(t) } catch { return } // invalid targets are reported by validate(), never fatal
    if (!pt) return
    const key = `${pt.id}:${pt.model || ''}`
    if (seen.has(key)) return
    seen.add(key)
    const p = settings.resolve(pt.id)
    out.push({ provider: pt.model ? { ...p, model: pt.model } : p, reason })
  }
  const rules = asList(routes.rules)
  const hit = rules.findIndex((r) => r && r.use && matches(r.when, ctx))
  if (hit >= 0) asList(rules[hit].use).forEach((t) => add(t, `rule ${hit + 1}`))
  const agent = require('./agents').current()
  if (agent && ctx.role) asList(agent.routes?.[ctx.role]).forEach((t) => add(t, `agent ${agent.name}`))
  if (ctx.role) asList(routes.roles?.[ctx.role]).forEach((t) => add(t, `role ${ctx.role}`))
  add(settings.load().active, 'active provider')
  asList(routes.fallback).forEach((t) => add(t, 'fallback'))
  return out
}

/** The first candidate (what a call would try first) — for concurrency decisions and display. */
function primary(opts = {}) {
  return candidates(opts)[0]?.provider || settings.resolve()
}

/** Does any role, rule or fallback route to the local model? (Decides whether to start llama.cpp.) */
function usesLocal() {
  const routes = require('./harness').load().routes || {}
  const targets = [settings.load().active, ...Object.values(routes.roles || {}).flatMap(asList), ...asList(routes.rules).flatMap((r) => asList(r?.use)), ...asList(routes.fallback)]
  return targets.some((t) => { try { const pt = parseTarget(t); return pt && settings.resolve(pt.id).kind === 'local' } catch { return false } })
}

/**
 * Explain the route for every role (or one context): candidates with
 * the data policy's verdict on each. Used by the map UI and `openlex map`.
 */
function explain({ matterId = null, chars = 0, agent = null } = {}) {
  if (agent) return require('./agents').run(require('./agents').get(agent), () => explain({ matterId, chars }))
  const policy = require('./policy')
  return ROLES.map((role) => ({
    role,
    candidates: candidates({ role, matterId, chars }).map(({ provider, reason }) => {
      const d = policy.check(provider, matterId)
      return { provider: provider.id, model: provider.model || null, local: !!provider.local, reason, allowed: d.allowed, ...(d.allowed ? {} : { blocked: d.reason }) }
    }),
  }))
}

module.exports = { ROLES, PHASE_ROLE, parseTarget, validate, candidates, primary, usesLocal, explain, context }
