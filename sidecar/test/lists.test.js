"use strict"
/**
 * Lists (Phase 7.5): matter checklists and trackers with an audit trail,
 * seeded from chronology / review CSVs, exported to xlsx/csv/ics.
 *
 *   node --test test/lists.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-lists-'))
process.env.LEXVAULT_DATA_DIR = DATA

let lists, ws
test.before(() => {
  lists = require('../src/lists')
  ws = require('../src/workspace')
  ws.setBase(path.join(DATA, 'workspace'))
})
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

test('create, change, audit: every field change is recorded from → to with who', () => {
  const l = lists.create({ title: 'Closing checklist', items: [{ text: 'Signed SPA', owner: 'AB' }, { text: 'Merger clearance', due: future(30) }], by: 'nico' })
  const [spa, clearance] = l.items
  lists.updateItem(l.id, spa.id, { status: 'done' }, 'nico')
  lists.updateItem(l.id, clearance.id, { owner: 'CD', due: future(45), status: 'blocked', note: 'waiting for BWB' }, 'anna')
  assert.throws(() => lists.updateItem(l.id, spa.id, { status: 'maybe' }), /status must be/)
  assert.throws(() => lists.updateItem(l.id, spa.id, { due: '31.12.2026' }), /YYYY-MM-DD/)
  const got = lists.get(l.id)
  const changes = got.audit.filter((a) => a.action === 'change')
  assert.deepStrictEqual(changes.map((c) => [c.by, c.field, c.to]), [['nico', 'status', 'done'], ['anna', 'owner', 'CD'], ['anna', 'due', future(45)], ['anna', 'status', 'blocked'], ['anna', 'note', 'waiting for BWB']])
  assert.strictEqual(changes[1].from, '')
  lists.removeItem(l.id, spa.id, 'nico')
  assert.strictEqual(lists.get(l.id).audit.at(-1).action, 'remove')
})

test('overdue items are counted', () => {
  const l = lists.create({ title: 'Deadlines', items: [{ text: 'Late', due: '2020-01-01' }, { text: 'Late but done', due: '2020-01-01', status: 'done' }, { text: 'Fine', due: future(3) }] })
  assert.strictEqual(lists.all().find((x) => x.id === l.id).overdue, 1)
})

test('seed from a chronology CSV (future dates only, no duplicates) and a review CSV (high risk only)', () => {
  const folder = 'Matter_X'
  ws.writeFile(`${folder}/chronology.csv`, ['date,event,document,quote',
    `"${future(10)}","Notice period ends","lease.docx","The notice period ends on ..."`,
    '"2019-05-01","Signed","lease.docx","signed on 1 May 2019"',
    `"${future(20)}","Option to renew, ""early"" exercise","lease.docx","may renew,\nin writing"`].join('\n'))
  ws.writeFile(`${folder}/review.csv`, ['document,check,risk,answer,quote,location',
    '"spa.docx","change_of_control","high","Consent of the bank needed","consent of the Lender","§ 9"',
    '"spa.docx","governing_law","low","Austrian law","Austrian law","§ 20"'].join('\n'))
  const l = lists.create({ title: 'From workflows' })
  let r = lists.seedFromFile(l.id, `${folder}/chronology.csv`)
  assert.strictEqual(r.added, 2)
  assert.deepStrictEqual(r.list.items.map((i) => i.due), [future(10), future(20)])
  assert.strictEqual(r.list.items[1].text, 'Option to renew, "early" exercise')
  assert.strictEqual(r.list.items[1].source.quote, 'may renew,\nin writing')
  r = lists.seedFromFile(l.id, `${folder}/chronology.csv`)
  assert.strictEqual(r.added, 0, 'no duplicates on a second seed')
  r = lists.seedFromFile(l.id, path.join(ws.resolve(''), folder, 'review.csv'))
  assert.strictEqual(r.added, 1)
  assert.match(r.list.items.at(-1).text, /Consent of the bank/)
  assert.throws(() => lists.seedFromFile(l.id, '/etc/hosts'), /inside the OpenLex workspace/)
  fs.writeFileSync(path.join(DATA, 'workspace-evil.csv'), 'x')
  assert.throws(() => lists.seedFromFile(l.id, path.join(DATA, 'workspace-evil.csv')), /inside the OpenLex workspace/)
})

test('export: xlsx with audit sheet, csv, and ics with exclusive all-day end dates (open items only)', () => {
  const l = lists.create({ title: 'Export me', items: [{ text: 'File; notice, now', due: '2026-12-31', owner: 'AB' }, { text: 'Done thing', due: '2026-12-01', status: 'done' }] })
  const { files } = lists.exportList(l.id)
  assert.deepStrictEqual(files.map((f) => path.extname(f)), ['.xlsx', '.csv', '.ics'])
  const ics = fs.readFileSync(files[2], 'utf8')
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/)
  assert.ok(ics.includes('SUMMARY:File\\; notice\\, now'), 'commas and semicolons escaped (RFC 5545)')
  assert.ok(!/Done thing/.test(ics))
  assert.strictEqual(fs.readFileSync(files[0]).readUInt32LE(0), 0x04034b50)
})
