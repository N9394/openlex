/**
 * OpenLex engine for the desktop App — one local hub for App and Word.
 *
 * The engine is the Word sidecar's server (providers, data policy, matters,
 * firm library, workflows, connectors, web). If the Word plugin already
 * runs it, the App uses that instance; otherwise the App starts it with
 * Electron's own Node (ELECTRON_RUN_AS_NODE) and points it at the App's
 * llama proxy and Qdrant, so there is still only one model in memory.
 * Either way both front-ends talk to the same engine, offline.
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { readSidecar } = require('./hub-client')

let child = null

async function waitFor(fn, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

/**
 * @param {{ engineDir: string, logPath: string, llmProxy: string, qdrantUrl: string }} opts
 * @returns {Promise<{ owned: boolean, url: string|null, error?: string }>}
 */
async function ensureEngine({ engineDir, logPath, llmProxy, qdrantUrl }) {
  const running = readSidecar()
  if (running) return { owned: false, url: running.url }
  const entry = path.join(engineDir, 'server.js')
  if (!fs.existsSync(entry)) return { owned: false, url: null, error: `engine missing at ${entry}` }
  const addinRoot = [path.join(engineDir, '..', 'add-in'), path.join(engineDir, '..', '..', 'add-in')].find((p) => fs.existsSync(path.join(p, 'taskpane.html')))
  const out = fs.openSync(logPath, 'a')
  child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      // The App owns this engine's lifetime (stopEngine on quit) — the
      // Word/Outlook-aware shutdown must not stop it under the App.
      LEXVAULT_KEEPALIVE: '1',
      LEXVAULT_LLM_URL: llmProxy,
      LEXVAULT_QDRANT_URL: qdrantUrl,
      ...(addinRoot ? { LEXVAULT_ADDIN_ROOT: addinRoot } : {}),
    },
    stdio: ['ignore', out, out],
    windowsHide: true,
  })
  child.on('exit', (code) => {
    console.log(`[engine] exited (${code})`)
    child = null
  })
  const reg = await waitFor(() => { const r = readSidecar(); return r && r.pid === child?.pid ? r : null }, 20000)
  if (!reg) {
    // Port taken by a Word sidecar that started in the meantime? Use it.
    const other = readSidecar()
    if (other) { stopEngine(); return { owned: false, url: other.url } }
    return { owned: true, url: null, error: `engine did not start (see ${logPath})` }
  }
  console.log(`[engine] started at ${reg.url} (pid ${reg.pid})`)
  return { owned: true, url: reg.url }
}

function stopEngine() {
  if (child) { try { child.kill() } catch { /* gone */ } child = null }
}

module.exports = { ensureEngine, stopEngine }
