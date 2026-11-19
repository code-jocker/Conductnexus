import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileWarning,
  RefreshCw,
  Save,
  UserCheck,
  UserX,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, post } from '../lib/api'
import { useStructure } from '../lib/hooks'
import { cn, titleCase } from '../lib/utils'
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
  PageHeader,
  Select,
  StatCard,
  Tabs,
  Toggle,
} from '../components/ui'
import { useToast } from '../components/toast'

type SessionType = 'daily' | 'classroom' | 'dormitory_morning' | 'dormitory_evening'
type Status = 'present' | 'absent' | 'late' | 'excused' | 'sick' | 'permission' | 'suspended'
type TabKey = 'register' | 'reports' | 'corrections'

type RosterStudent = {
  _id: string
  studentId: string
  fullName: string
  gender?: string
  classId?: { name?: string } | string
  dormitoryId?: { name?: string } | string
  roomNumber?: string
  attendance?: { _id: string; status: Status; minutesLate?: number; reason?: string } | null
}

type RosterResponse = {
  date: string
  session: SessionType
  canRecord: boolean
  students: RosterStudent[]
  counts: Record<Status | 'unmarked', number>
}

type Correction = {
  _id: string
  reference: string
  previousStatus: string
  requestedStatus: string
  requestedMinutesLate?: number
  reason: string
  status: string
  createdAt: string
  studentId?: { fullName?: string; studentId?: string }
  requestedBy?: { name?: string } | string
}

type Excuse = {
  _id: string
  reference: string
  fromDate: string
  toDate: string
  category: string
  reason: string
  status: string
  submittedByName: string
  studentId?: { fullName?: string; studentId?: string }
}

type Overview = {
  date: string
  students: number
  totals: Record<Status | 'unmarked', number>
  byClass: Array<{
    classId: string
    name: string
    students: number
    marked: number
    present: number
    absent: number
    late: number
    excused: number
    attendanceRate: number | null
  }>
}

type Trend = { days: number; series: Array<{ date: string; marked: number; absent: number; late: number; attendanceRate: number | null }> }

const SESSIONS: { value: SessionType; label: string }[] = [
  { value: 'daily', label: 'Daily school attendance' },
  { value: 'classroom', label: 'Classroom attendance' },
  { value: 'dormitory_morning', label: 'Dormitory roll call — morning' },
  { value: 'dormitory_evening', label: 'Dormitory roll call — evening' },
]

const STATUS_ORDER: Status[] = ['present', 'late', 'absent', 'excused', 'sick', 'permission', 'suspended']

const STATUS_STYLE: Record<Status, string> = {
  present: 'bg-emerald-600 text-white border-emerald-600',
  late: 'bg-amber-500 text-white border-amber-500',
  absent: 'bg-risk-red text-white border-risk-red',
  excused: 'bg-sky-600 text-white border-sky-600',
  sick: 'bg-violet-600 text-white border-violet-600',
  permission: 'bg-slate-500 text-white border-slate-500',
  suspended: 'bg-slate-700 text-white border-slate-700',
}

function localToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date())
}

function refName(value?: { name?: string } | string) {
  if (!value) return ''
  return typeof value === 'string' ? value : value.name ?? ''
}

