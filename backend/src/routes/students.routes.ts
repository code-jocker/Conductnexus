import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, queryOf, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { ClassModel, Dormitory, GuardianLink, Parent, Stream, Student, type IStudent } from '../models/school.js'
import { Incident, DisciplineLedger, RiskAssessment } from '../models/discipline.js'
import { FollowUp, Intervention, Recognition } from '../models/support.js'
import { assertStudentAccess, visibleStudentQuery } from '../services/rbac.service.js'
import { ensureInitialAllocation, studentConductSummary } from '../services/ledger.service.js'
import { getActiveAcademicYear, getActiveTerm, resolveTerm } from '../services/academic.service.js'
import { nextRef } from '../shared/refs.js'
import { writeAudit } from '../services/audit.service.js'
import { toCsv } from '../services/reports.service.js'
import { normalizeRwandaPhone } from '../shared/utils.js'
import { objectId, paginationQuery, searchRegex } from './helpers.js'

const router = Router()
router.use(authenticate)

const studentListQuery = paginationQuery.extend({
  classId: objectId.optional(),
  streamId: objectId.optional(),
  dormitoryId: objectId.optional(),
  status: z.enum(['active', 'suspended', 'transferred', 'graduated', 'expelled', 'archived']).optional(),
  risk: z.enum(['green', 'yellow', 'orange', 'red']).optional(),
  termId: objectId.optional(),
})

const createStudentSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  otherNames: z.string().trim().max(80).optional(),
  gender: z.enum(['male', 'female']),
  dateOfBirth: z.string().trim().optional(),
  classId: objectId,
  streamId: objectId.optional().nullable(),
  dormitoryId: objectId.optional().nullable(),
  admissionDate: z.string().trim().optional(),
  studentId: z.string().trim().max(30).optional(),
  admissionNumber: z.string().trim().max(30).optional(),
  photoUrl: z.string().url().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional(),
  parent: z
    .object({
      name: z.string().trim().min(2).max(120),
      relationship: z.string().trim().max(60).optional(),
      phone: z.string().trim().min(9),
      altPhone: z.string().trim().optional(),
      email: z.string().email().optional().or(z.literal('')),
      preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'call']).optional(),
      whatsappConsent: z.boolean().optional(),
      smsConsent: z.boolean().optional(),
      emailConsent: z.boolean().optional(),
    })
    .optional(),
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

async function attachParent(student: IStudent, input: NonNullable<z.infer<typeof createStudentSchema>['parent']>, actorId: Types.ObjectId) {
  const phone = normalizeRwandaPhone(input.phone)
  let parent = await Parent.findOne({ phone })
  if (!parent) {
    parent = await Parent.create({
      name: input.name,
      relationship: input.relationship ?? 'Guardian',
      phone,
      altPhone: input.altPhone ? normalizeRwandaPhone(input.altPhone) : undefined,
      email: input.email || undefined,
      preferredChannel: input.preferredChannel ?? 'sms',
      whatsappConsent: Boolean(input.whatsappConsent),
      smsConsent: Boolean(input.smsConsent),
      emailConsent: Boolean(input.emailConsent),
      createdBy: actorId,
    })
  }
  await GuardianLink.updateOne(
    { studentId: student._id, parentId: parent._id },
    { $setOnInsert: { studentId: student._id, parentId: parent._id, relationship: input.relationship ?? 'Guardian', isPrimary: true } },
    { upsert: true },
  )
  return parent
}

