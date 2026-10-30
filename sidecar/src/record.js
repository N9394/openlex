"use strict"
/**
 * The AI record — what the AI did, in plain words, for a lawyer to show a
 * client, a data protection officer or a bar auditor. Never any client
 * content: no document text, no prompts, no answers, no search words.
 *
 * Built from two local logs, merged newest first:
 *   the activity log  ~/.lexvault/activity/<matter>.jsonl (activity.js): one
 *                     line per request — when, which window, the request's
 *                     short title, result, files written, how long
 *   the audit log     ~/.lexvault/audit/llm-calls.jsonl (policy.audit): one
 *                     line per AI call, online lookup, connector call and
 *                     permission decision (metadata only)
 * The audit lines of a request are grouped under it (by its `rid`, else by
 * matter and time); the rest stand on their own (e.g. a law-update check).
 *
 * Both logs are chained (chain.js); verify() checks every chain. Export
 * writes a PDF, CSV or Markdown file with an explanation page, the summary,
 * the entries and the check result. Retention (keep N months; default:
 * keep everything) removes old lines with a marker, never silently.
 *
 *   list({ matterId, from, to, left, service, kind, limit, cursor })
 *       → { entries, summary, total, nextCursor }
 *   verify()                       → { ok, text, files[], fingerprint }
 *   exportRecord({ matterId, from, to, format, titles })  → { file, format }
 *   settings() / setSettings({ keepMonths })  ·  applyRetention()
 *   handle(method, path, params, body)   the local API routes (server.js)
 */

const fs = require('fs')
const path = require('path')
const chain = require('./chain')
const { DATA_DIR } = require('./config')
const { serviceName, explainTool, duration, LAW_SOURCES } = require('./explain')

const AUDIT_PATH = () => require('./policy').AUDIT_PATH
const ACTIVITY_DIR = () => require('./activity').DIR
const SETTINGS_PATH = path.join(DATA_DIR, 'record.json')
const GRACE_MS = 3000

