#!/usr/bin/env node
"use strict"
/**
 * openlex — command line for the local OpenLex engine (the same engine the
 * Word add-in, Outlook and the desktop app use: same matters, data policy,
 * model, firm library and audit log).
 *
 *   openlex                            the terminal app (full screen; also `openlex tui`)
 *   openlex status
 *   openlex providers                  model providers, which is active, which have a key
 *   openlex use PROVIDER[:MODEL] [--base-url URL] [--region R]   e.g. use anthropic, use local, use openrouter:qwen/qwen3.5-9b
 *   openlex key PROVIDER [--remove]    store an API key in the OS keychain (typed hidden, or piped in)
 *   openlex test [PROVIDER]            one tiny call to check the model works (the data policy applies)
 *   openlex policy [--matter ID] | policy local-only | policy allow P1,P2 [--regions eu] [--redact]   where client data may go
 *   openlex ask "Is the liability cap enforceable?" [--file contract.docx] [--matter ID]
 *   openlex review   [--matter ID] [--playbook NAME] [--folder DIR]
 *   openlex chronology [--matter ID] [--folder DIR]
 *   openlex translate FILE --to en [--glossary NAME] [--matter ID]
 *   openlex compare OLD NEW [--matter ID] [--no-rate]
 *   openlex matters [new "Title" [--client X] [--privileged] | privileged ID [--off]]   privileged = never leaves this computer
 *   openlex clauses [--type liability] [--query words] [--matter ID]
 *   openlex grid list | new TITLE --columns cols.json [--matter ID] | run ID [--force] | show ID | export ID
 *   openlex decide "text" --question "Is …?" | --questions q.json [--file doc] [--matter ID]
 *   openlex skills [show NAME | draft "what it should do" [--name N] [--save]]   ("/name …" in ask runs one)
 *   openlex playbook draft FILE… --title T [--focus words] [--save NAME]
 *   openlex monitors [add eurlex|ris "words" | add rss|page URL] [--topics a,b] [--every H] | check [ID] | alerts
 *   openlex lists [show ID | new TITLE | add ID "item" [--due YYYY-MM-DD] [--owner X] | done ID ITEM | export ID]
 *   openlex map [--matter ID] [--agent NAME] | map set routes|hooks|agents|features|sources|models FILE.json | --clear
 *   openlex agents                     agent profiles (use one with "@name …" in ask)
 *   openlex models [MODEL] [--local]   model profiles, and which one each role's model gets
 *   openlex sources [add PRESET|NAME --file def.json | remove NAME | key NAME KEY | test NAME | search "q" [--kind k]]
 *   openlex plan "goal" --matter ID | plan list | plan show ID | plan run ID (approves) | plan decide ID STEP continue|stop [--note text]
 *   openlex serve                      run the engine in the foreground
 *
 * Finds the engine via ~/.lexvault/run/sidecar.json (url + its localhost
 * certificate); --json prints raw events/results for scripting.
 */

const fs = require('fs')
const path = require('path')
const { engine, request } = require('./client')

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-rate') out.rate = false
    else if (a === '--json') out.json = true
    else if (a === '--force') out.force = true
    else if (a === '--clear') out.clear = true
    else if (['--local', '--remove', '--redact', '--privileged', '--off'].includes(a)) out[a.slice(2)] = true
    else if (a === '--save' && (i + 1 >= argv.length || argv[i + 1].startsWith('--'))) out.save = true
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
    else out._.push(a)
  }
  return out
}

/** A secret from the terminal without echoing it, or from a pipe. */
function readSecret(prompt) {
  if (!process.stdin.isTTY) return new Promise((resolve) => { let s = ''; process.stdin.on('data', (c) => { s += c }); process.stdin.on('end', () => resolve(s)) })
  return new Promise((resolve) => {
    process.stderr.write(prompt)
    let s = ''
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const done = (v) => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', on); process.stderr.write('\n'); resolve(v) }
    const on = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done(s)
        if (ch === '\u0003') { process.stderr.write('\n'); process.exit(130) }
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1)
        else s += ch
      }
    }
    process.stdin.on('data', on)
  })
}

