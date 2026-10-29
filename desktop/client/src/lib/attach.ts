// Documents in the App's chat: the file the lawyer attaches (paperclip or
// drop) is read by the OpenLex engine on this computer (POST
// /api/document/read: Word, PDF with on-device text recognition for scans,
// Excel, e-mail, text) and referred to by id afterwards — in questions, in
// the full analysis (/analyse) and in the document reader. Plain functions,
// no React.

import { engine } from './commands'

/** What the engine reads. Old binary formats get a sentence that says what to do. */
export const ATTACH_EXT = /\.(docx|pdf|xlsx|eml|txt|md|markdown|csv|tsv|json|xml|html?|rtf|log)$/i
export const OLD_FORMAT: Record<string, string> = {
  doc: 'is the old Word format. Open it in Word and save it as .docx, then attach it again.',
  xls: 'is the old Excel format. Open it in Excel and save it as .xlsx, then attach it again.',
  msg: 'is an Outlook .msg file. In Outlook use File → Save As → .eml, then attach that.',
  pages: 'is a Pages file. Export it as Word or PDF first.',
}
/** The engine's one size rule (limits.js); the engine checks again. */
export const MAX_MB = 100

export interface Attachment {
  id: string
  name: string
  kind: string
  bytes: number
  chars: number
  pages: number
  ocrPages: number
  tokens: number
  outline?: string[]
  attachments?: string[]
  strategy?: { kind: 'local' | 'cloud'; mode: 'full' | 'parts'; cache?: boolean; label?: string; text: string }
  where?: { local: boolean; text: string }
}

export const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(b >= 10 * 1024 * 1024 ? 0 : 1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} bytes`)

/** Why a file cannot be attached, or null. */
export function refusal(f: { name: string; size: number }): string | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(f.name)?.[1] || '').toLowerCase()
  if (OLD_FORMAT[ext]) return `${f.name} ${OLD_FORMAT[ext]}`
  if (!ATTACH_EXT.test(f.name)) return `${f.name}: this kind of file cannot be read. Attach Word, PDF, Excel, e-mail (.eml) or text files.`
  if (f.size > MAX_MB * 1024 * 1024) return `${f.name} is ${sizeText(f.size)}; OpenLex reads files up to ${MAX_MB} MB. Split it into smaller files (for example one PDF per volume), or raise the limit in Settings.`
  return null
}

/** File → base64 (FileReader: native and fast, also for large PDFs). */
export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)) }
    r.onerror = () => reject(r.error || new Error('could not read the file'))
    r.readAsDataURL(file)
  })
}

/** Attach one file: the engine reads it on this computer. */
export async function attachFile(file: File, ctx: { matterId?: string | null; sessionId?: string | null }): Promise<Attachment> {
  const e = engine()
  if (!e) throw new Error('engine is not running')
  const data = await toBase64(file)
  const r = await e.call('POST', '/api/document/read', { name: file.name, data, matterId: ctx.matterId || undefined, sessionId: ctx.sessionId || undefined })
  if (!r?.attachment) throw new Error(r?.error || 'the file could not be read')
  return r.attachment as Attachment
}

/** One line under the chip: "34 pages · read in full by Claude (EU)". */
export function chipDetail(a: Attachment) {
  const parts = [a.pages ? `${a.pages} page${a.pages === 1 ? '' : 's'}` : '', a.ocrPages ? `${a.ocrPages} scanned (text recognised on this computer)` : '']
  return parts.filter(Boolean).join(' · ')
}

/**
 * Offer bytes from the engine as a file to save: the App's native save
 * dialog (preload saveFile), else the browser's download.
 * → { saved: path | null, cancelled }
 */
export async function download(name: string, mime: string, base64: string): Promise<{ saved: string | null; cancelled: boolean }> {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const native = typeof window !== 'undefined' ? (window as any).lexvault?.saveFile : null
  if (native) {
    const r = await native({ suggestedName: name, bytes: bytes.buffer })
    return { saved: r?.ok ? r.path : null, cancelled: !!r?.cancelled }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  return { saved: null, cancelled: false }
}

/** Where a quote sits in a text (whitespace and quote marks forgiven): [start, end] or null. */
export function findQuote(text: string, quote: string): [number, number] | null {
  const q = String(quote || '').replace(/\s+/g, ' ').trim()
  if (q.length < 8) return null
  const norm = (c: string) => (/[‘’‚‛]/.test(c) ? "'" : /[“”„‟«»]/.test(c) ? '"' : /[–—]/.test(c) ? '-' : c.toLowerCase())
  let flat = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (/\s/.test(c)) { if (!space && flat) { flat += ' '; map.push(i) } space = true; continue }
    space = false
    flat += norm(c)
    map.push(i)
  }
  const needle = Array.from(q.split(/\s*(?:\.\.\.|…)\s*/)[0]).map(norm).join('')
  const at = flat.indexOf(needle)
  if (at < 0) return null
  return [map[at], map[Math.min(at + needle.length - 1, map.length - 1)] + 1]
}
