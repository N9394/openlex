"use strict"
/**
 * RIS adapter — Austrian federal law via the official open-data API
 * (data.bka.gv.at, Rechtsinformationssystem des Bundes). API first: no
 * scraping, stable fields, and it says which version is in force.
 */

const API = () => process.env.OPENLEX_RIS_API || 'https://data.bka.gv.at/ris/api/v2.6'
const PAGE_SIZES = { 10: 'Ten', 20: 'Twenty', 50: 'Fifty', 100: 'OneHundred' }

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : [])

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'OpenLex (+https://openlex.dev)' }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`RIS → HTTP ${res.status}`)
  return res.json()
}

/**
 * Search consolidated federal law (Bundesrecht konsolidiert).
 * @returns {Promise<{total:number, results:Array}>}
 */
async function searchBundesrecht(query, { limit = 10, inForceOnly = true } = {}) {
  const params = new URLSearchParams({ Applikation: 'BrKons', Suchworte: query, DokumenteProSeite: PAGE_SIZES[limit <= 10 ? 10 : 20] })
  if (inForceOnly) params.set('Fassung.FassungVom', new Date().toISOString().slice(0, 10))
  const d = await getJson(`${API()}/Bundesrecht?${params}`)
  const docs = d?.OgdSearchResult?.OgdDocumentResults || {}
  const total = parseInt(docs.Hits?.['#text'] || '0', 10)
  const results = asArray(docs.OgdDocumentReference).slice(0, limit).map((ref) => {
    const meta = ref.Data?.Metadaten || {}
    const br = meta.Bundesrecht || {}
    const k = br.BrKons || {}
    const urls = asArray(ref.Data?.Dokumentliste?.ContentReference).flatMap((c) => asArray(c.Urls?.ContentUrl))
    const today = new Date().toISOString().slice(0, 10)
    const until = k.Ausserkrafttretensdatum || null
    return {
      id: meta.Technisch?.ID || null,
      title: `${br.Kurztitel || ''} ${k.ArtikelParagraphAnlage || ''}`.trim(),
      abbreviation: k.Abkuerzung || null,
      section: k.ArtikelParagraphAnlage || null,
      inForceFrom: k.Inkrafttretensdatum || null,
      inForceUntil: until,
      inForce: !until || until >= today,
      lastAmendment: [k.NovellenBeziehung, k.NovellenPublikationsorgan, k.NovellenBgblnummer].filter(Boolean).join(' ') || null,
      url: br.Eli || meta.Allgemein?.DokumentUrl || null,
      htmlUrl: urls.find((u) => u.DataType === 'Html')?.Url || null,
    }
  })
  return { total, results }
}

/** Plain text of one RIS document (HTML content URL from searchBundesrecht). */
async function documentText(htmlUrl) {
  const u = new URL(htmlUrl)
  if (!/(^|\.)ris\.bka\.gv\.at$/.test(u.hostname)) throw new Error('not a RIS document URL')
  const res = await fetch(u, { headers: { 'User-Agent': 'OpenLex (+https://openlex.dev)' }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`RIS document → HTTP ${res.status}`)
  const html = await res.text()
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

module.exports = { searchBundesrecht, documentText }
