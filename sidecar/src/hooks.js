"use strict"
/**
 * Hooks — firm rules at the harness's decision points.
 *
 *   "hooks": {
 *     "before_tool":   [{ "match": { "tool": ["web_fetch", "web_save"] }, "action": "deny", "reason": "No open-web research for this firm" }],
 *     "before_answer": [{ "match": { "notRegex": "§|Art\\.|Article|Section", "minChars": 400 }, "action": "warn", "message": "No legal citation in this answer." },
 *                       { "type": "decide", "question": "Does this answer give tax advice?", "threshold": 0.7, "action": "warn", "message": "Tax advice: route to the tax team." }],
 *     "on_suggestion": [{ "match": { "regex": "(?i)\\bguarantee" }, "action": "flag", "message": "Avoid 'guarantee' wording." }],
 *     "before_model":  [{ "match": { "role": "write", "local": false, "privileged": true }, "action": "deny" }],
 *     "before_web":    [{ "match": { "host": ["*.example-gossip.com"] }, "action": "deny" }],
 *     "after_workflow": [{ "type": "command", "command": "python3 /opt/firm/dms_upload.py", "timeoutMs": 30000 }]
 *   }
 *
 * Decision points (events) and what they carry:
 *   before_model    { role, provider, model, local, chars, matterId, privileged }  deny → that model is skipped
 *   before_tool     { tool, args, matterId }                                       deny → the agent is told the tool is blocked
 *   after_tool      { tool, args, ok, chars, matterId }                            observe (commands, audit)
 *   before_answer   { text, matterId }                                             warn → note appended; deny → answer withheld
 *   on_suggestion   { text (proposed_text), summary, severity, matterId }          flag → note on the card; deny → suggestion dropped
 *   before_web      { host, url, call, matterId }                                  deny → request refused
 *   after_workflow  { workflow, files, stats, matterId }                           observe (e.g. file outputs into the DMS)
 *
 * Hook types:
 *   rule (default)  match conditions → action: allow | deny | warn | flag
 *   command         runs a local program; the event is JSON on stdin; it may
 *                   print JSON {"decision": "allow|deny|warn|flag", "message": "…"}.
 *                   Exit code 2 = deny. Timeout (default 10 s) or failure →
 *                   `onError` (default allow; set "deny" to fail closed).
 *   decide          asks the decision model (Phase 9, System One yes/no) the
 *                   hook's question about the event text; p ≥ threshold →
 *                   action. Skipped when no decision model is configured.
 *
 * Match conditions (all given ones must match): tool, role, provider,
 * workflow, host (glob, "*." prefix), local, privileged, matters (ids),
 * regex / notRegex (on the event's text; "(?i)" prefix = case-insensitive),
 * minChars / maxChars.
 *
 * Hooks come from the firm and user layers of openlex.json (harness.js);
 * the firm can lock "hooks". Every deny/warn/flag is audited (event, hook
 * index, action), never the content. Commands receive content: they are
 * local programs the firm or user configured, nothing is sent anywhere by
 * OpenLex itself.
 */

const { spawn } = require('child_process')

const EVENTS = ['before_model', 'before_tool', 'after_tool', 'before_answer', 'on_suggestion', 'before_web', 'after_workflow']
const ACTIONS = ['allow', 'deny', 'warn', 'flag']
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

function regex(src) {
  const s = String(src)
  return s.startsWith('(?i)') ? new RegExp(s.slice(4), 'i') : new RegExp(s)
}
function glob(pattern, value) {
  const p = String(pattern).toLowerCase()
  const v = String(value || '').toLowerCase()
  if (p.startsWith('*.')) return v === p.slice(2) || v.endsWith(p.slice(1))
  return v === p
}

function matches(m = {}, ev) {
  if (m.tool !== undefined && !asList(m.tool).includes(ev.tool)) return false
  if (m.role !== undefined && !asList(m.role).includes(ev.role)) return false
  if (m.provider !== undefined && !asList(m.provider).includes(ev.provider)) return false
  if (m.workflow !== undefined && !asList(m.workflow).includes(ev.workflow)) return false
  if (m.host !== undefined && !asList(m.host).some((h) => glob(h, ev.host))) return false
  if (m.local !== undefined && !!m.local !== !!ev.local) return false
  if (m.privileged !== undefined && !!m.privileged !== !!ev.privileged) return false
  if (m.matters !== undefined && !asList(m.matters).includes(ev.matterId)) return false
  const text = String(ev.text ?? '')
  if (m.minChars !== undefined && text.length < Number(m.minChars)) return false
  if (m.maxChars !== undefined && text.length > Number(m.maxChars)) return false
  if (m.regex !== undefined && !regex(m.regex).test(text)) return false
  if (m.notRegex !== undefined && regex(m.notRegex).test(text)) return false
  return true
}

