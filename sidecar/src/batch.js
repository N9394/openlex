"use strict"
/**
 * Big batches: many documents (a folder, a data room) analysed one by one
 * in the background, with progress, Stop and Resume.
 *
 *   estimate({ files | folder, matterId })   how big it is and, for a cloud
 *       model, roughly how many tokens go to which service and what that
 *       costs: "about 480 pages, roughly 640,000 tokens to Claude (EU),
 *       est. $3.10". The window shows this and asks before a cloud run.
 *   start({ files | folder, matterId, confirmed })  → job (runs in the background)
 *   stop(id) / resume(id) / get(id) / list(matterId)
 *
 * Jobs are kept in ~/.lexvault/batches/<id>.json, file by file
 * (waiting / reading / done / failed / skipped), so a stopped run — or one
 * cut short by closing the app — resumes where it was. Each document goes
 * through the full analysis (analysis.js) with the matter's data policy;
 * each result is a normal analysis (exports, chat card).
 *
 * Cost: only an estimate (documented prices per million tokens, below; the
 * firm can add its own in the harness map, "prices"). Unknown services show
 * the token count without a price.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')

const DIR = path.join(DATA_DIR, 'batches')
const ID_RE = /^batch_[a-f0-9]{12}$/
const CONFIRM_TOKENS = 200000 // a cloud run above this asks first

// USD per million tokens [input, output] — documented list prices; an estimate only.
const PRICES = [
  [/claude-opus-5-5/i, 4, 20], [/claude-opus-(5|4)/i, 5, 25], [/claude-sonnet-5/i, 2, 10], [/claude-sonnet-4/i, 3, 15], [/claude-haiku-4/i, 1, 5],
]

function priceFor(model) {
  let custom = {}
  try { custom = require('./harness').load().prices || {} } catch { custom = {} }
  for (const [pattern, p] of Object.entries(custom)) { try { if (new RegExp(pattern, 'i').test(String(model || ''))) return { input: +p.input, output: +p.output, currency: p.currency || 'USD' } } catch { /* bad pattern */ } }
  const hit = PRICES.find(([re]) => re.test(String(model || '')))
  return hit ? { input: hit[1], output: hit[2], currency: 'USD' } : null
}

const SUPPORTED = () => require('./read').SUPPORTED

/** The documents of a request: explicit files (paths or matter document names) or every document in a folder. */
function resolveFiles({ files, folder, attachments, matterId }) {
  const out = []
  // Documents attached in the app (attachments.js), already read: "att:<id>".
  if (Array.isArray(attachments)) for (const id of attachments) { require('./attachments').meta(id); out.push(`att:${id}`) }
  if (Array.isArray(files)) for (const f of files) out.push(require('./workflows_docs').resolveDoc(matterId, String(f)))
  if (folder) {
    const fo = require('./folder')
    const root = fo.check(folder)
    if (!root.ok) throw new Error(root.error)
    const walk = (dir, depth = 0) => {
      if (depth > 8) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p, depth + 1)
        else if (SUPPORTED().includes(path.extname(e.name).toLowerCase()) && !/^analysis-/.test(e.name)) out.push(p)
      }
    }
    walk(root.path)
  }
  return [...new Set(out)].slice(0, 2000)
}

/** Quick size of one file without OCR: pages and characters (PDF page count from the file). */
async function quickSize(file) {
  if (file.startsWith('att:')) {
    const m = require('./attachments').meta(file.slice(4))
    return { file, name: m.name, bytes: m.bytes, chars: m.chars, pages: m.pages, tokens: m.tokens }
  }
  const st = fs.statSync(file)
  const limits = require('./limits')
  if (st.size > limits.maxFileBytes()) return { file, name: path.basename(file), bytes: st.size, tooLarge: true, note: limits.tooLargeMessage(path.basename(file), st.size) }
  try {
    const r = await require('./read').readDocument({ file }, { ocr: false })
    return { file, name: r.name, bytes: st.size, chars: r.chars, pages: r.pages, tokens: r.tokens }
  } catch (err) {
    // A scan without text: count the pages, assume ~2,500 characters each after OCR.
    if (path.extname(file).toLowerCase() === '.pdf' && /no text layer/i.test(err.message)) {
      try {
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise
        const pages = doc.numPages
        await doc.destroy()
        return { file, name: path.basename(file), bytes: st.size, chars: pages * 2500, pages, tokens: Math.ceil(pages * 2500 / 3.8), scanned: true }
      } catch { /* fall through */ }
    }
    return { file, name: path.basename(file), bytes: st.size, unreadable: true, note: err.message }
  }
}

const fmtInt = (n) => Math.round(n).toLocaleString('en-US')

