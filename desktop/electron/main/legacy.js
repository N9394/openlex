'use strict'
/**
 * The old desktop server (desktop/server: accounts, /docs, Vault, Audit,
 * Investigate, Workshop, M&A) is OFF by default. Its features moved into the
 * chat on the OpenLex engine (/analyse, /investigate, /diligence, /draft,
 * Saved, the AI record, the app's search). The code stays in the repository
 * for now; nothing in the app calls it.
 *
 * Switch it on for a comparison or a migration only:
 *   OPENLEX_LEGACY_SERVER=1   (on: 1, true, on, yes)
 *
 * Pure functions (no Electron), so the decision is unit-tested.
 */

/** Should the app start the old desktop server? */
function legacyServerWanted(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.OPENLEX_LEGACY_SERVER || '').trim())
}

/** The window's query string: the old server's address only when it runs. */
function windowSearch(backendUrl) {
  return backendUrl ? `backend=${encodeURIComponent(backendUrl)}` : ''
}

module.exports = { legacyServerWanted, windowSearch }
