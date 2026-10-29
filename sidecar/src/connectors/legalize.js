"use strict"
/**
 * Legalize (legalize-dev) — consolidated statutes of many countries, kept
 * by a volunteer project as one public git repository per country
 * (github.com/legalize-dev/legalize-<cc>): each law a Markdown file with
 * YAML front matter, each reform a dated commit. The texts come from the
 * official sources and stay under their terms (stated per repository:
 * CC BY 4.0 with RIS attribution for Austria, public domain for Germany
 * and Czechia, CC0 for the Netherlands, OGL for the UK …); the pipeline
 * code is MIT. A community source: not an official edition.
 *
 * Two ways in:
 *   - online (the default): the hosted API at legalize.dev with the
 *     lawyer's own free key (2,000 look-ups a month; €29 a month for
 *     50,000), header "Authorization: Bearer leg_…". Search by words or
 *     number, the text today, the text on a past date (law_at_date).
 *   - offline (only in the "Work fully offline" mode, or when the lawyer
 *     asks for one country offline): a git clone of the chosen country on
 *     this computer (shallow by default; the full history on request, for
 *     the text on a past date), a full-text index built here, a daily
 *     `git pull`. Nothing is cloned without the size shown first and a yes.
 *
 * Freshness: each country's last update (the newest commit) is shown in
 * /law; a country not updated for more than 60 days is flagged.
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { getJson, SourceError } = require('./http')
const { sliceSection } = require('./text')
const { paced } = require('./pace')
const localdata = require('./localdata')
const fts = require('./fts')

const LABEL = 'Legalize'
const API = () => (process.env.OPENLEX_LEGALIZE_API || 'https://legalize.dev').replace(/\/+$/, '')
const GITHUB_API = () => (process.env.OPENLEX_LEGALIZE_GITHUB || 'https://api.github.com').replace(/\/+$/, '')
const GIT_BASE = () => (process.env.OPENLEX_LEGALIZE_GIT || 'https://github.com/legalize-dev').replace(/\/+$/, '')
const STALE_DAYS = 60
const DAY = 86400000

/** Countries with a legalize repository (ISO code → name); the repo is legalize-<code lower case>. */
const COUNTRIES = {
  AT: 'Austria', DE: 'Germany', CH: 'Switzerland', CZ: 'Czechia', SK: 'Slovakia', PL: 'Poland', RO: 'Romania', FR: 'France',
  NL: 'Netherlands', BE: 'Belgium', LU: 'Luxembourg', UK: 'United Kingdom', IE: 'Ireland', EU: 'European Union', US: 'United States',
  ES: 'Spain', PT: 'Portugal', IT: 'Italy', GR: 'Greece', AD: 'Andorra', LI: 'Liechtenstein', SE: 'Sweden', FI: 'Finland', NO: 'Norway',
  EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', UY: 'Uruguay', KR: 'South Korea',
}
const COUNTRIES_DE = { AT: 'Österreich', DE: 'Deutschland', CH: 'Schweiz', CZ: 'Tschechien', SK: 'Slowakei', PL: 'Polen', RO: 'Rumänien', FR: 'Frankreich', NL: 'Niederlande', UK: 'Vereinigtes Königreich', EU: 'Europäische Union', US: 'USA' }
const cc = (j) => String(j || '').toUpperCase().replace(/^GB$/, 'UK')
const repoOf = (c) => `legalize-${cc(c).toLowerCase()}`
const day = (t) => (t ? String(t).slice(0, 10) : null)
const isStale = (t, now = Date.now()) => !!t && now - Date.parse(t) > STALE_DAYS * DAY

// ── git on this computer ────────────────────────────────────────────────

function git(args, { cwd, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try { child = spawn(process.env.OPENLEX_GIT || 'git', args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }) } catch (err) { return reject(err) }
    let out = ''
    let errText = ''
    const kill = () => { try { child.kill() } catch { /* gone */ } }
    signal?.addEventListener('abort', kill, { once: true })
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { errText += d; if (onLine) for (const l of String(d).split(/[\r\n]+/)) if (l.trim()) onLine(l) })
    child.on('error', (err) => reject(err.code === 'ENOENT' ? new SourceError('Git is not installed on this computer. Install it (git-scm.com) to keep laws offline, or use Legalize online with your free key.', 'setup', 'git missing') : err))
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill)
      if (code === 0) resolve(out)
      else reject(new SourceError(/could not resolve|unable to access|Could not read from remote/i.test(errText) ? 'GitHub could not be reached (no internet connection, or the service is down)' : 'The copy could not be updated', 'down', errText.slice(-300)))
    })
  })
}

