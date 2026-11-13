import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, CalendarCheck2, HeartHandshake, Plus, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, post } from '../lib/api'
import { refName, useStaff } from '../lib/hooks'
import { formatDate, titleCase } from '../lib/utils'
import type { PaginationMeta } from '../lib/types'
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
  Pagination,
  RiskBadge,
  SearchInput,
  Select,
  StatCard,
  Tabs,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

type RiskStudent = {
  _id: string
  fullName: string
  studentId: string
  currentBalance: number
  riskLevel: string
  riskLabel?: string
  classId?: { name?: string } | string
}

type Intervention = {
  _id: string
  type: string
  title: string
  plan?: string
  status: string
  startDate?: string
  reviewDate?: string
  studentId?: { _id?: string; fullName?: string; studentId?: string } | string
  assignedTo?: { name?: string } | string
}

type FollowUp = {
  _id: string
  type: string
  status: string
  dueDate: string
  notes?: string
  studentId?: { _id?: string; fullName?: string; studentId?: string; riskLevel?: string } | string
  assignedTo?: { name?: string } | string
}

type Recognition = {
  _id: string
  title: string
  type: string
  category?: string
  points?: number
  awardedAt?: string
  studentId?: { _id?: string; fullName?: string; studentId?: string } | string
  awardedBy?: { name?: string } | string
}

type TabKey = 'register' | 'interventions' | 'followups' | 'recognition'

function studentLink(s: Intervention['studentId'] | FollowUp['studentId'] | Recognition['studentId']) {
  if (!s) return null
  if (typeof s === 'string') return null
  if (!s._id) return null
  return { id: s._id, name: s.fullName ?? 'Student', ref: s.studentId ?? '' }
}

