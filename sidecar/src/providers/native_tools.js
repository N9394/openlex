"use strict"
/**
 * Native tool calling for hosted models (Phase 1).
 *
 * The agent loop speaks a text-JSON protocol — `{"tool": name, "args": {…}}`
 * in the reply — because that is what Lotus was fine-tuned on. Hosted
 * models are better (and cheaper) with their API's own function calling,
 * so for them we send real tool definitions and turn the native tool call
 * in the response back into that same text-JSON. agent.js and Lotus are
 * untouched; parseToolCall stays the single source of truth.
 */

// Meta tools that only exist to page schemas into a small model's context.
const SKIP = new Set(['tool_picker', 'get_tool_schemas', 'search_docs'])

const SUGGESTION_ITEM = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['rephrase', 'flag-favoring', 'legal-risk', 'alternative', 'compliance'] },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    summary: { type: 'string', description: 'One line: what and why.' },
    anchor: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Verbatim sentence from the document (≤220 chars) the suggestion attaches to.' } },
      required: ['text'],
    },
    proposed_text: { type: 'string', description: 'Complete replacement text for a rewrite, in the document language. Omit for flags.' },
    reason: { type: 'string' },
    party: { type: 'string', description: 'Party the clause favors, for flag-favoring.' },
    statute: { type: 'string', description: 'Legal basis, e.g. "ABGB § 1295".' },
    chunk_id: { type: 'string', description: 'Law chunk id from search_law, when cited.' },
  },
  required: ['type', 'summary'],
}

/** 'number 0-100' / 'string (optional — …)' / 'array of tool names' → JSON Schema. */
function propSchema(spec) {
  const s = String(spec || 'string')
  const type = /^(number|integer)/.test(s) ? 'number'
    : /^array/.test(s) ? 'array'
    : /^object/.test(s) ? 'object'
    : /^bool/.test(s) ? 'boolean'
    : 'string'
  const out = { type }
  if (type === 'array') out.items = /tool names/.test(s) ? { type: 'string' } : {}
  const desc = s.replace(/^(number|integer|string|array|object|boolean)\s*/, '').replace(/^\(|\)$/g, '').trim()
  if (desc) out.description = desc
  return out
}

function inputSchema(name, input) {
  if (name === 'propose_suggestions') {
    return { type: 'object', properties: { suggestions: { type: 'array', items: SUGGESTION_ITEM } }, required: ['suggestions'] }
  }
  const properties = {}
  const required = []
  for (const [k, spec] of Object.entries(input || {})) {
    properties[k] = propSchema(spec)
    if (!/optional/.test(String(spec)) && !/^query[23]$/.test(k)) required.push(k)
  }
  return { type: 'object', properties, required }
}

// Hosted APIs restrict tool names to [a-zA-Z0-9_-]{1,64}.
const safeName = (n) => String(n).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)

/**
 * Neutral tool list: [{ name, description, parameters }], plus a map from
 * the API-safe name back to the agent's tool name.
 */
function toolList() {
  const { TOOLS } = require('../tools')
  const tools = []
  const names = new Map()
  for (const [name, t] of Object.entries(TOOLS)) {
    if (SKIP.has(name)) continue
    tools.push({ name: safeName(name), description: t.description, parameters: inputSchema(name, t.input) })
    names.set(safeName(name), name)
  }
  try {
    for (const t of require('../mcp/client').allTools()) {
      const sn = safeName(t.qualified)
      if (names.has(sn)) continue
      const params = t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} }
      tools.push({ name: sn, description: `${t.description || t.name}${t.remote ? ' (external service)' : ''}`, parameters: params })
      names.set(sn, t.qualified)
    }
  } catch { /* no connectors */ }
  return { tools, names }
}

/** The agent's text-JSON form of a native tool call. */
function asTextCall(names, name, args) {
  let parsed = args
  if (typeof args === 'string') {
    try { parsed = args.trim() ? JSON.parse(args) : {} } catch { parsed = {} }
  }
  return JSON.stringify({ tool: names.get(name) || name, args: parsed || {} })
}

const forOpenAI = (tools) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
const forAnthropic = (tools) => tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))

module.exports = { toolList, asTextCall, forOpenAI, forAnthropic, inputSchema, propSchema }
