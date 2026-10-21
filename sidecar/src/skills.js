"use strict"
/**
 * Skills (Phase 7.2) — reusable task instructions a firm can version like
 * playbooks. One skill = one SKILL.md (the open Agent Skills layout:
 * frontmatter + Markdown instructions):
 *
 *   ---
 *   name: nda-review
 *   title: NDA review
 *   description: Review a non-disclosure agreement for one side's risks.
 *   triggers: [nda, non-disclosure, confidentiality agreement, geheimhaltungsvereinbarung]
 *   tools: [search_law, get_clause_analysis]      # optional allow-list
 *   output: suggestions | text | file              # optional hint
 *   ---
 *   Instructions for the agent …
 *
 * Where: bundled starters in sidecar/skills/<name>/SKILL.md; the firm's own
 * in the workspace skills/<name>/SKILL.md (or skills/<name>.md). A firm
 * skill with the same name replaces the bundled one.
 *
 * Use: a message starting with "/<name>" runs the agent with that skill's
 * instructions in the system prompt (and its tool allow-list, if any).
 * Without one, suggest() proposes the best-matching skill (a "nudge"):
 * through the configured decision model when there is one (Phase 9, a
 * calibrated pick-one question), else by trigger/keyword overlap.
 */

const fs = require('fs')
const path = require('path')

const BUNDLED = path.join(__dirname, '..', 'skills')
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,47}$/
const MAX_BODY = 12000
// Tools a skill can never switch off: reading the document, notes, and
// writing the result. The agent loop needs them to function at all.
const ALWAYS_ALLOWED = ['get_tool_schemas', 'get_range_text', 'get_clause_analysis', 'remember', 'propose_suggestions']

// ── parsing ──────────────────────────────────────────────────────────────
function parseValue(v) {
  const t = v.trim()
  if (t.startsWith('[') && t.endsWith(']')) {
    // Inline list; items may be quoted to contain commas: [a, "b, c"].
    const items = []
    for (const m of t.slice(1, -1).matchAll(/\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,]*)\s*(?:,|$)/g)) {
      const raw = m[1].trim()
      if (!raw) continue
      items.push(raw.startsWith('"') ? JSON.parse(raw) : unquote(raw))
    }
    return items
  }
  return unquote(t)
}
const unquote = (s) => s.replace(/^["']|["']$/g, '')

/** SKILL.md text → { meta, body }. Frontmatter: `key: value`, `key: [a, b]` or a `- item` list. */
function parse(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: src.trim() }
  const meta = {}
  let listKey = null
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) { meta[listKey].push(unquote(item[1].trim())); continue }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const value = kv[2].replace(/\s+#.*$/, '')
    if (value === '') { meta[kv[1]] = []; listKey = kv[1] } else { meta[kv[1]] = parseValue(value); listKey = null }
  }
  return { meta, body: m[2].trim() }
}

function validate(meta, body, nameHint) {
  const name = String(meta.name || nameHint || '').trim().toLowerCase()
  if (!NAME_RE.test(name)) throw new Error(`skill name "${name}" must be 2–48 characters: lowercase letters, digits, dashes`)
  if (!String(meta.description || '').trim()) throw new Error(`skill "${name}" needs a description (it decides when the skill is suggested)`)
  if (!body.trim()) throw new Error(`skill "${name}" has no instructions`)
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).map((s) => s.trim()).filter(Boolean)
  return {
    name,
    title: String(meta.title || name).slice(0, 80),
    description: String(meta.description).slice(0, 400),
    triggers: list(meta.triggers).slice(0, 40),
    tools: list(meta.tools),
    output: ['suggestions', 'text', 'file'].includes(meta.output) ? meta.output : null,
    body: body.slice(0, MAX_BODY),
  }
}

