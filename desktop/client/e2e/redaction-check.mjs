// The redaction check end to end, in a plain browser against the real
// engine with a fake online model: attach a German contract (names, IBAN,
// Austrian social security number), ask — the check appears; untick one
// name, add a word, look at the preview, send; the model got placeholders
// only, the answer shows the real names, the analysis export (Word) shows
// the real names, the AI record has the check (counts only).
// Needs a built client (npm run build) and the engine's dependencies.
//   node e2e/redaction-check.mjs [--shots <dir>]
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { startStack, BRIDGE, WEB_PORT, ROOT } from './stack.mjs'

const require = createRequire(path.join(ROOT, 'sidecar', 'package.json'))
const { chromium } = require('playwright-core')
const { docxBuffer } = require(path.join(ROOT, 'sidecar', 'src', 'docx_write.js'))
const { docxText } = require(path.join(ROOT, 'sidecar', 'src', 'docx_text.js'))
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null

const CONTRACT = [
  { text: 'KAUFVERTRAG', style: 'Title' },
  { text: 'abgeschlossen zwischen Herrn Mag. Johann Huber, geb. 12.03.1975, SVNR 1239 120375, wohnhaft Mariahilfer Straße 12/3/7, 1060 Wien (im Folgenden „Käufer“), und der Alpenbau Immobilien GmbH, FN 123456a, Bahnhofstraße 4, 4020 Linz, vertreten durch Dr. Eva Steiner (im Folgenden „Verkäuferin“).' },
  { text: '§ 1 Kaufpreis' },
  { text: 'Der Käufer zahlt EUR 450.000 auf das Konto IBAN AT61 1904 3002 3457 3201 der Verkäuferin. Rückfragen: Frau Petra Lang, Tel. +43 732 123456, petra.lang@alpenbau.example.' },
  { text: '§ 2 Gewährleistung' },
  { text: 'Die Gewährleistung wird ausgeschlossen, soweit gesetzlich zulässig.' },
]
const NAMES = ['Johann Huber', 'Alpenbau', 'Mariahilfer', '1239 120375', 'AT61 1904', 'Petra Lang', 'petra.lang', '12.03.1975']

const phs = (s) => [...new Set(String(s).match(/\[\[[A-Z]+_\d+\]\]/g) || [])]
const answer = (prompt) => {
  const p = phs(prompt)
  if (prompt.includes('Analyse this document')) {
    return JSON.stringify({ summary: { type: 'Kaufvertrag', what: `Kauf zwischen ${p[0] || '?'} und ${p.find((x) => x.startsWith('[[ORG')) || '?'}.`, parties: p.slice(0, 2).map((n) => ({ name: n, role: 'Partei' })), purpose: 'Kauf', key_points: [`${p[0] || '?'} zahlt EUR 450.000`], governing_law: 'österreichisches Recht' }, key_terms: [], dates: [], obligations: [], risks: [], clauses: [], glossary: [] })
  }
  if (/CHECK THE SUGGESTED FIXES|"verdict"/.test(prompt)) return '[]'
  const org = p.find((x) => x.startsWith('[[ORG')) || p[1] || '?'
  const person = p.find((x) => x.startsWith('[[PARTY') || x.startsWith('[[PERSON')) || p[0] || '?'
  return `Verkäuferin ist ${org}. ${person} zahlt den Kaufpreis auf ${p.find((x) => x.startsWith('[[IBAN')) || '?'}.`
}

