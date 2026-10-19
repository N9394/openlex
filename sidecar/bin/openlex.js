#!/usr/bin/env node
"use strict"
/**
 * openlex — command line for the local OpenLex engine (the same engine the
 * Word add-in, Outlook and the desktop app use: same matters, data policy,
 * model, firm library and audit log).
 *
 *   openlex status
 *   openlex ask "Is the liability cap enforceable?" [--file contract.docx] [--matter ID]
 *   openlex review   [--matter ID] [--playbook NAME] [--folder DIR]
 *   openlex chronology [--matter ID] [--folder DIR]
 *   openlex translate FILE --to en [--glossary NAME] [--matter ID]
 *   openlex compare OLD NEW [--matter ID] [--no-rate]
 *   openlex matters
 *   openlex clauses [--type liability] [--query words] [--matter ID]
 *   openlex grid list | new TITLE --columns cols.json [--matter ID] | run ID [--force] | show ID | export ID
 *   openlex decide "text" --question "Is …?" | --questions q.json [--file doc] [--matter ID]
 *   openlex serve                      run the engine in the foreground
 *
 * Finds the engine via ~/.lexvault/run/sidecar.json (url + its localhost
 * certificate); --json prints raw events/results for scripting.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const https = require('https')
const http = require('http')

const DATA_DIR = process.env.OPENLEX_DATA_DIR || process.env.LEXVAULT_DATA_DIR || path.join(os.homedir(), '.lexvault')
const REG = path.join(DATA_DIR, 'run', 'sidecar.json')

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-rate') out.rate = false
    else if (a === '--json') out.json = true
    else if (a === '--force') out.force = true
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
    else out._.push(a)
  }
  return out
}

function engine() {
  let reg
  try { reg = JSON.parse(fs.readFileSync(REG, 'utf8')) } catch {
    throw new Error('OpenLex engine is not running — open Word with the add-in, start the desktop app, or run `openlex serve`.')
  }
  try { process.kill(reg.pid, 0) } catch { throw new Error(`engine registry is stale (pid ${reg.pid} is gone) — start the engine again`) }
  const ca = reg.ca && fs.existsSync(reg.ca) ? fs.readFileSync(reg.ca) : undefined
  return { url: reg.url, ca, version: reg.version }
}

function request(method, pathname, body, { onEvent } = {}) {
  const { url, ca } = engine()
  const u = new URL(pathname, url)
  const lib = u.protocol === 'https:' ? https : http
  const data = body ? Buffer.from(JSON.stringify(body)) : null
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method,
      ca,
      headers: { Accept: onEvent ? 'text/event-stream' : 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) },
    }, (res) => {
      res.setEncoding('utf8')
      if (onEvent) {
        let buf = ''
        res.on('data', (chunk) => {
          buf += chunk
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i).replace(/^data:\s*/gm, '')
            buf = buf.slice(i + 2)
            try { onEvent(JSON.parse(frame)) } catch { /* keep-alive / partial */ }
          }
        })
        res.on('end', () => resolve(null))
        return
      }
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        let json = null
        try { json = raw ? JSON.parse(raw) : null } catch { /* not JSON */ }
        if (res.statusCode >= 400) return reject(new Error(json?.error || `HTTP ${res.statusCode}`))
        resolve(json)
      })
    })
    req.on('error', (err) => reject(new Error(`cannot reach the engine at ${url}: ${err.message}`)))
    if (data) req.write(data)
    req.end()
  })
}

async function readFileText(file) {
  const ext = path.extname(file).toLowerCase()
  const src = path.join(__dirname, '..', 'src')
  if (ext === '.docx') return require(path.join(src, 'docx_text')).docxText(file)
  if (ext === '.pdf') return require(path.join(src, 'pdf_text')).pdfText(file)
  return fs.readFileSync(file, 'utf8')
}

