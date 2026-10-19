"use strict"
/**
 * Native tool calling for hosted models (Phase 1).
 *
 *   node --test test/native_tools.test.js
 *
 * A fake OpenAI-compatible + Anthropic server answers agent-phase calls
 * with native tool calls; the facade must hand the agent the same
 * text-JSON tool call Lotus emits, so parseToolCall works unchanged.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-native-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test-openai'
process.env.OPENLEX_KEY_ANTHROPIC = 'sk-test-anthropic'

const seen = []
const sse = (res, events) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`)
  res.end('data: [DONE]\n\n')
}

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}
    seen.push({ url: req.url, body })
    const withTools = !!body.tools
    if (req.url.startsWith('/v1/chat/completions')) {
      if (!withTools) {
        if (body.stream) return sse(res, [{ choices: [{ delta: { content: 'plain' } }] }])
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ choices: [{ message: { content: 'plain' } }] }))
      }
      if (body.stream) {
        // Arguments arrive split across deltas, as real APIs send them.
        return sse(res, [
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'search_law', arguments: '' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"jurisdiction":"AT",' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"query":"Gewährleistung"}' } }] } }] },
        ])
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'get_document_map', arguments: '{}' } }] } }] }))
    }
    if (req.url === '/v1/messages') {
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`)
        ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check the clause.' } })
        ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'propose_suggestions', input: {} } })
        ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"suggestions":[{"type":"legal-risk",' } })
        ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"summary":"Cap missing"}]}' } })
        return res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n')
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ content: [{ type: 'text', text: 'Searching.' }, { type: 'tool_use', name: 'mcp__dms__find', input: { q: 'Acme' } }] }))
    }
    res.writeHead(404); res.end()
  })
})

let base
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${fake.address().port}`
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

const settings = require('../src/providers/settings')
const policy = require('../src/policy')
const llm = require('../src/llm')
const { parseToolCall } = require('../src/agent')
const native = require('../src/providers/native_tools')

test('tool list: JSON Schemas from the agent tool table, meta tools left out', () => {
  const { tools, names } = native.toolList()
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
  assert.ok(byName.search_law)
  assert.deepStrictEqual(byName.search_law.parameters.required, ['jurisdiction', 'query'], 'query2/query3 are optional')
  assert.strictEqual(byName.risk_scorecard.parameters.properties.score.type, 'number')
  assert.strictEqual(byName.propose_suggestions.parameters.properties.suggestions.items.properties.severity.enum.length, 3)
  assert.ok(!byName.tool_picker && !byName.get_tool_schemas, 'schema-paging meta tools are not needed natively')
  assert.ok(tools.every((t) => /^[a-zA-Z0-9_-]{1,64}$/.test(t.name)))
  assert.strictEqual(names.get('search_law'), 'search_law')
})

test('OpenAI: agent phases send tools; streamed tool call → text-JSON the agent parses', async () => {
  policy.setRule(null, { mode: 'allow-list', providers: ['openai', 'anthropic'] })
  settings.update({ provider: 'openai', overrides: { baseUrl: `${base}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  const r = await llm.chatWithReasoning([{ role: 'user', content: 'Gewährleistungsfrist?' }], { phase: 'planning' })
  const req = seen[seen.length - 1].body
  assert.ok(req.tools.some((t) => t.type === 'function' && t.function.name === 'search_law'))
  assert.strictEqual(req.tool_choice, 'auto')
  const call = parseToolCall(r.content)
  assert.strictEqual(call.tool, 'search_law')
  assert.deepStrictEqual(call.args, { jurisdiction: 'AT', query: 'Gewährleistung' })
})

test('OpenAI: non-streaming tool call; no tools outside agent phases or on prose-streaming calls', async () => {
  const out = await llm.chat([{ role: 'user', content: 'map' }], { phase: 'analyzing' })
  assert.strictEqual(parseToolCall(out).tool, 'get_document_map')
  assert.strictEqual(await llm.chat([{ role: 'user', content: 'judge this' }]), 'plain')
  assert.ok(!seen[seen.length - 1].body.tools, 'judge/workflow calls carry no tools')
  const pieces = []
  await llm.chatWithReasoning([{ role: 'user', content: 'answer' }], { phase: 'writing', onContent: (t) => pieces.push(t) })
  assert.ok(!seen[seen.length - 1].body.tools, 'streamed prose answers carry no tools')
  assert.deepStrictEqual(pieces, ['plain'])
})

test('provider setting nativeTools:false keeps the text-JSON protocol', async () => {
  settings.update({ provider: 'openai', overrides: { nativeTools: false } })
  try {
    await llm.chat([{ role: 'user', content: 'x' }], { phase: 'planning' })
    assert.ok(!seen[seen.length - 1].body.tools)
  } finally { settings.update({ provider: 'openai', overrides: { nativeTools: true } }) }
})

test('Anthropic: tool_use (streamed and not) → text-JSON; preamble text dropped', async () => {
  settings.update({ provider: 'anthropic', overrides: { baseUrl: base, model: 'claude-test' } })
  settings.update({ active: 'anthropic' })
  const r = await llm.chatWithReasoning([{ role: 'system', content: 'S' }, { role: 'user', content: 'review' }], { phase: 'analyzing' })
  const req = seen[seen.length - 1].body
  assert.ok(req.tools.some((t) => t.name === 'propose_suggestions' && t.input_schema.type === 'object'))
  assert.deepStrictEqual(req.tool_choice, { type: 'auto', disable_parallel_tool_use: true })
  const call = parseToolCall(r.content)
  assert.strictEqual(call.tool, 'propose_suggestions')
  assert.strictEqual(call.args.suggestions[0].summary, 'Cap missing')
  const out = await llm.chat([{ role: 'user', content: 'find' }], { phase: 'planning' })
  assert.deepStrictEqual(JSON.parse(out), { tool: 'mcp__dms__find', args: { q: 'Acme' } })
})
