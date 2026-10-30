/**
 * electron-builder afterPack hook.
 *
 * macOS builds without a Developer ID (the public, unsigned installers):
 * sign the app ad hoc ("codesign --sign -"). Apple Silicon refuses to run
 * code with no signature at all, and macOS calls an unsigned, downloaded
 * app "damaged" with no way to open it. Ad hoc signed, it gets the normal
 * "Apple could not verify…" prompt that the user can get past (right-click →
 * Open, or System Settings → Privacy & Security → Open Anyway).
 *
 * With a Developer ID (mac.identity set) electron-builder signs the app
 * itself right after this hook, and this does nothing.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function isMachO(file) {
  try {
    const fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(4)
    fs.readSync(fd, b, 0, 4, 0)
    fs.closeSync(fd)
    const m = b.readUInt32BE(0)
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m)
  } catch { return false }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const identity = context.packager.platformSpecificBuildOptions.identity
  if (identity !== null && identity !== undefined) return // a real signature follows
  if (process.env.CSC_LINK || process.env.CSC_NAME) return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // Nested executables outside the standard bundle locations first
  // (Qdrant, llama-server and its dylibs in Contents/Resources/bin), then the
  // bundle (--deep covers the Electron frameworks and helpers).
  const nested = walk(path.join(app, 'Contents', 'Resources')).filter(isMachO)
  for (const f of nested) execFileSync('codesign', ['--force', '--sign', '-', f], { stdio: 'inherit' })
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • ad hoc signed ${path.basename(app)} (${nested.length} nested binaries)`)
}
