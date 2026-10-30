/**
 * Where the desktop App finds a distributor's settings (distribution.json)
 * and the licence token. No Electron here, so it can be tested with node.
 *
 * distribution.json (format: distribution.example.json), first match wins:
 *   1. $OPENLEX_DISTRIBUTION                (a path; set by a launcher or for testing)
 *   2. <userData>/distribution.json         (an installer or IT drops it there;
 *                                            userData is the "LexVault" settings folder:
 *                                            macOS ~/Library/Application Support/LexVault,
 *                                            Windows %APPDATA%\LexVault, Linux ~/.config/LexVault)
 *   3. <resources>/distribution.json        (built into a distributor's own installer,
 *                                            scripts/prepare-resources.js)
 *   none → community build: no licence, no update feed, no server downloads.
 *
 * Licence token: <userData>/token.txt (Settings → License writes it; an
 * installer may drop it there too — on the next start the App fetches the
 * signed licence with it). The signed licence: <userData>/license.json.
 * Neither is read from the environment.
 */
const fs = require('fs')
const path = require('path')

/** Candidate files in lookup order (missing entries left out). */
function distributionCandidates({ env = process.env, userData, resourcesPath, devDir } = {}) {
  return [
    env.OPENLEX_DISTRIBUTION ? { file: env.OPENLEX_DISTRIBUTION, from: 'env' } : null,
    userData ? { file: path.join(userData, 'distribution.json'), from: 'userData' } : null,
    resourcesPath ? { file: path.join(resourcesPath, 'distribution.json'), from: 'resources' } : null,
    devDir ? { file: path.join(devDir, 'distribution.json'), from: 'dev' } : null,
  ].filter(Boolean)
}

/**
 * Load the first readable distribution.json.
 * @returns {{ config: object, file: string|null, from: string|null }}
 *   config is {} for the community build.
 */
function loadDistribution(opts = {}) {
  const log = opts.log || ((m) => console.warn(m))
  for (const c of distributionCandidates(opts)) {
    let text
    try { text = fs.readFileSync(c.file, 'utf8') } catch {
      if (c.from === 'env') log(`[distribution] OPENLEX_DISTRIBUTION=${c.file} is not readable — looking further`)
      continue
    }
    try {
      const config = JSON.parse(text)
      if (config && typeof config === 'object' && !Array.isArray(config)) return { config, file: c.file, from: c.from }
      log(`[distribution] ${c.file} is not a JSON object — ignored`)
    } catch (err) {
      log(`[distribution] ${c.file} is not valid JSON (${err.message}) — ignored`)
    }
  }
  return { config: {}, file: null, from: null }
}

/** The licence/update/download server of a distribution, without a trailing slash, or null. */
function serverOf(config, env = process.env) {
  if (env.LEXVAULT_LICENSE_SERVER) return String(env.LEXVAULT_LICENSE_SERVER).replace(/\/+$/, '')
  return config && config.server ? String(config.server).replace(/\/+$/, '') : null
}

/** The stored licence token (<userData>/token.txt), or null. */
function readToken(userData) {
  try {
    const t = fs.readFileSync(path.join(userData, 'token.txt'), 'utf8').trim()
    return t || null
  } catch { return null }
}

module.exports = { distributionCandidates, loadDistribution, serverOf, readToken }
