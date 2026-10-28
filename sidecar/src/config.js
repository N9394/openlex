"use strict"
/**
 * Sidecar configuration.
 *
 * Everything is localhost by default. Outbound calls are the license check
 * (license.js) plus whatever the data policy allows (cloud model
 * providers, web sources, remote connectors) — each one audited.
 */

const path = require('path')
const os = require('os')

const ENV = process.env

// OpenLex rename: every LEXVAULT_* setting can also be given as OPENLEX_*
// (the old names keep working; an explicit LEXVAULT_* value wins).
for (const [k, v] of Object.entries(ENV)) {
  if (k.startsWith('OPENLEX_')) {
    const legacy = `LEXVAULT_${k.slice('OPENLEX_'.length)}`
    if (ENV[legacy] === undefined) ENV[legacy] = v
  }
}

// Tier registry model name (models.js picks the model's profile from it).
const LLM_MODEL_NAME = ENV.LEXVAULT_LLM_MODEL || 'lotus-2-reasoning-q4_k_m'

const DATA_DIR_RESOLVED = ENV.LEXVAULT_DATA_DIR || path.join(os.homedir(), '.lexvault')

/**
 * Which llama.cpp to talk to. When the desktop App is running (hub registry
 * run/app.json, live pid) its LLM proxy is the one to share — one model in
 * RAM for both. Installers pin LEXVAULT_LLM_URL to a private port so a
 * user's own Ollama on 11434 is never mistaken for ours; the registry is a
 * positive signal that the App (not a stranger) owns llmProxy.
 * LEXVAULT_LLM_URL_STRICT=1 disables the switch.
 */
function resolveLlmBase() {
  const pinned = ENV.LEXVAULT_LLM_URL || 'http://127.0.0.1:11434'
  if (ENV.LEXVAULT_LLM_URL_STRICT === '1') return pinned
  try {
    const reg = JSON.parse(require('fs').readFileSync(path.join(DATA_DIR_RESOLVED, 'run', 'app.json'), 'utf8'))
    let alive = false
    try { process.kill(reg.pid, 0); alive = true } catch (e) { alive = e.code === 'EPERM' }
    if (alive && reg.llmProxy) return reg.llmProxy
  } catch { /* App not running */ }
  return pinned
}

