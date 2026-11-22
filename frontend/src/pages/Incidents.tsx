import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ClipboardList, Filter, Plus, ShieldAlert, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, getPage, post } from '../lib/api'
import type { Incident, PaginationMeta } from '../lib/types'
import { useDebounced, useStructure } from '../lib/hooks'
import { formatDate, titleCase } from '../lib/utils'
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Pagination, SearchInput, Select, StatusBadge, Tabs, Textarea } from '../components/ui'

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'under_review', label: 'Under review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

const REVIEWABLE = new Set(['submitted', 'under_review', 'escalated'])

type BulkResult = {
  reviewed: number
  failed: number
  results: { id: string; ok: boolean; status?: string; error?: string }[]
}

export function IncidentsPage() {
  const { has } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const initialStatus = params.get('status')
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const [status, setStatus] = useState(STATUS_TABS.some((t) => t.key === initialStatus) ? (initialStatus as string) : 'all')
  const [severity, setSeverity] = useState('')
  const [classId, setClassId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [bulkDecision, setBulkDecision] = useState<'approve' | 'reject' | null>(null)
  const [comments, setComments] = useState('')
  const [bulkSummary, setBulkSummary] = useState<BulkResult | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const canReview = has('incidents.review')
  const { data: structure } = useStructure()

  const { data, isLoading } = useQuery({
    queryKey: ['incidents', search, status, severity, classId, from, to, page],
    queryFn: () =>
      getPage<Incident>('/incidents', {
        page,
        pageSize: 20,
        q: search || undefined,
        status: status === 'all' ? undefined : status,
        severity: severity || undefined,
        classId: classId || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
  })

  const incidents = data?.items ?? []
  const meta = (data?.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 1 }) as PaginationMeta

  const bulkReview = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      post<BulkResult>('/incidents/bulk-review', {
        ids: selected,
        decision,
        comments: comments.trim() || undefined,
      }),
    onSuccess: (result) => {
      setBulkSummary(result)
      setBulkError(null)
      setBulkDecision(null)
      setComments('')
      setSelected([])
      setSelectMode(false)
      void queryClient.invalidateQueries({ queryKey: ['incidents'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => setBulkError(apiError(error)),
  })

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function canSelect(incident: Incident) {
    return canReview && REVIEWABLE.has(incident.status)
  }

  function startSelection() {
    setSelectMode((current) => !current)
    setSelected([])
    setBulkSummary(null)
    setBulkError(null)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Conduct events"
        title="Incidents"
        subtitle="Every incident follows draft → independent review → approved deduction, with evidence gates enforced."
        actions={
          <div className="flex flex-wrap gap-2">
            {canReview && (
              <Button variant={selectMode ? 'secondary' : 'ghost'} icon={selectMode ? XCircle : CheckCircle2} onClick={startSelection}>
                {selectMode ? 'Cancel selection' : 'Bulk review'}
              </Button>
            )}
            {has('incidents.create') && (
              <Button icon={Plus} onClick={() => navigate('/incidents/new')}>
                Record incident
              </Button>
            )}
          </div>
        }
      />

      <Tabs
        tabs={STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
        active={status}
        onChange={(key) => {
          setStatus(key)
          setPage(1)
        }}
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search incident number, student, offence or description…" className="flex-1" />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1) }}>
              <option value="">All severities</option>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="serious">Serious</option>
              <option value="critical">Critical</option>
            </Select>
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); setPage(1) }}>
              <option value="">All classes</option>
              {(structure?.classes ?? []).map((cls) => (
                <option key={cls._id} value={cls._id}>{cls.name}</option>
              ))}
            </Select>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label="From date" />
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label="To date" />
          </div>
        </div>
      </Card>

      {selectMode && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-ink dark:text-slate-100">{selected.length}</span> selected · only incidents awaiting review can be picked
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={!selected.length} onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button size="sm" variant="danger" icon={XCircle} disabled={!selected.length} onClick={() => { setComments(''); setBulkError(null); setBulkDecision('reject') }}>
              Reject selected
            </Button>
            <Button size="sm" icon={CheckCircle2} disabled={!selected.length} onClick={() => { setComments(''); setBulkError(null); setBulkDecision('approve') }}>
              Approve selected
            </Button>
          </div>
        </Card>
      )}

      {bulkSummary && (
        <Alert tone={bulkSummary.failed ? 'warning' : 'success'} title={`${bulkSummary.reviewed} reviewed · ${bulkSummary.failed} skipped`}>
          <p>
            Independent review stays enforced, so incidents you reported yourself are skipped. Refreshed balances are reflected on each student profile.
          </p>
          {bulkSummary.results.some((result) => !result.ok) && (
            <ul className="mt-2 space-y-1 text-xs">
              {bulkSummary.results.filter((result) => !result.ok).map((result) => (
                <li key={result.id}>{result.error ?? 'Review failed'}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3 text-xs text-slate-500 dark:border-[#26374f]">
          <span>
            <span className="font-semibold text-ink dark:text-slate-100">{meta.total}</span> incidents
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <Filter className="h-3.5 w-3.5" /> Filtered by {status === 'all' ? 'all statuses' : titleCase(status)}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-14 w-full" />
            ))}
          </div>
        ) : incidents.length ? (
          <>
            <ul className="divide-y divide-line/60 dark:divide-[#1f2f49] md:hidden">
              {incidents.map((incident) => (
                <li key={incident._id} className="flex items-start">
                  {selectMode && canSelect(incident) && (
                    <div className="pl-4 pt-4">
                      <Checkbox checked={selected.includes(incident._id)} onChange={() => toggle(incident._id)} label={<span className="sr-only">Select {incident.incidentNumber}</span>} />
                    </div>
                  )}
                  <Link
                    to={`/incidents/${incident._id}`}
                    onClick={(e) => {
                      if (selectMode) {
                        e.preventDefault()
                        if (canSelect(incident)) toggle(incident._id)
                      }
                    }}
                    className="block flex-1 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {incident.incidentNumber}
                          {incident.safeguardingFlag && <ShieldAlert className="h-3.5 w-3.5 text-ochre-500" aria-label="Safeguarding flag" />}
                        </p>
                        <p className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white">{incident.studentSnapshot?.fullName}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {incident.offenceSnapshot?.name} · −{incident.offenceSnapshot?.deduction} · {incident.studentSnapshot?.className}
                        </p>
                        <p className="mt-1 line-clamp-1 text-xs text-slate-400">{incident.description}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge status={incident.status} />
                        <span className="text-[10px] text-slate-400">{formatDate(incident.occurredAt)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                    {selectMode && <th className="w-10 px-3 py-2.5" aria-label="Select" />}
                    <th className="px-5 py-2.5 font-semibold">Incident</th>
                    <th className="px-3 py-2.5 font-semibold">Student</th>
                    <th className="px-3 py-2.5 font-semibold">Offence</th>
                    <th className="px-3 py-2.5 font-semibold">Severity</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Independent review</th>
                    <th className="px-3 py-2.5 font-semibold">Parent notice</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Occurred</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr
                      key={incident._id}
                      onClick={() => {
                        if (selectMode) {
                          if (canSelect(incident)) toggle(incident._id)
                          return
                        }
                        navigate(`/incidents/${incident._id}`)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (selectMode) {
                            if (canSelect(incident)) toggle(incident._id)
                            return
                          }
                          navigate(`/incidents/${incident._id}`)
                        }
                      }}
                      tabIndex={0}
                      className="row-hover cursor-pointer border-b border-line/60 last:border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 dark:border-[#1f2f49]"
                    >
                      {selectMode && (
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          {canSelect(incident) ? (
                            <Checkbox checked={selected.includes(incident._id)} onChange={() => toggle(incident._id)} label={<span className="sr-only">Select {incident.incidentNumber}</span>} />
                          ) : null}
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <Link
                          to={`/incidents/${incident._id}`}
                          onClick={(e) => { e.stopPropagation(); if (selectMode) e.preventDefault() }}
                          className="flex items-center gap-1.5 font-medium hover:text-brand-600 dark:hover:text-brand-300"
                        >
                          {incident.incidentNumber}
                          {incident.safeguardingFlag && <ShieldAlert className="h-3.5 w-3.5 text-ochre-500" aria-label="Safeguarding flag" />}
                        </Link>
                        <span className="block max-w-[240px] truncate text-xs text-slate-400">{incident.description}</span>
                      </td>
                      <td className="px-3 py-3">
                        {incident.studentSnapshot?.fullName}
                        <span className="block text-xs text-slate-400">{incident.studentSnapshot?.className}</span>
                      </td>
                      <td className="px-3 py-3">
                        {incident.offenceSnapshot?.name}
                        <span className="ml-1 font-mono text-xs text-risk-red">−{incident.offenceSnapshot?.deduction}</span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={incident.severity === 'critical' ? 'red' : incident.severity === 'serious' ? 'orange' : 'slate'}>{titleCase(incident.severity)}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={incident.status} />
                      </td>
                      <td className="px-3 py-3">
                        {incident.review?.reviewedAt ? (
                          <>
                            {typeof incident.review.reviewedBy === 'object' ? incident.review.reviewedBy?.name : '—'}
                            <span className="block text-xs text-slate-400">
                              {titleCase(incident.review.decision ?? '')} · {formatDate(incident.review.reviewedAt)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">Awaiting reviewer</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={incident.parentNotificationStatus} />
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-slate-400">{formatDate(incident.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState
            title="No incidents match"
            message="Try clearing filters, or record a new conduct incident."
            icon={ClipboardList}
            action={
              has('incidents.create') ? (
                <Link to="/incidents/new" className="link text-sm font-semibold">
                  Record an incident →
                </Link>
              ) : undefined
            }
          />
        )}
        <div className="border-t border-line px-5 py-3 dark:border-[#26374f]">
          <Pagination meta={meta} onPage={setPage} />
        </div>
      </Card>

      <Modal
        open={bulkDecision !== null}
        onClose={() => setBulkDecision(null)}
        title={bulkDecision === 'approve' ? `Approve ${selected.length} incidents` : `Reject ${selected.length} incidents`}
        subtitle="Each case is reviewed independently; incidents you reported yourself are skipped automatically."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBulkDecision(null)}>
              Cancel
            </Button>
            <Button
              variant={bulkDecision === 'approve' ? 'primary' : 'danger'}
              loading={bulkReview.isPending}
              disabled={!selected.length}
              onClick={() => bulkDecision && bulkReview.mutate(bulkDecision)}
            >
              {bulkDecision === 'approve' ? 'Approve all selected' : 'Reject all selected'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {bulkError && <Alert tone="danger" title="Bulk review failed">{bulkError}</Alert>}
          {bulkDecision === 'approve' ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Approved incidents post their deduction to the ledger immediately. Conduct balances cannot go below zero and each posting is immutable, so corrections require a compensating entry.
            </p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">Rejected incidents keep the conduct balance unchanged and record your decision in the audit trail.</p>
          )}
          <Textarea
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={bulkDecision === 'approve' ? 'Shared note for this batch (optional)' : 'Why are these being rejected?'}
          />
        </div>
      </Modal>
    </div>
  )
}
