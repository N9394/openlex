#!/usr/bin/env node
"use strict"
/**
 * openlex — command line for the local OpenLex engine (the same engine the
 * Word add-in, Outlook and the desktop app use: same matters, data policy,
 * model, firm library and audit log).
 *
 *   openlex [--folder DIR]             the terminal app (full screen; also `openlex tui`), working in this folder (or DIR)
 *   openlex status
 *   openlex providers                  model providers, which is active, which have a key
 *   openlex use PROVIDER[:MODEL] [--base-url URL] [--region R]   e.g. use anthropic, use local, use openrouter:qwen/qwen3.5-9b
 *   openlex key PROVIDER [--remove]    store an API key in the OS keychain (typed hidden, or piped in)
 *   openlex test [PROVIDER]            one tiny call to check the model works (the data policy applies)
 *   openlex policy [--matter ID] | policy local-only | policy allow P1,P2 [--regions eu] [--redact]   where client data may go
 *   openlex ask "Is the liability cap enforceable?" [--file contract.docx] [--matter ID] [--folder DIR | --no-folder] [--allow TOOL[,PATTERN…]] [--yes]
 *   openlex permissions [list | allow PATTERN [--matter ID] | ask PATTERN | deny PATTERN | remove PATTERN [--matter ID]]   what OpenLex may do without asking
 *   openlex review   [--matter ID] [--playbook NAME] [--folder DIR]
 *   openlex chronology [--matter ID] [--folder DIR]
 *   openlex translate FILE --to en [--glossary NAME] [--matter ID]
 *   openlex compare OLD NEW [--matter ID] [--no-rate]
 *   openlex analyse FILE… [--matter ID]  risks, deadlines, obligations, key terms — quotes checked; report saved in the matter folder
 *   openlex matters [new "Title" [--client X] [--privileged] | privileged ID [--off]]   privileged = never leaves this computer
 *   openlex matters show ID | export ID [--format docx|pdf|md]   the matter at a glance, or as a "matter memo" file
 *   openlex recall "liability cap" --matter ID [--summary]   search everything stored for the matter
 *   openlex record [--matter ID] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--left] [--export pdf|csv|md] [--verify] [--keep-months N|all]   the AI record: what the AI did, never any content
 *   openlex clauses [--type liability] [--query words] [--matter ID]
 *   openlex grid list | new TITLE --columns cols.json [--matter ID] | run ID [--force] | show ID | export ID
 *   openlex decide "text" --question "Is …?" | --questions q.json [--file doc] [--matter ID]
 *   openlex skills [show NAME | draft "what it should do" [--name N] [--save]]   ("/name …" in ask runs one)
 *   openlex playbook draft FILE… --title T [--focus words] [--save NAME]
 *   openlex monitors [add eurlex|ris "words" | add rss|page URL] [--topics a,b] [--every H] | check [ID] | alerts
 *   openlex lists [show ID | new TITLE | add ID "item" [--due YYYY-MM-DD] [--owner X] | done ID ITEM | export ID]
 *   openlex map [--matter ID] [--agent NAME] | map set routes|hooks|agents|features|sources|models|prompts|permissions FILE.json | --clear
 *   openlex agents                     agent profiles (use one with "@name …" in ask)
 *   openlex models [MODEL] [--local]   model profiles, and which one each role's model gets
 *   openlex prompts ["message"] [--after TOOL]   which instruction blocks and tools each step would get (the prompt roadmap)
 *   openlex sources                    law sources (official, community and gateways, by country) and the firm's own, in plain words
 *   openlex sources on|off SOURCE | key SOURCE [KEY] [--remove] | signin SOURCE [--no-browser] | nightcopy SOURCE on|off | test SOURCE | search "q" --law [--jurisdiction AT | --source ris,eurlex]  (without --law: the firm's own, [--kind k])
 *   openlex sources download SOURCE [PART] [--yes] [--history] | remove SOURCE [PART]   keep a source on this computer (size shown first)
 *   openlex sources offline on|off [--countries AT,DE] [--yes]                          work fully offline (shows what it downloads first)
 *   openlex sources add PRESET|NAME --file def.json | remove NAME     the firm's own sources (sources.js)
 *   openlex plan "goal" --matter ID | plan list | plan show ID | plan run ID (approves) | plan decide ID STEP continue|stop [--note text]
 *   openlex serve                      run the engine in the foreground
 *
 * Finds the engine via ~/.lexvault/run/sidecar.json (url + its localhost
 * certificate); --json prints raw events/results for scripting.
 *
 * Working folder: `openlex` and `openlex ask` work in the folder they are
 * started in (--folder DIR another one, --no-folder none): OpenLex may read
 * the files there and asks before it changes anything. The whole home
 * folder is never used without asking. --ascii: plain ASCII symbols.
 */

