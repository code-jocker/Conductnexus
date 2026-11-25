import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Download, LayoutGrid, List, Pencil, Plus, RotateCcw, Table2, Trash2, Upload, UserRound, Users, GraduationCap, X } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, del, downloadFile, getPage, post } from '../lib/api'
import { ImportStudents } from '../components/ImportStudents'
import type { PaginationMeta, Student } from '../lib/types'
import { useDebounced, useStaff, useStructure } from '../lib/hooks'
import { formatDate, titleCase } from '../lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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

const STEPS = ['Personal', 'Admission', 'Placement', 'Guardians', 'Review'] as const

type GuardianForm = {
  name: string
  relationship: string
  phone: string
  altPhone: string
  email: string
  address: string
  occupation: string
  isPrimary: boolean
  isEmergencyContact: boolean
  whatsappConsent: boolean
}

const emptyGuardian = (primary = false): GuardianForm => ({
  name: '',
  relationship: 'Guardian',
  phone: '',
  altPhone: '',
  email: '',
  address: '',
  occupation: '',
  isPrimary: primary,
  isEmergencyContact: false,
  whatsappConsent: true,
})

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  otherNames: '',
  gender: 'male',
  dateOfBirth: '',
  nationality: '',
  nationalId: '',
  religion: '',
  bloodGroup: '',
  photoUrl: '',
  contactPhone: '',
  contactEmail: '',
  contactAddress: '',
  medicalNotes: '',
  studentId: '',
  admissionNumber: '',
  admissionDate: '',
  admissionType: 'new',
  previousSchool: '',
  previousClass: '',
  boardingStatus: 'day',
  classId: '',
  streamId: '',
  classTeacherId: '',
  dormitoryId: '',
  roomNumber: '',
  notes: '',
}

type Form = typeof EMPTY_FORM

