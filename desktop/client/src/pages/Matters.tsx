// Matters: find one (search by name, number or client), start a new one.
// Choosing a matter opens its conversation in the chat.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { MatterList, NewMatterForm, mattersBridge, useMatters } from '../components/MatterPicker'

export default function Matters() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { matters, active, choose, refresh } = useMatters()
  const [adding, setAdding] = useState(false)
  if (!mattersBridge()) return <div className="p-8 text-antique">{t('matters.appOnly', 'Matters are kept by the desktop app.')}</div>
  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl text-parchment">{t('matters.title', 'Matters')}</h1>
        {!adding && <button type="button" className="btn-primary !px-4 !py-2 text-sm inline-flex items-center gap-1.5" onClick={() => setAdding(true)} data-testid="matters-new"><Plus size={16} /> {t('matters.new', 'New matter')}</button>}
      </div>
      {adding && <div className="card !p-4"><NewMatterForm onDone={() => { setAdding(false); refresh(); navigate('/research') }} onCancel={() => setAdding(false)} /></div>}
      <div className="card !p-4">
        <MatterList matters={matters} active={active} autoFocus={!adding} onChoose={async (m) => { await choose(m ? m.id : null); navigate('/research') }} />
      </div>
    </div>
  )
}
