import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, KeyRound, LogOut, MailCheck, MessageCircle, MonitorSmartphone, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { useI18n } from '../lib/i18n'
import { apiError, del, get, post } from '../lib/api'
import { initials, titleCase } from '../lib/utils'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, LoadingBlock, PageHeader, Select, StatusBadge } from '../components/ui'
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
              <TwoFactorSecurityCard />
          {me.roles.includes('ADMIN') && (
            <>
              <EmailChangeCard currentEmail={me.user.email} />
              <TrustedDevicesCard />
            </>
          )}
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


function EmailChangeCard({ currentEmail }: { currentEmail: string }) {
  const { success, error: toastError } = useToast()
  const [newEmail, setNewEmail] = useState('princeshyakaclever@gmail.com')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const result = await post<{ message: string }>('/auth/change-email', { newEmail, password })
      success(result.message)
      setSent(true)
      setPassword('')
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-line p-3 dark:border-[#1f2f49]">
      <p className="text-sm font-medium">Change administrator email</p>
      <p className="mt-1 text-xs text-slate-500">Current address: {currentEmail}. The new address becomes active only after its owner opens the verification link.</p>
      <div className="mt-3 grid gap-2">
        <Field label="New email address">
          <Input type="email" autoComplete="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setSent(false) }} />
        </Field>
        <Field label="Confirm your current password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div>
          <Button size="sm" loading={busy} disabled={!newEmail.includes('@') || !password} onClick={submit}>Send verification link</Button>
        </div>
        {sent && <Alert tone="success" title="Verification email requested">Check the new inbox and open the verification link. Your current address remains active until then.</Alert>}
      </div>
    </div>
  )
}

