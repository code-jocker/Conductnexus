import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import {
  CounsellingAppointment,
  CounsellingRecord,
  WelfareReferral,
  WelfareSupportPlan,
} from '../models/welfare.js'
import { SafeguardingCase } from '../models/governance.js'
import { FollowUp } from '../models/support.js'
import { Role, User, UserRole } from '../models/core.js'
import { nextRef } from '../shared/refs.js'
import { assertStudentAccess, hasPermission, hasRole } from '../services/rbac.service.js'
import { writeAccessLog, writeAudit } from '../services/audit.service.js'
import { notifyPermission, notifyUsers } from '../services/notification.service.js'
import { queueParentMessage } from '../services/communication.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

/**
 * Confidential welfare centre.
 *
 * Discipline records and welfare records never share collections, and welfare
 * access is never implied by discipline visibility. Staff either hold
 * `welfare.view_all` (leadership / support lead) or only see the cases they own.
 */

function seesAllWelfare(ctx: NonNullable<import('express').Request['auth']>) {
  return hasPermission(ctx, 'welfare.view_all') || hasRole(ctx, 'HEADTEACHER')
}

function appointmentScope(ctx: NonNullable<import('express').Request['auth']>) {
  if (seesAllWelfare(ctx)) return {}
  return { $or: [{ counsellorId: ctx.userId }, { createdBy: ctx.userId }] }
}

function planScope(ctx: NonNullable<import('express').Request['auth']>) {
  if (seesAllWelfare(ctx)) return {}
  return { $or: [{ assignedTo: ctx.userId }, { createdBy: ctx.userId }] }
}

function referralScope(ctx: NonNullable<import('express').Request['auth']>) {
  if (seesAllWelfare(ctx) || hasPermission(ctx, 'welfare.manage')) {
    if (!seesAllWelfare(ctx)) return { $or: [{ fromStaffId: ctx.userId }, { assignedTo: ctx.userId }] }
    return {}
  }
  return { fromStaffId: ctx.userId }
}

function assertAppointmentAccess(ctx: NonNullable<import('express').Request['auth']>, doc: { counsellorId: Types.ObjectId; createdBy: Types.ObjectId }) {
  if (seesAllWelfare(ctx)) return
  if (String(doc.counsellorId) !== String(ctx.userId) && String(doc.createdBy) !== String(ctx.userId)) {
    throw ApiError.forbidden('This counselling appointment is assigned to another staff member')
  }
}

function assertPlanAccess(ctx: NonNullable<import('express').Request['auth']>, doc: { assignedTo: Types.ObjectId; createdBy: Types.ObjectId }) {
  if (seesAllWelfare(ctx)) return
  if (String(doc.assignedTo) !== String(ctx.userId) && String(doc.createdBy) !== String(ctx.userId)) {
    throw ApiError.forbidden('This support plan is assigned to another staff member')
  }
}

function refId(ref: unknown): string {
  if (!ref) return ''
  if (typeof ref === 'object' && '_id' in (ref as Record<string, unknown>)) {
    return String((ref as { _id: unknown })._id)
  }
  return String(ref)
}

async function assertActiveStaff(id: string) {
  const user = await User.findOne({ _id: id, status: 'active' }).lean()
  if (!user) throw ApiError.badRequest('Select an active staff member')
  return user
}

const goalSchema = z.object({
  description: z.string().trim().min(2).max(400),
  actions: z.string().trim().max(600).optional(),
  targetDate: z.string().trim().optional(),
  progress: z.number().int().min(0).max(100).optional(),
})

type PlanGoalInput = { description?: string; actions?: string; targetDate?: string; progress?: number }

// ── Staff options ──────────────────────────────────────────────────────────

router.get(
  '/welfare/staff',
  requirePermission('welfare.manage', 'welfare.assign'),
  asyncHandler(async (_req, res) => {
    // Guardians are not staff: never offer parent-only accounts as counsellors,
    // supervisors or case owners.
    const parentRole = await Role.findOne({ key: 'PARENT' }).select('_id').lean()
    let parentOnlyIds: Types.ObjectId[] = []
    if (parentRole) {
      const parentLinks = await UserRole.find({ roleId: parentRole._id }).select('userId').lean()
      const ids = parentLinks.map((l) => l.userId)
      if (ids.length) {
        const staffLinks = await UserRole.find({ userId: { $in: ids }, roleId: { $ne: parentRole._id } })
          .select('userId')
          .lean()
        const staffIds = new Set(staffLinks.map((l) => String(l.userId)))
        parentOnlyIds = ids.filter((id) => !staffIds.has(String(id)))
      }
    }
    const staff = await User.find({ status: 'active', _id: { $nin: parentOnlyIds } })
      .select('name position')
      .sort({ name: 1 })
      .limit(300)
      .lean()
    ok(res, staff.map((u) => ({ _id: String(u._id), name: u.name, position: u.position })))
  }),
)