const fs = require('fs')
const path = require('path')
const { engine, request, DATA_DIR } = require('./client')
const { friendly } = require('./friendly')

const esm = (f) => import(require('url').pathToFileURL(path.join(__dirname, '..', 'tui', f)).href)

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-rate') out.rate = false
    else if (a === '--json') out.json = true
    else if (a === '--force') out.force = true
    else if (a === '--clear') out.clear = true
    else if (['--local', '--remove', '--redact', '--privileged', '--off', '--yes', '--ascii', '--summary', '--left', '--verify', '--law', '--history'].includes(a)) out[a.slice(2)] = true
    else if (a === '--no-folder') out.folder = false
    else if (a === '--no-browser') out.browser = false
    else if (a === '--allow') out.allow = [...(out.allow || []), ...String(argv[++i] || '').split(',').map((x) => x.trim()).filter(Boolean)]
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
  const printer = opts.json ? null : (await esm('cli.mjs')).workPrinter(type)
  await request('POST', '/api/workflows/run', { type, ...body }, {
    onEvent: (ev) => {
      if (opts.json) { console.log(JSON.stringify(ev)); return }
      printer.onEvent(ev)
      if (ev.type === 'error') process.exitCode = 1
      else if (ev.type === 'done') result = ev
    },
  })
  if (!opts.json) {
    printer.finish(result)
    if (result?.summary) console.log(`\n${result.summary}`)
    for (const f of result?.files || []) console.log(f)
  }
}

/** The small preferences shared with the terminal app (tui.json): which folders were already used. */
const PREFS = path.join(DATA_DIR, 'tui.json')
const loadPrefs = () => { try { return JSON.parse(fs.readFileSync(PREFS, 'utf8')) } catch { return {} } }
function savePrefs(patch) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(PREFS, JSON.stringify({ ...loadPrefs(), ...patch }, null, 2)) } catch { /* not essential */ } }

/** One yes/no question in the terminal (no = default). */
async function confirm(question) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stderr })
  const reply = await new Promise((resolve) => rl.question(`${question} [y/N] `, (x) => { rl.close(); resolve(String(x).trim().toLowerCase()) }))
  return reply === 'y' || reply === 'yes'
}

/**
 * The working folder of a command: --folder DIR, else (when `implicit`)
 * the current folder. Never the whole home folder without asking; a folder
 * used for the first time gets a one-line notice. Returns the request
 * fields ({ folder, folderConfirmed? }) or {}.
 */
