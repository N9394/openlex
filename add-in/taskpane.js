/* OpenLex Word add-in — task pane logic.
 * Talks to the local sidecar on the same origin (https://localhost:18001).
 * The add-in is thin: all agent work happens in the sidecar.
 */
(function () {
  'use strict'

  // Same origin as the page itself (the sidecar serves the add-in), so the
  // scheme matches whichever the sidecar is listening on (https when the
  // localhost cert is installed, http in dev fallback).
  const SIDECAR = window.location.origin || 'http://127.0.0.1:18001'
  let sidecarOk = false
  let lang = 'auto'

  const $ = (sel) => document.querySelector(sel)

  // ── Office bootstrap ──────────────────────────────────────────────────────
  Office.onReady((info) => {
    if (info.host !== Office.HostType.Word) {
      setStatus('needs Word', false)
      return
    }
    init()
  })

  async function init() {
    bindTabs()
    bindChat()
    bindSelection()
    bindStop()
    bindUndo()
    bindWorkspace()
    bindCalendar()
    bindSuggestionsTab()
    bindCompare()
    bindCommentDigest()
    bindXref()
    const oc = document.getElementById('obligCheck')
    if (oc) oc.addEventListener('click', obligCheck)
    bindDocMap()
    bindSettings()
    bindDropdown()
    setStatus('starting…')
    const ok = await pingSidecar()
    sidecarOk = ok
    setStatus(ok ? 'local engine ready' : 'engine offline', ok)
    if (ok) { refreshDataBadge(); bindHub(); bindMatters(); bindWorkflows() }
    if (ok) {
      refreshSetup()
      refreshJurisdictions()
      refreshPacks()
      bindUpdate()
      autoMap() // map the open document so the agent has context immediately
    }
  }

  // First-run nicety: build the document map automatically so the chat has
  // context without a manual "Build document map" click.
  async function autoMap() {
    try {
      const body = await getDocTextAndStyles()
      if (!body.text || !body.text.trim()) return
      const map = await mapBody(body)
      docMap = map
      docId = map.doc_id
      $('#docmeta').textContent = `Mapped ${body.length.toLocaleString()} chars · ${map.sections.length} sections`
      renderTree(map)
      setStatus('local engine ready · doc mapped')
      refreshMatters() // select the matter this document is filed under
    } catch {
      // Not in Word yet or no doc — pane still works for law-only questions.
    }
  }

  function setStatus(text, ok) {
    $('#statusText').textContent = text
    $('#statusDot').className = 'dot ' + (ok === undefined ? '' : ok ? 'on' : 'off')
  }

  // ── Sidecar API ───────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(SIDECAR + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(`${path}: ${res.status} ${err.slice(0, 120)}`)
    }
    return res.status === 204 ? null : res.json()
  }

  async function pingSidecar() {
    try {
      const res = await fetch(SIDECAR + '/health', { signal: AbortSignal.timeout(1500) })
      return res.ok
    } catch { return false }
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function bindTabs() {
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'))
        document.querySelectorAll('.tabpane').forEach((x) => x.classList.remove('active'))
        t.classList.add('active')
        $('#tab-' + t.dataset.tab).classList.add('active')
      })
    })
  }

  // ── Custom dropdown (language + theme pickers) ────────────────────────────
  function bindDropdown() {
    const wire = (ddId, labelSel, onPick, dataAttr) => {
      const dd = document.getElementById(ddId)
      if (!dd) return
      const btn = dd.querySelector('.dd-btn')
      const items = dd.querySelectorAll('.dd-item')
      const pick = (it) => {
        const v = it.dataset[dataAttr]
        const label = document.querySelector(labelSel)
        if (label) label.textContent = it.querySelector('span').textContent
        items.forEach((x) => x.classList.toggle('selected', x === it))
        dd.classList.remove('open')
        onPick(v)
      }
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        dd.classList.toggle('open')
      })
      items.forEach((it) => it.addEventListener('click', () => pick(it)))
      document.addEventListener('click', () => dd.classList.remove('open'))
      return pick
    }

    // Language picker.
    wire('langDd', '#langLabel', (v) => { lang = v }, 'lang')
    $('#langDd').querySelector('.dd-item[data-lang="auto"]').classList.add('selected')

    // Theme picker (dark / light / match system), persisted.
    const applyTheme = (t) => {
      const dark = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
      const label = t === 'auto' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'
      const lbl = document.getElementById('themeLabel')
      if (lbl) lbl.textContent = label
      const sel = document.querySelector('#themeDd .dd-item[data-theme-opt="' + t + '"]')
      if (sel) {
        document.querySelectorAll('#themeDd .dd-item').forEach((x) => x.classList.toggle('selected', x === sel))
      }
      try { localStorage.setItem('lexvault-theme', t) } catch {}
    }
    wire('themeDd', '#themeLabel', applyTheme, 'themeOpt')
    let savedTheme = 'auto'
    try { savedTheme = localStorage.getItem('lexvault-theme') || 'auto' } catch {}
    applyTheme(savedTheme)
    if (savedTheme === 'auto' && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(savedTheme))
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  function bindChat() {
    const send = () => {
      hideSelectionBar()
      const text = $('#input').value.trim()
      if (!text) return
      $('#input').value = ''
      // Reset the grown composer: after a long multi-line message the
      // textarea keeps its inline height and the row stays 2-3 lines tall
      // until the next input event. Clear it on send.
      const ta = $('#input')
      ta.style.height = ''
      ta.classList.remove('multi')
      addMsg('user', text)
      streamChat(text)
    }
    $('#send').addEventListener('click', () => {
      if (isProcessing) { if (chatAbort) chatAbort.abort(); return }
      send()
    })
    // Single-line pill that only grows when the message gets longer.
    const ta = $('#input')
    const autoGrow = () => {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
      ta.classList.toggle('multi', ta.scrollHeight > 42)
    }
    ta.addEventListener('input', autoGrow)
    ta.addEventListener('focus', autoGrow)
    $('#input').addEventListener('keydown', (e) => {
      if (skillMenuKey(e)) return
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    })
    ta.addEventListener('input', updateSkillMenu)
    ta.addEventListener('blur', () => setTimeout(hideSkillMenu, 150))
  }

  // ── Skills: "/" autocomplete in the composer (firm + bundled SKILL.md) ──
  let skillCache = null
  let skillPick = 0
  async function loadSkills() {
    if (skillCache) return skillCache
    try { skillCache = (await (await fetch(SIDECAR + '/api/skills')).json()).skills.filter((s) => !s.error) } catch { skillCache = [] }
    setTimeout(() => { skillCache = null }, 60000) // pick up new firm skills
    return skillCache
  }
  function skillMatches() {
    const m = $('#input').value.match(/^\/([a-z0-9-]*)$/)
    if (!m || !skillCache) return []
    return skillCache.filter((s) => s.name.startsWith(m[1]) || s.title.toLowerCase().includes(m[1])).slice(0, 8)
  }
  async function updateSkillMenu() {
    if (!/^\/[a-z0-9-]*$/.test($('#input').value)) return hideSkillMenu()
    await loadSkills()
    const list = skillMatches()
    let menu = $('#skillMenu')
    if (!list.length) return hideSkillMenu()
    if (!menu) {
      menu = document.createElement('div')
      menu.id = 'skillMenu'
      menu.className = 'skill-menu'
      $('.composer').before(menu)
    }
    skillPick = Math.min(skillPick, list.length - 1)
    menu.innerHTML = ''
    list.forEach((s, i) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'skill-item' + (i === skillPick ? ' active' : '')
      item.innerHTML = `<b></b><span></span>`
      item.querySelector('b').textContent = '/' + s.name
      item.querySelector('span').textContent = s.description
      item.addEventListener('mousedown', (e) => { e.preventDefault(); chooseSkill(s.name) })
      menu.appendChild(item)
    })
  }
  function hideSkillMenu() { const m = $('#skillMenu'); if (m) m.remove(); skillPick = 0 }
  function chooseSkill(name) {
    const ta = $('#input')
    ta.value = `/${name} `
    hideSkillMenu()
    ta.focus()
  }
  function skillMenuKey(e) {
    if (!$('#skillMenu')) return false
    const list = skillMatches()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); skillPick = (skillPick + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length; updateSkillMenu(); return true }
    if ((e.key === 'Enter' || e.key === 'Tab') && list[skillPick]) { e.preventDefault(); chooseSkill(list[skillPick].name); return true }
    if (e.key === 'Escape') { hideSkillMenu(); return true }
    return false
  }
  function addSkillChip(evt) {
    // The engine thinks a firm skill fits: offer it, never force it.
    const row = addMsg('step', '')
    row.textContent = ''
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn btn-ghost skill-chip'
    b.textContent = `Use skill: ${evt.title}`
    b.title = evt.description || ''
    b.addEventListener('click', () => { const ta = $('#input'); ta.value = `/${evt.name} ${lastQuestion || ''}`.trim(); ta.focus() })
    row.appendChild(b)
  }

  function addMsg(kind, text) {
    const el = document.createElement('div')
    el.className = 'msg ' + kind
    if (kind === 'agent') {
      // Markdown-rendered agent bubble. Keeps the raw text for streaming
      // appends (re-render whole body per chunk — cheap at these sizes).
      el._mdText = text || ''
      const inner = document.createElement('div')
      inner.className = 'md'
      inner.innerHTML = mdToHtml(el._mdText)
      el.appendChild(inner)
      el._mdInner = inner
    } else {
      el.textContent = text
    }
    $('#chat').appendChild(el)
    $('#chat').scrollTop = $('#chat').scrollHeight
    return el
  }

  /* Minimal escape-first markdown → HTML renderer. No innerHTML from raw
   * LLM text ever: HTML is escaped first, then a handful of markdown
   * constructs are matched on the escaped text (headers, lists, code,
   * bold/italic, links, blockquotes, hr, paragraphs). */
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
    const flushList = () => { if (listTag) { out.push('<' + listTag + '>' + listItems.map(x => '<li>' + inlineMd(x) + '</li>').join('') + '</' + listTag + '>'); listTag = null; listItems = [] } }
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
        const lvl = h[1].length
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

  /* Thinking card — one per reasoning phase, so tool uses sit BETWEEN
   * thinking steps instead of after one giant accumulated bubble. Collapsed
   * by default; the header pill shows a spinner + ChatGPT-style glimmer
   * while active, then the settled "thought for Xs — click to expand".
   * Steps within a phase are deduped (Lotus repeats itself) and capped. */
  let activeThinkCard = null
  let thinkStart = null
  let thinkTimer = null
  const MAX_THINK_STEPS = 5

  function ensureThinkCard() {
    if (activeThinkCard) return activeThinkCard
    thinkStart = Date.now()
    activeThinkCard = document.createElement('div')
    activeThinkCard.className = 'think'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'think-toggle active'
    toggle.innerHTML = '<span class="think-timer">thinking…</span>'
    toggle.addEventListener('click', () => toggle.classList.toggle('open'))
    const body = document.createElement('div')
    body.className = 'think-body'
    activeThinkCard.appendChild(toggle)
    activeThinkCard.appendChild(body)
    $('#chat').appendChild(activeThinkCard)
    activeThinkCard._toggle = toggle
    activeThinkCard._body = body
    activeThinkCard._steps = 0
    thinkTimer = setInterval(() => {
      const s = ((Date.now() - thinkStart) / 1000).toFixed(1)
      toggle.querySelector('.think-timer').textContent = `thinking… ${s}s`
    }, 100) // tenths of a second
    return activeThinkCard
  }

  /* Near-identical reasoning detection: Lotus replans the same thought
   * across hops ("The clause already heavily favors the client" ×3).
   * Treat steps with ≥80% shared words and similar length as duplicates. */
  function similarThought(a, b) {
    const A = String(a || '').trim().toLowerCase()
    const B = String(b || '').trim().toLowerCase()
    if (!A || !B || A === B) return A === B
    const [sh, lo] = A.length <= B.length ? [A, B] : [B, A]
    if (sh.length < 30) return false
    if (lo.includes(sh)) return true
    if (Math.abs(A.length - B.length) > Math.max(60, A.length * 0.6)) return false
    const wa = new Set(sh.split(/\W+/).filter(Boolean))
    const wb = new Set(lo.split(/\W+/).filter(Boolean))
    let common = 0
    for (const w of wa) if (wb.has(w)) common++
    return common / wa.size > 0.8
  }

  function addThinkStep(text, streaming = false) {
    const b = ensureThinkCard()
    const raw = String(text || '')
    if (!raw && !streaming) return

    // reasoning_content arrives one token/delta at a time. Keep those deltas
    // in one live block and preserve their whitespace; rendering every delta
    // as a display:block step made the trace read "The / user / wants / me".
    if (streaming) {
      let live = b._body.querySelector('.tstep-live')
      if (!live) {
        if (b._steps >= MAX_THINK_STEPS) {
          b._steps++
          let more = b._body.querySelector('.tstep-more')
          if (!more) {
            more = document.createElement('span')
            more.className = 'tstep tstep-more'
            b._body.appendChild(more)
          }
          more.textContent = `… ${b._steps - MAX_THINK_STEPS} more step${b._steps - MAX_THINK_STEPS === 1 ? '' : 's'}`
          return
        }
        live = document.createElement('span')
        live.className = 'tstep tstep-live'
        b._body.appendChild(live)
        b._steps++
      }
      live.textContent += raw
      $('#chat').scrollTop = $('#chat').scrollHeight
      return
    }

    const t = raw.trim()
    if (!t) return

    // The agent emits the complete thought after the stream settles. If its
    // live line already contains that thought, keep one copy in the card.
    const live = b._body.querySelector('.tstep-live')
    if (live) {
      live.classList.remove('tstep-live')
      const streamed = live.textContent.trim()
      if (streamed && (streamed === t || t.includes(streamed) || streamed.includes(t) || similarThought(t, streamed))) return
    }
    const prev = b._body.lastElementChild
    if (prev && prev.classList.contains('tstep') && similarThought(t, prev.textContent)) return
    if (b._steps >= MAX_THINK_STEPS) {
      b._steps++
      let more = b._body.querySelector('.tstep-more')
      if (!more) {
        more = document.createElement('span')
        more.className = 'tstep tstep-more'
        b._body.appendChild(more)
      }
      more.textContent = `… ${b._steps - MAX_THINK_STEPS} more step${b._steps - MAX_THINK_STEPS === 1 ? '' : 's'}`
      return
    }
    const step = document.createElement('span')
    step.className = 'tstep'
    step.textContent = t
    b._body.appendChild(step)
    b._steps++
    $('#chat').scrollTop = $('#chat').scrollHeight
  }

  function finalizeThinkCard() {
    if (!activeThinkCard) return
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null }
    const s = ((Date.now() - thinkStart) / 1000).toFixed(1)
    const toggle = activeThinkCard._toggle
    toggle.classList.remove('active')
    toggle.innerHTML = `<span class="chev">▶</span><span class="think-timer">thought for ${s}s — click to expand</span>`
    activeThinkCard = null
    thinkStart = null
  }

  let chatAbort = null
  async function streamChat(text) {
    if (!sidecarOk) { addMsg('err', 'Local engine is offline. Start the OpenLex sidecar first.'); return }
    toggleSendStop(true)

    // "Analyze" chip → the full clause-by-clause pipeline (SSE suggestions).
    if (text === 'Analyze this document for risks') {
      return streamAnalyze()
    }

    // The sidecar keeps documents in memory only — after it restarts (update,
    // crash) a mapped doc is gone. If we have no cached text, re-extract it
    // from Word so the agent never analyzes an empty document.
    if (!docText && docId) {
      try {
        const fresh = await getDocTextAndStyles()
        docText = fresh.text
        const map = await mapBody(fresh)
        docMap = map
        docId = map.doc_id
        renderTree(map)
      } catch { /* not in Word — law-only question */ }
    }

    // The sidecar emits the full timeline itself (planning… → tool chips →
    // writing… → judge), so the pane adds no local step row. The first
    // text event owns the agent bubble via `agentMsg`.
    const step = null
    chatAbort = new AbortController()
    lastQuestion = text
    try {
      const res = await fetch(SIDECAR + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, doc: currentDocMap(), lang, docId, text: docText }),
        signal: chatAbort.signal,
      })
      if (!res.ok) throw new Error(await res.text())
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buffer = ''
      let agentMsg = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()
        for (const part of parts) {
          if (!part.startsWith('data:')) continue
          const evt = JSON.parse(part.slice(5))
          handleChatEvent(evt, step, () => agentMsg)
        }
      }
      finalizeThinkCard()
      toggleSendStop(false)
    } catch (err) {
      finalizeThinkCard()
      if (err && err.name === 'AbortError') {
        addMsg('step', '⏹ Stopped — partial results kept')
      } else {
        step.remove()
        addMsg('err', 'Engine error: ' + err.message)
      }
      toggleSendStop(false)
    }
    chatAbort = null
  }

  // Stop button (Batch 1.3): send button toggles to Stop during processing.
  let isProcessing = false
  function toggleSendStop(stopping) {
    const send = document.getElementById('send')
    if (!send) return
    isProcessing = stopping
    if (stopping) {
      send.textContent = '⏹'
      send.classList.add('btn-stop')
    } else {
      send.textContent = 'Send'
      send.classList.remove('btn-stop')
    }
    const ta = document.getElementById('input')
    if (ta) ta.disabled = stopping
  }
  function bindStop() {
    // Stop is handled via the send button's existing click handler — see send's
    // event listener below (checks isProcessing to decide send vs abort).
  }

  async function streamAnalyze() {
    const step = addMsg('step', 'reading document…')
    try {
      const body = await getDocText()
      const res = await fetch(SIDECAR + '/api/document/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body.slice(0, 200000), docId }),
      })
      if (!res.ok) throw new Error(await res.text())
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buffer = ''
      let comments = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()
        for (const part of parts) {
          if (!part.startsWith('data:')) continue
          const evt = JSON.parse(part.slice(5))
          if (evt.type === 'step') {
            // Timeline: every section/tool step appends its own row (same
            // treatment as chat); tool calls render as pill chips BETWEEN
            // thinking phases — finalize the active card first.
            finalizeThinkCard()
            if (/^tool:/.test(evt.text || '')) addMsg('toolstep', evt.text.replace(/^tool:\s*/, ''))
            else addMsg('step', evt.text)
          } else if (evt.type === 'reasoning') { addThinkStep(evt.text, evt.streaming === true) }
          else if (evt.type === 'note') { addNoteChip(evt) }
          else if (evt.type === 'suggestion') {
            comments++
            renderSuggestion(evt.suggestion, true)
            renderChatSuggestion(evt.suggestion, false)
            addMsg('step', `analyzing… ${comments} suggestion(s) so far`)
          } else if (evt.type === 'error') { addMsg('err', evt.message) }
          else if (evt.type === 'done') { addMsg('step', `done — ${evt.comments || comments} suggestion(s)`) }
        }
      }
      finalizeThinkCard()
    } catch (err) {
      finalizeThinkCard()
      step.remove()
      addMsg('err', 'Analysis failed: ' + err.message)
    }
  }

  // Streaming step suppression: during active text streaming, suppress new
  // step/tool rows — they fragment the prose into disconnected chunks.
  // The reasoning card already shows the tool trace; step rows are noise
  // during streaming.
  let streamingActive = false

  function handleChatEvent(evt, step, getAgentMsg) {
    // Suppress step events while text is actively streaming
    if (evt.type !== 'text' && evt.type !== 'reasoning') streamingActive = false
    if (evt.type === 'step' && streamingActive) return

    switch (evt.type) {
      case 'step':
        dismissCompaction()
        // Every step event gets its own row → visible timeline:
        // planning → tool: get_range_text → searching law packs → writing…
        // Tool calls render as distinct chips BETWEEN thinking phases —
        // finalize the active card first so the chip sits between cards.
        finalizeThinkCard()
        if (/^tool:/.test(evt.text || '')) {
          const row = addMsg('toolstep', evt.text.replace(/^tool:\s*/, ''))
          row._auto = true
          markLive(row)
        } else {
          markLive(addMsg('step', evt.text))
        }
        break
      case 'skill':
        addMsg('step', `Skill: ${evt.title}`)
        break
      case 'skill_suggestion':
        addSkillChip(evt)
        break
      case 'reasoning':
        dismissCompaction()
        // Working trace — folded into the collapsible thinking card.
        addThinkStep(evt.text, evt.streaming === true)
        break
      case 'note':
        // Agent's `remember` calls → clickable bookmarks in the thread
        // + a badge on the document-map node they refer to.
        addNoteChip(evt)
        break
      case 'scorecard':
        // Batch 5: an agent-emitted risk scorecard renders as a dedicated
        // card (big score + category bars) instead of plain prose.
        addScorecardCard(evt.scorecard)
        break
      case 'law':
        // Laws the agent pulled from the local law packs — visible proof
        // of the database basis (source + section + snippet).
        addLawCard(evt.sources || [])
        break
      case 'compact':
        // Context compaction happened — show a "still working" card with
        // a spinner + what was pruned, so the run never looks stalled.
        showCompaction(evt)
        break
      case 'plan':
        // Plan card removed (0.1.65) — the reasoning card already shows the
        // same first line; the green 📋 card was pure duplication.
        break
      case 'suggestion':
        if (autopilot && evt.suggestion) {
          autopilotApply(evt.suggestion)
        } else {
          renderSuggestion(evt.suggestion, true)
          renderChatSuggestion(evt.suggestion, true)
        }
        break
      case 'text':
        streamingActive = true
        dismissCompaction()
        clearLive()
        finalizeThinkCard()
        if (!getAgentMsg()) {
          if (step) step.remove()
          getAgentMsg = () => addMsg('agent', '')
        }
        const msgEl = getAgentMsg()
        if (msgEl._mdInner) {
          msgEl._mdText += evt.text
          msgEl._mdInner.innerHTML = mdToHtml(msgEl._mdText)
        } else {
          msgEl.textContent += evt.text
        }
        $('#chat').scrollTop = $('#chat').scrollHeight
        break
      case 'done':
        dismissCompaction()
        clearLive()
        finalizeThinkCard()
        if (step) step.remove()
        break
      case 'error':
        dismissCompaction()
        clearLive()
        finalizeThinkCard()
        if (step) step.remove()
        addMsg('err', evt.message || 'unknown engine error')
        break
    }
  }

  /* Law-sources card: which laws the agent found and used from the local
   * database. Collapsible; each source shows name · section · snippet. */
  function addLawCard(sources) {
    const el = document.createElement('div')
    el.className = 'lawcard'
    const seen = new Map()
    for (const s of sources) if (s && s.source_name && !seen.has(s.source_name)) seen.set(s.source_name, s)
    const list = [...seen.values()]
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'law-toggle'
    toggle.innerHTML = `<span class="law-gavel">⚖</span> <span>${list.length} law${list.length === 1 ? '' : 's'} found in the database</span><span class="law-chev">▾</span>`
    const body = document.createElement('div')
    body.className = 'law-body'
    body.innerHTML = list.map((s) =>
      `<div class="law-row"><span class="law-name">${escHtml(s.source_name)}</span>${s.section ? ` <span class="law-sec">${escHtml(s.section)}</span>` : ''}` +
      (s.snippet ? `<div class="law-snip">${escHtml(s.snippet)}</div>` : '') + `</div>`
    ).join('')
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open')
      body.style.display = body.style.display === 'none' ? '' : 'none'
    })
    el.appendChild(toggle)
    el.appendChild(body)
    $('#chat').appendChild(el)
    $('#chat').scrollTop = $('#chat').scrollHeight
    bindLawCard(el, list)
    return el
  }

  function addScorecardCard(sc) {
    if (!sc) return
    const score = Math.max(0, Math.min(100, Math.round(+sc.score || 0)))
    const tone = score >= 70 ? 'high' : score >= 45 ? 'mid' : 'low'
    const cats = sc.categories || {}
    const el = document.createElement('div')
    el.className = 'scard'
    el.innerHTML =
      `<div class="scard-head"><span class="scard-label">Risk score</span>` +
      `<span class="scard-score ${tone}">${score}/100</span></div>` +
      (Object.keys(cats).length
        ? `<div class="scard-bars">` + Object.entries(cats).map(([k, v]) =>
            `<div class="scard-bar"><span class="scard-bar-name">${escHtml(k)}</span>` +
            `<div class="scard-bar-track"><div class="scard-bar-fill" style="width:${Math.max(2, Math.min(100, +v || 0))}%"></div></div>` +
            `<span class="scard-bar-val">${+v || 0}%</span></div>`).join('') + `</div>`
        : '') +
      (sc.summary ? `<div class="scard-sum">${escHtml(sc.summary)}</div>` : '')
    $('#chat').appendChild(el)
    $('#chat').scrollTop = $('#chat').scrollHeight
    return el
  }

  /* Compaction progress card: the context was compacted mid-run — show a
   * spinner + what was pruned so the user knows it's still working. The
   * card is replaced by the next step/thinking event. */
  let compactionRow = null
  function showCompaction(evt) {
    const phase = String(evt.phase || 'working')
    const actions = (evt.actions || []).filter(Boolean)
    const detail = actions.length ? `kept your document · ${actions.join(' · ')}` : 'compressing earlier steps'
    if (!compactionRow || !compactionRow.isConnected) {
      compactionRow = addMsg('step', '')
      compactionRow._auto = true
    }
    compactionRow.textContent = `${phase}… still working — ${detail}`
    markLive(compactionRow)
    return compactionRow
  }
  function dismissCompaction() {
    if (compactionRow && compactionRow.isConnected) compactionRow.remove()
    compactionRow = null
  }

  /* Active-phase shimmer: the CURRENT step row (planning…/writing…/tool
   * chips/compacting…) glows with the sweep animation so the user sees
   * the run is alive — the same treatment for every action, no pills. */
  function markLive(row) {
    document.querySelectorAll('.msg.step.live, .msg.toolstep.live').forEach((r) => r.classList.remove('live'))
    if (row) row.classList.add('live')
  }
  function clearLive() {
    document.querySelectorAll('.msg.step.live, .msg.toolstep.live').forEach((r) => r.classList.remove('live'))
  }

  /* Law card (Batch 2.8): clicking a source fetches the full statute text. */
  function bindLawCard(el, sources) {
    const rows = el.querySelectorAll('.law-row')
    rows.forEach((row, i) => {
      const src = sources[i]
      if (!src) return
      row.style.cursor = 'pointer'
      row.title = 'click for full text'
      row.addEventListener('click', async () => {
        try {
          const r = await api('/api/law/section?chunk_id=' + encodeURIComponent(src.chunk_id))
          const detail = document.createElement('div')
          detail.className = 'law-detail'
          detail.innerHTML = `<div class="basis">${escHtml(r.source_name || '')} ${escHtml(r.section || '')}</div><div class="law-snip">${escHtml(String(r.content || '').slice(0, 1500))}</div>`
          const existing = row.parentNode.querySelector('.law-detail')
          if (existing) existing.remove()
          row.parentNode.appendChild(detail)
          $('#chat').scrollTop = $('#chat').scrollHeight
        } catch (err) { addMsg('err', err.message) }
      })
    })
  }

  /* Plan card REMOVED (0.1.65) — duplicated the reasoning card's first line. */

  /* Bookmark chip: the agent's note for a section. Clicking jumps Word to
   * that spot (search-select of the section's first words). Notes without
   * a section index render without the § label and don't jump. */
  const notesBySection = {}
  function addNoteChip(note) {
    const idx = note.section
    const el = document.createElement('div')
    el.className = 'notechip'
    const secLabel = (idx !== '' && idx != null) ? `<span class="note-sec">§${escHtml(String(idx))}${note.entity ? ' · ' + escHtml(note.entity) : ''}</span>` : (note.entity ? `<span class="note-sec">${escHtml(note.entity)}</span>` : '')
    el.innerHTML = `<span class="note-pin">📌</span><span class="note-body">${secLabel}<span class="note-claim">${escHtml(note.claim || '')}</span></span>`
    if (idx !== '' && idx != null) {
      el.addEventListener('click', () => jumpToSection(idx))
    } else {
      el.style.cursor = 'default'
    }
    $('#chat').appendChild(el)
    $('#chat').scrollTop = $('#chat').scrollHeight
    if (idx !== '' && idx != null) {
      notesBySection[idx] = (notesBySection[idx] || 0) + 1
      const node = $('#doctree [data-idx="' + idx + '"] .badge')
      if (node) { node.textContent = '📌 ' + notesBySection[idx]; node.classList.add('noted') }
    }
    return el
  }

  async function jumpToSection(idx) {
    try {
      const r = await api('/api/document/section', { method: 'POST', body: { docId, index: idx } })
      const snippet = String(r.text || '').split('\n').filter(Boolean)[0] || ''
      if (!snippet) return addMsg('err', 'No text to jump to in section ' + idx)
      await Word.run(async (context) => {
        const res = context.document.body.search(snippet.slice(0, 60), { matchCase: false })
        res.load('items')
        await context.sync()
        if (res.items.length) { res.items[0].select(); await context.sync() }
        else throw new Error('anchor not found in document')
      })
    } catch (err) {
      addMsg('err', 'Jump to §' + idx + ' failed: ' + err.message)
    }
  }

  // ── Batch 4: Word-native superpowers ───────────────────────────────────────
  async function reviewAll(action) {
    try {
      await Word.run(async (context) => {
        if (action === 'accept') context.document.acceptAllRevisionsShown()
        else context.document.rejectAllRevisionsShown()
        await context.sync()
      })
      addMsg('step', action === 'accept' ? '✓ accepted all shown tracked changes' : '✓ rejected all shown tracked changes')
    } catch (err) { addMsg('err', err.message) }
  }

  function bindCompare() {
    const btn = document.getElementById('compareDoc')
    const fileInput = document.getElementById('compareFile')
    if (!btn || !fileInput) return
    btn.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0]
      fileInput.value = ''
      if (!f) return
      addMsg('step', 'comparing — Word will mark every difference as a tracked change…')
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
        addMsg('step', 'compare done — extracting differences…')
        const revisions = await extractRevisions()
        if (!revisions.length) { addMsg('step', 'no differences found'); return }
        const text = 'Summarize the differences in this contract compared to the counterparty version. ' +
          'Group by clause; say what changed, who it favors, and what to push back on.\n\nDIFFERENCES:\n' +
          revisions.slice(0, 40).map((r) => `[${r.type}] ${r.text}`).join('\n')
        const input = $('#input')
        if (input) { input.value = text; $('#send').click() }
      } catch (err) { addMsg('err', 'compare failed: ' + err.message) }
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

  async function bindCommentDigest() {
    const btn = document.getElementById('commentDigest')
    if (!btn) return
    btn.addEventListener('click', async () => {
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
        if (!comments.length) { addMsg('step', 'no comments in this document'); return }
        const input = $('#input')
        if (input) {
          input.value = 'Draft a response memo addressing the comments on this document:\n\n' + comments.join('\n')
          $('#send').click()
        }
      } catch (err) { addMsg('err', 'comments unavailable: ' + err.message) }
    })
  }

  async function bindXref() {
    const btn = document.getElementById('xrefCheck')
    if (!btn) return
    btn.addEventListener('click', async () => {
      if (!docText || !docMap) { addMsg('step', 'build the document map first'); return }
      const nums = new Set((docMap.sections || []).map((s) => String(s.index)))
      const re = /(?:Section|§|Artikel|Article)\s+(\d{1,3})(?!\.\d)/gi
      const broken = new Set()
      let m
      while ((m = re.exec(docText))) {
        if (nums.has(m[1])) continue
        const line = docText.slice(Math.max(0, m.index - 60), m.index + 20).replace(/\s+/g, ' ').trim()
        broken.add(`${m[0]} → ${line.slice(-90)}`)
      }
      if (!broken.size) { addMsg('step', '✓ no broken cross-references found'); return }
      addMsg('step', '⚠ possible broken cross-references:')
      ;[...broken].slice(0, 15).forEach((b) => addMsg('step', '· ' + b))
    })
  }

  function obligCheck() {
    if (!docText) { addMsg('step', 'extract text first (select-all → the caret menu)'); return }
    const lines = String(docText).split(/\n+/).map((l) => l.trim()).filter((l) => /(shall|must not|may not|undertakes to|agrees to|warrants)\b/i.test(l))
    const uniq = [...new Set(lines)].slice(0, 30)
    if (!uniq.length) { addMsg('step', 'no obligation-style terms detected in the extracted text'); return }
    const el = document.createElement('div')
    el.className = 'oclist'
    el.innerHTML = `<div class="scard-label" style="padding:.1rem 0 .2rem">Obligation checklist (deterministic)</div>` + uniq.map((l, i) =>
      `<label class="oc-line"><input type="checkbox" data-i="${i}"><span>${escHtml(l.slice(0, 140))}</span></label>`).join('')
    $('#chat').appendChild(el)
    const update = () => {
      const done = el.querySelectorAll('input:checked').length
      if (done === uniq.length) addScorecardCard({ score: 100, categories: { obligation_status: 100 }, summary: `all ${uniq.length} obligations completed` })
    }
    el.querySelectorAll('input').forEach((c) => c.addEventListener('change', update))
    $('#chat').scrollTop = $('#chat').scrollHeight
  }

  // ── Suggestions tab (Batch 2.8): filters + bulk + stale anchors ────────────
  function bindSuggestionsTab() {
    const list = document.getElementById('sugList')
    if (!list) return
    const bar = document.createElement('div')
    bar.className = 'sugbar'
    bar.innerHTML = `
      <span class="sug-filter" data-f="all">All</span>
      <span class="sug-filter" data-f="high">High</span>
      <span class="sug-filter" data-f="medium">Med</span>
      <span class="sug-filter" data-f="low">Low</span>
      <span style="flex:1"></span>
      <button class="btn btn-ghost" id="bulkAccept" type="button">Accept all (tracked)</button>
      <button class="btn btn-ghost" id="bulkDismiss" type="button">Dismiss all</button>
      <span style="flex-basis:100%"></span>
      <button class="btn btn-ghost" id="revAccept" type="button">Accept all in Review</button>
      <button class="btn btn-ghost" id="revReject" type="button">Reject all in Review</button>`
    list.parentNode.insertBefore(bar, list)
    let cur = 'all'
    const apply = () => {
      document.querySelectorAll('#sugList .sug').forEach((el) => {
        const sev = (el.querySelector('.sev') || {}).textContent || 'low'
        el.style.display = (cur === 'all' || sev === cur) ? '' : 'none'
      })
    }
    bar.querySelectorAll('.sug-filter').forEach((f) => f.addEventListener('click', () => {
      cur = f.dataset.f
      bar.querySelectorAll('.sug-filter').forEach((x) => x.classList.toggle('active', x === f))
      apply()
    }))
    document.getElementById('bulkAccept').addEventListener('click', async () => {
      const cards = [...document.querySelectorAll('#sugList .sug')].filter((el) => el.style.display !== 'none')
      for (const el of cards) {
        const btn = el.querySelector('.btn')
        if (btn) btn.click()
      }
    })
    document.getElementById('bulkDismiss').addEventListener('click', () => {
      document.querySelectorAll('#sugList .sug').forEach((el) => { if (el.style.display !== 'none') el.remove() })
    })
    document.getElementById('revAccept').addEventListener('click', () => reviewAll('accept'))
    document.getElementById('revReject').addEventListener('click', () => reviewAll('reject'))
  }

  // Stale-anchor detection: mark cards whose anchor no longer exists in the doc.
  function markStale(el, s) {
    if (!el || !s || !s.anchor || !s.anchor.text) return
    if (docText && !docText.replace(/\s+/g, ' ').includes(s.anchor.text.replace(/\s+/g, ' ').slice(0, 120))) {
      const note = document.createElement('div')
      note.className = 'basis stale'
      note.textContent = '⚠ document changed — anchor no longer found, verify before applying'
      el.insertBefore(note, el.querySelector('.sug-actions') || null)
    }
  }

  // ── Selection-aware actions ────────────────────────────────────────────────
  // Select any text in Word → an action bar appears above the composer
  // (Explain / Rewrite for the client / Check compliance). The selection
  // becomes the anchor — no typing section numbers.
  let selectionBar = null
  function bindSelection() {
    if (!Office.context.document || !Office.context.document.addHandlerAsync) return
    let timer = null
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => {
      clearTimeout(timer)
      timer = setTimeout(readSelection, 400)
    })
  }
  async function readSelection() {
    try {
      const value = await new Promise((resolve, reject) => {
        Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
          if (r.status === Office.AsyncResultStatus.Succeeded) resolve(r.value)
          else reject(new Error(r.error && r.error.message))
        })
      })
      const text = String(value || '').trim()
      if (!text || text.length > 6000) return hideSelectionBar()
      showSelectionBar(text)
    } catch { hideSelectionBar() }
  }
  function showSelectionBar(text) {
    if (!selectionBar) {
      selectionBar = document.createElement('div')
      selectionBar.className = 'selbar'
      selectionBar.innerHTML =
        '<span class="sel-hint">Selected:</span>' +
        '<button class="btn sel-act" data-act="Explain">Explain</button>' +
        '<button class="btn sel-act" data-act="Rewrite for the client">Rewrite for the client</button>' +
        '<button class="btn sel-act" data-act="Check compliance">Check compliance</button>' +
        '<button class="btn btn-ghost sel-close" type="button">✕</button>'
      const composer = document.querySelector('.composer')
      if (composer && composer.parentNode) composer.parentNode.insertBefore(selectionBar, composer)
      const close = selectionBar.querySelector('.sel-close')
      if (close) close.addEventListener('click', hideSelectionBar)
      selectionBar.querySelectorAll('.sel-act').forEach((b) => b.addEventListener('click', () => {
        const msg = `${b.dataset.act} the following selected text:\n"${selectionBar._selText}"`
        hideSelectionBar()
        const input = $('#input')
        if (input) { input.value = msg; $('#send').click() }
      }))
    }
    selectionBar._selText = text
    selectionBar.style.display = 'flex'
  }
  function hideSelectionBar() {
    if (selectionBar) selectionBar.style.display = 'none'
  }

  // ── Document map ──────────────────────────────────────────────────────────
  let docMap = null
  function currentDocMap() { return docMap }
  let docId = null
  let docText = null

  function bindDocMap() {
    $('#scanDoc').addEventListener('click', async () => {
      try {
        const body = await getDocTextAndStyles()
        $('#docmeta').textContent = `Extracted ${body.text.length.toLocaleString()} chars`
        const map = await mapBody(body)
        docMap = map
        docId = map.doc_id
        docText = body
        renderTree(map)
      } catch (err) {
        $('#docmeta').textContent = 'Map failed: ' + err.message
      }
    })
  }

  function renderTree(map) {
    const tree = $('#doctree')
    tree.innerHTML = ''
    if (!map.sections || !map.sections.length) {
      tree.innerHTML = '<div class="muted">No headings detected — plain text document?</div>'
    }
    map.sections.forEach((s) => {
      const el = document.createElement('div')
      el.className = 'node lvl' + Math.min(s.level || 0, 2)
      el.dataset.idx = s.index
      const noted = notesBySection[s.index] ? `<span class="badge noted">📌 ${notesBySection[s.index]}</span>` : ''
      const badge = s.flags ? `<span class="badge">${s.flags} ⚑</span>` : noted || '<span class="badge clean">ok</span>'
      el.innerHTML = `<span>${escHtml(s.heading || ('Section ' + s.index))}</span>${badge}`
      el.addEventListener('click', async () => {
        try {
          const r = await api('/api/document/section', { method: 'POST', body: { docId, index: s.index } })
          addMsg('user', '“' + (s.heading || 'section ' + s.index) + '”')
          addMsg('agent', r.text)
        } catch (err) { addMsg('err', err.message) }
      })
      tree.appendChild(el)
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

  /* Style-based map (Batch 2.6): body text + the real paragraph styles
   * (styleBuiltIn — locale-independent Heading1..6 / Title), aligned to the
   * sidecar's normalized paragraphs (blanks skipped). */
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
  function renderSuggestion(s, post = false) {
    const item = document.createElement('div')
    item.className = 'sug'
    item.id = 'sug-' + s.id
    item.innerHTML = `
      <div class="sug-head"><span>${s.summary}</span><span class="sev ${s.severity || 'low'}">${s.severity || 'low'}</span></div>
      ${(s.clauseText || s.anchor) && s.proposed_text ? diffHtml(s.anchor.wholeParagraph ? (s.clauseText || s.anchor.text) : s.anchor.text, s.proposed_text) : `<div class="muted">${s.proposed_text || ''}</div>`}
      <div class="basis">${s.basis ? s.basis.jurisdiction + ' · ' + s.basis.source + ' · ' + s.basis.section : ''}</div>
      ${s.citationWarning ? `<div class="basis cite-warn">⚠ ${escHtml(s.citationWarning)}</div>` : ''}
      ${s.collapseWarning ? `<div class="basis cite-warn">⚠ ${escHtml(s.collapseWarning)} — review before applying</div>` : ''}
      <div class="sug-actions">
        ${s.proposed_text ? '<button class="btn">Apply</button>' : ''}
        <button class="btn btn-ghost">Comment</button>
        <button class="btn btn-ghost">Dismiss</button>
      </div>`
    bindDiffFull(item)
    markStale(item, s)
    item.querySelector('.btn')?.addEventListener('click', async () => {
      try { await applySuggestion(s); item.remove() }
      catch (err) { addMsg('err', err.message) }
    })
    item.querySelectorAll('.btn-ghost')[0].addEventListener('click', async () => {
      try { await commentSuggestion(s); item.remove() }
      catch (err) { addMsg('err', err.message) }
    })
    item.querySelectorAll('.btn-ghost')[1].addEventListener('click', () => item.remove())
    $('#sugList').prepend(item)
    if (post && $('#postComments').checked) {
      if (Office.context.requirements.isSetSupported('WordApi', 1.4)) {
        commentSuggestion(s).catch((err) => addMsg('err', err.message))
      } else if (!commentsUnsupportedNoted) {
        commentsUnsupportedNoted = true
        addMsg('step', 'Word comments unavailable in this Word version — use Approve instead')
      }
    }
  }

  /* Suggestion card INLINE in the chat thread — the lawyer never leaves
   * the conversation to act. Shows where the change lands (§ + heading +
   * anchor quote) and the original → proposed diff, with three actions:
   *   Approve → insert as tracked change in Word (Review accept/reject)
   *   Defer   → keep it in the Suggestions tab, mark the chat card
   *   Reject  → drop it everywhere (chat card + tab card)
   * Clause rewrites in the chat path auto-insert as a TRACKED change —
   * the rewrite goes straight into Word's Review pane, fully reversible
   * there, no Apply click needed; the card settles to confirm. The bulk
   * Analyze pipeline stays review-first (no auto-insert). */
  function renderChatSuggestion(s, autoTrack = false) {
    const el = document.createElement('div')
    el.className = 'sug chat-sug'
    el.id = 'chat-sug-' + s.id
    const sec = docMap && docMap.sections ? docMap.sections.find((x) => x.index === s.sectionIndex) : null
    const loc = sec
      ? `§${sec.index}${sec.heading ? ' · ' + sec.heading : ''}`
      : (s.anchor && s.anchor.text ? 'in: “' + s.anchor.text.slice(0, 70) + '…”' : '')
    const whole = s.anchor && s.anchor.wholeParagraph ? ' — replaces the entire clause' : ''
    const sev = s.severity || 'low'
    el.innerHTML = `
      <div class="sug-head"><span>${s.summary}</span><span class="sev ${sev}">${sev}</span></div>
      ${loc ? `<div class="basis loc">${escHtml(loc + whole)}</div>` : ''}
      ${s.citationWarning ? `<div class="basis cite-warn">⚠ ${escHtml(s.citationWarning)}</div>` : ''}
      ${s.collapseWarning ? `<div class="basis cite-warn">⚠ ${escHtml(s.collapseWarning)} — review before applying</div>` : ''}
      ${(s.clauseText || s.anchor) && s.proposed_text ? diffHtml(s.anchor.wholeParagraph ? (s.clauseText || s.anchor.text) : s.anchor.text, s.proposed_text) : `<div class="muted">${s.proposed_text || ''}</div>`}
      <div class="sug-actions">
        <button class="btn chat-approve">Approve</button>
        <button class="btn btn-ghost chat-defer">Defer</button>
        <button class="btn btn-ghost chat-reject">Reject</button>
      </div>`
    bindDiffFull(el)
    markStale(el, s)
    el.querySelector('.chat-approve').addEventListener('click', async () => {
      if (s._applied) return
      s._applied = true
      try {
        await applySuggestion(s)
        settleChatCard(el, 'Approved — inserted as a tracked change (Review → Accept/Reject in Word)', true)
        const tabCard = document.getElementById('sug-' + s.id)
        if (tabCard) tabCard.remove()
      } catch (err) { s._applied = false; addMsg('err', err.message) }
    })
    el.querySelector('.chat-defer').addEventListener('click', () => {
      if (s._applied) return
      settleChatCard(el, 'Deferred — review it in the Suggestions tab')
    })
    el.querySelector('.chat-reject').addEventListener('click', () => {
      if (s._applied) return
      const tabCard = document.getElementById('sug-' + s.id)
      if (tabCard) tabCard.remove()
      el.remove()
    })
    $('#chat').appendChild(el)
    $('#chat').scrollTop = $('#chat').scrollHeight

    // Clause rewrite in the chat path → put it INTO REVIEW right away:
    // insert as a TRACKED change (reversible in Word's Review pane), then
    // settle the card. This is unconditional — it never waits for Apply,
    // and it never writes plain text (forceTracked ignores the "permanent"
    // applyMode setting; the user asked in chat, and a rewrite must always
    // be reversible there). A clause rewrite is any suggestion carrying a
    // proposed replacement for a section the agent read (sectionIndex) or
    // an explicitly whole-clause anchor. Skipped only when tracking is
    // unsupported — the card keeps its Approve button, which then explains
    // why. The bulk Analyze pipeline stays review-first (autoTrack=false).
    // NEVER auto-apply a non-rewrite: clarification text ("N/A", "please
    // specify…") as proposed_text would REPLACE a real clause with garbage
    // (2026-08-15 incident) — the sidecar filters these, this is the pane's
    // own belt-and-braces.
    const NOOP_RE = /^(n\/?a|please specify|please provide|need clarification|i need more|not enough|no change|no rewrite|not applicable|unchanged|as is|none|nothing)/i
    const realRewrite = s.proposed_text && s.proposed_text.trim().length >= 40 && !NOOP_RE.test(s.proposed_text.trim())
    const isClauseRewrite = realRewrite && (s.sectionIndex != null || (s.anchor && s.anchor.wholeParagraph))
    if (autoTrack && isClauseRewrite &&
        Office.context.requirements.isSetSupported('WordApi', 1.4)) {
      s._applied = true
      applySuggestion(s, { forceTracked: true })
        .then(() => {
          settleChatCard(el, 'Inserted as a tracked change — Review → Accept/Reject in Word', true)
          const tabCard = document.getElementById('sug-' + s.id)
          if (tabCard) tabCard.remove()
        })
        .catch((err) => { s._applied = false; addMsg('err', err.message) })
    }
  }

  /* Settle a card. keepActions=true (auto-apply path): the Accept/Reject
   * controls STAY — the user asked to keep them; the note explains where
   * the change landed and the Approve button disables (already applied).
   * keepActions=false (manual Approve/Defer): actions are replaced by the
   * note as before. */
  function settleChatCard(el, msg, keepActions) {
    const note = document.createElement('div')
    note.className = 'basis'
    note.textContent = msg
    el.appendChild(note)
    el.classList.add('settled')
    if (!keepActions) {
      const actions = el.querySelector('.sug-actions')
      if (actions) actions.remove()
    } else {
      const approve = el.querySelector('.chat-approve')
      if (approve) { approve.disabled = true; approve.textContent = 'Applied' }
      el.classList.add('applied')
    }
  }

  async function commentSuggestion(s) {
    if (!s.anchor || !s.anchor.text) return
    if (!Office.context.requirements.isSetSupported('WordApi', 1.4)) {
      throw new Error('Word comments are not available in this document/Word version — use Approve instead')
    }
    return Word.run(async (context) => {
      const search = context.document.body.search(s.anchor.text, { matchCase: true })
      search.load('items')
      await context.sync()
      if (search.items.length === 0) {
        throw new Error('anchored text no longer present (document edited?) — suggestion kept in pane only')
      }
      const range = search.items[0]
      if (!range.comment) throw new Error('Word comments are not available in this document/Word version — use Approve instead')
      range.comment.add(s.summary)
      await context.sync()
    })
  }

  // Apply a suggestion as an edit (decision D, default A):
  //   A (default, "tracked"): read changeTrackingMode → set TrackAll →
  //     replace text → restore prior mode. The edit lands as native Word
  //     redline the lawyer accepts/rejects in Review — works even when the
  //     user is NOT in review mode. changeTrackingMode is settable
  //     (WordApi 1.4+). When tracking is NOT available (old Word,
  //     Compatibility Mode) the apply is REFUSED unless the user has
  //     explicitly picked permanent edits — a silent plain replace has
  //     burned real contracts.
  //   B ("permanent"): plain replace (the pane diff preview is the review).
  // opts.forceTracked: the chat path's AUTO-apply (clause rewrites) always
  //   passes this — the rewrite lands in Word's Review as a tracked change
  //   no matter what applyMode says, because the user asked for it in chat
  //   and must be able to reverse it. Plain text is never auto-written.
  let applyMode = 'tracked' // synced from /api/config/agent
  async function applySuggestion(s, opts = {}) {
    // Never a silent no-op: a missing anchor previously resolved as
    // success (card settled, nothing inserted — 2026-08-15 incident).
    if (!s.proposed_text) throw new Error('Suggestion has no replacement text — cannot apply')
    if (!s.anchor || !String(s.anchor.text || '').trim()) {
      throw new Error('Suggestion has no anchor text — cannot locate the clause in Word')
    }
    const wantTracked = opts.forceTracked ? true : applyMode === 'tracked'
    if (wantTracked && !Office.context.requirements.isSetSupported('WordApi', 1.4)) {
      throw new Error('Tracked changes are not available in this document (Compatibility Mode?) — save as .docx, or switch Apply to "permanent" in Settings')
    }
    return Word.run(async (context) => {
      let target = null
      // Deterministic path first: the sidecar knows which body paragraph
      // the clause starts at (paraIndex, from the document map). Word's
      // paragraphs are 1:1 with body.text paragraphs UNLESS the doc was
      // edited after mapping — so verify the paragraph's text starts like
      // the anchor before touching it; on any mismatch, fall back to the
      // text search below.
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
            if (first && anchorProbe && (first.startsWith(anchorProbe) || anchorProbe.startsWith(first))) {
              target = p
            }
          }
        } catch { /* index path failed — fall through to search */ }
      }
      if (!target) {
        // Word caps search text at 255 chars — clause-length anchors must be
        // searched by a word-boundary prefix probe. The match then expands
        // to the containing paragraph (the anchor is the clause, so its
        // paragraph IS the clause unit).
        let probe = s.anchor.text
        let probed = false
        if (probe.length > 250) {
          probe = probe.slice(0, 250)
          const sp = probe.lastIndexOf(' ')
          if (sp >= 120) probe = probe.slice(0, sp)
          probed = true
        }
        const search = context.document.body.search(probe, { matchCase: true })
        search.load('items')
        await context.sync()
        if (search.items.length === 0) throw new Error('anchored text no longer present (document edited?)')
        target = search.items[0]
        // Whole-clause rewrite: expand the replacement to the entire
        // containing paragraph — the clause is replaced as a unit, no
        // original tail left glued after the new text. A truncated probe
        // is the same situation. Defensive: some Word hosts surface
        // search ranges without the full API (getParagraphs missing) —
        // never crash; degrade to replacing the matched range only.
        if (s.anchor && (s.anchor.wholeParagraph || probed)) {
          try {
            const getParas = (r) => (typeof r.getParagraphs === 'function' ? r.getParagraphs() : r.paragraphs)
            const paras = getParas(target)
            paras.load('items')
            await context.sync()
            if (paras.items.length) target = paras.items[0]
          } catch (e) {
            addMsg('step', 'paragraph expansion unavailable — applying to the matched text only')
          }
        }
      }

      // Revert-last (Batch 1.4): capture the original text BEFORE the
      // replace so Undo can restore it as a tracked change.
      let originalText = ''
      try {
        target.load('text')
        await context.sync()
        originalText = String(target.text || '')
      } catch { /* best-effort */ }

      if (wantTracked) {
        context.document.load('changeTrackingMode')
        await context.sync()
        const prior = context.document.changeTrackingMode
        context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll
        await context.sync()
        // Verify the mode actually took — hosts in Compatibility Mode can
        // accept the set and ignore it. Never trust the silent fallback.
        context.document.load('changeTrackingMode')
        await context.sync()
        if (context.document.changeTrackingMode !== Word.ChangeTrackingMode.trackAll) {
          context.document.changeTrackingMode = prior
          await context.sync()
          throw new Error('Tracked changes are not available in this document (Compatibility Mode?) — save as .docx, or switch Apply to "permanent" in Settings')
        }
        try {
          target.insertText(s.proposed_text, Word.InsertLocation.replace)
          await context.sync()
        } finally {
          context.document.changeTrackingMode = prior
          await context.sync()
        }
        if (!opts.silent) addMsg('step', 'inserted as tracked change — visible in Review (Accept/Reject)')
      } else {
        target.insertText(s.proposed_text, Word.InsertLocation.replace)
        await context.sync()
      }
      if (originalText) pushApplied({ original: originalText, applied: s.proposed_text, wholeParagraph: !!(s.anchor && s.anchor.wholeParagraph) })
    })
  }

  // ── Revert-last (Batch 1.4) ───────────────────────────────────────────────
  // Applied-suggestion stack; "Undo last" re-inserts the ORIGINAL text as a
  // tracked change over the applied text (reversible in Review).
  let appliedStack = []
  function pushApplied(entry) { appliedStack.push(entry); updateUndoBtn() }
  function updateUndoBtn() {
    const b = document.getElementById('undoBtn')
    if (b) b.disabled = appliedStack.length === 0
  }
  async function undoLast() {
    const entry = appliedStack.pop()
    if (!entry) return
    try {
      await Word.run(async (context) => {
        let probe = String(entry.applied || '')
        let probed = false
        if (probe.length > 200) {
          probe = probe.slice(0, 200)
          const sp = probe.lastIndexOf(' ')
          if (sp >= 100) probe = probe.slice(0, sp)
          probed = true
        }
        const search = context.document.body.search(probe, { matchCase: true })
        search.load('items')
        await context.sync()
        if (search.items.length === 0) throw new Error('applied text no longer present — undo skipped')
        let target = search.items[0]
        if (entry.wholeParagraph || probed) {
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
      addMsg('step', '↩ undone — original restored as a tracked change (Review → Accept/Reject)')
    } catch (err) {
      addMsg('err', 'undo failed: ' + err.message)
    }
    updateUndoBtn()
  }
  function bindUndo() {
    const b = document.getElementById('undoBtn')
    if (b) b.addEventListener('click', undoLast)
    updateUndoBtn()
  }

  // In-pane diff preview: original struck through, proposed highlighted.
  // The "original" side shows the FULL clause (s.clauseText — what the
  // model actually read), not the 160-char Word search probe; long
  // clauses collapse behind a "show full clause" toggle.
  function diffHtml(oldText, newText) {
    const esc = (t) => String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    if (!newText) return ''
    const full = String(oldText || '')
    const long = full.length > 300
    const shown = long ? full.slice(0, 300) + '…' : full
    return `<div class="diff">
      <div class="diff-old"><span class="muted">original:</span> <s>${esc(shown)}</s>` +
      (long ? `<button type="button" class="btn btn-ghost diff-full" data-full="${esc(full)}">show full clause</button>` : '') + `</div>
      <div class="diff-new"><span class="muted">proposed:</span> <b>${esc(newText)}</b></div>
    </div>`
  }

  // Wire the "show full clause" toggle inside a rendered card.
  function bindDiffFull(el) {
    const df = el && el.querySelector('.diff-full')
    if (!df) return
    df.addEventListener('click', () => {
      const s = df.parentElement && df.parentElement.querySelector('s')
      if (s) s.textContent = df.dataset.full
      df.remove()
    })
  }

  // ── Calendar settings (Batch W3) ───────────────────────────────────────────
  async function bindCalendar() {
    const box = document.getElementById('calEnabled')
    if (!box) return
    try {
      const cfg = await api('/api/calendar/config')
      box.checked = !!cfg.enabled
      const items = document.querySelectorAll('#calProviderDd .dd-item')
      const label = document.getElementById('calProviderLabel')
      const pick = (p) => {
        items.forEach((x) => x.classList.toggle('selected', x.dataset.provider === p))
        if (label) label.textContent = { auto: 'Auto (detect)', apple: 'Apple Calendar', outlook: 'Microsoft Outlook' }[p] || p
      }
      pick(cfg.provider || 'auto')
      document.querySelector('#calProviderDd .dd-btn')?.addEventListener('click', (e) => { e.stopPropagation(); document.querySelector('#calProviderDd')?.classList.toggle('open') })
      items.forEach((it) => it.addEventListener('click', async () => {
        pick(it.dataset.provider)
        document.querySelector('#calProviderDd')?.classList.remove('open')
        try { await api('/api/calendar/config', { method: 'POST', body: { enabled: box.checked, provider: it.dataset.provider } }) } catch {}
      }))
      box.addEventListener('change', async () => {
        try { await api('/api/calendar/config', { method: 'POST', body: { enabled: box.checked } }) } catch {}
      })
      document.addEventListener('click', () => document.querySelector('#calProviderDd')?.classList.remove('open'))
    } catch { /* sidecar offline */ }
  }

  // ── Workspace (Batch W1) ──────────────────────────────────────────────────
  async function refreshWorkspace() {
    const list = document.getElementById('wsList')
    if (!list) return
    try {
      const ws = await api('/api/workspace')
      const pathEl = document.getElementById('wsPath')
      if (pathEl) pathEl.value = ws.base
      list.innerHTML = ws.files.length
        ? '<b>Files:</b><br>' + ws.files.map((f) => escHtml(f.path) + ' (' + f.size + ' B)').join('<br>')
        : 'workspace empty'
    } catch { list.textContent = 'workspace unavailable' }
  }
  function bindWorkspace() {
    const save = document.getElementById('wsSave')
    const reveal = document.getElementById('wsReveal')
    if (save) save.addEventListener('click', async () => {
      const pathEl = document.getElementById('wsPath')
      try {
        const r = await api('/api/config/workspace', { method: 'POST', body: { path: pathEl.value } })
        pathEl.value = r.base
        refreshWorkspace()
      } catch (err) { addMsg('err', err.message) }
    })
    if (reveal) reveal.addEventListener('click', async () => {
      try { await api('/api/workspace/reveal', { method: 'POST', body: {} }) } catch (err) { addMsg('err', err.message) }
    })
    refreshWorkspace()
  }

  // ── Whole-matter workflows (Phase 4) ─────────────────────────────────────
  async function refreshPlaybooks() {
    const sel = $('#wfPlaybook')
    if (!sel) return
    try {
      const r = await api('/api/workflows/playbooks')
      sel.innerHTML = ''
      for (const pb of r.playbooks) {
        const o = document.createElement('option')
        o.value = pb.name
        o.textContent = `Checklist: ${pb.title}${pb.builtIn ? ' (built-in)' : ` · ${pb.checks} checks`}`
        sel.appendChild(o)
      }
    } catch { /* sidecar offline */ }
  }

  async function runWorkflow(type) {
    const msg = $('#wfMsg')
    const matterId = $('#matterSel')?.value || ''
    if (!matterId) { msg.textContent = 'Pick a matter first (top of the pane), and add its folder under Settings → Firm library.'; return }
    const buttons = [$('#wfReview'), $('#wfChrono'), $('#wfTranslate'), $('#wfCompare')].filter(Boolean)
    const extra = type === 'translate' ? { file: $('#wfDocA').value, target: $('#wfLang').value, glossary: $('#wfGlossary').value.trim() || undefined }
      : type === 'compare' ? { fileA: $('#wfDocA').value, fileB: $('#wfDocB').value } : {}
    if ((type === 'translate' && !extra.file) || (type === 'compare' && (!extra.fileA || !extra.fileB || extra.fileA === extra.fileB))) {
      msg.textContent = type === 'compare' ? 'Pick two different documents.' : 'Pick a document.'
      return
    }
    buttons.forEach((b) => { b.disabled = true })
    msg.textContent = 'Starting…'
    try {
      const res = await fetch(SIDECAR + '/api/workflows/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, matterId, playbook: $('#wfPlaybook').value || undefined, ...extra }),
      })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).replace(/^data:\s*/, '')
          buf = buf.slice(i + 2)
          let ev
          try { ev = JSON.parse(line) } catch { continue }
          if (ev.type === 'progress') msg.textContent = ev.step === 'rate' ? `rating ${ev.total} changes…` : ev.index ? `${ev.index}/${ev.total} · ${ev.name}` : (ev.name || '…')
          else if (ev.type === 'error') msg.textContent = ev.message
          else if (ev.type === 'done') {
            const st = ev.stats || {}
            const line = type === 'translate' ? `${st.translated}/${st.paragraphs} paragraphs translated · ${st.flags} flagged for review`
              : type === 'compare' ? `${st.changes} changes${st.high ? ` · ${st.high} high` : ''}${st.medium ? ` · ${st.medium} medium` : ''}${st.rateError ? ' · not rated: ' + st.rateError : ''}`
              : `${ev.count} ${type === 'review' ? 'verified findings' : 'dated events'} from ${st.documents} documents · ${st.unverified} unverified dropped`
            msg.innerHTML = ''
            msg.appendChild(document.createTextNode(line))
            const files = document.createElement('div')
            files.className = 'wf-files'
            for (const f of ev.files || []) {
              const a = document.createElement('a')
              a.textContent = f.split(/[\\/]/).pop()
              a.title = f
              a.addEventListener('click', () => api('/api/workspace/reveal', { method: 'POST', body: { path: f } }).catch(() => {}))
              files.appendChild(a)
            }
            msg.appendChild(files)
          }
        }
      }
    } catch (err) {
      msg.textContent = err.message
    } finally {
      buttons.forEach((b) => { b.disabled = false })
    }
  }

  function bindWorkflows() {
    if (!$('#wfReview')) return
    $('#wfReview').addEventListener('click', () => runWorkflow('review'))
    $('#wfChrono').addEventListener('click', () => runWorkflow('chronology'))
    $('#wfTranslate')?.addEventListener('click', () => runWorkflow('translate'))
    $('#wfCompare')?.addEventListener('click', () => runWorkflow('compare'))
    $('.wf-more')?.addEventListener('toggle', (e) => { if (e.target.open) refreshWorkflowDocs() })
    refreshPlaybooks()
    bindClauses()
  }

  // ── Firm clause library ──────────────────────────────────────────────────
  async function refreshClauses() {
    const sel = $('#clType')
    if (!sel) return
    const matterId = $('#matterSel')?.value || ''
    const params = new URLSearchParams({ matterId, type: sel.value || '', q: $('#clQuery').value.trim() })
    let data
    try { data = await api('/api/clauses?' + params) } catch { return }
    if (!sel.options.length || sel.dataset.files !== String(data.files)) {
      const cur = sel.value
      sel.innerHTML = '<option value="">Clause type…</option>'
      for (const t of data.types.filter((x) => x.count)) { const o = document.createElement('option'); o.value = t.id; o.textContent = `${t.label} (${t.count})`; sel.appendChild(o) }
      sel.value = cur
      sel.dataset.files = String(data.files)
    }
    const list = $('#clList')
    list.innerHTML = ''
    if (!data.files) { list.innerHTML = '<div class="muted" style="font-size:0.72rem">Add precedent folders under Settings → Firm library.</div>'; return }
    for (const c of data.clauses) {
      const item = document.createElement('details')
      item.className = 'cl-item'
      const sum = document.createElement('summary')
      sum.textContent = `${c.heading} · ${c.uses} doc${c.uses === 1 ? '' : 's'}`
      sum.title = c.documents.join(', ')
      const body = document.createElement('div')
      body.className = 'cl-text'
      body.textContent = c.text
      const btn = document.createElement('button')
      btn.className = 'btn btn-ghost'
      btn.type = 'button'
      btn.textContent = 'Insert at cursor'
      btn.addEventListener('click', () => insertFromApp(c.text).catch((err) => { btn.textContent = err.message }))
      item.append(sum, body, btn)
      list.appendChild(item)
    }
  }

  function bindClauses() {
    if (!$('#clType')) return
    $('#clType').addEventListener('change', refreshClauses)
    let t = null
    $('#clQuery').addEventListener('input', () => { clearTimeout(t); t = setTimeout(refreshClauses, 300) })
    refreshClauses()
  }

  async function refreshWorkflowDocs() {
    const matterId = $('#matterSel')?.value || ''
    let data
    try { data = await api('/api/workflows/documents?matterId=' + encodeURIComponent(matterId)) } catch { return }
    for (const id of ['#wfDocA', '#wfDocB']) {
      const sel = $(id)
      const cur = sel.value
      sel.innerHTML = data.documents.length ? '' : '<option value="">— no documents in this matter\'s folders —</option>'
      for (const d of data.documents) { const o = document.createElement('option'); o.value = d.path; o.textContent = d.name; sel.appendChild(o) }
      if (cur) sel.value = cur
    }
    const lang = $('#wfLang')
    if (!lang.options.length) {
      for (const [code, name] of Object.entries(data.languages)) { const o = document.createElement('option'); o.value = code; o.textContent = name; lang.appendChild(o) }
      lang.value = 'en'
    }
  }

  // ── Connectors (MCP servers, Phase 3) ────────────────────────────────────
  let mcpServers = []
  async function refreshMcp(msg) {
    const box = $('#mcpList')
    if (!box) return
    try { mcpServers = (await api('/api/mcp')).servers } catch { return }
    box.innerHTML = ''
    for (const sv of mcpServers) {
      const row = document.createElement('div')
      row.className = 'lib-folder'
      const name = document.createElement('span')
      name.className = 'path'
      name.style.direction = 'ltr'
      name.title = [sv.command, ...sv.args].join(' ')
      name.textContent = `${sv.name} — ${sv.connected ? `${sv.tools.length} tools` : (sv.error || 'not connected')}`
      const kind = document.createElement('span')
      kind.className = 'badge ' + (sv.remote ? 'cloud' : 'local')
      kind.textContent = sv.remote ? 'external' : 'local'
      const rm = document.createElement('button')
      rm.type = 'button'
      rm.textContent = '✕'
      rm.title = 'Remove connector'
      rm.addEventListener('click', async () => {
        try { await api('/api/mcp/servers/remove', { method: 'POST', body: { name: sv.name } }); refreshMcp('removed'); renderPolicyProviders() }
        catch (err) { $('#mcpMsg').textContent = err.message }
      })
      row.append(name, kind, rm)
      box.appendChild(row)
    }
    $('#mcpMsg').textContent = msg || (mcpServers.length ? '' : 'No connectors yet.')
    renderPolicyProviders()
  }

  function splitCommand(line) {
    // Minimal shell-like split: quotes group words, no expansion.
    const out = []
    line.replace(/"([^"]*)"|'([^']*)'|(\S+)/g, (_, a, b, c) => { out.push(a ?? b ?? c); return '' })
    return out
  }

  function bindWeb() {
    const btn = $('#webLogin')
    if (!btn) return
    btn.addEventListener('click', async () => {
      try { const r = await api('/api/web/login', { method: 'POST', body: { url: $('#webLoginUrl').value.trim() } }); $('#webMsg').textContent = r.message }
      catch (err) { $('#webMsg').textContent = err.message }
    })
  }

  function bindMcp() {
    if (!$('#mcpAdd')) return
    $('#mcpAdd').addEventListener('click', async () => {
      const parts = splitCommand($('#mcpCmd').value.trim())
      if (!parts.length) { $('#mcpMsg').textContent = 'Enter the command that starts the MCP server.'; return }
      $('#mcpMsg').textContent = 'Connecting…'
      try {
        await api('/api/mcp/servers', { method: 'POST', body: { name: $('#mcpName').value.trim(), config: { command: parts[0], args: parts.slice(1), remote: $('#mcpRemote').checked } } })
        $('#mcpName').value = ''; $('#mcpCmd').value = ''
        refreshMcp('added')
      } catch (err) { $('#mcpMsg').textContent = err.message }
    })
    $('#mcpReconnect').addEventListener('click', async () => {
      try { await api('/api/mcp/reconnect', { method: 'POST', body: {} }); refreshMcp('reconnected') } catch (err) { $('#mcpMsg').textContent = err.message }
    })
    refreshMcp()
  }

  // ── Firm library (Phase 2) ───────────────────────────────────────────────
  async function refreshLibrary(msg) {
    const box = $('#libFolders')
    if (!box) return
    let st
    try { st = await api('/api/library') } catch { return }
    box.innerHTML = ''
    for (const f of st.folders) {
      const row = document.createElement('div')
      row.className = 'lib-folder'
      const pth = document.createElement('span')
      pth.className = 'path'
      pth.title = f.path
      pth.textContent = f.path
      const scope = document.createElement('span')
      scope.className = 'badge'
      const m = mattersCache.find((x) => x.id === f.matterId)
      scope.textContent = f.matterId ? (m ? m.title : 'matter') : 'firm-wide'
      const rm = document.createElement('button')
      rm.type = 'button'
      rm.title = 'Remove from library'
      rm.textContent = '✕'
      rm.addEventListener('click', async () => {
        try { await api('/api/library/folders/remove', { method: 'POST', body: { path: f.path } }); refreshLibrary('folder removed') }
        catch (err) { $('#libMsg').textContent = err.message }
      })
      row.append(pth, scope, rm)
      box.appendChild(row)
    }
    $('#libMsg').textContent = (msg ? msg + ' · ' : '') + `${st.files} files · ${st.chunks} passages indexed`
  }

  function bindLibrary() {
    if (!$('#libAdd')) return
    const run = async (path, body) => {
      $('#libMsg').textContent = 'Indexing… (first run can take a few minutes for large folders)'
      try {
        const r = await api(path, { method: 'POST', body })
        const res = r.result || {}
        refreshLibrary(`${res.indexed || 0} indexed, ${res.removed || 0} removed${res.errors?.length ? `, ${res.errors.length} skipped` : ''}`)
      } catch (err) { $('#libMsg').textContent = err.message }
    }
    $('#libAdd').addEventListener('click', () => {
      const matterId = $('#libMatter').checked ? ($('#matterSel').value || '') : ''
      if ($('#libMatter').checked && !matterId) { $('#libMsg').textContent = 'Pick a matter first (top of the pane).'; return }
      run('/api/library/folders', { path: $('#libPath').value, matterId }).then(() => { $('#libPath').value = '' })
    })
    $('#libSync').addEventListener('click', () => run('/api/library/sync', {}))
    refreshLibrary()
  }

  // ── Matters (Phase 2) — shared with the desktop App ──────────────────────
  // The open document is bound to a matter; the sidecar resolves the matter
  // from docId for chat/analysis, so its data policy and workspace folder
  // follow automatically.
  let mattersCache = []

  function policyLabel(rule) {
    if (!rule) return ''
    return rule.mode === 'local-only' ? 'local only' : `cloud: ${(rule.providers || []).join(', ') || 'none'}`
  }

  async function refreshMatters() {
    const sel = $('#matterSel')
    if (!sel) return
    let data
    try { data = await api('/api/matters' + (docId ? `?docId=${encodeURIComponent(docId)}` : '')) } catch { return }
    mattersCache = data.matters
    sel.innerHTML = '<option value="">— none —</option>'
    for (const m of data.matters) {
      const o = document.createElement('option')
      o.value = m.id
      o.textContent = (m.number ? m.number + ' · ' : '') + m.title + (m.privileged ? ' 🔒' : '')
      sel.appendChild(o)
    }
    sel.value = data.forDoc || ''
    showMatterPolicy()
  }

  function showMatterPolicy() {
    const m = mattersCache.find((x) => x.id === $('#matterSel').value)
    const b = $('#matterPolicy')
    b.textContent = m ? policyLabel(m.policy) : ''
    b.className = 'badge ' + (m ? (m.policy?.mode === 'local-only' ? 'local' : 'cloud') : '')
    b.style.display = m ? '' : 'none'
  }

  async function bindDocToMatter(id) {
    if (!docId) { addMsg('err', 'Open the document map first so the document has an id'); return }
    await api('/api/matters/bind', { method: 'POST', body: { id: id || null, docId, title: docMap?.title || '' } })
    await refreshMatters()
    refreshDataBadge()
  }

  function bindMatters() {
    const sel = $('#matterSel')
    if (!sel) return
    sel.addEventListener('change', () => { bindDocToMatter(sel.value).catch((err) => addMsg('err', err.message)); refreshClauses() })
    $('#matterNewBtn').addEventListener('click', () => {
      const box = $('#matterNew')
      box.style.display = box.style.display === 'none' ? '' : 'none'
      $('#matterTitle').focus()
    })
    $('#matterCancel').addEventListener('click', () => { $('#matterNew').style.display = 'none' })
    $('#matterCreate').addEventListener('click', async () => {
      try {
        const r = await api('/api/matters', { method: 'POST', body: {
          title: $('#matterTitle').value, client: $('#matterClient').value,
          number: $('#matterNumber').value, privileged: $('#matterPriv').checked,
        } })
        const terms = $('#matterTerms').value.trim()
        if (terms) await api('/api/matters/update', { method: 'POST', body: { id: r.matter.id, patch: { redactTerms: terms } } })
        $('#matterNew').style.display = 'none'
        for (const id of ['#matterTitle', '#matterClient', '#matterNumber', '#matterTerms']) $(id).value = ''
        $('#matterPriv').checked = false
        await bindDocToMatter(r.matter.id)
        addMsg('step', `matter "${r.matter.title}" created — this document is filed under it${r.matter.privileged ? ' (privileged: local only)' : ''}`)
      } catch (err) { addMsg('err', err.message) }
    })
    refreshMatters()
  }

  // ── Hub: offline link with the desktop app (sidecar src/hub.js) ──────────
  // The app can send text into the open document (insert-text); the pane
  // can hand the current question over to the app (open-in-app). Same
  // origin as the sidecar, so EventSource needs no token.
  let lastQuestion = ''
  let appLinked = false

  function setAppLinked(on) {
    appLinked = !!on
    const pill = $('#appPill')
    if (pill) pill.style.display = appLinked ? '' : 'none'
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

  // Monitors (engine): new legal developments on a watched source.
  function renderMonitorAlert(ev) {
    const n = ev.data?.count || 1
    const card = document.createElement('div')
    card.className = 'msg handoff'
    const head = document.createElement('div')
    head.className = 'handoff-head'
    head.textContent = `Monitor · ${ev.data?.title || 'legal updates'}`
    const body = document.createElement('div')
    body.textContent = `${n} new ${n === 1 ? 'item' : 'items'} found. Open the desktop app → Matter desk to read and file ${n === 1 ? 'it' : 'them'}.`
    card.append(head, body)
    $('#chat').appendChild(card)
    card.scrollIntoView({ block: 'nearest' })
  }

  function renderHandoff(ev) {
    const text = String(ev.data?.text || '')
    const card = document.createElement('div')
    card.className = 'msg handoff'
    const head = document.createElement('div')
    head.className = 'handoff-head'
    head.textContent = `From the desktop app${ev.data?.source ? ' · ' + ev.data.source : ''}`
    const body = document.createElement('div')
    body.className = 'md'
    body.innerHTML = mdToHtml(text.length > 1200 ? text.slice(0, 1200) + '…' : text)
    const row = document.createElement('div')
    row.className = 'btn-row'
    const ins = document.createElement('button')
    ins.className = 'btn'
    ins.textContent = applyMode === 'tracked' ? 'Insert at cursor (tracked)' : 'Insert at cursor'
    const dis = document.createElement('button')
    dis.className = 'btn btn-ghost'
    dis.textContent = 'Dismiss'
    const done = async (msg) => {
      try { await api('/api/hub/ack', { method: 'POST', body: { id: ev.id } }) } catch {}
      row.remove()
      if (msg) addMsg('step', msg)
    }
    ins.addEventListener('click', async () => {
      ins.disabled = true
      try { await insertFromApp(text); await done('inserted from the desktop app') }
      catch (err) { ins.disabled = false; addMsg('err', err.message) }
    })
    dis.addEventListener('click', () => { done(null); card.remove() })
    row.append(ins, dis)
    card.append(head, body, row)
    $('#chat').appendChild(card)
    $('#chat').scrollTop = $('#chat').scrollHeight
    document.querySelector('[data-tab="chat"]')?.click()
  }

  function bindHub() {
    const pill = $('#appPill')
    pill?.addEventListener('click', async () => {
      try {
        await api('/api/hub/events', { method: 'POST', body: { type: 'open-in-app', data: { view: 'research', query: lastQuestion || '', docId: docId || null } } })
        addMsg('step', lastQuestion ? 'sent to the desktop app — continue there' : 'opened the desktop app')
      } catch (err) { addMsg('err', err.message) }
    })
    let es = null
    const connect = () => {
      try { es = new EventSource(SIDECAR + '/api/hub/events') } catch { return }
      es.onmessage = (m) => {
        let ev
        try { ev = JSON.parse(m.data) } catch { return }
        if (ev.type === 'hello') setAppLinked(ev.data?.peers?.app?.running)
        else if (ev.type === 'insert-text') renderHandoff(ev)
        else if (ev.type === 'provider-changed' || ev.type === 'policy-changed') { refreshProviders?.(); refreshDataBadge(); refreshMatters() }
        else if (ev.type === 'matter-changed') refreshMatters()
        else if (ev.type === 'monitor-alert') renderMonitorAlert(ev)
      }
      es.onerror = () => { /* EventSource reconnects by itself */ }
    }
    connect()
    // App start/stop shows up in the registry; poll cheaply for the pill.
    setInterval(async () => {
      try { const info = await api('/api/hub/info'); setAppLinked(info.peers?.app?.running) } catch {}
    }, 10000)
  }

  // ── Model provider + data policy (OpenLex Phase 1) ───────────────────────
  // The sidecar owns keys (OS keychain) and enforces the policy; the pane
  // only ever learns hasKey true/false and never reads a key back.
  let providers = []
  let activeProvider = 'local'

  async function refreshDataBadge() {
    const badge = $('#dataBadge')
    if (!badge) return
    try {
      const st = await api('/api/status')
      const m = st.model || {}
      const isLocal = m.local !== false
      badge.textContent = isLocal ? 'local' : `cloud · ${m.provider}`
      badge.className = 'badge ' + (isLocal ? 'local' : 'cloud')
      badge.title = isLocal ? 'Client data stays on this machine' : `Requests go to ${m.provider} under your data policy`
      if (!isLocal) setStatus(m.loaded ? `${m.name} ready` : (m.error || 'provider not ready'), !!m.loaded)
    } catch { badge.textContent = '…' }
  }

  function showProviderFields() {
    const p = providers.find((x) => x.id === $('#providerSel').value)
    if (!p) return
    const isLocal = p.kind === 'local'
    $('#providerFields').style.display = isLocal ? 'none' : ''
    $('#providerKeyDel').style.display = p.needsKey ? '' : 'none'
    $('#providerUrlRow').style.display = p.id === 'azure' || p.id === 'custom' ? '' : 'none'
    $('#providerLocalRow').style.display = p.id === 'custom' ? '' : 'none'
    $('#providerKeyRow').style.display = p.needsKey || p.id === 'custom' || p.id === 'vertex' ? '' : 'none'
    const regional = p.id === 'bedrock' || p.id === 'vertex' || p.id === 'azure'
    $('#providerCloudRow').style.display = regional ? '' : 'none'
    $('#providerProjectWrap').style.display = p.id === 'vertex' ? '' : 'none'
    $('#providerRegion').value = p.region || ''
    $('#providerRegion').placeholder = p.id === 'vertex' ? 'europe-west1' : p.id === 'azure' ? 'swedencentral' : 'eu-central-1'
    $('#providerProject').value = p.project || ''
    $('#providerKey').placeholder = p.id === 'bedrock' ? 'Bedrock API key, or ACCESS_KEY_ID:SECRET — stored in the OS keychain'
      : p.id === 'vertex' ? 'Service-account JSON (optional — empty uses your gcloud login)'
      : 'Paste key — stored in the OS keychain'
    $('#providerModel').value = p.model || ''
    $('#providerUrl').value = p.baseUrl || ''
    $('#providerLocal').checked = !!p.local
    $('#providerKey').value = ''
    $('#providerKeyState').textContent = p.needsKey ? (p.hasKey ? '· saved ✓' : '· not set') : ''
    $('#providerUrl').placeholder = p.id === 'azure' ? 'https://<resource>.openai.azure.com/openai/deployments/<deployment>' : 'http://gateway.internal:8000/v1'
    const dl = $('#providerModels')
    dl.innerHTML = ''
    for (const m of p.models || []) { const o = document.createElement('option'); o.value = m; dl.appendChild(o) }
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
      const o = document.createElement('option')
      o.value = p.id
      o.textContent = p.label + (p.id === activeProvider ? ' — active' : '') + (p.local ? '' : ' ☁')
      sel.appendChild(o)
    }
    sel.value = providers.some((p) => p.id === cur) ? cur : activeProvider
    showProviderFields()
    renderPolicyProviders()
  }

  function bindProvider() {
    const sel = $('#providerSel')
    if (!sel) return
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
        msg(`Using ${p.label}.` + (p.local || id === 'local' ? '' : ' Cloud calls still need the data policy below to allow it.'))
        await refreshProviders()
        refreshDataBadge()
      } catch (err) { msg(err.message) }
    })

    $('#providerTest').addEventListener('click', async () => {
      msg('Testing…')
      try {
        const r = await api('/api/providers/test', { method: 'POST', body: { provider: sel.value } })
        msg(r.ok ? `OK — ${r.sample || 'reachable'}` : `Failed: ${r.error}`)
      } catch (err) { msg(err.message) }
    })

    $('#providerKeyDel').addEventListener('click', async () => {
      try {
        await api('/api/providers/key', { method: 'POST', body: { provider: sel.value, key: null } })
        msg('Key removed from the keychain.')
        await refreshProviders()
        refreshDataBadge()
      } catch (err) { msg(err.message) }
    })
    refreshProviders()
  }

  let policyState = null
  function renderPolicyProviders() {
    const box = $('#policyProviders')
    if (!box || !policyState) return
    const rule = policyState.default
    document.querySelectorAll('input[name="policyMode"]').forEach((r) => { r.checked = r.value === rule.mode })
    const redact = $('#policyRedact')
    if (redact) { redact.checked = !!rule.redact; redact.disabled = rule.mode !== 'allow-list' }
    const eu = $('#policyEu')
    if (eu) { eu.checked = (rule.regions || []).includes('eu'); eu.disabled = rule.mode !== 'allow-list' }
    box.innerHTML = ''
    const targets = [
      ...providers.filter((x) => !x.local).map((x) => ({ id: x.id, label: x.label })),
      { id: 'web', label: 'Web access (RIS, public pages, your signed-in databases)' },
      ...(typeof mcpServers !== 'undefined' ? mcpServers : []).filter((x) => x.remote).map((x) => ({ id: `mcp:${x.name}`, label: `Connector: ${x.name}` })),
    ]
    for (const p of targets) {
      const l = document.createElement('label')
      l.className = 'row'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.value = p.id
      cb.checked = rule.mode === 'allow-list' && (rule.providers || []).includes(p.id)
      cb.disabled = rule.mode !== 'allow-list'
      cb.addEventListener('change', savePolicy)
      l.appendChild(cb)
      l.appendChild(document.createTextNode(' ' + p.label))
      box.appendChild(l)
    }
    $('#policyMsg').textContent = `Every model call is logged (metadata only, never content): ${policyState.auditLog}`
  }

  async function savePolicy() {
    const mode = document.querySelector('input[name="policyMode"]:checked')?.value || 'local-only'
    const rule = { mode }
    if (mode === 'allow-list') {
      rule.providers = [...document.querySelectorAll('#policyProviders input:checked')].map((c) => c.value)
      if ($('#policyRedact')?.checked) rule.redact = true
      if ($('#policyEu')?.checked) rule.regions = ['eu']
    }
    try {
      const r = await api('/api/policy', { method: 'POST', body: { rule } })
      policyState = { ...policyState, ...r }
      renderPolicyProviders()
      refreshDataBadge()
    } catch (err) { $('#policyMsg').textContent = err.message }
  }

  async function bindPolicy() {
    try { policyState = await api('/api/policy') } catch { return }
    document.querySelectorAll('input[name="policyMode"]').forEach((r) => r.addEventListener('change', savePolicy))
    $('#policyRedact')?.addEventListener('change', savePolicy)
    $('#policyEu')?.addEventListener('change', savePolicy)
    renderPolicyProviders()
  }

  // ── Settings / onboarding ─────────────────────────────────────────────────
  function bindSettings() {
    const clearBtn = document.getElementById('clearConv')
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        try {
          await api('/api/session/clear', { method: 'POST', body: { docId } })
          addMsg('step', 'conversation memory cleared')
        } catch (err) { addMsg('err', err.message) }
      })
    }
    $('#aggression').addEventListener('input', (e) => {
      $('#aggLabel').textContent = ['Conservative', 'Balanced', 'Aggressive'][+e.target.value]
    })
    bindProvider()
    bindPolicy()
    bindLibrary()
    bindMcp()
    bindWeb()
    bindDepth()
    bindApplyMode()
    bindAutopilot()
    refreshSetup()
  }

  // ── Analysis depth (8/16/32K) — synced from /api/config/agent ────────────
  async function bindDepth() {
    const dd = $('#depthDd')
    if (!dd) return
    const btn = dd.querySelector('.dd-btn')
    const items = dd.querySelectorAll('.dd-item')
    let cfg = null
    try { cfg = await api('/api/config/agent') } catch { /* sidecar offline */ }

    const labels = { fast: 'Fast · 8K', balanced: 'Balanced · 16K', deep: 'Deep · 32K', ultra: 'Ultra · 64K' }
    const apply = (key) => {
      const p = cfg?.presets?.[key]
      $('#depthLabel').textContent = labels[key] || key
      const note = $('#depthNote')
      if (note && p) note.textContent = `${p.totalGiB} GB total (2.7 GB weights + ${p.kvMiB} MB KV) · ${p.hops} hops`
      items.forEach((x) => x.classList.toggle('selected', x.dataset.depthOpt === key))
      dd.classList.remove('open')
    }

    btn?.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('open') })
    items.forEach((it) => {
      it.addEventListener('click', async () => {
        const key = it.dataset.depthOpt
        apply(key)
        try { await api('/api/config/agent', { method: 'POST', body: { depth: key } }) } catch {}
      })
    })
    document.addEventListener('click', () => dd.classList.remove('open'))

    if (cfg) {
      apply(cfg.depth || 'balanced')
    } else {
      items.forEach((x) => x.classList.toggle('selected', x.dataset.depthOpt === 'balanced'))
    }
  }

  // ── Apply mode: tracked change (default) vs permanent edit ────────────────
  // Autopilot (Batch 3): apply a suggestion silently as a tracked change —
  // no card, one pane line. Only real rewrites apply (the same NOOP guard
  // the chat card uses); non-rewrites are skipped silently.
  const AP_NOOP_RE = /^(n\/?a|please specify|please provide|need clarification|i need more|not enough|no change|no rewrite|not applicable|unchanged|as is|none|nothing)/i
  async function autopilotApply(s) {
    if (!s || !s.proposed_text) return
    const text = String(s.proposed_text).trim()
    if (text.length < 40 || AP_NOOP_RE.test(text) || s._applied) return
    if (!s.anchor || !String(s.anchor.text || '').trim()) return // no anchor — skip silently
    // Collapse guard: a whole-clause rewrite that lost most of the original
    // needs human eyes — autopilot must never silently nuke a clause
    // (BILLA field log 2026-08-24: liability clause → one generic sentence).
    if (s.collapseWarning) {
      addMsg('step', 'autopilot skipped (possible clause collapse — review manually): ' + (s.summary || 'suggestion'))
      return
    }
    if (!Office.context.requirements.isSetSupported('WordApi', 1.4)) {
      addMsg('step', 'autopilot: tracked changes unavailable — skipping: ' + (s.summary || ''))
      return
    }
    s._applied = true
    try {
      // silent: applySuggestion's own "inserted as tracked change" line is
      // suppressed — autopilot logs its own one-liner per apply (two lines
      // per suggestion was clutter).
      await applySuggestion(s, { forceTracked: true, silent: true })
      addMsg('step', '✎ autopilot applied: ' + (s.summary || 'suggestion'))
    } catch (err) {
      s._applied = false
      addMsg('err', 'autopilot failed: ' + err.message)
    }
  }

  async function bindAutopilot() {
    const box = $('#autopilot')
    if (!box) return
    try {
      const cfg = await api('/api/config/agent')
      autopilot = !!cfg.autopilot
      box.checked = autopilot
    } catch { /* keep default */ }
    box.addEventListener('change', async () => {
      autopilot = box.checked
      try { await api('/api/config/agent', { method: 'POST', body: { autopilot } }) } catch {}
    })
  }

  async function bindApplyMode() {
    const box = $('#applyTracked')
    if (!box) return
    try {
      const cfg = await api('/api/config/agent')
      applyMode = cfg.applyMode === 'permanent' ? 'permanent' : 'tracked'
      autopilot = !!cfg.autopilot
      const ap = $('#autopilot'); if (ap) ap.checked = autopilot
      box.checked = applyMode === 'tracked'
    } catch { /* keep default */ }
    box.addEventListener('change', async () => {
      applyMode = box.checked ? 'tracked' : 'permanent'
      try { await api('/api/config/agent', { method: 'POST', body: { applyMode, autopilot } }) } catch {}
    })
  }

  // Status cards (Bevel-style): icon + title + description + action.
  function statusCard(kind, title, desc, actionHtml) {
    const icon = {
      ok: '<span style="font-size:0.95rem">✓</span>',
      bad: '<span style="font-size:0.95rem">✕</span>',
      warn: '<span style="font-size:0.95rem">◌</span>',
      neutral: '<span style="font-size:0.95rem">⚑</span>',
    }[kind] || '⚑'
    return `<div class="status-card">
      <div class="sc-head"><span class="lic-chip ${kind}">${icon} ${title}</span></div>
      <div class="sc-desc">${desc}</div>
      ${actionHtml ? `<div class="sc-action">${actionHtml}</div>` : ''}
    </div>`
  }

  function licenseStatusCard(lic) {
    if (!lic) return statusCard('neutral', 'Unknown', 'No license state yet.')
    switch (lic.status) {
      case 'active': return statusCard('ok', 'Active', `Paid subscription · ${(lic.jurisdictions || []).length} jurisdiction(s) · expires ${new Date(lic.expiresAt).toLocaleDateString()}.`)
      case 'no_token': return statusCard('neutral', 'No license token', 'The plugin runs fully offline, but downloads and the subscription check need your login token.')
      case 'invalid_token': return statusCard('bad', 'Token rejected', 'This token is not under a paid subscription.', '<a class="btn" href="https://lexvault.pinemarshlands.com/buy" target="_blank" rel="noopener">Get a subscription</a>')
      case 'expired': return statusCard('bad', 'Subscription expired', 'Your subscription has lapsed. Renew to keep downloads and updates flowing.', '<a class="btn" href="https://lexvault.pinemarshlands.com/buy" target="_blank" rel="noopener">Renew</a>')
      case 'offline': return statusCard('warn', 'License server unreachable', 'Could not reach the license server — a cached license may still work offline.')
      default: return statusCard('neutral', lic.status || 'Unknown', lic.error || '')
    }
  }

  // Onboarding: token presence → paid-subscription check → model + packs.
  async function refreshSetup() {
    const box = $('#setupBox')
    let st, lic
    try { st = await api('/api/setup/status') } catch { box.innerHTML = '<div class="muted">sidecar offline — start the OpenLex sidecar first</div>'; return }
    try { lic = await api('/api/license/status') } catch { /* lic stays undefined */ }

    const needModel = !st.model
    const packs = (st.packs || []).map((p) =>
      `${p.code} · v${p.version || '?'} · ${p.chunk_count ? Number(p.chunk_count).toLocaleString() + ' chunks' : ''}${p.ingested_at ? ' · ' + String(p.ingested_at).slice(0, 10) : ''}`
    ).join('<br>') || 'none'

    if (!st.token) {
      // STEP 1 — no token yet: paste it, then we verify the subscription.
      box.innerHTML = `
        ${licenseStatusCard(lic)}
        <div class="muted" style="margin-bottom:0.5rem">Get your token at <b>lexvault.pinemarshlands.com/account</b>.</div>
        <input type="text" id="tokenInput" placeholder="Paste your login token (lv_live_…)">
        <button class="btn btn-block" id="saveTokenBtn">Activate</button>
        <div id="setupProgress" class="muted" style="margin-top:0.5rem"></div>`
      $('#saveTokenBtn').addEventListener('click', async () => {
        const token = $('#tokenInput').value.trim()
        if (!token) return
        const prog = $('#setupProgress')
        prog.textContent = 'saving token…'
        try {
          await api('/api/config/token', { method: 'POST', body: { token } })
          prog.textContent = 'checking subscription…'
          await new Promise((r) => setTimeout(r, 1500)) // let the watchdog phone home
          const lic2 = await api('/api/license/status')
          prog.innerHTML = licenseStatusCard(lic2)
          refreshSetup()
        } catch (err) { prog.textContent = 'Failed: ' + err.message }
      })
      return
    }

    // STEP 2 — token present: show subscription state + what's missing.
    const rows = []
    rows.push(licenseStatusCard(lic))
    if (lic && lic.tier) rows.push(`<div class="muted">Tier: ${lic.tier}</div>`)
    if (needModel) {
      rows.push(`<button class="btn btn-block" id="dlModelBtn" style="margin-top:0.4rem">Download model (Lotus, 2.7 GB)</button>`)
    } else {
      rows.push(`<div class="muted" style="margin-top:0.4rem">model: <b>${st.model}</b></div>`)
    }
    rows.push(`<div class="muted" style="line-height:1.5">packs:<br>${packs}</div>`)
    rows.push(`<button class="btn btn-ghost btn-block" id="recheckBtn">Check subscription now</button>`)
    rows.push(`<div id="setupProgress" class="muted" style="margin-top:0.5rem"></div>`)
    box.innerHTML = rows.join('')

    $('#dlModelBtn')?.addEventListener('click', () => {
      streamProgress('/api/download/model', { variant: 'lotus-ai-4b-q4_k_m' }, $('#setupProgress'), () => {
        $('#setupProgress').textContent = 'model ready — reload the pane to start the agent'
        refreshSetup()
      })
    })
    $('#recheckBtn')?.addEventListener('click', async () => {
      const lic2 = await api('/api/license/status')
      $('#setupProgress').innerHTML = licenseStatusCard(lic2)
      refreshSetup()
    })
  }

  function streamProgress(path, body, el, onDone) {
    el.textContent = 'starting…'
    fetch(SIDECAR + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(async (res) => {
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()
        for (const part of parts) {
          if (!part.startsWith('data:')) continue
          const evt = JSON.parse(part.slice(5))
          if (evt.kind === 'download-progress') {
            el.textContent = `${evt.what}: ${evt.pct ?? '…'}% (${(evt.received / 1048576).toFixed(0)} MB${evt.total ? ' / ' + (evt.total / 1048576).toFixed(0) + ' MB' : ''})`
          } else if (evt.type === 'error') {
            el.textContent = 'error: ' + evt.message
          } else if (evt.type === 'done') {
            el.textContent = 'done ✓'
            onDone?.(evt)
          }
        }
      }
    }).catch((err) => { el.textContent = 'download failed: ' + err.message })
  }

  async function refreshJurisdictions() {
    try {
      const jurs = await api('/api/jurisdictions')
      const box = $('#jurList')
      box.innerHTML = ''
      jurs.forEach((j) => {
        const el = document.createElement('div')
        el.className = 'jur'
        el.innerHTML = `<span>${j.code}</span><span>${j.installed
          ? '<span class="jur-actions"><span class="badge-ok">installed</span><button class="btn btn-ghost del-jur" style="padding:0.25rem 0.6rem;font-size:0.68rem">Delete</button></span>'
          : '<button class="btn dl-jur" style="padding:0.25rem 0.6rem;font-size:0.68rem">Download pack</button>'}</span>`
        box.appendChild(el)
        el.querySelector('.dl-jur')?.addEventListener('click', () => {
          const btn = el.querySelector('.dl-jur')
          btn.disabled = true
          btn.textContent = 'downloading…'
          streamProgress('/api/download/pack', { jurisdiction: j.code }, btn, () => {
            btn.textContent = 'installed'
            refreshSetup(); refreshPacks(); refreshJurisdictions()
          })
        })
        el.querySelector('.del-jur')?.addEventListener('click', async () => {
          if (!window.confirm(`Delete the ${j.code} law pack? This frees disk space and removes it from the local index. You can re-download it any time.`)) return
          const btn = el.querySelector('.del-jur')
          btn.disabled = true
          btn.textContent = 'deleting…'
          try {
            const r = await api('/api/packs/delete', { method: 'POST', body: { jurisdiction: j.code } })
            btn.textContent = `removed ${r.points_deleted?.toLocaleString() || ''} chunks`
            refreshSetup(); refreshPacks(); refreshJurisdictions()
          } catch (err) {
            btn.textContent = 'failed'
            addMsg('err', err.message)
            refreshJurisdictions()
          }
        })
      })
    } catch { }
  }

  async function refreshPacks() {
    try {
      const packs = await api('/api/packs')
      const box = $('#packList')
      box.innerHTML = ''
      packs.forEach((p) => {
        const el = document.createElement('div')
        el.className = 'pack-item'
        el.innerHTML = `<span>${p.filename}</span><span class="muted">${(p.size_mb / 1024).toFixed(1)} GB</span>`
        box.appendChild(el)
      })
    } catch { }
  }

  // ── Auto-update (Settings → Update) ───────────────────────────────────────
  function bindUpdate() {
    refreshUpdate()
  }

  async function refreshUpdate() {
    const box = $('#updateBox')
    let st
    try { st = await api('/api/update/status') } catch { box.innerHTML = '<div class="muted">sidecar offline</div>'; return }
    const cur = st.current || '0.1.0'
    if (st.status === 'available' && st.available) {
      box.innerHTML = `
        <div class="status-card" style="margin:0 0 0.5rem">
          <div class="sc-head"><span class="lic-chip warn">◌ Update ${st.available} available</span></div>
          <div class="sc-desc">A newer version of the OpenLex Word plugin is ready (you have ${cur}).</div>
        </div>
        <button class="btn btn-block" id="dlUpdateBtn">Download update</button>
        <div id="updateProgress" class="muted" style="margin-top:0.4rem"></div>`
      $('#dlUpdateBtn').addEventListener('click', () => {
        streamProgress('/api/update/download', {}, $('#updateProgress'), () => {
          $('#updateProgress').innerHTML = 'Downloaded ✓ <button class="btn" id="applyUpdateBtn" style="margin-top:0.4rem">Apply &amp; restart</button>'
          $('#applyUpdateBtn').addEventListener('click', async () => {
            $('#updateProgress').textContent = 'applying…'
            streamProgress('/api/update/apply', {}, $('#updateProgress'), () => {
              $('#updateProgress').textContent = 'restarting… reload the pane in a few seconds'
            })
          })
        })
      })
    } else if (st.status === 'applied') {
      box.innerHTML = `<div class="status-card" style="margin:0"><div class="sc-head"><span class="lic-chip ok">✓ Updated to ${cur}</span></div></div>`
    } else if (st.status === 'error') {
      box.innerHTML = `<div class="muted">Update check failed: ${st.error}</div><button class="btn btn-ghost btn-block" id="retryUpdateBtn">Check again</button>`
      $('#retryUpdateBtn').addEventListener('click', async () => {
        await api('/api/update/check', { method: 'POST' })
        refreshUpdate()
      })
    } else if (st.status === 'no-token') {
      box.innerHTML = '<div class="muted">No token — updates check once a subscription token is set.</div>'
    } else {
      box.innerHTML = `<div class="muted">OpenLex Word plugin is up to date (${cur}). Updates check automatically every 6h.</div><button class="btn btn-ghost btn-block" id="retryUpdateBtn">Check now</button>`
      $('#retryUpdateBtn').addEventListener('click', async () => {
        await api('/api/update/check', { method: 'POST' })
        refreshUpdate()
      })
    }
  }
})()
