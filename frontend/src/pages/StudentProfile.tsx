import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderLock,
  GraduationCap,
  HeartHandshake,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserRound,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, del, get, patch, post } from '../lib/api'
import type { GuardianLink, StudentProfile } from '../lib/types'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
import { refName, useStaff, useStructure } from '../lib/hooks'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  RiskBadge,
  Select,
  StatCard,
  StatusBadge,
  Tabs,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

type TabKey =
  | 'overview'
  | 'personal'
  | 'academic'
  | 'guardians'
  | 'discipline'
  | 'ledger'
  | 'risk'
  | 'support'
  | 'letters'
  | 'communication'
  | 'investigations'
  | 'appeals'
  | 'safeguarding'
  | 'documents'
  | 'activity'

const TAB_KEYS: TabKey[] = [
  'overview',
  'personal',
  'academic',
  'guardians',
  'discipline',
  'ledger',
  'risk',
  'support',
  'letters',
  'communication',
  'investigations',
  'appeals',
  'safeguarding',
  'documents',
  'activity',
]

type ActivityEntry = { type: string; title: string; detail?: string; at: string; actor?: string; ref?: string }

type LifecycleAction = 'suspend' | 'reinstate' | 'transfer' | 'withdraw' | 'graduate' | 'archive' | 'restore'

const LIFECYCLE_LABELS: Record<LifecycleAction, string> = {
  suspend: 'Suspend student',
  reinstate: 'Reinstate student',
  transfer: 'Transfer out',
  withdraw: 'Withdraw student',
  graduate: 'Graduate student',
  archive: 'Archive record',
  restore: 'Restore record',
}

