"use strict"
/**
 * Answer language and window language (agent-config.js → answerLang, uiLang)
 * and how the agent's prompt honours it (prompts.js).
 *
 *   node --test test/answer_lang.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-lang-'))
process.env.LEXVAULT_DATA_DIR = DATA
test.after(() => fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))

const ac = require('../src/agent-config')
const prompts = require('../src/prompts')

test('defaults: answerLang auto, uiLang null', () => {
  const c = ac.load()
  assert.strictEqual(c.answerLang, 'auto')
  assert.strictEqual(c.uiLang, null)
})

test('save validates and keeps the other settings; undefined keys keep their value', () => {
  ac.save({ depth: 'deep', autopilot: true })
  let c = ac.save({ answerLang: 'de', uiLang: 'de' })
  assert.deepStrictEqual([c.answerLang, c.uiLang, c.depth, c.autopilot], ['de', 'de', 'deep', true])
  // What POST /api/config/agent sends when the pane only changes the window language.
  c = ac.save({ depth: undefined, applyMode: undefined, autopilot: undefined, answerLang: undefined, uiLang: 'en' })
  assert.deepStrictEqual([c.answerLang, c.uiLang, c.depth, c.autopilot], ['de', 'en', 'deep', true])
  c = ac.load()
  assert.deepStrictEqual([c.answerLang, c.uiLang], ['de', 'en'])
  c = ac.save({ uiLang: null, answerLang: 'auto' })
  assert.deepStrictEqual([c.answerLang, c.uiLang], ['auto', null])
  assert.throws(() => ac.save({ answerLang: 'fr' }), /unknown answerLang/)
  assert.throws(() => ac.save({ uiLang: 'auto' }), /unknown uiLang/)
  assert.strictEqual(ac.load().answerLang, 'auto', 'a refused value is not stored')
})

test('a broken value in the file falls back to the defaults', () => {
  fs.writeFileSync(ac.CONFIG_PATH, JSON.stringify({ answerLang: 'xx', uiLang: 7 }))
  const c = ac.load()
  assert.deepStrictEqual([c.answerLang, c.uiLang], ['auto', null])
})

test('the prompt: auto keeps the document-language rule, de/en force the answer language', () => {
  const auto = prompts.build({ phase: 'planning', message: 'Summarise this contract' }).text
  assert.match(auto, /Respond in the document's language/)
  assert.doesNotMatch(auto, /Always answer in/)
  assert.strictEqual(prompts.build({ phase: 'planning', message: 'x', answerLang: 'auto' }).text, prompts.build({ phase: 'planning', message: 'x' }).text)
  const de = prompts.build({ phase: 'writing', message: 'Summarise this contract', answerLang: 'de' }).text
  assert.match(de, /Always answer in German/)
  assert.match(de, /verbatim/)
  assert.doesNotMatch(de, /Respond in the document's language/)
  const en = prompts.build({ phase: 'analyzing', message: 'Fasse den Vertrag zusammen', answerLang: 'en' }).text
  assert.match(en, /Always answer in English/)
  assert.doesNotMatch(en, /Respond in the document's language/)
})

test('POST /api/config/agent passes answerLang and uiLang through (with depth, applyMode, autopilot)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8')
  const line = src.split('\n').find((l) => /agentCfg\.save\(/.test(l))
  for (const k of ['depth', 'applyMode', 'autopilot', 'answerLang', 'uiLang']) assert.match(line, new RegExp(`${k}: body\\.${k}`), k)
  const agent = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent.js'), 'utf8')
  assert.match(agent, /answerLang,\n\s*\}\)\.text/, 'agent.js hands answerLang to prompts.build')
})
