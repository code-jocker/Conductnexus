import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, paginated, parsePagination, queryOf, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { ClassModel, Dormitory, Student, Term, AcademicYear } from '../models/school.js'
import {
  ATTENDANCE_SESSIONS,
  ATTENDANCE_STATUSES,
  AbsenceExcuse,
  AttendanceCorrection,
  AttendanceRecord,
} from '../models/attendance.js'
import { assertStudentAccess, visibleStudentQuery } from '../services/rbac.service.js'
import { writeAudit } from '../services/audit.service.js'
import { queueParentMessage } from '../services/communication.service.js'
import { logger } from '../shared/logger.js'
import { nextRef } from '../shared/refs.js'
import { objectId } from './helpers.js'

function labelOf(value: string): string {
  const text = value.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Attendance never touches the discipline ledger. An absence, however often it
 * repeats, must not silently deduct conduct marks — deductions stay an explicit
 * human decision recorded through the discipline module.
 */

const router = Router()
router.use(authenticate)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const dateString = z.string().trim().regex(DATE_RE, 'Use YYYY-MM-DD')

function schoolDate(value?: string | Date): string {
  if (typeof value === 'string' && DATE_RE.test(value)) return value
  const date = value ? new Date(value) : new Date()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(date)
}

function notificationReason(value?: string): string {
  return (value ?? '').trim() || 'Not provided'
}

async function notifyGuardianOfRecord(record: InstanceType<typeof AttendanceRecord>) {
  const student = await Student.findById(record.studentId).select('fullName studentId').lean()
  if (!student) return
  try {
    const result = await queueParentMessage({
      studentId: record.studentId,
      templateKey: 'attendance_absence',
      dedupeSuffix: `attendance:${record.date}:${record.session}`,
      extraVars: {
        attendanceDate: record.date,
        attendanceStatus: labelOf(record.status),
        attendanceReason: notificationReason(record.reason),
      },
    })
    if (result.queued > 0) {
      record.parentNotifiedAt = new Date()
      await record.save()
    }
  } catch (err) {
    // A missing template or an offline channel must not fail a register that
    // already persisted; the delivery gap is surfaced in the queue centre.
    logger.warn({ err, attendanceId: String(record._id) }, 'Attendance parent notification could not be queued')
  }
}

function studentFilterFor(auth: Awaited<ReturnType<typeof visibleStudentQuery>>): Record<string, unknown> {
  return { status: 'active', ...auth }
}

router.get(
  '/attendance/roster',
  requirePermission('attendance.view'),
  validate({
    query: z.object({
      date: dateString.optional(),
      session: z.enum(ATTENDANCE_SESSIONS as [string, ...string[]]).default('daily'),
      classId: objectId.optional(),
      streamId: objectId.optional(),
      dormitoryId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = queryOf<{ date?: string; session: string; classId?: string; streamId?: string; dormitoryId?: string }>(req)
    const date = schoolDate(query.date)
    const session = query.session
    const dormSession = session.startsWith('dormitory')
    const coversAllBoarders =
      req.auth!.permissions.has('students.view_all') || req.auth!.permissions.has('boarding.view')
    if (dormSession && !query.dormitoryId && !coversAllBoarders) {
      throw ApiError.badRequest('Select a dormitory for a dormitory roll call')
    }
    const auth = req.auth!
    const scope = studentFilterFor(await visibleStudentQuery(auth))
    const assigned = auth.user.assignedClassIds.length > 0 || auth.user.assignedDormitoryIds.length > 0
    const namedClassTeacher =
      auth.roles.includes('TEACHER') && !assigned
        ? Boolean(await Student.exists({ classTeacherId: auth.userId, status: 'active' }))
        : false
    // A teacher with no class, dormitory or named-student responsibility may
    // still browse registers for cover and handover, but cannot save marks.
    const browsingOnly =
      auth.roles.includes('TEACHER') &&
      !auth.permissions.has('students.view_all') &&
      !assigned &&
      !namedClassTeacher &&
      !auth.permissions.has('boarding.view')
    const canRecord = auth.permissions.has('attendance.record') && !browsingOnly
    const filter: Record<string, unknown> = browsingOnly ? { status: 'active' } : { ...scope }
    if (query.classId) filter.classId = query.classId
    if (query.streamId) filter.streamId = query.streamId
    if (query.dormitoryId) filter.dormitoryId = query.dormitoryId
    else if (dormSession) filter.dormitoryId = { $ne: null }

    const students = await Student.find(filter)
      .select('studentId fullName gender classId streamId dormitoryId roomNumber photoUrl')
      .populate('classId', 'name')
      .populate('dormitoryId', 'name')
      .sort({ fullName: 1 })
      .limit(600)
      .lean()
    const ids = students.map((s) => s._id)
    const records = await AttendanceRecord.find({ studentId: { $in: ids }, date, session }).lean()
    const counts = { present: 0, absent: 0, late: 0, excused: 0, sick: 0, permission: 0, suspended: 0, unmarked: 0 }
    const byStudent = new Map(records.map((r) => [String(r.studentId), r]))
    for (const s of students) {
      const status = byStudent.get(String(s._id))?.status as keyof typeof counts | undefined
      if (status) counts[status]++
      else counts.unmarked++
    }
    ok(res, {
      date,
      session,
      canRecord,
      students: students.map((s) => ({ ...s, attendance: byStudent.get(String(s._id)) ?? null })),
      counts,
    })
  }),
)

const markEntry = z.object({
  studentId: objectId,
  status: z.enum(ATTENDANCE_STATUSES as [string, ...string[]]),
  minutesLate: z.coerce.number().int().min(0).max(1440).optional(),
  reason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
})

router.post(
  '/attendance/mark',
  requirePermission('attendance.record'),
  validate({
    body: z.object({
      date: dateString.optional(),
      session: z.enum(ATTENDANCE_SESSIONS as [string, ...string[]]).default('daily'),
      classId: objectId.optional(),
      streamId: objectId.optional(),
      dormitoryId: objectId.optional(),
      notifyParents: z.boolean().default(false),
      entries: z.array(markEntry).min(1).max(600),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      date?: string
      session: string
      classId?: string
      streamId?: string
      dormitoryId?: string
      notifyParents: boolean
      entries: Array<{ studentId: string; status: string; minutesLate?: number; reason?: string; note?: string }>
    }
    const date = schoolDate(body.date)
    // Registers must still work before an academic year is activated; term
    // linkage is best-effort metadata, not a precondition for marking.
    const [term, year] = await Promise.all([
      Term.findOne({ isActive: true }).select('_id').lean(),
      AcademicYear.findOne({ isActive: true }).select('_id').lean(),
    ])
    const saved: Array<InstanceType<typeof AttendanceRecord>> = []
    const notify: Array<InstanceType<typeof AttendanceRecord>> = []
    const seen = new Set<string>()
    for (const entry of body.entries) {
      if (seen.has(entry.studentId)) continue
      seen.add(entry.studentId)
      const student = await assertStudentAccess(req.auth!, entry.studentId)
      if (student.status !== 'active') throw ApiError.badRequest(`${student.fullName} is not an active student`)
      const record = await AttendanceRecord.findOneAndUpdate(
        { studentId: student._id, date, session: body.session },
        {
          $set: {
            status: entry.status,
            minutesLate: entry.status === 'late' ? entry.minutesLate ?? 0 : undefined,
            reason: entry.reason,
            note: entry.note,
            classId: body.classId ? new Types.ObjectId(body.classId) : student.classId,
            streamId: body.streamId ? new Types.ObjectId(body.streamId) : student.streamId,
            dormitoryId: body.dormitoryId ? new Types.ObjectId(body.dormitoryId) : student.dormitoryId,
            termId: term?._id ?? null,
            academicYearId: year?._id ?? null,
            source: 'manual',
            updatedBy: req.auth!.userId,
          },
          $setOnInsert: { recordedBy: req.auth!.userId, recordedAt: new Date() },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      saved.push(record)
      if (body.notifyParents && ['absent', 'late'].includes(entry.status)) notify.push(record)
    }
    for (const record of notify) await notifyGuardianOfRecord(record)
    await writeAudit({
      req,
      actor: req.auth,
      action: 'attendance.recorded',
      resourceType: 'AttendanceRecord',
      after: { date, session: body.session, count: saved.length, notified: notify.length },
    })
    ok(res, { date, session: body.session, recorded: saved.length, notified: notify.length })
  }),
)

router.get(
  '/attendance/records',
  requirePermission('attendance.view'),
  validate({
    query: z.object({
      from: dateString.optional(),
      to: dateString.optional(),
      date: dateString.optional(),
      session: z.enum(ATTENDANCE_SESSIONS as [string, ...string[]]).optional(),
      status: z.enum(ATTENDANCE_STATUSES as [string, ...string[]]).optional(),
      studentId: objectId.optional(),
      classId: objectId.optional(),
      dormitoryId: objectId.optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = queryOf<Record<string, string | undefined>>(req)
    const scope = await visibleStudentQuery(req.auth!)
    const studentIds = await Student.find(scope).distinct('_id')
    const filter: Record<string, unknown> = { studentId: { $in: studentIds } }
    if (query.studentId) filter.studentId = query.studentId
    if (query.session) filter.session = query.session
    if (query.status) filter.status = query.status
    if (query.classId) filter.classId = query.classId
    if (query.dormitoryId) filter.dormitoryId = query.dormitoryId
    if (query.date) filter.date = query.date
    else if (query.from || query.to) {
      filter.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) }
    }
    const { page, pageSize, skip } = parsePagination(req.query as Record<string, unknown>)
    const [items, total] = await Promise.all([
      AttendanceRecord.find(filter)
        .populate('studentId', 'fullName studentId classId dormitoryId')
        .populate('classId', 'name')
        .populate('dormitoryId', 'name')
        .populate('recordedBy', 'name')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      AttendanceRecord.countDocuments(filter),
    ])
    paginated(res, items, total, page, pageSize)
  }),
)

router.get(
  '/attendance/students/:id',
  requirePermission('attendance.view'),
  validate({
    query: z.object({
      from: dateString.optional(),
      to: dateString.optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const query = queryOf<{ from?: string; to?: string; limit?: number }>(req)
    const filter: Record<string, unknown> = { studentId: student._id }
    if (query.from || query.to) {
      filter.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) }
    }
    const records = await AttendanceRecord.find(filter).sort({ date: -1 }).limit(query.limit ?? 60).lean()
    const summary = { present: 0, absent: 0, late: 0, excused: 0, sick: 0, permission: 0, suspended: 0 }
    for (const record of records) summary[record.status]++
    const attended = summary.present + summary.late
    const counted = records.length - summary.excused - summary.permission
    ok(res, {
      student: { id: String(student._id), fullName: student.fullName, studentId: student.studentId, dormitoryId: student.dormitoryId },
      records,
      summary,
      attendanceRate: counted > 0 ? Math.round((attended / counted) * 1000) / 10 : null,
    })
  }),
)

router.post(
  '/attendance/:id/correction',
  requirePermission('attendance.correct'),
  validate({
    body: z.object({
      status: z.enum(ATTENDANCE_STATUSES as [string, ...string[]]),
      minutesLate: z.coerce.number().int().min(0).max(1440).optional(),
      reason: z.string().trim().min(5).max(1000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const record = await AttendanceRecord.findById(req.params.id)
    if (!record) throw ApiError.notFound('Attendance record not found')
    await assertStudentAccess(req.auth!, record.studentId)
    const pending = await AttendanceCorrection.exists({ attendanceId: record._id, status: 'pending' })
    if (pending) throw ApiError.conflict('A correction request is already awaiting approval for this record')
    const correction = await AttendanceCorrection.create({
      reference: await nextRef('ATC'),
      attendanceId: record._id,
      studentId: record.studentId,
      requestedBy: req.auth!.userId,
      reason: req.body.reason,
      requestedStatus: req.body.status,
      requestedMinutesLate: req.body.status === 'late' ? req.body.minutesLate ?? 0 : undefined,
      previousStatus: record.status,
      previousMinutesLate: record.minutesLate,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'attendance.correction_requested',
      resourceType: 'AttendanceCorrection',
      resourceId: String(correction._id),
      before: { status: record.status, minutesLate: record.minutesLate },
      after: { status: req.body.status, minutesLate: req.body.minutesLate },
      reason: req.body.reason,
    })
    created(res, correction)
  }),
)

router.get(
  '/attendance/corrections',
  requirePermission('attendance.view'),
  validate({
    query: z.object({
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = queryOf<{ status?: string }>(req)
    const filter: Record<string, unknown> = query.status ? { status: query.status } : {}
    const { page, pageSize, skip } = parsePagination(req.query as Record<string, unknown>)
    const [items, total] = await Promise.all([
      AttendanceCorrection.find(filter)
        .populate('studentId', 'fullName studentId')
        .populate('requestedBy', 'name')
        .populate('decidedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      AttendanceCorrection.countDocuments(filter),
    ])
    paginated(res, items, total, page, pageSize)
  }),
)

router.post(
  '/attendance/corrections/:id/decide',
  requirePermission('attendance.correct.approve'),
  validate({
    body: z.object({
      decision: z.enum(['approve', 'reject']),
      note: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const correction = await AttendanceCorrection.findById(req.params.id)
    if (!correction) throw ApiError.notFound('Correction request not found')
    if (correction.status !== 'pending') throw ApiError.badRequest('This correction has already been decided')
    const decision = req.body.decision as 'approve' | 'reject'
    correction.status = decision === 'approve' ? 'approved' : 'rejected'
    correction.decidedBy = req.auth!.userId
    correction.decidedAt = new Date()
    correction.decisionNote = req.body.note
    await correction.save()
    if (decision === 'approve') {
      const record = await AttendanceRecord.findById(correction.attendanceId)
      if (record) {
        record.status = correction.requestedStatus
        record.minutesLate = correction.requestedMinutesLate
        record.source = 'correction'
        record.updatedBy = req.auth!.userId
        await record.save()
      }
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'attendance.correction_decided',
      resourceType: 'AttendanceCorrection',
      resourceId: String(correction._id),
      after: { decision, note: req.body.note },
    })
    ok(res, correction)
  }),
)

const excuseBody = z.object({
  studentId: objectId,
  fromDate: dateString,
  toDate: dateString,
  category: z.enum(['medical', 'family', 'transport', 'school_activity', 'other']).default('other'),
  reason: z.string().trim().min(5).max(1000),
  documentUrl: z.string().trim().max(500).optional(),
})

router.post(
  '/attendance/excuses',
  requirePermission('attendance.record'),
  validate({ body: excuseBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof excuseBody>
    if (body.toDate < body.fromDate) throw ApiError.badRequest('The excuse end date cannot be before the start date')
    const student = await assertStudentAccess(req.auth!, body.studentId)
    const excuse = await AbsenceExcuse.create({
      reference: await nextRef('EXC'),
      studentId: student._id,
      fromDate: body.fromDate,
      toDate: body.toDate,
      category: body.category,
      reason: body.reason,
      documentUrl: body.documentUrl,
      submittedBy: req.auth!.userId,
      submittedByName: req.auth!.name,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'attendance.excuse_submitted',
      resourceType: 'AbsenceExcuse',
      resourceId: String(excuse._id),
      after: { studentId: String(student._id), fromDate: body.fromDate, toDate: body.toDate, category: body.category },
    })
    created(res, excuse)
  }),
)

router.get(
  '/attendance/excuses',
  requirePermission('attendance.view'),
  validate({
    query: z.object({
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
      studentId: objectId.optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = queryOf<{ status?: string; studentId?: string }>(req)
    const filter: Record<string, unknown> = {}
    if (query.status) filter.status = query.status
    if (query.studentId) filter.studentId = query.studentId
    const { page, pageSize, skip } = parsePagination(req.query as Record<string, unknown>)
    const [items, total] = await Promise.all([
      AbsenceExcuse.find(filter)
        .populate('studentId', 'fullName studentId')
        .populate('submittedBy', 'name')
        .populate('reviewedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      AbsenceExcuse.countDocuments(filter),
    ])
    paginated(res, items, total, page, pageSize)
  }),
)

router.post(
  '/attendance/excuses/:id/review',
  requirePermission('attendance.excuse.review'),
  validate({
    body: z.object({
      decision: z.enum(['approve', 'reject']),
      note: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const excuse = await AbsenceExcuse.findById(req.params.id)
    if (!excuse) throw ApiError.notFound('Absence excuse not found')
    if (excuse.status !== 'pending') throw ApiError.badRequest('This excuse has already been reviewed')
    const decision = req.body.decision as 'approve' | 'reject'
    excuse.status = decision === 'approve' ? 'approved' : 'rejected'
    excuse.reviewedBy = req.auth!.userId
    excuse.reviewedAt = new Date()
    excuse.reviewNote = req.body.note
    if (decision === 'approve') {
      const records = await AttendanceRecord.find({
        studentId: excuse.studentId,
        date: { $gte: excuse.fromDate, $lte: excuse.toDate },
        status: { $in: ['absent', 'late'] },
      })
      excuse.appliedDates = [...new Set(records.map((r) => r.date))].sort()
      for (const record of records) {
        record.status = 'excused'
        record.reason = excuse.reason
        record.source = 'correction'
        record.updatedBy = req.auth!.userId
        await record.save()
      }
    }
    await excuse.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'attendance.excuse_reviewed',
      resourceType: 'AbsenceExcuse',
      resourceId: String(excuse._id),
      after: { decision, note: req.body.note, appliedDates: excuse.appliedDates },
    })
    ok(res, excuse)
  }),
)

router.get(
  '/attendance/overview',
  requirePermission('attendance.reports'),
  validate({
    query: z.object({
      date: dateString.optional(),
      session: z.enum(ATTENDANCE_SESSIONS as [string, ...string[]]).default('daily'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = queryOf<{ date?: string; session: string }>(req)
    const date = schoolDate(query.date)
    const session = query.session
    const scope = await visibleStudentQuery(req.auth!)
    const students = await Student.find({ status: 'active', ...scope }).select('classId dormitoryId').lean()
    const records = await AttendanceRecord.find({ date, session, studentId: { $in: students.map((s) => s._id) } }).lean()
    const totals = { present: 0, absent: 0, late: 0, excused: 0, sick: 0, permission: 0, suspended: 0, unmarked: 0 }
    const marked = new Set<string>()
    for (const record of records) {
      totals[record.status]++
      marked.add(String(record.studentId))
    }
    totals.unmarked = students.length - marked.size
    const classes = await ClassModel.find().select('name').lean()
    const byClass = classes
      .map((cls) => {
        const classStudents = students.filter((s) => String(s.classId) === String(cls._id))
        const classRecords = records.filter((r) => String(r.classId) === String(cls._id))
        const counts = { present: 0, absent: 0, late: 0, excused: 0, sick: 0, permission: 0, suspended: 0 }
        for (const record of classRecords) if (record.status in counts) counts[record.status as keyof typeof counts]++
        const attended = counts.present + counts.late
        const counted = classRecords.length - counts.excused - counts.permission
        return {
          classId: String(cls._id),
          name: cls.name,
          students: classStudents.length,
          marked: classRecords.length,
          ...counts,
          attendanceRate: counted > 0 ? Math.round((attended / counted) * 1000) / 10 : null,
        }
      })
      .filter((row) => row.students > 0)
    ok(res, { date, session, totals, students: students.length, byClass })
  }),
)

router.get(
  '/attendance/trend',
  requirePermission('attendance.reports'),
  validate({
    query: z.object({
      days: z.coerce.number().int().min(1).max(120).optional(),
      session: z.enum(ATTENDANCE_SESSIONS as [string, ...string[]]).default('daily'),
      classId: objectId.optional(),
      dormitoryId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = queryOf<{ days?: number; session: string; classId?: string; dormitoryId?: string }>(req)
    const days = query.days ?? 14
    const scope = await visibleStudentQuery(req.auth!)
    const ids = await Student.find({ status: 'active', ...scope }).distinct('_id')
    const end = new Date()
    const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
    const filter: Record<string, unknown> = {
      studentId: { $in: ids },
      session: query.session,
      date: { $gte: schoolDate(start), $lte: schoolDate(end) },
    }
    if (query.classId) filter.classId = query.classId
    if (query.dormitoryId) filter.dormitoryId = query.dormitoryId
    const rows = await AttendanceRecord.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$date',
          present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
          sick: { $sum: { $cond: [{ $eq: ['$status', 'sick'] }, 1, 0] } },
          permission: { $sum: { $cond: [{ $eq: ['$status', 'permission'] }, 1, 0] } },
          marked: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    const byDate = new Map(rows.map((row) => [row._id as string, row]))
    const series = Array.from({ length: days }, (_, index) => {
      const date = schoolDate(new Date(start.getTime() + index * 24 * 60 * 60 * 1000))
      const row = byDate.get(date)
      const attended = (row?.present ?? 0) + (row?.late ?? 0)
      const counted = (row?.marked ?? 0) - (row?.excused ?? 0) - (row?.permission ?? 0)
      return {
        date,
        present: row?.present ?? 0,
        absent: row?.absent ?? 0,
        late: row?.late ?? 0,
        excused: row?.excused ?? 0,
        sick: row?.sick ?? 0,
        permission: row?.permission ?? 0,
        marked: row?.marked ?? 0,
        attendanceRate: counted > 0 ? Math.round((attended / counted) * 1000) / 10 : null,
      }
    })
    ok(res, { session: query.session, days, series })
  }),
)

router.get(
  '/attendance/reports/classes',
  requirePermission('attendance.reports'),
  validate({
    query: z.object({
      from: dateString.optional(),
      to: dateString.optional(),
      session: z.enum(ATTENDANCE_SESSIONS as [string, ...string[]]).default('daily'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = queryOf<{ from?: string; to?: string; session: string }>(req)
    const to = query.to ?? schoolDate()
    const from = query.from ?? schoolDate(new Date(new Date().getTime() - 29 * 24 * 60 * 60 * 1000))
    if (to < from) throw ApiError.badRequest('The end date cannot be before the start date')
    const scope = await visibleStudentQuery(req.auth!)
    const ids = await Student.find({ status: 'active', ...scope }).distinct('_id')
    const rows = await AttendanceRecord.aggregate([
      { $match: { studentId: { $in: ids }, session: query.session, date: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: '$classId',
          present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
          permission: { $sum: { $cond: [{ $eq: ['$status', 'permission'] }, 1, 0] } },
          marked: { $sum: 1 },
        },
      },
      { $lookup: { from: 'classes', localField: '_id', foreignField: '_id', as: 'class' } },
      { $unwind: { path: '$class', preserveNullAndEmptyArrays: true } },
      { $sort: { 'class.order': 1, 'class.name': 1 } },
    ])
    ok(
      res,
      rows.map((row) => {
        const attended = row.present + row.late
        const counted = row.marked - row.excused - row.permission
        return {
          classId: row._id ? String(row._id) : '',
          name: row.class?.name ?? 'Unassigned',
          present: row.present,
          absent: row.absent,
          late: row.late,
          excused: row.excused,
          permission: row.permission,
          marked: row.marked,
          attendanceRate: counted > 0 ? Math.round((attended / counted) * 1000) / 10 : null,
        }
      }),
    )
  }),
)

router.get(
  '/attendance/dormitories',
  requirePermission('attendance.reports'),
  asyncHandler(async (_req, res) => {
    const dormitories = await Dormitory.find({ active: true }).select('name code gender capacity').sort({ name: 1 }).lean()
    ok(res, dormitories)
  }),
)

export const attendanceRouter = router
