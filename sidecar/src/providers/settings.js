"use strict"
/**
 * Provider settings (~/.lexvault/providers.json): which provider/model is
 * active plus per-provider overrides (baseUrl, model, ctx, local flag for
 * custom endpoints). API keys are NEVER stored here — see secrets.js.
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('../config')
const { PROVIDERS, getProvider } = require('./catalog')

const SETTINGS_PATH = path.join(DATA_DIR, 'providers.json')

const DEFAULTS = { active: 'local', overrides: {} }

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
    return {
      active: PROVIDERS[saved.active] ? saved.active : DEFAULTS.active,
      overrides: saved.overrides && typeof saved.overrides === 'object' ? saved.overrides : {},
    }
  } catch {
    return { ...DEFAULTS, overrides: {} }
  }
}

function save(next) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2))
  return next
}

const OVERRIDE_FIELDS = ['baseUrl', 'model', 'ctx', 'local', 'apiVersion', 'nativeTools', 'region', 'project']

/** Set the active provider and/or merge overrides for one provider. */
function update({ active, provider, overrides } = {}) {
  const cur = load()
  if (active !== undefined) {
    getProvider(active) // throws on unknown
    cur.active = active
  }
  if (provider && overrides) {
    getProvider(provider)
    const clean = {}
    for (const k of OVERRIDE_FIELDS) if (overrides[k] !== undefined) clean[k] = overrides[k]
    if (clean.baseUrl !== undefined && clean.baseUrl !== null) {
      const u = new URL(clean.baseUrl) // throws on garbage
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('baseUrl must be http(s)')
      clean.baseUrl = clean.baseUrl.replace(/\/+$/, '')
    }
    if (clean.ctx !== undefined) clean.ctx = Math.max(2048, parseInt(clean.ctx, 10) || 0)
    // Only custom endpoints may declare themselves local; a hosted API is
    // never local no matter what the settings file says.
    if (clean.local !== undefined) {
      if (provider !== 'custom') delete clean.local
      else clean.local = !!clean.local
    }
    cur.overrides[provider] = { ...(cur.overrides[provider] || {}), ...clean }
  }
  return save(cur)
}

/** Resolved descriptor for a provider: catalog defaults + user overrides. */
function resolve(id) {
  const { active, overrides } = load()
  const pid = id || active
  const base = getProvider(pid)
  return { ...base, ...(overrides[pid] || {}), id: pid }
}

module.exports = { load, update, resolve, SETTINGS_PATH }