export function StudentsPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const { data: structure } = useStructure()
  const { data: staff } = useStaff(has('users.view'))
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const [classId, setClassId] = useState('')
  const [risk, setRisk] = useState('')
  const [status, setStatus] = useState('active')
  const [gender, setGender] = useState('')
  const [boardingStatus, setBoardingStatus] = useState('')
  const [sort, setSort] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [pageSize, setPageSize] = useState(20)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [guardians, setGuardians] = useState<GuardianForm[]>([emptyGuardian(true)])
  const [customFields, setCustomFields] = useState<{ label: string; value: string }[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [filtersOpen, setFiltersOpen] = useState(typeof window === 'undefined' || window.innerWidth >= 768)

  useEffect(() => {
    const handleResize = () => {
      const next = window.innerWidth < 768 ? 'cards' : 'table'
      setView((current) => (current === next ? current : next))
      setFiltersOpen(window.innerWidth >= 768)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['students', search, classId, risk, status, gender, boardingStatus, sort, sortDir, includeArchived, page, pageSize],
    queryFn: () =>
      getPage<Student>('/students', {
        page,
        pageSize,
        q: search || undefined,
        classId: classId || undefined,
        risk: risk || undefined,
        status: status || undefined,
        gender: gender || undefined,
        boardingStatus: boardingStatus || undefined,
        sort,
        sortDir,
        includeArchived: includeArchived || undefined,
      }),
  })

  const students = data?.items ?? []
  const meta = (data?.meta ?? { total: 0, page: 1, pageSize, totalPages: 1 }) as PaginationMeta
  const pageIds = students.map((s) => s.id ?? s._id ?? '').filter(Boolean)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  async function exportSelected() {
    const ids = [...selected]
    if (!ids.length) return
    try {
      await downloadFile(`/students/export?ids=${encodeURIComponent(ids.join(','))}`, `conductnexus-selected-students-${new Date().toISOString().slice(0, 10)}.csv`)
      success(`${ids.length} selected student${ids.length === 1 ? '' : 's'} exported`)
    } catch (err) {
      toastError(apiError(err))
    }
  }

  const filteredStreams = useMemo(
    () => (structure?.streams ?? []).filter((s) => !form.classId || s.level === structure?.classes.find((c) => c._id === form.classId)?.level),
    [structure, form.classId],
  )

  const createMutation = useMutation({
    mutationFn: () =>
      post<Student>('/students', {
        firstName: form.firstName,
        lastName: form.lastName,
        otherNames: form.otherNames || undefined,
        gender: form.gender,
        dateOfBirth: form.dateOfBirth || undefined,
        nationality: form.nationality || undefined,
        nationalId: form.nationalId || undefined,
        religion: form.religion || undefined,
        bloodGroup: form.bloodGroup || undefined,
        photoUrl: form.photoUrl || undefined,
        contact:
          form.contactPhone || form.contactEmail || form.contactAddress
            ? { phone: form.contactPhone || undefined, email: form.contactEmail || undefined, address: form.contactAddress || undefined }
            : undefined,
        customFields: customFields.filter((field) => field.label.trim()).map((field) => ({ label: field.label.trim(), value: field.value })),
        medicalNotes: form.medicalNotes || undefined,
        studentId: form.studentId || undefined,
        admissionNumber: form.admissionNumber || undefined,
        admissionDate: form.admissionDate || undefined,
        admissionType: form.admissionType,
        previousSchool: form.previousSchool || undefined,
        previousClass: form.previousClass || undefined,
        boardingStatus: form.boardingStatus,
        classId: form.classId,
        streamId: form.streamId || undefined,
        classTeacherId: form.classTeacherId || undefined,
        dormitoryId: form.dormitoryId || undefined,
        roomNumber: form.roomNumber || undefined,
        notes: form.notes || undefined,
        guardians: guardians
          .filter((g) => g.name && g.phone)
          .map((g) => ({
            name: g.name,
            relationship: g.relationship,
            phone: g.phone,
            altPhone: g.altPhone || undefined,
            email: g.email || undefined,
            address: g.address || undefined,
            occupation: g.occupation || undefined,
            isPrimary: g.isPrimary,
            isEmergencyContact: g.isEmergencyContact,
            whatsappConsent: g.whatsappConsent,
            preferredChannel: 'whatsapp',
          })),
      }),
    onSuccess: (student) => {
      success(`${student.fullName} registered. The conduct ledger is open for the active term.`)
      closeWizard()
      queryClient.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setGuardian(index: number, patch: Partial<GuardianForm>) {
    setGuardians((list) =>
      list.map((g, i) => {
        if (i !== index) return patch.isPrimary ? { ...g, isPrimary: false } : g
        return { ...g, ...patch }
      }),
    )
  }

  function closeWizard() {
    setOpen(false)
    setStep(0)
    setForm(EMPTY_FORM)
    setGuardians([emptyGuardian(true)])
    setCustomFields([])
  }

  function clearFilters() {
    setQ('')
    setClassId('')
    setRisk('')
    setStatus('active')
    setGender('')
    setBoardingStatus('')
    setIncludeArchived(false)
    setPage(1)
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteReason.trim().length < 3) return
    const id = deleteTarget.id ?? deleteTarget._id
    if (!id) return
    setDeleteBusy(true)
    try {
      await del(`/students/${id}?reason=${encodeURIComponent(deleteReason.trim())}`)
      success(`${deleteTarget.fullName} archived. You can restore the record from the archived list.`)
      setDeleteTarget(null)
      setDeleteReason('')
      queryClient.invalidateQueries({ queryKey: ['students'] })
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  async function restoreStudent(student: Student) {
    const id = student.id ?? student._id
    if (!id) return
    try {
      await post(`/students/${id}/restore`)
      success(`${student.fullName} restored.`)
      queryClient.invalidateQueries({ queryKey: ['students'] })
    } catch (err) {
      toastError(apiError(err))
    }
  }

  const stepValid = (() => {
    if (step === 0) return Boolean(form.firstName && form.lastName && form.gender)
    if (step === 1) return form.admissionType !== 'transfer' || Boolean(form.previousSchool)
    if (step === 2) return Boolean(form.classId)
    if (step === 3) return guardians.every((g) => (!g.name && !g.phone) || (g.name.length >= 2 && g.phone.length >= 9))
    return true
  })()

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
        subtitle="Registration, placement, guardians and the full discipline lifecycle for every learner."
        actions={
          <>
            {has('students.export') && (
              <Button variant="secondary" icon={Download} onClick={exportCsv}>
                Export
              </Button>
            )}
            {has('students.import') && (
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
                Import
              </Button>
            )}
            {has('students.promote') && (
              <Link
                to="/promotions"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#2a3b55] dark:bg-[#101a2c] dark:text-slate-200"
              >
                <GraduationCap className="h-4 w-4" /> Promotions
              </Link>
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
        <div className="flex items-center justify-between lg:hidden">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400"
          >
            <List className={`h-4 w-4 ${filtersOpen ? 'rotate-180' : ''}`} />
            {filtersOpen ? 'Hide filters' : 'Show filters'}
          </button>
        </div>
        {!filtersOpen && typeof window !== 'undefined' && window.innerWidth < 768 ? null : (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search name, student ID, admission number or national ID…" className="flex-1" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); setPage(1) }}>
              <option value="">All classes</option>
              {structure?.classes.map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
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
              <option value="withdrawn">Withdrawn</option>
              <option value="graduated">Graduated</option>
              <option value="expelled">Expelled</option>
              <option value="archived">Archived</option>
              <option value="">All statuses</option>
            </Select>
            <Select value={gender} onChange={(e) => { setGender(e.target.value); setPage(1) }}>
              <option value="">All genders</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </Select>
            <Select value={boardingStatus} onChange={(e) => { setBoardingStatus(e.target.value); setPage(1) }}>
              <option value="">Day & boarding</option>
              <option value="day">Day</option>
              <option value="boarding">Boarding</option>
            </Select>
            <Select value={`${sort}:${sortDir}`} onChange={(e) => { const [nextSort, nextDir] = e.target.value.split(':'); setSort(nextSort); setSortDir(nextDir); setPage(1) }}>
              <option value="name:asc">Name A–Z</option>
              <option value="name:desc">Name Z–A</option>
              <option value="balance:asc">Lowest balance</option>
              <option value="balance:desc">Highest balance</option>
              <option value="admitted:desc">Newest admission</option>
              <option value="admitted:asc">Oldest admission</option>
              <option value="risk:asc">Risk (low to critical)</option>
              <option value="risk:desc">Risk (critical to low)</option>
            </Select>
          </div>
          <div className="flex items-center gap-4">
            <Checkbox checked={includeArchived} onChange={(v) => { setIncludeArchived(v); setPage(1) }} label="Include archived" />
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-600">
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          </div>
        </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 text-xs text-slate-500 dark:border-[#26374f]">
          <div className="flex flex-wrap items-center gap-3">
            <span><span className="font-semibold text-ink dark:text-slate-100">{meta.total}</span> students</span>
            {selected.size > 0 && (
              <>
                <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">{selected.size} selected</span>
                {has('students.export') && (
                  <Button size="sm" variant="secondary" icon={Download} onClick={exportSelected}>Export selected</Button>
                )}
                <button type="button" onClick={() => setSelected(new Set())} className="font-semibold text-slate-400 hover:text-slate-600">Clear</button>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden lg:inline">Conduct is held per term and changed only through approved transactions.</span>
            <div className="flex rounded-lg border border-line p-0.5 dark:border-[#2a3b55]">
              <button
                type="button"
                onClick={() => setView('table')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold transition ${view === 'table' ? 'bg-navy-900 text-white dark:bg-brand-600' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Table2 className="h-3.5 w-3.5" /> Table
              </button>
              <button
                type="button"
                onClick={() => setView('cards')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold transition ${view === 'cards' ? 'bg-navy-900 text-white dark:bg-brand-600' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Cards
              </button>
            </div>
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12 w-full" />)}
          </div>
        ) : students.length ? (
          view === 'table' ? (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                  <th className="py-2.5 pl-5 pr-1">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all students on this page"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-semibold">Student</th>
                  <th className="px-3 py-2.5 font-semibold">Class</th>
                  <th className="px-3 py-2.5 font-semibold">Boarding</th>
                  <th className="px-3 py-2.5 font-semibold">Balance</th>
                  <th className="px-3 py-2.5 font-semibold">Risk</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Admitted</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const id = s.id ?? s._id ?? ''
                  return (
                    <tr key={id} className="row-hover border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                      <td className="py-3 pl-5 pr-1">
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() => toggleSelected(id)}
                          aria-label={`Select ${s.fullName}`}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Link to={`/students/${id}`} className="group flex items-center gap-3">
                          {s.photoUrl ? (
                            <img src={s.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                          ) : (
                            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                              {s.fullName?.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                            </span>
                          )}
                          <span>
                            <span className="block font-medium group-hover:text-brand-600">{s.fullName}</span>
                            <span className="block text-xs text-slate-400">{s.studentId} · {s.admissionNumber}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {typeof s.classId === 'object' ? s.classId?.name ?? '—' : '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-500">
                        {s.boardingStatus === 'boarding' ? (typeof s.dormitoryId === 'object' ? s.dormitoryId?.name ?? 'Boarding' : 'Boarding') : 'Day'}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`font-mono text-sm font-semibold ${s.currentBalance <= 15 ? 'text-risk-red' : s.currentBalance <= 25 ? 'text-risk-orange' : s.currentBalance <= 32 ? 'text-risk-yellow' : 'text-risk-green'}`}>
                          {s.currentBalance}
                        </span>
                        <span className="text-xs text-slate-400"> / term</span>
                      </td>
                      <td className="px-3 py-3"><RiskBadge risk={s.riskLevel} /></td>
                      <td className="px-3 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-3 py-3 text-right text-xs text-slate-400">{formatDate(s.admissionDate ?? s.createdAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to={`/students/${id}`}
                            title="Edit student"
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-white/5"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                          {s.status === 'archived' && has('students.restore') && (
                            <button
                              type="button"
                              title="Restore student"
                              onClick={() => restoreStudent(s)}
                              className="grid h-8 w-8 place-items-center rounded-lg text-risk-green hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}
                          {s.status !== 'archived' && has('students.archive') && (
                            <button
                              type="button"
                              title="Delete student record"
                              onClick={() => { setDeleteTarget(s); setDeleteReason('') }}
                              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-risk-red dark:hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          ) : (
            <div className="grid gap-3 p-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {students.map((s) => {
                const id = s.id ?? s._id ?? ''
                const className = typeof s.classId === 'object' ? s.classId?.name ?? '—' : '—'
                return (
                  <div key={id} className="rounded-xl border border-line bg-white p-4 dark:border-[#2a3b55] dark:bg-[#0f1828]">
                    <div className="flex items-start justify-between gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => toggleSelected(id)}
                        aria-label={`Select ${s.fullName}`}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <RiskBadge risk={s.riskLevel} />
                    </div>
                    <Link to={`/students/${id}`} className="mt-3 flex items-center gap-3 group">
                      {s.photoUrl ? (
                        <img src={s.photoUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                      ) : (
                        <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                          {s.fullName?.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold group-hover:text-brand-600">{s.fullName}</span>
                        <span className="block truncate text-xs text-slate-400">{s.studentId} · {s.admissionNumber}</span>
                      </span>
                    </Link>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><dt className="text-slate-400">Class</dt><dd className="font-medium">{className}</dd></div>
                      <div><dt className="text-slate-400">Boarding</dt><dd className="font-medium">{s.boardingStatus === 'boarding' ? 'Boarding' : 'Day'}</dd></div>
                      <div>
                        <dt className="text-slate-400">Balance</dt>
                        <dd className={`font-mono font-semibold ${s.currentBalance <= 15 ? 'text-risk-red' : s.currentBalance <= 25 ? 'text-risk-orange' : s.currentBalance <= 32 ? 'text-risk-yellow' : 'text-risk-green'}`}>{s.currentBalance}</dd>
                      </div>
                      <div><dt className="text-slate-400">Status</dt><dd><StatusBadge status={s.status} /></dd></div>
                    </dl>
                    <div className="mt-3 flex items-center justify-between border-t border-line pt-3 dark:border-[#26374f]">
                      <span className="text-[11px] text-slate-400">Admitted {formatDate(s.admissionDate ?? s.createdAt)}</span>
                      <div className="flex items-center gap-1">
                        <Link to={`/students/${id}`} title="Open profile" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-white/5">
                          <Pencil className="h-4 w-4" />
                        </Link>
                        {s.status === 'archived' && has('students.restore') && (
                          <button type="button" title="Restore student" onClick={() => restoreStudent(s)} className="grid h-8 w-8 place-items-center rounded-lg text-risk-green hover:bg-emerald-50 dark:hover:bg-emerald-500/10">
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                        {s.status !== 'archived' && has('students.archive') && (
                          <button type="button" title="Delete student record" onClick={() => { setDeleteTarget(s); setDeleteReason('') }} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-risk-red dark:hover:bg-red-500/10">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <EmptyState title="No students found" message="Adjust your filters or register the first student." icon={Users} />
        )}
        <div className="flex flex-col gap-3 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-[#26374f]">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
              className="h-8 rounded-lg border border-line bg-white px-2 text-xs dark:border-[#2a3b55] dark:bg-[#101a2c]"
            >
              {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <Pagination meta={meta} onPage={setPage} />
        </div>
      </Card>

      <Modal
        open={open}
        onClose={closeWizard}
        title="Register a student"
        subtitle="Five short steps. A conduct allocation is posted for the active term on completion."
        size="xl"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => (step === 0 ? closeWizard() : setStep((s) => s - 1))}>
              {step === 0 ? 'Cancel' : <><ArrowLeft className="h-4 w-4" /> Back</>}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button disabled={!stepValid} onClick={() => setStep((s) => s + 1)}>
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
                <Check className="h-4 w-4" /> Register student
              </Button>
            )}
          </div>
        }
      >
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => i < step && setStep(i)}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                i === step
                  ? 'bg-navy-900 text-white dark:bg-brand-600'
                  : i < step
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200'
                    : 'bg-slate-100 text-slate-400 dark:bg-white/5'
              }`}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10px]">{i < step ? '✓' : i + 1}</span>
              {label}
            </button>
          ))}
        </div>

        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="First name" required><Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
            <Field label="Last name" required><Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
            <Field label="Other names"><Input value={form.otherNames} onChange={(e) => set('otherNames', e.target.value)} /></Field>
            <Field label="Gender" required>
              <Select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </Select>
            </Field>
            <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
            <Field label="Nationality"><Input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} placeholder="Rwandan" /></Field>
            <Field label="National ID"><Input value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} /></Field>
            <Field label="Religion"><Input value={form.religion} onChange={(e) => set('religion', e.target.value)} /></Field>
            <Field label="Blood group"><Input value={form.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)} placeholder="O+" /></Field>
            <Field label="Photo URL" className="sm:col-span-2"><Input value={form.photoUrl} onChange={(e) => set('photoUrl', e.target.value)} placeholder="https://…" /></Field>
            <Field label="Student phone"><Input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="0788 000 000" /></Field>
            <Field label="Student email"><Input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
            <Field label="Home address" className="sm:col-span-2"><Input value={form.contactAddress} onChange={(e) => set('contactAddress', e.target.value)} /></Field>
            <Field label="Medical notes" className="sm:col-span-3"><Textarea value={form.medicalNotes} onChange={(e) => set('medicalNotes', e.target.value)} placeholder="Allergies, medication, dietary needs…" /></Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Student ID" hint="Generated if left blank"><Input value={form.studentId} onChange={(e) => set('studentId', e.target.value)} placeholder="STD-0001" /></Field>
            <Field label="Admission number" hint="Generated if left blank"><Input value={form.admissionNumber} onChange={(e) => set('admissionNumber', e.target.value)} placeholder="ADM-0001" /></Field>
            <Field label="Admission date"><Input type="date" value={form.admissionDate} onChange={(e) => set('admissionDate', e.target.value)} /></Field>
            <Field label="Admission type" required>
              <Select value={form.admissionType} onChange={(e) => set('admissionType', e.target.value)}>
                <option value="new">New admission</option>
                <option value="transfer">Transfer</option>
                <option value="reentry">Re-entry</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            {form.admissionType === 'transfer' && (
              <>
                <Field label="Previous school" required><Input value={form.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} /></Field>
                <Field label="Previous class"><Input value={form.previousClass} onChange={(e) => set('previousClass', e.target.value)} /></Field>
              </>
            )}
            <Field label="Boarding status" required>
              <Select value={form.boardingStatus} onChange={(e) => set('boardingStatus', e.target.value)}>
                <option value="day">Day student</option>
                <option value="boarding">Boarding student</option>
              </Select>
            </Field>
            <Field label="Dormitory" hint="Boarding students only">
              <Select value={form.dormitoryId} onChange={(e) => set('dormitoryId', e.target.value)}>
                <option value="">No dormitory</option>
                {structure?.dormitories?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Room number"><Input value={form.roomNumber} onChange={(e) => set('roomNumber', e.target.value)} /></Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Class" required>
              <Select value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value, streamId: '' }))}>
                <option value="">Select class</option>
                {structure?.classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Stream">
              <Select value={form.streamId} onChange={(e) => set('streamId', e.target.value)}>
                <option value="">No stream</option>
                {filteredStreams.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Class teacher" hint="Optional staff assignment">
              <Select value={form.classTeacherId} onChange={(e) => set('classTeacherId', e.target.value)}>
                <option value="">Unassigned</option>
                {(staff ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}{u.position ? ` · ${u.position}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Context for class teachers and the care team…" />
            </Field>
            <div className="sm:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Custom fields</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Plus}
                  onClick={() => setCustomFields((fields) => [...fields, { label: '', value: '' }])}
                >
                  Add field
                </Button>
              </div>
              {customFields.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line p-3 text-xs text-slate-400 dark:border-[#2a3b55]">
                  Add any school-specific detail (for example house, bus route or scholarship). Custom fields appear in the profile and exports.
                </p>
              ) : (
                <div className="space-y-2">
                  {customFields.map((field, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={field.label}
                        onChange={(e) => setCustomFields((fields) => fields.map((item, i) => (i === index ? { ...item, label: e.target.value } : item)))}
                        placeholder="Field name"
                        className="w-1/3"
                      />
                      <Input
                        value={field.value}
                        onChange={(e) => setCustomFields((fields) => fields.map((item, i) => (i === index ? { ...item, value: e.target.value } : item)))}
                        placeholder="Value"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCustomFields((fields) => fields.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {guardians.map((g, i) => (
              <div key={i} className="rounded-xl border border-line p-4 dark:border-[#26374f]">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <UserRound className="h-4 w-4 text-brand-500" /> Guardian {i + 1}
                  </p>
                  {guardians.length > 1 && (
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setGuardians((list) => list.filter((_, x) => x !== i))}>Remove</Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Full name" required><Input value={g.name} onChange={(e) => setGuardian(i, { name: e.target.value })} /></Field>
                  <Field label="Relationship">
                    <Select value={g.relationship} onChange={(e) => setGuardian(i, { relationship: e.target.value })}>
                      <option>Guardian</option><option>Mother</option><option>Father</option><option>Aunt</option><option>Uncle</option><option>Sibling</option><option>Other</option>
                    </Select>
                  </Field>
                  <Field label="WhatsApp phone" hint="Rwanda numbers are normalised to +250" required>
                    <Input value={g.phone} onChange={(e) => setGuardian(i, { phone: e.target.value })} placeholder="0788 000 000" />
                  </Field>
                  <Field label="Alternative phone"><Input value={g.altPhone} onChange={(e) => setGuardian(i, { altPhone: e.target.value })} /></Field>
                  <Field label="Email"><Input type="email" value={g.email} onChange={(e) => setGuardian(i, { email: e.target.value })} /></Field>
                  <Field label="Occupation"><Input value={g.occupation} onChange={(e) => setGuardian(i, { occupation: e.target.value })} /></Field>
                  <Field label="Address" className="sm:col-span-2"><Input value={g.address} onChange={(e) => setGuardian(i, { address: e.target.value })} /></Field>
                </div>
                <div className="mt-3 flex flex-wrap gap-5 rounded-lg bg-slate-50 p-3 text-xs dark:bg-[#0c1524]">
                  <Checkbox checked={g.whatsappConsent} onChange={(v) => setGuardian(i, { whatsappConsent: v })} label="WhatsApp consent (recommended)" />
                  <Checkbox checked={g.isPrimary} onChange={(v) => setGuardian(i, { isPrimary: v })} label="Primary contact" />
                  <Checkbox checked={g.isEmergencyContact} onChange={(v) => setGuardian(i, { isEmergencyContact: v })} label="Emergency contact" />
                </div>
              </div>
            ))}
            {guardians.length < 3 && (
              <Button variant="secondary" icon={Plus} onClick={() => setGuardians((list) => [...list, emptyGuardian(false)])}>Add another guardian</Button>
            )}
            <p className="text-xs text-slate-400">Parent messaging is WhatsApp-only. Guardians without WhatsApp consent are skipped.</p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Personal</p>
                <p className="mt-1 text-lg font-semibold">{[form.firstName, form.otherNames, form.lastName].filter(Boolean).join(' ')}</p>
                <p className="text-sm text-slate-500">{titleCase(form.gender)} · {formatDate(form.dateOfBirth) || 'No date of birth'}</p>
                <p className="mt-2 text-xs text-slate-400">{[form.nationality, form.bloodGroup, form.religion].filter(Boolean).join(' · ') || 'No additional identity details'}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Admission</p>
                <p className="mt-1 text-sm font-medium">{titleCase(form.admissionType)} admission</p>
                <p className="text-sm text-slate-500">{form.studentId || 'Student ID auto-generated'} · {form.admissionNumber || 'Admission number auto-generated'}</p>
                <p className="mt-2 text-xs text-slate-400">{form.admissionDate ? `Admitted ${formatDate(form.admissionDate)}` : 'Admitted on registration date'}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Placement</p>
                <p className="mt-1 text-sm font-medium">
                  {structure?.classes.find((c) => c._id === form.classId)?.name ?? 'No class selected'}
                  {form.streamId ? ` · ${structure?.streams.find((s) => s._id === form.streamId)?.name ?? ''}` : ''}
                </p>
                <p className="text-sm text-slate-500">
                  {form.boardingStatus === 'boarding'
                    ? `Boarding · ${structure?.dormitories?.find((d) => d._id === form.dormitoryId)?.name ?? 'No dormitory'}`
                    : 'Day student'}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {form.classTeacherId ? `Class teacher: ${staff?.find((u) => u.id === form.classTeacherId)?.name ?? ''}` : 'No class teacher assigned'}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Guardians</p>
                {guardians.filter((g) => g.name || g.phone).length ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {guardians.filter((g) => g.name || g.phone).map((g, i) => (
                      <li key={i} className="flex items-center justify-between gap-2">
                        <span>{g.name} <span className="text-xs text-slate-400">· {g.relationship}</span></span>
                        <span className="flex items-center gap-1.5">
                          {g.isPrimary && <Badge tone="brand">Primary</Badge>}
                          <Badge tone={g.whatsappConsent ? 'emerald' : 'slate'}>WhatsApp {g.whatsappConsent ? 'yes' : 'no'}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">No guardians added. You can link them from the student profile.</p>
                )}
              </Card>
            </div>
            <p className="text-xs text-slate-400">On registration an initial conduct allocation is posted for the active term and a placement record is added to the student timeline.</p>
          </div>
        )}
      </Modal>

      <ImportStudents open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => { setDeleteTarget(null); setDeleteReason('') }}
        title="Delete student record"
        subtitle="This is a soft delete. The record and its history are kept and can be restored."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDeleteTarget(null); setDeleteReason('') }}>Cancel</Button>
            <Button variant="danger" loading={deleteBusy} disabled={deleteReason.trim().length < 3} onClick={confirmDelete}>
              <Trash2 className="h-4 w-4" /> Delete record
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Alert tone="warning" title="The student will leave active registers">
            Conduct transactions, incidents and documents are preserved. An authorised user can restore the student from the archived list at any time.
          </Alert>
          <p className="text-sm">
            Delete <span className="font-semibold">{deleteTarget?.fullName}</span>
            {deleteTarget?.studentId ? <span className="text-slate-400"> · {deleteTarget.studentId}</span> : null}?
          </p>
          <Field label="Reason for deletion" required hint="Recorded in the audit trail and timeline.">
            <Textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="For example: duplicate registration created in error" />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
