"use strict"
/**
 * Panel — agents working together ("agent teams"; called "Panel" in the
 * windows so it is not confused with a paid plan).
 *
 *   parallel  several agents answer the same question at once (e.g. a
 *             researcher in Austrian law and one in EU law); the answers are
 *             put side by side, each under its agent's name.
 *   debate    two or more agents take positions (claimant vs defendant),
 *             N rounds (default 2), each answering the others; then a
 *             moderator (the judge, or an agent the lawyer chose) sums up:
 *             where they agree, where they disagree, the stronger position
 *             and the open questions. Citations stay verifiable: the
 *             moderator may only cite the sources the agents brought, and a
 *             quote that is not found word for word is removed.
 *   review    a drafter writes, a reviewer reviews, the drafter revises.
 *
 * Every agent turn is a normal run of the agent loop (agent.js) with that
 * agent's profile: its instructions, tools, routes and budget, the data
 * policy and the permissions. Where an agent may not go for this matter
 * (an agent set to an online AI and a privileged matter) it runs where the
 * policy allows, or sits the panel out — and the lawyer is told plainly.
 *
 * Cost: before a panel that uses online AI the window shows an estimate
 * (calls × agents × rounds, priced from prices.json) and the lawyer starts
 * it; the monthly limit (spend.js) stops the panel between turns, keeping
 * what was said. At most `concurrency` (default 3) agents run at once; the
 * AI on this computer runs one agent at a time.
 *
 * Results are kept on this computer (~/.lexvault/panels/<id>.json), shown
 * as a card, exported as Word / PDF / Markdown (report.js), and can be kept
 * with the matter (saved.js). The AI record notes which agent used which
 * AI (never what was said); the conversation keeps the transcript.
 *
 *   estimate(opts) → { calls, cloudCalls, eur, agents[], needsConfirm, overCap, … }
 *   run(opts)      → result (events through opts.onEvent)
 *   get(id) · list({ matterId }) · exportPanel(id, format) · toMarkdown(result)
 *   handle(method, path, params, body)   GET /api/panel, /api/panels; POST /api/panel/estimate, /api/panel/export
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')

const DIR = path.join(DATA_DIR, 'panels')
const MODES = ['parallel', 'debate', 'review']
const ID_RE = /^pn_[a-f0-9]{12}$/
const PER_TURN = { fast: 2, balanced: 3, deep: 5, ultra: 7 } // model calls one agent turn takes, about
const MODE_WORDS = { parallel: 'side by side', debate: 'debate', review: 'draft and review' }

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
const round2 = (n) => Math.round(n * 100) / 100

/** openlex.json → "panel": { concurrency, rounds }. */
function settings() {
  let p = {}
  try { p = require('./harness').load().panel || {} } catch { p = {} }
  const concurrency = Math.max(1, Math.min(6, Math.floor(+p.concurrency) || 3))
  const rounds = Math.max(1, Math.min(5, Math.floor(+p.rounds) || 2))
  return { concurrency, rounds }
}

// ── who takes part, and where each one runs ─────────────────────────────────

/** "the AI on this computer", "Claude (Anthropic, EU)" … */
const whereWords = (p) => (p ? require('./explain').serviceName({ provider: p.id, model: p.model, region: p.region, local: !!p.local || p.kind === 'local', label: p.label }) : 'nowhere')

/**
 * Where an agent's work goes for this matter: the first route the data
 * policy allows (what llm.js would use), and a plain sentence when that is
 * not the agent's own choice — or when nothing is allowed.
 */
function placement(agent, matterId) {
  const agents = require('./agents')
  const routing = require('./routing')
  const policy = require('./policy')
  return agents.run(agent, () => {
    const cands = routing.candidates({ role: 'plan', matterId })
    const ok = (p) => policy.check(p, matterId).allowed && !require('./providers/blocked').reason(p)
    const first = cands[0]?.provider || null
    const use = cands.map((c) => c.provider).find(ok) || null
    const privileged = routing.context({ matterId }).privileged
    const why = privileged ? 'this matter is privileged and stays on this computer' : 'your client-data rule does not allow it for this matter'
    let note = ''
    if (!use) note = `${agent.title} is set to run on ${whereWords(first)}, but ${why}. ${agent.title} does not see this matter and sits this panel out.`
    else if (first && use !== first) note = `${agent.title} is set to run on ${whereWords(first)}, but ${why}: it runs on ${whereWords(use)} instead.`
    const local = !!use && (use.kind === 'local' || !!use.local)
    return { provider: use, first, local, note, where: use ? whereWords(use) : null }
  })
}

