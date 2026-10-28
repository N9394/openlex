"use strict"
/**
 * Terminal app (tui/): setup wizard, matter list, streamed chat with
 * sources and suggestion cards, "working as" without typing "@", privileged
 * toggle, action progress, dropped paths, the CLI's `matters new` /
 * `matters privileged`, the permission prompt ("OpenLex wants to save a
 * file") and the chat commands (/model, /key, /data, /as, /privileged,
 * /permissions, /clear, /help), and the status bar following changes made
 * by another front end (hub events).
 *
 *   node --test test/tui.test.js
 *
 * Offline: a fake engine (tiny local HTTP server with canned JSON and SSE)
 * found through a registry in a temp OPENLEX_DATA_DIR. No model, no
 * keychain, no network.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFile } = require('child_process')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-tui-'))
process.env.OPENLEX_DATA_DIR = DATA
process.env.NO_COLOR = '1'

// ── fake engine ──────────────────────────────────────────────────────────
const seen = []
const state = {
  active: 'local',
  keys: {},
  models: {},
  policy: { mode: 'local-only' },
  perms: { allow: ['web_fetch:eur-lex.europa.eu'], ask: [], deny: [], matters: { m_1: { allow: ['write_file'] } } },
  hub: [],
  matters: [
    { id: 'm_1', title: 'Alpine share deal', client: 'Alpine Holding', privileged: false, policy: { mode: 'local-only' } },
    { id: 'm_2', title: 'Internal investigation', client: '', privileged: true, policy: { mode: 'local-only' } },
  ],
}
const AGENTS = [
  { name: 'associate', title: 'Associate', description: 'The default: reads, searches the law, answers.' },
  { name: 'researcher', title: 'Researcher', description: 'Answers legal questions with exact citations.' },
  { name: 'reviewer', title: 'Reviewer', description: 'Reviews for the client\'s risks.' },
  { name: 'drafter', title: 'Drafter', description: 'Drafts in the firm\'s wording.' },
]
const sse = (res, events) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`)
  res.end()
}
const engine = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null
    const p = new URL(req.url, 'http://x').pathname
    seen.push({ method: req.method, path: p, body, client: req.headers['x-openlex-client'] })
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    const providers = () => ['local', 'anthropic', 'openai', 'mistral', 'openrouter', 'azure', 'bedrock', 'vertex', 'custom'].map((id) => ({
      id, label: id, local: id === 'local', needsKey: !['local', 'vertex', 'custom'].includes(id), hasKey: state.keys[id] ? true : (['local', 'vertex', 'custom'].includes(id) ? null : false),
      model: state.models[id] || (id === 'anthropic' ? 'claude-sonnet-5-5' : null), region: id === 'mistral' ? 'eu' : null,
    }))
    switch (`${req.method} ${p}`) {
      case 'GET /health': return json({ ok: true })
      case 'GET /api/status': return json({ model: { loaded: state.active !== 'local', name: state.active === 'local' ? 'lotus' : (state.models[state.active] || 'claude-sonnet-5-5'), provider: state.active, local: state.active === 'local' } })
      case 'GET /api/providers': return json({ active: state.active, providers: providers() })
      case 'POST /api/providers': if (body.active) state.active = body.active; if (body.overrides?.model) state.models[body.active] = body.overrides.model; return json({ ok: true })
      case 'POST /api/providers/key': state.keys[body.provider] = body.key; return json({ ok: true, hasKey: !!body.key })
      case 'POST /api/providers/test': return json(state.policy.mode === 'local-only' ? { ok: false, error: 'Blocked by data policy: local-only', code: 'POLICY_BLOCKED' } : { ok: true, sample: 'ok' })
      case 'GET /api/policy': return json({ default: state.policy, matters: {} })
      case 'POST /api/policy': state.policy = body.rule; return json({ ok: true })
      case 'GET /api/agents': return json({ agents: AGENTS })
      case 'GET /api/skills': return json({ skills: [{ name: 'nda-review', title: 'NDA review', description: 'Checks an NDA against the firm standard.' }] })
      case 'GET /api/matters': return json({ matters: state.matters })
      case 'POST /api/matters': { const m = { id: 'm_new', title: body.title, client: body.client, privileged: !!body.privileged, policy: { mode: 'local-only' } }; state.matters.push(m); return json({ ok: true, matter: m }) }
      case 'POST /api/matters/update': { const m = state.matters.find((x) => x.id === body.id); Object.assign(m, body.patch); return json({ ok: true, matter: m }) }
      case 'POST /api/matters/policy': { const m = state.matters.find((x) => x.id === body.id); m.policy = body.rule; return json({ ok: true, matter: m }) }
      case 'GET /api/workflows/documents': return json({ documents: [{ name: 'SPA draft 3.docx', path: '/docs/SPA draft 3.docx' }, { name: 'SPA draft 4.docx', path: '/docs/SPA draft 4.docx' }], languages: { en: 'English', de: 'German' } })
      case 'GET /api/workflows/playbooks': return json({ playbooks: [{ name: '', title: 'Standard contract review', builtIn: true }, { name: 'spa', title: 'Share purchase checklist', checks: 14, firm: true }] })
      case 'GET /api/workspace': return json({ base: path.join(DATA, 'workspace') })
      case 'POST /api/library/folders': return json({ ok: true })
      case 'POST /api/chat':
        if (/still writing/i.test(body.message)) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.write(`data: ${JSON.stringify({ type: 'text', text: 'Part one of a long answer…' })}\n\n`)
          state.finishChat = () => res.end(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
          return
        }
        if (/export|save/i.test(body.message)) {
          // Held open until the lawyer answers, like the engine does.
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          const ev = { type: 'permission', id: `perm_${seen.length}`, tool: 'write_file', title: 'OpenLex wants to save a file', summary: 'Save obligations.csv in Alpine/', detail: { path: 'Alpine/obligations.csv', content: 'party,obligation' }, risk: 'writes a file', matterId: body.matterId || null, choices: body.matterId ? ['once', 'always_matter', 'always', 'deny'] : ['once', 'always', 'deny'], always: 'write_file' }
          res.write(`data: ${JSON.stringify({ type: 'step', text: 'tool: write_file' })}\n\n`)
          res.write(`data: ${JSON.stringify(ev)}\n\n`)
          state.pending = (decision, by = 'lawyer') => {
            res.write(`data: ${JSON.stringify({ type: 'permission_result', id: ev.id, decision, by })}\n\n`)
            if (state.holdAfterPermission) { state.finishChat = () => res.end(`data: ${JSON.stringify({ type: 'done' })}\n\n`); return }
            res.end(`data: ${JSON.stringify({ type: 'text', text: decision === 'deny' ? 'I did not save the file.' : 'Saved obligations.csv.' })}\n\ndata: ${JSON.stringify({ type: 'done' })}\n\n`)
          }
          return
        }
        return sse(res, [
          { type: 'step', text: 'searching local law packs…' },
          { type: 'law', sources: [{ chunk_id: 'c1', source_name: 'ABGB', section: '§ 879' }, { chunk_id: 'c2', source_name: 'KSchG', section: '§ 6' }] },
          { type: 'text', text: 'A two-year non-compete is ' },
          { type: 'text', text: 'enforceable only if reasonable.' },
          { type: 'suggestion', suggestion: { severity: 'high', summary: 'Shorten the non-compete', proposed_text: 'twelve (12) months', basis: 'ABGB § 879' } },
          { type: 'done' },
        ])
      case 'POST /api/workflows/run':
        if (body.type === 'chronology') {
          // Held open until the test has seen the progress.
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.write(`data: ${JSON.stringify({ type: 'progress', step: 'document', index: 1, total: 2, name: 'SPA draft 3.docx' })}\n\n`)
          state.finishChronology = () => res.end(`data: ${JSON.stringify({ type: 'done', files: ['/ws/Alpine/chronology.xlsx'], stats: { documents: 2, events: 7 } })}\n\n`)
          return
        }
        return sse(res, [
          { type: 'progress', step: 'document', index: 1, total: 2, name: 'SPA draft 3.docx' },
          { type: 'progress', step: 'document', index: 2, total: 2, name: 'SPA draft 4.docx' },
          { type: 'done', files: ['/ws/Alpine/review.xlsx', '/ws/Alpine/review.docx'], stats: { documents: 2, verified: 5 } },
        ])
      case 'POST /api/permissions/answer': { const fn = state.pending; state.pending = null; fn?.(body.decision); return json(fn ? { ok: true, ...(body.decision.startsWith('always') ? { saved: 'write_file' } : {}) } : { ok: false, error: 'no such permission request' }, fn ? 200 : 404) }
      case 'GET /api/permissions': return json({ firm: { allow: [], ask: [], deny: ['run_bash'], matters: {} }, user: state.perms, locked: false, defaults: [], pending: [] })
      case 'POST /api/permissions/rules': {
        if (body.action === 'remove') {
          state.perms.allow = state.perms.allow.filter((x) => x !== body.pattern)
          for (const m of Object.values(state.perms.matters)) m.allow = m.allow.filter((x) => x !== body.pattern)
        }
        return json({ removed: true, user: state.perms })
      }
      case 'POST /api/session/clear': return json({ ok: true })
      case 'GET /api/hub/events':
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ type: 'hello', data: {} })}\n\n`)
        state.hub.push(res)
        res.on('close', () => { state.hub = state.hub.filter((x) => x !== res) })
        return
      default: return json({ error: 'not found' }, 404)
    }
  })
})

let ink, React, App, paths, h
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const flat = (f) => String(f).replace(/\s+/g, ' ')
async function waitFor(r, text, ms = 3000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const f = r.lastFrame() || ''
    // Long lines wrap: strings match across line breaks.
    if (typeof text === 'string' ? f.includes(text) || flat(f).includes(text) : text.test(f)) { await sleep(40); return r.lastFrame() }
    await sleep(20)
  }
  throw new Error(`timed out waiting for ${text}; last frame:\n${r.lastFrame()}`)
}
const KEY = { enter: '\r', down: '\u001B[B', up: '\u001B[A', esc: '\u001B', tab: '\t' }
async function press(r, ...keys) { for (const k of keys) { r.stdin.write(KEY[k] ?? k); await sleep(k === 'esc' ? 80 : 30) } }
const posted = (p) => seen.filter((x) => x.method === 'POST' && x.path === p)
/** OPENLEX_TUI_CAPTURE=1 prints the screens (for docs and reviews). */
const capture = (name, frame) => { if (process.env.OPENLEX_TUI_CAPTURE === '1') console.log(`\n--- ${name} ---\n${frame}\n`) }

