/**
 * Every server OpenLex starts must listen on loopback (127.0.0.1) only —
 * never on all interfaces. This is a static check over the source of the
 * engine, the desktop shell and the legacy desktop server (the latter needs
 * a database and many services to boot, so it is checked by reading it).
 *
 *   node --test test/loopback.test.js
 */
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const DIRS = [
  'sidecar/src',
  'sidecar/bin',
  'sidecar/tui',
  'desktop/electron/main',
  'desktop/electron/sidecars',
  'desktop/server/dist',
  'desktop/server-fixes',
]

function jsFiles(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...jsFiles(p))
    else if (/\.(c|m)?js$/.test(e.name)) out.push(p)
  }
  return out
}

const files = DIRS.flatMap((d) => jsFiles(path.join(ROOT, d)))

test('the scan finds the known servers', () => {
  const rel = files.map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
  for (const f of ['sidecar/src/server.js', 'desktop/server/dist/server.js', 'desktop/server-fixes/server.js', 'desktop/electron/sidecars/supervisor.js']) {
    assert.ok(rel.includes(f), `${f} not scanned`)
  }
})

test('every .listen( call binds to 127.0.0.1', () => {
  const bad = []
  let calls = 0
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    const hostConst = /const HOST = '127\.0\.0\.1'/.test(src)
    const re = /\.listen\(([^)]*?)(,\s*(async\s*)?\(|,\s*function|\)\s*;?\s*$)/gm
    let m
    while ((m = re.exec(src))) {
      calls++
      const args = m[1].split(',').map((s) => s.trim())
      const host = args[1]
      const ok = host === "'127.0.0.1'" || host === '"127.0.0.1"' || (host === 'HOST' && hostConst)
      if (!ok) bad.push(`${path.relative(ROOT, f)}: .listen(${m[1]}`)
    }
  }
  assert.ok(calls >= 4, `expected at least 4 listen calls, found ${calls}`)
  assert.deepStrictEqual(bad, [], 'servers listening beyond loopback')
})

test('no server code mentions binding to all interfaces', () => {
  const hits = []
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    if (/['"`]0\.0\.0\.0['"`]|host:\s*['"]::['"]/.test(src)) hits.push(path.relative(ROOT, f))
  }
  assert.deepStrictEqual(hits, [])
})
