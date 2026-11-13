import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { idempotency } from '../middleware/idempotency.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, queryOf, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Offence, Incident, AdjustmentRequest, DisciplineLedger } from '../models/discipline.js'
import { Student } from '../models/school.js'
import { Recognition } from '../models/support.js'
import { getSettings } from '../models/core.js'
import {
  createIncident,
  updateDraftIncident,
  submitIncident,
  reviewIncident,
  closeIncident,
  visibleIncidentFilter,
  getIncidentForUser,
  type CreateIncidentInput,
} from '../services/incidents.service.js'
import { requestAdjustment } from '../services/adjustments.service.js'
import { decideApproval } from '../services/approvals.service.js'
import { rewardStudent, reverseTransaction, studentConductSummary } from '../services/ledger.service.js'
import { resolveTerm } from '../services/academic.service.js'
import { assertStudentAccess } from '../services/rbac.service.js'
import { writeAudit } from '../services/audit.service.js'
import { objectId, paginationQuery, searchRegex } from './helpers.js'

const router = Router()
router.use(authenticate)

const incidentListQuery = paginationQuery.extend({
  status: z.string().trim().optional(),
  severity: z.enum(['minor', 'moderate', 'serious', 'critical']).optional(),
  studentId: objectId.optional(),
  termId: objectId.optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
})

const incidentBody = z.object({
  studentId: objectId,
  offenceId: objectId,
  description: z.string().trim().min(10, 'Describe what happened').max(5000),
  occurredAt: z.string().trim().min(4),
  location: z.string().trim().min(2).max(160),
  witnesses: z
    .array(z.object({ name: z.string().trim().min(2).max(120), contact: z.string().trim().max(60).optional(), statement: z.string().trim().max(2000).optional() }))
    .max(10)
    .optional(),
  evidenceIds: z.array(objectId).max(20).optional(),
  safeguardingFlag: z.boolean().optional(),
  clientSubmissionId: z.string().trim().max(80).optional(),
})

// ── Offence rules ──────────────────────────────────────────────────────────

router.get(
  '/offences',
  requirePermission('offences.view'),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {}
    if (req.query.active !== 'all') filter.active = true
    if (req.query.category) filter.category = req.query.category
    if (req.query.severity) filter.severity = req.query.severity
    if (req.query.q) {
      const rx = searchRegex(String(req.query.q))
      filter.$or = [{ name: rx }, { code: rx }, { category: rx }]
    }
    ok(res, await Offence.find(filter).sort({ category: 1, name: 1 }).lean())
  }),
)

router.post(
  '/offences',
  requirePermission('offences.manage'),
  validate({
    body: z.object({
      code: z.string().trim().min(2).max(20),
      name: z.string().trim().min(3).max(160),
      category: z.string().trim().min(2).max(80),
      description: z.string().trim().max(1000).optional(),
      deduction: z.number().int().min(0).max(40),
      severity: z.enum(['minor', 'moderate', 'serious', 'critical']).default('minor'),
      applicableLevels: z.array(z.enum(['O', 'A'])).min(1).default(['O', 'A']),
      requiresApproval: z.boolean().optional().default(true),
      requiresEvidence: z.boolean().optional().default(false),
      notifyParent: z.boolean().optional().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (await Offence.exists({ code: req.body.code.toUpperCase() })) throw ApiError.conflict('An offence with this code already exists')
    const offence = await Offence.create({ ...req.body, code: req.body.code.toUpperCase(), createdBy: req.auth!.userId })
    await writeAudit({ req, actor: req.auth, action: 'offence.created', resourceType: 'Offence', resourceId: String(offence._id), after: req.body })
    created(res, offence)
  }),
)

router.patch(
  '/offences/:id',
  requirePermission('offences.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(3).max(160).optional(),
      category: z.string().trim().min(2).max(80).optional(),
      description: z.string().trim().max(1000).optional(),
      deduction: z.number().int().min(0).max(40).optional(),
      severity: z.enum(['minor', 'moderate', 'serious', 'critical']).optional(),
      applicableLevels: z.array(z.enum(['O', 'A'])).min(1).optional(),
      requiresApproval: z.boolean().optional(),
      requiresEvidence: z.boolean().optional(),
      notifyParent: z.boolean().optional(),
      active: z.boolean().optional(),
      reason: z.string().trim().max(400).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const offence = await Offence.findById(req.params.id)
    if (!offence) throw ApiError.notFound('Offence rule not found')
    const before = { name: offence.name, deduction: offence.deduction, severity: offence.severity, active: offence.active }
    const { reason, ...changes } = req.body
    Object.assign(offence, changes)
    await offence.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'offence.updated',
      resourceType: 'Offence',
      resourceId: String(offence._id),
      before,
      after: changes,
      reason,
    })
    ok(res, offence)
  }),
)

// ── Incidents ──────────────────────────────────────────────────────────────

