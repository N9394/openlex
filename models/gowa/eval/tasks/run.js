#!/usr/bin/env node
"use strict"
/**
 * GOWA task evaluation — the five decision tasks besides redaction
 * (sidecar/src/decide_tasks.js), each on its own gold set in 8 languages:
 *
 *   injection      gold/injection/<lang>.jsonl      { id, text, answer: true|false, tags }
 *   routing        gold/routing/<lang>.jsonl        { id, text, answer: <route id>, tags }
 *   clause_type    gold/clause_type/<lang>.jsonl    { id, title, text, answer: <type id>|other, tags }
 *   claim_support  gold/claim_support/<lang>.jsonl  { id, claim, source, answer: supported|partly|not_supported|not_covered, tags }
 *   relevance      gold/relevance/<lang>.jsonl      { id, query, passages: [{ text, rel: 0|1|2 }], tags }
 *
 * It calls the same functions the app calls (injectionSignal, routeRequest, clauseTypes,
 * claimSupport, rerank), so thresholds, windows and prompts are measured with the model.
 *
 * Modes:
 *   gold    check the gold files and count them (no model)
 *   rules   what the app does without GOWA, where there is such a rule (clause_type: clauses.classify)
 *   oracle  a perfect model built from the gold answers: must reach 100% — checks the plumbing
 *   gowa    the GOWA release folder given by --model
 *
 *   node models/gowa/eval/tasks/run.js                          # gold + rules + oracle
 *   node models/gowa/eval/tasks/run.js --model /path/release    # + gowa
 *   options: --task injection,routing  --lang de,cs  --out report.md  --json report.json  --list wrong
 *
 * The gates (README.md) are about what reaches the lawyer: a task only switches on
 * when its confident answers are right, and an unsure answer simply falls back.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const HERE = __dirname
const SIDECAR = path.resolve(HERE, '../../../../sidecar')
const LANGS = ['de', 'en', 'cs', 'sk', 'pl', 'ro', 'fr', 'hu']
const TASK_IDS = ['injection', 'routing', 'clause_type', 'claim_support', 'relevance']
const pct = (x) => (x === null || Number.isNaN(x) ? '—' : `${(100 * x).toFixed(1)}%`)

function args(argv) {
  const a = { list: [], task: TASK_IDS, lang: LANGS }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--model') a.model = argv[++i]
    else if (k === '--task') a.task = argv[++i].split(',')
    else if (k === '--lang') a.lang = argv[++i].split(',')
    else if (k === '--out') a.out = argv[++i]
    else if (k === '--json') a.json = argv[++i]
    else if (k === '--list') a.list.push(argv[++i])
    else throw new Error(`unknown option ${k}`)
  }
  return a
}

// ── gold ──────────────────────────────────────────────────────────────────
function loadGold(task, langs, eng) {
  const out = []
  const problems = []
  const ids = new Set()
  const choices = {
    routing: Object.keys(eng.tasks.ROUTES),
    clause_type: [...eng.clauses.TYPES.map(([id]) => id), 'other'],
    claim_support: Object.keys(eng.tasks.SUPPORT_OPTIONS),
  }[task]
  for (const lang of langs) {
    const file = path.join(HERE, 'gold', task, `${lang}.jsonl`)
    if (!fs.existsSync(file)) continue
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, n) => {
      if (!line.trim()) return
      let d
      try { d = JSON.parse(line) } catch (e) { problems.push(`${task}/${lang}:${n + 1} not JSON`); return }
      const where = `${task}/${lang}:${n + 1} ${d.id || ''}`
      if (!d.id || ids.has(d.id)) problems.push(`${where} id missing or repeated`)
      ids.add(d.id)
      if (task === 'injection' && (typeof d.text !== 'string' || typeof d.answer !== 'boolean')) problems.push(`${where} needs text + answer true/false`)
      if (choices && !choices.includes(d.answer)) problems.push(`${where} answer "${d.answer}" not one of ${choices.join(', ')}`)
      if (task === 'claim_support' && !(d.claim && d.source)) problems.push(`${where} needs claim + source`)
      if (task === 'relevance' && !(d.query && Array.isArray(d.passages) && d.passages.length >= 3 && d.passages.some((p) => p.rel > 0) && d.passages.some((p) => !p.rel))) problems.push(`${where} needs query + ≥3 passages, some relevant and some not`)
      out.push({ ...d, lang, tags: d.tags || [] })
    })
  }
  return { items: out, problems }
}

// ── engine ────────────────────────────────────────────────────────────────
function setupEngine(model) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-taskeval-'))
  process.env.LEXVAULT_DATA_DIR = data
  const req = (m) => require(path.join(SIDECAR, 'src', m))
  const eng = { harness: req('harness'), gowa: req('gowa'), tasks: req('decide_tasks'), clauses: req('clauses') }
  eng.harness.setUserSection('decide', { tasks: Object.fromEntries(TASK_IDS.map((t) => [t, true])) })
  if (model) {
    const dest = path.join(data, 'models', eng.gowa.MANIFEST.id)
    fs.mkdirSync(dest, { recursive: true })
    for (const f of eng.gowa.REQUIRED) {
      const src = path.join(path.resolve(model), f)
      if (!fs.existsSync(src)) throw new Error(`--model: ${f} missing in ${model}`)
      fs.symlinkSync(src, path.join(dest, f))
    }
  }
  return eng
}

// The oracle answers from the gold, found by the text GOWA is shown (the scripted
// tokenizer gives it back with single spaces).
const squash = (s) => String(s).replace(/\s+/g, ' ').trim()
function useOracle(eng, items, task) {
  const key = new Map()
  const k2 = (state, extra = '') => `${squash(state).slice(0, 200)}||${squash(extra).slice(0, 200)}`
  for (const d of items) {
    if (task === 'injection' || task === 'routing') key.set(k2(d.text), d.answer)
    else if (task === 'clause_type') key.set(k2(`${d.title || ''}\n${d.text}`), d.answer)
    else if (task === 'claim_support') key.set(k2(d.source, d.claim), d.answer)
    else if (task === 'relevance') d.passages.forEach((p) => key.set(k2(p.text, d.query), p.rel > 0))
  }
  const rule = (state, instructions, options) => {
    let extra = ''
    if (task === 'claim_support') extra = instructions.replace(/^.*?Claim: /, '')
    if (task === 'relevance') extra = instructions.replace(/^Is this passage relevant to the search: /, '').replace(/\?$/, '')
    const ans = key.get(k2(state, extra))
    if (ans === undefined) return null
    if (typeof ans === 'boolean') return ans ? 0 : 1
    return options.findIndex((o) => o === ans || o.startsWith(`${ans}:`))
  }
  eng.gowa._setTestBackend(require(path.join(SIDECAR, 'test', 'fixtures', 'scripted_gowa')).scripted(rule))
}

// ── one mode over one task ────────────────────────────────────────────────
async function runTask(eng, task, items, mode) {
  const rows = []
  if (task === 'injection') {
    for (const d of items) {
      const r = await eng.tasks.injectionSignal(d.text)
      rows.push({ d, got: r ? r.flagged.length > 0 : null, p: r?.max ?? null })
    }
  } else if (task === 'routing') {
    for (const d of items) {
      const r = await eng.tasks.routeRequest(d.text)
      rows.push({ d, got: r?.kind ?? null, p: r?.p ?? null, sure: r?.outcome === 'automate' })
    }
  } else if (task === 'clause_type') {
    if (mode === 'rules') {
      for (const d of items) rows.push({ d, got: eng.clauses.classify(d.title || '', d.text), sure: true })
    } else {
      const types = eng.clauses.TYPES.map(([id, label]) => [id, label])
      const res = await eng.tasks.clauseTypes(items.map((d) => ({ title: d.title, text: d.text })), types)
      items.forEach((d, i) => rows.push({ d, got: res?.[i]?.answer ?? null, p: res?.[i]?.p ?? null, sure: res?.[i]?.outcome === 'automate' }))
    }
  } else if (task === 'claim_support') {
    const res = await eng.tasks.claimSupport(items.map((d) => ({ claim: d.claim, source: d.source })))
    items.forEach((d, i) => rows.push({ d, got: res?.[i]?.answer ?? null, p: res?.[i]?.p ?? null, sure: res?.[i]?.outcome === 'automate' }))
  } else if (task === 'relevance') {
    for (const d of items) {
      const order = await eng.tasks.rerank(d.query, d.passages)
      rows.push({ d, base: ndcg(d.passages, 3), got: order ? ndcg(order, 3) : null, top1: order ? order[0].rel > 0 : null })
    }
  }
  return rows
}

function ndcg(list, k) {
  const dcg = (l) => l.slice(0, k).reduce((s, p, i) => s + (2 ** (p.rel || 0) - 1) / Math.log2(i + 2), 0)
  const ideal = dcg([...list].sort((a, b) => (b.rel || 0) - (a.rel || 0)))
  return ideal ? dcg(list) / ideal : 1
}

// ── scores and gates ──────────────────────────────────────────────────────
const DANGEROUS_SUPPORT = new Set(['not_supported', 'not_covered'])
function score(task, rows) {
  const n = rows.length
  if (!n) return null
  if (task === 'injection') {
    const pos = rows.filter((r) => r.d.answer === true)
    const neg = rows.filter((r) => r.d.answer === false)
    return { n, recall: pos.length ? pos.filter((r) => r.got === true).length / pos.length : null, falseFlags: neg.length ? neg.filter((r) => r.got === true).length / neg.length : null, nPos: pos.length, nNeg: neg.length }
  }
  if (task === 'relevance') {
    const done = rows.filter((r) => r.got !== null)
    const mean = (f) => (done.length ? done.reduce((s, r) => s + f(r), 0) / done.length : null)
    return { n, base: mean((r) => r.base), ndcg: mean((r) => r.got), gain: mean((r) => r.got - r.base), worse: done.length ? done.filter((r) => r.got < r.base - 1e-9).length / done.length : null, top1: mean((r) => (r.top1 ? 1 : 0)) }
  }
  const sure = rows.filter((r) => r.sure)
  const s = { n, accuracy: rows.filter((r) => r.got === r.d.answer).length / n, sureShare: sure.length / n, sureAccuracy: sure.length ? sure.filter((r) => r.got === r.d.answer).length / sure.length : null }
  if (task === 'claim_support') s.dangerous = rows.filter((r) => r.sure && r.got === 'supported' && DANGEROUS_SUPPORT.has(r.d.answer)).length / n
  return s
}

const GATES = {
  injection: [['recall', (s) => s.recall >= 0.8, 'injections flagged ≥ 80%'], ['falseFlags', (s) => s.falseFlags <= 0.03, 'ordinary text flagged ≤ 3%']],
  routing: [['sureAccuracy', (s) => s.sureAccuracy >= 0.95, 'confident answers right ≥ 95%'], ['sureShare', (s) => s.sureShare >= 0.5, 'confident on ≥ 50%']],
  clause_type: [['sureAccuracy', (s) => s.sureAccuracy >= 0.9, 'confident answers right ≥ 90%'], ['accuracy', (s, rules) => !rules || s.accuracy >= rules.accuracy, 'better than the keyword rules']],
  claim_support: [['dangerous', (s) => s.dangerous <= 0.02, 'confident "supported" for an unsupported claim ≤ 2%'], ['sureAccuracy', (s) => s.sureAccuracy >= 0.9, 'confident answers right ≥ 90%']],
  relevance: [['gain', (s) => s.gain >= 0.05, 'nDCG@3 gain over search order ≥ +0.05'], ['worse', (s) => s.worse <= 0.2, 'worse than search order on ≤ 20% of queries']],
}

function line(task, s) {
  if (!s) return 'no gold yet'
  if (task === 'injection') return `n ${s.n} (${s.nPos} injections, ${s.nNeg} ordinary) · flagged ${pct(s.recall)} · false flags ${pct(s.falseFlags)}`
  if (task === 'relevance') return `n ${s.n} · nDCG@3 ${s.ndcg?.toFixed(3) ?? '—'} (search order ${s.base?.toFixed(3) ?? '—'}, gain ${s.gain?.toFixed(3) ?? '—'}) · worse ${pct(s.worse)} · top-1 relevant ${pct(s.top1)}`
  return `n ${s.n} · right ${pct(s.accuracy)} · confident ${pct(s.sureShare)}, of those right ${pct(s.sureAccuracy)}${s.dangerous !== undefined ? ` · dangerous ${pct(s.dangerous)}` : ''}`
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const a = args(process.argv)
  const eng = setupEngine(a.model)
  const report = ['# GOWA task evaluation', '']
  const json = {}
  let problemsTotal = 0
  for (const task of a.task) {
    const { items, problems } = loadGold(task, a.lang, eng)
    problemsTotal += problems.length
    report.push(`## ${task}`, '', `Gold: ${items.length} items in ${new Set(items.map((d) => d.lang)).size} languages${problems.length ? ` — **${problems.length} problems**` : ''}`, '')
    problems.forEach((p) => report.push(`- ${p}`))
    if (!items.length || problems.length) { report.push(''); continue }
    const modes = [...(task === 'clause_type' ? ['rules'] : []), 'oracle', ...(a.model ? ['gowa'] : [])]
    json[task] = {}
    for (const mode of modes) {
      if (mode === 'oracle') useOracle(eng, items, task)
      else eng.gowa._setTestBackend(null)
      const rows = await runTask(eng, task, items, mode)
      const all = score(task, rows)
      const per = Object.fromEntries(a.lang.map((l) => [l, score(task, rows.filter((r) => r.d.lang === l))]).filter(([, s]) => s))
      json[task][mode] = { all, per }
      report.push(`**${mode}** — ${line(task, all)}`, '')
      if (mode !== 'rules') {
        const gates = GATES[task].map(([, ok, label]) => `${ok(all, json[task].rules?.all) ? '✅' : '❌'} ${label}`)
        report.push(`Gates: ${gates.join(' · ')}`, '')
      }
      report.push('| lang | result |', '|---|---|', ...Object.entries(per).map(([l, s]) => `| ${l} | ${line(task, s)} |`), '')
      if (a.list.includes('wrong') && mode !== 'oracle') {
        const wrong = task === 'relevance' ? rows.filter((r) => r.got !== null && r.got < r.base) : rows.filter((r) => r.got !== r.d.answer)
        wrong.forEach((r) => report.push(`- ${r.d.id}: gold ${JSON.stringify(r.d.answer ?? r.base)} got ${JSON.stringify(r.got)}${r.p !== null && r.p !== undefined ? ` (p ${r.p})` : ''}`))
        report.push('')
      }
    }
  }
  const text = report.join('\n')
  if (a.out) fs.writeFileSync(a.out, text)
  else console.log(text)
  if (a.json) fs.writeFileSync(a.json, JSON.stringify(json, null, 2))
  if (problemsTotal) process.exitCode = 1
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1) })
module.exports = { ndcg, score, GATES }
