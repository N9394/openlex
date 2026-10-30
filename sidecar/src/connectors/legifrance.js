"use strict"
/**
 * Légifrance — French law (codes and the consolidated laws, ordinances,
 * decrees and orders) from the official Légifrance API of the DILA
 * (Direction de l'information légale et administrative), reached through
 * PISTE, the French State's API gateway. Data under the Licence Ouverte 2.0
 * (Etalab). Free, with the lawyer's own PISTE application:
 * "client_id:client_secret", exchanged for a short-lived token (OAuth 2.0
 * client credentials, scope openid) that is kept until it runs out.
 *
 * One PISTE key serves Légifrance and Judilibre (keyId 'piste'); the token
 * code is shared with judilibre.js.
 *
 *   POST /search                          fonds CODE_DATE, then LODA_DATE (version in force on a date)
 *   POST /consult/getArticle              one article by its LEGIARTI id
 *   POST /consult/getArticleWithIdAndNum  one article of a code or text by number
 *   POST /consult/legiPart                a whole consolidated text (LEGITEXT)
 */

const crypto = require('crypto')
const { request, getJson, htmlToText, strip, SourceError } = require('./http')
const { paced } = require('./pace')

const TOKEN_URL = () => process.env.OPENLEX_PISTE_TOKEN_URL || 'https://oauth.piste.gouv.fr/api/oauth/token'
const API = () => (process.env.OPENLEX_LEGIFRANCE_API || 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app').replace(/\/+$/, '')
const LABEL = 'Légifrance'
const SITE = 'https://www.legifrance.gouv.fr'
const GAP_MS = 250 // PISTE quotas are per application; one request at a time, a few a second at most

// ── the PISTE key (shared with judilibre.js) ──────────────────────────────

const tokens = new Map() // key hash → { token, until }
const pending = new Map() // key hash → a token request under way (Légifrance and Judilibre ask at once)
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16)

/** "client_id:client_secret" → { id, secret }; a plain sentence for anything else. */
function parseKey(key) {
  const k = String(key || '').trim()
  const i = k.indexOf(':')
  if (!k || i < 1 || i === k.length - 1 || /\s/.test(k)) throw new SourceError('Paste the PISTE key as client-id:client-secret (both from your application on piste.gouv.fr)', 'key')
  return { id: k.slice(0, i), secret: k.slice(i + 1) }
}

/** An access token for this key: cached until shortly before it runs out. */
async function token(key, label, { force = false } = {}) {
  const { id, secret } = parseKey(key)
  const h = hash(key)
  const hit = tokens.get(h)
  if (!force && hit && hit.until > Date.now() + 30000) return hit.token
  if (!force && pending.has(h)) return pending.get(h)
  const p = fetchToken(id, secret, label, h)
  pending.set(h, p)
  try { return await p } finally { if (pending.get(h) === p) pending.delete(h) }
}

async function fetchToken(id, secret, label, h) {
  let res
  try {
    res = await request(TOKEN_URL(), {
      label, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'openid' }).toString(),
    })
  } catch (err) {
    if (err.code === 'bad' || err.code === 'key') throw new SourceError(`${label} did not accept the key (check the client id and secret of your PISTE application)`, 'key', err.message)
    throw err
  }
  const j = await res.json().catch(() => ({}))
  if (!j.access_token) throw new SourceError(`${label} did not accept the key`, 'key', 'no access_token')
  tokens.set(h, { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 })
  return j.access_token
}

/**
 * One call to a PISTE API with the bearer token, paced; a token refused
 * before its time is renewed once. 403 means the application is not
 * subscribed to this API (or its terms are not accepted).
 */
async function piste(key, { label, api, path, method = 'GET', body, paceKey }) {
  const once = async (force) => {
    const t = await token(key, label, { force })
    return paced(paceKey, GAP_MS, () => getJson(`${api}${path}`, {
      label, method,
      headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }))
  }
  try { return await once(false) } catch (err) {
    if (err.code !== 'key') throw err
    if (/HTTP 403/.test(err.message)) throw new SourceError(`${label} did not accept the key: subscribe your PISTE application to the ${label} API and accept its terms (CGU) on piste.gouv.fr`, 'key', err.message)
    tokens.delete(hash(key))
    try { return await once(true) } catch (e2) {
      if (e2.code === 'key' && /HTTP 403/.test(e2.message)) throw new SourceError(`${label} did not accept the key: subscribe your PISTE application to the ${label} API and accept its terms (CGU) on piste.gouv.fr`, 'key', e2.message)
      throw e2
    }
  }
}