export function RiskPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('register')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [interventionOpen, setInterventionOpen] = useState(false)
  const [awardOpen, setAwardOpen] = useState(false)

  const { data: staff } = useStaff(has(['interventions.manage', 'followups.manage', 'recognition.manage']))
  const { data: riskData, isLoading: riskLoading } = useQuery({
    queryKey: ['risk-students', q, page],
    queryFn: () => getPage<RiskStudent>('/risk/students', { page, pageSize: 20, category: 'yellow,orange,red', q: q || undefined }),
    enabled: tab === 'register',
  })
  const { data: interventions } = useQuery({
    queryKey: ['interventions'],
    queryFn: () => getPage<Intervention>('/interventions', { pageSize: 50 }),
    enabled: tab === 'interventions',
  })
  const { data: followUps } = useQuery({
    queryKey: ['followups'],
    queryFn: () => getPage<FollowUp>('/followups', { pageSize: 50 }),
    enabled: tab === 'followups',
  })
  const { data: recognition } = useQuery({
    queryKey: ['recognition'],
    queryFn: () => getPage<Recognition>('/recognition', { pageSize: 50 }),
    enabled: tab === 'recognition',
  })

  const recalc = useMutation({
    mutationFn: (studentId: string) => post(`/risk/students/${studentId}/recalculate`),
    onSuccess: () => {
      success('Risk recalculated')
      queryClient.invalidateQueries({ queryKey: ['risk-students'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const completeFollowUp = useMutation({
    mutationFn: (id: string) => post(`/followups/${id}/complete`, {}),
    onSuccess: () => {
      success('Follow-up completed')
      queryClient.invalidateQueries({ queryKey: ['followups'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const riskMeta = (riskData?.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 1 }) as PaginationMeta
  const students = riskData?.items ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Care & intervention"
        title="Risk & support"
        subtitle="Identify students losing conduct marks early, then respond with documented care."
        actions={
          has('interventions.manage') && (
            <Button icon={Plus} onClick={() => setInterventionOpen(true)}>
              New intervention
            </Button>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="In risk register" value={riskMeta.total} icon={ShieldAlert} tone="red" hint="Yellow, orange and red bands" />
        <StatCard label="Open interventions" value={interventions?.items.filter((i) => i.status !== 'completed').length ?? '—'} icon={HeartHandshake} tone="brand" hint="Documented support plans" />
        <StatCard label="Pending follow-ups" value={followUps?.items.filter((f) => f.status === 'pending' || f.status === 'overdue').length ?? '—'} icon={CalendarCheck2} tone="amber" hint="Care team commitments" />
      </div>

      <Tabs
        tabs={[
          { key: 'register', label: 'Risk register', count: riskMeta.total },
          { key: 'interventions', label: 'Interventions', count: interventions?.items.length },
          { key: 'followups', label: 'Follow-ups', count: followUps?.items.length },
          { key: 'recognition', label: 'Recognition', count: recognition?.items.length },
        ]}
        active={tab}
        onChange={(key) => {
          setTab(key)
          setPage(1)
        }}
      />

      {tab === 'register' && (
        <Card>
          <div className="flex flex-col gap-3 border-b border-line p-4 dark:border-[#26374f] sm:flex-row sm:items-center">
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search students in the risk register…" className="flex-1" />
            <Badge tone="amber">Sorted by lowest balance</Badge>
          </div>
          {riskLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 w-full" />)}</div>
          ) : students.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                    <th className="px-5 py-2.5 font-semibold">Student</th>
                    <th className="px-3 py-2.5 font-semibold">Class</th>
                    <th className="px-3 py-2.5 font-semibold">Balance</th>
                    <th className="px-3 py-2.5 font-semibold">Risk</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s._id} className="row-hover border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                      <td className="px-5 py-3">
                        <Link to={`/students/${s._id}`} className="font-medium hover:text-brand-600">
                          {s.fullName}
                        </Link>
                        <span className="block text-xs text-slate-400">{s.studentId}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-500">{typeof s.classId === 'object' ? s.classId?.name : '—'}</td>
                      <td className="px-3 py-3">
                        <span className={`font-mono font-semibold ${s.currentBalance <= 15 ? 'text-risk-red' : s.currentBalance <= 25 ? 'text-risk-orange' : 'text-risk-yellow'}`}>
                          {s.currentBalance}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <RiskBadge risk={s.riskLevel} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {has('risk.manage') && (
                          <Button variant="ghost" size="sm" icon={RefreshCw} loading={recalc.isPending && recalc.variables === s._id} onClick={() => recalc.mutate(s._id)}>
                            Recalculate
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Risk register is clear" message="No students are currently in yellow, orange or red bands." icon={Sparkles} />
          )}
          <div className="border-t border-line px-5 py-3 dark:border-[#26374f]">
            <Pagination meta={riskMeta} onPage={setPage} />
          </div>
        </Card>
      )}

      {tab === 'interventions' && (
        <Card>
          <CardHeader title="Support plans" subtitle="Counselling, behaviour plans, mentoring and family work" icon={HeartHandshake} />
          {interventions?.items.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {interventions.items.map((i) => {
                const student = studentLink(i.studentId)
                return (
                  <li key={i._id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {i.title}{' '}
                        <Badge tone="brand" className="ml-1">
                          {titleCase(i.type)}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {student ? <Link to={`/students/${student.id}`} className="link">{student.name}</Link> : 'Student'} · {refName(i.assignedTo)}
                        {i.startDate ? ` · started ${formatDate(i.startDate)}` : ''}
                      </p>
                      {i.plan && <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{i.plan}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={i.status === 'completed' ? 'emerald' : i.status === 'open' ? 'amber' : 'brand'}>{titleCase(i.status)}</Badge>
                      {i.reviewDate && <span className="text-xs text-slate-400">Review {formatDate(i.reviewDate)}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState title="No interventions" message="Create a documented support plan for a student at risk." icon={HeartHandshake} />
          )}
        </Card>
      )}

      {tab === 'followups' && (
        <Card>
          <CardHeader title="Follow-ups" subtitle="Behaviour checks, counselling and parent meetings" icon={CalendarCheck2} />
          {followUps?.items.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {followUps.items.map((f) => {
                const student = studentLink(f.studentId)
                const overdue = f.status !== 'completed' && new Date(f.dueDate) < new Date()
                return (
                  <li key={f._id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {titleCase(f.type)} · {student ? <Link to={`/students/${student.id}`} className="link">{student.name}</Link> : 'Student'}
                      </p>
                      <p className="text-xs text-slate-400">
                        Due {formatDate(f.dueDate)} · {refName(f.assignedTo)}
                        {f.notes ? ` · ${f.notes}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={overdue ? 'red' : f.status === 'completed' ? 'emerald' : 'amber'}>{overdue ? 'Overdue' : titleCase(f.status)}</Badge>
                      {has('followups.manage') && f.status !== 'completed' && (
                        <Button variant="secondary" size="sm" loading={completeFollowUp.isPending && completeFollowUp.variables === f._id} onClick={() => completeFollowUp.mutate(f._id)}>
                          Complete
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState title="No follow-ups" message="Follow-ups keep care commitments visible and accountable." icon={CalendarCheck2} />
          )}
        </Card>
      )}

      {tab === 'recognition' && (
        <Card>
          <CardHeader
            title="Recognition & improvement"
            subtitle="Celebrate positive behaviour and measurable improvement"
            icon={Award}
            actions={
              has(['recognition.create', 'recognition.manage']) && (
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAwardOpen(true)}>
                  Award recognition
                </Button>
              )
            }
          />
          {recognition?.items.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {recognition.items.map((r) => {
                const student = studentLink(r.studentId)
                return (
                  <li key={r._id} className="flex items-start justify-between gap-3 px-5 py-4">
                    <div>
                      <p className="font-medium">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        {student ? <Link to={`/students/${student.id}`} className="link">{student.name}</Link> : 'Student'} · {refName(r.awardedBy)} · {formatDate(r.awardedAt)}
                      </p>
                      {r.category && <p className="mt-0.5 text-xs text-slate-400">{r.category}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone="slate">{titleCase(r.type)}</Badge>
                      {typeof r.points === 'number' && r.points > 0 && <Badge tone="emerald">+{r.points}</Badge>}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState title="No recognition awarded" message="Recognition records build a balanced conduct picture." icon={Award} />
          )}
        </Card>
      )}

      <InterventionModal open={interventionOpen} onClose={() => setInterventionOpen(false)} staff={staff ?? []} onSaved={() => queryClient.invalidateQueries({ queryKey: ['interventions'] })} />
      <AwardModal open={awardOpen} onClose={() => setAwardOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['recognition'] })} />
    </div>
  )
}

function InterventionModal({
  open,
  onClose,
  staff,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  staff: { id: string; name: string; position?: string }[]
  onSaved: () => void
}) {
  const { success, error: toastError } = useToast()
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [form, setForm] = useState({ type: 'counselling', title: '', plan: '', assignedTo: '', reviewDate: '' })

  const create = useMutation({
    mutationFn: () =>
      post('/interventions', {
        studentId: student?.id,
        type: form.type,
        title: form.title,
        plan: form.plan,
        assignedTo: form.assignedTo,
        reviewDate: form.reviewDate || undefined,
      }),
    onSuccess: () => {
      success('Intervention created and assigned')
      setStudent(null)
      setForm({ type: 'counselling', title: '', plan: '', assignedTo: '', reviewDate: '' })
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New support intervention"
      subtitle="Documented care with an accountable owner."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!student || form.title.length < 3 || form.plan.length < 5 || !form.assignedTo} onClick={() => create.mutate()}>
            Create intervention
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Student" required>
          <StudentPicker value={student} onChange={setStudent} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Intervention type" required>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="counselling">Counselling</option>
              <option value="behaviour_plan">Behaviour plan</option>
              <option value="mentoring">Mentoring</option>
              <option value="family">Family engagement</option>
              <option value="watchlist">Watchlist support</option>
            </Select>
          </Field>
          <Field label="Assigned staff" required>
            <Select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
              <option value="">Select staff member</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}{u.position ? ` — ${u.position}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Six-week behaviour coaching plan" />
        </Field>
        <Field label="Support plan" required>
          <Textarea value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} placeholder="Goals, methods, review approach and responsibilities…" className="min-h-[120px]" />
        </Field>
        <Field label="Review date">
          <Input type="date" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

function AwardModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [form, setForm] = useState({ type: 'positive_behaviour', title: '', description: '', points: 0, applyMarks: false })

  const create = useMutation({
    mutationFn: () =>
      post('/recognition', {
        studentId: student?.id,
        type: form.type,
        title: form.title,
        description: form.description || undefined,
        points: Number(form.points) || 0,
        applyMarks: form.applyMarks,
      }),
    onSuccess: () => {
      success('Recognition awarded')
      setStudent(null)
      setForm({ type: 'positive_behaviour', title: '', description: '', points: 0, applyMarks: false })
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Award recognition"
      subtitle="Positive entries are visible in the student's conduct story."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!student || form.title.length < 3} onClick={() => create.mutate()}>
            Award
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Student" required>
          <StudentPicker value={student} onChange={setStudent} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Recognition type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="positive_behaviour">Positive behaviour</option>
              <option value="achievement">Achievement</option>
              <option value="reward">Reward</option>
            </Select>
          </Field>
          <Field label="Marks to restore">
            <Input type="number" min={0} max={20} value={form.points} onChange={(e) => setForm({ ...form, points: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Outstanding peer support" />
        </Field>
        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        {has('marks.reward') && Number(form.points) > 0 && (
          <>
            <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm dark:border-[#26374f]">
              <input type="checkbox" checked={form.applyMarks} onChange={(e) => setForm({ ...form, applyMarks: e.target.checked })} className="mt-0.5 h-4 w-4 rounded" />
              <span>
                Restore {form.points} conduct marks in the ledger
                <span className="block text-xs text-slate-400">Creates an auditable reward transaction for the active term.</span>
              </span>
            </label>
            <Alert tone="info" title="Ledger impact">
              Reward marks are posted immediately and appear on the student ledger with your name attached.
            </Alert>
          </>
        )}
      </div>
    </Modal>
  )
}
