import { useState } from 'react'
import { Plus, Trash2, Building2 } from 'lucide-react'
import { maApi, type DealParty } from '../../lib/api'

const PARTY_ROLES = ['buyer', 'seller', 'target', 'guarantor', 'advisor']
const JURISDICTIONS = [
  { code: 'US', label: 'United States' },
  { code: 'US-CA', label: 'California' },
  { code: 'EW', label: 'England & Wales' },
  { code: 'SC', label: 'Scotland' },
  { code: 'NI', label: 'Northern Ireland' },
  { code: 'DE', label: 'Germany' },
  { code: 'AT', label: 'Austria (Federal)' },
  { code: 'SK', label: 'Slovakia' },
  { code: 'CZ', label: 'Czech Republic' },
  { code: 'RO', label: 'Romania' },
  { code: 'CY', label: 'Cyprus' },
  { code: 'ZA', label: 'South Africa' },
  { code: 'FR', label: 'France' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'HU', label: 'Hungary' },
  { code: 'IE', label: 'Ireland' },
  { code: 'EU', label: 'European Union' },
]

interface Props {
  dealId: string
  parties: DealParty[]
  onUpdate: () => void
}

export default function MaPartyEditor({ dealId, parties, onUpdate }: Props) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', role: 'buyer', jurisdiction: 'US' })
  const [loading, setLoading] = useState(false)

  const handleAdd = async () => {
    if (!form.name.trim()) return
    setLoading(true)
    try {
      await maApi.addParty(dealId, form)
      setForm({ name: '', role: 'buyer', jurisdiction: 'US' })
      setAdding(false)
      onUpdate()
    } catch (err) {
      console.error('Failed to add party:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (partyId: string) => {
    try {
      await maApi.deleteParty(dealId, partyId)
      onUpdate()
    } catch (err) {
      console.error('Failed to delete party:', err)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-lg text-parchment">Deal Parties</h3>
        <button
          onClick={() => setAdding(!adding)}
          className="btn-secondary text-sm flex items-center gap-1"
        >
          <Plus size={14} /> Add Party
        </button>
      </div>

      {adding && (
        <div className="card mb-4 border-accent/20">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <input
              type="text"
              placeholder="Party name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="input"
              autoFocus
            />
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="input"
            >
              {PARTY_ROLES.map(r => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
            <select
              value={form.jurisdiction}
              onChange={e => setForm(f => ({ ...f, jurisdiction: e.target.value }))}
              className="input"
            >
              {JURISDICTIONS.map(j => (
                <option key={j.code} value={j.code}>{j.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={loading || !form.name.trim()} className="btn-primary text-sm">
              {loading ? 'Adding...' : 'Add'}
            </button>
            <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {parties.length === 0 ? (
        <p className="text-antique text-sm">No parties added yet. Add the buyer, seller, and target entities.</p>
      ) : (
        <div className="space-y-2">
          {parties.map(party => (
            <div key={party.id} className="flex items-center gap-3 p-3 rounded-button bg-leather/50">
              <Building2 size={18} className="text-antique" />
              <div className="flex-1">
                <span className="text-cream font-medium">{party.name}</span>
                <span className="text-antique text-sm ml-2">
                  {party.role.charAt(0).toUpperCase() + party.role.slice(1)} ({party.jurisdiction})
                </span>
              </div>
              <button
                onClick={() => handleDelete(party.id)}
                className="text-antique hover:text-red-400 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