async function runWorkflow(type, body, opts) {
  let result = null
  await request('POST', '/api/workflows/run', { type, ...body }, {
    onEvent: (ev) => {
      if (opts.json) { console.log(JSON.stringify(ev)); return }
      if (ev.type === 'progress') process.stderr.write(`  ${ev.index ? `${ev.index}/${ev.total} ` : ''}${ev.name || ev.step || ''}\n`)
      else if (ev.type === 'error') { process.exitCode = 1; console.error(`error: ${ev.message}`) }
      else if (ev.type === 'done') result = ev
    },
  })
  if (result && !opts.json) {
    console.log(Object.entries(result.stats || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · '))
    for (const f of result.files || []) console.log(f)
  }
}

const USAGE = (() => { const lines = fs.readFileSync(__filename, 'utf8').split('\n'); const end = lines.findIndex((l) => l.includes('Finds the engine')) - 1; return lines.slice(3, end).map((l) => l.replace(/^ \* ?/, '')).join('\n') })()

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const a = parseArgs(rest)
  switch (cmd) {
    case 'serve':
      require(path.join(__dirname, '..', 'src', 'server.js'))
      return
    case 'status': {
      const st = await request('GET', '/api/status')
      if (a.json) return console.log(JSON.stringify(st, null, 2))
      const m = st.model || {}
      console.log(`engine   ${engine().url}  (version ${st.version || engine().version || '?'})`)
      console.log(`model    ${m.name || m.provider || '?'} — ${m.local !== false ? 'local' : `cloud: ${m.provider}`} — ${m.loaded ? 'ready' : m.error || 'not ready'}`)
      return
    }
    case 'ask': {
      const message = a._.join(' ').trim()
      if (!message) throw new Error('usage: openlex ask "question" [--file doc] [--matter ID]')
      const text = a.file ? await readFileText(a.file) : ''
      const docId = `cli:${a.file ? path.resolve(a.file) : 'scratch'}`
      let wroteText = false
      await request('POST', '/api/chat', { message, text, docId, matterId: a.matter }, {
        onEvent: (ev) => {
          if (a.json) { console.log(JSON.stringify(ev)); return }
          if (ev.type === 'text') { process.stdout.write(ev.text); wroteText = true }
          else if (ev.type === 'step') process.stderr.write(`  · ${ev.text}\n`)
          else if (ev.type === 'law') for (const s of ev.sources || []) process.stderr.write(`  § ${s.source_name || s.title}\n`)
          else if (ev.type === 'suggestion') console.log(`\n[${ev.suggestion.severity}] ${ev.suggestion.summary}${ev.suggestion.proposed_text ? `\n  → ${ev.suggestion.proposed_text}` : ''}`)
          else if (ev.type === 'error') { process.exitCode = 1; console.error(`error: ${ev.message}`) }
        },
      })
      if (wroteText && !a.json) process.stdout.write('\n')
      return
    }
    case 'review':
    case 'chronology':
      return runWorkflow(cmd, { matterId: a.matter, playbook: a.playbook, folder: a.folder && path.resolve(a.folder) }, a)
    case 'translate':
      if (!a._[0] || !a.to) throw new Error('usage: openlex translate FILE --to en [--glossary NAME]')
      return runWorkflow('translate', { matterId: a.matter, file: path.resolve(a._[0]), target: a.to, glossary: a.glossary }, a)
    case 'compare':
      if (a._.length < 2) throw new Error('usage: openlex compare OLD NEW')
      return runWorkflow('compare', { matterId: a.matter, fileA: path.resolve(a._[0]), fileB: path.resolve(a._[1]), rate: a.rate !== false }, a)
    case 'matters': {
      const r = await request('GET', '/api/matters')
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      for (const m of r.matters || []) console.log(`${m.id}  ${m.number ? m.number + ' · ' : ''}${m.title}${m.privileged ? '  [privileged]' : ''}  — ${m.policy?.mode === 'local-only' ? 'local only' : `cloud: ${(m.policy?.providers || []).join(', ')}`}`)
      return
    }
    case 'clauses': {
      const q = new URLSearchParams({ matterId: a.matter || '', type: a.type || '', q: a.query || '' })
      const r = await request('GET', `/api/clauses?${q}`)
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      if (!a.type && !a.query) {
        for (const t of r.types.filter((x) => x.count)) console.log(`${t.id.padEnd(18)} ${t.count}`)
        return
      }
      for (const c of r.clauses) console.log(`\n${c.heading}  (${c.label}, ${c.uses} doc${c.uses === 1 ? '' : 's'}: ${c.documents.join(', ')})\n${c.text}`)
      return
    }
    case 'grid': {
      const [sub, arg] = a._
      if (sub === 'list' || !sub) {
        const r = await request('GET', `/api/grids${a.matter ? `?matterId=${encodeURIComponent(a.matter)}` : ''}`)
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        for (const g of r.grids) console.log(`${g.id}  ${g.title}  (${g.documents} documents × ${g.columns} columns)`)
        return
      }
      if (sub === 'new') {
        if (!arg || !a.columns) throw new Error('usage: openlex grid new TITLE --columns cols.json [--matter ID]   (cols.json: [{ "label", "prompt", "type": "text|yesno|choice|date|number", "options"?, "dependsOn"? }])')
        const r = await request('POST', '/api/grids', { title: arg, matterId: a.matter, columns: JSON.parse(fs.readFileSync(a.columns, 'utf8')) })
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        console.log(`${r.id}  ${r.title}: ${r.rows.length} documents × ${r.columns.length} columns — run it with: openlex grid run ${r.id}`)
        return
      }
      if (!arg) throw new Error(`usage: openlex grid ${sub} ID`)
      if (sub === 'run') {
        let done = null
        await request('POST', '/api/grids/run', { id: arg, force: !!a.force }, {
          onEvent: (ev) => {
            if (a.json) { console.log(JSON.stringify(ev)); return }
            if (ev.type === 'progress' && ev.step === 'cell') process.stderr.write(`  ${ev.document} · ${ev.column}: ${ev.status === 'ok' ? ev.value : `[${ev.status}] ${ev.value || ''}`}\n`)
            else if (ev.type === 'error') { process.exitCode = 1; console.error(`error: ${ev.message}`) }
            else if (ev.type === 'done') done = ev
          },
        })
        if (done && !a.json) console.log(Object.entries(done.stats).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · '))
        return
      }
      if (sub === 'show') {
        const v = await request('GET', `/api/grids/view?id=${encodeURIComponent(arg)}`)
        if (a.json) return console.log(JSON.stringify(v, null, 2))
        const flag = { unverified: ' [UNVERIFIED]', invalid: ' [CHECK]', edited: ' [edited]', error: ' [ERROR]' }
        for (const row of v.rows) {
          console.log(`\n${row.name}`)
          row.cells.forEach((c, i) => console.log(`  ${v.columns[i].label}: ${!c ? '·' : c.status === 'not_found' ? '—' : c.value + (flag[c.status] || '')}`))
        }
        return
      }
      if (sub === 'export') {
        const r = await request('POST', '/api/grids/export', { id: arg })
        for (const f of r.files) console.log(f)
        return
      }
      throw new Error(`unknown grid command: ${sub}`)
    }
    case 'decide': {
      const state = a.file ? await readFileText(a.file) : a._.join(' ').trim()
      if (!state || (!a.question && !a.questions)) throw new Error('usage: openlex decide "text" --question "Is …?"  |  --questions q.json  [--file doc]')
      const questions = a.questions ? JSON.parse(fs.readFileSync(a.questions, 'utf8')) : { answer: { type: 'noul', instructions: a.question } }
      const r = await request('POST', '/api/decide', { state, questions, matterId: a.matter })
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      for (const [id, s] of Object.entries(r.summary)) {
        const ans = typeof s.answer === 'boolean' ? (s.answer ? 'yes' : 'no') : s.level ? `${s.level} (${s.answer.toFixed(2)})` : s.answer
        console.log(`${id}: ${ans}${s.p != null ? `  p=${s.p.toFixed(2)}` : ''}${s.confidence != null ? `  confidence=${s.confidence.toFixed(2)}` : ''}`)
      }
      return
    }
    default:
      console.log(USAGE)
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 2
  }
}

main().catch((err) => { console.error(`openlex: ${err.message}`); process.exitCode = 1 })
