"use strict"
/**
 * The working folder: the folder the lawyer started OpenLex in (`openlex`
 * or `openlex ask` in ~/Clients/Alpine), like a coding agent works in its
 * current directory. A front end sends it per request ("folder" on
 * /api/chat and the workflow, grid and plan runs); the engine runs the
 * request inside run(folder, …) and the file tools then work there:
 *
 *   - relative paths resolve against the working folder;
 *   - the working folder and the OpenLex workspace (the matter folders) are
 *     the only places a file tool can reach. Anything else is refused —
 *     never asked — lexically AND after resolving symlinks, compared
 *     case-insensitively on macOS and Windows;
 *   - hidden files and folders (.git, .ssh …), system folders, OpenLex's
 *     own data folder are off-limits; the firm's configuration
 *     (openlex.json, skills/, playbooks/) cannot be written;
 *   - reading is allowed; saving, adding to, renaming and deleting ask
 *     first (permissions.js). A delete keeps a recoverable copy in the
 *     workspace history, and is asked every time.
 *
 * Big folders: listings and searches stop after a fixed number of files
 * and say so, so a home folder cannot make the engine walk the disk.
 *
 * Without a working folder everything behaves as before: file tools work
 * in the workspace only.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { AsyncLocalStorage } = require('async_hooks')

const store = new AsyncLocalStorage()

const LIST_MAX = 100 // files shown by one listing
const VISIT_MAX = 5000 // files looked at by one listing or search
const DEPTH_MAX = 8
const SEARCH_HITS = 20
const SEARCH_DOCS_MAX = 40 // Word/PDF files opened by one search
const DOC_MAX_BYTES = 10 * 1024 * 1024
const READ_MAX = 8000

/** Word, PDF and text files a lawyer would call "documents". */
const DOC_EXT = new Set(['.docx', '.pdf', '.txt', '.md', '.rtf', '.doc', '.odt', '.csv', '.xlsx', '.eml', '.msg', '.html', '.htm'])
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.ics', '.rtf', '.eml', '.log', '.yaml', '.yml', ''])
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '$RECYCLE.BIN', 'System Volume Information'])

/** macOS and Windows compare file names without case. */
const caseInsensitive = () => (process.env.OPENLEX_CASE_SENSITIVE === '1' ? false : process.platform === 'darwin' || process.platform === 'win32')
const norm = (p) => (caseInsensitive() ? p.toLowerCase() : p)
function within(p, root) {
  const a = norm(p)
  const r = norm(root)
  if (a === r) return true
  return a.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
}

const home = () => os.homedir()
function expandHome(p) {
  const s = String(p ?? '')
  if (s === '~') return home()
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(home(), s.slice(2))
  return s
}

/** Real path of p even if it does not exist yet (nearest existing ancestor + the rest). */
function realOf(p) {
  let cur = p
  const rest = []
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) break
    rest.unshift(path.basename(cur))
    cur = parent
  }
  let real = cur
  try { real = fs.realpathSync(cur) } catch { /* keep */ }
  return path.join(real, ...rest)
}

/** "~/Clients/Alpine" (forward slashes: also the form permission rules use). */
function tilde(p) {
  const h = home()
  const s = String(p || '')
  if (h && within(s, h)) return `~${s.slice(h.length)}`.replace(/\\/g, '/')
  return s.replace(/\\/g, '/')
}

function dataDir() { try { return require('./config').DATA_DIR } catch { return path.join(home(), '.lexvault') } }
function wsBase() { return require('./workspace').base() }

/** Folders of the operating system: never a working folder, never touched below one. */
function systemDirs() {
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot || 'C:\\Windows'
    return [sys, process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData', path.join(home(), 'AppData')]
  }
  const common = ['/bin', '/sbin', '/usr', '/etc', '/dev', '/opt', '/boot', '/proc', '/sys', '/lib', '/lib64', '/root', '/snap']
  if (process.platform === 'darwin') return [...common, '/System', '/Library', '/private', '/var', '/cores', '/Applications', path.join(home(), 'Library')]
  return [...common, '/var', '/run', '/srv']
}

