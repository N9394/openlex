"use strict"
/**
 * Distribution settings — who ships this build, and where its licence,
 * update and download server is. The open-source code has no built-in
 * server: without a distribution file this is the community build
 * (no licence check, no update feed, no server downloads; models and law
 * packs are added locally, cloud models use your own keys).
 *
 * A distributor ships a distribution.json next to the engine:
 *
 *   {
 *     "name": "Acme Legal OpenLex",
 *     "server": "https://downloads.example.com",       // base for licence, updates, packs, models
 *     "licenseUrl": "https://…/api/app/license",       // optional, default <server>/api/app/license
 *     "accountUrl": "https://…/account",                // where users manage subscriptions
 *     "downloadUrl": "https://…/download",
 *     "supportUrl": "https://…/support"
 *   }
 *
 * Looked up in order: $OPENLEX_DISTRIBUTION, <sidecar>/distribution.json,
 * <install root>/distribution.json, <data dir>/distribution.json.
 */

const fs = require('fs')
const path = require('path')

let cached

function load(dataDir) {
  if (cached !== undefined) return cached
  const candidates = [
    process.env.OPENLEX_DISTRIBUTION,
    path.join(__dirname, 'distribution.json'), // plugin update payloads carry it inside src/
    path.join(__dirname, '..', 'distribution.json'),
    path.join(__dirname, '..', '..', 'distribution.json'),
    dataDir ? path.join(dataDir, 'distribution.json') : null,
  ].filter(Boolean)
  cached = null
  for (const file of candidates) {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'))
      const server = d.server ? String(d.server).replace(/\/+$/, '') : null
      cached = {
        file,
        name: d.name ? String(d.name) : null,
        server,
        licenseUrl: d.licenseUrl || (server ? `${server}/api/app/license` : null),
        accountUrl: d.accountUrl || (server ? `${server}/account` : null),
        downloadUrl: d.downloadUrl || (server ? `${server}/download` : null),
        supportUrl: d.supportUrl || null,
      }
      break
    } catch { /* not there or not JSON: try the next */ }
  }
  return cached
}

function community() {
  return !load()?.licenseUrl
}

module.exports = { load, community }
