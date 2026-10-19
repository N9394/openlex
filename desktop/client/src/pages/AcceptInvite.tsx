import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
import { Users, Check, AlertTriangle, Loader2 } from 'lucide-react'

interface InviteInfo {
  id: string
  email: string
  role: string
  status: string
  orgName: string
  orgSlug: string
  expired: boolean
}

export default function AcceptInvite() {
  const { t } = useTranslation()
  const { invitationId } = useParams<{ invitationId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!invitationId) return
    api.get(`/org/invite/${invitationId}`)
      .then(data => setInvite(data.invitation))
      .catch(err => setError(err instanceof Error ? err.message : 'Invitation not found'))
      .finally(() => setLoading(false))
  }, [invitationId])

  const handleAccept = async () => {
    if (!invitationId) return
    setAccepting(true)
    setError('')

    try {
      await api.post(`/org/invite/${invitationId}/accept`, {})
      setSuccess(true)
      setTimeout(() => navigate('/dashboard'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-obsidian flex items-center justify-center">
        <Loader2 className="text-accent animate-spin" size={32} />
      </div>
    )
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen bg-obsidian flex items-center justify-center p-6">
        <div className="w-full max-w-md card text-center">
          <AlertTriangle size={48} className="text-red-400 mx-auto mb-4" />
          <h2 className="font-serif text-2xl text-parchment mb-2">{t('auth.inviteError')}</h2>
          <p className="text-antique mb-6">{error}</p>
          <Link to="/login" className="btn-primary inline-block">Go to Login</Link>
        </div>
      </div>
    )
  }

  if (!invite) return null

  const isExpired = invite.expired || invite.status === 'expired'
  const isAlreadyAccepted = invite.status === 'accepted'

  if (isExpired || isAlreadyAccepted) {
    return (
      <div className="min-h-screen bg-obsidian flex items-center justify-center p-6">
        <div className="w-full max-w-md card text-center">
          <AlertTriangle size={48} className="text-amber-400 mx-auto mb-4" />
          <h2 className="font-serif text-2xl text-parchment mb-2">
            {isAlreadyAccepted ? 'Already Accepted' : 'Invitation Expired'}
          </h2>
          <p className="text-antique mb-6">
            {isAlreadyAccepted
              ? 'This invitation has already been accepted.'
              : 'This invitation has expired. Please ask your admin to send a new one.'}
          </p>
          <Link to="/login" className="btn-primary inline-block">Go to Login</Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-obsidian flex items-center justify-center p-6">
        <div className="w-full max-w-md card text-center">
          <Check size={48} className="text-green-400 mx-auto mb-4" />
          <h2 className="font-serif text-2xl text-parchment mb-2">{t('common.success')}</h2>
          <p className="text-antique">Redirecting to dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-obsidian flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl text-parchment font-bold tracking-wide mb-2">
            Lex<span className="text-accent">Vault</span>
          </h1>
          <p className="text-antique">Legal Research Platform</p>
        </div>

        <div className="card text-center">
          <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users size={32} className="text-accent" />
          </div>

          <h2 className="font-serif text-2xl text-parchment mb-2">{t('admin.invitations')}</h2>
          <p className="text-cream mb-1">
            You've been invited to join
          </p>
          <p className="text-accent text-lg font-semibold mb-1">{invite.orgName}</p>
          <p className="text-antique text-sm mb-6">
            as <span className="text-cream capitalize">{invite.role}</span>
          </p>

          {error && (
            <div className="bg-burgundy/20 border border-burgundy/50 rounded-button px-4 py-3 text-red-300 text-sm mb-4">
              {error}
            </div>
          )}

          {user ? (
            // Logged in — show accept button
            <div>
              <p className="text-antique text-sm mb-4">
                Signed in as <span className="text-cream">{user.email}</span>
              </p>
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="btn-primary w-full"
              >
                {accepting ? 'Joining...' : 'Join Team'}
              </button>
            </div>
          ) : (
            // Not logged in — show login/signup links
            <div className="space-y-3">
              <p className="text-antique text-sm mb-4">
                Sign in or create an account to join the team.
              </p>
              <Link
                to={`/login?invite=${invitationId}`}
                className="btn-primary w-full block text-center"
              >
                Sign In
              </Link>
              <Link
                to={`/signup?invite=${invitationId}`}
                className="btn-secondary w-full block text-center"
              >
                Create Account
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