// ── codes: names, abbreviations, identifiers ──────────────────────────────

/** The usual codes: Légifrance identifier and the usual short form for citations. */
const CODES = [
  ['Code civil', 'C. civ.', 'LEGITEXT000006070721', ['code civil', 'c. civ.', 'c civ', 'cciv']],
  ['Code pénal', 'C. pén.', 'LEGITEXT000006070719', ['code pénal', 'code penal', 'c. pén.', 'c. pen.', 'c pen']],
  ['Code du travail', 'C. trav.', 'LEGITEXT000006072050', ['code du travail', 'c. trav.', 'c trav']],
  ['Code de commerce', 'C. com.', 'LEGITEXT000005634379', ['code de commerce', 'c. com.', 'c com']],
  ['Code de procédure civile', 'CPC', 'LEGITEXT000006070716', ['code de procédure civile', 'code de procedure civile', 'cpc']],
  ['Code de procédure pénale', 'CPP', 'LEGITEXT000006071154', ['code de procédure pénale', 'code de procedure penale', 'cpp']],
  ['Code de la consommation', 'C. consom.', 'LEGITEXT000006069565', ['code de la consommation', 'c. consom.', 'c consom']],
  ['Code général des impôts', 'CGI', 'LEGITEXT000006069577', ['code général des impôts', 'code general des impots', 'cgi']],
  ['Code de la sécurité sociale', 'CSS', 'LEGITEXT000006073189', ['code de la sécurité sociale', 'code de la securite sociale', 'css']],
  ['Code de la propriété intellectuelle', 'CPI', 'LEGITEXT000006069414', ['code de la propriété intellectuelle', 'code de la propriete intellectuelle', 'cpi']],
]
const SHORT = Object.fromEntries(CODES.map(([name, short]) => [name.toLowerCase(), short]))
const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** "Art. 1240 C. civ." / "article 1240 du code civil" / "C. civ. art. 1240" → { textId, num, name }; null otherwise. */
function parseRef(q) {
  const s = fold(q).replace(/\s+/g, ' ').trim()
  const num = s.match(/\b(?:art(?:icle)?\.?\s*)([lrda]\.?\s?)?(\d[\d-]*(?:\s?(?:bis|ter|quater))?)\b/)
  if (!num) return null
  for (const [name, , textId, names] of CODES) {
    if (names.some((n) => new RegExp(`(^|[^a-z])${fold(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(s))) return { textId, num: `${num[1] ? num[1].replace(/[.\s]/g, '').toUpperCase() : ''}${num[2].replace(/\s/g, '')}`, name }
  }
  return null
}

// ── shapes ────────────────────────────────────────────────────────────────

const day = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : /^\d{9,}$/.test(String(v)) ? Number(v) : null
  if (n !== null) return new Date(n).toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}
const isCode = (id, title) => /^LEGITEXT/.test(String(id)) && /^code\b/i.test(String(title || ''))
const articleUrl = (id, code) => `${SITE}/${code ? 'codes' : 'loda'}/article_lc/${id}`
const textUrl = (id, code) => `${SITE}/${code ? 'codes/texte_lc' : 'loda/id'}/${id}`

function citation(ref, x = {}) {
  const textTitle = x.textTitle || ''
  const short = SHORT[String(textTitle).toLowerCase()]
  if (x.num) return short ? `Art. ${x.num} ${short}` : `Art. ${x.num}${textTitle ? `, ${textTitle}` : ''} (Légifrance, ${ref})`
  return `${textTitle || ref} (Légifrance${textTitle ? `, ${ref}` : ''})`
}

/** Search hits (typePagination ARTICLE): one result per article, else per text. */
function mapResults(json, limit, fond) {
  const out = []
  for (const r of json?.results || []) {
    const t = (r.titles || [])[0] || {}
    const textTitle = strip(t.title || r.text || '')
    const code = fond === 'CODE_DATE' || isCode(t.id, textTitle)
    const extracts = (r.sections || []).flatMap((s) => (s.extracts || []).map((e) => ({ ...e, section: strip(s.title) })))
    const arts = extracts.filter((e) => /^LEGIARTI|^JORFARTI/.test(String(e.id)))
    if (arts.length) {
      for (const e of arts) {
        const num = String(e.num || '').trim() || null
        out.push({
          ref: e.id,
          title: `${textTitle}${num ? `, article ${num}` : ''}`,
          citation: citation(e.id, { textTitle, num }),
          url: articleUrl(e.id, code),
          snippet: [e.section, strip((e.values || []).join(' … '))].filter(Boolean).join(': ').slice(0, 600),
          date: day(e.dateDebut || e.dateVersion),
          inForce: e.legalStatus ? e.legalStatus === 'VIGUEUR' : null,
        })
        if (out.length >= limit) return out
      }
    } else if (t.id) {
      out.push({
        ref: t.cid || t.id,
        title: textTitle || t.id,
        citation: citation(t.cid || t.id, { textTitle }),
        url: textUrl(t.cid || t.id, code),
        snippet: strip(extracts.flatMap((e) => e.values || []).join(' … ')).slice(0, 600),
        date: day(r.date || r.dateSignature || t.startDate),
        inForce: t.legalStatus ? t.legalStatus === 'VIGUEUR' : r.etat ? r.etat === 'VIGUEUR' : null,
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

const searchBody = (fond, query, limit, date) => ({
  fond,
  recherche: {
    champs: [{ typeChamp: 'ALL', operateur: 'ET', criteres: [{ typeRecherche: 'TOUS_LES_MOTS_DANS_UN_CHAMP', valeur: String(query).slice(0, 300), operateur: 'ET' }] }],
    filtres: [{ facette: 'DATE_VERSION', singleDate: Date.parse(date ? `${date}T00:00:00Z` : new Date().toISOString().slice(0, 10)) }],
    pageNumber: 1, pageSize: Math.min(Math.max(limit, 1), 20), operateur: 'ET', sort: 'PERTINENCE', typePagination: 'ARTICLE',
  },
})

function articleOf(a, ref) {
  const textTitle = strip((a.textTitles || [])[0]?.titre || (a.context?.titreTxt || [])[0]?.titre || '')
  const code = /^code\b/i.test(textTitle)
  const num = a.num ? String(a.num) : null
  const text = String(a.texte || '').trim() || htmlToText(a.texteHtml || '')
  const inForce = a.etat ? a.etat === 'VIGUEUR' : null
  return {
    ref: a.id || ref,
    title: `${textTitle}${num ? `, article ${num}` : ''}`,
    citation: citation(a.id || ref, { textTitle, num }),
    url: articleUrl(a.id || ref, code),
    text: `${num ? `Article ${num}\n` : ''}${text}`,
    version: day(a.dateDebut),
    inForce,
    ...(inForce === false ? { note: `This version of the article is not in force (Légifrance status: ${a.etat}); in force from ${day(a.dateDebut)} to ${day(a.dateFin)}.` } : {}),
  }
}

/** Flatten a consolidated text (sections → articles) into plain text. */
function flatten(t, max = 60000) {
  const lines = []
  const walk = (s, depth) => {
    if (s.title && depth) lines.push(strip(s.title))
    for (const a of s.articles || []) lines.push(`Article ${a.num || ''}`.trim(), htmlToText(a.content || a.texte || ''))
    for (const c of s.sections || []) walk(c, depth + 1)
  }
  walk(t, 0)
  const text = lines.filter(Boolean).join('\n')
  return text.length > max ? text.slice(0, max) : text
}

const connector = {
  id: 'legifrance',
  label: 'Légifrance',
  country: 'FR',
  jurisdictions: ['FR'],
  kind: 'law',
  description: 'French codes and consolidated laws, ordinances and decrees from the official Légifrance API (DILA), the version in force on a date',
  licence: 'Licence Ouverte 2.0 (Etalab); DILA, Légifrance',
  licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  homepage: 'https://www.legifrance.gouv.fr',
  needsKey: true,
  keyId: 'piste',
  needsKeyWords: 'needs your free PISTE key',
  keyHelp: 'Free, about 10 minutes: 1. Create an account at piste.gouv.fr. 2. Create an application. 3. Subscribe it to the Légifrance and Judilibre APIs and accept their terms (CGU). 4. Copy the client id and the client secret. 5. Paste them here as id:secret. One key serves Légifrance and Judilibre.',
  guide: 'piste',
  hosts: ['api.piste.gouv.fr', 'oauth.piste.gouv.fr'],
  de: {
    label: 'Légifrance (Frankreich)',
    description: 'Französische Gesetzbücher (Codes) und konsolidierte Gesetze, Verordnungen und Dekrete aus der amtlichen Légifrance-API (DILA), in der an einem Datum geltenden Fassung',
    needsKeyWords: 'braucht Ihren kostenlosen PISTE-Schlüssel',
    keyHelp: 'Kostenlos, etwa 10 Minuten: 1. Konto auf piste.gouv.fr anlegen. 2. Eine Anwendung anlegen. 3. Sie für die APIs Légifrance und Judilibre abonnieren und deren Bedingungen (CGU) annehmen. 4. Client-ID und Client-Secret kopieren. 5. Hier als id:secret einfügen. Ein Schlüssel gilt für Légifrance und Judilibre.',
  },
  sample: 'responsabilité du fait des choses',
  checkKey: (key) => { parseKey(key) },

  async search(query, { limit = 8, date = null } = {}, { key } = {}) {
    const call = (path, body) => piste(key, { label: LABEL, api: API(), path, method: 'POST', body, paceKey: 'piste-legifrance' })
    const direct = parseRef(query)
    if (direct) {
      try {
        const r = await call('/consult/getArticleWithIdAndNum', { id: direct.textId, num: direct.num })
        if (r?.article?.id) {
          const a = articleOf(r.article, r.article.id)
          return [{ ref: a.ref, title: a.title, citation: a.citation, url: a.url, snippet: a.text.slice(0, 400), date: a.version, inForce: a.inForce }]
        }
      } catch (err) { if (err.code !== 'notfound') throw err }
    }
    const out = mapResults(await call('/search', searchBody('CODE_DATE', query, limit, date)), limit, 'CODE_DATE')
    if (out.length < limit) out.push(...mapResults(await call('/search', searchBody('LODA_DATE', query, limit - out.length, date)), limit - out.length, 'LODA_DATE'))
    return out
  },

  /** An article (LEGIARTI…), an article of a text by number (LEGITEXT… + article, or "Code civil" + article), or a whole text. */
  async get(ref, { article = null, date = null } = {}, { key } = {}) {
    const call = (path, body) => piste(key, { label: LABEL, api: API(), path, method: 'POST', body, paceKey: 'piste-legifrance' })
    const id = String(ref || '').trim()
    const num = article ? String(article).replace(/^\s*(art(icle)?\.?)\s*/i, '').trim() : null
    let textId = /^(LEGITEXT|JORFTEXT)\d{12}$/.test(id) ? id : null
    if (!textId && !/^(LEGIARTI|JORFARTI)\d{12}$/.test(id)) {
      const p = parseRef(num ? `art. ${num} ${id}` : id)
      if (p) return connector.get(p.textId, { article: p.num, date }, { key })
      throw new SourceError(`${LABEL}: give the identifier from a search result (LEGIARTI…, LEGITEXT…) or a code and article, for example "Art. 1240 C. civ."`, 'bad')
    }
    if (/^(LEGIARTI|JORFARTI)/.test(id)) {
      const r = await call('/consult/getArticle', { id })
      if (!r?.article) throw new SourceError(`${LABEL} has no such document`, 'notfound')
      return articleOf(r.article, id)
    }
    if (num) {
      const r = await call('/consult/getArticleWithIdAndNum', { id: textId, num })
      if (!r?.article?.id) throw new SourceError(`${LABEL}: article ${num} was not found in this text`, 'notfound')
      return articleOf(r.article, r.article.id)
    }
    const t = await call('/consult/legiPart', { textId, date: date || new Date().toISOString().slice(0, 10) })
    const title = strip(t?.title || '') || textId
    const code = /^code\b/i.test(title)
    return { ref: textId, title, citation: citation(textId, { textTitle: title }), url: textUrl(textId, code), text: flatten(t || {}), version: day(t?.dateDebutVersion) }
  },

  citation,
}

module.exports = { ...connector, parseKey, parseRef, mapResults, piste, _reset: () => { tokens.clear(); pending.clear() } }
