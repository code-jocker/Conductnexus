import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Search, Upload, UserRound, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, downloadFile, getPage, post } from '../lib/api'
import type { PaginationMeta, Student } from '../lib/types'
import { useDebounced, useStructure } from '../lib/hooks'
import { formatDate, titleCase } from '../lib/utils'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  RiskBadge,
  SearchInput,
  Select,
  StatusBadge,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  otherNames: '',
  gender: 'male',
  dateOfBirth: '',
  classId: '',
  streamId: '',
  dormitoryId: '',
  studentId: '',
  admissionNumber: '',
  notes: '',
  guardianName: '',
  guardianRelationship: 'Guardian',
  guardianPhone: '',
  guardianEmail: '',
  guardianWhatsapp: false,
  guardianSms: true,
}

type Form = typeof EMPTY_FORM

export function StudentsPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const { data: structure } = useStructure()
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const [classId, setClassId] = useState('')
  const [risk, setRisk] = useState('')
  const [status, setStatus] = useState('active')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [addGuardian, setAddGuardian] = useState(true)

  const { data, isLoading } = useQuery({
    queryKey: ['students', search, classId, risk, status, page],
    queryFn: async () => {
      const result = await getPage<Student>('/students', {
        page,
        pageSize: 20,
        q: search || undefined,
        classId: classId || undefined,
        risk: risk || undefined,
        status: status || undefined,
      })
      return result
    },
  })

  const students = data?.items ?? []
  const meta = (data?.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 1 }) as PaginationMeta

  const filteredStreams = useMemo(
    () => (structure?.streams ?? []).filter((s) => !form.classId || s.level === structure?.classes.find((c) => c._id === form.classId)?.level),
    [structure, form.classId],
  )

  const createMutation = useMutation({
    mutationFn: () =>
      post('/students', {
        firstName: form.firstName,
        lastName: form.lastName,
        otherNames: form.otherNames || undefined,
        gender: form.gender,
        dateOfBirth: form.dateOfBirth || undefined,
        classId: form.classId,
        streamId: form.streamId || undefined,
        dormitoryId: form.dormitoryId || undefined,
        studentId: form.studentId || undefined,
        admissionNumber: form.admissionNumber || undefined,
        notes: form.notes || undefined,
        parent: addGuardian
          ? {
              name: form.guardianName,
              relationship: form.guardianRelationship,
              phone: form.guardianPhone,
              email: form.guardianEmail || undefined,
              whatsappConsent: form.guardianWhatsapp,
              smsConsent: form.guardianSms,
              emailConsent: Boolean(form.guardianEmail),
              preferredChannel: form.guardianWhatsapp ? 'whatsapp' : form.guardianSms ? 'sms' : 'email',
            }
          : undefined,
      }),
    onSuccess: () => {
      success('Student registered and conduct ledger opened at the term starting marks.')
      setOpen(false)
      setForm(EMPTY_FORM)
      queryClient.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function exportCsv() {
    try {
      await downloadFile('/students/export', `conductnexus-students-${new Date().toISOString().slice(0, 10)}.csv`)
      success('Student register exported')
    } catch (err) {
      toastError(apiError(err))
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Student register"
        title="Students"
        subtitle="Conduct balances, risk bands and placements for every learner on roll."
        actions={
          <>
            {has('students.export') && (
              <Button variant="secondary" icon={Download} onClick={exportCsv}>
                Export
              </Button>
            )}
            {has('students.create') && (
              <Button icon={Plus} onClick={() => setOpen(true)}>
                Register student
              </Button>
            )}
          </>
        }
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search name, student ID or admission number…" className="flex-1" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:w-[520px]">
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); setPage(1) }}>
              <option value="">All classes</option>
              {structure?.classes.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={risk} onChange={(e) => { setRisk(e.target.value); setPage(1) }}>
              <option value="">All risk levels</option>
              <option value="green">Green</option>
              <option value="yellow">Yellow</option>
              <option value="orange">Orange</option>
              <option value="red">Red</option>
            </Select>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="transferred">Transferred</option>
              <option value="graduated">Graduated</option>
              <option value="expelled">Expelled</option>
              <option value="">All statuses</option>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3 text-xs text-slate-500 dark:border-[#26374f]">
          <span>
            <span className="font-semibold text-ink dark:text-slate-100">{meta.total}</span> students
          </span>
          <span className="hidden sm:inline">Conduct is held per term and adjusted only through approved transactions.</span>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        ) : students.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                  <th className="px-5 py-2.5 font-semibold">Student</th>
                  <th className="px-3 py-2.5 font-semibold">Class</th>
                  <th className="px-3 py-2.5 font-semibold">Dormitory</th>
                  <th className="px-3 py-2.5 font-semibold">Balance</th>
                  <th className="px-3 py-2.5 font-semibold">Risk</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Admitted</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const id = s.id ?? s._id ?? ''
                  return (
                    <tr key={id} className="row-hover border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                      <td className="px-5 py-3">
                        <Link to={`/students/${id}`} className="group flex items-center gap-3">
                          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                            {s.fullName?.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                          </span>
                          <span>
                            <span className="block font-medium group-hover:text-brand-600">{s.fullName}</span>
                            <span className="block text-xs text-slate-400">{s.studentId}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {typeof s.classId === 'object' ? s.classId?.name ?? '—' : '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-500">{typeof s.dormitoryId === 'object' ? s.dormitoryId?.name ?? '—' : '—'}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`font-mono text-sm font-semibold ${
                            s.currentBalance <= 15 ? 'text-risk-red' : s.currentBalance <= 25 ? 'text-risk-orange' : s.currentBalance <= 32 ? 'text-risk-yellow' : 'text-risk-green'
                          }`}
                        >
                          {s.currentBalance}
                        </span>
                        <span className="text-xs text-slate-400"> / term</span>
                      </td>
                      <td className="px-3 py-3">
                        <RiskBadge risk={s.riskLevel} />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-slate-400">{formatDate(s.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No students found" message="Adjust your filters or register the first student." icon={Users} />
        )}
        <div className="border-t border-line px-5 py-3 dark:border-[#26374f]">
          <Pagination meta={meta} onPage={setPage} />
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Register a student"
        subtitle="An initial conduct allocation is posted automatically for the active term."
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createMutation.isPending}
              disabled={!form.firstName || !form.lastName || !form.classId || (addGuardian && (!form.guardianName || !form.guardianPhone))}
              onClick={() => createMutation.mutate()}
            >
              Register student
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <UserRound className="h-4 w-4 text-brand-500" /> Learner details
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="First name" required>
                <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
              </Field>
              <Field label="Last name" required>
                <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
              </Field>
              <Field label="Other names">
                <Input value={form.otherNames} onChange={(e) => set('otherNames', e.target.value)} />
              </Field>
              <Field label="Gender" required>
                <Select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </Select>
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
              </Field>
              <Field label="Student ID" hint="Generated if left blank">
                <Input value={form.studentId} onChange={(e) => set('studentId', e.target.value)} placeholder="STD-0001" />
              </Field>
              <Field label="Class" required>
                <Select value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value, streamId: '' }))}>
                  <option value="">Select class</option>
                  {structure?.classes.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Stream">
                <Select value={form.streamId} onChange={(e) => set('streamId', e.target.value)}>
                  <option value="">No stream</option>
                  {filteredStreams.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Dormitory">
                <Select value={form.dormitoryId} onChange={(e) => set('dormitoryId', e.target.value)}>
                  <option value="">Day student</option>
                  {structure?.dormitories?.map((d) => (
                    <option key={d._id} value={d._id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes">
                <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Medical, accommodation or other context…" />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-line p-4 dark:border-[#26374f]">
            <label className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Primary guardian</span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={addGuardian} onChange={(e) => setAddGuardian(e.target.checked)} className="h-4 w-4 rounded border-line" />
                Add guardian
              </span>
            </label>
            {addGuardian && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Full name" required>
                  <Input value={form.guardianName} onChange={(e) => set('guardianName', e.target.value)} />
                </Field>
                <Field label="Relationship">
                  <Select value={form.guardianRelationship} onChange={(e) => set('guardianRelationship', e.target.value)}>
                    <option>Guardian</option>
                    <option>Mother</option>
                    <option>Father</option>
                    <option>Aunt</option>
                    <option>Uncle</option>
                    <option>Sibling</option>
                  </Select>
                </Field>
                <Field label="Phone" hint="Rwanda numbers are normalised to +250" required>
                  <Input value={form.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} placeholder="0788 000 000" />
                </Field>
                <Field label="Email">
                  <Input type="email" value={form.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} />
                </Field>
                <div className="sm:col-span-2 flex flex-wrap gap-4 rounded-lg bg-slate-50 p-3 text-xs dark:bg-[#0c1524]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.guardianWhatsapp} onChange={(e) => set('guardianWhatsapp', e.target.checked)} className="h-4 w-4 rounded" />
                    WhatsApp consent
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.guardianSms} onChange={(e) => set('guardianSms', e.target.checked)} className="h-4 w-4 rounded" />
                    SMS consent
                  </label>
                  <span className="text-slate-400">Messages outside quiet hours are queued automatically.</span>
                </div>
              </div>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Upload className="h-3.5 w-3.5" /> Bulk import accepts validated JSON rows through the API import endpoint; use Export for a template.
          </p>
        </div>
      </Modal>
    </div>
  )
}
