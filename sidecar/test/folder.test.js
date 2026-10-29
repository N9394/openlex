"use strict"
/**
 * The working folder (folder.js): the agent works in the folder the lawyer
 * started OpenLex in — reading there is allowed, every change is asked,
 * anything else is refused without asking.
 *
 *   node --test test/folder.test.js
 *
 * Offline: a fake OpenAI-compatible model scripts the agent's tool calls
 * (as in permissions.test.js); temp folders only, no keychain.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-folder-'))
process.env.LEXVAULT_DATA_DIR = path.join(DATA, 'data')
process.env.OPENLEX_KEY_OPENAI = 'sk-test'
const WS = path.join(DATA, 'workspace')
// The lawyer's client folder, next to (not inside) the workspace.
const CLIENTS = path.join(DATA, 'Clients')
const ALPINE = path.join(CLIENTS, 'Alpine')
const OUTSIDE = path.join(DATA, 'Elsewhere')
const CI = process.platform === 'darwin' || process.platform === 'win32'

// ── fake model ─────────────────────────────────────────────────────────────
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

let fo, perms, policy
/** One agent run in the working folder; permission events answered by `answer(ev)`. */
async function run(message, { answer = null, folder = ALPINE, interactive = true, yes = false } = {}) {
  const events = []
  const { runAction } = require('../src/agent')
  const { Document } = require('../src/doc')
  const ctx = { doc: new Document('§ 1 The Seller shall deliver.', `d-${Math.random()}`), memory: null, session: null, summary: () => '' }
  const sess = {
    ask: interactive ? (e) => {
      events.push(e)
      if (e.type === 'permission' && answer) setImmediate(() => perms.answer(e.id, answer(e)))
    } : null,
    allow: [],
    yes,
  }
  await fo.run(folder, () => perms.session(sess, () => policy.withMatter(null, () => runAction(ctx, message, (e) => events.push(e)))))
  return events
}
const call = (tool, args) => JSON.stringify({ reasoning: 'do it', tool, args })
/** The tool results the model was shown, newest last. */
const toolResults = () => requests.flatMap((q) => q.messages.map((m) => m.content || '')).filter((c) => /Tool result|ERROR|written|MATCHES|FILES IN/.test(c))
const userLayer = () => { try { return JSON.parse(fs.readFileSync(path.join(process.env.LEXVAULT_DATA_DIR, 'openlex.json'), 'utf8')) } catch { return {} } }
const setUser = (o) => fs.writeFileSync(path.join(process.env.LEXVAULT_DATA_DIR, 'openlex.json'), JSON.stringify(o))

