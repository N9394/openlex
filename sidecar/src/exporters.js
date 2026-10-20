"use strict"
/**
 * Deterministic exporters (Batch W2) — discovery/checklist/calendar files
 * built from sidecar-known data (sections + clause analysis + a deadline
 * extractor). No model free-form: the formats stay reliable.
 *
 * Export model:
 *   { matter, generatedAt, docId,
 *     clauses: [{section, heading, summary, chars}],
 *     obligations: [{section, subject, type, clause}],
 *     deadlines: [{date, text, section}],
 *     inventory: [{section, heading, chars}] }
 *
 * Formats: csv | xml | json | md | dat (Relativity-style load file) | ics
 */

const DATE_RE = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:jan(?:uar)?|feb(?:ruar)?|mär|mar|apr|mai|jun|jul|aug|sep|okt|oct|nov|dez|dec)[a-z]*\.?\s+\d{4})\b/gi
const DUR_RE = /\b(?:within|no later than|nach|binnen|upon|bei|frist von)\s+(\d{1,3})\s+(?:kalender|kalendertage|business\s+)?(days?|tage?|weeks?|wochen?|months?|monate?|monaten?|years?|jahren?|jahren)\b/gi

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  januar: 1, februar: 2, märz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 }

function parseDate(s) {
  const m = String(s || '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const m2 = String(s || '').match(/(\d{1,2})\s+([a-zäöüß]+)\.?\s+(\d{4})/i)
  if (m2) {
    const mon = MONTHS[String(m2[2]).toLowerCase().slice(0, 3)]
    if (mon) return `${m2[3]}-${String(mon).padStart(2, '0')}-${m2[1].padStart(2, '0')}`
  }
  return null
}

/** Extract deadlines (dates + notice durations) deterministically from text.
 * Dates run on the RAW text (sentence splitting would break "15.09.2026"
 * on the dots); durations on the sentence-split text. */
function extractDeadlines(sections) {
  const out = []
  for (const s of sections || []) {
    const text = String(s.text || '')
    for (const dm of text.matchAll(DATE_RE)) {
      const parsed = parseDate(dm[0])
      if (!parsed) continue
      const win = text.slice(Math.max(0, dm.index - 70), dm.index + dm[0].length + 70).replace(/\s+/g, ' ').trim()
      out.push({ date: parsed, text: win.slice(0, 200), section: s.index })
    }
    const sentences = text.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]+/g) || []
    for (const sent of sentences) {
      for (const dm of sent.matchAll(DUR_RE)) {
        out.push({ date: null, duration: `${dm[1]} ${dm[2]}`, text: sent.trim().slice(0, 200), section: s.index })
      }
    }
  }
  return out
}

function buildModel(doc, matter) {
  const sections = (doc && doc.sections) || []
  const clauses = sections.map((s) => ({
    section: s.index, heading: String(s.text.split('\n')[0] || '').slice(0, 80),
    chars: s.text.length,
  }))
  const obligations = []
  try {
    const { analyzeSection } = require('./clause')
    for (const s of sections) {
      const a = analyzeSection(s.text)
      for (const r of (a.rows || []).slice(0, 10)) {
        obligations.push({ section: s.index, subject: r.subject, type: r.type, clause: String(r.clause || '').slice(0, 160) })
      }
    }
  } catch { /* analysis best-effort */ }
  return {
    matter, generatedAt: new Date().toISOString(), docId: doc.docId || '',
    clauses, obligations, inventory: clauses,
    deadlines: extractDeadlines(sections),
  }
}

function escXml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function csvEscape(s) { const t = String(s ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }

function toCSV(rows, cols) {
  const head = cols.join(',')
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))
  return [head, ...body].join('\n') + '\n'
}

