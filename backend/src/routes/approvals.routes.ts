import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Approval } from '../models/discipline.js'
import { decideApproval, pendingApprovalsFor } from '../services/approvals.service.js'
import { Types } from 'mongoose'

const router = Router()
router.use(authenticate)

router.get(
  '/approvals',
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
  asyncHandler(async (req, res) => {
    const items = await pendingApprovalsFor(req.auth!)
    ok(res, { count: items.length })
  }),
)

router.get(
  '/approvals/:id',
  asyncHandler(async (req, res) => {
    const approval = await Approval.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId currentBalance')
      .populate('requestedBy', 'name position')
      .populate('decidedBy', 'name position')
      .lean()
    if (!approval) throw ApiError.notFound('Approval not found')
    if (!req.auth!.permissions.has(approval.requiredPermission) && String(approval.requestedBy) !== String(req.auth!.userId)) {
      throw ApiError.forbidden('You are not authorized to view this approval')
    }
    ok(res, approval)
  }),
)

const decisionBody = z.object({
  notes: z.string().trim().max(2000).optional(),
})

router.post(
  '/approvals/:id/approve',
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
  validate({ body: z.object({ reason: z.string().trim().min(3).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const result = await decideApproval(req.auth!, req.params.id, { decision: 'reject', notes: req.body.reason }, req)
    ok(res, result)
  }),
)

router.post(
  '/approvals/:id/request-info',
  validate({ body: z.object({ notes: z.string().trim().min(3).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const result = await decideApproval(req.auth!, req.params.id, { decision: 'request_info', notes: req.body.notes }, req)
    ok(res, result)
  }),
)

router.get(
  '/approvals/:id/timeline',
  asyncHandler(async (req, res) => {
    const approval = await Approval.findById(req.params.id).lean()
    if (!approval) throw ApiError.notFound('Approval not found')
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