async function readFileText(file) {
  const ext = path.extname(file).toLowerCase()
  const src = path.join(__dirname, '..', 'src')
  if (ext === '.docx') return require(path.join(src, 'docx_text')).docxText(file)
  if (ext === '.pdf') return require(path.join(src, 'pdf_text')).pdfText(file)
  return fs.readFileSync(file, 'utf8')
}

async function runWorkflow(type, body, opts) {
  let result = null
  await request('POST', '/api/workflows/run', { type, ...body }, {
    onEvent: (ev) => {
      if (opts.json) { console.log(JSON.stringify(ev)); return }
      if (ev.type === 'progress') process.stderr.write(`  ${ev.index ? `${ev.index}/${ev.total} ` : ''}${ev.name || ev.step || ''}\n`)
      else if (ev.type === 'error') { process.exitCode = 1; console.error(`error: ${ev.message}`) }
      else if (ev.type === 'done') result = ev
    },
  })
  if (result && !opts.json) {
    console.log(Object.entries(result.stats || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · '))
    for (const f of result.files || []) console.log(f)
  }
}

const USAGE = (() => { const lines = fs.readFileSync(__filename, 'utf8').split('\n'); const end = lines.findIndex((l) => l.includes('Finds the engine')) - 1; return lines.slice(3, end).map((l) => l.replace(/^ \* ?/, '')).join('\n') })()

/** The terminal app (tui/, ES modules: Ink + React) loaded on demand. */
async function startTui() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('the terminal app needs an interactive terminal — run `openlex help` for the commands')
  const { run } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'tui', 'index.mjs')).href)
  await run()
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const a = parseArgs(rest)
  switch (cmd) {
    case 'tui':
      return startTui()
    case 'serve':
      // Run until stopped: without this the engine shuts down when no Word,
      // Outlook or desktop app is attached (their idle rule), which is never
      // the case for a terminal or server install.
      process.env.LEXVAULT_KEEPALIVE = process.env.LEXVAULT_KEEPALIVE || '1'
      require(path.join(__dirname, '..', 'src', 'server.js'))
      return
    case 'status': {
      const st = await request('GET', '/api/status')
      if (a.json) return console.log(JSON.stringify(st, null, 2))
      const m = st.model || {}
      console.log(`engine   ${engine().url}  (version ${st.version || engine().version || '?'})`)
      console.log(`model    ${m.name || m.provider || '?'} — ${m.local !== false ? 'local' : `cloud: ${m.provider}`} — ${m.loaded ? 'ready' : m.error || 'not ready'}`)
      return
    }
    case 'providers': {
      const r = await request('GET', '/api/providers')
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      for (const p of r.providers) console.log(`${p.id === r.active ? '*' : ' '} ${p.id.padEnd(11)} ${p.label.padEnd(36)} ${p.local ? 'on this machine' : p.needsKey ? (p.hasKey ? 'key set' : 'no key') : ''}${p.model ? `  model ${p.model}` : ''}${p.region ? `  region ${p.region}` : ''}`)
      console.log('\n* active.  openlex use PROVIDER[:MODEL] · openlex key PROVIDER · openlex policy allow PROVIDER')
      return
    }
    case 'use': {
      const [target] = a._
      if (!target) throw new Error('usage: openlex use PROVIDER[:MODEL] [--base-url URL] [--region R]')
      const i = target.indexOf(':')
      const provider = i < 0 ? target : target.slice(0, i)
      const overrides = { ...(i >= 0 ? { model: target.slice(i + 1) } : {}), ...(a['base-url'] ? { baseUrl: a['base-url'] } : {}), ...(a.region ? { region: a.region } : {}) }
      await request('POST', '/api/providers', { active: provider, ...(Object.keys(overrides).length ? { provider, overrides } : {}) })
      const r = await request('GET', '/api/providers')
      const p = r.providers.find((x) => x.id === provider)
      console.log(`using ${p.label}${p.model ? ` · ${p.model}` : ''}`)
      if (p.needsKey && !p.hasKey) console.log(`no key yet: openlex key ${p.id}`)
      if (!p.local) {
        const pol = await request('GET', '/api/policy')
        const ok = pol.default?.mode === 'allow-list' && (pol.default.providers || []).includes(p.id)
        if (!ok) console.log(`the default data policy keeps client data on this machine; to allow ${p.id}: openlex policy allow ${p.id}   (or per matter with --matter ID)`)
      }
      return
    }
    case 'key': {
      const [provider] = a._
      if (!provider) throw new Error('usage: openlex key PROVIDER [--remove]')
      if (a.remove) { await request('POST', '/api/providers/key', { provider, key: null }); return console.log(`removed the ${provider} key`) }
      const key = (await readSecret(`${provider} API key (hidden): `)).trim()
      if (!key) throw new Error('no key given')
      const r = await request('POST', '/api/providers/key', { provider, key })
      console.log(r.hasKey ? `saved the ${provider} key in the OS keychain` : 'the key was not saved')
      return
    }
    case 'test': {
      const r = await request('POST', '/api/providers/test', { ...(a._[0] ? { provider: a._[0] } : {}), ...(a.matter ? { matterId: a.matter } : {}) })
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      if (r.ok) console.log(`ok${r.sample ? ` · ${String(r.sample).slice(0, 80)}` : ''}`)
      else { process.exitCode = 1; console.log(`failed: ${r.error}`) }
      return
    }
    case 'policy': {
      const [mode, list] = a._
      const show = (rule) => (rule?.mode === 'allow-list' ? `cloud allowed: ${(rule.providers || []).join(', ') || 'none'}${rule.regions ? ` · regions ${rule.regions.join(', ')}` : ''}${rule.redact ? ' · names redacted before sending' : ''}` : 'local only (nothing leaves this machine)')
      if (!mode) {
        const r = await request('GET', '/api/policy')
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        if (a.matter) return console.log(`${a.matter}: ${show(r.matters?.[a.matter] || r.default)}${r.matters?.[a.matter] ? '' : '  (default)'}`)
        console.log(`default: ${show(r.default)}`)
        for (const [id, rule] of Object.entries(r.matters || {})) console.log(`${id}: ${show(rule)}`)
        return console.log(`audit log: ${r.auditLog}`)
      }
      let rule
      if (mode === 'local-only') rule = { mode: 'local-only' }
      else if (mode === 'allow' && list) rule = { mode: 'allow-list', providers: list.split(',').map((s) => s.trim()).filter(Boolean), ...(a.regions ? { regions: a.regions.split(',') } : {}), ...(a.redact ? { redact: true } : {}) }
      else throw new Error('usage: openlex policy local-only | policy allow P1,P2 [--regions eu] [--redact] [--matter ID]')
      if (a.matter) await request('POST', '/api/matters/policy', { id: a.matter, rule })
      else await request('POST', '/api/policy', { rule })
      return console.log(`${a.matter || 'default'}: ${show(rule)}`)
    }
    case 'ask': {
      const message = a._.join(' ').trim()
      if (!message) throw new Error('usage: openlex ask "question" [--file doc] [--matter ID]')
      const text = a.file ? await readFileText(a.file) : ''
      const docId = `cli:${a.file ? path.resolve(a.file) : 'scratch'}`
      let wroteText = false
      await request('POST', '/api/chat', { message, text, docId, matterId: a.matter }, {
        onEvent: (ev) => {
          if (a.json) { console.log(JSON.stringify(ev)); return }
          if (ev.type === 'text') { process.stdout.write(ev.text); wroteText = true }
          else if (ev.type === 'step') process.stderr.write(`  · ${ev.text}\n`)
          else if (ev.type === 'law') for (const s of ev.sources || []) process.stderr.write(`  § ${s.source_name || s.title}\n`)
          else if (ev.type === 'suggestion') console.log(`\n[${ev.suggestion.severity}] ${ev.suggestion.summary}${ev.suggestion.proposed_text ? `\n  → ${ev.suggestion.proposed_text}` : ''}`)
          else if (ev.type === 'error') { process.exitCode = 1; console.error(`error: ${ev.message}`) }
        },
      })
      if (wroteText && !a.json) process.stdout.write('\n')
      return
    }
    case 'review':
    case 'chronology':
      return runWorkflow(cmd, { matterId: a.matter, playbook: a.playbook, folder: a.folder && path.resolve(a.folder) }, a)
    case 'translate':
      if (!a._[0] || !a.to) throw new Error('usage: openlex translate FILE --to en [--glossary NAME]')
      return runWorkflow('translate', { matterId: a.matter, file: path.resolve(a._[0]), target: a.to, glossary: a.glossary }, a)
    case 'compare':
      if (a._.length < 2) throw new Error('usage: openlex compare OLD NEW')
      return runWorkflow('compare', { matterId: a.matter, fileA: path.resolve(a._[0]), fileB: path.resolve(a._[1]), rate: a.rate !== false }, a)
    case 'matters': {
      const [sub, arg] = a._
      if (sub === 'new') {
        if (!arg) throw new Error('usage: openlex matters new "Title" [--client X] [--privileged]')
        const r = await request('POST', '/api/matters', { title: arg, client: a.client, number: a.number, privileged: !!a.privileged })
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        return console.log(`${r.matter.id}  ${r.matter.title}${r.matter.privileged ? '  [privileged: stays on this machine]' : ''}`)
      }
      if (sub === 'privileged') {
        if (!arg) throw new Error('usage: openlex matters privileged ID [--off]')
        const r = await request('POST', '/api/matters/update', { id: arg, patch: { privileged: !a.off } })
        return console.log(r.matter.privileged ? `${r.matter.title}: privileged — nothing from this matter leaves this machine` : `${r.matter.title}: no longer privileged — its data policy now decides (openlex policy --matter ${arg})`)
      }
      if (sub) throw new Error(`unknown matters command: ${sub}`)
      const r = await request('GET', '/api/matters')
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      for (const m of r.matters || []) console.log(`${m.id}  ${m.number ? m.number + ' · ' : ''}${m.title}${m.privileged ? '  [privileged]' : ''}  — ${m.policy?.mode === 'local-only' ? 'local only' : `cloud: ${(m.policy?.providers || []).join(', ')}`}`)
      return
    }
    case 'clauses': {
      const q = new URLSearchParams({ matterId: a.matter || '', type: a.type || '', q: a.query || '' })
      const r = await request('GET', `/api/clauses?${q}`)
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      if (!a.type && !a.query) {
        for (const t of r.types.filter((x) => x.count)) console.log(`${t.id.padEnd(18)} ${t.count}`)
        return
      }
      for (const c of r.clauses) console.log(`\n${c.heading}  (${c.label}, ${c.uses} doc${c.uses === 1 ? '' : 's'}: ${c.documents.join(', ')})\n${c.text}`)
      return
    }
    case 'grid': {
      const [sub, arg] = a._
      if (sub === 'list' || !sub) {
        const r = await request('GET', `/api/grids${a.matter ? `?matterId=${encodeURIComponent(a.matter)}` : ''}`)
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        for (const g of r.grids) console.log(`${g.id}  ${g.title}  (${g.documents} documents × ${g.columns} columns)`)
        return
      }
      if (sub === 'new') {
        if (!arg || !a.columns) throw new Error('usage: openlex grid new TITLE --columns cols.json [--matter ID]   (cols.json: [{ "label", "prompt", "type": "text|yesno|choice|date|number", "options"?, "dependsOn"? }])')
        const r = await request('POST', '/api/grids', { title: arg, matterId: a.matter, columns: JSON.parse(fs.readFileSync(a.columns, 'utf8')) })
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        console.log(`${r.id}  ${r.title}: ${r.rows.length} documents × ${r.columns.length} columns — run it with: openlex grid run ${r.id}`)
        return
      }
      if (!arg) throw new Error(`usage: openlex grid ${sub} ID`)
      if (sub === 'run') {
        let done = null
        await request('POST', '/api/grids/run', { id: arg, force: !!a.force }, {
          onEvent: (ev) => {
            if (a.json) { console.log(JSON.stringify(ev)); return }
            if (ev.type === 'progress' && ev.step === 'cell') process.stderr.write(`  ${ev.document} · ${ev.column}: ${ev.status === 'ok' ? ev.value : `[${ev.status}] ${ev.value || ''}`}\n`)
            else if (ev.type === 'error') { process.exitCode = 1; console.error(`error: ${ev.message}`) }
            else if (ev.type === 'done') done = ev
          },
        })
        if (done && !a.json) console.log(Object.entries(done.stats).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · '))
        return
      }
      if (sub === 'show') {
        const v = await request('GET', `/api/grids/view?id=${encodeURIComponent(arg)}`)
        if (a.json) return console.log(JSON.stringify(v, null, 2))
        const flag = { unverified: ' [UNVERIFIED]', invalid: ' [CHECK]', edited: ' [edited]', error: ' [ERROR]' }
        for (const row of v.rows) {
          console.log(`\n${row.name}`)
          row.cells.forEach((c, i) => console.log(`  ${v.columns[i].label}: ${!c ? '·' : c.status === 'not_found' ? '—' : c.value + (flag[c.status] || '')}`))
        }
        return
      }
      if (sub === 'export') {
        const r = await request('POST', '/api/grids/export', { id: arg })
        for (const f of r.files) console.log(f)
        return
      }
      throw new Error(`unknown grid command: ${sub}`)
    }
    case 'skills': {
      const [sub, ...args] = a._
      if (!sub) {
        const r = await request('GET', '/api/skills')
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        for (const sk of r.skills) console.log(`/${sk.name.padEnd(28)} ${sk.error ? `INVALID: ${sk.error}` : sk.description}${sk.source === 'firm' ? '  [firm]' : ''}`)
        return
      }
      if (sub === 'show') {
        const r = await request('GET', `/api/skills/get?name=${encodeURIComponent(args[0] || '')}`)
        return console.log(a.json ? JSON.stringify(r, null, 2) : r.content)
      }
      if (sub === 'draft') {
        const r = await request('POST', '/api/skills/draft', { request: args.join(' '), name: a.name, matterId: a.matter })
        console.log(r.content)
        if (a.save) { const sv = await request('POST', '/api/skills', { content: r.content }); console.error(`saved as /${sv.skill.name} → ${sv.skill.file}`) }
        else console.error('(draft only — rerun with --save to keep it, or edit and save it in the app)')
        return
      }
      throw new Error(`unknown skills command: ${sub}`)
    }
    case 'playbook': {
      const [sub, ...files] = a._
      if (sub !== 'draft' || !files.length) throw new Error('usage: openlex playbook draft FILE… --title T [--focus words] [--save NAME]')
      const r = await request('POST', '/api/workflows/playbooks/draft', { files: files.map((f) => path.resolve(f)), title: a.title, focus: a.focus, matterId: a.matter })
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      for (const c of r.playbook.checks) console.log(`[${c.severity}] ${c.question}${c.standard ? `\n    firm standard: ${c.standard}` : '\n    (no firm standard found verbatim in the precedents)'}`)
      if (a.save) { const sv = await request('POST', '/api/workflows/playbooks', { name: a.save, playbook: r.playbook }); console.error(`saved playbook "${sv.name}" (${sv.checks} checks) → ${sv.file}`) }
      return
    }
    case 'monitors': {
      const [sub, kind, target] = a._
      if (!sub) {
        const r = await request('GET', `/api/monitors${a.matter ? `?matterId=${encodeURIComponent(a.matter)}` : ''}`)
        for (const m of r.monitors) console.log(`${m.id}  ${m.title}  [${m.source.type}] every ${m.everyHours} h  ${m.lastRun ? `checked ${m.lastRun.slice(0, 16)}` : 'not checked yet'}${m.lastError ? `  ERROR ${m.lastError}` : ''}`)
        return
      }
      if (sub === 'add') {
        const source = ['eurlex', 'ris'].includes(kind) ? { type: kind, query: target } : { type: kind, url: target }
        const r = await request('POST', '/api/monitors', { title: a.title, matterId: a.matter, source, topics: a.topics, everyHours: a.every ? Number(a.every) : undefined })
        return console.log(`${r.monitor.id}  added — the first check sets the baseline (alerts only for what appears after today)`)
      }
      if (sub === 'check') {
        const r = await request('POST', '/api/monitors/check', kind ? { id: kind } : {})
        for (const x of r.results || [r]) console.log(x.error ? `error: ${x.error}` : `${x.checked} items checked, ${x.alerts.length} new alerts`)
        return
      }
      if (sub === 'alerts') {
        const r = await request('GET', `/api/monitors/alerts${a.matter ? `?matterId=${encodeURIComponent(a.matter)}` : ''}`)
        for (const al of r.alerts) console.log(`${al.read ? ' ' : '*'} ${al.date || al.at.slice(0, 10)}  ${al.title}\n    ${al.url || ''}${al.summary ? `\n    ${al.summary}` : ''}`)
        return
      }
      throw new Error(`unknown monitors command: ${sub}`)
    }
    case 'lists': {
      const [sub, id, ...rest] = a._
      if (!sub) {
        const r = await request('GET', `/api/lists${a.matter ? `?matterId=${encodeURIComponent(a.matter)}` : ''}`)
        for (const l of r.lists) console.log(`${l.id}  ${l.title}  ${l.open} open${l.overdue ? `, ${l.overdue} OVERDUE` : ''} / ${l.items}`)
        return
      }
      if (sub === 'new') { const r = await request('POST', '/api/lists', { title: [id, ...rest].join(' '), matterId: a.matter }); return console.log(r.list.id) }
      if (sub === 'show') {
        const { list } = await request('GET', `/api/lists/get?id=${encodeURIComponent(id || '')}`)
        console.log(list.title)
        for (const i of list.items) console.log(`  ${i.id}  [${i.status.padEnd(7)}] ${i.due || '          '}  ${i.owner ? `(${i.owner}) ` : ''}${i.text}`)
        return
      }
      if (sub === 'add') { const r = await request('POST', '/api/lists/items', { id, item: { text: rest.join(' '), due: a.due, owner: a.owner } }); return console.log(r.item.id) }
      if (sub === 'done') { await request('POST', '/api/lists/items/update', { id, itemId: rest[0], patch: { status: 'done' } }); return console.log('done') }
      if (sub === 'export') { const r = await request('POST', '/api/lists/export', { id }); for (const f of r.files) console.log(f); return }
      throw new Error(`unknown lists command: ${sub}`)
    }
    case 'sources': {
      const [sub, name, val] = a._
      if (!sub) {
        const r = await request('GET', '/api/sources')
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        for (const s of r.sources) console.log(`${s.name.padEnd(18)} ${s.type.padEnd(7)} ${s.kind.padEnd(11)} ${s.local === null ? 'INVALID' : s.local ? 'local ' : 'remote'}  ${s.error || s.title}`)
        if (!r.sources.length) console.log('no sources configured')
        console.log(`presets: ${r.presets.join(', ')}  (openlex sources add <preset>)`)
        return
      }
      if (sub === 'add') { const r = await request('POST', '/api/sources/add', { name, source: a.file ? JSON.parse(fs.readFileSync(a.file, 'utf8')) : undefined }); return console.log(`added ${r.source.name} (${r.source.type}, ${r.source.kind}) to your layer — remote sources also need "source:${name}" allowed in the data policy`) }
      if (sub === 'remove') { await request('POST', '/api/sources/remove', { name }); return console.log(`removed ${name}`) }
      if (sub === 'key') { await request('POST', '/api/sources/key', { name, key: val || null }); return console.log(val ? `key for ${name} stored in the OS keychain` : `key for ${name} removed`) }
      if (sub === 'test') { const r = await request('POST', '/api/sources/test', { name, query: val, matterId: a.matter }); return console.log(r.ok ? `ok: ${r.results} results${r.sample ? ` — ${r.sample.title}` : ''}` : `failed: ${r.error}`) }
      if (sub === 'search') {
        const r = await request('POST', '/api/sources/search', { query: [name, val].filter(Boolean).join(' '), kind: a.kind, jurisdiction: a.jurisdiction, matterId: a.matter })
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        r.results.forEach((x, i) => console.log(`[${i + 1}] ${x.source} · ${x.title}${x.citation ? ` — ${x.citation}` : ''}\n    ${x.text.slice(0, 200)}${x.url ? `\n    ${x.url}` : ''}`))
        for (const s of r.skipped) console.log(`not searched: ${s.source} — ${s.reason}`)
        return
      }
      throw new Error(`unknown sources command: ${sub}`)
    }
    case 'agents': {
      const r = await request('GET', '/api/agents')
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      for (const ag of r.agents) console.log(`@${ag.name.padEnd(14)} ${ag.error ? `INVALID: ${ag.error}` : `${ag.description}${ag.depth ? `  [${ag.depth}]` : ''}${Object.keys(ag.routes || {}).length ? `  routes: ${Object.entries(ag.routes).map(([k, v]) => `${k}→${v}`).join(', ')}` : ''}`}`)
      return
    }
    case 'models': {
      if (a._[0]) {
        const q = new URLSearchParams({ model: a._[0], kind: a.local ? 'local' : 'hosted' })
        const r = await request('GET', `/api/models?${q}`)
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        const pr = r.profile
        console.log(`${pr.model}  →  profile ${pr.name}`)
        console.log(`  thinking ${pr.thinking} · tools ${pr.tools} · temperature ${pr.temperature === null ? 'not sent' : pr.temperature ?? 'default'}${pr.ctx ? ` · ctx ${pr.ctx}` : ''}${pr.maxOutput ? ` · max output ${pr.maxOutput}` : ''}`)
        if (pr.instructions) console.log(`  notes to the model: ${pr.instructions}`)
        if (pr.notes) console.log(`  ${pr.notes}`)
        return
      }
      const r = await request('GET', `/api/models${a.matter ? `?matterId=${encodeURIComponent(a.matter)}` : ''}`)
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      for (const e of r.problems) console.log(`  ! ${e}`)
      console.log('ROLES (first-choice model and its profile)')
      for (const x of r.roles) console.log(`  ${x.role.padEnd(10)} ${x.provider}${x.model ? `:${x.model}` : ''}  →  ${x.profile} (thinking ${x.thinking}, tools ${x.tools})`)
      console.log('\nPROFILES (tried in order; change or add them in openlex.json → "models")')
      for (const pr of r.profiles) console.log(`  ${pr.name.padEnd(18)} ${String(pr.kind).padEnd(6)} ${pr.thinking.padEnd(6)} ${pr.tools.padEnd(6)} ${(pr.match || []).join(' | ')}${pr.origin !== 'built-in' ? `  [${pr.origin}]` : ''}`)
      return
    }
    case 'map': {
      if (a._[0] === 'set') {
        const [, section, file] = a._
        if (!section || (!file && !a.clear)) throw new Error('usage: openlex map set routes|hooks|agents|features|sources|models FILE.json   (or --clear)')
        const value = a.clear ? null : JSON.parse(fs.readFileSync(file, 'utf8'))
        await request('POST', '/api/harness/section', { section, value })
        return console.log(a.clear ? `cleared ${section} from your layer` : `saved ${section} to your layer (validated)`)
      }
      const q = new URLSearchParams({ ...(a.matter ? { matterId: a.matter } : {}), ...(a.agent ? { agent: a.agent } : {}) })
      const r = await request('GET', `/api/harness${q.toString() ? `?${q}` : ''}`)
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      console.log(`config: firm ${r.files.firm || '—'} · user ${r.files.user}${r.config.locked.length ? ` · firm locks: ${r.config.locked.join(', ')}` : ''}`)
      for (const e of [...r.errors, ...r.problems]) console.log(`  ! ${e}`)
      console.log('\nROUTES (tried in order; ✗ = skipped by the data policy)')
      for (const role of r.routes) console.log(`  ${role.role.padEnd(10)} ${role.candidates.map((c) => `${c.allowed ? '' : '✗'}${c.provider}${c.model ? `:${c.model}` : ''} (${c.reason})`).join(' → ')}`)
      const blocked = [...new Map(r.routes.flatMap((x) => x.candidates).filter((c) => c.blocked).map((c) => [c.provider, c.blocked])).entries()]
      for (const [p, why] of blocked) console.log(`  ✗ ${p}: ${why}`)
      console.log(`\nAGENTS  ${(r.agents || []).map((x) => `@${x.name}${x.error ? ' (invalid)' : ''}`).join(' · ')}`)
      const hk = Object.entries(r.config.hooks || {}).filter(([, v]) => (v || []).length)
      console.log(`HOOKS   ${hk.length ? hk.map(([k, v]) => `${k} ×${v.length}`).join(' · ') : 'none'}`)
      const f = r.config.features
      console.log(`\nFEATURES  ${Object.entries(f).map(([k, v]) => `${k}${v === false ? ' off' : ''}`).join(' · ')}`)
      return
    }
    case 'plan': {
      const [sub, ...args] = a._
      const show = (pl) => {
        console.log(`${pl.id}  [${pl.status}]  ${pl.goal}`)
        pl.steps.forEach((st, i) => console.log(`  ${String(i + 1).padStart(2)}. ${st.id} ${st.kind.padEnd(10)} ${st.status.padEnd(8)} ${st.title}${st.kind === 'checkpoint' ? `\n      ? ${st.args.question}` : ''}${st.result?.summary ? `\n      → ${st.result.summary}` : ''}${st.error ? `\n      ✗ ${st.error}` : ''}`))
        for (const n of pl.notes || []) console.log(`  note: ${n}`)
        if (pl.report) console.log(`  report: ${pl.report}`)
      }
      if (sub === 'list') { const r = await request('GET', `/api/plans${a.matter ? `?matterId=${encodeURIComponent(a.matter)}` : ''}`); for (const pl of r.plans) console.log(`${pl.id}  [${pl.status}]  ${pl.goal.slice(0, 80)}`); return }
      if (sub === 'show') { const r = await request('GET', `/api/plans/get?id=${encodeURIComponent(args[0] || '')}`); return a.json ? console.log(JSON.stringify(r, null, 2)) : show(r.plan) }
      if (sub === 'run') {
        const id = args[0]
        const cur = (await request('GET', `/api/plans/get?id=${encodeURIComponent(id || '')}`)).plan
        if (cur.status === 'proposed') await request('POST', '/api/plans/approve', { id })
        await request('POST', '/api/plans/run', { id }, {
          onEvent: (ev) => {
            if (a.json) return console.log(JSON.stringify(ev))
            if (ev.type === 'progress' && ev.status) process.stderr.write(`  ${ev.step}: ${ev.status}${ev.summary ? ` — ${ev.summary}` : ''}${ev.question ? ` — ${ev.question}` : ''}${ev.error ? ` — ${ev.error}` : ''}\n`)
            else if (ev.type === 'error') { process.exitCode = 1; console.error(`error: ${ev.message}`) }
            else if (ev.type === 'done') console.log(ev.status === 'waiting' ? `waiting at ${ev.waiting?.id}: ${ev.waiting?.args?.question}\n  → openlex plan decide ${id} ${ev.waiting?.id} continue|stop [--note …]` : `${ev.status}${ev.report ? `: ${ev.report}` : ''}`)
          },
        })
        return
      }
      if (sub === 'decide') {
        const [id, stepId, decision] = args
        if (!['continue', 'stop'].includes(decision)) throw new Error('usage: openlex plan decide ID STEP continue|stop [--note text]')
        const r = await request('POST', '/api/plans/decide', { id, stepId, decision, note: a.note })
        console.log(r.plan.status === 'stopped' ? `stopped: ${r.plan.report}` : `continuing — run it again: openlex plan run ${id}`)
        return
      }
      const goal = a._.join(' ').trim()
      if (!goal) throw new Error('usage: openlex plan "goal" --matter ID')
      const r = await request('POST', '/api/plans', { goal, matterId: a.matter })
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      show(r.plan)
      console.log(`\nNothing has run. Approve and run: openlex plan run ${r.plan.id}`)
      return
    }
    case 'decide': {
      const state = a.file ? await readFileText(a.file) : a._.join(' ').trim()
      if (!state || (!a.question && !a.questions)) throw new Error('usage: openlex decide "text" --question "Is …?"  |  --questions q.json  [--file doc]')
      const questions = a.questions ? JSON.parse(fs.readFileSync(a.questions, 'utf8')) : { answer: { type: 'noul', instructions: a.question } }
      const r = await request('POST', '/api/decide', { state, questions, matterId: a.matter })
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      for (const [id, s] of Object.entries(r.summary)) {
        const ans = typeof s.answer === 'boolean' ? (s.answer ? 'yes' : 'no') : s.level ? `${s.level} (${s.answer.toFixed(2)})` : s.answer
        console.log(`${id}: ${ans}${s.p != null ? `  p=${s.p.toFixed(2)}` : ''}${s.confidence != null ? `  confidence=${s.confidence.toFixed(2)}` : ''}`)
      }
      return
    }
    default:
      // No arguments in a terminal: the full-screen app. Piped/scripted: usage.
      if (!cmd && process.stdin.isTTY && process.stdout.isTTY) return startTui()
      console.log(USAGE)
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 2
  }
}

main().catch((err) => { console.error(`openlex: ${err.message}`); process.exitCode = 1 })
