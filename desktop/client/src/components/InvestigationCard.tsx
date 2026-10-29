// The investigation as a card in the chat (/investigate — the old
// Investigate page, now on the engine): the answer across the documents,
// what they share, where they differ, gaps; per document the quoted
// findings with place and law; what the check removed. Export Word, PDF, CSV.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { engine } from '../lib/commands'
import { clip, friendly } from '../lib/turn'
import ExportButtons from './ExportButtons'

const LEVEL_CLASS: Record<string, string> = { high: 'text-red-400 border-red-400/50', medium: 'text-amber-400 border-amber-400/50', low: 'text-forest border-forest/50' }

export function briefOf(x: any) {
  const c = x.comparison || {}
  return [`## ${x.question}`, c.answer || '', ...(c.conflicts || []).map((k: any) => `- ${k.topic}: ${k.detail}`)].join('\n\n')
}

export default function InvestigationCard({ id }: { id: string }) {
  const { t } = useTranslation()
  const [x, setX] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    engine()?.call('GET', `/api/investigation?id=${encodeURIComponent(id)}`).then((r) => setX(r.investigation)).catch((err) => setError(friendly(err)))
  }, [id])
  if (error) return <div className="text-xs text-antique">{t('tools.gone', 'The result could not be opened')}: {error}</div>
  if (!x) return <div className="text-xs text-antique">{t('common.loading', 'Loading…')}</div>
  const c = x.comparison
  const st = x.stats
  const kindWord = (k: string) => t(`investigation.kind.${k}`, k)
  const levelWord = (l: string) => t(`tools.level.${l}`, l)

  return (
    <div className="rounded-card border border-accent/40 bg-deep-brown/60 p-4 space-y-3 text-sm" data-testid="investigation-card">
      <div>
        <div className="text-xs uppercase tracking-wide text-accent">{t('investigation.title', 'Investigation')}</div>
        <div className="font-serif text-lg text-parchment">{x.question}</div>
        <div className="text-xs text-antique">{t('investigation.meta', '{{docs}} documents · {{relevant}} with something on the question', { docs: st.documents, relevant: st.relevant })}</div>
      </div>
      {c.answer && <p className="text-parchment/90 whitespace-pre-wrap">{c.answer}</p>}
      {c.favourable && <p className="text-parchment/80"><span className="text-antique">{t('investigation.favourable', 'More favourable or riskier')}:</span> {c.favourable}</p>}

      {(c.common.length > 0 || c.conflicts.length > 0 || c.gaps.length > 0) && (
        <div className="border-t border-tobacco/50 pt-2 space-y-2">
          {c.conflicts.length > 0 && <div><div className="text-xs font-medium text-amber-400">{t('investigation.conflicts', 'Where the documents differ')}</div>
            <ul className="list-disc ml-5 text-xs text-parchment/90">{c.conflicts.map((k: any, i: number) => <li key={i}><span className="text-parchment">{k.topic}:</span> {k.detail}{k.documents.length ? <span className="text-antique"> ({k.documents.join(', ')})</span> : null}</li>)}</ul></div>}
          {c.common.length > 0 && <div><div className="text-xs font-medium text-parchment">{t('investigation.common', 'What they share')}</div>
            <ul className="list-disc ml-5 text-xs text-parchment/90">{c.common.map((k: any, i: number) => <li key={i}>{k.point}{k.documents.length ? <span className="text-antique"> ({k.documents.join(', ')})</span> : null}</li>)}</ul></div>}
          {c.gaps.length > 0 && <div><div className="text-xs font-medium text-parchment">{t('investigation.gaps', 'Gaps')}</div>
            <ul className="list-disc ml-5 text-xs text-parchment/90">{c.gaps.map((k: any, i: number) => <li key={i}><span className="text-parchment">{k.topic}:</span> {k.detail}</li>)}</ul></div>}
        </div>
      )}

      <div className="border-t border-tobacco/50 pt-2 space-y-1">
        <div className="text-xs font-medium text-parchment">{t('investigation.perDocument', 'Per document')}</div>
        {x.documents.map((d: any, i: number) => (
          <div key={i}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full flex items-center gap-2 text-left text-xs text-parchment/90 hover:text-cream">
              <span className={d.relevant ? 'text-forest' : 'text-antique'}>{d.relevant ? '✓' : '–'}</span>
              <span className="flex-1 truncate">{d.name}{d.pages ? <span className="text-antique"> · {d.pages} p.</span> : null}{d.scan ? <span className="text-antique"> · {t('investigation.scanned', 'scanned: {{n}} of {{all}} sections read', { n: d.stats.selected ?? d.stats.sections, all: d.stats.sections })}</span> : null}</span>
              <span className="text-antique">{t('investigation.findingsCount', '{{n}} findings', { n: d.findings.length })}</span>
              {open === i ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {open === i && (
              <div className="ml-5 mt-1 mb-2 space-y-2">
                <p className="text-xs text-parchment/80">{d.relevant ? d.summary : t('investigation.notRelevant', 'Nothing in this document answers the question.')}</p>
                <ul className="space-y-1.5">
                  {d.findings.map((f: any) => (
                    <li key={f.id} className={`border-l-2 pl-3 ${LEVEL_CLASS[f.level] || ''}`}>
                      <div className="text-xs"><span className="uppercase font-semibold">{levelWord(f.level)}</span> · <span className="text-antique">{kindWord(f.kind)}</span> <span className="text-parchment">{f.title}</span>{f.location?.text ? <span className="text-antique"> · {f.location.text}</span> : null}</div>
                      {f.detail && <div className="text-xs text-parchment/80">{f.detail}</div>}
                      <div className="text-xs text-antique italic">“{clip(f.quote, 220)}”</div>
                      {(f.sources || []).map((s: any, j: number) => <div key={j} className="text-xs text-antique">{t('analysis.lawLabel', 'Law')}: {[s.title, s.section].filter(Boolean).join(' ')}{s.snippet ? ` — ${clip(s.snippet, 100)}` : ''}</div>)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="text-[11px] text-antique border-t border-tobacco/50 pt-2 space-y-0.5">
        <div>✓ {t('investigation.checked', '{{verified}} findings checked word for word against their document', { verified: st.verified })}{st.dropped ? ` · ${t('investigation.dropped', '{{n}} removed because their quote was not in the document', { n: st.dropped })}` : ''} · {t('investigation.lawSearches', '{{n}} law searches', { n: st.lawSearches })}</div>
        <div>✓ {t('investigation.judge', 'The comparison was checked against the quotes: {{checked}} statements, {{removed}} removed.', { checked: st.checked, removed: st.removed })}</div>
        {x.removed.map((r: any, i: number) => <div key={i} className="text-amber-400">– {t('investigation.removedLine', 'Removed')}: {r.text}{r.note ? ` (${r.note})` : ''}</div>)}
        {x.skipped.map((s: any, i: number) => <div key={i} className="text-amber-400">! {t('investigation.notRead', 'Not read')}: {s.name}{s.note ? ` — ${s.note}` : ''}</div>)}
        <div>{t('analysis.aiNote', 'Summaries and fixes are written by AI — check them before relying on them.')}</div>
      </div>
      <ExportButtons path="/api/investigation/export" id={x.id} formats={['docx', 'pdf', 'csv']}
        save={{ matterId: x.matterId, kind: 'investigation', title: x.question.slice(0, 160), content: briefOf(x), source: { kind: 'investigation', id: x.id } }} />
    </div>
  )
}
