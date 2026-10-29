"use strict"
/**
 * Sandboxed workspace (Batch W1): files the agent may touch live under a
 * user-chosen base folder (~/LexVault by default), organized in per-matter
 * subfolders. Strict containment — NOTHING outside the root is ever
 * readable or writable by the file tools. The agent's fine-tune file tools
 * (write_file / read_file / list_directory / search_local_files) finally
 * get real handlers here.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

// OPENLEX_WORKSPACE overrides the default (tests, portable installs); the
// user's Settings choice still wins over both.
const DEFAULT_BASE = process.env.OPENLEX_WORKSPACE ? path.resolve(process.env.OPENLEX_WORKSPACE)
  : process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || 'C:\\Users\\public', 'LexVault')
    : path.join(os.homedir(), 'LexVault')

let baseDir = DEFAULT_BASE

/** Configure the workspace root (Settings). Returns the effective path. */
function setBase(dir) {
  if (dir && typeof dir === 'string' && dir.trim()) baseDir = path.resolve(dir.trim())
  fs.mkdirSync(baseDir, { recursive: true })
  return baseDir
}

function base() { return baseDir }

/** Real (symlink-free) path of the workspace root. */
function realBase() {
  try { return fs.realpathSync(baseDir) } catch { return baseDir }
}

/**
 * Real path of p even if it does not exist yet: realpath of the nearest
 * existing ancestor plus the rest. Defeats symlinks that point outside.
 */
function realPathOf(p) {
  let cur = p
  const rest = []
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) break
    rest.unshift(path.basename(cur))
    cur = parent
  }
  let real = cur
  try { real = fs.realpathSync(cur) } catch { /* keep as is */ }
  return path.join(real, ...rest)
}

const inside = (p, root) => p === root || p.startsWith(root + path.sep)

/** Resolve a workspace-relative or absolute path, enforcing containment (lexically and after resolving symlinks). */
function resolve(...parts) {
  const p = path.resolve(baseDir, ...parts.map((x) => String(x || '')))
  if (!inside(p, baseDir) || !inside(realPathOf(p), realBase())) {
    throw new Error('path outside the OpenLex workspace — denied')
  }
  return p
}

// ── versioned writes: the previous content is kept, nothing is lost by overwriting ──
const HISTORY_DIR = '.openlex/history'
const HISTORY_KEEP = 20

/**
 * Where earlier versions of a file are kept: workspace files under their
 * own path, files of a working folder (folder.js) under _folders/ + their
 * full path — always inside the workspace, never in the client's folder.
 */
function historyDirFor(p) {
  const abs = path.resolve(p)
  const rel = path.relative(baseDir, abs)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return path.join(baseDir, HISTORY_DIR, rel)
  const parsed = path.parse(abs)
  const drive = parsed.root.replace(/[:\\/]/g, '')
  return path.join(baseDir, HISTORY_DIR, '_folders', ...(drive ? [drive] : []), abs.slice(parsed.root.length))
}

/** Keep a copy of p before it changes. Returns the copy's path (null: nothing to keep, or it failed). */
function keepVersion(p) {
  try {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null
    const rel = path.relative(baseDir, p)
    if (rel.startsWith('.openlex')) return null
    const dir = historyDirFor(p)
    fs.mkdirSync(dir, { recursive: true })
    // Two saves within the same millisecond must not overwrite each other's
    // copy: add -001, -002 … (sorts after the plain name, so order is kept).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let copy = path.join(dir, stamp)
    for (let n = 1; fs.existsSync(copy); n++) copy = path.join(dir, `${stamp}-${String(n).padStart(3, '0')}`)
    fs.copyFileSync(p, copy, fs.constants.COPYFILE_EXCL)
    const versions = fs.readdirSync(dir).sort()
    for (const old of versions.slice(0, Math.max(0, versions.length - HISTORY_KEEP))) fs.unlinkSync(path.join(dir, old))
    return copy
  } catch (err) { console.warn('[workspace] could not keep previous version:', err.message); return null }
}

