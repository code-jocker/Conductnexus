import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Database, Filter, ScrollText } from 'lucide-react'
import { get, getPage } from '../lib/api'
import { formatDateTime, titleCase } from '../lib/utils'
import {
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
  Select,
} from '../components/ui'

type AuditRow = {
  _id: string
  action: string
  actorName?: string
  actorRole?: string
  resourceType?: string
  resourceId?: string
  ip?: string
  userAgent?: string
  before?: unknown
  after?: unknown
  metadata?: unknown
  createdAt: string
}

const RESOURCE_TYPES = [
  'User', 'Role', 'Student', 'Incident', 'Approval', 'Letter', 'MessageQueue', 'SafeguardingCase',
  'Investigation', 'Appeal', 'Evidence', 'Policy', 'Meeting', 'Settings', 'AcademicYear', 'Term', 'Class',
  'DataRequest', 'DataBreach', 'BackupRecord', 'DisciplineLedger', 'Intervention', 'Recognition',
]

export function AuditPage() {
  const [q, setQ] = useState('')
  const [action, setAction] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AuditRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', q, action, resourceType, from, to, page],
    queryFn: () =>
      getPage<AuditRow>('/audit-logs', {
        page,
        pageSize: 25,
        q: q || undefined,
        action: action || undefined,
        resourceType: resourceType || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
  })

  const rows = data?.items ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accountability"
        title="Audit trail"
        subtitle="An immutable record of security-relevant actions — who did what, when, and from where."
      />

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Search">
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Actor, action, resource…" />
          </Field>
          <Field label="Action contains">
            <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} placeholder="e.g. incident." />
          </Field>
          <Field label="Resource">
            <Select value={resourceType} onChange={(e) => { setResourceType(e.target.value); setPage(1) }}>
              <option value="">All resources</option>
              {RESOURCE_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
          </Field>
        </div>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading audit trail…" />
      ) : rows.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {rows.map((row) => (
                  <tr key={row._id} className="hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <p>{row.actorName ?? 'System'}</p>
                      {row.actorRole && <p className="text-[10px] uppercase tracking-wide text-slate-400">{titleCase(row.actorRole)}</p>}
                    </td>
                    <td className="px-4 py-2.5"><Badge tone="brand">{row.action}</Badge></td>
                    <td className="px-4 py-2.5 text-xs">
                      {row.resourceType ?? '—'}
                      {row.resourceId && <span className="ml-1 font-mono text-[10px] text-slate-400">{row.resourceId.slice(-6)}</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{row.ip ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>Details</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-slate-500 dark:border-[#1f2f49]">
            <span>{data?.meta.total ?? 0} audit entries</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= Number(data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState icon={ScrollText} title="No audit entries" message="Actions matching these filters will appear here." />
      )}

      {selected && <AuditDetailModal audit={selected} onClose={() => setSelected(null)} />}

      <Card className="p-4 text-xs text-slate-500">
        <span className="flex items-center gap-2"><Database className="h-3.5 w-3.5" /> Audit entries are append-only and retained according to the retention schedule in Settings.</span>
      </Card>
    </div>
  )
}

function AuditDetailModal({ audit, onClose }: { audit: AuditRow; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['audit-log', audit._id],
    queryFn: () => get<AuditRow>(`/audit-logs/${audit._id}`),
    initialData: audit,
  })
  const entry = data ?? audit
  return (
    <Modal open onClose={onClose} title="Audit entry" subtitle={`${entry.action} · ${formatDateTime(entry.createdAt)}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="Actor" value={entry.actorName ?? 'System'} />
          <Detail label="Role" value={entry.actorRole ? titleCase(entry.actorRole) : '—'} />
          <Detail label="Resource" value={`${entry.resourceType ?? '—'}${entry.resourceId ? ` · ${entry.resourceId}` : ''}`} />
          <Detail label="IP address" value={entry.ip ?? '—'} />
        </div>
        <JsonBlock label="Before" value={entry.before} />
        <JsonBlock label="After" value={entry.after} />
        <JsonBlock label="Metadata" value={entry.metadata} />
        {entry.userAgent && <Detail label="User agent" value={entry.userAgent} />}
      </div>
    </Modal>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 break-words">{value}</p>
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-slate-50 p-3 text-[11px] leading-relaxed dark:border-[#1f2f49] dark:bg-white/[0.02]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
