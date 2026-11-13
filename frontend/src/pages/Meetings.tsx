import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CalendarPlus, Clock, MapPin, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, patch, post } from '../lib/api'
import { refName } from '../lib/hooks'
import { formatDateTime, titleCase } from '../lib/utils'
import { StudentPicker, type PickedStudent } from '../components/StudentPicker'
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatusBadge, Textarea } from '../components/ui'
import { useToast } from '../components/toast'

type MeetingRow = {
  _id: string
  reference: string
  title: string
  type: string
  scheduledAt: string
  durationMinutes?: number
  location?: string
  status: string
  confidentiality: string
  studentId?: { fullName?: string; studentId?: string } | string
  createdBy?: { name?: string } | string
  participants?: { name?: string; userId?: { name?: string } }[]
}

type MeetingDetail = MeetingRow & {
  notes?: string
  decisions?: string
  attendance?: { name?: string; userId?: { name?: string } | string; status: string }[]
}

const TYPE_OPTIONS = [
  { value: 'parent', label: 'Parent meeting' },
  { value: 'hearing', label: 'Discipline hearing' },
  { value: 'counselling', label: 'Counselling' },
  { value: 'staff', label: 'Staff meeting' },
  { value: 'safeguarding', label: 'Safeguarding meeting' },
]

