"use strict"
/**
 * Local copies of a law source on the lawyer's own computer: a git clone
 * (legalize-dev), an official bulk download (German federal laws from
 * gesetze-im-internet.de), an opt-in community dump. Always from the
 * source itself, never through OpenLex, never passed on.
 *
 * The same four steps for every one, so /law can say them the same way:
 *   1. plan    — what would be downloaded and how big it is (asked first);
 *   2. start   — only with the lawyer's yes (confirm: true); runs in the
 *                background with progress (done / total, bytes);
 *   3. status  — what is on this computer, how big, last updated;
 *   4. remove  — deletes it from this computer.
 *
 * A connector offers this with
 *   local: {
 *     parts()                 → [{ part, label }]          what can be downloaded
 *     plan(part, opts)        → { part, label, bytes, estimate, from, licence, note? }
 *     run(part, { dir, opts, progress, signal })            does the download
 *     items()                 → [{ part, label, bytes, updated, stale, licence, history? }]
 *     remove?(part)                                         (default: delete its folder)
 *   }
 * Everything lives under <data folder>/law-data/<source>/<part>.
 */

const fs = require('fs')
const path = require('path')
const { SourceError, UA } = require('./http')

const root = () => path.join(require('../config').DATA_DIR, 'law-data')
const dirOf = (id, part = null) => path.join(root(), id, ...(part ? [String(part).toLowerCase().replace(/[^a-z0-9_-]/g, '_')] : []))

/** "about 120 MB", "about 4 GB", "12 KB". */
function sizeWords(bytes, estimate = false) {
  const b = Number(bytes) || 0
  const units = [['GB', 1e9], ['MB', 1e6], ['KB', 1e3]]
  for (const [u, n] of units) if (b >= n) return `${estimate ? 'about ' : ''}${b >= 10 * n ? Math.round(b / n) : Math.round((b / n) * 10) / 10} ${u}`
  return `${b} bytes`
}

/** Bytes of everything under a folder (0 when there is none). */
function folderBytes(dir) {
  let total = 0
  const walk = (d) => {
    let list = []
    try { list = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { try { total += fs.statSync(p).size } catch { /* gone */ } }
    }
  }
  walk(dir)
  return total
}

const jobs = new Map() // "id:part" → job
const view = (j) => (j ? { source: j.source, part: j.part, label: j.label, state: j.state, done: j.done, total: j.total, bytes: j.bytes, message: j.message, startedAt: j.startedAt, finishedAt: j.finishedAt || null, ...(j.error ? { error: j.error } : {}) } : null)

/** What a download would be (size, from where, licence); nothing is downloaded. */
async function plan(c, part, opts = {}) {
  if (!c.local) throw new SourceError(`${c.label} has nothing to download`, 'bad')
  const p = await c.local.plan(part, opts)
  return { source: c.id, ...p, size: sizeWords(p.bytes, p.estimate), dest: dirOf(c.id, p.part) }
}

/**
 * Start a download in the background. Refused without confirm: true (the
 * lawyer has seen the size and said yes). One at a time per part.
 */
function start(c, part, { confirm = false, opts = {} } = {}) {
  if (!c.local) throw new SourceError(`${c.label} has nothing to download`, 'bad')
  if (!confirm) throw new SourceError('Look at the size first and confirm the download', 'confirm')
  const key = `${c.id}:${part || ''}`
  const running = jobs.get(key)
  if (running && running.state === 'running') return view(running)
  const ac = new AbortController()
  const j = { source: c.id, part: part || null, label: `${c.label}${part ? ` (${part})` : ''}`, state: 'running', done: 0, total: null, bytes: 0, message: 'Starting…', startedAt: new Date().toISOString(), cancel: () => ac.abort() }
  jobs.set(key, j)
  const progress = (p = {}) => { for (const k of ['done', 'total', 'bytes', 'message']) if (p[k] !== undefined) j[k] = p[k] }
  const dir = dirOf(c.id, part)
  fs.mkdirSync(dir, { recursive: true })
  Promise.resolve()
    .then(() => c.local.run(part, { dir, opts, progress, signal: ac.signal }))
    .then(() => { j.state = 'done'; j.message = 'Done'; j.finishedAt = new Date().toISOString() })
    .catch((err) => {
      j.finishedAt = new Date().toISOString()
      if (ac.signal.aborted) { j.state = 'cancelled'; j.message = 'Stopped'; return }
      j.state = 'failed'
      j.error = err instanceof SourceError ? err.plain : `The download from ${c.label} did not finish`
      j.message = j.error
    })
  return view(j)
}

function status(c, part) {
  return view(jobs.get(`${c.id}:${part || ''}`))
}

function allJobs(c) {
  return [...jobs.values()].filter((j) => j.source === c.id).map(view)
}

function cancel(c, part) {
  const j = jobs.get(`${c.id}:${part || ''}`)
  if (j && j.state === 'running') j.cancel()
  return view(j)
}

/** Delete a local copy from this computer. */
async function remove(c, part) {
  if (!c.local) throw new SourceError(`${c.label} has nothing to remove`, 'bad')
  cancel(c, part)
  if (c.local.remove) await c.local.remove(part)
  else fs.rmSync(dirOf(c.id, part), { recursive: true, force: true })
  jobs.delete(`${c.id}:${part || ''}`)
  return { source: c.id, part: part || null, removed: true }
}

/** Download one file (streamed to disk, with bytes as they arrive). */
async function downloadFile(url, dest, { label = 'The source', onBytes = () => {}, signal, headers = {} } = {}) {
  let res
  try { res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal }) } catch (err) {
    if (signal?.aborted) throw err
    throw new SourceError(`${label} could not be reached (no internet connection, or the service is down)`, 'offline', String(err?.cause?.code || err.message))
  }
  if (!res.ok) throw new SourceError(res.status === 404 ? `${label} has no such file` : `${label} is not answering right now; try again later`, res.status === 404 ? 'notfound' : 'down', `HTTP ${res.status}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  const out = fs.createWriteStream(tmp)
  let n = 0
  try {
    for await (const chunk of res.body) {
      n += chunk.length
      onBytes(chunk.length, n)
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok))
    }
    await new Promise((ok, fail) => out.end((err) => (err ? fail(err) : ok())))
    fs.renameSync(tmp, dest)
  } catch (err) {
    out.destroy()
    try { fs.rmSync(tmp, { force: true }) } catch { /* none */ }
    throw err
  }
  return n
}

/** Size of a file at a URL without downloading it (HEAD; null when the server does not say). */
async function remoteSize(url, { headers = {} } = {}) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(20000) })
    const n = Number(res.headers.get('content-length'))
    return res.ok && n > 0 ? n : null
  } catch { return null }
}

module.exports = { plan, start, status, allJobs, cancel, remove, dirOf, root, sizeWords, folderBytes, downloadFile, remoteSize, _reset: () => jobs.clear() }
