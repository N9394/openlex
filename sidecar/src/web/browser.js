"use strict"
/**
 * Browser agent — a real browser the agent can read pages with, using the
 * lawyer's own sessions.
 *
 * - Engine: Playwright driving the browser already on the machine (Edge or
 *   Chrome; OPENLEX_BROWSER_PATH overrides), no bundled Chromium needed.
 * - Logins: the lawyer signs in themselves in a visible window
 *   (openForLogin). Cookies live in a dedicated profile
 *   (~/.lexvault/browser-profile) that later headless reads reuse. OpenLex
 *   never sees or stores the password; 2FA/SSO just work.
 * - Provenance: saveToMatter() writes the page text, a screenshot and a
 *   provenance record (URL, time, SHA-256 of both) into the matter folder.
 * - Every URL passes web/guard.js (public hosts only, data policy, audit).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('../config')
const { assertPublicUrl } = require('./guard')

const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile')
const MAX_TEXT = 20000
let ctx = null // persistent context (one at a time per profile)
let ctxHeadless = true

function launchOptions(headless) {
  const opts = { headless, viewport: { width: 1280, height: 900 }, acceptDownloads: false }
  if (process.env.OPENLEX_BROWSER_PATH) opts.executablePath = process.env.OPENLEX_BROWSER_PATH
  return opts
}

async function launch(headless) {
  const { chromium } = require('playwright-core')
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  const base = launchOptions(headless)
  if (base.executablePath) return chromium.launchPersistentContext(PROFILE_DIR, base)
  // The lawyer's installed browser first (Edge ships with Windows), then
  // Chrome, then a Playwright-managed Chromium if one is installed.
  const errors = []
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, ...(channel ? { channel } : {}) }) }
    catch (err) { errors.push(`${channel || 'chromium'}: ${err.message.split('\n')[0]}`) }
  }
  throw new Error(`no browser available (${errors.join('; ')}) — install Edge or Chrome, or set OPENLEX_BROWSER_PATH`)
}

async function context(headless = true) {
  if (ctx && ctxHeadless === headless) return ctx
  if (ctx) await close()
  ctx = await launch(headless)
  ctxHeadless = headless
  ctx.on('close', () => { ctx = null })
  // Re-check every navigation the page makes (redirects, scripted jumps).
  await ctx.route('**/*', async (route) => {
    try { await assertPublicUrl(route.request().url()); await route.continue() } catch { await route.abort('blockedbyclient') }
  })
  return ctx
}

async function close() {
  const c = ctx
  ctx = null
  if (c) await c.close().catch(() => {})
}

/** Visible window on the site's login page; the lawyer signs in, the session persists in the profile. */
async function openForLogin(url) {
  await assertPublicUrl(url)
  const c = await context(false)
  const page = await c.newPage()
  await page.goto(String(url), { waitUntil: 'domcontentloaded', timeout: 45000 })
  return { ok: true, message: 'Sign in in the browser window, then close it. OpenLex keeps the session, never the password.' }
}

async function readPage(page) {
  return page.evaluate((max) => {
    const pick = document.querySelector('main, article, [role=main]') || document.body
    const text = (pick?.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
    const links = [...document.querySelectorAll('a[href]')]
      .map((a) => ({ text: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80), href: a.href }))
      .filter((l) => l.text && /^https?:/.test(l.href))
      .slice(0, 40)
    return { title: document.title, text: text.slice(0, max), truncated: text.length > max, links }
  }, MAX_TEXT)
}