/** The members of a panel: [{ name, side }] → resolved, with where they run. */
function members(list, matterId) {
  const agents = require('./agents')
  const seen = new Set()
  return (Array.isArray(list) ? list : []).slice(0, 6).map((m, i) => {
    const spec = typeof m === 'string' ? { name: m } : m || {}
    const agent = agents.resolve(String(spec.name || '').toLowerCase())
    let lane = agent.name
    while (seen.has(lane)) lane = `${agent.name}-${i + 1}`
    seen.add(lane)
    const side = clip(spec.side || '', 200)
    return { lane, name: agent.name, title: spec.label ? clip(spec.label, 60) : agent.title, ...(!spec.label && agent.de?.title ? { titleDe: agent.de.title } : {}), side, agent, ...placement(agent, matterId) }
  })
}

function validateShape(mode, list) {
  if (!MODES.includes(mode)) throw new Error(`choose how the agents work together: ${MODES.join(', ')}`)
  if (list.length < 2) throw new Error(mode === 'review' ? 'A review needs a drafter and a reviewer.' : 'A panel needs at least two agents.')
  if (mode === 'review' && list.length !== 2) throw new Error('A review takes two agents: first the drafter, then the reviewer.')
}

// ── estimate ───────────────────────────────────────────────────────────────

/** How many turns each member takes: [n per member]. */
function turnsOf(mode, rounds, n) {
  if (mode === 'parallel') return Array(n).fill(1)
  if (mode === 'debate') return Array(n).fill(rounds)
  const cycles = Math.max(1, rounds - 1)
  return [1 + cycles, cycles] // drafter: draft + revisions; reviewer: one review per cycle
}

function callCost(p, inTok, outTok) {
  if (!p || p.local || p.kind === 'local') return 0
  const price = require('./spend').priceFor(p.id, p.model)
  const raw = (inTok * price.in + outTok * price.out) / 1e6
  return String(price.currency || 'EUR').toUpperCase() === 'USD' ? raw * (price.usdToEur || 0.92) : raw
}

/**
 * What a panel will cost before it starts. Only an estimate: calls depend
 * on how much each agent looks up.
 */
function estimate({ mode = 'debate', agents: list = [], rounds, moderator, matterId = null, docChars = 0 } = {}) {
  const st = settings()
  const r = Math.max(1, Math.min(5, Math.floor(+rounds) || st.rounds))
  const ms = members(list, matterId)
  validateShape(mode, ms)
  const turns = turnsOf(mode, r, ms.length)
  const docTok = Math.min(Math.ceil(docChars / 4), 60000)
  const rows = ms.map((m, i) => {
    const depth = m.agent.depth || require('./agent-config').load().depth || 'balanced'
    const calls = m.provider ? turns[i] * (PER_TURN[depth] || 3) : 0
    const eur = calls * callCost(m.provider, 4000 + docTok + (mode === 'parallel' ? 0 : 1500), 700)
    return { lane: m.lane, name: m.name, title: m.title, ...(m.titleDe ? { titleDe: m.titleDe } : {}), side: m.side, where: m.where, local: m.local, skipped: !m.provider, note: m.note, calls, eur: round2(eur) }
  })
  // The moderator: one call with the whole transcript (debate; parallel only when asked).
  let mod = null
  if (mode === 'debate' || (mode === 'parallel' && moderator)) {
    const who = moderator && moderator !== 'judge' ? members([moderator], matterId)[0] : null
    const p = who ? who.provider : require('./agents').run(null, () => require('./routing').candidates({ role: 'judge', matterId }).map((c) => c.provider).find((x) => require('./policy').check(x, matterId).allowed) || null)
    const transcript = rows.reduce((n, x, i) => n + turns[i] * 900, 0)
    mod = { name: who ? who.name : 'judge', title: who ? who.title : 'The judge (second pass)', where: whereWords(p), local: !!p && (p.local || p.kind === 'local'), calls: p ? 1 : 0, eur: round2(callCost(p, 2500 + transcript, 1200)) }
  }
  const all = [...rows, ...(mod ? [mod] : [])]
  const calls = all.reduce((n, x) => n + x.calls, 0)
  const cloudCalls = all.filter((x) => !x.local).reduce((n, x) => n + x.calls, 0)
  const eur = round2(all.reduce((n, x) => n + x.eur, 0))
  const sp = require('./spend').status()
  const left = sp.cap ? round2(Math.max(0, sp.cap - sp.total)) : null
  const notes = rows.filter((x) => x.note).map((x) => x.note)
  const parallelism = rows.some((x) => !x.local && !x.skipped) ? Math.min(st.concurrency, rows.filter((x) => !x.local && !x.skipped).length) : 1
  return {
    mode, rounds: r, agents: rows, moderator: mod, calls, cloudCalls, eur, range: { low: round2(eur * 0.5), high: round2(eur * 1.6) },
    needsConfirm: cloudCalls > 0,
    spending: { cap: sp.cap, total: sp.total, left },
    overCap: !!sp.cap && sp.total + eur > sp.cap,
    capReached: !!sp.cap && sp.total >= sp.cap,
    concurrency: parallelism,
    notes,
    text: estimateText({ mode, r, rows, mod, calls, cloudCalls, eur, sp, left }),
  }
}

