#!/usr/bin/env node
/**
 * Update metadata for a release, in electron-builder's latest*.yml shape —
 * what main/updater.js reads from a distribution's update feed:
 *
 *   latest-mac.yml    OpenLex-X.Y.Z-mac-arm64.zip and OpenLex-X.Y.Z-mac-x64.zip
 *                     (macOS updates install from the zip, not the dmg)
 *   latest.yml        OpenLex-X.Y.Z-windows-x64-setup.exe
 *   latest-linux.yml  OpenLex-X.Y.Z-linux-x64.AppImage
 *
 * Each lists version, files[] (url = file name, sha512 = base64, size),
 * path/sha512 of the first file and releaseDate. A file set that is not
 * there is skipped (one platform built locally); none at all is an error.
 * electron-builder writes these only with a publish target, which the open
 * build does not have (no update server in the repository), so the release
 * workflow writes them here.
 *
 *   node scripts/update-info.js <dir> <version>
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SETS = {
  'latest-mac.yml': (v) => [`OpenLex-${v}-mac-arm64.zip`, `OpenLex-${v}-mac-x64.zip`],
  'latest.yml': (v) => [`OpenLex-${v}-windows-x64-setup.exe`],
  'latest-linux.yml': (v) => [`OpenLex-${v}-linux-x64.AppImage`],
}

function sha512(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512')
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('base64'))).on('error', reject)
  })
}

function yml({ version, files, releaseDate }) {
  const lines = [`version: ${version}`, 'files:']
  for (const f of files) lines.push(`  - url: ${f.url}`, `    sha512: ${f.sha512}`, `    size: ${f.size}`)
  lines.push(`path: ${files[0].url}`, `sha512: ${files[0].sha512}`, `releaseDate: '${releaseDate}'`)
  return lines.join('\n') + '\n'
}

async function writeUpdateInfo(dir, version, { releaseDate = new Date().toISOString() } = {}) {
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(String(version))) throw new Error(`not a version: ${version}`)
  const written = []
  for (const [name, list] of Object.entries(SETS)) {
    const files = []
    for (const url of list(version)) {
      const p = path.join(dir, url)
      if (!fs.existsSync(p)) continue
      files.push({ url, sha512: await sha512(p), size: fs.statSync(p).size })
    }
    if (!files.length) continue
    fs.writeFileSync(path.join(dir, name), yml({ version, files, releaseDate }))
    written.push({ name, files: files.map((f) => f.url) })
  }
  if (!written.length) throw new Error(`no OpenLex ${version} installers in ${dir}`)
  return written
}

module.exports = { writeUpdateInfo, yml }

if (require.main === module) {
  const [dir, version] = process.argv.slice(2)
  if (!dir || !version) { console.error('usage: node scripts/update-info.js <dir> <version>'); process.exit(2) }
  writeUpdateInfo(dir, version).then((w) => {
    for (const x of w) console.log(`${x.name}: ${x.files.join(', ')}`)
  }, (err) => { console.error(err.message); process.exit(1) })
}
