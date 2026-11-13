import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Database, Eye, FileCheck2, Plus, ShieldCheck } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, patch, post } from '../lib/api'
import { StudentPicker, type PickedStudent } from '../components/StudentPicker'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
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
  Select,
  StatCard,
  StatusBadge,
  Tabs,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

type TabKey = 'requests' | 'breaches' | 'access'

type DataRequestRow = {
  _id: string
  requestNumber: string
  type: string
  requesterName: string
  requesterContact: string
  studentId?: string
  details: string
  status: string
  dueDate: string
  decision?: string
  completedAt?: string
  createdAt: string
}

type BreachRow = {
  _id: string
  breachNumber: string
  title: string
  description: string
  discoveredAt: string
  severity: string
  affectedRecords: number
  dataCategories?: string[]
  status: string
  containment?: string
  reportedToAuthority?: boolean
  authorityNotifiedAt?: string
  individualsNotified?: boolean
  createdAt: string
}

type AccessRow = {
  _id: string
  userId?: { name?: string; email?: string } | string
  actorName?: string
  resourceType: string
  resourceId?: string
  action: string
  ip?: string
  createdAt: string
}

const REQUEST_TYPES = [
  { value: 'access', label: 'Access — copy of personal data' },
  { value: 'correction', label: 'Correction — fix inaccurate data' },
  { value: 'objection', label: 'Objection — restrict processing' },
  { value: 'erasure', label: 'Erasure — delete where lawful' },
]

const REQUEST_STATUSES = ['received', 'under_review', 'approved', 'rejected', 'completed']

export function DataProtectionPage() {
  const { has } = useAuth()
  const [tab, setTab] = useState<TabKey>('requests')

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Governance"
        title="Data protection centre"
        subtitle="Aligned with Rwanda's Law No. 058/2021 on the protection of personal data. Manage requests, breaches and processing access logs."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Lawful basis" value="Public interest" hint="Education records processed under school authority" icon={ShieldCheck} tone="brand" />
        <StatCard label="Retention" value="Per schedule" hint="Configured in Settings → Retention" icon={Database} tone="ochre" />
        <StatCard label="Access logging" value="Every read" hint="Sensitive student records record who looked, and when" icon={Eye} tone="slate" />
      </div>

      <Tabs<TabKey>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'requests', label: 'Data subject requests' },
          { key: 'breaches', label: 'Breach register' },
          { key: 'access', label: 'Access log' },
        ]}
      />

      {tab === 'requests' && <RequestsTab canManage={has('data_protection.manage')} />}
      {tab === 'breaches' && <BreachesTab canManage={has('data_protection.breaches')} />}
      {tab === 'access' && <AccessTab />}
    </div>
  )
}

function RequestsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<DataRequestRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['data-requests', status, page],
    queryFn: () => getPage<DataRequestRow>('/data-protection/requests', { page, pageSize: 20, status: status || undefined }),
  })

  const rows = data?.items ?? []
  const overdue = rows.filter((r) => !r.completedAt && new Date(r.dueDate) < new Date()).length

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="sm:w-48">
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        {overdue > 0 && <Badge tone="red">{overdue} past due</Badge>}
        <div className="ml-auto">
          {canManage && <Button icon={Plus} onClick={() => setCreateOpen(true)}>Log request</Button>}
        </div>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading requests…" />
      ) : rows.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Requester</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {rows.map((row) => {
                  const late = !row.completedAt && new Date(row.dueDate) < new Date()
                  return (
                    <tr key={row._id} className={late ? 'bg-red-50/40 dark:bg-red-950/10' : undefined}>
                      <td className="px-4 py-3 font-mono text-xs">{row.requestNumber}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.requesterName}</p>
                        <p className="text-xs text-slate-400">{row.requesterContact}</p>
                      </td>
                      <td className="px-4 py-3"><Badge tone="brand">{titleCase(row.type)}</Badge></td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className={`px-4 py-3 text-xs ${late ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{formatDate(row.dueDate)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => setSelected(row)}>Handle</Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-slate-500 dark:border-[#1f2f49]">
            <span>{data?.meta.total ?? 0} requests</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= Number(data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState icon={FileCheck2} title="No data requests" message="Parents can submit access, correction, objection or erasure requests from the parent portal." />
      )}

      {createOpen && <CreateRequestModal open onClose={() => setCreateOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['data-requests'] })} />}
      {selected && (
        <HandleRequestModal
          key={selected._id}
          request={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['data-requests'] })}
        />
      )}
    </div>
  )
}

function CreateRequestModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [form, setForm] = useState({ type: 'access', requesterName: '', requesterContact: '', details: '', dueInDays: 30 })

  const create = useMutation({
    mutationFn: () => post('/data-protection/requests', { ...form, studentId: student?.id || undefined, dueInDays: Number(form.dueInDays) }),
    onSuccess: () => {
      success('Data request logged')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a data subject request"
      subtitle="Rwanda's data protection law expects a response within 30 days."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={form.requesterName.trim().length < 2 || form.requesterContact.trim().length < 5 || form.details.trim().length < 10} onClick={() => create.mutate()}>Log request</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Request type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {REQUEST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Response deadline (days)">
            <Input type="number" min={1} max={90} value={form.dueInDays} onChange={(e) => setForm({ ...form, dueInDays: Number(e.target.value) })} />
          </Field>
          <Field label="Requester name" required>
            <Input value={form.requesterName} onChange={(e) => setForm({ ...form, requesterName: e.target.value })} />
          </Field>
          <Field label="Contact" required hint="Phone or email">
            <Input value={form.requesterContact} onChange={(e) => setForm({ ...form, requesterContact: e.target.value })} />
          </Field>
        </div>
        <Field label="Related student (optional)">
          <StudentPicker value={student} onChange={setStudent} />
        </Field>
        <Field label="Request details" required>
          <Textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} className="min-h-[120px]" />
        </Field>
      </div>
    </Modal>
  )
}

function HandleRequestModal({
  request,
  canManage,
  onClose,
  onSaved,
}: {
  request: DataRequestRow
  canManage: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { success, error: toastError } = useToast()
  const [status, setStatus] = useState(request.status)
  const [decision, setDecision] = useState(request.decision ?? '')

  const save = useMutation({
    mutationFn: () => patch(`/data-protection/requests/${request._id}`, { status, decision }),
    onSuccess: () => {
      success('Request updated')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={request.requestNumber}
      subtitle={`${titleCase(request.type)} request from ${request.requesterName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {canManage && <Button loading={save.isPending} onClick={() => save.mutate()}>Save decision</Button>}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={request.status} />
          <Badge tone="brand">{titleCase(request.type)}</Badge>
          <span className="text-xs text-slate-500">Due {formatDate(request.dueDate)}</span>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Contact</p>
          <p className="mt-0.5">{request.requesterContact}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Request</p>
          <p className="mt-0.5 whitespace-pre-wrap">{request.details}</p>
        </div>
        {canManage ? (
          <>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
            </Field>
            <Field label="Decision / response" hint="Record what was provided, corrected or why the request was declined.">
              <Textarea value={decision} onChange={(e) => setDecision(e.target.value)} className="min-h-[120px]" />
            </Field>
          </>
        ) : request.decision ? (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Decision</p>
            <p className="mt-0.5 whitespace-pre-wrap">{request.decision}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function BreachesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<BreachRow | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['data-breaches'], queryFn: () => get<BreachRow[]>('/data-protection/breaches') })

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">Breach register</p>
          <p className="text-xs text-slate-500">Notify the National Cyber Security Authority without undue delay where a breach poses risk.</p>
        </div>
        {canManage && <Button icon={Plus} variant="danger" onClick={() => setCreateOpen(true)}>Report breach</Button>}
      </Card>

      {isLoading ? (
        <LoadingBlock />
      ) : data?.length ? (
        <div className="space-y-3">
          {data.map((breach) => (
            <Card key={breach._id} className="p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-400">{breach.breachNumber}</span>
                    <Badge tone={breach.severity === 'critical' || breach.severity === 'high' ? 'red' : breach.severity === 'medium' ? 'amber' : 'slate'}>
                      {titleCase(breach.severity)}
                    </Badge>
                    <StatusBadge status={breach.status} />
                    {breach.reportedToAuthority && <Badge tone="emerald">Authority notified</Badge>}
                    {breach.individualsNotified && <Badge tone="brand">Individuals notified</Badge>}
                  </div>
                  <p className="mt-1 font-medium">{breach.title}</p>
                  <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">{breach.description}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Discovered {formatDateTime(breach.discoveredAt)} · {breach.affectedRecords} records
                    {breach.dataCategories?.length ? ` · ${breach.dataCategories.join(', ')}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setSelected(breach)}>Update</Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title="No breaches recorded" message="A clean register is a good sign. Report and track any suspected breach here." />
      )}

      {createOpen && <CreateBreachModal open onClose={() => setCreateOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['data-breaches'] })} />}
      {selected && (
        <HandleBreachModal
          key={selected._id}
          breach={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['data-breaches'] })}
        />
      )}
    </div>
  )
}

function CreateBreachModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [form, setForm] = useState({ title: '', description: '', discoveredAt: new Date().toISOString().slice(0, 16), severity: 'medium', affectedRecords: 0, dataCategories: '' })

  const create = useMutation({
    mutationFn: () =>
      post('/data-protection/breaches', {
        ...form,
        affectedRecords: Number(form.affectedRecords),
        dataCategories: form.dataCategories ? form.dataCategories.split(',').map((s) => s.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      success('Breach recorded — begin containment now')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report a data breach"
      subtitle="Record facts only. Containment and notification steps are tracked on the breach record."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={create.isPending} disabled={form.title.trim().length < 4 || form.description.trim().length < 10} onClick={() => create.mutate()}>Record breach</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Shared laptop exposed student records" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Discovered at">
            <Input type="datetime-local" value={form.discoveredAt} onChange={(e) => setForm({ ...form, discoveredAt: e.target.value })} />
          </Field>
          <Field label="Severity">
            <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </Field>
          <Field label="Affected records">
            <Input type="number" min={0} value={form.affectedRecords} onChange={(e) => setForm({ ...form, affectedRecords: Number(e.target.value) })} />
          </Field>
          <Field label="Data categories" hint="Comma separated">
            <Input value={form.dataCategories} onChange={(e) => setForm({ ...form, dataCategories: e.target.value })} placeholder="Student records, guardian contacts" />
          </Field>
        </div>
        <Field label="What happened" required>
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[140px]" />
        </Field>
        <Alert tone="warning" title="Notification duty">
          High-risk breaches should be notified to the supervisory authority and affected individuals without undue delay. Document every step on this record.
        </Alert>
      </div>
    </Modal>
  )
}

function HandleBreachModal({
  breach,
  canManage,
  onClose,
  onSaved,
}: {
  breach: BreachRow
  canManage: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { success, error: toastError } = useToast()
  const [form, setForm] = useState({
    containment: breach.containment ?? '',
    status: breach.status,
    reportedToAuthority: Boolean(breach.reportedToAuthority),
    individualsNotified: Boolean(breach.individualsNotified),
  })

  const save = useMutation({
    mutationFn: () => patch(`/data-protection/breaches/${breach._id}`, form),
    onSuccess: () => {
      success('Breach record updated')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={breach.title}
      subtitle={`${breach.breachNumber} · discovered ${formatDateTime(breach.discoveredAt)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {canManage && <Button loading={save.isPending} onClick={() => save.mutate()}>Save updates</Button>}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{breach.description}</p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="red">{titleCase(breach.severity)}</Badge>
          <Badge tone="amber">{breach.affectedRecords} records</Badge>
        </div>
        {canManage ? (
          <>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="open">Open</option>
                <option value="contained">Contained</option>
                <option value="closed">Closed</option>
              </Select>
            </Field>
            <Field label="Containment actions" hint="What was done to stop the breach and prevent recurrence?">
              <Textarea value={form.containment} onChange={(e) => setForm({ ...form, containment: e.target.value })} className="min-h-[120px]" />
            </Field>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.reportedToAuthority} onChange={(e) => setForm({ ...form, reportedToAuthority: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Reported to the supervisory authority
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.individualsNotified} onChange={(e) => setForm({ ...form, individualsNotified: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Affected individuals notified
              </label>
            </div>
          </>
        ) : breach.containment ? (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Containment</p>
            <p className="mt-0.5 whitespace-pre-wrap">{breach.containment}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function AccessTab() {
  const [resourceType, setResourceType] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['access-log', resourceType, page],
    queryFn: () => getPage<AccessRow>('/data-protection/access-log', { page, pageSize: 30, resourceType: resourceType || undefined }),
  })

  const rows = data?.items ?? []

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <Select value={resourceType} onChange={(e) => { setResourceType(e.target.value); setPage(1) }} className="sm:w-56">
          <option value="">All resources</option>
          <option value="Student">Student records</option>
          <option value="Incident">Incidents</option>
          <option value="SafeguardingCase">Safeguarding cases</option>
          <option value="Evidence">Evidence</option>
          <option value="Letter">Letters</option>
        </Select>
        <p className="text-xs text-slate-500">Sensitive reads are logged with the actor, time and IP address.</p>
      </Card>

      {isLoading ? (
        <LoadingBlock />
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
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {rows.map((row) => (
                  <tr key={row._id}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-2.5">{row.actorName ?? (typeof row.userId === 'object' ? row.userId?.name ?? row.userId?.email : row.userId) ?? 'System'}</td>
                    <td className="px-4 py-2.5"><Badge tone="brand">{titleCase(row.action)}</Badge></td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">{row.resourceType}{row.resourceId ? <span className="ml-1 font-mono text-[10px] text-slate-400">{row.resourceId.slice(-6)}</span> : null}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{row.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-slate-500 dark:border-[#1f2f49]">
            <span>{data?.meta.total ?? 0} access events</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= Number(data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState icon={Eye} title="No access events" message="Access to sensitive records will be listed here." />
      )}

      <Alert tone="info" title="Rwanda Law No. 058/2021">
        Personal data must be processed lawfully, minimised, kept accurate and stored only as long as necessary. ConductNexus logs sensitive access, supports data subject requests and maintains a breach register to help the school demonstrate accountability.
      </Alert>
    </div>
  )
}