/**
 * How big a batch is, and what a cloud run would send and cost.
 * @returns {{ files, documents, pages, tokens, service: {kind,label,model,region}, cost, needsConfirm, sentence, skipped }}
 */
async function estimate({ files, folder, attachments, matterId = null } = {}) {
  const list = resolveFiles({ files, folder, attachments, matterId })
  if (!list.length) throw new Error('no documents found to analyse')
  const sizes = []
  for (const f of list) sizes.push(await quickSize(f))
  const ok = sizes.filter((s) => !s.tooLarge && !s.unreadable)
  const pages = ok.reduce((n, s) => n + s.pages, 0)
  const docTokens = ok.reduce((n, s) => n + s.tokens, 0)
  // Per document: instructions, the second check and the answer (~3,500 in, ~2,500 out).
  const inTokens = docTokens + ok.length * 3500
  const outTokens = ok.length * 2500
  const strategy = require('./strategy')
  const t = strategy.target({ role: 'analyze', matterId })
  const service = { kind: t.kind, label: t.kind === 'local' ? 'this computer' : t.label, model: t.model, region: t.region }
  const price = t.kind === 'cloud' ? priceFor(t.model) : null
  const cost = price ? { currency: price.currency, amount: Math.round(((inTokens / 1e6) * price.input + (outTokens / 1e6) * price.output) * 100) / 100, basis: `${price.input}/${price.output} ${price.currency} per million tokens in/out (list price; your plan may differ)` } : null
  const where = t.kind === 'local' ? 'the AI on this computer (nothing leaves it)' : `${service.label}${t.region ? ` (${/^eu/i.test(t.region) ? 'EU' : t.region})` : ''}`
  const sentence = t.kind === 'local'
    ? `About ${fmtInt(pages)} pages in ${ok.length} document${ok.length === 1 ? '' : 's'}, read by ${where}. This can take a while; you can stop and resume.`
    : `About ${fmtInt(pages)} pages in ${ok.length} document${ok.length === 1 ? '' : 's'}, roughly ${fmtInt(inTokens + outTokens)} tokens to ${where}${cost ? `, est. ${cost.currency === 'USD' ? '$' : ''}${cost.amount.toFixed(2)}${cost.currency === 'USD' ? '' : ` ${cost.currency}`}` : ' (no price known for this service)'}.`
  return {
    files: sizes.map(({ file, name, pages: p, tokens, tooLarge, unreadable, scanned, note }) => ({ file, name, pages: p || null, tokens: tokens || null, ...(tooLarge ? { skip: 'too large', note } : unreadable ? { skip: 'unreadable', note } : {}), ...(scanned ? { scanned: true } : {}) })),
    documents: ok.length,
    pages,
    tokens: inTokens + outTokens,
    service,
    cost,
    needsConfirm: t.kind === 'cloud' && inTokens + outTokens >= CONFIRM_TOKENS,
    sentence,
    skipped: sizes.length - ok.length,
  }
}

// ── jobs ─────────────────────────────────────────────────────────────────
const running = new Map() // id → AbortController
let runner = (o) => require('./analysis').runAnalyse(o) // tests swap it

const jobFile = (id) => path.join(DIR, `${id}.json`)
function save(job) { fs.mkdirSync(DIR, { recursive: true }); job.updatedAt = new Date().toISOString(); fs.writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2)) }
function load(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('unknown batch')
  const job = JSON.parse(fs.readFileSync(jobFile(id), 'utf8'))
  // A run cut short (the engine stopped) can be resumed.
  if (job.state === 'running' && !running.has(id)) { job.state = 'stopped'; job.note = 'The run was interrupted (OpenLex closed). Resume to go on.' }
  return job
}

function summary(job) {
  const n = (s) => job.files.filter((f) => f.status === s).length
  return { ...job, counts: { total: job.files.length, done: n('done'), failed: n('failed'), skipped: n('skipped'), waiting: n('waiting') + n('reading') } }
}

/** Start a batch. A cloud run above the estimate threshold needs confirmed: true (the window asked). */
async function start({ files, folder, attachments, matterId = null, confirmed = false, focus = '' } = {}) {
  const est = await estimate({ files, folder, attachments, matterId })
  if (est.needsConfirm && confirmed !== true) {
    const e = new Error(`Please confirm first: ${est.sentence}`)
    e.code = 'CONFIRM'
    e.estimate = est
    throw e
  }
  const job = {
    id: `batch_${crypto.randomBytes(6).toString('hex')}`,
    matterId, focus: String(focus || '').slice(0, 300), createdAt: new Date().toISOString(), state: 'running',
    estimate: { pages: est.pages, tokens: est.tokens, cost: est.cost, service: est.service, sentence: est.sentence },
    files: est.files.map((f) => ({ file: f.file, name: f.name, pages: f.pages, status: f.skip ? 'skipped' : 'waiting', ...(f.note ? { note: f.note } : {}) })),
  }
  save(job)
  run(job.id)
  return summary(job)
}

