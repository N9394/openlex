"use strict"
/**
 * Spending meter and monthly cap for online AI services.
 *
 * Every cloud call adds its tokens to this month's tally, per service and
 * model and per matter, priced from prices.json (dated list prices,
 * ESTIMATES — a bill can differ). When the service reports the cost itself
 * (OpenRouter's usage.cost) that figure is used. When it reports no token
 * counts, they are estimated from the text length (4 characters a token).
 * The AI on this computer is free and never counted.
 *
 * The monthly cap (in euros) comes from openlex.json → "spending":
 *   { "cap": 50, "warnAt": 0.8 }
 * set by the lawyer here, or by the firm in its openlex.json (with
 * "lock": ["spending"] the lawyer cannot change it). At warnAt (80 %) the
 * windows show a notice; at 100 % cloud calls stop with a plain message
 * (code SPEND_CAP) and the routing moves on to the AI on this computer
 * when it is a fallback.
 *
 *   record({ provider, model, matterId, usage, inChars, outChars })  → cost (EUR)
 *   check(provider)   throws SPEND_CAP when the cap is reached
 *   status()          → { month, total, cap, ratio, level, byModel, byMatter, ... }
 *   setCap(eur|null)
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')

const DIR = path.join(DATA_DIR, 'spend')
const USER_PRICES = path.join(DATA_DIR, 'prices.json')
const BUILTIN = require('./prices.json')

const month = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const fileFor = (m) => path.join(DIR, `${m}.json`)
const round2 = (n) => Math.round(n * 100) / 100

/**
 * Price entries from openlex.json → "prices" (firm and/or user layer), the
 * same map the batch estimate reads:
 *   { "<model regex>": { "input": 3, "output": 15, "currency": "USD", "provider"?: "bedrock" } }
 * ("in"/"out" are accepted for input/output). Optional "usdToEur": <number>.
 * These are tried before the user's prices.json and the built-in list.
 */
function harnessPrices() {
  let cfg = {}
  try { cfg = require('./harness').load().prices || {} } catch { cfg = {} }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { models: [], usdToEur: null }
  const models = []
  for (const [match, p] of Object.entries(cfg)) {
    if (match === 'usdToEur' || !p || typeof p !== 'object' || Array.isArray(p)) continue
    const inP = Number(p.input ?? p.in)
    const outP = Number(p.output ?? p.out)
    if (!Number.isFinite(inP) || !Number.isFinite(outP) || inP < 0 || outP < 0) continue
    try { new RegExp(match, 'i') } catch { continue }
    models.push({ match, ...(typeof p.provider === 'string' ? { provider: p.provider } : {}), in: inP, out: outP, currency: String(p.currency || 'USD').toUpperCase(), source: 'openlex.json' })
  }
  const rate = typeof cfg.usdToEur === 'number' && cfg.usdToEur > 0 ? cfg.usdToEur : null
  return { models, usdToEur: rate }
}

function prices() {
  let user = null
  try { user = JSON.parse(fs.readFileSync(USER_PRICES, 'utf8')) } catch { user = null }
  const firm = harnessPrices()
  const models = [...firm.models, ...(Array.isArray(user?.models) ? user.models : []), ...BUILTIN.models]
  let usdToEur = BUILTIN.usdToEur
  if (user && typeof user.usdToEur === 'number') usdToEur = user.usdToEur
  if (firm.usdToEur) usdToEur = firm.usdToEur
  return { ...BUILTIN, usdToEur, models, default: user?.default || BUILTIN.default, custom: !!user || firm.models.length > 0 || !!firm.usdToEur }
}

/** The price entry for a model (first match; the default when none). */
function priceFor(provider, model) {
  const table = prices()
  const name = String(model || '')
  const hit = table.models.find((e) => {
    if (e.provider && e.provider !== provider) return false
    try { return new RegExp(e.match, 'i').test(name) } catch { return false }
  })
  return { ...(hit || table.default), known: !!hit, usdToEur: table.usdToEur }
}

const toEur = (amount, currency, rate) => (String(currency || 'EUR').toUpperCase() === 'USD' ? amount * rate : amount)

/** Token counts from any provider's usage object, or null. */
function tokens(usage) {
  if (!usage || typeof usage !== 'object') return null
  const inT = usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? usage.promptTokenCount
  const outT = usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? usage.candidatesTokenCount
  if (inT == null && outT == null) return null
  return { in: Number(inT) || 0, out: Number(outT) || 0 }
}