test.before(async () => {
  fs.mkdirSync(process.env.LEXVAULT_DATA_DIR, { recursive: true })
  fs.mkdirSync(path.join(ALPINE, '2024'), { recursive: true })
  fs.mkdirSync(path.join(ALPINE, '.git'), { recursive: true })
  fs.mkdirSync(OUTSIDE, { recursive: true })
  fs.writeFileSync(path.join(ALPINE, 'notes.txt'), 'The notice period is three months.\nGoverning law: Austria.')
  fs.writeFileSync(path.join(ALPINE, '2024', 'letter.md'), '# Letter\nPlease confirm the deadline of 30 June.')
  fs.writeFileSync(path.join(ALPINE, '.git', 'config'), 'secret')
  fs.writeFileSync(path.join(ALPINE, '.env'), 'KEY=secret')
  fs.writeFileSync(path.join(OUTSIDE, 'other.txt'), 'another client')
  fs.writeFileSync(path.join(CLIENTS, 'Alpine-evil.txt'), 'sibling')
  // A Word document (the smallest valid .docx the extractor reads).
  fs.writeFileSync(path.join(ALPINE, 'contract.docx'), require('./fixtures/docx.js').tinyDocx('The liability cap is EUR 1 million.'))
  // A link inside the folder that leads outside it.
  try { fs.symlinkSync(OUTSIDE, path.join(ALPINE, 'escape')) } catch { /* no symlinks (Windows without rights) */ }
  for (const s of [model]) await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'gpt-x', nativeTools: false } })
  settings.update({ active: 'openai' })
  require('../src/workspace').setBase(WS)
  fo = require('../src/folder')
  perms = require('../src/permissions')
  policy = require('../src/policy')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
})
test.after(() => { model.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => { setUser({}); replies.length = 0; requests.length = 0 })

test('relative paths resolve against the working folder; the workspace stays reachable by its full path', () => {
  fo.run(ALPINE, () => {
    assert.strictEqual(fo.locate('notes.txt').abs, path.join(ALPINE, 'notes.txt'))
    assert.strictEqual(fo.locate('./2024/letter.md').area, 'folder')
    assert.strictEqual(fo.locate('').abs, ALPINE)
    assert.strictEqual(fo.locate(path.join(WS, 'Acme', 'x.csv')).area, 'workspace')
  })
  // Without a working folder: the workspace, as before.
  const loc = fo.locate('Acme/x.csv')
  assert.deepStrictEqual([loc.area, loc.abs], ['workspace', path.join(WS, 'Acme', 'x.csv')])
})

test('outside the working folder is refused: ../, absolute paths, siblings, symlink escapes, case variants', () => {
  fo.run(ALPINE, () => {
    assert.throws(() => fo.locate('../Elsewhere/other.txt'), /outside the working folder/)
    assert.throws(() => fo.locate(path.join(OUTSIDE, 'other.txt')), /outside the working folder/)
    assert.throws(() => fo.locate('../Alpine-evil.txt'), /outside/, 'a sibling whose name starts the same is outside')
    assert.throws(() => fo.locate('/etc/hosts'), /outside/)
    assert.throws(() => fo.locate('~/.ssh/id_rsa'), /outside|off-limits/)
    if (fs.existsSync(path.join(ALPINE, 'escape'))) assert.throws(() => fo.locate('escape/other.txt'), /link to another place/)
    if (CI) {
      // Same folder in other letters: inside (macOS/Windows ignore case) …
      assert.strictEqual(fo.locate(path.join(ALPINE.toUpperCase(), 'notes.txt')).area, 'folder')
      // … and other letters never open a way out, nor into hidden folders.
      assert.throws(() => fo.locate(path.join(CLIENTS.toUpperCase(), 'ALPINE-EVIL.TXT')), /outside/)
      assert.throws(() => fo.locate('.GIT/config'), /Hidden/)
    }
  })
})

test('protected: hidden files, .git, OpenLex data, firm configuration (not writable), system folders', () => {
  fo.run(ALPINE, () => {
    assert.throws(() => fo.locate('.git/config'), /Hidden files and folders/)
    assert.throws(() => fo.locate('.env'), /Hidden/)
    assert.throws(() => fo.locate('openlex.json', { write: true }), /configuration/)
    assert.throws(() => fo.locate(path.join(WS, 'openlex.json'), { write: true }), /firm's configuration/)
    assert.throws(() => fo.locate(path.join(WS, 'playbooks', 'x.json'), { write: true }), /firm's configuration/)
    assert.ok(fo.locate(path.join(WS, 'playbooks', 'x.json')), 'reading a playbook is fine')
  })
  // A data folder or system folder cannot be the working folder.
  assert.match(fo.check(process.env.LEXVAULT_DATA_DIR).error, /OpenLex's own data folder/)
  if (process.platform !== 'win32') assert.match(fo.check('/etc').error || '', /system folder|not found/)
})

test('home folder and the whole computer: allowed only after confirming; huge folders are capped', () => {
  assert.strictEqual(fo.check(os.homedir()).broad, 'home')
  assert.strictEqual(fo.check(path.parse(os.homedir()).root).broad, 'root')
  assert.strictEqual(fo.check(ALPINE).broad, null)
  assert.strictEqual(fo.check(path.join(ALPINE, 'notes.txt')).ok, false)
  assert.match(fo.check(path.join(DATA, 'nope')).error, /was not found/)
  // 120 files: the listing shows 100 and says there are more.
  const big = path.join(CLIENTS, 'Big')
  fs.mkdirSync(big, { recursive: true })
  for (let i = 0; i < 120; i++) fs.writeFileSync(path.join(big, `f${String(i).padStart(3, '0')}.txt`), 'x')
  const r = fo.run(big, () => fo.list(''))
  assert.strictEqual(r.files.length, fo.LIST_MAX)
  assert.ok(r.truncated)
  assert.strictEqual(fo.documents(big).count, 120)
})

test('reading in the working folder needs no question: Word, text, listing and search', async () => {
  replies.push(call('list_directory', {}), call('read_file', { path: 'contract.docx' }), call('search_local_files', { query: 'deadline' }), 'The cap is EUR 1 million.')
  const evs = await run('What is in this folder?')
  assert.ok(!evs.some((e) => e.type === 'permission'), 'reading is never asked')
  const seen = toolResults().join('\n')
  assert.match(seen, /FILES IN THE WORKING FOLDER/)
  assert.match(seen, /notes\.txt/)
  assert.ok(!/\.git|\.env/.test(seen.split('FILES IN THE WORKING FOLDER')[1].split('\n').slice(0, 8).join('\n')), 'hidden files are not listed')
  assert.match(seen, /liability cap is EUR 1 million/)
  assert.match(seen, /2024\/letter\.md:2/)
  // The activity shows where it read: the working folder, file names only.
  const step = evs.find((e) => e.type === 'step' && e.tool === 'read_file')
  assert.deepStrictEqual(step.detail, { file: 'contract.docx', where: 'folder' })
  // The model knows where it works.
  assert.match(requests[0].messages[0].content, /WORKING FOLDER\nThe lawyer is working in the folder/)
})

test('saving in the working folder asks first, in plain words; "Always allow (this folder)" saves a path rule', async () => {
  replies.push(call('write_file', { path: 'obligations.csv', content: 'party,obligation' }), 'Saved.')
  let evs = await run('Save the obligations as a CSV here', { answer: () => 'once' })
  const ev = evs.find((e) => e.type === 'permission')
  assert.strictEqual(ev.title, 'OpenLex wants to save a file')
  assert.strictEqual(ev.summary, `Save obligations.csv in this folder: ${fo.tilde(ALPINE)}`)
  assert.deepStrictEqual(ev.choices, ['once', 'always_folder', 'deny'])
  assert.strictEqual(ev.alwaysFolder, `write_file:${fo.tilde(ALPINE)}/**`)
  assert.strictEqual(fs.readFileSync(path.join(ALPINE, 'obligations.csv'), 'utf8'), 'party,obligation')

  replies.push(call('write_file', { path: '2024/deadlines.csv', content: 'a' }), 'Saved.')
  evs = await run('Save the deadlines', { answer: () => 'always_folder' })
  assert.match(evs.find((e) => e.type === 'permission').summary, /in .*Alpine\/2024 \(inside this folder\)/)
  assert.deepStrictEqual(userLayer().permissions.allow, [`write_file:${fo.tilde(ALPINE)}/**`])

  // Next time in this folder: not asked. In another folder: asked again.
  replies.push(call('write_file', { path: 'more.csv', content: 'b' }), 'Saved.')
  evs = await run('Save more', { answer: () => { throw new Error('must not ask') } })
  assert.ok(fs.existsSync(path.join(ALPINE, 'more.csv')))
  const other = path.join(CLIENTS, 'Beta')
  fs.mkdirSync(other, { recursive: true })
  replies.push(call('write_file', { path: 'x.csv', content: 'c' }), 'Saved.')
  evs = await run('Save', { folder: other, answer: () => 'deny' })
  assert.ok(evs.some((e) => e.type === 'permission'))
  assert.ok(!fs.existsSync(path.join(other, 'x.csv')))
  // The rule matches the full path: the same file through the workspace-relative form is not covered.
  assert.strictEqual(perms.evaluate('write_file', { path: 'Alpine/a.csv' }).decision, 'ask')
})

test('outside the folder is refused without asking — also for a script that says --yes', async () => {
  replies.push(call('write_file', { path: '../Elsewhere/stolen.csv', content: 'x' }), call('read_file', { path: path.join(OUTSIDE, 'other.txt') }), 'I could not.')
  const evs = await run('Save it next door', { answer: () => 'once', yes: true })
  assert.ok(!evs.some((e) => e.type === 'permission'), 'never asked')
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'stolen.csv')))
  assert.ok(evs.some((e) => e.type === 'step' && e.kind === 'outside' && e.tool === 'write_file'))
  assert.match(toolResults().join('\n'), /outside the working folder .* so OpenLex may not use it\. This is never allowed, so nobody was asked/)
  assert.ok(!toolResults().join('\n').includes('another client'))
})

test('delete always asks (no "always"), keeps a copy that can be restored; --yes and allow rules do not skip it', async () => {
  fs.writeFileSync(path.join(ALPINE, 'old draft.txt'), 'draft 1')
  setUser({ permissions: { allow: ['delete_file', `delete_file:${fo.tilde(ALPINE)}/**`] } })
  replies.push(call('delete_file', { path: 'old draft.txt' }), 'Deleted.')
  const evs = await run('Delete the old draft', { answer: (e) => { assert.deepStrictEqual(e.choices, ['once', 'deny']); return 'once' }, yes: true })
  const ev = evs.find((e) => e.type === 'permission')
  assert.strictEqual(ev.title, 'OpenLex wants to delete a file')
  assert.match(ev.summary, /^Delete old draft\.txt in this folder: .*Alpine \(a copy is kept\)$/)
  assert.ok(!fs.existsSync(path.join(ALPINE, 'old draft.txt')))
  assert.match(toolResults().join('\n'), /deleted: .*a copy is kept/)
  // Restore it from the history (kept in the workspace, not the client's folder).
  const ws = require('../src/workspace')
  assert.strictEqual(ws.versions(path.join(ALPINE, 'old draft.txt')).length, 1)
  assert.ok(!fs.readdirSync(ALPINE).includes('.openlex'))
  fo.run(ALPINE, () => ws.restoreVersion(path.join(ALPINE, 'old draft.txt')))
  assert.strictEqual(fs.readFileSync(path.join(ALPINE, 'old draft.txt'), 'utf8'), 'draft 1')
  // Nobody to ask: not deleted, even with --yes.
  replies.push(call('delete_file', { path: 'old draft.txt' }), 'ok')
  await run('Delete it', { interactive: false, yes: true })
  assert.ok(fs.existsSync(path.join(ALPINE, 'old draft.txt')))
})

test('rename asks, never overwrites, and stays inside', async () => {
  fs.writeFileSync(path.join(ALPINE, 'a.txt'), 'A')
  replies.push(call('rename_file', { path: 'a.txt', to: 'b.txt' }), call('rename_file', { path: 'b.txt', to: '../../Elsewhere/b.txt' }), 'ok')
  const evs = await run('Rename a to b', { answer: () => 'once' })
  const asks = evs.filter((e) => e.type === 'permission')
  assert.strictEqual(asks.length, 1, 'the move outside was refused without asking')
  assert.match(asks[0].summary, /^Rename a\.txt to b\.txt in this folder/)
  assert.ok(fs.existsSync(path.join(ALPINE, 'b.txt')) && !fs.existsSync(path.join(ALPINE, 'a.txt')))
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'b.txt')))
  fs.writeFileSync(path.join(ALPINE, 'c.txt'), 'C')
  assert.throws(() => fo.run(ALPINE, () => fo.rename('b.txt', 'c.txt')), /already exists/)
})

