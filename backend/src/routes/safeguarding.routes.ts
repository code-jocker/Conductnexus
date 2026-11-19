import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { SafeguardingCase } from '../models/governance.js'
import { Evidence } from '../models/governance.js'
import { User } from '../models/core.js'
import { Student } from '../models/school.js'
import { nextRef } from '../shared/refs.js'
import { assertSafeguardingAccess, safeguardingCaseAccess } from '../services/rbac.service.js'
import { writeAccessLog, writeAudit } from '../services/audit.service.js'
import { createApproval } from '../services/approvals.util.js'
import { notifyPermission, notifyUsers } from '../services/notification.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

function accessFilter(ctx: NonNullable<import('express').Request['auth']>) {
  if (ctx.roles.includes('HEADTEACHER')) return {}
  return { $or: [{ reportedBy: ctx.userId }, { assignedTo: ctx.userId }] }
}

router.get(
  '/safeguarding/cases',
  requirePermission('safeguarding.view'),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = { ...accessFilter(ctx) }
    if (req.query.status) filter.status = req.query.status
    if (req.query.category) filter.category = req.query.category
    if (req.query.severity) filter.severity = req.query.severity
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      const clauses = [{ caseNumber: rx }, { narrative: rx }]
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: clauses }]
        delete filter.$or
      } else {
        filter.$or = clauses
      }
    }
    const [total, cases] = await Promise.all([
      SafeguardingCase.countDocuments(filter),
      SafeguardingCase.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select('-accessLog -narrative')
        .populate('studentId', 'fullName studentId classId')
        .populate('reportedBy', 'name position')
        .populate('assignedTo', 'name position')
        .lean(),
    ])
    ok(res, cases, pagedMeta(total, page, pageSize))
  }),
)

router.get(
  '/safeguarding/stats',
  requirePermission('safeguarding.view'),
  asyncHandler(async (req, res) => {
    const base = accessFilter(req.auth!)
    const rows = await SafeguardingCase.aggregate([
      { $match: base },
      { $group: { _id: { status: '$status', severity: '$severity' }, count: { $sum: 1 } } },
    ])
    const byStatus: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    for (const r of rows) {
      byStatus[r._id.status] = (byStatus[r._id.status] ?? 0) + r.count
      bySeverity[r._id.severity] = (bySeverity[r._id.severity] ?? 0) + r.count
    }
    const overdue = await SafeguardingCase.countDocuments({ ...base, deadline: { $lt: new Date() }, status: { $nin: ['resolved', 'closed'] } })
    ok(res, { byStatus, bySeverity, overdue })
  }),
)

router.post(
  '/safeguarding/cases',
  requirePermission('safeguarding.create'),
  validate({
    body: z.object({
      category: z.enum(['bullying', 'harassment', 'abuse', 'protection', 'other']),
      severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      studentId: objectId.optional(),
      narrative: z.string().trim().min(10).max(10000),
      immediateRisk: z.string().trim().max(3000).optional(),
      confidential: z.boolean().optional().default(true),
      evidenceIds: z.array(objectId).optional(),
      deadline: z.string().trim().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (req.body.studentId && !(await Student.exists({ _id: req.body.studentId }))) throw ApiError.notFound('Student not found')
    const caseNumber = await nextRef('SG', 4)
    const doc = await SafeguardingCase.create({
      caseNumber,
      category: req.body.category,
      severity: req.body.severity,
      studentId: req.body.studentId,
      reportedBy: req.auth!.userId,
      confidential: req.body.confidential,
      narrative: req.body.narrative,
      immediateRisk: req.body.immediateRisk,
      evidenceIds: req.body.evidenceIds ?? [],
      deadline: req.body.deadline ? new Date(req.body.deadline) : new Date(Date.now() + (req.body.severity === 'critical' ? 1 : 3) * 86_400_000),
      accessLog: [{ userId: req.auth!.userId, at: new Date(), action: 'reported' }],
      history: [{ at: new Date(), by: req.auth!.userId, action: 'reported', note: req.body.category }],
    })
    await notifyPermission(
      'safeguarding.view',
      {
        type: 'safeguarding.created',
        title: `Safeguarding concern ${caseNumber}`,
        message: `A ${req.body.severity} ${req.body.category} concern was reported. Access is restricted.`,
        link: `/safeguarding/${doc._id}`,
        data: { caseId: String(doc._id), confidential: true },
      },
      { excludeUserId: String(req.auth!.userId) },
    )
    await writeAccessLog({ actor: req.auth!, resourceType: 'SafeguardingCase', resourceId: String(doc._id), action: 'created', req })
    await writeAudit({ req, actor: req.auth, action: 'safeguarding.created', resourceType: 'SafeguardingCase', resourceId: String(doc._id), after: { caseNumber, category: doc.category, severity: doc.severity } })
    created(res, doc)
  }),
)

router.get(
  '/safeguarding/cases/:id',
  requirePermission('safeguarding.view'),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId')
      .populate('reportedBy', 'name position')
      .populate('assignedTo', 'name position')
      .populate('evidenceIds')
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    assertSafeguardingAccess(req.auth!, doc)
    doc.accessLog.push({ userId: req.auth!.userId, at: new Date(), action: 'viewed' })
    await doc.save()
    await writeAccessLog({ actor: req.auth!, resourceType: 'SafeguardingCase', resourceId: String(doc._id), action: 'viewed', req })
    ok(res, doc)
  }),
)

