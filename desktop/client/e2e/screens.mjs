// Screenshots of the desktop client and the Word pane at the UI audit's
// window sizes (English light, German, dark; pane widths 320–500 px), with
// a small layout report (sideways scroll, targets under 24 px).
//   node e2e/screens.mjs OUTPUT_FOLDER
// Needs a built client and the engine's dependencies; uses the fake model.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startStack, BRIDGE, WEB_PORT, ENGINE_PORT, ROOT } from './stack.mjs'

const OUT = path.resolve(process.argv[2] || 'e2e-screens')
fs.mkdirSync(OUT, { recursive: true })
const require = createRequire(path.join(ROOT, 'sidecar', 'package.json'))
const { chromium } = require('playwright-core')
const report = {}
const CHECK = () => {
  const tiny = []
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || el.type === 'file') continue
    if ((r.width < 24 || r.height < 24) && !(el.matches('input[type=checkbox],input[type=radio]') && el.closest('label'))) tiny.push(`${el.tagName.toLowerCase()}:"${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}" ${Math.round(r.width)}×${Math.round(r.height)}`)
  }
  return { hScroll: document.documentElement.scrollWidth > innerWidth + 1, tiny: [...new Set(tiny)] }
}

const st = await startStack()
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  const passes = [
    ['app-en-light', 'en', 'light', [[1280, 800], [1366, 768], [1024, 768], [800, 900], [1920, 1080]]],
    ['app-de-light', 'de', 'light', [[1024, 768], [800, 900]]],
    ['app-en-dark', 'en', 'dark', [[1366, 768], [800, 900]]],
  ]
  for (const [tag, lang, theme, sizes] of passes) {
    const dir = path.join(OUT, tag); fs.mkdirSync(dir, { recursive: true })
    const ctx = await browser.newContext({ viewport: { width: sizes[0][0], height: sizes[0][1] } })
    await ctx.addInitScript(BRIDGE(st.ids.a))
    await ctx.addInitScript(`try { localStorage.setItem('lexvault-ui-lang', '${lang}'); localStorage.setItem('theme', '${theme}') } catch {}`)
    const page = await ctx.newPage()
    const go = async (to) => { await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, to); await page.waitForTimeout(700) }
    const snap = async (name, before) => {
      for (const [w, h] of sizes) {
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(350)
        if (before) await before()
        const file = `${name}__${w}x${h}.png`
        await page.screenshot({ path: path.join(dir, file) })
        report[`${tag}/${file}`] = await page.evaluate(CHECK)
      }
      console.log('[screens]', tag, name)
    }
    const step = async (name, fn) => { try { await fn() } catch (e) { console.log('FAIL', tag, name, String(e.message).split('\n')[0]); await page.keyboard.press('Escape').catch(() => {}) } }
    await page.goto(`http://127.0.0.1:${WEB_PORT}/research`)
    await page.waitForSelector('[data-testid=question]', { timeout: 30000 }); await page.waitForTimeout(1000)
    await step('empty', () => snap('01-chat-empty'))
    await step('answer', async () => {
      await page.fill('[data-testid=question]', 'Is a two-year non-compete enforceable?'); await page.keyboard.press('Enter')
      await page.waitForSelector('.prose-custom table', { timeout: 60000 }); await page.waitForTimeout(1500)
      await snap('04-chat-answer')
    })
    await step('palette', async () => { await page.keyboard.press('Meta+k'); await page.waitForSelector('[data-testid=palette]'); await page.fill('[data-testid=palette-input]', '/'); await page.waitForTimeout(800); await snap('03-cmd-k'); await page.keyboard.press('Escape') })
    await step('matter', async () => {
      await snap('21-matter-picker', async () => {
        await page.keyboard.press('Escape'); await page.waitForTimeout(200)
        // Narrow windows show the sidebar as icons: open it first.
        if (!(await page.locator('[data-testid=matter-button]').isVisible())) await page.locator('[data-testid=app-sidebar] button').first().click()
        await page.click('[data-testid=matter-button]'); await page.waitForTimeout(500)
      })
      await page.keyboard.press('Escape'); await page.waitForTimeout(200)
      if (await page.locator('[data-testid=app-sidebar].shadow-2xl').count()) await page.mouse.click(page.viewportSize().width - 20, 300)
    })
    await step('data', async () => { await page.fill('[data-testid=question]', '/data'); await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForSelector('[data-testid=data-rule]'); await page.waitForTimeout(500); await snap('14-data-dialog'); await page.keyboard.press('Escape') })
    await step('law', async () => { await page.fill('[data-testid=question]', '/law'); await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForSelector('[data-testid=law-sections]', { timeout: 15000 }); await page.waitForTimeout(500); await snap('15-law-dialog'); await page.keyboard.press('Escape') })
    await step('settings', async () => { await go('/settings'); await snap('30-settings') })
    await step('settings-ai', async () => { await page.click('[data-testid=settings-ai]'); await page.waitForTimeout(1200); await snap('31-settings-ai'); await page.keyboard.press('Escape') })
    await step('settings-language', async () => { await page.click('[data-testid=settings-language]'); await page.waitForTimeout(600); await snap('32-settings-language'); await page.keyboard.press('Escape') })
    await step('setup', async () => { await go('/setup'); await page.click('[data-testid=setup-key]'); await page.waitForTimeout(800); await snap('35-setup') })
    await step('more', async () => { await go('/more'); await snap('40-more-tools') })
    await step('help', async () => { await go('/help'); await snap('45-help') })
    await step('hub', async () => { await go('/hub'); await snap('46-hub') })
    await ctx.close()
  }

  // The Word pane, served by the engine, with a stand-in office.js.
  const OFFICE = `
window.Office = { HostType: { Word: 'Word' }, EventType: { DocumentSelectionChanged: 'sel', OfficeThemeChanged: 'theme' }, CoercionType: { Text: 'text' }, AsyncResultStatus: { Succeeded: 'succeeded' },
  context: { officeTheme: null, requirements: { isSetSupported: () => true }, document: { addHandlerAsync: () => {}, getSelectedDataAsync: (t, cb) => cb && cb({ status: 'succeeded', value: '' }) } },
  onReady: (cb) => { setTimeout(() => cb({ host: 'Word' }), 50); return Promise.resolve({ host: 'Word' }) } }
window.Word = { run: async (fn) => fn({ document: { body: { text: 'SERVICE AGREEMENT', load() {}, paragraphs: { items: [{ text: 'SERVICE AGREEMENT', styleBuiltIn: 'Title', load() {} }], load() {} } } }, sync: async () => {} }) }`
  for (const [tag, theme, widths] of [['word-light', 'light', [320, 350, 500]], ['word-dark', 'dark', [350]]]) {
    const dir = path.join(OUT, tag); fs.mkdirSync(dir, { recursive: true })
    const ctx = await browser.newContext({ viewport: { width: widths[0], height: 800 } })
    await ctx.route('**/office.js', (r) => r.fulfill({ contentType: 'text/javascript', body: OFFICE }))
    await ctx.addInitScript(`try { localStorage.setItem('openlex-theme', '${theme}') } catch {}`)
    const page = await ctx.newPage()
    const snap = async (name) => { for (const w of widths) { await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(300); const file = `${name}__${w}x800.png`; await page.screenshot({ path: path.join(dir, file) }); report[`${tag}/${file}`] = await page.evaluate(CHECK) } console.log('[screens]', tag, name) }
    try {
      await page.goto(`http://127.0.0.1:${ENGINE_PORT}/taskpane.html`); await page.waitForTimeout(2500)
      await page.fill('#input', 'Is a two-year non-compete enforceable?'); await page.click('#send'); await page.waitForTimeout(5000)
      await snap('w02-answer')
      await page.click('#menuBtn'); await page.waitForTimeout(300); await page.fill('#menuSearch', 'settings'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200)
      await snap('w08-settings')
      report[`${tag}/settingsHeight`] = await page.evaluate(() => document.querySelector('#view-settings')?.scrollHeight || 0)
    } catch (e) { console.log('FAIL', tag, String(e.message).split('\n')[0]) }
    await ctx.close()
  }
} finally {
  fs.writeFileSync(path.join(OUT, 'layout-report.json'), JSON.stringify(report, null, 1))
  await browser.close(); st.stop()
}