function estimateText({ mode, r, rows, mod, calls, cloudCalls, eur, sp, left }) {
  const active = rows.filter((x) => !x.skipped)
  const head = `${active.length} agents · ${mode === 'debate' ? `${r} round${r === 1 ? '' : 's'}` : MODE_WORDS[mode]}${mod ? ' · a summary by the moderator' : ''}: about ${calls} AI calls`
  if (!cloudCalls) return `${head}, all on this computer — nothing is sent anywhere, nothing to pay.`
  const money = `about €${eur.toFixed(2)} (estimate)`
  const capLine = sp.cap ? ` This month so far: €${sp.total.toFixed(2)} of your €${sp.cap.toFixed(2)} limit (€${left.toFixed(2)} left).` : ''
  return `${head}, ${cloudCalls} of them to online AI: ${money}.${capLine}`
}

// ── citations ───────────────────────────────────────────────────────────────

const STATUTE_RES = [
  /§§?\s?\d+[a-z]?(?:\s?(?:Abs\.?|Z|lit\.?|Satz|S\.)\s?\d+[a-z]?)*(?:\s(?:[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{1,15}))?/g,
  /\b(?:Art(?:\.|icle|ikel))\s?\d+[a-z]?(?:\s?\(\d+\))?(?:\s(?:[A-Z][A-Za-z-]{1,15}))?/g,
  /\b\d+\s?Ob\s?\d+\/\d+[a-z]?\b/g, // OGH case numbers: 1 Ob 123/45x
  /\bC-\d+\/\d{2}\b/g, // CJEU case numbers
]

/** Sections and cases named in a text: ["§ 1295 ABGB", "Art 6 DSGVO", …] */
function namedCitations(text) {
  const out = []
  for (const re of STATUTE_RES) for (const m of String(text || '').matchAll(re)) { const c = m[0].trim().replace(/\s+/g, ' '); if (!out.includes(c)) out.push(c) }
  return out.slice(0, 30)
}

/** The sources of one turn: the law it looked up, and what it names. */
function turnCitations(text, r) {
  const law = []
  for (const s of r?.sources || []) {
    if (!s || law.some((x) => (x.chunk_id && x.chunk_id === s.chunk_id) || (x.source_name === s.source_name && x.section === s.section))) continue
    law.push({ kind: 'law', chunk_id: s.chunk_id || null, source_name: clip(s.source_name, 120), section: clip(s.section, 60), snippet: clip(s.snippet, 200), ...(s.origin ? { origin: s.origin } : {}), ...(s.from ? { from: clip(s.from, 60) } : {}), ...(s.fromDe ? { fromDe: clip(s.fromDe, 60) } : {}) })
  }
  const named = namedCitations(text).map((c) => ({ kind: 'named', text: c }))
  return [...law, ...named]
}

// ── running ──────────────────────────────────────────────────────────────────

/** A tiny limiter: at most n at once. */
function limiter(n) {
  let active = 0
  const queue = []
  const next = () => { if (active < n && queue.length) queue.shift()() }
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => { active++; Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next() }) })
    next()
  })
}

const SOURCE_RULE = 'Cite a source for every legal point: the statute and section (for example "§ 1295 ABGB"), the case, or the clause of the document. Put decisive words in quotation marks only exactly as they appear in the source. If you have no source for a point, say so.'

function promptFor(mode, step) {
  const { question, member, round, rounds, others, draft, review } = step
  const role = member.side || member.agent.description || member.title
  if (mode === 'parallel') return `${question}\n\n(You are one of several agents answering this at the same time, as ${member.title}${member.side ? `: ${member.side}` : ''}. Answer from your own role. ${SOURCE_RULE})`
  if (mode === 'debate') {
    const head = `PANEL DEBATE — round ${round} of ${rounds}.\nQuestion: ${question}\n\nYou are ${member.title}. Your position: ${role}.`
    if (round === 1 || !others.length) return `${head}\nMake your strongest case in at most 350 words. ${SOURCE_RULE}`
    return `${head}\n\nWhat the others said in round ${round - 1}:\n${others.map((o) => `--- ${o.title}${o.side ? ` (${o.side})` : ''}:\n${clip(o.text, 3000)}`).join('\n\n')}\n\nRespond in at most 350 words: answer their points with sources, concede what is right, and sharpen your own case. ${SOURCE_RULE}`
  }
  if (step.kind === 'draft') return `${question}\n\nWrite the draft: complete text, ready to use. ${SOURCE_RULE}`
  if (step.kind === 'review') return `You review a draft written for this request: "${clip(question, 600)}".\nList each problem — what it is, why it matters, the source, and how to fix it — most serious first. Do not rewrite the whole text. Say what is good, briefly. ${SOURCE_RULE}\n\nDRAFT:\n${clip(draft, 12000)}`
  return `Revise your draft for this request: "${clip(question, 600)}" so that it answers the review below. Give the complete revised text first, then a short list: what you changed, and what you did not change and why.\n\nYOUR DRAFT:\n${clip(draft, 12000)}\n\nTHE REVIEW (${step.reviewer}):\n${clip(review, 6000)}`
}