/** Earlier versions of a file, newest first (an absolute path may name a file of a working folder). */
function versions(relPath) {
  const dir = historyDirFor(path.isAbsolute(String(relPath)) ? String(relPath) : resolve(relPath))
  try { return fs.readdirSync(dir).sort().reverse().map((v) => ({ version: v, path: path.join(dir, v) })) } catch { return [] }
}

/** Put an earlier version back (the current one is kept as a version first); also brings back a deleted file. */
function restoreVersion(relPath, version) {
  const p = path.isAbsolute(String(relPath)) ? require('./folder').locate(relPath, { write: true }).abs : resolve(relPath)
  const v = versions(relPath).find((x) => x.version === version) || versions(relPath)[0]
  if (!v) throw new Error(`no earlier version of ${relPath}`)
  keepVersion(p)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.copyFileSync(v.path, p)
  return { restored: v.version, path: p }
}

/** Sanitize a matter name into a safe folder name. */
function matterFolder(matter) {
  const safe = String(matter || 'default').replace(/[^\w\-.]/g, '_').slice(0, 80)
  return safe
}

function writeFile(relPath, content) {
  const p = resolve(relPath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  keepVersion(p)
  fs.writeFileSync(p, String(content ?? ''), 'utf8')
  return p
}

function writeFileBinary(relPath, buffer) {
  const p = resolve(relPath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  keepVersion(p)
  fs.writeFileSync(p, Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''), 'latin1'))
  return p
}

function appendFile(relPath, content) {
  const p = resolve(relPath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  keepVersion(p)
  fs.appendFileSync(p, String(content ?? ''), 'utf8')
  return p
}

function readFile(relPath, maxChars = 4000) {
  const p = resolve(relPath)
  if (!fs.existsSync(p)) return null
  const raw = fs.readFileSync(p, 'utf8')
  return raw.length > maxChars ? raw.slice(0, maxChars) + '\n…(truncated)' : raw
}

function listFiles(dir = '') {
  const p = resolve(dir)
  if (!fs.existsSync(p)) return []
  const out = []
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.openlex') continue // internal: version history
      const full = path.join(d, e.name)
      const r = rel ? path.join(rel, e.name) : e.name
      if (e.isDirectory()) walk(full, r)
      else out.push({ path: r, size: fs.statSync(full).size })
    }
  }
  walk(p, dir ? String(dir) : '')
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out.slice(0, 100)
}

/** Simple word-match search over workspace files (cap results). */
function search(query, dir = '') {
  const q = String(query || '').toLowerCase()
  if (!q) return []
  const hits = []
  for (const f of listFiles(dir)) {
    if (f.size > 1024 * 1024) continue // skip huge files
    const content = readFile(f.path, 200000) || ''
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        hits.push({ file: f.path, line: i + 1, text: lines[i].trim().slice(0, 160) })
        if (hits.length >= 20) return hits
      }
    }
  }
  return hits
}

/**
 * run_bash — a deliberately small, sandboxed command runner.
 *
 * Off unless the firm turns it on (openlex.json → "features": { "shell": true }).
 * Lawyers rarely need a shell, and it is the riskiest tool an agent can hold.
 *
 * Layers (all must pass):
 *   1. Allowlist of read/organise commands only. Nothing that runs code,
 *      reaches the network, changes permissions or deletes: no python, node,
 *      npm, pip, curl, wget, env, rm, chmod, dd … Dangerous options of the
 *      allowed ones are refused (find -delete/-exec, git -c/--exec, …).
 *   2. No shell: argv is passed to execFile; ; | & ` $ ( ) { } < > are refused.
 *   3. Every path argument must resolve inside the workspace, after symlinks;
 *      absolute paths and ~ are refused. cp/mv never overwrite (-n).
 *   4. A minimal environment: no API keys or other variables reach the command.
 *   5. OS sandbox: macOS Seatbelt / Linux bubblewrap — writes only inside the
 *      workspace, no reads in the home folder outside it, no network. Without
 *      an OS sandbox the command is refused (unless the firm explicitly sets
 *      "shellWithoutSandbox": true).
 */