class FolderError extends Error {}
const fail = (m) => { throw new FolderError(m) }

/**
 * Can `dir` be a working folder? { ok, path, real, short, broad, error }.
 * broad = 'home' (the whole home folder) or 'root' (the whole computer or
 * a folder above the home folder): allowed only after the lawyer confirms.
 */
function check(dir) {
  const raw = String(dir ?? '').trim()
  if (!raw) return { ok: false, error: 'No folder given.' }
  const p = path.resolve(expandHome(raw))
  let st
  try { st = fs.statSync(p) } catch { return { ok: false, path: p, short: tilde(p), error: `The folder ${tilde(p)} was not found.` } }
  if (!st.isDirectory()) return { ok: false, path: p, short: tilde(p), error: `${tilde(p)} is a file, not a folder.` }
  const real = realOf(p)
  const out = { ok: true, path: p, real, short: tilde(p), broad: null }
  if (within(real, realOf(dataDir())) || within(p, dataDir())) return { ...out, ok: false, error: 'That is OpenLex\'s own data folder. Choose the folder with your documents instead.' }
  const h = home()
  if (norm(p) === norm(path.parse(p).root)) out.broad = 'root'
  else if (norm(p) === norm(h) || norm(real) === norm(realOf(h))) out.broad = 'home'
  else if (within(h, p)) out.broad = 'root'
  if (!out.broad && systemDirs().some((s) => norm(p) === norm(s) || norm(real) === norm(realOf(s)))) return { ...out, ok: false, error: `${tilde(p)} is a system folder. Choose the folder with your documents instead.` }
  return out
}

/** Run fn with a working folder (null = none). The folder must have passed check(). */
function run(dir, fn) {
  if (!dir) return store.run(null, fn)
  const root = path.resolve(expandHome(dir))
  return store.run({ root, real: realOf(root) }, fn)
}

/** The working folder of this request: { root, real } or null. */
function current() { return store.getStore() || null }

/** Why a place is off-limits (null = fine). */
/**
 * A protected folder counts only below the place being worked in: a
 * workspace that itself lives in a temporary folder stays usable, but a
 * working folder "/" does not open /System.
 */
const below = (abs, dir, root) => within(abs, dir) && !within(root, dir)

function protectedReason(abs, rel, { write = false, area, root }) {
  const segs = rel.split(/[\\/]+/).filter(Boolean)
  if (segs.some((s) => s.startsWith('.'))) return 'Hidden files and folders (such as .git) are protected'
  if (below(abs, dataDir(), root) || below(realOf(abs), realOf(dataDir()), realOf(root))) return 'OpenLex\'s own data folder is protected'
  for (const s of systemDirs()) if (below(abs, s, root)) return 'System folders are protected'
  if (write) {
    const base = wsBase()
    if (within(abs, base)) {
      const wrel = path.relative(base, abs).replace(/\\/g, '/')
      if (/^(openlex\.json$|skills(\/|$)|playbooks(\/|$))/i.test(wrel)) return `${wrel} is the firm's configuration and is protected (it cannot be changed by OpenLex)`
    }
    if (area === 'folder' && /^openlex\.json$/i.test(path.basename(abs))) return 'openlex.json is configuration: protected, OpenLex cannot change it'
  }
  return null
}

/**
 * Where a path the agent named really is. Relative paths start in the
 * working folder (or the workspace without one); ~ and absolute paths are
 * taken as they are. Throws FolderError (a plain sentence) when the place
 * is outside both areas or off-limits.
 * @returns {{ abs, rel, area: 'folder'|'workspace', root }}
 */
