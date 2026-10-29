"use strict"
/**
 * Conversations every window shares (session.js): what is kept per turn,
 * the conversations of a matter from any window (terminal app, Word pane,
 * desktop app), reading one back, forgetting one, and the local API routes.
 *
 *   node --test test/sessions.test.js
 *
 * Offline: temp data dir, no engine process.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-sessions-'))
process.env.LEXVAULT_DATA_DIR = DATA

const sessions = require('../src/session')
const { Session } = sessions
const ROOT = path.join(__dirname, '..', '..')

test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

test('a turn keeps when, which window, the law used and where the data went — never more', () => {
  const s = new Session('app:m_abc123:1')
  s.append('Is a two-year non-compete enforceable?', 'Only if reasonable.', {
    matterId: 'm_abc123', client: 'app', agent: 'researcher',
    sources: [{ chunk_id: 'c1', source_name: 'ABGB', section: '§ 879', snippet: 'Ein Vertrag, der gegen ein gesetzliches Verbot …', content: 'FULL TEXT NOT KEPT' }],
    data: [{ provider: 'openai', label: 'OpenAI', model: 'gpt-x', local: false, region: 'eu', redacted: true, calls: 2 }],
    online: ['RIS (Austria\'s federal law database)', 'RIS (Austria\'s federal law database)'],
  })
  const [q, a] = s.history()
  assert.strictEqual(s.id, 'app_m_abc123_1', 'file-safe id')
  assert.deepStrictEqual([q.role, q.content, q.client, q.matterId], ['user', 'Is a two-year non-compete enforceable?', 'app', 'm_abc123'])
  assert.ok(!Number.isNaN(Date.parse(q.at)))
  assert.strictEqual(a.content, 'Only if reasonable.')
  assert.strictEqual(a.agent, 'researcher')
  assert.deepStrictEqual(a.sources, [{ chunk_id: 'c1', source_name: 'ABGB', section: '§ 879', snippet: 'Ein Vertrag, der gegen ein gesetzliches Verbot …' }])
  assert.strictEqual(a.data[0].calls, 2)
  assert.deepStrictEqual(a.online, ['RIS (Austria\'s federal law database)'], 'each service once')
  assert.ok(!a.stopped)
  // The model still sees only the short rolling context.
  assert.deepStrictEqual(s.load().map((m) => m.role), ['user', 'assistant'])
  assert.match(s.contextBlock(), /USER: Is a two-year non-compete enforceable\?\nASSISTANT: Only if reasonable\./)
  // The same id with other characters is the same conversation.
  assert.strictEqual(new Session('app_m_abc123_1').history().length, 2)
})

test('long conversations: the windows see up to 100 exchanges, the model the last 10', () => {
  const s = new Session('tui:long')
  for (let i = 0; i < sessions.MAX_KEEP + 5; i++) s.append(`q${i}`, `a${i}`)
  const h = s.history()
  assert.strictEqual(h.length, sessions.MAX_KEEP * 2)
  assert.strictEqual(h[0].content, 'q5', 'oldest dropped first')
  assert.strictEqual(s.load().length, sessions.MAX_TURNS * 2)
  s.clear()
})

test('the conversations of a matter, from every window, newest first', async () => {
  // Desktop app (tagged), terminal app (older file without tags), Word (bound document), another matter, no matter.
  new Session('tui:m_abc123').append('Asked in the terminal', 'Answer one.')
  await new Promise((r) => setTimeout(r, 15))
  new Session('word-doc-7').append('Asked in Word', 'Answer two.', { client: 'word' })
  await new Promise((r) => setTimeout(r, 15))
  new Session('app:m_other:1').append('Another matter', 'x', { matterId: 'm_other', client: 'app' })
  new Session('quick-1').append('No matter', 'y', { client: 'app' })
  await new Promise((r) => setTimeout(r, 15))
  new Session('app:m_abc123:1').append('Follow-up in the app', 'Answer three.', { matterId: 'm_abc123', client: 'app' })

  const forDoc = (id) => (id === 'word-doc-7' ? { id: 'm_abc123' } : null)
  const list = sessions.list({ matterId: 'm_abc123', forDoc })
  assert.deepStrictEqual(list.map((x) => x.id), ['app_m_abc123_1', 'word-doc-7', 'tui_m_abc123'])
  const app = list[0]
  assert.strictEqual(app.title, 'Is a two-year non-compete enforceable?', 'titled by its first question')
  assert.strictEqual(app.turns, 2)
  assert.deepStrictEqual(app.clients, ['app'])
  assert.strictEqual(list[1].matterId, 'm_abc123', 'Word: the matter its document is bound to')
  assert.ok(list[2].updatedAt, 'an older file without times: its file time')
  assert.deepStrictEqual(sessions.list({ matterId: null, forDoc }).map((x) => x.id), ['quick-1'], 'without a matter: only those')
  assert.deepStrictEqual(sessions.list({ matterId: 'm_abc123', forDoc, limit: 1 }).map((x) => x.id), ['app_m_abc123_1'])

  const r = sessions.read('tui:m_abc123')
  assert.strictEqual(r.id, 'tui_m_abc123')
  assert.strictEqual(r.matterId, 'm_abc123')
  assert.deepStrictEqual(r.messages.map((m) => m.content), ['Asked in the terminal', 'Answer one.'])
  assert.deepStrictEqual(sessions.read('nothing-here'), { id: 'nothing-here', matterId: null, messages: [] })
})

test('local API: GET /api/sessions, GET /api/session, POST /api/session/clear', () => {
  const forDoc = () => null
  const ok = sessions.handle('GET', '/api/sessions', new URLSearchParams('matterId=m_other'), {}, { forDoc })
  assert.strictEqual(ok.status, 200)
  assert.deepStrictEqual(ok.json.sessions.map((x) => x.id), ['app_m_other_1'])
  const one = sessions.handle('GET', '/api/session', new URLSearchParams('id=app_m_other_1'), {}, { forDoc })
  assert.strictEqual(one.json.messages.length, 2)
  assert.strictEqual(sessions.handle('GET', '/api/session', new URLSearchParams(), {}).status, 400)
  assert.strictEqual(sessions.handle('POST', '/api/sessions', new URLSearchParams(), {}).status, 405)
  assert.strictEqual(sessions.handle('GET', '/api/session/clear', new URLSearchParams(), {}).status, 405)
  // Forget: by the window's sessionId, or by document id as before.
  assert.strictEqual(sessions.handle('POST', '/api/session/clear', null, { sessionId: 'app:m_other:1' }).status, 200)
  assert.strictEqual(sessions.read('app_m_other_1').messages.length, 0)
  sessions.handle('POST', '/api/session/clear', null, { docId: 'quick-1' })
  assert.deepStrictEqual(sessions.list({ matterId: null }).map((x) => x.id), ['word-doc-7'], 'an unbound Word document has no matter')
  assert.strictEqual(sessions.handle('GET', '/api/agents', new URLSearchParams(), {}), null, 'other paths are left to the server')
})

test('server.js: chat keeps the turn in the window\'s conversation; the routes are served', () => {
  const server = fs.readFileSync(path.join(ROOT, 'sidecar', 'src', 'server.js'), 'utf8')
  assert.match(server, /new Session\(typeof body\.sessionId === 'string'/, 'POST /api/chat takes a sessionId')
  assert.match(server, /const keep = \(text, stopped\) => session\.append\(body\.message, text, \{ matterId: matterIdFor\(body, entry\), client: clientOf\(req\)/, 'the turn is kept with its matter and window')
  assert.match(server, /keep\(ac\.signal\.aborted \? shown : r\.text/, 'a stopped answer keeps only what the window showed')
  assert.match(server, /p === '\/api\/sessions'[\s\S]{0,300}require\('\.\/session'\)\.handle/, 'the routes are served')
})