function toXML(model) {
  const rows = model.inventory.map((c) =>
    `  <document><section>${escXml(c.section)}</section><heading>${escXml(c.heading)}</heading><chars>${c.chars}</chars></document>`).join('\n')
  const ob = model.obligations.map((o) =>
    `  <obligation><section>${o.section}</section><party>${escXml(o.subject)}</party><type>${escXml(o.type)}</type><clause>${escXml(o.clause)}</clause></obligation>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<lexvault_export matter="${escXml(model.matter)}" generated="${escXml(model.generatedAt)}">\n<inventory>\n${rows}\n</inventory>\n<obligations>\n${ob}\n</obligations>\n</lexvault_export>\n`
}

function toDAT(model) {
  // Relativity-style load file (pipe-delimited): DOCID|BEGBATES|ENDBATES|FILE|TITLE|TEXT
  const rows = model.inventory.map((c, i) => {
    const id = String(i + 1).padStart(6, '0')
    return `${id}|LV${id}|LV${id}||${escXml(c.heading)}|${escXml(c.heading)} § ${c.section}`
  })
  return 'DOCID|BEGBATES|ENDBATES|FILE|TITLE|TEXT\n' + rows.join('\n') + '\n'
}

function toJSON(model) { return JSON.stringify(model, null, 2) + '\n' }

function toMarkdown(model) {
  const L = []
  L.push(`# ${model.matter} — LexVault analysis`)
  L.push(`Generated: ${model.generatedAt}`)
  L.push(`\n## Clauses (${model.clauses.length})`)
  for (const c of model.clauses) L.push(`- §${c.section} ${c.heading} (${c.chars} chars)`)
  L.push(`\n## Obligations (${model.obligations.length})`)
  for (const o of model.obligations) L.push(`- §${o.section} [${o.type}] ${o.subject}: ${o.clause}`)
  L.push(`\n## Deadlines (${model.deadlines.length})`)
  for (const d of model.deadlines) L.push(`- ${d.date || d.duration || '?'}: ${d.text}`)
  return L.join('\n') + '\n'
}

function toICS(model) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LexVault//EN', 'CALSCALE:GREGORIAN']
  for (const d of model.deadlines) {
    if (!d.date) continue
    const safe = d.date.replace(/[-:]/g, '')
    L.push('BEGIN:VEVENT', `UID:lv-${model.matter}-${d.section}-${safe}@lexvault`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      // All-day events: DTEND is exclusive (RFC 5545), so it is the next day.
      `DTSTART;VALUE=DATE:${safe}`, `DTEND;VALUE=DATE:${new Date(Date.parse(`${safe.slice(0, 4)}-${safe.slice(4, 6)}-${safe.slice(6, 8)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10).replace(/-/g, '')}`,
      `SUMMARY:${String(d.text || 'Deadline').replace(/[,;\\\n]/g, ' ').slice(0, 100)}`,
      'END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.join('\r\n') + '\r\n'
}

/** Deterministic PDF (Batch 4 deferred item): two-column worklist
 * (obligations + deadlines + clause inventory) via the bundled no-dep
 * PDF writer. Returns a Buffer — callers write it with writeFileBinary. */
function toPDF(model) {
  const { renderPdf } = require('./pdf')
  const L = (s) => String(s ?? '')
  const blocks = []
  if (model.matter) {
    blocks.push({ title: `Matter: ${model.matter}`, rows: [[String(model.generatedAt || ''), 'LexVault document export']] })
  }
  if (model.obligations && model.obligations.length) {
    blocks.push({ title: 'Obligations', rows: model.obligations.map((o) => [L(o.section), `${o.type || ''} — ${o.clause || ''}`]) })
  }
  if (model.deadlines && model.deadlines.length) {
    blocks.push({ title: 'Deadlines', rows: model.deadlines.map((d) => [L(d.date || d.duration || ''), d.text || '']) })
  }
  if (model.clauses && model.clauses.length) {
    blocks.push({ title: 'Clause inventory', rows: model.clauses.map((c) => [L(c.section), `${c.heading || ''} — ${c.summary || ''}`]) })
  }
  return renderPdf(blocks)
}

function exportFile(model, format) {
  switch (format) {
    case 'csv': return { ext: 'csv', content: toCSV(model.obligations, ['section', 'subject', 'type', 'clause']) }
    case 'xml': return { ext: 'xml', content: toXML(model) }
    case 'json': return { ext: 'json', content: toJSON(model) }
    case 'md': case 'markdown': return { ext: 'md', content: toMarkdown(model) }
    case 'dat': return { ext: 'dat', content: toDAT(model) }
    case 'ics': return { ext: 'ics', content: toICS(model) }
    case 'pdf': return { ext: 'pdf', content: toPDF(model) }
    default: return null
  }
}

module.exports = { buildModel, extractDeadlines, exportFile }