router.get(
  '/incidents',
  requirePermission('incidents.view'),
  validate({ query: incidentListQuery }),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const q = queryOf<z.infer<typeof incidentListQuery>>(req)
    const visibility = await visibleIncidentFilter(req.auth!)
    const filter: Record<string, unknown> = { ...visibility }
    if (q.status) filter.status = { $in: q.status.split(',') }
    if (q.severity) filter.severity = q.severity
    if (q.studentId) filter.studentId = new Types.ObjectId(q.studentId)
    if (q.termId) filter.termId = new Types.ObjectId(q.termId)
    if (q.from || q.to) {
      filter.occurredAt = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      }
    }
    if (q.q) {
      const rx = searchRegex(q.q)
      const clauses = [{ incidentNumber: rx }, { 'studentSnapshot.fullName': rx }, { 'offenceSnapshot.name': rx }, { description: rx }]
      if (visibility.$or) {
        filter.$and = [{ $or: visibility.$or }, { $or: clauses }]
        delete filter.$or
      } else {
        filter.$or = clauses
      }
    }
    const [total, incidents] = await Promise.all([
      Incident.countDocuments(filter),
      Incident.find(filter)
        .sort({ occurredAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('reportedBy', 'name')
        .populate('studentId', 'fullName studentId classId currentBalance riskLevel')
        .lean(),
    ])
    ok(res, incidents, pagedMeta(total, page, pageSize))
  }),
)

router.get(
  '/incidents/:id',
  requirePermission('incidents.view'),
  asyncHandler(async (req, res) => {
    const incident = await getIncidentForUser(req.auth!, req.params.id)
    await incident.populate([
      { path: 'reportedBy', select: 'name position' },
      { path: 'review.reviewedBy', select: 'name position' },
      { path: 'studentId', select: 'fullName studentId classId dormitoryId currentBalance riskLevel' },
      { path: 'evidenceIds' },
    ])
    ok(res, incident)
  }),
)

router.post(
  '/incidents',
  requirePermission('incidents.create'),
  idempotency('incident.create'),
  validate({ body: incidentBody }),
  asyncHandler(async (req, res) => {
    const incident = await createIncident(req.auth!, req.body as CreateIncidentInput, req)
    created(res, incident)
  }),
)

router.patch(
  '/incidents/:id',
  requirePermission('incidents.update'),
  validate({ body: incidentBody.partial() }),
  asyncHandler(async (req, res) => {
    const incident = await updateDraftIncident(req.auth!, req.params.id, req.body, req)
    ok(res, incident)
  }),
)

router.post(
  '/incidents/:id/submit',
  requirePermission('incidents.submit'),
  asyncHandler(async (req, res) => {
    const incident = await submitIncident(req.auth!, req.params.id, req)
    ok(res, incident)
  }),
)

