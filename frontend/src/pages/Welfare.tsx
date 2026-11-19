import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  ClipboardCheck,
  FileHeart,
  HandHeart,
  HeartPulse,
  Plus,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, patch, post } from '../lib/api'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
import { StudentPicker, type PickedStudent } from '../components/StudentPicker'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  Tabs,
  Textarea,
  Toggle,
} from '../components/ui'
import { useToast } from '../components/toast'

type TabKey = 'overview' | 'appointments' | 'records' | 'referrals' | 'plans' | 'followups' | 'detention'

type StudentRef = { _id?: string; fullName?: string; studentId?: string; classId?: { name?: string } | string } | string | null
type PersonRef = { _id?: string; name?: string; position?: string } | string | null

type Appointment = {
  _id: string
  reference: string
  studentId: StudentRef
  counsellorId: PersonRef
  scheduledAt: string
  durationMinutes: number
  mode: string
  location?: string
  reason: string
  status: string
  guardianInformed?: boolean
  completedAt?: string
}

type CounsellingRecord = {
  _id: string
  reference: string
  studentId: StudentRef
  counsellorId: PersonRef
  sessionDate: string
  presentingConcern?: string
  sessionNotes?: string
  riskLevel: string
  interventions?: string[]
  outcome?: string
  followUpRequired?: boolean
  escalatedCaseId?: { caseNumber?: string } | string | null
}

type Referral = {
  _id: string
  reference: string
  studentId: StudentRef
  fromStaffId: PersonRef
  assignedTo?: PersonRef
  service: string
  destination: string
  reason: string
  urgency: string
  consentObtained: boolean
  status: string
  outcome?: string
  createdAt?: string
}

type PlanGoal = { description: string; actions?: string; targetDate?: string; progress?: number; status?: string }
type SupportPlan = {
  _id: string
  reference: string
  studentId: StudentRef
  assignedTo?: PersonRef
  title: string
  reason?: string
  category: string
  goals?: PlanGoal[]
  startDate?: string
  reviewDate?: string
  status: string
  outcome?: string
  reopenCount?: number
}

type WelfareFollowUp = {
  _id: string
  type: string
  status: string
  dueDate: string
  notes?: string
  studentId: StudentRef
  assignedTo?: PersonRef
}

type Detention = {
  _id: string
  reference: string
  studentId: StudentRef
  supervisorId: PersonRef
  reason: string
  scheduledAt: string
  durationMinutes: number
  location: string
  status: string
}

type Overview = {
  counts: { openPlans: number; openReferrals: number; upcomingAppointments: number; pendingFollowUps: number; overdueFollowUps: number }
  appointments: Appointment[]
  plans: SupportPlan[]
  referrals: Referral[]
  followUps: WelfareFollowUp[]
  scope: 'all' | 'assigned'
}

type StaffOption = { _id: string; name: string; position?: string }

function sid(ref: StudentRef): string {
  if (!ref || typeof ref === 'string') return ''
  return ref._id ?? ''
}
function studentName(ref: StudentRef): string {
  if (!ref || typeof ref === 'string') return 'Student'
  return ref.fullName ?? 'Student'
}
function studentRef(ref: StudentRef): string {
  if (!ref || typeof ref === 'string') return ''
  return ref.studentId ?? ''
}
function personName(ref: PersonRef | undefined): string {
  if (!ref) return 'Unassigned'
  return typeof ref === 'string' ? ref : ref.name ?? 'Staff'
}
function idOf(ref?: { _id?: string } | string | null): string {
  if (!ref) return ''
  return typeof ref === 'string' ? ref : ref._id ?? ''
}

function statusTone(status?: string): string {
  if (!status) return 'slate'
  if (['completed', 'closed', 'attended', 'accepted'].includes(status)) return 'emerald'
  if (['cancelled', 'declined', 'missed'].includes(status)) return 'red'
  if (['in_progress', 'reopened', 'scheduled', 'pending'].includes(status)) return 'amber'
  return 'slate'
}

function useWelfareStaff(enabled: boolean) {
  return useQuery({
    queryKey: ['welfare-staff'],
    queryFn: () => get<StaffOption[]>('/welfare/staff'),
    enabled,
    staleTime: 5 * 60_000,
  })
}

function StaffSelect({ value, onChange, staff, placeholder = 'Select staff member' }: { value: string; onChange: (v: string) => void; staff?: StaffOption[]; placeholder?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">{placeholder}</option>
      {(staff ?? []).map((member) => (
        <option key={member._id} value={member._id}>
          {member.name}{member.position ? ` — ${member.position}` : ''}
        </option>
      ))}
    </Select>
  )
}

function StudentLine({ student }: { student: StudentRef }) {
  return (
    <span>
      <span className="font-medium">{studentName(student)}</span>
      {studentRef(student) ? <span className="ml-2 text-xs text-slate-400">{studentRef(student)}</span> : null}
      {typeof student === 'object' && student?.classId && typeof student.classId === 'object' && student.classId.name ? (
        <span className="ml-2 text-xs text-slate-400">· {student.classId.name}</span>
      ) : null}
    </span>
  )
}

