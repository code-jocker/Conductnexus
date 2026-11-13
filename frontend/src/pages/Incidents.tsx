import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Filter, Plus, ShieldAlert } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { getPage } from '../lib/api'
import type { Incident, PaginationMeta } from '../lib/types'
import { useDebounced } from '../lib/hooks'
import { formatDate, titleCase } from '../lib/utils'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, SearchInput, Select, StatusBadge, Tabs } from '../components/ui'

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'under_review', label: 'Under review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

export function IncidentsPage() {
  const { has } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialStatus = params.get('status')
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const [status, setStatus] = useState(STATUS_TABS.some((t) => t.key === initialStatus) ? (initialStatus as string) : 'all')
  const [severity, setSeverity] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['incidents', search, status, severity, from, to, page],
    queryFn: () =>
      getPage<Incident>('/incidents', {
        page,
        pageSize: 20,
        q: search || undefined,
        status: status === 'all' ? undefined : status,
        severity: severity || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
  })

  const incidents = data?.items ?? []
  const meta = (data?.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 1 }) as PaginationMeta

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Conduct events"
        title="Incidents"
        subtitle="Every incident follows draft → independent review → approved deduction, with evidence gates enforced."
        actions={
          has('incidents.create') && (
            <Button icon={Plus} onClick={() => navigate('/incidents/new')}>
              Record incident
            </Button>
          )
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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:w-[480px]">
            <Select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1) }}>
              <option value="">All severities</option>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="serious">Serious</option>
              <option value="critical">Critical</option>
            </Select>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label="From date" />
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label="To date" />
          </div>
        </div>
      </Card>

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
                <li key={incident._id}>
                  <Link to={`/incidents/${incident._id}`} className="block px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
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
                    <th className="px-5 py-2.5 font-semibold">Incident</th>
                    <th className="px-3 py-2.5 font-semibold">Student</th>
                    <th className="px-3 py-2.5 font-semibold">Offence</th>
                    <th className="px-3 py-2.5 font-semibold">Severity</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Parent notice</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Occurred</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr
                      key={incident._id}
                      onClick={() => navigate(`/incidents/${incident._id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') navigate(`/incidents/${incident._id}`)
                      }}
                      tabIndex={0}
                      className="row-hover cursor-pointer border-b border-line/60 last:border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 dark:border-[#1f2f49]"
                    >
                      <td className="px-5 py-3">
                        <Link
                          to={`/incidents/${incident._id}`}
                          onClick={(e) => e.stopPropagation()}
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
    </div>
  )
}