const { execFile } = require('child_process')

const SAFE_CMDS = new Set([
  'ls', 'find', 'grep', 'wc', 'cat', 'head', 'tail', 'sort', 'uniq', 'diff', 'file', 'stat',
  'tree', 'du', 'pwd', 'date', 'echo', 'mkdir', 'cp', 'mv', 'git',
])
const FIND_FORBIDDEN = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'])
const GIT_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'ls-files', 'blame'])
const BIN_DIRS = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']

/** Split a command line into argv, honouring "double" and 'single' quotes. No expansion of any kind. */
function splitArgs(cmd) {
  const out = []
  let cur = ''
  let q = null
  let has = false
  for (const ch of cmd) {
    if (q) { if (ch === q) q = null; else cur += ch; continue }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue }
    if (/\s/.test(ch)) { if (has || cur) { out.push(cur); cur = ''; has = false } continue }
    cur += ch
  }
  if (q) throw new Error('unbalanced quote')
  if (has || cur) out.push(cur)
  return out
}

function shellFeatures() {
  try { return require('./harness').load().features || {} } catch { return {} }
}

/**
 * Validate a command against layers 1–3. Returns { bin, args } or throws
 * with a message the model can act on.
 */
function checkCommand(command) {
  const cmd = String(command || '').trim()
  if (!cmd) throw new Error('empty command')
  if (/[;|&`$(){}<>\n\r\\]/.test(cmd)) throw new Error('shell syntax (; | & ` $ ( ) { } < > \\ newlines) is not allowed — one plain command, or use the file tools')
  const argv = splitArgs(cmd)
  const name = argv[0]
  if (name.includes('/')) throw new Error('call the command by name, not by path')
  if (!SAFE_CMDS.has(name)) throw new Error(`"${name}" is not allowed. Allowed: ${[...SAFE_CMDS].join(', ')}. Code, network and delete commands are never available to the agent.`)
  let args = argv.slice(1)
  for (const a of args) {
    if (/^~/.test(a) || /=\s*[~/]/.test(a)) throw new Error(`"${a}": paths outside the workspace are not allowed`)
  }
  // Which arguments are paths (checked) and which are patterns/text (not)?
  const pathArgs = []
  const nonFlags = args.filter((a) => !a.startsWith('-'))
  if (name === 'echo' || name === 'date' || name === 'pwd') {
    if (name === 'date' && args.some((a) => /^-[sau]/.test(a))) throw new Error('date can only print the date')
  } else if (name === 'grep') {
    // first non-flag is the pattern (unless -e/-f gave it), the rest are paths
    if (args.some((a) => a === '-f' || a.startsWith('--file'))) throw new Error('grep -f is not allowed')
    const hasE = args.includes('-e')
    let skipped = hasE
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '-e') { i++; continue }
      if (a.startsWith('-')) continue
      if (!skipped) { skipped = true; continue }
      pathArgs.push(a)
    }
  } else if (name === 'find') {
    for (const a of args) if (FIND_FORBIDDEN.has(a)) throw new Error(`find ${a} is not allowed`)
    for (const a of args) { if (a.startsWith('-') || a === '!' ) break; pathArgs.push(a) }
  } else if (name === 'git') {
    const sub = nonFlags[0]
    if (!GIT_SUBCOMMANDS.has(sub)) throw new Error(`git ${sub || ''}: only ${[...GIT_SUBCOMMANDS].join(', ')} are allowed`)
    if (args.some((a) => /^(-c|-C|--exec|--output|--upload-pack|--receive-pack|--git-dir|--work-tree|--ext-diff|--textconv)/.test(a))) throw new Error('that git option is not allowed')
    // --no-pager goes before the subcommand; external diff/textconv drivers never run
    const at = args.indexOf(sub)
    args = ['--no-pager', ...args.slice(0, at + 1), ...(sub === 'diff' || sub === 'show' || sub === 'log' ? ['--no-ext-diff', '--no-textconv'] : []), ...args.slice(at + 1)]
  } else {
    pathArgs.push(...nonFlags)
  }
  if (name === 'cp' || name === 'mv') {
    if (args.some((a) => /^-[a-zA-Z]*[fR]/.test(a) && a !== '-R' && a !== '-r')) throw new Error(`${name} -f is not allowed`)
    args = ['-n', ...args] // never overwrite an existing file
  }
  for (const a of pathArgs) resolve(a) // throws if outside (after symlinks)
  let bin = null
  for (const d of BIN_DIRS) { const p = path.join(d, name); if (fs.existsSync(p)) { bin = p; break } }
  if (!bin) throw new Error(`${name} is not installed`)
  return { bin, args }
}

