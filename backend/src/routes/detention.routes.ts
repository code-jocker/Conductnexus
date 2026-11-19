import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { DetentionSession } from '../models/welfare.js'
import { Incident } from '../models/discipline.js'
import { Term } from '../models/school.js'
import { User } from '../models/core.js'
import { nextRef } from '../shared/refs.js'
import { assertStudentAccess, hasPermission } from '../services/rbac.service.js'
import { writeAudit } from '../services/audit.service.js'
import { notifyPermission, notifyUsers } from '../services/notification.service.js'
import { queueParentMessage } from '../services/communication.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

/**
 * Detention is a supervised reflection measure. Scheduling or completing a
 * detention never writes to the discipline ledger: any conduct deduction must
 * already have gone through the incident workflow.
 */

function canManage(ctx: NonNullable<import('express').Request['auth']>) {
  return hasPermission(ctx, 'detention.manage')
}

function sessionScope(ctx: NonNullable<import('express').Request['auth']>) {
  return canManage(ctx) ? {} : { supervisorId: ctx.userId }
}

function assertSessionAccess(ctx: NonNullable<import('express').Request['auth']>, session: { supervisorId: unknown; createdBy: unknown }) {
  if (canManage(ctx)) return
  if (String(session.supervisorId) !== String(ctx.userId) && String(session.createdBy) !== String(ctx.userId)) {
    throw ApiError.forbidden('This detention session is supervised by another staff member')
  }
}

async function assertActiveStaff(id: string) {
  const user = await User.findOne({ _id: id, status: 'active' }).lean()
  if (!user) throw ApiError.badRequest('Select an active staff member')
  return user
}

