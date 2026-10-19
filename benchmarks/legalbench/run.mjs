#!/usr/bin/env node
// LegalBench runner — any OpenAI-compatible chat endpoint (llama.cpp,
// Ollama, vLLM, LM Studio, OpenRouter, OpenAI, Mistral, Anthropic's
// OpenAI-compatible API …). Objective scoring only; see judge.mjs for the
// optional LLM-judge pass.
//
//   node run.mjs --endpoint http://127.0.0.1:8080/v1 --model lotus --name lotus-2 \
//                [--key-env OPENROUTER_API_KEY] [--hardware "RTX 3060 12GB"] [--runtime "llama.cpp b11560 CUDA"]
//
// Writes results/<name>.jsonl (+ .meta.json). Resumes: finished cases are skipped.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const endpoint = arg('endpoint')
const model = arg('model')
const name = arg('name', model)
if (!endpoint || !model) { console.error('usage: node run.mjs --endpoint URL --model NAME [--name LABEL] [--key-env VAR]'); process.exit(2) }
const key = arg('key-env') ? process.env[arg('key-env')] : ''
const { tools: TOOLS, cases: CASES } = JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8'))
const out = path.join(here, 'results', `${name}.jsonl`)

// Diacritics that must appear in queries written in the jurisdiction language.
const MARKS = { sk: /[čľšžôäíýéá]/gi, ro: /[ăâîșț]/gi, cs: /[čřšžýáíéůěďňť]/gi, de: /[äöüß]/gi }
const langOk = (lang, text) => !MARKS[lang] || (text.match(MARKS[lang]) || []).length > 0

export function score(c, r) {
  const s = { points: 0, max: 0, notes: [] }
  const calls = (r.toolCalls || []).filter((t) => t.name === 'search_legal_database')
  if (c.category === 'routing') {
    s.max = 3
    if (calls.length === 1) s.points++; else s.notes.push(`tool calls: ${calls.length}`)
    if (calls.length) {
      try {
        const a = JSON.parse(calls[0].args || '{}')
        const q = [a.query, a.query2, a.query3].filter(Boolean)
        if (q.length >= 2) s.points++
        if (langOk(c.language, q.join(' '))) s.points++; else s.notes.push('queries not in the jurisdiction language')
      } catch { s.notes.push('arguments not JSON') }
    } else s.notes.push('no tool call')
  } else if (c.category === 'clause') {
    s.max = 2
    const t = String(r.content || '').trim().replace(/^```\w*\n|\n```$/g, '')
    try {
      const o = JSON.parse(t)
      const keys = ['parties', 'obligations', 'prohibitions', 'values', 'durations']
      const have = keys.filter((k) => Array.isArray(o[k]))
      s.points += (have.length / keys.length) * 2
      s.notes.push(`keys: ${have.join(',') || 'none'}`)
    } catch { s.notes.push('not valid JSON') }
  } else if (c.category === 'edge') {
    s.max = 1
    if (!(r.toolCalls || []).length) s.points++; else s.notes.push('called a tool on chit-chat')
  } else {
    s.max = 1
    if (String(r.content || '').trim().length > 20) s.points++; else s.notes.push('empty or too short')
  }
  return s
}

async function call(c) {
  const body = { model, messages: [{ role: 'system', content: c.system }, { role: 'user', content: c.user }], temperature: 0.1, max_tokens: 800, stream: false }
  if (c.tools) body.tools = c.tools.map((t) => TOOLS[t])
  const t0 = Date.now()
  const res = await fetch(`${endpoint.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  })
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`, ms: Date.now() - t0 }
  const j = await res.json()
  const msg = j.choices?.[0]?.message || {}
  return {
    ms: Date.now() - t0,
    content: msg.content || '',
    toolCalls: (msg.tool_calls || []).map((t) => ({ name: t.function?.name, args: t.function?.arguments })),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const done = new Set()
  if (fs.existsSync(out)) for (const l of fs.readFileSync(out, 'utf8').split('\n').filter(Boolean)) done.add(JSON.parse(l).case)
  for (const c of CASES) {
    if (done.has(c.id)) continue
    let r
    try { r = await call(c) } catch (err) { r = { error: err.message, ms: 0 } }
    const sc = r.error ? { points: 0, max: c.category === 'routing' ? 3 : c.category === 'clause' ? 2 : 1, notes: [r.error] } : score(c, r)
    fs.appendFileSync(out, JSON.stringify({ case: c.id, category: c.category, language: c.language, ms: r.ms, score: sc.points, max: sc.max, notes: sc.notes, content: String(r.content || '').slice(0, 600), toolCalls: r.toolCalls || [] }) + '\n')
    console.log(`${c.id.padEnd(7)} ${sc.points}/${sc.max} ${(r.ms / 1000).toFixed(1)}s ${sc.notes.join('; ')}`)
  }
  const metaPath = out.replace(/\.jsonl$/, '.meta.json')
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({ model: arg('label', name), kind: arg('kind', /127\.0\.0\.1|localhost/.test(endpoint) ? 'local' : 'cloud'), runtime: arg('runtime', ''), hardware: arg('hardware', ''), date: new Date().toISOString().slice(0, 10) }, null, 2) + '\n')
  }
  console.log(`→ ${out}\nRebuild the table: node leaderboard.mjs`)
}
