// Export buttons for a chat tool's result (the same contract as the full
// analysis: the engine writes the file into the matter folder and hands its
// bytes back; the App's save dialog offers it too). Optional: "Save" keeps
// the result with the matter (Saved), "Send to Word" inserts text in Word.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bookmark, Check, Download, FileSpreadsheet, FileText, FolderOpen, Send } from 'lucide-react'
import { engine } from '../lib/commands'
import { download } from '../lib/attach'
import { friendly } from '../lib/turn'
import { useWordLink } from '../lib/hub'

export type Format = 'docx' | 'pdf' | 'csv' | 'xlsx' | 'md'
const LABEL: Record<Format, string> = { docx: 'Word', pdf: 'PDF', csv: 'CSV', xlsx: 'Excel', md: 'Markdown' }

export default function ExportButtons({ path, id, formats, save, wordText }: {
  /** e.g. /api/investigation/export */
  path: string
  id: string
  formats: Format[]
  /** Keep with the matter: the body for POST /api/saved. */
  save?: Record<string, unknown> | null
  /** Text for "Send to Word" (only when Word is connected). */
  wordText?: string | null
}) {
  const { t } = useTranslation()
  const word = useWordLink()
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ name: string; file: string; copy?: string | null } | null>(null)
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null)

  const exportAs = async (format: Format) => {
    setBusy(format)
    setNote(null)
    try {
      const r = await engine()!.call('POST', path, { id, format })
      const d = await download(r.name, r.mime, r.data)
      setDone({ name: r.name, file: r.file, copy: d.saved })
    } catch (err) { setNote({ text: friendly(err), ok: false }) } finally { setBusy(null) }
  }
  const keep = async () => {
    if (!save) return
    setBusy('save')
    try {
      await engine()!.call('POST', '/api/saved', save)
      setNote({ text: t('tools.savedWithMatter', 'Saved with the matter (Saved).'), ok: true })
    } catch (err) { setNote({ text: friendly(err), ok: false }) } finally { setBusy(null) }
  }
  const toWord = async () => {
    if (!wordText) return
    try { await word.sendToWord(wordText, { source: 'Draft' }); setNote({ text: t('tools.sentToWord', 'Sent to Word (inserted at the cursor).'), ok: true }) } catch (err) { setNote({ text: friendly(err), ok: false }) }
  }
  const reveal = () => { if (done) engine()?.call('POST', '/api/workspace/reveal', { path: done.file }).catch(() => {}) }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {formats.map((f) => (
          <button key={f} type="button" disabled={!!busy} onClick={() => exportAs(f)} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1" data-testid={`export-${f}`}>
            {f === 'csv' || f === 'xlsx' ? <FileSpreadsheet size={13} /> : f === 'docx' ? <FileText size={13} /> : <Download size={13} />} {busy === f ? '…' : LABEL[f]}
          </button>
        ))}
        {save && <button type="button" disabled={!!busy} onClick={keep} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1" data-testid="save-result"><Bookmark size={13} /> {t('tools.save', 'Save with the matter')}</button>}
        {wordText && word.connected && <button type="button" onClick={toWord} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><Send size={13} /> {t('tools.sendToWord', 'Send to Word')}</button>}
      </div>
      {done && (
        <div className="text-xs text-forest" role="status">
          <Check size={11} className="inline" /> {done.copy ? `${t('analysis.savedAt', 'Saved')}: ${done.copy} · ` : ''}{t('analysis.savedIn', 'Also saved in the matter folder')}: {done.name} <button type="button" onClick={reveal} className="underline text-antique hover:text-cream inline-flex items-center gap-1"><FolderOpen size={11} />{t('analysis.show', 'show')}</button>
        </div>
      )}
      {note && <div className={`text-xs ${note.ok ? 'text-forest' : 'text-red-400'}`} role="status">{note.ok ? '✓' : '✗'} {note.text}</div>}
    </div>
  )
}