// ── Overview ───────────────────────────────────────────────────────────────

router.get(
  '/welfare/overview',
  requirePermission('welfare.view'),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const now = new Date()
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000)
    const appointmentFilter = { ...appointmentScope(ctx), status: 'scheduled', scheduledAt: { $gte: now, $lte: weekAhead } }
    const planFilter = { ...planScope(ctx), status: { $in: ['active', 'reopened'] } }
    const referralFilter = { ...referralScope(ctx), status: { $in: ['pending', 'accepted', 'in_progress'] } }
    const followUpFilter = {
      type: { $in: ['counselling', 'parent_meeting', 'boarding_welfare'] },
      status: { $in: ['pending', 'overdue'] },
      ...(seesAllWelfare(ctx) ? {} : { assignedTo: ctx.userId }),
    }

    const [appointments, plans, referrals, followUps, planCount, referralCount, overdueFollowUps] = await Promise.all([
      CounsellingAppointment.find(appointmentFilter)
        .sort({ scheduledAt: 1 })
        .limit(8)
        .select('-notes -history')
        .populate('studentId', 'fullName studentId classId')
        .populate('counsellorId', 'name position')
        .lean(),
      WelfareSupportPlan.find(planFilter)
        .sort({ reviewDate: 1 })
        .limit(8)
        .select('-confidentialNotes -history')
        .populate('studentId', 'fullName studentId classId')
        .populate('assignedTo', 'name position')
        .lean(),
      WelfareReferral.find(referralFilter)
        .sort({ createdAt: -1 })
        .limit(8)
        .select('-history')
        .populate('studentId', 'fullName studentId classId')
        .populate('fromStaffId', 'name position')
        .lean(),
      FollowUp.find(followUpFilter)
        .sort({ dueDate: 1 })
        .limit(8)
        .populate('studentId', 'fullName studentId')
        .populate('assignedTo', 'name')
        .lean(),
      WelfareSupportPlan.countDocuments(planFilter),
      WelfareReferral.countDocuments(referralFilter),
      FollowUp.countDocuments({ ...followUpFilter, dueDate: { $lt: now } }),
    ])

    ok(res, {
      counts: {
        openPlans: planCount,
        openReferrals: referralCount,
        upcomingAppointments: await CounsellingAppointment.countDocuments(appointmentFilter),
        pendingFollowUps: await FollowUp.countDocuments(followUpFilter),
        overdueFollowUps,
      },
      appointments,
      plans,
      referrals,
      followUps,
      scope: seesAllWelfare(ctx) ? 'all' : 'assigned',
    })
  }),
)

// ── Counselling appointments ───────────────────────────────────────────────

