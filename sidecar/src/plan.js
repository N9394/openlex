"use strict"
/**
 * Planner with plan approval (Phase 7.3).
 *
 *   propose(goal)  → the model drafts a plan from the capabilities OpenLex
 *                    already has; nothing runs yet.
 *   update(plan)   → the lawyer edits steps (remove, reorder, change args).
 *   approve + run  → steps run in dependency order; independent steps run
 *                    side by side on hosted models (one at a time locally);
 *                    "checkpoint" steps pause the run until the lawyer
 *                    decides (continue / stop) — judgment stays human.
 *   report         → a Markdown report of every step's result in the
 *                    matter folder.
 *
 * Step kinds (each maps to an existing, tested capability):
 *   review      { playbook? }                    whole-matter checklist review
 *   chronology  {}                               dated events across the matter
 *   grid        { title, columns: [...] }        review grid (grid.js)
 *   translate   { file, target, glossary? }      document translation
 *   compare     { fileA, fileB }                 version comparison
 *   research    { question, skill? }             agent answer (law search etc.)
 *   skill       { skill, file, instruction? }    a skill run on one document
 *   checkpoint  { question }                     the lawyer decides before later steps run
 *
 * Plans live in <data dir>/plans/<id>.json. Model calls run under the
 * matter's data policy like every other call.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const wf = require('./workflows')

const PLAN_DIR = path.join(DATA_DIR, 'plans')
const KINDS = ['review', 'chronology', 'grid', 'translate', 'compare', 'research', 'skill', 'checkpoint']
const MAX_STEPS = 12

// ── storage ──────────────────────────────────────────────────────────────
const file = (id) => path.join(PLAN_DIR, `${String(id).replace(/[^\w-]/g, '')}.json`)
function save(plan) {
  fs.mkdirSync(PLAN_DIR, { recursive: true })
  plan.updatedAt = new Date().toISOString()
  fs.writeFileSync(file(plan.id) + '.tmp', JSON.stringify(plan, null, 1))
  fs.renameSync(file(plan.id) + '.tmp', file(plan.id))
  return plan
}
function get(id) {
  try { return JSON.parse(fs.readFileSync(file(id), 'utf8')) } catch { throw new Error(`no plan "${id}"`) }
}
function list(matterId) {
  let names = []
  try { names = fs.readdirSync(PLAN_DIR).filter((f) => f.endsWith('.json')) } catch { return [] }
  return names.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(PLAN_DIR, f), 'utf8')) } catch { return null } })
    .filter((p) => p && (matterId === undefined || (p.matterId || null) === (matterId || null)))
    .map((p) => ({ id: p.id, goal: p.goal, status: p.status, steps: p.steps.length, updatedAt: p.updatedAt }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

// ── validation ───────────────────────────────────────────────────────────
/** Clean model- or lawyer-written steps. Unknown kinds and broken references are dropped with a note. */
function cleanSteps(raw, { documents = [] } = {}) {
  const notes = []
  const steps = []
  const ids = new Set()
  const docByName = (f) => {
    if (!f) return null
    const s = String(f)
    if (path.isAbsolute(s)) return s
    return documents.find((d) => path.basename(d) === s) || documents.find((d) => path.basename(d).toLowerCase().includes(s.toLowerCase())) || null
  }
  for (const [i, r] of (Array.isArray(raw) ? raw : []).entries()) {
    if (steps.length >= MAX_STEPS) { notes.push(`only the first ${MAX_STEPS} steps were kept`); break }
    const kind = String(r?.kind || '').toLowerCase()
    if (!KINDS.includes(kind)) { notes.push(`step ${i + 1} dropped: unknown kind "${r?.kind}"`); continue }
    let id = String(r.id || `s${i + 1}`).replace(/[^\w-]/g, '').slice(0, 24) || `s${i + 1}`
    while (ids.has(id)) id += '_'
    const args = { ...(r.args || {}) }
    let problem = null
    if (kind === 'translate') { args.file = docByName(args.file); if (!args.file || !args.target) problem = 'needs a document from the matter and a target language' }
    if (kind === 'compare') { args.fileA = docByName(args.fileA); args.fileB = docByName(args.fileB); if (!args.fileA || !args.fileB || args.fileA === args.fileB) problem = 'needs two different documents from the matter' }
    if (kind === 'skill') { args.file = docByName(args.file); try { require('./skills').get(args.skill) } catch { problem = `unknown skill "${args.skill}"` } if (!problem && !args.file) problem = 'needs a document from the matter' }
    if (kind === 'research' && !String(args.question || '').trim()) problem = 'needs a question'
    // An optional skill on a research step must exist; an invented one is dropped, the step stays.
    if (kind === 'research' && args.skill) { try { require('./skills').get(args.skill) } catch { notes.push(`step ${i + 1}: unknown skill "${args.skill}" dropped, the research runs without it`); delete args.skill } }
    if (!problem && args.agent) { try { require('./agents').get(args.agent) } catch { problem = `unknown agent profile "${args.agent}"` } }
    if (kind === 'checkpoint' && !String(args.question || '').trim()) problem = 'needs a question for the lawyer'
    if (kind === 'grid') { try { require('./grid').cleanColumns(args.columns || []); if (!(args.columns || []).length) problem = 'needs columns' } catch (err) { problem = err.message } }
    if (kind === 'review' && args.playbook) { try { wf.loadPlaybook(args.playbook) } catch { problem = `unknown playbook "${args.playbook}"` } }
    if (problem) { notes.push(`step ${i + 1} (${kind}) dropped: ${problem}`); continue }
    ids.add(id)
    steps.push({ id, kind, title: String(r.title || kind).slice(0, 120), args, dependsOn: (Array.isArray(r.dependsOn) ? r.dependsOn : []).map(String), status: 'pending' })
  }
  // References only to earlier, kept steps (keeps the graph acyclic).
  const seen = new Set()
  for (const s of steps) {
    const bad = s.dependsOn.filter((d) => !seen.has(d))
    if (bad.length) { s.dependsOn = s.dependsOn.filter((d) => seen.has(d)); notes.push(`step "${s.id}": dropped dependency on ${bad.join(', ')} (unknown or later step)`) }
    seen.add(s.id)
  }
  // Steps after a checkpoint wait for it, even if the model forgot to say so.
  let lastCheckpoint = null
  for (const s of steps) {
    if (lastCheckpoint && !s.dependsOn.includes(lastCheckpoint)) s.dependsOn.push(lastCheckpoint)
    if (s.kind === 'checkpoint') lastCheckpoint = s.id
  }
  return { steps, notes }
}

