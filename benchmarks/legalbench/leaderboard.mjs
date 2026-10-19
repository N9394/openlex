#!/usr/bin/env node
// Builds LEADERBOARD.md from results/*.jsonl (+ .meta.json).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, 'results')
const CATS = ['routing', 'answer', 'clause', 'risk', 'cross', 'edge']
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0)
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }

const rows = []
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
  const name = f.slice(0, -6)
  const results = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  let meta = {}
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${name}.meta.json`), 'utf8')) } catch { /* none */ }
  const by = (cat) => results.filter((r) => r.category === cat)
  const sum = (rs, k) => rs.reduce((n, r) => n + r[k], 0)
  rows.push({
    name, meta, cases: results.length,
    total: pct(sum(results, 'score'), sum(results, 'max')),
    cats: Object.fromEntries(CATS.map((c) => [c, pct(sum(by(c), 'score'), sum(by(c), 'max'))])),
    latency: median(results.map((r) => r.ms).filter(Boolean)) / 1000,
  })
}
rows.sort((a, b) => b.total - a.total || (b.meta.judge?.accuracy || 0) - (a.meta.judge?.accuracy || 0))

const judge = (r) => (r.meta.judge ? `${r.meta.judge.accuracy.toFixed(2)} / ${r.meta.judge.language.toFixed(2)} / ${r.meta.judge.format.toFixed(2)}` : '—')
const md = [
  '# OpenLex LegalBench leaderboard',
  '',
  'Twenty everyday tasks of a lawyer: routing a question into a law search in the jurisdiction\'s own language (AT, SK, RO, CZ, US, UK), short legal answers, clause extraction to JSON, contract risk spotting, cross-jurisdiction comparison, and not calling tools for small talk. See [README.md](README.md) for the method and how to add a model.',
  '',
  '| # | Model | Where | Objective | Routing | Answer | Clause | Risk | Cross | Edge | Judge (accuracy / language / format, 1–5) | Median latency | Hardware | Date |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${r.meta.model || r.name} | ${r.meta.kind || '?'} | **${r.total}%** | ${CATS.map((c) => `${r.cats[c]}%`).join(' | ')} | ${judge(r)} | ${r.latency.toFixed(1)} s | ${r.meta.hardware || '—'} | ${r.meta.date || '—'} |`),
  '',
  'Objective scores are deterministic (tool call made, queries in the right language, valid JSON, no tool on small talk). For answer, risk and cross cases the objective check only verifies that an answer was given; legal quality is measured by the LLM judge. Latency depends on the hardware listed.',
  '',
]
fs.writeFileSync(path.join(here, 'LEADERBOARD.md'), md.join('\n'))
console.log(md.slice(4, 6 + rows.length).join('\n'))
