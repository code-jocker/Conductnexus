import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, CalendarClock, Database, Gauge, Save, Shield, SlidersHorizontal, TimerReset, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { apiError, get, patch } from '../lib/api'
import type { Settings } from '../lib/types'
import { titleCase } from '../lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Tabs,
  Textarea,
  Toggle,
} from '../components/ui'
import { useToast } from '../components/toast'

type TabKey = 'school' | 'academic' | 'discipline' | 'risk' | 'comms' | 'governance'

const SEVERITIES = ['minor', 'moderate', 'serious', 'critical'] as const

export function SettingsPage() {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const { has } = useAuth()
  const [tab, setTab] = useState<TabKey>('school')
  const [form, setForm] = useState<Settings | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') })

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      patch<Settings>('/settings', {
        school: form!.school,
        academic: form!.academic,
        discipline: form!.discipline,
        risk: form!.risk,
        comms: form!.comms,
        backup: { schedule: form!.backup.schedule, retentionDays: form!.backup.retentionDays, rpoHours: form!.backup.rpoHours, rtoHours: form!.backup.rtoHours },
        retention: form!.retention,
        security: form!.security,
      }),
    onSuccess: (updated) => {
      setForm(updated)
      success('Settings saved')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['structure-options'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (isLoading || !form) return <LoadingBlock label="Loading school settings…" />

  const canEdit = has('settings.manage')

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Maintenance"
        title="System settings"
        subtitle="Configure the school, discipline rules, risk thresholds, messaging and data-retention policy without a developer."
        actions={
          canEdit && (
            <Button icon={Save} loading={save.isPending} onClick={() => save.mutate()}>
              Save all changes
            </Button>
          )
        }
      />

      {!canEdit && <Alert tone="warning" title="Read-only access">You can review settings, but only administrators with settings.manage may change them.</Alert>}

      <Tabs<TabKey>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'school', label: 'School' },
          { key: 'academic', label: 'Academic' },
          { key: 'discipline', label: 'Discipline' },
          { key: 'risk', label: 'Risk' },
          { key: 'comms', label: 'Communications' },
          { key: 'governance', label: 'Data & security' },
        ]}
      />

      <fieldset disabled={!canEdit} className="space-y-4">
        {tab === 'school' && (
          <Card>
            <CardHeader icon={Building2} title="School identity" subtitle="Shown on letters, PDFs and the parent portal" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="School name" required>
                <Input value={form.school.name} onChange={(e) => setForm({ ...form, school: { ...form.school, name: e.target.value } })} />
              </Field>
              <Field label="Short name">
                <Input value={form.school.shortName} onChange={(e) => setForm({ ...form, school: { ...form.school, shortName: e.target.value } })} />
              </Field>
              <Field label="Motto" className="sm:col-span-2">
                <Input value={form.school.motto} onChange={(e) => setForm({ ...form, school: { ...form.school, motto: e.target.value } })} />
              </Field>
              <Field label="Address">
                <Input value={form.school.address} onChange={(e) => setForm({ ...form, school: { ...form.school, address: e.target.value } })} />
              </Field>
              <Field label="Phone">
                <Input value={form.school.phone} onChange={(e) => setForm({ ...form, school: { ...form.school, phone: e.target.value } })} placeholder="+250 …" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.school.email} onChange={(e) => setForm({ ...form, school: { ...form.school, email: e.target.value } })} />
              </Field>
              <Field label="Website">
                <Input value={form.school.website} onChange={(e) => setForm({ ...form, school: { ...form.school, website: e.target.value } })} />
              </Field>
              <Field label="Logo URL" className="sm:col-span-2" hint="A square PNG or SVG hosted on the school website.">
                <Input value={form.school.logoUrl} onChange={(e) => setForm({ ...form, school: { ...form.school, logoUrl: e.target.value } })} />
              </Field>
            </div>
          </Card>
        )}

        {tab === 'academic' && (
          <Card>
            <CardHeader icon={CalendarClock} title="Academic defaults" subtitle="Used when new terms and conduct ledgers are created" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Starting conduct marks" hint="Default marks per learner each term (40 in the national model).">
                <Input type="number" min={1} max={200} value={form.academic.startingMarks} onChange={(e) => setForm({ ...form, academic: { ...form.academic, startingMarks: Number(e.target.value) } })} />
              </Field>
              <Field label="Timezone">
                <Input value={form.academic.timezone} onChange={(e) => setForm({ ...form, academic: { ...form.academic, timezone: e.target.value } })} placeholder="Africa/Kigali" />
              </Field>
              <Field label="Default language">
                <Select value={form.academic.language} onChange={(e) => setForm({ ...form, academic: { ...form.academic, language: e.target.value as 'en' | 'rw' } })}>
                  <option value="en">English</option>
                  <option value="rw">Kinyarwanda</option>
                </Select>
              </Field>
              <Field label="Currency">
                <Input value={form.academic.currency} onChange={(e) => setForm({ ...form, academic: { ...form.academic, currency: e.target.value } })} placeholder="RWF" />
              </Field>
            </div>
          </Card>
        )}

        {tab === 'discipline' && (
          <Card>
            <CardHeader icon={SlidersHorizontal} title="Discipline workflow" subtitle="How incidents are reviewed and how many marks can be deducted" />
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Require independent review</p>
                  <p className="text-xs text-slate-500">A second staff member must approve incidents before marks are deducted.</p>
                </div>
                <Toggle checked={form.discipline.requireReview} onChange={(v) => setForm({ ...form, discipline: { ...form.discipline, requireReview: v } })} label="Require review" />
              </div>
              <Field label="Auto-approve these severities" hint="Only use when the school trusts reporters for low-level incidents.">
                <div className="flex flex-wrap gap-4 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
                  {SEVERITIES.map((severity) => (
                    <Checkbox
                      key={severity}
                      checked={form.discipline.autoApproveSeverities.includes(severity)}
                      onChange={() =>
                        setForm({
                          ...form,
                          discipline: {
                            ...form.discipline,
                            autoApproveSeverities: form.discipline.autoApproveSeverities.includes(severity)
                              ? form.discipline.autoApproveSeverities.filter((s) => s !== severity)
                              : [...form.discipline.autoApproveSeverities, severity],
                          },
                        })
                      }
                      label={titleCase(severity)}
                    />
                  ))}
                </div>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="High-impact deduction" hint="Incidents at or above this deduction require leadership approval.">
                  <Input type="number" min={1} max={40} value={form.discipline.highImpactDeduction} onChange={(e) => setForm({ ...form, discipline: { ...form.discipline, highImpactDeduction: Number(e.target.value) } })} />
                </Field>
                <Field label="Maximum backdating (days)" hint="How far in the past a teacher may record an incident.">
                  <Input type="number" min={0} max={365} value={form.discipline.maxBackdatingDays} onChange={(e) => setForm({ ...form, discipline: { ...form.discipline, maxBackdatingDays: Number(e.target.value) } })} />
                </Field>
              </div>
            </div>
          </Card>
        )}

        {tab === 'risk' && (
          <Card>
            <CardHeader icon={Gauge} title="Risk engine" subtitle="Thresholds are applied against the current conduct balance" />
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Green — good standing" hint="Balance at or above this value.">
                  <Input type="number" min={1} value={form.risk.thresholds.green} onChange={(e) => setForm({ ...form, risk: { ...form.risk, thresholds: { ...form.risk.thresholds, green: Number(e.target.value) } } })} />
                </Field>
                <Field label="Yellow — watch" hint="Balance below green but at or above this value.">
                  <Input type="number" min={1} value={form.risk.thresholds.yellow} onChange={(e) => setForm({ ...form, risk: { ...form.risk, thresholds: { ...form.risk.thresholds, yellow: Number(e.target.value) } } })} />
                </Field>
                <Field label="Orange — high risk" hint="Balance below yellow but at or above this value.">
                  <Input type="number" min={1} value={form.risk.thresholds.orange} onChange={(e) => setForm({ ...form, risk: { ...form.risk, thresholds: { ...form.risk.thresholds, orange: Number(e.target.value) } } })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Serious incident window (days)" hint="Recent serious incidents raise risk even when marks recover.">
                  <Input type="number" min={1} max={365} value={form.risk.seriousRecentDays} onChange={(e) => setForm({ ...form, risk: { ...form.risk, seriousRecentDays: Number(e.target.value) } })} />
                </Field>
                <Field label="Repeat offence threshold" hint="Number of similar offences that triggers escalation.">
                  <Input type="number" min={1} max={20} value={form.risk.repeatOffenceThreshold} onChange={(e) => setForm({ ...form, risk: { ...form.risk, repeatOffenceThreshold: Number(e.target.value) } })} />
                </Field>
              </div>
              <Alert tone="info" title="How risk is calculated">
                Below {form.risk.thresholds.orange} marks is critical (red); below {form.risk.thresholds.yellow} is high (orange); below {form.risk.thresholds.green} is watch (yellow); otherwise the learner is in good standing (green). Review with the discipline committee each term.
              </Alert>
            </div>
          </Card>
        )}

        {tab === 'comms' && (
          <Card>
            <CardHeader icon={Bell} title="Parent communications" subtitle="Consent, quiet hours and delivery channels" />
            <div className="space-y-4 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
                  <div>
                    <p className="text-sm font-medium">WhatsApp channel</p>
                    <p className="text-xs text-slate-500">Default channel for parent messages. Uses the connected school phone session.</p>
                  </div>
                  <Toggle checked={form.comms.whatsappEnabled} onChange={(v) => setForm({ ...form, comms: { ...form.comms, whatsappEnabled: v } })} label="WhatsApp enabled" />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
                  <div>
                    <p className="text-sm font-medium">Delivery policy</p>
                    <p className="text-xs text-slate-500">Parent messages are sent through WhatsApp only. SMS and email fallbacks are disabled.</p>
                  </div>
                  <Badge tone="emerald">WhatsApp only</Badge>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Quiet hours start" hint="Kigali time, 24h clock">
                  <Input type="number" min={0} max={23} value={form.comms.quietHoursStart} onChange={(e) => setForm({ ...form, comms: { ...form.comms, quietHoursStart: Number(e.target.value) } })} />
                </Field>
                <Field label="Quiet hours end">
                  <Input type="number" min={0} max={23} value={form.comms.quietHoursEnd} onChange={(e) => setForm({ ...form, comms: { ...form.comms, quietHoursEnd: Number(e.target.value) } })} />
                </Field>
                <Field label="Retry limit">
                  <Input type="number" min={0} max={10} value={form.comms.retryLimit} onChange={(e) => setForm({ ...form, comms: { ...form.comms, retryLimit: Number(e.target.value) } })} />
                </Field>
              </div>
              {has('notifications.manage') && (
                <Alert tone="info" title="WhatsApp connection">
                  Connect the school phone from Communications → WhatsApp and keep it online. Messages queue until the session is ready.
                </Alert>
              )}
              <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
                <div>
                  <p className="text-sm font-medium">Notify parents on deduction</p>
                  <p className="text-xs text-slate-500">Send a consent-aware message when a deduction is approved.</p>
                </div>
                <Toggle checked={form.comms.notifyOnDeduction} onChange={(v) => setForm({ ...form, comms: { ...form.comms, notifyOnDeduction: v } })} label="Notify on deduction" />
              </div>
              <Alert tone="info" title="Quiet hours">
                Messages queued during {form.comms.quietHoursStart}:00–{form.comms.quietHoursEnd}:00 Kigali time are held and delivered afterwards.
              </Alert>
            </div>
          </Card>
        )}

        {tab === 'governance' && (
          <div className="space-y-4">
            <Card>
              <CardHeader icon={Database} title="Data retention" subtitle="Aligned with Rwanda's data protection requirements" />
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Student records (years)">
                  <Input type="number" min={1} max={50} value={form.retention.studentRecordsYears} onChange={(e) => setForm({ ...form, retention: { ...form.retention, studentRecordsYears: Number(e.target.value) } })} />
                </Field>
                <Field label="Discipline records (years)">
                  <Input type="number" min={1} max={50} value={form.retention.disciplineYears} onChange={(e) => setForm({ ...form, retention: { ...form.retention, disciplineYears: Number(e.target.value) } })} />
                </Field>
                <Field label="Evidence files (years)">
                  <Input type="number" min={1} max={50} value={form.retention.evidenceYears} onChange={(e) => setForm({ ...form, retention: { ...form.retention, evidenceYears: Number(e.target.value) } })} />
                </Field>
                <Field label="Audit logs (years)">
                  <Input type="number" min={1} max={50} value={form.retention.auditYears} onChange={(e) => setForm({ ...form, retention: { ...form.retention, auditYears: Number(e.target.value) } })} />
                </Field>
                <Field label="Safeguarding records (years)">
                  <Input type="number" min={1} max={50} value={form.retention.safeguardingYears} onChange={(e) => setForm({ ...form, retention: { ...form.retention, safeguardingYears: Number(e.target.value) } })} />
                </Field>
              </div>
            </Card>

            <Card>
              <CardHeader icon={Shield} title="Security" subtitle="Login protection and session management" />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <Field label="Maximum failed logins" hint="After this, the account locks temporarily.">
                  <Input type="number" min={3} max={20} value={form.security.maxFailedLogins} onChange={(e) => setForm({ ...form, security: { ...form.security, maxFailedLogins: Number(e.target.value) } })} />
                </Field>
                <Field label="Lockout duration (minutes)">
                  <Input type="number" min={1} max={240} value={form.security.lockoutMinutes} onChange={(e) => setForm({ ...form, security: { ...form.security, lockoutMinutes: Number(e.target.value) } })} />
                </Field>
                <Field label="Session lifetime (days)">
                  <Input type="number" min={1} max={90} value={form.security.sessionDays} onChange={(e) => setForm({ ...form, security: { ...form.security, sessionDays: Number(e.target.value) } })} />
                </Field>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
                  <div>
                    <p className="text-sm font-medium">Require email verification</p>
                    <p className="text-xs text-slate-500">Accounts must verify their email before signing in.</p>
                  </div>
                  <Toggle checked={form.security.requireEmailVerification} onChange={(v) => setForm({ ...form, security: { ...form.security, requireEmailVerification: v } })} label="Require email verification" />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-3 dark:border-[#1f2f49] sm:col-span-2">
                  <div>
                    <p className="text-sm font-medium">Require two-factor authentication</p>
                    <p className="text-xs text-slate-500">
                      Every sign-in needs a 6-digit code. Only enable this after email (SMTP/Gmail) or WhatsApp delivery is configured, otherwise users cannot sign in.
                    </p>
                  </div>
                  <Toggle checked={form.security.requireTwoFactor} onChange={(v) => setForm({ ...form, security: { ...form.security, requireTwoFactor: v } })} label="Require two-factor authentication" />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader icon={TimerReset} title="Backup & disaster recovery" subtitle={`RPO ${form.backup.rpoHours}h · RTO ${form.backup.rtoHours}h · schedule "${form.backup.schedule}"`} />
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Cron schedule">
                  <Input value={form.backup.schedule} onChange={(e) => setForm({ ...form, backup: { ...form.backup, schedule: e.target.value } })} placeholder="0 2 * * *" />
                </Field>
                <Field label="Retention (days)">
                  <Input type="number" min={1} max={3650} value={form.backup.retentionDays} onChange={(e) => setForm({ ...form, backup: { ...form.backup, retentionDays: Number(e.target.value) } })} />
                </Field>
                <Field label="RPO (hours)">
                  <Input type="number" min={1} max={168} value={form.backup.rpoHours} onChange={(e) => setForm({ ...form, backup: { ...form.backup, rpoHours: Number(e.target.value) } })} />
                </Field>
                <Field label="RTO (hours)">
                  <Input type="number" min={1} max={168} value={form.backup.rtoHours} onChange={(e) => setForm({ ...form, backup: { ...form.backup, rtoHours: Number(e.target.value) } })} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm dark:border-[#1f2f49]">
                <Badge tone={form.backup.lastStatus === 'completed' ? 'emerald' : form.backup.lastStatus === 'failed' ? 'red' : 'slate'}>
                  Last backup: {form.backup.lastStatus ? titleCase(form.backup.lastStatus) : 'never'}
                </Badge>
                {has('backups.manage') && <Link to="/monitoring" className="text-xs font-semibold text-brand-600 hover:underline">Open backup centre →</Link>}
              </div>
            </Card>

            <Card>
              <CardHeader icon={Wrench} title="Maintenance shortcuts" subtitle="Everything a school administrator needs, no developer required" />
              <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <Link to="/structure" className="rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-slate-50 dark:border-[#1f2f49] dark:hover:bg-white/[0.03]">School structure →</Link>
                <Link to="/users" className="rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-slate-50 dark:border-[#1f2f49] dark:hover:bg-white/[0.03]">Users & roles →</Link>
                <Link to="/communications" className="rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-slate-50 dark:border-[#1f2f49] dark:hover:bg-white/[0.03]">Message templates →</Link>
                <Link to="/monitoring" className="rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-slate-50 dark:border-[#1f2f49] dark:hover:bg-white/[0.03]">Monitoring & backups →</Link>
                <Link to="/data-protection" className="rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-slate-50 dark:border-[#1f2f49] dark:hover:bg-white/[0.03]">Data protection centre →</Link>
                <Link to="/audit" className="rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-slate-50 dark:border-[#1f2f49] dark:hover:bg-white/[0.03]">Audit trail →</Link>
              </div>
            </Card>
          </div>
        )}
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-4 z-10 flex justify-end">
          <Button icon={Save} loading={save.isPending} className="shadow-lift" onClick={() => save.mutate()}>
            Save all changes
          </Button>
        </div>
      )}
    </div>
  )
}