// ── propose ──────────────────────────────────────────────────────────────
function capabilities({ documents, playbooks, skills }) {
  return `CAPABILITIES (the only step kinds you may use):
- review {"playbook": one of [${playbooks.join(', ')}] or omit for the default}: checklist review of EVERY document in the matter.
- chronology {}: dated events across all documents.
- grid {"title": "...", "columns": [{"label": "...", "prompt": "question per document", "type": "text|yesno|choice|date|number", "options": [...] (choice only)}]}: a table, one row per document, one column per question.
- translate {"file": "<document name>", "target": "en|de|fr|…"}: translate one document.
- compare {"fileA": "<older>", "fileB": "<newer>"}: compare two versions.
- research {"question": "...", "skill": optional skill name}: answer a legal question with law search.
- skill {"skill": one of [${skills.join(', ')}], "file": "<document name>", "instruction": "..."}: run a firm skill on one document.
- checkpoint {"question": "..."}: STOP and ask the lawyer to decide before the next steps (use before anything that depends on a judgment call).

DOCUMENTS IN THE MATTER (${documents.length}): ${documents.slice(0, 60).map((d) => path.basename(d)).join(', ') || 'none'}`
}

async function propose({ goal, matterId = null, documents } = {}) {
  if (!String(goal || '').trim()) throw new Error('describe the goal')
  const docs = documents?.length ? documents.map((d) => path.resolve(String(d))) : wf.listDocs(wf.matterFolders(matterId))
  const playbooks = ['', ...wf.bundledPlaybooks()].filter(Boolean)
  const skillNames = require('./skills').list().filter((s) => !s.error).map((s) => s.name)
  const items = await wf.askJson([
    { role: 'system', content: 'You plan legal work for a lawyer as a short sequence of steps using ONLY the listed capabilities. Prefer few, high-value steps. Put a checkpoint before any step that depends on the lawyer\'s judgment. Never invent documents.' },
    { role: 'user', content: `GOAL: ${String(goal).slice(0, 2000)}\n\n${capabilities({ documents: docs, playbooks, skills: skillNames })}\n\nReply with JSON only: [{"id": "s1", "kind": "<kind>", "title": "<what this step achieves, one line>", "args": {…}, "dependsOn": ["<earlier step id>", …]}]` },
  ], 2500, 'plan')
  const { steps, notes } = cleanSteps(items, { documents: docs })
  if (!steps.length) throw new Error(`the model proposed no usable steps${notes.length ? ` (${notes.join('; ')})` : ''}`)
  return save({ id: crypto.randomBytes(6).toString('hex'), matterId: matterId || null, goal: String(goal).slice(0, 2000), documents: docs, steps, notes, status: 'proposed', createdAt: new Date().toISOString() })
}

