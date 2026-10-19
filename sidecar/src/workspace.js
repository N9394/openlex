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

/** Resolve a workspace-relative or absolute path, enforcing containment. */
function resolve(...parts) {
  const p = path.resolve(baseDir, ...parts.map((x) => String(x || '')))
  if (p !== baseDir && !p.startsWith(baseDir + path.sep)) {
    throw new Error('path outside the LexVault workspace — denied')
  }
  return p
}

/** Sanitize a matter name into a safe folder name. */
function matterFolder(matter) {
  const safe = String(matter || 'default').replace(/[^\w\-.]/g, '_').slice(0, 80)
  return safe
}

function writeFile(relPath, content) {
  const p = resolve(relPath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, String(content ?? ''), 'utf8')
  return p
}

function writeFileBinary(relPath, buffer) {
  const p = resolve(relPath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''), 'latin1'))
  return p
}

function appendFile(relPath, content) {
  const p = resolve(relPath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
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
 * Sandboxed shell execution. Command must start with an allowlisted program.
 * CWD is always the workspace root. 10s timeout, 8K output cap.
 * No shell metacharacters (`;`, `&&`, `||`, `>`, `` ` ``, `$(`) —
 * the model should use write_file / read_file for most file ops.
 */
const { execFile } = require('child_process')
const SAFE_CMDS = new Set([
  'ls', 'find', 'grep', 'wc', 'cat', 'head', 'tail', 'sort', 'uniq',
  'diff', 'file', 'stat', 'git', 'python3', 'python', 'node', 'npm',
  'pip', 'pip3', 'curl', 'wget', 'mkdir', 'cp', 'mv', 'tree', 'du',
  'df', 'whoami', 'pwd', 'date', 'echo', 'env', 'which', 'type',
])

function runBash(command, maxChars = 8000, timeoutMs = 10000) {
  const cmd = String(command || '').trim()
  if (!cmd) return 'ERROR: empty command'
  // Block shell metacharacters that could escape the sandbox
  if (/[;|&`$(){}]/.test(cmd)) {
    return 'ERROR: shell metacharacters (; | & ` $ () {}) are not allowed — use the file tools instead'
  }
  // Extract base command (handle "git status", "python3 -c ...", etc.)
  const base = cmd.split(/\s+/)[0].split('/').pop()
  if (!SAFE_CMDS.has(base)) {
    return `ERROR: "${base}" is not in the allowed commands list`
  }
  return new Promise((resolve) => {
    execFile(base, cmd.split(/\s+/).slice(1), {
      cwd: baseDir,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      shell: false,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const out = ((stdout || '') + (stderr ? '\nSTDERR: ' + stderr : '')).trim()
      if (!out) resolve(err ? `ERROR: ${err.message}` : '(no output)')
      else resolve(out.length > maxChars ? out.slice(0, maxChars) + '\n…(truncated)' : out)
    })
  })
}

module.exports = { setBase, base, resolve, matterFolder, writeFile, writeFileBinary, appendFile, readFile, listFiles, search, runBash, DEFAULT_BASE }
