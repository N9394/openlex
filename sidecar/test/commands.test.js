"use strict"
/**
 * The chat commands (commands.js): one list for the terminal app, the Word
 * pane and the desktop app; per-window filtering, plain descriptions in
 * English and German, the GET /api/commands route, and that every front
 * end reads it instead of keeping its own copy.
 *
 *   node --test test/commands.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const commands = require('../src/commands')
const ROOT = path.join(__dirname, '..', '..')

test('one list: names unique, every command described in plain words in English and German', () => {
  const all = commands.list()
  const names = all.map((c) => c.name)
  assert.strictEqual(new Set(names).size, names.length, 'no duplicate names')
  for (const c of all) {
    assert.match(c.name, /^[a-z][a-z-]*$/, c.name)
    assert.strictEqual(typeof c.args, 'string', `${c.name} args`)
    assert.ok(c.description.en && c.description.de, `${c.name} needs en + de`)
    assert.notStrictEqual(c.description.en, c.description.de, `${c.name}: German is not a copy of the English`)
    assert.ok(c.surfaces.length && c.surfaces.every((s) => commands.SURFACES.includes(s)), `${c.name} surfaces`)
  }
  // The core set the lawyer meets everywhere.
  for (const n of ['help', 'model', 'record', 'clear']) assert.deepStrictEqual(commands.find(n).surfaces.sort(), ['app', 'tui', 'word'], n)
  assert.strictEqual(names[names.length - 1], 'help', '/help comes last')
})

test('per window: only what that window can run, in its language', () => {
  const tui = commands.list({ surface: 'tui' }).map((c) => c.name)
  assert.deepStrictEqual(tui, ['model', 'key', 'data', 'as', 'privileged', 'permissions', 'folder', 'sources', 'law', 'analyse', 'investigate', 'diligence', 'draft', 'saved', 'agent', 'team', 'judge', 'copy', 'save', 'transcript', 'activity', 'record', 'clear', 'help'])
  const app = commands.list({ surface: 'app' })
  for (const n of ['help', 'model', 'data', 'matter', 'copy', 'save', 'word', 'activity', 'record', 'clear']) assert.ok(app.some((c) => c.name === n), `app has /${n}`)
  // The app's chat runs on the engine, so these work there too (as in the terminal app).
  for (const n of ['as', 'sources', 'privileged', 'permissions', 'law']) assert.ok(app.some((c) => c.name === n), `app has /${n}`)
  assert.ok(!app.some((c) => c.name === 'transcript'), 'no terminal-only commands in the app')
  // The tools that moved from the old desktop server into the chat.
  for (const n of ['analyse', 'investigate', 'diligence', 'draft', 'saved', 'save']) assert.ok(app.some((c) => c.name === n), `app has /${n}`)
  const word = commands.list({ surface: 'word' }).map((c) => c.name)
  assert.deepStrictEqual(word, ['model', 'data', 'as', 'analyse', 'record', 'clear', 'help'])

  assert.strictEqual(commands.find('model').description.en, 'where the AI runs: on this computer, with an EU provider or in the cloud')
  assert.strictEqual(commands.list({ surface: 'app', lang: 'de' }).find((c) => c.name === 'model').help, 'wo die KI läuft: auf diesem Computer, bei einem EU-Anbieter oder in der Cloud')
  assert.strictEqual(commands.list({ lang: 'de-AT' }).find((c) => c.name === 'clear').help, 'ein neues Gespräch beginnen')
  assert.strictEqual(commands.list({ lang: 'fr' }).find((c) => c.name === 'clear').help, 'start a new conversation', 'other languages: English')
  assert.throws(() => commands.list({ surface: 'fax' }), /unknown window/)

  assert.strictEqual(commands.find('/Model').name, 'model')
  assert.strictEqual(commands.find('nope'), null)
  // A caller changing its copy does not change the list.
  commands.list()[0].surfaces.push('x')
  assert.ok(!commands.find('model').surfaces.includes('x'))
})

test('GET /api/commands', () => {
  const ok = commands.handle('GET', '/api/commands', new URLSearchParams('surface=app&lang=de'))
  assert.strictEqual(ok.status, 200)
  assert.deepStrictEqual(ok.json.surfaces, ['tui', 'word', 'app'])
  assert.ok(ok.json.commands.every((c) => c.surfaces.includes('app')))
  assert.strictEqual(ok.json.commands.find((c) => c.name === 'help').help, 'diese Befehle')
  assert.strictEqual(commands.handle('GET', '/api/commands', new URLSearchParams()).json.commands.length, commands.list().length)
  assert.strictEqual(commands.handle('GET', '/api/commands', { surface: 'word' }).json.commands.length, 7, 'plain object params')
  assert.strictEqual(commands.handle('GET', '/api/commands', new URLSearchParams('surface=fax')).status, 400)
  assert.strictEqual(commands.handle('POST', '/api/commands', new URLSearchParams()).status, 405)
  assert.strictEqual(commands.handle('GET', '/api/agents', new URLSearchParams()), null, 'other paths are left to the server')

  const server = fs.readFileSync(path.join(ROOT, 'sidecar', 'src', 'server.js'), 'utf8')
  assert.match(server, /p === '\/api\/commands'[\s\S]{0,200}require\('\.\/commands'\)\.handle/, 'server.js serves the route')
})

test('every window reads the one list (no private copies)', async () => {
  const mt = await import('../tui/matter.mjs')
  assert.deepStrictEqual(mt.COMMANDS, commands.list({ surface: 'tui' }).map(({ name, args, help }) => ({ name, args, help })))
  const tui = fs.readFileSync(path.join(ROOT, 'sidecar', 'tui', 'matter.mjs'), 'utf8')
  assert.ok(!/\{ name: 'model', args:/.test(tui), 'the terminal app has no copy of its own')
  const pane = fs.readFileSync(path.join(ROOT, 'add-in', 'taskpane.js'), 'utf8')
  assert.match(pane, /\/api\/commands\?surface=word/, 'the Word pane asks the engine')
  const app = fs.readFileSync(path.join(ROOT, 'desktop', 'client', 'src', 'lib', 'commands.ts'), 'utf8')
  assert.match(app, /\/api\/commands\?surface=app/, 'the desktop app asks the engine')
  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'electron', 'main', 'main.js'), 'utf8')
  const allowed = new RegExp(main.match(/const ENGINE_PATHS = \/(.+)\/\r?\n/)[1])
  for (const p of ['/api/commands?surface=app&lang=en', '/api/record?limit=50', '/api/record/export', '/api/folder/save']) assert.ok(allowed.test(p), `the app may call ${p}`)
  // The chat on the engine: asking, conversations, permission answers, law sections, /permissions, /law.
  for (const p of ['/api/chat', '/api/sessions?matterId=m_1', '/api/session?id=app_m_1_x', '/api/session/clear', '/api/permissions', '/api/permissions/answer', '/api/permissions/rules', '/api/law/section?chunk_id=c1', '/api/agents', '/api/sources/law?matterId=m_1', '/api/sources/enable', '/api/sources/key']) assert.ok(allowed.test(p), `the app may call ${p}`)
  // Documents: attach, analyse, export, the memory setting, batches.
  for (const p of ['/api/document/read', '/api/document/attachment?id=att_1', '/api/analyse', '/api/analysis?id=an_1', '/api/analysis/export', '/api/config/local-memory', '/api/batch/estimate', '/api/batch/start', '/api/batch?id=batch_1', '/api/batch/stop', '/api/batch/resume', '/api/batches?matterId=m_1', '/api/workspace/reveal']) assert.ok(allowed.test(p), `the app may call ${p}`)
  for (const p of ['/api/hub/events', '/api/config/token', '/api/sources/add', '/api/download/model']) assert.ok(!allowed.test(p), `the app may not call ${p}`)
})
