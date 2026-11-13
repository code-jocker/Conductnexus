import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Alert, Button, Field, Input } from '../../components/ui'
import { apiError, post } from '../../lib/api'
import { useToast } from '../../components/toast'

type ForgotResult = { delivered: boolean; devCode?: string; devToken?: string; message: string }

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ForgotResult | null>(null)
  const navigate = useNavigate()
  const { success } = useToast()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const data = await post<ForgotResult>('/auth/forgot-password', { email: email.trim() })
      setResult(data)
      success('Reset request received')
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle="Enter the email linked to your school account and we will send a six-digit code and a secure link."
    >
      {error && (
        <Alert tone="danger" title="Request failed">
          {error}
        </Alert>
      )}

      {result ? (
        <div className="space-y-4">
          <Alert tone="success" title="Check your inbox">
            {result.message}
          </Alert>
          {result.devCode && (
            <div className="surface-muted space-y-2 p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-ochre-500">Development mode</p>
              <p className="text-slate-600 dark:text-slate-300">Email delivery is not configured, so the reset details are shown here.</p>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 font-mono text-lg font-semibold tracking-[0.3em] dark:bg-[#101a2c]">
                {result.devCode}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(result.devCode!)
                    success('Code copied')
                  }}
                  className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Copy code"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => navigate(`/reset-password?email=${encodeURIComponent(email)}&code=${result.devCode}`)}
              >
                Continue with this code
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <Link to="/login" className="link flex items-center gap-1.5 font-semibold">
              <ArrowLeft className="h-4 w-4" /> Back to sign in
            </Link>
            <Link to={`/reset-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="link font-semibold">
              I have a code
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-2 space-y-4">
          <Field label="School email" required>
            <Input type="email" required autoComplete="email" placeholder="you@school.rw" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            Send reset code
          </Button>
          <Link to="/login" className="link flex items-center justify-center gap-1.5 text-sm font-semibold">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}