/** Render a skill back to SKILL.md (used by the builder and save()). */
function render(s) {
  const arr = (a) => `[${a.map((x) => (/[,\]#]/.test(x) ? JSON.stringify(x) : x)).join(', ')}]`
  return ['---', `name: ${s.name}`, `title: ${s.title}`, `description: ${s.description}`,
    ...(s.triggers?.length ? [`triggers: ${arr(s.triggers)}`] : []),
    ...(s.tools?.length ? [`tools: ${arr(s.tools)}`] : []),
    ...(s.output ? [`output: ${s.output}`] : []),
    '---', '', s.body.trim(), ''].join('\n')
}

// ── storage ──────────────────────────────────────────────────────────────
function readDirSkills(dir, source) {
  const out = []
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const file = e.isDirectory() ? path.join(dir, e.name, 'SKILL.md') : (e.name.endsWith('.md') && e.name !== 'README.md' ? path.join(dir, e.name) : null)
    if (!file || !fs.existsSync(file)) continue
    try {
      const { meta, body } = parse(fs.readFileSync(file, 'utf8'))
      out.push({ ...validate(meta, body, e.isDirectory() ? e.name : e.name.replace(/\.md$/, '')), source, file })
    } catch (err) {
      out.push({ name: e.name.replace(/\.md$/, ''), source, file, error: err.message })
    }
  }
  return out
}

function firmDir() {
  const ws = require('./workspace')
  return ws.resolve('skills')
}

/** All skills (firm overrides bundled). Invalid files are listed with their error. */
function list() {
  const byName = new Map()
  for (const s of readDirSkills(BUNDLED, 'bundled')) byName.set(s.name, s)
  let firm = []
  try { firm = readDirSkills(firmDir(), 'firm') } catch { /* no workspace yet */ }
  for (const s of firm) byName.set(s.name, { ...s, ...(byName.has(s.name) && !s.error ? { overrides: 'bundled' } : {}) })
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function get(name) {
  const s = list().find((x) => x.name === String(name || '').toLowerCase())
  if (!s) throw new Error(`no skill "${name}"`)
  if (s.error) throw new Error(`skill "${name}" is invalid: ${s.error}`)
  return s
}

/** Save a firm skill from SKILL.md text (validated). */
function save(content) {
  const { meta, body } = parse(content)
  const s = validate(meta, body)
  const ws = require('./workspace')
  const file = ws.writeFile(`skills/${s.name}/SKILL.md`, render(s))
  return { ...s, source: 'firm', file }
}

/** Remove a firm skill (bundled ones can't be removed, only overridden). */
function remove(name) {
  const s = list().find((x) => x.name === name && x.source === 'firm')
  if (!s) throw new Error(`no firm skill "${name}" (bundled skills can only be overridden)`)
  fs.rmSync(path.basename(s.file) === 'SKILL.md' ? path.dirname(s.file) : s.file, { recursive: true, force: true })
}

// ── invocation ───────────────────────────────────────────────────────────
/** "/nda-review check clause 4" → { skill, message: "check clause 4" }; anything else → null. */
function parseInvocation(message) {
  const m = String(message || '').match(/^\s*\/([a-z0-9][a-z0-9-]{1,47})(?:\s+|$)([\s\S]*)$/)
  if (!m) return null
  const s = list().find((x) => x.name === m[1] && !x.error)
  return s ? { skill: s, message: m[2].trim() } : null
}

/** System-prompt block for an active skill. */
function promptBlock(skill) {
  return `\n\nACTIVE SKILL: ${skill.title}\nThe lawyer chose this firm skill. Follow its instructions for this task; they override general style preferences but never the RULES on sources, citations and verbatim anchors.\n${skill.body}\n`
}

/** Tool allow-list for an active skill (null = no restriction). */
function allowedTools(skill) {
  if (!skill?.tools?.length) return null
  return new Set([...skill.tools, ...ALWAYS_ALLOWED])
}

// ── suggestion ("nudge") ─────────────────────────────────────────────────
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const STOP = new Set('the a an and or of to for in on with this that is are be please can you me my our review check draft make write und der die das ein eine fur mit bitte prufe den dem des zu von im'.split(' '))
const words = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w))

