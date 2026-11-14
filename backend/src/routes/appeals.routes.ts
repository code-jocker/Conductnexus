import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Appeal } from '../models/governance.js'
import { Incident } from '../models/discipline.js'
import { User } from '../models/core.js'
import { nextRef } from '../shared/refs.js'
import { assertStudentAccess } from '../services/rbac.service.js'
import { reverseTransaction } from '../services/ledger.service.js'
import { writeAudit } from '../services/audit.service.js'
import { notifyUsers } from '../services/notification.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

function canSeeAll(ctx: NonNullable<import('express').Request['auth']>) {
  return ctx.roles.includes('HEADTEACHER') || ctx.permissions.has('appeals.decide')
}

router.get(
  '/appeals',
  requirePermission('appeals.view'),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = canSeeAll(ctx)
      ? {}
      : { $or: [{ submittedBy: ctx.userId }, { reviewerId: ctx.userId }] }
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.incidentId) filter.incidentId = req.query.incidentId
    const [total, items] = await Promise.all([
      Appeal.countDocuments(filter),
      Appeal.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId classId')
        .populate('submittedBy', 'name position')
        .populate('reviewerId', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/appeals',
  requirePermission('appeals.submit'),
  validate({
    body: z.object({
      studentId: objectId,
      decisionType: z.enum(['incident', 'suspension', 'expulsion', 'other']).default('incident'),
      decisionRef: z.string().trim().max(120).optional(),
      incidentId: objectId.optional(),
      grounds: z.string().trim().min(5).max(200),
      reason: z.string().trim().min(20).max(10000),
      evidenceIds: z.array(objectId).optional(),
      originalDecisionBy: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    let decisionRef = req.body.decisionRef
    if (req.body.incidentId) {
      const incident = await Incident.findOne({ _id: req.body.incidentId, studentId: student._id })
      if (!incident) throw ApiError.notFound('Incident not found for this student')
      decisionRef = incident.incidentNumber
      if (!req.body.originalDecisionBy && incident.review?.reviewedBy) req.body.originalDecisionBy = String(incident.review.reviewedBy)
    }
    if (!decisionRef) throw ApiError.badRequest('Provide the decision reference being appealed')
    const appealNumber = await nextRef('APL', 4)
    const appeal = await Appeal.create({
      appealNumber,
      studentId: student._id,
      decisionType: req.body.decisionType,
      decisionRef,
      incidentId: req.body.incidentId,
      originalDecisionBy: req.body.originalDecisionBy,
      grounds: req.body.grounds,
      reason: req.body.reason,
      evidenceIds: req.body.evidenceIds ?? [],
      submittedBy: req.auth!.userId,
      submittedAt: new Date(),
      deadline: new Date(Date.now() + 14 * 86_400_000),
      status: 'submitted',
      history: [{ at: new Date(), by: req.auth!.userId, action: 'submitted', note: req.body.grounds }],
    })
    await notifyUsers([req.auth!.userId], {
      type: 'appeal.submitted',
      title: `Appeal ${appealNumber} submitted`,
      message: `${student.fullName}: ${req.body.grounds}`,
      link: `/appeals/${appeal._id}`,
    })
    await writeAudit({ req, actor: req.auth, action: 'appeal.submitted', resourceType: 'Appeal', resourceId: String(appeal._id), after: { appealNumber, decisionRef } })
    created(res, appeal)
  }),
)

router.get(
  '/appeals/:id',
  requirePermission('appeals.view'),
  asyncHandler(async (req, res) => {
    const appeal = await Appeal.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId currentBalance')
      .populate('submittedBy', 'name position')
      .populate('reviewerId', 'name position')
      .populate('evidenceIds')
    if (!appeal) throw ApiError.notFound('Appeal not found')
    if (!canSeeAll(req.auth!) && String(appeal.submittedBy) !== String(req.auth!.userId) && String(appeal.reviewerId ?? '') !== String(req.auth!.userId)) {
      throw ApiError.forbidden('You are not authorized to view this appeal')
    }
    ok(res, appeal)
  }),
)

router.post(
  '/appeals/:id/review',
  requirePermission('appeals.review'),
  validate({ body: z.object({ reviewerId: objectId.optional(), note: z.string().trim().max(1000).optional() }) }),
  asyncHandler(async (req, res) => {
    const appeal = await Appeal.findById(req.params.id)
    if (!appeal) throw ApiError.notFound('Appeal not found')
    if (!['submitted', 'under_review'].includes(appeal.status)) throw ApiError.badRequest('This appeal cannot be moved to review')
    const reviewerId = req.body.reviewerId ?? req.auth!.userId
    if (!(await User.exists({ _id: reviewerId, status: 'active' }))) throw ApiError.badRequest('Select an active reviewer')
    if (String(appeal.originalDecisionBy ?? '') === String(reviewerId)) {
      throw ApiError.forbidden('The original decision-maker cannot review the appeal')
    }
    appeal.reviewerId = reviewerId
    appeal.status = 'under_review'
    appeal.history.push({ at: new Date(), by: req.auth!.userId, action: 'assigned_for_review', note: req.body.note })
    await appeal.save()
    await notifyUsers([reviewerId], {
      type: 'appeal.review_assigned',
      title: 'Appeal assigned to you',
      message: `${appeal.appealNumber} is ready for review.`,
      link: `/appeals/${appeal._id}`,
    })
    await writeAudit({ req, actor: req.auth, action: 'appeal.review_assigned', resourceType: 'Appeal', resourceId: String(appeal._id), after: { reviewerId: String(reviewerId) } })
    ok(res, appeal)
  }),
)

router.post(
  '/appeals/:id/decide',
  requirePermission('appeals.decide'),
  validate({
    body: z.object({
      decision: z.enum(['upheld', 'overturned', 'modified', 'dismissed']),
      explanation: z.string().trim().min(10).max(10000),
      reverseLedgerId: objectId.optional(),
      restitutionReason: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const appeal = await Appeal.findById(req.params.id)
    if (!appeal) throw ApiError.notFound('Appeal not found')
    if (!['submitted', 'under_review'].includes(appeal.status)) throw ApiError.badRequest('This appeal has already been decided')
    if (String(appeal.originalDecisionBy ?? '') === String(req.auth!.userId)) {
      throw ApiError.forbidden('The original decision-maker cannot decide this appeal')
    }
    if (appeal.reviewerId && String(appeal.reviewerId) !== String(req.auth!.userId) && !req.auth!.roles.includes('HEADTEACHER')) {
      throw ApiError.forbidden('Only the assigned reviewer or Headteacher can decide this appeal')
    }
    let reversal = null
    if (['overturned', 'modified'].includes(req.body.decision) && req.body.reverseLedgerId) {
      reversal = await reverseTransaction({
        ledgerId: req.body.reverseLedgerId,
        reason: req.body.restitutionReason ?? `Appeal ${appeal.appealNumber} ${req.body.decision}`,
        actor: { userId: req.auth!.userId, name: req.auth!.name, roles: req.auth!.roles },
      })
      appeal.linkedLedgerId = reversal._id
    }
    appeal.decision = req.body.decision
    appeal.decisionExplanation = req.body.explanation
    appeal.decidedAt = new Date()
    appeal.status = 'decided'
    appeal.history.push({ at: new Date(), by: req.auth!.userId, action: 'decided', note: `${req.body.decision}: ${req.body.explanation}` })
    await appeal.save()
    await notifyUsers([appeal.submittedBy], {
      type: 'appeal.decided',
      title: `Appeal ${appeal.appealNumber} decided`,
      message: `Outcome: ${req.body.decision}. ${req.body.explanation}`,
      link: `/appeals/${appeal._id}`,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'appeal.decided',
      resourceType: 'Appeal',
      resourceId: String(appeal._id),
      after: { decision: req.body.decision },
      reason: req.body.explanation,
    })
    ok(res, { appeal, reversal })
  }),
)

router.post(
  '/appeals/:id/withdraw',
  requirePermission('appeals.submit'),
  validate({ body: z.object({ reason: z.string().trim().min(5).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const appeal = await Appeal.findById(req.params.id)
    if (!appeal) throw ApiError.notFound('Appeal not found')
    if (String(appeal.submittedBy) !== String(req.auth!.userId)) throw ApiError.forbidden('Only the person who submitted the appeal can withdraw it')
    if (['decided', 'withdrawn'].includes(appeal.status)) throw ApiError.badRequest('This appeal can no longer be withdrawn')
    appeal.status = 'withdrawn'
    appeal.history.push({ at: new Date(), by: req.auth!.userId, action: 'withdrawn', note: req.body.reason })
    await appeal.save()
    await writeAudit({ req, actor: req.auth, action: 'appeal.withdrawn', resourceType: 'Appeal', resourceId: String(appeal._id), reason: req.body.reason })
    ok(res, appeal)
  }),
)

export default router
