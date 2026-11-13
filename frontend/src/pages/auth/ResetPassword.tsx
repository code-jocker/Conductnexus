import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Alert, Button, Field, Input } from '../../components/ui'
import { apiError, post } from '../../lib/api'
import { useToast } from '../../components/toast'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { success } = useToast()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [code, setCode] = useState(params.get('code') ?? '')
  const [token, setToken] = useState(params.get('token') ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await post('/auth/reset-password', {
        email: email || undefined,
        code: code || undefined,
        token: token || undefined,
        newPassword,
      })
      success('Password reset. Sign in with your new password.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      eyebrow="Account recovery"
      title="Choose a new password"
      subtitle="Use the six-digit code from your email, or open the reset link directly."
    >
      {error && (
        <Alert tone="danger" title="Could not reset password">
          {error}
        </Alert>
      )}

      <form onSubmit={onSubmit} className="mt-2 space-y-4">
        {token ? (
          <Alert tone="info" title="Reset link detected">
            Your secure reset token has been applied. Choose a new password below.
          </Alert>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email address" required>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            <Field label="Six-digit code" required>
              <Input
                required
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="font-mono tracking-[0.3em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
        )}

        <Field label="New password" hint="10+ characters with upper case, lower case and a number" required>
          <Input type="password" required autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password" required>
          <Input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>

        <Button type="submit" loading={busy} className="w-full">
          Update password
        </Button>
        <Link to="/login" className="link flex items-center justify-center gap-1.5 text-sm font-semibold">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      </form>
    </AuthLayout>
  )
}