const st = await startStack({ answer })
const fail = (m) => { console.log(`✗ ${m}`); process.exitCode = 1 }
const ok = (m) => console.log(`✓ ${m}`)
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  for (const lang of ['de', 'en']) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true })
    await ctx.addInitScript(BRIDGE(st.ids.a))
    await ctx.addInitScript(`try { localStorage.setItem('lexvault-ui-lang', '${lang}'); localStorage.setItem('theme', 'light') } catch {}`)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${WEB_PORT}/research`)
    await page.waitForSelector('[data-testid=question]', { timeout: 30000 })
    await page.setInputFiles('[data-testid=attach-input]', { name: 'Kaufvertrag Huber.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxBuffer(CONTRACT) })
    await page.waitForSelector('[data-testid=attachments]', { timeout: 30000 })
    await page.waitForFunction(() => !document.querySelector('[data-testid=attachments]')?.textContent?.includes('…'), null, { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(500)
    const before = st.seen.length
    await page.fill('[data-testid=question]', lang === 'de' ? 'Wer ist Verkäuferin und was zahlt Huber?' : 'Who is the seller and what does Huber pay?')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-testid=redaction-check]', { timeout: 30000 })
    ok(`${lang}: the check appears before anything is sent`)
    if (st.seen.length !== before) fail(`${lang}: the model was called before the check`)
    const note = await page.textContent('[data-testid=redaction-note]')
    if (lang === 'de' ? !/Bitte prüfen Sie vor dem Senden/.test(note) : !/Please check before sending/.test(note)) fail(`${lang}: the note is missing`)
    if (/anonymi/i.test(await page.textContent('[data-testid=redaction-check]'))) fail(`${lang}: the word "anonymised" appears`)
    const list = await page.textContent('[data-testid=redaction-list]')
    for (const t of ['Johann Huber', 'Alpenbau Immobilien GmbH', '1239 120375', 'AT61 1904 3002 3457 3201', 'Eva Steiner', 'Petra Lang']) if (!list.includes(t)) fail(`${lang}: "${t}" not in the findings`)
    ok(`${lang}: names, organisation, SVNR, IBAN, address found`)
    await page.waitForTimeout(600)
    if (shots) await page.screenshot({ path: path.join(shots, `redaction-check-${lang}.png`) })
    // Untick Dr. Steiner (the other side's lawyer), add "Käufer" by selecting it.
    const hide = lang === 'de' ? 'Verdecken' : 'Hide'
    if (lang === 'de') {
      await page.getByRole('checkbox', { name: `${hide} Eva Steiner` }).uncheck()
      await page.evaluate(() => {
        const root = document.querySelector('[data-testid=redaction-text]')
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.textContent.indexOf('Käufer')
          if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 6); const s = getSelection(); s.removeAllRanges(); s.addRange(r); break }
        }
        root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
      await page.click('[data-testid=redaction-add]')
      ok('de: unticked one name, added "Käufer" by selecting it')
    }
    await page.click('[data-testid=redaction-preview]')
    const preview = await page.textContent('[data-testid=redaction-text]')
    if (!/\[\[PERSON\]\]|\[\[NAME\]\]/.test(preview) || preview.includes('1239 120375')) fail(`${lang}: the preview still shows hidden text`)
    else ok(`${lang}: the preview shows what the AI will see`)
    await page.waitForTimeout(300)
    if (shots) await page.screenshot({ path: path.join(shots, `redaction-preview-${lang}.png`) })
    await page.click('[data-testid=redaction-send]')
    await page.waitForFunction(() => /Verkäuferin ist/.test(document.body.innerText), null, { timeout: 60000 })
    const sent = st.seen.slice(before).join('\n')
    for (const t of NAMES) if (sent.includes(t)) fail(`${lang}: "${t}" reached the online model`)
    if (lang === 'de' && (/Käufer/.test(sent) || !sent.includes('Eva Steiner'))) fail('de: the lawyer\'s choices were not applied')
    ok(`${lang}: the online model got placeholders only`)
    const body = await page.evaluate(() => document.body.innerText)
    if (!/Verkäuferin ist Alpenbau Immobilien GmbH/.test(body) || !/Johann Huber zahlt/.test(body)) fail(`${lang}: the answer does not show the real names`)
    else ok(`${lang}: the answer shows the real names`)
    if (lang === 'de' ? !/Namen und Nummern verdeckt \(pseudonymisiert\), von Ihnen geprüft/.test(body) : !/names and numbers hidden \(pseudonymised\), checked by you/.test(body)) fail(`${lang}: the data line does not say names and numbers were hidden and checked`)
    else ok(`${lang}: the data line says names and numbers hidden, checked`)
    if (shots) await page.screenshot({ path: path.join(shots, `redaction-answer-${lang}.png`) })

    if (lang === 'de') {
      // The analysis: a second check (faster: the matter remembers), then the Word export shows real names.
      await page.setInputFiles('[data-testid=attach-input]', { name: 'Kaufvertrag Huber.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxBuffer(CONTRACT) })
      await page.waitForSelector('[data-testid=attachments]', { timeout: 30000 })
      await page.waitForTimeout(800)
      await page.fill('[data-testid=question]', '/analyse')
      await page.keyboard.press('Enter')
      await page.waitForSelector('[data-testid=redaction-check]', { timeout: 30000 })
      const list2 = await page.textContent('[data-testid=redaction-list]')
      if (!list2.includes('Käufer')) fail('de: the added word was not remembered for the matter')
      await page.click('[data-testid=redaction-send]')
      await page.waitForSelector('[data-testid=analysis-card]', { timeout: 60000 })
      await page.getByRole('button', { name: 'Word' }).click()
      await page.waitForTimeout(1500)
      const files = []
      const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/^analysis-.*\.docx$/.test(f.name)) files.push(p) } }
      walk(path.join(st.DATA, 'workspace'))
      if (!files.length) fail('de: no Word export found')
      else {
        const text = docxText(fs.readFileSync(files[0]))
        if (!/Johann Huber/.test(text) || /\[\[[A-Z]+_\d+\]\]/.test(text)) fail('de: the Word export does not show the real names')
        else ok('de: the Word export shows the real names')
      }
      // The AI record: the check, in counts.
      const rec = await (await fetch(`http://127.0.0.1:${WEB_PORT}/__engine/api/record?matterId=${st.ids.a}`)).json()
      const lines = (rec.entries || []).flatMap((e) => e.lines || [])
      const check = lines.find((l) => /^Redaction check: .* hidden in 2 texts — changed by you/.test(l))
      if (!check) fail(`de: no redaction check in the AI record (${lines.slice(0, 6).join(' | ')})`)
      else ok(`de: AI record — ${check}`)
      const raw = fs.readFileSync(path.join(st.DATA, 'audit', 'llm-calls.jsonl'), 'utf8')
      for (const t of NAMES) if (raw.includes(t)) fail(`de: "${t}" is in the AI record`)
      if (shots) await page.screenshot({ path: path.join(shots, 'redaction-analysis-de.png') })
    }
    if (errors.length) fail(`${lang}: page errors: ${errors.join('; ')}`)
    await ctx.close()
  }
  // Only this computer: no check.
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  await fetch(`http://127.0.0.1:${WEB_PORT}/__engine/api/policy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matterId: st.ids.a, rule: { mode: 'local-only' } }) })
  const r = await (await fetch(`http://127.0.0.1:${WEB_PORT}/__engine/api/redaction/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matterId: st.ids.a, message: 'Johann Huber' }) })).json()
  if (r.needed !== false || !r.local) fail('local only: a check was asked for')
  else ok('local only: no check (nothing leaves this computer)')
  await ctx.close()
} finally {
  await browser.close()
  st.stop()
}
