import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Layers,
  RefreshCw,
  Search,
  Send,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, downloadFile, get, getPage, post } from '../lib/api'
import { useStudentSearch } from '../lib/hooks'
import { formatDateTime, titleCase } from '../lib/utils'
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
import type { Student } from '../lib/types'

type BulkType = 'deduction' | 'reward'
type BulkScope = 'class' | 'stream' | 'dormitory' | 'school' | 'selection'

type Offence = { _id: string; code: string; name: string; category: string; deduction: number; severity: string }
type ClassRow = { id?: string; _id?: string; name: string; level: string; studentCount?: number }
type StreamRow = { _id: string; name: string; code?: string }
type DormRow = { _id: string; name: string; gender?: string }

type PreviewLine = {
  studentId: string
  name: string
  currentBalance: number
  change: number
  projectedBalance: number
  skipped: boolean
  skipReason?: string
}

type Preview = {
  type: BulkType
  scope: BulkScope
  offence?: { id: string; name: string; deduction: number }
  points?: number
  count: number
  applicable: number
  skipped: number
  totalChange: number
  lines: PreviewLine[]
}

type BulkResultLine = {
  studentId?: string
  name: string
  ok: boolean
  skipped?: boolean
  skipReason?: string
  change?: number
  newBalance?: number
  error?: string
}

type BulkRow = {
  _id: string
  reference: string
  type: BulkType
  scope: BulkScope
  status: string
  total: number
  applied: number
  skipped: number
  failed: number
  reason: string
  createdAt: string
  completedAt?: string
}

type BulkDetail = BulkRow & {
  exclusions: { name: string; reason: string }[]
  results: BulkResultLine[]
}

const SCOPES: { value: BulkScope; label: string; hint: string }[] = [
  { value: 'class', label: 'A class', hint: 'Every active student in one class' },
  { value: 'stream', label: 'A stream', hint: 'Every active student in a stream' },
  { value: 'dormitory', label: 'A dormitory', hint: 'Every boarder in a dormitory' },
  { value: 'selection', label: 'Selected students', hint: 'Pick individual students' },
  { value: 'school', label: 'Whole school', hint: 'Leadership only' },
]

function money(value: number) {
  return `${value > 0 ? '+' : ''}${value}`
}

