import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BedDouble, CalendarRange, CheckCircle2, GraduationCap, Layers, Lock, Plus, School } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, patch, post } from '../lib/api'
import { formatDate, titleCase } from '../lib/utils'
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
  StatusBadge,
  Tabs,
  Toggle,
} from '../components/ui'
import { useToast } from '../components/toast'

type TermRow = {
  _id: string
  name: string
  number: number
  startDate: string
  endDate: string
  startingMarks: number
  isActive: boolean
  closedAt?: string
  closedSummary?: { averageBalance?: number; students?: number }
}

type YearRow = {
  id: string
  _id?: string
  name: string
  startDate: string
  endDate: string
  isActive: boolean
  status: string
  terms: TermRow[]
}

type ClassRow = { id: string; _id?: string; name: string; level: string; streamId?: { _id?: string; name?: string } | string | null; order?: number; active: boolean; studentCount?: number }
type StreamRow = { _id: string; name: string; code: string; level: string; description?: string; active: boolean }
type DormRow = { id: string; _id?: string; name: string; code: string; gender: string; capacity: number; active: boolean; occupants?: number }

type TabKey = 'calendar' | 'classes' | 'dormitories'

const iso = (d: Date) => d.toISOString().slice(0, 10)

export function StructurePage() {
  const { has } = useAuth()
  const [tab, setTab] = useState<TabKey>('calendar')

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="School structure"
        subtitle="Academic years, terms, classes, streams and dormitories. Everything here can be maintained without a developer."
      />

      <Tabs<TabKey>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'calendar', label: 'Academic calendar' },
          { key: 'classes', label: 'Classes & streams' },
          { key: 'dormitories', label: 'Dormitories' },
        ]}
      />

      {tab === 'calendar' && <CalendarTab canManageYears={has('academic_years.manage')} canManageTerms={has('terms.manage')} />}
      {tab === 'classes' && <ClassesTab canManage={has('classes.manage')} />}
      {tab === 'dormitories' && <DormitoriesTab canManage={has('dormitories.manage')} />}
    </div>
  )
}

