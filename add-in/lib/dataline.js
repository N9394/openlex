/* OpenLex Word pane — "Where your data went": one always-visible line.
 * Symbol + words, never colour alone:
 *   ✓ Stayed on this computer
 *   ! Sent to Claude (Anthropic, EU) — names hidden · 2 times
 *   ! Looked up online: RIS
 * Built from the engine's `model` events (one per AI call) and the
 * `online`/`onlineTo` fields of `step` events. No DOM. */
(function (root, factory) {
  const words = typeof require === 'function' ? require('./words.js') : root.OpenLexPane.words
  const m = factory(words)
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).dataline = m
})(typeof self !== 'undefined' ? self : this, function (words) {
  'use strict'

  /** Add one `model` event to the services used (same service → count). */
  function addModel(models, ev) {
    const key = `${ev.local ? 'local' : ev.provider}|${ev.region || ''}|${ev.redacted ? 1 : 0}`
    const out = (models || []).map((m) => Object.assign({}, m))
    const hit = out.find((m) => m.key === key)
    if (hit) hit.calls++
    else out.push({ key, provider: ev.provider, label: ev.label, model: ev.model || null, local: !!ev.local, region: ev.region || null, redacted: !!ev.redacted, calls: 1 })
    return out
  }

  /** "RIS (Austria's federal law database)" → "RIS" for the line; the long form goes in the tooltip. */
  const short = (name) => String(name || '').replace(/\s*\(.*\)\s*$/, '').trim() || String(name || '')

  /**
   * The line: { symbol: '✓'|'!', text, left, title }. `left` is true when
   * anything went outside this computer.
   */
  function line(models, online, opts) {
    const running = !!(opts && opts.running)
    const cloud = (models || []).filter((m) => !m.local)
    const web = [...new Set(online || [])]
    const parts = []
    for (const m of cloud) parts.push(`Sent to ${words.serviceName(m)} — ${m.redacted ? 'names hidden' : 'names not hidden'} · ${words.times(m.calls)}`)
    if (web.length) parts.push(`Looked up online: ${web.map(short).join(', ')}`)
    if (!parts.length) {
      return { symbol: '✓', left: false, text: running ? 'Nothing has left this computer so far' : 'Stayed on this computer', title: 'The AI ran on this computer and nothing was looked up online.' }
    }
    const title = [
      cloud.length ? 'Your text was sent to the AI service named here, under your firm\'s client-data rule.' : 'Your documents stayed on this computer.',
      web.length ? `Only search words or web addresses went to: ${web.join(', ')}.` : '',
    ].filter(Boolean).join(' ')
    return { symbol: '!', left: true, text: parts.join(' · '), title }
  }

  /** The header label: where the AI runs ("AI: this computer"). `status` = GET /api/status. */
  function aiLabel(status) {
    const m = (status && status.model) || {}
    // The engine's words, the same label as the desktop app: "Claude · AWS Bedrock (EU)".
    if (m.display && m.display.en) return { text: `${m.display.en} ▾`, local: !!m.display.local }
    if (m.local !== false) return { text: 'AI: this computer', local: true }
    return { text: `AI: ${words.serviceName({ provider: m.provider, model: m.name, region: m.region, label: m.label })}`, local: false }
  }

  return { addModel, line, aiLabel, short }
})
