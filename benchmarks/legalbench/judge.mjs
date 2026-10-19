#!/usr/bin/env node
// Optional LLM-judge pass: a strong model grades each result 1–5 on legal
// accuracy, language/terminology and format, and the averages go into
// results/<name>.meta.json (shown in LEADERBOARD.md).
//
//   node judge.mjs --name lotus-2 --endpoint https://openrouter.ai/api/v1 --model qwen/qwen3.5-122b-a10b --key-env OPENROUTER_API_KEY
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const name = arg('name')
const endpoint = arg('endpoint')
const model = arg('model')
if (!name || !endpoint || !model) { console.error('usage: node judge.mjs --name RESULT --endpoint URL --model JUDGE [--key-env VAR]'); process.exit(2) }
const key = arg('key-env') ? process.env[arg('key-env')] : ''
const file = path.join(here, 'results', `${name}.jsonl`)
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

const AXIS = {
  routing: 'For ROUTING cases the correct response is a search_legal_database TOOL CALL with 2-3 queries in the jurisdiction language. Grade the tool calls (query language, statutory precision), not the empty text.',
  edge: 'For EDGE cases (greeting, small talk) the correct response is a polite reply WITHOUT any tool call.',
  clause: 'For CLAUSE cases the correct response is valid JSON with the 5 keys. Grade the accuracy of the JSON content.',
}

async function grade(r) {
  const prompt = [
    'You are a strict legal grading judge. Score the MODEL RESPONSE 1-5 on three axes:',
    '- accuracy: legal correctness of the substance',
    '- language: correct language and terminology for the jurisdiction',
    '- format: obeyed the task format (tool call, JSON schema, brevity)',
    `CASE [${r.case} / ${r.category} / ${r.language}]`,
    AXIS[r.category] || 'Grade the legal substance of the text answer.',
    `MODEL RESPONSE: ${String(r.content || '').slice(0, 600) || '(none — see tool calls)'}`,
    `TOOL CALLS: ${JSON.stringify(r.toolCalls || []).slice(0, 400)}`,
    'Reply with ONLY JSON: {"accuracy":N,"language":N,"format":N,"note":"one line"}',
  ].join('\n')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${endpoint.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 200 }),
        signal: AbortSignal.timeout(120000),
      })
      const j = await res.json()
      const t = String(j.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim()
      return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    } catch (err) { if (attempt === 2) return { accuracy: 0, language: 0, format: 0, note: `judge error: ${err.message}` } }
  }
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const scores = []
for (const r of rows) {
  r.judge = await grade(r)
  scores.push(r.judge)
  console.log(`${r.case.padEnd(7)} acc=${r.judge.accuracy} lang=${r.judge.language} fmt=${r.judge.format} ${r.judge.note || ''}`)
}
fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
const metaPath = file.replace(/\.jsonl$/, '.meta.json')
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {}
meta.judge = { model, accuracy: +avg(scores.map((s) => +s.accuracy || 0)).toFixed(2), language: +avg(scores.map((s) => +s.language || 0)).toFixed(2), format: +avg(scores.map((s) => +s.format || 0)).toFixed(2) }
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n')
console.log('judge averages:', meta.judge)