module.exports = {
  // HTTP API the Word add-in talks to
  PORT: parseInt(ENV.LEXVAULT_SIDECAR_PORT || '18001', 10),
  // Serve the add-in itself so the manifest SourceLocation works without
  // a separate web server. Office.js requires HTTPS except for localhost —
  // we ship a self-signed cert flow (scripts/gen-cert.sh) so the manifest
  // can always use https://localhost:18001.
  ADDIN_ROOT: ENV.LEXVAULT_ADDIN_ROOT || path.resolve(__dirname, '..', '..', 'add-in'),
  HTTPS_CERT: ENV.LEXVAULT_SIDECAR_CERT || path.join(os.homedir(), '.lexvault', 'certs', 'cert.pem'),
  HTTPS_KEY: ENV.LEXVAULT_SIDECAR_KEY || path.join(os.homedir(), '.lexvault', 'certs', 'key.pem'),

  // Local inference services (same layout/ports as the App supervisor)
  LLM_BASE: resolveLlmBase(), // llama.cpp (Ollama-compatible) — App's proxy when the App runs
  LLM_MODEL: LLM_MODEL_NAME, // tier registry name
  LLM_MODEL_NAME,
  QDRANT_BASE: ENV.LEXVAULT_QDRANT_URL || 'http://127.0.0.1:16333',
  QDRANT_COLLECTION: 'legal_chunks_local',

  // Platform tier for the local llama-server spawn (v3: apple/windows/linux).
  // Same registry (hardware-tiers.json) the App supervisor + license server
  // read. GPU layers auto-derived at spawn.
  TIER: ENV.LEXVAULT_TIER || (process.platform === 'darwin' ? 'apple' : process.platform === 'win32' ? 'windows' : 'linux'),

  // Analysis depth presets (8/16/32K — working budget == ctx). The user
  // picks one in the pane; persisted to ~/.lexvault/agent-config.json.
  // Four tiers: fast/balanced/deep/ultra map to ctx + hops. RAM-derived ctx
  // is the HARD floor (8K below 8GB, 16K on 8-16GB, 64K on 16GB+, 96K on
  // 32GB+) — the effective ctx is min(preset, RAM tier), enforced
  // identically by runtime.js (server spawn) and agent-config.js (client
  // budget), so the two can never disagree. KV is quantized
  // (iq4_nl-K/q4_0-V) so 64K ctx costs ~2-3GB.
  DEPTH_PRESETS: {
    fast:     { ctx: 8192,  hops: 2, label: 'Fast',     kvMiB: 256,  totalGiB: 3.0 },
    balanced: { ctx: 16384, hops: 5, label: 'Balanced', kvMiB: 512,  totalGiB: 3.2 },
    deep:     { ctx: 32768, hops: 6, label: 'Deep',     kvMiB: 1024, totalGiB: 4.2 },
    ultra:    { ctx: 65536, hops: 6, label: 'Ultra',    kvMiB: 2048, totalGiB: 5.8 },
  },
  DEFAULT_DEPTH: 'balanced',

  // RAM-derived context floor (hard cap for the current machine).
  ramCtxFor(ramGB) {
    if (ramGB >= 32) return 98304  // 96K — big servers / 32GB+ ARM
    if (ramGB >= 16) return 65536  // 64K — 16GB ARM, modern laptops
    if (ramGB >= 8) return 16384   // 16K — 8GB machines
    return 8192                    // 8K — weak / <8GB machines
  },

  // The one phone-home. Same endpoint the launcher uses.
  // No built-in server: a distributor's distribution.json (distribution.js)
  // or LEXVAULT_LICENSE_URL sets it; none = community build.
  LICENSE_URL: ENV.LEXVAULT_LICENSE_URL || require('./distribution').load(DATA_DIR_RESOLVED)?.licenseUrl || null,
  LICENSE_PUBLIC_KEY_PATH: ENV.LEXVAULT_LICENSE_KEY_PATH || null,
  LICENSE_CHECK_INTERVAL_MS: 6 * 60 * 60 * 1000, // every 6h
  OFFLINE_GRACE_MS: 30 * 24 * 60 * 60 * 1000, // matches license-server OFFLINE_GRACE_DAYS=30

  // Local data dir — override in tests (LEXVAULT_DATA_DIR) or package
  // installers; defaults to the shared ~/.lexvault so full-version clients
  // share packs/models/license with the plugin automatically.
  DATA_DIR: DATA_DIR_RESOLVED,

  // Local data dirs — same userData the launcher/App use, so full-version
  // clients share packs/models/license with the plugin automatically.
  USERDATA_DIRS: [
    path.join(os.homedir(), 'Library', 'Application Support', 'lexvault-launcher'), // macOS launcher
    path.join(os.homedir(), 'Library', 'Application Support', 'LexVault'), // macOS app
    path.join(os.homedir(), 'Library', 'Application Support', 'lexvault-word-sidecar'), // macOS standalone
    path.join(process.env.APPDATA || '', 'lexvault-launcher'), // Windows launcher
    path.join(process.env.APPDATA || '', 'LexVault'), // Windows app
    path.join(process.env.APPDATA || '', 'lexvault-word-sidecar'), // Windows standalone
    path.join(os.homedir(), '.lexvault'), // fallback
  ].filter(Boolean),

  // Agent budget (spec §4): 8K working context, ≤3 tool hops per action
  AGENT: {
    MAX_HOPS: 3,
    CTX_BUDGET_TOKENS: 8192,
    GENERATION_MAX_TOKENS: 600,
    // Suggestion JSON is verbose (reasoning + explanation + citation +
    // recommended_change per suggestion) — 1200 tokens truncated it
    // mid-object, which silently killed all suggestions. 2400 fits
    // ~4 rich suggestions in one shot. 6000 additionally fits FULL-CLAUSE
    // rewrites: proposed_text carries the entire replacement clause text.
    WRITE_MAX_TOKENS: 6000,
    // Native thinking — bounded SERVER-side via llama-server
    // `--reasoning-budget N` (bundled b10353+): Lotus never emits its own
    // end-of-thought tag, so the budget must be injected by llama.cpp
    // (client-side /chat/completions/control is ineffective — requires
    // `reasoning_control: true` per request AND the server to honour it;
    // verified 2026-08-11: control fires but the completion keeps thinking
    // until max_tokens with empty content). runtime.js passes the budget;
    // the client keeps onReasoning for the pane trace. Verified 2026-08-11:
    // budget 120 cuts thinking and content follows — but costs ~10-12s per
    // call on 8GB M1 (120 thinking tokens @ ~10 t/s). INLINE_REASONING
    // (default true) skips native thinking and relies on the JSON
    // "reasoning" field Lotus was fine-tuned for: ~5s per call, no trace.
    // Whether a model thinks natively or inline is now its profile's
    // `thinking` field (models.js), not a check on the model name.
    REASONING_MAX_TOKENS: 64,
    // Native-thinking hard stop injected by llama-server --reasoning-budget
    // (b10353+ only). 400 tokens ≈ 1,600 chars — generous on purpose: the
    // user prefers long, thorough thinking over speed (2026-08-16). The
    // 200-token cut made things snappier but shallower; reverted. Hops run
    // thinking:false anyway (bookkeeping needs no analysis). NEVER fully
    // uncap — unbudgeted Lotus monologues 32K tokens and truncates the
    // JSON (the 2026-08-11 failure class).
    THINKING_BUDGET: 400,
  },

  // Context compression thresholds
  COMPRESS: {
    SECTION_MAX_CHARS: 2000,
    LAW_DIGEST_SENTENCES: 2,
  },
}
