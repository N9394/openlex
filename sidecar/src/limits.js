"use strict"
/**
 * One size rule for files, in every window: ~100 MB per file.
 *
 * The engine used to carry several limits (10 MB for working-folder
 * documents, 20 MB for the firm library, 50 MB for reading a file or a
 * download). They are all this one now. It can be changed:
 *
 *   OPENLEX_MAX_FILE_MB=200            (environment, wins)
 *   agent-config.json "maxFileMB": 200 (Settings)
 *
 * Above the limit the lawyer gets one plain sentence that says what to do.
 */

const DEFAULT_MB = 100

function maxFileMB() {
  const env = Number(process.env.OPENLEX_MAX_FILE_MB)
  if (Number.isFinite(env) && env > 0) return env
  try {
    const v = Number(require('./agent-config').load().maxFileMB)
    if (Number.isFinite(v) && v > 0) return v
  } catch { /* defaults */ }
  return DEFAULT_MB
}

const maxFileBytes = () => Math.round(maxFileMB() * 1024 * 1024)

/** "2.1 MB", "48 KB". */
function sizeText(bytes) {
  const b = +bytes || 0
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(b >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  if (b >= 1024) return `${Math.round(b / 1024)} KB`
  return `${b} bytes`
}

/** The sentence a lawyer sees for a file above the limit. */
function tooLargeMessage(name, bytes) {
  return `${name || 'This file'} is ${sizeText(bytes)}; OpenLex reads files up to ${maxFileMB()} MB. Split it into smaller files (for example one PDF per volume), or raise the limit in Settings.`
}

/** Throws (code FILE_TOO_LARGE) when a file is above the limit. */
function checkSize(name, bytes) {
  if ((+bytes || 0) > maxFileBytes()) {
    const e = new Error(tooLargeMessage(name, bytes))
    e.code = 'FILE_TOO_LARGE'
    throw e
  }
}

module.exports = { DEFAULT_MB, maxFileMB, maxFileBytes, sizeText, tooLargeMessage, checkSize }
