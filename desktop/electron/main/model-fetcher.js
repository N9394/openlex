/**
 * GGUF download helper.
 *
 * Used only when the lawyer clicks "Download" on a model a distribution
 * recommends (main/model-setup.js) — never automatically at start. If the
 * file already exists at the right size + sha, we no-op. Otherwise we stream
 * it from the distribution's server, resumable, and verify.
 *
 * The download is token-authenticated: we attach the user's bearer token from
 * tokens.json (written by the renderer's first-run paste flow). This is the
 * same token used for license refresh and pack download.
 *
 * Usage:
 *   await fetchModel({
 *     server: 'https://downloads.example.com',   // the distributor's server
 *     token: 'lv_live_…',
 *     variant: 'qwen3.5-4b-q4_k_m',
 *     destDir: PATHS.models + '/llm',
 *     filename: 'qwen3.5-4b-instruct-q4_k_m.gguf',
 *     expectedBytes: 2_700_000_000,
 *     expectedSha256: 'abc…',          // null = skip hash check (dev)
 *     onProgress: ({ downloaded, total }) => …,
 *   })
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { URL } = require('url')

async function fetchModel({
  server, token, variant, destDir, filename,
  expectedBytes, expectedSha256, onProgress = () => {},
}) {
  fs.mkdirSync(destDir, { recursive: true })
  const finalPath = path.join(destDir, filename)
  const partPath = finalPath + '.part'

  // Skip if already present + correct size (and hash if known). A file
  // that does not match is NOT deleted here: the download goes to .part and
  // replaces it only once complete and verified (the lawyer asked for it).
  if (fs.existsSync(finalPath)) {
    const st = fs.statSync(finalPath)
    if (expectedBytes && st.size === expectedBytes) {
      if (!expectedSha256 || expectedSha256.startsWith('REPLACE_')) {
        return { path: finalPath, skipped: true, reason: 'exists with matching size' }
      }
      const actualSha = await sha256OfFile(finalPath)
      if (actualSha === expectedSha256) {
        return { path: finalPath, skipped: true, reason: 'exists with matching hash' }
      }
    }
  }

  const url = new URL(`/api/app/model/${variant}`, server)
  let downloaded = 0
  if (fs.existsSync(partPath)) {
    downloaded = fs.statSync(partPath).size
  }

  await new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(downloaded > 0 ? { 'Range': `bytes=${downloaded}-` } : {}),
      },
    }, res => {
      if (res.statusCode === 416) {
        // Range Not Satisfiable — file already complete on disk
        res.resume()
        return resolve()
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`))
      }
      // 200 to a Range request: the server sends the whole file again.
      if (res.statusCode === 200 && downloaded > 0) downloaded = 0
      const totalBytes = expectedBytes || (parseInt(res.headers['content-length'], 10) + downloaded) || 0
      const sink = fs.createWriteStream(partPath, { flags: downloaded > 0 ? 'a' : 'w' })
      res.on('data', chunk => {
        downloaded += chunk.length
        onProgress({ downloaded, total: totalBytes })
      })
      res.pipe(sink)
      sink.on('finish', resolve)
      sink.on('error', reject)
      res.on('error', reject)
      res.on('aborted', () => reject(new Error('download interrupted — try again to resume')))
    })
    req.on('error', reject)
    req.setTimeout(5 * 60_000, () => req.destroy(new Error('no data for 5 minutes — try again to resume')))
  })

  // Verify
  const finalSize = fs.statSync(partPath).size
  if (expectedBytes && finalSize !== expectedBytes) {
    throw new Error(`size mismatch: expected ${expectedBytes}, got ${finalSize}`)
  }
  if (expectedSha256 && !expectedSha256.startsWith('REPLACE_')) {
    const actualSha = await sha256OfFile(partPath)
    if (actualSha !== expectedSha256) {
      fs.unlinkSync(partPath)
      throw new Error(`sha256 mismatch: expected ${expectedSha256}, got ${actualSha}`)
    }
  }
  fs.renameSync(partPath, finalPath)
  return { path: finalPath, skipped: false }
}

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(file)
    s.on('data', d => h.update(d))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

module.exports = { fetchModel }
