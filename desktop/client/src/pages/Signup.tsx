import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

export default function Signup() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviteOrgName, setInviteOrgName] = useState<string | null>(null)
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteParam = searchParams.get('invite')

  useEffect(() => {
    if (inviteParam) {
      api.get(`/org/invite/${inviteParam}`)
        .then(data => setInviteOrgName(data.invitation?.orgName || null))
        .catch(() => {})
    }
  }, [inviteParam])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signup(email, password, name, inviteParam || undefined)
      navigate(inviteParam ? `/invite/${inviteParam}` : '/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-obsidian flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl text-parchment font-bold tracking-wide mb-2">
            Lex<span className="text-accent">Vault</span>
          </h1>
          <p className="text-antique">{t('auth.platform')}</p>
        </div>

        {/* Signup Card */}
        <div className="card animate-fade-in">
          <h2 className="font-serif text-2xl text-parchment mb-4">{t('auth.signupTitle')}</h2>

          {inviteOrgName && (
            <div className="bg-accent/10 border border-accent/30 rounded-button px-4 py-3 text-accent text-sm mb-4">
              {t('auth.acceptInviteTitle', { org: inviteOrgName })}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-cream text-sm mb-2">{t('common.name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input w-full"
                placeholder={t('auth.namePlaceholder')}
                required
              />
            </div>

            <div>
              <label className="block text-cream text-sm mb-2">{t('common.email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input w-full"
                placeholder={t('auth.emailPlaceholder')}
                required
              />
            </div>

            <div>
              <label className="block text-cream text-sm mb-2">{t('common.password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                placeholder="••••••••"
                minLength={8}
                required
              />
            </div>

            {error && (
              <div className="bg-burgundy/20 border border-burgundy/50 rounded-button px-4 py-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? t('auth.creatingAccount') : t('auth.signupButton')}
            </button>
          </form>

          <p className="text-antique text-center mt-6 text-sm">
            {t('auth.alreadyHaveAccount')}{' '}
            <Link to="/login" className="text-accent hover:text-accent-hover transition-colors">
              {t('common.login')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
