/* OpenLex for Outlook — mail pane logic.
 * Same local engine as the Word add-in (served from it, same origin):
 * the matter's data policy and redaction apply to everything here.
 */
(function () {
  'use strict'

  const ENGINE = window.location.origin || 'https://localhost:18001'
  const $ = (s) => document.querySelector(s)
  let mail = null // { id, subject, from, to, date, body }
  let mattersCache = []
  let lastReply = ''

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const md = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,4} (.+)$/gm, '<b>$1</b>')
    .replace(/^[-*] (.+)$/gm, '• $1')
    .replace(/\n/g, '<br>')

  async function api(path, opts = {}) {
    const res = await fetch(ENGINE + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || `${path}: HTTP ${res.status}`)
    return json
  }

  function setStatus(text, ok) {
    $('#statusText').textContent = text
    $('#statusDot').className = 'dot' + (ok ? ' ok' : '')
  }

  // Stable per-message id so conversation memory and matter binding persist.
  async function mailDocId(itemId) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(itemId || mail.subject + mail.date)))
    return 'mail:' + [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  function readMail() {
    const item = Office.context.mailbox.item
    return new Promise((resolve, reject) => {
      item.body.getAsync(Office.CoercionType.Text, (r) => {
        if (r.status !== Office.AsyncResultStatus.Succeeded) return reject(new Error(r.error?.message || 'cannot read the message body'))
        const addr = (a) => (a ? `${a.displayName || ''} <${a.emailAddress || ''}>`.trim() : '')
        resolve({
          id: item.itemId,
          subject: item.subject || '(no subject)',
          from: addr(item.from),
          to: (item.to || []).map(addr).join(', '),
          date: item.dateTimeCreated ? new Date(item.dateTimeCreated).toISOString() : '',
          body: String(r.value || '').slice(0, 60000),
        })
      })
    })
  }

  function emailText() {
    return `EMAIL\nSubject: ${mail.subject}\nFrom: ${mail.from}\nTo: ${mail.to}\nDate: ${mail.date}\n\n${mail.body}`
  }

  async function ask(message, { reply = false } = {}) {
    const out = $('#mailOut'); const text = $('#mailText')
    out.style.display = ''
    $('#replyRow').style.display = 'none'
    text.innerHTML = '<span class="muted">thinking…</span>'
    let answer = ''
    try {
      const res = await fetch(ENGINE + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, text: emailText(), docId: mail.docId, matterId: $('#matterSel').value || undefined }),
      })
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).replace(/^data:\s*/, ''); buf = buf.slice(i + 2)
          let ev; try { ev = JSON.parse(line) } catch { continue }
          if (ev.type === 'token' || ev.type === 'text') { answer += ev.text || ev.token || ''; text.innerHTML = md(answer) }
          else if (ev.type === 'error') { text.innerHTML = `<span class="err">${esc(ev.message)}</span>`; return }
        }
      }
      if (!answer.trim()) text.innerHTML = '<span class="muted">(no answer)</span>'
      if (reply && answer.trim()) { lastReply = answer.trim(); $('#replyRow').style.display = '' }
    } catch (err) {
      text.innerHTML = `<span class="err">${esc(err.message)}</span>`
    }
  }

  async function refreshMatters() {
    let data
    try { data = await api('/api/matters?docId=' + encodeURIComponent(mail.docId)) } catch { return }
    mattersCache = data.matters
    const sel = $('#matterSel')
    sel.innerHTML = '<option value="">— none —</option>'
    for (const m of data.matters) {
      const o = document.createElement('option')
      o.value = m.id
      o.textContent = (m.number ? m.number + ' · ' : '') + m.title + (m.privileged ? ' 🔒' : '')
      sel.appendChild(o)
    }
    sel.value = data.forDoc || data.active || ''
    showPolicy()
  }

  function showPolicy() {
    const m = mattersCache.find((x) => x.id === $('#matterSel').value)
    const b = $('#matterPolicy')
    b.style.display = m ? '' : 'none'
    if (!m) return
    b.textContent = m.policy?.mode === 'local-only' ? 'local only' : `cloud: ${(m.policy?.providers || []).join(', ')}`
    b.className = 'badge ' + (m.policy?.mode === 'local-only' ? 'local' : 'cloud')
  }

  async function refreshBadge() {
    try {
      const st = await api('/api/status')
      const local = st.model?.local !== false
      $('#dataBadge').textContent = local ? 'local' : `cloud · ${st.model.provider}`
      $('#dataBadge').className = 'badge ' + (local ? 'local' : 'cloud')
      setStatus(st.model?.loaded ? 'ready' : (st.model?.error || 'model not ready'), !!st.model?.loaded)
    } catch { setStatus('engine offline — start OpenLex', false) }
  }

  function bind() {
    $('#matterSel').addEventListener('change', async () => {
      showPolicy()
      const id = $('#matterSel').value
      try { await api('/api/matters/bind', { method: 'POST', body: { id: id || null, docId: mail.docId, title: mail.subject } }) } catch {}
    })
    $('#mailSummary').addEventListener('click', () => ask('Summarise this email for a lawyer: what is asked or claimed, by whom, any deadlines (with dates), and what action is needed. Be concise.'))
    $('#mailReply').addEventListener('click', () => ask('Draft a professional reply to this email in the same language. Output only the reply text, ready to send, no commentary.', { reply: true }))
    $('#mailAsk').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { ask(e.target.value.trim()); e.target.value = '' } })
    $('#mailUseReply').addEventListener('click', () => {
      try { Office.context.mailbox.item.displayReplyForm(lastReply) } catch (err) { $('#mailMsg').textContent = err.message }
    })
    $('#mailFile').addEventListener('click', async () => {
      const matterId = $('#matterSel').value
      if (!matterId) { $('#mailMsg').textContent = 'Pick a matter first.'; return }
      try {
        const r = await api('/api/mail/file', { method: 'POST', body: { matterId, ...mail } })
        await api('/api/matters/bind', { method: 'POST', body: { id: matterId, docId: mail.docId, title: mail.subject } })
        $('#mailMsg').textContent = `Filed: ${r.file.split(/[\\/]/).pop()} — now searchable and part of the matter's review and chronology.`
      } catch (err) { $('#mailMsg').textContent = err.message }
    })
  }

  Office.onReady(async (info) => {
    if (info.host !== Office.HostType.Outlook) { setStatus('needs Outlook', false); return }
    try {
      mail = await readMail()
      mail.docId = await mailDocId(mail.id)
      $('#mailMeta').textContent = `${mail.subject} — ${mail.from}`
    } catch (err) {
      $('#mailMeta').textContent = err.message
      return
    }
    bind()
    refreshBadge()
    refreshMatters()
  })
})()
