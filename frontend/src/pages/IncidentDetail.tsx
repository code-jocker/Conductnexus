import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardCheck, FileSearch, Gavel, MapPin, Scale, Send, ShieldAlert, UserRound, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, patch, post } from '../lib/api'
import { refName, useStaff } from '../lib/hooks'
import { formatDate, formatDateTime, humanBytes, titleCase } from '../lib/utils'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatusBadge, Textarea } from '../components/ui'
import { useToast } from '../components/toast'

type IncidentDetail = {
  _id: string
  incidentNumber: string
  studentSnapshot: { fullName: string; studentId: string; className?: string; dormitoryName?: string }
  offenceSnapshot: { name: string; code?: string; deduction: number; severity: string; requiresApproval?: boolean; requiresEvidence?: boolean; notifyParent?: boolean }
  description: string
  occurredAt: string
  location?: string
  immediateAction?: string
  severity: string
  status: string
  deductionApplied?: boolean
  ledgerId?: string
  sanctions?: Sanction[]
  parentNotificationStatus?: string
  safeguardingFlag?: boolean
  reportedBy?: { _id?: string; name?: string; position?: string } | string
  review?: { reviewedBy?: { name?: string; position?: string } | string; reviewedAt?: string; decision?: string; comments?: string }
  studentId?: { _id?: string; fullName?: string; studentId?: string; currentBalance?: number; riskLevel?: string } | string
  witnesses?: { name: string; contact?: string; statement?: string }[]
  evidenceIds?: { _id: string; originalName: string; classification: string; reviewStatus?: string; mimeType?: string; size?: number }[]
  history?: { at: string; action: string; note?: string }[]
  createdAt: string
}

type Sanction = {
  _id: string
  title: string
  type: string
  details?: string
  startDate?: string
  endDate?: string
  status: 'active' | 'completed' | 'cancelled'
  issuedBy?: { name?: string } | string
  issuedAt: string
}

type InvestigationSummary = {
  _id: string
  caseNumber: string
  title: string
  status: string
  deadline?: string
  assignedTo?: { name?: string } | string
  createdAt: string
}

type AppealSummary = {
  _id: string
  appealNumber: string
  grounds: string
  status: string
  submittedAt: string
  decision?: string
}