router.post(
  '/incidents/:id/review',
  requirePermission('incidents.review'),
  validate({
    body: z.object({
      decision: z.enum(['approve', 'reject', 'request_info']),
      comments: z.string().trim().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const incident = await reviewIncident(req.auth!, req.params.id, req.body, req)
    ok(res, incident)
  }),
)

router.post(
  '/incidents/:id/close',
  requirePermission('incidents.close'),
  validate({ body: z.object({ note: z.string().trim().min(3).max(1000) }) }),
  asyncHandler(async (req, res) => {
    ok(res, await closeIncident(req.auth!, req.params.id, req.body.note, req))
  }),
)

// ── Conduct ledger ─────────────────────────────────────────────────────────

router.get(
  '/discipline/ledger',
  requirePermission('marks.view'),
  asyncHandler(async (req, res) => {
    const studentId = String(req.query.studentId ?? '')
    if (!studentId) throw ApiError.badRequest('Select a student')
    const student = await assertStudentAccess(req.auth!, studentId)
    const term = await resolveTerm(req.query.termId as string | undefined)
    ok(res, {
      student: { id: String(student._id), fullName: student.fullName, currentBalance: student.currentBalance },
      term,
      ...(await studentConductSummary(String(student._id), String(term._id))),
    })
  }),
)

router.post(
  '/discipline/deduct',
  requirePermission('marks.deduct'),
  idempotency('discipline.deduct'),
  validate({
    body: z.object({
      studentId: objectId,
      offenceId: objectId,
      description: z.string().trim().min(10).max(5000),
      location: z.string().trim().min(2).max(160),
      occurredAt: z.string().trim().optional(),
      evidenceIds: z.array(objectId).optional(),
      clientSubmissionId: z.string().trim().max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const settings = await getSettings()
    const offence = await Offence.findById(req.body.offenceId)
    if (!offence || !offence.active) throw ApiError.badRequest('Select an active offence rule')
    if (settings.discipline.requireReview && offence.requiresApproval) {
      throw ApiError.badRequest(
        'This offence requires independent review. Record it through the incident workflow so another authorised staff member can approve the deduction.',
      )
    }
    const incident = await createIncident(
      req.auth!,
      {
        studentId: req.body.studentId,
        offenceId: req.body.offenceId,
        description: req.body.description,
        location: req.body.location,
        occurredAt: req.body.occurredAt ?? new Date().toISOString(),
        evidenceIds: req.body.evidenceIds,
        clientSubmissionId: req.body.clientSubmissionId,
      },
      req,
    )
    const result = await submitIncident(req.auth!, String(incident._id), req)
    created(res, result)
  }),
)

router.post(
  '/discipline/reward',
  requirePermission('marks.reward'),
  idempotency('discipline.reward'),
  validate({
    body: z.object({
      studentId: objectId,
      points: z.number().int().min(1).max(20),
      reason: z.string().trim().min(3).max(500),
      title: z.string().trim().max(160).optional(),
      category: z.string().trim().max(80).optional(),
      type: z.enum(['positive_behaviour', 'achievement', 'reward']).optional().default('reward'),
      termId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const term = await resolveTerm(req.body.termId)
    const ledger = await rewardStudent({
      studentId: String(student._id),
      points: req.body.points,
      reason: req.body.reason,
      termId: String(term._id),
      academicYearId: String(term.academicYearId),
      actor: { userId: req.auth!.userId, name: req.auth!.name, roles: req.auth!.roles },
    })
    const recognition = await Recognition.create({
      studentId: student._id,
      type: req.body.type,
      category: req.body.category ?? 'Positive conduct',
      title: req.body.title ?? 'Conduct reward',
      description: req.body.reason,
      points: req.body.points,
      awardedBy: req.auth!.userId,
      termId: term._id,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'discipline.reward_applied',
      resourceType: 'DisciplineLedger',
      resourceId: String(ledger._id),
      after: { studentId: String(student._id), points: req.body.points, balance: ledger.newBalance },
      reason: req.body.reason,
    })
    created(res, { ledger, recognition })
  }),
)

router.post(
  '/discipline/transactions/:id/reverse',
  requirePermission('marks.reverse'),
  validate({ body: z.object({ reason: z.string().trim().min(5).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const original = await DisciplineLedger.findById(req.params.id)
    if (!original) throw ApiError.notFound('Ledger transaction not found')
    await assertStudentAccess(req.auth!, original.studentId)
    const ledger = await reverseTransaction({
      ledgerId: req.params.id,
      reason: req.body.reason,
      actor: { userId: req.auth!.userId, name: req.auth!.name, roles: req.auth!.roles },
    })
    created(res, ledger)
  }),
)

// ── Adjustments ────────────────────────────────────────────────────────────

router.get(
  '/discipline/adjustments',
  requirePermission('marks.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const canApprove = req.auth!.permissions.has('marks.adjust.approve')
    const filter: Record<string, unknown> = canApprove ? {} : { requestedBy: req.auth!.userId }
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    const [total, items] = await Promise.all([
      AdjustmentRequest.countDocuments(filter),
      AdjustmentRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId classId')
        .populate('requestedBy', 'name')
        .populate('decidedBy', 'name')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.get(
  '/discipline/adjustments/:id',
  requirePermission('marks.view'),
  asyncHandler(async (req, res) => {
    const adjustment = await AdjustmentRequest.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId currentBalance')
      .populate('requestedBy', 'name')
      .populate('decidedBy', 'name')
      .lean()
    if (!adjustment) throw ApiError.notFound('Adjustment request not found')
    if (!req.auth!.permissions.has('marks.adjust.approve') && String(adjustment.requestedBy) !== String(req.auth!.userId)) {
      throw ApiError.forbidden('You can only view your own adjustment requests')
    }
    ok(res, adjustment)
  }),
)

router.post(
  '/discipline/adjustments',
  requirePermission('marks.adjust.request'),
  idempotency('adjustment.request'),
  validate({
    body: z.object({
      studentId: objectId,
      ledgerId: objectId.optional(),
      incidentId: objectId.optional(),
      reason: z.string().trim().min(5).max(2000),
      requestedChange: z.number().int().min(-40).max(40).refine((v) => v !== 0, 'The change cannot be zero'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await requestAdjustment(req.auth!, req.body, req)
    created(res, result)
  }),
)

router.post(
  '/discipline/adjustments/:id/decide',
  requirePermission('marks.adjust.approve'),
  validate({
    body: z.object({
      decision: z.enum(['approve', 'reject']),
      notes: z.string().trim().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const adjustment = await AdjustmentRequest.findById(req.params.id)
    if (!adjustment) throw ApiError.notFound('Adjustment request not found')
    if (!adjustment.approvalId) throw ApiError.badRequest('This adjustment has no linked approval')
    const approval = await decideApproval(req.auth!, String(adjustment.approvalId), req.body, req)
    ok(res, approval)
  }),
)

router.get(
  '/discipline/students-at-risk-count',
  requirePermission('marks.view'),
  asyncHandler(async (_req, res) => {
    const [orange, red, total] = await Promise.all([
      Student.countDocuments({ status: 'active', riskLevel: 'orange' }),
      Student.countDocuments({ status: 'active', riskLevel: 'red' }),
      Student.countDocuments({ status: 'active' }),
    ])
    ok(res, { orange, red, total })
  }),
)

export default router
