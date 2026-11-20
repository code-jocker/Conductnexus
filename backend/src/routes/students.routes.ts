import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, queryOf, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import {
  ClassModel,
  Dormitory,
  GuardianLink,
  Parent,
  Stream,
  Student,
  type IStudent,
  type StudentStatus,
} from '../models/school.js'
import { Incident, DisciplineLedger, RiskAssessment } from '../models/discipline.js'
import { FollowUp, Intervention, Recognition } from '../models/support.js'
import { Letter, Meeting, MessageQueue } from '../models/communications.js'
import { Appeal, Investigation, SafeguardingCase } from '../models/governance.js'
import { AuditLog } from '../models/governance.js'
import { User } from '../models/core.js'
import { assertStudentAccess, hasPermission, hasRole, safeguardingCaseAccess, visibleStudentQuery } from '../services/rbac.service.js'
import { ensureInitialAllocation, studentConductSummary } from '../services/ledger.service.js'
import { getActiveAcademicYear, getActiveTerm, resolveTerm } from '../services/academic.service.js'
import { nextRef } from '../shared/refs.js'
import { writeAudit } from '../services/audit.service.js'
import { toCsv } from '../services/reports.service.js'
import { normalizeRwandaPhone } from '../shared/utils.js'
import { objectId, paginationQuery, searchRegex } from './helpers.js'

const router = Router()
router.use(authenticate)

const STUDENT_STATUSES = [
  'active',
  'suspended',
  'transferred',
  'withdrawn',
  'graduated',
  'expelled',
  'archived',
] as const

const LIFECYCLE_ACTIONS = ['suspend', 'reinstate', 'transfer', 'withdraw', 'graduate', 'archive', 'restore'] as const
type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number]

const studentListQuery = paginationQuery.extend({
  classId: objectId.optional(),
  streamId: objectId.optional(),
  dormitoryId: objectId.optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  risk: z.enum(['green', 'yellow', 'orange', 'red']).optional(),
  gender: z.enum(['male', 'female']).optional(),
  boardingStatus: z.enum(['day', 'boarding']).optional(),
  minBalance: z.coerce.number().optional(),
  maxBalance: z.coerce.number().optional(),
  sort: z.enum(['name', 'balance', 'admitted', 'risk']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  termId: objectId.optional(),
  includeArchived: z.coerce.boolean().optional(),
  ids: z.string().trim().max(4000).optional(),
})

const guardianSchema = z.object({
  existingParentId: objectId.optional(),
  name: z.string().trim().min(2).max(120).optional(),
  relationship: z.string().trim().max(60).optional().default('Guardian'),
  phone: z.string().trim().min(9).optional(),
  altPhone: z.string().trim().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
  occupation: z.string().trim().max(120).optional(),
  nationalId: z.string().trim().max(40).optional(),
  preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'call']).optional().default('whatsapp'),
  whatsappConsent: z.boolean().optional().default(true),
  smsConsent: z.boolean().optional().default(false),
  emailConsent: z.boolean().optional().default(false),
  isPrimary: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional().default(false),
  notes: z.string().trim().max(1000).optional(),
})

const optionalDateString = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date')

const studentContactSchema = z.object({
  phone: z.string().trim().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
})

const customFieldSchema = z.object({
  label: z.string().trim().min(1).max(60),
  value: z.string().trim().max(500).optional().default(''),
})

const studentCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  otherNames: z.string().trim().max(80).optional(),
  gender: z.enum(['male', 'female']),
  dateOfBirth: optionalDateString,
  nationality: z.string().trim().max(80).optional(),
  nationalId: z.string().trim().max(40).optional(),
  religion: z.string().trim().max(60).optional(),
  bloodGroup: z.string().trim().max(10).optional(),
  classId: objectId,
  streamId: objectId.optional().nullable(),
  dormitoryId: objectId.optional().nullable(),
  classTeacherId: objectId.optional().nullable(),
  admissionDate: optionalDateString,
  admissionType: z.enum(['new', 'transfer', 'reentry', 'other']).optional().default('new'),
  previousSchool: z.string().trim().max(160).optional(),
  previousClass: z.string().trim().max(80).optional(),
  boardingStatus: z.enum(['day', 'boarding']).optional().default('day'),
  roomNumber: z.string().trim().max(30).optional(),
  emergencyContact: z
    .object({
      name: z.string().trim().max(120).optional(),
      relationship: z.string().trim().max(60).optional(),
      phone: z.string().trim().max(30).optional(),
    })
    .optional(),
  medicalNotes: z.string().trim().max(2000).optional(),
  studentId: z.string().trim().max(30).optional(),
  admissionNumber: z.string().trim().max(30).optional(),
  photoUrl: z.string().url().optional().or(z.literal('')),
  contact: studentContactSchema.optional(),
  customFields: z.array(customFieldSchema).max(30).optional(),
  notes: z.string().trim().max(2000).optional(),
  guardians: z.array(guardianSchema).max(5).optional(),
  parent: guardianSchema.extend({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(9) }).optional(),
})

const studentPatchSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  otherNames: z.string().trim().max(80).optional(),
  gender: z.enum(['male', 'female']).optional(),
  dateOfBirth: optionalDateString,
  nationality: z.string().trim().max(80).optional(),
  nationalId: z.string().trim().max(40).optional(),
  religion: z.string().trim().max(60).optional(),
  bloodGroup: z.string().trim().max(10).optional(),
  admissionNumber: z.string().trim().max(30).optional(),
  admissionDate: optionalDateString,
  admissionType: z.enum(['new', 'transfer', 'reentry', 'other']).optional(),
  previousSchool: z.string().trim().max(160).optional(),
  previousClass: z.string().trim().max(80).optional(),
  boardingStatus: z.enum(['day', 'boarding']).optional(),
  roomNumber: z.string().trim().max(30).optional(),
  emergencyContact: z
    .object({
      name: z.string().trim().max(120).optional(),
      relationship: z.string().trim().max(60).optional(),
      phone: z.string().trim().max(30).optional(),
    })
    .optional(),
  medicalNotes: z.string().trim().max(2000).optional(),
  classId: objectId.optional(),
  streamId: objectId.optional().nullable(),
  dormitoryId: objectId.optional().nullable(),
  classTeacherId: objectId.optional().nullable(),
  photoUrl: z.string().url().optional().or(z.literal('')),
  contact: studentContactSchema.optional(),
  customFields: z.array(customFieldSchema).max(30).optional(),
  notes: z.string().trim().max(2000).optional(),
  reason: z.string().trim().max(400).optional(),
})

