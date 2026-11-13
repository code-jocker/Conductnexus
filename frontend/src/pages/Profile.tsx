import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, KeyRound, LogOut, MailCheck, MonitorSmartphone, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { useI18n } from '../lib/i18n'
import { apiError, post } from '../lib/api'
import { initials, titleCase } from '../lib/utils'
import { Alert, Badge, Button, Card, CardHeader, Field, LoadingBlock, PageHeader, Select, StatusBadge } from '../components/ui'
import { useToast } from '../components/toast'

export function ProfilePage() {
  const { me, logout, refreshMe } = useAuth()
  const { theme, setTheme } = useTheme()
  const { language, setLanguage } = useI18n()
  const { success, error: toastError } = useToast()
  const navigate = useNavigate()
  const [devLink, setDevLink] = useState<string | null>(null)

  const resend = useMutation({
    mutationFn: () => post<{ delivered: boolean; devToken?: string; message: string }>('/auth/resend-verification'),
    onSuccess: (result) => {
      success(result.message)
      if (result.devToken) setDevLink(`/verify-email?token=${result.devToken}`)
      refreshMe().catch(() => undefined)
    },
    onError: (err) => toastError(apiError(err)),
  })

  const revokeAll = useMutation({
    mutationFn: () => post('/auth/logout-all'),
    onSuccess: async () => {
      success('All sessions revoked — please sign in again')
      await logout()
      navigate('/login', { replace: true })
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (!me) return <LoadingBlock />

  const groups = me.permissions.reduce<Record<string, string[]>>((acc, permission) => {
    const prefix = permission.split('.')[0]
    acc[prefix] = acc[prefix] ?? []
    acc[prefix].push(permission)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Your account" title="Profile & security" subtitle="Review your access, verify your email and manage active sessions." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-1">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-accent text-xl font-semibold text-white shadow-lg shadow-brand-900/20">
              {initials(me.user.name)}
            </span>
            <div>
              <p className="text-lg font-semibold">{me.user.name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{me.user.email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {me.roles.map((role) => <Badge key={role} tone="brand">{titleCase(role)}</Badge>)}
              </div>
            </div>
          </div>

          <dl className="mt-6 space-y-2 text-sm">
            <Row label="Position" value={me.user.position ?? '—'} />
            <Row label="Phone" value={me.user.phone ?? '—'} />
            <Row label="Email status" value={me.user.emailVerified ? <Badge tone="emerald">Verified</Badge> : <Badge tone="amber">Not verified</Badge>} />
            <Row label="Account" value={<StatusBadge status={me.user.status} />} />
            <Row label="Sign-in method" value={titleCase(me.user.authProvider ?? 'password')} />
          </dl>

          {!me.user.emailVerified && (
            <div className="mt-4 space-y-2">
              <Alert tone="warning" title="Verify your email">
                Verifying protects password resets and important school notices.
              </Alert>
              <Button size="sm" variant="secondary" icon={MailCheck} loading={resend.isPending} onClick={() => resend.mutate()}>
                Resend verification
              </Button>
              {devLink && <p className="text-xs text-slate-500">Development link: <a href={devLink} className="font-semibold text-brand-600 hover:underline">open verification</a></p>}
            </div>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader icon={ShieldCheck} title="Security" subtitle="Password and session controls" />
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
                <div>
                  <p className="text-sm font-medium">Password</p>
                  <p className="text-xs text-slate-500">Use at least 10 characters with upper case, lower case and a number.</p>
                </div>
                <Button size="sm" variant="secondary" icon={KeyRound} onClick={() => navigate('/change-password')}>
                  Change password
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
                <div>
                  <p className="text-sm font-medium">Active sessions</p>
                  <p className="text-xs text-slate-500">Revoke every device if you suspect your account was accessed.</p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  icon={MonitorSmartphone}
                  loading={revokeAll.isPending}
                  onClick={() => {
                    if (window.confirm('Sign out of every device, including this one?')) revokeAll.mutate()
                  }}
                >
                  Sign out everywhere
                </Button>
              </div>
              <Button variant="ghost" icon={LogOut} onClick={async () => { await logout(); navigate('/login', { replace: true }) }}>
                Sign out of this device
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader icon={CheckCircle2} title="Preferences" subtitle="Appearance and language" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Theme">
                <div className="flex gap-2">
                  <Button variant={theme === 'light' ? 'primary' : 'secondary'} icon={Sun} onClick={() => setTheme('light')}>Light</Button>
                  <Button variant={theme === 'dark' ? 'primary' : 'secondary'} icon={Moon} onClick={() => setTheme('dark')}>Dark</Button>
                </div>
              </Field>
              <Field label="Language">
                <Select value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'rw')}>
                  <option value="en">English</option>
                  <option value="rw">Kinyarwanda</option>
                </Select>
              </Field>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader icon={ShieldCheck} title="Effective permissions" subtitle={`${me.permissions.length} permissions granted through your roles and overrides`} />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([group, permissions]) => (
            <div key={group}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ochre-600 dark:text-ochre-400">{titleCase(group)}</p>
              <ul className="space-y-1">
                {permissions.sort().map((permission) => (
                  <li key={permission} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" /> {permission}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}