/** Render at the smallest size the app is designed for: 80×24. */
const rendered = []
function show(tree) {
  const r = ink.render(tree)
  rendered.push(r)
  Object.defineProperty(r.stdout, 'columns', { value: 80 })
  Object.defineProperty(r.stdout, 'rows', { value: 24 })
  r.stdout.emit('resize')
  return r
}
const prefs = (o) => fs.writeFileSync(path.join(DATA, 'tui.json'), JSON.stringify(o))

test.before(async () => {
  await new Promise((r) => engine.listen(0, '127.0.0.1', r))
  fs.mkdirSync(path.join(DATA, 'run'), { recursive: true })
  fs.writeFileSync(path.join(DATA, 'run', 'hub.token'), 'a'.repeat(64))
  fs.writeFileSync(path.join(DATA, 'run', 'sidecar.json'), JSON.stringify({ url: `http://127.0.0.1:${engine.address().port}`, version: 'test', pid: process.pid }))
  ink = await import('ink-testing-library')
  React = await import('react')
  App = (await import('../tui/app.mjs')).App
  paths = await import('../tui/paths.mjs')
  h = React.createElement
})
test.after(() => { for (const r of rendered) { try { r.unmount() } catch { /* already */ } } engine.closeAllConnections?.(); engine.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('first run: wizard asks where the AI runs, stores the key, sets the most private rule by default', async () => {
  const r = show(h(App))
  let f = await waitFor(r, 'Where should the AI run?')
  assert.match(f, /On this computer/)
  assert.match(f, /With my own key/)
  assert.match(f, /With my firm's cloud account/)
  assert.match(f, /AI model: lotus — on this computer \(not ready\)/)
  capture('first run', f)
  await press(r, 'down', 'enter')
  await waitFor(r, 'Which service is your key from?')
  await press(r, 'enter') // Anthropic
  await waitFor(r, 'Your key')
  await press(r, 'sk-ant-secret', 'enter')
  f = await waitFor(r, 'May client documents be sent to Anthropic?')
  capture('data question', f)
  assert.ok(!f.includes('sk-ant-secret'))
  assert.match(f, /No — keep everything on this computer/)
  await press(r, 'enter') // the default: the most private answer
  f = await waitFor(r, 'Saved. Your key will be checked')
  assert.deepStrictEqual(posted('/api/providers/key').at(-1).body, { provider: 'anthropic', key: 'sk-ant-secret' })
  assert.deepStrictEqual(posted('/api/policy').at(-1).body.rule, { mode: 'local-only' })
  r.unmount()
})

test('wizard: "Yes, for all matters" with EU only and hidden names → allow-list rule, then a ✓ test', async () => {
  prefs({})
  state.active = 'local'; state.keys = {}; state.policy = { mode: 'local-only' }
  const r = show(h(App))
  await waitFor(r, 'Where should the AI run?')
  await press(r, 'down', 'enter')
  await waitFor(r, 'Which service')
  await press(r, 'down', 'down', 'enter') // Mistral
  await waitFor(r, 'Your key')
  await press(r, 'mk-1', 'enter')
  await waitFor(r, 'May client documents be sent to Mistral?')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'EU data centres only')
  await press(r, 'up', 'up', 'enter') // EU on
  await press(r, 'down', 'enter') // names on
  await waitFor(r, '[x] Hide client names')
  await press(r, 'down', 'enter')
  const f = await waitFor(r, 'answered. Everything is ready.')
  assert.match(f, /✓|\+/)
  assert.deepStrictEqual(posted('/api/policy').at(-1).body.rule, { mode: 'allow-list', providers: ['mistral'], regions: ['eu'], redact: true })
  assert.match(f, /Client data: may go to Mistral \(EU only, names hidden\)/)
  r.unmount()
})

test('home lists matters with the privileged marker and the status bar', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  const f = await waitFor(r, 'Alpine share deal')
  assert.match(f, /New matter/)
  assert.match(f, /Quick question \(no matter\)/)
  assert.match(f, /Internal investigation\s+\[privileged\]/)
  assert.match(f, /Matter: none/)
  assert.match(f, /Ctrl\+C quit/)
  capture('home', f)
  r.unmount()
})

test('matter chat: streamed answer, sources, suggestion card; "as researcher:" picks the profile without "@"', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Ask a question')
  await press(r, 'enter')
  await waitFor(r, 'Type your question')
  await press(r, 'as researcher: is a 2-year non-compete valid?', 'enter')
  const f = await waitFor(r, 'enforceable only if reasonable.')
  assert.match(f, /A two-year non-compete is enforceable only if reasonable\./)
  assert.match(f, /\[1\] ABGB § 879/)
  assert.match(f, /\[2\] KSchG § 6/)
  assert.match(f, /HIGH\s+Shorten the non-compete/)
  assert.match(f, /Proposed: twelve \(12\) months/)
  const chat = posted('/api/chat').at(-1).body
  assert.strictEqual(chat.agent, 'researcher')
  assert.strictEqual(chat.message, 'is a 2-year non-compete valid?')
  assert.strictEqual(chat.matterId, 'm_1')
  capture('matter chat', f)

  // Tab opens "Working as" (no "@" needed); the choice is kept for the matter.
  await press(r, 'tab')
  await waitFor(r, 'Who should OpenLex work as?')
  await press(r, 'down', 'down', 'down', 'enter') // Drafter
  await waitFor(r, 'Working as: Drafter')
  assert.deepStrictEqual(posted('/api/matters/update').at(-1).body, { id: 'm_1', patch: { agent: 'drafter' } })
  await press(r, 'Redraft clause 7', 'enter')
  await waitFor(r, 'You: Redraft clause 7')
  await sleep(50)
  assert.strictEqual(posted('/api/chat').at(-1).body.agent, 'drafter')
  r.unmount()
})

