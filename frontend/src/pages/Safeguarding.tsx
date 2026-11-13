import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Clock, Lock, Plus, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, post, patch } from '../lib/api'
import { refName, useStaff } from '../lib/hooks'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
import { StudentPicker, type PickedStudent } from '../components/StudentPicker'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

type CaseRow = {
  _id: string
  caseNumber: string
  category: string
  severity: string
  status: string
  confidential: boolean
  createdAt: string
  deadline?: string
  studentId?: { fullName?: string; studentId?: string } | string
  reportedBy?: { name?: string } | string
  assignedTo?: { name?: string } | string
}

type CaseDetail = CaseRow & {
  narrative: string
  immediateRisk?: string
  resolution?: string
  history?: { at: string; action: string; note?: string }[]
}

export function SafeguardingPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [severity, setSeverity] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [action, setAction] = useState<'status' | 'assign' | 'escalate'>('status')
  const [actionText, setActionText] = useState('')
  const [assignTo, setAssignTo] = useState('')
  const [newStatus, setNewStatus] = useState('under_review')
  const [resolution, setResolution] = useState('')

  const { data: staff } = useStaff(has('safeguarding.assign'))
  const { data: stats } = useQuery({
    queryKey: ['safeguarding-stats'],
    queryFn: () => get<{ byStatus: Record<string, number>; bySeverity: Record<string, number>; overdue: number }>('/safeguarding/stats'),
  })
  const { data, isLoading } = useQuery({
    queryKey: ['safeguarding', status, severity],
    queryFn: () => getPage<CaseRow>('/safeguarding/cases', { pageSize: 50, status: status || undefined, severity: severity || undefined }),
  })
  const { data: detail } = useQuery({
    queryKey: ['safeguarding-case', selectedId],
    queryFn: () => get<CaseDetail>(`/safeguarding/cases/${selectedId}`),
    enabled: Boolean(selectedId),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['safeguarding'] })
    queryClient.invalidateQueries({ queryKey: ['safeguarding-case'] })
    queryClient.invalidateQueries({ queryKey: ['safeguarding-stats'] })
  }

  const updateCase = useMutation({
    mutationFn: () => patch(`/safeguarding/cases/${selectedId}`, { status: newStatus, resolution: resolution || undefined }),
    onSuccess: () => {
      success('Case status updated')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const assignCase = useMutation({
    mutationFn: () => post(`/safeguarding/cases/${selectedId}/assign`, { assignedTo: assignTo, note: actionText || undefined }),
    onSuccess: () => {
      success('Case owner assigned')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const escalateCase = useMutation({
    mutationFn: () => post(`/safeguarding/cases/${selectedId}/escalate`, { reason: actionText }),
    onSuccess: () => {
      success('Case escalated to leadership for approval')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const cases = data?.items ?? []
  const urgent = stats?.overdue ?? 0

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Restricted · safeguarding"
        title="Safeguarding centre"
        subtitle="Confidential concerns with restricted access, deadlines and an immutable access log."
        actions={
          has('safeguarding.create') && (
            <Button icon={Plus} variant="ochre" onClick={() => setCreateOpen(true)}>
              Report concern
            </Button>
          )
        }
      />

      <Alert tone="warning" title="Access is audited">
        Only the reporter, assigned officer and headteacher can open case details. Every view is written to the access log.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open concerns" value={(stats?.byStatus?.open ?? 0) + (stats?.byStatus?.under_review ?? 0) + (stats?.byStatus?.referred ?? 0)} icon={ShieldAlert} tone="ochre" hint="Reported or under review" />
        <StatCard label="Past deadline" value={urgent} icon={Clock} tone="red" hint="Needs immediate attention" />
        <StatCard label="Critical severity" value={stats?.bySeverity?.critical ?? 0} icon={AlertTriangle} tone="amber" hint="Highest risk band" />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-52">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Under review</option>
            <option value="referred">Referred</option>
            <option value="escalated">Escalated</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </Select>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="sm:w-52">
            <option value="">All severities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading restricted cases…" />
      ) : cases.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {cases.map((c) => {
            const overdue = c.deadline && new Date(c.deadline) < new Date() && !['resolved', 'closed'].includes(c.status)
            return (
              <Card key={c._id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{c.caseNumber}</span>
                      <Badge tone={c.severity === 'critical' ? 'red' : c.severity === 'high' ? 'orange' : 'slate'}>{titleCase(c.severity)}</Badge>
                      <StatusBadge status={c.status} />
                      {c.confidential && <Badge tone="slate"><Lock className="h-3 w-3" /> Confidential</Badge>}
                    </div>
                    <p className="mt-2 font-display text-lg font-semibold">{titleCase(c.category)} concern</p>
                    <p className="text-sm text-slate-500">
                      {typeof c.studentId === 'object' ? c.studentId?.fullName ?? 'No student linked' : 'No student linked'} · reported by {refName(c.reportedBy)}
                    </p>
                  </div>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${overdue ? 'bg-red-100 text-red-600 dark:bg-red-950/50' : 'bg-ochre-50 text-ochre-600 dark:bg-ochre-500/10'}`}>
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-slate-500 dark:border-[#26374f]">
                  <span className={overdue ? 'font-semibold text-red-600' : ''}>
                    {c.deadline ? `${overdue ? 'Overdue since' : 'Deadline'} ${formatDate(c.deadline)}` : 'No deadline set'}
                  </span>
                  <span>{refName(c.assignedTo, 'Unassigned')}</span>
                  <Button size="sm" variant="secondary" onClick={() => { setSelectedId(c._id); setAction('status'); setActionText('') }}>
                    Open case
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
        <EmptyState title="No safeguarding concerns" message="Reported concerns will appear here with restricted access." icon={ShieldCheck} />
      )}

      <CreateCaseModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={refresh} />

      <Modal open={Boolean(selectedId)} onClose={() => setSelectedId(null)} title={detail ? `${detail.caseNumber} · ${titleCase(detail.category)}` : 'Case detail'} subtitle="Restricted case file" size="lg">
        {!detail ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={detail.severity === 'critical' ? 'red' : detail.severity === 'high' ? 'orange' : 'slate'}>{titleCase(detail.severity)}</Badge>
              <StatusBadge status={detail.status} />
              <Badge tone="slate">Reported {formatDateTime(detail.createdAt)}</Badge>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Narrative</p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-700 dark:bg-[#0c1524] dark:text-slate-300">{detail.narrative}</p>
            </div>
            {detail.immediateRisk && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Immediate risk & action</p>
                <p className="mt-1 text-slate-700 dark:text-slate-300">{detail.immediateRisk}</p>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Reported by</dt>
                <dd className="mt-0.5">{refName(detail.reportedBy)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Case owner</dt>
                <dd className="mt-0.5">{refName(detail.assignedTo)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Deadline</dt>
                <dd className="mt-0.5">{formatDate(detail.deadline)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Student</dt>
                <dd className="mt-0.5">{typeof detail.studentId === 'object' ? detail.studentId?.fullName ?? '—' : '—'}</dd>
              </div>
            </dl>

            {detail.history?.length ? (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">History</p>
                <ul className="mt-1 space-y-1.5">
                  {detail.history.slice(-6).reverse().map((h, i) => (
                    <li key={i} className="flex justify-between gap-3 text-xs">
                      <span>{titleCase(h.action)}{h.note ? ` — ${h.note}` : ''}</span>
                      <span className="shrink-0 text-slate-400">{formatDate(h.at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-xl border border-line p-3 dark:border-[#26374f]">
              <div className="mb-3 flex gap-2">
                {(['status', 'assign', 'escalate'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAction(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${action === key ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300'}`}
                  >
                    {key === 'status' ? 'Update status' : key === 'assign' ? 'Assign owner' : 'Escalate'}
                  </button>
                ))}
              </div>

              {action === 'status' && (
                <div className="space-y-2">
                  <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                    <option value="open">Open</option>
                    <option value="under_review">Under review</option>
                    <option value="referred">Referred</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </Select>
                  {['resolved', 'closed'].includes(newStatus) && (
                    <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Resolution summary required before closing…" />
                  )}
                  <Button
                    size="sm"
                    loading={updateCase.isPending}
                    disabled={!has('safeguarding.view') || (['resolved', 'closed'].includes(newStatus) && resolution.trim().length < 5)}
                    onClick={() => updateCase.mutate()}
                  >
                    Save status
                  </Button>
                </div>
              )}

              {action === 'assign' && (
                <div className="space-y-2">
                  <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                    <option value="">Select case owner</option>
                    {staff?.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </Select>
                  <Input value={actionText} onChange={(e) => setActionText(e.target.value)} placeholder="Assignment note (optional)" />
                  <Button size="sm" loading={assignCase.isPending} disabled={!assignTo || !has('safeguarding.assign')} onClick={() => assignCase.mutate()}>
                    Assign officer
                  </Button>
                </div>
              )}

              {action === 'escalate' && (
                <div className="space-y-2">
                  <Textarea value={actionText} onChange={(e) => setActionText(e.target.value)} placeholder="Reason for escalation (5+ characters)" />
                  <Button size="sm" variant="ochre" loading={escalateCase.isPending} disabled={actionText.trim().length < 5 || !has('safeguarding.escalate')} onClick={() => escalateCase.mutate()}>
                    Escalate to leadership
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function CreateCaseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [form, setForm] = useState({ category: 'bullying', severity: 'medium', narrative: '', immediateRisk: '', deadline: '', confidential: true })

  const create = useMutation({
    mutationFn: () =>
      post('/safeguarding/cases', {
        category: form.category,
        severity: form.severity,
        studentId: student?.id || undefined,
        narrative: form.narrative,
        immediateRisk: form.immediateRisk || undefined,
        confidential: form.confidential,
        deadline: form.deadline || undefined,
      }),
    onSuccess: () => {
      success('Safeguarding concern recorded. Access is restricted.')
      setStudent(null)
      setForm({ category: 'bullying', severity: 'medium', narrative: '', immediateRisk: '', deadline: '', confidential: true })
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report a safeguarding concern"
      subtitle="Only authorised staff can see this case."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="ochre" loading={create.isPending} disabled={form.narrative.trim().length < 10} onClick={() => create.mutate()}>
            Record concern
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning" title="Confidentiality">
          Do not record speculation. Capture what was observed or disclosed, by whom, and any immediate safety action.
        </Alert>
        <Field label="Student (optional)">
          <StudentPicker value={student} onChange={setStudent} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" required>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="bullying">Bullying</option>
              <option value="harassment">Harassment</option>
              <option value="abuse">Abuse</option>
              <option value="protection">Child protection</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Severity" required>
            <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </Field>
        </div>
        <Field label="What was observed or disclosed?" required>
          <Textarea value={form.narrative} onChange={(e) => setForm({ ...form, narrative: e.target.value })} className="min-h-[120px]" />
        </Field>
        <Field label="Immediate risk and action taken">
          <Textarea value={form.immediateRisk} onChange={(e) => setForm({ ...form, immediateRisk: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Response deadline">
            <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} className="h-4 w-4 rounded" />
            Mark as confidential
          </label>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <UserRound className="h-3.5 w-3.5" /> The headteacher and safeguarding lead are notified immediately.
        </p>
      </div>
    </Modal>
  )
}