// ── words ────────────────────────────────────────────────────────────────
const WINDOWS = { word: 'Word', outlook: 'Outlook', tui: 'Terminal app', cli: 'Command line', desktop: 'Desktop app', app: 'Desktop app', local: 'Another program on this computer' }
const KIND_WORDS = { panel: 'Panel', question: 'Question', review: 'Checklist review', chronology: 'Chronology', translate: 'Translation', compare: 'Comparison', grid: 'Review grid', plan: 'Plan', analyse: 'Analysis' }
const ACTIONS = {
  write_file: 'save a file', append_file: 'add to a file', delete_file: 'delete a file', rename_file: 'rename a file',
  read_file: 'read a file', list_directory: 'look into a folder', search_local_files: 'search files', search_docs: 'search the matter\'s documents',
  run_bash: 'run a program', web_fetch: 'open a web page', web_save: 'save a web page', download_to_matter: 'download a file',
  export_document: 'save a file', sync_calendar: 'put deadlines into a calendar', search_ris: 'look up Austrian law online', search_eurlex: 'look up EU law online', get_eu_law: 'read EU law online',
  search_law_sources: 'look up the law online', get_law_source: 'read a law text online',
}
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`
const actionOf = (tool) => ACTIONS[tool] || (/^mcp[:_]/.test(String(tool)) ? 'use a connector' : 'use a tool')

function decidedBy(by) {
  const b = String(by || '')
  if (b === 'lawyer') return 'you'
  if (b === 'timeout') return 'nobody answered in time'
  if (b === 'disconnect') return 'the window was closed'
  if (b === 'session') return 'allowed for this run'
  if (b === 'non-interactive') return 'nobody could be asked'
  if (b === 'sandbox') return 'never allowed (outside the allowed folders)'
  if (b === 'default') return 'the standard setting'
  if (b === 'rule:firm') return 'your firm\'s rule'
  if (b === 'rule:matter') return 'this matter\'s rule'
  if (b.startsWith('rule:')) return 'your saved rule'
  return b ? clip(b, 30) : 'a rule'
}

/** Provider id → { local, service } for an audit line. */
function serviceOf(e) {
  let local = e.provider === 'local'
  try { const p = require('./providers/catalog').PROVIDERS[e.provider]; if (p) local = !!p.local } catch { /* no catalog */ }
  if (e.provider === 'decide') local = /^(localhost|127\.|::1|\[::1\])/.test(String(e.host || ''))
  const service = e.provider === 'decide' ? `the decision service${local ? ' on this computer' : ''}` : serviceName({ provider: e.provider, model: e.model, region: e.region, local })
  return { local, service: local ? 'the AI on this computer' : service }
}

// ── reading the logs ─────────────────────────────────────────────────────
function readJsonl(file) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    try {
      const { prev, h, ...e } = JSON.parse(raw)
      if (e.chain) continue // chain markers are not entries
      out.push(e)
    } catch { /* an unreadable line: verify() reports it */ }
  }
  return out
}

function activityFiles() {
  try { return fs.readdirSync(ACTIVITY_DIR()).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(ACTIVITY_DIR(), f)) } catch { return [] }
}

function matterTitle(id) {
  if (!id) return ''
  try { return require('./matters').get(id)?.title || '' } catch { return '' }
}

/** Requests from the activity logs (one matter, or all). */
function loadRequests(matterId) {
  const files = matterId ? [require('./activity').fileFor(matterId)] : activityFiles()
  const out = []
  for (const f of files) {
    const fromName = path.basename(f, '.jsonl')
    for (const r of readJsonl(f)) out.push({ ...r, matter: r.matter || (fromName === 'none' ? null : matterId || fromName) })
  }
  return out
}

function loadAudit(matterId) {
  const all = readJsonl(AUDIT_PATH())
  return matterId ? all.filter((e) => e.matter === matterId) : all
}

// ── turning log lines into entries ───────────────────────────────────────
/** What one audit line adds to an entry. */
function absorb(acc, e) {
  if (e.provider === 'permissions') {
    if (e.by === 'default' && e.decision === 'allowed') { acc.routine++; return }
    acc.permissions.push({ what: actionOf(e.call), decision: e.decision === 'blocked' ? 'denied' : 'allowed', by: decidedBy(e.by), asked: ['lawyer', 'timeout', 'disconnect'].includes(e.by) })
    return
  }
  if (e.provider === 'hook') {
    acc.permissions.push({ what: `go on (${clip(e.call, 30)})`, decision: e.decision === 'blocked' ? 'denied' : e.decision, by: 'your firm\'s rule', asked: false })
    return
  }
  if (e.provider === 'mcp-server') { acc.lookups.push({ name: `another program used OpenLex (${clip(e.model, 40)})`, local: true, count: 1 }); return }
  // Law sources (connectors/): the policy check ("web" or the gateway) and
  // the call itself are audited; the call counts as the lookup.
  const lawId = e.call === 'law_source' ? String(e.provider).slice(7) : e.provider === 'web' && /^source:/.test(String(e.call)) ? String(e.call).slice(7) : null
  if (lawId && LAW_SOURCES[lawId]) {
    const name = LAW_SOURCES[lawId]
    if (e.decision === 'blocked') { acc.blocked.push({ what: name, why: 'your client-data rule does not allow it' }); return }
    if (e.call !== 'law_source' || e.ok === undefined) return
    const hit = acc.lookups.find((x) => x.name === name)
    if (hit) hit.count++
    else acc.lookups.push({ name, local: false, count: 1 })
    return
  }
  const isWeb = e.provider === 'web'
  const isSource = String(e.provider).startsWith('source:')
  const isConnector = String(e.provider).startsWith('mcp:')
  if (isWeb || isSource || isConnector) {
    const name = isWeb ? clip(explainTool(e.call, { host: e.model }).online || e.model || 'a website', 60) : isSource ? `your firm's database “${clip(String(e.provider).slice(7), 30)}”` : `your connector “${clip(String(e.provider).slice(4), 30)}”`
    if (e.decision === 'blocked') { acc.blocked.push({ what: name, why: 'your client-data rule does not allow it' }); return }
    const hit = acc.lookups.find((x) => x.name === name)
    if (hit) hit.count++
    else acc.lookups.push({ name, local: false, count: 1 })
    return
  }
  // An AI call.
  const { local, service } = serviceOf(e)
  if (e.decision === 'blocked') { acc.blocked.push({ what: service, why: /region/i.test(e.reason || '') ? 'outside the approved regions' : 'your client-data rule does not allow it' }); return }
  const hidden = 'redacted' in e
  const key = `${local ? 'local' : e.provider}|${e.region || ''}|${hidden ? 1 : 0}`
  let s = acc.ai.find((x) => x.key === key)
  if (!s) { s = { key, provider: local ? 'local' : e.provider, service, local, region: local ? null : (e.region || null), namesHidden: hidden, calls: 0, failed: 0 }; acc.ai.push(s) }
  s.calls++
  if (e.ok === false) s.failed++
}

const emptyAcc = () => ({ ai: [], lookups: [], permissions: [], blocked: [], routine: 0 })