test('path patterns: "~/…/**" covers the folder and below; "*:folder/**" forbids everything there', () => {
  fo.run(ALPINE, () => {
    const m = (p, tool, args) => perms.matchPattern(p, tool, perms.subjectOf(tool, args))
    const rule = `write_file:${fo.tilde(ALPINE)}/**`
    assert.ok(m(rule, 'write_file', { path: 'x.csv' }))
    assert.ok(m(rule, 'write_file', { path: '2024/deep/x.csv' }))
    assert.ok(!m(rule, 'write_file', { path: path.join(WS, 'x.csv') }))
    assert.ok(m(`*:${fo.tilde(ALPINE)}/**`, 'list_directory', {}), 'the folder itself')
    assert.ok(m(`*:${fo.tilde(ALPINE)}/**`, 'read_file', { path: 'notes.txt' }))
    assert.ok(!m(`*:${fo.tilde(ALPINE)}/**`, 'web_fetch', { url: 'https://x.example' }))
    setUser({ permissions: { deny: [`*:${fo.tilde(ALPINE)}/**`] } })
    assert.strictEqual(perms.evaluate('read_file', { path: 'notes.txt' }).decision, 'deny')
    setUser({})
  })
})

test('the server refuses the home folder unless confirmed, and a folder that does not exist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8')
  assert.match(src, /folderConfirmed !== true/)
  assert.strictEqual((src.match(/require\('\.\/folder'\)\.run\(folderDir/g) || []).length, 6, 'chat, workflows, grids, plans, the document analysis and panels run in the working folder')
})
