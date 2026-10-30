/**
 * The local model at start, with or without a licence. No Electron here,
 * so it can be tested with node.
 *
 * The App never downloads a model by itself and never stops because one is
 * missing: the first-start setup page (On this computer · I brought my own
 * key · I need help) lets the lawyer choose. Model files in models/llm are
 * the lawyer's: nothing here deletes them (Settings → AI removes a model
 * when the lawyer asks).
 *
 * A distribution may recommend a local model that its server provides
 * (GET <server>/api/app/model/<variant>, with the licence token). It is
 * offered on the setup page's "On this computer" card and downloaded only
 * when the lawyer clicks. distribution.json:
 *
 *   "localModel": true          the model hardware-tiers.json names for this computer
 *   "localModel": { "variant": "…", "filename": "….gguf", "sizeBytes": 123,
 *                   "sha256": "…", "title": "…" }
 *   (absent or false)           no suggestion
 */
const fs = require('fs')
const path = require('path')

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.gguf$/
const SAFE_VARIANT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

/**
 * The GGUF to start the local AI with: the preferred file when present,
 * else the first .gguf in modelDir, else null (the App runs on a cloud key
 * or an Ollama / llama-server endpoint, or the setup page offers one).
 */
function findLocalModel(modelDir, preferredFilename) {
  if (preferredFilename) {
    const p = path.join(modelDir, preferredFilename)
    if (fs.existsSync(p)) return p
  }
  let own = null
  try {
    own = fs.readdirSync(modelDir).filter((f) => /\.gguf$/i.test(f) && !/^mmproj/i.test(f)).sort()[0] || null
  } catch { /* no folder yet */ }
  return own ? path.join(modelDir, own) : null
}

/**
 * What the boot does about the local model: find one, never download, never fail.
 * @returns {{ modelPath: string|null, state: object }}
 */
function settleLocalModel({ modelDir, hw }) {
  const modelPath = findLocalModel(modelDir, hw && hw.model_filename)
  return {
    modelPath,
    state: modelPath ? { state: 'done', filename: path.basename(modelPath) } : { state: 'none' },
  }
}

/**
 * The distribution's recommended local model, or null. Needs a licence,
 * its token and the distribution's server, and "localModel" in its settings.
 */
function localModelSuggestion({ distribution, licensed, token, server, hw, modelDir }) {
  if (!licensed || !token || !server || !distribution) return null
  const want = distribution.localModel
  if (!want) return null
  let s
  if (want === true) {
    if (!hw || !hw.model || !hw.model_filename) return null
    s = { variant: hw.model, filename: hw.model_filename, sizeBytes: hw.model_size_bytes || null, sha256: hw.model_sha256 || null, title: hw.model_title || null }
  } else if (typeof want === 'object') {
    s = { variant: want.variant, filename: want.filename, sizeBytes: Number(want.sizeBytes) || null, sha256: want.sha256 || null, title: want.title || null }
  } else return null
  if (!SAFE_VARIANT.test(String(s.variant || '')) || !SAFE_FILE.test(String(s.filename || ''))) return null
  if (s.sha256 && !/^[0-9a-f]{64}$/i.test(s.sha256)) s.sha256 = null
  s.title = s.title ? String(s.title) : s.filename.replace(/\.gguf$/i, '')
  const p = path.join(modelDir, s.filename)
  let installed = false
  try { installed = fs.statSync(p).isFile() && (!s.sizeBytes || fs.statSync(p).size === s.sizeBytes) } catch { /* not there */ }
  return { ...s, path: p, installed }
}

/**
 * Download the suggested model on the lawyer's click. Never throws: the
 * result says what happened, the App keeps running either way.
 * @returns {Promise<{ ok: true, path: string, file: string } | { ok: false, error: string }>}
 */
async function downloadSuggestedModel({ suggestion, server, token, modelDir, fetchModel, onProgress = () => {} }) {
  if (!suggestion) return { ok: false, error: 'This build recommends no model to download.' }
  try {
    const r = await fetchModel({
      server,
      token,
      variant: suggestion.variant,
      destDir: modelDir,
      filename: suggestion.filename,
      expectedBytes: suggestion.sizeBytes,
      expectedSha256: suggestion.sha256,
      onProgress,
    })
    return { ok: true, path: r.path, file: path.basename(r.path) }
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) }
  }
}

module.exports = { findLocalModel, settleLocalModel, localModelSuggestion, downloadSuggestedModel }
