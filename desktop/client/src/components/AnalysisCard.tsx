// The full document analysis as a card in the chat (the old Upload page's
// analysis, now a chat tool on the OpenLex engine): at a glance, risks with
// their quote, place, law and a checked fix, deadlines, who has to do what,
// key terms, notable and possibly missing clauses, legal terms explained —
// and export buttons for Word, PDF and CSV. "Read the document" opens the
// attached document with every finding highlighted where it is.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronDown, ChevronUp, Download, FileSpreadsheet, FileText, FolderOpen, X } from 'lucide-react'
import { engine } from '../lib/commands'
import { download, findQuote } from '../lib/attach'
import { clip, friendly } from '../lib/turn'
import i18n, { languageName } from '../i18n'

type Level = 'high' | 'medium' | 'low'
const LEVEL_MARK: Record<Level, string> = { high: '!!', medium: '!', low: '·' }
const LEVEL_CLASS: Record<Level, string> = { high: 'text-red-400 border-red-400/50', medium: 'text-amber-400 border-amber-400/50', low: 'text-forest border-forest/50' }
const LEVEL_WORD: Record<Level, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' }
const levelWord = (l: Level) => i18n.t(`analysis.levelWord.${l}`, LEVEL_WORD[l])
const lv = (l: string) => i18n.t(`tools.level.${l}`, l)
const HIGHLIGHT: Record<string, string> = { high: 'bg-red-500/25', medium: 'bg-amber-500/25', low: 'bg-forest/25', date: 'bg-sky-500/20', other: 'bg-accent/20' }

function fixText(r: any) {
  if (r.fixCheck === 'removed') return { text: i18n.t('analysis.fixRemoved', 'No safe fix suggested — a second check rejected the first proposal. Decide how to handle this.'), mark: '!', ok: false }
  if (!r.fix) return null
  const how = r.fixCheck === 'checked' ? i18n.t('analysis.fixChecked', 'checked by a second pass') : r.fixCheck === 'corrected' ? i18n.t('analysis.fixCorrected', 'corrected by a second pass') : i18n.t('analysis.fixUnchecked', 'not double-checked')
  return { text: `${r.fix} (${how})`, mark: r.fixCheck === 'checked' || r.fixCheck === 'corrected' ? '✓' : '!', ok: r.fixCheck === 'checked' || r.fixCheck === 'corrected' }
}