function load(m = month()) {
  try {
    const j = JSON.parse(fs.readFileSync(fileFor(m), 'utf8'))
    return { month: m, byModel: j.byModel || {}, byMatter: j.byMatter || {} }
  } catch { return { month: m, byModel: {}, byMatter: {} } }
}

function save(data) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(fileFor(data.month), JSON.stringify(data, null, 2))
}

const totalOf = (data) => round2(Object.values(data.byModel).reduce((n, x) => n + (x.cost || 0), 0))

/** Add one cloud call. Returns its cost in euros. */
function record({ provider, model = null, matterId = null, usage = null, inChars = 0, outChars = 0, local = false, at = new Date() } = {}) {
  if (local || !provider) return 0
  const t = tokens(usage)
  const counted = t || { in: Math.ceil((inChars || 0) / 4), out: Math.ceil((outChars || 0) / 4) }
  const price = priceFor(provider, model)
  let cost
  let reported = false
  if (usage && typeof usage.cost === 'number' && usage.cost >= 0) {
    cost = toEur(usage.cost, 'USD', price.usdToEur) // OpenRouter reports credits in US dollars
    reported = true
  } else {
    cost = toEur((counted.in * price.in + counted.out * price.out) / 1e6, price.currency, price.usdToEur)
  }
  const data = load(month(at))
  const key = `${provider}|${model || ''}`
  const row = data.byModel[key] || { provider, model, calls: 0, inTokens: 0, outTokens: 0, cost: 0, estimatedTokens: false, priceKnown: true, reported: false }
  row.calls++
  row.inTokens += counted.in
  row.outTokens += counted.out
  row.cost = Math.round((row.cost + cost) * 1e6) / 1e6
  if (!t) row.estimatedTokens = true
  if (!price.known && !reported) row.priceKnown = false
  if (reported) row.reported = true
  data.byModel[key] = row
  const mk = matterId || ''
  data.byMatter[mk] = Math.round(((data.byMatter[mk] || 0) + cost) * 1e6) / 1e6
  save(data)
  return cost
}

function settings() {
  let cfg = {}
  let locked = false
  try {
    const h = require('./harness').load()
    cfg = h.spending || {}
    locked = (h.locked || []).includes('spending')
  } catch { cfg = {} }
  const cap = typeof cfg.cap === 'number' && cfg.cap > 0 ? cfg.cap : null
  const warnAt = typeof cfg.warnAt === 'number' && cfg.warnAt > 0 && cfg.warnAt < 1 ? cfg.warnAt : 0.8
  return { cap, warnAt, locked }
}

/** This month in numbers, for the meter and its details. */
function status() {
  const data = load()
  const { cap, warnAt, locked } = settings()
  const total = totalOf(data)
  const ratio = cap ? total / cap : 0
  const table = prices()
  return {
    month: data.month,
    currency: 'EUR',
    total,
    cap,
    warnAt,
    locked,
    ratio: round2(ratio),
    level: cap && ratio >= 1 ? 'stop' : cap && ratio >= warnAt ? 'warn' : 'ok',
    byModel: Object.values(data.byModel).map((x) => ({ ...x, cost: round2(x.cost) })).sort((a, b) => b.cost - a.cost),
    byMatter: Object.entries(data.byMatter).map(([matterId, cost]) => ({ matterId: matterId || null, cost: round2(cost) })).sort((a, b) => b.cost - a.cost),
    estimates: { note: table.note, usdToEur: table.usdToEur, asOf: table.usdToEurAsOf, custom: table.custom },
  }
}

/** Before a cloud call: stop when this month's cap is reached. */
function check(provider) {
  if (!provider || provider.local) return
  const { cap } = settings()
  if (!cap) return
  const total = totalOf(load())
  if (total >= cap) {
    const e = new Error(`This month's limit for online AI (€${cap.toFixed(2)}) is reached: €${total.toFixed(2)} so far. Use the AI on this computer (/model local), or raise the limit.`)
    e.code = 'SPEND_CAP'
    throw e
  }
}

/** The lawyer's own cap (euros; null removes it). Refused when the firm locked it. */
function setCap(cap) {
  const harness = require('./harness')
  if (cap !== null && !(typeof cap === 'number' && Number.isFinite(cap) && cap > 0 && cap <= 1e6)) throw new Error('the limit must be an amount in euros, more than 0')
  const cur = harness.layers().user.data?.spending || {}
  const next = { ...cur }
  if (cap === null) delete next.cap
  else next.cap = round2(cap)
  harness.setUserSection('spending', Object.keys(next).length ? next : null)
  return status()
}

module.exports = { record, check, status, setCap, priceFor, tokens, month, DIR }
