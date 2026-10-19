"use strict"
/**
 * OpenLex hub — the offline link between the Word plugin and the desktop app.
 *
 * Everything is local: discovery is a registry file, auth is a shared
 * token file (0600, same OS user), transport is localhost HTTP(S) + SSE.
 *
 *   ~/.lexvault/run/hub.token     shared secret, created by whoever starts first
 *   ~/.lexvault/run/sidecar.json  { url, pid, version, ca } — written by the sidecar
 *   ~/.lexvault/run/app.json      { pid, version, backend } — written by the desktop app
 *
 * Events (JSON, fan-out to every subscriber):
 *   insert-text        app → Word   { text, source?, matterId? }
 *   open-in-app        Word → app   { view: 'research'|'document', query?, docId?, matterId? }
 *   provider-changed   either way   {}
 *   policy-changed     either way   {}
 *   matter-changed     either way   { matterId? }
 *   hello              on connect   { from }
 *
 * The pane (same origin as the sidecar) uses /api/hub/* without a token;
 * other local processes must send Authorization: Bearer <hub.token>.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')

const RUN_DIR = path.join(DATA_DIR, 'run')
const TOKEN_PATH = path.join(RUN_DIR, 'hub.token')
const SIDECAR_REG = path.join(RUN_DIR, 'sidecar.json')
const APP_REG = path.join(RUN_DIR, 'app.json')
const EVENT_TYPES = new Set(['insert-text', 'open-in-app', 'provider-changed', 'policy-changed', 'matter-changed', 'hello'])

function ensureToken() {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  try {
    const t = fs.readFileSync(TOKEN_PATH, 'utf8').trim()
    if (/^[a-f0-9]{64}$/.test(t)) return t
  } catch { /* create below */ }
  const t = crypto.randomBytes(32).toString('hex')
  // wx: if the app created it in the meantime, use theirs.
  try { fs.writeFileSync(TOKEN_PATH, t, { mode: 0o600, flag: 'wx' }) } catch { return fs.readFileSync(TOKEN_PATH, 'utf8').trim() }
  return t
}

function tokenOk(req) {
  const h = String(req.headers.authorization || '')
  if (!h.startsWith('Bearer ')) return false
  const given = Buffer.from(h.slice(7).trim())
  const want = Buffer.from(ensureToken())
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function readReg(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'))
    return pidAlive(r.pid) ? r : null
  } catch { return null }
}

function register(info) {
  ensureToken()
  fs.writeFileSync(SIDECAR_REG, JSON.stringify({ ...info, pid: process.pid, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  const cleanup = () => {
    try {
      const r = JSON.parse(fs.readFileSync(SIDECAR_REG, 'utf8'))
      if (r.pid === process.pid) fs.rmSync(SIDECAR_REG, { force: true })
    } catch { /* gone */ }
  }
  process.on('exit', cleanup)
}

// ── event bus ────────────────────────────────────────────────────────────
const subscribers = new Set() // { res, from }
const recent = [] // last few events, replayed to late subscribers (e.g. pane opened after the app sent text)

function publish(type, data = {}, from = 'unknown') {
  if (!EVENT_TYPES.has(type)) throw new Error(`unknown hub event: ${type}`)
  const ev = { id: crypto.randomUUID(), type, from, ts: new Date().toISOString(), data }
  if (type === 'insert-text') {
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('insert-text needs text')
    if (data.text.length > 200000) throw new Error('insert-text too large')
    recent.push(ev)
    while (recent.length > 5) recent.shift()
  }
  for (const s of subscribers) {
    if (s.from === from) continue // don't echo to the sender
    try { s.res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch { subscribers.delete(s) }
  }
  return ev
}

function subscribe(req, res, from) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const sub = { res, from }
  subscribers.add(sub)
  res.write(`data: ${JSON.stringify({ type: 'hello', data: { peers: peers() } })}\n\n`)
  // Replay undelivered handoffs (acked ones are dropped via ack()).
  for (const ev of recent) if (ev.from !== from) res.write(`data: ${JSON.stringify(ev)}\n\n`)
  const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* closed */ } }, 25000)
  req.on('close', () => { clearInterval(ping); subscribers.delete(sub) })
}

function ack(id) {
  const i = recent.findIndex((e) => e.id === id)
  if (i >= 0) recent.splice(i, 1)
}

function peers() {
  const app = readReg(APP_REG)
  return {
    app: app ? { running: true, version: app.version || null } : { running: false },
    subscribers: [...subscribers].map((s) => s.from),
  }
}

module.exports = { ensureToken, tokenOk, register, publish, subscribe, ack, peers, readReg, RUN_DIR, TOKEN_PATH, SIDECAR_REG, APP_REG }