async function workingFolder(a, { implicit = true } = {}) {
  if (a.folder === false) return {}
  const explicit = typeof a.folder === 'string'
  if (!explicit && !implicit) return {}
  const dir = path.resolve(explicit ? a.folder : process.cwd())
  const info = await request('GET', `/api/folder?path=${encodeURIComponent(dir)}`)
  if (!info.ok) {
    if (explicit) throw new Error(info.error)
    return {}
  }
  const known = (loadPrefs().folders || {})[info.path]
  if (known === 'forbidden') { if (explicit) process.stderr.write(`You asked OpenLex not to read ${info.short}; working without a folder.\n`); return {} }
  if (info.broad) {
    const whole = info.broad === 'home' ? 'your whole home folder' : 'the whole computer'
    if (!explicit) {
      if (!a.json) process.stderr.write(`(Not working in ${whole}. To work with the files of one client: cd into their folder, or use --folder DIR.)\n`)
      return {}
    }
    process.stderr.write(`! That's ${whole} (${info.short}). OpenLex would be able to read every document in it.\n`)
    if (!(await confirm('Work in it anyway?'))) throw new Error(`Not working in ${whole}. Choose the folder of one client or matter with --folder.`)
    return { folder: info.path, folderConfirmed: true }
  }
  if (known !== 'ok' && !a.json) {
    process.stderr.write(`OpenLex can read the files in this folder: ${info.short}${info.documents ? ` (${info.documents} document${info.documents === 1 ? '' : 's'})` : ''}. It asks before it saves, renames or deletes anything here. (To forbid it: openlex permissions deny '*:${info.short}/**')\n`)
    savePrefs({ folders: { ...(loadPrefs().folders || {}), [info.path]: 'ok' } })
  }
  return { folder: info.path }
}

/**
 * "OpenLex wants to …" in a terminal: one line, [y]es once / [a]lways / [n]o.
 * Enter alone = yes once; anything unclear = no.
 */
async function askPermission(ev) {
  const readline = require('readline')
  const always = ev.choices.includes('always_matter') ? 'always_matter' : ev.choices.includes('always_folder') ? 'always_folder' : ev.choices.includes('always') ? 'always' : null
  const keys = `[y]es once${always ? ` / [a]lways${always === 'always_matter' ? ' (this matter)' : always === 'always_folder' ? ' (this folder)' : ''}` : ''} / [n]o`
  const detail = ev.tool === 'run_bash' ? '' : Object.entries(ev.detail || {}).filter(([k]) => k !== 'content').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')
  process.stderr.write(`\n${ev.title} (${ev.risk})\n  ${ev.summary}${detail && !ev.folder ? `\n  ${detail.slice(0, 200)}` : ''}${ev.firmRule ? '\n  (your firm asks for confirmation here)' : ''}\n`)
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  const reply = await new Promise((resolve) => rl.question(`  Allow? ${keys}: `, (x) => { rl.close(); resolve(String(x).trim().toLowerCase()) }))
  const decision = reply === '' || reply === 'y' || reply === 'yes' ? 'once' : (reply === 'a' || reply === 'always') && always ? always : 'deny'
  const r = await request('POST', '/api/permissions/answer', { id: ev.id, decision }).catch((err) => ({ ok: false, error: err.message }))
  if (!r.ok) process.stderr.write(`  (too late: ${r.error})\n`)
  else process.stderr.write(decision === 'deny' ? '  not allowed\n' : `  allowed${r.saved ? ` — from now on without asking: ${r.saved}` : ''}\n`)
}

function printPermissions(r) {
  const line = (label, list) => console.log(`  ${label.padEnd(7)} ${list.length ? list.join(', ') : '—'}`)
  console.log(`YOUR RULES${r.locked ? ' (locked by the firm — ignored)' : ''}`)
  line('allow', r.user.allow); line('ask', r.user.ask); line('deny', r.user.deny)
  for (const [id, m] of Object.entries(r.user.matters || {})) line(id, (m.allow || []).map((x) => `allow ${x}`))
  if ([...r.firm.allow, ...r.firm.ask, ...r.firm.deny].length) {
    console.log('FIRM RULES (deny wins over any allow)')
    line('allow', r.firm.allow); line('ask', r.firm.ask); line('deny', r.firm.deny)
  }
  console.log('DEFAULTS (when no rule matches)')
  console.log(`  allow   ${r.defaults.filter((d) => d.decision === 'allow').map((d) => d.tool).join(', ')}`)
  console.log(`  ask     ${r.defaults.filter((d) => d.decision !== 'allow').map((d) => d.tool).join(', ')}, connector tools (mcp:*), anything unknown`)
  console.log('\nopenlex permissions allow|ask|deny PATTERN · remove PATTERN · patterns: write_file, write_file:Acme/**, web_fetch:*.europa.eu, run_bash:git *, mcp:dms:*')
}

