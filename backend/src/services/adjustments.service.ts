import type { Request } from 'express'
import { getSettings } from '../models/core.js'
import { AdjustmentRequest, Incident, type IAdjustmentRequest } from '../models/discipline.js'
import { nextRef } from '../shared/refs.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from './audit.service.js'
import { createApproval } from './approvals.util.js'
import { notifyPermission, notifyUsers } from './notification.service.js'
import { postTransaction } from './ledger.service.js'
import { assertStudentAccess, hasPermission, type AuthContext } from './rbac.service.js'

export async function requestAdjustment(
  ctx: AuthContext,
  input: { studentId: string; ledgerId?: string; incidentId?: string; reason: string; requestedChange: number },
  req?: Request,
) {
  const student = await assertStudentAccess(ctx, input.studentId)
  if (!Number.isFinite(input.requestedChange) || input.requestedChange === 0) {
    throw ApiError.badRequest('The requested change must be a non-zero number of marks')
  }
  if (Math.abs(input.requestedChange) > 40) throw ApiError.badRequest('An adjustment cannot exceed 40 marks')
  if (!input.reason.trim()) throw ApiError.badRequest('A reason is required')

  const settings = await getSettings()
  const reference = await nextRef('ADJ', 4)
  const adjustment = await AdjustmentRequest.create({
    reference,
    studentId: student._id,
    ledgerId: input.ledgerId,
    incidentId: input.incidentId,
    requestedBy: ctx.userId,
    reason: input.reason,
    requestedChange: Math.round(input.requestedChange),
    status: 'pending',
  })

  const approval = await createApproval({
    type: 'adjustment',
    refId: adjustment._id,
    studentId: student._id,
    title: `Mark adjustment — ${student.fullName}`,
    summary: `${input.requestedChange > 0 ? '+' : ''}${input.requestedChange} marks requested. ${input.reason}`,
    requestedBy: ctx.userId,
    requiredPermission: 'marks.adjust.approve',
    requiredRole: Math.abs(input.requestedChange) >= settings.discipline.highImpactDeduction ? 'HEADTEACHER' : undefined,
  })
  adjustment.approvalId = approval._id
  await adjustment.save()

  if (input.incidentId) await Incident.updateOne({ _id: input.incidentId }, { $set: { adjustmentId: adjustment._id } })

  await notifyPermission(
    'marks.adjust.approve',
    {
      type: 'adjustment.requested',
      title: 'Mark adjustment awaiting approval',
      message: `${student.fullName}: ${input.requestedChange > 0 ? '+' : ''}${input.requestedChange} marks — ${input.reason}`,
      link: '/approvals',
      data: { adjustmentId: String(adjustment._id) },
    },
    { excludeUserId: String(ctx.userId) },
  )
  await writeAudit({
    req,
    actor: ctx,
    action: 'marks.adjustment.requested',
    resourceType: 'AdjustmentRequest',
    resourceId: String(adjustment._id),
    after: { reference, change: input.requestedChange },
    reason: input.reason,
  })
  return { adjustment, approval }
}

export async function applyAdjustmentDecision(
  ctx: AuthContext,
  adjustment: IAdjustmentRequest,
  decision: 'approve' | 'reject',
  notes: string | undefined,
  req?: Request,
) {
  if (adjustment.status !== 'pending') throw ApiError.badRequest('This adjustment has already been decided')
  if (String(adjustment.requestedBy) === String(ctx.userId)) {
    throw ApiError.forbidden('You cannot approve or reject your own adjustment request')
  }
  if (decision === 'reject' && !notes?.trim()) throw ApiError.badRequest('A rejection reason is required')
  if (!hasPermission(ctx, 'marks.adjust.approve')) throw ApiError.forbidden('Missing permission: marks.adjust.approve')

  if (decision === 'reject') {
    adjustment.status = 'rejected'
    adjustment.decidedBy = ctx.userId
    adjustment.decisionReason = notes
    adjustment.decidedAt = new Date()
    await adjustment.save()
    await notifyUsers([adjustment.requestedBy], {
      type: 'adjustment.rejected',
      title: 'Adjustment rejected',
      message: `${adjustment.reference} was rejected: ${notes}`,
      link: `/adjustments`,
    })
    await writeAudit({ req, actor: ctx, action: 'marks.adjustment.rejected', resourceType: 'AdjustmentRequest', resourceId: String(adjustment._id), reason: notes })
    return adjustment
  }

  const student = await import('../models/school.js').then((m) => m.Student.findById(adjustment.studentId))
  if (!student) throw ApiError.notFound('Student not found')
  const termId = student.currentTermId ?? student.termId
  if (!termId) throw ApiError.badRequest('No active term available')

  const ledger = await postTransaction({
    studentId: student._id,
    termId,
    academicYearId: student.academicYearId,
    incidentId: adjustment.incidentId,
    adjustmentId: adjustment._id,
    type: 'adjustment',
    change: adjustment.requestedChange,
    reason: `Approved adjustment ${adjustment.reference}: ${adjustment.reason}`,
    actor: { userId: ctx.userId, name: ctx.name, roles: ctx.roles },
    approvedBy: ctx.userId,
  })

  adjustment.status = 'approved'
  adjustment.decidedBy = ctx.userId
  adjustment.decisionReason = notes
  adjustment.decidedAt = new Date()
  adjustment.resultingLedgerId = ledger._id
  await adjustment.save()

  if (adjustment.incidentId) {
    await Incident.updateOne(
      { _id: adjustment.incidentId },
      { $push: { history: { at: new Date(), by: ctx.userId, action: 'adjustment_applied', note: notes ?? 'Mark adjustment approved' } } },
    )
  }

  await notifyUsers([adjustment.requestedBy], {
    type: 'adjustment.approved',
    title: 'Adjustment approved',
    message: `${adjustment.reference} was approved (${adjustment.requestedChange > 0 ? '+' : ''}${adjustment.requestedChange} marks).`,
    link: `/adjustments`,
  })
  await writeAudit({
    req,
    actor: ctx,
    action: 'marks.adjustment.approved',
    resourceType: 'AdjustmentRequest',
    resourceId: String(adjustment._id),
    after: { change: adjustment.requestedChange, ledgerId: String(ledger._id) },
  })
  return adjustment
}
