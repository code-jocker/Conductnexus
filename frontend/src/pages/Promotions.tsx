import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, GraduationCap, Play, Plus, RefreshCw, Send, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, post } from '../lib/api'
import { useStructure } from '../lib/hooks'
import { formatDate, titleCase } from '../lib/utils'
import type { PaginationMeta, PromotionBatch } from '../lib/types'
import { useToast } from '../components/toast'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
  Tabs,
  Textarea,
} from '../components/ui'

type BatchItem = {
  _id?: string
  studentId: string
  studentSnapshot: { fullName: string; studentId: string; admissionNumber: string }
  status: string
  error?: string
  toClassId?: string | null
}

type BatchDetail = PromotionBatch & {
  items: BatchItem[]
  submittedBy?: { name?: string } | string
  reviewedBy?: { name?: string } | string
  executedBy?: { name?: string } | string
  history?: { at: string; action: string; note?: string }[]
}

type StatusFilter = 'all' | 'draft' | 'submitted' | 'approved' | 'completed' | 'failed' | 'cancelled'

function refLabel(ref: PromotionBatch['fromClassId'] | PromotionBatch['toClassId']) {
  if (!ref) return '—'
  if (typeof ref === 'string') return ref
  return ref.name ?? '—'
}

export function PromotionsPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const canPromote = has('students.promote')
  const canApprove = has('students.promote.approve')

  const { data: structure } = useStructure()
  const classes = structure?.classes ?? []
  const years = structure?.years ?? []
  const terms = structure?.terms ?? []

  const { data, isLoading } = useQuery({
    queryKey: ['promotions', status, q, page],
    queryFn: () =>
      getPage<PromotionBatch>('/promotions', {
        page,
        pageSize: 20,
        status: status === 'all' ? undefined : status,
        q: q || undefined,
      }),
  })

  const batches = data?.items ?? []
  const meta: PaginationMeta = data?.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 1 }
  const countFor = (value: StatusFilter) =>
    value === 'all' ? batches.length : batches.filter((b) => b.status === value).length

  const summary = useMemo(() => {
    const active = batches.filter((b) => ['draft', 'submitted', 'approved'].includes(b.status)).length
    const awaiting = batches.filter((b) => b.status === 'submitted').length
    const completed = batches.filter((b) => b.status === 'completed').length
    return { active, awaiting, completed }
  }, [batches])

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Student lifecycle"
        title="Promotions"
        subtitle="Prepare cohort promotions or graduations, route them for approval, and execute them safely with a full audit trail."
        actions={
          canPromote ? (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              New batch
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open batches" value={summary.active} icon={RefreshCw} hint="Draft, submitted or approved" />
        <StatCard label="Awaiting approval" value={summary.awaiting} icon={Send} tone="amber" hint="Submitted for review" />
        <StatCard label="Completed" value={summary.completed} icon={CheckCircle2} tone="emerald" hint="On this page of results" />
      </div>

      <Tabs
        tabs={[
          { key: 'all', label: 'All', count: countFor('all') },
          { key: 'draft', label: 'Draft', count: countFor('draft') },
          { key: 'submitted', label: 'Submitted', count: countFor('submitted') },
          { key: 'approved', label: 'Approved', count: countFor('approved') },
          { key: 'completed', label: 'Completed', count: countFor('completed') },
          { key: 'failed', label: 'Failed', count: countFor('failed') },
          { key: 'cancelled', label: 'Cancelled', count: countFor('cancelled') },
        ]}
        active={status}
        onChange={(key) => {
          setStatus(key as StatusFilter)
          setPage(1)
        }}
      />

      <Card>
        <CardHeader
          title="Promotion batches"
          subtitle="Each batch is idempotent — re-running it never promotes a student twice."
          icon={GraduationCap}
          actions={<SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search batch or title…" className="w-56" />}
        />
        {isLoading ? (
          <LoadingBlock label="Loading promotion batches…" />
        ) : batches.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                  <th className="px-5 py-2.5 font-semibold">Batch</th>
                  <th className="px-3 py-2.5 font-semibold">Movement</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Created</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch._id} className="row-hover border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                    <td className="px-5 py-3">
                      <button className="font-medium hover:text-brand-600" onClick={() => setSelectedId(batch._id)}>
                        {batch.batchNumber}
                      </button>
                      <p className="max-w-xs truncate text-xs text-slate-400">{batch.title}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        {refLabel(batch.fromClassId)}
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                        {batch.graduate ? <Badge tone="emerald">Graduation</Badge> : refLabel(batch.toClassId)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={batch.status} />
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">{formatDate(batch.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setSelectedId(batch._id)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination meta={meta} onPage={setPage} />
          </div>
        ) : (
          <EmptyState
            title="No promotion batches"
            message="Create a batch to move a cohort to the next class, or to graduate a final-year class."
            icon={GraduationCap}
            action={
              canPromote ? (
                <Button icon={Plus} onClick={() => setCreateOpen(true)}>
                  New batch
                </Button>
              ) : undefined
            }
          />
        )}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New promotion batch" subtitle="Students are staged from the selected source class. Nothing changes until the batch is approved and executed." size="lg">
        <CreateBatchForm
          classes={classes}
          years={years}
          terms={terms}
          onCancel={() => setCreateOpen(false)}
          onCreated={(batch) => {
            setCreateOpen(false)
            queryClient.invalidateQueries({ queryKey: ['promotions'] })
            success(`Batch ${batch.batchNumber} created`)
            setSelectedId(batch._id)
          }}
          onError={(message) => toastError(message)}
        />
      </Modal>

      <Modal open={Boolean(selectedId)} onClose={() => setSelectedId(null)} title="Promotion batch" subtitle="Review students, then submit, approve or execute." size="xl">
        {selectedId ? (
          <BatchDetailPanel
            id={selectedId}
            canPromote={canPromote}
            canApprove={canApprove}
            onClose={() => setSelectedId(null)}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['promotions'] })}
            onSuccess={success}
            onError={toastError}
          />
        ) : null}
      </Modal>
    </div>
  )
}

