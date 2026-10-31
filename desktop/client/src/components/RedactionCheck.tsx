// The redaction check ("Schwärzen mit Prüfung"): before a question or a
// document goes to an online AI service, the lawyer sees what OpenLex will
// hide — the text with the findings marked, grouped (people, organisations,
// addresses, IDs and numbers, contact, other). Each can be unticked; any
// selected text can be added ("also hide this", for the whole matter); a
// preview shows what the AI will see. Long documents: a findings list with
// jump-to, and the text around the chosen place. Several documents (a batch):
// one check for all, with a list of the documents.
//
// The engine finds and decides (POST /api/redaction/check | confirm | cancel);
// this window only shows and collects the lawyer's choices.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Plus, ShieldCheck, X } from 'lucide-react'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'

export interface CheckFinding { key: string; kind: string; group: string; start: number; end: number; on: boolean; confidence: number; source: string }
export interface CheckItem { id: string; name: string; chars: number; truncated: boolean; detection?: 'model' | 'basic'; text: string; findings: CheckFinding[] }
export interface CheckEntry { key: string; kind: string; group: string; text: string; label: string; confidence: number; sources: string[]; on: boolean; count: number; at: { item: string; start: number; end: number }[] }
export interface CheckReview { id: string; matterId: string | null; basic: boolean; detection?: 'basic' | 'with-model'; finder?: 'used' | 'failed' | 'not-installed' | 'unavailable'; runtime?: 'not-bundled' | 'load-failed' | null; items: CheckItem[]; entries: CheckEntry[]; groups: string[] }

const WINDOW = 12000 // characters of a long document shown around the chosen place
const LONG = 40000

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Ask the engine whether a check is due; resolves undefined (none due), the check id, or null (cancelled). */
export async function runRedactionCheck(body: Record<string, unknown>, show: (review: CheckReview) => Promise<string | null>, lang: string, onScanning?: (on: boolean) => void): Promise<string | null | undefined> {
  const e = engine()
  if (!e) return undefined
  onScanning?.(true)
  let r: any
  try { r = await e.call('POST', '/api/redaction/check', { ...body, lang }) } finally { onScanning?.(false) }
  if (!r?.needed || !r.review) return undefined
  return show(r.review)
}

