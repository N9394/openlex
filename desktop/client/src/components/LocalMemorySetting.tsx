// "Memory for the local AI" (engine: GET/POST /api/config/local-memory,
// sidecar/src/local_memory.js): how much of this computer's memory the AI
// that runs on it may use, and so how much of a long document it reads at
// once. Plain words for the trade-off; automatic by default.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu } from 'lucide-react'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'

interface MemoryInfo {
  automatic: boolean
  gb: number
  ctx: number
  pages: number
  auto: { gb: number; ctx: number; pages: number }
  min: number
  max: number
  options: { gb: number; ctx: number; pages: number }[]
  model: { gb: number }
  detected: { ramGB: number; vramGB: number | null; gpu: string | null; unified: boolean }
  words: { title: string; what: string; tradeoff: string; cloud: string; auto: string; restart: string }
}

const pagesFor = (info: MemoryInfo, gb: number) => {
  // Same arithmetic as the engine: (GB − model − 0.3) / 32 KB per token, 4K steps, then pages.
  const ctx = Math.max(8192, Math.min(262144, Math.floor((((gb - info.model.gb - 0.3) * 1024 ** 3 + 1024 ** 2) / 32768) / 4096) * 4096))
  return { ctx, pages: Math.max(1, Math.floor(((ctx * 0.85 - 3200) * 3.8) / 3000)) }
}

export default function LocalMemorySetting() {
  const { i18n } = useTranslation()
  const lang = /^de/i.test(i18n.language || '') ? 'de' : 'en'
  const [info, setInfo] = useState<MemoryInfo | null>(null)
  const [gb, setGb] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    engine()?.call('GET', `/api/config/local-memory?lang=${lang}`).then((r) => { setInfo(r); setGb(r.gb) }).catch(() => setInfo(null))
  }, [lang])

  if (!engine() || !info || gb === null) return null
  const w = info.words
  const preview = pagesFor(info, gb)
  const save = async (auto: boolean) => {
    try {
      const r = await engine()!.call('POST', '/api/config/local-memory', auto ? { auto: true, lang } : { gb, lang })
      setInfo(r)
      setGb(r.gb)
      setMsg({ text: w.restart, ok: true })
    } catch (err) { setMsg({ text: friendly(err), ok: false }) }
  }
  const de = lang === 'de'
  return (
    <div className="space-y-3 border-t border-tobacco pt-6" data-testid="local-memory">
      <h3 className="text-cream font-medium flex items-center gap-2"><Cpu size={16} /> {w.title}</h3>
      <p className="text-sm text-antique">{w.what}</p>
      <div className="flex items-center gap-4">
        <input type="range" min={info.min} max={info.max} step={0.1} value={gb} onChange={(e) => setGb(Number(e.target.value))} className="flex-1" aria-label={w.title} />
        <span className="text-parchment tabular-nums w-20 text-right">{gb.toFixed(1)} GB</span>
      </div>
      <p className="text-sm text-parchment">
        {de
          ? `Damit liest die lokale KI etwa ${preview.pages} Seiten auf einmal (${Math.round(preview.ctx / 1024)}K Token Kontext).`
          : `With this, the local AI reads about ${preview.pages} pages at once (${Math.round(preview.ctx / 1024)}K tokens of context).`}
        {info.automatic && Math.abs(gb - info.auto.gb) < 0.05 ? ` (${w.auto})` : ''}
      </p>
      <p className="text-xs text-antique">{w.tradeoff}</p>
      <p className="text-xs text-antique">
        {de ? 'Dieser Computer' : 'This computer'}: {info.detected.ramGB} GB {de ? 'Arbeitsspeicher' : 'memory'}{info.detected.vramGB ? `, ${info.detected.vramGB} GB ${de ? 'Grafikspeicher' : 'graphics memory'}${info.detected.gpu ? ` (${info.detected.gpu})` : ''}` : ''}{info.detected.unified ? (de ? ' (gemeinsam mit der Grafik)' : ' (shared with graphics)') : ''}. {de ? 'Das Modell selbst braucht' : 'The model itself needs'} {info.model.gb} GB. {w.cloud}
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn-primary !py-1.5 text-sm" onClick={() => save(false)}>{de ? 'Übernehmen' : 'Use this'}</button>
        <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => save(true)}>{w.auto} ({info.auto.gb} GB)</button>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? 'text-forest' : 'text-red-400'}`} role="status">{msg.text}</p>}
    </div>
  )
}