export function AttendancePage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('register')
  const [date, setDate] = useState(localToday())
  const [session, setSession] = useState<SessionType>('daily')
  const [classId, setClassId] = useState('')
  const [dormitoryId, setDormitoryId] = useState('')
  const [notifyParents, setNotifyParents] = useState(true)
  const [marks, setMarks] = useState<Record<string, { status: Status; minutesLate?: number; reason?: string }>>({})
  const { data: structure } = useStructure()
  const dormSession = session.startsWith('dormitory')
  // The API decides recordability per scope: an unassigned teacher can browse
  // registers but must be handed a class before saving marks.
  const canApprove = has('attendance.correct.approve')
  const canReviewExcuse = has('attendance.excuse.review')

  const rosterQuery = useQuery({
    queryKey: ['attendance-roster', date, session, classId, dormitoryId],
    queryFn: () =>
      get<RosterResponse>('/attendance/roster', {
        date,
        session,
        classId: classId || undefined,
        dormitoryId: dormitoryId || undefined,
      }),
    enabled: tab === 'register',
  })
  // Recordability is decided by the API for the loaded scope.
  const canRecord = has('attendance.record') && (rosterQuery.data?.canRecord ?? false)

  useEffect(() => {
    const students = rosterQuery.data?.students ?? []
    const next: Record<string, { status: Status; minutesLate?: number; reason?: string }> = {}
    for (const student of students) {
      if (student.attendance) {
        next[student._id] = {
          status: student.attendance.status,
          minutesLate: student.attendance.minutesLate,
          reason: student.attendance.reason,
        }
      } else {
        next[student._id] = { status: 'present' }
      }
    }
    setMarks(next)
  }, [rosterQuery.data])

  const markAll = (status: Status) => {
    const next: Record<string, { status: Status }> = {}
    for (const student of rosterQuery.data?.students ?? []) next[student._id] = { status }
    setMarks(next)
  }

  const save = useMutation({
    mutationFn: () =>
      post('/attendance/mark', {
        date,
        session,
        classId: classId || undefined,
        dormitoryId: dormitoryId || undefined,
        notifyParents,
        entries: Object.entries(marks).map(([studentId, mark]) => ({
          studentId,
          status: mark.status,
          minutesLate: mark.minutesLate,
          reason: mark.reason,
        })),
      }),
    onSuccess: () => {
      success('Register saved')
      queryClient.invalidateQueries({ queryKey: ['attendance-roster'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-overview'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const decided = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      post(`/attendance/corrections/${id}/decide`, { decision, note }),
    onSuccess: () => {
      success('Correction decision recorded')
      queryClient.invalidateQueries({ queryKey: ['attendance-corrections'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-roster'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const reviewedExcuse = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      post(`/attendance/excuses/${id}/review`, { decision, note }),
    onSuccess: () => {
      success('Excuse reviewed')
      queryClient.invalidateQueries({ queryKey: ['attendance-excuses'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-roster'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const { data: corrections } = useQuery({
    queryKey: ['attendance-corrections'],
    queryFn: () => getPage<Correction>('/attendance/corrections', { status: 'pending', pageSize: 50 }),
    enabled: tab === 'corrections',
  })
  const { data: excuses } = useQuery({
    queryKey: ['attendance-excuses'],
    queryFn: () => getPage<Excuse>('/attendance/excuses', { status: 'pending', pageSize: 50 }),
    enabled: tab === 'corrections',
  })

  const counts = rosterQuery.data?.counts
  const roster = rosterQuery.data?.students ?? []
  const summary = useMemo(() => {
    const values = Object.values(marks)
    const map: Record<string, number> = {}
    for (const mark of values) map[mark.status] = (map[mark.status] ?? 0) + 1
    return map
  }, [marks])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Student welfare"
        title="Attendance"
        subtitle="Registers for the school day, classrooms and dormitory roll calls. Attendance is tracked separately and never deducts conduct marks."
        actions={
          <Button variant="secondary" icon={RefreshCw} onClick={() => rosterQuery.refetch()} loading={rosterQuery.isFetching}>
            Refresh
          </Button>
        }
      />

      <Tabs
        tabs={[
          { key: 'register', label: 'Register', count: roster.length },
          { key: 'reports', label: 'Reports' },
          {
            key: 'corrections',
            label: 'Corrections & excuses',
            count: (corrections?.meta.total ?? 0) + (excuses?.meta.total ?? 0),
          },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'register' && (
        <Card>
          <CardHeader
            title="Mark the register"
            subtitle="One line per student per day and session. Re-saving updates the same records."
            icon={ClipboardCheck}
            actions={
              canRecord ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => markAll('present')}>
                    All present
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => markAll('absent')}>
                    All absent
                  </Button>
                  <Button icon={Save} loading={save.isPending} onClick={() => save.mutate()} disabled={!roster.length}>
                    Save register
                  </Button>
                </div>
              ) : (
                <Badge tone="slate">Read only</Badge>
              )
            }
          />
          <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-[#26374f]">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Session">
              <Select value={session} onChange={(e) => setSession(e.target.value as SessionType)}>
                {SESSIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Class">
              <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">All classes</option>
                {(structure?.classes ?? []).map((cls) => (
                  <option key={cls._id} value={cls._id}>
                    {cls.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dormitory" hint={dormSession ? 'Required for roll calls' : 'Optional'}>
              <Select value={dormitoryId} onChange={(e) => setDormitoryId(e.target.value)}>
                <option value="">All dormitories</option>
                {(structure?.dormitories ?? []).map((dorm) => (
                  <option key={dorm._id} value={dorm._id}>
                    {dorm.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Parent alerts" hint="Absent or late only">
              <div className="pt-2">
                <Toggle checked={notifyParents} onChange={setNotifyParents} label="Notify guardians" />
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3 dark:border-[#26374f]">
            {counts &&
              (Object.keys(counts) as Array<Status | 'unmarked'>).map((key) =>
                counts[key] > 0 ? (
                  <Badge key={key} tone={key === 'absent' ? 'red' : key === 'late' ? 'amber' : key === 'present' ? 'emerald' : 'slate'}>
                    {titleCase(key)}: {counts[key]}
                  </Badge>
                ) : null,
              )}
            <Badge tone="brand">In this save: {Object.keys(marks).length}</Badge>
          </div>

          {rosterQuery.isLoading ? (
            <LoadingBlock label="Loading students…" />
          ) : roster.length === 0 ? (
            <EmptyState
              icon={CalendarCheck2}
              title="No students in this register"
              message={dormSession ? 'Select a dormitory to run a roll call.' : 'Choose a class or adjust the filters.'}
            />
          ) : (
            <div className="divide-y divide-line dark:divide-[#26374f]">
              {roster.map((student) => {
                const mark = marks[student._id] ?? { status: 'present' as Status }
                return (
                  <div key={student._id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {student.fullName} <span className="text-xs text-slate-400">{student.studentId}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {refName(student.classId) || 'No class'}
                        {refName(student.dormitoryId) ? ` · ${refName(student.dormitoryId)}${student.roomNumber ? ` / ${student.roomNumber}` : ''}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {STATUS_ORDER.map((status) => (
                        <button
                          key={status}
                          type="button"
                          disabled={!canRecord}
                          onClick={() =>
                            setMarks((current) => ({
                              ...current,
                              [student._id]: {
                                ...current[student._id],
                                status,
                                minutesLate: status === 'late' ? current[student._id]?.minutesLate ?? 10 : undefined,
                              },
                            }))
                          }
                          className={cn(
                            'rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition',
                            mark.status === status
                              ? STATUS_STYLE[status]
                              : 'border-line bg-white text-slate-500 hover:border-brand-300 hover:text-brand-700 dark:border-[#26374f] dark:bg-[#0b1524] dark:text-slate-400',
                          )}
                        >
                          {status === 'permission' ? 'Perm.' : status === 'suspended' ? 'Susp.' : titleCase(status)}
                        </button>
                      ))}
                      {mark.status === 'late' && (
                        <Input
                          type="number"
                          min={0}
                          max={1440}
                          value={mark.minutesLate ?? 0}
                          onChange={(e) =>
                            setMarks((current) => ({
                              ...current,
                              [student._id]: { ...current[student._id], status: 'late', minutesLate: Number(e.target.value) },
                            }))
                          }
                          className="w-20"
                          aria-label="Minutes late"
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {canRecord && roster.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 dark:border-[#26374f]">
              <p className="text-xs text-slate-500">
                {STATUS_ORDER.filter((s) => summary[s]).map((s) => `${titleCase(s)} ${summary[s]}`).join(' · ') || 'No marks selected'}
              </p>
              <Button icon={Save} loading={save.isPending} onClick={() => save.mutate()}>
                Save register
              </Button>
            </div>
          )}
        </Card>
      )}

      {tab === 'reports' && <AttendanceReports />}

      {tab === 'corrections' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Correction requests" subtitle="Requires approval before the register changes." icon={FileWarning} />
            {!corrections?.items.length ? (
              <EmptyState icon={CheckCircle2} title="No pending corrections" message="Corrections submitted by staff appear here." />
            ) : (
              <div className="divide-y divide-line dark:divide-[#26374f]">
                {corrections.items.map((item) => (
                  <div key={item._id} className="space-y-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {item.studentId?.fullName ?? 'Student'}{' '}
                        <span className="text-xs text-slate-400">{item.studentId?.studentId}</span>
                      </p>
                      <Badge tone="amber">{item.reference}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      {titleCase(item.previousStatus)} → {titleCase(item.requestedStatus)}
                      {item.requestedStatus === 'late' && item.requestedMinutesLate ? ` (${item.requestedMinutesLate} min)` : ''}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{item.reason}</p>
                    <p className="text-xs text-slate-400">Requested by {refName(item.requestedBy) || 'staff'}</p>
                    {canApprove && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          loading={decided.isPending}
                          onClick={() => decided.mutate({ id: item._id, decision: 'approve', note: 'Approved in the attendance workspace' })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => decided.mutate({ id: item._id, decision: 'reject', note: 'Rejected in the attendance workspace' })}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Absence excuses" subtitle="Approved excuses mark matching absences as excused." icon={Clock} />
            {!excuses?.items.length ? (
              <EmptyState icon={CheckCircle2} title="No pending excuses" message="Guardian or staff excuses await review here." />
            ) : (
              <div className="divide-y divide-line dark:divide-[#26374f]">
                {excuses.items.map((item) => (
                  <div key={item._id} className="space-y-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {item.studentId?.fullName ?? 'Student'}{' '}
                        <span className="text-xs text-slate-400">{item.studentId?.studentId}</span>
                      </p>
                      <Badge tone="sky">{item.reference}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      {item.fromDate} → {item.toDate} · {titleCase(item.category)}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{item.reason}</p>
                    <p className="text-xs text-slate-400">Submitted by {item.submittedByName}</p>
                    {canReviewExcuse && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          loading={reviewedExcuse.isPending}
                          onClick={() => reviewedExcuse.mutate({ id: item._id, decision: 'approve', note: 'Excuse verified' })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => reviewedExcuse.mutate({ id: item._id, decision: 'reject', note: 'Excuse not accepted' })}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

function AttendanceReports() {
  const { has } = useAuth()
  const enabled = has('attendance.reports')
  const today = localToday()
  const { data: overview } = useQuery({
    queryKey: ['attendance-overview', today],
    queryFn: () => get<Overview>('/attendance/overview', { date: today, session: 'daily' }),
    enabled,
  })
  const { data: trend } = useQuery({
    queryKey: ['attendance-trend'],
    queryFn: () => get<Trend>('/attendance/trend', { days: 14, session: 'daily' }),
    enabled,
  })
  const { data: classes } = useQuery({
    queryKey: ['attendance-classes'],
    queryFn: () =>
      get<Array<{ classId: string; name: string; marked: number; present: number; absent: number; late: number; attendanceRate: number | null }>>(
        '/attendance/reports/classes',
        { session: 'daily' },
      ),
    enabled,
  })

  if (!enabled) {
    return <Alert tone="warning" title="Reports unavailable">Your role does not include attendance reporting.</Alert>
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Students" value={overview?.students ?? '—'} icon={UserCheck} tone="brand" />
        <StatCard label="Present today" value={overview?.totals.present ?? '—'} icon={CheckCircle2} tone="emerald" />
        <StatCard label="Absent today" value={overview?.totals.absent ?? '—'} icon={UserX} tone="red" />
        <StatCard label="Unmarked" value={overview?.totals.unmarked ?? '—'} icon={Clock} tone="amber" />
      </div>

      <Card>
        <CardHeader title="Attendance trend" subtitle="Daily school attendance over the last 14 days." icon={CalendarCheck2} />
        <div className="space-y-2 p-4">
          {(trend?.series ?? []).map((row) => (
            <div key={row.date} className="grid grid-cols-[110px_1fr_60px] items-center gap-3 text-xs">
              <span className="text-slate-500">{row.date}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div
                  className={cn(
                    'h-full rounded-full',
                    (row.attendanceRate ?? 0) >= 90 ? 'bg-emerald-500' : (row.attendanceRate ?? 0) >= 75 ? 'bg-amber-500' : 'bg-risk-red',
                  )}
                  style={{ width: `${row.attendanceRate ?? 0}%` }}
                />
              </div>
              <span className="text-right font-medium">{row.attendanceRate == null ? '—' : `${row.attendanceRate}%`}</span>
            </div>
          ))}
          {!trend?.series.length && <p className="text-sm text-slate-400">No attendance has been recorded yet.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Class comparison" subtitle="Attendance rate for the current term, based on recorded registers." icon={UserCheck} />
        {!classes?.length ? (
          <EmptyState title="No class data yet" message="Mark a register to populate this comparison." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-[#26374f] dark:bg-white/5">
                <tr>
                  <th className="px-4 py-2.5">Class</th>
                  <th className="px-4 py-2.5 text-right">Marked</th>
                  <th className="px-4 py-2.5 text-right">Present</th>
                  <th className="px-4 py-2.5 text-right">Absent</th>
                  <th className="px-4 py-2.5 text-right">Late</th>
                  <th className="px-4 py-2.5 text-right">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#26374f]">
                {classes.map((row) => (
                  <tr key={row.classId || row.name}>
                    <td className="px-4 py-2.5 font-medium">{row.name}</td>
                    <td className="px-4 py-2.5 text-right">{row.marked}</td>
                    <td className="px-4 py-2.5 text-right">{row.present}</td>
                    <td className="px-4 py-2.5 text-right">{row.absent}</td>
                    <td className="px-4 py-2.5 text-right">{row.late}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{row.attendanceRate == null ? '—' : `${row.attendanceRate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
