"use strict"
/**
 * OpenLex engine — HTTP API for the Word add-in, CLI and desktop app (:18001).
 *
 * - Serves the add-in static files (taskpane, manifest assets)
 * - /api/chat: agent loop with SSE streaming (step/suggestion/text/done/error);
 *   /api/sessions, /api/session: the conversations every window shares
 * - /api/document/*: map, sections, full analyze
 * - /api/license/status, /api/jurisdictions, /api/packs, /api/status
 *
 * Only the license watchdog touches the network.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('./config')
const { ping: llmPing, testProvider, activeProvider } = require('./llm')
const providerSettings = require('./providers/settings')
const { PROVIDERS } = require('./providers/catalog')
const secrets = require('./secrets')
const policy = require('./policy')
const hub = require('./hub')
const matters = require('./matters')
const library = require('./library')
const mcpClient = require('./mcp/client')
const SIDECAR_VERSION = (() => { try { return require('../package.json').version } catch { return '0.0.0' } })()
const { ping: qdrantPing } = require('./search')
const { ensureQdrant, stop: stopQdrant } = require('./qdrant')
const { ensureLlama, stop: stopLlama, resolveModelPath } = require('./runtime')
const { LicenseWatchdog, loadToken, saveToken } = require('./license')
const { Updater } = require('./update')
const { Document } = require('./doc')
const { runAction } = require('./agent')
const packStore = require('./packstore')
const downloads = require('./downloads')
const embeddings = require('./embeddings')
const search = require('./search')

const watchdog = new LicenseWatchdog()
watchdog.start()

// Auto-updater — rides the license phone-home tick (the plugin's ONE
// outbound channel): every 6h with the license check, plus right after a
// token is saved. Check-only; download/apply are user-triggered via the
// pane (Settings → Update).
const updater = new Updater({
  onEvent: (e) => console.log('[updater]', e.kind, e.version || e.pct || ''),
})
setInterval(() => { if (loadToken()) updater.check().catch(() => {}) }, config.LICENSE_CHECK_INTERVAL_MS)
updater.check().catch(() => {}) // once at boot (no-op without token)

// Standalone services: attach to the App's when present, else spawn our own.
let qdrantState = { ok: false, owned: false, reason: 'not started' }
let llamaState = { ok: false, owned: false, reason: 'not started' }

// Orphan sweep — kill any leftover bundled llama/qdrant from a previous
// sidecar instance. Update restarts and abnormal exits can orphan the stack
// (a later instance ATTACHES instead of spawning, so its stop() has no proc
// to kill — 2026-08-12: Word quit left llama+qdrant running for hours).
// Matching the plugin's bundled binary paths never touches the App's own
// stack (separate bin dir). Runs at startup and on every shutdown path.
function sweepOrphans() {
  if (process.platform !== 'darwin') return
  const { execFileSync } = require('child_process')
  for (const pat of [
    '/Library/Application Support/LexVault/WordPlugin/bin/llama-server',
    '/Library/Application Support/LexVault/WordPlugin/bin/qdrant-darwin-arm64',
  ]) {
    try { execFileSync('/usr/bin/pkill', ['-f', pat], { stdio: 'ignore' }) } catch { /* nothing matched */ }
  }
}

const shutdown = () => { detachRunner(); stopQdrant(); stopLlama(); sweepOrphans(); process.exit(0) }
if (process.platform === 'darwin') sweepOrphans()
ensureQdrant().then((s) => { qdrantState = s; console.log('[sidecar] qdrant:', s.reason) })
// Only warm the local engine when it's the active provider — a firm on its
// own cloud key shouldn't pay ~3 GB of RAM for an idle llama-server.
if (require('./routing').usesLocal()) ensureLlama().then((s) => { llamaState = s; console.log('[sidecar] llama:', s.reason) })
else console.log(`[sidecar] model provider: ${activeProvider().id} (${activeProvider().model || 'default'}) — no route uses the local model, local engine not started`)

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// launchd restarts `launchctl submit` jobs when the process exits — so the
// watchdog-submitted runner job would resurrect the sidecar after every
// intentional shutdown (Word quit, update restart). Detach: remove the job
// so launchd has nothing to restart; the watchdog re-submits only when Word
// opens again.
function detachRunner() {
  if (process.platform !== 'darwin') return
  try {
    require('child_process').execFileSync('/bin/launchctl', ['remove', 'com.lexvault.word-sidecar-runner'], { stdio: 'ignore' })
  } catch { /* job already gone */ }
}

// Word-aware lifecycle (macOS only): the sidecar exists to serve the Word
// task pane. When Word quits, tear down the whole stack (children included)
// instead of idling in the background; the launchd watchdog restarts it the
// moment Word opens again. LEXVAULT_KEEPALIVE=1 escapes the monitor for dev.
if (process.platform === 'darwin' && !process.env.LEXVAULT_KEEPALIVE) {
  const { execFile } = require('child_process')
  let shuttingDown = false
  setInterval(() => {
    if (shuttingDown) return
    // Any front-end keeps the engine alive: Word, Outlook, or the desktop
    // App (hub registry run/app.json with a live pid).
    if (hub.readReg(hub.APP_REG)) return
    execFile('/usr/bin/pgrep', ['-f', '/(Microsoft Word|Microsoft Outlook)\\.app/'], (err) => {
      if (err && err.code !== 0 && !shuttingDown) {
        shuttingDown = true
        console.log('[sidecar] Word, Outlook and the OpenLex app are not running — shutting down stack')
        detachRunner()
        stopQdrant()
        stopLlama()
        sweepOrphans()
        setTimeout(() => process.exit(0), 1500)
      }
    })
  }, 15000)
}

// Word-aware lifecycle (Windows): the VBS launcher waits for Word, so this
// sidecar exists only while Word is (or was recently) open. When Word has
// been closed for 5 minutes: end the scheduled GPU llama (model unloads,
// VRAM freed) and exit — the VBS restarts everything the next time Word
// opens. LEXVAULT_KEEPALIVE=1 escapes the monitor for dev.
if (process.platform === 'win32' && !process.env.LEXVAULT_KEEPALIVE) {
  const { execFile } = require('child_process')
  let wordGoneSince = null
  setInterval(() => {
    if (hub.readReg(hub.APP_REG)) { wordGoneSince = null; return } // the desktop App needs the engine
    const child = execFile('tasklist', ['/fo', 'csv', '/nh'], { timeout: 5000, windowsHide: true }, (err, out) => {
      if (err) {
        // Command failed (timeout, permission, etc.) — treat as "Word not running"
        // but don't start the exit countdown on transient errors.
        console.warn('[sidecar] tasklist failed:', err.message)
        return
      }
      const outStr = String(out || '').trim()
      // Word, classic Outlook or new Outlook (olk.exe) keep the engine alive.
      const wordUp = /"(WINWORD|OUTLOOK|olk)\.EXE"/i.test(outStr)
      if (wordUp) {
        if (wordGoneSince !== null) console.log('[sidecar] Word re-detected — cancelling exit')
        wordGoneSince = null
      } else if (wordGoneSince === null) {
        wordGoneSince = Date.now()
        console.log('[sidecar] Word not detected (tasklist output:', JSON.stringify(outStr.slice(0, 100)), ') — starting 5 min exit countdown')
      } else if (Date.now() - wordGoneSince > 5 * 60 * 1000) {
        console.log('[sidecar] Word closed 5 min — unloading GPU llama + exiting')
        execFile('schtasks', ['/end', '/tn', 'llama-server'], { windowsHide: true }, () => {}) // frees VRAM
        stopQdrant()
        stopLlama()
        setTimeout(() => process.exit(0), 1500)
      }
    })
    // Safety: kill the tasklist process if it hangs (prevents zombie children)
    setTimeout(() => { try { child.kill() } catch {} }, 6000)
  }, 30000)
}

// ── helpers ────────────────────────────────────────────────────────────────
/**
 * Settings that decide where client data goes (provider, keys, data
 * policy) may only be changed by the add-in itself or a local process —
 * never by an arbitrary web page through the permissive CORS below.
 * Browsers always send Origin on cross-origin POSTs; local tools don't.
 */
function trustedOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  if (TRUSTED_ORIGINS.has(origin)) return true
  try {
    const u = new URL(origin)
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && String(u.port || (u.protocol === 'https:' ? 443 : 80)) === String(config.PORT)
  } catch { return false }
}

// Extra origins allowed to call the sidecar (the desktop app's renderer,
// dev servers): OPENLEX_TRUSTED_ORIGINS="http://localhost:5173,app://openlex"
const TRUSTED_ORIGINS = new Set(String(process.env.OPENLEX_TRUSTED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean))

// One library sync at a time; callers share the in-flight run.
let librarySyncing = null
function runLibrarySync() {
  if (!librarySyncing) librarySyncing = library.sync().finally(() => { librarySyncing = null })
  return librarySyncing
}
function logLibrarySync(r) {
  if (r.indexed || r.removed || r.errors.length) console.log(`[library] sync: ${r.indexed} indexed, ${r.removed} removed, ${r.errors.length} errors`)
}

/** Matter for a request: explicit, else the one this document is bound to. */
function matterIdFor(body, entry) {
  if (body.matterId) return body.matterId
  const docId = body.docId || entry?.doc?.docId
  return matters.forDoc(docId)?.id || null
}

/** Local engine only matters when the active provider is local. */
async function engineReady() {
  if (!require('./routing').usesLocal()) return { ok: true, reason: `cloud provider ${activeProvider().id}` }
  try { llamaState = await ensureLlama() } catch { llamaState = { ok: false, reason: 'llama-server failed to start' } }
  return llamaState
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function sendSse(res, event) {
  // Client disconnected mid-stream (pane closed, Word reloaded): writes to
  // a destroyed socket can raise an 'error' on the response — one unhandled
  // one kills the whole sidecar mid-analysis. Guard both sides: swallow
  // response errors at the router and skip writes once the socket is gone.
  if (!res || res.destroyed || res.writableEnded) return
  // Steps the engine itself emits get their plain sentence here (explain.js).
  require('./explain').withPlain(event)
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

/** Who sent a request, for hub events (the pane is same-origin; local programs name themselves). */
function clientOf(req) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return 'word'
  return String(req.headers['x-openlex-client'] || 'local').replace(/[^\w-]/g, '').slice(0, 20) || 'local'
}

/**
 * Permission session for a streamed run (permissions.js). Only a front end
 * that says it can answer (`interactive: true`) is asked; for everyone else
 * an "ask" is a deny. `allow` (patterns) and `yes` pre-approve asks for this
 * run only (CLI --allow / --yes); deny rules still win.
 */
function permissionSession(body, res, signal) {
  return {
    ask: body.interactive === true ? (e) => sendSse(res, e) : null,
    signal,
    allow: Array.isArray(body.allow) ? body.allow.filter((x) => typeof x === 'string').slice(0, 50) : [],
    yes: body.yes === true,
  }
}

/**
 * The working folder of a request (body.folder, folder.js): checked, or an
 * Error with a plain sentence. The whole home folder or the whole computer
 * needs body.folderConfirmed (the front end asked the lawyer). No folder → null.
 */
function folderFor(body) {
  if (body.folder === undefined || body.folder === null || body.folder === '') return null
  const c = require('./folder').check(body.folder)
  if (!c.ok) throw new Error(c.error)
  if (c.broad && body.folderConfirmed !== true) throw new Error(`${c.broad === 'home' ? 'That is your whole home folder' : 'That is the whole computer'} (${c.short}). Choose the folder of one client or matter, or confirm it (folderConfirmed).`)
  return c.path
}

function readBody(req, limitMb = 5) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limitMb * 1024 * 1024) { reject(new Error('body too large')); req.destroy() }
      else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch { reject(new Error('invalid JSON')) }
    })
    req.on('error', reject)
  })
}

