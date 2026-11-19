import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, paginated, parsePagination, queryOf, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Dormitory, Student } from '../models/school.js'
import { BoardingAllocation, BoardingMovement } from '../models/attendance.js'
import { FollowUp } from '../models/support.js'
import { assertStudentAccess, visibleStudentQuery } from '../services/rbac.service.js'
import { writeAudit } from '../services/audit.service.js'
import { queueParentMessage } from '../services/communication.service.js'
import { notifyPermission } from '../services/notification.service.js'
import { logger } from '../shared/logger.js'
import { nextRef } from '../shared/refs.js'
import { objectId, optionalDate } from './helpers.js'

const router = Router()
router.use(authenticate)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const dateString = z.string().trim().regex(DATE_RE, 'Use YYYY-MM-DD')
const MOVEMENT_TYPES = ['exit', 'return', 'weekend_permission', 'medical', 'school_activity', 'home', 'other'] as const

function schoolDate(value?: string | Date): string {
  if (typeof value === 'string' && DATE_RE.test(value)) return value
  const date = value ? new Date(value) : new Date()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(date)
}

function formatMoment(value?: Date | null): string {
  if (!value) return 'the agreed time'
  return new Date(value).toLocaleString('en-RW', { timeZone: 'Africa/Kigali', dateStyle: 'medium', timeStyle: 'short' })
}

async function expireOverdueMovements(): Promise<void> {
  await BoardingMovement.updateMany(
    { status: 'out', expectedReturnAt: { $ne: null, $lt: new Date() } },
    { $set: { status: 'overdue' } },
  )
}

async function notifyOverdue(movement: InstanceType<typeof BoardingMovement>): Promise<boolean> {
  if (movement.overdueNotifiedAt) return false
  const [student, dormitory] = await Promise.all([
    Student.findById(movement.studentId).select('fullName').lean(),
    movement.dormitoryId ? Dormitory.findById(movement.dormitoryId).select('name').lean() : null,
  ])
  if (!student) return false
  try {
    const result = await queueParentMessage({
      studentId: movement.studentId,
      templateKey: 'boarding_return_overdue',
      dedupeSuffix: `boarding-overdue:${movement.reference}`,
      extraVars: {
        dormitoryName: dormitory?.name ?? 'the dormitory',
        expectedReturnAt: formatMoment(movement.expectedReturnAt),
        movementDestination: movement.destination,
      },
    })
    if (result.queued > 0) {
      movement.overdueNotifiedAt = new Date()
      movement.guardianNotifiedAt = movement.guardianNotifiedAt ?? new Date()
      await movement.save()
      return true
    }
  } catch (err) {
    logger.warn({ err, movementId: String(movement._id) }, 'Boarding overdue notification could not be queued')
  }
  return false
}

router.get(
  '/boarding/overview',
  requirePermission('boarding.view'),
  asyncHandler(async (req, res) => {
    await expireOverdueMovements()
    const scope = await visibleStudentQuery(req.auth!)
    const students = await Student.find({ status: 'active', ...scope })
      .select('dormitoryId boardingStatus roomNumber')
      .lean()
    const visibleDorms = new Set(students.map((s) => (s.dormitoryId ? String(s.dormitoryId) : '')).filter(Boolean))
    const dormitories = await Dormitory.find({ active: true }).select('name code gender capacity').sort({ name: 1 }).lean()
    const movements = await BoardingMovement.find({ status: { $in: ['out', 'overdue'] } })
      .populate('studentId', 'fullName studentId classId')
      .populate('dormitoryId', 'name code')
      .sort({ expectedReturnAt: 1 })
      .limit(200)
      .lean()
    const visibleMovements = movements.filter(
      (m) => !m.dormitoryId || visibleDorms.has(String((m.dormitoryId as unknown as { _id?: Types.ObjectId })?._id ?? m.dormitoryId)),
    )
    const rows = dormitories.map((dorm) => {
      const residentIds = students.filter((s) => String(s.dormitoryId) === String(dorm._id)).map((s) => String(s._id))
      const dormMovements = visibleMovements.filter((m) => String((m.dormitoryId as unknown as { _id?: Types.ObjectId })?._id ?? '') === String(dorm._id))
      return {
        _id: dorm._id,
        name: dorm.name,
        code: dorm.code,
        gender: dorm.gender,
        capacity: dorm.capacity,
        residents: residentIds.length,
        occupancy: dorm.capacity > 0 ? Math.round((residentIds.length / dorm.capacity) * 1000) / 10 : null,
        outNow: dormMovements.filter((m) => m.status === 'out').length,
        overdue: dormMovements.filter((m) => m.status === 'overdue').length,
        missing: dormMovements.filter((m) => m.missingReportedAt && !m.resolvedAt).length,
      }
    })
    const unallocated = students.filter((s) => !s.dormitoryId).length
    ok(res, {
      dormitories: rows,
      unallocated,
      totals: {
        residents: students.filter((s) => s.dormitoryId).length,
        outNow: visibleMovements.filter((m) => m.status === 'out').length,
        overdue: visibleMovements.filter((m) => m.status === 'overdue').length,
        missing: visibleMovements.filter((m) => m.missingReportedAt && !m.resolvedAt).length,
      },
      openMovements: visibleMovements,
    })
  }),
)