/** Sentences for the detail view, the same in every front end and export. */
function detailLines(x) {
  const lines = []
  if (x.window) lines.push(`Asked in: ${x.window}`)
  if (x.matter) lines.push(`Matter: ${x.matter}`)
  if (x.documents) lines.push(`Documents given: ${x.documents}`)
  if (x.panel) {
    const p = x.panel
    const svc = (list) => (list || []).map((s) => `${s.label} (${plural(s.calls, 'call')})`).join(', ') || 'no AI call'
    lines.push(`Panel: ${{ parallel: 'agents side by side', debate: `a debate, ${plural(p.rounds, 'round')}`, review: 'draft and review' }[p.mode] || p.mode}`)
    for (const a of p.agents || []) lines.push(`Agent ${a.title}: ${a.skipped ? 'did not take part (not allowed for this matter)' : svc(a.services)}`)
    if (p.moderator) lines.push(`Moderator ${p.moderator.title}: ${svc(p.moderator.services)}`)
  }
  for (const s of x.ai) {
    lines.push(s.local
      ? `AI: on this computer · ${plural(s.calls, 'call')}${s.failed ? ` (${s.failed} failed)` : ''}`
      : `AI: ${s.service} — sent outside this computer, ${s.namesHidden ? 'names hidden' : 'names not hidden'} · ${plural(s.calls, 'call')}${s.failed ? ` (${s.failed} failed)` : ''}`)
  }
  if (!x.ai.length && x.type === 'request') lines.push('AI: no AI call recorded')
  const online = x.lookups.filter((l) => !l.local)
  if (online.length) lines.push(`Looked up online: ${online.map((l) => `${l.name}${l.count > 1 ? ` (${l.count}×)` : ''}`).join(', ')} — only search words or a web address were sent`)
  for (const l of x.lookups.filter((y) => y.local)) lines.push(clip(l.name, 80))
  for (const p of x.permissions) lines.push(`Permission to ${p.what}: ${p.decision} — ${p.decision === 'allowed' || p.decision === 'denied' ? `decided by ${p.by}` : p.by}`)
  if (x.routine) lines.push(`${plural(x.routine, 'routine step')} allowed by the standard settings (reading, searching)`)
  for (const b of x.blocked) lines.push(`Not sent to ${b.what}: ${b.why}`)
  if (x.result) lines.push(`Result: ${x.result}`)
  if (x.ms) lines.push(`Took ${duration(x.ms)}`)
  return lines
}

function resultText(r) {
  if (r.result === 'failed') return 'Did not finish (an error)'
  if (r.result === 'stopped') return 'Stopped by the user (what was done so far was kept)'
  const parts = [r.kind === 'question' ? 'Answered' : 'Done']
  if (r.suggestions) parts.push(plural(r.suggestions, 'proposed change'))
  if (r.saved?.length) parts.push(`saved ${r.saved.join(', ')}`)
  return parts.join(', ')
}

function finishEntry(x) {
  x.ai = x.ai.map(({ key, ...a }) => a)
  delete x.test
  x.left = x.ai.some((s) => !s.local) || x.lookups.some((l) => !l.local)
  x.calls = x.ai.reduce((n, s) => n + s.calls, 0)
  x.lines = detailLines(x)
  x.took = x.ms ? duration(x.ms) : ''
  return x
}

function requestEntry(r, lines) {
  const acc = emptyAcc()
  for (const e of lines) absorb(acc, e)
  // Older records have no audit lines linked to them: use the services the request reported.
  if (!acc.ai.length) {
    for (const d of r.data || []) {
      acc.ai.push({ key: `${d.provider}|${d.region || ''}|${d.redacted ? 1 : 0}`, provider: d.local ? 'local' : d.provider, service: d.local ? 'the AI on this computer' : serviceName(d), local: !!d.local, region: d.local ? null : (d.region || null), namesHidden: !!d.redacted, calls: d.calls || 1, failed: 0 })
    }
  }
  // Online lookups the request reported (host or database only — never the search words).
  for (const l of r.looked || []) {
    if (!l.tool) continue
    const on = explainTool(l.tool, { host: l.detail?.host, sources: l.detail?.sources, jurisdiction: l.detail?.jurisdiction }).online
    if (on && !acc.lookups.some((x) => x.name === on || (l.detail?.host && x.name === l.detail.host))) acc.lookups.push({ name: on, local: false, count: 1 })
  }
  return finishEntry({
    id: r.rid || `a_${String(r.matter || 'none')}_${r.at}`,
    type: 'request',
    kind: r.kind || 'question',
    at: r.at,
    title: `${KIND_WORDS[r.kind] || 'Request'}${r.asked ? `: “${clip(r.asked, 120)}”` : ''}`,
    asked: r.asked ? clip(r.asked, 200) : '',
    window: WINDOWS[r.client] || (r.client ? clip(r.client, 20) : ''),
    matterId: r.matter || null,
    matter: matterTitle(r.matter),
    documents: (r.files || []).length,
    ...(r.panel ? { panel: r.panel } : {}),
    files: (r.saved || []).slice(0, 10),
    outcome: r.result || 'done',
    result: resultText(r),
    ms: r.ms || 0,
    ...acc,
  })
}

function standaloneTitle(e, acc) {
  if (e.provider === 'permissions') return `Permission: ${acc.permissions[0] ? `${acc.permissions[0].what} — ${acc.permissions[0].decision}` : 'routine step allowed'}`
  if (e.provider === 'hook') return 'Your firm\'s rule'
  if (e.provider === 'mcp-server') return 'Another program used OpenLex'
  if (e.call === 'monitor') return 'Check for law updates'
  if (e.call === 'test') return 'Test of the AI connection'
  if (e.call === 'law_source' || (e.provider === 'web' && /^source:/.test(String(e.call)))) return 'Looked up the law online'
  if (String(e.provider).startsWith('source:')) return 'Search in your firm\'s database'
  if (String(e.provider).startsWith('mcp:')) return 'Connector used'
  if (e.provider === 'web') return 'Looked up online'
  if (e.decision === 'blocked') return 'AI call stopped by your client-data rule'
  return 'AI used outside a question (for example a summary or a check)'
}