const SANCTION_TYPES = [
  { value: 'warning', label: 'Written warning' },
  { value: 'detention', label: 'Detention' },
  { value: 'community_service', label: 'Community service' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'expulsion_recommendation', label: 'Expulsion recommendation' },
  { value: 'counselling', label: 'Counselling referral' },
  { value: 'other', label: 'Other' },
]

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
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeNote, setCloseNote] = useState('')
  const [sanctionOpen, setSanctionOpen] = useState(false)
  const [sanctionForm, setSanctionForm] = useState({ title: '', type: 'warning', details: '', startDate: '', endDate: '' })
  const [investigationOpen, setInvestigationOpen] = useState(false)
  const [investigationForm, setInvestigationForm] = useState({ title: '', assignedTo: '', deadline: '' })

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

  const closeMutation = useMutation({
    mutationFn: () => post(`/incidents/${id}/close`, { note: closeNote.trim() }),
    onSuccess: () => {
      success('Case closed and archived in the audit trail')
      setCloseOpen(false)
      setCloseNote('')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const sanctionMutation = useMutation({
    mutationFn: () =>
      post(`/incidents/${id}/sanctions`, {
        title: sanctionForm.title.trim(),
        type: sanctionForm.type,
        details: sanctionForm.details.trim() || undefined,
        startDate: sanctionForm.startDate || undefined,
        endDate: sanctionForm.endDate || undefined,
      }),
    onSuccess: () => {
      success('Sanction recorded on the case')
      setSanctionOpen(false)
      setSanctionForm({ title: '', type: 'warning', details: '', startDate: '', endDate: '' })
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const sanctionStatusMutation = useMutation({
    mutationFn: ({ sanctionId, status }: { sanctionId: string; status: Sanction['status'] }) =>
      patch(`/incidents/${id}/sanctions/${sanctionId}`, { status }),
    onSuccess: () => {
      success('Sanction updated')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const investigationMutation = useMutation({
    mutationFn: (payload: { studentId: string; title: string; assignedTo?: string; deadline?: string }) =>
      post('/investigations', { ...payload, incidentIds: [id] }),
    onSuccess: () => {
      success('Investigation opened and linked to this case')
      setInvestigationOpen(false)
      setInvestigationForm({ title: '', assignedTo: '', deadline: '' })
      void queryClient.invalidateQueries({ queryKey: ['incident-investigations', id] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const canViewInvestigations = has('investigations.view')
  const { data: investigations } = useQuery({
    queryKey: ['incident-investigations', id],
    queryFn: async () => (await getPage<InvestigationSummary>('/investigations', { incidentId: id, pageSize: 10 })).items,
    enabled: canViewInvestigations && Boolean(id),
  })

  const canViewAppeals = has('appeals.view')
  const { data: appeals } = useQuery({
    queryKey: ['incident-appeals', id],
    queryFn: async () => (await getPage<AppealSummary>('/appeals', { incidentId: id, pageSize: 10 })).items,
    enabled: canViewAppeals && Boolean(id),
  })

  const { data: staff } = useStaff(has('users.view'))

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
  const canClose = ['approved', 'rejected', 'resolved', 'escalated'].includes(incident.status) && has('incidents.close')
  const canRecordSanction = ['approved', 'resolved'].includes(incident.status) && has('incidents.review')
  const canOpenInvestigation = has('investigations.create')
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
            {canClose && (
              <Button variant="secondary" icon={CheckCircle2} onClick={() => setCloseOpen(true)}>
                Close case
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
              {incident.immediateAction && (
                <div className="mt-4 rounded-lg border border-line/70 bg-slate-50 p-3 dark:border-[#26374f] dark:bg-[#0c1524]">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Immediate action taken</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{incident.immediateAction}</p>
                </div>
              )}
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

          {canViewInvestigations && (
            <Card>
              <CardHeader
                title="Investigation"
                subtitle="Formal fact-finding linked to this case"
                icon={FileSearch}
                actions={
                  canOpenInvestigation ? (
                    <Button size="sm" variant="secondary" onClick={() => setInvestigationOpen(true)}>
                      Open investigation
                    </Button>
                  ) : undefined
                }
              />
              {investigations?.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {investigations.map((inv) => (
                    <li key={inv._id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{inv.title}</p>
                        <p className="text-xs text-slate-400">
                          {inv.caseNumber} · {typeof inv.assignedTo === 'object' ? inv.assignedTo?.name ?? 'Unassigned' : 'Unassigned'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <StatusBadge status={inv.status} />
                        {inv.deadline && <p className="mt-1 text-xs text-slate-400">Due {formatDate(inv.deadline)}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-5 text-sm text-slate-500 dark:text-slate-400">
                  No investigation is linked yet.{' '}
                  <Link to="/investigations" className="link font-semibold">
                    Open the investigation desk
                  </Link>
                </div>
              )}
            </Card>
          )}

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
              {incident.ledgerId && studentUrl && (
                <Row label="Ledger">
                  <Link to={`${studentUrl}?tab=ledger`} className="link">
                    View conduct ledger
                  </Link>
                </Row>
              )}
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

          <Card>
            <CardHeader
              title="Sanctions & outcomes"
              subtitle="Non-monetary measures issued with this decision"
              icon={Gavel}
              actions={
                canRecordSanction ? (
                  <Button size="sm" variant="secondary" onClick={() => setSanctionOpen(true)}>
                    Issue sanction
                  </Button>
                ) : undefined
              }
            />
            {incident.sanctions?.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {incident.sanctions.map((sanction) => (
                  <li key={sanction._id} className="px-5 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{sanction.title}</p>
                        <p className="text-xs text-slate-400">
                          {titleCase(sanction.type)} · {refName(sanction.issuedBy)} · {formatDate(sanction.issuedAt)}
                        </p>
                        {sanction.details && <p className="mt-1 text-slate-600 dark:text-slate-300">{sanction.details}</p>}
                        {(sanction.startDate || sanction.endDate) && (
                          <p className="mt-1 text-xs text-slate-400">
                            {sanction.startDate ? formatDate(sanction.startDate) : '—'} → {sanction.endDate ? formatDate(sanction.endDate) : 'Open'}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <StatusBadge status={sanction.status} />
                        {canRecordSanction && sanction.status === 'active' && (
                          <div className="mt-1 flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => sanctionStatusMutation.mutate({ sanctionId: sanction._id, status: 'completed' })}>
                              Complete
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => sanctionStatusMutation.mutate({ sanctionId: sanction._id, status: 'cancelled' })}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-5 text-sm text-slate-500 dark:text-slate-400">
                {canRecordSanction
                  ? 'No sanction recorded. Add warnings, detention, suspension or referral outcomes here.'
                  : 'No sanctions have been issued for this case.'}
              </div>
            )}
          </Card>

          {canViewAppeals && (
            <Card>
              <CardHeader
                title="Appeals"
                subtitle="Challenges raised against this decision"
                icon={Scale}
                actions={
                  <Link to="/appeals" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    Appeal desk
                  </Link>
                }
              />
              {appeals?.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {appeals.map((appeal) => (
                    <li key={appeal._id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">{appeal.appealNumber}</p>
                        <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{appeal.grounds}</p>
                        <p className="mt-0.5 text-xs text-slate-400">Submitted {formatDate(appeal.submittedAt)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <StatusBadge status={appeal.status} />
                        {appeal.decision && <p className="mt-1 text-xs text-slate-400">{titleCase(appeal.decision)}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-5 text-sm text-slate-500 dark:text-slate-400">No appeal has been lodged against this case.</div>
              )}
            </Card>
          )}

          <Card>
            <CardHeader
              title="Evidence"
              subtitle="Secure attachments with review status"
              icon={ShieldAlert}
              actions={
                <Link
                  to={`/incidents/${id}/evidence`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-[#2a3b55] dark:text-slate-300 dark:hover:bg-white/5"
                >
                  Open workspace
                </Link>
              }
            />
            {incident.evidenceIds?.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {incident.evidenceIds.map((ev) => (
                  <li key={ev._id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{ev.originalName}</span>
                      <span className="block text-xs text-slate-400">
                        {ev.reviewStatus ? titleCase(ev.reviewStatus) : 'Awaiting review'}
                        {typeof ev.size === 'number' ? ` · ${humanBytes(ev.size)}` : ''}
                      </span>
                    </span>
                    <Badge tone={ev.classification === 'restricted' ? 'red' : ev.classification === 'confidential' ? 'amber' : 'slate'}>
                      {titleCase(ev.classification)}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-5 text-sm text-slate-500 dark:text-slate-400">
                {incident.offenceSnapshot.requiresEvidence
                  ? 'This offence requires evidence before submission. Attach at least one file in the evidence workspace.'
                  : 'No evidence attached to this case yet.'}
              </div>
            )}
          </Card>
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

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Close this case"
        subtitle="Closing freezes the case as reviewed. The record stays in the audit trail and remains searchable."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button variant="dark" loading={closeMutation.isPending} disabled={closeNote.trim().length < 3} onClick={() => closeMutation.mutate()}>
              Close case
            </Button>
          </>
        }
      >
        <Field label="Closure note" hint="Summarise the outcome, notifications sent and any follow-up.">
          <Textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Decision communicated to the guardian; sanction completed; no further action." />
        </Field>
      </Modal>

      <Modal
        open={sanctionOpen}
        onClose={() => setSanctionOpen(false)}
        title="Issue a sanction"
        subtitle="Sanctions are attached to the approved case and recorded in the audit trail."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSanctionOpen(false)}>Cancel</Button>
            <Button loading={sanctionMutation.isPending} disabled={sanctionForm.title.trim().length < 3} onClick={() => sanctionMutation.mutate()}>
              Record sanction
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Sanction" required>
            <Input value={sanctionForm.title} onChange={(e) => setSanctionForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Two-day suspension from lessons" />
          </Field>
          <Field label="Type">
            <Select value={sanctionForm.type} onChange={(e) => setSanctionForm((f) => ({ ...f, type: e.target.value }))}>
              {SANCTION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date">
              <Input type="date" value={sanctionForm.startDate} onChange={(e) => setSanctionForm((f) => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="End date">
              <Input type="date" value={sanctionForm.endDate} onChange={(e) => setSanctionForm((f) => ({ ...f, endDate: e.target.value }))} />
            </Field>
          </div>
          <Field label="Details" hint="Conditions, duration and who was informed.">
            <Textarea value={sanctionForm.details} onChange={(e) => setSanctionForm((f) => ({ ...f, details: e.target.value }))} placeholder="Sanction supervised by the deputy; guardian informed by phone." />
          </Field>
        </div>
      </Modal>

      <Modal
        open={investigationOpen}
        onClose={() => setInvestigationOpen(false)}
        title="Open an investigation"
        subtitle="This case and its evidence will be linked to the new investigation file."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInvestigationOpen(false)}>Cancel</Button>
            <Button
              loading={investigationMutation.isPending}
              disabled={investigationForm.title.trim().length < 5 || !studentRef?._id}
              onClick={() =>
                studentRef?._id &&
                investigationMutation.mutate({
                  studentId: studentRef._id,
                  title: investigationForm.title.trim(),
                  assignedTo: investigationForm.assignedTo || undefined,
                  deadline: investigationForm.deadline || undefined,
                })
              }
            >
              Open investigation
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Investigation title" required>
            <Input value={investigationForm.title} onChange={(e) => setInvestigationForm((f) => ({ ...f, title: e.target.value }))} placeholder={`Investigation into ${incident.offenceSnapshot.name.toLowerCase()}`} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Investigator" hint={staff?.length ? undefined : 'Staff directory unavailable for your role.'}>
              <Select value={investigationForm.assignedTo} onChange={(e) => setInvestigationForm((f) => ({ ...f, assignedTo: e.target.value }))} disabled={!staff?.length}>
                <option value="">Unassigned</option>
                {(staff ?? []).map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Deadline">
              <Input type="date" value={investigationForm.deadline} onChange={(e) => setInvestigationForm((f) => ({ ...f, deadline: e.target.value }))} />
            </Field>
          </div>
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