function locate(p, { write = false } = {}) {
  const cur = current()
  const ws = require('./workspace')
  const base = ws.base()
  const raw = expandHome(String(p ?? '').trim())
  const start = cur ? cur.root : base
  const abs = path.resolve(start, raw)
  const real = realOf(abs)
  let area = null
  let root = null
  if (cur && within(abs, cur.root) && within(real, cur.real)) { area = 'folder'; root = cur.root } else if (within(abs, base) && within(real, realOf(base))) { area = 'workspace'; root = base }
  if (!area) {
    if (cur && within(abs, cur.root)) fail(`${tilde(abs)} leads outside the working folder (a link to another place), so OpenLex may not use it`)
    fail(cur ? `${tilde(abs)} is outside the working folder (${tilde(cur.root)}) and the matter folders, so OpenLex may not use it` : `${tilde(abs)} is outside the OpenLex workspace, so OpenLex may not use it`)
  }
  // abs is within root (perhaps in other letters on macOS/Windows): the rest is the relative part.
  const rel = abs.slice(root.length).replace(/^[\\/]+/, '')
  const why = protectedReason(abs, rel, { write, area, root })
  if (why) fail(`${why}: ${tilde(abs)}`)
  return { abs, rel: rel.replace(/\\/g, '/'), area, root }
}

/** The same, but null instead of throwing. */
function tryLocate(p, opts) { try { return locate(p, opts) } catch { return null } }

// ── reading ───────────────────────────────────────────────────────────────

/** The text of a Word, PDF or text file (no OCR: keeps memory low). */
async function textOf(abs) {
  const ext = path.extname(abs).toLowerCase()
  if (ext === '.docx') return require('./docx_text').docxText(abs)
  if (ext === '.pdf') return require('./pdf_text').pdfText(abs, { ocr: false })
  const buf = fs.readFileSync(abs)
  if (buf.subarray(0, 8000).includes(0)) throw new FolderError(`${path.basename(abs)} is not a text, Word or PDF file, so OpenLex cannot read it (save it as Word or PDF)`)
  return buf.toString('utf8')
}

/** Read one file: { text, total, more } (a slice of at most `max` characters from `start`). */
async function read(p, { start = 0, max = READ_MAX } = {}) {
  const loc = locate(p)
  let st
  try { st = fs.statSync(loc.abs) } catch { fail(`${tilde(loc.abs)} was not found`) }
  if (st.isDirectory()) fail(`${tilde(loc.abs)} is a folder; list it instead`)
  if (st.size > 50 * 1024 * 1024) fail(`${path.basename(loc.abs)} is too large to read (${Math.round(st.size / 1048576)} MB)`)
  const text = String(await textOf(loc.abs) || '')
  const from = Math.max(0, Math.min(Number(start) || 0, text.length))
  const slice = text.slice(from, from + max)
  return { loc, text: slice, total: text.length, more: from + slice.length < text.length ? from + slice.length : null }
}

/** Walk a folder: files (relative to it), skipping hidden, system and huge trees. */
function walk(dirAbs, { maxVisit = VISIT_MAX, maxDepth = DEPTH_MAX, filter = null, root = dirAbs } = {}) {
  const files = []
  let visited = 0
  let truncated = false
  const go = (d, rel, depth) => {
    if (truncated) return
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      const full = path.join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (depth >= maxDepth) { truncated = true; continue }
        if (protectedReason(full, r, { root })) continue
        go(full, r, depth + 1)
      } else if (e.isFile()) {
        if (++visited > maxVisit) { truncated = true; return }
        if (filter && !filter(e.name)) continue
        let size = 0
        try { size = fs.statSync(full).size } catch { continue }
        files.push({ path: r, abs: full, size })
      }
      if (truncated) return
    }
  }
  go(dirAbs, '', 0)
  return { files, truncated, visited: Math.min(visited, maxVisit) }
}

/** List a folder (or the working folder): { loc, files (≤100), total, truncated }. */
function list(p = '') {
  const loc = locate(p || '')
  let st
  try { st = fs.statSync(loc.abs) } catch { fail(`${tilde(loc.abs)} was not found`) }
  if (!st.isDirectory()) fail(`${tilde(loc.abs)} is a file; read it instead`)
  const w = walk(loc.abs, { root: loc.root })
  return { loc, files: w.files.slice(0, LIST_MAX), total: w.files.length, truncated: w.truncated || w.files.length > LIST_MAX }
}