/**
 * Run a panel. opts: { mode, agents: [{ name, side?, label? }], question,
 * rounds, moderator ('judge' | agent name | null), matterId, makeContext()
 * → agent ctx, signal, onEvent, concurrency }.
 */
async function run(opts = {}) {
  const { mode = 'debate', question = '', matterId = null, signal = null } = opts
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}
  const st = settings()
  const rounds = Math.max(1, Math.min(5, Math.floor(+opts.rounds) || st.rounds))
  const all = members(opts.agents, matterId)
  validateShape(mode, all)
  if (!String(question).trim()) throw new Error('What should the panel answer? Type the question.')
  const ms = all.filter((m) => m.provider)
  for (const m of all.filter((x) => x.note)) onEvent({ type: 'panel_note', lane: m.lane, text: m.note })
  if (ms.length < 2) throw new Error(`Not enough agents can work on this matter: ${all.filter((m) => !m.provider).map((m) => m.note).join(' ')}`)
  if (mode === 'review' && ms.length !== 2) throw new Error('The drafter or the reviewer cannot work on this matter, so the review cannot run.')

  const id = `pn_${crypto.randomBytes(6).toString('hex')}`
  const moderatorSpec = mode === 'debate' ? (opts.moderator || 'judge') : mode === 'parallel' ? (opts.moderator || null) : null
  const modMember = moderatorSpec && moderatorSpec !== 'judge' ? members([moderatorSpec], matterId)[0] : null
  const result = {
    id, at: new Date().toISOString(), mode, question: String(question).slice(0, 4000), matterId: matterId || null, rounds: mode === 'parallel' ? 1 : rounds,
    members: all.map((m) => ({ lane: m.lane, name: m.name, title: m.title, ...(m.titleDe ? { titleDe: m.titleDe } : {}), side: m.side, where: m.where, local: m.local, ...(m.provider ? {} : { skipped: true }), ...(m.note ? { note: m.note } : {}) })),
    moderator: moderatorSpec ? { name: modMember ? modMember.name : 'judge', title: modMember ? modMember.title : 'The judge (second pass)' } : null,
    turns: [], summary: null, sources: [], stopped: false, notes: all.filter((m) => m.note).map((m) => m.note),
  }
  onEvent({ type: 'panel_start', id, mode, rounds: result.rounds, question: result.question, members: result.members, moderator: result.moderator })

  const cloudSlots = limiter(Math.max(1, Math.min(6, +opts.concurrency || st.concurrency)))
  const localSlot = limiter(1)
  const aborted = () => !!(signal && signal.aborted)
  let capHit = null
  const lane = (m, status, plain, extra = {}) => onEvent({ type: 'panel_lane', lane: m.lane, status, plain, ...extra })
  const usage = {} // lane → { services: { label: calls } }
  const track = (laneId, ev) => {
    const u = usage[laneId] || (usage[laneId] = { calls: 0, services: {} })
    u.calls++
    const label = require('./explain').serviceName({ provider: ev.provider, model: ev.model, region: ev.region, local: ev.local, label: ev.label })
    u.services[label] = (u.services[label] || 0) + 1
  }

  /** One agent's turn: the agent loop with its profile, its events tagged with its lane. */
  const turn = (m, round, prompt, kind = 'answer') => (m.local ? localSlot : cloudSlots)(async () => {
    if (aborted() || capHit) { lane(m, 'stopped', capHit ? 'Not started: the monthly limit for online AI is reached' : 'Stopped'); return null }
    if (!m.local) {
      try { require('./spend').check(m.provider) } catch (err) {
        if (err.code !== 'SPEND_CAP') throw err
        capHit = err.message
        lane(m, 'stopped', 'Not started: the monthly limit for online AI is reached')
        return null
      }
    }
    lane(m, 'working', kind === 'review' ? 'Reading the draft' : round > 1 ? 'Reading what the others said' : 'Working out how to answer', { round })
    const ctx = typeof opts.makeContext === 'function' ? opts.makeContext() : defaultContext()
    let spoke = false
    const forward = (e) => {
      if (!e || !e.type) return
      if (e.type === 'step') {
        require('./explain').withPlain(e)
        if (!e.quiet) lane(m, 'working', e.plain, { round, ...(e.online ? { online: e.onlineTo } : {}) })
      } else if (e.type === 'text') {
        if (!spoke) { spoke = true; lane(m, 'speaking', 'Speaking', { round }) }
        onEvent({ type: 'panel_text', lane: m.lane, round, text: e.text })
      } else if (e.type === 'law') onEvent({ type: 'law', lane: m.lane, sources: e.sources })
    }
    const agents = require('./agents')
    const policy = require('./policy')
    let r
    try {
      r = await policy.observeModels((ev) => { track(m.lane, ev); onEvent({ type: 'model', lane: m.lane, ...ev }) }, () => agents.run(m.agent, () => require('./agent').runAction(ctx, prompt, forward, { signal, agent: m.agent, prose: true, judge: false })))
    } catch (err) {
      if (err.code === 'SPEND_CAP') capHit = err.message
      const t = { lane: m.lane, name: m.name, title: m.title, ...(m.titleDe ? { titleDe: m.titleDe } : {}), side: m.side, round, kind, text: '', error: require('./explain').friendly ? require('./explain').friendly(err) : err.message, citations: [] }
      lane(m, 'failed', `Could not answer: ${clip(t.error, 120)}`, { round })
      result.turns.push(t)
      return t
    }
    const text = String(r.text || '').trim()
    const citations = turnCitations(text, r)
    const evidence = (r.evidence || []).map((x) => x.text)
    const t = { lane: m.lane, name: m.name, title: m.title, ...(m.titleDe ? { titleDe: m.titleDe } : {}), side: m.side, round, kind, text, citations, ...(r.stopped ? { stopped: true } : {}), ...(!citations.length && kind !== 'draft' ? { noSource: true } : {}), _evidence: evidence }
    result.turns.push(t)
    onEvent({ type: 'panel_turn', lane: m.lane, round, kind, text, citations, ...(t.noSource ? { noSource: true } : {}), ...(r.stopped ? { stopped: true } : {}) })
    lane(m, r.stopped ? 'stopped' : 'done', r.stopped ? 'Stopped' : t.noSource ? 'Done — but it cited no source' : `Done${citations.length ? ` · ${citations.length} source${citations.length === 1 ? '' : 's'} cited` : ''}`, { round, ...(t.noSource ? { warn: true } : {}) })
    return t
  })

  const byOrder = (list) => list.filter(Boolean).sort((a, b) => ms.findIndex((m) => m.lane === a.lane) - ms.findIndex((m) => m.lane === b.lane))
  try {
    if (mode === 'parallel') {
      await Promise.all(ms.map((m) => turn(m, 1, promptFor(mode, { question, member: m }))))
    } else if (mode === 'debate') {
      for (let round = 1; round <= rounds; round++) {
        if (aborted() || capHit) break
        onEvent({ type: 'panel_round', round, rounds })
        const prev = byOrder(result.turns.filter((t) => t.round === round - 1 && t.text))
        await Promise.all(ms.map((m) => turn(m, round, promptFor(mode, { question, member: m, round, rounds, others: prev.filter((t) => t.lane !== m.lane) }))))
      }
    } else {
      const [drafter, reviewer] = ms
      let draft = await turn(drafter, 1, promptFor(mode, { kind: 'draft', question, member: drafter }), 'draft')
      const cycles = Math.max(1, rounds - 1)
      for (let c = 1; c <= cycles && draft?.text && !aborted() && !capHit; c++) {
        const review = await turn(reviewer, c, promptFor(mode, { kind: 'review', question, member: reviewer, draft: draft.text }), 'review')
        if (!review?.text || aborted() || capHit) break
        draft = await turn(drafter, c + 1, promptFor(mode, { kind: 'revise', question, member: drafter, draft: draft.text, review: review.text, reviewer: reviewer.title }), 'revision') || draft
      }
    }
  } finally {
    result.turns = result.turns.sort((a, b) => a.round - b.round || ms.findIndex((m) => m.lane === a.lane) - ms.findIndex((m) => m.lane === b.lane))
  }

  // The sources the agents brought, numbered once for the whole panel.
  result.sources = sourceList(result.turns)
  if (aborted()) result.stopped = 'you'
  else if (capHit) { result.stopped = 'cap'; result.notes.push(`${capHit} The panel stopped; what was said so far is kept.`) }

  // The moderator's summary (debate; parallel when asked): only when the panel ran through.
  if (!result.stopped && moderatorSpec && result.turns.some((t) => t.text)) {
    onEvent({ type: 'panel_lane', lane: 'moderator', status: 'working', plain: mode === 'debate' ? 'Summing up: agreement, disagreement, the stronger position, open questions' : 'Comparing the answers' })
    result.summary = await moderate({ result, modMember, signal, onEvent, track, matterId, makeContext: opts.makeContext })
    onEvent({ type: 'panel_lane', lane: 'moderator', status: 'done', plain: result.summary.fallback ? 'Could not sum up — the positions are shown as they are' : `Summed up${result.summary.removed ? ` (${result.summary.removed} unverifiable citation${result.summary.removed === 1 ? '' : 's'} removed)` : ''}` })
    onEvent({ type: 'panel_summary', summary: result.summary })
  }
  if (mode === 'review') {
    const finals = result.turns.filter((t) => t.lane === ms[0].lane && t.text)
    result.final = finals.length ? finals[finals.length - 1].text : ''
  }
  result.usage = Object.fromEntries(Object.entries(usage).map(([k, u]) => [k, { calls: u.calls, services: Object.entries(u.services).map(([label, calls]) => ({ label, calls })) }]))
  for (const t of result.turns) delete t._evidence
  save(result)
  onEvent({ type: 'panel_result', panel: result })
  return result
}

