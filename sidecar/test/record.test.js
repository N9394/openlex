"use strict"
/**
 * The AI record (record.js + chain.js): requests merged with the AI calls,
 * online lookups and permission decisions made for them; filters and
 * summary counts; never any content; tamper-evidence (sealing old lines,
 * verify finds an edited, deleted or moved line); retention with a marker;
 * exports (PDF, CSV, Markdown) and the local API routes.
 *
 *   node --test test/record.test.js
 *
 * Offline: the local model is a stub; nothing is sent anywhere.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-record-'))
process.env.LEXVAULT_DATA_DIR = DATA

const policy = require('../src/policy')
const activity = require('../src/activity')
const chain = require('../src/chain')
const record = require('../src/record')
const matters = require('../src/matters')
const ws = require('../src/workspace')

ws.setBase(path.join(DATA, 'ws'))
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

const SECRETS = ['SECRET-CLIENT-TEXT', 'Müller Holding GmbH', 'SECRET-ANSWER', 'SECRET-SEARCH-WORDS', 'SECRET-URL-QUERY', 'SECRET-SYSTEM-PROMPT', 'SECRET-FILE-CONTENT']
const noSecrets = (text, where) => { for (const s of SECRETS) assert.ok(!String(text).includes(s), `${where} must not contain "${s}"`) }
const reset = () => {
  fs.rmSync(path.join(DATA, 'audit'), { recursive: true, force: true })
  fs.rmSync(activity.DIR, { recursive: true, force: true })
  fs.rmSync(record.SETTINGS_PATH, { force: true })
  chain.reset()
}

/** One request as the server runs it: activity record + audit lines inside rec.run. */
async function request({ matterId, asked, client = 'word', kind = 'question', inside = async () => {}, finish = {} }) {
  const rec = activity.start({ matterId, kind, asked, client, files: ['/x/SPA draft 3.docx'] })
  await rec.run(() => policy.withMatter(matterId, inside(rec)))
  return rec.finish(finish)
}

test('grouping: AI calls, lookups and permissions land under their request; the rest stand alone', async () => {
  reset()
  const m = matters.create({ title: 'Alpine share deal' })
  await request({
    matterId: m.id, asked: 'Is the liability cap valid?',
    inside: (rec) => async () => {
      rec.see({ type: 'model', provider: 'anthropic', local: false, region: 'eu-central-1', redacted: true })
      policy.audit({ provider: 'anthropic', model: 'claude-sonnet-5-5', region: 'eu-central-1', matter: m.id, call: 'chat', decision: 'allowed', ok: true, ms: 900, inChars: 5000, outChars: 300, redacted: 4 })
      policy.audit({ provider: 'anthropic', model: 'claude-sonnet-5-5', region: 'eu-central-1', matter: m.id, call: 'chat', decision: 'allowed', ok: true, ms: 800, redacted: 2 })
      policy.audit({ provider: 'web', model: 'data.bka.gv.at', matter: m.id, call: 'search_ris', decision: 'allowed' })
      policy.audit({ provider: 'permissions', model: null, matter: m.id, call: 'read_file', decision: 'allowed', by: 'default' })
      policy.audit({ provider: 'permissions', model: null, matter: m.id, call: 'write_file', decision: 'blocked', by: 'lawyer', answer: 'deny' })
      rec.see({ type: 'suggestion' })
      rec.see({ type: 'suggestion' })
    },
  })
  // A law-update check outside any request.
  policy.audit({ provider: 'web', model: 'data.bka.gv.at', matter: m.id, call: 'monitor', decision: 'allowed' })
  const r = record.list({ matterId: m.id })
  assert.strictEqual(r.total, 2)
  const [check, q] = r.entries
  assert.strictEqual(check.type, 'lookup')
  assert.strictEqual(check.title, 'Check for law updates')
  assert.strictEqual(q.type, 'request')
  assert.strictEqual(q.title, 'Question: “Is the liability cap valid?”')
  assert.strictEqual(q.window, 'Word')
  assert.strictEqual(q.matter, 'Alpine share deal')
  assert.strictEqual(q.calls, 2)
  assert.deepStrictEqual(q.ai.map((s) => [s.service, s.namesHidden, s.calls]), [['Claude (Anthropic, EU)', true, 2]])
  assert.deepStrictEqual(q.lookups.map((l) => l.name), ['RIS (Austria\'s federal law database)'])
  assert.deepStrictEqual(q.permissions, [{ what: 'save a file', decision: 'denied', by: 'you', asked: true }])
  assert.strictEqual(q.routine, 1)
  assert.strictEqual(q.result, 'Answered, 2 proposed changes')
  assert.ok(q.left)
  assert.ok(q.lines.includes('AI: Claude (Anthropic, EU) — sent outside this computer, names hidden · 2 calls'))
  assert.ok(q.lines.includes('Permission to save a file: denied — decided by you'))
  assert.ok(q.lines.some((l) => /^Looked up online: RIS/.test(l)))
})