/** A law source's allowed policy check: the call that follows is the entry. */
const lawGateLine = (e) => e.decision === 'allowed' && ((e.provider === 'web' && /^source:/.test(String(e.call))) || (e.call === 'law_source' && e.ok === undefined))

/** Audit lines that belong to no request: one entry each, runs of the same thing folded. */
function standaloneEntries(lines) {
  const out = []
  let cur = null
  const sig = (e) => `${e.provider}|${e.matter || ''}|${e.call}|${e.decision}|${e.by || ''}|${e.region || ''}`
  for (const e of lines) {
    if (lawGateLine(e)) continue
    if (cur && cur.sig === sig(e) && Date.parse(e.ts) - Date.parse(cur.last) <= 10 * 60000) {
      absorb(cur.acc, e)
      cur.last = e.ts
      cur.n++
      continue
    }
    cur = { sig: sig(e), first: e, last: e.ts, n: 1, acc: emptyAcc() }
    absorb(cur.acc, e)
    out.push(cur)
  }
  return out.map((g) => {
    const e = g.first
    const ms = Math.max(0, Date.parse(g.last) - Date.parse(e.ts))
    return finishEntry({
      id: `l_${e.ts}_${e.provider}`,
      type: e.provider === 'permissions' || e.provider === 'hook' ? 'permission' : e.decision === 'blocked' ? 'blocked' : ['web', 'mcp-server'].includes(e.provider) || /^(source|mcp):/.test(e.provider) ? 'lookup' : 'call',
      kind: e.call || '',
      at: e.ts,
      title: `${standaloneTitle(e, g.acc)}${g.n > 1 ? ` (${g.n}×)` : ''}`,
      asked: '',
      window: WINDOWS[e.client] || '',
      matterId: e.matter || null,
      matter: matterTitle(e.matter),
      documents: 0,
      files: [],
      outcome: e.ok === false ? 'failed' : 'done',
      result: e.ok === false ? 'Did not work (an error)' : '',
      ms: e.ms && g.n === 1 ? e.ms : ms,
      ...g.acc,
    })
  })
}

/** All entries of a selection (before filters on `left`, service, kind), newest first. */
function build(matterId) {
  const requests = loadRequests(matterId).filter((r) => r.at).sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const audit = loadAudit(matterId).filter((e) => e.ts).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
  const byRid = new Map(requests.filter((r) => r.rid).map((r) => [r.rid, []]))
  const byIdx = requests.map(() => [])
  const spans = requests.map((r) => { const t = Date.parse(r.at); return { t0: t - 1000, t1: t + (r.ms || 0) + GRACE_MS, matter: r.matter || null } })
  const loose = []
  for (const e of audit) {
    if (e.rid && byRid.has(e.rid)) { byRid.get(e.rid).push(e); continue }
    // A request whose record is gone (retention) or still running; scheduled checks and outside programs never belong to one.
    if (e.rid || e.call === 'monitor' || e.call === 'mcp-serve') { loose.push(e); continue }
    // Older lines (no request id): the request of the same matter running at that time.
    const t = Date.parse(e.ts)
    let pick = -1
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i]
      if (s.t0 > t || requests[i].rid) continue
      if (t <= s.t1 && (s.matter || null) === (e.matter || null)) { pick = i; break }
      if (s.t1 < t - 6 * 3600000) break
    }
    if (pick >= 0) byIdx[pick].push(e)
    else loose.push(e)
  }
  const entries = requests.map((r, i) => requestEntry(r, [...(r.rid ? byRid.get(r.rid) || [] : []), ...byIdx[i]]))
  entries.push(...standaloneEntries(loose))
  // Newest first; entries of the same moment in the order they were written, reversed.
  return entries.map((x, i) => [x, i]).sort(([a, i], [b, j]) => String(b.at).localeCompare(String(a.at)) || j - i).map(([x]) => x)
}

// ── filters and summary ──────────────────────────────────────────────────
const localDay = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const DAY = /^\d{4}-\d{2}-\d{2}$/

function checkDay(v, name) {
  if (v === undefined || v === null || v === '') return null
  if (!DAY.test(String(v))) throw new Error(`${name} must be a date like 2026-10-29`)
  return String(v)
}

function matches(x, { from, to, left, service, kind }) {
  const d = localDay(x.at)
  if (from && d < from) return false
  if (to && d > to) return false
  if (left && !x.left) return false
  if (service) {
    const s = String(service).toLowerCase()
    const hit = x.ai.some((a) => a.provider === s || a.service.toLowerCase().includes(s)) || x.lookups.some((l) => (s === 'web' ? !l.local : l.name.toLowerCase().includes(s)))
    if (!hit) return false
  }
  if (kind && x.type !== kind && x.kind !== kind) return false
  return true
}

