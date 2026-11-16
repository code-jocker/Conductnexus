import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Approval } from '../models/discipline.js'
import { decideApproval, pendingApprovalsFor } from '../services/approvals.service.js'
import { Types } from 'mongoose'

const router = Router()
router.use(authenticate)

/**
 * Permissions that can act on at least one kind of approval. The list endpoints
 * are guarded by this set because they aggregate approvals of many types; each
 * individual record is still filtered by its own `requiredPermission`.
 */
const APPROVAL_PERMISSIONS = [
  'marks.adjust.approve',
  'incidents.review',
  'letters.approve',
  'safeguarding.escalate',
  'students.promote.approve',
  'investigations.decide',
] as const

/**
 * Record-level guard for `/approvals/:id*`.
 *
 * Approval routes cannot use a single static permission: every approval carries
 * its own `requiredPermission`, and the requester may read their own record.
 * Loading the record here authorizes against the permission that approval
 * actually demands, and fails closed with 404 (missing) before 403 (unauthorized).
 */
async function loadApproval(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await Approval.findById(req.params.id).lean()
    if (!approval) throw ApiError.notFound('Approval not found')
    const auth = req.auth!
    if (!auth.permissions.has(approval.requiredPermission) && String(approval.requestedBy) !== String(auth.userId)) {
      throw ApiError.forbidden('You are not authorized to view this approval')
    }
    res.locals.approval = approval
    next()
  } catch (err) {
    next(err)
  }
}

router.get(
  '/approvals',
  requirePermission(...APPROVAL_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const { page, pageSize, skip } = parsePagination(req.query)
    const status = String(req.query.status ?? 'pending')
    let filter: Record<string, unknown>
    if (status === 'pending') {
      const pending = await pendingApprovalsFor(ctx)
      const ids = pending.map((p) => p._id)
      filter = { _id: { $in: ids } }
    } else {
      const permissionFilter = { requiredPermission: { $in: [...ctx.permissions] } }
      filter = {
        ...(status !== 'all' ? { status } : {}),
        $or: [{ requestedBy: ctx.userId }, permissionFilter],
      }
    }
    const [total, items, pendingCount] = await Promise.all([
      Approval.countDocuments(filter),
      Approval.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId classId')
        .populate('requestedBy', 'name position')
        .populate('decidedBy', 'name position')
        .lean(),
      Approval.countDocuments({ status: 'pending', requiredPermission: { $in: [...ctx.permissions] }, requestedBy: { $ne: ctx.userId } }),
    ])
    ok(res, items, { ...pagedMeta(total, page, pageSize), pendingCount })
  }),
)

router.get(
  '/approvals/pending/count',
  requirePermission(...APPROVAL_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const items = await pendingApprovalsFor(req.auth!)
    ok(res, { count: items.length })
  }),
)

router.get(
  '/approvals/:id',
  loadApproval,
  asyncHandler(async (req, res) => {
    const approval = await Approval.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId currentBalance')
      .populate('requestedBy', 'name position')
      .populate('decidedBy', 'name position')
      .lean()
    if (!approval) throw ApiError.notFound('Approval not found')
    ok(res, approval)
  }),
)

const decisionBody = z.object({
  notes: z.string().trim().max(2000).optional(),
})

router.post(
  '/approvals/:id/approve',
  loadApproval,
  validate({ body: decisionBody }),
  asyncHandler(async (req, res) => {
    const approval = await Approval.findById(req.params.id)
    if (!approval) throw ApiError.notFound('Approval not found')
    const result = await decideApproval(req.auth!, req.params.id, { decision: 'approve', notes: req.body.notes }, req)
    ok(res, result)
  }),
)

router.post(
  '/approvals/:id/reject',
  loadApproval,
  validate({ body: z.object({ reason: z.string().trim().min(3).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const result = await decideApproval(req.auth!, req.params.id, { decision: 'reject', notes: req.body.reason }, req)
    ok(res, result)
  }),
)

router.post(
  '/approvals/:id/request-info',
  loadApproval,
  validate({ body: z.object({ notes: z.string().trim().min(3).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const result = await decideApproval(req.auth!, req.params.id, { decision: 'request_info', notes: req.body.notes }, req)
    ok(res, result)
  }),
)

router.get(
  '/approvals/:id/timeline',
  loadApproval,
  asyncHandler(async (req, res) => {
    const approval = res.locals.approval as { _id: Types.ObjectId }
    const { AuditLog } = await import('../models/governance.js')
    const logs = await AuditLog.find({
      resourceType: 'Approval',
      resourceId: String(approval._id),
    })
      .sort({ createdAt: 1 })
      .lean()
    ok(res, {
      approval,
      timeline: logs.map((l) => ({
        action: l.action,
        actor: l.actorName,
        at: l.createdAt,
        reason: l.reason,
      })),
    })
  }),
)

export default router
