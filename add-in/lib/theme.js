/* OpenLex Word pane — light or dark, following Word's own theme
 * (Office.context.officeTheme) unless the user picked one. No DOM. */
(function (root, factory) {
  const m = factory()
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).theme = m
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  /** Relative luminance of "#rrggbb" (0 black … 1 white), or null. */
  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
    if (!m) return null
    const n = parseInt(m[1], 16)
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) })
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
  }

  /** Word's theme → 'dark' | 'light' | null (unknown). */
  function fromOffice(officeTheme) {
    if (!officeTheme) return null
    if (typeof officeTheme.isDarkTheme === 'boolean') return officeTheme.isDarkTheme ? 'dark' : 'light'
    const l = luminance(officeTheme.bodyBackgroundColor)
    return l == null ? null : l < 0.35 ? 'dark' : 'light'
  }

  /** The theme to use: the user's pick, else Word's, else the system's. */
  function resolve(pref, officeTheme, systemDark) {
    if (pref === 'dark' || pref === 'light') return pref
    return fromOffice(officeTheme) || (systemDark ? 'dark' : 'light')
  }

  return { luminance, fromOffice, resolve }
})
