import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button, Card, Field, Input, PageHeader, Alert } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { apiError, post } from '../../lib/api'
import { useToast } from '../../components/toast'

export function ChangePasswordPage() {
  const { me, refreshMe, logout } = useAuth()
  const navigate = useNavigate()
  const { success, error: toastError } = useToast()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const forced = Boolean(me?.user.mustChangePassword)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!currentPassword) {
      setError(forced ? 'Enter the temporary password you signed in with.' : 'Enter your current password.')
      return
    }
    if (newPassword.length < 10) {
      setError('New password must be at least 10 characters long.')
      return
    }
    if (!/[a-z]/.test(newPassword)) {
      setError('New password must include a lowercase letter.')
      return
    }
    if (!/[A-Z]/.test(newPassword)) {
      setError('New password must include an uppercase letter.')
      return
    }
    if (!/\d/.test(newPassword)) {
      setError('New password must include a number.')
      return
    }
    if (newPassword === currentPassword) {
      setError('Choose a password that is different from the temporary password.')
      return
    }
    if (newPassword !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await post('/auth/change-password', { currentPassword, newPassword })
      success('Password updated')
      try {
        await refreshMe()
        navigate('/', { replace: true })
      } catch {
        await logout()
        navigate('/login', { replace: true })
      }
    } catch (err) {
      setError(apiError(err))
      toastError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Account security"
        title={forced ? 'Choose a new password' : 'Change password'}
        subtitle={
          forced
            ? 'Your account was created with a temporary password. Set a private password to continue.'
            : 'Use a strong password you do not reuse on other systems.'
        }
      />

      <Card className="p-6">
        {forced && (
          <div className="mb-5">
            <Alert tone="warning" title="A new password is required">
              For security, temporary passwords must be replaced before you can open conduct records.
            </Alert>
          </div>
        )}
        {error && (
          <div className="mb-4">
            <Alert tone="danger" title="Password not changed">
              {error}
            </Alert>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <Field
            label={forced ? 'Temporary password' : 'Current password'}
            hint={forced ? 'The password from your invitation, used to sign in just now.' : undefined}
            required
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="password"
                autoComplete="current-password"
                required
                className="pl-9"
                value={currentPassword}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          </Field>
          <Field label="New password" hint="10+ characters with upper case, lower case and a number" required>
            <Input type="password" autoComplete="new-password" required value={newPassword} onChange={(e) => setNew(e.target.value)} />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>

          <div className="flex items-center justify-between pt-2">
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" /> All other sessions will be signed out.
            </p>
            <Button type="submit" loading={busy}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
