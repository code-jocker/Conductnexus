import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardCheck, MapPin, Send, ShieldAlert, UserRound, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, post } from '../lib/api'
import { refName } from '../lib/hooks'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, LoadingBlock, Modal, PageHeader, StatusBadge, Textarea } from '../components/ui'
import { useToast } from '../components/toast'

type IncidentDetail = {
  _id: string
  incidentNumber: string
  studentSnapshot: { fullName: string; studentId: string; className?: string; dormitoryName?: string }
  offenceSnapshot: { name: string; code?: string; deduction: number; severity: string; requiresApproval?: boolean; requiresEvidence?: boolean; notifyParent?: boolean }
  description: string
  occurredAt: string
  location?: string
  severity: string
  status: string
  deductionApplied?: boolean
  parentNotificationStatus?: string
  safeguardingFlag?: boolean
  reportedBy?: { _id?: string; name?: string; position?: string } | string
  review?: { reviewedBy?: { name?: string; position?: string } | string; reviewedAt?: string; decision?: string; comments?: string }
  studentId?: { _id?: string; fullName?: string; studentId?: string; currentBalance?: number; riskLevel?: string } | string
  witnesses?: { name: string; contact?: string; statement?: string }[]
  evidenceIds?: { _id: string; originalName: string; classification: string; reviewStatus?: string }[]
  history?: { at: string; action: string; note?: string }[]
  createdAt: string
}

type Decision = 'approve' | 'reject' | 'request_info'