router.get(
  '/welfare/appointments',
  requirePermission('welfare.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = { ...appointmentScope(req.auth!) }
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.counsellorId) filter.counsellorId = req.query.counsellorId
    if (req.query.from || req.query.to) {
      const range: Record<string, Date> = {}
      if (req.query.from) range.$gte = new Date(String(req.query.from))
      if (req.query.to) range.$lte = new Date(String(req.query.to))
      filter.scheduledAt = range
    }
    const [total, items] = await Promise.all([
      CounsellingAppointment.countDocuments(filter),
      CounsellingAppointment.find(filter)
        .sort({ scheduledAt: 1 })
        .skip(skip)
        .limit(pageSize)
        .select('-notes -history')
        .populate('studentId', 'fullName studentId classId')
        .populate('counsellorId', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/welfare/appointments',
  requirePermission('welfare.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      counsellorId: objectId,
      scheduledAt: z.string().trim().min(4),
      durationMinutes: z.number().int().min(10).max(240).optional(),
      mode: z.enum(['in_person', 'virtual', 'phone']).optional().default('in_person'),
      location: z.string().trim().max(200).optional(),
      reason: z.string().trim().min(5).max(500),
      guardianInformed: z.boolean().optional().default(false),
      notes: z.string().trim().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const counsellor = await assertActiveStaff(req.body.counsellorId)
    const reference = await nextRef('CA', 4)
    const appointment = await CounsellingAppointment.create({
      reference,
      studentId: student._id,
      counsellorId: counsellor._id,
      scheduledAt: new Date(req.body.scheduledAt),
      durationMinutes: req.body.durationMinutes ?? 45,
      mode: req.body.mode,
      location: req.body.location,
      reason: req.body.reason,
      guardianInformed: req.body.guardianInformed,
      notes: req.body.notes,
      createdBy: req.auth!.userId,
      history: [{ by: req.auth!.userId, action: 'scheduled', note: `Counsellor: ${counsellor.name}` }],
    })

    await notifyUsers([counsellor._id], {
      type: 'welfare.appointment',
      title: 'Counselling appointment assigned',
      message: `${reference} with ${student.fullName} on ${appointment.scheduledAt.toISOString()}.`,
      link: '/welfare',
      data: { appointmentId: String(appointment._id), confidential: true },
    })

    if (req.body.guardianInformed) {
      await queueParentMessage({
        studentId: student._id,
        templateKey: 'counselling_appointment',
        dedupeSuffix: `counselling:${reference}`,
        extraVars: {
          appointmentDate: appointment.scheduledAt.toLocaleDateString('en-GB'),
          appointmentTime: appointment.scheduledAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          appointmentLocation: appointment.location ?? 'School welfare office',
        },
      })
    }

    await writeAccessLog({ actor: req.auth!, resourceType: 'CounsellingAppointment', resourceId: String(appointment._id), action: 'created', req })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'welfare.appointment.created',
      resourceType: 'CounsellingAppointment',
      resourceId: String(appointment._id),
      after: { studentId: String(student._id), counsellorId: String(counsellor._id), guardianInformed: req.body.guardianInformed },
    })
    created(res, appointment)
  }),
)

