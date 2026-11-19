import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BedDouble,
  Clock,
  DoorOpen,
  Home,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Undo2,
  UserRound,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, post } from '../lib/api'
import { useStructure } from '../lib/hooks'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
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
  Tabs,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

type TabKey = 'overview' | 'movements' | 'allocations' | 'reports'

type DormRow = {
  _id: string
  name: string
  code: string
  gender: string
  capacity: number
  residents: number
  occupancy: number | null
  outNow: number
  overdue: number
  missing: number
}

type Movement = {
  _id: string
  reference: string
  type: string
  destination: string
  reason: string
  outAt: string
  expectedReturnAt?: string
  returnedAt?: string
  status: string
  missingReportedAt?: string
  resolvedAt?: string
  notes?: string
  studentId?: { _id?: string; fullName?: string; studentId?: string } | string
  dormitoryId?: { name?: string } | string
}

type Overview = {
  dormitories: DormRow[]
  unallocated: number
  totals: { residents: number; outNow: number; overdue: number; missing: number }
  openMovements: Movement[]
}

type Allocation = {
  _id: string
  roomNumber?: string
  bedNumber?: string
  allocatedAt: string
  active: boolean
  releasedAt?: string
  releaseReason?: string
  studentId?: { _id?: string; fullName?: string; studentId?: string } | string
  dormitoryId?: { name?: string } | string
}

type MatronReport = {
  from: string
  to: string
  dormitories: Array<{
    dormitoryId: string
    name: string
    residents: number
    exits: number
    returns: number
    weekendPermissions: number
    overdueNow: number
    missingUnresolved: number
    welfareFollowUps: number
  }>
}

function fullName(ref: Movement['studentId'] | Allocation['studentId']) {
  if (!ref || typeof ref === 'string') return 'Student'
  return ref.fullName ?? 'Student'
}

function studentRef(ref: Movement['studentId'] | Allocation['studentId']) {
  if (!ref || typeof ref === 'string') return ''
  return ref.studentId ?? ''
}

function dormName(ref: Movement['dormitoryId'] | Allocation['dormitoryId']) {
  if (!ref) return ''
  return typeof ref === 'string' ? '' : ref.name ?? ''
}

function isoOrUndefined(value: string) {
  return value ? new Date(value).toISOString() : undefined
}

function localToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date())
}