const USAGE = (() => { const lines = fs.readFileSync(__filename, 'utf8').split('\n'); const end = lines.findIndex((l) => l.includes('Finds the engine')) - 1; return lines.slice(3, end).map((l) => l.replace(/^ \* ?/, '')).join('\n') })()

/** The terminal app (tui/, ES modules: Ink + React) loaded on demand. */
async function startTui(a = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('the terminal app needs an interactive terminal — run `openlex help` for the commands')
  const { run } = await esm('index.mjs')
  // The working folder: --folder DIR, else the folder the app was started in (checked in the app).
  const folder = a.folder === false ? null : path.resolve(typeof a.folder === 'string' ? a.folder : process.cwd())
  await run({ folder })
}

async function main() {
  const argv = process.argv.slice(2)
  // `openlex --folder DIR` (the app) and `openlex --ascii`: options without a command.
  const [cmd, ...rest] = argv[0] && argv[0].startsWith('--') ? [undefined, ...argv] : argv
  const a = parseArgs(rest)
  if (a.ascii) process.env.OPENLEX_ASCII = '1'
  switch (cmd) {
    case 'tui':
      return startTui(a)
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
      if (!message) throw new Error('usage: openlex ask "question" [--file doc] [--matter ID] [--folder DIR]')
      const text = a.file ? await readFileText(a.file) : ''
      const docId = `cli:${a.file ? path.resolve(a.file) : 'scratch'}`
      const where = await workingFolder(a)
      // Plain sentences, a spinner while it works, and where the data went (tui/cli.mjs).
      const printer = a.json ? null : (await esm('cli.mjs')).askPrinter()
      // Only a person at a terminal can answer "may OpenLex …?"; scripts
      // (--json, pipes) fail closed unless --allow / --yes say otherwise.
      const interactive = !a.json && !!process.stdin.isTTY && !!process.stderr.isTTY
      await request('POST', '/api/chat', { message, text, docId, matterId: a.matter, interactive, ...where, ...(a.allow ? { allow: a.allow } : {}), ...(a.yes ? { yes: true } : {}) }, {
        onEvent: (ev) => {
          if (a.json) { console.log(JSON.stringify(ev)); return }
          if (ev.type === 'permission') { printer.pause(); askPermission(ev).then(() => printer.resume()).catch((err) => console.error(`openlex: ${friendly(err)}`)); return }
          if (ev.type === 'text') { printer.wrote(); process.stdout.write(ev.text); return }
          printer.onEvent(ev)
          if (ev.type === 'suggestion') console.log(`\n[${ev.suggestion.severity}] ${ev.suggestion.summary}${ev.suggestion.proposed_text ? `\n  → ${ev.suggestion.proposed_text}` : ''}`)
          else if (ev.type === 'error') process.exitCode = 1
        },
      })
      if (!a.json) printer.finish()
      return
    }
    case 'review':
    case 'chronology':
      // The documents: the matter's, plus --folder DIR (its files are read, nothing there is changed).
      return runWorkflow(cmd, { matterId: a.matter, playbook: a.playbook, ...(await workingFolder(a, { implicit: false })) }, a)
    case 'translate':
      if (!a._[0] || !a.to) throw new Error('usage: openlex translate FILE --to en [--glossary NAME]')
      return runWorkflow('translate', { matterId: a.matter, file: path.resolve(a._[0]), target: a.to, glossary: a.glossary }, a)
    case 'compare':
      if (a._.length < 2) throw new Error('usage: openlex compare OLD NEW')
      return runWorkflow('compare', { matterId: a.matter, fileA: path.resolve(a._[0]), fileB: path.resolve(a._[1]), rate: a.rate !== false }, a)
    case 'analyse':
    case 'analyze':
      if (!a._.length) throw new Error('usage: openlex analyse FILE… [--matter ID]')
      return runWorkflow('analyse', { matterId: a.matter, files: a._.map((f) => path.resolve(f)) }, a)
    case 'recall': {
      if (!a._[0] || !a.matter) throw new Error('usage: openlex recall "words" --matter ID [--summary]')
      const q = new URLSearchParams({ id: a.matter, q: a._.join(' '), format: 'text', ...(a.summary ? { summary: '1' } : {}), ...(a.limit ? { limit: a.limit } : {}) })
      const r = await request('GET', `/api/matters/recall?${q}`)
      return console.log(a.json ? JSON.stringify(r, null, 2) : r.text)
    }
    case 'record': {
      const cli = await esm('cli.mjs')
      if (a['keep-months']) {
        const r = await request('POST', '/api/record/settings', { keepMonths: a['keep-months'] })
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        console.log(r.keepMonths ? `The AI record now keeps the last ${r.keepMonths} months. Older entries are removed with a note saying how many and from when.` : 'The AI record now keeps everything (the default).')
        for (const x of r.applied || []) console.log(x.error ? `  ${x.name}: ${x.error}` : `  ${x.name}: ${x.removed.count} old entries removed`)
        return
      }
      if (a.verify) {
        const v = await request('GET', '/api/record/verify')
        if (!v.ok) process.exitCode = 1
        return console.log(a.json ? JSON.stringify(v, null, 2) : cli.verifyText(v))
      }
      for (const k of ['from', 'to']) if (a[k] && !/^\d{4}-\d{2}-\d{2}$/.test(a[k])) throw new Error(`usage: --${k} takes a date like 2026-10-29`)
      if (a.export) {
        const r = await request('POST', '/api/record/export', { matterId: a.matter, from: a.from, to: a.to, left: !!a.left, format: a.export })
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        console.log(cli.asciiText(`Saved the AI record (${r.entries} entr${r.entries === 1 ? 'y' : 'ies'}, ${r.verified ? 'record intact ✓' : 'record changed ✗'}):`))
        return console.log(r.file)
      }
      const q = new URLSearchParams(Object.entries({ matterId: a.matter, from: a.from, to: a.to, left: a.left ? '1' : '', limit: a.limit || '50' }).filter(([, v]) => v))
      const r = await request('GET', `/api/record?${q}`)
      return console.log(a.json ? JSON.stringify(r, null, 2) : cli.recordText(r))
    }
    case 'matters': {
      const [sub, arg] = a._
      if (sub === 'show') {
        if (!arg) throw new Error('usage: openlex matters show ID')
        const r = await request('GET', `/api/matters/overview?${new URLSearchParams({ id: arg, format: 'text' })}`)
        return console.log(a.json ? JSON.stringify(r, null, 2) : r.text)
      }
      if (sub === 'export') {
        if (!arg) throw new Error('usage: openlex matters export ID [--format docx|pdf|md]')
        const r = await request('POST', '/api/matters/overview/export', { id: arg, format: a.format || 'docx' })
        return console.log(a.json ? JSON.stringify(r, null, 2) : r.file)
      }
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
      if (!sub || sub === 'list') {
        const r = await request('GET', `/api/sources${a.matter ? `?matterId=${encodeURIComponent(a.matter)}` : ''}`)
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        console.log('Law sources')
        for (const s of r.law || []) {
          console.log(`  ${s.state === 'ready' ? '✓' : s.state === 'off' ? '–' : '·'} ${s.status}`)
          if (s.state === 'needs_key') console.log(`      how to get it: ${s.guide}\n      then: ${s.signIn ? `openlex sources signin ${s.id}  (or a service credential: openlex sources key ${s.id})` : `openlex sources key ${s.id}`}`)
          else if (s.optionalKey && !s.hasKey && s.state !== 'off') console.log(`      optional free key: ${s.guide}`)
          if (s.nightCopy === false && s.state !== 'off') console.log(`      keep a local copy (fetched at night): openlex sources nightcopy ${s.id} on`)
        }
        const offline = (r.law || []).some((s) => s.state === 'offline')
        if (offline) console.log('  Online look-ups are off in your client-data rule. Allow "web" (keep your AI service in the list too): openlex policy allow web[,anthropic]')
        console.log('  Switch one off or on: openlex sources off ris · openlex sources on ris')
        if (r.sources.length) {
          console.log("\nYour firm's own sources")
          for (const s of r.sources) console.log(`  ${s.name.padEnd(18)} ${s.type.padEnd(7)} ${s.kind.padEnd(11)} ${s.local === null ? 'INVALID' : s.local ? 'local ' : 'remote'}  ${s.error || s.title}`)
        }
        return
      }
      if (sub === 'on' || sub === 'off') {
        if (!name) throw new Error(`usage: openlex sources ${sub} SOURCE`)
        const r = await request('POST', '/api/sources/enable', { name, on: sub === 'on' })
        return console.log(`${r.id} is now ${r.enabled ? 'on' : 'off'}`)
      }
      if (sub === 'add') { const r = await request('POST', '/api/sources/add', { name, source: a.file ? JSON.parse(fs.readFileSync(a.file, 'utf8')) : undefined }); return console.log(`added ${r.source.name} (${r.source.type}, ${r.source.kind}) to your layer — remote sources also need "source:${name}" allowed in the data policy`) }
      if (sub === 'remove') {
        // A law source: its copy on this computer; otherwise one of the firm's own sources.
        if (name && ((await request('GET', '/api/sources/law')).sources || []).some((x) => x.id === name)) { await request('POST', '/api/sources/law/download/remove', { name, part: val || null }); return console.log(`removed ${name}${val ? ` ${val}` : ''} from this computer`) }
        await request('POST', '/api/sources/remove', { name }); return console.log(`removed ${name}`)
      }
      if (sub === 'key') {
        if (!name) throw new Error('usage: openlex sources key SOURCE [KEY] [--remove]')
        const key = a.remove ? null : (val || (await readSecret(`${name} key (hidden): `)).trim())
        if (!a.remove && !key) throw new Error('no key given')
        await request('POST', '/api/sources/key', { name, key })
        return console.log(key ? `key for ${name} stored in the OS keychain` : `key for ${name} removed`)
      }
      if (sub === 'nightcopy') {
        if (!name || !['on', 'off'].includes(val)) throw new Error('usage: openlex sources nightcopy SOURCE on|off')
        const r = await request('POST', '/api/sources/law/nightcopy', { name, on: val === 'on' })
        return console.log(r.nightCopy ? `${r.id}: OpenLex keeps a local copy, fetched in the hours the source allows` : `${r.id}: no local copy`)
      }
      if (sub === 'signin') {
        if (!name) throw new Error('usage: openlex sources signin SOURCE')
        let st = await request('POST', '/api/sources/law/signin', { name, open: a.browser !== false })
        console.log(st.userCode ? `Type this code on the sign-in page: ${st.userCode}` : 'Sign in on the page in your browser.')
        console.log(`${st.opened ? 'If no page opened, go to' : 'Open'}: ${st.pageUrl || st.url}`)
        console.log('Waiting for the sign-in… (Ctrl+C to stop)')
        while (st.state === 'pending') {
          await new Promise((ok) => setTimeout(ok, 2000))
          st = await request('GET', `/api/sources/law/signin?name=${encodeURIComponent(name)}`)
        }
        if (st.state !== 'done') { process.exitCode = 1; return console.log(st.error || 'The sign-in did not finish.') }
        return console.log(`Signed in. The tokens are kept in this computer's keychain.`)
      }
      if (sub === 'download') {
        if (!name) throw new Error('usage: openlex sources download SOURCE [PART] [--yes] [--history]')
        const part = val || null
        const r = await request('POST', '/api/sources/law/download', { name, part })
        console.log(`${r.plan.label}: ${r.plan.size}, from ${r.plan.from || name}${r.plan.note ? ` (${r.plan.note})` : ''}${r.plan.updated ? `; last updated ${r.plan.updated}${r.plan.stale ? ' (over 60 days ago)' : ''}` : ''}`)
        if (!a.yes) return console.log(`To download it: openlex sources download ${name}${part ? ` ${part}` : ''} --yes`)
        await request('POST', '/api/sources/law/download', { name, part, confirm: true, history: !!a.history })
        for (;;) {
          const { job } = await request('GET', `/api/sources/law/download?name=${encodeURIComponent(name)}${part ? `&part=${encodeURIComponent(part)}` : ''}`)
          if (!job || job.state !== 'running') { if (job?.state === 'failed') process.exitCode = 1; return console.log(job ? (job.state === 'done' ? `done: ${job.message}` : `${job.state}: ${job.error || job.message}`) : 'done') }
          process.stdout.write(`\r${String(job.message || '').slice(0, 70).padEnd(70)}`)
          await new Promise((ok) => setTimeout(ok, 1500))
        }
      }
      if (sub === 'offline') {
        if (!['on', 'off'].includes(name)) throw new Error('usage: openlex sources offline on|off [--countries AT,DE] [--yes]')
        const countries = a.countries ? String(a.countries).split(',') : undefined
        if (name === 'off') { await request('POST', '/api/sources/law/offline', { on: false }); return console.log('OpenLex looks things up online again (copies on this computer stay until removed).') }
        const p = await request('POST', '/api/sources/law/offline', { plan: true, countries })
        for (const d of p.downloads || []) console.log(`  ${d.label}: ${d.error || d.size}`)
        console.log(`Together: ${p.total?.size || '—'} (countries: ${p.countries.join(', ')})`)
        if (!a.yes) return console.log('To download them and work fully offline: openlex sources offline on --yes')
        await request('POST', '/api/sources/law/offline', { on: true, confirm: true, countries: p.countries })
        return console.log('OpenLex now works fully offline; the downloads run in the background (openlex sources shows them).')
      }
      if (sub === 'test') { const r = await request('POST', '/api/sources/test', { name, query: val, matterId: a.matter }); if (!r.ok) process.exitCode = 1; return console.log(r.ok ? `ok: ${r.results} results${r.sample ? ` — ${r.sample.citation || r.sample.title}` : ''}` : `failed: ${r.error}`) }
      if (sub === 'search') {
        const query = [name, val].filter(Boolean).join(' ')
        const lawSearch = a.law || a.source
        const r = lawSearch
          ? await request('POST', '/api/sources/law/search', { query, jurisdiction: a.jurisdiction, sources: a.source ? String(a.source).split(',') : undefined, matterId: a.matter })
          : await request('POST', '/api/sources/search', { query, kind: a.kind, jurisdiction: a.jurisdiction, matterId: a.matter })
        if (a.json) return console.log(JSON.stringify(r, null, 2))
        if (lawSearch) for (const n of r.notes || []) console.log(`note (${n.source}): ${n.note}`)
        if (lawSearch && r.notice) console.log(r.notice)
        if (lawSearch) r.results.forEach((x, i) => console.log(`[${i + 1}] ${x.sourceLabel} · ${x.title}\n    cite as: ${x.citation || x.title}${x.snippet ? `\n    ${x.snippet.slice(0, 200)}` : ''}${x.url ? `\n    ${x.url}` : ''}\n    retrieved ${String(x.retrieved).slice(0, 10)} · ${x.licence}`))
        else r.results.forEach((x, i) => console.log(`[${i + 1}] ${x.source} · ${x.title}${x.citation ? ` — ${x.citation}` : ''}\n    ${x.text.slice(0, 200)}${x.url ? `\n    ${x.url}` : ''}`))
        if (!r.results.length) console.log('nothing found')
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
    case 'prompts': {
      const q = new URLSearchParams({ message: a._.join(' '), ...(a.after ? { afterTool: a.after } : {}) })
      const r = await request('GET', `/api/prompts?${q}`)
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      console.log(`intents: ${r.intents.join(', ') || 'none'}`)
      console.log(`tools offered: ${r.tools.offered.join(', ')}`)
      console.log(`tools by name only (loaded on request): ${r.tools.deferred.join(', ') || 'none'}`)
      console.log('\nSTEP        BLOCKS (≈ tokens of instructions, without the document)')
      for (const t of r.turns) console.log(`  ${t.phase.padEnd(10)} ${t.blocks.join(' · ')}  (≈${t.tokens})`)
      console.log('\nBLOCKS (change or add them in openlex.json → "prompts")')
      for (const b of r.blocks) console.log(`  ${b.id.padEnd(12)} ≈${String(b.tokens).padStart(4)}  ${b.when ? Object.entries(b.when).map(([k, v]) => `${k}: ${[].concat(v).join('|')}`).join('; ') : 'always'}${b.origin !== 'built-in' ? `  [${b.origin}]` : ''}`)
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
    case 'permissions': {
      const [sub, pattern] = a._
      if (['allow', 'ask', 'deny', 'remove'].includes(sub)) {
        if (!pattern) throw new Error(`usage: openlex permissions ${sub} PATTERN${sub === 'allow' || sub === 'remove' ? ' [--matter ID]' : ''}   (e.g. write_file, web_fetch:eur-lex.europa.eu, mcp:dms:*)`)
        const r = await request('POST', '/api/permissions/rules', { action: sub, pattern, matterId: a.matter })
        if (sub === 'remove') return console.log(r.removed ? `removed ${pattern}${a.matter ? ` (matter ${a.matter})` : ''}` : `${pattern} was not one of your rules${r.firm && [...r.firm.allow, ...r.firm.ask, ...r.firm.deny].includes(pattern) ? ' (it is a firm rule: ask your administrator)' : ''}`)
        return console.log(`${sub === 'allow' ? 'allowed without asking' : sub === 'deny' ? 'never allowed' : 'always asked'}: ${pattern}${a.matter ? ` (matter ${a.matter} only)` : ''}`)
      }
      if (sub && sub !== 'list') throw new Error('usage: openlex permissions [list | allow PATTERN [--matter ID] | ask PATTERN | deny PATTERN | remove PATTERN [--matter ID]]')
      const r = await request('GET', '/api/permissions')
      if (a.json) return console.log(JSON.stringify(r, null, 2))
      printPermissions(r)
      return
    }
    case 'map': {
      if (a._[0] === 'set') {
        const [, section, file] = a._
        if (!section || (!file && !a.clear)) throw new Error('usage: openlex map set routes|hooks|agents|features|sources|models|prompts|permissions FILE.json   (or --clear)')
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
      const pm = r.config.permissions || {}
      const pmMatters = Object.keys(pm.matters || {}).length
      console.log(`PERMISSIONS  allow ${(pm.allow || []).join(', ') || '—'} · ask ${(pm.ask || []).join(', ') || '—'} · deny ${(pm.deny || []).join(', ') || '—'}${pmMatters ? ` · ${pmMatters} matter${pmMatters === 1 ? '' : 's'} with own rules` : ''}  (openlex permissions)`)
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
      if (!cmd && process.stdin.isTTY && process.stdout.isTTY) return startTui(a)
      console.log(USAGE)
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 2
  }
}

// Errors in plain words (bin/friendly.js), never a stack trace; usage lines are shown as they are.
main().catch((err) => { console.error(`openlex: ${/^usage:/.test(err.message) ? err.message : friendly(err)}`); process.exitCode = 1 })