function defaultContext() {
  const { Document } = require('./doc')
  const doc = new Document('', `panel:${Date.now().toString(36)}`)
  return { doc, memory: null, session: null, summary: () => doc.summary() }
}

/** Every source of the panel, numbered S1…: law looked up, then sections named. */
function sourceList(turns) {
  const out = []
  for (const t of turns) {
    for (const c of t.citations || []) {
      const label = c.kind === 'law' ? [c.source_name, c.section].filter(Boolean).join(' ') : c.text
      const key = c.kind === 'law' ? (c.chunk_id || label) : label.toLowerCase()
      let s = out.find((x) => x.key === key)
      if (!s) { s = { id: `S${out.length + 1}`, key, kind: c.kind, label, chunk_id: c.chunk_id || null, snippet: c.snippet || '', ...(c.origin ? { origin: c.origin } : {}), ...(c.from ? { from: c.from } : {}), ...(c.fromDe ? { fromDe: c.fromDe } : {}), by: [] }; out.push(s) }
      if (!s.by.includes(t.title)) s.by.push(t.title)
    }
  }
  return out.slice(0, 60).map(({ key, ...s }) => s)
}

// ── the moderator ────────────────────────────────────────────────────────────

const MODERATOR_PROMPT = `You moderate a panel of AI agents for the lawyer who asked. Be neutral and precise. Use only what the agents said and the SOURCES list.
Reply with JSON only:
{"agreement": [{"point": "...", "cites": ["S1"]}],
 "disagreement": [{"point": "...", "positions": [{"agent": "<agent id>", "view": "..."}], "cites": ["S2"]}],
 "stronger": {"agent": "<agent id, or none>", "why": "...", "cites": ["S3"]},
 "open": [{"question": "...", "why": "..."}],
 "quotes": [{"text": "exact words", "source": "S1"}]}
Rules: cite only ids from SOURCES; a point no source supports gets "cites": [] — say so in the point. "quotes": only words that appear exactly in the source or in an agent's text. Weigh points without a source less. If neither side is clearly stronger, say "none" and why. Write in the language of the question.`