export function BoardingPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const { data: structure } = useStructure()
  const canRecord = has('boarding.record')
  const canManage = has('boarding.manage')
  const canEscalate = has('boarding.escalate')
  const canReport = has('attendance.reports')
  const [tab, setTab] = useState<TabKey>('overview')

  const overviewQuery = useQuery({
    queryKey: ['boarding-overview'],
    queryFn: () => get<Overview>('/boarding/overview'),
    enabled: tab === 'overview',
    refetchInterval: 60_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['boarding-overview'] })
    queryClient.invalidateQueries({ queryKey: ['boarding-movements'] })
    queryClient.invalidateQueries({ queryKey: ['boarding-allocations'] })
  }

  const returned = useMutation({
    mutationFn: (id: string) => post(`/boarding/movements/${id}/return`, {}),
    onSuccess: () => {
      success('Return recorded')
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const overdue = useMutation({
    mutationFn: (id: string) => post(`/boarding/movements/${id}/flag-overdue`),
    onSuccess: (data) => {
      const notified = (data as { guardianNotified?: boolean }).guardianNotified
      success(notified ? 'Marked overdue and the guardian was queued' : 'Marked overdue')
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Student welfare"
        title="Boarding"
        subtitle="Dormitory occupancy, bed allocations, movements, weekend permissions and missing-student escalation."
        actions={
          <Button variant="secondary" icon={RefreshCw} loading={overviewQuery.isFetching} onClick={() => overviewQuery.refetch()}>
            Refresh
          </Button>
        }
      />

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'movements', label: 'Movements' },
          { key: 'allocations', label: 'Allocations' },
          { key: 'reports', label: 'Matron / patron report' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <BoardingOverview
          data={overviewQuery.data}
          loading={overviewQuery.isLoading}
          canRecord={canRecord}
          canEscalate={canEscalate}
          onReturn={(id) => returned.mutate(id)}
          onOverdue={(id) => overdue.mutate(id)}
        />
      )}
      {tab === 'movements' && <MovementsTab canRecord={canRecord} canEscalate={canEscalate} onChange={invalidate} dormitories={structure?.dormitories ?? []} />}
      {tab === 'allocations' && <AllocationsTab canManage={canManage} canRecord={canRecord} onChange={invalidate} dormitories={structure?.dormitories ?? []} />}
      {tab === 'reports' && <MatronReportTab enabled={canReport} />}
    </div>
  )
}

function BoardingOverview({
  data,
  loading,
  canRecord,
  canEscalate,
  onReturn,
  onOverdue,
}: {
  data?: Overview
  loading: boolean
  canRecord: boolean
  canEscalate: boolean
  onReturn: (id: string) => void
  onOverdue: (id: string) => void
}) {
  const [missing, setMissing] = useState<Movement | null>(null)
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const escalate = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => post(`/boarding/movements/${id}/missing`, { note }),
    onSuccess: () => {
      success('Missing-student escalation sent')
      setMissing(null)
      queryClient.invalidateQueries({ queryKey: ['boarding-overview'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (loading) return <LoadingBlock label="Loading boarding operations…" />

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Boarders" value={data?.totals.residents ?? 0} icon={BedDouble} tone="brand" hint={`${data?.unallocated ?? 0} unallocated`} />
        <StatCard label="Out now" value={data?.totals.outNow ?? 0} icon={DoorOpen} tone="ochre" />
        <StatCard label="Overdue" value={data?.totals.overdue ?? 0} icon={Clock} tone="amber" />
        <StatCard label="Missing" value={data?.totals.missing ?? 0} icon={ShieldAlert} tone="red" />
      </div>

      {data?.totals.missing ? (
        <Alert tone="danger" title="Missing-student escalation active">
          {data.totals.missing} boarding movement{data.totals.missing === 1 ? ' is' : 's are'} escalated and unresolved. Follow the school's safeguarding procedure and record the outcome.
        </Alert>
      ) : null}

      {!data?.dormitories.length ? (
        <EmptyState title="No dormitories yet" message="Create dormitories in School structure to start allocating boarders." icon={Home} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.dormitories.map((dorm) => (
            <Card key={dorm._id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{dorm.name}</p>
                  <p className="text-xs text-slate-500">
                    {dorm.code} · {titleCase(dorm.gender)}
                  </p>
                </div>
                <Badge tone={dorm.missing ? 'red' : dorm.overdue ? 'amber' : 'slate'}>
                  {dorm.residents}/{dorm.capacity || '∞'}
                </Badge>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: `${Math.min(100, dorm.occupancy ?? (dorm.capacity ? (dorm.residents / dorm.capacity) * 100 : 0))}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <Badge tone="slate">Out {dorm.outNow}</Badge>
                <Badge tone="amber">Overdue {dorm.overdue}</Badge>
                <Badge tone="red">Missing {dorm.missing}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader title="Open movements" subtitle="Students currently out or overdue, newest expected return first." icon={DoorOpen} />
        {!data?.openMovements.length ? (
          <EmptyState title="Everyone accounted for" message="No students are currently recorded out of the dormitories." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-[#26374f] dark:bg-white/5">
                <tr>
                  <th className="px-4 py-2.5">Student</th>
                  <th className="px-4 py-2.5">Destination</th>
                  <th className="px-4 py-2.5">Expected back</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#26374f]">
                {data.openMovements.map((movement) => (
                  <tr key={movement._id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{fullName(movement.studentId)}</p>
                      <p className="text-xs text-slate-400">{studentRef(movement.studentId)}{dormName(movement.dormitoryId) ? ` · ${dormName(movement.dormitoryId)}` : ''}</p>
                    </td>
                    <td className="px-4 py-2.5">{movement.destination}</td>
                    <td className="px-4 py-2.5">{movement.expectedReturnAt ? formatDateTime(movement.expectedReturnAt) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={movement.status === 'overdue' ? 'amber' : 'sky'}>{titleCase(movement.status)}</Badge>
                        {movement.missingReportedAt && !movement.resolvedAt ? <Badge tone="red">Missing</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {canRecord && movement.status !== 'overdue' && (
                          <Button size="sm" variant="secondary" icon={Clock} onClick={() => onOverdue(movement._id)}>
                            Overdue
                          </Button>
                        )}
                        {canRecord && (
                          <Button size="sm" variant="secondary" icon={Undo2} onClick={() => onReturn(movement._id)}>
                            Return
                          </Button>
                        )}
                        {canEscalate && !movement.missingReportedAt && (
                          <Button size="sm" variant="danger" icon={ShieldAlert} onClick={() => setMissing(movement)}>
                            Missing
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(missing)}
        onClose={() => setMissing(null)}
        title="Escalate a missing student"
        subtitle={missing ? `${fullName(missing.studentId)} · ${missing.destination}` : ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMissing(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={escalate.isPending}
              onClick={() => missing && escalate.mutate({ id: missing._id, note: 'Reported missing from the boarding workspace' })}
            >
              Escalate and alert guardians
            </Button>
          </div>
        }
      >
        <Alert tone="danger" title="Use the school's safeguarding procedure">
          This alerts boarding leadership in-app and messages the guardians with limited, non-confidential details. Record the resolution once the student is found.
        </Alert>
      </Modal>
    </div>
  )
}

const MOVEMENT_TYPES = ['exit', 'weekend_permission', 'medical', 'school_activity', 'home', 'other'] as const

function MovementsTab({
  canRecord,
  canEscalate,
  onChange,
  dormitories,
}: {
  canRecord: boolean
  canEscalate: boolean
  onChange: () => void
  dormitories: { _id: string; name: string }[]
}) {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('open')
  const [dormitoryId, setDormitoryId] = useState('')
  const [open, setOpen] = useState(false)
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [type, setType] = useState<(typeof MOVEMENT_TYPES)[number]>('weekend_permission')
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [outAt, setOutAt] = useState('')
  const [expectedReturnAt, setExpectedReturnAt] = useState('')

  const query = useQuery({
    queryKey: ['boarding-movements', status, dormitoryId],
    queryFn: () =>
      getPage<Movement>('/boarding/movements', {
        status: status || undefined,
        dormitoryId: dormitoryId || undefined,
        pageSize: 50,
      }),
  })

  const create = useMutation({
    mutationFn: () =>
      post('/boarding/movements', {
        studentId: student?.id,
        type,
        destination: destination.trim(),
        reason: reason.trim(),
        outAt: isoOrUndefined(outAt),
        expectedReturnAt: isoOrUndefined(expectedReturnAt),
      }),
    onSuccess: () => {
      success('Movement recorded')
      setOpen(false)
      setStudent(null)
      setDestination('')
      setReason('')
      setOutAt('')
      setExpectedReturnAt('')
      queryClient.invalidateQueries({ queryKey: ['boarding-movements'] })
      onChange()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const returned = useMutation({
    mutationFn: (id: string) => post(`/boarding/movements/${id}/return`, {}),
    onSuccess: () => {
      success('Return recorded')
      queryClient.invalidateQueries({ queryKey: ['boarding-movements'] })
      onChange()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const escalate = useMutation({
    mutationFn: (id: string) => post(`/boarding/movements/${id}/missing`, { note: 'Reported missing from the boarding movements list' }),
    onSuccess: () => {
      success('Missing-student escalation sent')
      queryClient.invalidateQueries({ queryKey: ['boarding-movements'] })
      onChange()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Card>
      <CardHeader
        title="Boarding movements"
        subtitle="Exits, weekend permissions, medical leave and returns."
        icon={LogOut}
        actions={
          canRecord ? (
            <Button icon={Plus} onClick={() => setOpen(true)}>
              Record movement
            </Button>
          ) : (
            <Badge tone="slate">Read only</Badge>
          )
        }
      />
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 dark:border-[#26374f]">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open (out or overdue)</option>
            <option value="out">Out</option>
            <option value="overdue">Overdue</option>
            <option value="returned">Returned</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All movements</option>
          </Select>
        </Field>
        <Field label="Dormitory">
          <Select value={dormitoryId} onChange={(e) => setDormitoryId(e.target.value)}>
            <option value="">All dormitories</option>
            {dormitories.map((dorm) => (
              <option key={dorm._id} value={dorm._id}>
                {dorm.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {query.isLoading ? (
        <LoadingBlock />
      ) : !query.data?.items.length ? (
        <EmptyState title="No movements match" message="Adjust the filters or record a new movement." icon={LogOut} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-[#26374f] dark:bg-white/5">
              <tr>
                <th className="px-4 py-2.5">Reference</th>
                <th className="px-4 py-2.5">Student</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Destination</th>
                <th className="px-4 py-2.5">Out</th>
                <th className="px-4 py-2.5">Expected back</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-[#26374f]">
              {query.data.items.map((movement) => (
                <tr key={movement._id}>
                  <td className="px-4 py-2.5 font-mono text-xs">{movement.reference}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{fullName(movement.studentId)}</p>
                    <p className="text-xs text-slate-400">{studentRef(movement.studentId)}</p>
                  </td>
                  <td className="px-4 py-2.5">{titleCase(movement.type)}</td>
                  <td className="px-4 py-2.5">{movement.destination}</td>
                  <td className="px-4 py-2.5">{formatDateTime(movement.outAt)}</td>
                  <td className="px-4 py-2.5">{movement.expectedReturnAt ? formatDateTime(movement.expectedReturnAt) : '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={movement.status === 'returned' ? 'emerald' : movement.status === 'overdue' ? 'amber' : movement.status === 'cancelled' ? 'slate' : 'sky'}>
                        {titleCase(movement.status)}
                      </Badge>
                      {movement.missingReportedAt && !movement.resolvedAt ? <Badge tone="red">Missing</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {canRecord && ['out', 'overdue'].includes(movement.status) && (
                        <Button size="sm" variant="secondary" icon={Undo2} onClick={() => returned.mutate(movement._id)}>
                          Return
                        </Button>
                      )}
                      {canEscalate && ['out', 'overdue'].includes(movement.status) && !movement.missingReportedAt && (
                        <Button size="sm" variant="danger" onClick={() => escalate.mutate(movement._id)}>
                          Missing
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record a boarding movement"
        subtitle="The return time drives overdue alerts and missing-student escalation."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button icon={Plus} loading={create.isPending} onClick={() => create.mutate()} disabled={!student || !destination.trim() || reason.trim().length < 3}>
              Save movement
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Student" required>
            <StudentPicker value={student} onChange={setStudent} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" required>
              <Select value={type} onChange={(e) => setType(e.target.value as (typeof MOVEMENT_TYPES)[number])}>
                {MOVEMENT_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {titleCase(item)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Destination" required>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Family home, clinic, activity venue" />
            </Field>
            <Field label="Leaves at" hint="Defaults to now">
              <Input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} />
            </Field>
            <Field label="Expected return">
              <Input type="datetime-local" value={expectedReturnAt} onChange={(e) => setExpectedReturnAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Approved by, purpose, transport arrangements…" />
          </Field>
        </div>
      </Modal>
    </Card>
  )
}

function AllocationsTab({
  canManage,
  canRecord,
  onChange,
  dormitories,
}: {
  canManage: boolean
  canRecord: boolean
  onChange: () => void
  dormitories: { _id: string; name: string; capacity: number }[]
}) {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [dormitoryId, setDormitoryId] = useState('')
  const [open, setOpen] = useState(false)
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [targetDorm, setTargetDorm] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [bedNumber, setBedNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [release, setRelease] = useState<Allocation | null>(null)
  const [releaseReason, setReleaseReason] = useState('')
  const [followUp, setFollowUp] = useState<Allocation | null>(null)
  const [dueDate, setDueDate] = useState(localToday())
  const [followUpNotes, setFollowUpNotes] = useState('')

  const query = useQuery({
    queryKey: ['boarding-allocations', dormitoryId],
    queryFn: () =>
      getPage<Allocation>('/boarding/allocations', {
        dormitoryId: dormitoryId || undefined,
        active: 'true',
        pageSize: 100,
      }),
  })

  const allocate = useMutation({
    mutationFn: () =>
      post('/boarding/allocations', {
        studentId: student?.id,
        dormitoryId: targetDorm,
        roomNumber: roomNumber.trim() || undefined,
        bedNumber: bedNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      success('Student allocated')
      setOpen(false)
      setStudent(null)
      setRoomNumber('')
      setBedNumber('')
      setNotes('')
      queryClient.invalidateQueries({ queryKey: ['boarding-allocations'] })
      onChange()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const released = useMutation({
    mutationFn: () => post(`/boarding/allocations/${release?._id}/release`, { reason: releaseReason.trim() }),
    onSuccess: () => {
      success('Allocation released')
      setRelease(null)
      setReleaseReason('')
      queryClient.invalidateQueries({ queryKey: ['boarding-allocations'] })
      onChange()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const createdFollowUp = useMutation({
    mutationFn: () =>
      post('/boarding/followups', {
        studentId: followUp && typeof followUp.studentId === 'object' ? followUp.studentId._id : undefined,
        dueDate,
        notes: followUpNotes.trim(),
      }),
    onSuccess: () => {
      success('Welfare follow-up created')
      setFollowUp(null)
      setFollowUpNotes('')
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Card>
      <CardHeader
        title="Dormitory allocations"
        subtitle="Bed and room assignments. Reallocating releases the previous bed automatically."
        icon={BedDouble}
        actions={
          canManage ? (
            <Button icon={Plus} onClick={() => setOpen(true)}>
              Allocate student
            </Button>
          ) : (
            <Badge tone="slate">Read only</Badge>
          )
        }
      />
      <div className="border-b border-line p-4 dark:border-[#26374f]">
        <Field label="Dormitory">
          <Select value={dormitoryId} onChange={(e) => setDormitoryId(e.target.value)}>
            <option value="">All dormitories</option>
            {dormitories.map((dorm) => (
              <option key={dorm._id} value={dorm._id}>
                {dorm.name} {dorm.capacity ? `(${dorm.capacity} beds)` : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {query.isLoading ? (
        <LoadingBlock />
      ) : !query.data?.items.length ? (
        <EmptyState title="No active allocations" message="Allocate a boarding student to a dormitory to get started." icon={BedDouble} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-[#26374f] dark:bg-white/5">
              <tr>
                <th className="px-4 py-2.5">Student</th>
                <th className="px-4 py-2.5">Dormitory</th>
                <th className="px-4 py-2.5">Room / bed</th>
                <th className="px-4 py-2.5">Allocated</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-[#26374f]">
              {query.data.items.map((allocation) => (
                <tr key={allocation._id}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{fullName(allocation.studentId)}</p>
                    <p className="text-xs text-slate-400">{studentRef(allocation.studentId)}</p>
                  </td>
                  <td className="px-4 py-2.5">{dormName(allocation.dormitoryId) || '—'}</td>
                  <td className="px-4 py-2.5">
                    {allocation.roomNumber || '—'}
                    {allocation.bedNumber ? ` / bed ${allocation.bedNumber}` : ''}
                  </td>
                  <td className="px-4 py-2.5">{formatDate(allocation.allocatedAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {canRecord && (
                        <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setFollowUp(allocation)}>
                          Follow-up
                        </Button>
                      )}
                      {canManage && (
                        <Button size="sm" variant="secondary" icon={LogOut} onClick={() => setRelease(allocation)}>
                          Release
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Allocate a boarding student"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button icon={BedDouble} loading={allocate.isPending} onClick={() => allocate.mutate()} disabled={!student || !targetDorm}>
              Allocate
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Student" required>
            <StudentPicker value={student} onChange={setStudent} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dormitory" required>
              <Select value={targetDorm} onChange={(e) => setTargetDorm(e.target.value)}>
                <option value="">Select dormitory</option>
                {dormitories.map((dorm) => (
                  <option key={dorm._id} value={dorm._id}>
                    {dorm.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Room">
              <Input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="e.g. B2" />
            </Field>
            <Field label="Bed">
              <Input value={bedNumber} onChange={(e) => setBedNumber(e.target.value)} placeholder="e.g. 4" />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional allocation notes" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(release)}
        onClose={() => setRelease(null)}
        title="Release allocation"
        subtitle={release ? `${fullName(release.studentId)} · ${dormName(release.dormitoryId)}` : ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRelease(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={released.isPending} onClick={() => released.mutate()} disabled={releaseReason.trim().length < 3}>
              Release bed
            </Button>
          </div>
        }
      >
        <Field label="Reason" required>
          <Textarea rows={3} value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} placeholder="Transferred to day school, completed studies, disciplinary relocation…" />
        </Field>
      </Modal>

      <Modal
        open={Boolean(followUp)}
        onClose={() => setFollowUp(null)}
        title="Boarding welfare follow-up"
        subtitle={followUp ? fullName(followUp.studentId) : ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFollowUp(null)}>
              Cancel
            </Button>
            <Button icon={UserRound} loading={createdFollowUp.isPending} onClick={() => createdFollowUp.mutate()} disabled={followUpNotes.trim().length < 3}>
              Create follow-up
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Due date" required>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="What needs checking?" required>
            <Textarea rows={3} value={followUpNotes} onChange={(e) => setFollowUpNotes(e.target.value)} placeholder="Welfare check after weekend leave, room adaptation, guardian concern…" />
          </Field>
        </div>
      </Modal>
    </Card>
  )
}

function MatronReportTab({ enabled }: { enabled: boolean }) {
  const [from, setFrom] = useState(() => {
    const start = new Date()
    start.setDate(start.getDate() - 29)
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(start)
  })
  const [to, setTo] = useState(localToday())
  const { data } = useQuery({
    queryKey: ['boarding-matron', from, to],
    queryFn: () => get<MatronReport>('/boarding/reports/matron', { from, to }),
    enabled,
  })

  if (!enabled) {
    return <Alert tone="warning" title="Report unavailable">Your role does not include boarding reports.</Alert>
  }

  return (
    <Card>
      <CardHeader title="Matron and patron report" subtitle="Movements, missing cases and welfare follow-ups per dormitory." icon={Home} />
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 dark:border-[#26374f]">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {!data?.dormitories.length ? (
        <EmptyState title="No dormitory data" message="Allocate boarders and record movements to populate this report." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-[#26374f] dark:bg-white/5">
              <tr>
                <th className="px-4 py-2.5">Dormitory</th>
                <th className="px-4 py-2.5 text-right">Residents</th>
                <th className="px-4 py-2.5 text-right">Exits</th>
                <th className="px-4 py-2.5 text-right">Returns</th>
                <th className="px-4 py-2.5 text-right">Weekend perms</th>
                <th className="px-4 py-2.5 text-right">Overdue now</th>
                <th className="px-4 py-2.5 text-right">Missing</th>
                <th className="px-4 py-2.5 text-right">Welfare follow-ups</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-[#26374f]">
              {data.dormitories.map((row) => (
                <tr key={row.dormitoryId}>
                  <td className="px-4 py-2.5 font-medium">{row.name}</td>
                  <td className="px-4 py-2.5 text-right">{row.residents}</td>
                  <td className="px-4 py-2.5 text-right">{row.exits}</td>
                  <td className="px-4 py-2.5 text-right">{row.returns}</td>
                  <td className="px-4 py-2.5 text-right">{row.weekendPermissions}</td>
                  <td className="px-4 py-2.5 text-right">{row.overdueNow}</td>
                  <td className="px-4 py-2.5 text-right">{row.missingUnresolved}</td>
                  <td className="px-4 py-2.5 text-right">{row.welfareFollowUps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
