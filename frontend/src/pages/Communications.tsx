import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  BellRing,
  CheckCheck,
  Download,
  FileText,
  Inbox,
  Mail,
  MessageSquare,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { apiError, downloadFile, get, getPage, patch, post } from '../lib/api'
import { refName } from '../lib/hooks'
import { formatDateTime, timeAgo, titleCase } from '../lib/utils'
import { StudentPicker, type PickedStudent } from '../components/StudentPicker'
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
  Toggle,
} from '../components/ui'
import { useToast } from '../components/toast'
import type { NotificationItem } from '../lib/types'

type TabKey = 'notifications' | 'letters' | 'queue' | 'templates' | 'whatsapp'

type LetterRow = {
  _id: string
  reference: string
  type: string
  subject: string
  status: string
  deliveryStatus: string
  studentSnapshot?: { fullName?: string; studentId?: string; className?: string }
  preparedBy?: { name?: string } | string
  approvedBy?: { name?: string } | string
  createdAt: string
  issuedAt?: string
}

type LetterDetail = LetterRow & {
  body: string
  rejectionReason?: string
  approvalNotes?: string
  confidentiality?: string
  history?: { at: string; action: string; note?: string }[]
}

type QueueRow = {
  _id: string
  channel: string
  to: string
  subject?: string
  body: string
  status: string
  attempts: number
  maxAttempts: number
  lastError?: string
  sentAt?: string
  createdAt: string
  templateKey?: string
  parentId?: { name?: string } | string
  studentId?: { fullName?: string } | string
}

type NotificationTemplateRow = {
  _id: string
  key: string
  name: string
  channel: string
  subject?: string
  body: string
  active: boolean
}

type LetterTemplateRow = {
  _id: string
  name: string
  type: string
  subject: string
  body: string
  active: boolean
}

const LETTER_TYPES = [
  { value: 'warning', label: 'Warning letter' },
  { value: 'parent_meeting_invitation', label: 'Parent meeting invitation' },
  { value: 'serious_incident', label: 'Serious incident notice' },
  { value: 'hearing_invitation', label: 'Hearing invitation' },
  { value: 'suspension', label: 'Suspension letter' },
  { value: 'expulsion_recommendation', label: 'Expulsion recommendation' },
  { value: 'expulsion_decision', label: 'Expulsion decision' },
  { value: 'conduct_report', label: 'Conduct report' },
  { value: 'improvement_notice', label: 'Improvement notice' },
]

const QUEUE_STATUSES = ['queued', 'sending', 'sent', 'failed', 'manual_review', 'dead_letter']

export function CommunicationsPage() {
  const { has } = useAuth()
  const [tab, setTab] = useState<TabKey>('notifications')

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Parent engagement"
        title="Communications"
        subtitle="Consent-aware parent messaging, notification templates, official letters and WhatsApp delivery in one place."
      />

      <Tabs<TabKey>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'notifications', label: 'In-app notifications' },
          ...(has('letters.view') ? [{ key: 'letters' as TabKey, label: 'Letters' }] : []),
          ...(has('notifications.manage') ? [{ key: 'queue' as TabKey, label: 'Message queue' }] : []),
          ...(has('notifications.manage') || has('templates.manage') ? [{ key: 'templates' as TabKey, label: 'Templates' }] : []),
          ...(has('whatsapp.manage') ? [{ key: 'whatsapp' as TabKey, label: 'WhatsApp' }] : []),
        ]}
      />

      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'letters' && <LettersTab />}
      {tab === 'queue' && <QueueTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'whatsapp' && <WhatsappTab />}
    </div>
  )
}