export function IncidentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { me, has } = useAuth()
  const { success, error: toastError } = useToast()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [decision, setDecision] = useState<Decision>('approve')
  const [comments, setComments] = useState('')

  const { data: incident, isLoading, error } = useQuery({
    queryKey: ['incident', id],
    queryFn: () => get<IncidentDetail>(`/incidents/${id}`),
    enabled: Boolean(id),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['incident', id] })

  const submitMutation = useMutation({
    mutationFn: () => post(`/incidents/${id}/submit`),
    onSuccess: () => {
      success('Incident submitted for review')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const reviewMutation = useMutation({
    mutationFn: () =>
      post(`/incidents/${id}/review`, {
        decision,
        comments: comments.trim() || undefined,
      }),
    onSuccess: () => {
      success(decision === 'approve' ? 'Incident approved and deduction processed' : decision === 'reject' ? 'Incident rejected' : 'More information requested')
      setReviewOpen(false)
      setComments('')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (isLoading) return <LoadingBlock label="Loading incident…" />
  if (error || !incident) {
    return (
      <EmptyState
        title="Incident unavailable"
        message="It may not exist, or your role does not have visibility of it."
        action={<Link to="/incidents" className="link font-semibold">Back to incidents</Link>}
      />
    )
  }

  const reporterId = typeof incident.reportedBy === 'object' ? incident.reportedBy?._id : incident.reportedBy
  const isReporter = reporterId && me?.user.id ? String(reporterId) === String(me.user.id) : false
  const canSubmit = ['draft', 'submitted'].includes(incident.status) && (isReporter || has('incidents.view_all')) && has('incidents.submit')
  const canReview = ['submitted', 'under_review', 'escalated'].includes(incident.status) && has('incidents.review') && !isReporter
  const studentRef = typeof incident.studentId === 'object' ? incident.studentId : undefined
  const studentUrl = studentRef?._id ? `/students/${studentRef._id}` : null

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/incidents')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to incidents
      </button>

      <PageHeader
        eyebrow={`${incident.incidentNumber} · ${titleCase(incident.severity)} severity`}
        title={incident.offenceSnapshot.name}
        subtitle={`${incident.studentSnapshot.fullName} · ${incident.studentSnapshot.className ?? 'Unplaced'} · occurred ${formatDateTime(incident.occurredAt)}`}
        actions={
          <>
            <StatusBadge status={incident.status} />
            {canSubmit && (
              <Button icon={Send} loading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>
                Submit for review
              </Button>
            )}
            {canReview && (
              <Button variant="dark" icon={ClipboardCheck} onClick={() => setReviewOpen(true)}>
                Review decision
              </Button>
            )}
          </>
        }
      />

      {incident.safeguardingFlag && (
        <Alert tone="warning" title="Safeguarding flag">
          This incident is flagged as a safeguarding concern. Visibility is restricted and the safeguarding lead has been alerted.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Incident account" subtitle="Recorded narrative" icon={ShieldAlert} />
            <div className="p-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">{incident.description}</p>
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {incident.location ?? 'No location recorded'}
                </span>
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" /> Logged {formatDateTime(incident.createdAt)}
                </span>
                <span className="flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5" /> {refName(incident.reportedBy)}
                </span>
              </div>
            </div>
          </Card>

          {incident.witnesses?.length ? (
            <Card>
              <CardHeader title="Witnesses" subtitle="Statements captured by the reporter" icon={UserRound} />
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {incident.witnesses.map((w, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <p className="font-medium">{w.name}</p>
                    {w.statement && <p className="mt-0.5 text-slate-600 dark:text-slate-300">{w.statement}</p>}
                    {w.contact && <p className="mt-0.5 text-xs text-slate-400">{w.contact}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Case history" subtitle="Every action is timestamped and attributed" icon={ClipboardCheck} />
            {incident.history?.length ? (
              <ol className="relative space-y-4 p-5 pl-8">
                <span className="absolute bottom-6 left-[21px] top-8 w-px bg-line dark:bg-[#26374f]" aria-hidden />
                {[...incident.history].reverse().map((h, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[22px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-white bg-brand-500 dark:border-[#101a2c]" />
                    <p className="text-sm font-medium">{titleCase(h.action)}</p>
                    {h.note && <p className="text-sm text-slate-600 dark:text-slate-300">{h.note}</p>}
                    <p className="text-xs text-slate-400">{formatDateTime(h.at)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No history yet" message="Actions will appear as the case moves through review." />
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Decision snapshot" subtitle="Rule outcomes and notifications" icon={ShieldAlert} />
            <dl className="space-y-3 p-5 text-sm">
              <Row label="Student">
                {studentUrl ? (
                  <Link to={studentUrl} className="link font-medium">
                    {incident.studentSnapshot.fullName}
                  </Link>
                ) : (
                  incident.studentSnapshot.fullName
                )}
              </Row>
              <Row label="Student ID">{incident.studentSnapshot.studentId}</Row>
              {typeof studentRef?.currentBalance === 'number' && <Row label="Current balance">{studentRef.currentBalance}</Row>}
              <Row label="Offence code">{incident.offenceSnapshot.code ?? '—'}</Row>
              <Row label="Deduction">
                <span className="font-mono font-semibold text-risk-red">−{incident.offenceSnapshot.deduction}</span>
              </Row>
              <Row label="Approval required">{incident.offenceSnapshot.requiresApproval ? 'Yes' : 'No'}</Row>
              <Row label="Evidence required">{incident.offenceSnapshot.requiresEvidence ? 'Yes' : 'No'}</Row>
              <Row label="Deduction applied">{incident.deductionApplied ? 'Yes' : 'Not yet'}</Row>
              <Row label="Guardian notice">
                <StatusBadge status={incident.parentNotificationStatus} />
              </Row>
              <Row label="Reported by">{refName(incident.reportedBy)}</Row>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Independent review" subtitle="Separation of duties enforced" icon={CheckCircle2} />
            <div className="p-5 text-sm">
              {incident.review?.reviewedAt ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Outcome</span>
                    <Badge tone={incident.review.decision === 'approved' ? 'emerald' : incident.review.decision === 'rejected' ? 'red' : 'amber'}>
                      {titleCase(incident.review.decision ?? 'pending')}
                    </Badge>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">
                    {refName(incident.review.reviewedBy)} · {formatDateTime(incident.review.reviewedAt)}
                  </p>
                  {incident.review.comments && <p className="rounded-lg bg-slate-50 p-3 text-slate-600 dark:bg-[#0c1524] dark:text-slate-300">{incident.review.comments}</p>}
                </div>
              ) : (
                <p className="text-slate-500 dark:text-slate-400">
                  {isReporter
                    ? 'You reported this incident, so a different reviewer must decide it.'
                    : 'Awaiting an independent decision from an authorised reviewer.'}
                </p>
              )}
            </div>
          </Card>

          {incident.evidenceIds?.length ? (
            <Card>
              <CardHeader title="Evidence" subtitle="Secure attachments" icon={ShieldAlert} />
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {incident.evidenceIds.map((ev) => (
                  <li key={ev._id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="truncate">{ev.originalName}</span>
                    <Badge tone={ev.classification === 'restricted' ? 'red' : ev.classification === 'confidential' ? 'amber' : 'slate'}>
                      {titleCase(ev.classification)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Independent review decision"
        subtitle="You cannot review an incident you reported. Decisions are permanently audited."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={decision === 'reject' ? 'danger' : 'primary'}
              loading={reviewMutation.isPending}
              disabled={decision === 'reject' && comments.trim().length < 3}
              onClick={() => reviewMutation.mutate()}
            >
              Confirm {decision === 'approve' ? 'approval' : decision === 'reject' ? 'rejection' : 'request'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                { key: 'approve', label: 'Approve', icon: CheckCircle2, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' },
                { key: 'reject', label: 'Reject', icon: XCircle, tone: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' },
                { key: 'request_info', label: 'Request info', icon: ClipboardCheck, tone: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setDecision(opt.key)}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm font-medium transition ${
                  decision === opt.key ? opt.tone : 'border-line text-slate-500 hover:border-slate-300 dark:border-[#26374f]'
                }`}
              >
                <opt.icon className="h-4 w-4" />
                {opt.label}
              </button>
            ))}
          </div>
          <Field label="Review comments" hint={decision === 'reject' ? 'A reason is required for rejection.' : 'Optional context for the reporter.'}>
            <Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Explain the basis for this decision…" />
          </Field>
          {incident.severity === 'serious' || incident.severity === 'critical' ? (
            <Alert tone="info" title="High-impact incident">
              Serious and critical incidents require headteacher approval. If you are not the headteacher, this decision escalates automatically.
            </Alert>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 last:border-0 last:pb-0 dark:border-[#1f2f49]">
      <dt className="text-xs uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