type TrustedDeviceItem = {
  _id: string
  deviceName: string
  userAgent?: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

function TrustedDevicesCard() {
  const { success, error: toastError } = useToast()
  const [devices, setDevices] = useState<TrustedDeviceItem[]>([])
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const result = await get<{ devices: TrustedDeviceItem[] }>('/auth/trusted-devices')
      setDevices(result.devices)
    } catch (err) {
      toastError(apiError(err))
    }
  }

  useEffect(() => { load() }, [])

  async function revoke(id?: string) {
    setBusy(true)
    try {
      if (id) await del(`/auth/trusted-devices/${id}`)
      else await del('/auth/trusted-devices')
      success(id ? 'Trusted device revoked' : 'All trusted devices revoked')
      await load()
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-line p-3 dark:border-[#1f2f49]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Trusted devices</p>
          <p className="text-xs text-slate-500">These browsers can skip the email code for up to 30 days. Your password is still required.</p>
        </div>
        {devices.length > 0 && <Button size="sm" variant="danger" loading={busy} onClick={() => revoke()}>Revoke all</Button>}
      </div>
      <div className="mt-3 space-y-2">
        {devices.length === 0 ? <p className="text-xs text-slate-500">No active trusted devices.</p> : devices.map((device) => (
          <div key={device._id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2 dark:border-[#26374f]">
            <div className="min-w-0">
              <p className="text-sm font-medium">{device.deviceName}</p>
              <p className="text-[11px] text-slate-500">Last used: {new Date(device.lastUsedAt).toLocaleString()} · Expires: {new Date(device.expiresAt).toLocaleDateString()}</p>
            </div>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => revoke(device._id)}>Revoke</Button>
          </div>
        ))}
      </div>
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

type TwoFactorChannel = 'email' | 'whatsapp'
type TwoFactorStatus = {
  enabled: boolean
  mandatory: boolean
  channels: TwoFactorChannel[]
  email: string
  phone?: string
}

function TwoFactorSecurityCard() {
  const { success, error: toastError } = useToast()
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [channel, setChannel] = useState<TwoFactorChannel>('email')
  const [code, setCode] = useState('')
  const [awaitingCode, setAwaitingCode] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [disabling, setDisabling] = useState(false)

  async function load() {
    try {
      const next = await get<TwoFactorStatus>('/auth/2fa/status')
      setStatus(next)
      if (!next.channels.includes(channel)) setChannel(next.channels[0] ?? 'email')
    } catch (err) {
      toastError(apiError(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startEnrollment() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await post<{
        channel: TwoFactorChannel
        channels: TwoFactorChannel[]
        maskedDestination: string
        delivered: boolean
        warning?: string
        devCode?: string
      }>('/auth/2fa/enroll', { password, channel })
      setAwaitingCode(true)
      setCode(result.devCode ?? '')
      setDevCode(result.devCode ?? null)
      setNotice(
        result.delivered
          ? `A verification code was sent to ${result.maskedDestination} by ${result.channel === 'whatsapp' ? 'WhatsApp' : 'email'}.`
          : result.warning ?? 'The code could not be delivered. Try the other channel.',
      )
      setPassword('')
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnrollment() {
    setBusy(true)
    try {
      await post('/auth/2fa/enroll/confirm', { code: code.trim() })
      success('Two-factor authentication is now enabled')
      setAwaitingCode(false)
      setCode('')
      setDevCode(null)
      setNotice(null)
      await load()
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (!window.confirm('Turn off two-factor authentication? Your account will be protected by your password alone.')) return
    setBusy(true)
    try {
      await post('/auth/2fa/disable', { password: password })
      success('Two-factor authentication is disabled')
      setDisabling(false)
      setPassword('')
      await load()
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <div className="rounded-lg border border-line p-3 dark:border-[#1f2f49]">
        <p className="text-sm font-medium">Two-factor authentication</p>
        <p className="text-xs text-slate-500">Checking your security settings…</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-line p-3 dark:border-[#1f2f49]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            Two-factor authentication
            {status.enabled ? <Badge tone="emerald">Enabled</Badge> : status.mandatory ? <Badge tone="amber">Required</Badge> : <Badge tone="slate">Off</Badge>}
          </p>
          <p className="text-xs text-slate-500">
            Every sign-in requires a 6-digit code sent by email{status.phone ? ' or WhatsApp' : ''} after your password.
          </p>
        </div>
        {status.enabled ? (
          <Button size="sm" variant="secondary" onClick={() => setDisabling((v) => !v)}>
            {disabling ? 'Cancel' : 'Turn off'}
          </Button>
        ) : null}
      </div>

      {status.mandatory && !status.enabled && (
        <Alert tone="warning" title="Required by your school">
          Your administrator requires two-factor authentication. Set it up now to keep signing in.
        </Alert>
      )}
      {notice && <p className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">{notice}</p>}

      {status.enabled ? (
        disabling ? (
          <div className="mt-3 space-y-2">
            <Field label="Confirm your password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
            </Field>
            <Button size="sm" variant="danger" loading={busy} onClick={disable}>Turn off two-factor</Button>
          </div>
        ) : null
      ) : awaitingCode ? (
        <div className="mt-3 space-y-2">
          <Field label="Enter the 6-digit code" required>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="tracking-[0.4em]"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </Field>
          {devCode && <p className="text-xs text-slate-500">Development code: <span className="font-mono font-semibold">{devCode}</span></p>}
          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={confirmEnrollment} disabled={code.length !== 6}>Confirm and enable</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAwaitingCode(false); setCode(''); setDevCode(null); setNotice(null) }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Field label="Confirm your password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
          </Field>
          <Field label="Send codes by">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as TwoFactorChannel)}>
              <option value="email">Email</option>
              {status.channels.includes('whatsapp') && <option value="whatsapp">WhatsApp</option>}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Button
              size="sm"
              icon={channel === 'whatsapp' ? MessageCircle : MailCheck}
              loading={busy}
              disabled={!password}
              onClick={startEnrollment}
            >
              Set up two-factor
            </Button>
            {!status.phone && (
              <p className="mt-1 text-[11px] text-slate-400">
                Add a mobile number to your profile to receive codes on WhatsApp.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