router.get(
  '/boarding/allocations',
  requirePermission('boarding.view'),
  validate({
    query: z.object({
      dormitoryId: objectId.optional(),
      active: z.enum(['true', 'false', 'all']).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = queryOf<{ dormitoryId?: string; active?: string }>(req)
    const filter: Record<string, unknown> = {}
    if (query.dormitoryId) filter.dormitoryId = query.dormitoryId
    if (query.active !== 'all') filter.active = query.active !== 'false'
    const { page, pageSize, skip } = parsePagination(req.query as Record<string, unknown>)
    const [items, total] = await Promise.all([
      BoardingAllocation.find(filter)
        .populate('studentId', 'fullName studentId classId gender')
        .populate('dormitoryId', 'name code')
        .populate('allocatedBy', 'name')
        .sort({ active: -1, allocatedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      BoardingAllocation.countDocuments(filter),
    ])
    paginated(res, items, total, page, pageSize)
  }),
)

const allocateBody = z.object({
  studentId: objectId,
  dormitoryId: objectId,
  roomNumber: z.string().trim().max(20).optional(),
  bedNumber: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(1000).optional(),
})

async function assertCapacity(dormitoryId: string, additional = 1): Promise<InstanceType<typeof Dormitory>> {
  const dormitory = await Dormitory.findById(dormitoryId)
  if (!dormitory) throw ApiError.notFound('Dormitory not found')
  if (!dormitory.active) throw ApiError.badRequest('This dormitory is inactive')
  if (dormitory.capacity > 0) {
    const current = await Student.countDocuments({ dormitoryId: dormitory._id, status: 'active' })
    if (current + additional > dormitory.capacity) {
      throw ApiError.conflict(`${dormitory.name} has ${dormitory.capacity} beds; ${current} are already allocated`)
    }
  }
  return dormitory
}

router.post(
  '/boarding/allocations',
  requirePermission('boarding.manage'),
  validate({ body: allocateBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof allocateBody>
    const student = await assertStudentAccess(req.auth!, body.studentId)
    const dormitory = await assertCapacity(body.dormitoryId)
    if (dormitory.gender !== 'mixed' && dormitory.gender !== student.gender) {
      throw ApiError.badRequest(`${dormitory.name} accommodates ${dormitory.gender} students only`)
    }
    await BoardingAllocation.updateMany(
      { studentId: student._id, active: true },
      { $set: { active: false, releasedAt: new Date(), releaseReason: 'Reallocated' } },
    )
    const allocation = await BoardingAllocation.create({
      studentId: student._id,
      dormitoryId: dormitory._id,
      roomNumber: body.roomNumber,
      bedNumber: body.bedNumber,
      allocatedBy: req.auth!.userId,
      notes: body.notes,
      active: true,
    })
    student.dormitoryId = dormitory._id
    student.roomNumber = body.roomNumber
    student.boardingStatus = 'boarding'
    student.enrollmentHistory.push({
      dormitoryId: dormitory._id,
      action: 'boarding_allocation',
      reason: body.notes,
      at: new Date(),
      by: req.auth!.userId,
    })
    await student.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.student_allocated',
      resourceType: 'BoardingAllocation',
      resourceId: String(allocation._id),
      after: { studentId: String(student._id), dormitoryId: String(dormitory._id), roomNumber: body.roomNumber, bedNumber: body.bedNumber },
    })
    created(res, { allocation, occupancy: await Student.countDocuments({ dormitoryId: dormitory._id, status: 'active' }) })
  }),
)

router.post(
  '/boarding/allocations/bulk',
  requirePermission('boarding.manage'),
  validate({
    body: z.object({
      studentIds: z.array(objectId).min(1).max(200),
      dormitoryId: objectId,
      roomNumber: z.string().trim().max(20).optional(),
      notes: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { studentIds: string[]; dormitoryId: string; roomNumber?: string; notes?: string }
    const uniqueIds = [...new Set(body.studentIds)]
    const dormitory = await assertCapacity(body.dormitoryId, uniqueIds.length)
    const allocations: string[] = []
    const skipped: string[] = []
    for (const studentId of uniqueIds) {
      const student = await Student.findById(studentId)
      if (!student || student.status !== 'active') {
        skipped.push(studentId)
        continue
      }
      if (dormitory.gender !== 'mixed' && dormitory.gender !== student.gender) {
        skipped.push(studentId)
        continue
      }
      await BoardingAllocation.updateMany(
        { studentId: student._id, active: true },
        { $set: { active: false, releasedAt: new Date(), releaseReason: 'Reallocated' } },
      )
      const allocation = await BoardingAllocation.create({
        studentId: student._id,
        dormitoryId: dormitory._id,
        roomNumber: body.roomNumber,
        allocatedBy: req.auth!.userId,
        notes: body.notes,
        active: true,
      })
      student.dormitoryId = dormitory._id
      student.roomNumber = body.roomNumber
      student.boardingStatus = 'boarding'
      student.enrollmentHistory.push({
        dormitoryId: dormitory._id,
        action: 'boarding_allocation',
        reason: body.notes,
        at: new Date(),
        by: req.auth!.userId,
      })
      await student.save()
      allocations.push(String(allocation._id))
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.bulk_allocated',
      resourceType: 'BoardingAllocation',
      after: { dormitoryId: body.dormitoryId, allocated: allocations.length, skipped: skipped.length },
    })
    ok(res, { allocated: allocations.length, skipped: skipped.length, allocationIds: allocations })
  }),
)

router.post(
  '/boarding/allocations/:id/release',
  requirePermission('boarding.manage'),
  validate({ body: z.object({ reason: z.string().trim().min(3).max(500) }) }),
  asyncHandler(async (req, res) => {
    const allocation = await BoardingAllocation.findById(req.params.id)
    if (!allocation) throw ApiError.notFound('Allocation not found')
    if (!allocation.active) throw ApiError.badRequest('This allocation has already been released')
    const student = await Student.findById(allocation.studentId)
    allocation.active = false
    allocation.releasedAt = new Date()
    allocation.releaseReason = req.body.reason
    await allocation.save()
    if (student && String(student.dormitoryId ?? '') === String(allocation.dormitoryId)) {
      student.dormitoryId = null
      student.roomNumber = undefined
      student.boardingStatus = 'day'
      student.enrollmentHistory.push({
        action: 'boarding_released',
        reason: req.body.reason,
        at: new Date(),
        by: req.auth!.userId,
      })
      await student.save()
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.allocation_released',
      resourceType: 'BoardingAllocation',
      resourceId: String(allocation._id),
      reason: req.body.reason,
    })
    ok(res, allocation)
  }),
)

router.get(
  '/boarding/movements',
  requirePermission('boarding.view'),
  validate({
    query: z.object({
      status: z.enum(['out', 'returned', 'overdue', 'cancelled', 'open']).optional(),
      type: z.enum(MOVEMENT_TYPES).optional(),
      studentId: objectId.optional(),
      dormitoryId: objectId.optional(),
      from: dateString.optional(),
      to: dateString.optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    await expireOverdueMovements()
    const query = queryOf<Record<string, string | undefined>>(req)
    const filter: Record<string, unknown> = {}
    if (query.status === 'open') filter.status = { $in: ['out', 'overdue'] }
    else if (query.status) filter.status = query.status
    if (query.type) filter.type = query.type
    if (query.studentId) filter.studentId = query.studentId
    if (query.dormitoryId) filter.dormitoryId = query.dormitoryId
    if (query.from || query.to) {
      filter.outAt = {
        ...(query.from ? { $gte: new Date(`${query.from}T00:00:00+02:00`) } : {}),
        ...(query.to ? { $lte: new Date(`${query.to}T23:59:59+02:00`) } : {}),
      }
    }
    const { page, pageSize, skip } = parsePagination(req.query as Record<string, unknown>)
    const [items, total] = await Promise.all([
      BoardingMovement.find(filter)
        .populate('studentId', 'fullName studentId classId dormitoryId')
        .populate('dormitoryId', 'name code')
        .populate('approvedBy', 'name')
        .populate('createdBy', 'name')
        .sort({ outAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      BoardingMovement.countDocuments(filter),
    ])
    paginated(res, items, total, page, pageSize)
  }),
)

const movementBody = z.object({
  studentId: objectId,
  type: z.enum(MOVEMENT_TYPES).default('exit'),
  destination: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(3).max(1000),
  outAt: optionalDate,
  expectedReturnAt: optionalDate,
  notes: z.string().trim().max(1000).optional(),
})

router.post(
  '/boarding/movements',
  requirePermission('boarding.record'),
  validate({ body: movementBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof movementBody>
    const student = await assertStudentAccess(req.auth!, body.studentId)
    if (student.boardingStatus !== 'boarding' && !student.dormitoryId) {
      throw ApiError.badRequest(`${student.fullName} is not a boarding student`)
    }
    if (body.expectedReturnAt && body.outAt && body.expectedReturnAt < body.outAt) {
      throw ApiError.badRequest('The expected return time cannot be before the exit time')
    }
    const isReturn = body.type === 'return'
    const movement = await BoardingMovement.create({
      reference: await nextRef('BRD'),
      studentId: student._id,
      dormitoryId: student.dormitoryId,
      type: body.type,
      destination: body.destination,
      reason: body.reason,
      outAt: body.outAt ?? new Date(),
      expectedReturnAt: body.expectedReturnAt,
      notes: body.notes,
      approvedBy: req.auth!.userId,
      createdBy: req.auth!.userId,
      status: isReturn ? 'returned' : 'out',
      returnedAt: isReturn ? body.outAt ?? new Date() : undefined,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: isReturn ? 'boarding.student_return_recorded' : 'boarding.movement_recorded',
      resourceType: 'BoardingMovement',
      resourceId: String(movement._id),
      after: {
        studentId: String(student._id),
        type: body.type,
        destination: body.destination,
        expectedReturnAt: body.expectedReturnAt,
      },
    })
    created(res, movement)
  }),
)

router.post(
  '/boarding/movements/:id/return',
  requirePermission('boarding.record'),
  validate({
    body: z.object({
      returnedAt: optionalDate,
      notes: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const movement = await BoardingMovement.findById(req.params.id)
    if (!movement) throw ApiError.notFound('Movement not found')
    if (movement.status === 'cancelled') throw ApiError.badRequest('A cancelled movement cannot be returned')
    if (movement.status === 'returned') {
      ok(res, movement)
      return
    }
    movement.status = 'returned'
    movement.returnedAt = req.body.returnedAt ?? new Date()
    if (movement.missingReportedAt) {
      movement.resolvedAt = new Date()
      movement.resolutionNote = movement.resolutionNote ?? req.body.notes ?? 'Returned to school'
    }
    if (req.body.notes) movement.notes = `${movement.notes ? `${movement.notes}\n` : ''}${req.body.notes}`
    await movement.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.student_returned',
      resourceType: 'BoardingMovement',
      resourceId: String(movement._id),
      after: { returnedAt: movement.returnedAt, resolvedMissing: Boolean(movement.missingReportedAt) },
    })
    ok(res, movement)
  }),
)

router.post(
  '/boarding/movements/:id/cancel',
  requirePermission('boarding.record'),
  validate({ body: z.object({ reason: z.string().trim().min(3).max(500) }) }),
  asyncHandler(async (req, res) => {
    const movement = await BoardingMovement.findById(req.params.id)
    if (!movement) throw ApiError.notFound('Movement not found')
    if (movement.returnedAt) throw ApiError.badRequest('A completed movement cannot be cancelled')
    movement.status = 'cancelled'
    movement.resolutionNote = req.body.reason
    await movement.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.movement_cancelled',
      resourceType: 'BoardingMovement',
      resourceId: String(movement._id),
      reason: req.body.reason,
    })
    ok(res, movement)
  }),
)

router.post(
  '/boarding/movements/:id/flag-overdue',
  requirePermission('boarding.record'),
  asyncHandler(async (req, res) => {
    const movement = await BoardingMovement.findById(req.params.id)
    if (!movement) throw ApiError.notFound('Movement not found')
    if (movement.status === 'returned' || movement.status === 'cancelled') {
      throw ApiError.badRequest('This movement is already closed')
    }
    movement.status = 'overdue'
    await movement.save()
    const notified = await notifyOverdue(movement)
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.overdue_flagged',
      resourceType: 'BoardingMovement',
      resourceId: String(movement._id),
      after: { guardianNotified: notified },
    })
    ok(res, { movement, guardianNotified: notified })
  }),
)

router.post(
  '/boarding/movements/:id/missing',
  requirePermission('boarding.escalate'),
  validate({ body: z.object({ note: z.string().trim().max(1000).optional() }) }),
  asyncHandler(async (req, res) => {
    const movement = await BoardingMovement.findById(req.params.id)
    if (!movement) throw ApiError.notFound('Movement not found')
    if (movement.status === 'returned') throw ApiError.badRequest('This student has already returned')
    if (movement.missingReportedAt) throw ApiError.conflict('This movement has already been escalated as missing')
    const [student, dormitory] = await Promise.all([
      Student.findById(movement.studentId).select('fullName studentId').lean(),
      movement.dormitoryId ? Dormitory.findById(movement.dormitoryId).select('name').lean() : null,
    ])
    if (!student) throw ApiError.notFound('Student not found')
    movement.missingReportedAt = new Date()
    movement.missingReportedBy = req.auth!.userId
    movement.escalatedAt = new Date()
    movement.escalatedTo = ['HEADTEACHER', 'DEPUTY_DISCIPLINE', 'PATRON', 'MATRON']
    movement.status = 'overdue'
    if (req.body.note) movement.notes = `${movement.notes ? `${movement.notes}\n` : ''}${req.body.note}`
    await movement.save()
    await notifyPermission('boarding.escalate', {
      type: 'safeguarding.missing_student',
      title: 'Missing boarding student',
      message: `${student.fullName} (${student.studentId}) is missing from ${dormitory?.name ?? 'the dormitory'}; last approved destination: ${movement.destination}.`,
      link: '/boarding',
      data: { movementId: String(movement._id), studentId: String(student._id) },
    })
    try {
      const result = await queueParentMessage({
        studentId: movement.studentId,
        templateKey: 'boarding_missing_student',
        dedupeSuffix: `boarding-missing:${movement.reference}`,
        critical: true,
        extraVars: {
          dormitoryName: dormitory?.name ?? 'the dormitory',
          lastSeenAt: formatMoment(movement.outAt),
          movementDestination: movement.destination,
        },
      })
      if (result.queued > 0) movement.guardianNotifiedAt = new Date()
    } catch (err) {
      logger.warn({ err, movementId: String(movement._id) }, 'Missing-student guardians could not be messaged')
    }
    await movement.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.missing_reported',
      resourceType: 'BoardingMovement',
      resourceId: String(movement._id),
      after: { studentId: String(student._id), destination: movement.destination, escalatedTo: movement.escalatedTo },
      reason: req.body.note,
    })
    created(res, movement)
  }),
)