/** Load a URL headless and return readable text + links. */
async function fetchPage(url) {
  await assertPublicUrl(url)
  const c = await context(true)
  const page = await c.newPage()
  try {
    const resp = await page.goto(String(url), { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const r = await readPage(page)
    return { url: String(url), finalUrl: page.url(), status: resp?.status() || null, ...r }
  } finally {
    await page.close().catch(() => {})
  }
}

/** Save page text + screenshot + provenance into the workspace (matter folder). */
async function saveToMatter(url, matterFolder) {
  await assertPublicUrl(url)
  const ws = require('../workspace')
  const c = await context(true)
  const page = await c.newPage()
  try {
    await page.goto(String(url), { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const r = await readPage(page)
    const shot = await page.screenshot({ fullPage: true })
    const fetchedAt = new Date().toISOString()
    const host = new URL(page.url()).hostname
    const slug = (r.title || host).replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').slice(0, 50).replace(/^-|-$/g, '') || 'page'
    const dir = `${matterFolder}/web/${fetchedAt.slice(0, 10)}-${host}-${slug}`
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
    const md = `# ${r.title || host}\n\nSource: ${page.url()}\nRetrieved: ${fetchedAt}\n\n---\n\n${r.text}\n`
    const provenance = { url: String(url), finalUrl: page.url(), title: r.title, fetchedAt, sha256: { text: sha(md), screenshot: sha(shot) }, truncated: r.truncated }
    const files = [
      ws.writeFile(`${dir}/page.md`, md),
      ws.writeFileBinary(`${dir}/screenshot.png`, shot),
      ws.writeFile(`${dir}/provenance.json`, JSON.stringify(provenance, null, 2)),
    ]
    return { ...provenance, files }
  } finally {
    await page.close().catch(() => {})
  }
}

// The one size rule (limits.js, ~100 MB).
const maxDownload = () => require('../limits').maxFileBytes()

/**
 * Download a file (PDF, Word, …) into the matter folder with provenance,
 * using the browser profile's cookies — so files behind the lawyer's own
 * sign-in work. Redirects are followed by hand, each hop re-checked
 * against the public-address guard.
 */
async function downloadToMatter(url, matterFolder) {
  const ws = require('../workspace')
  const c = await context(true)
  let target = (await assertPublicUrl(url)).href
  let resp
  for (let hop = 0; hop < 6; hop++) {
    resp = await c.request.get(target, { maxRedirects: 0, timeout: 60000, failOnStatusCode: false })
    const loc = resp.status() >= 300 && resp.status() < 400 ? resp.headers().location : null
    if (!loc) break
    target = (await assertPublicUrl(new URL(loc, target).href)).href
    resp = null
  }
  if (!resp) throw new Error('too many redirects')
  if (!resp.ok()) throw new Error(`HTTP ${resp.status()} for ${target}`)
  const len = parseInt(resp.headers()['content-length'] || '0', 10)
  if (len > maxDownload()) throw new Error(require('../limits').tooLargeMessage('The file', len))
  const body = await resp.body()
  if (body.length > maxDownload()) throw new Error(require('../limits').tooLargeMessage('The file', body.length))
  const type = (resp.headers()['content-type'] || '').split(';')[0].trim()
  const disp = resp.headers()['content-disposition'] || ''
  const fromDisp = disp.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
  let name = fromDisp ? decodeURIComponent(fromDisp[1] || fromDisp[2]) : decodeURIComponent(new URL(target).pathname.split('/').pop() || '')
  const ext = { 'application/pdf': '.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'text/html': '.html', 'text/plain': '.txt', 'application/xml': '.xml', 'text/xml': '.xml' }[type]
  name = name.replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/^\.+/, '').slice(0, 120) || 'download'
  if (ext && !name.toLowerCase().endsWith(ext)) name += ext
  const fetchedAt = new Date().toISOString()
  const dir = `${matterFolder}/downloads/${fetchedAt.slice(0, 10)}-${new URL(target).hostname}`
  const sha256 = crypto.createHash('sha256').update(body).digest('hex')
  const file = ws.writeFileBinary(`${dir}/${name}`, body)
  const provenance = { url: String(url), finalUrl: target, file: name, contentType: type, bytes: body.length, fetchedAt, sha256 }
  ws.writeFile(`${dir}/${name}.provenance.json`, JSON.stringify(provenance, null, 2))
  return { ...provenance, path: file }
}

module.exports = { fetchPage, saveToMatter, downloadToMatter, openForLogin, close, PROFILE_DIR }
