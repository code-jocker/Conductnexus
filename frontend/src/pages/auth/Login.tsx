import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, KeyRound, Mail, MessageCircle, RotateCw, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { AccessRequestDialog } from '../../components/AccessRequestDialog'
import { Alert, Button, Field, Input } from '../../components/ui'
import { useAuth, type TwoFactorChallenge, type TwoFactorChannel } from '../../lib/auth'
import { apiError, get } from '../../lib/api'
import { firebaseEnabled } from '../../lib/firebase'
import { useToast } from '../../components/toast'

type SetupStatus = { needsSetup: boolean; schoolName?: string; firebaseConfigured?: boolean }

const CHANNEL_LABEL: Record<TwoFactorChannel, string> = { email: 'Email', whatsapp: 'WhatsApp' }
const RESEND_SECONDS = 60

export function LoginPage() {
  const { login, verifyTwoFactor, resendTwoFactor, loginWithGoogle } = useAuth()
  const { success, error: toastError, info } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [resending, setResending] = useState<TwoFactorChannel | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [twoFactor, setTwoFactor] = useState<TwoFactorChallenge | null>(null)
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(true)
  const [requestOpen, setRequestOpen] = useState(false)

  useEffect(() => {
    get<SetupStatus>('/auth/setup-status')
      .then((s) => {
        setStatus(s)
        if (s.needsSetup) navigate('/setup', { replace: true })
      })
      .catch(() => undefined)
  }, [navigate])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  const from = (location.state as { from?: string } | null)?.from || '/'

  function startChallenge(challenge: TwoFactorChallenge) {
    setTwoFactor(challenge)
    setCode(challenge.devCode ?? '')
    setCooldown(RESEND_SECONDS)
    if (challenge.warning) info(challenge.warning)
    else if (challenge.delivered) {
      info(`A verification code was sent to ${challenge.maskedDestination} by ${CHANNEL_LABEL[challenge.channel]}.`)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await login(email.trim(), password)
      if (result.status === 'two_factor_required') {
        startChallenge(result)
        return
      }
      const me = result.me
      success(`Welcome back, ${me.user.name.split(' ')[0]}`)
      navigate(me.user.mustChangePassword ? '/change-password' : from, { replace: true })
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!twoFactor) return
    setError(null)
    setBusy(true)
    try {
      const me = await verifyTwoFactor(twoFactor.challenge, code.trim(), trustDevice)
      success(`Welcome back, ${me.user.name.split(' ')[0]}`)
      navigate(me.user.mustChangePassword ? '/change-password' : from, { replace: true })
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onResend(channel: TwoFactorChannel) {
    if (!twoFactor) return
    setError(null)
    setResending(channel)
    try {
      const delivery = await resendTwoFactor(twoFactor.challenge, channel)
      setTwoFactor({ ...twoFactor, ...delivery })
      setCode(delivery.devCode ?? '')
      setCooldown(RESEND_SECONDS)
      if (delivery.warning) info(delivery.warning)
      else if (delivery.delivered) {
        success(`A new code was sent to ${delivery.maskedDestination} by ${CHANNEL_LABEL[delivery.channel]}.`)
      }
    } catch (err) {
      setError(apiError(err))
    } finally {
      setResending(null)
    }
  }

  function cancelTwoFactor() {
    setTwoFactor(null)
    setCode('')
    setError(null)
    setPassword('')
    setCooldown(0)
  }

  async function onGoogle() {
    setError(null)
    setGoogleBusy(true)
    try {
      const result = await loginWithGoogle()
      if (result.status === 'two_factor_required') {
        startChallenge(result)
        return
      }
      success(result.message ?? `Signed in as ${result.me.user.email}`)
      navigate(from, { replace: true })
    } catch (err) {
      const message = err instanceof Error && err.message.includes('popup') ? 'Google sign-in was cancelled.' : apiError(err)
      setError(message)
      toastError(message)
    } finally {
      setGoogleBusy(false)
    }
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Sign in to ConductNexus"
      subtitle={status?.schoolName ? `Continue to ${status.schoolName}` : 'Use your school account to continue.'}
    >
      {error && (
        <Alert tone="danger" title={twoFactor ? 'Verification failed' : 'Unable to sign in'}>
          {error}
        </Alert>
      )}

      {twoFactor ? (
        <form onSubmit={onVerify} className="mt-4 space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-slate-50 p-3 text-sm text-slate-600 dark:border-[#26374f] dark:bg-[#101d33] dark:text-slate-300">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" />
            <div className="space-y-1">
              <p className="font-semibold">New device verification</p>
              <p>
                We sent a 6-digit verification code to{' '}
                <span className="font-semibold">{twoFactor.maskedDestination}</span> by{' '}
                {CHANNEL_LABEL[twoFactor.channel]}.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                This step is required because two-factor authentication protects your account. The code expires in 10 minutes.
              </p>
            </div>
          </div>

          {twoFactor.warning && <Alert tone="warning" title="Code delivery needs attention">{twoFactor.warning}</Alert>}

          <Field label="Verification code" required>
            <div className="relative">
              <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                className="pl-9 tracking-[0.4em]"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
          </Field>
          {twoFactor.canTrustDevice && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm dark:border-[#26374f]">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brand-600"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
              />
              <span>
                <span className="block font-medium text-slate-700 dark:text-slate-200">Trust this device for 30 days</span>
                <span className="block text-xs text-slate-500">Only select this on a private device you control. Your password is still required on every sign-in.</span>
              </span>
            </label>
          )}
          <Button type="submit" loading={busy} className="w-full" icon={ArrowRight}>
            Verify and sign in
          </Button>

          <div className="rounded-lg border border-line p-3 dark:border-[#26374f]">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Didn&apos;t get the code?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {twoFactor.channels.map((ch) => (
                <Button
                  key={ch}
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={resending === ch}
                  disabled={cooldown > 0 || Boolean(resending)}
                  icon={ch === 'whatsapp' ? MessageCircle : Mail}
                  onClick={() => onResend(ch)}
                >
                  {resending === ch
                    ? 'Sending…'
                    : cooldown > 0
                      ? `Resend to ${CHANNEL_LABEL[ch]} in ${cooldown}s`
                      : `Send to ${CHANNEL_LABEL[ch]}`}
                </Button>
              ))}
            </div>
            {twoFactor.channels.length === 1 && (
              <p className="mt-2 text-[11px] text-slate-400">Add a mobile number to your profile to receive codes on WhatsApp.</p>
            )}
          </div>

          <button type="button" onClick={cancelTwoFactor} className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400">
            Use a different account
          </button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <Field label="School email" required>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="email"
                autoComplete="email"
                required
                className="pl-9"
                placeholder="you@school.rw"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </Field>

          <Field label="Password" required>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                className="pl-9 pr-10"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setRequestOpen(true)}
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
            >
              Need an account? Request access
            </button>
            <Link to="/forgot-password" className="link text-xs font-semibold">
              Forgot password?
            </Link>
          </div>

          <Button type="submit" loading={busy} className="w-full" icon={ArrowRight}>
            Sign in
          </Button>
        </form>
      )}

      {!twoFactor && (firebaseEnabled || status?.firebaseConfigured) && (
        <>
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line dark:bg-[#26374f]" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">or</span>
            <span className="h-px flex-1 bg-line dark:bg-[#26374f]" />
          </div>
          <Button type="button" variant="secondary" className="w-full" loading={googleBusy} onClick={onGoogle}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51z" />
            </svg>
            Continue with Google
          </Button>
        </>
      )}

      <p className="mt-6 text-center text-xs text-slate-400">
        Protected by role-based access, audit logging and Rwanda&apos;s data protection principles.
      </p>

      <AccessRequestDialog open={requestOpen} onClose={() => setRequestOpen(false)} />
    </AuthLayout>
  )
}