export default function RedactionCheck({ review, onDone }: { review: CheckReview; onDone: (id: string | null) => void }) {
  const { t } = useTranslation()
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(review.entries.map((x) => [x.key, x.on])))
  const [added, setAdded] = useState<{ key: string; text: string }[]>([])
  // Start with the text that has the most to check (usually the document, not the question).
  const [item, setItem] = useState(() => [...review.items].sort((a, b) => b.findings.length - a.findings.length)[0]?.id || '')
  const [focus, setFocus] = useState<{ start: number; end: number } | null>(null)
  const [hops, setHops] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState(false)
  const [sel, setSel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const textRef = useRef<HTMLDivElement>(null)

  const GROUPS: Record<string, string> = {
    people: t('redaction.groups.people', 'People'), orgs: t('redaction.groups.orgs', 'Organisations'), addresses: t('redaction.groups.addresses', 'Addresses'),
    ids: t('redaction.groups.ids', 'IDs & numbers'), contact: t('redaction.groups.contact', 'Contact'), other: t('redaction.groups.other', 'Other'),
  }
  const cur = review.items.find((x) => x.id === item) || review.items[0]
  const entryOf = useMemo(() => new Map(review.entries.map((x) => [x.key, x])), [review])

  // Places of the texts the lawyer added, in every document (case-insensitive).
  const addedAt = useMemo(() => {
    const out: Record<string, { key: string; start: number; end: number }[]> = {}
    // Whole words only, like the engine ("Käufer" is not hidden inside "Verkäuferin").
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    for (const it of review.items) {
      out[it.id] = []
      for (const a of added) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(a.text)}(?![\\p{L}\\p{N}])`, 'giu')
        for (const m of it.text.matchAll(re)) { if (out[it.id].length >= 2000) break; out[it.id].push({ key: a.key, start: m.index!, end: m.index! + m[0].length }) }
      }
    }
    return out
  }, [added, review])

  const marks = useMemo(() => {
    if (!cur) return []
    const list = [...cur.findings.map((f) => ({ key: f.key, start: f.start, end: f.end, kind: f.kind })), ...(addedAt[cur.id] || []).map((a) => ({ ...a, kind: 'OTHER' }))]
      .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
    const out: typeof list = []
    for (const m of list) if (!out.length || m.start >= out[out.length - 1].end) out.push(m)
    return out
  }, [cur, addedAt])

  const isOn = (key: string) => (key.startsWith('add:') ? true : !!on[key])
  const long = (cur?.text.length || 0) > LONG
  const anchor = focus?.start ?? 0
  const from = long ? Math.max(0, Math.min(anchor - WINDOW / 3, (cur?.text.length || 0) - WINDOW)) : 0
  const to = long ? Math.min(cur?.text.length || 0, from + WINDOW) : (cur?.text.length || 0)

  useEffect(() => {
    if (!focus) return
    const el = textRef.current?.querySelector('[data-focus="1"]') as HTMLElement | null
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus, item])

  const jump = (x: CheckEntry) => {
    if (!x.at.length) return
    const n = (hops[x.key] || 0) % x.at.length
    const p = x.at[n]
    setHops((h) => ({ ...h, [x.key]: n + 1 }))
    setItem(p.item)
    setFocus({ start: p.start, end: p.end })
  }

  const allKind = (kind: string, value: boolean) => setOn((cur) => ({ ...cur, ...Object.fromEntries(review.entries.filter((x) => x.kind === kind).map((x) => [x.key, value])) }))
  const allGroup = (group: string, value: boolean) => setOn((cur) => ({ ...cur, ...Object.fromEntries(review.entries.filter((x) => x.group === group).map((x) => [x.key, value])) }))

  const onSelect = () => {
    const s = window.getSelection()?.toString() || ''
    const v = s.replace(/\s+/g, ' ').trim()
    setSel(v.length >= 2 && v.length <= 200 ? v : '')
  }
  const addSel = () => {
    if (!sel) return
    const existing = review.entries.find((x) => norm(x.text) === norm(sel))
    if (existing) setOn((c) => ({ ...c, [existing.key]: true }))
    else if (!added.some((a) => norm(a.text) === norm(sel))) setAdded((a) => [...a, { key: `add:${norm(sel)}`, text: sel }])
    setSel('')
    window.getSelection()?.removeAllRanges()
  }

  const hiddenCount = review.entries.filter((x) => on[x.key]).length + added.length
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const off = review.entries.filter((x) => x.on && !on[x.key]).map((x) => x.key)
      const ticked = review.entries.filter((x) => !x.on && on[x.key]).map((x) => x.key)
      await engine()!.call('POST', '/api/redaction/confirm', { id: review.id, off, on: ticked, add: added.map((a) => ({ text: a.text, kind: 'OTHER' })) })
      onDone(review.id)
    } catch (err) { setError(friendly(err)); setBusy(false) }
  }
  const cancel = async () => {
    try { await engine()?.call('POST', '/api/redaction/cancel', { id: review.id }) } catch { /* the check expires anyway */ }
    onDone(null)
  }

  // Placeholder words for the preview (the engine numbers them; the kind is what matters here).
  const PH: Record<string, string> = { PERSON: 'PERSON', PARTY: 'NAME', ORG: 'ORG', ADDRESS: 'ADDRESS', EMAIL: 'EMAIL', PHONE: 'PHONE', IBAN: 'IBAN', BIC: 'BIC', CARD: 'CARD', ID: 'ID', TAXID: 'TAXID', REGNO: 'REGNO', CASENO: 'CASENO', DATE: 'DATE', OTHER: 'OTHER' }
  const renderText = () => {
    if (!cur) return null
    const parts: JSX.Element[] = []
    let at = from
    let i = 0
    for (const m of marks) {
      if (m.end <= from || m.start >= to) continue
      if (m.start > at) parts.push(<span key={`t${i++}`}>{cur.text.slice(at, m.start)}</span>)
      const hidden = isOn(m.key)
      const e = entryOf.get(m.key)
      const isFocus = !!focus && focus.start === m.start && focus.end === m.end
      const label = e ? `${e.label}${e.confidence < 0.7 ? ` · ${t('redaction.unsure', 'not sure')}` : ''}` : t('redaction.addedByYou', 'Added by you')
      parts.push(preview && hidden
        ? <mark key={`m${i++}`} className="rounded px-0.5 bg-leather text-antique font-mono text-[12px]" title={label}>[[{PH[m.kind] || 'NAME'}]]</mark>
        : (
          <mark key={`m${i++}`} data-focus={isFocus ? '1' : undefined} title={label}
            onClick={() => { if (!m.key.startsWith('add:')) setOn((c) => ({ ...c, [m.key]: !c[m.key] })) }}
            className={`rounded px-0.5 cursor-pointer ${hidden ? 'bg-accent/30 text-parchment' : 'bg-transparent text-cream underline decoration-dotted decoration-antique'} ${isFocus ? 'ring-2 ring-accent' : ''}`}>
            {cur.text.slice(m.start, m.end)}
          </mark>
        ))
      at = m.end
    }
    if (at < to) parts.push(<span key={`t${i++}`}>{cur.text.slice(at, to)}</span>)
    return parts
  }

  const groups = review.groups.filter((g) => review.entries.some((x) => x.group === g) || (g === 'other' && added.length))
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-[4vh]" data-testid="redaction-check">
      <div className="fixed inset-0 bg-ink/70" onClick={cancel} />
      <div role="dialog" aria-modal="true" aria-label={t('redaction.title', 'Check what is hidden before sending')} className="relative w-full max-w-5xl rounded-card border border-tobacco bg-deep-brown shadow-2xl animate-fade-in flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-tobacco">
          <div>
            <h2 className="font-serif text-lg text-parchment inline-flex items-center gap-2"><ShieldCheck size={18} className="text-accent" /> {t('redaction.title', 'Check what is hidden before sending')}</h2>
            <p className="text-xs text-antique mt-1 max-w-3xl" data-testid="redaction-note">{t('redaction.note', 'OpenLex looks for names, numbers and addresses and hides what it finds. It can miss things, especially indirect details (a rare job title, a unique event). Please check before sending. Hidden text is replaced on your computer and restored in the answer.')}</p>
            {/* "basic" unless the name finder really ran for every text of this check (the engine records it per run). */}
            {review.basic
              ? <p className="text-xs text-antique mt-1" data-testid="redaction-basic">{
                review.finder === 'failed' ? t('redaction.basicFailed', 'Basic detection: the name finder is installed but did not run for this text, so only patterns, your matter\'s list, titles and company forms were used.')
                  : review.finder === 'unavailable' ? (review.runtime === 'not-bundled'
                    ? t('redaction.basicNeedsApp', 'Basic detection: patterns, your matter\'s list, titles and company forms. The name finder needs the desktop app.')
                    : t('redaction.basicCannotRun', 'Basic detection: patterns, your matter\'s list, titles and company forms. The name finder cannot run on this computer.'))
                    : t('redaction.basic', 'Basic detection: patterns, your matter\'s list, titles and company forms. The optional name finder (Settings) also finds names without a title.')}</p>
              : <p className="text-xs text-antique mt-1" data-testid="redaction-with-model">{t('redaction.withModel', 'With name finder: names, organisations and addresses without a title or company form were looked for too (on this computer).')}</p>}
          </div>
          <button type="button" onClick={cancel} className="text-antique hover:text-cream" aria-label={t('common.close', 'Close')}><X size={18} /></button>
        </div>

        <div className="flex-1 min-h-0 grid md:grid-cols-[minmax(240px,320px)_1fr]">
          {/* The findings, grouped */}
          <div className="border-b md:border-b-0 md:border-r border-tobacco overflow-y-auto p-3 space-y-3 max-h-[34vh] md:max-h-none" data-testid="redaction-list">
            {!review.entries.length && !added.length && <p className="text-sm text-antique">{t('redaction.none', 'OpenLex found nothing to hide. Select text on the right to hide it, or send as it is.')}</p>}
            {groups.map((g) => {
              const list = review.entries.filter((x) => x.group === g)
              return (
                <section key={g} aria-label={GROUPS[g]}>
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-antique mb-1">
                    <span>{GROUPS[g]} <span className="normal-case">({list.length + (g === 'other' ? added.length : 0)})</span></span>
                    {!!list.length && <span className="normal-case space-x-2">
                      <button type="button" className="hover:text-cream underline" onClick={() => allGroup(g, true)}>{t('redaction.hideAll', 'Hide all')}</button>
                      <button type="button" className="hover:text-cream underline" onClick={() => allGroup(g, false)}>{t('redaction.hideNone', 'None')}</button>
                    </span>}
                  </div>
                  <ul className="space-y-0.5">
                    {list.map((x) => (
                      <li key={x.key} className="group flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!on[x.key]} onChange={(ev) => setOn((c) => ({ ...c, [x.key]: ev.target.checked }))} aria-label={`${t('redaction.hide', 'Hide')} ${x.text}`} />
                        <button type="button" onClick={() => jump(x)} className={`flex-1 min-w-0 text-left truncate ${on[x.key] ? 'text-parchment' : 'text-antique line-through decoration-antique/60'}`} title={`${x.label} · ${t('redaction.jump', 'show where')}`}>
                          {x.text}
                        </button>
                        {x.count > 1 && <span className="text-[11px] text-antique">×{x.count}</span>}
                        <span className={`h-1.5 w-1.5 rounded-full ${x.confidence >= 0.85 ? 'bg-accent' : x.confidence >= 0.5 ? 'bg-accent/50' : 'bg-antique/40'}`} title={x.confidence >= 0.85 ? t('redaction.sure', 'likely') : x.confidence >= 0.5 ? t('redaction.maybe', 'possible') : t('redaction.unsure', 'not sure')} aria-hidden="true" />
                        <button type="button" onClick={() => allKind(x.kind, true)} className="hidden group-hover:inline text-[11px] text-antique hover:text-cream underline" title={x.label}>{t('redaction.allLikeThis', 'Hide all like this')}</button>
                      </li>
                    ))}
                    {g === 'other' && added.map((a) => (
                      <li key={a.key} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked onChange={() => setAdded((l) => l.filter((y) => y.key !== a.key))} aria-label={`${t('redaction.hide', 'Hide')} ${a.text}`} />
                        <span className="flex-1 truncate text-parchment">{a.text}</span>
                        <span className="text-[11px] text-antique">{t('redaction.addedByYou', 'Added by you')}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>

          {/* The text (or the part around the chosen place), with the findings marked */}
          <div className="flex flex-col min-h-0">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-tobacco text-xs">
              {review.items.length > 1
                ? <select className="input !py-1 !px-2 text-xs max-w-[50%]" value={cur?.id} onChange={(e) => { setItem(e.target.value); setFocus(null) }} aria-label={t('redaction.document', 'Document')} data-testid="redaction-docs">
                    {review.items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.findings.filter((f) => isOn(f.key)).length})</option>)}
                  </select>
                : <span className="text-cream truncate">{cur?.name}</span>}
              <button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex items-center gap-1 text-antique hover:text-cream" aria-pressed={preview} data-testid="redaction-preview">
                {preview ? <EyeOff size={14} /> : <Eye size={14} />} {preview ? t('redaction.showText', 'Show my text') : t('redaction.preview', 'What the AI will see')}
              </button>
              {long && <span className="text-antique">{t('redaction.longDoc', 'Long document: showing the part around the chosen place')}
                <button type="button" className="ml-1 align-middle hover:text-cream" aria-label={t('redaction.earlier', 'Earlier part')} onClick={() => setFocus({ start: Math.max(0, from - WINDOW / 2), end: Math.max(0, from - WINDOW / 2) })}><ChevronLeft size={14} /></button>
                <button type="button" className="align-middle hover:text-cream" aria-label={t('redaction.later', 'Later part')} onClick={() => setFocus({ start: to + WINDOW / 3, end: to + WINDOW / 3 })}><ChevronRight size={14} /></button>
              </span>}
              {cur?.truncated && <span className="text-antique">{t('redaction.truncated', 'Only the beginning is shown here; the rest is checked by the same rules.')}</span>}
              {sel && !preview && <button type="button" onClick={addSel} className="ml-auto btn-secondary !px-2 !py-1 text-xs inline-flex items-center gap-1" data-testid="redaction-add"><Plus size={12} /> {t('redaction.alsoHide', 'Also hide “{{text}}”', { text: sel.length > 40 ? `${sel.slice(0, 39)}…` : sel })}</button>}
            </div>
            <div ref={textRef} onMouseUp={onSelect} onKeyUp={onSelect} className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed text-cream whitespace-pre-wrap font-serif min-h-[30vh]" data-testid="redaction-text">
              {long && from > 0 && <span className="text-antique">…</span>}
              {renderText()}
              {long && to < (cur?.text.length || 0) && <span className="text-antique">…</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-tobacco">
          <span className="text-xs text-antique">{review.matterId ? t('redaction.summary', '{{n}} to hide · your choices are remembered for this matter', { n: hiddenCount }) : t('redaction.summaryNoMatter', '{{n}} to hide', { n: hiddenCount })}</span>
          {error && <span className="text-xs text-red-400">{error}</span>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary !px-4 !py-2 text-sm" onClick={cancel} disabled={busy}>{t('common.cancel', 'Cancel')}</button>
            <button type="button" className="btn-primary !px-4 !py-2 text-sm" onClick={send} disabled={busy} data-testid="redaction-send">{t('redaction.send', 'Send with these hidden')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