router.patch(
  '/safeguarding/cases/:id',
  requirePermission('safeguarding.view'),
  validate({
    body: z.object({
      severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      status: z.enum(['open', 'under_review', 'referred', 'escalated', 'resolved', 'closed']).optional(),
      narrative: z.string().trim().min(10).max(10000).optional(),
      immediateRisk: z.string().trim().max(3000).optional(),
      deadline: z.string().trim().optional(),
      resolution: z.string().trim().max(5000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    assertSafeguardingAccess(req.auth!, doc)
    if (req.body.status === 'closed' || req.body.status === 'resolved') {
      if (!req.auth!.permissions.has('safeguarding.close')) throw ApiError.forbidden('Missing permission: safeguarding.close')
      if (!req.body.resolution && !doc.resolution) throw ApiError.badRequest('Record a resolution before closing this case')
      doc.closedAt = new Date()
    }
    const before = { status: doc.status, severity: doc.severity }
    Object.assign(doc, req.body)
    if (req.body.deadline) doc.deadline = new Date(req.body.deadline)
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'updated', note: req.body.status ? `Status: ${req.body.status}` : 'Case details updated' })
    await doc.save()
    await writeAudit({ req, actor: req.auth, action: 'safeguarding.updated', resourceType: 'SafeguardingCase', resourceId: String(doc._id), before, after: req.body })
    ok(res, doc)
  }),
)

router.post(
  '/safeguarding/cases/:id/reopen',
  requirePermission('safeguarding.close'),
  validate({ body: z.object({ reason: z.string().trim().min(5).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    assertSafeguardingAccess(req.auth!, doc)
    if (!['resolved', 'closed'].includes(doc.status)) throw ApiError.badRequest('Only resolved or closed cases can be reopened')
    doc.status = 'open'
    doc.closedAt = undefined
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'reopened', note: req.body.reason })
    await doc.save()
    await writeAccessLog({ actor: req.auth!, resourceType: 'SafeguardingCase', resourceId: String(doc._id), action: 'reopened', req })
    await writeAudit({ req, actor: req.auth, action: 'safeguarding.reopened', resourceType: 'SafeguardingCase', resourceId: String(doc._id), reason: req.body.reason })
    ok(res, doc)
  }),
)

router.post(
  '/safeguarding/cases/:id/assign',
  requirePermission('safeguarding.assign'),
  validate({ body: z.object({ assignedTo: objectId, note: z.string().trim().max(500).optional() }) }),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    assertSafeguardingAccess(req.auth!, doc)
    const user = await User.findOne({ _id: req.body.assignedTo, status: 'active' })
    if (!user) throw ApiError.badRequest('Select an active staff member')
    doc.assignedTo = user._id
    doc.status = doc.status === 'open' ? 'under_review' : doc.status
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'assigned', note: `${user.name}${req.body.note ? ` — ${req.body.note}` : ''}` })
    await doc.save()
    await notifyUsers([user._id], {
      type: 'safeguarding.assigned',
      title: 'Safeguarding case assigned to you',
      message: `${doc.caseNumber}: ${doc.category} concern requires your attention.`,
      link: `/safeguarding/${doc._id}`,
    })
    await writeAccessLog({ actor: req.auth!, resourceType: 'SafeguardingCase', resourceId: String(doc._id), action: 'assigned', req })
    await writeAudit({ req, actor: req.auth, action: 'safeguarding.assigned', resourceType: 'SafeguardingCase', resourceId: String(doc._id), after: { assignedTo: String(user._id) } })
    ok(res, doc)
  }),
)