test('privileged toggle: on at once, off only after confirming', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, 'down', 'down', 'enter')
  capture('matter', await waitFor(r, 'Privileged — keep on this computer: Off'))
  await press(r, '5') // the 5th menu item
  await waitFor(r, 'Privileged — keep on this computer: On')
  assert.deepStrictEqual(posted('/api/matters/update').at(-1).body, { id: 'm_1', patch: { privileged: true } })
  let f = await waitFor(r, /Matter: Alpine share deal\s+\[privileged\]/)
  assert.match(f, /stays on this computer \(privileged\)/)
  const before = posted('/api/matters/update').length
  await press(r, '5')
  f = await waitFor(r, 'Turn privileged off?')
  await press(r, 'enter') // "No, keep it privileged" is first
  await waitFor(r, 'Privileged — keep on this computer: On')
  assert.strictEqual(posted('/api/matters/update').length, before)
  await press(r, '5')
  await waitFor(r, 'Turn privileged off?')
  await press(r, 'down', 'enter')
  await waitFor(r, 'Privileged — keep on this computer: Off')
  assert.deepStrictEqual(posted('/api/matters/update').at(-1).body, { id: 'm_1', patch: { privileged: false } })
  r.unmount()
})

test('per-matter client data: allow the cloud AI for one matter only', async () => {
  prefs({ setupDone: true, cloudForMatters: { mode: 'allow-list', providers: ['mistral'], regions: ['eu'] } })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Client data for this matter: stays on this computer')
  await press(r, '6')
  await waitFor(r, 'May documents of this matter be sent to Mistral?')
  await press(r, 'down', 'enter')
  const f = await waitFor(r, 'Client data for this matter: may go to Mistral (EU only)')
  assert.match(f, /Client data: may go to Mistral \(EU only\)/) // the status bar follows the matter
  assert.deepStrictEqual(posted('/api/matters/policy').at(-1).body, { id: 'm_1', rule: { mode: 'allow-list', providers: ['mistral'], regions: ['eu'] } })
  r.unmount()
})