/** OS sandbox wrapper for the current platform, or null if none is available. */
function sandboxFor(root) {
  const home = os.homedir()
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) {
    const esc = (s) => s.replace(/(["\\])/g, '\\$1')
    const profile = `(version 1)(allow default)(deny network*)` +
      `(deny file-write* (subpath "/"))(allow file-write* (subpath "${esc(root)}") (literal "/dev/null") (literal "/dev/tty"))` +
      `(deny file-read* (subpath "${esc(fs.realpathSync(home))}"))(allow file-read* (subpath "${esc(root)}"))`
    return { kind: 'seatbelt', wrap: (bin, args) => ['/usr/bin/sandbox-exec', ['-p', profile, bin, ...args]] }
  }
  if (process.platform === 'linux') {
    const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find((p) => fs.existsSync(p))
    if (bwrap) {
      return { kind: 'bubblewrap', wrap: (bin, args) => [bwrap, ['--ro-bind', '/', '/', '--tmpfs', home, '--bind', root, root, '--dev', '/dev', '--unshare-all', '--die-with-parent', '--chdir', root, bin, ...args]] }
    }
  }
  return null
}

function runBash(command, maxChars = 8000, timeoutMs = 10000) {
  const feat = shellFeatures()
  if (feat.shell !== true) return 'ERROR: run_bash is turned off. Use read_file, list_directory, search_local_files and write_file instead. (A firm can enable it with "features": { "shell": true } in openlex.json.)'
  let checked
  try { checked = checkCommand(command) } catch (err) { return `ERROR: ${err.message}` }
  const root = realBase()
  const sb = sandboxFor(root)
  if (!sb && feat.shellWithoutSandbox !== true) return 'ERROR: no OS sandbox is available on this machine (macOS sandbox-exec or Linux bubblewrap), so run_bash stays off.'
  const [file, argv] = sb ? sb.wrap(checked.bin, checked.args) : [checked.bin, checked.args]
  return new Promise((done) => {
    execFile(file, argv, {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      shell: false,
      windowsHide: true,
      env: { PATH: BIN_DIRS.join(':'), LANG: process.env.LANG || 'en_US.UTF-8', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    }, (err, stdout, stderr) => {
      const out = ((stdout || '') + (stderr ? '\nSTDERR: ' + stderr : '')).trim()
      if (!out) done(err ? `ERROR: ${err.message}` : '(no output)')
      else done(out.length > maxChars ? out.slice(0, maxChars) + '\n…(truncated)' : out)
    })
  })
}

module.exports = { setBase, base, resolve, realBase, matterFolder, keepVersion, historyDirFor, writeFile, writeFileBinary, appendFile, readFile, listFiles, search, runBash, checkCommand, sandboxFor, versions, restoreVersion, DEFAULT_BASE }
