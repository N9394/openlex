"use strict"
/**
 * Tool output compression (tooltrim-style). Compresses tool outputs BEFORE
 * they enter the context window. Each tool type gets content-aware
 * compression. Based on tooltrim/CMV patterns — 94-99% reduction on
 * structured data while preserving key facts.
 *
 * The model can call expand(ref) to retrieve the full output when needed.
 */

/**
 * Compress a tool result to key findings only. Applied at the boundary —
 * before the output enters the message array. The model never sees raw
 * tool output. Different strategies per tool type.
 *
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {string} output - Raw tool output
 * @returns {{ text: string, ref: string, original: string }}
 */
function compressToolOutput(name, args, output) {
  const text = String(output || '')
  const ref = `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

  let compressed
  switch (name) {
    case 'search_law':
      compressed = compressSearchResults(text, args)
      break
    case 'get_clause_analysis':
      compressed = compressClauseAnalysis(text)
      break
    case 'get_range_text':
      compressed = compressRangeText(text, args)
      break
    case 'get_law_section':
      compressed = compressLawSection(text)
      break
    case 'run_playbook':
      compressed = compressPlaybook(text)
      break
    case 'run_bash':
      compressed = compressBash(text)
      break
    case 'get_document_map':
      compressed = compressDocMap(text)
      break
    case 'remember':
    case 'recall':
      compressed = text // already compact
      break
    default:
      compressed = compressGeneric(text)
  }

  return { text: compressed, ref, original: text }
}

function compressSearchResults(text, args) {
  // Keep: header (result count) + top 3 source lines with statute tags
  const lines = text.split('\n').filter((l) => l.trim())
  const header = lines[0] || ''
  const digests = lines.slice(1, 4).map((l) => l.replace(/\[.*?\]/g, '').trim()).filter(Boolean)
  const more = lines.length > 4 ? ` +${lines.length - 4} more` : ''
  return `${header}\n${digests.join('\n')}${more}`
}

function compressClauseAnalysis(text) {
  // Keep structured table (parties/obligations/favoring), drop FULL TEXT
  const idx = text.indexOf('FULL TEXT')
  return idx > 0 ? text.slice(0, idx).trim() : text.slice(0, 300)
}

function compressRangeText(text, args) {
  // Keep first 2 sentences + section index
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  return sentences.slice(0, 2).join(' ')
}

function compressLawSection(text) {
  // Source + section + first 100 chars of content
  const parts = text.split('\n')
  const header = parts[0] || ''
  const content = parts.slice(1).join('\n').slice(0, 100)
  return `${header}\n${content}${parts.length > 2 ? '…' : ''}`
}

function compressPlaybook(text) {
  // Finding count + first 2 findings
  const lines = text.split('\n')
  return lines.slice(0, 3).join('\n')
}

function compressBash(text) {
  // Exit code + first/last 3 lines
  const lines = text.split('\n').filter(Boolean)
  if (lines.length <= 6) return text
  const first = lines.slice(0, 3).join('\n')
  const last = lines.slice(-3).join('\n')
  return `${first}\n…(${lines.length - 6} lines)…\n${last}`
}

function compressDocMap(text) {
  // Top 8 sections only
  const lines = text.split('\n')
  return lines.slice(0, 10).join('\n') + (lines.length > 10 ? `\n…+${lines.length - 10} more` : '')
}

function compressGeneric(text) {
  // Truncate to 200 chars
  return text.length > 200 ? text.slice(0, 200) + '…' : text
}

module.exports = { compressToolOutput }
