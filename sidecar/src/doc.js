"use strict"
/**
 * In-memory document model: heading map, sectioning, per-section
 * compression, defined terms, jurisdiction detection.
 *
 * The full document never enters the LLM context — only the map, the
 * compressed sections, and the glossary (spec §4).
 */

const { splitSections, compressSection, extractDefinedTerms, estimateTokens } = require('./compress')

const JURISDICTION_HINTS = {
  AT: [/österreich|österreichisches|gmbh|gesmbh|bundesgesetz|bwg|gmbh-gesetz/i],
  DE: [/deutsches recht|german law|bgb|gmbhg|hgb|brd|europäische union unter deutschem recht/i],
  RO: [/codul civil|legea|românia|romania|drept roman|noul cod/i],
  SK: [/slovenská republika|obchodný zákonník|občiansky zákonník|slovenskej republiky/i],
  CZ: [/zákoník|česká republika|občanský zákoník|obchodní zákoník/i],
  US: [/united states|delaware|state of new york|us law|securities act|u\.?s\.?c\.?/i],
  'US-CA': [/california|civil code of california|cal\. civ\./i],
  ZA: [/republic of south africa|south african law|companies act 71/i],
  CY: [/cyprus|κυπριακή|republic of cyprus/i],
  UK: [/united kingdom|england and wales|english law|companies act 2006|uk law/i],
}

class Document {
  constructor(text, docId, paraStyles = null) {
    this.text = String(text || '')
    this.docId = docId || `doc-${Math.random().toString(36).slice(2, 8)}`
    this.sections = splitSections(this.text, 2000, paraStyles).map((s, i) => {
      const compressed = compressSection(s.text)
      return { ...s, index: i, compressed, tokens: estimateTokens(compressed), flagged: false }
    })
    this.glossary = []
    this._map = null
    this._jurisdiction = null
    for (const s of this.sections) this.glossary.push(...extractDefinedTerms(s.text))
  }

  /** Heading outline. Paragraph-level heuristic (Word styles come via API in P1). */
  map() {
    if (this._map) return this._map
    const sections = []
    for (const s of this.sections) {
      const firstLine = s.text.split('\n')[0].trim()
      const level = detectLevel(firstLine)
      const styled = s.styleLevel !== null && s.styleLevel !== undefined
      sections.push({
        index: s.index,
        heading: (styled || level >= 0) ? firstLine.replace(/[:.]$/, '') : null,
        level: styled ? s.styleLevel : Math.max(level, 0),
        chars: s.text.length,
        tokens: s.tokens,
        flagged: s.flagged,
        paraStart: s.paraStart, // body paragraph index (1:1 with Word body.paragraphs when doc is unchanged)
        paraCount: s.paraCount,
      })
    }
    this._map = { doc_id: this.docId, sections }
    return this._map
  }

  section(index) {
    return this.sections[+index]
  }

  jurisdiction() {
    if (this._jurisdiction) return this._jurisdiction
    const probe = this.text.slice(0, 4000)
    for (const [code, hints] of Object.entries(JURISDICTION_HINTS)) {
      if (hints.some((re) => re.test(probe))) { this._jurisdiction = code; return code }
    }
    this._jurisdiction = 'US' // sensible default for cross-border English docs
    return this._jurisdiction
  }

  /** Compact context for the agent system prompt (≤ ~400 tokens). */
  summary() {
    const map = this.map()
    const headings = map.sections.filter((s) => s.heading).slice(0, 40).map((s) => `${s.index}: ${s.heading}`).join(' | ')
    const glossary = this.glossary.slice(0, 25).map((t) => `${t.term} = ${t.definition.slice(0, 90)}`).join('; ')
    return `DOCUMENT: ${map.sections.length} sections.${headings ? '\nHEADINGS: ' + headings : ''}${glossary ? '\nDEFINED TERMS: ' + glossary : ''}`
  }
}

function detectLevel(line) {
  const { isHeading } = require('./compress')
  if (!line) return -1
  if (isHeading(line)) {
    // Numbered forms (Section N:, 4. Title, I. Parties) read as level 1,
    // ALL-CAPS titles as level 0. Same predicate splitSections uses, so the
    // map and the section boundaries can never disagree.
    if (/^(?:section|sec\.?|art\.?|article|clause|par\.?|paragraph|§|s\.?)\s*\d+/i.test(line)) return 1
    if (/^\d+(?:\.\d+)*[.)\s]+[A-ZÀ-ÿ0-9]/.test(line)) return 1
    if (/^(?:i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3})\b/i.test(line)) return 1
    return 0
  }
  return -1
}

module.exports = { Document }
