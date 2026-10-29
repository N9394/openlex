/* OpenLex Word pane — plain words shared by the pane modules.
 * No DOM, no Office.js: loaded as a plain script in the pane
 * (window.OpenLexPane.words) and with require() in node tests.
 * The engine sends ready sentences on `step` events (`plain`); these
 * helpers cover what the pane composes itself (durations, service names,
 * clause names). Mirrors sidecar/src/explain.js. */
(function (root, factory) {
  const m = factory()
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).words = m
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`

  /** "8 s", "1 min 5 s", "12 min". */
  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000))
    if (s < 60) return `${s} s`
    const m = Math.floor(s / 60)
    if (m >= 10) return `${m} min`
    return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
  }

  const times = (n) => (n === 1 ? 'once' : `${n} times`)

  const NAMES = {
    anthropic: 'Anthropic', openai: 'OpenAI', azure: 'Azure OpenAI', mistral: 'Mistral',
    openrouter: 'OpenRouter', bedrock: 'AWS Bedrock', vertex: 'Google Vertex',
    scaleway: 'Scaleway', ovhcloud: 'OVHcloud', stackit: 'STACKIT', ionos: 'IONOS',
  }
  const FAMILIES = [[/claude|anthropic/i, 'Claude'], [/gpt|^o\d|openai/i, 'GPT'], [/mistral|mixtral|magistral|codestral/i, 'Mistral'], [/gemini/i, 'Gemini'], [/llama/i, 'Llama'], [/qwen/i, 'Qwen']]
  const isEu = (r) => /^(eu|europe)/i.test(String(r || ''))

  /** "Claude (Anthropic, EU)", "Mistral (EU)", "this computer" — never a model id. */
  function serviceName(m) {
    m = m || {}
    if (m.local) return 'this computer'
    if (m.provider === 'custom') return 'your firm\'s AI server'
    const company = NAMES[m.provider] || clip(m.label || m.provider || 'an AI service', 30)
    const hit = FAMILIES.find(([re]) => re.test(String(m.model || '')) || (m.provider === 'anthropic' && re.test('claude')))
    const family = hit ? hit[1] : ''
    const region = m.region ? (isEu(m.region) ? 'EU' : /^us/i.test(m.region) ? 'USA' : clip(m.region, 16)) : ''
    const inner = [family && family !== company ? company : '', region].filter(Boolean).join(', ')
    const head = family && family !== company ? family : company
    return inner ? `${head} (${inner})` : head
  }

  /** "clause 4 (Liability)" from a heading like "4. Liability" or "§ 4 Haftung". */
  function clauseName(c) {
    if (!c) return 'a part of the document'
    const h = String(c.heading || '').trim()
    const m = /^(?:§+\s*|art(?:icle|\.)?\s*|clause\s*|ziffer\s*|punkt\s*)?(\d+(?:\.\d+)*)\.?\s*[-–:)]?\s*(.*)$/i.exec(h)
    if (m && m[2]) return `clause ${m[1]} (${clip(m[2], 40)})`
    if (m) return `clause ${m[1]}`
    if (h) return `the part “${clip(h, 40)}”`
    if (Number.isInteger(c.index)) return `part ${c.index + 1} of the document`
    return 'a part of the document'
  }

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
  const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

  return { clip, plural, duration, times, serviceName, clauseName, cap, lowerFirst, NAMES }
})
