import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertOctagon, ArchiveRestore, Database, Download, HardDrive, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, downloadFile, get, post } from '../lib/api'
import { formatDateTime, humanBytes, titleCase } from '../lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
  Tabs,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

type TabKey = 'health' | 'errors' | 'queue' | 'ledger' | 'backups'

type Health = {
  status: string
  checkedAt: string
  application: { environment: string; uptimeSeconds: number; nodeVersion: string; memoryMb: { used: number; heap: number } }
  database: { status: string; name?: string; collections: number; objects: number; dataSizeMb: number }
  worker: { status: string; lastRun?: string; processed: number }
  queue: { counts: Record<string, number>; deadLetters: number; total: number }
  whatsapp: { status: string; enabled: boolean; lastConnectedAt?: string; lastError?: string }
  backups: { lastRunAt?: string; lastStatus?: string; retentionDays: number; rpoHours: number; rtoHours: number; recent: BackupRow[]; storageBytes: number }
  storage: { usedBytes: number }
  integrations: { mongodb: boolean; smtp: boolean; firebase: boolean; whatsappEnabled: boolean; whatsappConnected: boolean }
  errors: { last24h: number }
  cases: { pendingApprovals: number; openIncidents: number }
  settings: { timezone: string; language: string; schoolName: string }
}

type ErrorRow = { _id: string; level: string; message: string; stack?: string; path?: string; method?: string; requestId?: string; createdAt: string }

type QueueFailure = { _id: string; channel: string; to: string; status: string; attempts: number; lastError?: string; createdAt: string }

type LedgerRow = { _id: string; type: string; change: number; newBalance: number; reason: string; createdAt: string }

type BackupRow = {
  _id: string
  filename: string
  size: number
  checksum: string
  status: string
  collections: { name: string; count: number }[]
  restoreTestedAt?: string
  restoreTestResult?: string
  retentionUntil: string
  error?: string
  createdAt: string
}

const uptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${mins}m`].filter(Boolean).join(' ')
}

export function MonitoringPage() {
  const { has } = useAuth()
  const [tab, setTab] = useState<TabKey>('health')

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="System monitoring"
        subtitle="Live health, error logs, queue failures, ledger integrity and disaster-recovery backups — all without a developer."
      />

      <Tabs<TabKey>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'health', label: 'Health' },
          { key: 'errors', label: 'Errors' },
          { key: 'queue', label: 'Queue failures' },
          { key: 'ledger', label: 'Ledger integrity' },
          ...(has('backups.manage') ? [{ key: 'backups' as TabKey, label: 'Backups' }] : []),
        ]}
      />

      {tab === 'health' && <HealthTab />}
      {tab === 'errors' && <ErrorsTab />}
      {tab === 'queue' && <QueueFailuresTab />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'backups' && <BackupsTab />}
    </div>
  )
}

function HealthTab() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => get<Health>('/system/health'),
    refetchInterval: 15_000,
  })

  if (isLoading || !data) return <LoadingBlock label="Checking system health…" />

  const integrations = [
    { key: 'MongoDB', ok: data.integrations.mongodb },
    { key: 'Email (SMTP)', ok: data.integrations.smtp },
    { key: 'Firebase', ok: data.integrations.firebase },
    { key: 'WhatsApp', ok: data.integrations.whatsappConnected, hint: data.integrations.whatsappEnabled ? 'Enabled' : 'Disabled' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="API status" value={titleCase(data.status)} icon={Activity} tone={data.status === 'operational' ? 'emerald' : 'red'} hint={`Checked ${formatDateTime(data.checkedAt)}`} />
        <StatCard label="Uptime" value={uptime(data.application.uptimeSeconds)} icon={RefreshCw} tone="brand" hint={data.application.nodeVersion} />
        <StatCard label="Memory" value={`${data.application.memoryMb.used} MB`} icon={HardDrive} tone="ochre" hint={`Heap ${data.application.memoryMb.heap} MB`} />
        <StatCard label="Errors (24h)" value={data.errors.last24h} icon={AlertOctagon} tone={data.errors.last24h ? 'amber' : 'slate'} hint="Application error log" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={Database} title="Database" subtitle={`${data.database.name ?? 'MongoDB'} · ${data.settings.timezone}`} />
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
            <Info label="Status" value={<StatusBadge status={data.database.status} />} />
            <Info label="Size" value={`${data.database.dataSizeMb} MB`} />
            <Info label="Collections" value={data.database.collections} />
            <Info label="Documents" value={data.database.objects.toLocaleString()} />
          </dl>
        </Card>

        <Card>
          <CardHeader icon={ListChecks} title="Background worker" subtitle="Message queue dispatcher" />
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
            <Info label="Status" value={<StatusBadge status={data.worker.status} />} />
            <Info label="Last run" value={data.worker.lastRun ? formatDateTime(data.worker.lastRun) : 'Waiting'} />
            <Info label="Processed" value={data.worker.processed} />
            <Info label="Total queued" value={data.queue.total} />
          </dl>
        </Card>

        <Card>
          <CardHeader icon={ShieldCheck} title="Integrations" subtitle="Optional services and their configuration state" />
          <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
            {integrations.map((item) => (
              <li key={item.key} className="flex items-center justify-between px-4 py-2.5">
                <span>{item.key}{item.hint ? <span className="ml-1 text-xs text-slate-400">({item.hint})</span> : null}</span>
                <Badge tone={item.ok ? 'emerald' : 'slate'}>{item.ok ? 'Ready' : 'Not configured'}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader icon={ArchiveRestore} title="Disaster recovery" subtitle={`RPO ${data.backups.rpoHours}h · RTO ${data.backups.rtoHours}h`} />
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
            <Info label="Last backup" value={data.backups.lastRunAt ? formatDateTime(data.backups.lastRunAt) : 'Never'} />
            <Info label="Last status" value={data.backups.lastStatus ? <StatusBadge status={data.backups.lastStatus} /> : '—'} />
            <Info label="Retention" value={`${data.backups.retentionDays} days`} />
            <Info label="Backup storage" value={humanBytes(data.backups.storageBytes)} />
          </dl>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm">
          <p className="font-semibold">Workload snapshot</p>
          <p className="text-xs text-slate-500">{data.cases.openIncidents} open incidents · {data.cases.pendingApprovals} pending approvals · Queue {JSON.stringify(data.queue.counts)}</p>
        </div>
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={isFetching} onClick={() => refetch()}>Refresh now</Button>
      </Card>
    </div>
  )
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
}

function ErrorsTab() {
  const { data, isLoading } = useQuery({ queryKey: ['system-errors'], queryFn: () => get<ErrorRow[]>('/system/errors', { limit: 100 }) })
  const [selected, setSelected] = useState<ErrorRow | null>(null)

  if (isLoading) return <LoadingBlock />
  if (!data?.length) return <Card><EmptyState icon={ShieldCheck} title="No recent errors" message="Nothing has failed in the last 30 days of retained logs." /></Card>

  return (
    <div className="space-y-3">
      <Alert tone="info" title="Error logs are retained for 30 days">Stack traces are available to administrators only and never shown to parents.</Alert>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
              {data.map((row) => (
                <tr key={row._id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-2.5"><Badge tone={row.level === 'fatal' || row.level === 'error' ? 'red' : 'amber'}>{row.level}</Badge></td>
                  <td className="max-w-[380px] truncate px-4 py-2.5">{row.message}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{row.method} {row.path}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>Stack</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {selected && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">{selected.message}</p>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[11px] text-slate-200">{selected.stack ?? 'No stack trace captured.'}</pre>
        </Card>
      )}
    </div>
  )
}

function QueueFailuresTab() {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['queue-failures'], queryFn: () => get<QueueFailure[]>('/system/queue-failures', { limit: 100 }) })

  const retry = useMutation({
    mutationFn: (id: string) => post(`/notifications/queue/${id}/retry`),
    onSuccess: () => {
      success('Message re-queued')
      queryClient.invalidateQueries({ queryKey: ['queue-failures'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (isLoading) return <LoadingBlock />
  if (!data?.length) return <Card><EmptyState icon={ShieldCheck} title="No queue failures" message="Every parent message has been delivered or is waiting its turn." /></Card>

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Failed parent messages" subtitle="Retry after fixing the gateway, or review with the communications team." />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Recipient</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Attempts</th>
              <th className="px-4 py-3">Error</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
            {data.map((row) => (
              <tr key={row._id}>
                <td className="px-4 py-2.5 font-mono text-xs">{row.to}</td>
                <td className="px-4 py-2.5">{titleCase(row.channel)}</td>
                <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
                <td className="px-4 py-2.5">{row.attempts}</td>
                <td className="max-w-[300px] truncate px-4 py-2.5 text-xs text-red-600">{row.lastError ?? '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === row._id} onClick={() => retry.mutate(row._id)}>Retry</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function LedgerTab() {
  const { data, isLoading } = useQuery({ queryKey: ['ledger-health'], queryFn: () => get<{ totalTransactions: number; recent: LedgerRow[] }>('/system/ledger-health') })

  if (isLoading || !data) return <LoadingBlock />

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Ledger transactions" value={data.totalTransactions.toLocaleString()} icon={Database} tone="brand" />
        <StatCard label="Immutability" value="Append-only" hint="Corrections use compensating entries" tone="emerald" icon={ShieldCheck} />
        <StatCard label="Reconciliation" value="Optimistic locks" hint="balanceVersion prevents lost updates" tone="ochre" icon={ListChecks} />
      </div>
      <Card>
        <CardHeader title="Latest ledger entries" subtitle="Every change carries a before/after balance and an audit reference" />
        <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
          {data.recent.map((row) => (
            <li key={row._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div>
                <p className="font-medium">{row.reason}</p>
                <p className="text-xs text-slate-400">{titleCase(row.type)} · {formatDateTime(row.createdAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={row.change >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>
                  {row.change >= 0 ? '+' : ''}{row.change}
                </span>
                <Badge tone="slate">Balance {row.newBalance}</Badge>
              </div>
            </li>
          ))}
          {!data.recent.length && <li className="px-4 py-6 text-center text-slate-400">No ledger activity yet.</li>}
        </ul>
      </Card>
    </div>
  )
}

function BackupsTab() {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['backups'], queryFn: () => get<{ backups: BackupRow[]; policy: { schedule: string; retentionDays: number; rpoHours: number; rtoHours: number; lastRunAt?: string; lastStatus?: string } }>('/backups') })

  const run = useMutation({
    mutationFn: () => post<{ filename: string; size: number }>('/backups'),
    onSuccess: (result) => {
      success(`Backup created: ${result.filename} (${humanBytes(result.size)})`)
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      queryClient.invalidateQueries({ queryKey: ['system-health'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const cleanup = useMutation({
    mutationFn: () => post<{ removed: number }>('/backups/cleanup'),
    onSuccess: (result) => {
      success(`${result.removed} expired backup${result.removed === 1 ? '' : 's'} removed`)
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const restore = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; total: number; testedAt: string }>(`/backups/${id}/restore-test`),
    onSuccess: (result) => {
      success(`Restore test passed — ${result.total} documents readable`)
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (isLoading || !data) return <LoadingBlock />

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Schedule" value={data.policy.schedule} icon={RefreshCw} tone="brand" />
        <StatCard label="Retention" value={`${data.policy.retentionDays} days`} icon={HardDrive} tone="ochre" />
        <StatCard label="RPO" value={`${data.policy.rpoHours} hours`} hint="Maximum acceptable data loss" tone="emerald" />
        <StatCard label="RTO" value={`${data.policy.rtoHours} hours`} hint="Maximum acceptable downtime" tone="amber" />
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">Encrypted backups</p>
          <p className="text-xs text-slate-500">Last run {data.policy.lastRunAt ? formatDateTime(data.policy.lastRunAt) : 'never'} · stored on the server with AES encryption.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={Database} loading={run.isPending} onClick={() => run.mutate()}>Back up now</Button>
          <Button variant="secondary" loading={cleanup.isPending} onClick={() => cleanup.mutate()}>Remove expired</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Backup history" subtitle={`${data.backups.length} records`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Restore test</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
              {data.backups.map((row) => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-xs">{row.filename}</p>
                    {row.error && <p className="text-xs text-red-600">{row.error}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-2.5">{humanBytes(row.size)}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{row.restoreTestedAt ? formatDateTime(row.restoreTestedAt) : 'Not tested'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" loading={restore.isPending && restore.variables === row._id} onClick={() => restore.mutate(row._id)}>Test</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Download}
                        onClick={() => downloadFile(`/backups/${row._id}/download`, row.filename).catch((err) => toastError(apiError(err)))}
                      >
                        Download
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data.backups.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No backups yet. Run the first backup now.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <p className="mb-2 text-sm font-semibold">Backup notes</p>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Store the off-site copy location or DR drill notes here… (kept in this browser only)" />
        <p className="mt-1 text-xs text-slate-500">Download a backup and keep an encrypted copy off-site. Test restore at least once per term.</p>
      </Card>
    </div>
  )
}
