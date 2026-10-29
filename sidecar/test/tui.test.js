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
      case 'GET /api/activity': return json({ activity: state.activity || [] })
      case 'GET /api/record': {
        const qs = new URL(req.url, 'http://x').searchParams
        state.recordQueries = [...(state.recordQueries || []), qs.toString()]
        const entries = (state.record || []).filter((x) => qs.get('left') !== '1' || x.left)
        return json({ matter: qs.get('matterId') ? { id: qs.get('matterId'), title: 'Alpine share deal' } : null, total: entries.length, nextCursor: null, entries, summary: { text: qs.get('left') === '1' ? '1 request · 1 sent to Claude (Anthropic, EU), names hidden · 1 online lookup' : '2 requests · 1 sent to Claude (Anthropic, EU), names hidden · 1 online lookup · 1 permission denied' }, verify: { ok: true, text: 'Record intact.', fingerprint: '3f2a 9c1d' } })
      }
      case 'GET /api/record/verify': return json({ ok: false, text: 'Record changed: Audit log — Line 7 was changed after it was written.', fingerprint: '3f2a 9c1d 77b0 e412', files: [{ name: 'Audit log (AI calls, online lookups, permissions)', ok: false, entries: 9, broken: { line: 7, why: 'Line 7 was changed after it was written.' }, notes: [] }] })
      case 'POST /api/record/export': return json({ ok: true, file: `/ws/Alpine/ai-record-2026-10-29-14-02.${body.format}`, format: body.format, entries: 2, verified: true, fingerprint: '3f2a 9c1d' })
      case 'GET /api/law/section': return json({ source_name: 'ABGB', section: '§ 933', content: 'Das Recht auf die Gewährleistung muss gerichtlich geltend gemacht werden, und zwar, wenn es unbewegliche Sachen betrifft, binnen drei Jahren.' })
      case 'GET /api/workflows/documents':
        if (state.manyDocs) return json({ documents: Array.from({ length: 12 }, (_, i) => ({ name: `Lease ${String(i + 1).padStart(2, '0')}.docx`, path: `/docs/Lease ${i + 1}.docx` })), languages: { en: 'English' } })
        return json({ documents: [{ name: 'SPA draft 3.docx', path: '/docs/SPA draft 3.docx' }, { name: 'SPA draft 4.docx', path: '/docs/SPA draft 4.docx' }], languages: { en: 'English', de: 'German' } })
      case 'GET /api/workflows/playbooks': return json({ playbooks: [{ name: '', title: 'Standard contract review', builtIn: true }, { name: 'spa', title: 'Share purchase checklist', checks: 14, firm: true }] })
      case 'GET /api/workspace': return json({ base: path.join(DATA, 'workspace') })
      case 'POST /api/library/folders': return json({ ok: true })
      case 'GET /api/folder': {
        // As the engine does it (folder.js check), with the documents counted.
        const fo = require('../src/folder')
        const c = fo.check(new URL(req.url, 'http://x').searchParams.get('path'))
        if (!c.ok) return json({ ok: false, error: c.error })
        return json({ ok: true, path: c.path, short: c.short, broad: c.broad, documents: c.broad ? null : fo.documents(c.path).count, truncated: false })
      }
      case 'POST /api/folder/save':
        if (!body.decision) return json({ ask: { type: 'permission', id: 'save', tool: 'write_file', title: 'OpenLex wants to save a file', summary: `Save ${body.path} in this folder: ~/Clients/Alpine`, risk: 'writes a file', choices: ['once', 'always_folder', 'deny'], folder: '~/Clients/Alpine' } })
        state.saved = body
        return json({ saved: `/x/${body.path}`, short: `~/Clients/Alpine/${body.path}` })
      case 'POST /api/chat':
        // A scripted answer (transparency tests): its events, then held open until finishChat().
        if (state.chatScript) {
          const script = state.chatScript
          state.chatScript = null
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          for (const e of script) res.write(`data: ${JSON.stringify(e)}\n\n`)
          state.chatRes = res
          state.chatSend = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`)
          res.on('close', () => { state.chatClosed = true })
          state.finishChat = (more = []) => { for (const e of more) res.write(`data: ${JSON.stringify(e)}\n\n`); res.end(`data: ${JSON.stringify({ type: 'done' })}\n\n`) }
          return
        }
        if (/still writing/i.test(body.message)) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.write(`data: ${JSON.stringify({ type: 'text', text: 'Part one of a long answer…' })}\n\n`)
          state.finishChat = () => res.end(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
          return
        }
        if (/cannot reach/i.test(body.message)) return sse(res, [{ type: 'error', message: 'fetch failed: ECONNREFUSED api.anthropic.com' }])
        if (body.folder && /here/i.test(body.message)) {
          // Saving in the working folder: "Always allow (this folder)" instead of matter/everywhere.
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          const ev = { type: 'permission', id: `perm_${seen.length}`, tool: 'write_file', title: 'OpenLex wants to save a file', summary: 'Save obligations.csv in this folder: ~/Clients/Alpine', detail: { path: 'obligations.csv', content: 'party,obligation' }, risk: 'writes a file', matterId: body.matterId || null, choices: ['once', 'always_folder', 'deny'], always: null, folder: '~/Clients/Alpine', alwaysFolder: 'write_file:~/Clients/Alpine/**' }
          res.write(`data: ${JSON.stringify({ type: 'step', kind: 'tool', tool: 'write_file', detail: { file: 'obligations.csv', where: 'folder' } })}\n\n`)
          res.write(`data: ${JSON.stringify(ev)}\n\n`)
          state.pending = (decision, by = 'lawyer') => {
            res.write(`data: ${JSON.stringify({ type: 'permission_result', id: ev.id, decision, by })}\n\n`)
            res.end(`data: ${JSON.stringify({ type: 'text', text: decision === 'deny' ? 'I did not save the file.' : 'Saved obligations.csv.' })}\n\ndata: ${JSON.stringify({ type: 'done' })}\n\n`)
          }
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
        if (state.workflowScript) {
          const script = state.workflowScript
          state.workflowScript = null
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          state.workflowSend = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`)
          state.finishWorkflow = (e) => res.end(`data: ${JSON.stringify(e)}\n\n`)
          res.on('close', () => { state.workflowClosed = true })
          for (const e of script) state.workflowSend(e)
          return
        }
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
      case 'POST /api/permissions/answer': { const fn = state.pending; state.pending = null; fn?.(body.decision); return json(fn ? { ok: true, ...(body.decision === 'always_folder' ? { saved: 'write_file:~/Clients/Alpine/**' } : body.decision.startsWith('always') ? { saved: 'write_file' } : {}) } : { ok: false, error: 'no such permission request' }, fn ? 200 : 404) }
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