export function MeetingsPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [decisions, setDecisions] = useState('')
  const [meetingStatus, setMeetingStatus] = useState('scheduled')
  const [attendance, setAttendance] = useState<{ name?: string; userId?: string; status: string }[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['meetings', status],
    queryFn: () => getPage<MeetingRow>('/meetings', { pageSize: 50, status: status || undefined }),
  })
  const { data: detail } = useQuery({
    queryKey: ['meeting', selectedId],
    queryFn: () => get<MeetingDetail>(`/meetings/${selectedId}`),
    enabled: Boolean(selectedId),
  })

  const applyDetail = (meeting: MeetingDetail) => {
    setNotes(meeting.notes ?? '')
    setDecisions(meeting.decisions ?? '')
    setMeetingStatus(meeting.status)
    setAttendance(
      (meeting.attendance ?? []).map((a) => ({
        name: a.name ?? (typeof a.userId === 'object' ? a.userId?.name : undefined),
        userId: typeof a.userId === 'object' ? (a.userId as { _id?: string })?._id : a.userId,
        status: a.status,
      })),
    )
  }

  const save = useMutation({
    mutationFn: () => patch(`/meetings/${selectedId}`, { notes, decisions, status: meetingStatus }),
    onSuccess: () => {
      success('Meeting record updated')
      queryClient.invalidateQueries({ queryKey: ['meeting'] })
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const saveAttendance = useMutation({
    mutationFn: () => post(`/meetings/${selectedId}/attendance`, { attendance }),
    onSuccess: () => {
      success('Attendance recorded')
      queryClient.invalidateQueries({ queryKey: ['meeting'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const meetings = data?.items ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Coordination"
        title="Meetings"
        subtitle="Parent meetings, hearings, counselling and staff coordination with attendance and minutes."
        actions={
          has('meetings.manage') && (
            <Button icon={CalendarPlus} onClick={() => setCreateOpen(true)}>
              Schedule meeting
            </Button>
          )
        }
      />

      <Card className="p-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-56">
          <option value="">All meetings</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading meetings…" />
      ) : meetings.length ? (
        <div className="space-y-3">
          {meetings.map((m) => (
            <Card key={m._id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                  <CalendarDays className="h-5 w-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-400">{m.reference}</span>
                    <Badge tone="brand">{titleCase(m.type)}</Badge>
                    <StatusBadge status={m.status} />
                    {m.confidentiality === 'restricted' && <Badge tone="amber">Restricted</Badge>}
                  </div>
                  <p className="mt-1 font-medium">{m.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatDateTime(m.scheduledAt)} · {m.durationMinutes ?? 30}m</span>
                    {m.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {m.location}</span>}
                    <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {refName(m.createdBy)}</span>
                  </p>
                  {typeof m.studentId === 'object' && m.studentId?.fullName && <p className="mt-0.5 text-xs text-slate-400">Student: {m.studentId.fullName}</p>}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  setSelectedId(m._id)
                  const meeting = await get<MeetingDetail>(`/meetings/${m._id}`)
                  applyDetail(meeting)
                }}
              >
                Open record
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No meetings scheduled" message="Schedule a parent or care meeting to coordinate support." icon={CalendarDays} />
      )}

      <CreateMeetingModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['meetings'] })} />

      <Modal open={Boolean(selectedId)} onClose={() => setSelectedId(null)} title={detail?.title ?? 'Meeting record'} subtitle={detail ? `${detail.reference} · ${formatDateTime(detail.scheduledAt)}` : undefined} size="lg">
        {!detail ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{titleCase(detail.type)}</Badge>
              <StatusBadge status={detail.status} />
              {detail.confidentiality === 'restricted' && <Badge tone="amber">Restricted notes</Badge>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Scheduled</p>
                <p className="mt-0.5">{formatDateTime(detail.scheduledAt)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Location</p>
                <p className="mt-0.5">{detail.location ?? '—'}</p>
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Attendance</p>
              {attendance.length ? (
                <ul className="mt-2 space-y-2">
                  {attendance.map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span>{a.name ?? 'Participant'}</span>
                      <Select
                        className="h-8 w-32 text-xs"
                        value={a.status}
                        disabled={!has('meetings.manage')}
                        onChange={(e) => setAttendance((list) => list.map((row, idx) => (idx === i ? { ...row, status: e.target.value } : row)))}
                      >
                        <option value="invited">Invited</option>
                        <option value="attended">Attended</option>
                        <option value="absent">Absent</option>
                        <option value="excused">Excused</option>
                      </Select>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-slate-400">No participants recorded.</p>
              )}
              {has('meetings.manage') && attendance.length > 0 && (
                <Button size="sm" variant="secondary" className="mt-2" loading={saveAttendance.isPending} onClick={() => saveAttendance.mutate()}>
                  Save attendance
                </Button>
              )}
            </div>

            {has('meetings.manage') ? (
              <>
                <Field label="Minutes / notes">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[100px]" placeholder="Discussion points, agreements and context…" />
                </Field>
                <Field label="Decisions">
                  <Textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} placeholder="Decisions and follow-up actions…" />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={meetingStatus} onChange={(e) => setMeetingStatus(e.target.value)} className="w-44">
                    <option value="scheduled">Scheduled</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                  <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
                    Save record
                  </Button>
                </div>
              </>
            ) : (
              <>
                {detail.notes && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Minutes</p>
                    <p className="mt-1 whitespace-pre-wrap">{detail.notes}</p>
                  </div>
                )}
                {detail.decisions && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Decisions</p>
                    <p className="mt-1 whitespace-pre-wrap">{detail.decisions}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function CreateMeetingModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [form, setForm] = useState({
    title: '',
    type: 'parent',
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
    durationMinutes: 30,
    location: '',
    confidentiality: 'standard',
    notes: '',
  })

  const create = useMutation({
    mutationFn: () =>
      post('/meetings', {
        title: form.title,
        type: form.type,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        durationMinutes: Number(form.durationMinutes),
        location: form.location || undefined,
        studentId: student?.id || undefined,
        confidentiality: form.confidentiality,
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      success('Meeting scheduled')
      setStudent(null)
      setForm({ ...form, title: '', location: '', notes: '' })
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule a meeting"
      subtitle="A calendar entry is created automatically."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={form.title.trim().length < 3} onClick={() => create.mutate()}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Parent meeting — conduct review" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Meeting type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date & time" required>
            <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
          </Field>
          <Field label="Duration (minutes)">
            <Input type="number" min={10} max={480} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Deputy's office" />
          </Field>
        </div>
        <Field label="Student (optional)">
          <StudentPicker value={student} onChange={setStudent} />
        </Field>
        <Field label="Confidentiality">
          <Select value={form.confidentiality} onChange={(e) => setForm({ ...form, confidentiality: e.target.value })}>
            <option value="standard">Standard</option>
            <option value="restricted">Restricted (leadership and participants)</option>
          </Select>
        </Field>
        <Field label="Agenda / notes">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}