function CreateBatchForm({
  classes,
  years,
  terms,
  onCancel,
  onCreated,
  onError,
}: {
  classes: { _id: string; name: string; level: string; active: boolean }[]
  years: { _id: string; name: string; isActive: boolean }[]
  terms: { _id: string; name: string; academicYearId: string; isActive: boolean }[]
  onCancel: () => void
  onCreated: (batch: PromotionBatch) => void
  onError: (message: string) => void
}) {
  const [title, setTitle] = useState('')
  const [fromClassId, setFromClassId] = useState('')
  const [toClassId, setToClassId] = useState('')
  const [graduate, setGraduate] = useState(false)
  const [toAcademicYearId, setToAcademicYearId] = useState('')
  const [toTermId, setToTermId] = useState('')
  const [reason, setReason] = useState('')

  const activeClasses = classes.filter((c) => c.active)
  const destinations = activeClasses.filter((c) => c._id !== fromClassId)
  const termOptions = toAcademicYearId ? terms.filter((t) => t.academicYearId === toAcademicYearId) : terms

  const mutation = useMutation({
    mutationFn: () =>
      post<PromotionBatch>('/promotions', {
        title: title.trim(),
        fromClassId,
        toClassId: graduate ? null : toClassId || null,
        graduate,
        toAcademicYearId: toAcademicYearId || null,
        toTermId: toTermId || null,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (batch) => onCreated(batch),
    onError: (err) => onError(apiError(err)),
  })

  return (
    <div className="space-y-4">
      <Field label="Batch title" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. S3 to S4 promotion — Term 1 2027" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Source class" required>
          <Select
            value={fromClassId}
            onChange={(e) => {
              setFromClassId(e.target.value)
              if (e.target.value === toClassId) setToClassId('')
            }}
          >
            <option value="">Select class…</option>
            {activeClasses.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} · {c.level}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Destination class" hint={graduate ? 'Graduation batch — no destination needed' : undefined}>
          <Select value={toClassId} onChange={(e) => setToClassId(e.target.value)} disabled={graduate}>
            <option value="">Select class…</option>
            {destinations.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} · {c.level}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={graduate} onChange={(e) => setGraduate(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        Mark this cohort as graduated
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Destination academic year" hint="Optional — updates each learner's year when executed">
          <Select value={toAcademicYearId} onChange={(e) => { setToAcademicYearId(e.target.value); setToTermId('') }}>
            <option value="">Keep current year</option>
            {years.map((y) => (
              <option key={y._id} value={y._id}>
                {y.name}{y.isActive ? ' · active' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Destination term" hint="Optional — updates conduct allocation term">
          <Select value={toTermId} onChange={(e) => setToTermId(e.target.value)}>
            <option value="">Keep current term</option>
            {termOptions.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}{t.isActive ? ' · active' : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Reason / notes" hint="Shown to approvers and stored in the audit trail">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why this cohort is moving…" />
      </Field>
      {!graduate && !toClassId ? <Alert tone="warning">Select a destination class or mark the cohort as graduated.</Alert> : null}
      <div className="flex justify-end gap-2 border-t border-line pt-3 dark:border-[#1f2f49]">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button loading={mutation.isPending} disabled={title.trim().length < 3 || !fromClassId || (!graduate && !toClassId)} onClick={() => mutation.mutate()}>
          Create batch
        </Button>
      </div>
    </div>
  )
}

function BatchDetailPanel({
  id,
  canPromote,
  canApprove,
  onClose,
  onChanged,
  onSuccess,
  onError,
}: {
  id: string
  canPromote: boolean
  canApprove: boolean
  onClose: () => void
  onChanged: () => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  const { data: batch, isLoading } = useQuery({
    queryKey: ['promotion', id],
    queryFn: () => get<BatchDetail>(`/promotions/${id}`),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['promotion', id] })
    onChanged()
  }

  const act = useMutation({
    mutationFn: ({ action, body }: { action: 'submit' | 'approve' | 'execute' | 'retry' | 'reject' | 'cancel'; body?: unknown }) =>
      post(`/promotions/${id}/${action}`, body),
    onSuccess: (_data, variables) => {
      const labels: Record<string, string> = {
        submit: 'Batch submitted for approval',
        approve: 'Batch approved',
        execute: 'Batch executed',
        retry: 'Failed students retried',
        reject: 'Batch rejected',
        cancel: 'Batch cancelled',
      }
      onSuccess(labels[variables.action] ?? 'Batch updated')
      setRejectOpen(false)
      setCancelOpen(false)
      setReason('')
      refresh()
    },
    onError: (err) => onError(apiError(err)),
  })

  if (isLoading || !batch) return <LoadingBlock label="Loading batch…" />

  const items = batch.items ?? []
  const tally = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})

  const canExecute = batch.status === 'approved' && canPromote
  const canSubmit = ['draft', 'rejected'].includes(batch.status) && canPromote
  const canReview = batch.status === 'submitted' && canApprove
  const canRetry = batch.status === 'failed' && canPromote
  const canCancel = !['completed', 'cancelled', 'executing'].includes(batch.status) && canPromote

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-slate-50/70 p-4 dark:border-[#1f2f49] dark:bg-white/[0.02]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{batch.batchNumber}</p>
            <h3 className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-white">{batch.title}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              {refLabel(batch.fromClassId)}
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              {batch.graduate ? <Badge tone="emerald">Graduation</Badge> : refLabel(batch.toClassId)}
            </p>
          </div>
          <StatusBadge status={batch.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="uppercase tracking-wider text-slate-400">Students</dt>
            <dd className="mt-0.5 text-sm font-semibold">{items.length}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider text-slate-400">Promoted</dt>
            <dd className="mt-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">{tally.promoted ?? 0}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider text-slate-400">Graduated</dt>
            <dd className="mt-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">{tally.graduated ?? 0}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider text-slate-400">Failed / pending</dt>
            <dd className="mt-0.5 text-sm font-semibold">
              <span className="text-red-600 dark:text-red-400">{tally.failed ?? 0}</span> / {tally.pending ?? 0}
            </dd>
          </div>
        </dl>
        {batch.reason ? <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{batch.reason}</p> : null}
        {batch.rejectionReason ? <Alert tone="danger" title="Rejected">{batch.rejectionReason}</Alert> : null}
        {batch.decisionNotes ? <Alert tone="info" title="Approval notes">{batch.decisionNotes}</Alert> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {canSubmit ? (
          <Button icon={Send} loading={act.isPending} onClick={() => act.mutate({ action: 'submit' })}>
            Submit for approval
          </Button>
        ) : null}
        {canReview ? (
          <>
            <Button icon={CheckCircle2} loading={act.isPending} onClick={() => act.mutate({ action: 'approve', body: { notes: notes.trim() || undefined } })}>
              Approve
            </Button>
            <Button variant="danger" icon={XCircle} onClick={() => setRejectOpen(true)}>
              Reject
            </Button>
          </>
        ) : null}
        {canExecute ? (
          <Button icon={Play} loading={act.isPending} onClick={() => act.mutate({ action: 'execute' })}>
            Execute batch
          </Button>
        ) : null}
        {canRetry ? (
          <Button icon={RefreshCw} loading={act.isPending} onClick={() => act.mutate({ action: 'retry' })}>
            Retry failed students
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>
            Cancel batch
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      {canReview ? (
        <Field label="Approval notes" hint="Optional — shared with the batch creator">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes for the audit trail…" />
        </Field>
      ) : null}

      <div>
        <h4 className="mb-2 text-sm font-semibold">Students</h4>
        <div className="max-h-72 overflow-x-auto overflow-y-auto rounded-lg border border-line dark:border-[#1f2f49]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-400 dark:bg-[#0f1a2b]">
              <tr>
                <th className="px-4 py-2 font-semibold">Student</th>
                <th className="px-3 py-2 font-semibold">Admission</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id ?? item.studentId} className="border-t border-line/60 dark:border-[#1f2f49]">
                  <td className="px-4 py-2">
                    <p className="font-medium">{item.studentSnapshot?.fullName ?? 'Student'}</p>
                    <p className="text-xs text-slate-400">{item.studentSnapshot?.studentId}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{item.studentSnapshot?.admissionNumber}</td>
                  <td className="px-3 py-2">
                    <Badge tone={item.status === 'failed' ? 'red' : item.status === 'pending' ? 'slate' : 'emerald'}>{titleCase(item.status)}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{item.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {batch.history?.length ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold">History</h4>
          <ul className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
            {batch.history.map((entry, i) => (
              <li key={i}>
                <span className="font-medium text-slate-700 dark:text-slate-200">{titleCase(entry.action)}</span> · {formatDate(entry.at)}
                {entry.note ? ` · ${entry.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject batch" subtitle="The creator will be notified with your reason." size="sm">
        <div className="space-y-4">
          <Field label="Reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={act.isPending} disabled={reason.trim().length < 3} onClick={() => act.mutate({ action: 'reject', body: { reason: reason.trim() } })}>
              Reject batch
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel batch" subtitle="Nothing is applied to students. The batch stays on record." size="sm">
        <div className="space-y-4">
          <Field label="Reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep batch
            </Button>
            <Button variant="danger" loading={act.isPending} disabled={reason.trim().length < 3} onClick={() => act.mutate({ action: 'cancel', body: { reason: reason.trim() } })}>
              Cancel batch
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