let ink, React, App, paths, h, explain
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
  explain = await import('../tui/explain.mjs')
  h = React.createElement
})
test.after(() => { for (const r of rendered) { try { r.unmount() } catch { /* already */ } } engine.closeAllConnections?.(); engine.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('first run: wizard asks where the AI runs, stores the key, sets the most private rule by default', async () => {
  const r = show(h(App))
  let f = await waitFor(r, 'Where should the AI run?')
  assert.match(f, /On this computer/)
  assert.match(f, /With my own key/)
  assert.match(f, /With my firm's cloud account/)
  assert.match(f, /AI: on this computer \(not ready\)/)
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
  assert.match(f, /N new matter · Q quick question · \/ filter/)
  assert.match(f, /\? help/)
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
  await waitFor(r, 'as Drafter')
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
  // A severe change: it needs "yes" typed; anything else keeps it privileged.
  await press(r, 'ok', 'enter')
  await waitFor(r, 'Still privileged.')
  await waitFor(r, 'Privileged — keep on this computer: On')
  assert.strictEqual(posted('/api/matters/update').length, before)
  await press(r, '5')
  await waitFor(r, 'Turn privileged off?')
  await press(r, 'yes', 'enter')
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
  assert.match(f, /Done in \d+ s\. 2 documents (·|\|) 5 findings \(each quoted\)/)
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
  let f = await waitFor(r, 'Document 1 of 2')
  assert.match(f, /▸ SPA draft 3\.docx — finding the dated events/)
  assert.match(f, /• SPA draft 4\.docx/)
  assert.match(f, /time left: known after the first one/)
  assert.match(f, /Esc stop · what is done so far is saved in the matter folder/)
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
  let f = await waitFor(r, 'Work with files')
  capture('help', f)
  assert.match(f, /Esc\s+stop the answer/)
  assert.match(f, /\/folder\s+the folder OpenLex works in/)
  await press(r, 'esc')
  await waitFor(r, 'Quick question (no matter)')
  await press(r, 'down', 'enter')
  await waitFor(r, 'Ask a legal question.')
  await press(r, 'Is ? typed, not help', 'enter')
  f = await waitFor(r, 'enforceable only if reasonable')
  assert.strictEqual(posted('/api/chat').at(-1).body.message, 'Is ? typed, not help')
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
  await waitFor(r, 'Tab to change')
  await press(r, '\u0015') // Ctrl+U: text kept from an earlier test (drafts survive going back)
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
  assert.match(flat(f), /OpenLex wants to save obligations\.csv in Alpine\/\. Allow\?/)
  assert.match(f, /path: Alpine\/obligations\.csv/)
  assert.match(flat(f), /This writes a file\. Nothing happens until you choose\./)
  assert.match(f, /▸ 1 Allow once\s+Enter/, 'the default is visible, numbered')
  assert.match(f, /2 Always allow \(this matter\)\s+a/)
  assert.match(f, /3 Always allow\s+A/)
  assert.match(f, /4 Don't allow\s+n \/ Esc/)
  await sleep(150)
  assert.strictEqual(answered().length, 0, 'never answered by itself')
  await press(r, 'enter')
  f = await waitFor(r, 'Saved obligations.csv.')
  assert.match(f, /Allowed once: Save obligations\.csv in Alpine\//)
  assert.deepStrictEqual(answered(), ['once'])

  for (const [k, want, line] of [['a', 'always_matter', 'Allowed for this matter from now on: saving files'], ['A', 'always', 'Allowed from now on: saving files'], ['esc', 'deny', 'I did not save the file.'], ['n', 'deny', 'Not allowed: Save obligations.csv']]) {
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
  await waitFor(r, '/nda-review · firm instructions')

  // /model anthropic → active provider, one confirmation line, status bar at once.
  await press(r, CTRL_U, '/model anthropic', 'enter')
  f = await waitFor(r, 'Now using Claude (Anthropic), an online AI service.')
  capture('model command', f)
  assert.deepStrictEqual(posted('/api/providers').at(-1).body, { active: 'anthropic' })
  assert.match(flat(f), /Client data for this matter: stays on this computer\. To send documents to Anthropic: \/data\./)
  assert.match(flat(f), /There is no key for Anthropic yet: \/key anthropic\./)
  assert.match(f, /AI: Claude \(Anthropic\) — online AI service/)

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
  await waitFor(r, 'Now using OpenRouter, an online AI service. Client')
  assert.deepStrictEqual(posted('/api/providers').at(-1).body, { active: 'openrouter', provider: 'openrouter', overrides: { model: 'qwen/qwen3.5-9b' } })
  await press(r, '/model nowhere', 'enter')
  await waitFor(r, 'There is no AI service called "nowhere"')

  // /model alone: the picker, in the chat.
  await press(r, '/model', 'enter')
  await waitFor(r, 'Where should the AI run?')
  await press(r, 'enter') // first: on this computer
  await waitFor(r, 'Now using the AI on this computer.')
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
  await press(r, 'yes', 'enter')
  await waitFor(r, 'No longer privileged')
  assert.deepStrictEqual(posted('/api/matters/update').at(-1).body, { id: 'm_1', patch: { privileged: false } })
  await waitFor(r, 'Type your question')

  // /permissions: the rules, remove one.
  await press(r, '/permissions', 'enter')
  f = await waitFor(r, 'What OpenLex may do without asking')
  capture('permissions list', f)
  assert.match(f, /Opening web pages on eur-lex\.europa\.eu\s+allowed everywhere/)
  assert.match(f, /Saving files\s+this matter/)
  assert.match(f, /Running programs on this computer\s+blocked by your firm/)
  await press(r, 'enter')
  await waitFor(r, 'Remove "opening web pages on eur-lex.europa.eu"?')
  await press(r, 'enter')
  await waitFor(r, '▸ ✓ Saving files')
  assert.deepStrictEqual(posted('/api/permissions/rules').at(-1).body, { action: 'remove', pattern: 'web_fetch:eur-lex.europa.eu' })
  await press(r, 'esc')
  await waitFor(r, 'Removed: opening web pages on eur-lex.europa.eu')

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
  await waitFor(r, 'AI: on this computer')
  const until = Date.now() + 3000
  while (!state.hub.length && Date.now() < until) await sleep(20)
  assert.ok(state.hub.length, 'the terminal app follows the hub')
  assert.strictEqual(seen.filter((x) => x.path === '/api/hub/events').length > 0, true)
  state.active = 'mistral'
  state.policy = { mode: 'allow-list', providers: ['mistral'], regions: ['eu'] }
  for (const res of state.hub) res.write(`data: ${JSON.stringify({ type: 'provider-changed', from: 'cli', data: {} })}\n\n`)
  const f = await waitFor(r, 'AI: Mistral (EU) — online AI service')
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

// ── transparency: what OpenLex is doing, in a lawyer's words ─────────────

test('explain: every engine event becomes a plain sentence (no tool names, JSON or model ids)', () => {
  const step = (tool, detail = {}, extra = {}) => explain.explainStep({ type: 'step', text: `tool: ${tool}`, kind: 'tool', tool, detail, ...extra }).text
  const table = [
    [step('get_range_text', { clause: { index: 3, heading: '4. Liability' } }), 'Reading clause 4 (Liability)'],
    [step('get_clause_analysis', { clause: { index: 6, heading: '§ 7 Haftung' } }), 'Reading clause 7 (Haftung)'],
    [step('get_range_text', { clause: { index: 2, heading: null } }), 'Reading part 3 of the document'],
    [step('search_law', { query: 'Gewährleistung Frist', jurisdiction: 'AT' }), 'Searching Austrian law: “Gewährleistung Frist”'],
    [step('search_law', { query: 'notice period' }), 'Searching the law: “notice period”'],
    [step('search_ris', { query: 'Gewährleistung' }), 'Checking the official source (RIS, Austria\'s federal law database): “Gewährleistung”'],
    [step('search_eurlex', {}), 'Checking the official source (EUR-Lex, the EU\'s law database)'],
    [step('web_fetch', { host: 'eur-lex.europa.eu' }), 'Opening a web page: eur-lex.europa.eu'],
    [step('search_firm_library', { query: 'cap' }), 'Looking through your firm\'s precedents'],
    [step('find_clause', {}), 'Looking through your firm\'s precedents'],
    [step('write_file', { file: 'obligations.csv' }), 'Saving “obligations.csv” in your files folder'],
    [step('run_bash'), 'Running a program on this computer'],
    [step('mcp__dms__search'), 'Using your connector “dms”'],
    [step('some_new_tool'), 'Working on your question'],
    [explain.explainStep({ type: 'step', text: 'writing…', kind: 'writing' }).text, 'Writing the answer'],
    [explain.explainStep({ type: 'step', text: 'judge: verifying 2 suggestion(s)…', kind: 'judge', total: 2 }).text, 'Checking each suggestion against the law it cites'],
    [explain.explainStep({ type: 'step', text: 'judge: 1/2 verified', kind: 'judged', verified: 1, total: 2 }).text, 'Checked the suggestions: 1 of 2 hold up'],
    [explain.explainStep({ type: 'step', text: 'analysis time limit reached — writing answer', kind: 'timeout' }).text, 'Enough research for this question — writing the answer now'],
    [explain.explainStep({ type: 'step', text: 'failed: search_ris', kind: 'tool_failed', tool: 'search_ris', offline: true }).text, 'Couldn\'t reach RIS (Austria\'s federal law database); the answer uses the copy of the law on this computer instead.'],
    [explain.explainStep({ type: 'step', text: 'declined: web_fetch', kind: 'declined', tool: 'web_fetch', detail: { host: 'example.com' } }).text, 'Not done — you said no: opening a web page: example.com'],
    [explain.explainStep({ type: 'step', text: 'blocked: run_bash', kind: 'blocked', tool: 'run_bash' }).text, 'Not done — your firm\'s rules don\'t allow it: running a program on this computer'],
    [explain.explainStep({ type: 'step', text: 'LLM temporarily unavailable — writing with what we have', kind: 'model_unavailable' }).text, 'The AI stopped responding; writing the answer with what was found so far'],
    // Older engines send only the text: still plain words.
    [explain.explainStep({ type: 'step', text: 'tool: search_law' }).text, 'Searching the law'],
    [explain.explainStep({ type: 'step', text: 'writing… (truncated — retrying)' }).text, 'Writing the answer again (the first try was cut off)'],
    [explain.explainStep({ type: 'step', text: 'judge: 2/3 verified' }).text, 'Checked the suggestions: 2 of 3 hold up'],
    [explain.explainStep({ type: 'step', text: 'something brand new from the engine' }).text, 'Working on your question'],
  ]
  for (const [got, want] of table) assert.strictEqual(got, want)
  assert.strictEqual(explain.explainStep({ type: 'step', text: 'searching local law packs…', kind: 'law_search' }).hide, true)
  assert.strictEqual(explain.explainStep({ type: 'step', text: 'garbage filter: 3 → 2 suggestions' }).hide, true)
  // Every tool in the table: words only — never the tool's own name, an underscore or braces.
  for (const tool of Object.keys(explain.TOOL_WORDS)) {
    const x = explain.explainTool(tool, { query: 'q', host: 'h.example', clause: { heading: '1. A' }, file: 'f.txt' })
    if (x.hide) continue
    assert.ok(!x.text.includes(tool) && !/[_{}]/.test(x.text), `${tool}: ${x.text}`)
  }
  assert.strictEqual(explain.explainTool('search_ris', {}).online, 'RIS (Austria\'s federal law database)')
  assert.strictEqual(explain.explainTool('search_law', {}).online, undefined, 'the law on this computer is not "online"')
  // Errors: what went wrong and what it means for the answer.
  assert.match(explain.errorSentence('ECONNREFUSED api.anthropic.com', { partial: true }), /could not be reached.*The answer stops here; what was written so far is kept\./)
  assert.match(explain.errorSentence('Blocked by data policy: local-only'), /client-data rule.*There is no answer this time\./)
})

test('explain: the activity grows step by step (✓ done · ▸ now), with times and what was found', () => {
  let a = explain.startActivity(0)
  a = explain.applyEvent(a, { type: 'model', provider: 'local', local: true }, 500)
  a = explain.applyEvent(a, { type: 'reasoning', text: 'hmm', streaming: true }, 600)
  a = explain.applyEvent(a, { type: 'step', kind: 'tool', tool: 'get_range_text', detail: { clause: { index: 3, heading: '4. Liability' } } }, 2000)
  a = explain.applyEvent(a, { type: 'step', kind: 'tool', tool: 'search_law', detail: { query: 'Haftung', jurisdiction: 'AT' } }, 3000)
  a = explain.applyEvent(a, { type: 'law', sources: [{ chunk_id: 'c1', source_name: 'ABGB', section: '§ 1295' }] }, 4000)
  a = explain.applyEvent(a, { type: 'step', kind: 'law_search', text: 'searching local law packs…' }, 4100)
  a = explain.applyEvent(a, { type: 'compact', actions: ['x'] }, 4200)
  assert.deepStrictEqual(a.steps.map((s) => [s.text, s.status]), [
    ['Working out how to answer', 'done'], ['Reading clause 4 (Liability)', 'done'], ['Searching Austrian law: “Haftung”', 'now'],
  ])
  let lines = explain.activityLines(a, { now: 9000, width: 78 }).map((l) => l.map((g) => g.t).join(''))
  assert.match(lines[0], /OpenLex is working on it · 9 s so far/)
  assert.match(lines[1], /^ 1 ✓ Working out how to answer\s+2 s$/)
  assert.match(lines[3], /^ 3 ▸ Searching Austrian law: “Haftung”\s+6 s$/)
  assert.match(lines[4], /found: ABGB § 1295/)
  assert.match(lines.join('\n'), /• Next: writing the answer/)
  assert.match(lines.join('\n'), /✓ Stayed on this computer|Nothing has left this computer so far/)
  assert.match(lines.at(-1), /Esc stop · the answer so far is kept/)
  a = explain.applyEvent(a, { type: 'text', text: 'The cap ' }, 10000)
  a = explain.applyEvent(a, { type: 'text', text: 'is valid.' }, 10100)
  a = explain.applyEvent(a, { type: 'done' }, 12000)
  assert.deepStrictEqual(a.steps.map((s) => s.status), ['done', 'done', 'done', 'done'])
  assert.strictEqual(a.steps[3].text, 'Writing the answer')
  lines = explain.doneLines(a).map((l) => l.map((g) => g.t).join(''))
  assert.deepStrictEqual(lines, ['Done after 12 s · 4 steps', '✓ Stayed on this computer'])
  // Based on: the law found and the clause read.
  assert.deepStrictEqual(explain.basedOn(a).map((x) => x.label), ['ABGB § 1295', 'Your document: clause 4 (Liability)'])
  // A stop says what was kept.
  assert.strictEqual(explain.stopSentence(a, 'The cap is valid.'), 'Stopped by you. Kept: the answer so far (4 words), 1 law section it found. Nothing more is sent or saved.')
  // Suggestions: checked or not.
  assert.strictEqual(explain.checkLine({ basis: { source: 'ABGB', section: '§ 933' }, verdict: { status: 'verified' } }).text, 'checked against ABGB § 933 ✓')
  assert.strictEqual(explain.checkLine({ basis: 'ABGB § 933', verdict: { status: 'verified', note: 'judge unavailable — unverified' } }).text, 'could not be verified — review carefully')
  assert.strictEqual(explain.checkLine({}).ok, false)
})

test('explain: where the data went — this computer, a cloud AI, names hidden, public law databases', () => {
  const local = { type: 'model', provider: 'local', local: true }
  const claude = { type: 'model', provider: 'anthropic', label: 'Anthropic', model: 'claude-sonnet-5-5', region: 'eu-central-1', local: false, redacted: true }
  let m = explain.addModel([], local)
  assert.deepStrictEqual(explain.dataLine(m), { text: 'Stayed on this computer', left: false })
  assert.deepStrictEqual(explain.dataLine([], [], { running: true }), { text: 'Nothing has left this computer so far', left: false })
  m = explain.addModel(explain.addModel(m, claude), claude)
  assert.deepStrictEqual(explain.dataLine(m), { text: 'Sent to: Claude (Anthropic, EU) — names hidden · 2 times', left: true })
  const open = explain.addModel([], { ...claude, provider: 'openai', label: 'OpenAI', model: 'gpt-5', region: null, redacted: false })
  assert.strictEqual(explain.dataLine(open).text, 'Sent to: GPT (OpenAI) — names not hidden · once')
  assert.strictEqual(explain.dataLine(explain.addModel([], { ...claude, provider: 'mistral', model: 'mistral-large', region: 'eu', redacted: false })).text, 'Sent to: Mistral (EU) — names not hidden · once')
  const web = explain.dataLine(explain.addModel([], local), ['RIS (Austria\'s federal law database)'])
  assert.deepStrictEqual(web, { text: 'Your documents stayed on this computer. Looked up online: RIS (Austria\'s federal law database) (only search words or web addresses)', left: true })
  assert.match(explain.dataLine([], [], { unreported: 'Not reported which AI answered.' }).text, /Not reported/)
  assert.ok(!/claude-sonnet/.test(explain.serviceName(claude)), 'no model ids')
})

test('explain: progress and time left for 12 documents', () => {
  const t = (ms) => explain.timeLeft(ms)
  assert.strictEqual(t({ done: 0, total: 12, startedAt: 0, currentAt: 0, now: 5000 }), 'time left: known after the first one')
  assert.strictEqual(t({ done: 2, total: 12, startedAt: 0, currentAt: 24000, now: 30000 }), 'about 2 minutes left')
  assert.strictEqual(t({ done: 11, total: 12, startedAt: 0, currentAt: 110000, now: 112000 }), 'less than a minute left')
  assert.strictEqual(t({ done: 12, total: 12, startedAt: 0, now: 1 }), '')
  const names = Array.from({ length: 12 }, (_, i) => `Lease ${i + 1}.docx`)
  let w = explain.startWork('review', names, 0)
  w = explain.applyProgress(w, { type: 'progress', step: 'document', index: 1, total: 12, name: 'Lease 1.docx' }, 0)
  w = explain.applyProgress(w, { type: 'progress', step: 'document', index: 2, total: 12, name: 'Lease 2.docx' }, 30000)
  w = explain.applyProgress(w, { type: 'progress', step: 'document', index: 3, total: 12, name: 'Lease 3.docx' }, 60000)
  assert.deepStrictEqual([w.done, w.total], [2, 12])
  const lines = explain.workLines(w, { now: 70000, width: 78 }).map((l) => l.map((g) => g.t).join(''))
  assert.match(lines[0], /^Document 3 of 12 · about 5 minutes left · 1 min 10 s so far$/)
  assert.match(lines[1], /17%$/)
  assert.match(lines.join('\n'), /✓ Lease 1\.docx\s+30 s/)
  assert.match(lines.join('\n'), /▸ Lease 3\.docx — checking it point by point\s+10 s/)
  assert.match(lines.join('\n'), /• Lease 4\.docx/)
  assert.match(lines.join('\n'), /… \d+ more waiting/)
  assert.match(lines.at(-1), /Esc stop · what is done so far is saved in the matter folder/)
  // The grid reports a document when it is finished.
  let g = explain.startWork('grid', ['A.docx', 'B.docx'], 0)
  g = explain.applyProgress(g, { type: 'progress', step: 'document', index: 1, total: 2, name: 'A.docx' }, 20000)
  assert.deepStrictEqual(g.items.map((x) => x.status), ['done', 'now'])
})

const scriptStep = (tool, detail) => ({ type: 'step', text: `tool: ${tool}`, kind: 'tool', tool, detail })
async function openChat(r) {
  await openMatterChat(r)
}

test('chat in progress (AI on this computer): numbered steps, times, data line, how to stop; then "Based on" and Ctrl+B', async () => {
  prefs({ setupDone: true })
  Object.assign(state, { active: 'local', models: {}, policy: { mode: 'local-only' } })
  state.matters[0].policy = { mode: 'local-only' }
  let T = 1_000_000
  explain.clock.now = () => T
  const local = { type: 'model', provider: 'local', label: 'this computer', local: true, region: null, redacted: false }
  state.chatScript = [local]
  const r = show(h(App))
  await openChat(r)
  await press(r, 'How long is the warranty period under clause 4?', 'enter')
  await waitFor(r, 'Working out how to answer')
  T += 3000; state.chatSend(scriptStep('get_range_text', { clause: { index: 3, heading: '4. Gewährleistung' } }))
  await waitFor(r, 'Reading clause 4 (Gewährleistung)')
  T += 2000; state.chatSend(local)
  state.chatSend(scriptStep('search_law', { query: 'Gewährleistung Frist', jurisdiction: 'AT' }))
  await waitFor(r, 'Searching Austrian law')
  T += 4000; state.chatSend({ type: 'law', sources: [{ chunk_id: 'c9', source_name: 'ABGB', section: '§ 933', snippet: 'Das Recht auf die Gewährleistung muss gerichtlich geltend gemacht werden' }, { chunk_id: 'c10', source_name: 'ABGB', section: '§ 932', snippet: 'Der Übernehmer kann wegen eines Mangels die Verbesserung verlangen' }] })
  state.chatSend({ type: 'step', text: 'searching local law packs…', kind: 'law_search' })
  T += 1000
  let f = await waitFor(r, 'found: ABGB § 933, ABGB § 932')
  await sleep(1100) // the clock ticks once a second
  f = r.lastFrame()
  capture('chat in progress — AI on this computer', f)
  assert.match(f, / 1 ✓ Working out how to answer\s+3 s/)
  assert.match(f, / 2 ✓ Reading clause 4 \(Gewährleistung\)\s+2 s/)
  assert.match(f, / 3 ▸ Searching Austrian law: “Gewährleistung Frist”\s+5 s/)
  assert.match(f, /Next: writing the answer/)
  assert.match(f, /✓ Nothing has left this computer so far/)
  assert.match(f, /Esc stop · the answer so far is kept/)
  assert.match(f, /OpenLex is working on it · 10 s so far/)
  assert.ok(!/search_law|get_range_text|tool:|SSE|hop|phase/.test(f), 'no engine words on screen')

  T += 2000; state.chatSend({ type: 'step', text: 'writing…', kind: 'writing' })
  state.chatSend({ type: 'text', text: 'The warranty period is two years for movable goods (ABGB § 933). Clause 4 shortens it to six months.' })
  state.chatSend({ type: 'step', text: 'judge: verifying 1 suggestion(s)…', kind: 'judge', total: 1 })
  T += 3000; state.chatSend({ type: 'step', text: 'judge: 1/1 verified', kind: 'judged', verified: 1, total: 1 })
  state.finishChat([{ type: 'suggestion', suggestion: { severity: 'high', summary: 'Restore the statutory two-year period', proposed_text: 'Die Gewährleistungsfrist beträgt zwei Jahre.', basis: { source: 'ABGB', section: '§ 933' }, verdict: { status: 'verified', note: 'consistent' } } }])
  f = await waitFor(r, 'checked against ABGB § 933 ✓')
  capture('the "Based on" block', f)
  assert.match(f, /Based on:/)
  assert.match(f, /\[1\] ABGB § 933 — Das Recht auf die Gewährleistung/)
  assert.match(f, /\[3\] Your document: clause 4 \(Gewährleistung\)/)
  assert.match(f, /Ctrl\+B or \/sources: see each one in full/)
  assert.match(f, /Done after 15 s · 6 steps/)
  assert.match(f, /✓ Stayed on this computer/)

  // Ctrl+B: everything it is based on; Enter opens the law section in full.
  await press(r, '\u0002')
  f = await waitFor(r, 'What the last answer is based on')
  assert.match(f, /\[2\] ABGB § 932/)
  await press(r, 'enter')
  f = await waitFor(r, 'binnen drei Jahren')
  capture('a law section opened from "Based on"', f)
  await press(r, 'esc')
  await waitFor(r, 'What the last answer is based on')
  await press(r, 'esc')
  await waitFor(r, 'Type your question')
  explain.clock.now = () => Date.now()
  r.unmount()
})

test('chat with a cloud AI and names hidden: "Sent to" cannot be missed; Esc stops and says what was kept', async () => {
  prefs({ setupDone: true })
  Object.assign(state, { active: 'anthropic', keys: { anthropic: 'k' }, models: {}, policy: { mode: 'allow-list', providers: ['anthropic'], regions: ['eu'], redact: true } })
  state.matters[0].policy = { mode: 'allow-list', providers: ['anthropic'], regions: ['eu'], redact: true }
  let T = 2_000_000
  explain.clock.now = () => T
  const claude = { type: 'model', provider: 'anthropic', label: 'Anthropic', model: 'claude-sonnet-5-5', local: false, region: 'eu-central-1', redacted: true, role: 'plan' }
  state.chatScript = [claude]
  state.chatClosed = false
  const r = show(h(App))
  await openChat(r)
  await press(r, 'Can the seller limit liability to the purchase price?', 'enter')
  await waitFor(r, 'Sent to: Claude (Anthropic, EU) — names hidden · once')
  T += 4000; state.chatSend(scriptStep('search_ris', { query: 'Haftungsbeschränkung' }))
  await waitFor(r, 'Checking the official source')
  T += 3000; state.chatSend({ ...claude, role: 'analyze' })
  state.chatSend({ type: 'step', text: 'writing…', kind: 'writing' })
  state.chatSend({ type: 'text', text: 'In principle yes, but not for' })
  T += 2000
  let f = await waitFor(r, 'names hidden · 2 times')
  await sleep(1100)
  f = r.lastFrame()
  capture('chat in progress — cloud AI, names hidden', f)
  assert.match(flat(f), /! Sent to: Claude \(Anthropic, EU\) — names hidden · 2 times\. Also looked up online: RIS/)
  assert.match(f, /Checking the official source \(RIS, Austria's federal law/)
  assert.match(f, /▸ Writing the answer/)
  assert.match(f, /AI: Claude \(Anthropic\) — online AI service/)
  assert.ok(!/claude-sonnet/.test(f), 'no model id')
  await press(r, 'esc')
  f = await waitFor(r, 'Stopped by you.')
  capture('stopped', f)
  assert.match(flat(f), /Stopped by you\. Kept: the answer so far \(6 words\)\. Nothing more is sent or saved\./)
  assert.match(f, /Stopped after 9 s/)
  assert.match(flat(f), /! Sent to: Claude \(Anthropic, EU\) — names hidden · 2 times/)
  const until = Date.now() + 2000
  while (!state.chatClosed && Date.now() < until) await sleep(20)
  assert.ok(state.chatClosed, 'the engine is told to stop')
  explain.clock.now = () => Date.now()
  Object.assign(state, { active: 'local', keys: {}, policy: { mode: 'local-only' } })
  state.matters[0].policy = { mode: 'local-only' }
  r.unmount()
})

test('a 12-document review in progress: "Document 3 of 12 · about … left", each document, data line; Esc explains what is kept', async () => {
  prefs({ setupDone: true })
  state.manyDocs = true
  let T = 3_000_000
  explain.clock.now = () => T
  const doc = (i) => ({ type: 'progress', step: 'document', index: i, total: 12, name: `Lease ${String(i).padStart(2, '0')}.docx` })
  state.workflowScript = [doc(1)]
  state.workflowClosed = false
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Actions…')
  await press(r, '3')
  await waitFor(r, 'Review the documents against a checklist')
  await press(r, 'enter')
  await waitFor(r, 'Which checklist?')
  await press(r, 'enter')
  await waitFor(r, 'Document 1 of 12')
  T += 2000; state.workflowSend({ type: 'model', provider: 'local', local: true })
  T += 40000; state.workflowSend(doc(2))
  await waitFor(r, 'Document 2 of 12')
  T += 46000; state.workflowSend(doc(3))
  state.workflowSend({ type: 'model', provider: 'local', local: true })
  await waitFor(r, 'Document 3 of 12')
  T += 12000
  await sleep(1100)
  let f = r.lastFrame()
  capture('12-document review in progress', f)
  assert.match(f, /Document 3 of 12 · about 7 minutes left · 1 min 40 s so far/)
  assert.match(f, /✓ Lease 01\.docx\s+42 s/)
  assert.match(f, /▸ Lease 03\.docx — checking it point by point\s+12 s/)
  assert.match(f, /• Lease 04\.docx/)
  assert.match(f, /✓ Nothing has left this computer so far/)
  assert.match(f, /Esc stop · what is done so far is saved in the matter folder/)
  await press(r, 'esc')
  f = await waitFor(r, 'Stopped by you after 2 of 12 documents')
  assert.match(flat(f), /What was done so far is saved in the matter folder\. Nothing more is sent\./)
  const until = Date.now() + 2000
  while (!state.workflowClosed && Date.now() < until) await sleep(20)
  assert.ok(state.workflowClosed)
  state.manyDocs = false
  explain.clock.now = () => Date.now()
  r.unmount()
})

test('recent activity: when, what was asked, what was looked at, where data went, result', async () => {
  prefs({ setupDone: true })
  const today = new Date()
  today.setHours(14, 2, 0, 0)
  state.activity = [
    { at: today.toISOString(), kind: 'question', asked: 'Can the seller limit liability to the purchase price?', ms: 34000, looked: [{ tool: 'get_range_text', detail: { clause: { index: 3, heading: '4. Liability' } } }, { tool: 'search_law', detail: { query: 'Haftungsbeschränkung', jurisdiction: 'AT' } }, { tool: 'search_ris', detail: { query: 'Haftung' } }], sources: ['ABGB § 1295', 'ABGB § 879'], data: [{ provider: 'anthropic', label: 'Anthropic', model: 'claude-sonnet-5-5', local: false, region: 'eu-central-1', redacted: true, calls: 3 }], suggestions: 1, result: 'done' },
    { at: new Date(today.getTime() - 3600000).toISOString(), kind: 'review', asked: 'spa', ms: 410000, looked: [{ document: 'Lease 01.docx' }, { document: 'Lease 02.docx' }], sources: [], data: [{ provider: 'local', local: true, calls: 24 }], suggestions: 0, result: 'stopped' },
    { at: new Date(today.getTime() - 86400000).toISOString(), kind: 'question', asked: 'Translate the term sheet', ms: 2000, looked: [], sources: [], data: [], suggestions: 0, result: 'failed', error: 'ECONNREFUSED' },
  ]
  const r = show(h(App))
  await openChat(r)
  await press(r, '/activity', 'enter')
  let f = await waitFor(r, 'Looked at:')
  capture('recent activity', f)
  assert.match(f, /▸ ?✓ Today 14:02 · Question: “Can the seller limit liability to the purchase/)
  assert.match(f, /! Today 13:02 · Checklist review/)
  assert.match(f, /✗ Yesterday 14:02 · Question: “Translate the term sheet”/)
  assert.match(f, /Took 34 s/)
  assert.match(flat(f), /Looked at: Reading clause 4 \(Liability\); Searching Austrian law: “Haftungsbeschränkung”/)
  assert.match(f, /Law used: ABGB § 1295, ABGB § 879/)
  assert.match(flat(f), /! Sent to: Claude \(Anthropic, EU\) — names hidden · 3 times\./)
  assert.match(f, /Result: Answered, 1 proposed change/)
  await press(r, 'down')
  f = await waitFor(r, 'Stopped by you (what was done so far is kept)')
  assert.match(f, /Looked at: Lease 01\.docx; Lease 02\.docx/)
  assert.match(f, /Stayed on this computer/)
  await press(r, 'down')
  f = await waitFor(r, 'Did not finish:')
  await press(r, 'esc')
  await waitFor(r, 'Type your question')
  r.unmount()
})

test('files dropped into the question: chips, Backspace removes, sent with the question and kept in the matter; a pasted block stays one question', async () => {
  prefs({ setupDone: true })
  Object.assign(state, { active: 'local', policy: { mode: 'local-only' } })
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-tui-drop-'))
  const a = path.join(src, 'SPA draft 3.txt')
  const b = path.join(src, 'Side letter.txt')
  fs.writeFileSync(a, 'The seller warrants the shares are free of encumbrances.')
  fs.writeFileSync(b, 'Side letter: the price is adjusted.')
  const r = show(h(App))
  await openChat(r)
  // A drop arrives as a bracketed paste (or one chunk): two quoted paths → two chips.
  await press(r, `\u001b[200~'${a}' '${b}'\u001b[201~`)
  let f = await waitFor(r, 'All 2 files are included in this question.')
  capture('two files dropped into the question', f)
  assert.match(f, /\+ SPA draft 3\.txt · 56 bytes/)
  assert.match(f, /\+ Side letter\.txt · 35 bytes/)
  assert.match(f, /Type your question about the file/)
  await press(r, '\u007f') // Backspace in the empty field: the last chip goes
  f = await waitFor(r, 'Your question will be about SPA draft 3.txt.')
  assert.ok(!f.includes('Side letter.txt'))
  // A pasted block with line breaks stays one question (no early send).
  const before = posted('/api/chat').length
  await press(r, '\u001b[200~Is the warranty\rcomplete?\u001b[201~')
  f = await waitFor(r, 'Is the warranty complete?')
  await press(r, ' Also\nthe cap?')
  await sleep(80)
  assert.strictEqual(posted('/api/chat').length, before, 'nothing sent while pasting')
  assert.match(r.lastFrame(), /Is the warranty complete\? Also the cap\?/)
  state.chatScript = [{ type: 'model', provider: 'local', local: true }]
  await press(r, 'enter')
  f = await waitFor(r, 'with SPA draft 3.txt')
  f = await waitFor(r, 'copied into the matter folder')
  capture('question with an attached file', f)
  const chat = posted('/api/chat').at(-1).body
  assert.strictEqual(chat.message, 'Is the warranty complete? Also the cap?')
  assert.strictEqual(chat.text, 'The seller warrants the shares are free of encumbrances.')
  assert.deepStrictEqual(chat.files, ['SPA draft 3.txt'])
  assert.match(chat.docId, /^tui:m_1:.*SPA draft 3\.txt$/)
  assert.match(flat(f), /SPA draft 3\.txt — copied into the matter folder \(your original is unchanged\)/)
  const dest = path.join(DATA, 'workspace', 'Alpine_share_deal', 'documents', 'SPA draft 3.txt')
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'The seller warrants the shares are free of encumbrances.')
  state.finishChat([{ type: 'text', text: 'Yes: the warranty covers all shares.' }])
  // A path typed by hand and sent alone is attached too, not asked.
  await waitFor(r, 'Yes: the warranty covers all shares.')
  const n = posted('/api/chat').length
  await press(r, `'${b}'`, 'enter')
  await waitFor(r, 'Your question will be about Side letter.txt.')
  assert.strictEqual(posted('/api/chat').length, n)
  fs.rmSync(src, { recursive: true, force: true })
  r.unmount()
})

test('help: a second page explains what OpenLex is doing and why', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await waitFor(r, 'Alpine share deal')
  await press(r, '?')
  await waitFor(r, 'Ctrl+B')
  await press(r, '\u001B[C') // →
  const f = await waitFor(r, 'What OpenLex is doing and why')
  capture('help: what OpenLex is doing and why', f)
  assert.match(flat(f), /"Sent to:" names every AI service outside this computer/)
  assert.match(flat(f), /Esc stops at any time\. What was written so far is kept; nothing more is sent\./)
  r.unmount()
})

// ── working in a folder; friendlier for everyone ─────────────────────────

const FOLDERS = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-tui-folder-'))
const ALPINE = path.join(FOLDERS, 'Alpine')
fs.mkdirSync(ALPINE, { recursive: true })
for (const n of ['SPA.docx', 'Side letter.pdf', 'notes.md']) fs.writeFileSync(path.join(ALPINE, n), 'x')
fs.writeFileSync(path.join(ALPINE, 'photo.jpg'), 'x')
const tuiPrefs = () => JSON.parse(fs.readFileSync(path.join(DATA, 'tui.json'), 'utf8'))
/** Render at another size (e.g. too narrow). */
function showAt(tree, cols, rows = 24) {
  const r = ink.render(tree)
  rendered.push(r)
  Object.defineProperty(r.stdout, 'columns', { value: cols })
  Object.defineProperty(r.stdout, 'rows', { value: rows })
  r.stdout.emit('resize')
  return r
}
const CTRL = { c: '\u0003', u: '\u0015', k: '\u000B', o: '\u000F', j: '\n' }

test('working folder: a one-time notice, "Working in" in the status bar, its documents for the matter, questions carry it', async () => {
  prefs({ setupDone: true })
  Object.assign(state, { active: 'local', keys: {}, models: {}, policy: { mode: 'local-only' } })
  state.matters[0].privileged = false
  let r = show(h(App, { folder: ALPINE }))
  let f = await waitFor(r, 'OpenLex can read the files in this folder')
  capture('first time in a folder', f)
  assert.match(f.replace(/\n /g, ''), /Alpine \(3 documents\)/, 'Word, PDF and text count; the photo does not')
  assert.match(f, /It asks before it saves, renames or deletes anything here\./)
  assert.match(f, /▸ 1 OK, continue/)
  assert.match(f, /2 Don't let OpenLex read this folder/)
  await press(r, 'enter')
  f = await waitFor(r, 'Your matters')
  capture('status bar with the working folder', f)
  assert.match(f, /Matter: none {2}· {2}Working in: .*Alpine/)
  assert.match(f, /3 documents OpenLex can read/)
  assert.strictEqual(tuiPrefs().folders[fs.realpathSync(ALPINE)] || tuiPrefs().folders[ALPINE], 'ok')

  // The matter can take the folder's documents in one step.
  await press(r, 'down', 'down', 'enter')
  f = await waitFor(r, 'Use the 3 documents in this folder for this matter')
  await press(r, '7')
  f = await waitFor(r, 'Use the 3 documents in this folder for this matter?')
  capture('use the folder for the matter', f)
  await press(r, 'enter')
  await waitFor(r, 'now belong to this matter')
  assert.deepStrictEqual(posted('/api/library/folders').at(-1).body, { path: ALPINE, matterId: 'm_1' })

  // Questions carry the folder; the activity says "in this folder".
  await press(r, '1')
  await waitFor(r, 'Tab to change')
  await press(r, CTRL.u, 'What does the side letter change?', 'enter')
  await waitFor(r, 'enforceable only if reasonable')
  const chat = posted('/api/chat').at(-1).body
  assert.strictEqual(chat.folder, ALPINE)
  assert.strictEqual(chat.folderConfirmed, undefined)
  r.unmount()

  // The second time in the same folder: no notice.
  r = show(h(App, { folder: ALPINE }))
  f = await waitFor(r, 'Your matters')
  assert.ok(!f.includes('OpenLex can read the files in this folder'))
  r.unmount()
})

test('the whole home folder: a warning, the safe choice first; "anyway" is confirmed per request. Forbidding a folder saves a rule', async () => {
  prefs({ setupDone: true })
  let r = show(h(App, { folder: os.homedir() }))
  let f = await waitFor(r, "That's your whole home folder")
  capture('home folder warning', f)
  assert.match(f, /▸ 1 Don't use a folder \(work with matters only\)/, 'the safe choice is first')
  assert.match(f, /3 Use your whole home folder anyway/)
  await press(r, '3')
  f = await waitFor(r, 'Working in your whole home folder')
  assert.match(f, /Working in: ~/)
  await press(r, 'Q')
  await waitFor(r, 'Tab to change')
  await press(r, CTRL.u, 'Anything?', 'enter')
  await waitFor(r, 'enforceable only if reasonable')
  assert.deepStrictEqual([posted('/api/chat').at(-1).body.folder, posted('/api/chat').at(-1).body.folderConfirmed], [os.homedir(), true])
  r.unmount()

  const other = path.join(FOLDERS, 'Beta')
  fs.mkdirSync(other, { recursive: true })
  r = show(h(App, { folder: other }))
  await waitFor(r, 'OpenLex can read the files in this folder')
  await press(r, '2')
  f = await waitFor(r, 'OpenLex will not read')
  assert.ok(!/Working in:/.test(f))
  const rule = posted('/api/permissions/rules').at(-1).body
  assert.strictEqual(rule.action, 'deny')
  assert.match(rule.pattern, /^\*:.*Beta\/\*\*$/)
  r.unmount()
})

test('/folder changes the working folder in the chat; saving there asks with "Always allow (this folder)"; /save asks too', async () => {
  prefs({ setupDone: true, folders: { [ALPINE]: 'ok' } })
  const r = show(h(App, { folder: ALPINE }))
  await openMatterChat(r)
  await press(r, '/folder none', 'enter')
  await waitFor(r, 'Not working in a folder any more')
  let f = r.lastFrame()
  assert.ok(!/Working in:/.test(f))
  await press(r, `/folder ${ALPINE}`, 'enter')
  f = await waitFor(r, 'Now working in')
  assert.match(f, /Working in: .*Alpine/)

  await press(r, 'Save the obligations here', 'enter')
  f = await waitFor(r, 'OpenLex wants to save a file')
  capture('saving in the working folder', f)
  assert.match(f, /OpenLex wants to save obligations\.csv in this folder:/)
  assert.match(f, /~\/Clients\/Alpine\. Allow\?/)
  assert.match(f, /▸ 1 Allow once/)
  assert.match(f, /2 Always allow \(this folder\)\s+a/)
  assert.match(f, /3 Don't allow\s+n \/ Esc/)
  assert.ok(!/path: obligations\.csv/.test(f), 'the folder sentence says where; no raw path line')
  await press(r, 'a')
  f = await waitFor(r, 'Allowed in this folder from now on')
  assert.match(flat(f), /saving files in ~\/Clients\/Alpine\//)
  assert.strictEqual(answered().at(-1), 'always_folder')

  // /save: the last answer as a file, asked like any save.
  await waitFor(r, 'Saved obligations.csv.')
  await press(r, '/save', 'enter')
  await waitFor(r, 'OpenLex wants to save a file')
  await press(r, 'enter')
  f = await waitFor(r, 'Saved the answer as')
  assert.strictEqual(state.saved.folder, ALPINE)
  assert.strictEqual(state.saved.decision, 'once')
  assert.match(state.saved.path, /^answer-\d{8}-\d{4}\.md$/)
  assert.match(state.saved.content, /Saved obligations\.csv\./)
  r.unmount()
})

test('forgiving input: "Did you mean /model?", help and quit as words, Esc keeps the text, ↑ brings questions back, a long paste is one chip', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await openMatterChat(r)
  const n = posted('/api/chat').length
  await press(r, '/modle', 'enter')
  let f = await waitFor(r, 'Did you mean /model?')
  capture('did you mean', f)
  assert.match(f, /› \/model/, 'the suggestion is in the field: Enter uses it')
  await press(r, CTRL.u, '/zzzzzz', 'enter')
  await waitFor(r, 'There is no command /zzzzzz. Type /help to see the commands.')
  await press(r, CTRL.u, 'help', 'enter')
  await waitFor(r, '/help — these commands')
  assert.strictEqual(posted('/api/chat').length, n, 'none of these went to the AI')

  // Esc with text typed: first a hint, the text stays; it is still there when coming back.
  await press(r, 'a draft question')
  await press(r, 'esc')
  f = await waitFor(r, 'Your text is kept. Press Esc again to go back')
  assert.match(f, /a draft question/)
  await press(r, 'esc')
  await waitFor(r, 'Ask a question')
  await press(r, 'enter')
  f = await waitFor(r, 'a draft question')

  // ↑ in an empty field: the earlier questions.
  await press(r, CTRL.u, 'First question?', 'enter')
  await waitFor(r, 'enforceable only if reasonable')
  await press(r, '\u001B[A')
  await waitFor(r, '› First question?')
  await press(r, CTRL.u)

  // A long paste stays out of the way as one chip; Ctrl+O puts it into the field.
  const block = Array.from({ length: 8 }, (_, i) => `Line ${i + 1} of the email`).join('\n')
  await press(r, `\u001B[200~${block}\u001B[201~`)
  f = await waitFor(r, '[Pasted 8 lines]')
  capture('a long paste', f)
  const sent = posted('/api/chat').length
  await press(r, 'Summarise this', 'enter')
  for (let i = 0; i < 100 && posted('/api/chat').length === sent; i++) await sleep(20)
  assert.match(posted('/api/chat').at(-1).body.message, /^Summarise this\n\nLine 1 of the email\nLine 2/)

  // "/" opens the command list, filtered as you type; Tab completes; Esc closes it and keeps the text.
  await press(r, '/')
  f = await waitFor(r, '/permissions · what OpenLex may do without asking')
  capture('slash menu', f)
  await press(r, 'pe')
  f = await waitFor(r, '/pe')
  assert.ok(!/\/model ·/.test(f), 'filtered')
  await press(r, 'tab')
  await waitFor(r, '› /permissions')
  await press(r, 'esc')
  f = await waitFor(r, 'Tab to change')
  assert.match(f, /› \/permissions/)
  await press(r, CTRL.u)

  // Ctrl+K: every command, also without typing "/".
  await press(r, CTRL.k)
  f = await waitFor(r, 'All commands')
  capture('all commands (Ctrl+K)', f)
  assert.match(f, /\/model\s+where the AI runs/)
  await press(r, 'esc')
  await waitFor(r, 'Tab to change')

  // "quit" as a word is not a question for the AI.
  const m = posted('/api/chat').length
  await press(r, 'quit', 'enter')
  await sleep(100)
  assert.strictEqual(posted('/api/chat').length, m)
  r.unmount()
})

test('every command is in a menu (Ctrl+K) and the examples suit the folder', async () => {
  const mt = await import('../tui/matter.mjs')
  for (const c of ['model', 'key', 'data', 'as', 'privileged', 'permissions', 'folder', 'sources', 'copy', 'save', 'transcript', 'activity', 'clear', 'help']) assert.ok(mt.COMMANDS.some((x) => x.name === c), c)
  assert.strictEqual(mt.didYouMean('modle', mt.COMMANDS.map((c) => c.name)), 'model')
  assert.strictEqual(mt.didYouMean('perm', mt.COMMANDS.map((c) => c.name)), 'permissions')
  assert.strictEqual(mt.didYouMean('xyzzy', mt.COMMANDS.map((c) => c.name)), null)
  assert.deepStrictEqual(mt.examples({ folder: true }).slice(0, 2), ['Summarise the contract in this folder', 'Which deadlines are in these documents?'])
  const lines = mt.emptyLines({ folder: true, folderShort: '~/Clients/Alpine' }).map((l) => l.segs.map((s) => s.t).join(''))
  assert.match(lines[0], /Ask about the documents in ~\/Clients\/Alpine/)
  assert.ok(lines.some((l) => /Try:/.test(l)))
})

test('keys: Esc never quits; Ctrl+C stops a running answer, then twice quits (with a hint)', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await waitFor(r, 'Your matters')
  await press(r, 'esc', 'esc', 'esc')
  let f = await waitFor(r, 'Your matters')
  assert.match(f, /Enter open · N new matter/)
  await press(r, CTRL.c)
  f = await waitFor(r, 'Press Ctrl+C again to quit')
  capture('Ctrl+C once', f)
  await sleep(2100)
  f = r.lastFrame()
  assert.ok(!f.includes('Press Ctrl+C again'), 'the hint goes away')

  // A running answer: Ctrl+C stops it (and does not quit).
  state.chatScript = [{ type: 'step', kind: 'tool', tool: 'search_law', detail: { jurisdiction: 'AT', query: 'Gewährleistung' } }]
  await press(r, 'down', 'down', 'enter')
  await waitFor(r, 'Ask a question')
  await press(r, 'enter')
  await waitFor(r, 'Tab to change')
  await press(r, CTRL.u, 'Long research question', 'enter')
  await waitFor(r, 'Searching Austrian law')
  await press(r, CTRL.c)
  f = await waitFor(r, 'Stopped by you')
  assert.ok(state.chatClosed)
  assert.ok(!f.includes('Press Ctrl+C again'))
  r.unmount()
})

test('first-run tour: three short screens after setup, skippable', async () => {
  prefs({})
  Object.assign(state, { active: 'local', keys: {}, models: {}, policy: { mode: 'local-only' } })
  const r = show(h(App))
  await waitFor(r, 'Where should the AI run?')
  await press(r, 'up', 'enter') // "Skip for now"
  let f = await waitFor(r, 'What OpenLex can do')
  capture('tour 1 of 3', f)
  assert.match(f, /Welcome \(1 of 3\)/)
  await press(r, 'enter')
  f = await waitFor(r, 'How to ask')
  capture('tour 2 of 3', f)
  assert.match(f, /Summarise the contract in this folder/)
  await press(r, 'enter')
  await waitFor(r, 'Where your data goes')
  await press(r, 'esc')
  await waitFor(r, 'Your matters')
  assert.strictEqual(tuiPrefs().tourDone, true)
  r.unmount()
})

test('look: no colour with NO_COLOR, plain ASCII when asked, a screen-reader mode, and a message below 60 columns', async () => {
  const theme = await import('../tui/theme.mjs')
  const env = { ...process.env }
  try {
    // NO_COLOR (set for these tests): no colours at all, even on a terminal.
    theme.configure({}, { tty: true })
    assert.strictEqual(theme.look.colorLevel, 0)
    assert.deepStrictEqual(Object.values(theme.color).filter(Boolean), [])
    delete process.env.NO_COLOR
    delete process.env.COLORTERM
    theme.configure({}, { tty: true })
    assert.strictEqual(theme.color.accent, 'yellow', 'the terminal\'s own yellow, not a fixed shade')
    process.env.COLORTERM = 'truecolor'
    process.env.COLORFGBG = '15;0'
    theme.configure({}, { tty: true })
    assert.strictEqual(theme.color.accent, '#d9a86c', 'the exact amber only on a known dark background')
    theme.configure({ colours: 'none' }, { tty: true })
    assert.strictEqual(theme.look.colorLevel, 0)
    process.env.NO_COLOR = '1'

    prefs({ setupDone: true })
    let r = show(h(App))
    let f = await waitFor(r, 'Your matters')
    assert.ok(!/\x1b\[(3[0-9]|9[0-7]|38;)/.test(f), 'no colour codes')
    r.unmount()

    // ASCII: header, menu marks and the bottom lines are plain ASCII.
    process.env.OPENLEX_ASCII = '1'
    theme.configure({}, { tty: false })
    r = show(h(App))
    f = await waitFor(r, 'Your matters')
    capture('ASCII mode', f)
    const lines = f.split('\n')
    for (const l of [lines[0], ...lines.slice(-5)]) assert.match(l, /^[\x20-\x7e]*$/, `not ASCII: ${l}`)
    assert.match(f, /> New matter/)
    assert.match(f, /-{20}/)
    r.unmount()
    delete process.env.OPENLEX_ASCII

    // Screen-reader mode: labelled lines, numbered menus, nothing that moves.
    process.env.OPENLEX_ACCESSIBLE = '1'
    theme.configure({}, { tty: true })
    assert.ok(theme.look.reducedMotion && theme.look.accessible)
    r = show(h(App))
    f = await waitFor(r, 'Your matters')
    assert.match(f, /1\. New matter \(selected\)/)
    await press(r, 'down', 'down', 'enter')
    await waitFor(r, 'Ask a question')
    await press(r, 'enter')
    await waitFor(r, 'Tab to change')
    await press(r, CTRL.u, 'Is it valid?', 'enter')
    f = await waitFor(r, 'enforceable only if reasonable')
    capture('screen-reader mode', f)
    assert.match(f, /Proposed change:\n {3}HIGH/, 'cards without box characters')
    const mt = await import('../tui/matter.mjs')
    const said = mt.transcript([{ role: 'you', text: 'Is it valid?' }, { id: 1, role: 'ai', text: 'Yes.', suggestions: [] }], 78).map((l) => l.segs.map((s) => s.t).join('')).join('\n')
    assert.match(said, /you: Is it valid\?\nOpenLex:\nYes\./)
    assert.ok(!/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏╭╮╰╯]/.test(f))
    r.unmount()
    delete process.env.OPENLEX_ACCESSIBLE
  } finally {
    for (const k of ['NO_COLOR', 'COLORTERM', 'COLORFGBG', 'OPENLEX_ASCII', 'OPENLEX_ACCESSIBLE']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k] }
    theme.configure({}, { tty: false })
  }

  // Too narrow: a plain request instead of a broken layout.
  const r = showAt(h(App), 50)
  const f = await waitFor(r, 'Window too small')
  assert.match(flat(f), /please make it wider \(at least 60 columns\)/)
  r.unmount()
})

test('CLI: plain sentences while it works, "Based on" and where the data went; the folder it runs in', async () => {
  const run = (args, opts = {}) => new Promise((ok) => execFile(process.execPath, [path.join(__dirname, '..', 'bin', 'openlex.js'), ...args], { env: { ...process.env, OPENLEX_DATA_DIR: DATA }, cwd: opts.cwd || process.cwd() }, (err, out, errOut) => ok({ out, err: errOut })))
  fs.writeFileSync(path.join(DATA, 'tui.json'), JSON.stringify({ setupDone: true }))
  let r = await run(['ask', 'Is a two-year non-compete valid?'], { cwd: ALPINE })
  assert.match(r.out, /A two-year non-compete is enforceable only if reasonable\./)
  assert.match(r.out, /\[high\] Shorten the non-compete/)
  assert.match(r.err, /OpenLex can read the files in this folder: .*Alpine \(3 documents\)\. It asks before it saves/)
  assert.match(r.err, /Based on:\n {2}\[1\] ABGB § 879/)
  assert.match(r.err, /Done after \d+ s · \d+ steps?\n✓ Stayed on this computer/)
  assert.ok(!/searching local law packs|tool: /.test(r.err), 'no raw step text')
  let chat = posted('/api/chat').at(-1).body
  assert.strictEqual(chat.folder, fs.realpathSync(ALPINE) === ALPINE ? ALPINE : chat.folder)
  assert.ok(chat.folder.endsWith('Alpine'))
  // The second time: no notice. --no-folder: none.
  r = await run(['ask', 'Again?'], { cwd: ALPINE })
  assert.ok(!/OpenLex can read the files/.test(r.err))
  await run(['ask', 'Without?', '--no-folder'], { cwd: ALPINE })
  assert.strictEqual(posted('/api/chat').at(-1).body.folder, undefined)
  // Started in the home folder: not used, and it says how to choose one.
  r = await run(['ask', 'From home?'], { cwd: os.homedir() })
  assert.strictEqual(posted('/api/chat').at(-1).body.folder, undefined)
  assert.match(r.err, /Not working in your whole home folder/)

  // A workflow: documents in words, the result files on stdout.
  r = await run(['review', '--matter', 'm_1'])
  assert.match(r.err, /Document 1 of 2: SPA draft 3\.docx/)
  assert.match(r.err, /✓ Done after \d+ s: 2 documents, 5 verified/)
  assert.match(r.out, /\/ws\/Alpine\/review\.xlsx/)

  // The printer by itself: a read in the working folder, in words.
  const { askPrinter } = await import('../tui/cli.mjs')
  let out = ''
  const p = askPrinter({ out: { write: (s) => { out += s }, isTTY: false }, tty: false })
  p.onEvent({ type: 'step', kind: 'tool', tool: 'read_file', detail: { file: 'SPA.docx', where: 'folder' } })
  p.onEvent({ type: 'step', kind: 'outside', tool: 'write_file', detail: { file: 'x.csv' } })
  p.onEvent({ type: 'model', provider: 'anthropic', model: 'claude-x', region: 'eu', redacted: true })
  p.finish()
  assert.match(out, /Reading “SPA\.docx” in this folder/)
  assert.match(out, /! Not done — “x\.csv” is outside the folder you are working in/)
  assert.match(out, /Sent to: Claude \(Anthropic, EU\) — names hidden · once/)
})

test('an error: what happened, why, what to do — and the question is not lost', async () => {
  prefs({ setupDone: true })
  const r = show(h(App))
  await openMatterChat(r)
  await press(r, 'Why cannot reach it?', 'enter')
  const f = await waitFor(r, 'press Enter to try again')
  capture('error in three parts', f)
  assert.match(f, /✗ The AI service could not be reached\./)
  assert.match(f, /The internet connection may be off/)
  assert.match(f, /Check the connection and try again\./)
  assert.match(f, /› Why cannot reach it\?/, 'the question is back in the field')
  assert.ok(!/ECONNREFUSED|at \w+ \(/.test(f), 'no codes, no stack')
  r.unmount()
})

test.after(() => fs.rmSync(FOLDERS, { recursive: true, force: true }))

// ── the AI record (/record) ───────────────────────────────────────────────
const RECORD = () => {
  const t = new Date()
  t.setHours(14, 2, 0, 0)
  return [
    { id: 'r1', type: 'request', kind: 'question', at: t.toISOString(), title: 'Question: “Can the seller limit liability?”', window: 'Word', left: true, outcome: 'done', calls: 3,
      lines: ['Asked in: Word', 'Matter: Alpine share deal', 'AI: Claude (Anthropic, EU) — sent outside this computer, names hidden · 3 calls', 'Looked up online: RIS (Austria\'s federal law database) — only search words or a web address were sent', 'Permission to save a file: denied — decided by you', 'Result: Answered, 1 proposed change', 'Took 34 s'] },
    { id: 'r2', type: 'request', kind: 'review', at: new Date(t.getTime() - 3600000).toISOString(), title: 'Checklist review: “spa”', window: 'Terminal app', left: false, outcome: 'done', calls: 24,
      lines: ['Asked in: Terminal app', 'AI: on this computer · 24 calls', 'Result: Done, saved review.docx', 'Took 6 min'] },
  ]
}

test('AI record (/record): summary line, entries with marks and details, only-sent-outside filter, export, check; Esc goes back', async () => {
  prefs({ setupDone: true })
  state.record = RECORD()
  state.recordQueries = []
  const r = show(h(App))
  await openChat(r)
  await press(r, '/record', 'enter')
  let f = await waitFor(r, 'record intact')
  capture('AI record', f)
  assert.match(f, /OpenLex › AI record/)
  assert.match(flat(f), /2 requests · 1 sent to Claude \(Anthropic, EU\), names hidden · 1 online lookup · 1 permission denied · record intact ✓/)
  assert.match(f, /▸ ! \d+ \w+ \d{4} 14:02 · Question: “Can the seller limit liability\?” \(Word\)/)
  assert.match(f, /✓ \d+ \w+ \d{4} 13:02 · Checklist review: “spa” \(Terminal app\)/)
  assert.match(f, /! AI: Claude \(Anthropic, EU\) — sent outside this computer, names hidden/, 'the meaning is in a mark and words, not only colour')
  assert.match(f, /Permission to save a file: denied — decided by you/)
  assert.match(f, /l only sent outside · p PDF · c CSV · v check · Esc back/)
  assert.match(state.recordQueries.at(-1), /matterId=m_1/)
  await press(r, 'down')
  f = await waitFor(r, 'AI: on this computer · 24 calls')
  await press(r, 'l')
  f = await waitFor(r, 'Showing only what left this computer')
  assert.match(state.recordQueries.at(-1), /left=1/)
  assert.ok(!f.includes('Checklist review'))
  await press(r, 'p')
  f = await waitFor(r, 'Saved (2 entries)')
  assert.deepStrictEqual(posted('/api/record/export').at(-1).body, { matterId: 'm_1', left: true, format: 'pdf' })
  await press(r, 'c')
  await waitFor(r, 'ai-record-2026-10-29-14-02.csv')
  await press(r, 'v')
  f = await waitFor(r, 'Record changed')
  capture('AI record: check failed', f)
  assert.match(flat(f), /✗ Record changed: Audit log — Line 7 was changed after it was written\. Fingerprint: 3f2a 9c1d 77b0 e412/)
  assert.match(flat(f), /record changed ✗/)
  await press(r, 'esc')
  await waitFor(r, 'Type your question')
  // Also in the Ctrl+K list and the matter menu.
  const mt = await import('../tui/matter.mjs')
  assert.ok(mt.COMMANDS.some((c) => c.name === 'record'))
  await press(r, 'esc')
  f = await waitFor(r, 'AI record')
  assert.match(f, /AI record\s+what the AI did, checkable, to show a client/)
  r.unmount()
})

test('AI record in plain ASCII, and the CLI: openlex record [--left] [--verify] [--export]', async () => {
  const cli = await import('../tui/cli.mjs')
  const theme = await import('../tui/theme.mjs')
  theme.configure({ ascii: true }, { tty: false })
  try {
    const text = cli.recordText({ matter: { id: 'm_1', title: 'Alpine share deal' }, total: 2, entries: RECORD(), summary: { text: '2 requests · 1 sent to Claude (Anthropic, EU), names hidden' }, verify: { ok: true } })
    assert.ok(/^[\x20-\x7E\n]*$/.test(text), `ASCII only:\n${text}`)
    assert.match(text, /record intact \+/)
    assert.match(text, /^! \d+ \w+ \d{4} 14:02 \| Question: "Can the seller limit liability\?" \(Word\)$/m)
  } finally { theme.configure({}, { tty: false }) }
  const run = (...a) => new Promise((ok) => execFile(process.execPath, [path.join(__dirname, '..', 'bin', 'openlex.js'), ...a], { env: { ...process.env, OPENLEX_DATA_DIR: DATA } }, (err, out, errOut) => ok({ out, err: errOut, code: err?.code || 0 })))
  state.record = RECORD()
  let x = await run('record', '--matter', 'm_1', '--left', '--from', '2026-10-01')
  capture('openlex record --left', x.out)
  assert.match(x.out, /^AI record — Alpine share deal\n1 request · 1 sent to Claude \(Anthropic, EU\), names hidden · 1 online lookup · record intact ✓/)
  assert.match(x.out, /\n    AI: Claude \(Anthropic, EU\) — sent outside this computer, names hidden · 3 calls\n/)
  assert.match(state.recordQueries.at(-1), /matterId=m_1&from=2026-10-01&left=1&limit=50/)
  x = await run('record', '--verify')
  assert.match(x.out, /^✗ Record changed: Audit log — Line 7 was changed after it was written\.\nFingerprint: 3f2a 9c1d 77b0 e412/)
  assert.match(x.out, /cannot stop someone with access to this computer/)
  assert.strictEqual(x.code, 1, 'a changed record is a failure for scripts')
  x = await run('record', '--export', 'csv', '--matter', 'm_1')
  assert.match(x.out, /Saved the AI record \(2 entries, record intact ✓\):\n\/ws\/Alpine\/ai-record-2026-10-29-14-02\.csv/)
  assert.deepStrictEqual(posted('/api/record/export').at(-1).body, { matterId: 'm_1', left: false, format: 'csv' })
  x = await run('record', '--json')
  assert.strictEqual(JSON.parse(x.out).entries.length, 2)
  x = await run('record', '--from', '29.10.2026')
  assert.match(x.err, /usage: --from takes a date like 2026-10-29/)
})