function NotificationsTab() {
  const { has } = useAuth()
  const queryClient = useQueryClient()
  const { error: toastError } = useToast()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', unreadOnly, page],
    queryFn: () => getPage<NotificationItem>('/notifications', { page, pageSize: 25, unread: unreadOnly || undefined }),
    refetchInterval: 30_000,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => toastError(apiError(err)),
  })

  const markAll = useMutation({
    mutationFn: () => post<{ marked: number }>('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => toastError(apiError(err)),
  })

  const rows = data?.items ?? []
  const unread = Number(data?.meta.unread ?? 0)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={Bell}
          title="Your notifications"
          subtitle={unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'You are all caught up'}
          actions={
            <>
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => {
                    setUnreadOnly(e.target.checked)
                    setPage(1)
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Unread only
              </label>
              {has('notifications.view') && (
                <Button size="sm" variant="secondary" icon={CheckCheck} loading={markAll.isPending} disabled={unread === 0} onClick={() => markAll.mutate()}>
                  Mark all read
                </Button>
              )}
            </>
          }
        />

        {isLoading ? (
          <LoadingBlock label="Loading notifications…" />
        ) : rows.length ? (
          <>
            <ul className="divide-y divide-line dark:divide-[#1f2f49]">
              {rows.map((item) => (
                <li key={item._id} className={`flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between ${item.readAt ? '' : 'bg-brand-50/40 dark:bg-brand-950/20'}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${item.readAt ? 'bg-slate-100 text-slate-400 dark:bg-white/5' : 'bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300'}`}>
                      <BellRing className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</p>
                      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{item.message}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{timeAgo(item.createdAt)} · {titleCase(item.type)}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
                    {item.link && (
                      <Link to={item.link} className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => !item.readAt && markRead.mutate(item._id)}>
                        Open
                      </Link>
                    )}
                    {!item.readAt && (
                      <Button size="sm" variant="ghost" onClick={() => markRead.mutate(item._id)}>
                        Mark read
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-slate-500 dark:border-[#1f2f49]">
              <span>{data?.meta.total ?? 0} notifications</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="ghost" disabled={page >= Number(data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState icon={Inbox} title="No notifications" message="Incident updates, approvals and parent replies will appear here." />
        )}
      </Card>
    </div>
  )
}

function LettersTab() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['letters', status, q, page],
    queryFn: () => getPage<LetterRow>('/letters', { page, pageSize: 20, status: status || undefined, q: q || undefined }),
  })

  const { data: detail } = useQuery({
    queryKey: ['letter', selectedId],
    queryFn: () => get<LetterDetail>(`/letters/${selectedId}`),
    enabled: Boolean(selectedId),
  })

  const submit = useMutation({
    mutationFn: (id: string) => post(`/letters/${id}/submit`),
    onSuccess: () => {
      success('Letter submitted for approval')
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      queryClient.invalidateQueries({ queryKey: ['letter'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const issue = useMutation({
    mutationFn: (id: string) => post(`/letters/${id}/issue`),
    onSuccess: () => {
      success('Letter issued and delivered to the parent')
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      queryClient.invalidateQueries({ queryKey: ['letter'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const letters = data?.items ?? []

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Search reference, subject or student…" className="sm:w-72" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="sm:w-48">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_approval">Pending approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="issued">Issued</option>
        </Select>
        <div className="ml-auto">
          {has('letters.create') && (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              New letter
            </Button>
          )}
        </div>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading letters…" />
      ) : letters.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Delivery</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {letters.map((letter) => (
                  <tr key={letter._id} className="hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{letter.reference}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{letter.studentSnapshot?.fullName ?? '—'}</p>
                      <p className="text-xs text-slate-400">{letter.studentSnapshot?.studentId} · {letter.studentSnapshot?.className}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{titleCase(letter.type)}</td>
                    <td className="max-w-[240px] truncate px-4 py-3">{letter.subject}</td>
                    <td className="px-4 py-3"><StatusBadge status={letter.status} /></td>
                    <td className="px-4 py-3"><StatusBadge status={letter.deliveryStatus} /></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(letter.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setSelectedId(letter._id)}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-slate-500 dark:border-[#1f2f49]">
            <span>{data?.meta.total ?? 0} letters</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= Number(data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState icon={FileText} title="No letters yet" message="Draft an official warning, invitation or conduct report and route it for approval." />
      )}

      <CreateLetterModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: ['letters'] })} />

      <Modal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={detail?.subject ?? 'Letter'}
        subtitle={detail ? `${detail.reference} · ${titleCase(detail.type)}` : undefined}
        size="lg"
        footer={
          detail && (
            <>
              {has('letters.view') && ['approved', 'issued'].includes(detail.status) && (
                <Button
                  variant="secondary"
                  icon={Download}
                  onClick={() => downloadFile(`/letters/${detail._id}/pdf`, `${detail.reference}.pdf`).catch((err) => toastError(apiError(err)))}
                >
                  Download PDF
                </Button>
              )}
              {detail.status === 'draft' && has('letters.create') && (
                <Button loading={submit.isPending} onClick={() => submit.mutate(detail._id)}>Submit for approval</Button>
              )}
              {detail.status === 'approved' && has('letters.issue') && (
                <Button loading={issue.isPending} onClick={() => issue.mutate(detail._id)}>Issue to parent</Button>
              )}
            </>
          )
        }
      >
        {!detail ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <StatusBadge status={detail.deliveryStatus} />
              {detail.confidentiality === 'restricted' && <Badge tone="amber">Restricted</Badge>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Student</p>
                <p className="mt-0.5">{detail.studentSnapshot?.fullName} · {detail.studentSnapshot?.className}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Prepared by</p>
                <p className="mt-0.5">{refName(detail.preparedBy)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Created</p>
                <p className="mt-0.5">{formatDateTime(detail.createdAt)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Issued</p>
                <p className="mt-0.5">{detail.issuedAt ? formatDateTime(detail.issuedAt) : '—'}</p>
              </div>
            </div>
            {detail.rejectionReason && <Alert tone="danger" title="Rejected">{detail.rejectionReason}</Alert>}
            {detail.approvalNotes && <Alert tone="success" title="Approval notes">{detail.approvalNotes}</Alert>}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Letter body</p>
              <div className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-slate-50 p-4 leading-relaxed dark:border-[#1f2f49] dark:bg-white/[0.02]">
                {detail.body}
              </div>
            </div>
            {detail.history?.length ? (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">History</p>
                <ul className="mt-2 space-y-1.5">
                  {detail.history.map((h, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-slate-600 dark:text-slate-300">{titleCase(h.action)}{h.note ? ` — ${h.note}` : ''}</span>
                      <span className="shrink-0 text-slate-400">{formatDateTime(h.at)}</span>
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

function CreateLetterModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { success, error: toastError } = useToast()
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [form, setForm] = useState({ type: 'warning', templateId: '', subject: '', body: '' })

  const { data: templates } = useQuery({
    queryKey: ['letter-templates'],
    queryFn: () => get<LetterTemplateRow[]>('/letter-templates'),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () =>
      post<{ reference: string }>('/letters', {
        type: form.type,
        studentId: student?.id,
        templateId: form.templateId || undefined,
        subject: form.subject || undefined,
        body: form.body.trim() || undefined,
      }),
    onSuccess: (letter) => {
      success(`Letter ${letter.reference} created as a draft`)
      setStudent(null)
      setForm({ type: 'warning', templateId: '', subject: '', body: '' })
      onCreated()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const template = templates?.find((t) => t._id === form.templateId)
  const canSubmit = Boolean(student && (form.body.trim().length > 0 || form.templateId))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Draft a letter"
      subtitle="Letters are saved as drafts, then approved and issued to the parent."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Save draft</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Student" required>
          <StudentPicker value={student} onChange={setStudent} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Letter type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {LETTER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Template (optional)" hint="Selecting a template auto-fills placeholders such as student name and balance.">
            <Select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
              <option value="">Start from scratch</option>
              {(templates ?? []).map((t) => (
                <option key={t._id} value={t._id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Subject">
          <Input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder={template?.subject ? `Template: ${template.subject}` : 'e.g. Official warning — repeated lateness'}
          />
        </Field>
        <Field
          label="Body"
          required={!form.templateId}
          hint={form.templateId ? 'Leave blank to use the selected template, or write your own body.' : 'Use {{studentName}}, {{balance}} and other placeholders where helpful.'}
        >
          <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="min-h-[180px]" placeholder="Dear Parent/Guardian, …" />
        </Field>
        <Alert tone="info">
          Letters are reviewed by a headteacher or deputy before issue. Once approved, a signed PDF becomes available.
        </Alert>
      </div>
    </Modal>
  )
}

function QueueTab() {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [page, setPage] = useState(1)

  const { data: stats } = useQuery({
    queryKey: ['queue-stats'],
    queryFn: () => get<Record<string, number>>('/notifications/queue/stats'),
    refetchInterval: 30_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['queue', status, channel, page],
    queryFn: () => getPage<QueueRow>('/notifications/queue', { page, pageSize: 25, status: status || undefined, channel: channel || undefined }),
  })

  const process = useMutation({
    mutationFn: () => post<{ processed: number; sent: number; failed: number }>('/notifications/queue/process'),
    onSuccess: (result) => {
      success(`Queue processed — ${result.sent} sent, ${result.failed} failed of ${result.processed}`)
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: ['queue-stats'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const retry = useMutation({
    mutationFn: (id: string) => post(`/notifications/queue/${id}/retry`),
    onSuccess: () => {
      success('Message re-queued')
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: ['queue-stats'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const rows = data?.items ?? []
  const s = stats ?? {}

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Queued" value={s.queued ?? 0} icon={Mail} tone="brand" />
        <StatCard label="Sent" value={s.sent ?? 0} icon={Send} tone="emerald" />
        <StatCard label="Failed" value={s.failed ?? 0} icon={WifiOff} tone="red" />
        <StatCard label="Manual review" value={s.manual_review ?? 0} icon={Inbox} tone="amber" />
        <StatCard label="Dead letter" value={s.dead_letter ?? 0} icon={MessageSquare} tone="slate" />
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-4">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="sm:w-44">
          <option value="">All statuses</option>
          {QUEUE_STATUSES.map((st) => <option key={st} value={st}>{titleCase(st)}</option>)}
        </Select>
        <Select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1) }} className="sm:w-40">
          <option value="">All channels</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </Select>
        <Button variant="secondary" icon={RefreshCw} className="ml-auto" loading={process.isPending} onClick={() => process.mutate()}>
          Process queue now
        </Button>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading message queue…" />
      ) : rows.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Attempts</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {rows.map((row) => (
                  <tr key={row._id} className="align-top hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <p className="font-medium">{typeof row.parentId === 'object' ? row.parentId?.name ?? row.to : row.to}</p>
                      <p className="text-xs text-slate-400">
                        {typeof row.studentId === 'object' && row.studentId?.fullName ? `${row.studentId.fullName} · ` : ''}{row.to}
                      </p>
                      {row.lastError && <p className="mt-1 max-w-[260px] text-xs text-red-600 dark:text-red-400">{row.lastError}</p>}
                    </td>
                    <td className="px-4 py-3"><Badge tone="brand">{titleCase(row.channel)}</Badge></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{row.templateKey ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-xs">{row.attempts}/{row.maxAttempts}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {['failed', 'dead_letter', 'manual_review'].includes(row.status) && (
                        <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === row._id} onClick={() => retry.mutate(row._id)}>
                          Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-slate-500 dark:border-[#1f2f49]">
            <span>{data?.meta.total ?? 0} messages</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= Number(data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState icon={Mail} title="Queue is empty" message="Parent messages queued by incidents and letters will appear here." />
      )}
    </div>
  )
}

function TemplatesTab() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [templateModal, setTemplateModal] = useState<NotificationTemplateRow | 'new' | null>(null)
  const [letterTemplateModal, setLetterTemplateModal] = useState<LetterTemplateRow | 'new' | null>(null)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => get<NotificationTemplateRow[]>('/notifications/templates'),
    enabled: has('notifications.manage'),
  })

  const { data: letterTemplates } = useQuery({
    queryKey: ['letter-templates-all'],
    queryFn: () => get<LetterTemplateRow[]>('/letter-templates', { active: 'all' }),
    enabled: has('letters.view'),
  })

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          icon={Bell}
          title="Notification templates"
          subtitle="WhatsApp, SMS, email and in-app messages"
          actions={has('templates.manage') && <Button size="sm" icon={Plus} onClick={() => setTemplateModal('new')}>New</Button>}
        />
        {!has('notifications.manage') ? (
          <EmptyState title="Restricted" message="You need notification management access to view templates." />
        ) : isLoading ? (
          <LoadingBlock />
        ) : templates?.length ? (
          <ul className="divide-y divide-line dark:divide-[#1f2f49]">
            {templates.map((t) => (
              <li key={t._id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-400">{t.key}</span>
                    <Badge tone="brand">{titleCase(t.channel)}</Badge>
                    {!t.active && <Badge>Inactive</Badge>}
                  </div>
                  <p className="mt-1 text-sm font-medium">{t.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{t.body}</p>
                </div>
                {has('templates.manage') && (
                  <Button size="sm" variant="ghost" onClick={() => setTemplateModal(t)}>Edit</Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Bell} title="No notification templates" message="Create a template so incidents can notify parents automatically." />
        )}
      </Card>

      <Card>
        <CardHeader
          icon={FileText}
          title="Letter templates"
          subtitle="Official letters with merge placeholders"
          actions={has('templates.manage') && <Button size="sm" icon={Plus} onClick={() => setLetterTemplateModal('new')}>New</Button>}
        />
        {!has('letters.view') ? (
          <EmptyState title="Restricted" message="You need letters access to view letter templates." />
        ) : letterTemplates?.length ? (
          <ul className="divide-y divide-line dark:divide-[#1f2f49]">
            {letterTemplates.map((t) => (
              <li key={t._id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="ochre">{titleCase(t.type)}</Badge>
                    {!t.active && <Badge>Inactive</Badge>}
                  </div>
                  <p className="mt-1 text-sm font-medium">{t.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{t.subject}</p>
                </div>
                {has('templates.manage') && (
                  <Button size="sm" variant="ghost" onClick={() => setLetterTemplateModal(t)}>Edit</Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={FileText} title="No letter templates" message="Add a warning or invitation template to standardise official letters." />
        )}
      </Card>

      {templateModal !== null && (
        <NotificationTemplateModal
          key={templateModal === 'new' ? 'new' : templateModal._id}
          open
          existing={templateModal === 'new' ? null : templateModal}
          onClose={() => setTemplateModal(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['notification-templates'] })}
          onError={(err) => toastError(apiError(err))}
          onSuccess={success}
        />
      )}

      {letterTemplateModal !== null && (
        <LetterTemplateModal
          key={letterTemplateModal === 'new' ? 'new' : letterTemplateModal._id}
          open
          existing={letterTemplateModal === 'new' ? null : letterTemplateModal}
          onClose={() => setLetterTemplateModal(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['letter-templates-all'] })}
          onError={(err) => toastError(apiError(err))}
          onSuccess={success}
        />
      )}
    </div>
  )
}

function NotificationTemplateModal({
  open,
  existing,
  onClose,
  onSaved,
  onSuccess,
  onError,
}: {
  open: boolean
  existing: NotificationTemplateRow | null
  onClose: () => void
  onSaved: () => void
  onSuccess: (message: string) => void
  onError: (error: string) => void
}) {
  const [form, setForm] = useState(() =>
    existing
      ? { key: existing.key, name: existing.name, channel: existing.channel, subject: existing.subject ?? '', body: existing.body, active: existing.active }
      : { key: '', name: '', channel: 'whatsapp', subject: '', body: '', active: true },
  )

  const save = useMutation({
    mutationFn: () =>
      existing
        ? patch(`/notifications/templates/${existing._id}`, { name: form.name, channel: form.channel, subject: form.subject, body: form.body, active: form.active })
        : post('/notifications/templates', form),
    onSuccess: () => {
      onSuccess(existing ? 'Template updated' : 'Template created')
      onSaved()
      onClose()
    },
    onError: (err) => onError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit notification template' : 'New notification template'}
      subtitle="Placeholders like {{studentName}} and {{balance}} are replaced when the message is queued."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={form.name.trim().length < 2 || form.body.trim().length < 5} onClick={() => save.mutate()}>Save template</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template key" required hint="Lowercase letters, numbers, underscores">
            <Input value={form.key} disabled={Boolean(existing)} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="incident_deduction" />
          </Field>
          <Field label="Display name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Channel">
            <Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="in_app">In-app</option>
            </Select>
          </Field>
          <Field label="Active">
            <div className="flex h-10 items-center">
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Template active" />
            </div>
          </Field>
        </div>
        <Field label="Subject" hint="Used for email; optional elsewhere.">
          <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </Field>
        <Field label="Body" required>
          <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="min-h-[160px]" />
        </Field>
      </div>
    </Modal>
  )
}

function LetterTemplateModal({
  open,
  existing,
  onClose,
  onSaved,
  onSuccess,
  onError,
}: {
  open: boolean
  existing: LetterTemplateRow | null
  onClose: () => void
  onSaved: () => void
  onSuccess: (message: string) => void
  onError: (error: string) => void
}) {
  const [form, setForm] = useState(() =>
    existing
      ? { name: existing.name, type: existing.type, subject: existing.subject, body: existing.body, active: existing.active }
      : { name: '', type: 'warning', subject: '', body: '', active: true },
  )

  const save = useMutation({
    mutationFn: () =>
      existing
        ? patch(`/letter-templates/${existing._id}`, { name: form.name, subject: form.subject, body: form.body, active: form.active })
        : post('/letter-templates', form),
    onSuccess: () => {
      onSuccess(existing ? 'Letter template updated' : 'Letter template created')
      onSaved()
      onClose()
    },
    onError: (err) => onError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit letter template' : 'New letter template'}
      subtitle="Use {{studentName}}, {{parentName}}, {{balance}}, {{incidentNumber}} and {{schoolName}}."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={form.name.trim().length < 3 || form.subject.trim().length < 3 || form.body.trim().length < 10} onClick={() => save.mutate()}>Save template</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Official warning — repeated lateness" />
          </Field>
          <Field label="Letter type">
            <Select value={form.type} disabled={Boolean(existing)} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {LETTER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Subject" required>
          <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Warning regarding repeated lateness" />
        </Field>
        <Field label="Body" required>
          <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="min-h-[220px]" />
        </Field>
      </div>
    </Modal>
  )
}

function WhatsappTab() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()

  const { data: status } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => get<{ status: string; enabled: boolean; qrDataUrl?: string; lastConnectedAt?: string; lastError?: string; info?: { pushname?: string; number?: string } }>('/whatsapp/status'),
    refetchInterval: 6_000,
  })

  const { data: qr } = useQuery({
    queryKey: ['whatsapp-qr'],
    queryFn: () => get<{ status: string; qrDataUrl: string | null; enabled: boolean; lastError?: string }>('/whatsapp/qr'),
    refetchInterval: 6_000,
  })

  const connect = useMutation({
    mutationFn: () => post('/whatsapp/connect'),
    onSuccess: () => {
      success('WhatsApp is starting. Scan the QR code with the school phone.')
      queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] })
      queryClient.invalidateQueries({ queryKey: ['whatsapp-qr'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const disconnect = useMutation({
    mutationFn: () => post('/whatsapp/disconnect'),
    onSuccess: () => {
      success('WhatsApp disconnected')
      queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] })
      queryClient.invalidateQueries({ queryKey: ['whatsapp-qr'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const state = status?.status ?? 'disabled'
  const connected = state === 'ready'

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 place-items-center rounded-xl ${connected ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-white/5'}`}>
            {connected ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-sm font-semibold">WhatsApp gateway</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge status={state} />
              {status?.enabled ? <Badge tone="emerald">Enabled in settings</Badge> : <Badge tone="amber">Disabled in settings</Badge>}
            </div>
          </div>
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-slate-500">Account</dt><dd>{status?.info?.pushname ?? '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">Number</dt><dd>{status?.info?.number ?? '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">Last connected</dt><dd>{status?.lastConnectedAt ? formatDateTime(status.lastConnectedAt) : '—'}</dd></div>
        </dl>

        {status?.lastError && <div className="mt-3"><Alert tone="danger" title="Last error">{status.lastError}</Alert></div>}

        {!status?.enabled && (
          <div className="mt-4">
            <Alert tone="warning" title="WhatsApp is switched off">
              An administrator must enable WhatsApp in Settings → Communications before the gateway can connect. SMS or email remains available as a fallback.
            </Alert>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {has('whatsapp.manage') && !connected && (
            <Button icon={Smartphone} loading={connect.isPending} onClick={() => connect.mutate()}>Connect device</Button>
          )}
          {has('whatsapp.manage') && connected && (
            <Button variant="danger" icon={WifiOff} loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><QrCode className="h-4 w-4" /> Link a device</div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Open WhatsApp on the school phone → Linked devices → Link a device, then scan this code. The session is stored on the server.
        </p>
        <div className="mt-4 flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-line bg-slate-50 p-4 dark:border-[#2a3b55] dark:bg-white/[0.02]">
          {connected ? (
            <div className="text-center">
              <Wifi className="mx-auto h-10 w-10 text-emerald-500" />
              <p className="mt-2 text-sm font-medium">Device connected</p>
              <p className="text-xs text-slate-500">Messages will send automatically from the queue.</p>
            </div>
          ) : qr?.qrDataUrl ? (
            <div className="text-center">
              <img src={qr.qrDataUrl} alt="WhatsApp QR code" className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />
              <p className="mt-2 text-xs text-slate-500">This code refreshes automatically.</p>
            </div>
          ) : (
            <div className="text-center text-sm text-slate-500">
              <QrCode className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-2">No QR code yet. Press “Connect device” to start the session.</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