/** Counts for a selection, and the one line front ends show. */
function summarize(entries) {
  const services = new Map()
  const online = new Map()
  let aiCalls = 0
  let localCalls = 0
  let leftCalls = 0
  const perms = { asked: 0, allowed: 0, denied: 0 }
  let blocked = 0
  for (const x of entries) {
    const seen = new Set()
    for (const s of x.ai) {
      aiCalls += s.calls
      if (s.local) { localCalls += s.calls; continue }
      leftCalls += s.calls
      const k = s.service
      const g = services.get(k) || { service: s.service, provider: s.provider, region: s.region, entries: 0, calls: 0, hiddenCalls: 0 }
      g.calls += s.calls
      if (s.namesHidden) g.hiddenCalls += s.calls
      if (!seen.has(k)) { g.entries++; seen.add(k) }
      services.set(k, g)
    }
    for (const l of x.lookups.filter((y) => !y.local)) online.set(l.name, (online.get(l.name) || 0) + l.count)
    for (const p of x.permissions) {
      if (p.asked) perms.asked++
      if (p.decision === 'denied') perms.denied++
      else if (p.decision === 'allowed') perms.allowed++
    }
    blocked += x.blocked.length
  }
  const left = [...services.values()].map((g) => ({ ...g, namesHidden: g.hiddenCalls === g.calls ? 'all' : g.hiddenCalls ? 'some' : 'none' }))
  const lookups = [...online.values()].reduce((a, b) => a + b, 0)
  const s = {
    requests: entries.filter((x) => x.type === 'request').length,
    entries: entries.length,
    aiCalls,
    localCalls,
    left: { entries: entries.filter((x) => x.left).length, calls: leftCalls, services: left },
    online: { lookups, sources: [...online.keys()] },
    permissions: perms,
    blocked,
  }
  s.text = summaryText(s)
  return s
}

function summaryText(s) {
  const parts = [plural(s.requests, 'request')]
  for (const g of s.left.services) parts.push(`${g.entries} sent to ${g.service}${g.namesHidden === 'all' ? ', names hidden' : g.namesHidden === 'some' ? ', names hidden in some' : ', names not hidden'}`)
  if (!s.left.services.length) parts.push(s.aiCalls ? 'AI only on this computer' : 'no AI calls')
  if (s.online.lookups) parts.push(plural(s.online.lookups, 'online lookup'))
  if (s.permissions.denied) parts.push(`${plural(s.permissions.denied, 'permission')} denied`)
  else if (s.permissions.asked) parts.push(`${plural(s.permissions.asked, 'permission')} asked`)
  if (s.blocked) parts.push(`${s.blocked} stopped by the client-data rule`)
  return parts.join(' · ')
}

/**
 * The record for a selection.
 * @returns {{ entries, summary, total, nextCursor, filters }}
 */
function list({ matterId = null, from = null, to = null, left = false, service = null, kind = null, limit = 50, cursor = null } = {}) {
  const f = { from: checkDay(from, 'from'), to: checkDay(to, 'to'), left: left === true || left === '1' || left === 'true', service: service || null, kind: kind || null }
  const all = build(matterId || null).filter((x) => matches(x, f))
  const max = Math.max(1, Math.min(parseInt(limit, 10) || 50, 500))
  const offset = Math.max(0, parseInt(cursor, 10) || 0)
  const page = all.slice(offset, offset + max)
  return {
    matter: matterId ? { id: matterId, title: matterTitle(matterId) } : null,
    filters: { matterId: matterId || null, ...f },
    summary: summarize(all),
    total: all.length,
    entries: page,
    nextCursor: offset + max < all.length ? String(offset + max) : null,
  }
}

// ── verification ─────────────────────────────────────────────────────────
function chainFiles() {
  const files = []
  if (fs.existsSync(AUDIT_PATH())) files.push({ file: AUDIT_PATH(), name: 'Audit log (AI calls, online lookups, permissions)' })
  for (const f of activityFiles()) {
    const id = path.basename(f, '.jsonl')
    const t = id === 'none' ? 'quick questions (no matter)' : (matterTitle(id) || id)
    files.push({ file: f, name: `Requests: ${t}` })
  }
  return files
}

/** Seal what was written before the chain existed (once) — at startup. */
function sealAll() {
  for (const { file } of chainFiles()) {
    try { chain.seal(file) } catch (err) { console.warn('[record] seal failed:', path.basename(file), err.message) }
  }
}