async function validateClassPlacement(classId: string, streamId?: string | null) {
  const cls = await ClassModel.findById(classId)
  if (!cls || !cls.active) throw ApiError.badRequest('Select an active class')
  if (streamId) {
    const stream = await Stream.findById(streamId)
    if (!stream || !stream.active) throw ApiError.badRequest('Select an active stream')
    if (stream.level !== cls.level) throw ApiError.badRequest('The selected stream does not match the class level')
  }
  if (cls.streamId && streamId && String(cls.streamId) !== String(streamId)) {
    throw ApiError.badRequest('The selected stream does not match this class')
  }
  return cls
}

async function attachGuardian(
  student: IStudent,
  input: z.infer<typeof guardianSchema>,
  actorId: Types.ObjectId,
): Promise<{ linkId: string; parentId: string }> {
  let parent = null
  if (input.existingParentId) {
    parent = await Parent.findById(input.existingParentId)
    if (!parent) throw ApiError.badRequest('Selected guardian was not found')
    const updates: Record<string, unknown> = {}
    if (input.name) updates.name = input.name
    if (input.relationship) updates.relationship = input.relationship
    if (input.phone) updates.phone = normalizeRwandaPhone(input.phone)
    if (input.altPhone !== undefined) updates.altPhone = input.altPhone ? normalizeRwandaPhone(input.altPhone) : undefined
    if (input.email !== undefined) updates.email = input.email || undefined
    if (input.address !== undefined) updates.address = input.address
    if (input.occupation !== undefined) updates.occupation = input.occupation
    if (input.nationalId !== undefined) updates.nationalId = input.nationalId
    if (input.preferredChannel) updates.preferredChannel = input.preferredChannel
    if (input.whatsappConsent !== undefined) updates.whatsappConsent = input.whatsappConsent
    if (input.smsConsent !== undefined) updates.smsConsent = input.smsConsent
    if (input.emailConsent !== undefined) updates.emailConsent = input.emailConsent
    if (Object.keys(updates).length) await Parent.updateOne({ _id: parent._id }, { $set: updates })
  } else {
    if (!input.name || !input.phone) throw ApiError.badRequest('Provide the guardian name and phone number')
    const phone = normalizeRwandaPhone(input.phone)
    parent = await Parent.findOne({ phone })
    if (!parent) {
      parent = await Parent.create({
        name: input.name,
        relationship: input.relationship ?? 'Guardian',
        phone,
        altPhone: input.altPhone ? normalizeRwandaPhone(input.altPhone) : undefined,
        email: input.email || undefined,
        address: input.address,
        occupation: input.occupation,
        nationalId: input.nationalId,
        preferredChannel: input.preferredChannel ?? 'whatsapp',
        whatsappConsent: input.whatsappConsent ?? true,
        smsConsent: input.smsConsent ?? false,
        emailConsent: input.emailConsent ?? false,
        createdBy: actorId,
      })
    } else if (input.name && !parent.name) {
      parent.name = input.name
    }
  }

  if (input.isPrimary) {
    await GuardianLink.updateMany({ studentId: student._id, parentId: { $ne: parent._id } }, { $set: { isPrimary: false } })
  }
  const existingCount = await GuardianLink.countDocuments({ studentId: student._id })
  const setFields: Record<string, unknown> = {
    relationship: input.relationship ?? 'Guardian',
    isEmergencyContact: input.isEmergencyContact ?? false,
    notes: input.notes,
  }
  if (input.isPrimary !== undefined) setFields.isPrimary = input.isPrimary
  const insertFields: Record<string, unknown> = { studentId: student._id, parentId: parent._id }
  if (input.isPrimary === undefined) insertFields.isPrimary = existingCount === 0
  const link = await GuardianLink.findOneAndUpdate(
    { studentId: student._id, parentId: parent._id },
    { $set: setFields, $setOnInsert: insertFields },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return { linkId: String(link._id), parentId: String(parent._id) }
}

async function registerStudent(
  input: z.infer<typeof studentCreateSchema>,
  actor: { userId: Types.ObjectId; name: string; roles: string[] },
) {
  const cls = await validateClassPlacement(input.classId, input.streamId)
  if (input.dormitoryId && !(await Dormitory.exists({ _id: input.dormitoryId, active: true }))) {
    throw ApiError.badRequest('Select an active dormitory')
  }
  if (input.classTeacherId && !(await User.exists({ _id: input.classTeacherId, status: 'active' }))) {
    throw ApiError.badRequest('Select an active class teacher')
  }
  const [year, term] = await Promise.all([getActiveAcademicYear(), getActiveTerm()])
  const requestedStudentId = input.studentId?.trim()
  const requestedAdmissionNumber = input.admissionNumber?.trim()
  if (requestedStudentId && (await Student.exists({ studentId: requestedStudentId }))) {
    throw ApiError.conflict('A student with this student ID already exists')
  }
  if (requestedAdmissionNumber && (await Student.exists({ admissionNumber: requestedAdmissionNumber }))) {
    throw ApiError.conflict('A student with this admission number already exists')
  }
  let studentId = requestedStudentId ?? ''
  let admissionNumber = requestedAdmissionNumber ?? ''
  if (!requestedStudentId || !requestedAdmissionNumber) {
    let allocated = false
    // Counters can lag behind IDs created by seeds or imports, so skip anything already taken.
    for (let attempt = 0; attempt < 100 && !allocated; attempt++) {
      if (!requestedStudentId) studentId = await nextRef('STD', 4)
      if (!requestedAdmissionNumber) admissionNumber = await nextRef('ADM', 4)
      allocated = !(await Student.exists({ $or: [{ studentId }, { admissionNumber }] }))
    }
    if (!allocated) throw ApiError.conflict('Could not allocate a unique student ID. Enter one manually.')
  }
  const fullName = [input.firstName, input.otherNames, input.lastName].filter(Boolean).join(' ')
  const student = await Student.create({
    studentId,
    admissionNumber,
    firstName: input.firstName,
    lastName: input.lastName,
    otherNames: input.otherNames,
    fullName,
    gender: input.gender,
    dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
    nationality: input.nationality,
    nationalId: input.nationalId,
    religion: input.religion,
    bloodGroup: input.bloodGroup,
    classId: cls._id,
    streamId: input.streamId ?? cls.streamId ?? null,
    dormitoryId: input.dormitoryId ?? null,
    classTeacherId: input.classTeacherId ?? null,
    academicYearId: year._id,
    termId: term._id,
    currentTermId: term._id,
    status: 'active',
    admissionDate: input.admissionDate ? new Date(input.admissionDate) : new Date(),
    admissionType: input.admissionType ?? 'new',
    previousSchool: input.previousSchool,
    previousClass: input.previousClass,
    boardingStatus: input.boardingStatus ?? (input.dormitoryId ? 'boarding' : 'day'),
    roomNumber: input.roomNumber,
    emergencyContact: input.emergencyContact,
    medicalNotes: input.medicalNotes,
    currentBalance: 0,
    riskLevel: 'green',
    photoUrl: input.photoUrl || undefined,
    contact: input.contact,
    customFields: input.customFields ?? [],
    notes: input.notes,
    createdBy: actor.userId,
    enrollmentHistory: [
      {
        academicYearId: year._id,
        termId: term._id,
        classId: cls._id,
        streamId: input.streamId ?? cls.streamId ?? undefined,
        dormitoryId: input.dormitoryId ?? undefined,
        action: 'enrolled',
        reason: `Admitted as ${input.admissionType ?? 'new'} student`,
        at: new Date(),
        by: actor.userId,
      },
    ],
  })
  await ensureInitialAllocation(student, term, { userId: actor.userId, name: actor.name, roles: actor.roles })
  const guardians = [...(input.guardians ?? [])]
  if (input.parent) guardians.push(input.parent)
  for (const guardian of guardians) await attachGuardian(student, guardian, actor.userId)
  return student
}

async function findDuplicateStudent(
  input: z.infer<typeof studentCreateSchema>,
  fullName: string,
): Promise<{ field: string; value: string; studentId?: string; fullName?: string } | null> {
  for (const [field, value] of [
    ['studentId', input.studentId?.trim()],
    ['admissionNumber', input.admissionNumber?.trim()],
    ['nationalId', input.nationalId?.trim()],
  ] as const) {
    if (!value) continue
    const existing = await Student.findOne({ [field]: value }).select('studentId fullName').lean()
    if (existing) {
      return { field, value, studentId: existing.studentId, fullName: existing.fullName }
    }
  }
  const escaped = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const nameClash = await Student.findOne({
    fullName: new RegExp(`^${escaped}$`, 'i'),
    classId: input.classId,
  })
    .select('studentId fullName')
    .lean()
  if (nameClash) {
    return { field: 'fullName', value: fullName, studentId: nameClash.studentId, fullName: nameClash.fullName }
  }
  return null
}

router.get(
  '/students',
  requirePermission('students.view'),
  validate({ query: studentListQuery }),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const { page, pageSize, skip } = parsePagination(req.query)
    const q = queryOf<z.infer<typeof studentListQuery>>(req)
    const visibility = await visibleStudentQuery(ctx)
    const filter: Record<string, unknown> = { ...visibility }
    if (q.classId) filter.classId = new Types.ObjectId(q.classId)
    if (q.streamId) filter.streamId = new Types.ObjectId(q.streamId)
    if (q.dormitoryId) filter.dormitoryId = new Types.ObjectId(q.dormitoryId)
    if (q.status) filter.status = q.status
    else if (!q.includeArchived) filter.status = { $in: ['active', 'suspended'] }
    if (q.risk) filter.riskLevel = q.risk
    if (q.gender) filter.gender = q.gender
    if (q.boardingStatus) filter.boardingStatus = q.boardingStatus
    if (q.minBalance !== undefined || q.maxBalance !== undefined) {
      filter.currentBalance = {
        ...(q.minBalance !== undefined ? { $gte: q.minBalance } : {}),
        ...(q.maxBalance !== undefined ? { $lte: q.maxBalance } : {}),
      }
    }
    if (q.q) {
      const textFilter = { $text: { $search: q.q } }
      if (visibility.$or) {
        filter.$and = [{ $or: visibility.$or }, textFilter]
        delete filter.$or
      } else {
        filter.$text = { $search: q.q }
      }
    }
    const dir = q.sortDir === 'desc' ? -1 : 1
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      name: { lastName: dir, firstName: dir },
      balance: { currentBalance: dir, lastName: 1 },
      admitted: { admissionDate: dir, lastName: 1 },
      risk: { riskLevel: dir, lastName: 1 },
    }
    const [total, students] = await Promise.all([
      Student.countDocuments(filter),
      Student.find(filter)
        .sort(sortMap[q.sort ?? 'name'] ?? { lastName: 1, firstName: 1 })
        .skip(skip)
        .limit(pageSize)
        .populate('classId', 'name level')
        .populate('streamId', 'name code')
        .populate('dormitoryId', 'name code')
        .populate('classTeacherId', 'name position')
        .lean(),
    ])
    ok(
      res,
      students.map((s) => ({ ...s, id: String(s._id) })),
      pagedMeta(total, page, pageSize),
    )
  }),
)