router.post(
  '/safeguarding/cases/:id/escalate',
  requirePermission('safeguarding.escalate'),
  validate({ body: z.object({ reason: z.string().trim().min(5).max(2000), to: z.string().trim().max(160).optional() }) }),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    assertSafeguardingAccess(req.auth!, doc)
    if (req.auth!.roles.includes('HEADTEACHER')) {
      doc.status = 'escalated'
      doc.escalation = { level: 'headteacher', to: req.body.to ?? 'Headteacher', at: new Date(), reason: req.body.reason }
      doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'escalated', note: req.body.reason })
      await doc.save()
      return ok(res, { case: doc, approval: null, message: 'Case escalated to institutional leadership.' })
    }
    const approval = await createApproval({
      type: 'safeguarding_escalation',
      refId: doc._id,
      studentId: doc.studentId,
      title: `Safeguarding escalation — ${doc.caseNumber}`,
      summary: 'Confidential escalation request. Open the case only if authorized.',
      requestedBy: req.auth!.userId,
      requiredPermission: 'safeguarding.escalate',
      requiredRole: 'HEADTEACHER',
    })
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'escalation_requested', note: req.body.reason })
    await doc.save()
    await notifyPermission('safeguarding.escalate', {
      type: 'safeguarding.escalation_requested',
      title: 'Safeguarding escalation needs decision',
      message: `${doc.caseNumber} requires Headteacher escalation review.`,
      link: `/approvals`,
    })
    await writeAudit({ req, actor: req.auth, action: 'safeguarding.escalation_requested', resourceType: 'SafeguardingCase', resourceId: String(doc._id), reason: req.body.reason })
    created(res, { case: doc, approval })
  }),
)

router.post(
  '/safeguarding/cases/:id/referrals',
  requirePermission('safeguarding.view'),
  validate({
    body: z.object({
      type: z.string().trim().min(2).max(120),
      to: z.string().trim().min(2).max(200),
      notes: z.string().trim().max(2000).optional(),
      status: z.string().trim().max(60).optional().default('made'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    assertSafeguardingAccess(req.auth!, doc)
    doc.referrals.push({ type: req.body.type, to: req.body.to, at: new Date(), notes: req.body.notes, status: req.body.status })
    doc.status = 'referred'
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'referred', note: `${req.body.type} → ${req.body.to}` })
    await doc.save()
    await writeAccessLog({ actor: req.auth!, resourceType: 'SafeguardingCase', resourceId: String(doc._id), action: 'referral', req })
    await writeAudit({ req, actor: req.auth, action: 'safeguarding.referred', resourceType: 'SafeguardingCase', resourceId: String(doc._id), after: { to: req.body.to, type: req.body.type } })
    created(res, doc)
  }),
)

router.post(
  '/safeguarding/cases/:id/evidence',
  requirePermission('safeguarding.view'),
  validate({ body: z.object({ evidenceId: objectId }) }),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    assertSafeguardingAccess(req.auth!, doc)
    const evidence = await Evidence.findById(req.body.evidenceId)
    if (!evidence) throw ApiError.notFound('Evidence not found')
    doc.evidenceIds.push(evidence._id)
    evidence.classification = 'restricted'
    evidence.linkedType = 'safeguarding'
    evidence.linkedId = doc._id
    await Promise.all([doc.save(), evidence.save()])
    await writeAccessLog({ actor: req.auth!, resourceType: 'SafeguardingCase', resourceId: String(doc._id), action: 'evidence_linked', req })
    await writeAudit({ req, actor: req.auth, action: 'safeguarding.evidence_linked', resourceType: 'SafeguardingCase', resourceId: String(doc._id), after: { evidenceId: String(evidence._id) } })
    ok(res, doc)
  }),
)

router.get(
  '/safeguarding/cases/:id/access-log',
  requirePermission('safeguarding.view'),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id).select('accessLog caseNumber')
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    assertSafeguardingAccess(req.auth!, doc)
    if (!req.auth!.roles.includes('HEADTEACHER')) throw ApiError.forbidden('Only the Headteacher can review the access log')
    ok(res, doc.accessLog)
  }),
)

router.post(
  '/safeguarding/check-access/:id',
  requirePermission('safeguarding.view'),
  asyncHandler(async (req, res) => {
    const doc = await SafeguardingCase.findById(req.params.id).select('reportedBy assignedTo')
    if (!doc) throw ApiError.notFound('Safeguarding case not found')
    ok(res, { allowed: await safeguardingCaseAccess(req.auth!, doc) })
  }),
)

export default router