/** Check every chain. → { ok, text, files: [{ name, ok, entries, broken, notes }], fingerprint } */
function verify() {
  const files = chainFiles().map(({ file, name }) => {
    const v = chain.verify(file)
    return { name, file: path.basename(file), ok: v.ok, entries: v.entries + v.sealedBefore + v.unsealed, head: v.head, broken: v.broken, notes: v.notes }
  })
  const bad = files.filter((f) => !f.ok)
  const fingerprint = chain.sha(files.map((f) => `${f.file}:${f.head || '-'}:${f.entries}`).sort().join('\n')).slice(0, 32).replace(/(.{4})(?!$)/g, '$1 ')
  const text = bad.length
    ? `Record changed: ${bad.map((f) => `${f.name} — ${f.broken.why}`).join('; ')}`
    : files.length ? `Record intact: all ${plural(files.length, 'log')} checked, no line changed, removed or moved.` : 'Nothing recorded yet.'
  return { ok: !bad.length, text, checkedAt: new Date().toISOString(), files, fingerprint }
}

// ── retention ────────────────────────────────────────────────────────────
function settings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
    const n = parseInt(s.keepMonths, 10)
    return { keepMonths: n > 0 ? n : null }
  } catch { return { keepMonths: null } }
}

function setSettings({ keepMonths } = {}) {
  const n = keepMonths === null || keepMonths === undefined || keepMonths === '' || keepMonths === 'all' ? null : parseInt(keepMonths, 10)
  if (n !== null && !(n >= 1 && n <= 600)) throw new Error('keep the record for 1 to 600 months, or "all" (the default)')
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ keepMonths: n }, null, 2))
  return { keepMonths: n, applied: applyRetention() }
}

/** Remove entries older than the setting, each log with a marker. → [{ name, removed }] */
function applyRetention(now = new Date()) {
  const { keepMonths } = settings()
  if (!keepMonths) return []
  const cut = new Date(now)
  cut.setMonth(cut.getMonth() - keepMonths)
  const out = []
  for (const { file, name } of chainFiles()) {
    try {
      const removed = chain.prune(file, cut.toISOString(), now)
      if (removed) out.push({ name, removed })
    } catch (err) { out.push({ name, error: err.message }) }
  }
  return out
}

// ── export ───────────────────────────────────────────────────────────────
const EXPLAIN_TITLE = 'What this record shows and what it never contains'
const EXPLAIN = [
  ['Shows', 'Every request made to OpenLex: when, from which window (Word, the terminal app, the command line), the short title of what was asked, the result (answered, number of proposed changes, names of files saved) and how long it took.'],
  ['AI used', 'Which AI service handled each request and where it ran: on this computer, or an online service and its region. For online services: whether client names were hidden before sending.'],
  ['Online', 'What was looked up online: only the website or database (for example RIS or EUR-Lex). Only search words or a web address go there, never documents.'],
  ['Permissions', 'Every permission decision: what OpenLex wanted to do (for example save a file), whether it was allowed, and who decided (you, a firm rule, a saved rule, or no answer in time).'],
  ['Never contains', 'The text of documents, the full questions as sent to the AI, the AI\'s answers, the instructions given to the AI, file contents or search words. OpenLex does not store these in the record at all.'],
  ['Check', 'Every line of the record is linked to the line before it by a fingerprint (SHA-256). If a line is changed, removed or moved, the check fails and names the line. The check detects changes; it cannot prevent them, because the record is kept as files on this computer. Keep this export: its fingerprint lets you show later that the record has not changed since.'],
]

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function scopeText({ matterId, from, to, left }) {
  return [
    matterId ? `Matter: ${matterTitle(matterId) || matterId}` : 'All matters',
    from || to ? `Dates: ${from || 'start'} to ${to || 'today'}` : 'All dates',
    left ? 'Only what left this computer' : '',
  ].filter(Boolean).join(' · ')
}

const csvCell = (s) => { const t = String(s ?? ''); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }

function rowOf(x, titles) {
  const cloud = x.ai.filter((s) => !s.local)
  return {
    when: stamp(new Date(x.at)),
    window: x.window || '',
    matter: x.matter || '',
    what: titles || x.type !== 'request' ? x.title : (KIND_WORDS[x.kind] || 'Request'),
    ai: x.ai.map((s) => s.local ? 'this computer' : s.service).join('; ') || '-',
    where: x.ai.length ? (cloud.length ? (x.ai.some((s) => s.local) ? 'this computer and online' : 'online') : 'this computer') : '-',
    region: [...new Set(cloud.map((s) => s.region).filter(Boolean))].join('; '),
    names: cloud.length ? (cloud.every((s) => s.namesHidden) ? 'hidden' : cloud.some((s) => s.namesHidden) ? 'partly hidden' : 'not hidden') : '',
    calls: x.calls,
    online: x.lookups.filter((l) => !l.local).map((l) => l.name).join('; '),
    permissions: x.permissions.map((p) => `${p.what}: ${p.decision} (${p.by})`).join('; '),
    blocked: x.blocked.map((b) => `${b.what}: ${b.why}`).join('; '),
    result: x.result || '',
    files: (x.files || []).join('; '),
    seconds: x.ms ? Math.round(x.ms / 1000) : '',
  }
}
const COLUMNS = [['when', 'When'], ['window', 'Window'], ['matter', 'Matter'], ['what', 'What was asked'], ['ai', 'AI service'], ['where', 'Where it ran'], ['region', 'Region'], ['names', 'Client names'], ['calls', 'AI calls'], ['online', 'Looked up online'], ['permissions', 'Permissions'], ['blocked', 'Not sent'], ['result', 'Result'], ['files', 'Files saved'], ['seconds', 'Seconds']]

