import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Loader2, Settings2, Factory } from 'lucide-react'
import { maApi, type Deal } from '../lib/api'
import MaPartyEditor from '../components/ma/MaPartyEditor'
import MaDocumentUpload from '../components/ma/MaDocumentUpload'

const PERSPECTIVES = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'seller', label: 'Seller' },
  { value: 'target', label: 'Target' },
]

const DEAL_TYPES = [
  { value: 'asset_purchase', label: 'Asset Purchase' },
  { value: 'share_purchase', label: 'Share Purchase' },
  { value: 'merger', label: 'Merger' },
  { value: 'joint_venture', label: 'Joint Venture' },
]

export default function MaDealSetup() {
  const { t } = useTranslation()
  const { dealId } = useParams<{ dealId: string }>()
  const navigate = useNavigate()
  const [deal, setDeal] = useState<Deal | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [industrySuggestions, setIndustrySuggestions] = useState<string[]>([])

  useEffect(() => {
    if (dealId) loadDeal()
    maApi.getIndustries().then(setIndustrySuggestions).catch(() => {})
  }, [dealId])

  const loadDeal = async () => {
    try {
      const data = await maApi.getDeal(dealId!)
      setDeal(data)
    } catch (err) {
      console.error('Failed to load deal:', err)
    } finally {
      setLoading(false)
    }
  }

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Record<string, string>>({})

  const flushSave = useCallback(async () => {
    if (!deal || Object.keys(pendingRef.current).length === 0) return
    const payload = { ...pendingRef.current }
    pendingRef.current = {}
    setSaving(true)
    try {
      await maApi.updateDeal(deal.id, payload)
    } catch (err) {
      console.error('Failed to update deal:', err)
    } finally {
      setSaving(false)
    }
  }, [deal])

  const handleConfigChange = (field: string, value: string) => {
    if (!deal) return
    setDeal({ ...deal, [field]: value })
    pendingRef.current[field] = value
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(flushSave, 600)
  }

  // Flush on unmount
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    flushSave()
  }, [flushSave])

  const handleStart = async () => {
    if (!deal) return
    const parsedDocs = (deal.documents || []).filter(d => ['parsed', 'classified'].includes(d.status))
    if (parsedDocs.length === 0) {
      alert('Upload at least one document before starting analysis.')
      return
    }

    setStarting(true)
    try {
      await maApi.startPipeline(deal.id)
      navigate(`/ma/${deal.id}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start'
      alert(message)
    } finally {
      setStarting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <Loader2 size={24} className="mx-auto text-antique animate-spin" />
      </div>
    )
  }

  if (!deal) {
    return (
      <div className="p-8 text-center">
        <p className="text-antique">Deal not found.</p>
      </div>
    )
  }

  const parsedDocs = (deal.documents || []).filter(d => ['parsed', 'classified'].includes(d.status))

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-2xl text-parchment">{deal.name}</h1>
          <p className="text-antique text-sm">Configure deal, add parties, upload documents</p>
        </div>
        {saving && <span className="text-antique text-xs">Saving...</span>}
      </div>

      {/* Deal configuration */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 size={18} className="text-antique" />
          <h3 className="font-serif text-lg text-parchment">{t('ma.dealConfiguration')}</h3>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-antique text-sm mb-1 block">{t('ma.dealName')}</label>
            <input
              type="text"
              value={deal.name}
              onChange={e => handleConfigChange('name', e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="text-antique text-sm mb-1 block">{t('ma.perspective')}</label>
            <select
              value={deal.perspective}
              onChange={e => handleConfigChange('perspective', e.target.value)}
              className="input w-full"
            >
              {PERSPECTIVES.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-antique text-sm mb-1 block">{t('ma.dealType')}</label>
            <select
              value={deal.dealType}
              onChange={e => handleConfigChange('dealType', e.target.value)}
              className="input w-full"
            >
              {DEAL_TYPES.map(dt => (
                <option key={dt.value} value={dt.value}>{dt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Industry — free-text with autocomplete */}
        <div className="mt-4">
          <label className="text-antique text-sm mb-1 flex items-center gap-1.5">
            <Factory size={14} />
            {t('ma.targetIndustry')}
          </label>
          <input
            type="text"
            list="industry-suggestions"
            value={deal.industry || ''}
            onChange={e => handleConfigChange('industry', e.target.value)}
            className="input w-full"
            placeholder={t('ma.industry')}
          />
          <datalist id="industry-suggestions">
            {industrySuggestions.map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <p className="text-antique/60 text-xs mt-1">
            {t('ma.industryHint')}
          </p>
        </div>

        {deal.description !== undefined && (
          <div className="mt-4">
            <label className="text-antique text-sm mb-1 block">{t('ma.descriptionOptional')}</label>
            <textarea
              value={deal.description || ''}
              onChange={e => handleConfigChange('description', e.target.value)}
              className="input w-full h-20 resize-none"
              placeholder={t('common.description')}
            />
          </div>
        )}
      </div>

      {/* Parties */}
      <div className="card mb-6">
        <MaPartyEditor
          dealId={deal.id}
          parties={deal.parties || []}
          onUpdate={loadDeal}
        />
      </div>

      {/* Documents */}
      <div className="card mb-6">
        <MaDocumentUpload
          dealId={deal.id}
          documents={deal.documents || []}
          onUpdate={loadDeal}
        />
      </div>

      {/* Start button */}
      <div className="flex items-center justify-between p-6 card border-accent/20 bg-accent/5">
        <div>
          <p className="text-cream font-medium">{t('ma.readyToAnalyze')}</p>
          <p className="text-antique text-sm">
            {parsedDocs.length} document{parsedDocs.length !== 1 ? 's' : ''} ready.
            {deal.industry ? ` Industry: ${deal.industry}.` : ''}
          </p>
        </div>
        <button
          onClick={handleStart}
          disabled={starting || parsedDocs.length === 0}
          className="btn-primary flex items-center gap-2 text-lg px-6 py-3"
        >
          {starting ? (
            <><Loader2 size={18} className="animate-spin" /> Starting...</>
          ) : (
            <>Run Analysis <ArrowRight size={18} /></>
          )}
        </button>
      </div>
    </div>
  )
}
