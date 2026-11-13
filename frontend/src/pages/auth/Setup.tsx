import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, CheckCircle2, GraduationCap, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Alert, Button, Field, Input } from '../../components/ui'
import { apiError, get, post } from '../../lib/api'
import { setToken } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/toast'

type SetupStatus = { needsSetup: boolean; hasUsers: boolean; schoolName: string }

export function SetupPage() {
  const navigate = useNavigate()
  const { refreshMe } = useAuth()
  const { success } = useToast()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [form, setForm] = useState({
    schoolName: '',
    schoolEmail: '',
    schoolPhone: '+250 ',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    confirmPassword: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    get<SetupStatus>('/auth/setup-status')
      .then((s) => {
        setStatus(s)
        if (!s.needsSetup) navigate('/login', { replace: true })
        else if (s.schoolName && s.schoolName !== 'ConductNexus') setForm((f) => ({ ...f, schoolName: s.schoolName }))
      })
      .catch((err) => setError(apiError(err)))
  }, [navigate])

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (form.adminPassword !== form.confirmPassword) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const data = await post<{ accessToken: string }>('/auth/setup', {
        schoolName: form.schoolName,
        schoolEmail: form.schoolEmail || undefined,
        schoolPhone: form.schoolPhone || undefined,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
      })
      setToken(data.accessToken)
      await refreshMe()
      success('School workspace created. Welcome to ConductNexus.')
      navigate('/', { replace: true })
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (status && !status.needsSetup) return null

  return (
    <AuthLayout
      eyebrow="First-time setup"
      title="Create your school workspace"
      subtitle="This one-time setup creates the school profile and the first administrator account."
    >
      {error && (
        <Alert tone="danger" title="Setup could not be completed">
          {error}
        </Alert>
      )}

      <form onSubmit={onSubmit} className="mt-4 space-y-5">
        <div>
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Building2 className="h-4 w-4 text-brand-500" /> School profile
          </p>
          <div className="space-y-3">
            <Field label="School name" required>
              <Input required placeholder="e.g. Groupe Scolaire Kigali" value={form.schoolName} onChange={set('schoolName')} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="School email">
                <Input type="email" placeholder="info@school.rw" value={form.schoolEmail} onChange={set('schoolEmail')} />
              </Field>
              <Field label="School phone">
                <Input placeholder="+250 788 000 000" value={form.schoolPhone} onChange={set('schoolPhone')} />
              </Field>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <GraduationCap className="h-4 w-4 text-brand-500" /> Administrator account
          </p>
          <div className="space-y-3">
            <Field label="Full name" required>
              <Input required placeholder="e.g. Mugisha Aline" value={form.adminName} onChange={set('adminName')} />
            </Field>
            <Field label="Email address" required>
              <Input type="email" required placeholder="admin@school.rw" value={form.adminEmail} onChange={set('adminEmail')} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Password" hint="10+ chars, upper, lower and a number" required>
                <Input type="password" required value={form.adminPassword} onChange={set('adminPassword')} autoComplete="new-password" />
              </Field>
              <Field label="Confirm password" required>
                <Input type="password" required value={form.confirmPassword} onChange={set('confirmPassword')} autoComplete="new-password" />
              </Field>
            </div>
          </div>
        </div>

        <ul className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500 dark:bg-[#0c1524] dark:text-slate-400">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> 12 roles, 40-mark conduct ledger and approval workflow are created automatically.
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> You can add Google Sign-In and email delivery later in Settings.
          </li>
        </ul>

        <Button type="submit" loading={busy} className="w-full">
          Create workspace
        </Button>
      </form>
    </AuthLayout>
  )
}
