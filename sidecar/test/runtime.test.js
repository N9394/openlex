"use strict"
/**
 * Runtime verification (A1): llama-server spawn/attach with the Lotus GGUF.
 *
 *   node test/runtime.test.js
 *
 * Spawns the bundled llama-server with the downloaded Lotus model on a free
 * port, waits for readiness, runs one tiny chat completion, then stops it.
 * Skips (PASS) if the model file is not installed — the download-manager
 * test covers that path.
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const MODEL = path.join(os.homedir(), '.lexvault', 'models', 'lotus-ai-q4km.gguf')
const PORT = process.env.LEXVAULT_LLM_PORT || '11439'
process.env.LEXVAULT_LLM_URL = `http://127.0.0.1:${PORT}`

function llamaServerCount() {
  try {
    const out = execSync(`ps aux | grep '[l]lama-server' | grep -c .`, { encoding: 'utf8' }).trim()
    return parseInt(out, 10) || 0
  } catch { return 0 }
}

;(async () => {
  if (!fs.existsSync(MODEL)) {
    console.log('SKIP — Lotus GGUF not installed (run the setup download first)')
    return process.exit(0)
  }

  const runtime = require('../src/runtime')
  const llm = require('../src/llm')

  console.log(`\nruntime.test.js — spawn llama-server with Lotus on :${PORT}`)
  const before = llamaServerCount()

  // 1. Spawn (nothing on :PORT yet)
  const s1 = await runtime.ensureLlama()
  assert.strictEqual(s1.ok, true, `spawn: ${s1.reason}`)
  assert.strictEqual(s1.owned, true, 'we own the spawned process')
  console.log('  ok  spawn:', s1.reason)

  // 2. Re-entrant: attaches to the running server, no double spawn
  const s2 = await runtime.ensureLlama()
  assert.strictEqual(s2.ok, true)
  assert.strictEqual(s2.owned, false, 'attach path (probe hit our own server)')
  assert.strictEqual(llamaServerCount(), before + 1, 'exactly one llama-server process')
  console.log('  ok  re-entrant ensureLlama → attach, single process')

  // 3. Model visible via /api/tags
  const ping = await llm.ping()
  assert.strictEqual(ping.ok, true, 'llm ping after spawn')
  console.log('  ok  /api/tags models:', ping.models.join(', ') || '(none)')

  // 4. One real completion through llm.js (temp 0, think off)
  const out = await llm.chat([
    { role: 'system', content: 'You are a test harness. Answer in one short sentence.' },
    { role: 'user', content: 'Reply with exactly: PONG' },
  ], { maxTokens: 32 })
  assert.ok(out.trim().length > 0, 'completion returned content')
  console.log('  ok  chat completion →', JSON.stringify(out.trim().slice(0, 60)))

  // 5. Stop → process gone
  runtime.stop()
  await new Promise((r) => setTimeout(r, 1500))
  assert.ok(!runtime.proc, 'proc nulled after stop')
  assert.strictEqual(llamaServerCount(), before, 'llama-server reaped')
  console.log('  ok  stop() → process reaped')

  console.log('\nall runtime checks passed')
})().catch((err) => {
  console.error('FAIL:', err.message)
  try { require('../src/runtime').stop() } catch { }
  process.exit(1)
})