function CalendarTab({ canManageYears, canManageTerms }: { canManageYears: boolean; canManageTerms: boolean }) {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [yearModal, setYearModal] = useState(false)
  const [termForYear, setTermForYear] = useState<YearRow | null>(null)

  const { data: years, isLoading } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => get<YearRow[]>('/academic-years'),
  })

  const activateYear = useMutation({
    mutationFn: (id: string) => post(`/academic-years/${id}/activate`),
    onSuccess: () => {
      success('Academic year activated')
      queryClient.invalidateQueries({ queryKey: ['academic-years'] })
      queryClient.invalidateQueries({ queryKey: ['structure-options'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const activateTerm = useMutation({
    mutationFn: (id: string) => post<{ allocatedStudents: number }>(`/terms/${id}/activate`),
    onSuccess: (result) => {
      success(`Term activated — conduct marks allocated for ${result.allocatedStudents} student${result.allocatedStudents === 1 ? '' : 's'}`)
      queryClient.invalidateQueries({ queryKey: ['academic-years'] })
      queryClient.invalidateQueries({ queryKey: ['structure-options'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const closeTerm = useMutation({
    mutationFn: (id: string) => post(`/terms/${id}/close`),
    onSuccess: () => {
      success('Term closed and archived with a summary')
      queryClient.invalidateQueries({ queryKey: ['academic-years'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const rows = years ?? []
  const activeYear = rows.find((y) => y.isActive)

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-200">
            <CalendarRange className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">{activeYear ? `${activeYear.name} is active` : 'No active academic year'}</p>
            <p className="text-xs text-slate-500">Activating a term allocates fresh conduct marks to every learner.</p>
          </div>
        </div>
        {canManageYears && <Button icon={Plus} onClick={() => setYearModal(true)}>New academic year</Button>}
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading academic calendar…" />
      ) : rows.length ? (
        <div className="space-y-4">
          {rows.map((year) => (
            <Card key={year.id}>
              <CardHeader
                icon={School}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {year.name}
                    <StatusBadge status={year.status} />
                    {year.isActive && <Badge tone="emerald">Active</Badge>}
                  </span>
                }
                subtitle={`${formatDate(year.startDate)} — ${formatDate(year.endDate)}`}
                actions={
                  canManageYears &&
                  !year.isActive &&
                  year.status !== 'closed' && (
                    <Button size="sm" variant="secondary" onClick={() => activateYear.mutate(year.id)}>
                      Set active
                    </Button>
                  )
                }
              />
              {year.terms?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Term</th>
                        <th className="px-4 py-2.5">Period</th>
                        <th className="px-4 py-2.5">Starting marks</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                      {year.terms.map((term) => (
                        <tr key={term._id}>
                          <td className="px-4 py-3 font-medium">{term.name}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{formatDate(term.startDate)} — {formatDate(term.endDate)}</td>
                          <td className="px-4 py-3">{term.startingMarks}</td>
                          <td className="px-4 py-3">
                            {term.closedAt ? <Badge tone="slate">Closed {formatDate(term.closedAt)}</Badge> : term.isActive ? <StatusBadge status="active" /> : <StatusBadge status="planned" />}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canManageTerms && !term.closedAt && !term.isActive && (
                              <Button size="sm" variant="secondary" icon={CheckCircle2} className="mr-1" onClick={() => activateTerm.mutate(term._id)}>Activate</Button>
                            )}
                            {canManageTerms && term.isActive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={Lock}
                                onClick={() => {
                                  if (window.confirm(`Close ${term.name}? Marks are archived and the term becomes read-only.`)) closeTerm.mutate(term._id)
                                }}
                              >
                                Close term
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No terms" message="Add Term 1, 2 and 3 so conduct marks can be allocated." />
              )}
              {canManageTerms && year.status !== 'closed' && (
                <div className="border-t border-line px-4 py-3 dark:border-[#1f2f49]">
                  <Button size="sm" variant="secondary" icon={Plus} onClick={() => setTermForYear(year)}>Add term</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={CalendarRange} title="No academic year yet" message="Create the current academic year to unlock terms, allocations and reports." />
      )}

      {yearModal && <YearModal open onClose={() => setYearModal(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['academic-years'] })} />}
      {termForYear && (
        <TermModal
          open
          year={termForYear}
          onClose={() => setTermForYear(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['academic-years'] })
            queryClient.invalidateQueries({ queryKey: ['structure-options'] })
          }}
        />
      )}
    </div>
  )
}

function YearModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const now = new Date()
  const [form, setForm] = useState({
    name: `${now.getFullYear()}–${now.getFullYear() + 1}`,
    startDate: iso(new Date(now.getFullYear(), 8, 1)),
    endDate: iso(new Date(now.getFullYear() + 1, 6, 15)),
    createTerms: true,
  })

  const create = useMutation({
    mutationFn: () => {
      const start = new Date(form.startDate)
      const end = new Date(form.endDate)
      const third = Math.round((end.getTime() - start.getTime()) / 3)
      const boundary = (i: number) => new Date(start.getTime() + third * i)
      const terms = form.createTerms
        ? [1, 2, 3].map((n) => ({
            name: `Term ${n}`,
            number: n,
            startDate: iso(n === 1 ? start : new Date(boundary(n - 1).getTime() + 86_400_000)),
            endDate: iso(n === 3 ? end : boundary(n)),
            startingMarks: 40,
          }))
        : undefined
      return post('/academic-years', { name: form.name, startDate: form.startDate, endDate: form.endDate, terms })
    },
    onSuccess: () => {
      success('Academic year created')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New academic year"
      subtitle="Rwandan school years usually run from September to July."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={form.name.trim().length < 4} onClick={() => create.mutate()}>Create year</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Year name" required hint="Example: 2025–2026">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date" required>
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="End date" required>
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
          <Toggle checked={form.createTerms} onChange={(v) => setForm({ ...form, createTerms: v })} label="Create three terms" />
          <div>
            <p className="text-sm font-medium">Create Term 1, 2 and 3</p>
            <p className="text-xs text-slate-500">They can be adjusted later. Conduct starts at 40 marks each term.</p>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function TermModal({ open, year, onClose, onSaved }: { open: boolean; year: YearRow; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const nextNumber = Math.min(4, (year.terms?.reduce((m, t) => Math.max(m, t.number), 0) ?? 0) + 1)
  const [form, setForm] = useState({
    name: `Term ${nextNumber}`,
    number: nextNumber,
    startDate: iso(new Date()),
    endDate: iso(new Date(Date.now() + 90 * 86_400_000)),
    startingMarks: 40,
  })

  const create = useMutation({
    mutationFn: () => post('/terms', { ...form, academicYearId: year.id }),
    onSuccess: () => {
      success('Term added')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add a term to ${year.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>Add term</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Term name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Term number">
            <Select value={form.number} onChange={(e) => setForm({ ...form, number: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Term {n}</option>)}
            </Select>
          </Field>
          <Field label="Start date" required>
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="End date" required>
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Starting conduct marks" hint="Every learner starts each term with these marks.">
          <Input type="number" min={0} max={100} value={form.startingMarks} onChange={(e) => setForm({ ...form, startingMarks: Number(e.target.value) })} />
        </Field>
      </div>
    </Modal>
  )
}

function ClassesTab({ canManage }: { canManage: boolean }) {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [classModal, setClassModal] = useState(false)
  const [streamModal, setStreamModal] = useState(false)

  const { data: classes, isLoading } = useQuery({ queryKey: ['classes-full'], queryFn: () => get<ClassRow[]>('/classes') })
  const { data: streams } = useQuery({ queryKey: ['streams-full'], queryFn: () => get<StreamRow[]>('/streams') })

  const toggleClass = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => patch(`/classes/${id}`, { active }),
    onSuccess: () => {
      success('Class updated')
      queryClient.invalidateQueries({ queryKey: ['classes-full'] })
      queryClient.invalidateQueries({ queryKey: ['structure-options'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  const toggleStream = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => patch(`/streams/${id}`, { active }),
    onSuccess: () => {
      success('Stream updated')
      queryClient.invalidateQueries({ queryKey: ['streams-full'] })
      queryClient.invalidateQueries({ queryKey: ['structure-options'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={Layers}
          title="Streams"
          subtitle="Science, arts and other combinations offered by the school"
          actions={canManage && <Button size="sm" icon={Plus} onClick={() => setStreamModal(true)}>Add stream</Button>}
        />
        <div className="flex flex-wrap gap-2 p-4">
          {(streams ?? []).map((s) => (
            <span key={s._id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm dark:border-[#1f2f49]">
              <Badge tone="brand">{s.code}</Badge>
              {s.name}
              <Badge tone={s.active ? 'emerald' : 'slate'}>{s.level}</Badge>
              {canManage && (
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-slate-600"
                  onClick={() => toggleStream.mutate({ id: s._id, active: !s.active })}
                >
                  {s.active ? 'Disable' : 'Enable'}
                </button>
              )}
            </span>
          ))}
          {!streams?.length && <p className="text-sm text-slate-500">No streams configured yet.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={GraduationCap}
          title="Classes"
          subtitle="Senior 1 to Senior 6 and their streams"
          actions={canManage && <Button size="sm" icon={Plus} onClick={() => setClassModal(true)}>Add class</Button>}
        />
        {isLoading ? (
          <LoadingBlock />
        ) : classes?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Class</th>
                  <th className="px-4 py-2.5">Level</th>
                  <th className="px-4 py-2.5">Stream</th>
                  <th className="px-4 py-2.5">Learners</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {classes.map((cls) => (
                  <tr key={cls.id}>
                    <td className="px-4 py-3 font-medium">{cls.name}</td>
                    <td className="px-4 py-3"><Badge tone="brand">{cls.level === 'O' ? 'Ordinary level' : 'Advanced level'}</Badge></td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{typeof cls.streamId === 'object' ? cls.streamId?.name ?? '—' : '—'}</td>
                    <td className="px-4 py-3">{cls.studentCount ?? 0}</td>
                    <td className="px-4 py-3"><StatusBadge status={cls.active ? 'active' : 'inactive'} /></td>
                    <td className="px-4 py-3 text-right">
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={() => toggleClass.mutate({ id: cls.id, active: !cls.active })}>
                          {cls.active ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={GraduationCap} title="No classes" message="Create classes such as Senior 1 A or Senior 4 Science." />
        )}
      </Card>

      {classModal && <ClassModal open onClose={() => setClassModal(false)} streams={streams ?? []} onSaved={() => { queryClient.invalidateQueries({ queryKey: ['classes-full'] }); queryClient.invalidateQueries({ queryKey: ['structure-options'] }) }} />}
      {streamModal && <StreamModal open onClose={() => setStreamModal(false)} onSaved={() => { queryClient.invalidateQueries({ queryKey: ['streams-full'] }); queryClient.invalidateQueries({ queryKey: ['structure-options'] }) }} />}
    </div>
  )
}

function ClassModal({ open, onClose, streams, onSaved }: { open: boolean; onClose: () => void; streams: StreamRow[]; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [form, setForm] = useState({ name: '', level: 'O', streamId: '', order: 0 })

  const create = useMutation({
    mutationFn: () => post('/classes', { ...form, streamId: form.streamId || null, order: Number(form.order) }),
    onSuccess: () => {
      success('Class created')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const options = streams.filter((s) => s.level === form.level)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a class"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!form.name.trim()} onClick={() => create.mutate()}>Create class</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Class name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Senior 1 A" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Level">
            <Select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value, streamId: '' })}>
              <option value="O">Ordinary level (S1–S3)</option>
              <option value="A">Advanced level (S4–S6)</option>
            </Select>
          </Field>
          <Field label="Stream (optional)" hint="Must match the class level.">
            <Select value={form.streamId} onChange={(e) => setForm({ ...form, streamId: e.target.value })}>
              <option value="">No stream</option>
              {options.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Display order">
          <Input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} />
        </Field>
      </div>
    </Modal>
  )
}

function StreamModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [form, setForm] = useState({ name: '', code: '', level: 'A', description: '' })

  const create = useMutation({
    mutationFn: () => post('/streams', form),
    onSuccess: () => {
      success('Stream created')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a stream"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={form.name.trim().length < 2 || form.code.trim().length < 2} onClick={() => create.mutate()}>Create stream</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stream name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Science" />
          </Field>
          <Field label="Code" required>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SCI" />
          </Field>
        </div>
        <Field label="Level">
          <Select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
            <option value="A">Advanced level</option>
            <option value="O">Ordinary level</option>
          </Select>
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

function DormitoriesTab({ canManage }: { canManage: boolean }) {
  const { error: toastError } = useToast()
  const { success } = useToast()
  const queryClient = useQueryClient()
  const [modal, setModal] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['dormitories-full'], queryFn: () => get<DormRow[]>('/dormitories') })

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => patch(`/dormitories/${id}`, { active }),
    onSuccess: () => {
      success('Dormitory updated')
      queryClient.invalidateQueries({ queryKey: ['dormitories-full'] })
      queryClient.invalidateQueries({ queryKey: ['structure-options'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">Boarding houses</p>
          <p className="text-xs text-slate-500">Occupancy is calculated from active learners assigned to each dormitory.</p>
        </div>
        {canManage && <Button icon={Plus} onClick={() => setModal(true)}>Add dormitory</Button>}
      </Card>

      {isLoading ? (
        <LoadingBlock />
      ) : data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((dorm) => {
            const occupancy = dorm.occupants ?? 0
            const pct = dorm.capacity ? Math.min(100, Math.round((occupancy / dorm.capacity) * 100)) : 0
            return (
              <Card key={dorm.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-ochre-500/10 text-ochre-600 dark:text-ochre-400"><BedDouble className="h-5 w-5" /></span>
                    <div>
                      <p className="font-medium">{dorm.name}</p>
                      <p className="text-xs text-slate-400">{dorm.code} · {titleCase(dorm.gender)}</p>
                    </div>
                  </div>
                  <StatusBadge status={dorm.active ? 'active' : 'inactive'} />
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{occupancy} occupants</span>
                    <span>{dorm.capacity ? `${dorm.capacity} capacity` : 'No capacity set'}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                    <div className={`h-full rounded-full ${pct >= 95 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                {canManage && (
                  <Button size="sm" variant="ghost" className="mt-3" onClick={() => toggle.mutate({ id: dorm.id, active: !dorm.active })}>
                    {dorm.active ? 'Disable' : 'Enable'}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      ) : (
        <EmptyState icon={BedDouble} title="No dormitories" message="Add boarding houses and their capacity to manage occupancy." />
      )}

      {modal && <DormModal open onClose={() => setModal(false)} onSaved={() => { queryClient.invalidateQueries({ queryKey: ['dormitories-full'] }); queryClient.invalidateQueries({ queryKey: ['structure-options'] }) }} />}

      <Alert tone="info">
        Assign learners to a dormitory from the student register. Matrons and patrons only see the dormitories assigned to them.
      </Alert>
    </div>
  )
}

function DormModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [form, setForm] = useState({ name: '', code: '', gender: 'female', capacity: 60 })

  const create = useMutation({
    mutationFn: () => post('/dormitories', form),
    onSuccess: () => {
      success('Dormitory added')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a dormitory"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={form.name.trim().length < 2 || !form.code.trim()} onClick={() => create.mutate()}>Add dormitory</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kigali House" />
          </Field>
          <Field label="Code" required>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="KGL" />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="mixed">Mixed</option>
            </Select>
          </Field>
          <Field label="Capacity">
            <Input type="number" min={0} max={1000} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
