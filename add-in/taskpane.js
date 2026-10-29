/* OpenLex Word add-in — task pane (the Office.js and DOM glue).
 * Talks to the local engine on the same origin (https://localhost:18001).
 * The pane's logic lives in lib/*.js (window.OpenLexPane; unit-tested in
 * node without Word): activity, data line, sources, review, errors, menu,
 * permission, theme, contextual hint, matter. This file renders it and
 * talks to Word.
 *
 * Layout rule (no clutter): permanent chrome is the header (matter, where
 * the AI runs, menu button), the conversation, the data line, and the
 * question box with ONE main action ("Review this contract"). Everything
 * else is an entry in the "What can I do here?" menu (lib/menu.js), and
 * features appear in context through the single hint slot (lib/suggest.js).
 * Results go into the document (tracked changes, comments) plus one card in
 * the conversation; details open on click.
 */
(function () {
  'use strict'

  const P = window.OpenLexPane
  // Same origin as the page itself (the engine serves the add-in).
  const SIDECAR = window.location.origin || 'http://127.0.0.1:18001'
  let sidecarOk = false
  let lang = 'auto'
  let features = {} // openlex.json → features (firm switches)
  const available = { analyse: false, overview: false } // engine capabilities found by probing

  const $ = (sel) => document.querySelector(sel)
  const now = () => Date.now()
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v } catch { return d } },
    set(k, v) { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  }

  // ── Office bootstrap ──────────────────────────────────────────────────────
  Office.onReady((info) => {
    if (info.host !== Office.HostType.Word) {
      setStatus('OpenLex works inside Word. Open this pane from Word.', false)
      return
    }
    init()
  })

  async function init() {
    bindTheme()
    bindViews()
    bindMenu()
    bindHint()
    bindChat()
    bindReview()
    bindSelection()
    bindUndo()
    bindWorkspace()
    bindCalendar()
    bindSuggestionsList()
    bindCompare()
    bindDocMap()
    bindSettings()
    setStatus('Starting…')
    const ok = await pingSidecar()
    sidecarOk = ok
    setStatus(ok ? '' : 'OpenLex is not running on this computer. Start it, then reopen this pane.', ok)
    if (ok) {
      refreshAiBadge(); bindHub(); bindMatters(); bindWorkflows()
      refreshSetup(); refreshJurisdictions(); refreshPacks(); bindUpdate()
      loadFeatures(); probeCapabilities(); loadReviewPlaybooks()
      autoMap() // read the open document so questions have context immediately
    }
  }

  // Read the open document once so the chat has context without a click.
  async function autoMap() {
    try {
      const body = await getDocTextAndStyles()
      if (!body.text || !body.text.trim()) return
      const map = await mapBody(body)
      docMap = map
      docId = map.doc_id
      docText = body.text
      $('#docmeta').textContent = `${P.words.plural(map.sections.length, 'part')} · ${body.text.length.toLocaleString()} characters`
      renderTree(map)
      refreshMatters() // select the matter this document is filed under
    } catch {
      // No document yet — the pane still answers questions about the law.
    }
  }

  // ── Status line (only shown when there is something to say) ─────────────
  let statusMsg = ''
  function setStatus(text, ok) {
    statusMsg = text || ''
    $('#statusText').textContent = statusMsg
    $('#statusDot').className = 'dot ' + (ok === undefined ? '' : ok ? 'on' : 'off')
    refreshStatusLine()
  }
  // The line under the header: where the AI runs, this matter's rule, and
  // a problem only when there is one.
  function refreshStatusLine() {
    $('#statusDot').hidden = !statusMsg
    $('#statusText').hidden = !statusMsg
  }

  // ── Engine API ────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(SIDECAR + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      let msg = err
      try { msg = JSON.parse(err).error || err } catch { /* plain text */ }
      throw Object.assign(new Error(`${msg || res.statusText} (${res.status})`), { status: res.status })
    }
    return res.status === 204 ? null : res.json()
  }

  async function pingSidecar() {
    try {
      const res = await fetch(SIDECAR + '/health', { signal: AbortSignal.timeout(1500) })
      return res.ok
    } catch { return false }
  }

  /** Read an SSE response, calling onEvent for each `data:` event. */
  async function readSse(res, onEvent) {
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += dec.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop()
      for (const part of parts) {
        if (!part.startsWith('data:')) continue
        let evt
        try { evt = JSON.parse(part.slice(5)) } catch { continue }
        onEvent(evt)
      }
    }
  }

  /** Firm switches (openlex.json → features): menu entries the firm turned off are hidden. */
  async function loadFeatures() {
    try { features = (await api('/api/features')).features || {} } catch { features = {} }
    applyFeatures()
  }
  function applyFeatures() {
    $('#reviewBtn').hidden = features.review === false
    $('#reviewOptsBtn').hidden = features.review === false
  }

  /**
   * Hooks for "Analyse this document" and "Matter overview": the menu
   * entries stay hidden until the engine has the endpoints (a separate
   * engine change). Only the engine's own 404 "not found" means absent.
   */
  async function probeCapabilities() {
    try {
      const res = await fetch(SIDECAR + '/api/matters/overview?id=__probe__')
      let body = null
      try { body = await res.json() } catch { /* not JSON */ }
      const has = P.matter.routeExists(res.status, body)
      available.overview = has
      available.analyse = has // both arrive with the same engine change
    } catch { /* engine offline */ }
  }

  // ── Screen-reader announcements (one polite region, debounced) ───────────
  let srTimer = null
  function announce(text, urgent) {
    let r = $('#srStatus')
    if (!r) { r = el('div', 'sr-only'); r.id = 'srStatus'; r.setAttribute('role', 'status'); r.setAttribute('aria-live', 'polite'); document.body.appendChild(r) }
    clearTimeout(srTimer)
    if (urgent) { r.textContent = text; return }
    srTimer = setTimeout(() => { r.textContent = text }, 1200)
  }

  // ── Theme: follows Word (Office.context.officeTheme) unless picked ────────
  function bindTheme() {
    const sel = $('#themeSel')
    const pref = store.get('openlex-theme', 'auto')
    const apply = () => {
      const p = sel.value
      const sys = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      let officeTheme = null
      try { officeTheme = Office.context.officeTheme } catch { /* not available */ }
      document.documentElement.setAttribute('data-theme', P.theme.resolve(p, officeTheme, sys))
    }
    sel.value = ['auto', 'light', 'dark'].includes(pref) ? pref : 'auto'
    sel.addEventListener('change', () => { store.set('openlex-theme', sel.value); apply() })
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
    try {
      if (Office.EventType.OfficeThemeChanged && Office.context.document && Office.context.document.addHandlerAsync) {
        Office.context.document.addHandlerAsync(Office.EventType.OfficeThemeChanged, apply, () => {})
      }
    } catch { /* host has no theme event */ }
    apply()
  }

  // ── Views: the conversation, and one secondary view at a time ────────────
  let currentView = 'chat'
  function showView(name, focusSel) {
    document.querySelectorAll('.view').forEach((v) => {
      const on = v.id === 'view-' + name
      v.hidden = !on
      v.classList.toggle('active', on)
    })
    currentView = name
    const dockOn = name === 'chat'
    $('.dock').classList.toggle('dock-min', !dockOn)
    const target = focusSel ? $(focusSel) : name === 'chat' ? $('#input') : $(`#view-${name} .view-head h2`)
    if (target) {
      if (target.tagName === 'H2' || target.tagName === 'H3') target.setAttribute('tabindex', '-1')
      target.focus()
      if (target.scrollIntoView) target.scrollIntoView({ block: 'start' })
    }
  }
  function bindViews() {
    document.querySelectorAll('.view .back').forEach((b) => b.addEventListener('click', () => showView('chat')))
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && currentView !== 'chat' && $('#menu').hidden) { e.preventDefault(); showView('chat') }
    })
  }

  // ── "What can I do here?" — the one menu (lib/menu.js) ───────────────────
  let menuItems = []
  let menuPick = 0
  let menuReturn = null
  const ACTIONS = {
    review: () => openReviewOptions(),
    analyse: () => runAnalyse(),
    compare: () => $('#compareFile').click(),
    comments: () => commentDigest(),
    obligations: () => obligCheck(),
    xref: () => xrefCheck(),
    outline: () => showView('outline'),
    changes: () => showView('changes'),
    acceptAll: () => reviewAll('accept'),
    rejectAll: () => reviewAll('reject'),
    overview: () => showOverview(),
    matterReview: () => showView('matter', '#wfPlaybook'),
    chronology: () => showView('matter', '#wfChrono'),
    translate: () => { showView('matter', '#wfDocA'); const d = $('#wfMore'); if (d) { d.open = true; refreshWorkflowDocs() } },
    compareDocs: () => { showView('matter', '#wfDocB'); const d = $('#wfMore'); if (d) { d.open = true; refreshWorkflowDocs() } },
    clauses: () => showView('matter', '#clQuery'),
    newMatter: () => { const box = $('#matterNew'); box.hidden = false; $('#matterTitle').focus() },
    settingsAI: () => showView('settings', '#set-ai'),
    settingsData: () => showView('settings', '#set-data'),
    settingsLibrary: () => showView('settings', '#set-library'),
    settings: () => showView('settings'),
    clear: () => clearConversation(),
  }

  function bindMenu() {
    $('#menuBtn').addEventListener('click', openMenu)
    $('#menuClose').addEventListener('click', closeMenu)
    $('#menu').addEventListener('click', (e) => { if (e.target.id === 'menu') closeMenu() })
    $('#menuSearch').addEventListener('input', () => { menuPick = 0; renderMenu() })
    $('#menuSearch').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); menuPick = P.menu.move(menuPick, e.key === 'ArrowDown' ? 1 : -1, menuItems.length); renderMenu() }
      else if (e.key === 'Enter') { e.preventDefault(); if (menuItems[menuPick]) runMenu(menuItems[menuPick].id) }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu() }
    })
    // Keep Tab inside the menu while it is open.
    $('#menu').addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return
      const f = [...$('#menu').querySelectorAll('button, input')].filter((x) => !x.disabled && x.offsetParent !== null)
      if (!f.length) return
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
    })
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k') { e.preventDefault(); if ($('#menu').hidden) openMenu(); else closeMenu() }
    })
  }
  function openMenu() {
    menuReturn = document.activeElement
    $('#menu').hidden = false
    $('#menuBtn').setAttribute('aria-expanded', 'true')
    $('#menuSearch').value = ''
    menuPick = 0
    renderMenu()
    $('#menuSearch').focus()
  }
  function closeMenu(keepFocus) {
    $('#menu').hidden = true
    $('#menuBtn').setAttribute('aria-expanded', 'false')
    if (!keepFocus && menuReturn && menuReturn.focus) menuReturn.focus()
  }
  function renderMenu() {
    menuItems = P.menu.search($('#menuSearch').value, { features, available })
    const list = $('#menuList')
    list.innerHTML = ''
    if (!menuItems.length) { list.appendChild(el('div', 'menu-empty muted', 'Nothing found. Try other words, or just ask in the question box.')); $('#menuSearch').removeAttribute('aria-activedescendant'); return }
    let i = 0
    for (const g of P.menu.grouped(menuItems)) {
      const head = el('div', 'menu-group', g.group)
      head.setAttribute('role', 'presentation')
      list.appendChild(head)
      for (const e of g.entries) {
        const idx = i++
        const item = el('div', 'menu-item' + (idx === menuPick ? ' active' : ''))
        item.id = 'mi-' + e.id
        item.setAttribute('role', 'option')
        item.setAttribute('aria-selected', idx === menuPick ? 'true' : 'false')
        item.append(el('span', 'mi-label', e.label), el('span', 'mi-hint', e.hint))
        item.addEventListener('click', () => runMenu(e.id))
        item.addEventListener('mousemove', () => { if (menuPick !== idx) { menuPick = idx; renderMenu() } })
        list.appendChild(item)
        if (idx === menuPick) { $('#menuSearch').setAttribute('aria-activedescendant', item.id); item.scrollIntoView && item.scrollIntoView({ block: 'nearest' }) }
      }
    }
  }
  function runMenu(id) {
    closeMenu(true)
    const fn = ACTIONS[id]
    if (fn) Promise.resolve().then(fn).catch((err) => addError(err, 'load'))
  }

  // ── The contextual hint slot: at most one hint at a time (lib/suggest.js) ─
  let hintSlot = P.suggest.create()
  function bindHint() {
    $('#hint .hint-x').addEventListener('click', () => { hintSlot = P.suggest.dismiss(hintSlot); renderHint(); $('#input').focus() })
  }
  function offerHint(h) { hintSlot = P.suggest.offer(hintSlot, h); renderHint() }
  function withdrawHint(id) { hintSlot = P.suggest.withdraw(hintSlot, id); renderHint() }
  function renderHint() {
    const box = $('#hint')
    const h = hintSlot.current
    box.hidden = !h
    if (!h) return
    box.querySelector('.hint-text').textContent = h.text
    const acts = box.querySelector('.hint-acts')
    acts.innerHTML = ''
    for (const a of h.actions || []) {
      const b = el('button', 'hint-act', a.label)
      b.type = 'button'
      b.addEventListener('click', () => { const id = h.id; a.run(); withdrawHint(id) })
      acts.appendChild(b)
    }
  }

  // ── Errors: what happened · why · what to do (lib/errors.js) ─────────────
  function addError(err, doing, extra = {}) {
    const x = P.errors.explain(err, doing)
    const card = el('div', 'msg err')
    card.setAttribute('role', 'alert')
    card.append(el('div', 'err-what', '! ' + x.what), el('div', 'err-why', x.why), el('div', 'err-todo', x.todo + (extra.restored ? ' Your question is back in the question box.' : '')))
    const acts = el('div', 'btn-row')
    for (const a of extra.actions || []) {
      const b = el('button', 'btn btn-ghost btn-small', a.label)
      b.type = 'button'
      b.addEventListener('click', () => { b.disabled = true; Promise.resolve(a.run()).catch((e) => addError(e, a.doing || doing)).finally(() => { b.disabled = false }) })
      acts.appendChild(b)
    }
    if (acts.children.length) card.appendChild(acts)
    if (x.details) {
      const d = el('details', 'err-details')
      d.append(el('summary', null, 'Details'), el('code', null, x.details))
      card.appendChild(d)
    }
    appendToChat(card)
    return card
  }

  function addNote(text, cls = 'note') {
    const n = el('div', 'msg ' + cls, text)
    appendToChat(n)
    return n
  }

  // While a request runs, its cards (permission questions, notes, errors)
  // go into that request's block, in the order they happen.
  let activeTurn = null
  function appendToChat(node) {
    const w = $('#welcome'); if (w) w.remove()
    if (activeTurn && node !== activeTurn.el && activeTurn.el.isConnected) activeTurn.el.appendChild(node)
    else $('#chat').appendChild(node)
    scrollChat(true)
  }

  /** Keep the newest part in view — but never pull the page away from someone reading further up. */
  function scrollChat(force) {
    const v = $('#view-chat')
    if (currentView !== 'chat') return
    const nearBottom = v.scrollHeight - v.scrollTop - v.clientHeight < 160
    if (force || nearBottom) v.scrollTop = v.scrollHeight
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  let lastSent = ''
  let lastQuestion = ''
  let busy = null // { kind: 'chat'|'review'|'analyse', abort }

  function bindChat() {
    const ta = $('#input')
    // Never lose typed input: the draft survives a pane reload.
    ta.value = store.get('openlex-draft', '')
    const autoGrow = () => {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
      ta.classList.toggle('multi', ta.scrollHeight > 42)
    }
    ta.addEventListener('input', () => { autoGrow(); store.set('openlex-draft', ta.value) })
    ta.addEventListener('focus', autoGrow)
    ta.addEventListener('keydown', (e) => {
      if (skillMenuKey(e)) return
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendFromInput() }
      if (e.key === 'Escape' && busy) { e.preventDefault(); stopWork() }
    })
    ta.addEventListener('input', updateSkillMenu)
    ta.addEventListener('blur', () => setTimeout(hideSkillMenu, 150))
    $('#send').addEventListener('click', () => { if (busy) stopWork(); else sendFromInput() })
    setBusy(null)
  }

  function sendFromInput() {
    const ta = $('#input')
    const text = ta.value.trim()
    if (!text) { ta.focus(); return }
    if (busy) { announce('OpenLex is still working. Stop it first, or wait — your question stays in the box.', true); return }
    lastSent = ta.value
    ta.value = ''
    store.set('openlex-draft', '')
    ta.style.height = ''
    ta.classList.remove('multi')
    ask(text)
  }

  /** Put the question back if nothing was answered (never lose typed input). */
  function restoreInput() {
    const ta = $('#input')
    if (ta.value.trim() || !lastSent) return false
    ta.value = lastSent
    store.set('openlex-draft', lastSent)
    return true
  }

  function setBusy(b) {
    busy = b
    const send = $('#send')
    if (b) {
      send.textContent = 'Stop'
      send.classList.add('btn-stop')
      send.setAttribute('aria-label', 'Stop — what is done so far is kept')
    } else {
      send.textContent = 'Send'
      send.classList.remove('btn-stop')
      send.setAttribute('aria-label', 'Send the question')
    }
    $('#reviewBtn').disabled = !!b
  }

  function stopWork() {
    if (!busy) return
    busy.stopped = true
    if (busy.abort) busy.abort.abort()
  }

  // ── One request in the conversation: activity, answer, Based on ──────────
  function newTurn() {
    const wrap = el('div', 'turn')
    const act = el('div', 'activity')
    act.setAttribute('aria-live', 'off') // announced through #srStatus instead
    const head = el('div', 'act-head')
    const list = el('ol', 'act-steps')
    list.setAttribute('aria-label', 'What OpenLex is doing')
    const sum = el('button', 'act-summary')
    sum.type = 'button'
    sum.hidden = true
    sum.setAttribute('aria-expanded', 'false')
    const all = el('div', 'act-all')
    all.hidden = true
    act.append(head, list, sum, all)
    wrap.appendChild(act)
    appendToChat(wrap)
    const t = { el: wrap, actEl: act, head, list, sum, all, act: P.activity.start(now()), answer: null, lastStep: '' }
    sum.addEventListener('click', () => {
      const open = sum.getAttribute('aria-expanded') !== 'true'
      sum.setAttribute('aria-expanded', open ? 'true' : 'false')
      all.hidden = !open
      if (open) renderAllSteps(t)
    })
    t.timer = setInterval(() => renderActivity(t), 1000)
    activeTurn = t
    renderActivity(t)
    updateDataLine(t.act, true)
    return t
  }

  function renderActivity(t) {
    const v = P.activity.view(t.act, { now: now(), maxSteps: 3 })
    t.head.textContent = v.running ? v.label : ''
    t.head.hidden = !v.running
    t.list.hidden = !v.running
    t.sum.hidden = v.running
    if (v.running) {
      t.list.innerHTML = ''
      if (v.earlier) t.list.appendChild(el('li', 'act-earlier', `… ${P.words.plural(v.earlier, 'earlier step')}`))
      for (const s of v.steps) {
        const li = el('li', 'act-step ' + s.status + (s.current ? ' current' : ''))
        if (s.current) li.setAttribute('aria-current', 'step')
        const mark = el('span', 'mark', s.mark)
        mark.setAttribute('aria-hidden', 'true')
        li.append(mark, el('span', 'sr-only', s.status === 'done' ? 'Done: ' : s.status === 'failed' ? 'Did not work: ' : 'Now: '), el('span', 'act-text', s.text))
        t.list.appendChild(li)
      }
      const cur = v.steps.find((s) => s.current)
      if (cur && cur.text !== t.lastStep) { t.lastStep = cur.text; announce(cur.text) }
    } else {
      t.sum.textContent = v.summary + ' — what it did'
    }
    scrollChat(false)
  }

  function renderAllSteps(t) {
    t.all.innerHTML = ''
    const ol = el('ol', 'act-steps act-full')
    for (const s of P.activity.allSteps(t.act)) {
      const li = el('li', 'act-step ' + s.status)
      const mark = el('span', 'mark', s.mark)
      mark.setAttribute('aria-hidden', 'true')
      li.append(mark, el('span', 'act-text', s.text), el('span', 'act-took', s.took))
      ol.appendChild(li)
    }
    t.all.appendChild(ol)
    if (t.act.reasoning.trim()) {
      const d = el('details', 'act-notes')
      d.append(el('summary', null, 'Its working notes'), el('div', 'act-notes-body', t.act.reasoning.trim()))
      t.all.appendChild(d)
    }
  }

  function updateDataLine(act, running) {
    const line = P.dataline.line(act.models, act.online, { running })
    const box = $('#dataLine')
    box.classList.toggle('left', line.left)
    box.querySelector('.dl-sym').textContent = line.symbol
    box.querySelector('.dl-text').textContent = line.text
    box.title = line.title
  }

  function finishTurn(t) {
    if (t.timer) { clearInterval(t.timer); t.timer = null }
    if (activeTurn === t) activeTurn = null
    if (!t.act.endedAt) t.act = busy && busy.stopped ? P.activity.stop(t.act, now()) : P.activity.apply(t.act, { type: 'done' }, now())
    renderActivity(t)
    updateDataLine(t.act, false)
    if (t.answer) { t.answer.setAttribute('aria-busy', 'false'); announce(`Answer ready (${P.words.plural(t.act.answerWords, 'word')}).`) }
    if (!t.review) renderBasedOn(t) // a review's findings carry their own basis
    if (t.act.stopped && !t.review) addNote(P.activity.stopSentence(t.act), 'note stop-note')
  }

  async function ask(text, opts = {}) {
    if (!sidecarOk) { addError('engine offline', 'answer', { restored: restoreInput() }); return }
    if (busy) return
    if (opts.display) lastSent = '' // not typed: nothing to put back
    lastQuestion = text
    withdrawHint()
    addNote(opts.display || text, 'user')
    // The engine keeps documents in memory only: after a restart re-read the document.
    if (!docText && docId) {
      try {
        const fresh = await getDocTextAndStyles()
        docText = fresh.text
        const map = await mapBody(fresh)
        docMap = map
        docId = map.doc_id
        renderTree(map)
      } catch { /* not in Word — a question about the law */ }
    }
    const t = newTurn()
    const abort = new AbortController()
    setBusy({ kind: 'chat', abort })
    let gotText = false
    try {
      const res = await fetch(SIDECAR + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // interactive: this pane answers "May OpenLex …?" (permission cards).
        body: JSON.stringify({ message: text, doc: docMap, lang, docId, text: docText, interactive: true }),
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(await res.text())
      await readSse(res, (evt) => { if (evt.type === 'text') gotText = true; handleChatEvent(t, evt) })
    } catch (err) {
      if (!(err && err.name === 'AbortError')) {
        t.act = P.activity.apply(t.act, { type: 'error', message: err.message }, now())
        addError(err, 'answer', { restored: !gotText && restoreInput() })
      }
    }
    finishTurn(t)
    setBusy(null)
  }

  function handleChatEvent(t, evt) {
    t.act = P.activity.apply(t.act, evt, now())
    renderActivity(t)
    if (evt.type === 'model' || evt.type === 'step') updateDataLine(t.act, true)
    switch (evt.type) {
      case 'text': {
        if (!t.answer) {
          t.answer = el('div', 'msg agent')
          t.answer.setAttribute('aria-busy', 'true')
          t.answer._md = ''
          t.answer._inner = el('div', 'md')
          t.answer.appendChild(t.answer._inner)
          t.el.appendChild(t.answer)
        }
        t.answer._md += evt.text
        t.answer._inner.innerHTML = mdToHtml(t.answer._md)
        scrollChat(false)
        break
      }
      case 'suggestion':
        // Flagged by a firm rule: always shown for review, never put in silently.
        if (autopilot && evt.suggestion && !(evt.suggestion.flags && evt.suggestion.flags.length)) autopilotApply(evt.suggestion)
        else {
          renderSuggestion(evt.suggestion)
          renderChatSuggestion(evt.suggestion, true)
        }
        break
      case 'permission': addPermissionCard(evt); break
      case 'permission_result': closePermissionCard(evt); break
      case 'scorecard': addScorecardCard(evt.scorecard); break
      case 'skill_suggestion':
        if (features.skillSuggestions === false) break
        offerHint({ id: 'skill:' + evt.name, priority: 1, text: `Your firm has instructions for this: “${evt.title}”.`, actions: [{ label: 'Use them', run: () => { const ta = $('#input'); ta.value = `/${evt.name} ${lastQuestion || ''}`.trim(); ta.focus() } }] })
        break
      case 'warning': addNote('Note from your firm\'s rules: ' + (evt.message || ''), 'warn'); break
      case 'withheld': {
        const note = 'Your firm\'s rules held this answer back: ' + (evt.message || '')
        if (t.answer) { t.answer._inner.textContent = note; t.answer.classList.add('withheld') } else addNote(note, 'warn')
        break
      }
      case 'error': if (!evt.recoverable) addError(evt.message, 'answer'); break
    }
  }

  /** "Based on ① ② ③" — small numbered markers; click shows the quote or full text. */
  function renderBasedOn(t) {
    const items = P.sources.basedOn(t.act)
    if (!items.length) return
    const box = el('div', 'basedon')
    box.appendChild(el('span', 'bo-label', 'Based on'))
    const detail = el('div', 'bo-detail')
    detail.hidden = true
    let openN = 0
    for (const it of items) {
      const b = el('button', 'bo-mark bo-' + it.kind, String(it.n))
      b.type = 'button'
      b.title = it.label
      b.setAttribute('aria-label', `Source ${it.n}: ${it.label}`)
      b.setAttribute('aria-expanded', 'false')
      b.addEventListener('click', () => {
        const open = openN !== it.n
        box.querySelectorAll('.bo-mark').forEach((x) => x.setAttribute('aria-expanded', 'false'))
        openN = open ? it.n : 0
        detail.hidden = !open
        if (!open) return
        b.setAttribute('aria-expanded', 'true')
        showSource(it, detail)
      })
      box.appendChild(b)
    }
    box.appendChild(detail)
    t.el.appendChild(box)
  }

  async function showSource(it, box) {
    box.innerHTML = ''
    box.appendChild(el('div', 'bo-title', `${it.n}. ${it.label}`))
    if (it.detail) box.appendChild(el('blockquote', 'bo-quote', it.detail))
    const row = el('div', 'btn-row')
    if (it.kind === 'law' && it.chunk_id) {
      const b = el('button', 'btn btn-ghost btn-small', 'Read the full text')
      b.type = 'button'
      b.addEventListener('click', async () => {
        b.disabled = true
        try {
          const r = await api('/api/law/section?chunk_id=' + encodeURIComponent(it.chunk_id))
          const full = el('div', 'bo-full', String(r.content || '').slice(0, 4000))
          full.setAttribute('tabindex', '-1')
          b.replaceWith(full)
          full.focus()
        } catch (err) { b.disabled = false; addError(err, 'load') }
      })
      row.appendChild(b)
    }
    if ((it.kind === 'doc' && it.clause && it.clause.index != null) || (it.kind === 'note' && it.section != null)) {
      const b = el('button', 'btn btn-ghost btn-small', 'Show it in the document')
      b.type = 'button'
      b.addEventListener('click', () => jumpToSection(it.kind === 'doc' ? it.clause.index : it.section))
      row.appendChild(b)
    }
    if (row.children.length) box.appendChild(row)
  }

  // ── "/" menu: your firm's instructions and "@" working as … ─────────────
  let skillCache = null
  let skillPick = 0
  let agentCache = null
  async function loadSkills() {
    if (skillCache && agentCache) return skillCache
    try { skillCache = (await (await fetch(SIDECAR + '/api/skills')).json()).skills.filter((s) => !s.error) } catch { skillCache = [] }
    try { agentCache = (await (await fetch(SIDECAR + '/api/agents')).json()).agents.filter((a) => !a.error).map((a) => ({ ...a, agent: true })) } catch { agentCache = [] }
    setTimeout(() => { skillCache = null; agentCache = null }, 60000)
    return skillCache
  }
  const MENU_RE = /^(@[a-z0-9-]+\s+)?([/@])([a-z0-9-]*)$/
  function skillMatches() {
    const m = $('#input').value.match(MENU_RE)
    if (!m || !skillCache) return []
    const pool = m[2] === '@' ? (m[1] ? [] : agentCache || []) : skillCache
    return pool.filter((s) => s.name.startsWith(m[3]) || String(s.title || '').toLowerCase().includes(m[3])).slice(0, 8)
  }
  async function updateSkillMenu() {
    if (!MENU_RE.test($('#input').value)) return hideSkillMenu()
    await loadSkills()
    const list = skillMatches()
    let menu = $('#skillMenu')
    if (!list.length) return hideSkillMenu()
    if (!menu) {
      menu = el('div', 'skill-menu')
      menu.id = 'skillMenu'
      menu.setAttribute('role', 'listbox')
      menu.setAttribute('aria-label', $('#input').value.includes('@') ? 'Work as' : 'Your firm\'s instructions')
      $('.composer').before(menu)
    }
    skillPick = Math.min(skillPick, list.length - 1)
    menu.innerHTML = ''
    list.forEach((s, i) => {
      const item = el('button', 'skill-item' + (i === skillPick ? ' active' : ''))
      item.type = 'button'
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', i === skillPick ? 'true' : 'false')
      item.append(el('b', null, s.agent ? `Work as: ${s.title || s.name}` : (s.title || s.name)), el('span', null, s.description || ''))
      item.addEventListener('mousedown', (e) => { e.preventDefault(); chooseSkill(s.name, s.agent) })
      menu.appendChild(item)
    })
  }
  function hideSkillMenu() { const m = $('#skillMenu'); if (m) m.remove(); skillPick = 0 }
  function chooseSkill(name, isAgent) {
    const ta = $('#input')
    const prefix = (ta.value.match(MENU_RE) || [])[1] || ''
    ta.value = `${prefix}${isAgent ? '@' : '/'}${name} `
    hideSkillMenu()
    ta.focus()
  }
  function skillMenuKey(e) {
    if (!$('#skillMenu')) return false
    const list = skillMatches()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); skillPick = (skillPick + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length; updateSkillMenu(); return true }
    if ((e.key === 'Enter' || e.key === 'Tab') && list[skillPick]) { e.preventDefault(); chooseSkill(list[skillPick].name, list[skillPick].agent); return true }
    if (e.key === 'Escape') { hideSkillMenu(); return true }
    return false
  }

  /* Escape-first markdown → HTML. No innerHTML from raw model text ever:
   * HTML is escaped first, then a handful of markdown constructs are
   * matched on the escaped text. */
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  function inlineMd(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  }
  function mdToHtml(src) {
    const lines = String(src || '').replace(/\r\n/g, '\n').split('\n')
    const out = []
    let i = 0
    let listTag = null, listItems = [], inBlockquote = false, inCode = false, codeBuf = [], para = []
    const flushPara = () => { if (para.length) { out.push('<p>' + inlineMd(para.join('<br>')) + '</p>'); para = [] } }
    const flushList = () => { if (listTag) { out.push('<' + listTag + '>' + listItems.map((x) => '<li>' + inlineMd(x) + '</li>').join('') + '</' + listTag + '>'); listTag = null; listItems = [] } }
    const flushQuote = () => { if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false } }
    while (i < lines.length) {
      const line = lines[i]
      if (inCode) {
        if (/^\s*```/.test(line)) { inCode = false; out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>'); codeBuf = [] }
        else codeBuf.push(escHtml(line))
        i++; continue
      }
      if (/^\s*```/.test(line)) { flushPara(); flushList(); flushQuote(); inCode = true; i++; continue }
      const h = line.match(/^(#{1,6})\s+(.*)$/)
      if (h) {
        flushPara(); flushList(); flushQuote()
        const lvl = Math.min(h[1].length + 2, 6) // never larger than the pane's own headings
        out.push('<h' + lvl + '>' + inlineMd(escHtml(h[2])) + '</h' + lvl + '>')
        i++; continue
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); flushList(); flushQuote(); out.push('<hr>'); i++; continue }
      if (/^\s*>\s?(.*)$/.test(line)) {
        flushPara(); flushList()
        if (!inBlockquote) { inBlockquote = true; out.push('<blockquote>') }
        out.push(inlineMd(escHtml(line.replace(/^\s*>\s?/, ''))) + '<br>')
        i++; continue
      }
      const ul = line.match(/^\s*[-*]\s+(.*)$/)
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
      if (ul || ol) {
        flushPara(); flushQuote()
        const tag = ul ? 'ul' : 'ol'
        if (listTag !== tag) { flushList(); listTag = tag }
        listItems.push(escHtml((ul || ol)[1]))
        i++; continue
      }
      if (!line.trim()) { flushPara(); flushList(); flushQuote(); i++; continue }
      if (listTag) { flushList(); listTag = null }
      flushQuote()
      para.push(escHtml(line))
      i++
    }
    if (inCode) out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>')
    flushPara(); flushList(); flushQuote()
    return out.join('\n')
  }

  /* Permission card: one sentence with the verb, "Allow once" is the default
   * (focused) button, "Always" never is. Escape = Don't allow. No answer
   * within a few minutes = not allowed (the engine decides that). */
  function addPermissionCard(evt) {
    const card = el('div', 'msg permission')
    card.dataset.id = evt.id
    card.setAttribute('role', 'group')
    const qid = 'perm-q-' + String(evt.id).replace(/[^\w-]/g, '')
    card.setAttribute('aria-labelledby', qid)
    const q = el('div', 'perm-q', P.permission.question(evt))
    q.id = qid
    card.append(q, el('div', 'perm-risk', P.permission.riskLine(evt)))
    const rows = P.permission.details(evt)
    if (rows.length) {
      const d = el('details', 'perm-details')
      d.appendChild(el('summary', null, 'What exactly'))
      for (const r of rows) d.appendChild(el('div', 'perm-detail', `${r.label}: ${r.value}`))
      card.appendChild(d)
    }
    const row = el('div', 'perm-actions')
    for (const b of P.permission.buttons(evt)) {
      const btn = el('button', b.primary ? 'btn' : 'btn btn-ghost', b.label)
      btn.type = 'button'
      btn.dataset.choice = b.choice
      if (b.choice === 'always' && evt.always) btn.title = `Saves the rule "${evt.always}" — you can remove it later in Settings`
      btn.addEventListener('click', () => answerPermission(card, evt, b.choice))
      row.appendChild(btn)
    }
    card.appendChild(row)
    card.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.classList.contains('settled')) { e.preventDefault(); e.stopPropagation(); answerPermission(card, evt, 'deny') } })
    appendToChat(card)
    announce('OpenLex is asking: ' + q.textContent, true)
    const def = row.querySelector('[data-choice="once"]') || row.querySelector('button')
    if (def) def.focus()
  }
  async function answerPermission(card, evt, choice) {
    if (card.classList.contains('settled')) return
    card.querySelectorAll('.perm-actions button').forEach((x) => { x.disabled = true })
    try {
      const r = await api('/api/permissions/answer', { method: 'POST', body: { id: evt.id, decision: choice } })
      settlePermissionCard(card, P.permission.outcome(choice, r && r.saved))
    } catch (err) {
      card.querySelectorAll('.perm-actions button').forEach((x) => { x.disabled = false })
      addError(err, 'answer')
    }
  }
  function settlePermissionCard(card, text) {
    if (card.classList.contains('settled')) return
    card.classList.add('settled')
    const row = card.querySelector('.perm-actions')
    if (row) row.remove()
    card.appendChild(el('div', 'perm-outcome', text))
    $('#input').focus()
  }
  function closePermissionCard(evt) {
    const card = document.querySelector(`.msg.permission[data-id="${CSS.escape(evt.id)}"]`)
    if (!card || card.classList.contains('settled')) return
    settlePermissionCard(card, P.permission.settled(evt))
  }

  function addScorecardCard(sc) {
    if (!sc) return
    const score = Math.max(0, Math.min(100, Math.round(+sc.score || 0)))
    const tone = score >= 70 ? 'high' : score >= 45 ? 'mid' : 'low'
    const word = tone === 'high' ? 'high risk' : tone === 'mid' ? 'medium risk' : 'low risk'
    const cats = sc.categories || {}
    const card = el('div', 'scard')
    card.innerHTML =
      `<div class="scard-head"><span class="scard-label">Risk score</span>` +
      `<span class="scard-score ${tone}">${score}/100 · ${word}</span></div>` +
      (Object.keys(cats).length
        ? `<div class="scard-bars">` + Object.entries(cats).map(([k, v]) =>
            `<div class="scard-bar"><span class="scard-bar-name">${escHtml(k.replace(/_/g, ' '))}</span>` +
            `<div class="scard-bar-track" aria-hidden="true"><div class="scard-bar-fill" style="width:${Math.max(2, Math.min(100, +v || 0))}%"></div></div>` +
            `<span class="scard-bar-val">${+v || 0}%</span></div>`).join('') + `</div>`
        : '') +
      (sc.summary ? `<div class="scard-sum">${escHtml(sc.summary)}</div>` : '')
    appendToChat(card)
  }

  /* Jump to a part of the document (search-select its first words). */
  async function jumpToSection(idx) {
    try {
      const r = await api('/api/document/section', { method: 'POST', body: { docId, index: idx } })
      const snippet = String(r.text || '').split('\n').filter(Boolean)[0] || ''
      if (!snippet) throw new Error('anchor not found in document')
      await selectText(snippet)
    } catch (err) {
      addError(err, 'load')
    }
  }

  /** Select the first match of `text` (≤ 250 characters probed) in Word. */
  async function selectText(text) {
    let probe = String(text || '').replace(/\s+/g, ' ').trim()
    if (probe.length > 120) { probe = probe.slice(0, 120); const sp = probe.lastIndexOf(' '); if (sp > 60) probe = probe.slice(0, sp) }
    if (!probe) throw new Error('anchor not found in document')
    await Word.run(async (context) => {
      const res = context.document.body.search(probe, { matchCase: false })
      res.load('items')
      await context.sync()
      if (!res.items.length) throw new Error('anchor not found in document')
      res.items[0].select()
      await context.sync()
    })
  }

  // ── Word-native helpers ──────────────────────────────────────────────────
  async function reviewAll(action) {
    try {
      await Word.run(async (context) => {
        if (action === 'accept') context.document.acceptAllRevisionsShown()
        else context.document.rejectAllRevisionsShown()
        await context.sync()
      })
      addNote(action === 'accept' ? '✓ Accepted all tracked changes shown in Word.' : '✓ Rejected all tracked changes shown in Word.')
    } catch (err) { addError(err, 'apply') }
  }

  function bindCompare() {
    const fileInput = $('#compareFile')
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0]
      fileInput.value = ''
      if (!f) return
      addNote('Comparing — Word marks every difference as a tracked change…')
      try {
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result).split(',')[1] || '')
          r.onerror = () => reject(new Error('could not read file'))
          r.readAsDataURL(f)
        })
        await Word.run(async (context) => {
          context.document.compareFromBase64(b64, { author: 'OpenLex Compare' })
          await context.sync()
        })
        const revisions = await extractRevisions()
        if (!revisions.length) { addNote('No differences found.'); return }
        const text = 'Summarize the differences in this contract compared to the counterparty version. ' +
          'Group by clause; say what changed, who it favors, and what to push back on.\n\nDIFFERENCES:\n' +
          revisions.slice(0, 40).map((r) => `[${r.type}] ${r.text}`).join('\n')
        ask(text, { display: `Explain the differences from “${f.name}”` })
      } catch (err) { addError(err, 'load') }
    })
  }

  async function extractRevisions() {
    return Word.run(async (context) => {
      const revs = context.document.revisions
      revs.load('items')
      await context.sync()
      const items = revs.items.slice(0, 60)
      for (const r of items) { r.load('type'); r.range.load('text') }
      await context.sync()
      const out = []
      for (const r of items) {
        const t = String(r.text || '').trim()
        if (t) out.push({ type: r.type || 'change', text: t.slice(0, 220) })
      }
      return out
    })
  }

  async function commentDigest() {
    try {
      const comments = await Word.run(async (context) => {
        const cs = context.document.comments
        cs.load('items')
        await context.sync()
        const items = cs.items.slice(0, 50)
        const out = []
        for (const c of items) {
          c.load('content')
          const r = c.getRange()
          r.load('text')
          out.push({ c, r })
        }
        await context.sync()
        return out.map(({ c, r }) => `comment: ${String(c.content || '').slice(0, 200)} | on: ${String(r.text || '').slice(0, 120)}`)
      })
      if (!comments.length) { addNote('There are no comments in this document.'); return }
      ask('Draft a response memo addressing the comments on this document:\n\n' + comments.join('\n'), { display: `Answer the ${P.words.plural(comments.length, 'comment')} in this document` })
    } catch (err) { addError(err, 'comment') }
  }

  function xrefCheck() {
    if (!docText || !docMap) { addNote('OpenLex has not read the document yet — try again in a moment.'); autoMap(); return }
    const nums = new Set((docMap.sections || []).map((s) => String(s.index)))
    const re = /(?:Section|§|Artikel|Article)\s+(\d{1,3})(?!\.\d)/gi
    const broken = new Set()
    let m
    while ((m = re.exec(docText))) {
      if (nums.has(m[1])) continue
      const line = docText.slice(Math.max(0, m.index - 60), m.index + 20).replace(/\s+/g, ' ').trim()
      broken.add(`${m[0]} → ${line.slice(-90)}`)
    }
    if (!broken.size) { addNote('✓ No broken cross-references found.'); return }
    const card = el('div', 'msg note')
    card.appendChild(el('div', null, `! ${P.words.plural(broken.size, 'possible broken cross-reference')}:`))
    const ul = el('ul')
    ;[...broken].slice(0, 15).forEach((b) => ul.appendChild(el('li', null, b)))
    card.appendChild(ul)
    appendToChat(card)
  }

  function obligCheck() {
    if (!docText) { addNote('OpenLex has not read the document yet — try again in a moment.'); autoMap(); return }
    const lines = String(docText).split(/\n+/).map((l) => l.trim()).filter((l) => /(shall|must not|may not|undertakes to|agrees to|warrants)\b/i.test(l))
    const uniq = [...new Set(lines)].slice(0, 30)
    if (!uniq.length) { addNote('No obligations ("shall", "must", "undertakes to" …) found in this document.'); return }
    const card = el('div', 'oclist')
    card.appendChild(el('div', 'scard-label', `Obligations (${uniq.length}) — tick them off`))
    uniq.forEach((l) => {
      const lab = el('label', 'oc-line')
      const cb = el('input')
      cb.type = 'checkbox'
      lab.append(cb, el('span', null, l.slice(0, 160)))
      card.appendChild(lab)
    })
    appendToChat(card)
  }

  // ── Proposed changes (secondary view) ────────────────────────────────────
  function bindSuggestionsList() {
    const list = $('#sugList')
    const bar = el('div', 'sugbar')
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', 'Filter and act on all')
    const filters = [['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]
    let cur = 'all'
    const apply = () => {
      document.querySelectorAll('#sugList .sug').forEach((x) => { x.hidden = !(cur === 'all' || x.dataset.sev === cur) })
    }
    for (const [f, label] of filters) {
      const b = el('button', 'sug-filter' + (f === 'all' ? ' active' : ''), label)
      b.type = 'button'
      b.setAttribute('aria-pressed', f === 'all' ? 'true' : 'false')
      b.addEventListener('click', () => {
        cur = f
        bar.querySelectorAll('.sug-filter').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false') })
        apply()
      })
      bar.appendChild(b)
    }
    const dismissAll = el('button', 'btn btn-ghost btn-small', 'Dismiss all shown')
    dismissAll.type = 'button'
    dismissAll.addEventListener('click', () => document.querySelectorAll('#sugList .sug').forEach((x) => { if (!x.hidden) x.remove() }))
    bar.appendChild(dismissAll)
    list.parentNode.insertBefore(bar, list)
  }

  // Mark cards whose words no longer exist in the document.
  function markStale(card, s) {
    if (!card || !s || !s.anchor || !s.anchor.text) return
    if (docText && !docText.replace(/\s+/g, ' ').includes(s.anchor.text.replace(/\s+/g, ' ').slice(0, 120))) {
      const note = el('div', 'basis stale', '! The document changed here since OpenLex read it — check before putting it in.')
      card.insertBefore(note, card.querySelector('.sug-actions') || null)
    }
  }

  // ── Selection: one hint "With the selected text: Explain · Rewrite · Check" ─
  function bindSelection() {
    if (!Office.context.document || !Office.context.document.addHandlerAsync) return
    let timer = null
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => {
      clearTimeout(timer)
      timer = setTimeout(readSelection, 400)
    })
  }
  let selHintId = null
  async function readSelection() {
    try {
      const value = await new Promise((resolve, reject) => {
        Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
          if (r.status === Office.AsyncResultStatus.Succeeded) resolve(r.value)
          else reject(new Error(r.error && r.error.message))
        })
      })
      const text = String(value || '').trim()
      if (!text || text.length > 6000) { if (selHintId) withdrawHint(selHintId); selHintId = null; return }
      selHintId = 'selection:' + text.slice(0, 40)
      const act = (verb, label) => ({ label, run: () => ask(`${verb} the following selected text:\n"${text}"`, { display: `${verb}: “${P.words.clip(text, 80)}”` }) })
      offerHint({ id: selHintId, priority: 2, text: 'With the selected text:', actions: [act('Explain', 'Explain'), act('Rewrite for the client', 'Rewrite for the client'), act('Check compliance', 'Check')] })
    } catch { if (selHintId) withdrawHint(selHintId) }
  }

  // ── Document outline ─────────────────────────────────────────────────────
  let docMap = null
  let docId = null
  let docText = null

  function bindDocMap() {
    $('#scanDoc').addEventListener('click', async () => {
      try {
        const body = await getDocTextAndStyles()
        const map = await mapBody(body)
        docMap = map
        docId = map.doc_id
        docText = body.text
        $('#docmeta').textContent = `${P.words.plural(map.sections.length, 'part')} · ${body.text.length.toLocaleString()} characters`
        renderTree(map)
      } catch (err) {
        addError(err, 'load')
      }
    })
  }

  function renderTree(map) {
    const tree = $('#doctree')
    tree.innerHTML = ''
    if (!map.sections || !map.sections.length) {
      tree.appendChild(el('div', 'muted', 'No headings found — the document may be plain text.'))
      return
    }
    map.sections.forEach((s) => {
      const node = el('button', 'node lvl' + Math.min(s.level || 0, 2))
      node.type = 'button'
      node.dataset.idx = s.index
      node.appendChild(el('span', null, s.heading || ('Part ' + (s.index + 1))))
      if (s.flags) node.appendChild(el('span', 'badge', `${s.flags} ! to check`))
      node.addEventListener('click', () => { showView('chat'); jumpToSection(s.index) })
      tree.appendChild(node)
    })
  }

  async function getDocText() {
    return Word.run(async (context) => {
      const body = context.document.body
      body.load('text')
      await context.sync()
      return body.text
    })
  }

  /* Body text + the real paragraph styles (styleBuiltIn — locale-independent
   * Heading1..6 / Title), aligned to the engine's paragraphs (blanks skipped). */
  async function getDocTextAndStyles() {
    return Word.run(async (context) => {
      const body = context.document.body
      body.load('text')
      const paras = body.paragraphs
      paras.load('items')
      await context.sync()
      for (const p of paras.items) { p.load('styleBuiltIn'); p.load('text') }
      await context.sync()
      const styles = []
      for (const p of paras.items) {
        if (!String(p.text || '').trim()) continue
        styles.push(p.styleBuiltIn || null)
      }
      return { text: body.text, styles }
    })
  }
  function mapBody(body) {
    return api('/api/document/map', { method: 'POST', body: { docId, text: body.text, styles: body.styles } })
  }

  // ── Suggestions ───────────────────────────────────────────────────────────
  const SEV_MARK = { high: '▲ High', medium: '◆ Medium', low: '● Low' }
  const NOOP_RE = /^(n\/?a|please specify|please provide|need clarification|i need more|not enough|no change|no rewrite|not applicable|unchanged|as is|none|nothing)/i
  const isRealRewrite = (s) => !!(s && s.proposed_text && s.proposed_text.trim().length >= 40 && !NOOP_RE.test(s.proposed_text.trim()))

  function checkEl(s) {
    const c = P.sources.checkLine(s)
    const d = el('div', 'basis check ' + (c.ok ? 'ok' : 'warn'), c.ok ? c.text : '! ' + c.text)
    return d
  }

  function sugBody(card, s) {
    const head = el('div', 'sug-head')
    head.append(el('span', 'sug-sum', s.summary || 'Proposed change'), el('span', 'sev ' + (s.severity || 'low'), SEV_MARK[s.severity] || SEV_MARK.low))
    card.appendChild(head)
    if ((s.clauseText || s.anchor) && s.proposed_text) card.insertAdjacentHTML('beforeend', diffHtml(s.anchor && s.anchor.wholeParagraph ? (s.clauseText || s.anchor.text) : (s.anchor ? s.anchor.text : s.clauseText), s.proposed_text))
    else if (s.proposed_text) card.appendChild(el('div', 'muted', s.proposed_text))
    card.appendChild(checkEl(s))
    for (const f of s.flags || []) card.appendChild(el('div', 'basis cite-warn', '! Firm rule: ' + f))
    bindDiffFull(card)
    markStale(card, s)
  }

  // The full list (secondary view "Proposed changes").
  function renderSuggestion(s) {
    if (!s) return
    const item = el('div', 'sug')
    item.id = 'sug-' + s.id
    item.dataset.sev = s.severity || 'low'
    sugBody(item, s)
    const acts = el('div', 'sug-actions')
    if (s.proposed_text) {
      const a = el('button', 'btn btn-small', 'Put in the document')
      a.type = 'button'
      a.addEventListener('click', async () => {
        try { await applySuggestion(s); item.remove() } catch (err) { anchorError(err, s) }
      })
      acts.appendChild(a)
    }
    const c = el('button', 'btn btn-ghost btn-small', 'Add as comment')
    c.type = 'button'
    c.addEventListener('click', async () => { try { await commentSuggestion(s); item.remove() } catch (err) { anchorError(err, s) } })
    const d = el('button', 'btn btn-ghost btn-small', 'Dismiss')
    d.type = 'button'
    d.addEventListener('click', () => item.remove())
    acts.append(c, d)
    item.appendChild(acts)
    $('#sugList').prepend(item)
  }

  /** A change could not be put into the document: explain, and offer a comment instead. */
  function anchorError(err, s, clause) {
    addError(err, 'apply', { actions: [{ label: 'Insert as comment instead', doing: 'comment', run: async () => { const where = await commentAnywhere(s, clause); addNote(`✓ Added as a comment ${where}.`) } }] })
  }

  /* A suggestion card in the conversation. Clause rewrites asked for in the
   * chat go into the document right away as a TRACKED change (reversible in
   * Word's Review tab); everything else waits for the lawyer. */
  function renderChatSuggestion(s, autoTrack = false) {
    if (!s) return
    const card = el('div', 'sug chat-sug')
    card.id = 'chat-sug-' + s.id
    const sec = docMap && docMap.sections ? docMap.sections.find((x) => x.index === s.sectionIndex) : null
    const loc = sec ? P.words.cap(P.words.clauseName(sec)) : (s.anchor && s.anchor.text ? 'In: “' + P.words.clip(s.anchor.text, 70) + '”' : '')
    sugBody(card, s)
    if (loc) card.insertBefore(el('div', 'basis loc', loc + (s.anchor && s.anchor.wholeParagraph ? ' — replaces the whole clause' : '')), card.children[1] || null)
    const acts = el('div', 'sug-actions')
    const ok = el('button', 'btn btn-small chat-approve', 'Put in the document')
    ok.type = 'button'
    const later = el('button', 'btn btn-ghost btn-small', 'Decide later')
    later.type = 'button'
    const no = el('button', 'btn btn-ghost btn-small', 'Dismiss')
    no.type = 'button'
    acts.append(ok, later, no)
    card.appendChild(acts)
    if (!s.proposed_text) ok.hidden = true
    ok.addEventListener('click', async () => {
      if (s._applied) return
      s._applied = true
      try {
        await applySuggestion(s)
        settleChatCard(card, '✓ In the document as a tracked change — accept or reject it in Word (Review tab).', true)
        const tabCard = document.getElementById('sug-' + s.id)
        if (tabCard) tabCard.remove()
      } catch (err) { s._applied = false; anchorError(err, s) }
    })
    later.addEventListener('click', () => { if (!s._applied) settleChatCard(card, 'Kept for later — find it under ☰ → Proposed changes.') })
    no.addEventListener('click', () => {
      if (s._applied) return
      const tabCard = document.getElementById('sug-' + s.id)
      if (tabCard) tabCard.remove()
      card.remove()
    })
    appendToChat(card)

    // Never auto-apply a non-rewrite ("N/A", "please specify…" would REPLACE a clause).
    const isClauseRewrite = isRealRewrite(s) && (s.sectionIndex != null || (s.anchor && s.anchor.wholeParagraph))
    if (autoTrack && isClauseRewrite && Office.context.requirements.isSetSupported('WordApi', 1.4)) {
      s._applied = true
      applySuggestion(s, { forceTracked: true, silent: true })
        .then(() => {
          settleChatCard(card, '✓ In the document as a tracked change — accept or reject it in Word (Review tab).', true)
          const tabCard = document.getElementById('sug-' + s.id)
          if (tabCard) tabCard.remove()
        })
        .catch((err) => { s._applied = false; anchorError(err, s) })
    }
  }

  function settleChatCard(card, msg, applied) {
    card.appendChild(el('div', 'basis settled-note', msg))
    card.classList.add('settled')
    const actions = card.querySelector('.sug-actions')
    if (actions) actions.remove()
    if (applied) card.classList.add('applied')
  }

  /** Add a Word comment (WordApi 1.4 range.insertComment) on the suggestion's words. */
  async function commentSuggestion(s, text) {
    if (!s.anchor || !s.anchor.text) throw new Error('Suggestion has no anchor text')
    if (!Office.context.requirements.isSetSupported('WordApi', 1.4)) throw new Error('Word comments are not available in this Word version')
    return Word.run(async (context) => {
      const range = await findRange(context, s.anchor.text)
      if (!range) throw new Error('anchored text no longer present (document edited?)')
      range.insertComment(text || P.sources.commentText(s))
      await context.sync()
    })
  }

  /**
   * "Insert as comment instead": on the suggestion's words if found, else on
   * the clause heading, else at the lawyer's current selection. Returns
   * where it went, in words.
   */
  async function commentAnywhere(s, clause) {
    if (!Office.context.requirements.isSetSupported('WordApi', 1.4)) throw new Error('Word comments are not available in this Word version')
    const text = P.sources.commentText(s) + (s.proposed_text ? `\n\nProposed wording:\n${s.proposed_text}` : '')
    return Word.run(async (context) => {
      let range = s.anchor && s.anchor.text ? await findRange(context, s.anchor.text.slice(0, 80)) : null
      let where = 'on the words it is about'
      if (!range && clause && clause.heading) { range = await findRange(context, clause.heading); where = `on the heading of ${P.words.clauseName(clause)}` }
      if (!range) { range = context.document.getSelection(); where = 'where your cursor is' }
      range.insertComment(text)
      await context.sync()
      return where
    })
  }

  /** First range matching `text` (Word searches at most 255 characters). */
  async function findRange(context, text) {
    let probe = String(text || '').trim()
    if (!probe) return null
    if (probe.length > 250) { probe = probe.slice(0, 250); const sp = probe.lastIndexOf(' '); if (sp >= 120) probe = probe.slice(0, sp) }
    const res = context.document.body.search(probe, { matchCase: true })
    res.load('items')
    await context.sync()
    return res.items.length ? res.items[0] : null
  }

  // Put a suggestion into the document:
  //   tracked (default): set TrackAll → replace → restore the prior mode,
  //     so it lands as a native Word redline. Refused when tracking is not
  //     available, unless the lawyer chose direct edits.
  //   permanent: plain replace (the pane's preview was the review).
  // opts.forceTracked: always tracked (automatic and review placements).
  let applyMode = 'tracked' // synced from /api/config/agent
  async function applySuggestion(s, opts = {}) {
    if (!s.proposed_text) throw new Error('Suggestion has no replacement text — cannot apply')
    if (!s.anchor || !String(s.anchor.text || '').trim()) throw new Error('Suggestion has no anchor text — cannot locate the clause in Word')
    const wantTracked = opts.forceTracked ? true : applyMode === 'tracked'
    if (wantTracked && !Office.context.requirements.isSetSupported('WordApi', 1.4)) {
      throw new Error('Tracked changes are not available in this document (Compatibility Mode?)')
    }
    return Word.run(async (context) => {
      let target = null
      // Deterministic path first: the paragraph the engine mapped the clause
      // to — verified against the anchor before touching it.
      if (s.paraIndex != null) {
        try {
          const paras = context.document.body.paragraphs
          paras.load('items')
          await context.sync()
          const p = paras.items[s.paraIndex]
          if (p) {
            p.load('text')
            await context.sync()
            const first = String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, 60)
            const anchorProbe = String(s.anchor.text || '').replace(/\s+/g, ' ').trim().slice(0, 60)
            if (first && anchorProbe && (first.startsWith(anchorProbe) || anchorProbe.startsWith(first))) target = p
          }
        } catch { /* fall through to search */ }
      }
      if (!target) {
        const probed = s.anchor.text.length > 250
        target = await findRange(context, s.anchor.text)
        if (!target) throw new Error('anchored text no longer present (document edited?)')
        // Whole-clause rewrite (or a truncated probe): replace the whole paragraph.
        if (s.anchor.wholeParagraph || probed) {
          try {
            const paras = typeof target.getParagraphs === 'function' ? target.getParagraphs() : target.paragraphs
            paras.load('items')
            await context.sync()
            if (paras.items.length) target = paras.items[0]
          } catch { /* degrade to the matched range */ }
        }
      }
      let originalText = ''
      try { target.load('text'); await context.sync(); originalText = String(target.text || '') } catch { /* best effort */ }

      if (wantTracked) {
        context.document.load('changeTrackingMode')
        await context.sync()
        const prior = context.document.changeTrackingMode
        context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll
        await context.sync()
        // Hosts in Compatibility Mode can accept the setting and ignore it.
        context.document.load('changeTrackingMode')
        await context.sync()
        if (context.document.changeTrackingMode !== Word.ChangeTrackingMode.trackAll) {
          context.document.changeTrackingMode = prior
          await context.sync()
          throw new Error('Tracked changes are not available in this document (Compatibility Mode?)')
        }
        try {
          target.insertText(s.proposed_text, Word.InsertLocation.replace)
          await context.sync()
        } finally {
          context.document.changeTrackingMode = prior
          await context.sync()
        }
        if (!opts.silent) addNote('✓ In the document as a tracked change — accept or reject it in Word (Review tab).')
      } else {
        target.insertText(s.proposed_text, Word.InsertLocation.replace)
        await context.sync()
      }
      if (originalText) pushApplied({ original: originalText, applied: s.proposed_text, wholeParagraph: !!(s.anchor && s.anchor.wholeParagraph) })
    })
  }

  /** Accept or reject the tracked change OpenLex made for a suggestion (WordApi 1.6). */
  async function decideInWord(s, accept) {
    if (!Office.context.requirements.isSetSupported('WordApi', 1.6)) return false
    return Word.run(async (context) => {
      const range = await findRange(context, String(s.proposed_text || '').slice(0, 200))
      if (!range || typeof range.getTrackedChanges !== 'function') return false
      const tcs = range.getTrackedChanges()
      tcs.load('items')
      await context.sync()
      if (!tcs.items.length) return false
      if (accept) tcs.acceptAll(); else tcs.rejectAll()
      await context.sync()
      return true
    })
  }

  // ── Undo the last change OpenLex made ─────────────────────────────────────
  let appliedStack = []
  function pushApplied(entry) { appliedStack.push(entry); updateUndoBtn() }
  function updateUndoBtn() { $('#undoBtn').disabled = appliedStack.length === 0 }
  async function undoLast() {
    const entry = appliedStack.pop()
    if (!entry) return
    try {
      await Word.run(async (context) => {
        let target = await findRange(context, String(entry.applied || '').slice(0, 200))
        if (!target) throw new Error('applied text no longer present — undo skipped')
        if (entry.wholeParagraph || String(entry.applied || '').length > 200) {
          try {
            const paras = typeof target.getParagraphs === 'function' ? target.getParagraphs() : target.paragraphs
            paras.load('items')
            await context.sync()
            if (paras.items.length) target = paras.items[0]
          } catch { /* degrade to the matched range */ }
        }
        context.document.load('changeTrackingMode')
        await context.sync()
        const prior = context.document.changeTrackingMode
        context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll
        await context.sync()
        try {
          target.insertText(entry.original, Word.InsertLocation.replace)
          await context.sync()
        } finally {
          context.document.changeTrackingMode = prior
          await context.sync()
        }
      })
      addNote('↩ Undone — the original wording is back, as a tracked change.')
    } catch (err) {
      addError(err, 'apply')
    }
    updateUndoBtn()
  }
  function bindUndo() {
    $('#undoBtn').addEventListener('click', undoLast)
    updateUndoBtn()
  }

  // Preview: original struck through, proposed in bold; long clauses fold.
  function diffHtml(oldText, newText) {
    const esc = escHtml
    if (!newText) return ''
    const full = String(oldText || '')
    const long = full.length > 300
    const shown = long ? full.slice(0, 300) + '…' : full
    return `<div class="diff">
      <div class="diff-old"><span class="muted">Now:</span> <s>${esc(shown)}</s>` +
      (long ? `<button type="button" class="btn btn-ghost btn-small diff-full" data-full="${esc(full)}">Show the whole clause</button>` : '') + `</div>
      <div class="diff-new"><span class="muted">Proposed:</span> <b>${esc(newText)}</b></div>
    </div>`
  }
  function bindDiffFull(card) {
    const df = card && card.querySelector('.diff-full')
    if (!df) return
    df.addEventListener('click', () => {
      const s = df.parentElement && df.parentElement.querySelector('s')
      if (s) s.textContent = df.dataset.full
      df.remove()
    })
  }

  // ── Review this contract (the main action) ───────────────────────────────
  function bindReview() {
    const side = $('#rvSide')
    for (const [k, label] of P.review.SIDES) { const o = el('option', null, label); o.value = k; side.appendChild(o) }
    side.value = store.get('openlex-review-side', 'neutral')
    const focus = $('#rvFocus')
    for (const [k, label] of P.review.FOCUS) {
      const lab = el('label', 'row')
      const cb = el('input')
      cb.type = 'checkbox'
      cb.value = k
      lab.append(cb, document.createTextNode(' ' + label))
      focus.appendChild(lab)
    }
    $('#reviewBtn').addEventListener('click', () => runReview(reviewOptions()))
    $('#reviewOptsBtn').addEventListener('click', () => { if ($('#reviewOpts').hidden) openReviewOptions(); else closeReviewOptions() })
    $('#rvClose').addEventListener('click', closeReviewOptions)
    $('#rvStart').addEventListener('click', () => { closeReviewOptions(); runReview(reviewOptions()) })
    $('#reviewOpts').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeReviewOptions() } })
  }
  function openReviewOptions() {
    showView('chat')
    $('#reviewOpts').hidden = false
    $('#reviewOptsBtn').setAttribute('aria-expanded', 'true')
    $('#rvSide').focus()
  }
  function closeReviewOptions() {
    $('#reviewOpts').hidden = true
    $('#reviewOptsBtn').setAttribute('aria-expanded', 'false')
    $('#reviewOptsBtn').focus()
  }
  function reviewOptions() {
    store.set('openlex-review-side', $('#rvSide').value)
    return {
      side: $('#rvSide').value,
      playbook: $('#rvPlaybook').value || '',
      focus: [...document.querySelectorAll('#rvFocus input:checked')].map((x) => x.value),
    }
  }
  async function loadReviewPlaybooks() {
    try {
      const r = await api('/api/workflows/playbooks')
      const sel = $('#rvPlaybook')
      for (const pb of r.playbooks.filter((x) => x.name)) {
        const o = el('option', null, `Checklist: ${pb.title}${pb.firm ? ' (your firm)' : ''}`)
        o.value = pb.name
        sel.appendChild(o)
      }
    } catch { /* engine offline — no checklists */ }
  }

  async function runReview(opts) {
    if (busy) { announce('OpenLex is still working on the last request.', true); return }
    if (!sidecarOk) { addError('engine offline', 'review'); return }
    showView('chat')
    let body
    try { body = await getDocTextAndStyles() } catch (err) { addError(err, 'review'); return }
    if (!body.text || !body.text.trim()) { addNote('This document is empty — there is nothing to review yet.'); return }
    addNote('Review this contract' + describeOptions(opts), 'user')
    const t = newTurn()
    const rv = { state: P.review.start(opts, now()), placing: Promise.resolve() }
    t.review = rv
    const card = reviewCard(t)
    const abort = new AbortController()
    setBusy({ kind: 'review', abort })
    try {
      const res = await fetch(SIDECAR + '/api/document/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body.text.slice(0, 400000), styles: body.styles, docId, side: opts.side, playbook: opts.playbook, focus: opts.focus, interactive: true }),
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(await res.text())
      await readSse(res, (evt) => {
        t.act = P.activity.apply(t.act, evt, now())
        rv.state = P.review.apply(rv.state, evt, now())
        renderActivity(t)
        if (evt.type === 'model' || evt.type === 'step') updateDataLine(t.act, true)
        if (evt.type === 'step' && evt.kind === 'clause') announce(P.review.progressLine(rv.state, now()))
        if (evt.type === 'suggestion') {
          const f = rv.state.findings[rv.state.findings.length - 1]
          rv.placing = rv.placing.then(() => placeFinding(t, f.id))
          renderSuggestion(evt.suggestion)
        }
        if (evt.type === 'permission') addPermissionCard(evt)
        if (evt.type === 'permission_result') closePermissionCard(evt)
        if (evt.type === 'warning') addNote('Note: ' + (evt.message || ''), 'warn')
        if (evt.type === 'error' && !evt.recoverable) addError(evt.message, 'review')
        renderReviewCard(t, card)
      })
    } catch (err) {
      if (!(err && err.name === 'AbortError')) {
        rv.state = P.review.apply(rv.state, { type: 'error', message: err.message }, now())
        addError(err, 'review')
      }
    }
    if (busy && busy.stopped) rv.state = P.review.stop(rv.state, now())
    else if (!rv.state.endedAt) rv.state = P.review.apply(rv.state, { type: 'done' }, now())
    await rv.placing
    finishTurn(t)
    setBusy(null)
    renderReviewCard(t, card)
    announce(`Review finished: ${P.review.summaryLine(rv.state)}.`, true)
  }

  function describeOptions(o) {
    const side = P.review.SIDES.find(([k]) => k === o.side)
    const parts = []
    if (side && o.side !== 'neutral') parts.push(`for ${side[1].toLowerCase()}`)
    if (o.playbook) parts.push(`against “${$('#rvPlaybook').selectedOptions[0].textContent.replace(/^Checklist: /, '')}”`)
    if (o.focus && o.focus.length) parts.push(`focus: ${o.focus.map((f) => (P.review.FOCUS.find(([k]) => k === f) || [f, f])[1].toLowerCase()).join(', ')}`)
    return parts.length ? ' — ' + parts.join(' · ') : ''
  }

  /** Put one finding into Word: tracked change and/or comment with the legal basis. */
  async function placeFinding(t, id) {
    const rv = t.review
    const f = rv.state.findings.find((x) => x.id === id)
    if (!f) return
    const s = f.suggestion
    const wantTracked = $('#applyTracked').checked && isRealRewrite(s)
    const wantComment = $('#postComments').checked
    let placed = 'none'
    try {
      if (wantTracked) { await applySuggestion(s, { forceTracked: true, silent: true }); placed = 'tracked' }
      if (wantComment) { await commentSuggestion(s); placed = placed === 'tracked' ? 'tracked+comment' : 'comment' }
      rv.state = P.review.setPlaced(rv.state, id, placed)
    } catch (err) {
      rv.state = P.review.setPlaced(rv.state, id, placed === 'none' ? 'failed' : placed, placed === 'none' ? P.review.anchorProblem(err) : '')
    }
  }

  const PLACED_WORDS = {
    tracked: 'In the document as a tracked change.',
    comment: 'In the document as a comment.',
    'tracked+comment': 'In the document as a tracked change with a comment.',
    none: 'Only listed here (comments and tracked changes are off in Settings).',
    pending: 'Being put into the document…',
  }

  function reviewCard(t) {
    const card = el('section', 'rcard')
    card.setAttribute('aria-label', 'Contract review')
    t.el.appendChild(card)
    return card
  }

  function renderReviewCard(t, card) {
    const st = t.review.state
    const done = !!st.endedAt
    card.innerHTML = ''
    const head = el('div', 'rc-head', done ? P.review.summaryLine(st) : P.review.progressLine(st, now()))
    card.appendChild(head)
    if (!done) {
      const pct = st.total ? Math.round((Math.max(st.position, 0) / st.total) * 100) : 0
      const bar = el('div', 'rc-bar')
      bar.setAttribute('role', 'progressbar')
      bar.setAttribute('aria-valuemin', '0')
      bar.setAttribute('aria-valuemax', String(st.total || 0))
      bar.setAttribute('aria-valuenow', String(Math.max(st.position, 0)))
      bar.setAttribute('aria-label', 'Clauses reviewed')
      const fill = el('div', 'rc-fill')
      fill.style.width = pct + '%'
      bar.appendChild(fill)
      card.append(bar, el('div', 'rc-sub muted', st.findings.length ? `${P.words.plural(st.findings.length, 'finding')} so far: ${P.review.summaryLine(st)}` : 'No findings yet.'))
      scrollChat(false)
      return
    }
    const c = P.review.counts(st)
    const sub = [P.review.endLine(st), c.total ? P.review.decisionLine(st) : ''].filter(Boolean).join(' ')
    card.appendChild(el('div', 'rc-sub', sub))
    if (c.notPlaced) card.appendChild(el('div', 'rc-warn', `! ${P.words.plural(c.notPlaced, 'finding')} could not be marked in the document — open the details to add ${c.notPlaced === 1 ? 'it' : 'them'} as a comment.`))
    for (const p of st.problems) card.appendChild(el('div', 'rc-warn', '! ' + p))
    if (c.total) {
      const tog = el('button', 'btn btn-ghost btn-small rc-toggle', `Show the ${P.words.plural(c.total, 'finding')}`)
      tog.type = 'button'
      tog.setAttribute('aria-expanded', t.review.open ? 'true' : 'false')
      const list = el('ol', 'rc-list')
      list.hidden = !t.review.open
      tog.addEventListener('click', () => { t.review.open = !t.review.open; renderReviewCard(t, card); const b = card.querySelector('.rc-toggle'); if (b) b.focus() })
      if (t.review.open) { tog.textContent = 'Hide the findings'; for (const f of P.review.ordered(st)) list.appendChild(findingItem(t, card, f)) }
      card.append(tog, list)
    }
    const ex = el('div', 'btn-row rc-export')
    for (const [fmt, label] of [['docx', 'Save the review as Word'], ['pdf', 'Save as PDF']]) {
      const b = el('button', 'btn btn-ghost btn-small', label)
      b.type = 'button'
      b.addEventListener('click', () => exportReview(t, fmt, b))
      ex.appendChild(b)
    }
    card.appendChild(ex)
  }

  function findingItem(t, card, f) {
    const li = el('li', 'rc-item sev-' + f.severity)
    const top = el('div', 'rc-item-head')
    top.append(el('span', 'sev ' + f.severity, SEV_MARK[f.severity]), el('span', 'rc-clause', f.clause ? P.words.cap(f.clause) : ''))
    li.append(top, el('div', 'rc-sum', f.summary))
    li.appendChild(el('div', 'basis check ' + (f.check.ok ? 'ok' : 'warn'), f.check.ok ? f.check.text : '! ' + f.check.text))
    li.appendChild(el('div', 'basis', f.placed === 'failed' ? '! ' + f.problem : PLACED_WORDS[f.placed] || ''))
    if (f.status !== 'open') li.appendChild(el('div', 'basis decided', f.status === 'accepted' ? '✓ Accepted' : '✕ Rejected'))
    const acts = el('div', 'sug-actions')
    const btn = (label, run, primary) => { const b = el('button', primary ? 'btn btn-small' : 'btn btn-ghost btn-small', label); b.type = 'button'; b.addEventListener('click', async () => { b.disabled = true; try { await run() } catch (err) { addError(err, 'apply') } b.disabled = false }); acts.appendChild(b) }
    const s = f.suggestion
    if (f.placed === 'failed') {
      btn('Insert as comment instead', async () => {
        const where = await commentAnywhere(s, s.clause)
        t.review.state = P.review.setPlaced(t.review.state, f.id, 'comment')
        addNote(`✓ Added as a comment ${where}.`)
        renderReviewCard(t, card)
      }, true)
    } else {
      btn('Show in the document', () => selectText((s.anchor && s.anchor.text) || s.proposed_text || ''))
    }
    if (f.status === 'open') {
      btn('Accept', async () => { const inWord = f.placed.startsWith('tracked') ? await decideInWord(s, true) : false; decided(t, card, f, 'accepted', inWord) })
      btn('Reject', async () => { const inWord = f.placed.startsWith('tracked') ? await decideInWord(s, false) : false; decided(t, card, f, 'rejected', inWord) })
    }
    li.appendChild(acts)
    return li
  }

  function decided(t, card, f, status, inWord) {
    t.review.state = P.review.decide(t.review.state, f.id, status)
    renderReviewCard(t, card)
    if (f.placed.startsWith('tracked') && !inWord) addNote(`Noted as ${status}. Also ${status === 'accepted' ? 'accept' : 'reject'} the tracked change in Word (Review tab) — this Word version does not let OpenLex do it.`)
    announce(`${P.words.cap(status)}. ${P.review.decisionLine(t.review.state)}.`, true)
  }

  async function exportReview(t, fmt, b) {
    b.disabled = true
    try {
      let title = 'Contract review'
      try { title = 'Review — ' + ((docMap && docMap.title) || 'contract') } catch { /* keep */ }
      const r = await api('/api/review/export', { method: 'POST', body: { ...P.review.exportPayload(t.review.state, title), format: fmt, docId, matterId: $('#matterSel').value || undefined } })
      const name = String(r.file || '').split(/[\\/]/).pop()
      const note = addNote(`✓ Saved in your files folder: ${name}`)
      const show = el('button', 'btn btn-ghost btn-small', 'Show the file')
      show.type = 'button'
      show.addEventListener('click', () => api('/api/workspace/reveal', { method: 'POST', body: { path: r.file } }).catch((err) => addError(err, 'load')))
      note.appendChild(show)
    } catch (err) { addError(err, 'export') }
    b.disabled = false
  }

  // ── Analyse this document / Matter overview (feature-detected hooks) ─────
  const ANALYSE_STEPS = { read: 'Reading the document', analyse: 'Finding parties, dates, obligations and risks', verify: 'Checking each finding against the document', law: 'Looking up the law', judge: 'Checking the findings hold up', write: 'Writing the summary' }

  async function runAnalyse() {
    if (!available.analyse) { addNote('Analysing documents is not available in this version of OpenLex yet.'); return }
    if (busy) return
    showView('chat')
    addNote('Analyse this document', 'user')
    const t = newTurn()
    const abort = new AbortController()
    setBusy({ kind: 'analyse', abort })
    let result = null
    try {
      const res = await fetch(SIDECAR + '/api/workflows/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'analyse', docId, text: docText || undefined, matterId: $('#matterSel').value || undefined }),
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(await res.text())
      await readSse(res, (evt) => {
        let ev = evt
        if (evt.type === 'progress' && !evt.plain) ev = { type: 'step', plain: ANALYSE_STEPS[evt.step] || 'Working on the analysis' }
        else if (evt.type === 'progress') ev = Object.assign({}, evt, { type: 'step' })
        t.act = P.activity.apply(t.act, ev, now())
        renderActivity(t)
        updateDataLine(t.act, true)
        if (evt.type === 'done') result = evt
        if (evt.type === 'error') addError(evt.message, 'load')
      })
    } catch (err) { if (!(err && err.name === 'AbortError')) addError(err, 'load') }
    finishTurn(t)
    setBusy(null)
    if (result) renderAnalysis(t, P.matter.analysis(result))
  }

  function renderAnalysis(t, a) {
    const card = el('section', 'rcard')
    card.setAttribute('aria-label', 'Analysis of this document')
    card.appendChild(el('div', 'rc-head', P.matter.analysisLine(a)))
    if (a.summary) { const md = el('div', 'md'); md.innerHTML = mdToHtml(a.summary); card.appendChild(md) }
    const d = el('details', 'rc-details')
    d.appendChild(el('summary', null, 'Show the details'))
    const list = el('ol', 'rc-list')
    a.risks.forEach((r, i) => {
      const li = el('li', 'rc-item sev-' + r.severity)
      li.append(el('span', 'sev ' + r.severity, SEV_MARK[r.severity]), el('div', 'rc-sum', r.why))
      if (r.law) li.appendChild(el('div', 'basis', 'Legal basis: ' + r.law))
      if (r.fix) li.appendChild(el('div', 'basis', 'Suggested fix: ' + r.fix))
      const acts = el('div', 'sug-actions')
      if (r.quote) { const b = el('button', 'btn btn-ghost btn-small', 'Show in the document'); b.type = 'button'; b.addEventListener('click', () => selectText(r.quote).catch((err) => addError(err, 'load'))); acts.appendChild(b) }
      const sug = P.matter.riskSuggestion(r, i)
      if (sug) { const b = el('button', 'btn btn-small', 'Apply the fix'); b.type = 'button'; b.addEventListener('click', async () => { b.disabled = true; try { await applySuggestion(sug, { forceTracked: true }); b.textContent = '✓ In the document' } catch (err) { b.disabled = false; anchorError(err, sug) } }); acts.appendChild(b) }
      li.appendChild(acts)
      list.appendChild(li)
    })
    d.appendChild(list)
    for (const [title, items] of [['Deadlines', a.deadlines], ['Obligations', a.obligations], ['Parties', a.parties]]) {
      if (!items.length) continue
      d.appendChild(el('h4', null, title))
      const ul = el('ul')
      for (const x of items.slice(0, 30)) ul.appendChild(el('li', null, x))
      d.appendChild(ul)
    }
    card.appendChild(d)
    t.el.appendChild(card)
  }

  async function showOverview() {
    const id = $('#matterSel').value
    if (!id) { addNote('Pick the matter first (at the top of the pane), then open the overview.'); $('#matterSel').focus(); return }
    try {
      const data = await api('/api/matters/overview?id=' + encodeURIComponent(id))
      const cards = P.matter.overview(data)
      const card = el('section', 'rcard')
      card.setAttribute('aria-label', 'Matter overview')
      const m = mattersCache.find((x) => x.id === id)
      card.appendChild(el('div', 'rc-head', `Matter overview${m ? ': ' + m.title : ''}`))
      const first = cards.find((c) => c.key === 'summary')
      if (first) card.appendChild(el('div', 'rc-sub', first.items.map((x) => x.text).join(' ')))
      for (const c of cards.filter((x) => x.key !== 'summary')) {
        const d = el('details', 'rc-details')
        d.appendChild(el('summary', null, `${c.title} (${c.items.length})`))
        const ul = el('ul')
        for (const it of c.items.slice(0, 40)) {
          const li = el('li', null, it.text)
          const from = P.matter.fromLine(it.from)
          if (from) li.appendChild(el('div', 'basis', 'From: ' + from))
          ul.appendChild(li)
        }
        d.appendChild(ul)
        card.appendChild(d)
      }
      if (!cards.length) card.appendChild(el('div', 'muted', 'Nothing recorded for this matter yet.'))
      showView('chat')
      appendToChat(card)
    } catch (err) { addError(err, 'load') }
  }

  // ── Calendar ─────────────────────────────────────────────────────────────
  async function bindCalendar() {
    const box = $('#calEnabled')
    const sel = $('#calProviderSel')
    try {
      const cfg = await api('/api/calendar/config')
      box.checked = !!cfg.enabled
      sel.value = cfg.provider || 'auto'
    } catch { /* engine offline */ }
    sel.addEventListener('change', async () => { try { await api('/api/calendar/config', { method: 'POST', body: { enabled: box.checked, provider: sel.value } }) } catch (err) { addError(err, 'settings') } })
    box.addEventListener('change', async () => { try { await api('/api/calendar/config', { method: 'POST', body: { enabled: box.checked } }) } catch (err) { addError(err, 'settings') } })
  }

  // ── Your files folder ────────────────────────────────────────────────────
  async function refreshWorkspace() {
    const list = $('#wsList')
    try {
      const ws = await api('/api/workspace')
      $('#wsPath').value = ws.base
      list.innerHTML = ''
      if (!ws.files.length) { list.textContent = 'Nothing saved yet.'; return }
      const ul = el('ul')
      for (const f of ws.files.slice(0, 100)) ul.appendChild(el('li', null, f.path))
      list.appendChild(ul)
    } catch { list.textContent = 'Not available right now.' }
  }
  function bindWorkspace() {
    $('#wsSave').addEventListener('click', async () => {
      try {
        const r = await api('/api/config/workspace', { method: 'POST', body: { path: $('#wsPath').value } })
        $('#wsPath').value = r.base
        refreshWorkspace()
      } catch (err) { addError(err, 'settings') }
    })
    $('#wsReveal').addEventListener('click', async () => {
      try { await api('/api/workspace/reveal', { method: 'POST', body: {} }) } catch (err) { addError(err, 'load') }
    })
    refreshWorkspace()
  }

  // ── Work across the matter ───────────────────────────────────────────────
  async function refreshPlaybooks() {
    const sel = $('#wfPlaybook')
    try {
      const r = await api('/api/workflows/playbooks')
      sel.innerHTML = ''
      for (const pb of r.playbooks) {
        const o = el('option', null, `${pb.title}${pb.builtIn ? ' (standard)' : pb.firm ? ' (your firm)' : ''}`)
        o.value = pb.name
        sel.appendChild(o)
      }
    } catch { /* engine offline */ }
  }

  async function runWorkflow(type) {
    const msg = $('#wfMsg')
    const matterId = $('#matterSel').value || ''
    if (!matterId) { msg.textContent = 'Pick a matter first (top of the pane), and add its folder under Settings → Firm library.'; return }
    const buttons = [$('#wfReview'), $('#wfChrono'), $('#wfTranslate'), $('#wfCompare')]
    const extra = type === 'translate' ? { file: $('#wfDocA').value, target: $('#wfLang').value, glossary: $('#wfGlossary').value.trim() || undefined }
      : type === 'compare' ? { fileA: $('#wfDocA').value, fileB: $('#wfDocB').value } : {}
    if ((type === 'translate' && !extra.file) || (type === 'compare' && (!extra.fileA || !extra.fileB || extra.fileA === extra.fileB))) {
      msg.textContent = type === 'compare' ? 'Pick two different documents.' : 'Pick a document.'
      return
    }
    buttons.forEach((b) => { b.disabled = true })
    msg.textContent = 'Starting…'
    const models = { list: [] }
    try {
      const res = await fetch(SIDECAR + '/api/workflows/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, matterId, playbook: $('#wfPlaybook').value || undefined, ...extra }),
      })
      await readSse(res, (ev) => {
        if (ev.type === 'model') { models.list = P.dataline.addModel(models.list, ev); updateDataLine({ models: models.list, online: [] }, true) }
        else if (ev.type === 'progress') msg.textContent = ev.step === 'rate' ? `Rating how much each of ${ev.total} changes matters…` : ev.index ? `Document ${ev.index} of ${ev.total}: ${ev.name}` : (ev.plain || ev.name || '…')
        else if (ev.type === 'error') msg.textContent = P.errors.explain(ev.message).why
        else if (ev.type === 'done') {
          const st = ev.stats || {}
          const line = type === 'translate' ? `${st.translated} of ${st.paragraphs} paragraphs translated · ${st.flags} marked for checking`
            : type === 'compare' ? `${st.changes} changes${st.high ? ` · ${st.high} important` : ''}${st.medium ? ` · ${st.medium} medium` : ''}${st.rateError ? ' · importance not rated' : ''}`
            : `${ev.count} ${type === 'review' ? 'findings, each quoting the document,' : 'dated events'} from ${P.words.plural(st.documents || 0, 'document')} · ${st.unverified} left out (quote not found)`
          msg.innerHTML = ''
          msg.appendChild(document.createTextNode(line))
          const files = el('div', 'wf-files')
          for (const f of ev.files || []) {
            const a = el('button', 'link', f.split(/[\\/]/).pop())
            a.type = 'button'
            a.title = 'Show in your files folder'
            a.addEventListener('click', () => api('/api/workspace/reveal', { method: 'POST', body: { path: f } }).catch(() => {}))
            files.appendChild(a)
          }
          msg.appendChild(files)
        }
      })
      updateDataLine({ models: models.list, online: [] }, false)
    } catch (err) {
      msg.textContent = P.errors.explain(err).why
    } finally {
      buttons.forEach((b) => { b.disabled = false })
    }
  }

  function bindWorkflows() {
    $('#wfReview').addEventListener('click', () => runWorkflow('review'))
    $('#wfChrono').addEventListener('click', () => runWorkflow('chronology'))
    $('#wfTranslate').addEventListener('click', () => runWorkflow('translate'))
    $('#wfCompare').addEventListener('click', () => runWorkflow('compare'))
    $('#wfMore').addEventListener('toggle', (e) => { if (e.target.open) refreshWorkflowDocs() })
    refreshPlaybooks()
    bindClauses()
  }

  // ── Firm clauses ─────────────────────────────────────────────────────────
  async function refreshClauses() {
    const sel = $('#clType')
    const matterId = $('#matterSel').value || ''
    const params = new URLSearchParams({ matterId, type: sel.value || '', q: $('#clQuery').value.trim() })
    let data
    try { data = await api('/api/clauses?' + params) } catch { return }
    if (!sel.options.length || sel.dataset.files !== String(data.files)) {
      const cur = sel.value
      sel.innerHTML = '<option value="">Any kind of clause</option>'
      for (const t of data.types.filter((x) => x.count)) { const o = el('option', null, `${t.label} (${t.count})`); o.value = t.id; sel.appendChild(o) }
      sel.value = cur
      sel.dataset.files = String(data.files)
    }
    const list = $('#clList')
    list.innerHTML = ''
    if (!data.files) { list.appendChild(el('div', 'muted', 'Add folders of precedents under Settings → Firm library.')); return }
    for (const c of data.clauses) {
      const item = el('details', 'cl-item')
      const sum = el('summary', null, `${c.heading} · used in ${P.words.plural(c.uses, 'document')}`)
      sum.title = c.documents.join(', ')
      const body = el('div', 'cl-text', c.text)
      const btn = el('button', 'btn btn-ghost btn-small', 'Insert where my cursor is')
      btn.type = 'button'
      btn.addEventListener('click', () => insertFromApp(c.text).then(() => { btn.textContent = '✓ Inserted' }).catch((err) => addError(err, 'apply')))
      item.append(sum, body, btn)
      list.appendChild(item)
    }
  }

  function bindClauses() {
    $('#clType').addEventListener('change', refreshClauses)
    let t = null
    $('#clQuery').addEventListener('input', () => { clearTimeout(t); t = setTimeout(refreshClauses, 300) })
    refreshClauses()
  }

  async function refreshWorkflowDocs() {
    const matterId = $('#matterSel').value || ''
    let data
    try { data = await api('/api/workflows/documents?matterId=' + encodeURIComponent(matterId)) } catch { return }
    for (const id of ['#wfDocA', '#wfDocB']) {
      const sel = $(id)
      const cur = sel.value
      sel.innerHTML = data.documents.length ? '' : '<option value="">— no documents in this matter\'s folders —</option>'
      for (const d of data.documents) { const o = el('option', null, d.name); o.value = d.path; sel.appendChild(o) }
      if (cur) sel.value = cur
    }
    const langSel = $('#wfLang')
    if (!langSel.options.length) {
      for (const [code, name] of Object.entries(data.languages)) { const o = el('option', null, name); o.value = code; langSel.appendChild(o) }
      langSel.value = 'en'
    }
  }

  // ── Connected systems (MCP servers) ──────────────────────────────────────
  let mcpServers = []
  async function refreshMcp(msg) {
    const box = $('#mcpList')
    try { mcpServers = (await api('/api/mcp')).servers } catch { return }
    box.innerHTML = ''
    for (const sv of mcpServers) {
      const row = el('div', 'lib-folder')
      const name = el('span', 'path', `${sv.name} — ${sv.connected ? 'connected' : 'not connected'}`)
      name.style.direction = 'ltr'
      name.title = [sv.command, ...sv.args].join(' ')
      const kind = el('span', 'badge ' + (sv.remote ? 'cloud' : 'local'), sv.remote ? 'leaves this computer' : 'on this computer')
      const rm = el('button', null, '✕')
      rm.type = 'button'
      rm.setAttribute('aria-label', `Remove ${sv.name}`)
      rm.addEventListener('click', async () => {
        try { await api('/api/mcp/servers/remove', { method: 'POST', body: { name: sv.name } }); refreshMcp('Removed.'); renderPolicyProviders() }
        catch (err) { $('#mcpMsg').textContent = P.errors.explain(err).why }
      })
      row.append(name, kind, rm)
      box.appendChild(row)
    }
    $('#mcpMsg').textContent = msg || (mcpServers.length ? '' : 'Nothing connected yet.')
    renderPolicyProviders()
  }

  function splitCommand(line) {
    const out = []
    line.replace(/"([^"]*)"|'([^']*)'|(\S+)/g, (_, a, b, c) => { out.push(a ?? b ?? c); return '' })
    return out
  }

  function bindWeb() {
    $('#webLogin').addEventListener('click', async () => {
      try { const r = await api('/api/web/login', { method: 'POST', body: { url: $('#webLoginUrl').value.trim() } }); $('#webMsg').textContent = r.message }
      catch (err) { $('#webMsg').textContent = P.errors.explain(err).why }
    })
  }

  function bindMcp() {
    $('#mcpAdd').addEventListener('click', async () => {
      const parts = splitCommand($('#mcpCmd').value.trim())
      if (!parts.length) { $('#mcpMsg').textContent = 'Enter the command that starts it.'; return }
      $('#mcpMsg').textContent = 'Connecting…'
      try {
        await api('/api/mcp/servers', { method: 'POST', body: { name: $('#mcpName').value.trim(), config: { command: parts[0], args: parts.slice(1), remote: $('#mcpRemote').checked } } })
        $('#mcpName').value = ''; $('#mcpCmd').value = ''
        refreshMcp('Connected.')
      } catch (err) { $('#mcpMsg').textContent = P.errors.explain(err).why + ' ' + P.errors.explain(err).todo }
    })
    $('#mcpReconnect').addEventListener('click', async () => {
      try { await api('/api/mcp/reconnect', { method: 'POST', body: {} }); refreshMcp('Reconnected.') } catch (err) { $('#mcpMsg').textContent = P.errors.explain(err).why }
    })
    refreshMcp()
  }

  // ── Firm library ─────────────────────────────────────────────────────────
  async function refreshLibrary(msg) {
    const box = $('#libFolders')
    let st
    try { st = await api('/api/library') } catch { return }
    box.innerHTML = ''
    for (const f of st.folders) {
      const row = el('div', 'lib-folder')
      const pth = el('span', 'path', f.path)
      pth.title = f.path
      const m = mattersCache.find((x) => x.id === f.matterId)
      const scope = el('span', 'badge', f.matterId ? (m ? m.title : 'one matter') : 'whole firm')
      const rm = el('button', null, '✕')
      rm.type = 'button'
      rm.setAttribute('aria-label', `Remove ${f.path} from the library`)
      rm.addEventListener('click', async () => {
        try { await api('/api/library/folders/remove', { method: 'POST', body: { path: f.path } }); refreshLibrary('Folder removed.') }
        catch (err) { $('#libMsg').textContent = P.errors.explain(err).why }
      })
      row.append(pth, scope, rm)
      box.appendChild(row)
    }
    $('#libMsg').textContent = (msg ? msg + ' · ' : '') + `${P.words.plural(st.files, 'file')} · ${P.words.plural(st.chunks, 'passage')} searchable`
  }

  function bindLibrary() {
    const run = async (path, body) => {
      $('#libMsg').textContent = 'Reading the files… (the first time can take a few minutes for large folders)'
      try {
        const r = await api(path, { method: 'POST', body })
        const res = r.result || {}
        refreshLibrary(`${res.indexed || 0} added, ${res.removed || 0} removed${res.errors && res.errors.length ? `, ${res.errors.length} skipped` : ''}`)
      } catch (err) { $('#libMsg').textContent = P.errors.explain(err).why }
    }
    $('#libAdd').addEventListener('click', () => {
      const matterId = $('#libMatter').checked ? ($('#matterSel').value || '') : ''
      if ($('#libMatter').checked && !matterId) { $('#libMsg').textContent = 'Pick a matter first (top of the pane).'; return }
      run('/api/library/folders', { path: $('#libPath').value, matterId }).then(() => { $('#libPath').value = '' })
    })
    $('#libSync').addEventListener('click', () => run('/api/library/sync', {}))
    refreshLibrary()
  }

  // ── Matters — shared with the desktop app and the terminal app ───────────
  let mattersCache = []

  function policyLabel(m) {
    const rule = m && m.policy
    if (!rule) return ''
    if (m.privileged || rule.mode === 'local-only') return '✓ This matter stays on this computer'
    const names = (rule.providers || []).map((id) => P.words.NAMES[id] || (id === 'web' ? 'online sources' : String(id).replace(/^mcp:/, ''))).join(', ')
    return `! This matter may use: ${names || 'nothing outside this computer'}`
  }

  async function refreshMatters() {
    const sel = $('#matterSel')
    let data
    try { data = await api('/api/matters' + (docId ? `?docId=${encodeURIComponent(docId)}` : '')) } catch { return }
    mattersCache = data.matters
    sel.innerHTML = '<option value="">No matter</option>'
    for (const m of data.matters) {
      const o = el('option', null, (m.number ? m.number + ' · ' : '') + m.title + (m.privileged ? ' (privileged)' : ''))
      o.value = m.id
      sel.appendChild(o)
    }
    sel.value = data.forDoc || ''
    showMatterPolicy()
  }

  function showMatterPolicy() {
    const m = mattersCache.find((x) => x.id === $('#matterSel').value)
    const b = $('#matterPolicy')
    b.textContent = m ? policyLabel(m) : ''
    b.className = 'badge ' + (m ? (m.privileged || (m.policy && m.policy.mode === 'local-only') ? 'local' : 'cloud') : '')
    b.hidden = !m
    const p = $('#matterPrivBtn')
    p.hidden = !m
    p.textContent = m && m.privileged ? '🔒' : '🔓'
    p.setAttribute('aria-label', m && m.privileged ? 'Privileged: stays on this computer. Press twice to remove the mark.' : 'Mark as privileged: keep this matter on this computer')
    p.title = p.getAttribute('aria-label')
    p.dataset.armed = ''
    refreshStatusLine()
  }

  // Marking privileged is one click (it only tightens); unmarking needs a
  // second click within 4 s (Office add-ins have no confirm dialog).
  async function togglePrivileged() {
    const m = mattersCache.find((x) => x.id === $('#matterSel').value)
    const p = $('#matterPrivBtn')
    if (!m) return
    if (m.privileged && !p.dataset.armed) {
      p.dataset.armed = '1'
      p.textContent = 'Sure?'
      announce('Press again to remove the privileged mark.', true)
      setTimeout(() => { if (p.dataset.armed) showMatterPolicy() }, 4000)
      return
    }
    try {
      await api('/api/matters/update', { method: 'POST', body: { id: m.id, patch: { privileged: !m.privileged } } })
      addNote(m.privileged ? `“${m.title}” is no longer marked privileged. It still stays on this computer until you change its rule.` : `“${m.title}” is privileged: it stays on this computer.`)
      await refreshMatters()
      refreshAiBadge()
    } catch (err) { addError(err, 'settings') }
  }

  async function bindDocToMatter(id) {
    if (!docId) { addNote('OpenLex has not read this document yet — try again in a moment.'); autoMap(); return }
    await api('/api/matters/bind', { method: 'POST', body: { id: id || null, docId, title: (docMap && docMap.title) || '' } })
    await refreshMatters()
    refreshAiBadge()
  }

  function bindMatters() {
    const sel = $('#matterSel')
    sel.addEventListener('change', () => { bindDocToMatter(sel.value).catch((err) => addError(err, 'settings')); refreshClauses() })
    $('#matterCancel').addEventListener('click', () => { $('#matterNew').hidden = true; $('#input').focus() })
    $('#matterPrivBtn').addEventListener('click', togglePrivileged)
    $('#matterCreate').addEventListener('click', async () => {
      try {
        const r = await api('/api/matters', { method: 'POST', body: {
          title: $('#matterTitle').value, client: $('#matterClient').value,
          number: $('#matterNumber').value, privileged: $('#matterPriv').checked,
        } })
        const terms = $('#matterTerms').value.trim()
        if (terms) await api('/api/matters/update', { method: 'POST', body: { id: r.matter.id, patch: { redactTerms: terms } } })
        $('#matterNew').hidden = true
        for (const id of ['#matterTitle', '#matterClient', '#matterNumber', '#matterTerms']) $(id).value = ''
        $('#matterPriv').checked = false
        await bindDocToMatter(r.matter.id)
        addNote(`✓ Matter “${r.matter.title}” created; this document is filed under it${r.matter.privileged ? ' (privileged: stays on this computer)' : ''}.`)
      } catch (err) { addError(err, 'settings') }
    })
    refreshMatters()
  }

  // ── Link with the desktop app (engine hub) ───────────────────────────────
  function setAppLinked(on) {
    $('#appPill').hidden = !on
    refreshStatusLine()
  }

  async function insertFromApp(text) {
    await Word.run(async (context) => {
      const sel = context.document.getSelection()
      sel.load('isEmpty')
      context.document.load('changeTrackingMode')
      await context.sync()
      const prior = context.document.changeTrackingMode
      const tracked = applyMode === 'tracked'
      if (tracked) {
        context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll
        await context.sync()
      }
      try {
        sel.insertText(text, sel.isEmpty ? Word.InsertLocation.replace : Word.InsertLocation.after)
        await context.sync()
      } finally {
        if (tracked) { context.document.changeTrackingMode = prior; await context.sync() }
      }
    })
  }

  function renderMonitorAlert(ev) {
    const n = (ev.data && ev.data.count) || 1
    offerHint({ id: 'monitor:' + (ev.id || n), priority: 0, text: `${P.words.plural(n, 'new legal update')} on “${(ev.data && ev.data.title) || 'a watched source'}”.`, actions: [{ label: 'Open the desktop app', run: () => api('/api/hub/events', { method: 'POST', body: { type: 'open-in-app', data: { view: 'monitors' } } }).catch(() => {}) }] })
  }

  function renderHandoff(ev) {
    const text = String((ev.data && ev.data.text) || '')
    const card = el('div', 'msg handoff')
    card.appendChild(el('div', 'handoff-head', `From the desktop app${ev.data && ev.data.source ? ' · ' + ev.data.source : ''}`))
    const body = el('div', 'md')
    body.innerHTML = mdToHtml(text.length > 1200 ? text.slice(0, 1200) + '…' : text)
    const row = el('div', 'btn-row')
    const ins = el('button', 'btn btn-small', applyMode === 'tracked' ? 'Insert where my cursor is (tracked)' : 'Insert where my cursor is')
    ins.type = 'button'
    const dis = el('button', 'btn btn-ghost btn-small', 'Dismiss')
    dis.type = 'button'
    const done = async (msg) => {
      try { await api('/api/hub/ack', { method: 'POST', body: { id: ev.id } }) } catch { /* best effort */ }
      row.remove()
      if (msg) addNote(msg)
    }
    ins.addEventListener('click', async () => {
      ins.disabled = true
      try { await insertFromApp(text); await done('✓ Inserted from the desktop app.') }
      catch (err) { ins.disabled = false; addError(err, 'apply') }
    })
    dis.addEventListener('click', () => { done(null); card.remove() })
    row.append(ins, dis)
    card.append(body, row)
    showView('chat')
    appendToChat(card)
  }

  function bindHub() {
    $('#appPill').addEventListener('click', async () => {
      try {
        await api('/api/hub/events', { method: 'POST', body: { type: 'open-in-app', data: { view: 'research', query: lastQuestion || '', docId: docId || null } } })
        addNote(lastQuestion ? 'Sent to the desktop app — continue there.' : 'Opened the desktop app.')
      } catch (err) { addError(err, 'load') }
    })
    const connect = () => {
      let es
      try { es = new EventSource(SIDECAR + '/api/hub/events') } catch { return }
      es.onmessage = (m) => {
        let ev
        try { ev = JSON.parse(m.data) } catch { return }
        if (ev.type === 'hello') setAppLinked(ev.data && ev.data.peers && ev.data.peers.app && ev.data.peers.app.running)
        else if (ev.type === 'insert-text') renderHandoff(ev)
        else if (ev.type === 'provider-changed' || ev.type === 'policy-changed') { refreshProviders(); refreshAiBadge(); refreshMatters() }
        else if (ev.type === 'matter-changed') refreshMatters()
        else if (ev.type === 'monitor-alert' && features.monitors !== false) renderMonitorAlert(ev)
      }
      es.onerror = () => { /* EventSource reconnects by itself */ }
    }
    connect()
    setInterval(async () => {
      try { const info = await api('/api/hub/info'); setAppLinked(info.peers && info.peers.app && info.peers.app.running) } catch { /* offline */ }
    }, 10000)
  }

  // ── Which AI + where client data may go ──────────────────────────────────
  // The engine keeps keys (OS keychain) and enforces the rule; the pane only
  // learns hasKey true/false and never reads a key back.
  let providers = []
  let activeProvider = 'local'

  async function refreshAiBadge() {
    const badge = $('#aiBadge')
    try {
      const st = await api('/api/status')
      const label = P.dataline.aiLabel(st)
      badge.textContent = label.text
      badge.classList.toggle('cloud', !label.local)
      badge.title = label.local ? 'The AI runs on this computer.' : 'The AI is a service outside this computer, used under your client-data rule.'
      const m = st.model || {}
      if (!label.local && !m.loaded) setStatus(P.errors.explain(m.error || 'model unavailable').why, false)
    } catch { badge.textContent = 'AI: …' }
  }

  function showProviderFields() {
    const p = providers.find((x) => x.id === $('#providerSel').value)
    if (!p) return
    const isLocal = p.kind === 'local'
    $('#providerFields').hidden = isLocal
    $('#providerKeyDel').hidden = !p.needsKey
    $('#providerUrlRow').hidden = !(p.id === 'azure' || p.id === 'custom')
    $('#providerLocalRow').hidden = p.id !== 'custom'
    $('#providerKeyRow').hidden = !(p.needsKey || p.id === 'custom' || p.id === 'vertex')
    const regional = p.id === 'bedrock' || p.id === 'vertex' || p.id === 'azure'
    $('#providerCloudRow').hidden = !regional
    $('#providerProjectWrap').hidden = p.id !== 'vertex'
    $('#providerRegion').value = p.region || ''
    $('#providerRegion').placeholder = p.id === 'vertex' ? 'europe-west1' : p.id === 'azure' ? 'swedencentral' : 'eu-central-1'
    $('#providerProject').value = p.project || ''
    $('#providerKey').placeholder = p.id === 'bedrock' ? 'Bedrock key, or ACCESS_KEY_ID:SECRET — kept in your keychain'
      : p.id === 'vertex' ? 'Service-account file contents (optional — empty uses your Google Cloud sign-in)'
      : 'Paste the key — kept in your computer\'s keychain'
    $('#providerModel').value = p.model || ''
    $('#providerUrl').value = p.baseUrl || ''
    $('#providerLocal').checked = !!p.local
    $('#providerKey').value = ''
    $('#providerKeyState').textContent = p.needsKey ? (p.hasKey ? '· saved ✓' : '· not set yet') : ''
    $('#providerUrl').placeholder = p.id === 'azure' ? 'https://<resource>.openai.azure.com/openai/deployments/<deployment>' : 'http://gateway.internal:8000/v1'
    const dl = $('#providerModels')
    dl.innerHTML = ''
    for (const m of p.models || []) { const o = el('option'); o.value = m; dl.appendChild(o) }
  }

  async function refreshProviders() {
    let data
    try { data = await api('/api/providers') } catch { return }
    providers = data.providers
    activeProvider = data.active
    const sel = $('#providerSel')
    const cur = sel.value || activeProvider
    sel.innerHTML = ''
    for (const p of providers) {
      const o = el('option', null, (p.kind === 'local' ? 'The AI on this computer' : p.label) + (p.id === activeProvider ? ' — in use' : '') + (p.local ? '' : ' (outside this computer)'))
      o.value = p.id
      sel.appendChild(o)
    }
    sel.value = providers.some((p) => p.id === cur) ? cur : activeProvider
    showProviderFields()
    renderPolicyProviders()
  }

  function bindProvider() {
    const sel = $('#providerSel')
    const msg = (t) => { $('#providerMsg').textContent = t }
    sel.addEventListener('change', showProviderFields)
    $('#providerSave').addEventListener('click', async () => {
      const id = sel.value
      const p = providers.find((x) => x.id === id)
      try {
        const key = $('#providerKey').value.trim()
        if (key) await api('/api/providers/key', { method: 'POST', body: { provider: id, key } })
        const overrides = {}
        if (p.kind !== 'local') {
          overrides.model = $('#providerModel').value.trim() || null
          if (id === 'azure' || id === 'custom') overrides.baseUrl = $('#providerUrl').value.trim() || null
          if (id === 'custom') overrides.local = $('#providerLocal').checked
          if (id === 'bedrock' || id === 'vertex' || id === 'azure') overrides.region = $('#providerRegion').value.trim() || null
          if (id === 'vertex') overrides.project = $('#providerProject').value.trim() || null
        }
        await api('/api/providers', { method: 'POST', body: { active: id, provider: id, overrides } })
        msg(`✓ Now using ${p.kind === 'local' ? 'the AI on this computer' : p.label}.` + (p.local || id === 'local' ? '' : ' Your client-data rule below must also allow it.'))
        await refreshProviders()
        refreshAiBadge()
      } catch (err) { const x = P.errors.explain(err, 'settings'); msg(`${x.why} ${x.todo}`) }
    })
    $('#providerTest').addEventListener('click', async () => {
      msg('Testing…')
      try {
        const r = await api('/api/providers/test', { method: 'POST', body: { provider: sel.value } })
        msg(r.ok ? '✓ It works.' : `! ${P.errors.explain(r.error).why} ${P.errors.explain(r.error).todo}`)
      } catch (err) { msg(P.errors.explain(err).why) }
    })
    $('#providerKeyDel').addEventListener('click', async () => {
      try {
        await api('/api/providers/key', { method: 'POST', body: { provider: sel.value, key: null } })
        msg('Key removed from the keychain.')
        await refreshProviders()
        refreshAiBadge()
      } catch (err) { msg(P.errors.explain(err).why) }
    })
    refreshProviders()
  }

  let policyState = null
  function renderPolicyProviders() {
    const box = $('#policyProviders')
    if (!policyState) return
    const rule = policyState.default
    document.querySelectorAll('input[name="policyMode"]').forEach((r) => { r.checked = r.value === rule.mode })
    const redact = $('#policyRedact')
    redact.checked = !!rule.redact; redact.disabled = rule.mode !== 'allow-list'
    const eu = $('#policyEu')
    eu.checked = (rule.regions || []).includes('eu'); eu.disabled = rule.mode !== 'allow-list'
    box.innerHTML = ''
    const targets = [
      ...providers.filter((x) => !x.local).map((x) => ({ id: x.id, label: x.label })),
      { id: 'web', label: 'Online sources (RIS, public web pages, databases you signed in to)' },
      ...mcpServers.filter((x) => x.remote).map((x) => ({ id: `mcp:${x.name}`, label: `Connected system: ${x.name}` })),
    ]
    for (const p of targets) {
      const l = el('label', 'row')
      const cb = el('input')
      cb.type = 'checkbox'
      cb.value = p.id
      cb.checked = rule.mode === 'allow-list' && (rule.providers || []).includes(p.id)
      cb.disabled = rule.mode !== 'allow-list'
      cb.addEventListener('change', savePolicy)
      l.append(cb, document.createTextNode(' ' + p.label))
      box.appendChild(l)
    }
    $('#policyMsg').textContent = 'Every AI call is logged — which service and when, never the content.'
  }

  async function savePolicy() {
    const mode = (document.querySelector('input[name="policyMode"]:checked') || {}).value || 'local-only'
    const rule = { mode }
    if (mode === 'allow-list') {
      rule.providers = [...document.querySelectorAll('#policyProviders input:checked')].map((c) => c.value)
      if ($('#policyRedact').checked) rule.redact = true
      if ($('#policyEu').checked) rule.regions = ['eu']
    }
    try {
      const r = await api('/api/policy', { method: 'POST', body: { rule } })
      policyState = { ...policyState, ...r }
      renderPolicyProviders()
      refreshAiBadge()
      $('#policyMsg').textContent = '✓ Saved.'
    } catch (err) { $('#policyMsg').textContent = P.errors.explain(err, 'settings').why }
  }

  async function bindPolicy() {
    try { policyState = await api('/api/policy') } catch { return }
    document.querySelectorAll('input[name="policyMode"]').forEach((r) => r.addEventListener('change', savePolicy))
    $('#policyRedact').addEventListener('change', savePolicy)
    $('#policyEu').addEventListener('change', savePolicy)
    renderPolicyProviders()
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  async function clearConversation() {
    try {
      await api('/api/session/clear', { method: 'POST', body: { docId } })
      addNote('✓ OpenLex has forgotten this conversation.')
    } catch (err) { addError(err, 'settings') }
  }

  function bindSettings() {
    $('#clearConv').addEventListener('click', clearConversation)
    $('#aggression').addEventListener('input', (e) => {
      $('#aggLabel').textContent = ['Only the important things', 'Balanced', 'Everything worth changing'][+e.target.value]
    })
    $('#langSel').addEventListener('change', (e) => { lang = e.target.value })
    bindProvider()
    bindPolicy()
    bindLibrary()
    bindMcp()
    bindWeb()
    bindDepth()
    bindApplyMode()
  }

  async function bindDepth() {
    const sel = $('#depthSel')
    let cfg = null
    try { cfg = await api('/api/config/agent') } catch { /* engine offline */ }
    const note = (key) => {
      const p = cfg && cfg.presets && cfg.presets[key]
      $('#depthNote').textContent = p ? `About ${p.totalGiB} GB of memory · up to ${p.hops} research steps per question.` : ''
    }
    sel.value = (cfg && cfg.depth) || 'balanced'
    note(sel.value)
    sel.addEventListener('change', async () => {
      note(sel.value)
      try { await api('/api/config/agent', { method: 'POST', body: { depth: sel.value } }) } catch (err) { addError(err, 'settings') }
    })
  }

  // Autopilot: suggestions go in silently as tracked changes (one line each).
  let autopilot = false
  async function autopilotApply(s) {
    if (!isRealRewrite(s) || s._applied) return
    if (!s.anchor || !String(s.anchor.text || '').trim()) return
    // A whole-clause rewrite that lost most of the original needs human eyes.
    if (s.collapseWarning) { renderChatSuggestion(s, false); return }
    if (!Office.context.requirements.isSetSupported('WordApi', 1.4)) { renderChatSuggestion(s, false); return }
    s._applied = true
    try {
      await applySuggestion(s, { forceTracked: true, silent: true })
      addNote('✓ Put in as a tracked change: ' + (s.summary || 'a proposed change'))
    } catch (err) {
      s._applied = false
      anchorError(err, s)
    }
  }

  async function bindApplyMode() {
    const box = $('#applyTracked')
    const ap = $('#autopilot')
    try {
      const cfg = await api('/api/config/agent')
      applyMode = cfg.applyMode === 'permanent' ? 'permanent' : 'tracked'
      autopilot = !!cfg.autopilot
      ap.checked = autopilot
      box.checked = applyMode === 'tracked'
    } catch { /* keep defaults */ }
    box.addEventListener('change', async () => {
      applyMode = box.checked ? 'tracked' : 'permanent'
      try { await api('/api/config/agent', { method: 'POST', body: { applyMode, autopilot } }) } catch (err) { addError(err, 'settings') }
    })
    ap.addEventListener('change', async () => {
      autopilot = ap.checked
      try { await api('/api/config/agent', { method: 'POST', body: { autopilot } }) } catch (err) { addError(err, 'settings') }
    })
  }

  // Status cards: symbol + title + description + action.
  function statusCard(kind, title, desc, actionHtml) {
    const icon = { ok: '✓', bad: '✕', warn: '!', neutral: '•' }[kind] || '•'
    return `<div class="status-card">
      <div class="sc-head"><span class="lic-chip ${kind}">${icon} ${escHtml(title)}</span></div>
      <div class="sc-desc">${escHtml(desc)}</div>
      ${actionHtml ? `<div class="sc-action">${actionHtml}</div>` : ''}
    </div>`
  }

  function licenseStatusCard(lic) {
    if (!lic) return statusCard('neutral', 'Unknown', 'No licence information yet.')
    switch (lic.status) {
      case 'active': return statusCard('ok', 'Active', `Subscription · ${P.words.plural((lic.jurisdictions || []).length, 'jurisdiction')} · until ${new Date(lic.expiresAt).toLocaleDateString()}.`)
      case 'no_token': return statusCard('neutral', 'No sign-in token', 'OpenLex works offline; downloads need your sign-in token.')
      case 'community': return statusCard('ok', 'Open-source edition', 'No licence needed. Use the AI on this computer or your own AI service; add law collections here.')
      case 'invalid_token': return statusCard('bad', 'Token not accepted', 'This token does not belong to an active subscription.', lic.accountUrl ? `<a class="btn btn-small" href="${escHtml(lic.accountUrl)}" target="_blank" rel="noopener">Open your account</a>` : '')
      case 'expired': return statusCard('bad', 'Subscription ended', 'Renew to keep getting downloads and updates.', lic.accountUrl ? `<a class="btn btn-small" href="${escHtml(lic.accountUrl)}" target="_blank" rel="noopener">Renew</a>` : '')
      case 'offline': return statusCard('warn', 'Licence server not reachable', 'A saved licence may still work offline.')
      default: return statusCard('neutral', lic.status || 'Unknown', lic.error || '')
    }
  }

  async function refreshSetup() {
    const box = $('#setupBox')
    let st, lic
    try { st = await api('/api/setup/status') } catch { box.textContent = 'OpenLex is not running on this computer.'; return }
    try { lic = await api('/api/license/status') } catch { /* stays undefined */ }
    const packs = (st.packs || []).map((p) => `${escHtml(p.code)} · version ${escHtml(p.version || '?')}${p.ingested_at ? ' · ' + escHtml(String(p.ingested_at).slice(0, 10)) : ''}`).join('<br>') || 'none yet'
    const aiLine = st.model ? 'An AI is set up on this computer.' : 'No AI on this computer yet — choose one under Which AI.'
    if (lic && lic.status === 'community') {
      box.innerHTML = `${licenseStatusCard(lic)}<div class="muted">${aiLine}</div><div class="muted">Law collections:<br>${packs}</div>`
      return
    }
    if (!st.token) {
      box.innerHTML = `
        ${licenseStatusCard(lic)}
        <label class="field-label" for="tokenInput">Sign-in token</label>
        <input type="text" id="tokenInput" placeholder="Paste your token">
        <button class="btn" id="saveTokenBtn" type="button">Activate</button>
        <div id="setupProgress" class="muted" role="status" aria-live="polite"></div>`
      $('#saveTokenBtn').addEventListener('click', async () => {
        const token = $('#tokenInput').value.trim()
        if (!token) return
        const prog = $('#setupProgress')
        prog.textContent = 'Saving…'
        try {
          await api('/api/config/token', { method: 'POST', body: { token } })
          prog.textContent = 'Checking the subscription…'
          await new Promise((r) => setTimeout(r, 1500))
          const lic2 = await api('/api/license/status')
          prog.innerHTML = licenseStatusCard(lic2)
          refreshSetup()
        } catch (err) { prog.textContent = P.errors.explain(err).why }
      })
      return
    }
    const rows = [licenseStatusCard(lic)]
    if (!st.model) rows.push('<button class="btn" id="dlModelBtn" type="button">Download the AI for this computer (2.7 GB)</button>')
    else rows.push(`<div class="muted">${aiLine}</div>`)
    rows.push(`<div class="muted">Law collections:<br>${packs}</div>`)
    rows.push('<button class="btn btn-ghost" id="recheckBtn" type="button">Check the subscription now</button>')
    rows.push('<div id="setupProgress" class="muted" role="status" aria-live="polite"></div>')
    box.innerHTML = rows.join('')
    const dl = $('#dlModelBtn')
    if (dl) dl.addEventListener('click', () => {
      streamProgress('/api/download/model', { variant: 'lotus-ai-4b-q4_k_m' }, $('#setupProgress'), () => {
        $('#setupProgress').textContent = '✓ Ready — close and reopen the pane to start.'
        refreshSetup()
      })
    })
    $('#recheckBtn').addEventListener('click', async () => {
      const lic2 = await api('/api/license/status')
      $('#setupProgress').innerHTML = licenseStatusCard(lic2)
      refreshSetup()
    })
  }

  function streamProgress(path, body, target, onDone) {
    target.textContent = 'Starting…'
    fetch(SIDECAR + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((res) => readSse(res, (evt) => {
        if (evt.kind === 'download-progress') target.textContent = `${evt.what}: ${evt.pct ?? '…'}% (${(evt.received / 1048576).toFixed(0)} MB${evt.total ? ' of ' + (evt.total / 1048576).toFixed(0) + ' MB' : ''})`
        else if (evt.type === 'step' && evt.plain) target.textContent = evt.plain
        else if (evt.type === 'error') target.textContent = '! ' + P.errors.explain(evt.message).why
        else if (evt.type === 'done') { target.textContent = '✓ Done'; if (onDone) onDone(evt) }
      }))
      .catch((err) => { target.textContent = '! ' + P.errors.explain(err).why })
  }

  async function refreshJurisdictions() {
    try {
      const jurs = await api('/api/jurisdictions')
      const box = $('#jurList')
      box.innerHTML = ''
      jurs.forEach((j) => {
        const row = el('div', 'jur')
        row.appendChild(el('span', null, j.code))
        const right = el('span', 'jur-actions')
        if (j.installed) {
          right.appendChild(el('span', 'badge-ok', '✓ on this computer'))
          const del = el('button', 'btn btn-ghost btn-small', 'Remove')
          del.type = 'button'
          del.setAttribute('aria-label', `Remove the ${j.code} law collection`)
          del.addEventListener('click', async () => {
            if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Sure? Remove'; setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Remove' }, 4000); return }
            del.disabled = true
            del.textContent = 'Removing…'
            try { await api('/api/packs/delete', { method: 'POST', body: { jurisdiction: j.code } }); refreshSetup(); refreshPacks(); refreshJurisdictions() }
            catch (err) { addError(err, 'settings'); refreshJurisdictions() }
          })
          right.appendChild(del)
        } else {
          const dl = el('button', 'btn btn-small', 'Download')
          dl.type = 'button'
          dl.setAttribute('aria-label', `Download the ${j.code} law collection`)
          dl.addEventListener('click', () => {
            dl.disabled = true
            streamProgress('/api/download/pack', { jurisdiction: j.code }, dl, () => { refreshSetup(); refreshPacks(); refreshJurisdictions() })
          })
          right.appendChild(dl)
        }
        row.appendChild(right)
        box.appendChild(row)
      })
    } catch { /* offline */ }
  }

  async function refreshPacks() {
    try {
      const packs = await api('/api/packs')
      const box = $('#packList')
      box.innerHTML = ''
      packs.forEach((p) => box.appendChild(el('div', 'pack-item', `${p.filename} · ${(p.size_mb / 1024).toFixed(1)} GB`)))
    } catch { /* offline */ }
  }

  // ── Updates ──────────────────────────────────────────────────────────────
  function bindUpdate() { refreshUpdate() }

  async function refreshUpdate() {
    const box = $('#updateBox')
    let st
    try { st = await api('/api/update/status') } catch { box.textContent = 'OpenLex is not running.'; return }
    const cur = st.current || '0.1.0'
    const check = (label) => {
      const b = el('button', 'btn btn-ghost btn-small', label)
      b.type = 'button'
      b.addEventListener('click', async () => { try { await api('/api/update/check', { method: 'POST' }) } catch { /* shown below */ } refreshUpdate() })
      return b
    }
    box.innerHTML = ''
    if (st.status === 'available' && st.available) {
      box.innerHTML = statusCard('warn', `Version ${st.available} is ready`, `You have ${cur}.`)
      const b = el('button', 'btn', 'Download the update')
      b.type = 'button'
      const prog = el('div', 'muted')
      prog.setAttribute('role', 'status')
      b.addEventListener('click', () => streamProgress('/api/update/download', {}, prog, () => {
        const apply = el('button', 'btn', 'Install and restart')
        apply.type = 'button'
        apply.addEventListener('click', () => streamProgress('/api/update/apply', {}, prog, () => { prog.textContent = 'Restarting… close and reopen the pane in a few seconds.' }))
        prog.after(apply)
      }))
      box.append(b, prog)
    } else if (st.status === 'applied') {
      box.innerHTML = statusCard('ok', `Updated to ${cur}`, '')
    } else if (st.status === 'error') {
      box.appendChild(el('div', 'muted', `Could not check for updates: ${P.errors.explain(st.error).why}`))
      box.appendChild(check('Check again'))
    } else if (st.status === 'no-token') {
      box.appendChild(el('div', 'muted', 'Updates are checked once a sign-in token is set.'))
    } else {
      box.appendChild(el('div', 'muted', `Up to date (version ${cur}). Checked automatically every 6 hours.`))
      box.appendChild(check('Check now'))
    }
  }
})()
