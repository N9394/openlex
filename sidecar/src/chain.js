"use strict"
/**
 * Tamper-evidence for OpenLex's local logs (the audit log and the
 * per-matter activity logs): every line carries `prev` (the fingerprint of
 * the line before it) and `h` (the SHA-256 of the line as written, without
 * its `h`). Changing, removing or moving a line breaks the chain, and
 * verify() names the first line where it breaks.
 *
 * This DETECTS changes; it cannot PREVENT them. The logs are ordinary files
 * on this computer, and someone with access to them could rewrite the whole
 * chain. What it gives a lawyer: an export carries the chain's fingerprint,
 * so a later copy can be compared with it, and any edit made with a text
 * editor or a script that does not recompute every later fingerprint shows
 * up at once. (A periodic signed "seal" — the fingerprint signed with a key
 * or sent to a timestamping service — could be added later.)
 *
 * Line format (one JSON object per line):
 *   {"ts":"…", …the entry…, "prev":"<h of the line before>|null", "h":"<sha256>"}
 *   h = sha256 of the exact line text up to `"prev":…` with the closing brace,
 *       i.e. the line without its `,"h":"…"` part.
 *
 * Chain start markers (`"chain":"start"`), each also a chained line:
 *   why "sealed"    lines written before tamper-evidence existed (or by an
 *                   older version) are sealed once: `earlier` = { lines, sha256 }
 *                   of the unchained lines just above the marker.
 *   why "retention" only as the first line: older lines were removed under the
 *                   retention setting; `removed` = { count, from, to } and
 *                   `continues` = the fingerprint the next line links to.
 *
 * Writing stays fast: the last fingerprint of each file is kept in memory
 * (with the file size, so a write by another process is noticed) and is
 * recovered from the end of the file when the engine starts.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const H_TAIL = /,"h":"([0-9a-f]{64})"\}$/
const TAIL_BYTES = 256 * 1024

/** file → { h: last fingerprint, size: bytes we know of } */
const heads = new Map()

/** A raw line → { raw, e (parsed or null), h (if chained), body (what h covers) }. */
function parseLine(raw) {
  let e = null
  try { e = JSON.parse(raw) } catch { /* unreadable */ }
  const m = H_TAIL.exec(raw)
  if (!e || typeof e !== 'object' || !m || e.h !== m[1]) return { raw, e, h: null }
  return { raw, e, h: m[1], body: `${raw.slice(0, m.index)}}` }
}

function readLines(file) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** The JSON text of a chained line (h appended to the body). */
function chained(entry, prev) {
  const { prev: _p, h: _h, ...clean } = entry || {}
  const body = JSON.stringify({ ...clean, prev: prev ?? null })
  const h = sha(body)
  return { line: `${body.slice(0, -1)},"h":"${h}"}`, h }
}

/**
 * Where a file's chain stands: its last fingerprint. Unchained lines at
 * the end (older lines, an older version's writes) are sealed first.
 */
function recover(file) {
  let size = 0
  try { size = fs.statSync(file).size } catch { return { h: null, size: 0 } }
  if (!size) return { h: null, size: 0 }
  // Read the tail; widen to the whole file when no chained line is in it.
  let text
  const fd = fs.openSync(file, 'r')
  try {
    const len = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    text = buf.toString('utf8')
  } finally { fs.closeSync(fd) }
  let lines = text.split('\n')
  const endsWithNewline = lines[lines.length - 1] === ''
  if (endsWithNewline) lines.pop()
  if (size > TAIL_BYTES) lines = lines.slice(1) // the first one may be cut
  let i = lines.length - 1
  while (i >= 0 && !parseLine(lines[i]).h) i--
  if (i < 0 && size > TAIL_BYTES) {
    lines = readLines(file)
    i = lines.length - 1
    while (i >= 0 && !parseLine(lines[i]).h) i--
  }
  const lastH = i >= 0 ? parseLine(lines[i]).h : null
  const trailing = lines.slice(i + 1)
  if (!trailing.length) return { h: lastH, size }
  // Seal the unchained lines at the end once.
  const marker = chained({ ts: new Date().toISOString(), chain: 'start', why: 'sealed', earlier: { lines: trailing.length, sha256: sha(trailing.join('\n')) } }, lastH)
  const out = `${endsWithNewline ? '' : '\n'}${marker.line}\n`
  fs.appendFileSync(file, out)
  return { h: marker.h, size: size + Buffer.byteLength(out) }
}

/** Append one entry to a chained JSONL file. */
function append(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let size = 0
  try { size = fs.statSync(file).size } catch { /* new file */ }
  let st = heads.get(file)
  if (!st || st.size !== size) st = recover(file)
  const { line, h } = chained(entry, st.h)
  const text = `${line}\n`
  fs.appendFileSync(file, text)
  heads.set(file, { h, size: st.size + Buffer.byteLength(text) })
  return h
}

/** Seal a file now (startup): unchained lines get their marker; nothing else changes. */
function seal(file) {
  if (!fs.existsSync(file)) return null
  const st = recover(file)
  heads.set(file, st)
  return st.h
}

const tsOf = (e) => (e && (e.ts || e.at)) || ''

