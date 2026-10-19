import { useState } from 'react'
import { FileText, Loader2, Sparkles } from 'lucide-react'
import { maApi, type DealWarranty, type PlaybookPosition } from '../../lib/api'

interface Props {
  dealId: string
  warranties: DealWarranty[]
  onUpdate?: () => void
}

const STANCE_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  conservative: { label: 'Conservative', color: 'text-green-400', border: 'border-green-500/30' },
  moderate: { label: 'Moderate', color: 'text-amber-400', border: 'border-amber-500/30' },
  aggressive: { label: 'Aggressive', color: 'text-red-400', border: 'border-red-500/30' },
}

export default function MaRedliner({ dealId, warranties, onUpdate }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [stance, setStance] = useState<string>('moderate')
  const [generating, setGenerating] = useState(false)

  const warrantyWithPlaybook = warranties.filter(w => w.clauseText)
  const selectedWarranty = warrantyWithPlaybook.find(w => w.id === selected)
  const positions: PlaybookPosition[] = (() => {
    if (!selectedWarranty?.playbookPositions) return []
    try { return JSON.parse(selectedWarranty.playbookPositions) } catch { return [] }
  })()
  const activePosition = positions.find(p => p.level === stance)

  const handleGenerate = async () => {
    if (!selected) return
    setGenerating(true)
    try {
      await maApi.generatePlaybook(dealId, selected)
      onUpdate?.()
    } catch (err) {
      console.error('Failed to generate playbook:', err)
    } finally {
      setGenerating(false)
    }
  }

  if (warrantyWithPlaybook.length === 0) {
    return (
      <div className="text-center py-12 text-antique">
        <FileText size={48} className="mx-auto mb-4 opacity-30" />
        <p>No warranty clauses available for redlining.</p>
        <p className="text-xs mt-1">Run the analysis pipeline to extract warranty clauses first.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:h-[calc(100vh-320px)] min-h-[400px]">
      {/* Left: clause selector */}
      <div className="w-full md:w-72 flex-shrink-0 md:border-r border-b md:border-b-0 border-tobacco md:pr-4 pb-4 md:pb-0 overflow-y-auto max-h-48 md:max-h-none">
        <h4 className="text-cream font-medium text-sm mb-3 sticky top-0 bg-walnut pb-2">
          Warranty Clauses ({warrantyWithPlaybook.length})
        </h4>
        <div className="space-y-1">
          {warrantyWithPlaybook.map(w => {
            const hasPlaybook = !!w.playbookPositions
            return (
              <button
                key={w.id}
                onClick={() => setSelected(w.id)}
                className={`w-full text-left p-2 rounded text-sm transition-colors ${
                  selected === w.id
                    ? 'bg-accent/10 border border-accent/30'
                    : 'hover:bg-leather/50 border border-transparent'
                }`}
              >
                <span className="text-cream block truncate">{w.name}</span>
                <span className="text-antique text-xs block truncate">
                  {w.location || 'No location'}
                  {hasPlaybook && <span className="text-accent ml-1">&bull; redline ready</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: tracked changes view */}
      <div className="flex-1 overflow-y-auto">
        {!selectedWarranty ? (
          <div className="text-center py-12 text-antique">
            <p>Select a warranty clause from the left panel.</p>
          </div>
        ) : (
          <div>
            {/* Stance selector */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-antique text-sm">Stance:</span>
              {Object.entries(STANCE_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setStance(key)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    stance === key
                      ? `${cfg.border} ${cfg.color} bg-leather/50`
                      : 'border-tobacco text-antique hover:text-cream'
                  }`}
                >
                  {cfg.label}
                </button>
              ))}
              {positions.length === 0 && (
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="text-xs px-3 py-1 rounded-full bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 ml-auto flex items-center gap-1"
                >
                  {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Generate Positions
                </button>
              )}
            </div>

            {/* Original clause */}
            <div className="mb-4">
              <h4 className="text-antique text-xs font-medium uppercase tracking-wide mb-2">Original Clause</h4>
              <div className="p-4 rounded border border-tobacco bg-leather/20 text-cream text-sm leading-relaxed whitespace-pre-wrap">
                {selectedWarranty.clauseText}
              </div>
            </div>

            {/* Redlined version */}
            {activePosition?.redlineText ? (
              <div className="mb-4">
                <h4 className="text-antique text-xs font-medium uppercase tracking-wide mb-2">
                  Suggested Redline
                  <span className={`ml-2 ${STANCE_CONFIG[stance]?.color || 'text-antique'}`}>
                    ({STANCE_CONFIG[stance]?.label || stance})
                  </span>
                </h4>
                <div className="p-4 rounded border border-accent/20 bg-accent/5 text-cream text-sm leading-relaxed whitespace-pre-wrap">
                  <RedlineDiff original={selectedWarranty.clauseText} redline={activePosition.redlineText} />
                </div>
              </div>
            ) : positions.length > 0 ? (
              <div className="p-4 rounded border border-tobacco bg-leather/10 text-antique text-sm">
                No redline text available for the <strong>{stance}</strong> stance. The position may not include clause-level changes.
              </div>
            ) : null}

            {/* Position rationale */}
            {activePosition && (
              <div className="mb-4">
                <h4 className="text-antique text-xs font-medium uppercase tracking-wide mb-2">Rationale</h4>
                <div className="p-3 rounded bg-leather/30 text-cream text-sm">
                  <p>{String(activePosition.position ?? '')}</p>
                  <p className="text-antique text-xs mt-2">{String(activePosition.rationale ?? '')}</p>
                  {activePosition.statutoryRef && (
                    <p className="text-accent text-xs mt-1">{String(activePosition.statutoryRef)}</p>
                  )}
                </div>
              </div>
            )}

            {/* No positions yet */}
            {positions.length === 0 && !generating && (
              <div className="p-4 rounded border border-tobacco bg-leather/10 text-antique text-sm text-center">
                No playbook positions generated yet. Click "Generate Positions" above to create redline suggestions.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Simple diff display — highlights text that differs between original and redline.
 * Uses word-level comparison for a clean tracked-changes look.
 */
function RedlineDiff({ original, redline }: { original: string; redline: string }) {
  const origWords = original.split(/(\s+)/)
  const redWords = redline.split(/(\s+)/)

  // Simple LCS-based diff
  const diff = computeDiff(origWords, redWords)

  return (
    <span>
      {diff.map((part, i) => {
        if (part.type === 'equal') {
          return <span key={i}>{part.text}</span>
        }
        if (part.type === 'delete') {
          return (
            <span key={i} className="bg-red-500/20 text-red-400 line-through">{part.text}</span>
          )
        }
        if (part.type === 'insert') {
          return (
            <span key={i} className="bg-green-500/20 text-green-400 underline">{part.text}</span>
          )
        }
        return null
      })}
    </span>
  )
}

interface DiffPart {
  type: 'equal' | 'delete' | 'insert'
  text: string
}

function computeDiff(a: string[], b: string[]): DiffPart[] {
  // Build LCS table
  const m = a.length, n = b.length
  // For very long texts, fall back to simple side-by-side
  if (m > 500 || n > 500) {
    return [
      { type: 'delete', text: a.join('') },
      { type: 'insert', text: b.join('') },
    ]
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack
  const parts: DiffPart[] = []
  let i = m, j = n
  const stack: DiffPart[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: 'equal', text: a[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'insert', text: b[j - 1] })
      j--
    } else {
      stack.push({ type: 'delete', text: a[i - 1] })
      i--
    }
  }

  stack.reverse()

  // Merge consecutive same-type parts
  for (const part of stack) {
    if (parts.length > 0 && parts[parts.length - 1].type === part.type) {
      parts[parts.length - 1].text += part.text
    } else {
      parts.push({ ...part })
    }
  }

  return parts
}
