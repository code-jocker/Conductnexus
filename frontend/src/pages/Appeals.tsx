import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FileText, Gavel, Plus, Scale } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, post } from '../lib/api'
import { refName, useStaff } from '../lib/hooks'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
import { StudentPicker, type PickedStudent } from '../components/StudentPicker'
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatusBadge, Textarea } from '../components/ui'
import { useToast } from '../components/toast'

type AppealRow = {
  _id: string
  appealNumber: string
  decisionType: string
  decisionRef: string
  grounds: string
  status: string
  deadline?: string
  submittedAt?: string
  createdAt: string
  studentId?: { fullName?: string; studentId?: string; currentBalance?: number } | string
  submittedBy?: { name?: string } | string
  reviewerId?: { name?: string } | string
}

type AppealDetail = AppealRow & {
  reason: string
  decision?: string
  decisionExplanation?: string
  decidedAt?: string
  originalDecisionBy?: { name?: string } | string
  history?: { at: string; action: string; note?: string }[]
}

export function AppealsPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewerId, setReviewerId] = useState('')
  const [decision, setDecision] = useState('upheld')
  const [explanation, setExplanation] = useState('')

  const { data: staff } = useStaff(has('appeals.review'))
  const { data, isLoading } = useQuery({
    queryKey: ['appeals', status],
    queryFn: () => getPage<AppealRow>('/appeals', { pageSize: 40, status: status || undefined }),
  })
  const { data: detail } = useQuery({
    queryKey: ['appeal', selectedId],
    queryFn: () => get<AppealDetail>(`/appeals/${selectedId}`),
    enabled: Boolean(selectedId),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['appeals'] })
    queryClient.invalidateQueries({ queryKey: ['appeal'] })
  }

  const assignReview = useMutation({
    mutationFn: () => post(`/appeals/${selectedId}/review`, { reviewerId: reviewerId || undefined }),
    onSuccess: () => {
      success('Appeal assigned for review')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const decide = useMutation({
    mutationFn: () => post(`/appeals/${selectedId}/decide`, { decision, explanation }),
    onSuccess: () => {
      success('Appeal decision recorded')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const appeals = data?.items ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Fair process"
        title="Student appeals"
        subtitle="Independent review of conduct decisions, with the original decision-maker excluded."
        actions={
          has('appeals.submit') && (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              Submit appeal
            </Button>
          )
        }
      />

      <Card className="p-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-56">
          <option value="">All statuses</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under review</option>
          <option value="decided">Decided</option>
          <option value="withdrawn">Withdrawn</option>
        </Select>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading appeals…" />
      ) : appeals.length ? (
        <Card>
          <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
            {appeals.map((appeal) => {
              const student = typeof appeal.studentId === 'object' ? appeal.studentId : undefined
              return (
                <li key={appeal._id}>
                  <button
                    onClick={() => { setSelectedId(appeal._id); setDecision('upheld'); setExplanation('') }}
                    className="flex w-full flex-col gap-2 px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-white/5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-400">{appeal.appealNumber}</span>
                        <StatusBadge status={appeal.status} />
                        <Badge tone="slate">{titleCase(appeal.decisionType)}</Badge>
                      </div>
                      <p className="mt-1 font-medium">{appeal.grounds}</p>
                      <p className="text-xs text-slate-500">
                        {student?.fullName ?? 'Student'} · decision {appeal.decisionRef} · submitted by {refName(appeal.submittedBy)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                      {formatDate(appeal.createdAt)}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      ) : (
        <EmptyState title="No appeals" message="Appeals submitted by families or staff will appear here." icon={FileText} />
      )}

      <CreateAppealModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={refresh} />

      <Modal open={Boolean(selectedId)} onClose={() => setSelectedId(null)} title={detail ? `${detail.appealNumber} · ${detail.grounds}` : 'Appeal'} subtitle="Appeal case file" size="lg">
        {!detail ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <Badge tone="slate">Decision ref {detail.decisionRef}</Badge>
              <Badge tone="slate">Deadline {formatDate(detail.deadline)}</Badge>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Reason for appeal</p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 dark:bg-[#0c1524]">{detail.reason}</p>
            </div>
            {detail.decision && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Outcome</p>
                <p className="mt-1">
                  <Badge tone="emerald">{titleCase(detail.decision)}</Badge>{' '}
                  <span className="text-xs text-slate-400">{formatDateTime(detail.decidedAt)}</span>
                </p>
                <p className="mt-2 whitespace-pre-wrap">{detail.decisionExplanation}</p>
              </div>
            )}

            {['submitted', 'under_review'].includes(detail.status) && has('appeals.review') && (
              <div className="rounded-xl border border-line p-3 dark:border-[#26374f]">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assign reviewer</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className="flex-1">
                    <option value="">Assign to me</option>
                    {staff?.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </Select>
                  <Button size="sm" variant="secondary" loading={assignReview.isPending} onClick={() => assignReview.mutate()}>
                    Assign for review
                  </Button>
                </div>
              </div>
            )}

            {['submitted', 'under_review'].includes(detail.status) && has('appeals.decide') && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-900 dark:bg-brand-950/20">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                  <Gavel className="h-3.5 w-3.5" /> Decision
                </p>
                <div className="mt-2 space-y-2">
                  <Select value={decision} onChange={(e) => setDecision(e.target.value)}>
                    <option value="upheld">Uphold the original decision</option>
                    <option value="overturned">Overturn the original decision</option>
                    <option value="modified">Modify the original decision</option>
                    <option value="dismissed">Dismiss the appeal</option>
                  </Select>
                  <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Explain the decision basis (10+ characters)…" />
                  <Button size="sm" loading={decide.isPending} disabled={explanation.trim().length < 10} onClick={() => decide.mutate()} icon={Scale}>
                    Record decision
                  </Button>
                </div>
              </div>
            )}

            {detail.status === 'decided' && detail.history?.length ? (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">History</p>
                <ul className="mt-1 space-y-1.5 text-xs">
                  {detail.history.slice(-5).reverse().map((h, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>{titleCase(h.action)}{h.note ? ` — ${h.note}` : ''}</span>
                      <span className="shrink-0 text-slate-400">{formatDate(h.at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  )
}

function CreateAppealModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [form, setForm] = useState({ decisionType: 'incident', decisionRef: '', grounds: '', reason: '' })

  const create = useMutation({
    mutationFn: () =>
      post('/appeals', {
        studentId: student?.id,
        decisionType: form.decisionType,
        decisionRef: form.decisionRef || undefined,
        grounds: form.grounds,
        reason: form.reason,
      }),
    onSuccess: () => {
      success('Appeal submitted for independent review')
      setStudent(null)
      setForm({ decisionType: 'incident', decisionRef: '', grounds: '', reason: '' })
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit an appeal"
      subtitle="Appeals are decided by someone who did not make the original decision."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!student || form.grounds.trim().length < 5 || form.reason.trim().length < 20} onClick={() => create.mutate()}>
            Submit appeal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info" title="Grounds and evidence">
          State the grounds clearly and attach any evidence later from the case file. Appeals are due within 14 days of the decision.
        </Alert>
        <Field label="Student" required>
          <StudentPicker value={student} onChange={setStudent} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Decision type">
            <Select value={form.decisionType} onChange={(e) => setForm({ ...form, decisionType: e.target.value })}>
              <option value="incident">Conduct incident</option>
              <option value="suspension">Suspension</option>
              <option value="expulsion">Expulsion</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Decision reference" hint="Incident number if known">
            <Input value={form.decisionRef} onChange={(e) => setForm({ ...form, decisionRef: e.target.value })} placeholder="INC-00001" />
          </Field>
        </div>
        <Field label="Grounds for appeal" required>
          <Input value={form.grounds} onChange={(e) => setForm({ ...form, grounds: e.target.value })} placeholder="e.g. Procedure not followed" />
        </Field>
        <Field label="Detailed reason" hint="20+ characters" required>
          <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Explain why the decision should be reviewed, with facts and context…" className="min-h-[120px]" />
        </Field>
      </div>
    </Modal>
  )
}