function newClientReference() {
  const uuid = (globalThis.crypto as Crypto | undefined)?.randomUUID?.()
  return uuid ?? `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function BulkDisciplinePage() {
  const { has, hasRole } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()

  const canDeduct = has(['marks.deduct', 'marks.adjust.approve'])
  const canReward = has('marks.reward')
  const leadership = hasRole(['HEADTEACHER', 'ADMIN'])

  const [type, setType] = useState<BulkType>(canDeduct ? 'deduction' : 'reward')
  const [scope, setScope] = useState<BulkScope>('class')
  const [classId, setClassId] = useState('')
  const [streamId, setStreamId] = useState('')
  const [dormitoryId, setDormitoryId] = useState('')
  const [selection, setSelection] = useState<{ id: string; name: string; ref: string }[]>([])
  const [search, setSearch] = useState('')
  const [offenceId, setOffenceId] = useState('')
  const [points, setPoints] = useState(5)
  const [reason, setReason] = useState('')
  const [title, setTitle] = useState('')
  const [notifyParents, setNotifyParents] = useState(true)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const clientRef = useRef('')

  const { data: offences } = useQuery({
    queryKey: ['offences'],
    queryFn: () => get<Offence[]>('/offences'),
    enabled: type === 'deduction',
  })
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => get<ClassRow[]>('/classes') })
  const { data: streams } = useQuery({ queryKey: ['streams'], queryFn: () => get<StreamRow[]>('/streams') })
  const { data: dormitories } = useQuery({ queryKey: ['dormitories'], queryFn: () => get<DormRow[]>('/dormitories') })
  const { data: searchResults, isFetching: searching } = useStudentSearch(search, search.trim().length >= 2)

  const selectionKey = selection.map((s) => s.id).join(',')
  useEffect(() => {
    setPreview(null)
    setExcluded(new Set())
  }, [type, scope, classId, streamId, dormitoryId, offenceId, points, reason, title, selectionKey])

  function buildBody() {
    return {
      type,
      scope,
      classId: scope === 'class' ? classId || undefined : undefined,
      streamId: scope === 'stream' ? streamId || undefined : undefined,
      dormitoryId: scope === 'dormitory' ? dormitoryId || undefined : undefined,
      studentIds: scope === 'selection' ? selection.map((s) => s.id) : undefined,
      offenceId: type === 'deduction' ? offenceId || undefined : undefined,
      points: type === 'reward' ? points : undefined,
      reason: reason.trim(),
      title: type === 'reward' ? title.trim() || undefined : undefined,
      notifyParents,
    }
  }

  const formReady =
    reason.trim().length >= 5 &&
    (scope === 'school' || scope === 'selection' || (scope === 'class' && classId) || (scope === 'stream' && streamId) || (scope === 'dormitory' && dormitoryId)) &&
    (scope !== 'selection' || selection.length > 0) &&
    (type === 'reward' || Boolean(offenceId))

  const previewMutation = useMutation({
    mutationFn: () => post<Preview>('/discipline/bulk/preview', buildBody()),
    onSuccess: (result) => {
      setPreview(result)
      setExcluded(new Set())
    },
    onError: (err) => toastError(apiError(err)),
  })

  const apply = useMutation({
    mutationFn: () => {
      clientRef.current = newClientReference()
      return post<BulkRow & { failed: number; applied: number }>('/discipline/bulk/apply', {
        ...buildBody(),
        excludeStudentIds: [...excluded],
        exclusionReason: 'Excluded by operator',
        clientReference: clientRef.current,
      })
    },
    onSuccess: (operation) => {
      success(
        operation.failed
          ? `${operation.reference} applied to ${operation.applied} student(s) with ${operation.failed} failure(s) — open the history to retry`
          : `${operation.reference} applied to ${operation.applied} student(s)`,
      )
      clientRef.current = ''
      setPreview(null)
      queryClient.invalidateQueries({ queryKey: ['bulk-operations'] })
      queryClient.invalidateQueries({ queryKey: ['student-search'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const canApply = canDeduct || canReward
  const included = useMemo(
    () => (preview?.lines ?? []).filter((line) => !line.skipped && !excluded.has(line.studentId)),
    [preview, excluded],
  )
  const totalChange = included.reduce((sum, line) => sum + line.change, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Conduct operations"
        title="Bulk discipline centre"
        subtitle="Preview every balance that would change, exclude individual students, then apply an audited deduction or reward to a class, stream, dormitory, selection or the whole school."
      />

      {canApply ? (
        <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
          <Card>
            <CardHeader
              icon={Layers}
              title="Build an operation"
              subtitle="Deductions are posted only after this explicit action — never on report."
            />
            <div className="space-y-4 p-4">
              <Tabs<BulkType>
                active={type}
                onChange={setType}
                tabs={[
                  ...(canDeduct ? [{ key: 'deduction' as BulkType, label: 'Deduct conduct marks' }] : []),
                  ...(canReward ? [{ key: 'reward' as BulkType, label: 'Reward conduct' }] : []),
                ]}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Apply to" required>
                  <Select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as BulkScope)}
                  >
                    {SCOPES.filter((s) => s.value !== 'school' || leadership).map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end pb-1 text-xs text-slate-500 dark:text-slate-400">
                  {SCOPES.find((s) => s.value === scope)?.hint}
                </div>
              </div>

              {scope === 'class' && (
                <Field label="Class" required>
                  <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                    <option value="">Select a class</option>
                    {(classes ?? []).map((c) => {
                      const id = c.id ?? c._id ?? ''
                      return <option key={id} value={id}>{c.name} · {c.studentCount ?? 0} students</option>
                    })}
                  </Select>
                </Field>
              )}

              {scope === 'stream' && (
                <Field label="Stream" required>
                  <Select value={streamId} onChange={(e) => setStreamId(e.target.value)}>
                    <option value="">Select a stream</option>
                    {(streams ?? []).map((s) => <option key={s._id} value={s._id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
                  </Select>
                </Field>
              )}

              {scope === 'dormitory' && (
                <Field label="Dormitory" required>
                  <Select value={dormitoryId} onChange={(e) => setDormitoryId(e.target.value)}>
                    <option value="">Select a dormitory</option>
                    {(dormitories ?? []).map((d) => <option key={d._id} value={d._id}>{d.name}{d.gender ? ` · ${titleCase(d.gender)}` : ''}</option>)}
                  </Select>
                </Field>
              )}

              {scope === 'school' && (
                <Alert tone="warning" title="School-wide operation">
                  This reaches every active student you can see. It is restricted to Headteacher or Administrator authority and is fully audited.
                </Alert>
              )}

              {scope === 'selection' && (
                <div className="space-y-2">
                  <Field label="Students" required hint="Search by name or student ID, then add each student.">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search students…" />
                      {search.trim().length >= 2 && (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-lift dark:border-[#26374f] dark:bg-[#101a2c]">
                          {searching ? (
                            <p className="px-4 py-3 text-sm text-slate-400">Searching…</p>
                          ) : searchResults?.length ? (
                            searchResults.map((student: Student) => {
                              const id = student.id ?? student._id ?? ''
                              if (selection.some((s) => s.id === id)) return null
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => {
                                    setSelection((next) => [...next, { id, name: student.fullName, ref: student.studentId }])
                                    setSearch('')
                                  }}
                                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/5"
                                >
                                  <span>{student.fullName}<span className="ml-2 text-xs text-slate-400">{student.studentId}</span></span>
                                  <span className="text-xs text-slate-400">{typeof student.classId === 'object' ? student.classId?.name : ''}</span>
                                </button>
                              )
                            })
                          ) : (
                            <p className="px-4 py-3 text-sm text-slate-400">No matching students</p>
                          )}
                        </div>
                      )}
                    </div>
                  </Field>
                  {selection.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selection.map((student) => (
                        <span key={student.id} className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
                          <UserRound className="h-3.5 w-3.5" />
                          {student.name}
                          <span className="text-brand-500">{student.ref}</span>
                          <button
                            type="button"
                            onClick={() => setSelection((next) => next.filter((s) => s.id !== student.id))}
                            className="rounded-full p-0.5 hover:bg-brand-100 dark:hover:bg-brand-900/50"
                            aria-label={`Remove ${student.name}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">No students selected yet.</p>
                  )}
                </div>
              )}

              {type === 'deduction' ? (
                <Field label="Offence rule" required hint="The deduction comes from the offence library, so every student receives the same penalty.">
                  <Select value={offenceId} onChange={(e) => setOffenceId(e.target.value)}>
                    <option value="">Select an offence</option>
                    {(offences ?? []).map((o) => (
                      <option key={o._id} value={o._id}>{o.name} · −{o.deduction} marks</option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Reward points" required hint="Between 1 and 20 marks per student.">
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={points}
                      onChange={(e) => setPoints(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                    />
                  </Field>
                  <Field label="Title" hint="Shown on the recognition record.">
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Outstanding house duty" />
                  </Field>
                </div>
              )}

              <Field label="Reason" required hint="Recorded on every ledger row and in the audit trail.">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="min-h-[90px]"
                  placeholder="Why is this operation being applied? Reference the event or decision."
                />
              </Field>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-3 py-2.5 dark:border-[#26374f]">
                <div>
                  <p className="text-sm font-medium">Notify parents</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Sends a consent-aware message for every applied student.</p>
                </div>
                <Toggle checked={notifyParents} onChange={setNotifyParents} label="Notify parents" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button icon={Users} loading={previewMutation.isPending} disabled={!formReady} onClick={() => previewMutation.mutate()}>
                  Preview affected students
                </Button>
                <Button
                  icon={Send}
                  loading={apply.isPending}
                  disabled={!preview || included.length === 0 || apply.isPending}
                  onClick={() => apply.mutate()}
                >
                  Apply to {included.length || 0} student{included.length === 1 ? '' : 's'}
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader icon={AlertTriangle} title="Guardrails" subtitle="What this operation will and will not do" />
              <ul className="space-y-2.5 p-4 text-xs text-slate-600 dark:text-slate-300">
                <li>· A preview is calculated from the selected term's ledger, never from a stale live balance.</li>
                <li>· Students already at zero cannot be deducted further; the preview explains each skip.</li>
                <li>· Every row is immutable and chained to the previous balance, so the operation can be audited and reversed.</li>
                <li>· Retries only replay failed rows and never duplicate a deduction.</li>
                <li>· Parent messages respect WhatsApp/email/SMS consent and provider availability.</li>
              </ul>
            </Card>

            {preview && (
              <Card>
                <CardHeader icon={CheckCircle2} title="Preview" subtitle={`${preview.count} student(s) in scope · ${preview.applicable} applicable`} />
                <div className="grid grid-cols-2 gap-3 p-4">
                  <StatCard label="Included now" value={included.length} tone="brand" />
                  <StatCard label="Projected change" value={money(totalChange)} tone={totalChange < 0 ? 'red' : 'emerald'} />
                  <StatCard label="Skipped" value={preview.skipped + (preview.lines.filter((l) => !l.skipped).length - included.length)} tone="amber" />
                  <StatCard label="Students in scope" value={preview.count} tone="slate" />
                </div>
                {preview.offence && (
                  <p className="px-4 pb-3 text-xs text-slate-500 dark:text-slate-400">
                    Offence: {preview.offence.name} · −{preview.offence.deduction} marks each
                  </p>
                )}
              </Card>
            )}
          </div>
        </div>
      ) : (
        <Alert tone="info" title="Read-only access">
          You can review past bulk operations below. Applying deductions or rewards needs mark authority granted by an administrator.
        </Alert>
      )}

      {preview && (
        <Card className="overflow-hidden">
          <CardHeader
            icon={Users}
            title="Affected students"
            subtitle="Uncheck a student to exclude them from this operation. Exclusions are recorded with a reason."
            actions={
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setExcluded((next) => {
                    const selectable = preview.lines.filter((l) => !l.skipped).map((l) => l.studentId)
                    const allExcluded = selectable.every((id) => next.has(id))
                    return allExcluded ? new Set() : new Set(selectable)
                  })
                }
              >
                {preview.lines.filter((l) => !l.skipped).every((l) => excluded.has(l.studentId)) ? 'Include all' : 'Exclude all'}
              </Button>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Include</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3 text-right">Current</th>
                  <th className="px-4 py-3 text-right">Change</th>
                  <th className="px-4 py-3 text-right">Projected</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {preview.lines.map((line) => {
                  const isExcluded = excluded.has(line.studentId)
                  const disabled = line.skipped
                  return (
                    <tr key={line.studentId} className={isExcluded || line.skipped ? 'opacity-60' : ''}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={!disabled && !isExcluded}
                          disabled={disabled}
                          onChange={(e) =>
                            setExcluded((next) => {
                              const copy = new Set(next)
                              if (e.target.checked) copy.delete(line.studentId)
                              else copy.add(line.studentId)
                              return copy
                            })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">{line.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{line.currentBalance}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${line.change < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {disabled || isExcluded ? '—' : money(line.change)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{disabled || isExcluded ? line.currentBalance : line.projectedBalance}</td>
                      <td className="px-4 py-3 text-xs">
                        {line.skipped ? (
                          <span className="text-amber-600 dark:text-amber-400">{line.skipReason}</span>
                        ) : isExcluded ? (
                          <Badge tone="amber">Excluded</Badge>
                        ) : (
                          <Badge tone="success">Will change</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <BulkHistory
        canRetry={(row) => (row.type === 'deduction' ? canDeduct : canReward) && (row.scope !== 'school' || leadership)}
        onOpen={setDetailId}
        onError={toastError}
      />

      <BulkDetailModal
        id={detailId}
        onClose={() => setDetailId(null)}
        canRetry={canDeduct || canReward}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ['bulk-operations'] })}
      />
    </div>
  )
}

function BulkHistory({ canRetry, onOpen, onError }: { canRetry: (row: BulkRow) => boolean; onOpen: (id: string) => void; onError: (message: string) => void }) {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const { success } = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['bulk-operations', page],
    queryFn: () => getPage<BulkRow>('/discipline/bulk', { page, pageSize: 15 }),
  })

  const retry = useMutation({
    mutationFn: (row: BulkRow) => post<BulkRow>(`/discipline/bulk/${row._id}/retry`),
    onSuccess: (operation) => {
      success(`${operation.reference} retried — ${operation.applied} applied, ${operation.failed} still failing`)
      queryClient.invalidateQueries({ queryKey: ['bulk-operations'] })
    },
    onError: (err) => onError(apiError(err)),
  })

  const rows = data?.items ?? []

  return (
    <Card className="overflow-hidden">
      <CardHeader icon={Layers} title="Bulk operation history" subtitle="Every operation, its outcome and its downloadable per-student report." />
      {isLoading ? (
        <LoadingBlock label="Loading bulk operations…" />
      ) : rows.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {rows.map((row) => (
                  <tr key={row._id} className="hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.reference}</td>
                    <td className="px-4 py-3"><Badge tone={row.type === 'deduction' ? 'danger' : 'success'}>{titleCase(row.type)}</Badge></td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{titleCase(row.scope)}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400">{row.applied} applied</span>
                      {row.skipped ? <span className="text-slate-400"> · {row.skipped} skipped</span> : null}
                      {row.failed ? <span className="text-red-600 dark:text-red-400"> · {row.failed} failed</span> : null}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {['partial', 'failed'].includes(row.status) && canRetry(row) && (
                          <Button size="sm" variant="secondary" icon={RefreshCw} loading={retry.isPending && retry.variables?._id === row._id} onClick={() => retry.mutate(row)}>
                            Retry
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadFile(`/discipline/bulk/${row._id}/report.csv`, `${row.reference}-results.csv`).catch((err) => onError(apiError(err)))}>
                          CSV
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onOpen(row._id)}>Open</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-slate-500 dark:border-[#1f2f49]">
            <span>{data?.meta.total ?? 0} operations</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= Number(data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState icon={Layers} title="No bulk operations yet" message="Build an operation above; its preview and results will be recorded here." />
      )}
    </Card>
  )
}

function BulkDetailModal({ id, onClose, canRetry, onChanged }: { id: string | null; onClose: () => void; canRetry: boolean; onChanged: () => void }) {
  const { success, error: toastError } = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['bulk-operation', id],
    queryFn: () => get<BulkDetail>(`/discipline/bulk/${id}`),
    enabled: Boolean(id),
  })

  const retry = useMutation({
    mutationFn: () => post<BulkRow>(`/discipline/bulk/${id}/retry`),
    onSuccess: (operation) => {
      success(`${operation.reference} retried — ${operation.applied} applied, ${operation.failed} still failing`)
      onChanged()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={Boolean(id)}
      onClose={onClose}
      title={data?.reference ?? 'Bulk operation'}
      subtitle={data ? `${titleCase(data.type)} · ${titleCase(data.scope)} · ${data.applied}/${data.total} applied` : undefined}
      size="lg"
      footer={
        data && (
          <>
            <Button variant="secondary" icon={Download} onClick={() => downloadFile(`/discipline/bulk/${data._id}/report.csv`, `${data.reference}-results.csv`).catch((err) => toastError(apiError(err)))}>
              Download CSV
            </Button>
            {canRetry && ['partial', 'failed'].includes(data.status) && (
              <Button icon={RefreshCw} loading={retry.isPending} onClick={() => retry.mutate()}>Retry failed rows</Button>
            )}
          </>
        )
      }
    >
      {isLoading || !data ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            <Badge tone={data.type === 'deduction' ? 'danger' : 'success'}>{titleCase(data.type)}</Badge>
            <Badge tone="neutral">{titleCase(data.scope)}</Badge>
            <span className="text-xs text-slate-500">{formatDateTime(data.createdAt)}</span>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Reason</p>
            <p className="mt-1 whitespace-pre-wrap">{data.reason}</p>
          </div>
          {data.exclusions.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Exclusions</p>
              <ul className="mt-1 space-y-1 text-xs">
                {data.exclusions.map((exclusion, index) => (
                  <li key={index} className="text-slate-600 dark:text-slate-300">{exclusion.name} — {exclusion.reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-line dark:border-[#1f2f49]">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2 text-right">Change</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {data.results.map((line, index) => (
                  <tr key={`${line.studentId ?? index}`}>
                    <td className="px-3 py-2 font-medium">{line.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{typeof line.change === 'number' ? money(line.change) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{typeof line.newBalance === 'number' ? line.newBalance : '—'}</td>
                    <td className="px-3 py-2">
                      {line.ok ? (
                        line.skipped ? <span className="text-slate-500">{line.skipReason ?? 'Skipped'}</span> : <span className="text-emerald-600 dark:text-emerald-400">Applied</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">{line.error ?? line.skipReason ?? 'Failed'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}