async function registerStudent(
  input: z.infer<typeof createStudentSchema>,
  actor: { userId: Types.ObjectId; name: string; roles: string[] },
) {
  const cls = await validateClassPlacement(input.classId, input.streamId)
  if (input.dormitoryId && !(await Dormitory.exists({ _id: input.dormitoryId, active: true }))) {
    throw ApiError.badRequest('Select an active dormitory')
  }
  const [year, term] = await Promise.all([getActiveAcademicYear(), getActiveTerm()])
  const studentId = input.studentId?.trim() || (await nextRef('STD', 4))
  const admissionNumber = input.admissionNumber?.trim() || (await nextRef('ADM', 4))
  if (await Student.exists({ $or: [{ studentId }, { admissionNumber }] })) {
    throw ApiError.conflict('A student with this student ID or admission number already exists')
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
    classId: cls._id,
    streamId: input.streamId ?? cls.streamId ?? null,
    dormitoryId: input.dormitoryId ?? null,
    academicYearId: year._id,
    termId: term._id,
    currentTermId: term._id,
    status: 'active',
    admissionDate: input.admissionDate ? new Date(input.admissionDate) : new Date(),
    currentBalance: 0,
    riskLevel: 'green',
    photoUrl: input.photoUrl || undefined,
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
        at: new Date(),
        by: actor.userId,
      },
    ],
  })
  await ensureInitialAllocation(student, term, { userId: actor.userId, name: actor.name, roles: actor.roles })
  if (input.parent) await attachParent(student, input.parent, actor.userId)
  return student
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
    else if (!q.risk) filter.status = { $in: ['active', 'suspended'] }
    if (q.risk) filter.riskLevel = q.risk
    if (q.q) {
      const rx = searchRegex(q.q)
      const clauses: Record<string, unknown>[] = [{ fullName: rx }, { studentId: rx }, { admissionNumber: rx }]
      if (visibility.$or) {
        filter.$and = [{ $or: visibility.$or }, { $or: clauses }]
        delete filter.$or
      } else {
        filter.$or = clauses
      }
    }
    const [total, students] = await Promise.all([
      Student.countDocuments(filter),
      Student.find(filter)
        .sort({ lastName: 1, firstName: 1 })
        .skip(skip)
        .limit(pageSize)
        .populate('classId', 'name level')
        .populate('streamId', 'name code')
        .populate('dormitoryId', 'name code')
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
        className: cls?.name ?? '',
        stream: stream?.name ?? '',
        dormitory: dorm?.name ?? '',
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
  validate({ body: createStudentSchema }),
  asyncHandler(async (req, res) => {
    const student = await registerStudent(req.body, req.auth!)
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.created',
      resourceType: 'Student',
      resourceId: String(student._id),
      after: { fullName: student.fullName, classId: String(student.classId), balance: student.currentBalance },
    })
    created(res, student)
  }),
)

router.post(
  '/students/import',
  requirePermission('students.import'),
  validate({ body: z.object({ rows: z.array(createStudentSchema).min(1).max(500) }) }),
  asyncHandler(async (req, res) => {
    const results: { index: number; ok: boolean; studentId?: string; error?: string }[] = []
    for (let i = 0; i < req.body.rows.length; i++) {
      try {
        const student = await registerStudent(req.body.rows[i], req.auth!)
        results.push({ index: i, ok: true, studentId: String(student._id) })
      } catch (err) {
        results.push({ index: i, ok: false, error: err instanceof Error ? err.message : 'Registration failed' })
      }
    }
    const imported = results.filter((r) => r.ok).length
    await writeAudit({
      req,
      actor: req.auth,
      action: 'students.imported',
      resourceType: 'Student',
      after: { imported, failed: results.length - imported },
    })
    ok(res, { imported, failed: results.length - imported, results })
  }),
)