function Section({ title, count, children, open: initial = false }: { title: string; count: number; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  if (!count) return null
  return (
    <div className="border-t border-tobacco/50 pt-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center justify-between text-sm text-parchment hover:text-cream">
        <span className="font-medium">{title} <span className="text-antique font-normal">({count})</span></span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  )
}

export default function AnalysisCard({ id, analysis: given }: { id?: string; analysis?: any }) {
  const { t } = useTranslation()
  const [a, setA] = useState<any>(given || null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ name: string; file: string; copy?: string | null } | null>(null)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    if (given || !id) return
    engine()?.call('GET', `/api/analysis?id=${encodeURIComponent(id)}`).then((r) => setA(r?.analysis || null)).catch((err) => setError(friendly(err)))
  }, [id, given])

  if (error) return <div className="text-xs text-antique">{t('analysis.gone', 'The analysis could not be opened')}: {error}</div>
  if (!a) return <div className="text-xs text-antique">{t('common.loading', 'Loading…')}</div>

  const s = a.summary || {}
  const st = a.stats || {}
  const overall = a.overall as { score: number; level: Level; explanation: string } | undefined

  const exportAs = async (format: 'docx' | 'pdf' | 'csv') => {
    setBusy(format)
    setError(null)
    try {
      const r = await engine()!.call('POST', '/api/analysis/export', { id: a.id, format })
      const d = await download(r.name, r.mime, r.data)
      setSaved({ name: r.name, file: r.file, copy: d.saved })
    } catch (err) { setError(friendly(err)) } finally { setBusy(null) }
  }
  const reveal = () => { if (saved) engine()?.call('POST', '/api/workspace/reveal', { path: saved.file }).catch(() => {}) }

  return (
    <div className="rounded-card border border-accent/40 bg-deep-brown/60 p-4 space-y-3 text-sm" data-testid="analysis-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-accent">{t('analysis.title', 'Document analysis')}</div>
          <div className="font-serif text-lg text-parchment truncate" title={a.document?.name}>{a.document?.name}</div>
          <div className="text-xs text-antique">
            {[s.type, a.document?.pages ? t('analysis.pages', '{{count}} pages', { count: a.document.pages }) : '', st.strategy ? (st.strategy.mode === 'full' ? t('analysis.readFull', 'read in full') : t('analysis.readParts', 'read in {{n}} parts', { n: st.parts })) : '', languageName(a.document?.language, a.document?.languageName)].filter(Boolean).join(' · ')}
          </div>
        </div>
        {overall && (
          <div className={`shrink-0 rounded-button border px-2.5 py-1 text-xs ${LEVEL_CLASS[overall.level]}`} title={overall.explanation}>
            <span aria-hidden="true">{LEVEL_MARK[overall.level]} </span>{t('analysis.overall', 'Overall risk')}: {lv(overall.level)} · {overall.score}/100
          </div>
        )}
      </div>

      {/* At a glance */}
      <div className="space-y-1 text-parchment/90">
        {s.what && <p>{s.what}</p>}
        {!!s.parties?.length && <p><span className="text-antique">{t('analysis.parties', 'Parties')}:</span> {s.parties.map((p: any) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('; ')}</p>}
        {s.purpose && <p><span className="text-antique">{t('analysis.purpose', 'Purpose')}:</span> {s.purpose}</p>}
        {s.governingLaw && <p><span className="text-antique">{t('analysis.law', 'Governing law')}:</span> {s.governingLaw}</p>}
        {!!s.keyPoints?.length && <ul className="list-disc ml-5 space-y-0.5">{s.keyPoints.map((k: string, i: number) => <li key={i}>{k}</li>)}</ul>}
      </div>

      {/* Risks: always shown, highest first */}
      <div className="border-t border-tobacco/50 pt-2">
        <div className="text-sm font-medium text-parchment mb-1">{t('analysis.risks', 'Risks')} <span className="text-antique font-normal">({t('analysis.riskCounts', '{{high}} high, {{medium}} medium, {{low}} low', { high: st.high || 0, medium: st.medium || 0, low: st.low || 0 })})</span></div>
        {!a.risks?.length && <div className="text-xs text-antique">{t('analysis.noRisks', 'No risks found.')}</div>}
        <ul className="space-y-2">
          {(a.risks || []).map((r: any) => {
            const fix = fixText(r)
            return (
              <li key={r.id} className={`border-l-2 pl-3 ${LEVEL_CLASS[r.level as Level]}`}>
                <div><span className="font-semibold text-xs uppercase">{levelWord(r.level as Level)}</span> <span className="text-parchment">{r.title}</span>{r.location?.text && <span className="text-antique text-xs"> · {r.location.text}</span>}</div>
                {r.why && <div className="text-xs text-parchment/80">{r.why}</div>}
                {fix && <div className={`text-xs ${fix.ok ? 'text-forest' : 'text-amber-400'}`}>{fix.mark} {t('analysis.fix', 'Suggested fix')}: <span className="text-parchment/90">{fix.text}</span></div>}
                <div className="text-xs text-antique italic">“{clip(r.quote, 220)}”</div>
                {(r.sources || []).map((x: any, i: number) => <div key={i} className="text-xs text-antique">{t('analysis.lawLabel', 'Law')}: {[x.title, x.section].filter(Boolean).join(' ')}{x.snippet ? ` — ${clip(x.snippet, 100)}` : ''}</div>)}
              </li>
            )
          })}
        </ul>
      </div>

      <Section title={t('analysis.deadlines', 'Deadlines and dates')} count={a.deadlines?.length || 0} open>
        <table className="w-full text-xs">
          <tbody>
            {a.deadlines.map((d: any, i: number) => (
              <tr key={i} className="align-top border-b border-tobacco/30">
                <td className="py-1 pr-2 whitespace-nowrap text-parchment">{d.date || `${d.when} (${t('analysis.period', 'period')})`}</td>
                <td className="py-1 pr-2 text-parchment/90">{d.what}</td>
                <td className="py-1 pr-2 text-antique">{lv(d.importance)}</td>
                <td className="py-1 text-antique">{d.location?.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t('analysis.obligations', 'Who has to do what')} count={a.obligations?.length || 0}>
        {[...new Set<string>(a.obligations.map((o: any) => o.party))].map((p) => (
          <div key={p}>
            <div className="text-xs font-medium text-parchment">{p}</div>
            <ul className="list-disc ml-5 text-xs text-parchment/90">{a.obligations.filter((o: any) => o.party === p).map((o: any, i: number) => <li key={i}>{o.duty}{o.location?.text ? <span className="text-antique"> ({o.location.text})</span> : null}</li>)}</ul>
          </div>
        ))}
      </Section>

      <Section title={t('analysis.terms', 'Key terms')} count={a.keyTerms?.length || 0}>
        <ul className="text-xs space-y-0.5">{a.keyTerms.map((k: any, i: number) => <li key={i}><span className="text-parchment">{k.term}:</span> <span className="text-parchment/90">{k.value || clip(k.quote, 120)}</span>{k.location?.text ? <span className="text-antique"> ({k.location.text})</span> : null}</li>)}</ul>
      </Section>

      <Section title={t('analysis.clauses', 'Notable and possibly missing clauses')} count={a.clauses?.length || 0}>
        <ul className="text-xs space-y-1">
          {a.clauses.map((c: any, i: number) => (
            <li key={i}>
              {c.kind === 'missing'
                ? <><span className="text-amber-400">{t('analysis.missing', 'Possibly missing')}{c.importance ? ` (${t(`analysis.importance.${c.importance}`, c.importance)})` : ''}:</span> <span className="text-parchment">{c.title}</span> <span className="text-antique">— {c.note} ({t('analysis.pleaseCheck', 'not found in the text — please check')})</span></>
                : <><span className="text-parchment">{c.title}</span>{c.note ? <span className="text-parchment/80"> — {c.note}</span> : null}{c.location?.text ? <span className="text-antique"> ({c.location.text})</span> : null}</>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('analysis.glossary', 'Legal terms in plain words')} count={a.glossary?.length || 0}>
        <ul className="text-xs space-y-0.5">{a.glossary.map((g: any, i: number) => <li key={i}><span className="text-parchment">{g.term}:</span> <span className="text-parchment/80">{g.explanation}</span></li>)}</ul>
      </Section>

      {/* How it was checked */}
      <div className="text-[11px] text-antique border-t border-tobacco/50 pt-2 space-y-0.5">
        <div>✓ {st.verified || 0} {t('analysis.verified', 'findings checked word for word against the document')}{st.dropped ? ` · ${st.dropped} ${t('analysis.dropped', 'removed because their quote was not in the document')}` : ''} · {st.lawSearches || 0} {t('analysis.lawSearches', 'law searches')}</div>
        {!!a.document?.ocrPages && <div>! {a.document.ocrPages} {t('analysis.ocr', 'pages were scans, read by text recognition on this computer — check quotes from them')}</div>}
        {a.readability?.avgSentenceWords ? <div>{t('analysis.readability', 'Readability')}: {t(`analysis.grade.${a.readability.grade}`, a.readability.grade)} ({a.readability.avgSentenceWords} {t('analysis.wordsPerSentence', 'words per sentence on average')})</div> : null}
        <div>{t('analysis.aiNote', 'Summaries and fixes are written by AI — check them before relying on them.')}</div>
      </div>

      {/* Exports */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" disabled={!!busy} onClick={() => exportAs('docx')} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><FileText size={13} /> {busy === 'docx' ? '…' : 'Word'}</button>
        <button type="button" disabled={!!busy} onClick={() => exportAs('pdf')} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><Download size={13} /> {busy === 'pdf' ? '…' : 'PDF'}</button>
        <button type="button" disabled={!!busy} onClick={() => exportAs('csv')} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><FileSpreadsheet size={13} /> {busy === 'csv' ? '…' : t('analysis.csv', 'CSV (Excel)')}</button>
        {a.document?.attachmentId && <button type="button" onClick={() => setReading(true)} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"><BookOpen size={13} /> {t('analysis.read', 'Read the document')}</button>}
      </div>
      {saved && (
        <div className="text-xs text-forest" role="status">
          ✓ {saved.copy ? `${t('analysis.savedAt', 'Saved')}: ${saved.copy} · ` : ''}{t('analysis.savedIn', 'Also saved in the matter folder')}: {saved.name} <button type="button" onClick={reveal} className="underline text-antique hover:text-cream inline-flex items-center gap-1"><FolderOpen size={11} />{t('analysis.show', 'show')}</button>
        </div>
      )}
      {reading && a.document?.attachmentId && <DocumentReader attachmentId={a.document.attachmentId} analysis={a} onClose={() => setReading(false)} />}
    </div>
  )
}

/** The attached document with every finding highlighted where its quote is (the old DocumentView). */
function DocumentReader({ attachmentId, analysis, onClose }: { attachmentId: string; analysis: any; onClose: () => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    engine()?.call('GET', `/api/document/attachment?id=${encodeURIComponent(attachmentId)}&limit=2000000`).then((r) => setText(r?.text || '')).catch((err) => setError(friendly(err)))
  }, [attachmentId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Findings with a place in the text, in document order, without overlaps.
  const marks = useMemo(() => {
    if (!text) return []
    const all: { start: number; end: number; kind: string; label: string }[] = []
    const add = (quote: string, kind: string, label: string) => { const at = findQuote(text, quote); if (at) all.push({ start: at[0], end: at[1], kind, label }) }
    for (const r of analysis.risks || []) add(r.quote, r.level, `${levelWord(r.level as Level)}: ${r.title}`)
    for (const d of analysis.deadlines || []) add(d.quote, 'date', `${d.date || d.when}: ${d.what}`)
    for (const o of analysis.obligations || []) add(o.quote, 'other', `${o.party}: ${o.duty}`)
    for (const c of analysis.clauses || []) if (c.quote) add(c.quote, 'other', c.title)
    all.sort((x, y) => x.start - y.start)
    const out: typeof all = []
    for (const m of all) if (!out.length || m.start >= out[out.length - 1].end) out.push(m)
    return out
  }, [text, analysis])

  useEffect(() => {
    if (focus === null) return
    boxRef.current?.querySelector(`[data-mark="${focus}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus])

  const pieces: React.ReactNode[] = []
  if (text) {
    let at = 0
    marks.forEach((m, i) => {
      if (m.start > at) pieces.push(text.slice(at, m.start))
      pieces.push(<mark key={i} data-mark={i} title={m.label} className={`${HIGHLIGHT[m.kind] || HIGHLIGHT.other} text-cream rounded-sm ${focus === i ? 'ring-1 ring-accent' : ''}`}>{text.slice(m.start, m.end)}</mark>)
      at = m.end
    })
    pieces.push(text.slice(at))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-6" role="dialog" aria-modal="true" aria-label={analysis.document?.name}>
      <div className="fixed inset-0 bg-ink/80" onClick={onClose} />
      <div className="relative flex w-full max-w-6xl rounded-card border border-tobacco bg-deep-brown shadow-2xl overflow-hidden">
        <aside className="w-72 shrink-0 border-r border-tobacco overflow-y-auto p-3 space-y-1">
          <div className="text-xs uppercase tracking-wide text-accent mb-2">{t('analysis.findings', 'Findings in the text')} ({marks.length})</div>
          {marks.map((m, i) => (
            <button key={i} type="button" onClick={() => setFocus(i)} className={`w-full text-left text-xs px-2 py-1 rounded ${focus === i ? 'bg-accent/15 text-cream' : 'text-parchment/90 hover:bg-leather'}`}>
              <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${HIGHLIGHT[m.kind] || HIGHLIGHT.other}`} />{clip(m.label, 80)}
            </button>
          ))}
        </aside>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-tobacco">
            <div className="text-parchment truncate">{analysis.document?.name}</div>
            <button type="button" onClick={onClose} className="text-antique hover:text-cream" aria-label={t('common.close', 'Close')}><X size={18} /></button>
          </div>
          <div ref={boxRef} className="flex-1 overflow-y-auto px-6 py-4 whitespace-pre-wrap text-sm leading-relaxed text-parchment/90 font-serif">
            {error ? <span className="text-red-400">{error}</span> : text === null ? t('common.loading', 'Loading…') : pieces}
          </div>
        </div>
      </div>
    </div>
  )
}
