/* OpenLex Word pane — the contextual suggestion slot: at most ONE hint at a
 * time, under the question box ("Your firm has instructions for this:
 * NDA review"). Features appear in context through this slot instead of
 * adding buttons. A dismissed hint does not come back in this session.
 *
 * A hint: { id, text, action, priority } — higher priority replaces a lower
 * one; equal priority keeps the one already shown (no flicker). No DOM. */
(function (root, factory) {
  const m = factory()
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).suggest = m
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  function create() { return { current: null, dismissed: [] } }

  function offer(slot, hint) {
    if (!hint || !hint.id || slot.dismissed.includes(hint.id)) return slot
    const cur = slot.current
    if (cur && cur.id !== hint.id && (cur.priority || 0) >= (hint.priority || 0)) return slot
    return { current: Object.assign({}, hint), dismissed: slot.dismissed }
  }

  /** Remove a hint that no longer applies (e.g. the selection went away). */
  function withdraw(slot, id) {
    if (!slot.current || (id && slot.current.id !== id)) return slot
    return { current: null, dismissed: slot.dismissed }
  }

  /** The user closed it: gone for this session. */
  function dismiss(slot) {
    if (!slot.current) return slot
    return { current: null, dismissed: slot.dismissed.concat(slot.current.id) }
  }

  return { create, offer, withdraw, dismiss }
})