/** Documents (Word, PDF, text …) in a folder: { count, files (≤ max), truncated }. */
function documents(dirAbs, { max = 200 } = {}) {
  const w = walk(dirAbs, { maxVisit: 2000, maxDepth: 4, filter: (n) => DOC_EXT.has(path.extname(n).toLowerCase()) })
  return { count: w.files.length, files: w.files.slice(0, max), truncated: w.truncated }
}

/** Word search across the files of a folder (Word and PDF included): { hits, scanned, truncated }. */
async function search(query, dir = '') {
  const q = String(query || '').toLowerCase().trim()
  const loc = locate(dir || '')
  if (!q) return { loc, hits: [], scanned: 0, truncated: false }
  const w = walk(loc.abs, { root: loc.root })
  const hits = []
  let opened = 0
  let truncated = w.truncated
  let scanned = 0
  for (const f of w.files) {
    const ext = path.extname(f.path).toLowerCase()
    const isDoc = ext === '.docx' || ext === '.pdf'
    if (!isDoc && !TEXT_EXT.has(ext)) continue
    if (f.size > (isDoc ? DOC_MAX_BYTES : 1024 * 1024)) continue
    if (isDoc && ++opened > SEARCH_DOCS_MAX) { truncated = true; continue }
    let text
    try { text = await textOf(f.abs) } catch { continue }
    scanned++
    const lines = String(text || '').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        hits.push({ file: f.path, line: i + 1, text: lines[i].trim().slice(0, 160) })
        if (hits.length >= SEARCH_HITS) return { loc, hits, scanned, truncated: true }
      }
    }
  }
  return { loc, hits, scanned, truncated }
}

// ── changing (always asked first: permissions.js) ──────────────────────────

function write(p, content, { append = false, binary = false } = {}) {
  const loc = locate(p, { write: true })
  if (fs.existsSync(loc.abs) && fs.statSync(loc.abs).isDirectory()) fail(`${tilde(loc.abs)} is a folder`)
  const ws = require('./workspace')
  fs.mkdirSync(path.dirname(loc.abs), { recursive: true })
  ws.keepVersion(loc.abs)
  if (append) fs.appendFileSync(loc.abs, String(content ?? ''), 'utf8')
  else fs.writeFileSync(loc.abs, binary && Buffer.isBuffer(content) ? content : String(content ?? ''), binary ? undefined : 'utf8')
  return loc
}

/** Delete one file; a copy is kept in the workspace history first. */
function remove(p) {
  const loc = locate(p, { write: true })
  let st
  try { st = fs.lstatSync(loc.abs) } catch { fail(`${tilde(loc.abs)} was not found`) }
  if (!st.isFile()) fail(`${tilde(loc.abs)} is not a single file; OpenLex only deletes files one by one`)
  const kept = require('./workspace').keepVersion(loc.abs)
  if (!kept) fail(`No copy of ${path.basename(loc.abs)} could be kept, so it was not deleted`)
  fs.unlinkSync(loc.abs)
  return { loc, kept }
}

/** Rename or move one file inside the allowed places; never overwrites. */
function rename(from, to) {
  const src = locate(from, { write: true })
  const toRaw = String(to ?? '').trim()
  if (!toRaw) fail('No new name given')
  // A bare new name stays in the same folder.
  const dst = locate(/[\\/]/.test(toRaw) || toRaw.startsWith('~') ? toRaw : path.join(path.dirname(src.abs), toRaw), { write: true })
  if (!fs.existsSync(src.abs) || !fs.statSync(src.abs).isFile()) fail(`${tilde(src.abs)} was not found`)
  if (fs.existsSync(dst.abs)) fail(`${tilde(dst.abs)} already exists; OpenLex does not overwrite by renaming`)
  require('./workspace').keepVersion(src.abs)
  fs.mkdirSync(path.dirname(dst.abs), { recursive: true })
  try { fs.renameSync(src.abs, dst.abs) } catch { fs.copyFileSync(src.abs, dst.abs); fs.unlinkSync(src.abs) }
  return { from: src, to: dst }
}

module.exports = {
  check, run, current, locate, tryLocate, read, list, search, documents, write, remove, rename, tilde, within, expandHome, realOf,
  FolderError, LIST_MAX, VISIT_MAX, DOC_EXT,
}