export function WelfarePage() {
  const { has } = useAuth()
  const canView = has('welfare.view')
  const canRefer = has('welfare.refer') || has('welfare.manage')
  const tabs = (
    [
      canView ? { key: 'overview' as const, label: 'Overview' } : null,
      canView ? { key: 'appointments' as const, label: 'Counselling' } : null,
      has('welfare.records.view') ? { key: 'records' as const, label: 'Session records' } : null,
      canRefer ? { key: 'referrals' as const, label: 'Referrals' } : null,
      canView ? { key: 'plans' as const, label: 'Support plans' } : null,
      canView ? { key: 'followups' as const, label: 'Follow-ups' } : null,
      has('detention.view') ? { key: 'detention' as const, label: 'Detention' } : null,
    ].filter(Boolean) as { key: TabKey; label: string }[]
  )
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<TabKey>(() => {
    const requested = searchParams.get('tab') as TabKey | null
    return tabs.find((item) => item.key === requested)?.key ?? tabs[0]?.key ?? 'referrals'
  })

  if (!tabs.length) {
    return <Alert tone="warning" title="Welfare centre unavailable">Your role does not include welfare authorization.</Alert>
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Student care"
        title="Welfare centre"
        subtitle="Counselling, referrals, support plans and detention. Welfare notes are confidential, access-logged and never deducted from conduct marks."
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab onGo={setTab} />}
      {tab === 'appointments' && <AppointmentsTab />}
      {tab === 'records' && <RecordsTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'followups' && <FollowUpsTab />}
      {tab === 'detention' && <DetentionTab />}
    </div>
  )
}