router.get(
  '/detention/overview',
  requirePermission('detention.view'),
  asyncHandler(async (req, res) => {
    const now = new Date()
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000)
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000)
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000)
    const scope = sessionScope(req.auth!)

    const [today, upcoming, missed, attendanceWindow, repeated] = await Promise.all([
      DetentionSession.find({ ...scope, scheduledAt: { $gte: startOfDay, $lt: endOfDay } })
        .sort({ scheduledAt: 1 })
        .populate('studentId', 'fullName studentId classId')
        .populate('supervisorId', 'name')
        .lean(),
      DetentionSession.countDocuments({ ...scope, status: 'scheduled', scheduledAt: { $gte: now, $lte: weekAhead } }),
      DetentionSession.countDocuments({ ...scope, status: 'missed', scheduledAt: { $gte: monthAgo } }),
      DetentionSession.aggregate([
        { $match: { ...scope, scheduledAt: { $gte: monthAgo }, status: { $in: ['attended', 'completed', 'missed'] } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      DetentionSession.aggregate([
        { $match: { ...scope, status: 'missed', scheduledAt: { $gte: monthAgo } } },
        { $group: { _id: '$studentId', misses: { $sum: 1 } } },
        { $match: { misses: { $gte: 2 } } },
        { $sort: { misses: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'student' } },
        { $unwind: '$student' },
        { $project: { misses: 1, fullName: '$student.fullName', studentId: '$student.studentId' } },
      ]),
    ])

    const attended = attendanceWindow.find((r) => r._id === 'attended')?.count ?? 0
    const completed = attendanceWindow.find((r) => r._id === 'completed')?.count ?? 0
    const missedCount = attendanceWindow.find((r) => r._id === 'missed')?.count ?? 0
    const expected = attended + completed + missedCount

    ok(res, {
      today,
      counts: {
        todaySessions: today.length,
        upcoming,
        missedLast30Days: missed,
        attendanceRate: expected ? Math.round(((attended + completed) / expected) * 100) : 100,
      },
      repeatedMisses: repeated,
    })
  }),
)

router.get(
  '/detention/sessions',
  requirePermission('detention.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = { ...sessionScope(req.auth!) }
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.supervisorId) filter.supervisorId = req.query.supervisorId
    if (req.query.from || req.query.to) {
      const range: Record<string, Date> = {}
      if (req.query.from) range.$gte = new Date(String(req.query.from))
      if (req.query.to) range.$lte = new Date(String(req.query.to))
      filter.scheduledAt = range
    }
    const [total, items] = await Promise.all([
      DetentionSession.countDocuments(filter),
      DetentionSession.find(filter)
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId classId')
        .populate('supervisorId', 'name position')
        .populate('incidentId', 'incidentNumber')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/detention/sessions',
  requirePermission('detention.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      incidentId: objectId.optional(),
      reason: z.string().trim().min(5).max(2000),
      scheduledAt: z.string().trim().min(4),
      durationMinutes: z.number().int().min(10).max(240).optional(),
      location: z.string().trim().min(2).max(200),
      supervisorId: objectId,
      notes: z.string().trim().max(2000).optional(),
      notifyGuardian: z.boolean().optional().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const supervisor = await assertActiveStaff(req.body.supervisorId)

    if (req.body.incidentId) {
      const incident = await Incident.findOne({ _id: req.body.incidentId, studentId: student._id }).select('_id').lean()
      if (!incident) throw ApiError.badRequest('The selected incident does not belong to this student')
    }

    const term = await Term.findOne({ isActive: true }).select('_id').lean()
    const reference = await nextRef('DT', 4)
    const session = await DetentionSession.create({
      reference,
      studentId: student._id,
      incidentId: req.body.incidentId,
      reason: req.body.reason,
      scheduledAt: new Date(req.body.scheduledAt),
      durationMinutes: req.body.durationMinutes ?? 60,
      location: req.body.location,
      supervisorId: supervisor._id,
      notes: req.body.notes,
      termId: term?._id,
      createdBy: req.auth!.userId,
      history: [{ by: req.auth!.userId, action: 'scheduled', note: req.body.reason }],
    })

    await notifyUsers([supervisor._id], {
      type: 'detention.scheduled',
      title: 'Detention session assigned',
      message: `${reference}: supervise ${student.fullName} on ${session.scheduledAt.toLocaleDateString('en-GB')} at ${session.scheduledAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`,
      link: '/welfare?tab=detention',
      data: { detentionId: String(session._id) },
    })

    let guardianMessage = null
    if (req.body.notifyGuardian !== false) {
      guardianMessage = await queueParentMessage({
        studentId: student._id,
        templateKey: 'detention_scheduled',
        dedupeSuffix: `detention:${reference}`,
        extraVars: {
          detentionDate: session.scheduledAt.toLocaleDateString('en-GB'),
          detentionTime: session.scheduledAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          detentionLocation: session.location,
          detentionReason: session.reason,
        },
      })
    }

    await writeAudit({
      req,
      actor: req.auth,
      action: 'detention.scheduled',
      resourceType: 'DetentionSession',
      resourceId: String(session._id),
      after: { studentId: String(student._id), supervisorId: String(supervisor._id), notifyGuardian: req.body.notifyGuardian },
    })
    created(res, { session, guardianMessage })
  }),
)

router.post(
  '/detention/sessions/:id/attend',
  requirePermission('detention.view'),
  asyncHandler(async (req, res) => {
    const session = await DetentionSession.findById(req.params.id)
    if (!session) throw ApiError.notFound('Detention session not found')
    assertSessionAccess(req.auth!, session)
    if (!['scheduled', 'missed'].includes(session.status)) throw ApiError.badRequest('This session has already been closed')
    session.status = 'attended'
    session.attendedAt = new Date()
    session.history.push({ at: new Date(), by: req.auth!.userId, action: 'attended' })
    await session.save()
    await writeAudit({ req, actor: req.auth, action: 'detention.attended', resourceType: 'DetentionSession', resourceId: String(session._id) })
    ok(res, session)
  }),
)

router.post(
  '/detention/sessions/:id/miss',
  requirePermission('detention.view'),
  validate({ body: z.object({ notes: z.string().trim().min(3).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const session = await DetentionSession.findById(req.params.id)
    if (!session) throw ApiError.notFound('Detention session not found')
    assertSessionAccess(req.auth!, session)
    if (!['scheduled', 'missed'].includes(session.status)) throw ApiError.badRequest('This session has already been closed')
    session.status = 'missed'
    session.notes = [session.notes, req.body.notes].filter(Boolean).join('\n')
    session.history.push({ at: new Date(), by: req.auth!.userId, action: 'missed', note: req.body.notes })
    await session.save()
    await notifyPermission(
      'detention.manage',
      {
        type: 'detention.missed',
        title: 'Detention session missed',
        message: `${session.reference} was missed. Recorded note: ${req.body.notes}`,
        link: '/welfare?tab=detention',
        data: { detentionId: String(session._id) },
      },
      { excludeUserId: String(req.auth!.userId) },
    )
    await writeAudit({ req, actor: req.auth, action: 'detention.missed', resourceType: 'DetentionSession', resourceId: String(session._id), reason: req.body.notes })
    ok(res, session)
  }),
)

router.post(
  '/detention/sessions/:id/complete',
  requirePermission('detention.view'),
  validate({ body: z.object({ notes: z.string().trim().max(2000).optional() }) }),
  asyncHandler(async (req, res) => {
    const session = await DetentionSession.findById(req.params.id)
    if (!session) throw ApiError.notFound('Detention session not found')
    assertSessionAccess(req.auth!, session)
    if (session.status === 'cancelled') throw ApiError.badRequest('A cancelled session cannot be completed')
    session.status = 'completed'
    session.completedAt = new Date()
    if (!session.attendedAt) session.attendedAt = new Date()
    if (req.body.notes) session.notes = [session.notes, req.body.notes].filter(Boolean).join('\n')
    session.history.push({ at: new Date(), by: req.auth!.userId, action: 'completed', note: req.body.notes })
    await session.save()
    await writeAudit({ req, actor: req.auth, action: 'detention.completed', resourceType: 'DetentionSession', resourceId: String(session._id) })
    ok(res, session)
  }),
)

router.post(
  '/detention/sessions/:id/cancel',
  requirePermission('detention.manage'),
  validate({ body: z.object({ reason: z.string().trim().min(4).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const session = await DetentionSession.findById(req.params.id)
    if (!session) throw ApiError.notFound('Detention session not found')
    if (session.status === 'completed') throw ApiError.badRequest('A completed session cannot be cancelled')
    session.status = 'cancelled'
    session.cancelledReason = req.body.reason
    session.history.push({ at: new Date(), by: req.auth!.userId, action: 'cancelled', note: req.body.reason })
    await session.save()
    await writeAudit({ req, actor: req.auth, action: 'detention.cancelled', resourceType: 'DetentionSession', resourceId: String(session._id), reason: req.body.reason })
    ok(res, session)
  }),
)

router.post(
  '/detention/sessions/:id/reschedule',
  requirePermission('detention.manage'),
  validate({
    body: z.object({
      scheduledAt: z.string().trim().min(4),
      supervisorId: objectId.optional(),
      reason: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const session = await DetentionSession.findById(req.params.id)
    if (!session) throw ApiError.notFound('Detention session not found')
    if (session.status === 'completed' || session.status === 'cancelled') throw ApiError.badRequest('This session is already closed')
    session.scheduledAt = new Date(req.body.scheduledAt)
    if (req.body.supervisorId) {
      const supervisor = await assertActiveStaff(String(req.body.supervisorId))
      session.supervisorId = supervisor._id
    }
    session.status = 'scheduled'
    session.history.push({ at: new Date(), by: req.auth!.userId, action: 'rescheduled', note: req.body.reason })
    await session.save()
    await writeAudit({ req, actor: req.auth, action: 'detention.rescheduled', resourceType: 'DetentionSession', resourceId: String(session._id), after: { scheduledAt: session.scheduledAt } })
    ok(res, session)
  }),
)

export default router