async function moderate({ result, modMember, signal, onEvent, track, matterId, makeContext }) {
  const transcript = result.turns.filter((t) => t.text).map((t) => `${result.mode === 'debate' ? `Round ${t.round} — ` : ''}${t.title} [agent id: ${t.lane}]${t.side ? ` (${t.side})` : ''}${t.noSource ? ' (cited no source)' : ''}:\n${clip(t.text, 4000)}`).join('\n\n')
  const sources = result.sources.map((s) => `${s.id}: ${s.label}${s.snippet ? ` — ${s.snippet}` : ''} (brought by ${s.by.join(', ')})`).join('\n') || '(none — no agent cited a source)'
  const messages = [
    { role: 'system', content: MODERATOR_PROMPT },
    { role: 'user', content: `QUESTION:\n${result.question}\n\nAGENTS:\n${result.members.filter((m) => !m.skipped).map((m) => `- ${m.lane}: ${m.title}${m.side ? ` — ${m.side}` : ''}`).join('\n')}\n\nTRANSCRIPT:\n${transcript}\n\nSOURCES:\n${sources}` },
  ]
  const llm = require('./llm')
  const call = () => require('./policy').observeModels((ev) => { track('moderator', ev); onEvent({ type: 'model', lane: 'moderator', ...ev }) }, () => (modMember
    ? require('./agents').run(modMember.agent, () => llm.chat(messages, { maxTokens: 1800, role: 'write', signal }))
    : llm.chat(messages, { maxTokens: 1800, role: 'judge', signal })))
  let raw
  try { raw = await call() } catch (err) { return { fallback: true, note: `The moderator could not sum up (${clip(err.message, 160)}); the positions are shown as they are.`, agreement: [], disagreement: [], stronger: null, open: [], quotes: [] } }
  return checkSummary(raw, result)
}

