import { useState } from 'react'
import { Shield, Loader2, Sparkles } from 'lucide-react'
import { maApi, type DealWarranty, type PlaybookPosition } from '../../lib/api'

interface Props {
  dealId: string
  warranties: DealWarranty[]
  onUpdate?: () => void
}

const safeStr = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'object' && v ? ((v as Record<string, string>).risk || (v as Record<string, string>).title || (v as Record<string, string>).position || JSON.stringify(v)) : String(v ?? '')

const safeJsonParse = <T,>(json: string | null | undefined, fallback: T): T => {
  if (!json) return fallback
  try { return JSON.parse(json) } catch { return fallback }
}

const SCORE_COLOR = (score: number | null | undefined) => {
  if (score == null) return 'bg-leather text-antique'
  if (score >= 75) return 'bg-red-500/20 text-red-400'
  if (score >= 50) return 'bg-amber-500/20 text-amber-400'
  if (score >= 25) return 'bg-blue-500/20 text-blue-400'
  return 'bg-green-500/20 text-green-400'
}

export default function MaWarrantyHeatmap({ dealId, warranties, onUpdate }: Props) {
  const [generating, setGenerating] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const handlePlaybook = async (warrantyId: string) => {
    setGenerating(warrantyId)
    try {
      await maApi.generatePlaybook(dealId, warrantyId)
      onUpdate?.()
    } catch (err) {
      console.error('Playbook generation failed:', err)
    } finally {
      setGenerating(null)
    }
  }

  if (warranties.length === 0) {
    return (
      <div className="text-center py-12 text-antique">
        <Shield size={48} className="mx-auto mb-4 opacity-30" />
        <p>No warranties extracted yet.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Heatmap table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tobacco">
              <th className="text-left text-antique py-2 px-3 font-medium">Warranty</th>
              <th className="text-center text-antique py-2 px-3 font-medium w-20">Breadth</th>
              <th className="text-center text-antique py-2 px-3 font-medium w-20">Disclosure</th>
              <th className="text-center text-antique py-2 px-3 font-medium w-20">Exposure</th>
              <th className="text-center text-antique py-2 px-3 font-medium w-20">W&I</th>
              <th className="text-center text-antique py-2 px-3 font-medium w-28">Playbook</th>
            </tr>
          </thead>
          <tbody>
            {warranties.map(w => {
              const positions: PlaybookPosition[] = safeJsonParse<PlaybookPosition[]>(w.playbookPositions, [])
              const isExpanded = expanded === w.id
              return (
                <tr key={w.id} className="border-b border-tobacco/50 hover:bg-leather/30">
                  <td className="py-2 px-3">
                    <button onClick={() => setExpanded(isExpanded ? null : w.id)} className="text-left">
                      <span className="text-cream font-medium">{w.name}</span>
                      {w.location && <span className="text-antique text-xs ml-2">{w.location}</span>}
                    </button>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SCORE_COLOR(w.breadthScore)}`}>
                      {w.breadthScore ?? '—'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SCORE_COLOR(w.disclosureScore)}`}>
                      {w.disclosureScore ?? '—'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SCORE_COLOR(w.exposureScore)}`}>
                      {w.exposureScore ?? '—'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SCORE_COLOR(w.wniScore)}`}>
                      {w.wniScore ?? '—'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    {positions.length > 0 ? (
                      <button onClick={() => setExpanded(isExpanded ? null : w.id)} className="text-xs text-accent hover:underline">
                        {positions.length} positions
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePlaybook(w.id)}
                        disabled={generating === w.id}
                        className="text-xs px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50"
                      >
                        {generating === w.id ? <Loader2 size={12} className="inline animate-spin" /> : <Sparkles size={12} className="inline" />}
                        {' '}Generate
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Expanded warranty detail */}
      {expanded && (() => {
        const w = warranties.find(x => x.id === expanded)
        if (!w) return null
        const positions: PlaybookPosition[] = safeJsonParse<PlaybookPosition[]>(w.playbookPositions, [])
        return (
          <div className="mt-4 card border-accent/20">
            <h4 className="font-serif text-lg text-parchment mb-2">{w.name}</h4>
            {w.clauseText && (
              <div className="mb-3 p-3 bg-leather/50 rounded text-cream text-sm italic">
                {w.clauseText}
              </div>
            )}
            {positions.length > 0 && (
              <div className="space-y-3">
                <h5 className="text-cream font-medium text-sm">Negotiation Positions</h5>
                {positions.map((p, i) => (
                  <div key={i} className={`p-3 rounded border ${
                    p.level === 'conservative' ? 'border-green-500/20 bg-green-500/5' :
                    p.level === 'moderate' ? 'border-amber-500/20 bg-amber-500/5' :
                    'border-red-500/20 bg-red-500/5'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        p.level === 'conservative' ? 'bg-green-500/20 text-green-400' :
                        p.level === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>{safeStr(p.level)}</span>
                    </div>
                    <p className="text-cream text-sm mb-1">{safeStr(p.position)}</p>
                    <p className="text-antique text-xs">{safeStr(p.rationale)}</p>
                    {p.statutoryRef && <p className="text-accent text-xs mt-1">{safeStr(p.statutoryRef)}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