test('grouping by time and matter for audit lines without a request id (older logs)', () => {
  reset()
  const at = '2026-10-20T10:00:00.000Z'
  fs.mkdirSync(activity.DIR, { recursive: true })
  fs.writeFileSync(path.join(activity.DIR, 'm_old.jsonl'), `${JSON.stringify({ at, kind: 'review', asked: 'spa', client: 'tui', looked: [], sources: [], data: [{ provider: 'local', local: true, calls: 3 }], suggestions: 0, ms: 60000, result: 'done', saved: ['review.docx'] })}\n`)
  fs.mkdirSync(path.join(DATA, 'audit'), { recursive: true })
  fs.writeFileSync(policy.AUDIT_PATH, [
    { ts: '2026-10-20T10:00:10.000Z', provider: 'local', model: null, matter: 'm_old', call: 'chat', decision: 'allowed' },
    { ts: '2026-10-20T10:00:30.000Z', provider: 'local', model: null, matter: 'm_old', call: 'chat', decision: 'allowed' },
    { ts: '2026-10-20T10:00:40.000Z', provider: 'local', model: null, matter: 'm_other', call: 'chat', decision: 'allowed' },
    { ts: '2026-10-20T12:00:00.000Z', provider: 'local', model: null, matter: 'm_old', call: 'chat', decision: 'allowed' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n')
  const r = record.list({ matterId: 'm_old' })
  assert.deepStrictEqual(r.entries.map((x) => x.type), ['call', 'request'])
  const rv = r.entries[1]
  assert.strictEqual(rv.title, 'Checklist review: “spa”')
  assert.strictEqual(rv.window, 'Terminal app')
  assert.strictEqual(rv.calls, 2, 'the two calls inside its time, not the other matter\'s or the later one')
  assert.strictEqual(rv.result, 'Done, saved review.docx')
  assert.ok(!rv.left)
  assert.ok(rv.lines.includes('AI: on this computer · 2 calls'))
  // All matters: the other matter's call is its own entry.
  assert.strictEqual(record.list().total, 3)
})

test('filters (dates, left this computer, service, kind) and summary counts with the one line', async () => {
  reset()
  const m = matters.create({ title: 'Lease dispute' })
  await request({ matterId: m.id, asked: 'Local question', client: 'tui', inside: () => async () => { policy.audit({ provider: 'local', model: null, matter: m.id, call: 'chat', decision: 'allowed' }) } })
  for (let i = 0; i < 3; i++) {
    await request({ matterId: m.id, asked: `Cloud question ${i}`, inside: () => async () => { policy.audit({ provider: 'anthropic', model: 'claude-sonnet-5-5', region: 'eu-central-1', matter: m.id, call: 'chat', decision: 'allowed', ok: true, redacted: 1 }) } })
  }
  await request({ matterId: m.id, asked: 'Web question', client: 'cli', inside: () => async () => {
    policy.audit({ provider: 'web', model: 'eur-lex.europa.eu', matter: m.id, call: 'web_fetch', decision: 'allowed' })
    policy.audit({ provider: 'web', model: 'data.bka.gv.at', matter: m.id, call: 'search_ris', decision: 'allowed' })
    policy.audit({ provider: 'openai', model: 'gpt-x', matter: m.id, call: 'chat', decision: 'blocked', reason: 'data policy is local-only' })
  } })
  const all = record.list({ matterId: m.id })
  assert.strictEqual(all.summary.requests, 5)
  assert.strictEqual(all.summary.aiCalls, 4)
  assert.strictEqual(all.summary.localCalls, 1)
  assert.deepStrictEqual(all.summary.left.services.map((g) => [g.service, g.entries, g.calls, g.namesHidden]), [['Claude (Anthropic, EU)', 3, 3, 'all']])
  assert.strictEqual(all.summary.online.lookups, 2)
  assert.strictEqual(all.summary.blocked, 1)
  assert.strictEqual(all.summary.text, '5 requests · 3 sent to Claude (Anthropic, EU), names hidden · 2 online lookups · 1 stopped by the client-data rule')
  assert.strictEqual(record.list({ matterId: m.id, left: '1' }).total, 4)
  assert.strictEqual(record.list({ matterId: m.id, service: 'anthropic' }).total, 3)
  assert.strictEqual(record.list({ matterId: m.id, service: 'web' }).total, 1)
  assert.strictEqual(record.list({ matterId: m.id, kind: 'question' }).total, 5)
  const today = new Date()
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  assert.strictEqual(record.list({ matterId: m.id, from: d, to: d }).total, 5)
  assert.strictEqual(record.list({ matterId: m.id, to: '2001-01-01' }).total, 0)
  assert.throws(() => record.list({ from: '29.10.2026' }), /date like 2026-10-29/)
  // Pages: newest first, a cursor for the rest; the summary covers the whole selection.
  const p1 = record.list({ matterId: m.id, limit: 2 })
  assert.strictEqual(p1.entries.length, 2)
  assert.strictEqual(p1.nextCursor, '2')
  assert.strictEqual(p1.summary.requests, 5)
  const p3 = record.list({ matterId: m.id, limit: 2, cursor: '4' })
  assert.strictEqual(p3.entries.length, 1)
  assert.strictEqual(p3.nextCursor, null)
  assert.strictEqual(p3.entries[0].title, 'Question: “Local question”')
  // The API line adds the check.
  const api = await record.handle('GET', '/api/record', new URLSearchParams({ matterId: m.id, left: '1' }))
  assert.strictEqual(api.status, 200)
  assert.match(api.json.line, /^4 requests · 3 sent to Claude \(Anthropic, EU\), names hidden · 2 online lookups · 1 stopped by the client-data rule · record intact ✓$/)
  assert.strictEqual(await record.handle('GET', '/api/nothing'), null)
})

test('never content: secret prompts, documents, answers, search words and URLs never reach the record or its exports', async () => {
  reset()
  const m = matters.create({ title: 'Secret matter' })
  const local = require('../src/providers/local')
  const orig = local.chat
  local.chat = async () => 'SECRET-ANSWER from the model'
  try {
    const llm = require('../src/llm')
    await request({
      matterId: m.id, asked: 'Summarise the agreement',
      inside: (rec) => async () => {
        rec.see({ type: 'step', kind: 'tool', tool: 'search_law', detail: activity.toolDetail('search_law', { query: 'SECRET-SEARCH-WORDS', jurisdiction: 'AT' }) })
        rec.see({ type: 'step', kind: 'tool', tool: 'web_fetch', detail: activity.toolDetail('web_fetch', { url: 'https://www.ris.bka.gv.at/x?q=SECRET-URL-QUERY' }) })
        rec.see({ type: 'step', kind: 'tool', tool: 'read_file', detail: activity.toolDetail('read_file', { path: '/x/contract.docx' }) })
        rec.see({ type: 'text', text: 'SECRET-ANSWER' })
        await policy.observeModels((ev) => rec.see({ type: 'model', ...ev }), () => llm.chat([
          { role: 'system', content: 'SECRET-SYSTEM-PROMPT' },
          { role: 'user', content: 'SECRET-CLIENT-TEXT about Müller Holding GmbH: SECRET-FILE-CONTENT' },
        ], { phase: 'planning' }))
        policy.audit({ provider: 'web', model: 'www.ris.bka.gv.at', matter: m.id, call: 'web_fetch', decision: 'allowed' })
        policy.audit({ provider: 'permissions', model: null, matter: m.id, call: 'write_file', decision: 'allowed', by: 'lawyer', answer: 'once' })
      },
      finish: { files: ['/ws/Secret/summary.docx'] },
    })
  } finally { local.chat = orig }
  const r = record.list({ matterId: m.id })
  assert.strictEqual(r.total, 1)
  const e = r.entries[0]
  assert.strictEqual(e.calls, 1)
  assert.deepStrictEqual(e.files, ['summary.docx'])
  assert.deepStrictEqual(e.lookups.map((l) => l.name), ['www.ris.bka.gv.at'])
  noSecrets(JSON.stringify(r), 'GET /api/record')
  noSecrets(JSON.stringify(record.verify()), 'verify')
  for (const format of ['pdf', 'csv', 'md']) {
    const x = record.exportRecord({ matterId: m.id, format })
    noSecrets(fs.readFileSync(x.file, 'latin1') + fs.readFileSync(x.file, 'utf8'), `the ${format} export`)
  }
  // titles: false also leaves out what was asked.
  const md = fs.readFileSync(record.exportRecord({ matterId: m.id, format: 'md', titles: false }).file, 'utf8')
  assert.ok(!md.includes('Summarise the agreement'))
  assert.match(md, /\| Question \|/)
})

test('chain: new lines are linked; old lines are sealed once; verify finds an edit, a deletion and a move', () => {
  reset()
  fs.mkdirSync(path.dirname(policy.AUDIT_PATH), { recursive: true })
  // Lines from before tamper-evidence existed.
  fs.writeFileSync(policy.AUDIT_PATH, '{"ts":"2026-01-01T00:00:00.000Z","provider":"local","decision":"allowed"}\n{"ts":"2026-01-02T00:00:00.000Z","provider":"local","decision":"allowed"}\n')
  record.sealAll()
  record.sealAll() // once only
  let lines = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n')
  assert.strictEqual(lines.length, 3)
  const marker = JSON.parse(lines[2])
  assert.strictEqual(marker.chain, 'start')
  assert.deepStrictEqual(marker.earlier.lines, 2)
  for (let i = 0; i < 5; i++) policy.audit({ provider: 'local', model: null, matter: null, call: 'chat', decision: 'allowed', n: i })
  lines = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n')
  const parsed = lines.map((l) => JSON.parse(l))
  for (let i = 3; i < 8; i++) assert.strictEqual(parsed[i].prev, parsed[i - 1].h, `line ${i + 1} links to the one before`)
  assert.match(lines[3], /,"prev":"[0-9a-f]{64}","h":"[0-9a-f]{64}"\}$/)
  let v = chain.verify(policy.AUDIT_PATH)
  assert.ok(v.ok, JSON.stringify(v))
  assert.strictEqual(v.entries, 5)
  assert.strictEqual(v.sealedBefore, 2)
  assert.ok(record.verify().ok)
  const original = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
  const write = (ls) => { fs.writeFileSync(policy.AUDIT_PATH, `${ls.join('\n')}\n`); chain.reset() }
  // Edited: one field changed.
  write(lines.map((l, i) => (i === 5 ? l.replace('"decision":"allowed"', '"decision":"blocked"') : l)))
  v = chain.verify(policy.AUDIT_PATH)
  assert.strictEqual(v.ok, false)
  assert.deepStrictEqual(v.broken, { line: 6, why: 'Line 6 was changed after it was written.' })
  // Deleted.
  write(lines.filter((_, i) => i !== 4))
  v = chain.verify(policy.AUDIT_PATH)
  assert.strictEqual(v.broken.line, 5)
  assert.match(v.broken.why, /removed, moved or added/)
  // Moved (two lines swapped).
  write(lines.map((l, i) => (i === 4 ? lines[5] : i === 5 ? lines[4] : l)))
  assert.strictEqual(chain.verify(policy.AUDIT_PATH).broken.line, 5)
  // An old (sealed) line edited.
  write(lines.map((l, i) => (i === 0 ? l.replace('2026-01-01', '2026-01-05') : l)))
  v = chain.verify(policy.AUDIT_PATH)
  assert.strictEqual(v.broken.line, 1)
  assert.match(v.broken.why, /written before the record was sealed/)
  // The first chained line removed together with everything before it.
  write(lines.slice(4))
  assert.match(chain.verify(policy.AUDIT_PATH).broken.why, /earlier entries were removed/)
  // The record's own check says it in words.
  write(lines.map((l, i) => (i === 6 ? l.replace('"n":3', '"n":9') : l)))
  const rv = record.verify()
  assert.strictEqual(rv.ok, false)
  assert.match(rv.text, /^Record changed: Audit log .* Line 7 was changed after it was written\.$/)
  // Restored: intact again; the fingerprint is stable.
  fs.writeFileSync(policy.AUDIT_PATH, original)
  chain.reset()
  const a = record.verify()
  const b = record.verify()
  assert.ok(a.ok)
  assert.strictEqual(a.fingerprint, b.fingerprint)
  assert.match(a.fingerprint, /^([0-9a-f]{4} ){7}[0-9a-f]{4}$/)
})

test('chain: a write by another process is noticed; unchained lines added later are sealed with a note', () => {
  reset()
  policy.audit({ provider: 'local', model: null, call: 'chat', decision: 'allowed' })
  // An older OpenLex (no chain) appends a line.
  fs.appendFileSync(policy.AUDIT_PATH, '{"ts":"2026-10-29T10:00:00.000Z","provider":"local","decision":"allowed"}\n')
  let v = chain.verify(policy.AUDIT_PATH)
  assert.ok(v.ok)
  assert.strictEqual(v.unsealed, 1)
  assert.match(v.notes[0], /no fingerprint yet/)
  policy.audit({ provider: 'local', model: null, call: 'chat', decision: 'allowed' })
  v = chain.verify(policy.AUDIT_PATH)
  assert.ok(v.ok, JSON.stringify(v))
  assert.strictEqual(v.unsealed, 0)
  assert.match(v.notes[0], /written without a fingerprint .* sealed afterwards/)
  // A second writer that chains (another engine process): the head is re-read.
  const before = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
  chain.reset()
  chain.append(policy.AUDIT_PATH, { ts: new Date().toISOString(), provider: 'local', other: true })
  assert.ok(fs.readFileSync(policy.AUDIT_PATH, 'utf8').startsWith(before))
  policy.audit({ provider: 'local', model: null, call: 'chat', decision: 'allowed' })
  assert.ok(chain.verify(policy.AUDIT_PATH).ok)
})

test('retention: old lines removed with a marker (count and dates), the chain still verifies, a broken record is not pruned', async () => {
  reset()
  fs.mkdirSync(path.dirname(policy.AUDIT_PATH), { recursive: true })
  const old = (d) => chain.append(policy.AUDIT_PATH, { ts: d, provider: 'local', model: null, call: 'chat', decision: 'allowed' })
  old('2025-01-10T09:00:00.000Z')
  old('2025-02-10T09:00:00.000Z')
  old('2025-03-10T09:00:00.000Z')
  policy.audit({ provider: 'local', model: null, call: 'chat', decision: 'allowed' })
  await request({ matterId: 'm_ret', asked: 'Recent', inside: () => async () => {} })
  assert.deepStrictEqual(record.settings(), { keepMonths: null })
  assert.deepStrictEqual(record.applyRetention(), [], 'default: keep everything')
  const r = record.setSettings({ keepMonths: 12 })
  assert.strictEqual(r.keepMonths, 12)
  assert.strictEqual(r.applied.length, 1)
  assert.deepStrictEqual(r.applied[0].removed, { count: 3, from: '2025-01-10T09:00:00.000Z', to: '2025-03-10T09:00:00.000Z' })
  const lines = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.strictEqual(lines.length, 2)
  assert.strictEqual(lines[0].chain, 'start')
  assert.strictEqual(lines[0].why, 'retention')
  assert.ok(chain.verify(policy.AUDIT_PATH).ok)
  policy.audit({ provider: 'local', model: null, call: 'chat', decision: 'allowed' })
  assert.ok(record.verify().ok)
  // A forged "retention" marker in the middle is a break.
  const raw = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n')
  fs.writeFileSync(policy.AUDIT_PATH, `${[raw[1], raw[0], raw[2]].join('\n')}\n`)
  chain.reset()
  assert.strictEqual(chain.verify(policy.AUDIT_PATH).ok, false)
  assert.throws(() => chain.prune(policy.AUDIT_PATH, new Date().toISOString()), /has a change in it/)
  assert.throws(() => record.setSettings({ keepMonths: 0 }), /1 to 600 months/)
  assert.deepStrictEqual(record.setSettings({ keepMonths: 'all' }).keepMonths, null)
})

test('export: PDF, CSV and Markdown in the matter folder (or "records" for all matters) with explanation, summary, table and check', async () => {
  reset()
  const m = matters.create({ title: 'Export matter', number: '2026-17' })
  await request({ matterId: m.id, asked: 'Check the NDA', inside: () => async () => { policy.audit({ provider: 'anthropic', model: 'claude-sonnet-5-5', region: 'eu-central-1', matter: m.id, call: 'chat', decision: 'allowed', ok: true, redacted: 1 }) } })
  const md = record.exportRecord({ matterId: m.id, format: 'md' })
  assert.ok(md.file.startsWith(path.join(DATA, 'ws', '2026-17_Export_matter')), md.file)
  assert.match(path.basename(md.file), /^ai-record-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/)
  const text = fs.readFileSync(md.file, 'utf8')
  assert.match(text, /^# AI record — Export matter/)
  assert.match(text, /## What this record shows and what it never contains/)
  assert.match(text, /\*\*Never contains\.\*\* The text of documents/)
  assert.match(text, /1 request · 1 sent to Claude \(Anthropic, EU\), names hidden/)
  assert.match(text, /\| When \| Window \| Matter \| What was asked \|/)
  assert.match(text, /Question: “Check the NDA” \| Claude \(Anthropic, EU\) \| online \| eu-central-1 \| hidden \| 1 \|/)
  assert.match(text, /✓ Record intact/)
  assert.match(text, /Fingerprint of the whole record: [0-9a-f]{4} /)
  assert.ok(md.verified)
  const csv = record.exportRecord({ format: 'csv' })
  assert.ok(csv.file.startsWith(path.join(DATA, 'ws', 'records')), csv.file)
  const c = fs.readFileSync(csv.file, 'utf8').split('\n')
  assert.match(c[0], /^AI record — All matters/)
  assert.ok(c.includes('When,Window,Matter,What was asked,AI service,Where it ran,Region,Client names,AI calls,Looked up online,Permissions,Not sent,Result,Files saved,Seconds'))
  const pdf = record.exportRecord({ matterId: m.id, format: 'pdf' })
  const buf = fs.readFileSync(pdf.file, 'latin1')
  assert.ok(buf.startsWith('%PDF-1.4'))
  assert.ok(buf.includes('What this record shows and what it never contains'))
  assert.ok(buf.includes('Record intact'))
  assert.throws(() => record.exportRecord({ format: 'docx' }), /pdf, csv or md/)
  const api = await record.handle('POST', '/api/record/export', null, { matterId: m.id, format: 'csv' })
  assert.strictEqual(api.status, 200)
  assert.ok(fs.existsSync(api.json.file))
  const bad = await record.handle('POST', '/api/record/export', null, { format: 'exe' })
  assert.strictEqual(bad.status, 400)
})

test('overview: the recent-activity card links to the AI record', () => {
  const m = matters.create({ title: 'Linked matter' })
  const ov = require('../src/overview').overview(m.id)
  const card = ov.cards.find((c) => c.id === 'activity')
  assert.deepStrictEqual(card.link, { label: 'Open the AI record', action: 'record', api: `/api/record?matterId=${m.id}`, cli: `openlex record --matter ${m.id}` })
  assert.match(require('../src/overview').toText(ov), /Open the AI record: openlex record --matter m_/)
})