/**
 * The moderator's JSON, checked: only cites of the panel's sources, only
 * agents of the panel, quotes only when found word for word (in the cited
 * source's text or the agents' turns). Removed items are counted.
 */
function checkSummary(raw, result, evidence = []) {
  let v
  try { const m = String(raw).match(/\{[\s\S]*\}/); v = JSON.parse(m ? m[0] : raw) } catch {
    return { fallback: true, note: 'The moderator\'s summary could not be read; the positions are shown as they are.', agreement: [], disagreement: [], stronger: null, open: [], quotes: [] }
  }
  const ids = new Set(result.sources.map((s) => s.id))
  const lanes = new Set(result.members.filter((m) => !m.skipped).map((m) => m.lane))
  let removed = 0
  const cites = (list) => { const arr = Array.isArray(list) ? list.map(String) : []; const ok = [...new Set(arr.filter((c) => ids.has(c)))]; removed += arr.length - arr.filter((c) => ids.has(c)).length; return ok }
  const titleOf = (lane) => result.members.find((m) => m.lane === lane)?.title || lane
  const laneOf = (a) => { const s = String(a || '').toLowerCase(); return lanes.has(s) ? s : result.members.find((m) => !m.skipped && m.title.toLowerCase() === s)?.lane || null }
  const out = {
    agreement: (Array.isArray(v.agreement) ? v.agreement : []).slice(0, 12).map((x) => ({ point: clip(x?.point ?? x, 600), cites: cites(x?.cites) })).filter((x) => x.point),
    disagreement: (Array.isArray(v.disagreement) ? v.disagreement : []).slice(0, 12).map((x) => ({
      point: clip(x?.point ?? x, 600),
      positions: (Array.isArray(x?.positions) ? x.positions : []).map((p) => ({ lane: laneOf(p?.agent), view: clip(p?.view, 600) })).filter((p) => p.lane && p.view).map((p) => ({ ...p, title: titleOf(p.lane) })),
      cites: cites(x?.cites),
    })).filter((x) => x.point),
    stronger: null,
    open: (Array.isArray(v.open) ? v.open : []).slice(0, 12).map((x) => ({ question: clip(x?.question ?? x, 400), why: clip(x?.why, 400) })).filter((x) => x.question),
    quotes: [],
  }
  if (v.stronger && typeof v.stronger === 'object') {
    const lane = laneOf(v.stronger.agent)
    out.stronger = { lane, title: lane ? titleOf(lane) : null, why: clip(v.stronger.why, 800), cites: cites(v.stronger.cites) }
  }
  // Verbatim-anchor rule: a quote stays only when its words are found exactly.
  const { verbatim } = require('./judge')
  const turnTexts = result.turns.map((t) => t.text).filter(Boolean)
  const evTexts = [...evidence, ...result.turns.flatMap((t) => t._evidence || [])]
  for (const q of Array.isArray(v.quotes) ? v.quotes : []) {
    const text = String(q?.text || '').trim()
    if (!text) continue
    const src = result.sources.find((s) => s.id === String(q?.source || ''))
    const pool = [...turnTexts, ...evTexts, ...(src ? [src.label, src.snippet] : [])]
    if (verbatim(text, pool)) out.quotes.push({ text: clip(text, 400), source: src ? src.id : null })
    else removed++
  }
  if (removed) out.removed = removed
  return out
}

// ── storing, reading, exporting ───────────────────────────────────────────────

function save(result) {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(path.join(DIR, `${result.id}.json`), JSON.stringify(result), { mode: 0o600 })
  } catch (err) { console.warn('[panel] not stored:', err.message) }
}

function get(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('unknown panel')
  try { return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')) } catch { throw new Error('This panel is no longer on this computer.') }
}

function list({ matterId = null, limit = 50 } = {}) {
  let names = []
  try { names = fs.readdirSync(DIR).filter((f) => /^pn_[a-f0-9]{12}\.json$/.test(f)) } catch { return [] }
  const out = []
  for (const f of names) {
    try { const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); if (matterId && r.matterId !== matterId) continue; out.push({ id: r.id, at: r.at, mode: r.mode, question: clip(r.question, 200), matterId: r.matterId, members: r.members.map((m) => m.title) }) } catch { /* skip */ }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit)
}

const srcLine = (s) => `${s.id} ${s.label}${s.snippet ? ` — ${s.snippet}` : ''}${s.by?.length ? ` (cited by ${s.by.join(', ')})` : ''}`
const citeText = (c) => (c?.length ? ` [${c.join(', ')}]` : ' [no source]')
const NOTE = 'Written by AI agents and checked by a second pass where shown. Check the cited sources before relying on it.'