function OverviewTab({ onGo }: { onGo: (tab: TabKey) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['welfare-overview'], queryFn: () => get<Overview>('/welfare/overview') })

  if (isLoading) return <Card><div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 w-full" />)}</div></Card>

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Upcoming sessions" value={data?.counts.upcomingAppointments ?? '—'} icon={CalendarClock} tone="brand" hint="Next seven days" />
        <StatCard label="Open support plans" value={data?.counts.openPlans ?? '—'} icon={HandHeart} tone="emerald" />
        <StatCard label="Open referrals" value={data?.counts.openReferrals ?? '—'} icon={FileHeart} tone="amber" />
        <StatCard label="Welfare follow-ups" value={data?.counts.pendingFollowUps ?? '—'} icon={HeartPulse} tone="red" hint={data?.counts.overdueFollowUps ? `${data.counts.overdueFollowUps} overdue` : 'All on schedule'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming counselling" subtitle={data?.scope === 'all' ? 'Whole school' : 'Your assigned sessions'} icon={CalendarClock} actions={<Button size="sm" variant="secondary" onClick={() => onGo('appointments')}>Open</Button>} />
          {!data?.appointments.length ? (
            <EmptyState title="No sessions scheduled" message="Appointments booked in the next week appear here." />
          ) : (
            <div className="divide-y divide-line dark:divide-[#26374f]">
              {data.appointments.map((appointment) => (
                <div key={appointment._id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm"><StudentLine student={appointment.studentId} /></p>
                    <p className="text-xs text-slate-500">{formatDateTime(appointment.scheduledAt)} · {personName(appointment.counsellorId)}</p>
                  </div>
                  <Badge tone="brand">{appointment.reference}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Plans needing attention" subtitle="Active and reopened support plans" icon={HandHeart} actions={<Button size="sm" variant="secondary" onClick={() => onGo('plans')}>Open</Button>} />
          {!data?.plans.length ? (
            <EmptyState title="No active plans" message="Support plans created for students appear here." />
          ) : (
            <div className="divide-y divide-line dark:divide-[#26374f]">
              {data.plans.map((plan) => (
                <div key={plan._id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm"><StudentLine student={plan.studentId} /></p>
                    <p className="text-xs text-slate-500">{plan.title} · review {formatDate(plan.reviewDate)}</p>
                  </div>
                  <Badge tone={statusTone(plan.status)}>{titleCase(plan.status)}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Pending welfare follow-ups" subtitle="Counselling, parent meetings and boarding welfare" icon={HeartPulse} actions={<Button size="sm" variant="secondary" onClick={() => onGo('followups')}>Open</Button>} />
        {!data?.followUps.length ? (
          <EmptyState title="No pending follow-ups" message="Care commitments assigned to you appear here." />
        ) : (
          <div className="divide-y divide-line dark:divide-[#26374f]">
            {data.followUps.map((followUp) => (
              <div key={followUp._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm"><StudentLine student={followUp.studentId} /></p>
                  <p className="text-xs text-slate-500">{titleCase(followUp.type)} · due {formatDate(followUp.dueDate)} · {personName(followUp.assignedTo)}</p>
                </div>
                <Badge tone={statusTone(followUp.status)}>{titleCase(followUp.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function AppointmentsTab() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const staff = useWelfareStaff(has(['welfare.manage', 'welfare.assign']))
  const [status, setStatus] = useState('scheduled')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ student: null as PickedStudent | null, counsellorId: '', scheduledAt: '', mode: 'in_person', location: '', reason: '', guardianInformed: false })
  const [completing, setCompleting] = useState<Appointment | null>(null)
  const [session, setSession] = useState({ presentingConcern: '', sessionNotes: '', riskLevel: 'low', outcome: '', followUpRequired: false, followUpDate: '' })
  const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null)

  const { data } = useQuery({
    queryKey: ['welfare-appointments', status],
    queryFn: () => getPage<Appointment>('/welfare/appointments', { status: status || undefined, pageSize: 60 }),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['welfare-appointments'] })
    queryClient.invalidateQueries({ queryKey: ['welfare-overview'] })
  }

  const create = useMutation({
    mutationFn: () =>
      post('/welfare/appointments', {
        studentId: form.student?.id,
        counsellorId: form.counsellorId,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        mode: form.mode,
        location: form.location || undefined,
        reason: form.reason,
        guardianInformed: form.guardianInformed,
      }),
    onSuccess: () => {
      success('Counselling appointment scheduled')
      setOpen(false)
      setForm({ student: null, counsellorId: '', scheduledAt: '', mode: 'in_person', location: '', reason: '', guardianInformed: false })
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const complete = useMutation({
    mutationFn: () =>
      post(`/welfare/appointments/${completing?._id}/complete`, {
        presentingConcern: session.presentingConcern,
        sessionNotes: session.sessionNotes,
        riskLevel: session.riskLevel,
        outcome: session.outcome,
        followUpRequired: session.followUpRequired,
        followUpDate: session.followUpRequired && session.followUpDate ? new Date(session.followUpDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      success('Session recorded in the confidential register')
      setCompleting(null)
      setSession({ presentingConcern: '', sessionNotes: '', riskLevel: 'low', outcome: '', followUpRequired: false, followUpDate: '' })
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const cancel = useMutation({
    mutationFn: () => post(`/welfare/appointments/${cancelling?.id}/cancel`, { reason: cancelling?.reason }),
    onSuccess: () => {
      success('Appointment cancelled')
      setCancelling(null)
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const items = data?.items ?? []

  return (
    <Card>
      <CardHeader
        title="Counselling appointments"
        subtitle="Only the assigned counsellor and welfare leads can open a session record."
        icon={CalendarClock}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="">All statuses</option>
            </Select>
            {has('welfare.manage') && <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Schedule</Button>}
          </div>
        }
      />
      {!items.length ? (
        <EmptyState icon={CalendarClock} title="No appointments" message="Schedule a counselling session for a student in your care." />
      ) : (
        <div className="divide-y divide-line dark:divide-[#26374f]">
          {items.map((appointment) => (
            <div key={appointment._id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm"><StudentLine student={appointment.studentId} /></p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(appointment.scheduledAt)} · {appointment.durationMinutes} min · {titleCase(appointment.mode)} · {personName(appointment.counsellorId)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{appointment.reason}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(appointment.status)}>{titleCase(appointment.status)}</Badge>
                <Badge tone="slate">{appointment.reference}</Badge>
                {appointment.guardianInformed && <Badge tone="emerald">Guardian informed</Badge>}
                {appointment.status === 'scheduled' && has(['welfare.manage']) && (
                  <>
                    {has('welfare.records.view') && <Button size="sm" onClick={() => setCompleting(appointment)}>Record session</Button>}
                    <Button size="sm" variant="secondary" onClick={() => setCancelling({ id: appointment._id, reason: '' })}>Cancel</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule a counselling appointment"
        subtitle="The counsellor is notified immediately. Guardian messaging is optional."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Close</Button><Button loading={create.isPending} onClick={() => create.mutate()} disabled={!form.student || !form.counsellorId || !form.scheduledAt || form.reason.trim().length < 5}>Schedule</Button></>}
      >
        <div className="space-y-3">
          <Field label="Student" required><StudentPicker value={form.student} onChange={(student) => setForm({ ...form, student })} /></Field>
          <Field label="Counsellor" required><StaffSelect value={form.counsellorId} onChange={(counsellorId) => setForm({ ...form, counsellorId })} staff={staff.data} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date and time" required><Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></Field>
            <Field label="Mode"><Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="in_person">In person</option><option value="virtual">Virtual</option><option value="phone">Phone</option></Select></Field>
          </div>
          <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Welfare office" /></Field>
          <Field label="Reason for referral" required><Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 dark:border-[#26374f]">
            <span className="text-sm">Inform the guardian</span>
            <Toggle checked={form.guardianInformed} onChange={(guardianInformed) => setForm({ ...form, guardianInformed })} label="Inform guardian" />
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(completing)}
        onClose={() => setCompleting(null)}
        title="Record a counselling session"
        subtitle="Session notes are restricted and every read is access-logged."
        footer={<><Button variant="secondary" onClick={() => setCompleting(null)}>Close</Button><Button loading={complete.isPending} onClick={() => complete.mutate()} disabled={session.presentingConcern.trim().length < 5 || session.sessionNotes.trim().length < 5 || session.outcome.trim().length < 5}>Save record</Button></>}
      >
        <div className="space-y-3">
          <Field label="Presenting concern" required><Textarea rows={2} value={session.presentingConcern} onChange={(e) => setSession({ ...session, presentingConcern: e.target.value })} /></Field>
          <Field label="Session notes" required hint="Confidential — visible only to authorized welfare staff."><Textarea rows={5} value={session.sessionNotes} onChange={(e) => setSession({ ...session, sessionNotes: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Risk level"><Select value={session.riskLevel} onChange={(e) => setSession({ ...session, riskLevel: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></Select></Field>
            <Field label="Outcome" required><Input value={session.outcome} onChange={(e) => setSession({ ...session, outcome: e.target.value })} /></Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 dark:border-[#26374f]">
            <span className="text-sm">Assign a follow-up</span>
            <Toggle checked={session.followUpRequired} onChange={(followUpRequired) => setSession({ ...session, followUpRequired })} label="Follow-up required" />
          </div>
          {session.followUpRequired && <Field label="Follow-up date"><Input type="date" value={session.followUpDate} onChange={(e) => setSession({ ...session, followUpDate: e.target.value })} /></Field>}
        </div>
      </Modal>

      <Modal
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel appointment"
        footer={<><Button variant="secondary" onClick={() => setCancelling(null)}>Close</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()} disabled={(cancelling?.reason ?? '').trim().length < 4}>Cancel appointment</Button></>}
      >
        <Field label="Reason" required><Textarea rows={3} value={cancelling?.reason ?? ''} onChange={(e) => setCancelling((current) => (current ? { ...current, reason: e.target.value } : current))} /></Field>
      </Modal>
    </Card>
  )
}

function RecordsTab() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [riskLevel, setRiskLevel] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [escalate, setEscalate] = useState<{ id: string; category: string; severity: string; narrative: string } | null>(null)

  const { data } = useQuery({
    queryKey: ['welfare-records', riskLevel],
    queryFn: () => getPage<CounsellingRecord>('/welfare/records', { riskLevel: riskLevel || undefined, pageSize: 60 }),
  })
  const { data: record } = useQuery({
    queryKey: ['welfare-record', selectedId],
    queryFn: () => get<CounsellingRecord>(`/welfare/records/${selectedId}`),
    enabled: Boolean(selectedId),
  })

  const escalateMutation = useMutation({
    mutationFn: () => post(`/welfare/records/${escalate?.id}/escalate`, { category: escalate?.category, severity: escalate?.severity, narrative: escalate?.narrative }),
    onSuccess: () => {
      success('Escalated to a restricted safeguarding case')
      setEscalate(null)
      setSelectedId('')
      queryClient.invalidateQueries({ queryKey: ['welfare-records'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const items = data?.items ?? []

  return (
    <Card>
      <CardHeader
        title="Confidential session records"
        subtitle="Counsellors see their own records; welfare leads see the register. Every open is logged."
        icon={FileHeart}
        actions={
          <Select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className="w-40">
            <option value="">All risk levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        }
      />
      {!items.length ? (
        <EmptyState icon={FileHeart} title="No session records" message="Completed counselling sessions appear here." />
      ) : (
        <div className="divide-y divide-line dark:divide-[#26374f]">
          {items.map((item) => (
            <button key={item._id} type="button" onClick={() => setSelectedId(item._id)} className="flex w-full flex-col gap-2 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-white/5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm"><StudentLine student={item.studentId} /></p>
                <p className="text-xs text-slate-500">{formatDate(item.sessionDate)} · {personName(item.counsellorId)} · {item.outcome}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={item.riskLevel === 'critical' || item.riskLevel === 'high' ? 'red' : item.riskLevel === 'medium' ? 'amber' : 'emerald'}>{titleCase(item.riskLevel)} risk</Badge>
                <Badge tone="slate">{item.reference}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(selectedId) && Boolean(record)}
        onClose={() => setSelectedId('')}
        title={record ? `Session ${record.reference}` : 'Session record'}
        subtitle={record ? `${studentName(record.studentId)} · ${formatDate(record.sessionDate)}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelectedId('')}>Close</Button>
            {record && has('welfare.escalate') && !record.escalatedCaseId && (
              <Button variant="danger" icon={ShieldAlert} onClick={() => setEscalate({ id: record._id, category: 'protection', severity: 'high', narrative: '' })}>Escalate safeguarding</Button>
            )}
          </>
        }
      >
        {record && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs font-semibold uppercase text-slate-400">Counsellor</p><p>{personName(record.counsellorId)}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Risk</p><Badge tone={record.riskLevel === 'critical' || record.riskLevel === 'high' ? 'red' : 'amber'}>{titleCase(record.riskLevel)}</Badge></div>
            </div>
            <div><p className="text-xs font-semibold uppercase text-slate-400">Presenting concern</p><p className="mt-1 whitespace-pre-wrap">{record.presentingConcern ?? '—'}</p></div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-300">Restricted session notes</p>
              <p className="mt-1 whitespace-pre-wrap">{record.sessionNotes ?? '—'}</p>
            </div>
            {record.interventions?.length ? <div><p className="text-xs font-semibold uppercase text-slate-400">Interventions</p><p className="mt-1">{record.interventions.join(' · ')}</p></div> : null}
            <div><p className="text-xs font-semibold uppercase text-slate-400">Outcome</p><p className="mt-1 whitespace-pre-wrap">{record.outcome ?? '—'}</p></div>
            {record.followUpRequired && <Alert tone="info" title="Follow-up required">A welfare follow-up is tracked in the shared care queue.</Alert>}
            {record.escalatedCaseId && <Alert tone="warning" title="Escalated">Linked to safeguarding case {typeof record.escalatedCaseId === 'object' ? record.escalatedCaseId.caseNumber : '—'}.</Alert>}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(escalate)}
        onClose={() => setEscalate(null)}
        title="Escalate to safeguarding"
        subtitle="A restricted safeguarding case is created. Only authorized safeguarding staff can open it."
        footer={<><Button variant="secondary" onClick={() => setEscalate(null)}>Close</Button><Button variant="danger" loading={escalateMutation.isPending} onClick={() => escalateMutation.mutate()} disabled={(escalate?.narrative ?? '').trim().length < 10}>Escalate</Button></>}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category"><Select value={escalate?.category ?? 'protection'} onChange={(e) => setEscalate((c) => (c ? { ...c, category: e.target.value } : c))}><option value="bullying">Bullying</option><option value="harassment">Harassment</option><option value="abuse">Abuse</option><option value="protection">Protection</option><option value="other">Other</option></Select></Field>
            <Field label="Severity"><Select value={escalate?.severity ?? 'high'} onChange={(e) => setEscalate((c) => (c ? { ...c, severity: e.target.value } : c))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></Select></Field>
          </div>
          <Field label="Narrative" required hint="Do not copy session notes verbatim; record only what the safeguarding team needs."><Textarea rows={5} value={escalate?.narrative ?? ''} onChange={(e) => setEscalate((c) => (c ? { ...c, narrative: e.target.value } : c))} /></Field>
        </div>
      </Modal>
    </Card>
  )
}

function ReferralsTab() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const staff = useWelfareStaff(has('welfare.assign'))
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ student: null as PickedStudent | null, service: 'school_nurse', destination: '', reason: '', urgency: 'medium', consentObtained: false, consentBy: '', assignedTo: '' })

  const { data } = useQuery({ queryKey: ['welfare-referrals'], queryFn: () => getPage<Referral>('/welfare/referrals', { pageSize: 60 }) })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['welfare-referrals'] })
    queryClient.invalidateQueries({ queryKey: ['welfare-overview'] })
  }

  const create = useMutation({
    mutationFn: () =>
      post('/welfare/referrals', {
        studentId: form.student?.id,
        service: form.service,
        destination: form.destination,
        reason: form.reason,
        urgency: form.urgency,
        consentObtained: form.consentObtained,
        consentBy: form.consentBy || undefined,
        assignedTo: form.assignedTo || undefined,
      }),
    onSuccess: () => {
      success('Referral created')
      setOpen(false)
      setForm({ student: null, service: 'school_nurse', destination: '', reason: '', urgency: 'medium', consentObtained: false, consentBy: '', assignedTo: '' })
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patch(`/welfare/referrals/${id}`, { status }),
    onSuccess: () => {
      success('Referral updated')
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const items = data?.items ?? []
  const canCreate = has(['welfare.refer', 'welfare.manage'])

  return (
    <Card>
      <CardHeader
        title="Welfare referrals"
        subtitle="Internal and external services. Consent is recorded before sharing information."
        icon={FileHeart}
        actions={canCreate && <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>New referral</Button>}
      />
      {!items.length ? (
        <EmptyState icon={FileHeart} title="No referrals" message="Referrals you create or coordinate appear here." />
      ) : (
        <div className="divide-y divide-line dark:divide-[#26374f]">
          {items.map((referral) => (
            <div key={referral._id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm"><StudentLine student={referral.studentId} /></p>
                <p className="text-xs text-slate-500">{titleCase(referral.service)} → {referral.destination} · {personName(referral.fromStaffId)}</p>
                <p className="mt-1 text-xs text-slate-500">{referral.reason}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={referral.urgency === 'critical' || referral.urgency === 'high' ? 'red' : referral.urgency === 'medium' ? 'amber' : 'slate'}>{titleCase(referral.urgency)}</Badge>
                <Badge tone={statusTone(referral.status)}>{titleCase(referral.status)}</Badge>
                <Badge tone="slate">{referral.reference}</Badge>
                {has('welfare.manage') && referral.status !== 'closed' && (
                  <Select
                    value=""
                    onChange={(e) => e.target.value && update.mutate({ id: referral._id, status: e.target.value })}
                    className="w-32"
                    aria-label="Update referral status"
                  >
                    <option value="">Update…</option>
                    <option value="accepted">Accept</option>
                    <option value="in_progress">In progress</option>
                    <option value="closed">Close</option>
                    <option value="declined">Decline</option>
                  </Select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a welfare referral"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Close</Button><Button loading={create.isPending} onClick={() => create.mutate()} disabled={!form.student || form.destination.trim().length < 2 || form.reason.trim().length < 5}>Create referral</Button></>}
      >
        <div className="space-y-3">
          <Field label="Student" required><StudentPicker value={form.student} onChange={(student) => setForm({ ...form, student })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Service"><Select value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}><option value="school_nurse">School nurse</option><option value="external_counsellor">External counsellor</option><option value="psychologist">Psychologist</option><option value="hospital">Hospital</option><option value="social_services">Social services</option><option value="police">Police</option><option value="family">Family</option><option value="ngo">NGO</option><option value="other">Other</option></Select></Field>
            <Field label="Urgency"><Select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></Select></Field>
          </div>
          <Field label="Destination" required><Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="e.g. Kigali referral hospital" /></Field>
          <Field label="Reason" required><Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <Field label="Assign to (optional)"><StaffSelect value={form.assignedTo} onChange={(assignedTo) => setForm({ ...form, assignedTo })} staff={staff.data} placeholder="Unassigned — welfare leads notified" /></Field>
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 dark:border-[#26374f]">
            <span className="text-sm">Consent obtained</span>
            <Toggle checked={form.consentObtained} onChange={(consentObtained) => setForm({ ...form, consentObtained })} label="Consent obtained" />
          </div>
          {form.consentObtained && <Field label="Consent given by"><Input value={form.consentBy} onChange={(e) => setForm({ ...form, consentBy: e.target.value })} placeholder="Guardian name or relationship" /></Field>}
        </div>
      </Modal>
    </Card>
  )
}

function PlansTab() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const staff = useWelfareStaff(has(['welfare.manage', 'welfare.assign']))
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ student: null as PickedStudent | null, title: '', reason: '', category: 'wellbeing', assignedTo: '', reviewDate: '', goal: '', goalActions: '' })
  const [action, setAction] = useState<{ plan: SupportPlan; type: 'review' | 'close' | 'reopen'; note: string } | null>(null)

  const { data } = useQuery({ queryKey: ['welfare-plans'], queryFn: () => getPage<SupportPlan>('/welfare/plans', { pageSize: 60 }) })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['welfare-plans'] })
    queryClient.invalidateQueries({ queryKey: ['welfare-overview'] })
  }

  const create = useMutation({
    mutationFn: () =>
      post('/welfare/plans', {
        studentId: form.student?.id,
        title: form.title,
        reason: form.reason,
        category: form.category,
        assignedTo: form.assignedTo,
        reviewDate: form.reviewDate || undefined,
        goals: form.goal ? [{ description: form.goal, actions: form.goalActions || undefined }] : [],
      }),
    onSuccess: () => {
      success('Support plan created')
      setOpen(false)
      setForm({ student: null, title: '', reason: '', category: 'wellbeing', assignedTo: '', reviewDate: '', goal: '', goalActions: '' })
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const act = useMutation({
    mutationFn: () => {
      if (!action) return Promise.reject(new Error('No plan selected'))
      const body = action.type === 'review' ? { note: action.note } : action.type === 'close' ? { outcome: action.note } : { reason: action.note }
      return post(`/welfare/plans/${action.plan._id}/${action.type}`, body)
    },
    onSuccess: () => {
      success('Support plan updated')
      setAction(null)
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const items = data?.items ?? []

  return (
    <Card>
      <CardHeader
        title="Student support plans"
        subtitle="Documented goals, review dates and outcomes. Plans are separated from discipline sanctions."
        icon={HandHeart}
        actions={has('welfare.manage') && <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>New plan</Button>}
      />
      {!items.length ? (
        <EmptyState icon={HandHeart} title="No support plans" message="Create a plan to coordinate care for a student." />
      ) : (
        <div className="divide-y divide-line dark:divide-[#26374f]">
          {items.map((plan) => (
            <div key={plan._id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm"><StudentLine student={plan.studentId} /></p>
                  <p className="text-xs text-slate-500">{plan.title} · {titleCase(plan.category)} · owner {personName(plan.assignedTo)}</p>
                  <p className="mt-1 text-xs text-slate-500">Review {formatDate(plan.reviewDate)} · started {formatDate(plan.startDate)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(plan.status)}>{titleCase(plan.status)}</Badge>
                  <Badge tone="slate">{plan.reference}</Badge>
                </div>
              </div>
              {plan.goals?.length ? (
                <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5">
                  {plan.goals.map((goal, index) => (
                    <div key={index} className="flex items-center justify-between gap-3 text-xs">
                      <span>{goal.description}{goal.actions ? ` — ${goal.actions}` : ''}</span>
                      <span className="font-semibold">{goal.progress ?? 0}%</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {plan.outcome && <p className="text-xs text-slate-500">Outcome: {plan.outcome}</p>}
              {has('welfare.manage') && (
                <div className="flex flex-wrap gap-2">
                  {!['completed', 'abandoned'].includes(plan.status) && <Button size="sm" variant="secondary" onClick={() => setAction({ plan, type: 'review', note: '' })}>Review</Button>}
                  {plan.status !== 'completed' && <Button size="sm" variant="secondary" onClick={() => setAction({ plan, type: 'close', note: '' })}>Close</Button>}
                  {['completed', 'abandoned'].includes(plan.status) && <Button size="sm" variant="secondary" onClick={() => setAction({ plan, type: 'reopen', note: '' })}>Reopen</Button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a student support plan"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Close</Button><Button loading={create.isPending} onClick={() => create.mutate()} disabled={!form.student || form.title.trim().length < 3 || form.reason.trim().length < 5 || !form.assignedTo}>Create plan</Button></>}
      >
        <div className="space-y-3">
          <Field label="Student" required><StudentPicker value={form.student} onChange={(student) => setForm({ ...form, student })} /></Field>
          <Field label="Plan title" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Attendance recovery plan" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="wellbeing">Wellbeing</option><option value="behaviour">Behaviour</option><option value="academic">Academic</option><option value="attendance">Attendance</option><option value="family">Family</option><option value="other">Other</option></Select></Field>
            <Field label="Review date"><Input type="date" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} /></Field>
          </div>
          <Field label="Lead staff member" required><StaffSelect value={form.assignedTo} onChange={(assignedTo) => setForm({ ...form, assignedTo })} staff={staff.data} /></Field>
          <Field label="Reason" required><Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <Field label="First goal"><Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="Return to at least 90% attendance" /></Field>
          <Field label="Actions"><Input value={form.goalActions} onChange={(e) => setForm({ ...form, goalActions: e.target.value })} placeholder="Weekly check-in with the patron" /></Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title={action ? `${titleCase(action.type)} plan ${action.plan.reference}` : 'Update plan'}
        footer={<><Button variant="secondary" onClick={() => setAction(null)}>Close</Button><Button loading={act.isPending} onClick={() => act.mutate()} disabled={(action?.note ?? '').trim().length < 5}>Save</Button></>}
      >
        <Field label={action?.type === 'review' ? 'Review note' : action?.type === 'close' ? 'Outcome' : 'Reason for reopening'} required>
          <Textarea rows={4} value={action?.note ?? ''} onChange={(e) => setAction((current) => (current ? { ...current, note: e.target.value } : current))} />
        </Field>
      </Modal>
    </Card>
  )
}

function FollowUpsTab() {
  const { data } = useQuery({ queryKey: ['welfare-followups'], queryFn: () => getPage<WelfareFollowUp>('/welfare/followups', { pageSize: 60 }) })
  const items = data?.items ?? []

  return (
    <Card>
      <CardHeader title="Welfare follow-ups" subtitle="Counselling, parent meetings and boarding welfare commitments." icon={HeartPulse} />
      {!items.length ? (
        <EmptyState icon={HeartPulse} title="No follow-ups" message="Care commitments assigned to the welfare team appear here." />
      ) : (
        <div className="divide-y divide-line dark:divide-[#26374f]">
          {items.map((followUp) => (
            <div key={followUp._id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm"><StudentLine student={followUp.studentId} /></p>
                <p className="text-xs text-slate-500">{titleCase(followUp.type)} · due {formatDate(followUp.dueDate)} · {personName(followUp.assignedTo)}</p>
                {followUp.notes && <p className="mt-1 text-xs text-slate-500">{followUp.notes}</p>}
              </div>
              <Badge tone={statusTone(followUp.status)}>{titleCase(followUp.status)}</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function DetentionTab() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const staff = useWelfareStaff(has(['detention.manage']))
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ student: null as PickedStudent | null, reason: '', scheduledAt: '', durationMinutes: 60, location: '', supervisorId: '', notifyGuardian: true })
  const [note, setNote] = useState<{ session: Detention; type: 'miss' | 'cancel'; text: string } | null>(null)

  const { data: overview } = useQuery({
    queryKey: ['detention-overview'],
    queryFn: () => get<{ today: Detention[]; counts: { todaySessions: number; upcoming: number; missedLast30Days: number; attendanceRate: number }; repeatedMisses: { fullName: string; studentId: string; misses: number }[] }>('/detention/overview'),
  })
  const { data } = useQuery({ queryKey: ['detention-sessions'], queryFn: () => getPage<Detention>('/detention/sessions', { pageSize: 60 }) })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['detention-overview'] })
    queryClient.invalidateQueries({ queryKey: ['detention-sessions'] })
  }

  const create = useMutation({
    mutationFn: () =>
      post('/detention/sessions', {
        studentId: form.student?.id,
        reason: form.reason,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        durationMinutes: form.durationMinutes,
        location: form.location,
        supervisorId: form.supervisorId,
        notifyGuardian: form.notifyGuardian,
      }),
    onSuccess: () => {
      success('Detention session scheduled')
      setOpen(false)
      setForm({ student: null, reason: '', scheduledAt: '', durationMinutes: 60, location: '', supervisorId: '', notifyGuardian: true })
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const mark = useMutation({
    mutationFn: ({ session, type, text }: { session: Detention; type: 'attend' | 'complete' | 'miss' | 'cancel'; text?: string }) => {
      if (type === 'attend') return post(`/detention/sessions/${session._id}/attend`, {})
      if (type === 'complete') return post(`/detention/sessions/${session._id}/complete`, {})
      return post(`/detention/sessions/${session._id}/${type}`, type === 'miss' ? { notes: text } : { reason: text })
    },
    onSuccess: () => {
      success('Detention session updated')
      setNote(null)
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const items = data?.items ?? []

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Today" value={overview?.counts.todaySessions ?? '—'} icon={ClipboardCheck} tone="brand" />
        <StatCard label="Upcoming" value={overview?.counts.upcoming ?? '—'} icon={CalendarClock} tone="amber" hint="Next seven days" />
        <StatCard label="Missed (30 days)" value={overview?.counts.missedLast30Days ?? '—'} icon={ShieldAlert} tone="red" />
        <StatCard label="Attendance rate" value={overview ? `${overview.counts.attendanceRate}%` : '—'} icon={Users} tone="emerald" />
      </div>

      {overview?.repeatedMisses?.length ? (
        <Alert tone="warning" title="Repeated detention misses">
          {overview.repeatedMisses.map((row) => `${row.fullName} (${row.studentId}) — ${row.misses}`).join(' · ')}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Detention sessions"
          subtitle="Supervised reflection. Scheduling or completing detention never changes conduct marks."
          icon={ClipboardCheck}
          actions={has('detention.manage') && <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Schedule</Button>}
        />
        {!items.length ? (
          <EmptyState icon={ClipboardCheck} title="No detention sessions" message="Sessions you supervise or manage appear here." />
        ) : (
          <div className="divide-y divide-line dark:divide-[#26374f]">
            {items.map((session) => (
              <div key={session._id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm"><StudentLine student={session.studentId} /></p>
                  <p className="text-xs text-slate-500">{formatDateTime(session.scheduledAt)} · {session.durationMinutes} min · {session.location} · {personName(session.supervisorId)}</p>
                  <p className="mt-1 text-xs text-slate-500">{session.reason}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(session.status)}>{titleCase(session.status)}</Badge>
                  <Badge tone="slate">{session.reference}</Badge>
                  {['scheduled', 'missed'].includes(session.status) && (
                    <>
                      <Button size="sm" onClick={() => mark.mutate({ session, type: 'attend' })}>Attended</Button>
                      <Button size="sm" variant="secondary" onClick={() => mark.mutate({ session, type: 'complete' })}>Complete</Button>
                      <Button size="sm" variant="secondary" onClick={() => setNote({ session, type: 'miss', text: '' })}>Missed</Button>
                    </>
                  )}
                  {has('detention.manage') && !['completed', 'cancelled'].includes(session.status) && (
                    <Button size="sm" variant="secondary" onClick={() => setNote({ session, type: 'cancel', text: '' })}>Cancel</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Schedule a detention session"
          footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Close</Button><Button loading={create.isPending} onClick={() => create.mutate()} disabled={!form.student || form.reason.trim().length < 5 || !form.scheduledAt || !form.location.trim() || !form.supervisorId}>Schedule</Button></>}
        >
          <div className="space-y-3">
            <Field label="Student" required><StudentPicker value={form.student} onChange={(student) => setForm({ ...form, student })} /></Field>
            <Field label="Reason" required><Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date and time" required><Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></Field>
              <Field label="Minutes"><Input type="number" min={10} max={240} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} /></Field>
              <Field label="Location" required><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Room 12" /></Field>
            </div>
            <Field label="Supervisor" required><StaffSelect value={form.supervisorId} onChange={(supervisorId) => setForm({ ...form, supervisorId })} staff={staff.data} /></Field>
            <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 dark:border-[#26374f]">
              <span className="text-sm">Notify the guardian</span>
              <Toggle checked={form.notifyGuardian} onChange={(notifyGuardian) => setForm({ ...form, notifyGuardian })} label="Notify guardian" />
            </div>
          </div>
        </Modal>

        <Modal
          open={Boolean(note)}
          onClose={() => setNote(null)}
          title={note?.type === 'miss' ? 'Record a missed session' : 'Cancel detention'}
          footer={<><Button variant="secondary" onClick={() => setNote(null)}>Close</Button><Button variant={note?.type === 'miss' ? 'primary' : 'danger'} loading={mark.isPending} onClick={() => note && mark.mutate({ session: note.session, type: note.type, text: note.text })} disabled={(note?.text ?? '').trim().length < 4}>Save</Button></>}
        >
          <Field label={note?.type === 'miss' ? 'What happened' : 'Reason for cancellation'} required>
            <Textarea rows={3} value={note?.text ?? ''} onChange={(e) => setNote((current) => (current ? { ...current, text: e.target.value } : current))} />
          </Field>
        </Modal>
      </Card>
    </div>
  )
}