function verifyLines(v) {
  const lines = [v.ok ? `✓ ${v.text}` : `✗ ${v.text}`, `Checked: ${stamp(new Date(v.checkedAt))}`, `Fingerprint of the whole record: ${v.fingerprint}`]
  for (const f of v.files) lines.push(`${f.ok ? '✓' : '✗'} ${f.name}: ${plural(f.entries, 'line')}${f.broken ? ` — ${f.broken.why}` : ''}${f.head ? ` · last fingerprint ${f.head.slice(0, 16)}…` : ''}`)
  for (const f of v.files) for (const n of f.notes || []) lines.push(`Note (${f.name}): ${n}`)
  return lines
}

function toMarkdown(r, v, opts) {
  const out = [`# AI record — ${opts.matterId ? (r.matter?.title || opts.matterId) : 'all matters'}`, '', `${scopeText(opts)} · made ${stamp()} by OpenLex`, '', `## ${EXPLAIN_TITLE}`, '']
  for (const [k, t] of EXPLAIN) out.push(`- **${k}.** ${t}`)
  out.push('', '## Summary', '', r.summary.text, '',
    `- Requests: ${r.summary.requests} (entries in total: ${r.summary.entries})`,
    `- AI calls: ${r.summary.aiCalls} (${r.summary.localCalls} on this computer, ${r.summary.left.calls} sent outside)`,
    ...r.summary.left.services.map((g) => `- Sent to ${g.service}: ${plural(g.entries, 'entry', 'entries')}, ${plural(g.calls, 'call')}, client names ${g.namesHidden === 'all' ? 'hidden' : g.namesHidden === 'some' ? 'hidden in some' : 'not hidden'}`),
    `- Online lookups: ${r.summary.online.lookups}${r.summary.online.sources.length ? ` (${r.summary.online.sources.join(', ')})` : ''}`,
    `- Permissions: ${r.summary.permissions.asked} asked, ${r.summary.permissions.allowed} allowed, ${r.summary.permissions.denied} denied`,
    `- Stopped by the client-data rule: ${r.summary.blocked}`,
    '', '## Entries', '')
  if (!r.entries.length) out.push('Nothing recorded for this selection.')
  else {
    out.push(`| ${COLUMNS.map(([, h]) => h).join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`)
    for (const x of r.entries) { const row = rowOf(x, opts.titles); out.push(`| ${COLUMNS.map(([k]) => String(row[k] ?? '').replace(/\|/g, '/')).join(' | ')} |`) }
  }
  out.push('', '## Check', '', ...verifyLines(v).map((l) => `- ${l}`), '')
  return out.join('\n')
}

function toCsv(r, v, opts) {
  // The explanation, summary and check as single-cell rows above the table:
  // spreadsheet programs show them; the table starts after the blank row.
  const head = [`AI record — ${scopeText(opts)} — made ${stamp()} by OpenLex`, `${EXPLAIN_TITLE}:`, ...EXPLAIN.map(([k, t]) => `${k}: ${t}`), `Summary: ${r.summary.text}`, ...verifyLines(v)]
  return [...head.map(csvCell), '', COLUMNS.map(([, h]) => csvCell(h)).join(','), ...r.entries.map((x) => { const row = rowOf(x, opts.titles); return COLUMNS.map(([k]) => csvCell(row[k])).join(',') })].join('\n') + '\n'
}

function toPdf(r, v, opts) {
  const { renderPdf } = require('./pdf')
  const s = r.summary
  const sections = [
    { title: `AI record - ${opts.matterId ? (r.matter?.title || opts.matterId) : 'all matters'}`, rows: [['Selection', scopeText(opts)], ['Made', `${stamp()} by OpenLex`]] },
    { title: EXPLAIN_TITLE, rows: EXPLAIN },
    { title: 'Summary', rows: [['In short', s.text], ['Requests', String(s.requests)], ['AI calls', `${s.aiCalls} (${s.localCalls} on this computer, ${s.left.calls} sent outside)`], ...s.left.services.map((g) => ['Sent to', `${g.service}: ${plural(g.entries, 'entry', 'entries')}, ${plural(g.calls, 'call')}, client names ${g.namesHidden === 'all' ? 'hidden' : g.namesHidden === 'some' ? 'hidden in some' : 'not hidden'}`]), ['Online', `${s.online.lookups}${s.online.sources.length ? ` (${s.online.sources.join(', ')})` : ''}`], ['Permissions', `${s.permissions.asked} asked, ${s.permissions.allowed} allowed, ${s.permissions.denied} denied`], ['Not sent', String(s.blocked)]] },
    { title: `Entries (${r.entries.length})`, rows: r.entries.length ? r.entries.map((x) => [stamp(new Date(x.at)), [opts.titles || x.type !== 'request' ? x.title : (KIND_WORDS[x.kind] || 'Request'), ...x.lines].join(' | ')]) : [['', 'Nothing recorded for this selection.']] },
    { title: 'Check', rows: verifyLines(v).map((l, i) => [i === 0 ? (v.ok ? 'Intact' : 'Changed') : '', l.replace(/^[✓✗] /, (m) => (m.startsWith('✓') ? '[ok] ' : '[changed] '))]) },
  ]
  return renderPdf(sections)
}