/**
 * Check a file's chain.
 * → { ok, lines, entries, sealedBefore, unsealed, segments, head, notes[], broken: { line, why } | null }
 *   lines: physical lines; entries: lines that are not markers.
 */
function verify(file) {
  const lines = readLines(file)
  let expected = null
  let pending = [] // unchained lines waiting for their seal
  let pendingStart = 0
  let entries = 0
  let sealedBefore = 0
  let segments = 0
  let head = null
  const notes = []
  const fail = (line, why) => ({ ok: false, lines: lines.length, entries, sealedBefore, unsealed: 0, segments, head, notes, broken: { line, why } })
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const raw = lines[i]
    if (!raw.trim()) return fail(n, `Line ${n} is empty: something was removed or cut there.`)
    const L = parseLine(raw)
    if (!L.e) return fail(n, `Line ${n} cannot be read: it was changed or cut off.`)
    if (!L.h) {
      if (!pending.length) pendingStart = n
      pending.push(raw)
      continue
    }
    if (sha(L.body) !== L.h) return fail(n, `Line ${n} was changed after it was written.`)
    const e = L.e
    if (e.chain === 'start') {
      if (e.why === 'retention') {
        if (i !== 0 || (e.prev ?? null) !== null) return fail(n, `Line ${n} claims that older entries were removed, but it is not at the start of the file.`)
        segments++
        expected = e.continues || L.h
        head = expected
        continue
      }
      if (e.earlier) {
        if (pending.length !== e.earlier.lines || sha(pending.join('\n')) !== e.earlier.sha256) {
          return fail(pendingStart || n, `The ${e.earlier.lines} entr${e.earlier.lines === 1 ? 'y' : 'ies'} written before the record was sealed (above line ${n}) were changed, removed or added to.`)
        }
        sealedBefore += pending.length
        // Lines written in between by something that does not chain (an older
        // OpenLex, an edit) were sealed when OpenLex next wrote: say so.
        if (expected !== null) notes.push(`${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} at line ${pendingStart} ${pending.length === 1 ? 'was' : 'were'} written without a fingerprint (for example by an older version of OpenLex) and sealed afterwards.`)
        pending = []
      } else if (pending.length) return fail(pendingStart, `Line ${pendingStart} was added without being sealed.`)
      if ((e.prev ?? null) !== expected) return fail(n, `The chain does not link up at line ${n}: an entry before it was removed, moved or added.`)
      segments++
      expected = L.h
      head = L.h
      continue
    }
    if (pending.length) return fail(pendingStart, `Line ${pendingStart} was added without being sealed.`)
    if ((e.prev ?? null) !== expected) {
      return fail(n, i === 0 ? `Line 1 does not start the record: earlier entries were removed.` : `The chain does not link up at line ${n}: an entry before it was removed, moved or added.`)
    }
    if (i === 0) segments++
    entries++
    expected = L.h
    head = L.h
  }
  if (pending.length) notes.push(`${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} at the end (from line ${pendingStart}) ${pending.length === 1 ? 'has' : 'have'} no fingerprint yet; OpenLex seals ${pending.length === 1 ? 'it' : 'them'} the next time it writes.`)
  return { ok: true, lines: lines.length, entries, sealedBefore, unsealed: pending.length, segments, head, notes, broken: null }
}

/**
 * Retention: remove the lines older than `cutoffIso` from the start of a
 * file and start a new chain segment with a marker that says how many
 * entries were removed and from when to when. Refuses on a broken chain
 * (a removal must never hide a change). → { removed, from, to } | null
 */
function prune(file, cutoffIso, now = new Date()) {
  const v = verify(file)
  if (!v.ok) throw Object.assign(new Error(`The record in ${path.basename(file)} has a change in it (${v.broken.why}) — old entries were not removed. Export and keep it first.`), { code: 'CHAIN_BROKEN' })
  const lines = readLines(file).map(parseLine)
  // The cut: before the first line at or after the cutoff; never inside an
  // unsealed run (its seal marker below covers it).
  let k = lines.findIndex((L) => L.e && tsOf(L.e) >= cutoffIso)
  if (k < 0) k = lines.length
  while (k > 0 && !lines[k - 1].h) k--
  if (k === 0) return null
  const gone = lines.slice(0, k)
  const removedEntries = gone.filter((L) => L.e && L.e.chain !== 'start')
  const lastH = gone[gone.length - 1].h
  const stamps = removedEntries.map((L) => tsOf(L.e)).filter(Boolean).sort()
  const removed = { count: removedEntries.length, from: stamps[0] || null, to: stamps[stamps.length - 1] || null }
  const marker = chained({ ts: now.toISOString(), chain: 'start', why: 'retention', removed, continues: lastH }, null)
  const kept = lines.slice(k).map((L) => L.raw)
  const text = `${[marker.line, ...kept].join('\n')}\n`
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
  let h = lastH
  for (const L of lines.slice(k)) if (L.h) h = L.h
  heads.set(file, { h, size: Buffer.byteLength(text) })
  return removed
}

/** Forget what is in memory (tests; a file replaced from outside). */
function reset(file) { if (file) heads.delete(file); else heads.clear() }

module.exports = { append, seal, verify, prune, reset, parseLine, sha, tsOf }