/** The lawyer's edits: replace steps (re-validated) and/or the goal. Only before the run starts. */
function update(id, { steps, goal } = {}) {
  const plan = get(id)
  if (!['proposed', 'approved'].includes(plan.status)) throw new Error(`plan is ${plan.status}; edit it before running`)
  if (goal !== undefined) plan.goal = String(goal).slice(0, 2000)
  if (steps !== undefined) {
    const r = cleanSteps(steps, { documents: plan.documents })
    if (!r.steps.length) throw new Error(`no usable steps (${r.notes.join('; ')})`)
    plan.steps = r.steps
    plan.notes = r.notes
  }
  plan.status = 'proposed'
  return save(plan)
}

// ── run ──────────────────────────────────────────────────────────────────
async function runStep(plan, step, { signal, onProgress }) {
  const a = step.args
  const progress = (ev) => onProgress?.({ step: step.id, ...ev })
  switch (step.kind) {
    case 'review': {
      const r = await wf.runReview({ matterId: plan.matterId, playbook: a.playbook, signal, onProgress: progress })
      return { summary: `${r.stats.verified} verified findings in ${r.stats.documents} documents (${r.stats.unverified} dropped without a verbatim quote)`, files: r.files }
    }
    case 'chronology': {
      const r = await wf.runChronology({ matterId: plan.matterId, signal, onProgress: progress })
      return { summary: `${r.events.length} dated events from ${r.stats.documents} documents`, files: r.files }
    }
    case 'translate': {
      const r = await require('./workflows_docs').runTranslate({ matterId: plan.matterId, file: a.file, target: a.target, glossary: a.glossary, signal, onProgress: progress })
      return { summary: `${r.stats.translated}/${r.stats.paragraphs} paragraphs translated, ${r.stats.flags} flagged`, files: r.files }
    }
    case 'compare': {
      const r = await require('./workflows_docs').runCompare({ matterId: plan.matterId, fileA: a.fileA, fileB: a.fileB, signal, onProgress: progress })
      return { summary: `${r.stats.changes} changes${r.stats.high ? `, ${r.stats.high} rated high` : ''}`, files: r.files }
    }
    case 'grid': {
      const grid = require('./grid')
      const g = grid.create({ matterId: plan.matterId, title: a.title || step.title, columns: a.columns, documents: plan.documents })
      const r = await grid.run(g.id, { signal, onProgress: progress })
      const out = grid.exportGrid(g.id)
      return { summary: `grid "${g.title}": ${r.stats.ok} verified cells of ${r.stats.cells}`, files: out.files, gridId: g.id }
    }
    case 'research':
    case 'skill': {
      const { runAction } = require('./agent')
      const { Document } = require('./doc')
      const skills = require('./skills')
      const text = step.kind === 'skill' ? String(await wf.readDoc(a.file)) : ''
      // Same context the chat route gives the agent (law search needs search + embeddings).
      const doc = new Document(text, `plan:${plan.id}:${step.id}`)
      const ctx = { doc, memory: null, session: null, search: require('./search'), embeddings: require('./embeddings'), summary: () => doc.summary() }
      const skill = a.skill ? skills.get(a.skill) : null
      const question = step.kind === 'skill' ? (a.instruction || `Apply the "${skill.title}" skill to ${path.basename(a.file)}.`) : a.question
      const agentsMod = require('./agents')
      const agent = a.agent ? agentsMod.get(a.agent) : (step.kind === 'research' ? agentsMod.get('researcher') : null)
      const r = await agentsMod.run(agent, () => runAction(ctx, question, (e) => { if (e.type === 'step') progress({ text: e.text }) }, { signal, skill, agent }))
      const ws = require('./workspace')
      const lines = [`# ${step.title}`, '', question, '', r.text || '']
      for (const s of r.suggestions || []) lines.push('', `- **[${s.severity}] ${s.summary}**`, s.anchor ? `  > ${String(s.anchor).replace(/\n/g, ' ')}` : '', s.proposed_text ? `  → ${s.proposed_text}` : '')
      const out = ws.writeFile(`${ws.matterFolder(wf.matterLabel(plan.matterId))}/plan-${plan.id}-${step.id}.md`, lines.join('\n'))
      return { summary: String(r.text || '').replace(/\s+/g, ' ').slice(0, 300) || `${(r.suggestions || []).length} suggestions`, files: [out] }
    }
    default:
      throw new Error(`cannot run step kind ${step.kind}`)
  }
}

/**
 * Run (or resume) an approved plan. Returns when every step is done, a
 * checkpoint is waiting for the lawyer, a step failed, or the run is aborted.
 */