router.post(
  '/boarding/movements/:id/resolve',
  requirePermission('boarding.escalate'),
  validate({
    body: z.object({
      note: z.string().trim().min(3).max(1000),
      returned: z.boolean().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    const movement = await BoardingMovement.findById(req.params.id)
    if (!movement) throw ApiError.notFound('Movement not found')
    movement.resolvedAt = new Date()
    movement.resolutionNote = req.body.note
    if (req.body.returned) {
      movement.status = 'returned'
      movement.returnedAt = movement.returnedAt ?? new Date()
    }
    await movement.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.missing_resolved',
      resourceType: 'BoardingMovement',
      resourceId: String(movement._id),
      after: { returned: req.body.returned },
      reason: req.body.note,
    })
    ok(res, movement)
  }),
)

router.post(
  '/boarding/followups',
  requirePermission('boarding.record'),
  validate({
    body: z.object({
      studentId: objectId,
      dueDate: z.string().trim().min(4),
      assignedTo: objectId.optional(),
      notes: z.string().trim().min(3).max(1000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const dueDate = new Date(req.body.dueDate)
    if (Number.isNaN(dueDate.getTime())) throw ApiError.badRequest('Invalid follow-up date')
    const followUp = await FollowUp.create({
      studentId: student._id,
      type: 'boarding_welfare',
      dueDate,
      assignedTo: req.body.assignedTo ?? req.auth!.userId,
      notes: req.body.notes,
      createdBy: req.auth!.userId,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'boarding.welfare_followup_created',
      resourceType: 'FollowUp',
      resourceId: String(followUp._id),
      after: { studentId: String(student._id), dueDate: req.body.dueDate },
    })
    created(res, followUp)
  }),
)

router.get(
  '/boarding/reports/matron',
  requirePermission('attendance.reports'),
  validate({
    query: z.object({
      from: dateString.optional(),
      to: dateString.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    await expireOverdueMovements()
    const query = queryOf<{ from?: string; to?: string }>(req)
    const to = query.to ?? schoolDate()
    const from = query.from ?? schoolDate(new Date(new Date().getTime() - 29 * 24 * 60 * 60 * 1000))
    const dormitories = await Dormitory.find({ active: true }).select('name code capacity gender').sort({ name: 1 }).lean()
    const students = await Student.find({ status: 'active', dormitoryId: { $ne: null } })
      .select('dormitoryId')
      .lean()
    const movements = await BoardingMovement.find({
      outAt: { $gte: new Date(`${from}T00:00:00+02:00`), $lte: new Date(`${to}T23:59:59+02:00`) },
    }).lean()
    const followUps = await FollowUp.find({ type: 'boarding_welfare' }).select('studentId status dueDate').lean()
    const studentDorm = new Map(students.map((s) => [String(s._id), String(s.dormitoryId)]))
    const rows = dormitories.map((dorm) => {
      const dormMovements = movements.filter((m) => String(m.dormitoryId ?? '') === String(dorm._id))
      const residentIds = students.filter((s) => String(s.dormitoryId) === String(dorm._id)).map((s) => String(s._id))
      return {
        dormitoryId: String(dorm._id),
        name: dorm.name,
        code: dorm.code,
        capacity: dorm.capacity,
        residents: residentIds.length,
        exits: dormMovements.filter((m) => m.type !== 'return').length,
        returns: dormMovements.filter((m) => m.status === 'returned' || m.type === 'return').length,
        weekendPermissions: dormMovements.filter((m) => m.type === 'weekend_permission').length,
        overdueNow: dormMovements.filter((m) => m.status === 'overdue').length,
        missingUnresolved: dormMovements.filter((m) => m.missingReportedAt && !m.resolvedAt).length,
        welfareFollowUps: followUps.filter(
          (f) => f.status !== 'completed' && studentDorm.get(String(f.studentId)) === String(dorm._id),
        ).length,
      }
    })
    ok(res, { from, to, dormitories: rows })
  }),
)

export const boardingRouter = router
