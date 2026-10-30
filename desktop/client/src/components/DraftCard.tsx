// A draft as a card in the chat (/draft — the old Workshop, now on the
// engine). The text is shown in a field: select a passage to work on just
// that, or nothing for the whole draft.
//   Change   an instruction ("make the notice period three months") → before/after, Undo
//   Ideas    3–5 improvements, each usable as the instruction
//   Check    the passage against the law found on this computer (+ a second check)
//   Fill-ins names, dates, amounts … to replace everywhere (contract → template)
//   Versions every change is kept; any earlier version comes back
// Export Word, PDF, Markdown; Send to Word; Save with the matter.
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from './Markdown'
import { useTranslation } from 'react-i18next'
import { History, Lightbulb, ListChecks, Scale, Undo2, Wand2 } from 'lucide-react'
import { engine } from '../lib/commands'
import { clip, friendly } from '../lib/turn'
import ExportButtons from './ExportButtons'

const JURISDICTIONS = ['AT', 'DE', 'CH', 'EU', 'SK', 'CZ', 'RO', 'FR', 'GR', 'CY', 'EW', 'US']
const current = (d: any) => d.versions[d.versions.length - 1]

export default function DraftCard({ id }: { id: string }) {
  const { t } = useTranslation()
  const [d, setD] = useState<any>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [passage, setPassage] = useState('')
  const [change, setChange] = useState<{ before: string; after: string; whole: boolean } | null>(null)
  const [ideas, setIdeas] = useState<string[] | null>(null)
  const [jur, setJur] = useState('AT')
  const [check, setCheck] = useState<any>(null)
  const [fills, setFills] = useState<Record<string, string>>({})
  const [panel, setPanel] = useState<'fill' | 'versions' | null>(null)
  const [editing, setEditing] = useState(false) // read as formatted text first; Edit shows the plain text
  const area = useRef<HTMLTextAreaElement>(null)

  const show = useCallback((draft: any) => { setD(draft); setText(current(draft).text) }, [])
  useEffect(() => {
    engine()?.call('GET', `/api/draft?id=${encodeURIComponent(id)}`).then((r) => show(r.draft)).catch((err) => setError(friendly(err)))
  }, [id, show])

  const call = async (what: string, path: string, body: Record<string, unknown>) => {
    setBusy(what)
    setError(null)
    try { return await engine()!.call('POST', path, { id, ...body }) } catch (err) { setError(friendly(err)); return null } finally { setBusy(null) }
  }
  const onSelect = () => {
    const el = area.current
    if (!el) return
    const s = el.value.slice(el.selectionStart, el.selectionEnd)
    setPassage(s.trim().length >= 3 ? s : '')
  }

  if (!d) return error ? <div className="text-xs text-antique">{t('tools.gone', 'The result could not be opened')}: {error}</div> : <div className="text-xs text-antique">{t('draft.writing', 'Loading the draft…')}</div>
  const v = current(d)
  const dirty = text !== v.text

  const revise = async () => {
    if (!instruction.trim()) return
    const r = await call('revise', '/api/draft/revise', { instruction, section: passage })
    if (r) { show(r.draft); setChange({ before: r.before, after: r.after, whole: r.whole }); setPassage(''); setInstruction('') }
  }
  const undo = async () => {
    const prev = d.versions[d.versions.length - 2]
    if (!prev) return
    const r = await call('undo', '/api/draft/restore', { n: prev.n })
    if (r) { show(r.draft); setChange(null) }
  }
  const suggest = async () => { const r = await call('ideas', '/api/draft/suggest', { section: passage }); if (r) setIdeas(r.suggestions) }
  const runCheck = async () => { const r = await call('check', '/api/draft/check', { section: passage, jurisdiction: jur }); if (r) { show(r.draft); setCheck(r.check) } }
  const findFills = async () => { setPanel('fill'); if (!d.variables) { const r = await call('fill', '/api/draft/variables', {}); if (r) show(r.draft) } }
  const fillIn = async () => { const r = await call('fill', '/api/draft/fill', { values: fills }); if (r) { show(r.draft); setFills({}) } }
  const saveEdit = async () => { const r = await call('edit', '/api/draft/edit', { text }); if (r) show(r.draft) }
  const restore = async (n: number) => { const r = await call('restore', '/api/draft/restore', { n }); if (r) { show(r.draft); setPanel(null) } }
  const statusWord = (s: string) => String(t(`draft.status.${s}`, ({ supported: 'consistent with the law found', issue: 'possible issue', no_match: 'no matching law found' } as any)[s] || s))

  return (
    <div className="rounded-card border border-accent/40 bg-deep-brown/60 p-4 space-y-3 text-sm" data-testid="draft-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-accent">{t('draft.title', 'Draft')}</div>
          <div className="font-serif text-lg text-parchment truncate">{d.title}</div>
          <div className="text-xs text-antique">{t('draft.version', 'Version {{n}}', { n: v.n })}{v.note ? ` · ${v.note}` : ''}{d.sources?.length ? ` · ${t('draft.from', 'using {{names}}', { names: d.sources.map((s: any) => s.name).join(', ') })}` : ''}</div>
        </div>
        <button type="button" onClick={() => setPanel(panel === 'versions' ? null : 'versions')} className="btn-secondary !px-2.5 !py-1 text-xs inline-flex items-center gap-1 shrink-0"><History size={12} /> {t('draft.versions', 'Versions')} ({d.versions.length})</button>
      </div>

      {panel === 'versions' && (
        <ul className="text-xs space-y-0.5 border border-tobacco/50 rounded p-2">
          {[...d.versions].reverse().map((x: any) => (
            <li key={x.n} className="flex items-center gap-2">
              <span className="text-antique tabular-nums w-6">{x.n}</span>
              <span className="flex-1 text-parchment/90 truncate">{x.note || '—'} <span className="text-antique">· {new Date(x.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></span>
              {x.n !== v.n && <button type="button" disabled={!!busy} onClick={() => restore(x.n)} className="underline text-antique hover:text-cream">{t('draft.restore', 'bring back')}</button>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing(!editing)} className="text-xs text-antique underline hover:text-cream px-1 py-1" data-testid="draft-edit-toggle">
          {editing ? t('draft.read', 'Show as formatted text') : t('draft.edit', 'Edit the text')}
        </button>
      </div>
      {editing || dirty ? (
        <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} onSelect={onSelect} onMouseUp={onSelect} onKeyUp={onSelect}
          className="input w-full font-serif text-sm leading-relaxed min-h-[260px] max-h-[60vh]" aria-label={t('draft.text', 'The draft')} data-testid="draft-text" />
      ) : (
        <div className="prose-custom max-w-none font-serif rounded-button border border-tobacco bg-deep-brown px-4 py-3 max-h-[60vh] overflow-y-auto" data-testid="draft-text" onDoubleClick={() => setEditing(true)} title={t('draft.editHint', 'Double-click to edit')}>
          <Markdown>{text}</Markdown>
        </div>
      )}
      {dirty && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-amber-400">{t('draft.unsaved', 'Your edits are not kept yet.')}</span>
          <button type="button" disabled={!!busy} onClick={saveEdit} className="btn-primary !px-3 !py-1 text-xs">{t('draft.keepEdits', 'Keep my edits (new version)')}</button>
          <button type="button" onClick={() => setText(v.text)} className="underline text-antique">{t('draft.discard', 'discard')}</button>
        </div>
      )}

      <div className="space-y-2 border-t border-tobacco/50 pt-2">
        <div className="text-xs text-antique">{passage ? <>{t('draft.passage', 'Working on the selected passage')}: <span className="text-parchment italic">“{clip(passage, 120)}”</span> <button type="button" className="underline" onClick={() => setPassage('')}>{t('draft.wholeInstead', 'use the whole draft')}</button></> : t('draft.whole', 'Working on the whole draft — select a passage above to work on just that.')}</div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); revise() }}>
          <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('draft.instruction', 'What to change, e.g. "make the notice period three months"')} className="input flex-1 !py-1.5 text-sm" data-testid="draft-instruction" />
          <button type="submit" disabled={!!busy || !instruction.trim() || dirty} className="btn-primary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><Wand2 size={13} /> {busy === 'revise' ? '…' : t('draft.change', 'Change')}</button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!!busy || dirty} onClick={suggest} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><Lightbulb size={13} /> {busy === 'ideas' ? '…' : t('draft.ideas', 'Ideas to improve it')}</button>
          <span className="inline-flex items-center gap-1">
            <button type="button" disabled={!!busy || dirty} onClick={runCheck} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><Scale size={13} /> {busy === 'check' ? '…' : t('draft.check', 'Check against the law')}</button>
            <select value={jur} onChange={(e) => setJur(e.target.value)} className="input !py-1 !px-1.5 text-xs w-auto" aria-label={t('draft.jurisdiction', 'Jurisdiction')}>{JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}</select>
          </span>
          <button type="button" disabled={!!busy || dirty} onClick={findFills} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><ListChecks size={13} /> {busy === 'fill' ? '…' : t('draft.fillins', 'Fill-ins (make a template)')}</button>
        </div>
      </div>

      {change && (
        <div className="rounded border border-tobacco/60 p-2 space-y-1 text-xs" data-testid="draft-change">
          <div className="text-antique">{change.whole ? t('draft.changedWhole', 'The whole draft was changed.') : t('draft.changed', 'Changed:')}</div>
          {!change.whole && <><div className="line-through text-red-400/80 whitespace-pre-wrap">{clip(change.before, 800)}</div><div className="text-forest whitespace-pre-wrap">{clip(change.after, 800)}</div></>}
          <button type="button" disabled={!!busy} onClick={undo} className="underline text-antique inline-flex items-center gap-1"><Undo2 size={11} /> {t('draft.undo', 'Undo')}</button>
        </div>
      )}
      {ideas && (
        <div className="text-xs space-y-0.5">
          <div className="text-antique">{t('draft.ideasHint', 'Click one to use it as the instruction:')}</div>
          {ideas.map((s, i) => <button key={i} type="button" onClick={() => setInstruction(s)} className="block text-left text-parchment/90 hover:text-accent">› {s}</button>)}
          {!ideas.length && <div className="text-antique">{t('draft.noIdeas', 'No ideas this time.')}</div>}
        </div>
      )}
      {check && (
        <div className={`rounded border p-2 text-xs space-y-1 ${check.status === 'issue' ? 'border-amber-400/50' : 'border-tobacco/60'}`} data-testid="draft-check">
          <div><span className={check.status === 'issue' ? 'text-amber-400 font-medium' : check.status === 'supported' ? 'text-forest font-medium' : 'text-antique'}>{statusWord(check.status)}</span>{check.jurisdiction ? <span className="text-antique"> · {check.jurisdiction}</span> : null}</div>
          {check.explanation && <div className="text-parchment/90">{check.explanation}</div>}
          {check.judge && <div className={check.judge.unlawful ? 'text-red-400' : 'text-antique'}>{check.judge.unlawful ? t('draft.unlawful', 'Second check: may be void or unlawful ({{sev}})', { sev: check.judge.severity }) : t('draft.lawful', 'Second check: no sign that it is unlawful')}{check.judge.note ? ` — ${check.judge.note}` : ''}</div>}
          {(check.sources || []).map((s: any, i: number) => <div key={i} className="text-antique">{t('analysis.lawLabel', 'Law')}: {[s.title, s.section].filter(Boolean).join(' ')}{s.snippet ? ` — ${clip(s.snippet, 100)}` : ''}</div>)}
          {!check.web && <div className="text-antique/80">{t('draft.webOff', 'Only the law on this computer was searched (online sources are off for this matter).')}</div>}
        </div>
      )}
      {panel === 'fill' && (
        <div className="rounded border border-tobacco/60 p-2 text-xs space-y-1" data-testid="draft-fillins">
          {!d.variables ? <div className="text-antique">{t('draft.findingFillins', 'Finding names, dates and amounts…')}</div> : !d.variables.length ? <div className="text-antique">{t('draft.noFillins', 'No fill-ins found.')}</div> : (
            <>
              <div className="text-antique">{t('draft.fillHint', 'Type the new value; every occurrence is replaced. Use [BRACKETS] to make a template.')}</div>
              {d.variables.map((x: any) => (
                <label key={x.value} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 text-parchment/90 truncate" title={x.value}>{x.name} <span className="text-antique">×{x.occurrences}</span></span>
                  <span className="w-48 shrink-0 text-antique truncate" title={x.value}>{x.value}</span>
                  <input value={fills[x.value] || ''} onChange={(e) => setFills((f) => ({ ...f, [x.value]: e.target.value }))} className="input flex-1 !py-1 text-xs" placeholder={x.placeholder ? '' : `[${x.name.toUpperCase()}]`} />
                </label>
              ))}
              <button type="button" disabled={!!busy || !Object.values(fills).some((x) => x.trim())} onClick={fillIn} className="btn-primary !px-3 !py-1 text-xs">{t('draft.fillIn', 'Fill in')}</button>
            </>
          )}
        </div>
      )}
      {error && <div className="text-xs text-red-400">✗ {error}</div>}
      <div className="text-[11px] text-antique">{t('draft.aiNote', 'Written by AI — read it in full before you use it. No statutes are cited from memory.')}</div>
      <ExportButtons path="/api/draft/export" id={d.id} formats={['docx', 'pdf', 'md']} wordText={v.text}
        save={{ matterId: d.matterId, kind: 'draft', title: d.title, content: v.text, source: { kind: 'draft', id: d.id } }} />
    </div>
  )
}
