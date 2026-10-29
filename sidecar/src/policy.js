"use strict"
/**
 * Data policy + audit log — where client data is allowed to go.
 *
 * Policy file (~/.lexvault/policy.json):
 *   {
 *     "default": { "mode": "local-only" },
 *     "matters": {
 *       "<matterId>": { "mode": "allow-list", "providers": ["anthropic", "azure"] }
 *     }
 *   }
 *
 * Modes:
 *   local-only — only providers with local:true (default — privacy first)
 *   allow-list — local providers plus the listed cloud providers
 *
 * Every model call is checked BEFORE any byte leaves the machine and is
 * written to the audit log (~/.lexvault/audit/llm-calls.jsonl) — metadata
 * only (provider, model, matter, sizes, decision), never prompt content.
 * Each line is chained to the one before it (chain.js: `prev` + `h`), so a
 * changed, removed or moved line shows up in the AI record's check
 * (record.js). A line written during a request carries the request's `rid`
 * (withRequest), which links it to the activity record of that request.
 *
 * The active matter rides on AsyncLocalStorage (withMatter), so the agent
 * loop doesn't have to thread it through every call; so does an optional
 * observer of model calls (observeModels → the `model` event).
 */

const fs = require('fs')
const path = require('path')
const { AsyncLocalStorage } = require('async_hooks')
const { DATA_DIR } = require('./config')

const POLICY_PATH = path.join(DATA_DIR, 'policy.json')
const AUDIT_PATH = path.join(DATA_DIR, 'audit', 'llm-calls.jsonl')
const MODES = ['local-only', 'allow-list']
const DEFAULT_POLICY = { default: { mode: 'local-only' }, matters: {} }

const matterStore = new AsyncLocalStorage()

function cleanRule(rule) {
  if (!rule || !MODES.includes(rule.mode)) throw new Error(`policy mode must be one of: ${MODES.join(', ')}`)
  const out = { mode: rule.mode }
  if (rule.mode === 'allow-list') {
    out.providers = Array.isArray(rule.providers) ? rule.providers.filter((p) => typeof p === 'string') : []
  }
  // Pseudonymise client names/identifiers before cloud calls (redact.js).
  if (rule.redact) out.redact = true
  // Approved regions: cloud calls only where the provider is pinned to one
  // of these (prefix match — "eu" covers eu-central-1 and europe-west1).
  if (Array.isArray(rule.regions)) {
    const regions = rule.regions.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim().toLowerCase())
    if (regions.length) out.regions = regions
  }
  return out
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))
    const matters = {}
    for (const [id, rule] of Object.entries(saved.matters || {})) {
      try { matters[id] = cleanRule(rule) } catch { /* drop invalid rule */ }
    }
    let def
    try { def = cleanRule(saved.default) } catch { def = DEFAULT_POLICY.default }
    return { default: def, matters }
  } catch {
    return { default: { ...DEFAULT_POLICY.default }, matters: {} }
  }
}

function save(policy) {
  const clean = { default: cleanRule(policy.default), matters: {} }
  for (const [id, rule] of Object.entries(policy.matters || {})) clean.matters[id] = cleanRule(rule)
  fs.mkdirSync(path.dirname(POLICY_PATH), { recursive: true })
  fs.writeFileSync(POLICY_PATH, JSON.stringify(clean, null, 2))
  return clean
}

/** Set the rule for one matter (or the default when matterId is null). */
function setRule(matterId, rule) {
  const p = load()
  const clean = cleanRule(rule)
  // Privileged matters stay on this machine: loosening one means unmarking it first.
  if (matterId && clean.mode !== 'local-only' && require('./matters').get(matterId)?.privileged) {
    throw new Error('this matter is privileged and stays on this machine; unmark it as privileged first')
  }
  if (matterId) p.matters[matterId] = clean
  else p.default = clean
  return save(p)
}

function ruleFor(matterId) {
  const p = load()
  return (matterId && p.matters[matterId]) || p.default
}

/**
 * Is this provider allowed for this matter?
 * @param {{id:string, local:boolean}} provider resolved descriptor
 * @returns {{allowed:boolean, reason:string, rule:object}}
 */
function check(provider, matterId) {
  const rule = ruleFor(matterId)
  if (provider.local) return { allowed: true, reason: 'local provider', rule }
  if (rule.mode === 'allow-list' && rule.providers.includes(provider.id)) {
    if (rule.regions && !regionAllowed(rule.regions, provider.region)) {
      return {
        allowed: false,
        reason: provider.region
          ? `${provider.id} runs in ${provider.region}, outside the approved regions (${rule.regions.join(', ')})`
          : `${provider.id} has no pinned region; the policy only allows ${rule.regions.join(', ')}`,
        rule,
      }
    }
    return { allowed: true, reason: `allow-listed for ${matterId ? 'matter' : 'default policy'}`, rule }
  }
  return {
    allowed: false,
    reason: rule.mode === 'local-only'
      ? `data policy is local-only${matterId ? ` for matter ${matterId}` : ''} — ${provider.id} would send data off this machine`
      : `${provider.id} is not on the allow-list${matterId ? ` for matter ${matterId}` : ''}`,
    rule,
  }
}

function regionAllowed(regions, region) {
  const r = String(region || '').toLowerCase()
  return !!r && regions.some((a) => r === a || r.startsWith(a))
}

function withMatter(matterId, fn) {
  // Keeps a model observer set by an outer observeModels().
  return matterStore.run({ ...(matterStore.getStore() || {}), matterId: matterId || null }, fn)
}

/**
 * Call `onModel` once per model call made inside `fn` (front ends show
 * where the data went: which service, local or cloud, region, names
 * hidden). Metadata only — never content.
 */
function observeModels(onModel, fn) {
  return matterStore.run({ ...(matterStore.getStore() || {}), onModel }, fn)
}

/** llm.js: report one model call to the observer of this request, if any. */
function reportModel(info) {
  try { matterStore.getStore()?.onModel?.(info) } catch { /* observers must not break a call */ }
}

/** Run `fn` as part of one request (activity.js): audit lines inside it carry `rid`. */
function withRequest(rid, fn) {
  return matterStore.run({ ...(matterStore.getStore() || {}), rid: rid || null }, fn)
}

function currentMatter() {
  return matterStore.getStore()?.matterId || null
}

function audit(entry) {
  try {
    const rid = matterStore.getStore()?.rid
    require('./chain').append(AUDIT_PATH, { ts: new Date().toISOString(), ...entry, ...(rid && !entry.rid ? { rid } : {}) })
  } catch (err) {
    console.warn('[policy] audit write failed:', err.message)
  }
}

module.exports = { load, save, setRule, ruleFor, check, withMatter, withRequest, observeModels, reportModel, currentMatter, audit, POLICY_PATH, AUDIT_PATH, MODES }