export function StudentProfilePage() {
  const { id } = useParams()
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const requestedTab = params.get('tab') as TabKey | null
  const [tab, setTab] = useState<TabKey>(requestedTab && TAB_KEYS.includes(requestedTab) ? requestedTab : 'overview')

  const { data, isLoading, error } = useQuery({
    queryKey: ['student-profile', id],
    queryFn: () => get<StudentProfile>(`/students/${id}/profile`),
    enabled: Boolean(id),
  })

  const activity = useQuery({
    queryKey: ['student-activity', id],
    queryFn: () => get<{ timeline: ActivityEntry[] }>(`/students/${id}/activity`),
    enabled: Boolean(id) && tab === 'activity' && Boolean(data?.permissions.canViewActivity),
  })

  const [lifecycleOpen, setLifecycleOpen] = useState(false)
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction>('suspend')
  const [lifecycleForm, setLifecycleForm] = useState({ reason: '', effectiveDate: '', transferSchool: '', notes: '' })

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [editCustomFields, setEditCustomFields] = useState<{ label: string; value: string }[]>([])
  const [editOriginal, setEditOriginal] = useState({ classId: '', streamId: '', dormitoryId: '', classTeacherId: '' })
  const { data: structure } = useStructure()
  const { data: staff } = useStaff(has('users.view'))

  const [guardianModal, setGuardianModal] = useState<{ open: boolean; link: GuardianLink | null }>({ open: false, link: null })
  const [guardianForm, setGuardianForm] = useState({
    name: '',
    relationship: 'Guardian',
    phone: '',
    altPhone: '',
    email: '',
    address: '',
    occupation: '',
    isPrimary: false,
    isEmergencyContact: false,
    whatsappConsent: true,
  })

  const [docOpen, setDocOpen] = useState(false)
  const [docForm, setDocForm] = useState({ title: '', type: 'certificate', url: '', notes: '' })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['student-profile', id] })
    queryClient.invalidateQueries({ queryKey: ['student-activity', id] })
    queryClient.invalidateQueries({ queryKey: ['students'] })
  }

  const lifecycleMutation = useMutation({
    mutationFn: () => post(`/students/${id}/lifecycle`, { action: lifecycleAction, ...lifecycleForm }),
    onSuccess: () => {
      success(`Student ${LIFECYCLE_LABELS[lifecycleAction].toLowerCase()} applied.`)
      setLifecycleOpen(false)
      setLifecycleForm({ reason: '', effectiveDate: '', transferSchool: '', notes: '' })
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const editMutation = useMutation({
    mutationFn: () => {
      const { contactPhone, contactEmail, contactAddress, streamId, dormitoryId, classTeacherId, classId, ...rest } = editForm
      const payload: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(rest)) {
        if (value !== '') payload[key] = value
      }
      if ((classId ?? '') !== editOriginal.classId && classId) payload.classId = classId
      if ((streamId ?? '') !== editOriginal.streamId) payload.streamId = streamId || null
      if ((dormitoryId ?? '') !== editOriginal.dormitoryId) payload.dormitoryId = dormitoryId || null
      if ((classTeacherId ?? '') !== editOriginal.classTeacherId) payload.classTeacherId = classTeacherId || null
      if (contactPhone || contactEmail || contactAddress) {
        payload.contact = {
          phone: contactPhone || undefined,
          email: contactEmail || undefined,
          address: contactAddress || undefined,
        }
      }
      payload.customFields = editCustomFields
        .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
        .filter((field) => field.label)
      return patch(`/students/${id}`, payload)
    },
    onSuccess: () => {
      success('Student record updated.')
      setEditOpen(false)
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const guardianMutation = useMutation({
    mutationFn: () => {
      const base = {
        relationship: guardianForm.relationship,
        isPrimary: guardianForm.isPrimary,
        isEmergencyContact: guardianForm.isEmergencyContact,
        whatsappConsent: guardianForm.whatsappConsent,
      }
      if (guardianModal.link) {
        return patch(`/students/${id}/guardians/${guardianModal.link._id}`, {
          ...base,
          parent: {
            name: guardianForm.name,
            phone: guardianForm.phone,
            altPhone: guardianForm.altPhone || undefined,
            email: guardianForm.email || undefined,
            address: guardianForm.address || undefined,
            occupation: guardianForm.occupation || undefined,
            whatsappConsent: guardianForm.whatsappConsent,
          },
        })
      }
      return post(`/students/${id}/guardians`, {
        ...base,
        name: guardianForm.name,
        phone: guardianForm.phone,
        altPhone: guardianForm.altPhone || undefined,
        email: guardianForm.email || undefined,
        address: guardianForm.address || undefined,
        occupation: guardianForm.occupation || undefined,
        preferredChannel: 'whatsapp',
      })
    },
    onSuccess: () => {
      success(guardianModal.link ? 'Guardian updated.' : 'Guardian linked to the student.')
      setGuardianModal({ open: false, link: null })
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const guardianDelete = useMutation({
    mutationFn: (linkId: string) => del(`/students/${id}/guardians/${linkId}`),
    onSuccess: () => {
      success('Guardian unlinked.')
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const documentMutation = useMutation({
    mutationFn: () => post(`/students/${id}/documents`, docForm),
    onSuccess: () => {
      success('Document added to the student record.')
      setDocOpen(false)
      setDocForm({ title: '', type: 'certificate', url: '', notes: '' })
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const documentDelete = useMutation({
    mutationFn: (documentId: string) => del(`/students/${id}/documents/${documentId}`),
    onSuccess: () => {
      success('Document removed.')
      invalidate()
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (isLoading) return <LoadingBlock label="Loading student profile…" />
  if (error || !data) {
    return (
      <EmptyState
        title="Student not available"
        message="You may not have permission to view this student, or the record no longer exists."
        action={<Link to="/students" className="link font-semibold">Back to students</Link>}
      />
    )
  }

  const s = data.student
  const conduct = data.conduct
  const perms = data.permissions
  const studentId = s.id ?? s._id ?? String(id)

  const lifecycleOptions: LifecycleAction[] = []
  if (s.status === 'active') lifecycleOptions.push('suspend', 'transfer', 'withdraw', 'graduate', 'archive')
  if (s.status === 'suspended') lifecycleOptions.push('reinstate', 'transfer', 'withdraw', 'graduate', 'archive')
  if (['transferred', 'withdrawn', 'graduated', 'expelled'].includes(s.status)) lifecycleOptions.push('archive')
  if (s.status === 'archived') lifecycleOptions.push('restore')
  const allowedLifecycle = lifecycleOptions.filter((a) => (a === 'archive' ? perms.canArchive : a === 'restore' ? perms.canRestore : perms.canLifecycle))

  function openLifecycle(action: LifecycleAction) {
    setLifecycleAction(action)
    setLifecycleForm({ reason: '', effectiveDate: '', transferSchool: '', notes: '' })
    setLifecycleOpen(true)
  }

  function openEdit() {
    const placement = {
      classId: typeof s.classId === 'object' ? s.classId?._id ?? '' : s.classId,
      streamId: typeof s.streamId === 'object' ? s.streamId?._id ?? '' : s.streamId ?? '',
      dormitoryId: typeof s.dormitoryId === 'object' ? s.dormitoryId?._id ?? '' : s.dormitoryId ?? '',
      classTeacherId: typeof s.classTeacherId === 'object' ? s.classTeacherId?._id ?? '' : s.classTeacherId ?? '',
    }
    setEditOriginal(placement)
    setEditForm({
      firstName: s.firstName ?? '',
      lastName: s.lastName ?? '',
      otherNames: s.otherNames ?? '',
      gender: s.gender ?? 'male',
      dateOfBirth: s.dateOfBirth ? s.dateOfBirth.slice(0, 10) : '',
      nationalId: s.nationalId ?? '',
      nationality: s.nationality ?? '',
      religion: s.religion ?? '',
      bloodGroup: s.bloodGroup ?? '',
      photoUrl: s.photoUrl ?? '',
      admissionNumber: s.admissionNumber ?? '',
      admissionType: s.admissionType ?? 'new',
      previousSchool: s.previousSchool ?? '',
      boardingStatus: s.boardingStatus ?? 'day',
      roomNumber: s.roomNumber ?? '',
      medicalNotes: s.medicalNotes ?? '',
      notes: s.notes ?? '',
      ...placement,
      contactPhone: s.contact?.phone ?? '',
      contactEmail: s.contact?.email ?? '',
      contactAddress: s.contact?.address ?? '',
    })
    setEditCustomFields((s.customFields ?? []).map((field) => ({ label: field.label, value: field.value })))
    setEditOpen(true)
  }

  function openGuardian(link: GuardianLink | null) {
    if (link) {
      setGuardianForm({
        name: link.parentId?.name ?? '',
        relationship: link.relationship ?? 'Guardian',
        phone: link.parentId?.phone ?? '',
        altPhone: link.parentId?.altPhone ?? '',
        email: link.parentId?.email ?? '',
        address: link.parentId?.address ?? '',
        occupation: link.parentId?.occupation ?? '',
        isPrimary: link.isPrimary,
        isEmergencyContact: link.isEmergencyContact,
        whatsappConsent: link.parentId?.whatsappConsent ?? true,
      })
    } else {
      setGuardianForm({
        name: '',
        relationship: 'Guardian',
        phone: '',
        altPhone: '',
        email: '',
        address: '',
        occupation: '',
        isPrimary: data!.guardians.length === 0,
        isEmergencyContact: false,
        whatsappConsent: true,
      })
    }
    setGuardianModal({ open: true, link })
  }

  const editStreams = (structure?.streams ?? []).filter(
    (st) => !editForm.classId || st.level === structure?.classes.find((c) => c._id === editForm.classId)?.level,
  )

  return (
    <div className="space-y-5">
      <Link to="/students" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to students
      </Link>

      <PageHeader
        eyebrow={`${data.class?.name ?? 'Unplaced'}${data.stream?.name ? ` · ${data.stream.name}` : ''}${data.dormitory?.name ? ` · ${data.dormitory.name}` : ''}`}
        title={s.fullName}
        subtitle={`${s.studentId} · Admission ${s.admissionNumber} · ${titleCase(s.status)}`}
        actions={
          <>
            <RiskBadge risk={s.riskLevel} />
            {s.archivedAt && <Badge tone="orange">Archived {formatDate(s.archivedAt)}</Badge>}
            {perms.canEdit && (
              <Button variant="secondary" icon={Pencil} onClick={openEdit}>Edit profile</Button>
            )}
            {allowedLifecycle.length > 0 && (
              <Button variant="dark" icon={Archive} onClick={() => openLifecycle(allowedLifecycle[0])}>Lifecycle</Button>
            )}
            {has('incidents.create') && (
              <Link
                to={`/incidents/new?studentId=${studentId}`}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                <ClipboardList className="h-4 w-4" /> Record incident
              </Link>
            )}
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-navy-900 via-navy-800 to-brand-800 p-5 text-white">
          <div className="flex flex-wrap items-center gap-4">
            {s.photoUrl ? (
              <img src={s.photoUrl} alt="" className="h-20 w-20 rounded-2xl border border-white/20 object-cover" />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-2xl border border-white/20 bg-white/10 text-2xl font-bold">
                {s.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </div>
            )}
            <div className="min-w-[200px] flex-1">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-200">Student identity card</p>
              <h2 className="mt-1 text-2xl font-semibold">{s.fullName}</h2>
              <p className="text-sm text-slate-300">{s.studentId} · {s.admissionNumber}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">{data.class?.name ?? 'No class'}{data.stream?.name ? ` · ${data.stream.name}` : ''}</span>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">{s.boardingStatus === 'boarding' ? 'Boarding' : 'Day'}</span>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">{titleCase(s.admissionType ?? 'new')} admission</span>
                <span className="rounded-full bg-ochre-500/90 px-2.5 py-1 text-xs font-semibold text-navy-950">Balance {s.currentBalance}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Gender</p><p className="font-medium">{titleCase(s.gender)}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Date of birth</p><p className="font-medium">{formatDate(s.dateOfBirth)}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Admitted</p><p className="font-medium">{formatDate(s.admissionDate)}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Guardians</p><p className="font-medium">{data.guardians.length}</p></div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Current balance" value={s.currentBalance} icon={ShieldCheck} hint={`${conduct.term?.name ?? 'Term'} · starts at ${conduct.startingMarks}`} tone={s.currentBalance <= 25 ? 'red' : 'brand'} />
        <StatCard label="Total deductions" value={conduct.totalDeductions} icon={TrendingDown} tone="ochre" hint="Approved deductions this term" />
        <StatCard label="Rewards" value={conduct.totalRewards} icon={TrendingUp} tone="emerald" hint="Recognition points restored" />
        <StatCard label="Open follow-ups" value={data.followUps.filter((f) => f.status === 'pending').length} icon={CalendarDays} tone="amber" hint="Care team actions pending" />
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'personal', label: 'Personal' },
          { key: 'academic', label: 'Academic' },
          { key: 'guardians', label: 'Guardians', count: data.guardians.length },
          { key: 'discipline', label: 'Discipline', count: data.incidents.length },
          { key: 'ledger', label: 'Ledger', count: data.ledger.length },
          { key: 'risk', label: 'Risk', count: data.assessments.length },
          { key: 'support', label: 'Support', count: data.interventions.length },
          { key: 'letters', label: 'Letters', count: data.letters.length },
          { key: 'communication', label: 'Messages', count: data.messages.length },
          { key: 'investigations', label: 'Investigations', count: data.investigations.length },
          { key: 'appeals', label: 'Appeals', count: data.appeals.length },
          { key: 'safeguarding', label: 'Safeguarding', count: data.safeguarding.length },
          { key: 'documents', label: 'Documents', count: s.documents?.length ?? 0 },
          { key: 'activity', label: 'Activity' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-5">
            <Card>
              <CardHeader title="Identity & placement" subtitle="Current registered details" icon={UserRound} actions={perms.canEdit ? <Button size="sm" variant="ghost" icon={Pencil} onClick={openEdit}>Edit</Button> : undefined} />
              <dl className="grid gap-x-6 gap-y-4 p-5 text-sm grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                <Info label="Class" value={data.class?.name} />
                <Info label="Stream" value={data.stream?.name} />
                <Info label="Dormitory" value={data.dormitory?.name ?? 'Day student'} />
                <Info label="Class teacher" value={data.classTeacher?.name} />
                <Info label="Admission type" value={titleCase(s.admissionType ?? 'new')} />
                <Info label="Previous school" value={s.previousSchool} />
                <Info label="Nationality" value={s.nationality} />
                <Info label="National ID" value={s.nationalId} />
                <Info label="Blood group" value={s.bloodGroup} />
                {s.notes && <div className="col-span-2 sm:col-span-3"><Info label="Notes" value={s.notes} multiline /></div>}
              </dl>
            </Card>

            <Card>
              <CardHeader title="Placement history" subtitle="Admissions, promotions and lifecycle changes" icon={GraduationCap} />
              {s.placementHistory?.length ? (
                <ol className="space-y-0 p-5">
                  {s.placementHistory.map((h, i) => (
                    <li key={i} className="relative border-l border-line pb-4 pl-5 last:pb-0 dark:border-[#26374f]">
                      <span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full bg-brand-500" />
                      <p className="text-sm font-medium">{titleCase(h.action.replace(/_/g, ' '))}</p>
                      <p className="text-xs text-slate-400">{formatDateTime(h.at)}{h.reason ? ` · ${h.reason}` : ''}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState title="No placement history" message="Admissions and class changes will appear here." />
              )}
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Risk assessments" subtitle="Most recent determinations" icon={HeartHandshake} />
              {data.assessments.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {data.assessments.slice(0, 6).map((a) => (
                    <li key={a._id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-sm">{a.reason ?? 'Recalculated from conduct signals'}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(a.createdAt)}</p>
                      </div>
                      <RiskBadge risk={a.riskLevel} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No assessments yet" message="Risk is recalculated as conduct transactions are approved." />
              )}
            </Card>

            <Card>
              <CardHeader title="Pending follow-ups" subtitle="Care team commitments" icon={CalendarDays} />
              {data.followUps.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {data.followUps.map((f) => (
                    <li key={f._id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span>{titleCase(f.type)}</span>
                      <span className="text-xs text-slate-400">Due {formatDate(f.dueDate)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nothing pending" message="Follow-ups will appear here when scheduled." />
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'personal' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Personal details" subtitle="Identity and health information" icon={UserRound} actions={perms.canEdit ? <Button size="sm" variant="ghost" icon={Pencil} onClick={openEdit}>Edit</Button> : undefined} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 text-sm">
              <Info label="Full name" value={s.fullName} />
              <Info label="Gender" value={titleCase(s.gender)} />
              <Info label="Date of birth" value={formatDate(s.dateOfBirth)} />
              <Info label="Nationality" value={s.nationality} />
              <Info label="National ID" value={s.nationalId} />
              <Info label="Religion" value={s.religion} />
              <Info label="Blood group" value={s.bloodGroup} />
              <Info label="Student ID" value={s.studentId} />
              <Info label="Admission number" value={s.admissionNumber} />
              <Info label="Status" value={titleCase(s.status)} />
              <Info label="Student phone" value={s.contact?.phone} />
              <Info label="Student email" value={s.contact?.email} />
              <div className="col-span-2"><Info label="Residential address" value={s.contact?.address} multiline /></div>
            </dl>
            {s.customFields?.length ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line px-5 py-4 text-sm dark:border-[#26374f]">
                {s.customFields.map((field) => (
                  <Info key={field.label} label={field.label} value={field.value} />
                ))}
              </dl>
            ) : null}
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Emergency contact" subtitle="Used when a guardian cannot be reached" icon={Phone} />
              <div className="p-5 text-sm">
                {s.emergencyContact?.name || s.emergencyContact?.phone ? (
                  <dl className="grid grid-cols-2 gap-4">
                    <Info label="Name" value={s.emergencyContact?.name} />
                    <Info label="Relationship" value={s.emergencyContact?.relationship} />
                    <Info label="Phone" value={s.emergencyContact?.phone} />
                  </dl>
                ) : (
                  <p className="text-slate-500">No emergency contact recorded.</p>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Medical notes" subtitle="Visible to authorised staff" icon={HeartHandshake} />
              <div className="p-5 text-sm text-slate-600 dark:text-slate-300">{s.medicalNotes || 'No medical notes recorded.'}</div>
            </Card>
            <Card>
              <CardHeader title="Administrative notes" icon={FileText} />
              <div className="p-5 text-sm text-slate-600 dark:text-slate-300">{s.notes || 'No notes recorded.'}</div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'academic' && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardHeader title="Current placement" subtitle="Class, stream and boarding" icon={GraduationCap} actions={perms.canEdit ? <Button size="sm" variant="ghost" icon={Pencil} onClick={openEdit}>Change</Button> : undefined} />
            <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
              <Info label="Class" value={data.class?.name} />
              <Info label="Level" value={data.class?.level} />
              <Info label="Stream" value={data.stream?.name} />
              <Info label="Dormitory" value={data.dormitory?.name ?? 'Day student'} />
              <Info label="Room" value={s.roomNumber} />
              <Info label="Class teacher" value={data.classTeacher?.name} />
              <Info label="Admission type" value={titleCase(s.admissionType ?? 'new')} />
              <Info label="Previous school" value={s.previousSchool} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Placement history" subtitle="Every change is recorded with actor and reason" icon={Activity} />
            {s.placementHistory?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                      <th className="px-5 py-2.5 font-semibold">Action</th>
                      <th className="px-3 py-2.5 font-semibold">Reason</th>
                      <th className="px-5 py-2.5 text-right font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.placementHistory.map((h, i) => (
                      <tr key={i} className="border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                        <td className="px-5 py-3 font-medium">{titleCase(h.action.replace(/_/g, ' '))}</td>
                        <td className="max-w-sm px-3 py-3 text-slate-500">{h.reason ?? '—'}</td>
                        <td className="px-5 py-3 text-right text-xs text-slate-400">{formatDateTime(h.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No placement history" message="Admissions and class changes will appear here." />
            )}
          </Card>
        </div>
      )}

      {tab === 'guardians' && (
        <Card>
          <CardHeader
            title="Guardians & consent"
            subtitle="Parent messaging is WhatsApp-only and honours consent"
            icon={MessageSquare}
            actions={perms.canManageGuardians ? <Button size="sm" icon={Plus} onClick={() => openGuardian(null)}>Link guardian</Button> : undefined}
          />
          {data.guardians.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {data.guardians.map((g) => (
                <li key={g._id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="font-medium">
                      {g.parentId?.name ?? 'Guardian'}
                      {g.isPrimary && <Badge tone="brand" className="ml-2">Primary</Badge>}
                      {g.isEmergencyContact && <Badge tone="orange" className="ml-2">Emergency</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {g.relationship ?? 'Guardian'} · {g.parentId?.phone ?? 'No phone'}
                      {g.parentId?.email ? ` · ${g.parentId.email}` : ''}
                    </p>
                    {(g.parentId?.address || g.parentId?.occupation) && (
                      <p className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                        {g.parentId?.occupation && <span>{g.parentId.occupation}</span>}
                        {g.parentId?.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {g.parentId.address}</span>}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={g.parentId?.whatsappConsent ? 'emerald' : 'slate'}>WhatsApp {g.parentId?.whatsappConsent ? 'yes' : 'no'}</Badge>
                    <Badge tone="slate">{titleCase(g.parentId?.verificationStatus ?? 'unverified')}</Badge>
                    {perms.canManageGuardians && (
                      <>
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => openGuardian(g)}>Edit</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => guardianDelete.mutate(g._id)}>Unlink</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No guardian linked" message="Link a guardian so parent communication can be delivered." />
          )}
        </Card>
      )}

      {tab === 'discipline' && (
        <Card>
          <CardHeader title="Incident history" subtitle="Conduct events recorded for this student" icon={ClipboardList} />
          {data.incidents.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                    <th className="px-5 py-2.5 font-semibold">Incident</th>
                    <th className="px-3 py-2.5 font-semibold">Offence</th>
                    <th className="px-3 py-2.5 font-semibold">Severity</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Parent notice</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.incidents.map((incident) => (
                    <tr key={incident._id} className="row-hover border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                      <td className="px-5 py-3">
                        <Link to={`/incidents/${incident._id}`} className="font-medium hover:text-brand-600">{incident.incidentNumber}</Link>
                        <p className="max-w-xs truncate text-xs text-slate-400">{incident.description}</p>
                      </td>
                      <td className="px-3 py-3">
                        {incident.offenceSnapshot?.name}
                        <span className="ml-1 font-mono text-xs text-risk-red">−{incident.offenceSnapshot?.deduction}</span>
                      </td>
                      <td className="px-3 py-3"><Badge tone={incident.severity === 'critical' ? 'red' : incident.severity === 'serious' ? 'orange' : 'slate'}>{titleCase(incident.severity)}</Badge></td>
                      <td className="px-3 py-3"><StatusBadge status={incident.status} /></td>
                      <td className="px-3 py-3"><Badge tone={incident.parentNotificationStatus === 'sent' ? 'emerald' : incident.parentNotificationStatus === 'failed' ? 'red' : 'slate'}>{titleCase(incident.parentNotificationStatus ?? 'pending')}</Badge></td>
                      <td className="px-5 py-3 text-right text-xs text-slate-400">{formatDate(incident.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No incidents recorded" message="This student has no conduct events." icon={ShieldCheck} />
          )}
        </Card>
      )}

      {tab === 'ledger' && (
        <div className="space-y-5">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            <StatCard label="Starting marks" value={conduct.startingMarks} tone="brand" hint={conduct.term?.name} />
            <StatCard label="Deductions" value={conduct.totalDeductions} tone="ochre" />
            <StatCard label="Rewards" value={conduct.totalRewards} tone="emerald" />
            <StatCard label="Current balance" value={conduct.currentBalance} tone={conduct.currentBalance <= 25 ? 'red' : 'brand'} />
          </div>
          <Card>
            <CardHeader title="Conduct ledger" subtitle="Append-only transactions for the selected term" icon={FileText} />
            {data.ledger.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                      <th className="px-5 py-2.5 font-semibold">Type</th>
                      <th className="px-3 py-2.5 font-semibold">Change</th>
                      <th className="px-3 py-2.5 font-semibold">Balance</th>
                      <th className="px-3 py-2.5 font-semibold">Reason</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.map((l) => (
                      <tr key={l._id} className="border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                        <td className="px-5 py-3"><Badge tone={l.type === 'deduction' ? 'red' : l.type === 'reward' ? 'emerald' : 'slate'}>{titleCase(l.type.replace(/_/g, ' '))}</Badge></td>
                        <td className={`px-3 py-3 font-mono ${l.change < 0 ? 'text-risk-red' : 'text-risk-green'}`}>{l.change > 0 ? '+' : ''}{l.change}</td>
                        <td className="px-3 py-3 font-mono">{l.newBalance}</td>
                        <td className="max-w-md px-3 py-3 text-slate-500">{l.reason}</td>
                        <td className="px-5 py-3 text-right text-xs text-slate-400">{formatDateTime(l.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No ledger transactions" message="Approved deductions and rewards appear here." />
            )}
          </Card>
        </div>
      )}

      {tab === 'risk' && (
        <Card>
          <CardHeader title="Risk assessments" subtitle="Determinations and reasons" icon={HeartHandshake} />
          {data.assessments.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {data.assessments.map((a) => (
                <li key={a._id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="text-sm font-medium">{a.reason ?? 'Recalculated from conduct signals'}</p>
                    <p className="text-xs text-slate-400">{formatDateTime(a.createdAt)}{typeof a.score === 'number' ? ` · score ${a.score}` : ''}</p>
                  </div>
                  <RiskBadge risk={a.riskLevel} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No assessments yet" message="Risk is recalculated as conduct transactions are approved." />
          )}
        </Card>
      )}

      {tab === 'support' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Support plans" subtitle="Interventions and mentoring" icon={HeartHandshake} />
            {data.interventions.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.interventions.map((intervention) => (
                  <li key={intervention._id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{intervention.title}</p>
                        <p className="text-xs text-slate-500">{titleCase(intervention.type)} · {refName(intervention.assignedTo)} · started {formatDate(intervention.startDate)}</p>
                      </div>
                      <StatusBadge status={intervention.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No support plans" message="Create an intervention from Risk & support." />
            )}
          </Card>
          <Card>
            <CardHeader title="Follow-ups" subtitle="Behaviour checks and meetings" icon={CalendarDays} />
            {data.followUps.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.followUps.map((f) => (
                  <li key={f._id} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm">{titleCase(f.type)}</span>
                    <div className="flex items-center gap-2"><span className="text-xs text-slate-400">Due {formatDate(f.dueDate)}</span><StatusBadge status={f.status} /></div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No follow-ups" message="Follow-ups appear here once scheduled." />
            )}
          </Card>
          <Card>
            <CardHeader title="Recognition & rewards" subtitle="Positive conduct entries" icon={TrendingUp} />
            {data.recognitions.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.recognitions.map((r) => (
                  <li key={r._id} className="flex items-start justify-between gap-3 px-5 py-4">
                    <div><p className="font-medium">{r.title}</p><p className="text-xs text-slate-400">{formatDate(r.awardedAt)}</p>{r.notes && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{r.notes}</p>}</div>
                    {typeof r.points === 'number' && <Badge tone="emerald">+{r.points} marks</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No recognition yet" message="Recognition celebrates improvement and positive conduct." icon={TrendingUp} />
            )}
          </Card>
          <Card>
            <CardHeader title="Meetings" subtitle="Parent and care meetings" icon={CalendarDays} />
            {data.meetings.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.meetings.map((m) => (
                  <li key={m._id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div><p className="font-medium">{m.title}</p><p className="text-xs text-slate-400">{m.reference} · {titleCase(m.type)} · {formatDateTime(m.scheduledAt)}</p></div>
                    <StatusBadge status={m.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No meetings" message="Scheduled meetings involving this student appear here." />
            )}
          </Card>
        </div>
      )}

      {tab === 'letters' && (
        <Card>
          <CardHeader title="Letters" subtitle="Official correspondence issued for this student" icon={FileText} />
          {data.letters.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {data.letters.map((l) => (
                <li key={l._id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="font-medium">{l.subject}</p>
                    <p className="text-xs text-slate-400">{l.reference} · {titleCase(l.type.replace(/_/g, ' '))} · {formatDate(l.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={l.status} />
                    <Badge tone={l.deliveryStatus === 'sent' ? 'emerald' : l.deliveryStatus === 'failed' ? 'red' : 'slate'}>Delivery {titleCase(l.deliveryStatus)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No letters" message="Letters issued to guardians will appear here." icon={FileText} />
          )}
        </Card>
      )}

      {tab === 'communication' && (
        <Card>
          <CardHeader title="Parent messages" subtitle="WhatsApp delivery history" icon={MessageSquare} />
          {data.messages.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                    <th className="px-5 py-2.5 font-semibold">Recipient</th>
                    <th className="px-3 py-2.5 font-semibold">Template</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Attempts</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.messages.map((m) => (
                    <tr key={m._id} className="border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                      <td className="px-5 py-3 font-medium">{m.to}</td>
                      <td className="px-3 py-3 text-slate-500">{titleCase((m.templateKey ?? '').replace(/_/g, ' '))}</td>
                      <td className="px-3 py-3">
                        <Badge tone={m.status === 'sent' ? 'emerald' : m.status === 'failed' || m.status === 'dead_letter' ? 'red' : m.status === 'manual_review' ? 'orange' : 'slate'}>{titleCase(m.status.replace(/_/g, ' '))}</Badge>
                        {m.lastError && <p className="mt-1 max-w-xs text-xs text-slate-400">{m.lastError}</p>}
                      </td>
                      <td className="px-3 py-3 text-slate-500">{m.attempts}</td>
                      <td className="px-5 py-3 text-right text-xs text-slate-400">{formatDateTime(m.sentAt ?? m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No messages" message="Parent messages will appear here after approval." icon={MessageSquare} />
          )}
        </Card>
      )}

      {tab === 'investigations' && (
        <Card>
          <CardHeader title="Investigations" subtitle="Formal case work involving this student" icon={FolderLock} />
          {data.investigations.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {data.investigations.map((i) => (
                <li key={i._id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div><p className="font-medium">{i.title}</p><p className="text-xs text-slate-400">{i.caseNumber} · {titleCase(i.type.replace(/_/g, ' '))}</p></div>
                  <div className="flex items-center gap-2"><span className="text-xs text-slate-400">{formatDate(i.createdAt)}</span><StatusBadge status={i.status} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No investigations" message="Cases opened for this student appear here." />
          )}
        </Card>
      )}

      {tab === 'appeals' && (
        <Card>
          <CardHeader title="Appeals" subtitle="Challenges to conduct decisions" icon={FileText} />
          {data.appeals.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {data.appeals.map((a) => (
                <li key={a._id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{a.appealNumber} · {titleCase(a.decisionType)}</p>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{a.grounds}</p>
                  <p className="text-xs text-slate-400">Submitted {formatDate(a.submittedAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No appeals" message="Appeals linked to this student will appear here." />
          )}
        </Card>
      )}

      {tab === 'safeguarding' && (
        <Card>
          <CardHeader title="Safeguarding cases" subtitle="Restricted to authorised staff" icon={ShieldCheck} />
          {!perms.canViewSafeguarding ? (
            <div className="p-5"><Alert tone="warning" title="Restricted">Safeguarding records require dedicated authorisation. Contact the headteacher if you need access.</Alert></div>
          ) : data.safeguarding.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {data.safeguarding.map((c) => (
                <li key={c._id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div><p className="font-medium">{c.caseNumber}</p><p className="text-xs text-slate-400">{titleCase(c.category)} · {titleCase(c.severity)}</p></div>
                  <div className="flex items-center gap-2"><span className="text-xs text-slate-400">{formatDate(c.createdAt)}</span><StatusBadge status={c.status} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No safeguarding cases" message="Only cases you are assigned to are shown." />
          )}
        </Card>
      )}

      {tab === 'documents' && (
        <Card>
          <CardHeader
            title="Documents"
            subtitle="Certificates, letters and supporting files"
            icon={FolderLock}
            actions={perms.canManageDocuments ? <Button size="sm" icon={Plus} onClick={() => setDocOpen(true)}>Add document</Button> : undefined}
          />
          {s.documents?.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {s.documents.map((d) => (
                <li key={d._id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="font-medium">{d.title}</p>
                    <p className="text-xs text-slate-400">{titleCase(d.type)} · uploaded {formatDate(d.uploadedAt)}{d.notes ? ` · ${d.notes}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-600 hover:underline">Open</a>}
                    {perms.canManageDocuments && (
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => d._id && documentDelete.mutate(d._id)}>Remove</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No documents" message="Upload certificates or supporting documents to the student record." icon={FolderLock} />
          )}
        </Card>
      )}

      {tab === 'activity' && (
        <Card>
          <CardHeader title="Activity timeline" subtitle="Audit events, discipline, ledger and placement changes" icon={Activity} />
          {!perms.canViewActivity ? (
            <div className="p-5"><Alert tone="warning" title="Restricted">You do not have permission to view the student activity timeline.</Alert></div>
          ) : activity.isLoading ? (
            <LoadingBlock label="Loading timeline…" />
          ) : activity.data?.timeline?.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {activity.data.timeline.map((entry, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${entry.type === 'incident' ? 'bg-risk-red' : entry.type === 'recognition' ? 'bg-risk-green' : entry.type === 'ledger' ? 'bg-ochre-500' : 'bg-brand-500'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{titleCase(entry.title.replace(/_/g, ' '))}</p>
                    {entry.detail && <p className="text-xs text-slate-500">{entry.detail}</p>}
                    <p className="text-[11px] text-slate-400">{formatDateTime(entry.at)}{entry.actor ? ` · ${entry.actor}` : ''}</p>
                  </div>
                  <Badge tone="slate">{titleCase(entry.type.replace(/_/g, ' '))}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet" message="Actions taken on this student record will appear here." icon={Activity} />
          )}
        </Card>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit student record"
        subtitle="Identity, admission and current placement"
        size="xl"
        footer={<><Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button><Button loading={editMutation.isPending} onClick={() => editMutation.mutate()}>Save changes</Button></>}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="First name"><Input value={editForm.firstName ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))} /></Field>
          <Field label="Last name"><Input value={editForm.lastName ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))} /></Field>
          <Field label="Other names"><Input value={editForm.otherNames ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, otherNames: e.target.value }))} /></Field>
          <Field label="Gender"><Select value={editForm.gender ?? 'male'} onChange={(e) => setEditForm((f) => ({ ...f, gender: e.target.value }))}><option value="male">Male</option><option value="female">Female</option></Select></Field>
          <Field label="Date of birth"><Input type="date" value={editForm.dateOfBirth ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, dateOfBirth: e.target.value }))} /></Field>
          <Field label="Nationality"><Input value={editForm.nationality ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, nationality: e.target.value }))} /></Field>
          <Field label="National ID"><Input value={editForm.nationalId ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, nationalId: e.target.value }))} /></Field>
          <Field label="Religion"><Input value={editForm.religion ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, religion: e.target.value }))} /></Field>
          <Field label="Blood group"><Input value={editForm.bloodGroup ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, bloodGroup: e.target.value }))} /></Field>
          <Field label="Admission number"><Input value={editForm.admissionNumber ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, admissionNumber: e.target.value }))} /></Field>
          <Field label="Admission type"><Select value={editForm.admissionType ?? 'new'} onChange={(e) => setEditForm((f) => ({ ...f, admissionType: e.target.value }))}><option value="new">New</option><option value="transfer">Transfer</option><option value="reentry">Re-entry</option><option value="other">Other</option></Select></Field>
          <Field label="Previous school"><Input value={editForm.previousSchool ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, previousSchool: e.target.value }))} /></Field>
          <Field label="Boarding status"><Select value={editForm.boardingStatus ?? 'day'} onChange={(e) => setEditForm((f) => ({ ...f, boardingStatus: e.target.value }))}><option value="day">Day</option><option value="boarding">Boarding</option></Select></Field>
          <Field label="Room number"><Input value={editForm.roomNumber ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, roomNumber: e.target.value }))} /></Field>
          <Field label="Photo URL"><Input value={editForm.photoUrl ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, photoUrl: e.target.value }))} /></Field>
          <Field label="Class">
            <Select value={editForm.classId ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, classId: e.target.value, streamId: '' }))}>
              <option value="">Select class</option>
              {structure?.classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Stream">
            <Select value={editForm.streamId ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, streamId: e.target.value }))}>
              <option value="">No stream</option>
              {editStreams.map((st) => <option key={st._id} value={st._id}>{st.name}</option>)}
            </Select>
          </Field>
          <Field label="Dormitory" hint="Boarding students only">
            <Select value={editForm.dormitoryId ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, dormitoryId: e.target.value }))}>
              <option value="">No dormitory</option>
              {structure?.dormitories?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Class teacher">
            <Select value={editForm.classTeacherId ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, classTeacherId: e.target.value }))}>
              <option value="">Unassigned</option>
              {editForm.classTeacherId && !(staff ?? []).some((m) => m.id === editForm.classTeacherId) && (
                <option value={editForm.classTeacherId}>{data.classTeacher?.name ?? 'Current class teacher'}</option>
              )}
              {(staff ?? []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </Select>
          </Field>
          <Field label="Student phone"><Input value={editForm.contactPhone ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, contactPhone: e.target.value }))} /></Field>
          <Field label="Student email"><Input value={editForm.contactEmail ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, contactEmail: e.target.value }))} /></Field>
          <Field label="Residential address" className="sm:col-span-3"><Input value={editForm.contactAddress ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, contactAddress: e.target.value }))} /></Field>
          <div className="sm:col-span-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Additional fields</p>
              <Button
                size="sm"
                variant="ghost"
                icon={Plus}
                disabled={editCustomFields.length >= 30}
                onClick={() => setEditCustomFields((list) => [...list, { label: '', value: '' }])}
              >
                Add field
              </Button>
            </div>
            {editCustomFields.length ? (
              <div className="mt-2 space-y-2">
                {editCustomFields.map((field, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={field.label}
                      placeholder="Field label"
                      className="max-w-[220px]"
                      onChange={(e) => setEditCustomFields((list) => list.map((f, i) => (i === index ? { ...f, label: e.target.value } : f)))}
                    />
                    <Input
                      value={field.value}
                      placeholder="Value"
                      onChange={(e) => setEditCustomFields((list) => list.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)))}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      onClick={() => setEditCustomFields((list) => list.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-400">Record school-specific details such as house, transport route or sponsor.</p>
            )}
          </div>
          <Field label="Medical notes" className="sm:col-span-3"><Textarea value={editForm.medicalNotes ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, medicalNotes: e.target.value }))} /></Field>
          <Field label="Administrative notes" className="sm:col-span-3"><Textarea value={editForm.notes ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
          <Field label="Reason for change" className="sm:col-span-3" hint="Recorded in the audit trail and placement history"><Input value={editForm.reason ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
        </div>
      </Modal>

      <Modal
        open={lifecycleOpen}
        onClose={() => setLifecycleOpen(false)}
        title={LIFECYCLE_LABELS[lifecycleAction]}
        subtitle="Lifecycle changes are audited and recorded in the placement history"
        size="md"
        footer={<><Button variant="ghost" onClick={() => setLifecycleOpen(false)}>Cancel</Button><Button variant={lifecycleAction === 'archive' || lifecycleAction === 'withdraw' ? 'danger' : 'primary'} loading={lifecycleMutation.isPending} disabled={lifecycleForm.reason.trim().length < 3} onClick={() => lifecycleMutation.mutate()}>Apply {titleCase(lifecycleAction)}</Button></>}
      >
        <div className="space-y-3">
          <Field label="Action">
            <Select value={lifecycleAction} onChange={(e) => setLifecycleAction(e.target.value as LifecycleAction)}>
              {allowedLifecycle.map((a) => <option key={a} value={a}>{LIFECYCLE_LABELS[a]}</option>)}
            </Select>
          </Field>
          <Field label="Reason" required hint="At least 3 characters. Stored on the student timeline and audit log.">
            <Textarea value={lifecycleForm.reason} onChange={(e) => setLifecycleForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Why is this change being made?" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Effective date"><Input type="date" value={lifecycleForm.effectiveDate} onChange={(e) => setLifecycleForm((f) => ({ ...f, effectiveDate: e.target.value }))} /></Field>
            {lifecycleAction === 'transfer' && (
              <Field label="Transfer destination"><Input value={lifecycleForm.transferSchool} onChange={(e) => setLifecycleForm((f) => ({ ...f, transferSchool: e.target.value }))} placeholder="Receiving school" /></Field>
            )}
          </div>
          <Field label="Additional notes"><Textarea value={lifecycleForm.notes} onChange={(e) => setLifecycleForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
          {lifecycleAction === 'archive' && <Alert tone="warning" title="Archiving hides the student from default registers">The record remains available to authorised staff and can be restored.</Alert>}
          {lifecycleAction === 'restore' && <Alert tone="info" title="Restore returns the student to their previous status">Conduct and history are preserved.</Alert>}
        </div>
      </Modal>

      <Modal
        open={guardianModal.open}
        onClose={() => setGuardianModal({ open: false, link: null })}
        title={guardianModal.link ? 'Edit guardian' : 'Link a guardian'}
        subtitle="Guardians receive WhatsApp messages when consent is enabled"
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setGuardianModal({ open: false, link: null })}>Cancel</Button><Button loading={guardianMutation.isPending} disabled={!guardianForm.name || guardianForm.phone.length < 9} onClick={() => guardianMutation.mutate()}>{guardianModal.link ? 'Save guardian' : 'Link guardian'}</Button></>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required><Input value={guardianForm.name} onChange={(e) => setGuardianForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Relationship"><Select value={guardianForm.relationship} onChange={(e) => setGuardianForm((f) => ({ ...f, relationship: e.target.value }))}><option>Guardian</option><option>Mother</option><option>Father</option><option>Aunt</option><option>Uncle</option><option>Sibling</option><option>Other</option></Select></Field>
          <Field label="WhatsApp phone" required hint="Rwanda numbers are normalised to +250"><Input value={guardianForm.phone} onChange={(e) => setGuardianForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="Alternative phone"><Input value={guardianForm.altPhone} onChange={(e) => setGuardianForm((f) => ({ ...f, altPhone: e.target.value }))} /></Field>
          <Field label="Email"><Input value={guardianForm.email} onChange={(e) => setGuardianForm((f) => ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Occupation"><Input value={guardianForm.occupation} onChange={(e) => setGuardianForm((f) => ({ ...f, occupation: e.target.value }))} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={guardianForm.address} onChange={(e) => setGuardianForm((f) => ({ ...f, address: e.target.value }))} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-5 rounded-lg bg-slate-50 p-3 text-xs dark:bg-[#0c1524]">
          <Checkbox checked={guardianForm.whatsappConsent} onChange={(v) => setGuardianForm((f) => ({ ...f, whatsappConsent: v }))} label="WhatsApp consent" />
          <Checkbox checked={guardianForm.isPrimary} onChange={(v) => setGuardianForm((f) => ({ ...f, isPrimary: v }))} label="Primary contact" />
          <Checkbox checked={guardianForm.isEmergencyContact} onChange={(v) => setGuardianForm((f) => ({ ...f, isEmergencyContact: v }))} label="Emergency contact" />
        </div>
      </Modal>

      <Modal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        title="Add document"
        subtitle="Record a link or reference for a student document"
        size="md"
        footer={<><Button variant="ghost" onClick={() => setDocOpen(false)}>Cancel</Button><Button loading={documentMutation.isPending} disabled={!docForm.title} onClick={() => documentMutation.mutate()}>Add document</Button></>}
      >
        <div className="grid gap-3">
          <Field label="Title" required><Input value={docForm.title} onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))} /></Field>
          <Field label="Type"><Select value={docForm.type} onChange={(e) => setDocForm((f) => ({ ...f, type: e.target.value }))}><option value="certificate">Certificate</option><option value="report">Report</option><option value="letter">Letter</option><option value="medical">Medical</option><option value="identification">Identification</option><option value="other">Other</option></Select></Field>
          <Field label="URL" hint="Optional link to the stored file"><Input value={docForm.url} onChange={(e) => setDocForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://…" /></Field>
          <Field label="Notes"><Textarea value={docForm.notes} onChange={(e) => setDocForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
      </Modal>
    </div>
  )
}

function Info({ label, value, multiline }: { label: string; value?: string | null; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`mt-0.5 font-medium ${multiline ? 'whitespace-pre-wrap text-slate-600 dark:text-slate-300' : ''}`}>{value || '—'}</dd>
    </div>
  )
}
