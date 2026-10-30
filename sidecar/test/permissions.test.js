"use strict"
/**
 * Permissions: what the agent may do without asking (permissions.js).
 *
 *   node --test test/permissions.test.js
 *
 * Offline: a fake OpenAI-compatible model server scripts the agent's tool
 * calls; a tiny local HTTP server wires the agent to SSE and the answer
 * endpoint the same way server.js does. Temp data dir, no keychain.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-perms-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'
const WS = path.join(DATA, 'workspace')

// ── fake model: replies are scripted per test ─────────────────────────────
const replies = []
const requests = []
const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    requests.push(body)
    const content = replies.length ? replies.shift() : 'Done.'
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
})

// ── the engine's wiring, as in server.js (/api/chat + /api/permissions/answer) ──
let perms, policy, harness
const sseWrite = (res, e) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`) }
const engine = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', async () => {
    const body = raw ? JSON.parse(raw) : {}
    if (req.url === '/api/permissions/answer') {
      const r = perms.answer(body.id, body.decision)
      res.writeHead(r.ok ? 200 : 404, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(r))
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const ac = new AbortController()
    res.on('close', () => ac.abort())
    const { runAction } = require('../src/agent')
    const { Document } = require('../src/doc')
    const ctx = { doc: new Document(body.doc ?? '§ 1 The Seller shall deliver.', `d-${Math.random()}`), memory: null, session: null, summary: () => '' }
    const sess = { ask: body.interactive ? (e) => sseWrite(res, e) : null, signal: ac.signal, allow: body.allow || [], yes: !!body.yes, timeoutMs: body.timeoutMs }
    try {
      const r = await perms.session(sess, () => policy.withMatter(body.matterId || null, () => runAction(ctx, body.message, (e) => sseWrite(res, e), { signal: ac.signal })))
      sseWrite(res, { type: 'final', text: r.text })
    } catch (err) { sseWrite(res, { type: 'error', message: err.message }) }
    res.end()
  })
})

/** POST /api/chat and answer permission events with `answer(ev)` (null = don't answer; 'abort' = hang up). */
async function chat(body, answer) {
  const base = `http://127.0.0.1:${engine.address().port}`
  const ac = new AbortController()
  const events = []
  try {
    const res = await fetch(`${base}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: ac.signal })
    const dec = new TextDecoder()
    let buf = ''
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = JSON.parse(buf.slice(0, i).replace(/^data:\s*/, ''))
        buf = buf.slice(i + 2)
        events.push(ev)
        if (ev.type === 'permission' && answer) {
          const decision = answer(ev)
          if (decision === 'abort') { ac.abort(); await new Promise((r) => setTimeout(r, 100)); return events }
          if (decision) await fetch(`${base}/api/permissions/answer`, { method: 'POST', body: JSON.stringify({ id: ev.id, decision }) })
        }
      }
    }
  } catch (err) { if (err.name !== 'AbortError') throw err }
  return events
}

const writeCall = (p = 'Acme/obligations.csv') => JSON.stringify({ reasoning: 'save it', tool: 'write_file', args: { path: p, content: 'party,obligation\nSeller,deliver' } })
/** The newest refusal the model was shown (the agent hands it back as a tool result). */
const lastToolResult = () => requests.flatMap((q) => q.messages.map((m) => m.content || '')).filter((c) => /declined|nobody can answer|Not allowed by/.test(c)).pop() || ''
const userLayer = () => JSON.parse(fs.readFileSync(path.join(DATA, 'openlex.json'), 'utf8'))
const setUser = (o) => fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify(o))
const setFirm = (o) => fs.writeFileSync(path.join(WS, 'openlex.json'), JSON.stringify(o))
const auditLines = () => fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.provider === 'permissions')

test.before(async () => {
  for (const s of [model, engine]) await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'gpt-x', nativeTools: false } })
  settings.update({ active: 'openai' })
  require('../src/workspace').setBase(WS)
  perms = require('../src/permissions')
  policy = require('../src/policy')
  harness = require('../src/harness')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
})
test.after(() => { model.close(); engine.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => { setUser({}); try { fs.unlinkSync(path.join(WS, 'openlex.json')) } catch { /* none */ } replies.length = 0; requests.length = 0 })

test('built-in defaults: read-only tools allowed, side effects and unknown tools asked; every tool is classified', () => {
  for (const t of ['get_document_map', 'search_law', 'search_ris', 'get_eu_law', 'read_file', 'list_directory', 'recall', 'remember', 'get_tool_schemas', 'tool_picker', 'propose_suggestions']) assert.strictEqual(perms.evaluate(t).decision, 'allow', t)
  for (const t of ['write_file', 'append_file', 'export_document', 'run_bash', 'web_fetch', 'web_save', 'download_to_matter', 'sync_calendar', 'mcp__dms__search', 'brand_new_tool']) assert.strictEqual(perms.evaluate(t).decision, 'ask', t)
  const tools = Object.keys(require('../src/tools').TOOLS)
  assert.deepStrictEqual(tools.filter((t) => !perms.BUILTIN[t]), [], 'every real tool has a row in the table')
})

test('patterns: path globs, hosts, commands, connectors, tool-name globs', () => {
  const m = (p, tool, args) => perms.matchPattern(p, tool, perms.subjectOf(tool, args))
  assert.ok(m('write_file', 'write_file', { path: 'x.csv' }))
  assert.ok(m('write_file:Acme/*', 'write_file', { path: 'Acme/obligations.csv' }))
  assert.ok(!m('write_file:Acme/*', 'write_file', { path: 'Acme/sub/obligations.csv' }), '* stays in the folder')
  assert.ok(m('write_file:Acme/**', 'write_file', { path: './Acme/sub/o.csv' }))
  assert.ok(m('web_fetch:eur-lex.europa.eu', 'web_fetch', { url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/' }))
  assert.ok(m('web_fetch:*.europa.eu', 'web_fetch', { url: 'https://europa.eu/x' }))
  assert.ok(!m('web_fetch:eur-lex.europa.eu', 'web_fetch', { url: 'https://eur-lex.europa.eu.evil.example/' }))
  assert.ok(m('run_bash:git *', 'run_bash', { command: 'git status' }) && m('run_bash:git *', 'run_bash', { command: 'git' }))
  assert.ok(!m('run_bash:git *', 'run_bash', { command: 'gitx status' }))
  assert.ok(m('mcp:dms:*', 'mcp__dms__search', {}) && m('mcp:*', 'mcp__beck__find', {}) && !m('mcp:dms:*', 'mcp__beck__find', {}))
  assert.ok(m('export_*', 'export_document', { format: 'csv' }))
  assert.strictEqual(perms.suggestPattern('web_fetch', { url: 'https://ris.bka.gv.at/a' }), 'web_fetch:ris.bka.gv.at')
  assert.strictEqual(perms.suggestPattern('mcp__dms__search', {}), 'mcp:dms:search')
  assert.strictEqual(perms.suggestPattern('run_bash', { command: 'git log' }), 'run_bash:git *')
  assert.strictEqual(perms.summarize('write_file', { path: 'Acme/obligations.csv' }), 'Save obligations.csv in Acme/')
})

test('validate: shapes and patterns; the harness map carries the section', () => {
  assert.deepStrictEqual(perms.validate({ allow: ['write_file', 'mcp:dms:*'], deny: ['run_bash'], matters: { m1: { allow: ['web_fetch:x.example'] } } }), [])
  const p = perms.validate({ allow: 'write_file', nope: [], deny: ['rm -rf /'], matters: { m1: { deny: ['x'] } } })
  assert.strictEqual(p.length, 4, p.join('\n'))
  assert.ok(harness.SECTIONS.includes('permissions'))
})

test('deny wins over allow, across layers; firm ask cannot be silenced; firm lock ignores the user layer', () => {
  setFirm({ permissions: { deny: ['run_bash'], ask: ['search_ris'], allow: ['web_fetch:eur-lex.europa.eu'] } })
  setUser({ permissions: { allow: ['run_bash', 'search_ris', 'write_file'], deny: ['web_fetch'] } })
  assert.deepStrictEqual([perms.evaluate('run_bash', { command: 'ls' }).decision, perms.evaluate('run_bash', { command: 'ls' }).source], ['deny', 'firm'])
  const ris = perms.evaluate('search_ris', { query: 'MRG' })
  assert.deepStrictEqual([ris.decision, ris.canAlways], ['ask', false])
  assert.strictEqual(perms.evaluate('web_fetch', { url: 'https://eur-lex.europa.eu/' }).decision, 'deny', 'the user\'s deny beats the firm\'s allow')
  assert.strictEqual(perms.evaluate('write_file', { path: 'a.txt' }).decision, 'allow')
  // The merged map keeps both layers' lists.
  assert.deepStrictEqual(harness.load().permissions.deny.sort(), ['run_bash', 'web_fetch'])
  setFirm({ lock: ['permissions'], permissions: { allow: ['web_fetch'] } })
  assert.strictEqual(perms.evaluate('write_file', { path: 'a.txt' }).decision, 'ask', 'locked: the user allow is ignored')
  assert.strictEqual(perms.evaluate('web_fetch', { url: 'https://x.example/' }).decision, 'allow', 'locked: the user deny is ignored too, the firm decides')
  assert.strictEqual(perms.evaluate('write_file', {}).canAlways, false, 'nothing can be saved when locked')
  assert.throws(() => perms.addRule('allow', 'write_file'), /locked/)
})

test('ask → "Allow once" over SSE: the file is written, nothing is saved', async () => {
  replies.push(writeCall(), 'Saved the obligations.')
  const evs = await chat({ message: 'Export the obligations', interactive: true }, () => 'once')
  const ev = evs.find((e) => e.type === 'permission')
  assert.strictEqual(ev.title, 'OpenLex wants to save a file')
  assert.strictEqual(ev.summary, 'Save obligations.csv in Acme/')
  assert.strictEqual(ev.risk, 'writes a file')
  assert.strictEqual(ev.detail.path, 'Acme/obligations.csv')
  assert.deepStrictEqual(ev.choices, ['once', 'always', 'deny'], 'no matter → no "this matter" choice')
  assert.ok(evs.some((e) => e.type === 'permission_result' && e.id === ev.id && e.decision === 'once'))
  assert.ok(fs.existsSync(path.join(WS, 'Acme', 'obligations.csv')))
  assert.deepStrictEqual(userLayer(), {})
  const a = auditLines().at(-1)
  assert.deepStrictEqual([a.call, a.decision, a.by, a.answer], ['write_file', 'allowed', 'lawyer', 'once'])
  assert.ok(!JSON.stringify(auditLines()).includes('Seller,deliver'), 'audit has no content')
})

test('ask → "Don\'t allow": the model gets a tool ERROR and carries on', async () => {
  replies.push(writeCall('Acme/denied.csv'), 'I could not save the file.')
  const evs = await chat({ message: 'Export the obligations', interactive: true }, () => 'deny')
  assert.ok(!fs.existsSync(path.join(WS, 'Acme', 'denied.csv')))
  assert.match(lastToolResult(), /ERROR: The lawyer declined: Save denied\.csv in Acme\//)
  assert.ok(evs.some((e) => e.type === 'step' && e.text === 'declined: write_file'))
  assert.ok(evs.some((e) => e.type === 'final'), 'the run finished normally')
})

test('ask → "Always allow": saved to the user layer, not asked again', async () => {
  replies.push(writeCall('Acme/a1.csv'), 'ok')
  await chat({ message: 'Export', interactive: true }, () => 'always')
  assert.deepStrictEqual(userLayer().permissions.allow, ['write_file'])
  // No document open: the rule applies.
  replies.push(writeCall('Beta/a2.csv'), 'ok')
  const evs = await chat({ message: 'Export again', interactive: true, doc: '' }, () => { throw new Error('must not ask') })
  assert.ok(!evs.some((e) => e.type === 'permission'))
  assert.ok(fs.existsSync(path.join(WS, 'Beta', 'a2.csv')))
  // A document was read and the file goes outside the matter folder: asked
  // again despite the general rule, and the question says why (prompt injection).
  replies.push(writeCall('Beta/a3.csv'), 'ok')
  const evs2 = await chat({ message: 'Export again', interactive: true }, () => 'once')
  const ev = evs2.find((e) => e.type === 'permission')
  assert.ok(ev, 'asked')
  assert.match(ev.caution, /while reading a document/)
})

test('ask → "Always allow (this matter)": only for that matter', async () => {
  replies.push(writeCall('Acme/m1.csv'), 'ok')
  const evs = await chat({ message: 'Export', interactive: true, matterId: 'm_acme' }, (ev) => { assert.deepStrictEqual(ev.choices, ['once', 'always_matter', 'always', 'deny']); return 'always_matter' })
  assert.ok(evs.some((e) => e.type === 'permission'))
  assert.deepStrictEqual(userLayer().permissions, { matters: { m_acme: { allow: ['write_file'] } } })
  assert.strictEqual(perms.evaluate('write_file', { path: 'x' }, { matterId: 'm_acme' }).decision, 'allow')
  assert.strictEqual(perms.evaluate('write_file', { path: 'x' }, { matterId: 'm_other' }).decision, 'ask')
  assert.strictEqual(perms.evaluate('write_file', { path: 'x' }).decision, 'ask')
  assert.ok(perms.removeRule('write_file', { matterId: 'm_acme' }))
  assert.strictEqual(perms.evaluate('write_file', { path: 'x' }, { matterId: 'm_acme' }).decision, 'ask')
})

test('no answer in time → deny; hanging up → deny', async () => {
  replies.push(writeCall('Acme/t.csv'), 'ok')
  const evs = await chat({ message: 'Export', interactive: true, timeoutMs: 150 }, () => null)
  assert.ok(evs.some((e) => e.type === 'permission_result' && e.decision === 'deny' && e.by === 'timeout'))
  assert.match(lastToolResult(), /no answer in time/)
  assert.ok(!fs.existsSync(path.join(WS, 'Acme', 't.csv')))

  replies.push(writeCall('Acme/d.csv'), 'ok')
  await chat({ message: 'Export', interactive: true }, () => 'abort')
  await new Promise((r) => setTimeout(r, 200))
  assert.ok(!fs.existsSync(path.join(WS, 'Acme', 'd.csv')))
  assert.strictEqual(auditLines().filter((a) => a.call === 'write_file').at(-1).by, 'disconnect')
  assert.deepStrictEqual(perms.waiting(), [], 'nothing left pending')
  assert.strictEqual(perms.answer('perm_gone', 'once').ok, false)
})

test('non-interactive callers fail closed unless a rule or --allow/--yes says otherwise', async () => {
  replies.push(writeCall('Acme/n.csv'), 'ok')
  let evs = await chat({ message: 'Export' })
  assert.ok(!evs.some((e) => e.type === 'permission'))
  assert.match(lastToolResult(), /nobody can answer here/)
  assert.ok(!fs.existsSync(path.join(WS, 'Acme', 'n.csv')))
  assert.strictEqual(auditLines().at(-1).by, 'non-interactive')

  replies.push(writeCall('Acme/n2.csv'), 'ok')
  evs = await chat({ message: 'Export', allow: ['write_file:Acme/*'] })
  assert.ok(fs.existsSync(path.join(WS, 'Acme', 'n2.csv')), '--allow pre-approves')
  assert.strictEqual(auditLines().at(-1).by, 'session')

  // Outside a session at all (MCP server, monitors): deny.
  const r = await perms.authorize({ tool: 'web_fetch', args: { url: 'https://example.org' } })
  assert.strictEqual(r.allowed, false)

  // --yes approves asks, never denies.
  setUser({ permissions: { deny: ['write_file:Secret/**'] } })
  replies.push(writeCall('Secret/x.csv'), 'ok')
  await chat({ message: 'Export', yes: true })
  assert.ok(!fs.existsSync(path.join(WS, 'Secret', 'x.csv')))
  assert.match(lastToolResult(), /Not allowed by the lawyer's permission rules \(deny "write_file:Secret\/\*\*"\)/)
})

test('addRule / removeRule keep one list per pattern', () => {
  perms.addRule('deny', 'run_bash')
  perms.addRule('allow', 'run_bash')
  assert.deepStrictEqual(userLayer().permissions, { deny: [], allow: ['run_bash'] })
  assert.ok(perms.removeRule('run_bash'))
  assert.ok(!fs.readFileSync(path.join(DATA, 'openlex.json'), 'utf8').includes('permissions'))
  assert.throws(() => perms.addRule('deny', 'x', { matterId: 'm1' }), /only "allow"/)
})
