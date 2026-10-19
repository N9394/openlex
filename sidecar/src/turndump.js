"use strict"
/**
 * Turn dump — append-only JSONL record of every LLM turn the agent makes.
 *
 * The sidecar logs nothing per-request to disk (stdout goes nowhere when
 * launched by Word's VBS wrapper), so after a crash the model's behaviour is
 * unrecoverable. This module gives every turn a durable record: phase, token
 * estimate, what compaction did, which tool fired (hop loop), latency, and a
 * size signature of the reply. One JSON object per line in
 * ~/.lexvault/sidecar-turndump.jsonl (rotates at 1 MB, keeps one old file).
 *
 * Cheap: synchronous append, no reads, no in-memory buffer. A typical turn
 * adds ~250 bytes.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const { DATA_DIR } = require('./config')
const { estimateTokens } = require('./compress')

const FILE = process.env.LEXVAULT_TURNLOG_PATH || path.join(DATA_DIR, 'sidecar-turndump.jsonl')
const MAX_BYTES = 1024 * 1024 // 1 MB

let sessionId = null
function sid() {
  if (!sessionId) sessionId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
  return sessionId
}

function safeStr(x) { return String(x == null ? '' : x) }

function rotateIfNeeded() {
  try {
    if (fs.existsSync(FILE) && fs.statSync(FILE).size > MAX_BYTES) {
      const old = FILE + '.1'
      try { fs.unlinkSync(old) } catch {}
      try { fs.renameSync(FILE, old) } catch {}
    }
  } catch { /* best effort */ }
}

/**
 * @param {object} o
 *   o.phase      'planning'|'analyzing'|'writing'
 *   o.estTokens  estimated message tokens BEFORE compact
 *   o.compacted  string[] actions taken by the compactor
 *   o.tool       tool name that preceded this turn (hop loop)
 *   o.toolArgs   object  tool args (hop loop)
 *   o.latencyMs  number  wall-clock turn duration
 *   o.reasoningChars number length of reasoning returned
 *   o.contentChars   number length of content returned
 *   o.stop       'done'|'overflow'|'error'|'aborted'
 *   o.err        string  error message when stop==='error'
 */
function logTurn(o = {}) {
  try {
    rotateIfNeeded()
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sid: sid(),
      phase: safeStr(o.phase),
      estTokens: o.estTokens | 0,
      compacted: Array.isArray(o.compacted) ? o.compacted : [],
      tool: safeStr(o.tool || ''),
      toolArgs: o.toolArgs && typeof o.toolArgs === 'object' ? o.toolArgs : null,
      latencyMs: o.latencyMs | 0,
      reasoningChars: o.reasoningChars | 0,
      contentChars: o.contentChars | 0,
      stop: safeStr(o.stop || 'done'),
      err: safeStr(o.err || ''),
    }) + '\n'
    fs.appendFileSync(FILE, line)
  } catch { /* logging must never break the agent */ }
}

/** Convenience: estimate tokens for a message list. */
function estMessages(messages) {
  return (messages || []).reduce((n, m) => n + estimateTokens(m.content || ''), 0)
}

/** Record a tool dispatch from the hop loop (correlates to a turn via `sid`). */
function logTool(toolName, toolArgs) {
  try {
    rotateIfNeeded()
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sid: sid(),
      type: 'tool',
      tool: safeStr(toolName || ''),
      args: toolArgs && typeof toolArgs === 'object' ? toolArgs : null,
    }) + '\n'
    fs.appendFileSync(FILE, line)
  } catch { /* never break the agent */ }
}

module.exports = { logTurn, logTool, estMessages, FILE }
