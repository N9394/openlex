"use strict"
/**
 * Analysis depth + agent settings persistence (~/.lexvault/agent-config.json).
 * The pane writes via POST /api/config/agent; runtime.js + agent.js read it.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { DATA_DIR, DEPTH_PRESETS, DEFAULT_DEPTH, ramCtxFor } = require('./config')

const CONFIG_PATH = path.join(DATA_DIR, 'agent-config.json')

const DEFAULTS = {
  depth: DEFAULT_DEPTH,
  applyMode: 'tracked', // 'tracked' (default) | 'permanent'
  autopilot: false, // Batch 3: apply suggestions silently (tracked) instead of approval cards
  workspace: undefined, // workspace base folder (undefined → ~/LexVault, kept for existing installs)
  calendar: { enabled: false, provider: 'auto' }, // calendar integration (Batch W3)
  localMemoryGB: null, // memory for the local AI (null = automatic)
  maxFileMB: null, // file size limit (null = 100 MB)
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return {
      depth: DEPTH_PRESETS[saved.depth] ? saved.depth : DEFAULTS.depth,
      applyMode: saved.applyMode === 'permanent' ? 'permanent' : 'tracked',
      autopilot: !!saved.autopilot,
      workspace: typeof saved.workspace === 'string' ? saved.workspace : undefined,
      calendar: saved.calendar && typeof saved.calendar === 'object' ? saved.calendar : DEFAULTS.calendar,
      // Memory for the local AI (local_memory.js): GB, or null = automatic.
      localMemoryGB: Number(saved.localMemoryGB) > 0 ? Number(saved.localMemoryGB) : null,
      // The one file size limit (limits.js), in MB; null = 100 MB.
      maxFileMB: Number(saved.maxFileMB) > 0 ? Number(saved.maxFileMB) : null,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(partial) {
  const next = { ...load(), ...partial }
  if (partial.depth && !DEPTH_PRESETS[partial.depth]) throw new Error(`unknown depth: ${partial.depth}`)
  if (partial.applyMode && !['tracked', 'permanent'].includes(partial.applyMode)) throw new Error(`unknown applyMode: ${partial.applyMode}`)
  if (partial.autopilot !== undefined) next.autopilot = !!partial.autopilot
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2))
  return next
}

/** Effective agent budget from the selected depth preset. */
function agentBudget() {
  // An active agent profile (agents.js) may set its own depth.
  const depth = require('./agents').current()?.depth || load().depth
  const p = DEPTH_PRESETS[depth]
  return { depth, ctx: p.ctx, hops: p.hops }
}

/**
 * Effective AGENT settings (ctx budget + max hops) for llm.js / agent.js.
 * Reads the persisted depth preset so a Settings change applies without
 * restarting the module graph. The ctx budget is CAPPED by the RAM tier
 * (ramCtxFor) — identical rule to runtime.js's server spawn, so the client
 * budget can never exceed the llama-server's num_ctx (truncation guard).
 */
const CLOUD_HOPS = { fast: 3, balanced: 6, deep: 8, ultra: 12 }

function effectiveAgent() {
  const { depth, ctx, hops } = agentBudget()
  // Cloud providers: the RAM tier and local KV math don't apply — budget
  // against the provider's context window (user override wins).
  // The model the routing map would use for planning (agent profile, rules, roles, active provider).
  const provider = require('./routing').primary({ role: 'plan', matterId: require('./policy').currentMatter() })
  // Hosted models also get more tool hops and wall-clock per depth: the
  // local limits are sized for a 4B model on a laptop.
  const profile = require('./models').profileFor({ kind: provider.kind, model: provider.model })
  if (provider.kind !== 'local') {
    return {
      CTX_BUDGET_TOKENS: profile.ctx || provider.ctx || 32768,
      MAX_HOPS: CLOUD_HOPS[depth] || hops,
      HOP_TIMEOUT_MS: 240000,
      DEPTH: depth,
      PROVIDER: provider.id,
    }
  }
  const ramCtx = ramCtxFor(os.totalmem() / 1024 / 1024 / 1024)
  // "Memory for the local AI" (local_memory.js), when the lawyer set it, decides the context size.
  const chosen = require('./local_memory').chosenCtx()
  return { CTX_BUDGET_TOKENS: chosen ? Math.min(chosen, profile.ctx || Infinity) : Math.min(ctx, ramCtx, profile.ctx || Infinity), MAX_HOPS: hops, HOP_TIMEOUT_MS: 90000, DEPTH: depth, PROVIDER: 'local' }
}

module.exports = { load, save, agentBudget, effectiveAgent, CONFIG_PATH, DEFAULTS }