// ── front matter and text ───────────────────────────────────────────────

/** { meta, body } of a Markdown file with YAML front matter (flat key: "value" lines). */
function parseMd(raw) {
  const s = String(raw)
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(s)
  const meta = {}
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line)
      if (!kv) continue
      let v = kv[2].trim()
      if (/^".*"$/.test(v)) { try { v = JSON.parse(v) } catch { v = v.slice(1, -1) } } else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'")
      meta[kv[1]] = v
    }
  }
  return { meta, body: m ? s.slice(m[0].length) : s }
}

/** Markdown → plain reading text (headings and emphasis marks dropped). */
const mdText = (md) => String(md).replace(/^#{1,6}\s*/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\n{3,}/g, '\n\n').trim()

/** One article or section of a law ("§ 922", "Art. 5", "Artikel 6:162"). */
function section(text, article) {
  const a = String(article).trim()
  return sliceSection(text, a, '§+|Art\\.?|Artikel|Article|Artículo|Articolo|Artigo|Section|Sec\\.?|Čl\\.?|Článok|Článek|Art')
}

/** "at:AT-10001622" → { country: 'AT', id: 'AT-10001622' }. */
function parseRef(ref) {
  const m = /^([a-z]{2}):([\w.-]{1,120})$/i.exec(String(ref || '').trim())
  if (!m || m[2].includes('..')) throw new SourceError(`${LABEL}: give the reference from a search result (for example at:AT-10001622)`, 'bad')
  return { country: cc(m[1]), id: m[2] }
}

// ── the local copy (offline mode) ───────────────────────────────────────

const dirOf = (c) => localdata.dirOf('legalize', cc(c).toLowerCase())
const repoDir = (c) => path.join(dirOf(c), 'repo')
const metaFile = (c) => path.join(dirOf(c), 'meta.json')
const readMeta = (c) => { try { return JSON.parse(fs.readFileSync(metaFile(c), 'utf8')) } catch { return null } }
const writeMeta = (c, m) => fs.writeFileSync(metaFile(c), JSON.stringify(m, null, 2))
const hasCopy = (c) => !!readMeta(c)?.indexed
const copies = () => { try { return fs.readdirSync(localdata.dirOf('legalize')).map((d) => d.toUpperCase()).filter((c) => hasCopy(c)) } catch { return [] } }

/** Every law file of a clone: <repo>/<cc>/*.md (and one level deeper). */
function lawFiles(dir) {
  const out = []
  const walk = (d, depth) => {
    let list = []
    try { list = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory() && depth < 3) walk(p, depth + 1)
      else if (e.isFile() && e.name.endsWith('.md') && depth > 0) out.push(p)
    }
  }
  walk(dir, 0)
  return out
}

const docOf = (country, file, repo) => {
  const { meta, body } = parseMd(fs.readFileSync(file, 'utf8'))
  const id = path.basename(file, '.md')
  return {
    id: `${country.toLowerCase()}:${id}`,
    title: [meta.short_title, meta.title].filter(Boolean).join(' – ') || id,
    body: mdText(body),
    meta: { file: path.relative(repo, file).split(path.sep).join('/'), title: meta.title || id, short: meta.short_title || null, status: meta.status || null, updated: meta.last_updated || meta.publication_date || null, source: meta.source || null },
  }
}

function indexAll(country, progress = () => {}) {
  const repo = repoDir(country)
  const files = lawFiles(repo)
  const ix = fts.open(path.join(dirOf(country), 'index'))
  try {
    const docs = []
    files.forEach((f, i) => { try { docs.push(docOf(country, f, repo)) } catch { /* unreadable file */ } if (i % 500 === 0) progress({ message: `Building the search index (${i} of ${files.length})…`, done: i, total: files.length }) })
    ix.replace(docs)
    return docs.length
  } finally { ix.close() }
}