async function run(id, { signal, onProgress } = {}) {
  let plan = get(id)
  if (plan.status === 'proposed') throw new Error('approve the plan before running it')
  if (['done', 'stopped'].includes(plan.status)) return plan
  plan.status = 'running'
  save(plan)
  const local = require('./llm').providerFor('extract').kind === 'local'
  const width = local ? 1 : 3
  const running = new Map()
  const doneOk = (s) => s.status === 'done'
  const ready = () => plan.steps.filter((s) => s.status === 'pending' && s.dependsOn.every((d) => doneOk(plan.steps.find((x) => x.id === d))))

  while (!signal?.aborted) {
    // A failed step or a step whose prerequisite failed/was skipped can't run: skip it.
    for (const s of plan.steps) {
      if (s.status === 'pending' && s.dependsOn.some((d) => ['failed', 'skipped'].includes(plan.steps.find((x) => x.id === d)?.status))) {
        s.status = 'skipped'; s.note = 'a step it depends on did not finish'
      }
    }
    const waiting = plan.steps.find((s) => s.kind === 'checkpoint' && s.status === 'waiting')
    for (const s of ready()) {
      if (running.size >= width) break
      if (s.kind === 'checkpoint') {
        if (running.size) break // let earlier work finish before asking the lawyer
        s.status = 'waiting'
        onProgress?.({ step: s.id, status: 'waiting', question: s.args.question })
        break
      }
      s.status = 'running'
      s.startedAt = new Date().toISOString()
      onProgress?.({ step: s.id, status: 'running', title: s.title })
      save(plan)
      running.set(s.id, runStep(plan, s, { signal, onProgress }).then(
        (r) => { Object.assign(s, { status: 'done', result: r, finishedAt: new Date().toISOString() }); onProgress?.({ step: s.id, status: 'done', summary: r.summary, files: r.files }) },
        (err) => { Object.assign(s, { status: 'failed', error: String(err.message || err).slice(0, 300), finishedAt: new Date().toISOString() }); onProgress?.({ step: s.id, status: 'failed', error: s.error }) },
      ).finally(() => { running.delete(s.id); save(plan) }))
    }
    if (!running.size) {
      if (waiting || plan.steps.some((s) => s.status === 'waiting')) { plan.status = 'waiting'; break }
      if (!ready().length) break
      continue
    }
    await Promise.race(running.values())
  }
  if (running.size) await Promise.allSettled(running.values())
  if (signal?.aborted) {
    for (const s of plan.steps) if (s.status === 'running') s.status = 'pending'
    plan.status = 'paused'
  } else if (plan.status !== 'waiting') {
    plan.status = plan.steps.some((s) => s.status === 'failed') ? 'failed' : 'done'
    plan.report = writeReport(plan)
  }
  return save(plan)
}

function approve(id) {
  const plan = get(id)
  if (plan.status !== 'proposed') throw new Error(`plan is already ${plan.status}`)
  plan.status = 'approved'
  plan.approvedAt = new Date().toISOString()
  return save(plan)
}

/** The lawyer's answer at a checkpoint: continue (with a note) or stop the plan. */
function decide(id, { stepId, decision, note = '' } = {}) {
  const plan = get(id)
  const s = plan.steps.find((x) => x.id === stepId && x.kind === 'checkpoint')
  if (!s || s.status !== 'waiting') throw new Error('no checkpoint waiting with that id')
  s.decision = { decision: decision === 'stop' ? 'stop' : 'continue', note: String(note).slice(0, 1000), at: new Date().toISOString() }
  if (decision === 'stop') {
    s.status = 'done'
    for (const x of plan.steps) if (x.status === 'pending') { x.status = 'skipped'; x.note = 'the lawyer stopped the plan at a checkpoint' }
    plan.status = 'stopped'
    plan.report = writeReport(plan)
  } else {
    s.status = 'done'
    s.result = { summary: `Lawyer: continue${note ? ` — ${note}` : ''}` }
    plan.status = 'approved'
  }
  return save(plan)
}

function writeReport(plan) {
  const ws = require('./workspace')
  const md = [`# Plan: ${plan.goal}`, '', `${new Date().toISOString().slice(0, 10)} · ${plan.steps.length} steps · status ${plan.status}`, '']
  for (const s of plan.steps) {
    md.push(`## ${s.title} (${s.kind}) — ${s.status}`)
    if (s.result?.summary && !s.decision) md.push('', s.result.summary)
    if (s.decision) md.push('', `Lawyer's decision: ${s.decision.decision}${s.decision.note ? ` — ${s.decision.note}` : ''}`)
    if (s.error) md.push('', `Error: ${s.error}`)
    if (s.note) md.push('', `Note: ${s.note}`)
    for (const f of s.result?.files || []) md.push(`- ${f}`)
    md.push('')
  }
  if (plan.notes?.length) md.push('## Planner notes', '', ...plan.notes.map((n) => `- ${n}`))
  return ws.writeFile(`${ws.matterFolder(wf.matterLabel(plan.matterId))}/plan-${plan.id}.md`, md.join('\n'))
}

module.exports = { propose, update, approve, run, decide, get, list, cleanSteps, KINDS, PLAN_DIR }