/** Keyword score in [0, 1]: a trigger phrase in the message counts most; description words a little. */
function keywordScore(skill, message) {
  const msg = fold(message)
  const msgWords = new Set(words(message))
  let score = 0
  for (const t of skill.triggers || []) if (t && msg.includes(fold(t))) score = Math.max(score, 0.6 + Math.min(0.3, fold(t).length / 60))
  const desc = words(`${skill.title} ${skill.description}`)
  if (desc.length) score += 0.3 * (desc.filter((w) => msgWords.has(w)).length / Math.min(desc.length, 6))
  return Math.min(1, score)
}

/**
 * Best skill for a message, or null. { name, title, description, score, via }.
 * Uses the decision model (choice question) when one is configured and the
 * policy allows it; falls back to keywords on any failure.
 */
async function suggest(message, { useDecider = true, threshold = 0.6 } = {}) {
  const skills = list().filter((s) => !s.error)
  if (!skills.length || !String(message || '').trim()) return null
  const decide = require('./decide')
  if (useDecider && decide.loadConfig()) {
    try {
      const criteria = Object.fromEntries(skills.map((s) => [s.name, s.description]))
      criteria.none = 'None of these: a general question or a task no listed skill covers.'
      const r = await decide.systemOne({ state: message, questions: { skill: { type: 'choice', instructions: 'Which firm skill fits this request best?', criteria } } })
      const a = r.answers.skill || {}
      const p = a.probabilities?.[a.choice] ?? 0
      if (a.choice && a.choice !== 'none' && p >= threshold) {
        const s = skills.find((x) => x.name === a.choice)
        if (s) return { name: s.name, title: s.title, description: s.description, score: p, via: 'decider' }
      }
      if (a.choice) return null // the decider answered: trust its "none" / low confidence
    } catch { /* fall back to keywords */ }
  }
  let best = null
  for (const s of skills) {
    const score = keywordScore(s, message)
    if (!best || score > best.score) best = { name: s.name, title: s.title, description: s.description, score, via: 'keywords' }
  }
  return best && best.score >= threshold ? best : null
}

// ── builder ──────────────────────────────────────────────────────────────
/**
 * Draft a skill from a plain-language request (and optional example text,
 * e.g. a precedent). Returns SKILL.md text for the lawyer to review; never
 * saves on its own.
 */
async function draft({ request, examples = '', name } = {}) {
  if (!String(request || '').trim()) throw new Error('describe what the skill should do')
  const { chat } = require('./llm')
  const tools = Object.keys(require('./tools').TOOLS).join(', ')
  const reply = await chat([
    { role: 'system', content: 'You write reusable instructions ("skills") for a legal AI assistant used by a law firm. Be concrete and procedural: steps, what to check, what to output. Never invent statutes or case law; tell the assistant to search for authority instead.' },
    { role: 'user', content: `Write a SKILL.md for this request:\n"""${String(request).slice(0, 2000)}"""\n${examples ? `\nThe firm's own example to follow (style, structure, positions):\n"""${String(examples).slice(0, 6000)}"""\n` : ''}\nFormat exactly:\n---\nname: <lowercase-with-dashes>${name ? ` (use "${name}")` : ''}\ntitle: <short title>\ndescription: <one sentence: when to use this skill>\ntriggers: [<5–10 short phrases a lawyer might type, in the languages they would use>]\noutput: <suggestions | text | file>\n---\n<numbered instructions, 5–15 steps, plus an "Output" section>\n\nOnly use tools from this list if you name any: ${tools}.` },
  ], { maxTokens: 1800, temperature: 0.2, role: 'draft' })
  const text = String(reply).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?(?=---\n)/, '').replace(/```\w*\n?/g, '').trim()
  const { meta, body } = parse(text)
  if (name) meta.name = name
  const s = validate(meta, body) // throws with a clear message if the model's draft is unusable
  return { skill: s, content: render(s) }
}

module.exports = { parse, validate, render, list, get, save, remove, parseInvocation, promptBlock, allowedTools, suggest, keywordScore, draft, BUNDLED, ALWAYS_ALLOWED }