/** The licence line and attribution, read from the repository's own files. */
function licenceOf(repo) {
  let text = ''
  try { text = fs.readFileSync(path.join(repo, 'LICENSE'), 'utf8') } catch { /* none */ }
  const data = /LEGISLATIVE CONTENT \(DATA\)\s*\n([^\n]+)/i.exec(text)?.[1]?.trim()
  let readme = ''
  try { readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8') } catch { /* none */ }
  const quote = /^>\s*(?:Quelle|Source|Bron|Zdroj|Fuente|Fonte|Źródło)[^\n]*/im.exec(readme)?.[0]?.replace(/^>\s*/, '').trim()
  return { licence: data || 'see the repository\'s LICENSE file', attribution: quote || null }
}

const lastCommit = async (repo) => day((await git(['log', '-1', '--format=%cI'], { cwd: repo })).trim())

async function clone(country, { dir, opts = {}, progress, signal }) {
  const C = cc(country)
  if (!COUNTRIES[C]) throw new SourceError(`${LABEL} has no repository for ${country}`, 'notfound')
  const repo = path.join(dir, 'repo')
  fs.rmSync(repo, { recursive: true, force: true })
  progress({ message: `Downloading the laws of ${COUNTRIES[C]} from GitHub…`, done: 0, total: 100 })
  const args = ['clone', '--progress', '--single-branch', ...(opts.history ? [] : ['--depth', '1']), `${GIT_BASE()}/${repoOf(C)}${/^https?:/.test(GIT_BASE()) ? '.git' : ''}`, repo]
  await git(args, { signal, onLine: (l) => { const m = /Receiving objects:\s+(\d+)%/.exec(l); if (m) progress({ done: +m[1], total: 100, message: `Downloading the laws of ${COUNTRIES[C]}: ${m[1]}%` }) } })
  const n = indexAll(C, progress)
  const lic = licenceOf(repo)
  writeMeta(C, { country: C, cloned: new Date().toISOString(), pulled: new Date().toISOString(), updated: await lastCommit(repo), history: !!opts.history, laws: n, bytes: localdata.folderBytes(dir), indexed: true, ...lic })
  progress({ done: 100, total: 100, message: `${n} laws of ${COUNTRIES[C]} on this computer` })
}

/** git pull for every local copy older than a day; re-index what changed. */
async function refresh({ force = false } = {}) {
  let n = 0
  for (const C of copies()) {
    const m = readMeta(C)
    if (!force && m.pulled && Date.now() - Date.parse(m.pulled) < DAY) continue
    const repo = repoDir(C)
    const before = (await git(['rev-parse', 'HEAD'], { cwd: repo })).trim()
    if (m.history) await git(['pull', '--ff-only', '--quiet'], { cwd: repo })
    else { await git(['fetch', '--depth', '1', '--quiet', 'origin'], { cwd: repo }); await git(['reset', '--hard', '--quiet', 'FETCH_HEAD'], { cwd: repo }) }
    const after = (await git(['rev-parse', 'HEAD'], { cwd: repo })).trim()
    if (after !== before) {
      let changed = null
      try { changed = (await git(['diff', '--name-only', before, after], { cwd: repo })).split('\n').filter((f) => f.endsWith('.md') && f.includes('/')) } catch { /* shallow: index everything */ }
      if (changed) {
        const ix = fts.open(path.join(dirOf(C), 'index'))
        try {
          const there = changed.filter((f) => fs.existsSync(path.join(repo, f)))
          ix.remove(changed.map((f) => `${C.toLowerCase()}:${path.basename(f, '.md')}`))
          ix.upsert(there.map((f) => docOf(C, path.join(repo, f), repo)))
        } finally { ix.close() }
      } else indexAll(C)
      n++
    }
    writeMeta(C, { ...m, pulled: new Date().toISOString(), updated: await lastCommit(repo), bytes: localdata.folderBytes(dirOf(C)), ...licenceOf(repo) })
  }
  return n
}

// ── freshness of every country (one GitHub request a day, cached) ────────

const freshFile = () => path.join(localdata.dirOf('legalize'), 'freshness.json')
function freshness() {
  let cache = null
  try { cache = JSON.parse(fs.readFileSync(freshFile(), 'utf8')) } catch { /* none yet */ }
  return cache?.repos || {}
}
let freshening = null
/** Update the cached freshness list in the background (at most once a day; only when the data rule allows online look-ups). */
function freshen({ force = false } = {}) {
  let at = 0
  try { at = Date.parse(JSON.parse(fs.readFileSync(freshFile(), 'utf8')).at) || 0 } catch { /* none */ }
  if (!force && Date.now() - at < DAY) return Promise.resolve(freshness())
  if (freshening) return freshening
  try { if (!require('../policy').check({ id: 'web', local: false }, null).allowed) return Promise.resolve(freshness()) } catch { /* no policy in tools */ }
  freshening = paced('github', 1000, () => getJson(`${GITHUB_API()}/orgs/legalize-dev/repos?per_page=100`, { label: 'GitHub' }))
    .then((list) => {
      const repos = {}
      for (const r of Array.isArray(list) ? list : []) {
        const m = /^legalize-([a-z]{2})$/.exec(r.name || '')
        if (m) repos[m[1].toUpperCase()] = { updated: day(r.pushed_at), sizeKb: r.size || 0 }
      }
      fs.mkdirSync(path.dirname(freshFile()), { recursive: true })
      fs.writeFileSync(freshFile(), JSON.stringify({ at: new Date().toISOString(), repos }))
      return repos
    })
    .catch(() => freshness())
    .finally(() => { freshening = null })
  return freshening
}

const staleNote = (C, updated) => `the ${COUNTRIES[C] || C} laws in Legalize were last updated ${updated}, more than ${STALE_DAYS} days ago: they may be out of date`

// ── the hosted API (online, with the lawyer's key) ──────────────────────

const auth = (key) => ({ Authorization: `Bearer ${String(key).replace(/^Bearer\s+/i, '')}` })
async function api(p, key) {
  try {
    return await paced('legalize', 250, () => getJson(`${API()}${p}`, { label: LABEL, headers: auth(key) }))
  } catch (err) {
    if (err.code === 'limit') throw new SourceError('Legalize says the look-ups included in your plan are used up for this month', 'limit', err.message)
    throw err
  }
}

const itemOf = (C, r, extra = {}) => ({
  ref: `${C.toLowerCase()}:${r.id}`,
  title: [r.short_title, r.title].filter(Boolean).join(' – ') || r.id,
  citation: connector.citation(`${C.toLowerCase()}:${r.id}`, { short: r.short_title }),
  url: r.source || `${API()}/${C.toLowerCase()}/${encodeURIComponent(r.id)}`,
  snippet: [r.status === 'repealed' ? 'repealed' : r.status === 'in_force' ? 'in force' : '', r.text_state === 'as_enacted' ? 'as enacted (amendments not folded in)' : '', r.title_snippet ? String(r.title_snippet).replace(/<\/?[^>]+>/g, '') : ''].filter(Boolean).join(' · '),
  date: r.last_updated || r.publication_date || null,
  inForce: r.status ? r.status === 'in_force' : null,
  jurisdiction: C,
  ...extra,
})

// ── the connector ───────────────────────────────────────────────────────

const connector = {
  id: 'legalize',
  label: 'Legalize (laws of many countries)',
  country: 'INT',
  jurisdictions: Object.keys(COUNTRIES),
  kind: 'law',
  community: true,
  description: 'Consolidated statutes of 30+ countries, one git repository per country kept by the volunteer Legalize project from the official sources, with every reform as a dated version (the text on a past date). Online with your free key, or kept on this computer for offline work.',
  licence: 'Texts under the official source\'s terms, as stated in each country\'s repository (for example CC BY 4.0, RIS Austria; public domain; CC0; OGL); Legalize code MIT',
  licenceUrl: 'https://github.com/legalize-dev',
  homepage: 'https://legalize.dev',
  needsKey: false,
  optionalKey: true,
  keyHelp: 'Open legalize.dev/api, sign up (free, no card), create an API key and paste it here. Free: 2,000 look-ups a month; €29 a month for 50,000.',
  setupWords: { en: 'free: paste your free key, or keep countries on this computer for offline work', de: 'kostenlos: Ihren kostenlosen Schlüssel einfügen oder Länder für die Offline-Arbeit auf diesem Computer speichern' },
  de: {
    label: 'Legalize (Gesetze vieler Länder)',
    description: 'Konsolidierte Gesetze von über 30 Ländern, je Land ein Git-Repository des ehrenamtlichen Legalize-Projekts aus den amtlichen Quellen, jede Novelle als datierte Fassung. Online mit Ihrem kostenlosen Schlüssel oder für die Offline-Arbeit auf diesem Computer.',
    keyHelp: 'Öffnen Sie legalize.dev/api, registrieren Sie sich (kostenlos, ohne Karte), erstellen Sie einen API-Schlüssel und fügen Sie ihn hier ein. Kostenlos: 2.000 Abfragen im Monat; 29 € im Monat für 50.000.',
  },
  guide: 'legalize',
  sample: 'Gewährleistung',
  hosts: ['legalize.dev', 'github.com', 'api.github.com'],
  countries: COUNTRIES,

  checkKey(key) {
    if (!/^(Bearer\s+)?[\w-]{12,}$/.test(String(key).trim())) throw new SourceError('That does not look like a Legalize key (it starts with leg_)', 'key')
  },

  /** Usable with a key (online) or with a local copy of the country asked for. */
  ready(key, { jurisdiction } = {}) {
    if (key) return true
    const have = copies()
    return jurisdiction ? have.includes(cc(jurisdiction)) : have.length > 0
  },

  /** Nothing goes online when the answer comes from the copy on this computer. */
  offlineOnly(key, { jurisdiction, ref } = {}) {
    const C = jurisdiction ? cc(jurisdiction) : ref ? (() => { try { return parseRef(ref).country } catch { return null } })() : null
    return C ? hasCopy(C) : !key && copies().length > 0
  },

  statusNote(lang) {
    freshen().catch(() => {})
    const have = copies()
    if (!have.length) return ''
    const parts = have.map((C) => { const m = readMeta(C); const st = isStale(m.updated); return lang === 'de' ? `${C} Stand ${m.updated}${st ? ', über 60 Tage alt' : ''}` : `${C} last updated ${m.updated}${st ? ', over 60 days old' : ''}` })
    return lang === 'de' ? ` (auf diesem Computer: ${parts.join('; ')})` : ` (on this computer: ${parts.join('; ')})`
  },

  async search(query, { limit = 8, jurisdiction = null, date = null } = {}, { key = null } = {}) {
    const fresh = freshness()
    const notes = []
    const C = jurisdiction ? cc(jurisdiction) : null
    if (C && !COUNTRIES[C]) return []
    const local = C ? (hasCopy(C) ? [C] : []) : copies()
    let items = []
    if (local.length) {
      for (const L of local) {
        const ix = fts.open(path.join(dirOf(L), 'index'))
        try {
          items.push(...ix.search(query, { limit }).map((h) => itemOf(L, { id: h.id.split(':')[1], title: h.meta.title, short_title: h.meta.short, status: h.meta.status, last_updated: h.meta.updated, source: h.meta.source }, { snippet: h.snippet })))
        } finally { ix.close() }
        const m = readMeta(L)
        if (isStale(m?.updated)) notes.push(staleNote(L, m.updated))
      }
      items = items.slice(0, limit)
    } else if (key && C) {
      const r = await api(`/api/v1/${C.toLowerCase()}/laws?${new URLSearchParams({ q: String(query).slice(0, 200), per_page: String(Math.min(limit, 20)), ...(date ? { to_date: date } : {}) })}`, key)
      if (!Array.isArray(r?.results)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no results list')
      items = r.results.slice(0, limit).map((x) => itemOf(C, x))
      if (isStale(fresh[C]?.updated)) notes.push(staleNote(C, fresh[C].updated))
    }
    return notes.length ? { items, note: notes.join('; ') } : items
  },

  /** The text of a law today (or on `date`), or one article of it. */
  async get(ref, { article = null, date = null } = {}, { key = null } = {}) {
    const { country: C, id } = parseRef(ref)
    let text
    let title = id
    let url = null
    let version = null
    let note = null
    if (hasCopy(C)) {
      const m = readMeta(C)
      const repo = repoDir(C)
      const file = lawFiles(repo).find((f) => path.basename(f, '.md') === id)
      if (!file) throw new SourceError(`${LABEL} has no such document`, 'notfound')
      const rel = path.relative(repo, file).split(path.sep).join('/')
      let raw = fs.readFileSync(file, 'utf8')
      if (date) {
        if (!m.history) {
          if (!key) throw new SourceError(`${LABEL}: the text on a past date needs the full history on this computer (/law → Legalize → keep with history) or your Legalize key`, 'bad')
        } else {
          const sha = (await git(['log', '-1', `--before=${date}T23:59:59`, '--format=%H', '--', rel], { cwd: repo })).trim()
          if (!sha) throw new SourceError(`${LABEL}: there is no version of this law on or before ${date}`, 'notfound')
          raw = await git(['show', `${sha}:${rel}`], { cwd: repo })
          version = `${day((await git(['log', '-1', '--format=%cI', sha], { cwd: repo })).trim())} (git ${sha.slice(0, 9)})`
        }
      }
      if (!date || m.history) {
        const { meta, body } = parseMd(raw)
        text = mdText(body)
        title = [meta.short_title, meta.title].filter(Boolean).join(' – ') || id
        url = meta.source || null
        if (isStale(m.updated)) note = staleNote(C, m.updated)
      }
    }
    if (text === undefined) {
      if (!key) throw new SourceError(`${LABEL}: paste your free key in /law, or keep ${COUNTRIES[C] || C} on this computer`, 'key')
      const base = `/api/v1/${C.toLowerCase()}/laws/${encodeURIComponent(id)}`
      if (date) {
        const r = await api(`${base}/at?${new URLSearchParams({ date })}`, key)
        text = mdText(r.content_md || '')
        url = r.source_url || r.citation_url || null
        version = r.version_date ? `${r.version_date}${r.sha ? ` (git ${String(r.sha).slice(0, 9)})` : ''}` : null
        if (r.warning) note = r.warning
      } else {
        const r = await api(base, key)
        text = mdText(r.content_md || '')
        title = [r.short_title, r.title].filter(Boolean).join(' – ') || id
        url = r.source || null
        if (r.warning) note = r.warning
      }
      const f = freshness()[C]
      if (isStale(f?.updated)) note = [note, staleNote(C, f.updated)].filter(Boolean).join('; ')
    }
    const part = article ? section(text, article) : null
    if (article && !part) throw new SourceError(`${LABEL}: ${article} was not found in ${title}`, 'notfound')
    return {
      ref: `${C.toLowerCase()}:${id}`,
      title,
      citation: connector.citation(`${C.toLowerCase()}:${id}`, { short: title.split(' – ')[0], article: part ? article : null }),
      url: url || `https://github.com/legalize-dev/${repoOf(C)}`,
      text: part || text,
      jurisdiction: C,
      ...(version ? { version } : {}),
      ...(note ? { note } : {}),
    }
  },

  /** "ABGB § 922 (Legalize AT-10001622)". */
  citation(ref, x = {}) {
    const id = String(ref).split(':').pop()
    const name = [x.short, x.article].filter(Boolean).join(' ')
    return `${name ? `${name} ` : ''}(Legalize ${id})`
  },

  /** Offline mode: one country at a time, on this computer. */
  local: {
    parts: () => Object.entries(COUNTRIES).map(([part, label]) => ({ part, label, labelDe: COUNTRIES_DE[part] || label, updated: freshness()[part]?.updated || null, stale: isStale(freshness()[part]?.updated) })),
    async plan(part, opts = {}) {
      const C = cc(part)
      if (!COUNTRIES[C]) throw new SourceError(`${LABEL} has no repository for ${part}`, 'notfound')
      const r = await paced('github', 1000, () => getJson(`${GITHUB_API()}/repos/legalize-dev/${repoOf(C)}`, { label: 'GitHub' }))
      const full = (Number(r.size) || 0) * 1024
      // A shallow copy holds today's files only: roughly a third of the full history, plus the index.
      const bytes = opts.history ? Math.round(full * 1.2) : Math.round(full * 0.4)
      return {
        part: C, label: `${COUNTRIES[C]} (${repoOf(C)})`, bytes, estimate: true,
        from: `https://github.com/legalize-dev/${repoOf(C)}`,
        updated: day(r.pushed_at), stale: isStale(r.pushed_at),
        licence: 'as stated in the repository (read after the download and shown with every answer)',
        note: opts.history ? 'with the full history (the text on any past date)' : 'today\'s texts only (add the full history for past dates)',
      }
    },
    run: (part, ctx) => clone(part, ctx),
    async items() {
      return copies().map((C) => { const m = readMeta(C); return { part: C, label: COUNTRIES[C] || C, bytes: m.bytes || 0, updated: m.updated, stale: isStale(m.updated), licence: m.licence, attribution: m.attribution, history: !!m.history, laws: m.laws || 0 } })
    },
    refresh: () => refresh(),
  },
}

module.exports = { ...connector, parseMd, parseRef, freshen, refresh, COUNTRIES, _git: git }