router.patch(
  '/welfare/appointments/:id',
  requirePermission('welfare.manage'),
  validate({
    body: z.object({
      scheduledAt: z.string().trim().min(4).optional(),
      durationMinutes: z.number().int().min(10).max(240).optional(),
      mode: z.enum(['in_person', 'virtual', 'phone']).optional(),
      location: z.string().trim().max(200).optional(),
      counsellorId: objectId.optional(),
      reason: z.string().trim().min(5).max(500).optional(),
      notes: z.string().trim().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const appointment = await CounsellingAppointment.findById(req.params.id)
    if (!appointment) throw ApiError.notFound('Counselling appointment not found')
    assertAppointmentAccess(req.auth!, appointment)
    if (req.body.counsellorId) {
      const counsellor = await assertActiveStaff(req.body.counsellorId)
      appointment.counsellorId = counsellor._id
    }
    if (req.body.scheduledAt) appointment.scheduledAt = new Date(req.body.scheduledAt)
    if (req.body.durationMinutes) appointment.durationMinutes = req.body.durationMinutes
    if (req.body.mode) appointment.mode = req.body.mode
    if (req.body.location !== undefined) appointment.location = req.body.location
    if (req.body.reason) appointment.reason = req.body.reason
    if (req.body.notes !== undefined) appointment.notes = req.body.notes
    appointment.history.push({ at: new Date(), by: req.auth!.userId, action: 'updated' })
    await appointment.save()
    await writeAudit({ req, actor: req.auth, action: 'welfare.appointment.updated', resourceType: 'CounsellingAppointment', resourceId: String(appointment._id) })
    ok(res, appointment)
  }),
)

router.post(
  '/welfare/appointments/:id/cancel',
  requirePermission('welfare.manage'),
  validate({ body: z.object({ reason: z.string().trim().min(4).max(500) }) }),
  asyncHandler(async (req, res) => {
    const appointment = await CounsellingAppointment.findById(req.params.id)
    if (!appointment) throw ApiError.notFound('Counselling appointment not found')
    assertAppointmentAccess(req.auth!, appointment)
    if (appointment.status !== 'scheduled') throw ApiError.badRequest('Only scheduled appointments can be cancelled')
    appointment.status = 'cancelled'
    appointment.cancelledReason = req.body.reason
    appointment.history.push({ at: new Date(), by: req.auth!.userId, action: 'cancelled', note: req.body.reason })
    await appointment.save()
    await writeAudit({ req, actor: req.auth, action: 'welfare.appointment.cancelled', resourceType: 'CounsellingAppointment', resourceId: String(appointment._id), reason: req.body.reason })
    ok(res, appointment)
  }),
)

router.post(
  '/welfare/appointments/:id/complete',
  requirePermission('welfare.manage'),
  validate({
    body: z.object({
      presentingConcern: z.string().trim().min(5).max(3000),
      sessionNotes: z.string().trim().min(5).max(20000),
      riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional().default('low'),
      interventions: z.array(z.string().trim().min(2).max(400)).optional(),
      outcome: z.string().trim().min(5).max(3000),
      followUpRequired: z.boolean().optional().default(false),
      followUpDate: z.string().trim().optional(),
      followUpAssignedTo: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!hasPermission(req.auth!, 'welfare.records.view')) {
      throw ApiError.forbidden('Missing permission: welfare.records.view')
    }
    const appointment = await CounsellingAppointment.findById(req.params.id)
    if (!appointment) throw ApiError.notFound('Counselling appointment not found')
    assertAppointmentAccess(req.auth!, appointment)
    if (appointment.status !== 'scheduled') throw ApiError.badRequest('This appointment is no longer scheduled')

    const reference = await nextRef('CN', 4)
    const record = await CounsellingRecord.create({
      reference,
      studentId: appointment.studentId,
      appointmentId: appointment._id,
      counsellorId: appointment.counsellorId,
      sessionDate: appointment.scheduledAt,
      presentingConcern: req.body.presentingConcern,
      sessionNotes: req.body.sessionNotes,
      riskLevel: req.body.riskLevel,
      interventions: req.body.interventions ?? [],
      outcome: req.body.outcome,
      followUpRequired: req.body.followUpRequired,
      followUpDate: req.body.followUpDate ? new Date(req.body.followUpDate) : undefined,
      createdBy: req.auth!.userId,
      accessLog: [{ userId: req.auth!.userId, action: 'created' }],
    })

    appointment.status = 'completed'
    appointment.completedAt = new Date()
    appointment.recordId = record._id
    appointment.history.push({ at: new Date(), by: req.auth!.userId, action: 'completed', note: record.reference })
    await appointment.save()

    let followUp = null
    if (req.body.followUpRequired) {
      const assignee = req.body.followUpAssignedTo ? String(req.body.followUpAssignedTo) : String(appointment.counsellorId)
      await assertActiveStaff(assignee)
      followUp = await FollowUp.create({
        studentId: appointment.studentId,
        type: 'counselling',
        dueDate: req.body.followUpDate ? new Date(req.body.followUpDate) : new Date(Date.now() + 7 * 86_400_000),
        assignedTo: assignee,
        notes: `Welfare follow-up for ${reference}`,
        createdBy: req.auth!.userId,
      })
      await notifyUsers([assignee], {
        type: 'welfare.followup',
        title: 'Counselling follow-up assigned',
        message: `Follow up on ${reference} by ${followUp.dueDate.toLocaleDateString('en-GB')}.`,
        link: '/welfare',
        data: { followUpId: String(followUp._id), confidential: true },
      })
    }

    await writeAccessLog({ actor: req.auth!, resourceType: 'CounsellingRecord', resourceId: String(record._id), action: 'created', req })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'welfare.record.created',
      resourceType: 'CounsellingRecord',
      resourceId: String(record._id),
      after: { appointmentId: String(appointment._id), riskLevel: record.riskLevel, followUpRequired: record.followUpRequired },
    })
    created(res, { appointment, record, followUp })
  }),
)

// ── Counselling records (restricted) ───────────────────────────────────────

router.get(
  '/welfare/records',
  requirePermission('welfare.records.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (!seesAllWelfare(req.auth!)) filter.counsellorId = req.auth!.userId
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.riskLevel) filter.riskLevel = req.query.riskLevel
    const [total, items] = await Promise.all([
      CounsellingRecord.countDocuments(filter),
      CounsellingRecord.find(filter)
        .sort({ sessionDate: -1 })
        .skip(skip)
        .limit(pageSize)
        .select('-sessionNotes -accessLog')
        .populate('studentId', 'fullName studentId classId')
        .populate('counsellorId', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.get(
  '/welfare/records/:id',
  requirePermission('welfare.records.view'),
  asyncHandler(async (req, res) => {
    const record = await CounsellingRecord.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId')
      .populate('counsellorId', 'name position')
      .populate('escalatedCaseId', 'caseNumber status severity')
    if (!record) throw ApiError.notFound('Counselling record not found')
    if (!seesAllWelfare(req.auth!) && refId(record.counsellorId) !== String(req.auth!.userId)) {
      throw ApiError.forbidden('This counselling record belongs to another counsellor')
    }
    record.accessLog.push({ userId: req.auth!.userId, at: new Date(), action: 'viewed' })
    await record.save()
    await writeAccessLog({ actor: req.auth!, resourceType: 'CounsellingRecord', resourceId: String(record._id), action: 'viewed', req })
    ok(res, record)
  }),
)

router.get(
  '/welfare/records/:id/access-log',
  requirePermission('welfare.records.view'),
  asyncHandler(async (req, res) => {
    if (!seesAllWelfare(req.auth!) && !hasPermission(req.auth!, 'welfare.assign')) {
      throw ApiError.forbidden('Only welfare leads can review counselling access logs')
    }
    const record = await CounsellingRecord.findById(req.params.id).select('reference accessLog counsellorId')
    if (!record) throw ApiError.notFound('Counselling record not found')
    if (!seesAllWelfare(req.auth!) && String(record.counsellorId) !== String(req.auth!.userId)) {
      throw ApiError.forbidden('This counselling record belongs to another counsellor')
    }
    ok(res, { reference: record.reference, accessLog: record.accessLog })
  }),
)

router.post(
  '/welfare/records/:id/escalate',
  requirePermission('welfare.escalate'),
  validate({
    body: z.object({
      category: z.enum(['bullying', 'harassment', 'abuse', 'protection', 'other']),
      severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('high'),
      narrative: z.string().trim().min(10).max(10000),
      assignedTo: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const record = await CounsellingRecord.findById(req.params.id)
    if (!record) throw ApiError.notFound('Counselling record not found')
    if (!seesAllWelfare(req.auth!) && String(record.counsellorId) !== String(req.auth!.userId)) {
      throw ApiError.forbidden('This counselling record belongs to another counsellor')
    }
    if (record.escalatedCaseId) throw ApiError.conflict('This record has already been escalated')

    const assignedTo = req.body.assignedTo ? await assertActiveStaff(String(req.body.assignedTo)) : null
    const caseNumber = await nextRef('SG', 4)
    const safeguarding = await SafeguardingCase.create({
      caseNumber,
      category: req.body.category,
      severity: req.body.severity,
      studentId: record.studentId,
      reportedBy: req.auth!.userId,
      assignedTo: assignedTo?._id,
      confidential: true,
      narrative: req.body.narrative,
      deadline: new Date(Date.now() + (req.body.severity === 'critical' ? 1 : 3) * 86_400_000),
      accessLog: [{ userId: req.auth!.userId, at: new Date(), action: 'reported' }],
      history: [
        { at: new Date(), by: req.auth!.userId, action: 'reported', note: `Escalated from ${record.reference}` },
      ],
    })
    record.escalatedCaseId = safeguarding._id
    await record.save()

    await notifyPermission(
      'safeguarding.view',
      {
        type: 'safeguarding.created',
        title: `Safeguarding concern ${caseNumber}`,
        message: `A ${req.body.severity} ${req.body.category} concern was escalated from the welfare centre. Access is restricted.`,
        link: `/safeguarding/${safeguarding._id}`,
        data: { caseId: String(safeguarding._id), confidential: true },
      },
      { excludeUserId: String(req.auth!.userId) },
    )
    await writeAccessLog({ actor: req.auth!, resourceType: 'CounsellingRecord', resourceId: String(record._id), action: 'escalated', req })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'welfare.record.escalated',
      resourceType: 'CounsellingRecord',
      resourceId: String(record._id),
      after: { safeguardingCaseId: String(safeguarding._id), severity: req.body.severity, category: req.body.category },
    })
    created(res, { record, safeguardingCase: safeguarding })
  }),
)

// ── Referrals ──────────────────────────────────────────────────────────────

router.get(
  '/welfare/referrals',
  requirePermission('welfare.view', 'welfare.refer'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = { ...referralScope(req.auth!) }
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.service) filter.service = req.query.service
    const [total, items] = await Promise.all([
      WelfareReferral.countDocuments(filter),
      WelfareReferral.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select('-history')
        .populate('studentId', 'fullName studentId classId')
        .populate('fromStaffId', 'name position')
        .populate('assignedTo', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/welfare/referrals',
  requirePermission('welfare.refer', 'welfare.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      service: z.enum(['school_nurse', 'external_counsellor', 'psychologist', 'hospital', 'social_services', 'police', 'family', 'ngo', 'other']),
      destination: z.string().trim().min(2).max(200),
      reason: z.string().trim().min(5).max(3000),
      urgency: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
      consentObtained: z.boolean().optional().default(false),
      consentBy: z.string().trim().max(160).optional(),
      externalContact: z.string().trim().max(200).optional(),
      assignedTo: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const assignee = req.body.assignedTo ? await assertActiveStaff(String(req.body.assignedTo)) : null
    const reference = await nextRef('WR', 4)
    const referral = await WelfareReferral.create({
      reference,
      studentId: student._id,
      fromStaffId: req.auth!.userId,
      service: req.body.service,
      destination: req.body.destination,
      reason: req.body.reason,
      urgency: req.body.urgency,
      consentObtained: req.body.consentObtained,
      consentBy: req.body.consentBy,
      externalContact: req.body.externalContact,
      assignedTo: assignee?._id,
      createdBy: req.auth!.userId,
      history: [{ by: req.auth!.userId, action: 'created', note: req.body.service }],
    })

    if (assignee) {
      await notifyUsers([assignee._id], {
        type: 'welfare.referral',
        title: 'Welfare referral assigned',
        message: `${reference} for ${student.fullName} requires coordination.`,
        link: '/welfare',
        data: { referralId: String(referral._id), confidential: true },
      })
    } else {
      await notifyPermission('welfare.assign', {
        type: 'welfare.referral',
        title: 'Welfare referral awaiting assignment',
        message: `${reference} for ${student.fullName} was referred to ${req.body.destination}.`,
        link: '/welfare',
        data: { referralId: String(referral._id), confidential: true },
      })
    }

    await writeAccessLog({ actor: req.auth!, resourceType: 'WelfareReferral', resourceId: String(referral._id), action: 'created', req })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'welfare.referral.created',
      resourceType: 'WelfareReferral',
      resourceId: String(referral._id),
      after: { studentId: String(student._id), service: req.body.service, urgency: req.body.urgency, consentObtained: req.body.consentObtained },
    })
    created(res, referral)
  }),
)

router.patch(
  '/welfare/referrals/:id',
  requirePermission('welfare.manage'),
  validate({
    body: z.object({
      status: z.enum(['pending', 'accepted', 'in_progress', 'closed', 'declined']).optional(),
      outcome: z.string().trim().max(3000).optional(),
      assignedTo: objectId.optional(),
      externalContact: z.string().trim().max(200).optional(),
      consentObtained: z.boolean().optional(),
      consentBy: z.string().trim().max(160).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const referral = await WelfareReferral.findById(req.params.id)
    if (!referral) throw ApiError.notFound('Welfare referral not found')
    if (!seesAllWelfare(req.auth!) && String(referral.fromStaffId) !== String(req.auth!.userId) && String(referral.assignedTo ?? '') !== String(req.auth!.userId)) {
      throw ApiError.forbidden('This referral is handled by another staff member')
    }
    if (req.body.assignedTo) {
      const assignee = await assertActiveStaff(String(req.body.assignedTo))
      referral.assignedTo = assignee._id
    }
    if (req.body.status) {
      referral.status = req.body.status
      if (req.body.status === 'closed' || req.body.status === 'declined') referral.closedAt = new Date()
    }
    if (req.body.outcome !== undefined) referral.outcome = req.body.outcome
    if (req.body.externalContact !== undefined) referral.externalContact = req.body.externalContact
    if (req.body.consentObtained !== undefined) referral.consentObtained = req.body.consentObtained
    if (req.body.consentBy !== undefined) referral.consentBy = req.body.consentBy
    referral.history.push({ at: new Date(), by: req.auth!.userId, action: 'updated', note: req.body.status })
    await referral.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'welfare.referral.updated',
      resourceType: 'WelfareReferral',
      resourceId: String(referral._id),
      after: { status: referral.status, assignedTo: referral.assignedTo ? String(referral.assignedTo) : undefined },
    })
    ok(res, referral)
  }),
)

// ── Student support plans ──────────────────────────────────────────────────

router.get(
  '/welfare/plans',
  requirePermission('welfare.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = { ...planScope(req.auth!) }
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.category) filter.category = req.query.category
    const [total, items] = await Promise.all([
      WelfareSupportPlan.countDocuments(filter),
      WelfareSupportPlan.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select('-confidentialNotes -history')
        .populate('studentId', 'fullName studentId classId')
        .populate('assignedTo', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/welfare/plans',
  requirePermission('welfare.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      title: z.string().trim().min(3).max(160),
      reason: z.string().trim().min(5).max(3000),
      category: z.enum(['wellbeing', 'behaviour', 'academic', 'attendance', 'family', 'other']).optional().default('wellbeing'),
      goals: z.array(goalSchema).optional(),
      assignedTo: objectId,
      startDate: z.string().trim().optional(),
      reviewDate: z.string().trim().optional(),
      confidentialNotes: z.string().trim().max(5000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const assignee = await assertActiveStaff(req.body.assignedTo)
    const reference = await nextRef('WP', 4)
    const plan = await WelfareSupportPlan.create({
      reference,
      studentId: student._id,
      title: req.body.title,
      reason: req.body.reason,
      category: req.body.category,
      goals: (req.body.goals ?? []).map((g: PlanGoalInput) => ({
        description: g.description,
        actions: g.actions,
        targetDate: g.targetDate ? new Date(g.targetDate) : undefined,
        progress: g.progress ?? 0,
        status: 'active',
      })),
      assignedTo: assignee._id,
      startDate: req.body.startDate ? new Date(req.body.startDate) : new Date(),
      reviewDate: req.body.reviewDate ? new Date(req.body.reviewDate) : undefined,
      confidentialNotes: req.body.confidentialNotes,
      createdBy: req.auth!.userId,
      history: [{ by: req.auth!.userId, action: 'created' }],
    })
    await notifyUsers([assignee._id], {
      type: 'welfare.plan',
      title: 'Student support plan assigned',
      message: `${reference}: ${plan.title} for ${student.fullName}.`,
      link: '/welfare',
      data: { planId: String(plan._id), confidential: true },
    })
    await writeAccessLog({ actor: req.auth!, resourceType: 'WelfareSupportPlan', resourceId: String(plan._id), action: 'created', req })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'welfare.plan.created',
      resourceType: 'WelfareSupportPlan',
      resourceId: String(plan._id),
      after: { studentId: String(student._id), category: plan.category },
    })
    created(res, plan)
  }),
)

router.patch(
  '/welfare/plans/:id',
  requirePermission('welfare.manage'),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(160).optional(),
      reason: z.string().trim().min(5).max(3000).optional(),
      category: z.enum(['wellbeing', 'behaviour', 'academic', 'attendance', 'family', 'other']).optional(),
      goals: z.array(goalSchema.partial({ description: true })).optional(),
      assignedTo: objectId.optional(),
      reviewDate: z.string().trim().optional(),
      confidentialNotes: z.string().trim().max(5000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const plan = await WelfareSupportPlan.findById(req.params.id)
    if (!plan) throw ApiError.notFound('Support plan not found')
    assertPlanAccess(req.auth!, plan)
    if (req.body.assignedTo) {
      const assignee = await assertActiveStaff(String(req.body.assignedTo))
      plan.assignedTo = assignee._id
    }
    if (req.body.title) plan.title = req.body.title
    if (req.body.reason) plan.reason = req.body.reason
    if (req.body.category) plan.category = req.body.category
    if (req.body.reviewDate) plan.reviewDate = new Date(req.body.reviewDate)
    if (req.body.confidentialNotes !== undefined) plan.confidentialNotes = req.body.confidentialNotes
    if (req.body.goals) {
      plan.goals = req.body.goals.map((g: PlanGoalInput) => ({
        description: g.description ?? '',
        actions: g.actions,
        targetDate: g.targetDate ? new Date(g.targetDate) : undefined,
        progress: g.progress ?? 0,
        status: g.progress === 100 ? 'completed' : 'active',
      }))
    }
    plan.history.push({ at: new Date(), by: req.auth!.userId, action: 'updated' })
    await plan.save()
    await writeAudit({ req, actor: req.auth, action: 'welfare.plan.updated', resourceType: 'WelfareSupportPlan', resourceId: String(plan._id) })
    ok(res, plan)
  }),
)

router.post(
  '/welfare/plans/:id/review',
  requirePermission('welfare.manage'),
  validate({
    body: z.object({
      note: z.string().trim().min(3).max(3000),
      nextReviewDate: z.string().trim().optional(),
      goals: z.array(goalSchema.partial({ description: true })).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const plan = await WelfareSupportPlan.findById(req.params.id)
    if (!plan) throw ApiError.notFound('Support plan not found')
    assertPlanAccess(req.auth!, plan)
    if (plan.status === 'completed' || plan.status === 'abandoned') throw ApiError.badRequest('Reopen the plan before recording a review')
    if (req.body.goals) {
      plan.goals = req.body.goals.map((g: PlanGoalInput) => ({
        description: g.description ?? '',
        actions: g.actions,
        targetDate: g.targetDate ? new Date(g.targetDate) : undefined,
        progress: g.progress ?? 0,
        status: g.progress === 100 ? 'completed' : 'active',
      }))
    }
    plan.reviewDate = req.body.nextReviewDate ? new Date(req.body.nextReviewDate) : new Date(Date.now() + 14 * 86_400_000)
    plan.status = 'active'
    plan.history.push({ at: new Date(), by: req.auth!.userId, action: 'reviewed', note: req.body.note })
    await plan.save()
    await writeAudit({ req, actor: req.auth, action: 'welfare.plan.reviewed', resourceType: 'WelfareSupportPlan', resourceId: String(plan._id), reason: req.body.note })
    ok(res, plan)
  }),
)

router.post(
  '/welfare/plans/:id/close',
  requirePermission('welfare.manage'),
  validate({ body: z.object({ outcome: z.string().trim().min(5).max(3000) }) }),
  asyncHandler(async (req, res) => {
    const plan = await WelfareSupportPlan.findById(req.params.id)
    if (!plan) throw ApiError.notFound('Support plan not found')
    assertPlanAccess(req.auth!, plan)
    if (plan.status === 'completed') throw ApiError.badRequest('This support plan is already closed')
    plan.status = 'completed'
    plan.outcome = req.body.outcome
    plan.closedAt = new Date()
    plan.closedBy = req.auth!.userId
    plan.history.push({ at: new Date(), by: req.auth!.userId, action: 'closed', note: req.body.outcome })
    await plan.save()
    await writeAudit({ req, actor: req.auth, action: 'welfare.plan.closed', resourceType: 'WelfareSupportPlan', resourceId: String(plan._id), reason: req.body.outcome })
    ok(res, plan)
  }),
)

router.post(
  '/welfare/plans/:id/reopen',
  requirePermission('welfare.manage'),
  validate({ body: z.object({ reason: z.string().trim().min(5).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const plan = await WelfareSupportPlan.findById(req.params.id)
    if (!plan) throw ApiError.notFound('Support plan not found')
    assertPlanAccess(req.auth!, plan)
    if (plan.status === 'active' || plan.status === 'reopened') throw ApiError.badRequest('This support plan is already open')
    plan.status = 'reopened'
    plan.closedAt = undefined
    plan.closedBy = undefined
    plan.outcome = undefined
    plan.reopenCount += 1
    plan.history.push({ at: new Date(), by: req.auth!.userId, action: 'reopened', note: req.body.reason })
    await plan.save()
    await writeAudit({ req, actor: req.auth, action: 'welfare.plan.reopened', resourceType: 'WelfareSupportPlan', resourceId: String(plan._id), reason: req.body.reason })
    ok(res, plan)
  }),
)

// ── Follow-ups (welfare view of the shared follow-up queue) ────────────────

router.get(
  '/welfare/followups',
  requirePermission('welfare.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {
      type: { $in: ['counselling', 'parent_meeting', 'boarding_welfare'] },
    }
    if (!seesAllWelfare(req.auth!)) filter.assignedTo = req.auth!.userId
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    const [total, items] = await Promise.all([
      FollowUp.countDocuments(filter),
      FollowUp.find(filter)
        .sort({ dueDate: 1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId classId')
        .populate('assignedTo', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

export default router