/**
 * Write the record as a file: in the matter folder, or the "records" folder
 * of the workspace for all matters. titles:false leaves out what was asked.
 */
function exportRecord({ matterId = null, from = null, to = null, left = false, format = 'pdf', titles = true } = {}, now = new Date()) {
  const fmt = String(format || 'pdf').toLowerCase()
  if (!['pdf', 'csv', 'md'].includes(fmt)) throw new Error('format must be pdf, csv or md')
  const opts = { matterId: matterId || null, from: checkDay(from, 'from'), to: checkDay(to, 'to'), left: !!left && left !== '0', titles: titles !== false && titles !== '0' && titles !== 'false' }
  const r = list({ ...opts, limit: 500 })
  // Everything in the selection, not one page.
  if (r.total > r.entries.length) r.entries = build(opts.matterId).filter((x) => matches(x, { ...opts, left: opts.left }))
  const v = verify()
  const ws = require('./workspace')
  const folder = opts.matterId ? ws.matterFolder(require('./workflows').matterLabel(opts.matterId)) : 'records'
  const rel = `${folder}/ai-record-${stamp(now).replace(/[ :]/g, '-')}.${fmt}`
  const file = fmt === 'pdf' ? ws.writeFileBinary(rel, toPdf(r, v, opts)) : ws.writeFile(rel, fmt === 'csv' ? toCsv(r, v, opts) : toMarkdown(r, v, opts))
  return { file, format: fmt, entries: r.entries.length, verified: v.ok, fingerprint: v.fingerprint }
}

// ── local API ────────────────────────────────────────────────────────────
const ROUTES = new Set(['/api/record', '/api/record/verify', '/api/record/export', '/api/record/settings'])

/**
 * GET  /api/record?matterId=&from=&to=&left=1&service=&kind=&limit=&cursor=[&verify=0]
 * GET  /api/record/verify
 * POST /api/record/export { matterId?, from?, to?, left?, format: pdf|csv|md, titles? }
 * GET|POST /api/record/settings { keepMonths: N | null }
 * → { status, json } or null when the path is not one of these.
 */
async function handle(method, p, params, body = {}) {
  if (!ROUTES.has(p)) return null
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) ?? null
  try {
    if (method === 'GET' && p === '/api/record') {
      const r = list({ matterId: get('matterId'), from: get('from'), to: get('to'), left: get('left'), service: get('service'), kind: get('kind'), limit: get('limit'), cursor: get('cursor') })
      if (get('verify') !== '0') r.verify = (({ ok, text, fingerprint, checkedAt }) => ({ ok, text, fingerprint, checkedAt }))(verify())
      r.line = r.verify ? `${r.summary.text} · ${r.verify.ok ? 'record intact ✓' : 'record changed ✗'}` : r.summary.text
      return { status: 200, json: r }
    }
    if (method === 'GET' && p === '/api/record/verify') return { status: 200, json: verify() }
    if (method === 'POST' && p === '/api/record/export') return { status: 200, json: { ok: true, ...exportRecord(body || {}) } }
    if (p === '/api/record/settings') {
      if (method === 'GET') return { status: 200, json: settings() }
      if (method === 'POST') return { status: 200, json: { ok: true, ...setSettings(body || {}) } }
    }
    return { status: 404, json: { error: 'not found' } }
  } catch (err) {
    return { status: 400, json: { error: err.message } }
  }
}

/**
 * How often each law source answered a lookup in one matter, from the audit
 * log (one pass over the matter's lines): { <source id>: count }. Counts the
 * calls that were made and answered (call "law_source", ok: true); the
 * permission checks before a call and failed calls are not counted.
 */
function sourceUses(matterId) {
  const out = {}
  if (!matterId) return out
  for (const e of loadAudit(matterId)) {
    if (e.call !== 'law_source' || e.ok !== true || !String(e.provider || '').startsWith('source:')) continue
    const id = String(e.provider).slice(7)
    out[id] = (out[id] || 0) + 1
  }
  return out
}

module.exports = { sourceUses, list, build, summarize, verify, sealAll, exportRecord, settings, setSettings, applyRetention, handle, toMarkdown, toCsv, SETTINGS_PATH, EXPLAIN, EXPLAIN_TITLE }
