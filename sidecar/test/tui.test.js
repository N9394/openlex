"use strict"
/**
 * Terminal app (tui/): setup wizard, matter list, streamed chat with
 * sources and suggestion cards, "working as" without typing "@", privileged
 * toggle, action progress, dropped paths, and the CLI's `matters new` /
 * `matters privileged`.
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
  policy: { mode: 'local-only' },
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
    seen.push({ method: req.method, path: p, body })
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    const providers = () => ['local', 'anthropic', 'openai', 'mistral', 'openrouter', 'azure', 'bedrock', 'vertex', 'custom'].map((id) => ({
      id, label: id, local: id === 'local', needsKey: !['local', 'vertex', 'custom'].includes(id), hasKey: state.keys[id] ? true : (['local', 'vertex', 'custom'].includes(id) ? null : false),
      model: id === 'anthropic' ? 'claude-sonnet-5-5' : null, region: id === 'mistral' ? 'eu' : null,
    }))
    switch (`${req.method} ${p}`) {
      case 'GET /health': return json({ ok: true })
      case 'GET /api/status': return json({ model: { loaded: state.active !== 'local', name: state.active === 'local' ? 'lotus' : 'claude-sonnet-5-5', provider: state.active, local: state.active === 'local' } })
      case 'GET /api/providers': return json({ active: state.active, providers: providers() })
      case 'POST /api/providers': if (body.active) state.active = body.active; return json({ ok: true })
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
      default: return json({ error: 'not found' }, 404)
    }
  })
})

let ink, React, App, paths, h
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(r, text, ms = 3000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const f = r.lastFrame() || ''
    if (typeof text === 'string' ? f.includes(text) : text.test(f)) { await sleep(40); return r.lastFrame() }
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
function show(tree) {
  const r = ink.render(tree)
  Object.defineProperty(r.stdout, 'columns', { value: 80 })
  Object.defineProperty(r.stdout, 'rows', { value: 24 })
  r.stdout.emit('resize')
  return r
}
const prefs = (o) => fs.writeFileSync(path.join(DATA, 'tui.json'), JSON.stringify(o))

test.before(async () => {
  await new Promise((r) => engine.listen(0, '127.0.0.1', r))
  fs.mkdirSync(path.join(DATA, 'run'), { recursive: true })
  fs.writeFileSync(path.join(DATA, 'run', 'sidecar.json'), JSON.stringify({ url: `http://127.0.0.1:${engine.address().port}`, version: 'test', pid: process.pid }))
  ink = await import('ink-testing-library')
  React = await import('react')
  App = (await import('../tui/app.mjs')).App
  paths = await import('../tui/paths.mjs')
  h = React.createElement
})
test.after(() => { engine.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

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
  assert.deepStrictEqual(paths.cleanPaths(`'${spaced}'`), [spaced])
  assert.deepStrictEqual(paths.cleanPaths(`"${spaced}"`), [spaced])
  assert.deepStrictEqual(paths.cleanPaths(spaced), [spaced]) // typed by hand, unquoted
  if (process.platform !== 'win32') assert.deepStrictEqual(paths.cleanPaths(spaced.replace(/ /g, '\\ ')), [spaced])
  assert.deepStrictEqual(paths.cleanPaths(`file://${spaced.replace(/ /g, '%20')}`), [spaced])
  assert.deepStrictEqual(paths.cleanPaths(`'${spaced}' '${tmp}'`), [spaced, tmp])
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