test('action: checklist review shows progress, then the result files to open', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Actions…')
  await press(r, '3')
  await waitFor(r, 'Review the documents against a checklist')
  await press(r, 'enter')
  await waitFor(r, 'Which checklist?')
  await press(r, 'down', 'enter') // the firm's checklist
  const f = await waitFor(r, 'Open review.xlsx')
  assert.match(f, /Done\. 2 documents · 5 findings \(each quoted\)|Done\. 2 documents \| 5 findings/)
  assert.match(f, /Open review\.docx/)
  assert.match(f, /Open the folder/)
  assert.deepStrictEqual(posted('/api/workflows/run').at(-1).body, { type: 'review', playbook: 'spa', matterId: 'm_1' })
  capture('action result', f)
  r.unmount()
})

test('action progress: the chronology shows which document is being read, then the result', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Actions…')
  await press(r, '3')
  await waitFor(r, 'Build a chronology')
  await press(r, '2')
  await waitFor(r, 'Build a chronology from 2 documents?')
  await press(r, 'enter')
  let f = await waitFor(r, 'Working — 1 of 2…')
  assert.match(f, /Reading SPA draft 3\.docx/)
  assert.match(f, /Esc stop/)
  capture('action progress', f)
  state.finishChronology()
  f = await waitFor(r, 'Open chronology.xlsx')
  assert.match(f, /2 documents · 7 dated events/)
  r.unmount()
})