/** The sections of the result (shared by Markdown, Word and PDF). */
function sections(r) {
  const out = []
  const who = r.members.map((m) => [m.title, `${m.side ? `${m.side} · ` : ''}${m.skipped ? 'did not take part' : `ran on ${m.where}`}${m.note ? ` — ${m.note}` : ''}`])
  out.push({ title: 'Question', text: r.question })
  out.push({ title: 'Who took part', rows: [...who, ...(r.moderator ? [['Moderator', r.moderator.title]] : [])] })
  const s = r.summary
  if (s && !s.fallback) {
    if (s.stronger) out.push({ title: 'The stronger position', text: `${s.stronger.title || 'Neither side clearly'}: ${s.stronger.why}${citeText(s.stronger.cites)}` })
    if (s.agreement.length) out.push({ title: 'Where they agree', text: s.agreement.map((a) => `- ${a.point}${citeText(a.cites)}`) })
    if (s.disagreement.length) out.push({ title: 'Where they disagree', text: s.disagreement.map((d) => `- ${d.point}${citeText(d.cites)}${d.positions.map((p) => `\n  - ${p.title}: ${p.view}`).join('')}`) })
    if (s.open.length) out.push({ title: 'Open questions', text: s.open.map((o) => `- ${o.question}${o.why ? ` — ${o.why}` : ''}`) })
    if (s.quotes.length) out.push({ title: 'Quoted', text: s.quotes.map((q) => `- “${q.text}”${q.source ? ` [${q.source}]` : ''}`) })
    if (s.removed) out.push({ title: 'Checked', text: `${s.removed} citation${s.removed === 1 ? '' : 's'} or quote${s.removed === 1 ? '' : 's'} of the moderator could not be verified and ${s.removed === 1 ? 'was' : 'were'} removed.` })
  } else if (s?.fallback) out.push({ title: 'Summary', text: s.note })
  if (r.mode === 'review' && r.final) out.push({ title: 'Final draft', text: r.final })
  const label = (t) => (r.mode === 'debate' ? `Round ${t.round} — ${t.title}` : r.mode === 'review' ? `${t.title} — ${{ draft: 'draft', review: `review ${t.round}`, revision: `revision ${t.round - 1}` }[t.kind] || t.kind}` : t.title)
  for (const t of r.turns) out.push({ title: label(t), text: t.error ? `(could not answer: ${t.error})` : `${t.text}${t.noSource ? '\n\n(This turn cited no source.)' : ''}` })
  if (r.sources.length) out.push({ title: 'Sources', text: r.sources.map((x) => `- ${srcLine(x)}`) })
  if (r.notes?.length) out.push({ title: 'Notes', text: r.notes.map((n) => `- ${n}`) })
  return out
}

function report(r) {
  const head = `${MODE_WORDS[r.mode] ? MODE_WORDS[r.mode][0].toUpperCase() + MODE_WORDS[r.mode].slice(1) : r.mode}${r.mode === 'debate' ? `, ${r.rounds} round${r.rounds === 1 ? '' : 's'}` : ''}`
  return { title: `Panel: ${clip(r.question, 80)}`, subtitle: `${head} · ${String(r.at).slice(0, 10)}${r.stopped ? ` · stopped${r.stopped === 'cap' ? ' (monthly limit)' : ''}` : ''}`, note: NOTE, sections: sections(r) }
}

/** The result as Markdown (the chat's text, the conversation, saved items). */
function toMarkdown(r) {
  return require('./report').render(report(r), 'md').toString('utf8')
}

function exportPanel(id, format) {
  const r = get(id)
  const fmt = String(format || '').toLowerCase()
  if (!['docx', 'pdf', 'md'].includes(fmt)) throw new Error('format must be docx, pdf or md')
  return require('./report').save({ report: report(r), format: fmt, matterId: r.matterId, base: `panel-${clip(r.question, 40)}` })
}

/** The local API → { status, json } or null. (The run itself streams: server.js.) */
async function handle(method, p, params, body = {}) {
  const q = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  try {
    if (method === 'GET' && p === '/api/panel') return { status: 200, json: { panel: get(q('id')) } }
    if (method === 'GET' && p === '/api/panels') return { status: 200, json: { panels: list({ matterId: q('matterId') }), settings: settings(), modes: MODES } }
    if (method === 'POST' && p === '/api/panel/estimate') return { status: 200, json: { estimate: estimate(body) } }
    if (method === 'POST' && p === '/api/panel/export') return { status: 200, json: exportPanel(body.id, body.format) }
    return null
  } catch (err) {
    return { status: 400, json: { error: err.message } }
  }
}

module.exports = { run, estimate, members, placement, get, list, save, exportPanel, toMarkdown, report, checkSummary, sourceList, namedCitations, handle, settings, MODES, DIR }