/** Validate a hooks section; returns problems (empty = fine). */
function validate(hooks = {}) {
  const problems = []
  for (const [event, list] of Object.entries(hooks || {})) {
    if (!EVENTS.includes(event)) { problems.push(`hooks: unknown event "${event}" (${EVENTS.join(', ')})`); continue }
    asList(list).forEach((h, i) => {
      const where = `hooks.${event}[${i}]`
      const type = h?.type || 'rule'
      if (!['rule', 'command', 'decide'].includes(type)) problems.push(`${where}: unknown type "${type}"`)
      if (type !== 'command' && h.action !== undefined && !ACTIONS.includes(h.action)) problems.push(`${where}: action must be one of ${ACTIONS.join(', ')}`)
      if (type === 'command' && !String(h.command || '').trim()) problems.push(`${where}: needs a command`)
      if (type === 'decide' && !String(h.question || '').trim()) problems.push(`${where}: needs a question`)
      for (const k of ['regex', 'notRegex']) if (h?.match?.[k] !== undefined) { try { regex(h.match[k]) } catch (err) { problems.push(`${where}.match.${k}: ${err.message}`) } }
    })
  }
  return problems
}

function runCommand(h, ev) {
  return new Promise((resolve) => {
    const timeoutMs = Math.min(120000, Number(h.timeoutMs) || 10000)
    let out = ''
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }
    let child
    try {
      child = spawn(String(h.command), { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, OPENLEX_HOOK_EVENT: ev.event } })
    } catch (err) { return done({ error: err.message }) }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } done({ error: `timed out after ${timeoutMs} ms` }) }, timeoutMs)
    child.stdout.on('data', (c) => { if (out.length < 100000) out += c })
    child.on('error', (err) => { clearTimeout(timer); done({ error: err.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      let parsed = null
      try { parsed = out.trim() ? JSON.parse(out.trim().split('\n').pop()) : null } catch { /* plain output = no decision */ }
      if (code === 2) return done({ decision: 'deny', message: parsed?.message || out.trim().slice(0, 300) || 'denied by hook command' })
      if (code !== 0) return done({ error: `exit code ${code}` })
      done({ decision: parsed?.decision || 'allow', message: parsed?.message || '' })
    })
    child.stdin.on('error', () => { /* program didn't read stdin */ })
    child.stdin.end(JSON.stringify(ev))
  })
}

async function runDecide(h, ev) {
  const decide = require('./decide')
  if (!decide.loadConfig()) return { skipped: 'no decision model configured' }
  const r = await decide.systemOne({ state: String(ev.text || ev.tool || ev.host || ev.workflow || ''), questions: { q: { type: 'noul', instructions: String(h.question) } } })
  const p = Number(r.answers.q?.noul)
  return p >= (Number(h.threshold) || 0.5) ? { decision: h.action || 'warn', message: h.message || h.question, p } : { decision: 'allow', p }
}

/**
 * Run the hooks for one event.
 * @returns {Promise<{ decision: 'allow'|'deny', reason?: string, warnings: string[], flags: string[] }>}
 */
async function run(event, payload = {}) {
  const out = { decision: 'allow', warnings: [], flags: [] }
  let list
  try { list = asList(require('./harness').load().hooks?.[event]) } catch { return out }
  if (!list.length) return out
  const ev = { event, ...payload }
  const policy = require('./policy')
  for (const [i, h] of list.entries()) {
    if (!h || typeof h !== 'object') continue
    const type = h.type || 'rule'
    let res
    try {
      if (h.match && !matches(h.match, ev)) continue
      if (type === 'command') res = await runCommand(h, ev)
      else if (type === 'decide') res = await runDecide(h, ev)
      else res = { decision: h.action || 'deny', message: h.message || h.reason || '' }
    } catch (err) {
      res = { error: err.message }
    }
    if (res.skipped) continue
    if (res.error) res = { decision: h.onError === 'deny' ? 'deny' : 'allow', message: `hook ${event}[${i}] failed: ${res.error}` }
    const decision = ACTIONS.includes(res.decision) ? res.decision : 'allow'
    if (decision !== 'allow') policy.audit({ provider: 'hook', model: null, matter: payload.matterId ?? policy.currentMatter(), call: event, decision: decision === 'deny' ? 'blocked' : decision, hook: i, ...(type !== 'rule' ? { type } : {}) })
    if (decision === 'deny') return { ...out, decision: 'deny', reason: res.message || h.reason || `blocked by firm rule (${event} #${i + 1})` }
    if (decision === 'warn' && res.message) out.warnings.push(res.message)
    if (decision === 'flag' && res.message) out.flags.push(res.message)
  }
  return out
}

/** Are any hooks configured for this event? (Cheap check before building payloads.) */
function has(event) {
  try { return asList(require('./harness').load().hooks?.[event]).length > 0 } catch { return false }
}

module.exports = { run, has, validate, matches, EVENTS, ACTIONS }