test('new matter: name, client, privileged explained, created', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, 'enter')
  await waitFor(r, 'Name of the matter')
  await press(r, 'Lease portfolio', 'enter')
  await waitFor(r, 'Client (optional)')
  await press(r, 'Beta GmbH', 'enter')
  const f = await waitFor(r, 'Is this matter privileged?')
  assert.match(f, /ever leaves this computer/)
  await press(r, 'down', 'enter')
  await waitFor(r, 'Ask a question')
  assert.deepStrictEqual(posted('/api/matters').at(-1).body, { title: 'Lease portfolio', client: 'Beta GmbH', privileged: true })
  r.unmount()
})

test('add documents: a dragged-in (quoted) file is copied into the matter folder and registered', async () => {
  prefs({ setupDone: true })
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-tui-docs-'))
  const file = path.join(src, 'Lease 2024.docx')
  fs.writeFileSync(file, 'lease')
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Add documents')
  await press(r, '2')
  await waitFor(r, 'Which documents?')
  await press(r, `'${file}' `, 'enter')
  const f = await waitFor(r, 'copied into the matter folder')
  assert.match(f, /Lease 2024\.docx/)
  const dest = path.join(DATA, 'workspace', 'Alpine_share_deal', 'documents')
  assert.strictEqual(fs.readFileSync(path.join(dest, 'Lease 2024.docx'), 'utf8'), 'lease')
  assert.deepStrictEqual(posted('/api/library/folders').at(-1).body, { path: dest, matterId: 'm_1' })
  fs.rmSync(src, { recursive: true, force: true })
  r.unmount()
})

test('help with "?", quick question works without a matter', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, '?')
  let f = await waitFor(r, 'Add documents:')
  assert.match(f, /Esc\s+go back one step/)
  await press(r, 'esc')
  await waitFor(r, 'Quick question (no matter)')
  await press(r, 'down', 'enter')
  await waitFor(r, 'Ask a legal question.')
  await press(r, 'Is ? typed, not help', 'enter')
  f = await waitFor(r, 'You: Is ? typed, not help')
  assert.strictEqual(posted('/api/chat').at(-1).body.matterId, undefined)
  r.unmount()
})

test('errors are one plain line, never a stack', async () => {
  const { friendly } = await import('../tui/api.mjs')
  assert.match(friendly(new Error('Blocked by data policy: data policy is local-only — anthropic would send data off this machine.')), /client-data rule/)
  assert.match(friendly('local engine unavailable: model not installed — run setup'), /No AI model is installed/)
  assert.match(friendly(new Error('HTTP 401 invalid x-api-key')), /did not accept your key/)
  assert.match(friendly(new Error('cannot reach the engine at http://127.0.0.1:1: ECONNREFUSED')), /not running in the background/)
  assert.ok(!friendly(new Error('x\n    at foo (bar.js:1:1)')).includes('at foo'))
})

