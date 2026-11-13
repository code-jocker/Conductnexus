import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck, Inbox, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, getPage, post } from '../lib/api'
import type { Approval, PaginationMeta } from '../lib/types'
import { refName } from '../lib/hooks'
import { formatDateTime, titleCase } from '../lib/utils'
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Pagination, StatusBadge, Tabs, Textarea } from '../components/ui'
import { useToast } from '../components/toast'

type ApprovalDetail = Approval & {
  decisionNotes?: string
  rejectionReason?: string
  decidedBy?: { name?: string } | string
  studentId?: { fullName?: string; studentId?: string; currentBalance?: number } | string
}

export function ApprovalsPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ApprovalDetail | null>(null)
  const [decision, setDecision] = useState<'approve' | 'reject' | 'request_info'>('approve')
  const [notes, setNotes] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['approvals', status, page],
    queryFn: () => getPage<Approval>('/approvals', { status, page, pageSize: 20 }),
  })

  const items = data?.items ?? []
  const meta = (data?.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 1 }) as PaginationMeta & { pendingCount?: number }

  const decide = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('No approval selected')
      if (decision === 'approve') return post(`/approvals/${selected._id}/approve`, { notes: notes.trim() || undefined })
      const field = decision === 'reject' ? 'reason' : 'notes'
      return post(`/approvals/${selected._id}/${decision === 'reject' ? 'reject' : 'request-info'}`, { [field]: notes.trim() })
    },
    onSuccess: () => {
      success(decision === 'approve' ? 'Approval granted and the underlying action executed' : decision === 'reject' ? 'Approval rejected' : 'Information requested from the requester')
      setSelected(null)
      setNotes('')
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const canDecide = selected && selected.status === 'pending' && has(selected.requiredPermission)

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Separation of duties"
        title="Approvals"
        subtitle="Independent decisions for high-impact conduct, adjustments, letters, appeals and safeguarding escalations."
        actions={
          typeof meta.pendingCount === 'number' ? (
            <Badge tone={meta.pendingCount ? 'amber' : 'emerald'}>{meta.pendingCount} awaiting you</Badge>
          ) : undefined
        }
      />

      <Tabs
        tabs={[
          { key: 'pending', label: 'Pending', count: meta.pendingCount },
          { key: 'all', label: 'All' },
          { key: 'approved', label: 'Approved' },
          { key: 'rejected', label: 'Rejected' },
          { key: 'info_requested', label: 'Info requested' },
        ]}
        active={status}
        onChange={(key) => {
          setStatus(key)
          setPage(1)
        }}
      />

      <Card>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 w-full" />
            ))}
          </div>
        ) : items.length ? (
          <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
            {items.map((approval) => (
              <li key={approval._id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(approval as ApprovalDetail)
                    setDecision('approve')
                    setNotes('')
                  }}
                  className="flex w-full flex-col gap-2 px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-white/5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{titleCase(approval.type)}</Badge>
                      {approval.approvalNumber && <span className="font-mono text-[11px] text-slate-400">{approval.approvalNumber}</span>}
                      <StatusBadge status={approval.status} />
                    </div>
                    <p className="mt-1.5 truncate font-medium">{approval.title}</p>
                    {approval.summary && <p className="truncate text-xs text-slate-500">{approval.summary}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">
                      Requested by {refName(approval.requestedBy)} · {formatDateTime(approval.createdAt)}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-600">
                    Open <ClipboardCheck className="h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={status === 'pending' ? 'Nothing waiting for you' : 'No approvals found'}
            message={status === 'pending' ? 'Your approval queue is clear. High-impact actions require a different approver.' : 'Try a different filter.'}
            icon={Inbox}
          />
        )}
        <div className="border-t border-line px-5 py-3 dark:border-[#26374f]">
          <Pagination meta={meta} onPage={setPage} />
        </div>
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title ?? 'Approval'}
        subtitle={selected ? `${titleCase(selected.type)} · required permission ${selected.requiredPermission}` : undefined}
        size="lg"
        footer={
          canDecide ? (
            <>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
              <Button
                variant={decision === 'reject' ? 'danger' : 'primary'}
                loading={decide.isPending}
                disabled={(decision === 'reject' || decision === 'request_info') && notes.trim().length < 3}
                onClick={() => decide.mutate()}
              >
                {decision === 'approve' ? 'Approve' : decision === 'reject' ? 'Reject' : 'Request information'}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Close
            </Button>
          )
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            {selected.summary && <p className="rounded-lg bg-slate-50 p-3 text-slate-600 dark:bg-[#0c1524] dark:text-slate-300">{selected.summary}</p>}
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Status</dt>
                <dd className="mt-0.5"><StatusBadge status={selected.status} /></dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Requested by</dt>
                <dd className="mt-0.5 font-medium">{refName(selected.requestedBy)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Created</dt>
                <dd className="mt-0.5">{formatDateTime(selected.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Decided</dt>
                <dd className="mt-0.5">{selected.decidedAt ? formatDateTime(selected.decidedAt) : '—'}</dd>
              </div>
              {typeof selected.studentId === 'object' && selected.studentId?.fullName && (
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Student</dt>
                  <dd className="mt-0.5 font-medium">
                    {selected.studentId.fullName} {selected.studentId.studentId ? `· ${selected.studentId.studentId}` : ''}
                  </dd>
                </div>
              )}
              {(selected.decisionNotes || selected.rejectionReason) && (
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Decision notes</dt>
                  <dd className="mt-0.5 text-slate-600 dark:text-slate-300">{selected.decisionNotes ?? selected.rejectionReason}</dd>
                </div>
              )}
            </dl>

            {canDecide && (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setDecision('approve')}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left font-medium ${
                      decision === 'approve' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-line text-slate-500 dark:border-[#26374f]'
                    }`}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision('request_info')}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left font-medium ${
                      decision === 'request_info' ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'border-line text-slate-500 dark:border-[#26374f]'
                    }`}
                  >
                    <ClipboardCheck className="h-4 w-4" /> Request info
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision('reject')}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left font-medium ${
                      decision === 'reject' ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' : 'border-line text-slate-500 dark:border-[#26374f]'
                    }`}
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </button>
                </div>
                <Field label={decision === 'reject' ? 'Rejection reason' : 'Decision notes'} required={decision !== 'approve'}>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Record the basis for your decision…" />
                </Field>
              </>
            )}

            {!canDecide && selected.status === 'pending' && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                This approval needs the <code className="font-mono">{selected.requiredPermission}</code> permission. Your role does not include it, or you requested this action yourself.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
