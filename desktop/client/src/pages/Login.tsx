import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, ArrowLeft, Shield } from 'lucide-react'

export default function Login() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // MFA state
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaToken, setMfaToken] = useState('')
  const [mfaCode, setMfaCode] = useState('')

  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteParam = searchParams.get('invite')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // If MFA is required, include the MFA token and code
      const result = await login(email, password, mfaRequired ? { mfaToken, mfaCode } : undefined)

      // Check if MFA is required
      if (result?.requiresMfa && result?.mfaToken) {
        setMfaRequired(true)
        setMfaToken(result.mfaToken)
        setLoading(false)
        return
      }

      // If there's an invite param, redirect to invite page after login
      if (inviteParam) {
        navigate(`/invite/${inviteParam}`)
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleBackToLogin = () => {
    setMfaRequired(false)
    setMfaToken('')
    setMfaCode('')
    setError('')
  }

  // MFA Verification Screen
  if (mfaRequired) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="card animate-fade-in">
            {/* Back Button */}
            <button
              onClick={handleBackToLogin}
              className="inline-flex items-center text-sm text-cream-dark hover:text-parchment transition-colors mb-6"
            >
              <ArrowLeft size={16} className="mr-2" />
              {t('common.back')}
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-accent/20 rounded-card flex items-center justify-center">
                <Shield size={24} className="text-accent" />
              </div>
              <div>
                <h1 className="text-2xl font-serif font-bold text-parchment">{t('auth.mfaTitle')}</h1>
                <p className="text-cream-dark text-sm">{t('auth.mfaDesc')}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-parchment mb-2">
                  {t('auth.mfaCodeLabel')}
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  className="input w-full text-center text-3xl tracking-[0.5em] font-mono"
                />
              </div>

              {error && (
                <div className="bg-burgundy/20 border border-burgundy/50 rounded-button px-4 py-3 text-red-300 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || mfaCode.length !== 6}
                className="btn-primary w-full"
              >
                {loading ? t('common.loading') : t('auth.mfaVerify')}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl text-parchment font-bold tracking-wide mb-2">
            Lex<span className="text-accent">Vault</span>
          </h1>
          <p className="text-antique">{t('auth.platform')}</p>
        </div>

        {/* Login Card */}
        <div className="card animate-fade-in">
          <h2 className="font-serif text-2xl text-parchment mb-2">{t('auth.loginTitle')}</h2>
          <p className="text-cream-dark text-sm mb-6">{t('auth.loginSubtitle')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <div className="flex items-center justify-between mb-2">
                <label className="block text-cream text-sm">{t('common.password')}</label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  {t('auth.forgotPassword')}
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input w-full pr-10"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-antique hover:text-parchment transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
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
              {loading ? t('auth.logginIn') : t('auth.loginButton')}
            </button>
          </form>

          <p className="text-antique text-center mt-6 text-sm">
            {t('auth.noAccount')}{' '}
            <Link to="/signup" className="text-accent hover:text-accent-hover font-semibold transition-colors">
              {t('common.signup')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