test('dropped paths: quoted, backslash-escaped, file:// URLs, several at once', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-tui-paths-'))
  const spaced = path.join(tmp, 'My Contract.docx')
  fs.writeFileSync(spaced, 'x')
  const q = process.platform === 'win32' ? '"' : "'" // Windows terminals quote with "…" only
  assert.deepStrictEqual(paths.cleanPaths(`${q}${spaced}${q}`), [spaced])
  assert.deepStrictEqual(paths.cleanPaths(`"${spaced}"`), [spaced])
  assert.deepStrictEqual(paths.cleanPaths(spaced), [spaced]) // typed by hand, unquoted
  if (process.platform !== 'win32') assert.deepStrictEqual(paths.cleanPaths(spaced.replace(/ /g, '\\ ')), [spaced])
  assert.deepStrictEqual(paths.cleanPaths(require('node:url').pathToFileURL(spaced).href), [spaced])
  assert.deepStrictEqual(paths.cleanPaths(`${q}${spaced}${q} ${q}${tmp}${q}`), [spaced, tmp])
  assert.strictEqual(paths.completePath(path.join(tmp, 'My C')), spaced)
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('CLI: matters new --privileged and matters privileged ID --off', async () => {
  // The fake engine runs in this process, so the CLI child must run asynchronously.
  const run = (...a) => new Promise((ok) => execFile(process.execPath, [path.join(__dirname, '..', 'bin', 'openlex.js'), ...a], { env: { ...process.env, OPENLEX_DATA_DIR: DATA } }, (err, out) => ok(out)))
  assert.match(await run('matters', 'new', 'Tax audit', '--client', 'Gamma AG', '--privileged'), /Tax audit\s+\[privileged/)
  assert.deepStrictEqual(posted('/api/matters').at(-1).body, { title: 'Tax audit', client: 'Gamma AG', privileged: true })
  assert.match(await run('matters', 'privileged', 'm_1', '--off'), /no longer privileged/)
  assert.deepStrictEqual(posted('/api/matters/update').at(-1).body, { id: 'm_1', patch: { privileged: false } })
  // Not a terminal and no arguments: the usage, as before.
  assert.match(await run(), /openlex status/)
})

// ── permissions and chat commands ─────────────────────────────────────────
const CTRL_U = '\u0015'
async function openMatterChat(r) {
  await waitFor(r, 'Alpine share deal')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Ask a question')
  await press(r, 'enter')
  await waitFor(r, 'Type your question')
}
const answered = () => posted('/api/permissions/answer').map((x) => x.body.decision)
async function waitAnswers(n, ms = 3000) {
  const until = Date.now() + ms
  while (answered().length < n && Date.now() < until) await sleep(20)
  assert.strictEqual(answered().length, n)
}

test('permission prompt: plain words over the chat; Enter = allow once, a = this matter, A = always, n/Esc = no', async () => {
  prefs({ setupDone: true })
  Object.assign(state, { active: 'local', policy: { mode: 'local-only' } })
  state.matters[0].privileged = false
  const r = show(h(App))
  await openMatterChat(r)
  await press(r, 'Export the obligations as CSV', 'enter')
  let f = await waitFor(r, 'OpenLex wants to save a file')
  capture('permission prompt', f)
  assert.strictEqual(posted('/api/chat').at(-1).body.interactive, true, 'the TUI says it can answer')
  assert.match(f, /Save obligations\.csv in Alpine\//)
  assert.match(f, /path: Alpine\/obligations\.csv/)
  assert.match(f, /This writes a file\. Nothing happens until you choose\./)
  assert.match(f, /▸ Allow once\s+Enter/, 'the default is visible')
  assert.match(f, /Always allow \(this matter\)\s+a/)
  assert.match(f, /Always allow\s+A/)
  assert.match(f, /Don't allow\s+n \/ Esc/)
  await sleep(150)
  assert.strictEqual(answered().length, 0, 'never answered by itself')
  await press(r, 'enter')
  f = await waitFor(r, 'Saved obligations.csv.')
  assert.match(f, /Allowed once: Save obligations\.csv in Alpine\//)
  assert.deepStrictEqual(answered(), ['once'])

  for (const [k, want, line] of [['a', 'always_matter', 'Allowed for this matter from now on: write_file'], ['A', 'always', 'Allowed from now on: write_file'], ['esc', 'deny', 'I did not save the file.'], ['n', 'deny', 'Not allowed: Save obligations.csv']]) {
    const n = answered().length
    await press(r, 'Save it again', 'enter')
    await waitFor(r, 'OpenLex wants to save a file')
    await press(r, k)
    await waitAnswers(n + 1)
    await waitFor(r, line)
    assert.strictEqual(answered().at(-1), want, `key ${k}`)
    await waitFor(r, 'Type your question')
  }

  // No answer in time: the engine decides "no", the prompt closes and says so.
  await press(r, 'Save once more', 'enter')
  await waitFor(r, 'OpenLex wants to save a file')
  const fn = state.pending
  state.pending = null
  fn('deny', 'timeout')
  f = await waitFor(r, 'No answer in time, so not allowed')
  assert.ok(!f.includes('OpenLex wants to save a file'))
  r.unmount()
})

test('chat commands: "/" shows hints; /model, /key, /data, /as, /privileged, /permissions, /clear, /help', async () => {
  prefs({ setupDone: true })
  Object.assign(state, { active: 'local', keys: {}, models: {}, policy: { mode: 'local-only' } })
  state.matters[0].policy = { mode: 'local-only' }
  const r = show(h(App))
  await openMatterChat(r)
  await press(r, '/')
  let f = await waitFor(r, '/permissions')
  capture('slash hints', f)
  assert.match(f, /\/model \[local \| anthropic \| openrouter:MODEL\] · where the AI runs/)
  assert.match(f, /\/key \[service\] · add or replace a key/)
  await press(r, 'mo')
  f = await waitFor(r, '/model [local')
  assert.ok(!f.includes('/key [service]'))
  await press(r, CTRL_U, '/nda')
  await waitFor(r, '/nda-review · firm skill')

  // /model anthropic → active provider, one confirmation line, status bar at once.
  await press(r, CTRL_U, '/model anthropic', 'enter')
  f = await waitFor(r, 'Now using claude-sonnet-5-5 (Anthropic), cloud.')
  capture('model command', f)
  assert.deepStrictEqual(posted('/api/providers').at(-1).body, { active: 'anthropic' })
  assert.match(flat(f), /Client data for this matter: stays on this computer\. To send documents to Anthropic: \/data\./)
  assert.match(flat(f), /There is no key for Anthropic yet: \/key anthropic\./)
  assert.match(f, /AI model: claude-sonnet-5-5 — cloud: Anthropic/)

  // /key: hidden, saved, then checked.
  await press(r, '/key', 'enter')
  await waitFor(r, 'Your Anthropic key')
  await press(r, 'sk-ant-xyz', 'enter')
  f = await waitFor(r, 'Key saved for Anthropic')
  assert.ok(!f.includes('sk-ant-xyz'))
  assert.deepStrictEqual(posted('/api/providers/key').at(-1).body, { provider: 'anthropic', key: 'sk-ant-xyz' })
  assert.deepStrictEqual(posted('/api/providers/test').at(-1).body, { provider: 'anthropic', matterId: 'm_1' })

  // /data: EU only for this matter.
  await press(r, '/data', 'enter')
  await waitFor(r, 'Where may client data of this matter go?')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Client data for this matter: may go to Anthropic (EU only).')
  assert.deepStrictEqual(posted('/api/matters/policy').at(-1).body, { id: 'm_1', rule: { mode: 'allow-list', providers: ['anthropic'], regions: ['eu'] } })

  // /model with a model name; an unknown service.
  await press(r, '/model openrouter:qwen/qwen3.5-9b', 'enter')
  await waitFor(r, 'Now using qwen/qwen3.5-9b (OpenRouter), cloud.')
  assert.deepStrictEqual(posted('/api/providers').at(-1).body, { active: 'openrouter', provider: 'openrouter', overrides: { model: 'qwen/qwen3.5-9b' } })
  await press(r, '/model nowhere', 'enter')
  await waitFor(r, 'There is no AI service called "nowhere"')

  // /model alone: the picker, in the chat.
  await press(r, '/model', 'enter')
  await waitFor(r, 'Where should the AI run?')
  await press(r, 'enter') // first: on this computer
  await waitFor(r, 'Now using lotus (this computer), on this computer.')
  assert.strictEqual(posted('/api/providers').at(-1).body.active, 'local')

  // /as and /privileged.
  await press(r, '/as researcher', 'enter')
  await waitFor(r, 'Now working as Researcher for this matter.')
  assert.deepStrictEqual(posted('/api/matters/update').at(-1).body, { id: 'm_1', patch: { agent: 'researcher' } })
  await press(r, '/privileged on', 'enter')
  await waitFor(r, 'Privileged: nothing from this matter leaves this computer.')
  assert.deepStrictEqual(posted('/api/matters/update').at(-1).body, { id: 'm_1', patch: { privileged: true } })
  await press(r, '/privileged off', 'enter')
  await waitFor(r, 'Turn privileged off?')
  await press(r, 'down', 'enter')
  await waitFor(r, 'No longer privileged')
  assert.deepStrictEqual(posted('/api/matters/update').at(-1).body, { id: 'm_1', patch: { privileged: false } })
  await waitFor(r, 'Type your question')

  // /permissions: the rules, remove one.
  await press(r, '/permissions', 'enter')
  f = await waitFor(r, 'What OpenLex may do without asking')
  capture('permissions list', f)
  assert.match(f, /web_fetch:eur-lex\.europa\.eu\s+allowed everywhere/)
  assert.match(f, /write_file\s+this matter/)
  assert.match(f, /run_bash\s+blocked by your firm/)
  await press(r, 'enter')
  await waitFor(r, 'Remove "web_fetch:eur-lex.europa.eu"?')
  await press(r, 'enter')
  await waitFor(r, '▸ ✓ write_file')
  assert.deepStrictEqual(posted('/api/permissions/rules').at(-1).body, { action: 'remove', pattern: 'web_fetch:eur-lex.europa.eu' })
  await press(r, 'esc')
  await waitFor(r, 'Removed: web_fetch:eur-lex.europa.eu')

  // /help and /clear.
  await press(r, '/help', 'enter')
  await waitFor(r, '/clear — start a new conversation')
  await press(r, '/clear', 'enter')
  f = await waitFor(r, 'New conversation for this matter')
  assert.deepStrictEqual(posted('/api/session/clear').at(-1).body, { docId: 'tui:m_1' })
  assert.ok(!f.includes('/clear — start'), 'the conversation was cleared')
  r.unmount()
})

test('changing the model while an answer is written: applies to the next question', async () => {
  prefs({ setupDone: true })
  Object.assign(state, { active: 'local', keys: { anthropic: 'k' }, models: {}, policy: { mode: 'local-only' } })
  const r = show(h(App))
  await openMatterChat(r)
  await press(r, 'This is still writing', 'enter')
  await waitFor(r, 'Part one of a long answer')
  await press(r, '/model anthropic', 'enter')
  const f = await waitFor(r, 'This applies from your next question; the answer being written keeps the current model.')
  capture('model change while streaming', f)
  await press(r, 'Another question', 'enter')
  await waitFor(r, 'The answer is still being written.')
  state.finishChat()
  await waitFor(r, 'Working as:')
  r.unmount()
})

test('another front end changes the model or the rule: the status bar follows (hub)', async () => {
  prefs({ setupDone: true })
  Object.assign(state, { active: 'local', models: {}, policy: { mode: 'local-only' } })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await waitFor(r, 'AI model: lotus — on this computer')
  const until = Date.now() + 3000
  while (!state.hub.length && Date.now() < until) await sleep(20)
  assert.ok(state.hub.length, 'the terminal app follows the hub')
  assert.strictEqual(seen.filter((x) => x.path === '/api/hub/events').length > 0, true)
  state.active = 'mistral'
  state.policy = { mode: 'allow-list', providers: ['mistral'], regions: ['eu'] }
  for (const res of state.hub) res.write(`data: ${JSON.stringify({ type: 'provider-changed', from: 'cli', data: {} })}\n\n`)
  const f = await waitFor(r, 'AI model: claude-sonnet-5-5 — cloud: Mistral, EU')
  assert.match(f, /Client data: may go to Mistral \(EU only\)/)
  r.unmount()
})

test('CLI: permissions list / allow --matter / remove; ask from a script never asks, --allow and --yes are explicit', async () => {
  const run = (...a) => new Promise((ok) => execFile(process.execPath, [path.join(__dirname, '..', 'bin', 'openlex.js'), ...a], { env: { ...process.env, OPENLEX_DATA_DIR: DATA } }, (err, out, errOut) => ok(out + errOut)))
  state.perms = { allow: ['write_file'], ask: [], deny: ['run_bash'], matters: { m_1: { allow: ['web_fetch:eur-lex.europa.eu'] } } }
  const list = await run('permissions')
  assert.match(list, /YOUR RULES/)
  assert.match(list, /allow\s+write_file/)
  assert.match(list, /m_1\s+allow web_fetch:eur-lex\.europa\.eu/)
  assert.match(list, /FIRM RULES \(deny wins over any allow\)[\s\S]*deny\s+run_bash/)
  assert.match(await run('permissions', 'allow', 'mcp:dms:*', '--matter', 'm_1'), /allowed without asking: mcp:dms:\* \(matter m_1 only\)/)
  assert.deepStrictEqual(posted('/api/permissions/rules').at(-1).body, { action: 'allow', pattern: 'mcp:dms:*', matterId: 'm_1' })
  assert.strictEqual(posted('/api/permissions/rules').at(-1).client, 'cli', 'the CLI names itself (hub events say who changed what)')
  assert.match(await run('permissions', 'remove', 'write_file'), /removed write_file/)
  assert.match(await run('permissions', 'frobnicate'), /usage: openlex permissions/)
  await run('ask', 'What applies?', '--json')
  let chat = posted('/api/chat').at(-1).body
  assert.strictEqual(chat.interactive, false, 'not a terminal: fail closed')
  assert.strictEqual(chat.allow, undefined)
  await run('ask', 'What applies?', '--json', '--allow', 'write_file:Acme/**,web_fetch:eur-lex.europa.eu', '--yes')
  chat = posted('/api/chat').at(-1).body
  assert.deepStrictEqual([chat.allow, chat.yes], [['write_file:Acme/**', 'web_fetch:eur-lex.europa.eu'], true])
})