/** Work through the waiting documents, one at a time, in the background. */
function run(id) {
  if (running.has(id)) return
  const ac = new AbortController()
  running.set(id, ac)
  const policy = require('./policy')
  ;(async () => {
    try {
      for (;;) {
        const job = load(id)
        const next = job.files.find((f) => f.status === 'waiting' || f.status === 'reading')
        if (!next || ac.signal.aborted) {
          job.state = ac.signal.aborted ? 'stopped' : 'done'
          if (job.state === 'done') job.finishedAt = new Date().toISOString()
          save(job)
          break
        }
        next.status = 'reading'
        next.startedAt = new Date().toISOString()
        job.state = 'running'
        save(job)
        try {
          const r = await policy.withMatter(job.matterId, () => runner({ matterId: job.matterId, ...(next.file.startsWith('att:') ? { attachments: [next.file.slice(4)] } : { file: next.file }), focus: job.focus, signal: ac.signal }))
          const a = r.analyses?.[0]
          const fresh = load(id)
          const f = fresh.files.find((x) => x.file === next.file)
          // Stopped while this document was read: it is read again on resume (a partial analysis is not "done").
          if (ac.signal.aborted) { f.status = 'waiting'; delete f.startedAt; save(fresh); continue }
          Object.assign(f, { status: 'done', analysisId: a?.id || null, risks: a ? { high: a.stats.high, medium: a.stats.medium, low: a.stats.low } : null, finishedAt: new Date().toISOString() })
          save(fresh)
        } catch (err) {
          const fresh = load(id)
          const f = fresh.files.find((x) => x.file === next.file)
          if (ac.signal.aborted) f.status = 'waiting'
          else Object.assign(f, { status: 'failed', note: String(err.message).split('\n')[0].slice(0, 300) })
          // The data policy forbids the service: stop the whole run (every file would fail the same way).
          if (err.code === 'POLICY_BLOCKED' || /data policy/i.test(err.message)) { fresh.state = 'stopped'; fresh.note = String(err.message).slice(0, 300); save(fresh); break }
          save(fresh)
        }
      }
    } catch (err) {
      console.warn('[batch]', id, err.message)
    } finally {
      running.delete(id)
    }
  })()
}

function stop(id) {
  const job = load(id)
  const ac = running.get(id)
  if (ac) ac.abort()
  job.state = 'stopped'
  save(job)
  return summary(job)
}

function resume(id) {
  const job = load(id)
  if (job.state === 'done') return summary(job)
  for (const f of job.files) if (f.status === 'reading') f.status = 'waiting'
  job.state = 'running'
  delete job.note
  save(job)
  run(id)
  return summary(job)
}

function get(id) { return summary(load(id)) }

function list(matterId = null) {
  let names = []
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) } catch { return [] }
  return names.map((f) => { try { return summary(load(f.replace(/\.json$/, ''))) } catch { return null } })
    .filter((j) => j && (!matterId || j.matterId === matterId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(({ files, ...rest }) => rest)
}

/** Wait until a job is no longer running (tests, the CLI). */
async function settle(id, timeoutMs = 30000) {
  const t0 = Date.now()
  while (running.has(id) && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 20))
  return get(id)
}

function setRunner(fn) { runner = fn || ((o) => require('./analysis').runAnalyse(o)) }

/** The local API: /api/batch/* and /api/batches → { status, json } or null. */
async function handle(method, p, params, body = {}) {
  const get_ = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  try {
    if (p === '/api/batches' && method === 'GET') return { status: 200, json: { batches: list(get_('matterId')) } }
    if (p === '/api/batch' && method === 'GET') return { status: 200, json: { batch: get(get_('id')) } }
    if (method !== 'POST') return p.startsWith('/api/batch') ? { status: 405, json: { error: 'use POST' } } : null
    if (p === '/api/batch/estimate') return { status: 200, json: { estimate: await estimate(body) } }
    if (p === '/api/batch/start') return { status: 200, json: { batch: await start(body) } }
    if (p === '/api/batch/stop') return { status: 200, json: { batch: stop(body.id) } }
    if (p === '/api/batch/resume') return { status: 200, json: { batch: resume(body.id) } }
    return null
  } catch (err) {
    if (err.code === 'CONFIRM') return { status: 409, json: { error: err.message, confirm: true, estimate: err.estimate } }
    return { status: 400, json: { error: err.message } }
  }
}

module.exports = { estimate, start, stop, resume, get, list, settle, setRunner, handle, priceFor, resolveFiles, CONFIRM_TOKENS }