// Active document store (single active doc per sidecar instance is fine —
// Word is a single-document-per-window app, and the pane is per-doc).
const activeDocs = new Map()

function getDoc(body) {
  const key = body.docId || body.documentId || 'current'
  let entry = activeDocs.get(key)
  if (!entry) { entry = { doc: null, memory: null }; activeDocs.set(key, entry) }
  return entry
}

// ── router ─────────────────────────────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  // CORS: the pane is same-origin (served by this sidecar). Only local,
  // explicitly trusted origins get CORS headers, and any request carrying a
  // foreign Origin is refused outright — a web page could otherwise drive
  // the agent (and the lawyer's files) with a no-preflight "simple" POST.
  if (!trustedOrigin(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'forbidden origin' }))
  }
  if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  // Swallow writes to a socket the client already closed (sendSse also
  // checks destroyed/writableEnded before each write).
  res.on('error', () => {})
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  try {
    // Static add-in assets
    if (p === '/' || p.startsWith('/taskpane') || p.startsWith('/commands') || p.startsWith('/assets/') || p.startsWith('/lib/') || p.startsWith('/outlook')) {
      const file = p === '/' ? '/taskpane.html' : p
      const fp = path.normalize(path.join(config.ADDIN_ROOT, file))
      if (!fp.startsWith(config.ADDIN_ROOT)) return sendJson(res, 403, { error: 'forbidden' })
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'not found' })
      const ext = path.extname(fp)
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.xml': 'text/xml' }
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
      return fs.createReadStream(fp).pipe(res)
    }

    if (req.method === 'GET' && p === '/health') {
      return sendJson(res, 200, { ok: true, sidecar: SIDECAR_VERSION })
    }

    if (req.method === 'GET' && p === '/api/status') {
      const llm = await llmPing()
      const qd = await qdrantPing()
      const embHealth = await embeddings.appHealth()
      return sendJson(res, 200, {
        model: { loaded: llm.ok, name: llm.models?.[0] || config.LLM_MODEL, error: llm.error || null, provider: activeProvider().id, local: !!activeProvider().local },
        llamaState,
        modelFile: resolveModelPath(),
        qdrant: qd,
        qdrantState,
        embeddingsBackend: embeddings.backendName(),
        embeddingsAttach: embHealth.ok ? { attached: true, status: embHealth.status } : { attached: false, error: embHealth.error },
        license: watchdog.state,
        packs: packStore.scanPacks().length,
      })
    }

    // Setup state for the first-run flow: token, model, packs.
    // ── Hub: offline link with the desktop app ──────────────────────────
    // Pane (same origin, browser sets Sec-Fetch-Site) or a local process
    // holding ~/.lexvault/run/hub.token.
    if (p.startsWith('/api/hub/')) {
      const pane = req.headers['sec-fetch-site'] === 'same-origin'
      if (!pane && !hub.tokenOk(req)) return sendJson(res, 401, { error: 'hub token required' })
      const from = pane ? 'word' : String(req.headers['x-openlex-client'] || 'local').slice(0, 20)
      if (req.method === 'GET' && p === '/api/hub/info') {
        const ap = activeProvider()
        return sendJson(res, 200, {
          version: SIDECAR_VERSION, provider: { id: ap.id, model: ap.model || null, local: !!ap.local },
          policy: policy.ruleFor(null), peers: hub.peers(),
        })
      }
      if (req.method === 'GET' && p === '/api/hub/events') return hub.subscribe(req, res, from)
      if (req.method === 'POST' && p === '/api/hub/events') {
        const body = await readBody(req, 2)
        try { return sendJson(res, 200, { ok: true, event: hub.publish(body.type, body.data || {}, from) }) }
        catch (err) { return sendJson(res, 400, { error: err.message }) }
      }
      if (req.method === 'POST' && p === '/api/hub/ack') {
        const body = await readBody(req)
        hub.ack(body.id)
        return sendJson(res, 200, { ok: true })
      }
      return sendJson(res, 404, { error: 'not found' })
    }

    // ── Web: the lawyer signs in to sites in a visible browser window ────
    if (req.method === 'POST' && p === '/api/web/login') {
      const body = await readBody(req)
      try { return sendJson(res, 200, await require('./web/browser').openForLogin(body.url)) }
      catch (err) { return sendJson(res, 400, { error: err.message }) }
    }

    // ── Outlook: file an email into a matter (searchable + in workflows) ─
    if (req.method === 'POST' && p === '/api/mail/file') {
      const body = await readBody(req, 20)
      try {
        const m = matters.get(body.matterId)
        if (!m) throw new Error('pick a matter first')
        const ws = require('./workspace')
        ws.setBase(require('./agent-config').load().workspace)
        const date = String(body.date || new Date().toISOString()).slice(0, 10)
        const subject = String(body.subject || '(no subject)').slice(0, 200)
        const safe = subject.replace(/[^\p{L}\p{N} _.-]+/gu, '_').slice(0, 80).trim() || 'email'
        const folder = `${ws.matterFolder(m.number ? `${m.number} ${m.title}` : m.title)}/mail`
        const md = [`# ${subject}`, '', `From: ${body.from || ''}`, `To: ${body.to || ''}`, `Date: ${body.date || ''}`, '', '---', '', String(body.body || '')].join('\n')
        const file = ws.writeFile(`${folder}/${date} ${safe}.md`, md)
        // Register the matter's mail folder in the firm library once; index now.
        const mailDir = path.dirname(file)
        if (!library.status().folders.some((f) => f.path === mailDir)) library.addFolder(mailDir, m.id)
        runLibrarySync().catch(() => {})
        hub.publish('matter-changed', { matterId: m.id }, 'word')
        return sendJson(res, 200, { ok: true, file })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // ── Workflows over a whole matter (Phase 4) ──────────────────────────
    if (req.method === 'GET' && p === '/api/workflows/playbooks') {
      const ws = require('./workspace')
      const wf = require('./workflows')
      const list = [{ name: '', title: wf.DEFAULT_PLAYBOOK.title, builtIn: true }]
      const firm = new Set()
      for (const f of ws.listFiles('playbooks')) {
        const name = path.basename(String(f.path || f), '.json')
        try { const pb = wf.loadPlaybook(name); list.push({ name, title: pb.title, checks: pb.checks.length, firm: true }); firm.add(name) } catch { /* regex playbook or invalid */ }
      }
      for (const name of wf.bundledPlaybooks()) {
        if (firm.has(name)) continue // the firm's own version replaces the bundled one
        try { const pb = wf.loadPlaybook(name); list.push({ name, title: pb.title, checks: pb.checks.length, builtIn: true }) } catch { /* invalid */ }
      }
      return sendJson(res, 200, { playbooks: list })
    }
    // ── Clause library (the firm's own clauses, from the firm library) ───
    if (req.method === 'GET' && p === '/api/clauses') {
      const cl = require('./clauses')
      const matterId = url.searchParams.get('matterId') || null
      const type = url.searchParams.get('type') || null
      const q = url.searchParams.get('q') || ''
      return sendJson(res, 200, { ...cl.overview(matterId), clauses: type || q ? cl.search({ type, query: q, matterId, limit: 12 }) : [] })
    }
    if (req.method === 'GET' && p === '/api/workflows/documents') {
      const wf = require('./workflows')
      const matterId = url.searchParams.get('matterId') || null
      const files = wf.listDocs(wf.matterFolders(matterId)).map((f) => ({ name: path.basename(f), path: f }))
      return sendJson(res, 200, { documents: files, languages: require('./workflows_docs').LANGS })
    }
    if (req.method === 'POST' && p === '/api/workflows/run') {
      const body = await readBody(req)
      const wf = require('./workflows')
      const docs = require('./workflows_docs')
      const analyse = require('./analysis').runAnalyse
      const run = { review: wf.runReview, chronology: wf.runChronology, translate: docs.runTranslate, compare: docs.runCompare, analyse, analyze: analyse }[body.type]
      if (!run) return sendJson(res, 400, { error: 'type must be review, chronology, translate, compare or analyse' })
      // analyse with docId: the Word document the pane has mapped (its text, its title in the matter).
      let wordDoc = null
      if (run === analyse && body.docId && !body.file && !(Array.isArray(body.files) && body.files.length)) {
        const entry = activeDocs.get(body.docId)
        if (!entry?.doc) return sendJson(res, 400, { error: 'that Word document is not open in OpenLex (map it first), or pass files' })
        const bound = matters.forDoc(body.docId)?.docs?.find((d) => d.docId === body.docId)
        wordDoc = { text: entry.doc.text, name: String(body.title || bound?.title || 'Word document') }
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      let folderDir
      try { folderDir = folderFor(body) } catch (err) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
      const ready = await engineReady()
      if (!ready?.ok) { sendSse(res, { type: 'error', message: `model unavailable: ${ready.reason}` }); return res.end() }
      const ac = new AbortController()
      res.on('close', () => ac.abort())
      const matterId = body.matterId || matterIdFor(body, null)
      require('./workspace').setBase(require('./agent-config').load().workspace)
      // Activity record + `model` events: what was read and where data went.
      const rec = require('./activity').start({ matterId, kind: body.type, asked: [body.playbook, body.target].filter(Boolean).join(' · '), client: clientOf(req), files: [body.file, body.fileA, body.fileB].filter(Boolean) })
      const out = (e) => { rec.see(e); sendSse(res, e) }
      try {
        const r = await rec.run(() => require('./folder').run(folderDir, () => policy.observeModels((m) => out({ type: 'model', ...m }), () => policy.withMatter(matterId, () => run({
          matterId, folder: folderDir || undefined, playbook: body.playbook, signal: ac.signal,
          file: body.file, target: body.target, glossary: body.glossary, fileA: body.fileA, fileB: body.fileB, rate: body.rate !== false,
          files: Array.isArray(body.files) ? body.files : undefined, ...(wordDoc || {}),
          onProgress: (ev) => out({ type: 'progress', ...ev }),
        })))))
        out({ type: 'done', files: r.files, stats: r.stats, count: r.count ?? (r.findings || r.events || r.changes || r.flags || []).length, ...(r.summary ? { summary: r.summary } : {}), ...(r.analyses ? { analyses: r.analyses } : {}) })
        rec.finish({ aborted: ac.signal.aborted, files: r.files || [] })
        require('./hooks').run('after_workflow', { workflow: body.type, files: r.files, stats: r.stats, matterId }).catch(() => {})
      } catch (err) {
        out({ type: 'error', message: err.message })
        rec.finish({ error: err.message })
      }
      return res.end()
    }

    if (req.method === 'GET' && p === '/api/models') {
      require('./workspace').setBase(require('./agent-config').load().workspace)
      const models = require('./models')
      const model = url.searchParams.get('model')
      if (model) return sendJson(res, 200, { profile: models.profileFor({ kind: url.searchParams.get('kind') || 'hosted', model }) })
      return sendJson(res, 200, { profiles: models.all(), generic: models.GENERIC, roles: models.explain({ matterId: url.searchParams.get('matterId') || null }), problems: models.validate(require('./harness').load().models) })
    }
    if (req.method === 'GET' && p === '/api/prompts') {
      require('./workspace').setBase(require('./agent-config').load().workspace)
      const pr = require('./prompts')
      return sendJson(res, 200, { ...pr.explain(url.searchParams.get('message') || '', { afterTool: url.searchParams.get('afterTool') || null, docFull: url.searchParams.get('docFull') === '1' }), blocks: pr.blocks().map((b) => ({ id: b.id, when: b.when || null, origin: b.origin, tokens: require('./compress').estimateTokens(b.text) })) })
    }
    // The chat commands, one list for the terminal app, Word and the desktop app (commands.js).
    if (p === '/api/commands') {
      const r = require('./commands').handle(req.method, p, url.searchParams)
      return sendJson(res, r.status, r.json)
    }
    if (req.method === 'GET' && p === '/api/agents') {
      require('./workspace').setBase(require('./agent-config').load().workspace)
      return sendJson(res, 200, { agents: require('./agents').list() })
    }
    // ── Data sources (the firm's databases and subscriptions) ──────────
    if (p === '/api/sources' || p.startsWith('/api/sources/')) {
      const src = require('./sources')
      require('./workspace').setBase(require('./agent-config').load().workspace)
      try {
        const law = require('./connectors')
        // Law sources (connectors/): one plain list for every front end.
        if (req.method === 'GET' && p === '/api/sources/law') return sendJson(res, 200, { sources: await law.status({ matterId: url.searchParams.get('matterId') || null }) })
        if (req.method === 'GET' && p === '/api/sources') return sendJson(res, 200, { law: await law.status({ matterId: url.searchParams.get('matterId') || null }), sources: src.list(), presets: Object.keys(src.PRESETS), kinds: src.KINDS, types: src.TYPES })
        if (req.method === 'GET' && p === '/api/sources/law/signin') return sendJson(res, 200, law.signInStatus(url.searchParams.get('name')))
        if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' })
        const body = await readBody(req)
        const matterId = body.matterId || null
        // Browser sign-in (Ansvar): start (code + page), then poll the GET above.
        if (p === '/api/sources/law/signin') return sendJson(res, 200, await law.signIn(body.name, { open: body.open !== false }))
        if (p === '/api/sources/law/signin/cancel') return sendJson(res, 200, law.cancelSignIn(body.name))
        if (p === '/api/sources/law/nightcopy') return sendJson(res, 200, law.setNightCopy(body.name, body.on !== false))
        const isLaw = law.IDS.includes(String(body.name || body.source || '').toLowerCase())
        if (p === '/api/sources/law/search') return sendJson(res, 200, await policy.withMatter(matterId, () => law.search(body)))
        if (p === '/api/sources/law/get') return sendJson(res, 200, await policy.withMatter(matterId, () => law.get(body)))
        if (p === '/api/sources/enable') return sendJson(res, 200, law.setEnabled(body.name, body.on !== false))
        if (p === '/api/sources/test' && isLaw) return sendJson(res, 200, await policy.withMatter(matterId, () => law.test(body.name, body.query)))
        if (p === '/api/sources/key' && isLaw) return sendJson(res, 200, await law.setKey(body.name, body.key))
        if (p === '/api/sources/search') return sendJson(res, 200, await policy.withMatter(matterId, () => src.search(body)))
        if (p === '/api/sources/test') return sendJson(res, 200, await policy.withMatter(matterId, () => src.test(body.name, body.query)))
        if (p === '/api/sources/add') return sendJson(res, 200, { source: src.add(body.name, body.source) })
        if (p === '/api/sources/remove') { src.remove(body.name); return sendJson(res, 200, { ok: true }) }
        if (p === '/api/sources/key') {
          if (body.key === null || body.key === '') await secrets.deleteKey(`source-${body.name}`)
          else await secrets.setKey(`source-${body.name}`, body.key)
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        return sendJson(res, 400, { error: err.plain || err.message })
      }
    }
    // ── Permissions: what the agent may do without asking ───────────────
    if (p === '/api/permissions' || p.startsWith('/api/permissions/')) {
      const perms = require('./permissions')
      require('./workspace').setBase(require('./agent-config').load().workspace)
      try {
        if (req.method === 'GET' && p === '/api/permissions') return sendJson(res, 200, perms.describe())
        if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' })
        const body = await readBody(req)
        if (p === '/api/permissions/answer') {
          const r = perms.answer(body.id, body.decision)
          return sendJson(res, r.ok ? 200 : 404, r)
        }
        if (p === '/api/permissions/rules') {
          const matterId = body.matterId || null
          if (body.action === 'remove') return sendJson(res, 200, { removed: perms.removeRule(body.pattern, { matterId }), ...perms.describe() })
          perms.addRule(body.action, body.pattern, { matterId })
          return sendJson(res, 200, perms.describe())
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // Feature switches only (openlex.json → features): front ends hide what a firm turned off.
    if (req.method === 'GET' && p === '/api/features') {
      try {
        require('./workspace').setBase(require('./agent-config').load().workspace)
        return sendJson(res, 200, { features: require('./harness').load().features || {} })
      } catch (err) { return sendJson(res, 200, { features: {}, error: err.message }) }
    }

    // ── Harness map (routes, hooks, agents, features — layered config) ───
    if (p === '/api/harness' || p.startsWith('/api/harness/')) {
      const harness = require('./harness')
      const routing = require('./routing')
      require('./workspace').setBase(require('./agent-config').load().workspace)
      try {
        if (req.method === 'GET' && p === '/api/harness') {
          const matterId = url.searchParams.get('matterId') || null
          const agentName = url.searchParams.get('agent') || null
          const cfg = harness.load()
          return sendJson(res, 200, { config: cfg, userLayer: harness.layers().user.data || {}, errors: harness.errors(), problems: [...routing.validate(cfg.routes), ...require('./hooks').validate(cfg.hooks), ...require('./agents').validate(cfg.agents), ...require('./sources').validate(cfg.sources), ...require('./models').validate(cfg.models), ...require('./prompts').validate(cfg.prompts), ...require('./permissions').validate(cfg.permissions)], agents: require('./agents').list(), routes: routing.explain({ matterId, agent: agentName }), roles: routing.ROLES, providers: Object.entries(require('./providers/catalog').PROVIDERS).map(([id, x]) => ({ id, label: x.label, local: !!x.local })), hookEvents: require('./hooks').EVENTS, files: { firm: harness.layers().firm.path, user: harness.USER_PATH } })
        }
        if (req.method === 'POST' && p === '/api/harness/section') {
          const body = await readBody(req)
          if (body.value && ['routes', 'hooks', 'agents', 'sources', 'models', 'prompts', 'permissions'].includes(body.section)) { const problems = body.section === 'routes' ? routing.validate(body.value) : body.section === 'hooks' ? require('./hooks').validate(body.value) : body.section === 'sources' ? require('./sources').validate(body.value) : body.section === 'models' ? require('./models').validate(body.value) : body.section === 'prompts' ? require('./prompts').validate(body.value) : body.section === 'permissions' ? require('./permissions').validate(body.value) : require('./agents').validate(body.value); if (problems.length) return sendJson(res, 400, { error: problems.join('; '), problems }) }
          const saved = harness.setUserSection(body.section, body.value ?? null)
          if (body.section === 'permissions') hub.publish('permissions-changed', {}, clientOf(req))
          return sendJson(res, 200, { config: saved })
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // ── Lists (matter checklists and trackers, audited) ──────────────────
    if (p === '/api/lists' || p.startsWith('/api/lists/')) {
      const lists = require('./lists')
      require('./workspace').setBase(require('./agent-config').load().workspace)
      try {
        if (req.method === 'GET' && p === '/api/lists') {
          const matterId = url.searchParams.has('matterId') ? (url.searchParams.get('matterId') || null) : undefined
          return sendJson(res, 200, { lists: lists.all(matterId), statuses: lists.STATUSES })
        }
        if (req.method === 'GET' && p === '/api/lists/get') return sendJson(res, 200, { list: lists.get(url.searchParams.get('id')) })
        if (req.method === 'GET' && p === '/api/lists/sources') return sendJson(res, 200, { sources: lists.sources(url.searchParams.get('matterId') || null) })
        if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' })
        const body = await readBody(req)
        const by = body.by || undefined
        if (p === '/api/lists') return sendJson(res, 200, { list: lists.create({ ...body, by }) })
        if (p === '/api/lists/rename') return sendJson(res, 200, { list: lists.rename(body.id, body.title, by) })
        if (p === '/api/lists/delete') { lists.remove(body.id); return sendJson(res, 200, { ok: true }) }
        if (p === '/api/lists/items') return sendJson(res, 200, { item: lists.addItem(body.id, body.item || {}, by) })
        if (p === '/api/lists/items/update') return sendJson(res, 200, { item: lists.updateItem(body.id, body.itemId, body.patch || {}, by) })
        if (p === '/api/lists/items/delete') { lists.removeItem(body.id, body.itemId, by); return sendJson(res, 200, { ok: true }) }
        if (p === '/api/lists/seed') { const r = lists.seedFromFile(body.id, body.file, { all: !!body.all }, by); return sendJson(res, 200, { added: r.added, list: r.list }) }
        if (p === '/api/lists/export') return sendJson(res, 200, lists.exportList(body.id))
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // ── Monitors (watch official sources) ───────────────────────────────
    if (p === '/api/monitors' || p.startsWith('/api/monitors/')) {
      const mon = require('./monitors')
      try {
        if (req.method === 'GET' && p === '/api/monitors') {
          const matterId = url.searchParams.has('matterId') ? (url.searchParams.get('matterId') || null) : undefined
          return sendJson(res, 200, { monitors: mon.list(matterId), types: mon.TYPES })
        }
        if (req.method === 'GET' && p === '/api/monitors/alerts') {
          const matterId = url.searchParams.has('matterId') ? (url.searchParams.get('matterId') || null) : undefined
          return sendJson(res, 200, { alerts: mon.alerts({ matterId, unread: url.searchParams.get('unread') === '1' }) })
        }
        if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' })
        const body = await readBody(req)
        if (p === '/api/monitors') return sendJson(res, 200, { monitor: mon.create(body) })
        if (p === '/api/monitors/update') return sendJson(res, 200, { monitor: mon.update(body.id, body.patch || {}) })
        if (p === '/api/monitors/delete') { mon.remove(body.id); return sendJson(res, 200, { ok: true }) }
        if (p === '/api/monitors/check') return sendJson(res, 200, body.id ? await mon.check(body.id) : { results: await mon.checkDue(0) })
        if (p === '/api/monitors/alerts/read') return sendJson(res, 200, { unread: mon.markRead(body.ids || 'all') })
        if (p === '/api/monitors/alerts/file') {
          require('./workspace').setBase(require('./agent-config').load().workspace)
          return sendJson(res, 200, { file: mon.fileAlert(body.id) })
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // ── Plans (propose → lawyer approves → run, with checkpoints) ───────
    if (p === '/api/plans' || p.startsWith('/api/plans/')) {
      const planMod = require('./plan')
      require('./workspace').setBase(require('./agent-config').load().workspace)
      try {
        if (req.method === 'GET' && p === '/api/plans') {
          const matterId = url.searchParams.has('matterId') ? (url.searchParams.get('matterId') || null) : undefined
          return sendJson(res, 200, { plans: planMod.list(matterId), kinds: planMod.KINDS })
        }
        if (req.method === 'GET' && p === '/api/plans/get') return sendJson(res, 200, { plan: planMod.get(url.searchParams.get('id')) })
        if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' })
        const body = await readBody(req)
        if (p === '/api/plans') {
          const ready = await engineReady()
          if (!ready?.ok) return sendJson(res, 503, { error: `model unavailable: ${ready.reason}` })
          const matterId = body.matterId || null
          return sendJson(res, 200, { plan: await policy.withMatter(matterId, () => planMod.propose({ goal: body.goal, matterId, documents: body.documents })) })
        }
        if (p === '/api/plans/update') return sendJson(res, 200, { plan: planMod.update(body.id, body) })
        if (p === '/api/plans/approve') return sendJson(res, 200, { plan: planMod.approve(body.id) })
        if (p === '/api/plans/decide') return sendJson(res, 200, { plan: planMod.decide(body.id, body) })
        if (p === '/api/plans/run') {
          const plan = planMod.get(body.id)
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
          let folderDir
          try { folderDir = folderFor(body) } catch (err) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
          const ready = await engineReady()
          if (!ready?.ok) { sendSse(res, { type: 'error', message: `model unavailable: ${ready.reason}` }); return res.end() }
          const ac = new AbortController()
          res.on('close', () => ac.abort())
          const rec = require('./activity').start({ matterId: plan.matterId, kind: 'plan', asked: plan.goal || '', client: clientOf(req) })
          const out = (e) => { rec.see(e); sendSse(res, e) }
          try {
            const r = await rec.run(() => require('./folder').run(folderDir, () => require('./permissions').session(permissionSession(body, res, ac.signal), () => policy.observeModels((m) => out({ type: 'model', ...m }), () => policy.withMatter(plan.matterId, () => planMod.run(body.id, { signal: ac.signal, onProgress: (ev) => out({ type: 'progress', ...ev }) }))))))
            out({ type: 'done', status: r.status, report: r.report || null, waiting: r.steps.find((x) => x.status === 'waiting') || null })
            rec.finish({ aborted: ac.signal.aborted, files: [r.report, ...r.steps.flatMap((x) => x.result?.files || [])] })
            if (r.status === 'done' || r.status === 'failed') require('./hooks').run('after_workflow', { workflow: 'plan', files: [r.report, ...r.steps.flatMap((x) => x.result?.files || [])].filter(Boolean), stats: { status: r.status, steps: r.steps.length }, matterId: plan.matterId }).catch(() => {})
          } catch (err) {
            out({ type: 'error', message: err.message })
            rec.finish({ error: err.message })
          }
          return res.end()
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        if (res.headersSent) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
        return sendJson(res, err.code === 'POLICY_BLOCKED' ? 403 : 400, { error: err.message })
      }
    }

    // ── Skills (firm instructions as SKILL.md files) ─────────────────────
    if (p === '/api/skills' || p.startsWith('/api/skills/')) {
      const skillsMod = require('./skills')
      require('./workspace').setBase(require('./agent-config').load().workspace)
      try {
        if (req.method === 'GET' && p === '/api/skills') {
          return sendJson(res, 200, { skills: skillsMod.list().map(({ body, file, ...rest }) => rest) })
        }
        if (req.method === 'GET' && p === '/api/skills/get') {
          const sk = skillsMod.get(url.searchParams.get('name'))
          return sendJson(res, 200, { skill: sk, content: skillsMod.render(sk) })
        }
        if (req.method === 'GET' && p === '/api/skills/suggest') {
          return sendJson(res, 200, { suggestion: await skillsMod.suggest(url.searchParams.get('q') || '') })
        }
        if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' })
        const body = await readBody(req)
        if (p === '/api/skills') return sendJson(res, 200, { skill: skillsMod.save(body.content) })
        if (p === '/api/skills/delete') { skillsMod.remove(body.name); return sendJson(res, 200, { ok: true }) }
        if (p === '/api/skills/draft') {
          const ready = await engineReady()
          if (!ready?.ok) return sendJson(res, 503, { error: `model unavailable: ${ready.reason}` })
          return sendJson(res, 200, await policy.withMatter(body.matterId || null, () => skillsMod.draft(body)))
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        return sendJson(res, err.code === 'POLICY_BLOCKED' ? 403 : 400, { error: err.message })
      }
    }
    if (req.method === 'POST' && p === '/api/workflows/playbooks/draft') {
      const body = await readBody(req)
      try {
        const ready = await engineReady()
        if (!ready?.ok) return sendJson(res, 503, { error: `model unavailable: ${ready.reason}` })
        const matterId = body.matterId || null
        return sendJson(res, 200, await policy.withMatter(matterId, () => require('./workflows').draftPlaybook({ ...body, matterId })))
      } catch (err) {
        return sendJson(res, err.code === 'POLICY_BLOCKED' ? 403 : 400, { error: err.message })
      }
    }
    if (req.method === 'POST' && p === '/api/workflows/playbooks') {
      const body = await readBody(req)
      try { return sendJson(res, 200, require('./workflows').savePlaybook(body.name, body.playbook)) } catch (err) { return sendJson(res, 400, { error: err.message }) }
    }

    // ── Decision models (System One API: Kev, our own, Jev) ─────────────
    if (p === '/api/decide' || p.startsWith('/api/decide/')) {
      const decide = require('./decide')
      try {
        if (req.method === 'GET' && p === '/api/decide/config') {
          return sendJson(res, 200, { config: decide.loadConfig(), endpoint: decide.descriptor(), hasKey: await secrets.hasKey('decide') })
        }
        if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' })
        const body = await readBody(req)
        if (p === '/api/decide/config') return sendJson(res, 200, { config: decide.saveConfig(body.clear ? null : body), endpoint: decide.descriptor() })
        if (p === '/api/decide/key') {
          if (body.key === null || body.key === '') await secrets.deleteKey('decide')
          else await secrets.setKey('decide', body.key)
          return sendJson(res, 200, { ok: true, hasKey: await secrets.hasKey('decide') })
        }
        const matterId = body.matterId || matterIdFor(body, null)
        if (p === '/api/decide/test') return sendJson(res, 200, await policy.withMatter(matterId, () => decide.test()))
        if (p === '/api/decide') {
          const r = await policy.withMatter(matterId, () => decide.systemOne({ state: body.state, questions: body.questions }))
          return sendJson(res, 200, { ...r, summary: decide.summarize(r.answers) })
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        return sendJson(res, err.code === 'POLICY_BLOCKED' ? 403 : 400, { error: err.message, ...(err.code ? { code: err.code } : {}) })
      }
    }

    // ── Review grid (rows = documents, columns = questions) ──────────────
    if (p === '/api/grids' || p.startsWith('/api/grids/')) {
      const grid = require('./grid')
      try {
        if (req.method === 'GET' && p === '/api/grids') {
          const matterId = url.searchParams.has('matterId') ? (url.searchParams.get('matterId') || null) : undefined
          return sendJson(res, 200, { grids: grid.list(matterId), types: grid.TYPES })
        }
        if (req.method === 'GET' && p === '/api/grids/view') return sendJson(res, 200, grid.view(url.searchParams.get('id')))
        if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' })
        const body = await readBody(req)
        if (p === '/api/grids') {
          const g = grid.create({ matterId: body.matterId || matterIdFor(body, null), title: body.title, columns: body.columns, documents: body.documents })
          return sendJson(res, 200, grid.view(g.id))
        }
        if (p === '/api/grids/update') { grid.update(body.id, body.patch || {}); return sendJson(res, 200, grid.view(body.id)) }
        if (p === '/api/grids/cell') return sendJson(res, 200, { cell: grid.setCell(body.id, body) })
        if (p === '/api/grids/delete') { grid.remove(body.id); return sendJson(res, 200, { ok: true }) }
        if (p === '/api/grids/export') {
          require('./workspace').setBase(require('./agent-config').load().workspace)
          return sendJson(res, 200, grid.exportGrid(body.id))
        }
        if (p === '/api/grids/run') {
          const g = grid.get(body.id)
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
          let folderDir
          try { folderDir = folderFor(body) } catch (err) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
          const ready = await engineReady()
          if (!ready?.ok) { sendSse(res, { type: 'error', message: `model unavailable: ${ready.reason}` }); return res.end() }
          const ac = new AbortController()
          res.on('close', () => ac.abort())
          const rec = require('./activity').start({ matterId: g.matterId, kind: 'grid', asked: g.title || '', client: clientOf(req) })
          const out = (e) => { rec.see(e); sendSse(res, e) }
          try {
            const r = await rec.run(() => require('./folder').run(folderDir, () => policy.observeModels((m) => out({ type: 'model', ...m }), () => policy.withMatter(g.matterId, () => grid.run(body.id, {
              documents: body.documents, columns: body.columns, force: !!body.force, signal: ac.signal,
              onProgress: (ev) => out({ type: 'progress', ...ev }),
            })))))
            out({ type: 'done', stats: r.stats })
            rec.finish({ aborted: ac.signal.aborted })
            require('./hooks').run('after_workflow', { workflow: 'grid', files: [], stats: r.stats, matterId: g.matterId }).catch(() => {})
          } catch (err) {
            out({ type: 'error', message: err.message })
            rec.finish({ error: err.message })
          }
          return res.end()
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        if (res.headersSent) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
        return sendJson(res, 400, { error: err.message })
      }
    }

    // ── Connectors (MCP servers) ─────────────────────────────────────────
    if (req.method === 'GET' && p === '/api/mcp') {
      return sendJson(res, 200, { servers: mcpClient.status(), configPath: mcpClient.CONFIG_PATH })
    }
    if (req.method === 'POST' && p.startsWith('/api/mcp')) {
      const body = await readBody(req)
      try {
        if (p === '/api/mcp/servers') mcpClient.upsertServer(body.name, body.config || {})
        else if (p === '/api/mcp/servers/remove') mcpClient.removeServer(body.name)
        else if (p !== '/api/mcp/reconnect') return sendJson(res, 404, { error: 'not found' })
        return sendJson(res, 200, { ok: true, servers: await mcpClient.connectAll() })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // ── Firm library (the firm's own documents, indexed locally) ─────────
    if (req.method === 'GET' && p === '/api/library') {
      return sendJson(res, 200, { ...library.status(), syncing: librarySyncing })
    }
    if (req.method === 'POST' && p.startsWith('/api/library')) {
      const body = await readBody(req)
      try {
        if (p === '/api/library/folders') library.addFolder(body.path, body.matterId || '')
        else if (p === '/api/library/folders/remove') await library.removeFolder(body.path)
        else if (p !== '/api/library/sync') return sendJson(res, 404, { error: 'not found' })
        library.watchAll({ onSync: logLibrarySync })
        const result = await runLibrarySync()
        return sendJson(res, 200, { ok: true, ...library.status(), result })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // ── Matters (shared with the desktop App via ~/.lexvault/matters.json) ─
    if (req.method === 'GET' && p === '/api/matters') {
      return sendJson(res, 200, {
        matters: matters.list({ includeClosed: url.searchParams.get('all') === '1' }),
        active: matters.active('word')?.id || null,
        forDoc: url.searchParams.get('docId') ? matters.forDoc(url.searchParams.get('docId'))?.id || null : undefined,
      })
    }
    // Matter overview, recall and the matter memo (overview.js) — what is stored, readable.
    if (p === '/api/matters/overview' || p === '/api/matters/recall' || p === '/api/matters/overview/export') {
      require('./workspace').setBase(require('./agent-config').load().workspace)
      const body = req.method === 'POST' ? await readBody(req) : {}
      const r = await require('./overview').handle(req.method, p, url.searchParams, body)
      return sendJson(res, r.status, r.json)
    }
    // The AI record (record.js): what the AI did, merged from the audit and activity logs; check, export, retention.
    if (p === '/api/record' || p.startsWith('/api/record/')) {
      require('./workspace').setBase(require('./agent-config').load().workspace)
      const body = req.method === 'POST' ? await readBody(req) : {}
      const r = await require('./record').handle(req.method, p, url.searchParams, body)
      if (r) return sendJson(res, r.status, r.json)
    }
    if (req.method === 'POST' && p.startsWith('/api/matters')) {
      const body = await readBody(req)
      try {
        let out
        if (p === '/api/matters') out = matters.create(body)
        else if (p === '/api/matters/update') out = matters.update(body.id, body.patch || {})
        else if (p === '/api/matters/bind') {
          out = body.id ? matters.bindDoc(body.id, body.docId, body.title) : (matters.unbindDoc(body.docId), null)
          matters.setActive('word', body.id || null)
        } else if (p === '/api/matters/policy') {
          policy.setRule(body.id, body.rule)
          out = matters.get(body.id)
        } else return sendJson(res, 404, { error: 'not found' })
        hub.publish('matter-changed', { matterId: out?.id || null }, clientOf(req))
        return sendJson(res, 200, { ok: true, matter: out })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // ── Model providers (bring your own model / key) ────────────────────
    if (req.method === 'GET' && p === '/api/providers') {
      const cur = providerSettings.load()
      const list = []
      for (const id of Object.keys(PROVIDERS)) {
        const d = providerSettings.resolve(id)
        list.push({
          id, label: d.label, kind: d.kind, local: !!d.local, needsKey: d.needsKey,
          baseUrl: d.baseUrl || null, model: d.model || d.defaultModel || null, models: d.models || [],
          region: d.region || null, project: d.project || null,
          ctx: d.ctx || null, hasKey: d.needsKey ? await secrets.hasKey(id) : null,
        })
      }
      return sendJson(res, 200, { active: cur.active, providers: list })
    }

    if (req.method === 'POST' && p === '/api/providers') {
      const body = await readBody(req)
      try {
        if (body.provider && body.overrides) {
          providerSettings.update({ provider: body.provider, overrides: body.overrides })
        }
        // Fill in the catalog default model the first time a provider is used.
        if (body.active) {
          const d = providerSettings.resolve(body.active)
          if (!d.model && d.defaultModel) providerSettings.update({ provider: body.active, overrides: { model: d.defaultModel } })
          providerSettings.update({ active: body.active })
        }
        hub.publish('provider-changed', {}, clientOf(req))
        return sendJson(res, 200, { ok: true, ...providerSettings.load() })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    if (req.method === 'POST' && p === '/api/providers/key') {
      const body = await readBody(req)
      try {
        if (!PROVIDERS[body.provider]) throw new Error(`unknown provider: ${body.provider}`)
        if (body.key === null || body.key === '') await secrets.deleteKey(body.provider)
        else await secrets.setKey(body.provider, body.key)
        hub.publish('provider-changed', { provider: body.provider }, clientOf(req))
        return sendJson(res, 200, { ok: true, provider: body.provider, hasKey: await secrets.hasKey(body.provider) })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    if (req.method === 'POST' && p === '/api/providers/test') {
      const body = await readBody(req)
      try {
        const r = await policy.withMatter(body.matterId, () => testProvider(body.provider || providerSettings.load().active))
        return sendJson(res, 200, r)
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err.message, code: err.code || null })
      }
    }

    // ── Data policy (where client data may go, per matter) ──────────────
    if (req.method === 'GET' && p === '/api/policy') {
      return sendJson(res, 200, { ...policy.load(), modes: policy.MODES, auditLog: policy.AUDIT_PATH })
    }

    if (req.method === 'POST' && p === '/api/policy') {
      const body = await readBody(req)
      try {
        const saved = policy.setRule(body.matterId || null, body.rule)
        hub.publish('policy-changed', {}, clientOf(req))
        return sendJson(res, 200, { ok: true, ...saved })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    if (req.method === 'GET' && p === '/api/setup/status') {
      return sendJson(res, 200, {
        token: !!loadToken(),
        model: resolveModelPath() ? config.LLM_MODEL : null,
        models: await downloads.installedModels(),
        packs: packStore.installedJurisdictions(),
        available: await downloads.fetchRegistry().then((r) => r.models ? Object.keys(r.models) : []).catch(() => []),
      })
    }

    // Save the login token (the one paste-out-of-website token).
    if (req.method === 'POST' && p === '/api/config/token') {
      const body = await readBody(req)
      if (!body.token) return sendJson(res, 400, { error: 'missing token' })
      saveToken(body.token)
      watchdog.check().catch(() => {})
      return sendJson(res, 200, { ok: true })
    }

    // Download the local model (Lotus GGUF) — SSE progress.
    if (req.method === 'POST' && p === '/api/download/model') {
      const body = await readBody(req)
      const variant = body.variant || config.LLM_MODEL
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      try {
        await downloads.downloadModel(variant, { onProgress: (e) => sendSse(res, e) })
        const s = await ensureLlama()
        llamaState = s
        sendSse(res, { type: 'done', model: variant, llama: s })
      } catch (err) {
        sendSse(res, { type: 'error', message: err.message })
      }
      return res.end()
    }

    // Download + ingest a jurisdiction pack — SSE progress.
    if (req.method === 'POST' && p === '/api/download/pack') {
      const body = await readBody(req)
      if (!body.jurisdiction) return sendJson(res, 400, { error: 'missing jurisdiction' })
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      try {
        const result = await downloads.downloadPack(body.jurisdiction, {
          version: body.version,
          onProgress: (e) => sendSse(res, e),
        })
        // Pack updated → re-validate the license explicitly (the download
        // itself was token-authed; this refreshes the cached license state
        // + server last_seen so the monthly sweep sees the device live).
        watchdog.check().catch(() => {})
        sendSse(res, { type: 'done', result })
      } catch (err) {
        sendSse(res, { type: 'error', message: err.message })
      }
      return res.end()
    }

    // Analysis depth + apply-mode settings (persisted agent-config.json).
    if (req.method === 'GET' && p === '/api/config/agent') {
      const agentCfg = require('./agent-config')
      const { load, CONFIG_PATH } = agentCfg
      const saved = load()
      // Resource math for the pane dropdown (iq4_nl-K/q4_0-V = 1.0 B/elem,
      // 32 layers × 1024 kv-dim; weights ≈ 2.7 GB Lotus Q4_K_M).
      const presets = {}
      for (const [key, p] of Object.entries(config.DEPTH_PRESETS)) {
        presets[key] = { ...p, kvMiB: p.kvMiB, totalGiB: p.totalGiB }
      }
      return sendJson(res, 200, { ...saved, presets, configPath: CONFIG_PATH })
    }

    if (req.method === 'POST' && p === '/api/config/agent') {
      const body = await readBody(req)
      try {
        const agentCfg = require('./agent-config')
        const saved = agentCfg.save({ depth: body.depth, applyMode: body.applyMode, autopilot: body.autopilot })
        return sendJson(res, 200, { ok: true, ...saved })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // Auto-update: state for the pane's Settings → Update section.
    if (req.method === 'GET' && p === '/api/update/status') {
      return sendJson(res, 200, updater.getState())
    }

    // Manual "check now" — forces a manifest poll (used by the pane's
    // Check-again button; the 6h timer also polls automatically).
    if (req.method === 'POST' && p === '/api/update/check') {
      try {
        const r = await updater.check({ silent: false })
        return sendJson(res, 200, updater.getState())
      } catch (err) {
        return sendJson(res, 200, updater.getState())
      }
    }

    // Download the available update — SSE progress.
    if (req.method === 'POST' && p === '/api/update/download') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      try {
        const path = await updater.download()
        sendSse(res, { type: 'done', artifactPath: path, version: updater.pendingVersion })
      } catch (err) {
        sendSse(res, { type: 'error', message: err.message })
      }
      return res.end()
    }

    // Apply the downloaded update + restart the sidecar.
    if (req.method === 'POST' && p === '/api/update/apply') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      try {
        const backup = await updater.apply()
        sendSse(res, { type: 'done', version: updater.pendingVersion, backup })
        setTimeout(() => updater.restart(), 1500)
      } catch (err) {
        sendSse(res, { type: 'error', message: err.message })
      }
      return res.end()
    }

    if (req.method === 'GET' && p === '/api/license/status') {
      const st = watchdog.state
      const dist = require('./distribution').load(config.DATA_DIR)
      const links = { distribution: dist?.name || null, accountUrl: dist?.accountUrl || null, downloadUrl: dist?.downloadUrl || null, supportUrl: dist?.supportUrl || null }
      return sendJson(res, 200, st.status === 'unknown' ? { status: 'pending', ...st, ...links } : { ...st, ...links })
    }

    if (req.method === 'GET' && p === '/api/jurisdictions') {
      const installed = new Set(packStore.installedJurisdictions().map((x) => x.code))
      const all = ['AT', 'CY', 'CZ', 'DE', 'RO', 'SK', 'US', 'US-CA', 'ZA', 'UK', 'EU']
      return sendJson(res, 200, all.map((code) => ({ code, installed: installed.has(code) })))
    }

    if (req.method === 'GET' && p === '/api/packs') {
      const packs = packStore.scanPacks()
      const installed = packStore.installedJurisdictions()
      return sendJson(res, 200, packs.map((p) => ({
        ...p,
        installed: installed.find((i) => i.code === p.jurisdiction)?.version === p.version,
        installedChunks: installed.find((i) => i.code === p.jurisdiction)?.chunk_count || 0,
      })))
    }

    // Remove an installed jurisdiction (Qdrant points + .lvpack + registry).
    if (req.method === 'POST' && p === '/api/packs/delete') {
      const body = await readBody(req)
      if (!body.jurisdiction) return sendJson(res, 400, { error: 'missing jurisdiction' })
      try {
        const result = await packStore.removePack(body.jurisdiction)
        return sendJson(res, 200, result)
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // Ingest a local .lvpack into the standalone Qdrant (plugin-only path).
    if (req.method === 'POST' && p === '/api/packs/ingest') {
      const body = await readBody(req)
      if (!body.path) return sendJson(res, 400, { error: 'missing path' })
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      try {
        sendSse(res, { type: 'step', text: 'verifying pack signature…' })
        const result = await packStore.ingest(body.path, {
          onProgress: (e) => sendSse(res, { type: 'progress', ...e }),
        })
        sendSse(res, { type: 'done', result })
      } catch (err) {
        sendSse(res, { type: 'error', message: err.message })
      }
      return res.end()
    }

    if (req.method === 'POST' && p === '/api/document/map') {
      const body = await readBody(req, 20)
      const entry = getDoc(body)
      entry.doc = new Document(body.text, body.docId, body.styles)
      entry.memory = require('./memory').DocMemory ? new (require('./memory').DocMemory)(entry.doc.docId) : null
      return sendJson(res, 200, entry.doc.map())
    }

    if (req.method === 'POST' && p === '/api/document/section') {
      const body = await readBody(req)
      const entry = getDoc(body)
      if (!entry.doc) return sendJson(res, 400, { error: 'no document mapped yet' })
      const s = entry.doc.section(body.index)
      if (!s) return sendJson(res, 404, { error: 'no such section' })
      return sendJson(res, 200, { index: s.index, text: s.text.slice(0, 2000), compressed: s.compressed, tokens: s.tokens })
    }

    // Full analyze: map → per-section agent analysis → suggestions → SSE
    if (req.method === 'POST' && p === '/api/document/analyze') {
      // Contract review, clause by clause. Optional: side (whom we act
      // for), playbook (a firm checklist), focus (topics), interactive
      // (permission cards). Streams `step` (kind: clause, position,
      // total), `model`, `suggestion` (with its clause), `done`
      // ({ comments, stopped, total }).
      const body = await readBody(req, 20)
      const entry = getDoc(body)
      entry.doc = new Document(body.text, body.docId, body.styles)
      const { DocMemory } = require('./memory')
      entry.memory = new DocMemory(entry.doc.docId)
      const review = require('./review')

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      // Same recovery as /api/chat: respawn llama when it died since startup.
      const ready = await engineReady()
      if (!ready?.ok) {
        sendSse(res, { type: 'error', message: `local engine unavailable: ${ready.reason || 'unknown'} — Settings → Download model, then retry` })
        return res.end()
      }
      const opts = review.options(body)
      let checks = []
      if (opts.playbook) {
        try {
          require('./workspace').setBase(require('./agent-config').load().workspace)
          checks = require('./workflows').loadPlaybook(opts.playbook).checks
        } catch (err) { sendSse(res, { type: 'warning', message: `The firm checklist could not be loaded (${err.message}); reviewing without it.` }) }
      }
      const map = entry.doc.map()
      const context = {
        doc: entry.doc, memory: entry.memory, search, embeddings,
        summary: () => entry.doc.summary(),
      }
      // Stop: the pane aborts the fetch → stop between clauses, keep what is done.
      const ac = new AbortController()
      res.on('close', () => ac.abort())
      const sections = map.sections.slice(0, 30)
      if (map.sections.length > sections.length) sendSse(res, { type: 'warning', message: `This document has ${map.sections.length} parts; the review covers the first ${sections.length}.` })
      const mid = matterIdFor(body, entry)
      let comments = 0
      await require('./permissions').session(permissionSession(body, res, ac.signal), () => policy.observeModels((m) => sendSse(res, { type: 'model', ...m }), async () => {
        for (const [position, s] of sections.entries()) {
          if (ac.signal.aborted) break
          sendSse(res, { type: 'step', text: `analyzing § ${s.heading || s.index + 1}…`, kind: 'clause', position, total: sections.length, detail: { clause: { index: s.index, heading: s.heading || '' } } })
          try {
            const r = await policy.withMatter(mid, () => runAction(context, review.clausePrompt({ section: s, position, total: sections.length, opts, checks }), (e) => { if (e.type !== 'done' && e.type !== 'text') sendSse(res, e) }, { signal: ac.signal }))
            for (const sug of r.suggestions) { comments++; sendSse(res, { type: 'suggestion', suggestion: { ...sug, clause: { index: s.index, heading: s.heading || '', position } } }) }
          } catch (err) {
            sendSse(res, { type: 'error', message: `section ${s.index}: ${err.message}`, clause: { index: s.index, heading: s.heading || '' }, recoverable: true })
          }
        }
      }))
      sendSse(res, { type: 'done', comments, stopped: ac.signal.aborted, total: sections.length })
      return res.end()
    }

    // Export a finished review (Word pane summary card) into the matter's folder.
    if (req.method === 'POST' && p === '/api/review/export') {
      const body = await readBody(req, 5)
      try {
        require('./workspace').setBase(require('./agent-config').load().workspace)
        const entry = body.docId ? getDoc(body) : null
        const matterId = body.matterId || (entry ? matterIdFor(body, entry) : null)
        const file = require('./review').exportReview({ title: body.title, side: body.side, findings: body.findings, format: body.format, matterLabel: require('./workflows').matterLabel(matterId) })
        return sendJson(res, 200, { file })
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }
    }

    // What OpenLex did per request (activity.js): asked, looked at, where data went, result.
    if (req.method === 'GET' && p === '/api/activity') {
      return sendJson(res, 200, { activity: require('./activity').list(url.searchParams.get('matterId') || null, +(url.searchParams.get('limit') || 20)) })
    }
    // ── documents: attach (read on this computer), analyse, export ──────────
    // Attach a file to the chat: { name, data (base64) } from the window, or
    // { file } (a document in the matter's folders). The one size rule
    // (limits.js) applies; the body may be that large plus base64 overhead.
    if (req.method === 'POST' && p === '/api/document/read') {
      const limits = require('./limits')
      let body
      try { body = await readBody(req, limits.maxFileMB() * 1.37 + 1) } catch (err) {
        return sendJson(res, 413, { error: /too large/.test(err.message) ? limits.tooLargeMessage('This file', +(req.headers['content-length'] || 0) / 1.37) : err.message, code: 'FILE_TOO_LARGE' })
      }
      try {
        require('./workspace').setBase(require('./agent-config').load().workspace)
        const matterId = body.matterId || null
        const att = await policy.withMatter(matterId, () => require('./attachments').add({
          name: body.name, file: body.file, buffer: typeof body.data === 'string' ? Buffer.from(body.data, 'base64') : undefined,
          matterId, sessionId: body.sessionId || null, ocr: body.ocr !== false,
        }))
        return sendJson(res, 200, { attachment: att })
      } catch (err) {
        return sendJson(res, err.code === 'FILE_TOO_LARGE' ? 413 : 400, { error: err.message, ...(err.code ? { code: err.code } : {}) })
      }
    }
    // An attached document's text (DocumentView): ?id=&offset=&limit= (characters).
    if (req.method === 'GET' && p === '/api/document/attachment') {
      try {
        const at = require('./attachments')
        const id = url.searchParams.get('id')
        const text = at.text(id)
        const offset = Math.max(0, +(url.searchParams.get('offset') || 0))
        const limit = Math.min(2000000, Math.max(1000, +(url.searchParams.get('limit') || 400000)))
        return sendJson(res, 200, { attachment: at.meta(id), text: text.slice(offset, offset + limit), offset, total: text.length, more: offset + limit < text.length })
      } catch (err) { return sendJson(res, 404, { error: err.message }) }
    }
    // The full document analysis as a chat turn (the app's /analyse and
    // drop-a-document): live steps, then an `analysis` event with the
    // result; the turn is kept in the matter's conversation.
    if (req.method === 'POST' && p === '/api/analyse') {
      const body = await readBody(req, 20)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      let folderDir
      try { folderDir = folderFor(body) } catch (err) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
      const ready = await engineReady()
      if (!ready?.ok) { sendSse(res, { type: 'error', message: `model unavailable: ${ready.reason}` }); return res.end() }
      const ac = new AbortController()
      res.on('close', () => ac.abort())
      const matterId = body.matterId || null
      require('./workspace').setBase(require('./agent-config').load().workspace)
      const attachments = Array.isArray(body.attachments) ? body.attachments.filter((x) => typeof x === 'string').slice(0, 20) : []
      const files = Array.isArray(body.files) ? body.files : body.file ? [body.file] : []
      let names = []
      try { names = [...attachments.map((id) => require('./attachments').meta(id).name), ...files.map((f) => path.basename(String(f)))] } catch (err) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
      if (!names.length && !body.text) { sendSse(res, { type: 'error', message: 'Attach a document (or name one of the matter) to analyse.' }); return res.end() }
      const asked = String(body.message || `/analyse ${names.join(', ')}`).slice(0, 2000)
      const rec = require('./activity').start({ matterId, kind: 'analyse', asked, client: clientOf(req), files: names })
      const turn = { data: [], sources: [] }
      const out = (e) => {
        rec.see(e)
        if (e.type === 'model') {
          const hit = turn.data.find((m) => m.provider === e.provider && m.region === (e.region || null) && m.redacted === !!e.redacted && m.local === !!e.local)
          if (hit) hit.calls++
          else turn.data.push({ provider: e.provider, label: e.label, model: e.model || null, local: !!e.local, region: e.region || null, redacted: !!e.redacted, calls: 1 })
        }
        sendSse(res, e)
      }
      const steps = require('./analysis').stepWords
      try {
        const r = await rec.run(() => require('./folder').run(folderDir, () => require('./permissions').session(permissionSession(body, res, ac.signal), () => policy.observeModels((m) => out({ type: 'model', ...m }), () => policy.withMatter(matterId, () => require('./analysis').runAnalyse({
          matterId, attachments, files, text: body.text, name: body.name, focus: body.focus, signal: ac.signal,
          onProgress: (ev) => out({ type: 'step', kind: 'analyse', plain: steps(ev), ...ev }),
        }))))))
        for (const a of r.analyses) out({ type: 'analysis', analysis: a })
        const text = r.analyses.map((a) => require('./analysis').brief(a)).join('\n\n')
        if (body.sessionId && r.analyses.length) {
          const { Session } = require('./session')
          new Session(String(body.sessionId)).append(asked, text, { matterId, client: clientOf(req), data: turn.data, stopped: ac.signal.aborted, results: r.analyses.map((a) => ({ kind: 'analysis', id: a.id, name: a.document.name })) })
        }
        out({ type: 'done', stopped: ac.signal.aborted, files: r.files, stats: r.stats })
        rec.finish({ aborted: ac.signal.aborted, files: r.files || [] })
      } catch (err) {
        out({ type: 'error', message: err.message })
        rec.finish({ error: err.message })
      }
      return res.end()
    }
    if (req.method === 'GET' && p === '/api/analysis') {
      try { return sendJson(res, 200, { analysis: require('./analysis').get(url.searchParams.get('id')) }) } catch (err) { return sendJson(res, 404, { error: err.message }) }
    }
    if (req.method === 'POST' && p === '/api/analysis/export') {
      const body = await readBody(req)
      try {
        require('./workspace').setBase(require('./agent-config').load().workspace)
        return sendJson(res, 200, require('./analysis').exportAnalysis(body.id, body.format))
      } catch (err) { return sendJson(res, 400, { error: err.message }) }
    }
    if (p === '/api/config/local-memory') {
      const body = req.method === 'POST' ? await readBody(req) : {}
      const r = require('./local_memory').handle(req.method, p, url.searchParams, body)
      return sendJson(res, r.status, r.json)
    }
    if (p === '/api/batches' || p === '/api/batch' || p.startsWith('/api/batch/')) {
      const body = req.method === 'POST' ? await readBody(req) : {}
      require('./workspace').setBase(require('./agent-config').load().workspace)
      const r = await require('./batch').handle(req.method, p, url.searchParams, body)
      if (r) return sendJson(res, r.status, r.json)
    }

    if (req.method === 'POST' && p === '/api/chat') {
      const body = await readBody(req, 20)
      const entry = getDoc(body)
      // Attached documents (POST /api/document/read): their text becomes the
      // conversation's document; how it is read follows the model (strategy.js).
      let attached = null
      if (Array.isArray(body.attachments) && body.attachments.length) {
        try {
          attached = require('./attachments').combined(body.attachments.filter((x) => typeof x === 'string'))
          entry.doc = new Document(attached.text, body.docId)
          entry.memory = null
          body.files = [...new Set([...(Array.isArray(body.files) ? body.files : []), ...attached.names])]
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
          sendSse(res, { type: 'error', message: `The attached document is no longer available (${err.message}); attach it again.` })
          return res.end()
        }
      }
      if (!entry.doc && body.text) entry.doc = new Document(body.text, body.docId, body.styles)
      if (!entry.doc) entry.doc = new Document('', body.docId)
      if (!entry.memory) entry.memory = new (require('./memory').DocMemory)(entry.doc.docId)

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      // The working folder (folder.js): checked before anything runs.
      let folderDir
      try { folderDir = folderFor(body) } catch (err) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
      // Llama may have died since startup (crash, model reload, tunnel
      // flap) — the chat path must recover instead of surfacing raw
      // ECONNREFUSED. ensureLlama probes (fast when a server is up) and
      // respawns the local one when nothing answers.
      const ready = await engineReady()
      if (!ready?.ok) {
        sendSse(res, { type: 'error', message: `local engine unavailable: ${ready.reason || 'unknown'} — Settings → Download model, then retry` })
        return res.end()
      }
      // The conversation: the window's own (sessionId: the terminal app and
      // the desktop app, one per matter conversation), else this document's.
      const { Session } = require('./session')
      const session = new Session(typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : entry.doc.docId)
      const context = {
        doc: entry.doc, memory: entry.memory, search, embeddings, session,
        summary: () => entry.doc.summary(),
      }
      body.message = require('./recipes').expand(body.message)
      // Firm skills (Phase 7.2): "/name …" or body.skill runs the agent with
      // that skill; otherwise suggest a matching one (the pane shows a chip).
      const skillsMod = require('./skills')
      const agentsMod = require('./agents')
      let skill = null
      let agent = null
      try {
        // "@agent" first, then "/skill": "@drafter /rebalance-clause make §7 fairer".
        if (body.agent) agent = agentsMod.get(body.agent)
        else {
          const ai = agentsMod.parseInvocation(body.message)
          if (ai) { agent = ai.agent; body.message = ai.message }
          else { const mt = matterIdFor(body, entry); const dm = mt ? require('./matters').get(mt)?.agent : null; if (dm) agent = agentsMod.get(dm) }
        }
        if (body.skill) skill = skillsMod.get(body.skill)
        else {
          const inv = skillsMod.parseInvocation(body.message)
          if (inv) { skill = inv.skill; body.message = inv.message || `Apply the "${inv.skill.title}" skill to this document.` }
        }
      } catch (err) { sendSse(res, { type: 'error', message: err.message }); return res.end() }
      // Activity record (GET /api/activity) + `model` events (where the data went).
      const rec = require('./activity').start({ matterId: matterIdFor(body, entry), kind: 'question', asked: body.message, client: clientOf(req), files: Array.isArray(body.files) ? body.files : [] })
      // What the answer was based on and where its data went, kept with the conversation.
      const turn = { sources: [], data: [], online: [] }
      let shown = '' // the answer text the window actually received (kept as is when stopped)
      const out = (e) => {
        rec.see(e)
        if (e.type === 'text' && !res.destroyed && !res.writableEnded) shown += e.text || ''
        sendSse(res, e)
        if (e.type === 'law') for (const s of e.sources || []) { if (!turn.sources.some((x) => (x.chunk_id && x.chunk_id === s.chunk_id) || (x.source_name === s.source_name && x.section === s.section))) turn.sources.push(s) }
        else if (e.type === 'model') {
          const hit = turn.data.find((m) => m.provider === e.provider && m.region === (e.region || null) && m.redacted === !!e.redacted && m.local === !!e.local)
          if (hit) hit.calls++
          else turn.data.push({ provider: e.provider, label: e.label, model: e.model || null, local: !!e.local, region: e.region || null, redacted: !!e.redacted, calls: 1 })
        } else if (e.type === 'step' && e.online && e.onlineTo && !turn.online.includes(e.onlineTo)) turn.online.push(e.onlineTo)
      }
      if (attached) {
        // How the attached document will be read (in full, or part by part), in words.
        const st = require('./strategy')
        const pages = attached.list.reduce((n, a) => n + (a.meta.pages || 0), 0)
        const plan = st.forModel({ tokens: require('./read').tokensFor(attached.text), role: 'plan', matterId: matterIdFor(body, entry), outputTokens: config.AGENT.WRITE_MAX_TOKENS })
        sendSse(res, { type: 'strategy', mode: plan.mode, kind: plan.kind, cache: plan.cache, ctx: plan.ctx, tokens: plan.tokens, text: st.explain(plan, { name: attached.names.join(', '), pages }) })
      }
      if (agent && agent.name !== 'associate') sendSse(res, { type: 'agent', name: agent.name, title: agent.title })
      if (skill) sendSse(res, { type: 'skill', name: skill.name, title: skill.title })
      else if (body.suggestSkill !== false) {
        const hint = await rec.run(() => policy.withMatter(matterIdFor(body, entry), () => skillsMod.suggest(body.message).catch(() => null)))
        if (hint) sendSse(res, { type: 'skill_suggestion', ...hint })
      }
      // Stop support (Batch 1.3): when the pane aborts the SSE fetch, stop
      // the run cleanly (partial results kept) instead of burning the loop.
      const ac = new AbortController()
      res.on('close', () => ac.abort())
      // The turn in the conversation every window shows (stopped ones too).
      const keep = (text, stopped) => session.append(body.message, text, { matterId: matterIdFor(body, entry), client: clientOf(req), agent: agent && agent.name !== 'associate' ? agent.name : null, ...turn, stopped })
      try {
        // Permissions: an interactive front end answers "may OpenLex …?"
        // questions on this stream; anything else fails closed (deny).
        const r = await rec.run(() => require('./folder').run(folderDir, () => require('./permissions').session(permissionSession(body, res, ac.signal), () => policy.observeModels((m) => out({ type: 'model', ...m }), () => policy.withMatter(matterIdFor(body, entry), () => agentsMod.run(agent, () => runAction(context, body.message, out, { signal: ac.signal, skill, agent })))))))
        // Conversation memory: persist the exchange (best-effort; the
        // model's streamed prose already went out token-by-token).
        keep(ac.signal.aborted ? shown : r.text, ac.signal.aborted || !!r.stopped)
        // Firm hooks at the answer (hooks.js): warn → note; deny → withheld.
        // A streamed answer is already on screen: the pane marks it withheld.
        const hooks = require('./hooks')
        const mid = matterIdFor(body, entry)
        const gate = hooks.has('before_answer') && r.text ? await rec.run(() => hooks.run('before_answer', { text: r.text, matterId: mid })) : { decision: 'allow', warnings: [] }
        if (gate.decision === 'deny') out({ type: 'withheld', message: gate.reason })
        else {
          // streamed=true → the write phase already streamed the prose token
          // by token; skip the duplicate final event.
          if (!r.streamed) out({ type: 'text', text: r.text + '\n' })
          for (const w of gate.warnings) out({ type: 'warning', message: w })
        }
        for (const sug of r.suggestions) {
          if (hooks.has('on_suggestion')) {
            const g = await rec.run(() => hooks.run('on_suggestion', { text: sug.proposed_text || '', summary: sug.summary || '', severity: sug.severity, matterId: mid }))
            if (g.decision === 'deny') { out({ type: 'warning', message: `A suggestion was removed by a firm rule: ${g.reason}` }); continue }
            if (g.flags.length || g.warnings.length) sug.flags = [...g.flags, ...g.warnings]
          }
          out({ type: 'suggestion', suggestion: sug })
        }
        out({ type: 'done' })
        rec.finish({ aborted: ac.signal.aborted })
      } catch (err) {
        if (ac.signal.aborted) keep(shown, true)
        out({ type: 'error', message: err.message })
        rec.finish({ error: err.message })
      }
      return res.end()
    }

    // Sandboxed workspace (Batch W1).
    if (req.method === 'GET' && p === '/api/workspace') {
      const ws = require('./workspace')
      const { load } = require('./agent-config')
      ws.setBase(load().workspace)
      return sendJson(res, 200, { base: ws.base(), files: ws.listFiles('') })
    }
    // A working folder before it is used (folder.js): can it be one, is it
    // the whole home folder, how many documents are in it.
    if (req.method === 'GET' && p === '/api/folder') {
      const fo = require('./folder')
      const c = fo.check(url.searchParams.get('path') || '')
      if (!c.ok) return sendJson(res, 200, { ok: false, error: c.error, ...(c.short ? { short: c.short } : {}) })
      const docs = c.broad ? { count: null, truncated: true } : fo.documents(c.path)
      return sendJson(res, 200, { ok: true, path: c.path, short: c.short, broad: c.broad, documents: docs.count, truncated: docs.truncated })
    }
    // A front end saves something itself (the terminal app's "save the
    // answer"): the same rules as the agent's write_file. No decision yet →
    // { ask } with the question to show; then again with decision.
    if (req.method === 'POST' && p === '/api/folder/save') {
      const body = await readBody(req, 20)
      const fo = require('./folder')
      const perms = require('./permissions')
      require('./workspace').setBase(require('./agent-config').load().workspace)
      let dir
      try { dir = folderFor(body) } catch (err) { return sendJson(res, 400, { error: err.message }) }
      return fo.run(dir, () => {
        const args = { path: String(body.path || ''), content: '' }
        const ev = perms.evaluate('write_file', args, { matterId: body.matterId || null })
        const summary = perms.summarize('write_file', args)
        if (ev.decision === 'deny') return sendJson(res, 403, { error: ev.reason || `Not allowed by ${ev.source === 'firm' ? 'the firm\'s' : 'your'} permission rules: ${summary}` })
        if (ev.decision === 'ask' && !['once', 'always_folder'].includes(body.decision)) {
          const inFolder = ev.area === 'folder' && ev.root
          return sendJson(res, 200, { ask: { type: 'permission', id: 'save', tool: 'write_file', title: 'OpenLex wants to save a file', summary, risk: 'writes a file', detail: { path: args.path }, choices: inFolder && ev.canAlways ? ['once', 'always_folder', 'deny'] : ['once', 'deny'], ...(inFolder ? { folder: fo.tilde(ev.root), alwaysFolder: `write_file:${fo.tilde(ev.root)}/**` } : {}) } })
        }
        if (body.decision === 'always_folder' && ev.area === 'folder' && ev.canAlways) perms.addRule('allow', `write_file:${fo.tilde(ev.root)}/**`)
        try {
          const loc = fo.write(args.path, String(body.content ?? ''))
          require('./policy').audit({ provider: 'permissions', model: null, call: 'write_file', decision: 'allowed', by: ev.decision === 'allow' ? `rule:${ev.source}` : 'lawyer', client: clientOf(req) })
          return sendJson(res, 200, { saved: loc.abs, short: fo.tilde(loc.abs) })
        } catch (err) { return sendJson(res, 400, { error: err.message }) }
      })
    }
    if (req.method === 'POST' && p === '/api/workspace/reveal') {
      const body = await readBody(req).catch(() => ({}))
      const ws = require('./workspace')
      const { load } = require('./agent-config')
      ws.setBase(load().workspace)
      let target = ws.base()
      if (body.path) {
        try { target = ws.resolve(body.path) } catch { /* keep base */ }
      }
      const { execFile } = require('child_process')
      if (process.platform === 'darwin') execFile('open', ['-R', target], () => {})
      else execFile('explorer.exe', ['/select,', target], () => {})
      return sendJson(res, 200, { ok: true, revealed: target })
    }
    if (req.method === 'POST' && p === '/api/config/workspace') {
      const body = await readBody(req).catch(() => ({}))
      const ws = require('./workspace')
      const { save } = require('./agent-config')
      ws.setBase(body.path)
      save({ workspace: ws.base() })
      return sendJson(res, 200, { base: ws.base() })
    }

    // Drafting recipes (Batch 2.7) + law section (Batch 2.8).
    if (req.method === 'GET' && p === '/api/recipes') {
      return sendJson(res, 200, require('./recipes').RECIPES)
    }
    if (req.method === 'GET' && p === '/api/law/section') {
      const q = new URL(req.url, 'http://x').searchParams
      const chunk = await search.getChunk(q.get('chunk_id') || '')
      if (!chunk) return sendJson(res, 404, { error: 'chunk not found' })
      return sendJson(res, 200, { source_name: chunk.source_name, section: chunk.section, content: chunk.content })
    }

    // Calendar integration (Batch W3).
    if (req.method === 'GET' && p === '/api/calendar/config') {
      return sendJson(res, 200, require('./calendar').providerConfig())
    }
    if (req.method === 'POST' && p === '/api/calendar/config') {
      const body = await readBody(req).catch(() => ({}))
      return sendJson(res, 200, require('./calendar').setProviderConfig(body))
    }
    if (req.method === 'POST' && p === '/api/workspace/open-ics') {
      const body = await readBody(req).catch(() => ({}))
      const ws = require('./workspace')
      const { load } = require('./agent-config')
      ws.setBase(load().workspace)
      try {
        const target = body.path ? ws.resolve(body.path) : ws.base()
        await require('./calendar').openICS(target)
        return sendJson(res, 200, { ok: true })
      } catch (e) {
        return sendJson(res, 400, { error: e.message })
      }
    }

    // Conversations (session.js): listed per matter and read by every window;
    // /api/session/clear forgets one (this document's, or a window's sessionId).
    if (p === '/api/sessions' || p === '/api/session' || p === '/api/session/clear') {
      const body = req.method === 'POST' ? await readBody(req).catch(() => ({})) : {}
      const r = require('./session').handle(req.method, p, url.searchParams, body, { forDoc: matters.forDoc })
      return sendJson(res, r.status, r.json)
    }

    return sendJson(res, 404, { error: 'not found', path: p })
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message })
    else res.end()
  }
}

// ── HTTP(S) server ─────────────────────────────────────────────────────────
// HTTPS with the localhost cert when present (Office.js requirement for the
// add-in SourceLocation); plain HTTP otherwise (dev fallback, localhost-only).
let httpsServer = null
if (fs.existsSync(config.HTTPS_CERT) && fs.existsSync(config.HTTPS_KEY)) {
  httpsServer = require('https').createServer({
    cert: fs.readFileSync(config.HTTPS_CERT),
    key: fs.readFileSync(config.HTTPS_KEY),
  }, handle)
} else {
  console.warn('[sidecar] no localhost cert — serving plain HTTP. Run scripts/gen-cert.sh + trust-cert-*.sh for Office.js.')
}

// Bind to loopback only — the add-in and sidecar are on the same machine.
const server = httpsServer || http.createServer(handle)
server.listen(config.PORT, '127.0.0.1', () => {
  // The AI record: seal lines written before tamper-evidence existed (once),
  // then apply the retention setting (default: keep everything) — daily.
  try {
    const record = require('./record')
    record.sealAll()
    const keep = () => { for (const r of record.applyRetention()) console.log('[record] retention:', r.name, r.error || `${r.removed.count} old entries removed`) }
    keep()
    setInterval(keep, 24 * 3600 * 1000).unref()
  } catch (err) { console.warn('[record] startup failed:', err.message) }
  // Monitors (Phase 7.4): check due watches every 15 minutes while the engine runs.
  if (process.env.OPENLEX_MONITORS !== '0') require('./monitors').startScheduler()
  if (process.env.OPENLEX_MONITORS !== '0') require('./web/ris').startNightly() // RIS local copy, only in the hours the RIS terms allow (opt-in)
  console.log(`[sidecar] OpenLex engine on https://localhost:${config.PORT}${httpsServer ? '' : ' (http fallback)'}`)
  console.log(`[sidecar] serving add-in from ${config.ADDIN_ROOT}`)
  console.log(`[sidecar] model: ${config.LLM_MODEL} (llama.cpp at ${config.LLM_BASE})`)
  console.log(`[sidecar] law index: ${config.QDRANT_COLLECTION} at ${config.QDRANT_BASE}`)
  // Connectors: start configured MCP servers (their tools join the agent).
  mcpClient.connectAll().then((st) => {
    for (const sv of st) console.log(`[mcp] ${sv.name}: ${sv.connected ? `${sv.tools.length} tools` : `not connected (${sv.error || 'disabled'})`}`)
  }).catch((err) => console.warn('[mcp] connect failed:', err.message))
  process.on('exit', () => mcpClient.stopAll())
  // Firm library: catch up on changes made while we were down, then watch.
  if (library.status().folders.length) {
    runLibrarySync().then(logLibrarySync).catch((err) => console.warn('[library] startup sync failed:', err.message))
    library.watchAll({ onSync: logLibrarySync })
  }
  // Announce ourselves to the desktop app (offline discovery via file).
  hub.register({
    url: `${httpsServer ? 'https' : 'http'}://127.0.0.1:${config.PORT}`,
    version: SIDECAR_VERSION,
    ca: httpsServer ? config.HTTPS_CERT : null,
  })
})