router.get(
  '/students/:id',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    await student.populate([
      { path: 'classId', select: 'name level' },
      { path: 'streamId', select: 'name code' },
      { path: 'dormitoryId', select: 'name code' },
    ])
    const links = await GuardianLink.find({ studentId: student._id }).populate('parentId').lean()
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
    const [cls, stream, dorm, guardians, incidents, ledger, assessments, interventions, followUps, recognitions, summary] =
      await Promise.all([
        ClassModel.findById(student.classId).lean(),
        student.streamId ? Stream.findById(student.streamId).lean() : null,
        student.dormitoryId ? Dormitory.findById(student.dormitoryId).lean() : null,
        GuardianLink.find({ studentId: student._id }).populate('parentId').lean(),
        Incident.find({ studentId: student._id })
          .sort({ occurredAt: -1 })
          .limit(20)
          .populate('reportedBy', 'name')
          .lean(),
        DisciplineLedger.find({ studentId: student._id, termId: term._id }).sort({ createdAt: -1 }).lean(),
        RiskAssessment.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(15).lean(),
        Intervention.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(10).lean(),
        FollowUp.find({ studentId: student._id, status: 'pending' }).sort({ dueDate: 1 }).limit(10).lean(),
        Recognition.find({ studentId: student._id }).sort({ awardedAt: -1 }).limit(10).lean(),
        studentConductSummary(String(student._id), String(term._id)),
      ])
    await writeAudit({ req, actor: ctx, action: 'student.profile_viewed', resourceType: 'Student', resourceId: String(student._id) })
    ok(res, {
      student: { ...student.toJSON(), id: String(student._id) },
      class: cls,
      stream,
      dormitory: dorm,
      guardians,
      conduct: { ...summary, term },
      incidents,
      assessments,
      interventions,
      followUps,
      recognitions,
    })
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
    ok(res, { student: { id: String(student._id), fullName: student.fullName }, incidents, ledger, assessments, recognitions })
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
  validate({
    body: z.object({
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().min(1).max(80).optional(),
      otherNames: z.string().trim().max(80).optional(),
      gender: z.enum(['male', 'female']).optional(),
      dateOfBirth: z.string().trim().optional(),
      classId: objectId.optional(),
      streamId: objectId.optional().nullable(),
      dormitoryId: objectId.optional().nullable(),
      photoUrl: z.string().url().optional().or(z.literal('')),
      notes: z.string().trim().max(2000).optional(),
      reason: z.string().trim().max(400).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const before = {
      fullName: student.fullName,
      classId: String(student.classId),
      streamId: student.streamId ? String(student.streamId) : null,
      dormitoryId: student.dormitoryId ? String(student.dormitoryId) : null,
    }
    const nextClassId = req.body.classId ?? String(student.classId)
    const nextStreamId = req.body.streamId !== undefined ? req.body.streamId : student.streamId ? String(student.streamId) : null
    if (req.body.classId || req.body.streamId !== undefined) await validateClassPlacement(nextClassId, nextStreamId)
    if (req.body.dormitoryId && !(await Dormitory.exists({ _id: req.body.dormitoryId, active: true }))) {
      throw ApiError.badRequest('Select an active dormitory')
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
    if (req.body.photoUrl !== undefined) student.photoUrl = req.body.photoUrl || undefined
    if (req.body.notes !== undefined) student.notes = req.body.notes
    const placementChanged =
      before.classId !== nextClassId ||
      before.streamId !== (nextStreamId ?? null) ||
      before.dormitoryId !== (req.body.dormitoryId !== undefined ? req.body.dormitoryId : before.dormitoryId)
    if (placementChanged) {
      student.classId = new Types.ObjectId(nextClassId)
      student.streamId = nextStreamId ? new Types.ObjectId(nextStreamId) : null
      if (req.body.dormitoryId !== undefined) student.dormitoryId = req.body.dormitoryId ? new Types.ObjectId(req.body.dormitoryId) : null
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
    await writeAudit({ req, actor: req.auth, action: 'student.updated', resourceType: 'Student', resourceId: String(student._id), before, after: req.body })
    ok(res, student)
  }),
)

router.post(
  '/students/:id/status',
  requirePermission('students.update'),
  validate({
    body: z.object({
      status: z.enum(['active', 'suspended', 'transferred', 'graduated', 'expelled', 'archived']),
      reason: z.string().trim().min(3).max(500),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const before = student.status
    if (before === req.body.status) throw ApiError.badRequest('The student already has this status')
    if (req.body.status === 'archived' && !req.auth!.permissions.has('students.archive')) {
      throw ApiError.forbidden('Missing permission: students.archive')
    }
    student.status = req.body.status
    student.enrollmentHistory.push({
      academicYearId: student.academicYearId ?? undefined,
      termId: student.currentTermId ?? undefined,
      classId: student.classId,
      streamId: student.streamId,
      dormitoryId: student.dormitoryId,
      action: `status_${req.body.status}`,
      reason: req.body.reason,
      at: new Date(),
      by: req.auth!.userId,
    })
    await student.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'student.status_changed',
      resourceType: 'Student',
      resourceId: String(student._id),
      before: { status: before },
      after: { status: student.status },
      reason: req.body.reason,
    })
    ok(res, student)
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