router.get(
  '/students/export',
  requirePermission('students.export'),
  validate({ query: studentListQuery }),
  asyncHandler(async (req, res) => {
    const q = queryOf<z.infer<typeof studentListQuery>>(req)
    const visibility = await visibleStudentQuery(req.auth!)
    const filter: Record<string, unknown> = { ...visibility }
    if (q.classId) filter.classId = new Types.ObjectId(q.classId)
    if (q.streamId) filter.streamId = new Types.ObjectId(q.streamId)
    if (q.status) filter.status = q.status
    else if (!q.includeArchived) filter.status = { $ne: 'archived' }
    if (q.ids) {
      const ids = q.ids.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 1000)
      filter._id = { $in: ids.filter((value) => Types.ObjectId.isValid(value)).map((value) => new Types.ObjectId(value)) }
    }
    const students = await Student.find(filter)
      .populate('classId', 'name')
      .populate('streamId', 'name')
      .populate('dormitoryId', 'name')
      .lean()
    const rows = students.map((s) => {
      const cls = s.classId as unknown as { name?: string }
      const stream = s.streamId as unknown as { name?: string }
      const dorm = s.dormitoryId as unknown as { name?: string }
      return {
        studentId: s.studentId,
        admissionNumber: s.admissionNumber,
        fullName: s.fullName,
        gender: s.gender,
        dateOfBirth: s.dateOfBirth ? new Date(s.dateOfBirth).toISOString().slice(0, 10) : '',
        className: cls?.name ?? '',
        stream: stream?.name ?? '',
        dormitory: dorm?.name ?? '',
        boardingStatus: s.boardingStatus ?? '',
        admissionType: s.admissionType ?? '',
        status: s.status,
        conductBalance: s.currentBalance,
        riskLevel: s.riskLevel,
      }
    })
    const csv = toCsv(rows)
    await writeAudit({ req, actor: req.auth, action: 'students.exported', resourceType: 'Student', after: { rows: rows.length } })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="conductnexus-students-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(csv)
  }),
)

router.post(
  '/students',
  requirePermission('students.create'),
  validate({ body: studentCreateSchema }),
  asyncHandler(async (req, res) => {
    const student = await registerStudent(req.body, req.auth!)
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.created',
      resourceType: 'Student',
      resourceId: String(student._id),
      after: {
        fullName: student.fullName,
        studentId: student.studentId,
        classId: String(student.classId),
        admissionType: student.admissionType,
        balance: student.currentBalance,
      },
    })
    created(res, student)
  }),
)

router.post(
  '/students/import',
  requirePermission('students.import'),
  validate({
    body: z.object({
      rows: z.array(z.unknown()).min(1).max(500),
      dryRun: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const dryRun = Boolean(req.body.dryRun)
    type ImportResult = {
      index: number
      ok: boolean
      studentId?: string
      fullName?: string
      errors?: string[]
      duplicate?: { field: string; value: string; studentId?: string; fullName?: string }
    }
    const results: ImportResult[] = []
    for (let i = 0; i < req.body.rows.length; i++) {
      const parsed = studentCreateSchema.safeParse(req.body.rows[i])
      if (!parsed.success) {
        results.push({
          index: i,
          ok: false,
          errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`),
        })
        continue
      }
      const row = parsed.data
      const fullName = [row.firstName, row.otherNames, row.lastName].filter(Boolean).join(' ')
      try {
        const duplicate = await findDuplicateStudent(row, fullName)
        if (duplicate) {
          results.push({ index: i, ok: false, fullName, duplicate })
          continue
        }
        if (dryRun) {
          await validateClassPlacement(row.classId, row.streamId)
          results.push({ index: i, ok: true, fullName })
          continue
        }
        const student = await registerStudent(row, req.auth!)
        results.push({ index: i, ok: true, studentId: String(student._id), fullName })
      } catch (err) {
        results.push({
          index: i,
          ok: false,
          fullName,
          errors: [err instanceof Error ? err.message : 'Registration failed'],
        })
      }
    }
    const imported = results.filter((r) => r.ok).length
    if (!dryRun) {
      await writeAudit({
        req,
        actor: req.auth,
        action: 'students.imported',
        resourceType: 'Student',
        after: { imported, failed: results.length - imported },
      })
    }
    ok(res, {
      dryRun,
      total: results.length,
      valid: imported,
      invalid: results.length - imported,
      imported: dryRun ? 0 : imported,
      failed: results.length - imported,
      results,
    })
  }),
)

router.get(
  '/students/:id',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    await student.populate([
      { path: 'classId', select: 'name level streamId' },
      { path: 'streamId', select: 'name code' },
      { path: 'dormitoryId', select: 'name code' },
      { path: 'classTeacherId', select: 'name position email' },
    ])
    const links = await GuardianLink.find({ studentId: student._id })
      .populate('parentId', 'name relationship phone altPhone email address occupation preferredChannel whatsappConsent smsConsent emailConsent verificationStatus')
      .lean()
    ok(res, { ...student.toJSON(), id: String(student._id), guardians: links })
  }),
)

router.get(
  '/students/:id/profile',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const student = await assertStudentAccess(ctx, req.params.id)
    const term = await resolveTerm(req.query.termId as string | undefined)
    const canViewSafeguarding = hasPermission(ctx, 'safeguarding.view')

    const [
      cls,
      stream,
      dorm,
      classTeacher,
      guardianLinks,
      incidents,
      ledger,
      assessments,
      interventions,
      followUps,
      recognitions,
      summary,
      letters,
      messages,
      investigations,
      appeals,
      safeguarding,
      meetings,
    ] = await Promise.all([
      ClassModel.findById(student.classId).lean(),
      student.streamId ? Stream.findById(student.streamId).lean() : null,
      student.dormitoryId ? Dormitory.findById(student.dormitoryId).lean() : null,
      student.classTeacherId ? User.findById(student.classTeacherId).select('name position email').lean() : null,
      GuardianLink.find({ studentId: student._id })
        .populate('parentId', 'name relationship phone altPhone email address occupation preferredChannel whatsappConsent smsConsent emailConsent verificationStatus verifiedAt')
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean(),
      Incident.find({ studentId: student._id }).sort({ occurredAt: -1 }).limit(50).populate('reportedBy', 'name').lean(),
      DisciplineLedger.find({ studentId: student._id, termId: term._id }).sort({ createdAt: -1 }).lean(),
      RiskAssessment.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(20).lean(),
      Intervention.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(20).lean(),
      FollowUp.find({ studentId: student._id }).sort({ dueDate: 1 }).limit(20).lean(),
      Recognition.find({ studentId: student._id }).sort({ awardedAt: -1 }).limit(20).lean(),
      studentConductSummary(String(student._id), String(term._id)),
      Letter.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(25).lean(),
      MessageQueue.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(25).lean(),
      Investigation.find({ studentId: student._id })
        .select('caseNumber title type status assignedTo deadline createdAt updatedAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Appeal.find({ studentId: student._id }).sort({ submittedAt: -1 }).limit(20).lean(),
      canViewSafeguarding
        ? SafeguardingCase.find({ studentId: student._id })
            .select('caseNumber category severity status reportedBy assignedTo deadline createdAt')
            .sort({ createdAt: -1 })
            .limit(20)
            .lean()
        : Promise.resolve([]),
      Meeting.find({ studentId: student._id }).sort({ scheduledAt: -1 }).limit(20).lean(),
    ])

    const visibleSafeguarding = canViewSafeguarding
      ? (
          await Promise.all(
            safeguarding.map(async (c) => ((await safeguardingCaseAccess(ctx, c)) ? c : null)),
          )
        ).filter(Boolean)
      : []

    await writeAudit({ req, actor: ctx, action: 'student.profile_viewed', resourceType: 'Student', resourceId: String(student._id) })

    ok(res, {
      student: {
        ...student.toJSON(),
        id: String(student._id),
        placementHistory: [...student.enrollmentHistory].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
      },
      class: cls,
      stream,
      dormitory: dorm,
      classTeacher,
      guardians: guardianLinks,
      conduct: { ...summary, term },
      ledger,
      incidents,
      assessments,
      interventions,
      followUps,
      recognitions,
      letters,
      messages,
      investigations,
      appeals,
      safeguarding: visibleSafeguarding,
      meetings,
      permissions: {
        canEdit: hasPermission(ctx, 'students.update'),
        canManageGuardians: hasPermission(ctx, 'students.manage_guardians'),
        canManageDocuments: hasPermission(ctx, 'students.documents'),
        canLifecycle: hasPermission(ctx, 'students.lifecycle'),
        canArchive: hasPermission(ctx, 'students.archive'),
        canDelete: hasPermission(ctx, 'students.archive'),
        canRestore: hasPermission(ctx, 'students.restore'),
        canPromote: hasPermission(ctx, 'students.promote'),
        canViewLedger: hasPermission(ctx, 'marks.view'),
        canViewSafeguarding: canViewSafeguarding,
        canViewActivity: hasPermission(ctx, 'students.activity.view'),
      },
    })
  }),
)

router.get(
  '/students/:id/activity',
  requirePermission('students.activity.view'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const [audits, incidents, ledger, recognitions, interventions, followUps] = await Promise.all([
      AuditLog.find({ $or: [{ resourceType: 'Student', resourceId: String(student._id) }, { action: { $in: ['student.lifecycle', 'student.promoted', 'student.archived'] }, 'after.studentId': student.studentId }] })
        .sort({ createdAt: -1 })
        .limit(120)
        .lean(),
      Incident.find({ studentId: student._id }).select('incidentNumber offenceSnapshot severity status occurredAt createdAt').sort({ createdAt: -1 }).limit(60).lean(),
      DisciplineLedger.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(120).lean(),
      Recognition.find({ studentId: student._id }).select('title category awardedAt awardedBy').sort({ awardedAt: -1 }).limit(40).lean(),
      Intervention.find({ studentId: student._id }).select('type status startDate createdAt').sort({ createdAt: -1 }).limit(30).lean(),
      FollowUp.find({ studentId: student._id }).select('type dueDate status createdAt').sort({ createdAt: -1 }).limit(30).lean(),
    ])

    type Entry = { type: string; title: string; detail?: string; at: Date; actor?: string; ref?: string }
    const entries: Entry[] = []
    for (const a of audits) {
      entries.push({ type: 'audit', title: a.action, detail: a.reason ?? undefined, at: a.createdAt as Date, actor: a.actorName, ref: a.resourceId })
    }
    for (const i of incidents) {
      entries.push({
        type: 'incident',
        title: `${i.incidentNumber} — ${i.offenceSnapshot?.name ?? 'Incident'}`,
        detail: `${i.status} · ${i.severity}`,
        at: i.occurredAt as Date,
        ref: String(i._id),
      })
    }
    for (const l of ledger) {
      entries.push({
        type: 'ledger',
        title: `${l.type.replace(/_/g, ' ')} ${l.change > 0 ? '+' : ''}${l.change}`,
        detail: l.reason,
        at: l.createdAt as Date,
        ref: String(l._id),
      })
    }
    for (const r of recognitions) {
      entries.push({ type: 'recognition', title: r.title, detail: r.category, at: r.awardedAt as Date, ref: String(r._id) })
    }
    for (const i of interventions) {
      entries.push({ type: 'intervention', title: i.title, detail: i.status, at: i.startDate as Date, ref: String(i._id) })
    }
    for (const f of followUps) {
      entries.push({ type: 'follow_up', title: f.type.replace(/_/g, ' '), detail: f.status, at: f.dueDate as Date, ref: String(f._id) })
    }
    for (const h of student.enrollmentHistory) {
      entries.push({
        type: 'placement',
        title: h.action.replace(/_/g, ' '),
        detail: h.reason,
        at: h.at,
        ref: h.classId ? String(h.classId) : undefined,
      })
    }
    entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    ok(res, { student: { id: String(student._id), fullName: student.fullName }, timeline: entries.slice(0, 200) })
  }),
)

router.get(
  '/students/:id/history',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const [incidents, ledger, assessments, recognitions] = await Promise.all([
      Incident.find({ studentId: student._id }).sort({ occurredAt: -1 }).limit(200).lean(),
      DisciplineLedger.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(500).lean(),
      RiskAssessment.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(100).lean(),
      Recognition.find({ studentId: student._id }).sort({ awardedAt: -1 }).limit(100).lean(),
    ])
    ok(res, {
      student: {
        id: String(student._id),
        fullName: student.fullName,
        status: student.status,
        placementHistory: [...student.enrollmentHistory].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
      },
      incidents,
      ledger,
      assessments,
      recognitions,
    })
  }),
)

router.get(
  '/students/:id/ledger',
  requirePermission('marks.view'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const term = await resolveTerm(req.query.termId as string | undefined)
    ok(res, {
      ...(await studentConductSummary(String(student._id), String(term._id))),
      term,
      student: { id: String(student._id), fullName: student.fullName, currentBalance: student.currentBalance },
    })
  }),
)

router.patch(
  '/students/:id',
  requirePermission('students.update'),
  validate({ body: studentPatchSchema }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const before = {
      fullName: student.fullName,
      classId: String(student.classId),
      streamId: student.streamId ? String(student.streamId) : null,
      dormitoryId: student.dormitoryId ? String(student.dormitoryId) : null,
      status: student.status,
    }
    const nextClassId = req.body.classId ?? String(student.classId)
    const nextStreamId = req.body.streamId !== undefined ? req.body.streamId : student.streamId ? String(student.streamId) : null
    if (req.body.classId || req.body.streamId !== undefined) await validateClassPlacement(nextClassId, nextStreamId)
    if (req.body.dormitoryId && !(await Dormitory.exists({ _id: req.body.dormitoryId, active: true }))) {
      throw ApiError.badRequest('Select an active dormitory')
    }
    if (req.body.classTeacherId && !(await User.exists({ _id: req.body.classTeacherId, status: 'active' }))) {
      throw ApiError.badRequest('Select an active class teacher')
    }
    if (req.body.admissionNumber && req.body.admissionNumber !== student.admissionNumber) {
      if (await Student.exists({ _id: { $ne: student._id }, admissionNumber: req.body.admissionNumber })) {
        throw ApiError.conflict('A student with this admission number already exists')
      }
      student.admissionNumber = req.body.admissionNumber
    }
    if (req.body.firstName || req.body.lastName || req.body.otherNames !== undefined) {
      const first = req.body.firstName ?? student.firstName
      const last = req.body.lastName ?? student.lastName
      const other = req.body.otherNames !== undefined ? req.body.otherNames : student.otherNames
      student.fullName = [first, other, last].filter(Boolean).join(' ')
    }
    if (req.body.firstName) student.firstName = req.body.firstName
    if (req.body.lastName) student.lastName = req.body.lastName
    if (req.body.otherNames !== undefined) student.otherNames = req.body.otherNames || undefined
    if (req.body.gender) student.gender = req.body.gender
    if (req.body.dateOfBirth) student.dateOfBirth = new Date(req.body.dateOfBirth)
    if (req.body.nationality !== undefined) student.nationality = req.body.nationality || undefined
    if (req.body.nationalId !== undefined) student.nationalId = req.body.nationalId || undefined
    if (req.body.religion !== undefined) student.religion = req.body.religion || undefined
    if (req.body.bloodGroup !== undefined) student.bloodGroup = req.body.bloodGroup || undefined
    if (req.body.admissionDate) student.admissionDate = new Date(req.body.admissionDate)
    if (req.body.admissionType) student.admissionType = req.body.admissionType
    if (req.body.previousSchool !== undefined) student.previousSchool = req.body.previousSchool || undefined
    if (req.body.previousClass !== undefined) student.previousClass = req.body.previousClass || undefined
    if (req.body.boardingStatus) student.boardingStatus = req.body.boardingStatus
    if (req.body.roomNumber !== undefined) student.roomNumber = req.body.roomNumber || undefined
    if (req.body.emergencyContact !== undefined) student.emergencyContact = req.body.emergencyContact
    if (req.body.medicalNotes !== undefined) student.medicalNotes = req.body.medicalNotes || undefined
    if (req.body.photoUrl !== undefined) student.photoUrl = req.body.photoUrl || undefined
    if (req.body.contact !== undefined) {
      student.contact = {
        phone: req.body.contact.phone || undefined,
        email: req.body.contact.email || undefined,
        address: req.body.contact.address || undefined,
      }
    }
    if (req.body.customFields !== undefined) {
      student.customFields = (req.body.customFields as { label: string; value?: string }[] ?? []).map((field) => ({
        label: field.label,
        value: field.value ?? '',
      }))
    }
    if (req.body.notes !== undefined) student.notes = req.body.notes
    if (req.body.classTeacherId !== undefined) {
      student.classTeacherId = req.body.classTeacherId ? new Types.ObjectId(req.body.classTeacherId) : null
    }
    const placementChanged =
      before.classId !== nextClassId ||
      before.streamId !== (nextStreamId ?? null) ||
      before.dormitoryId !== (req.body.dormitoryId !== undefined ? req.body.dormitoryId : before.dormitoryId)
    if (placementChanged) {
      student.classId = new Types.ObjectId(nextClassId)
      student.streamId = nextStreamId ? new Types.ObjectId(nextStreamId) : null
      if (req.body.dormitoryId !== undefined) student.dormitoryId = req.body.dormitoryId ? new Types.ObjectId(req.body.dormitoryId) : null
      if (req.body.boardingStatus === undefined && req.body.dormitoryId !== undefined) {
        student.boardingStatus = req.body.dormitoryId ? 'boarding' : 'day'
      }
      student.enrollmentHistory.push({
        academicYearId: student.academicYearId ?? undefined,
        termId: student.currentTermId ?? undefined,
        classId: student.classId,
        streamId: student.streamId,
        dormitoryId: student.dormitoryId,
        action: 'placement_changed',
        reason: req.body.reason,
        at: new Date(),
        by: req.auth!.userId,
      })
    }
    await student.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.updated',
      resourceType: 'Student',
      resourceId: String(student._id),
      before,
      after: { ...req.body, status: student.status },
      reason: req.body.reason,
    })
    ok(res, student)
  }),
)

const lifecycleBody = z.object({
  action: z.enum(LIFECYCLE_ACTIONS),
  reason: z.string().trim().min(3).max(1000),
  effectiveDate: optionalDateString,
  transferSchool: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
})

const LIFECYCLE_PERMISSION: Record<LifecycleAction, string> = {
  suspend: 'students.lifecycle',
  reinstate: 'students.lifecycle',
  transfer: 'students.lifecycle',
  withdraw: 'students.lifecycle',
  graduate: 'students.lifecycle',
  archive: 'students.archive',
  restore: 'students.restore',
}

const ALLOWED_FROM: Record<LifecycleAction, StudentStatus[]> = {
  suspend: ['active'],
  reinstate: ['suspended'],
  transfer: ['active', 'suspended'],
  withdraw: ['active', 'suspended'],
  graduate: ['active', 'suspended'],
  archive: ['active', 'suspended', 'transferred', 'withdrawn', 'graduated', 'expelled'],
  restore: ['archived'],
}

router.post(
  '/students/:id/lifecycle',
  validate({ body: lifecycleBody }),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const body = req.body as z.infer<typeof lifecycleBody>
    const action = body.action as LifecycleAction
    if (!hasPermission(ctx, LIFECYCLE_PERMISSION[action])) {
      throw ApiError.forbidden(`Missing permission: ${LIFECYCLE_PERMISSION[action]}`)
    }
    const student = await assertStudentAccess(ctx, req.params.id)
    if (!ALLOWED_FROM[action].includes(student.status)) {
      throw ApiError.badRequest(`A ${student.status} student cannot be ${action === 'reinstate' ? 'reinstated' : action + 'd'}.`)
    }
    const before = student.status
    const previousStatus = student.previousStatus
    let nextStatus: StudentStatus
    switch (action) {
      case 'suspend':
      case 'transfer':
      case 'withdraw':
      case 'graduate':
        nextStatus = action === 'graduate' ? 'graduated' : action === 'withdraw' ? 'withdrawn' : action === 'transfer' ? 'transferred' : 'suspended'
        student.previousStatus = before
        break
      case 'reinstate':
        nextStatus = 'active'
        student.previousStatus = 'suspended'
        break
      case 'archive':
        nextStatus = 'archived'
        student.previousStatus = before
        student.archivedAt = new Date()
        student.archivedReason = body.reason
        break
      case 'restore':
        nextStatus = previousStatus && previousStatus !== 'archived' ? previousStatus : 'active'
        student.archivedAt = undefined
        student.archivedReason = undefined
        break
    }
    student.status = nextStatus
    const details = [
      body.reason,
      body.transferSchool ? `Transfer destination: ${body.transferSchool}` : '',
      body.effectiveDate ? `Effective ${body.effectiveDate}` : '',
      body.notes ?? '',
    ]
      .filter(Boolean)
      .join(' · ')
    student.enrollmentHistory.push({
      academicYearId: student.academicYearId ?? undefined,
      termId: student.currentTermId ?? undefined,
      classId: student.classId,
      streamId: student.streamId,
      dormitoryId: student.dormitoryId,
      action: `lifecycle_${action}`,
      reason: details,
      at: body.effectiveDate ? new Date(body.effectiveDate) : new Date(),
      by: ctx.userId,
    })
    await student.save()
    await writeAudit({
      req,
      actor: ctx,
      action: `student.${action}`,
      resourceType: 'Student',
      resourceId: String(student._id),
      before: { status: before },
      after: { status: nextStatus, transferSchool: body.transferSchool, effectiveDate: body.effectiveDate },
      reason: details,
    })
    ok(res, student)
  }),
)

router.delete(
  '/students/:id',
  requirePermission('students.archive'),
  validate({ query: z.object({ reason: z.string().trim().min(3).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const student = await assertStudentAccess(ctx, req.params.id)
    if (student.status === 'archived') throw ApiError.conflict('This student is already archived')
    const before = student.status
    student.previousStatus = before
    student.status = 'archived'
    student.archivedAt = new Date()
    student.archivedReason = String(req.query.reason)
    student.enrollmentHistory.push({
      academicYearId: student.academicYearId ?? undefined,
      termId: student.currentTermId ?? undefined,
      classId: student.classId,
      streamId: student.streamId,
      dormitoryId: student.dormitoryId,
      action: 'deleted',
      reason: String(req.query.reason),
      at: new Date(),
      by: ctx.userId,
    })
    await student.save()
    await writeAudit({
      req,
      actor: ctx,
      action: 'student.deleted',
      resourceType: 'Student',
      resourceId: String(student._id),
      before: { status: before },
      after: { status: 'archived', softDelete: true },
      reason: String(req.query.reason),
    })
    ok(res, {
      id: String(student._id),
      status: student.status,
      archivedAt: student.archivedAt,
      undo: `POST /students/${student._id}/lifecycle with action "restore"`,
    })
  }),
)

router.post(
  '/students/:id/restore',
  requirePermission('students.restore'),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const student = await assertStudentAccess(ctx, req.params.id)
    if (student.status !== 'archived') throw ApiError.badRequest('Only archived students can be restored')
    const before = student.status
    student.status = student.previousStatus && student.previousStatus !== 'archived' ? student.previousStatus : 'active'
    student.archivedAt = undefined
    student.archivedReason = undefined
    student.enrollmentHistory.push({
      academicYearId: student.academicYearId ?? undefined,
      termId: student.currentTermId ?? undefined,
      classId: student.classId,
      streamId: student.streamId,
      dormitoryId: student.dormitoryId,
      action: 'restored',
      reason: 'Student record restored',
      at: new Date(),
      by: ctx.userId,
    })
    await student.save()
    await writeAudit({
      req,
      actor: ctx,
      action: 'student.restored',
      resourceType: 'Student',
      resourceId: String(student._id),
      before: { status: before },
      after: { status: student.status },
    })
    ok(res, student)
  }),
)

router.post(
  '/students/:id/guardians',
  requirePermission('students.manage_guardians'),
  validate({ body: guardianSchema }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const link = await attachGuardian(student, req.body, req.auth!.userId)
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.guardian_linked',
      resourceType: 'Student',
      resourceId: String(student._id),
      after: link,
    })
    const populated = await GuardianLink.findById(link.linkId)
      .populate('parentId', 'name relationship phone altPhone email address occupation preferredChannel whatsappConsent smsConsent emailConsent verificationStatus')
      .lean()
    created(res, populated)
  }),
)

router.patch(
  '/students/:id/guardians/:linkId',
  requirePermission('students.manage_guardians'),
  validate({
    body: z.object({
      relationship: z.string().trim().max(60).optional(),
      isPrimary: z.boolean().optional(),
      isEmergencyContact: z.boolean().optional(),
      notes: z.string().trim().max(1000).optional(),
      parent: z
        .object({
          name: z.string().trim().min(2).max(120).optional(),
          phone: z.string().trim().min(9).optional(),
          altPhone: z.string().trim().optional(),
          email: z.string().email().optional().or(z.literal('')),
          address: z.string().trim().max(300).optional(),
          occupation: z.string().trim().max(120).optional(),
          nationalId: z.string().trim().max(40).optional(),
          preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'call']).optional(),
          whatsappConsent: z.boolean().optional(),
          smsConsent: z.boolean().optional(),
          emailConsent: z.boolean().optional(),
        })
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const link = await GuardianLink.findOne({ _id: req.params.linkId, studentId: student._id })
    if (!link) throw ApiError.notFound('Guardian link not found')
    if (req.body.isPrimary) {
      await GuardianLink.updateMany({ studentId: student._id, _id: { $ne: link._id } }, { $set: { isPrimary: false } })
    }
    if (req.body.relationship !== undefined) link.relationship = req.body.relationship
    if (req.body.isPrimary !== undefined) link.isPrimary = req.body.isPrimary
    if (req.body.isEmergencyContact !== undefined) link.isEmergencyContact = req.body.isEmergencyContact
    if (req.body.notes !== undefined) link.notes = req.body.notes
    await link.save()
    if (req.body.parent) {
      const p = req.body.parent
      const updates: Record<string, unknown> = {}
      if (p.name) updates.name = p.name
      if (p.phone) updates.phone = normalizeRwandaPhone(p.phone)
      if (p.altPhone !== undefined) updates.altPhone = p.altPhone ? normalizeRwandaPhone(p.altPhone) : undefined
      if (p.email !== undefined) updates.email = p.email || undefined
      if (p.address !== undefined) updates.address = p.address
      if (p.occupation !== undefined) updates.occupation = p.occupation
      if (p.nationalId !== undefined) updates.nationalId = p.nationalId
      if (p.preferredChannel) updates.preferredChannel = p.preferredChannel
      if (p.whatsappConsent !== undefined) updates.whatsappConsent = p.whatsappConsent
      if (p.smsConsent !== undefined) updates.smsConsent = p.smsConsent
      if (p.emailConsent !== undefined) updates.emailConsent = p.emailConsent
      if (Object.keys(updates).length) await Parent.updateOne({ _id: link.parentId }, { $set: updates })
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.guardian_updated',
      resourceType: 'Student',
      resourceId: String(student._id),
      after: { linkId: String(link._id) },
    })
    const populated = await GuardianLink.findById(link._id)
      .populate('parentId', 'name relationship phone altPhone email address occupation preferredChannel whatsappConsent smsConsent emailConsent verificationStatus')
      .lean()
    ok(res, populated)
  }),
)

router.delete(
  '/students/:id/guardians/:linkId',
  requirePermission('students.manage_guardians'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const link = await GuardianLink.findOneAndDelete({ _id: req.params.linkId, studentId: student._id })
    if (!link) throw ApiError.notFound('Guardian link not found')
    if (link.isPrimary) {
      const replacement = await GuardianLink.findOne({ studentId: student._id }).sort({ createdAt: 1 })
      if (replacement) {
        replacement.isPrimary = true
        await replacement.save()
      }
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.guardian_unlinked',
      resourceType: 'Student',
      resourceId: String(student._id),
      before: { linkId: String(link._id), parentId: String(link.parentId) },
    })
    ok(res, { removed: true })
  }),
)

router.post(
  '/students/:id/documents',
  requirePermission('students.documents'),
  validate({
    body: z.object({
      title: z.string().trim().min(2).max(160),
      type: z.string().trim().min(1).max(40),
      url: z.string().trim().max(600).optional(),
      notes: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const document = {
      title: req.body.title,
      type: req.body.type,
      url: req.body.url || undefined,
      notes: req.body.notes,
      uploadedBy: req.auth!.userId,
      uploadedAt: new Date(),
    }
    student.documents.push(document)
    await student.save()
    const saved = student.documents[student.documents.length - 1]
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.document_added',
      resourceType: 'Student',
      resourceId: String(student._id),
      after: { title: document.title, type: document.type },
    })
    created(res, saved)
  }),
)

router.delete(
  '/students/:id/documents/:documentId',
  requirePermission('students.documents'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const before = student.documents.length
    student.documents = student.documents.filter((d) => String((d as { _id?: unknown })._id) !== req.params.documentId)
    if (student.documents.length === before) throw ApiError.notFound('Document not found')
    await student.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.document_removed',
      resourceType: 'Student',
      resourceId: String(student._id),
      before: { documentId: req.params.documentId },
    })
    ok(res, { removed: true })
  }),
)

router.post(
  '/students/promote',
  requirePermission('students.promote'),
  validate({
    body: z.object({
      fromClassId: objectId,
      toClassId: objectId,
      studentIds: z.array(objectId).optional(),
      reason: z.string().trim().max(400).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const target = await ClassModel.findById(req.body.toClassId)
    if (!target || !target.active) throw ApiError.badRequest('Select an active destination class')
    const filter: Record<string, unknown> = { classId: new Types.ObjectId(req.body.fromClassId), status: 'active' }
    if (req.body.studentIds?.length) filter._id = { $in: req.body.studentIds.map((id: string) => new Types.ObjectId(id)) }
    const students = await Student.find(filter)
    for (const student of students) {
      student.classId = target._id
      student.streamId = target.streamId ?? null
      student.enrollmentHistory.push({
        academicYearId: student.academicYearId ?? undefined,
        termId: student.currentTermId ?? undefined,
        classId: target._id,
        streamId: target.streamId ?? undefined,
        dormitoryId: student.dormitoryId ?? undefined,
        action: 'promoted',
        reason: req.body.reason,
        at: new Date(),
        by: req.auth!.userId,
      })
      await student.save()
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'students.promoted',
      resourceType: 'Student',
      after: { fromClassId: req.body.fromClassId, toClassId: req.body.toClassId, students: students.length },
      reason: req.body.reason,
    })
    ok(res, { promoted: students.length })
  }),
)

export default router
