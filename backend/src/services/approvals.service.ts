import type { Request } from 'express'
import { Approval, AdjustmentRequest, Incident } from '../models/discipline.js'
import { Letter as LetterModel } from '../models/communications.js'
import { SafeguardingCase } from '../models/governance.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from './audit.service.js'
import { applyAdjustmentDecision } from './adjustments.service.js'
import { finalizeIncidentDeduction } from './incidents.service.js'
import { notifyUsers } from './notification.service.js'
import { hasPermission, hasRole, type AuthContext } from './rbac.service.js'

export async function decideApproval(
  ctx: AuthContext,
  approvalId: string,
  input: { decision: 'approve' | 'reject' | 'request_info'; notes?: string },
  req?: Request,
) {
  const approval = await Approval.findById(approvalId)
  if (!approval) throw ApiError.notFound('Approval request not found')
  if (approval.status !== 'pending') throw ApiError.badRequest('This approval has already been decided')
  if (String(approval.requestedBy) === String(ctx.userId)) {
    throw ApiError.forbidden('You cannot decide your own approval request')
  }
  if (!hasPermission(ctx, approval.requiredPermission)) {
    throw ApiError.forbidden(`This approval requires permission: ${approval.requiredPermission}`)
  }
  if (approval.requiredRole && !hasRole(ctx, approval.requiredRole)) {
    throw ApiError.forbidden(`This decision requires the ${approval.requiredRole} role`)
  }
  if (input.decision === 'request_info' && !input.notes?.trim()) {
    throw ApiError.badRequest('Describe what information is required')
  }
  if (input.decision === 'reject' && !input.notes?.trim()) {
    throw ApiError.badRequest('A rejection reason is required')
  }

  if (input.decision === 'request_info') {
    approval.status = 'info_requested'
    approval.decisionNotes = input.notes
    approval.decidedBy = ctx.userId
    await approval.save()
    await notifyUsers([approval.requestedBy], {
      type: 'approval.info_requested',
      title: 'More information requested',
      message: `${approval.approvalNumber}: ${input.notes}`,
      link: '/approvals',
    })
    await writeAudit({ req, actor: ctx, action: 'approval.info_requested', resourceType: 'Approval', resourceId: approvalId, reason: input.notes })
    return approval
  }

  if (approval.type === 'incident') {
    const incident = await Incident.findById(approval.refId)
    if (!incident) throw ApiError.notFound('Linked incident not found')
    if (input.decision === 'approve') {
      await finalizeIncidentDeduction(incident, ctx, input.notes ?? 'Approved', req)
    } else {
      incident.status = 'rejected'
      incident.review = {
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        decision: 'rejected',
        comments: input.notes,
      }
      incident.history.push({ at: new Date(), by: ctx.userId, action: 'rejected', note: input.notes })
      await incident.save()
      await writeAudit({ req, actor: ctx, action: 'incident.rejected', resourceType: 'Incident', resourceId: String(incident._id), reason: input.notes })
    }
  } else if (approval.type === 'adjustment') {
    const adjustment = await AdjustmentRequest.findById(approval.refId)
    if (!adjustment) throw ApiError.notFound('Linked adjustment not found')
    await applyAdjustmentDecision(ctx, adjustment, input.decision === 'approve' ? 'approve' : 'reject', input.notes, req)
  } else if (approval.type === 'letter') {
    const letter = await LetterModel.findById(approval.refId)
    if (!letter) throw ApiError.notFound('Linked letter not found')
    if (input.decision === 'approve') {
      letter.status = 'approved'
      letter.approvedBy = ctx.userId
      letter.approvalNotes = input.notes
      letter.history.push({ at: new Date(), by: ctx.userId, action: 'approved', note: input.notes })
    } else {
      letter.status = 'rejected'
      letter.rejectionReason = input.notes
      letter.history.push({ at: new Date(), by: ctx.userId, action: 'rejected', note: input.notes })
    }
    await letter.save()
    await notifyUsers([letter.preparedBy], {
      type: input.decision === 'approve' ? 'letter.approved' : 'letter.rejected',
      title: input.decision === 'approve' ? 'Letter approved' : 'Letter rejected',
      message: `${letter.reference} — ${input.notes ?? ''}`,
      link: `/letters`,
    })
  } else if (approval.type === 'safeguarding_escalation') {
    const safeguard = await SafeguardingCase.findById(approval.refId)
    if (!safeguard) throw ApiError.notFound('Linked safeguarding case not found')
    if (input.decision === 'approve') {
      safeguard.status = 'escalated'
      safeguard.escalation = { level: 'headteacher', to: ctx.name, at: new Date(), reason: input.notes ?? 'Approved escalation' }
      safeguard.history.push({ at: new Date(), by: ctx.userId, action: 'escalated', note: input.notes })
      await safeguard.save()
    }
  }

  approval.status = input.decision === 'approve' ? 'approved' : 'rejected'
  approval.decisionNotes = input.notes
  approval.rejectionReason = input.decision === 'reject' ? input.notes : undefined
  approval.decidedBy = ctx.userId
  approval.decidedAt = new Date()
  await approval.save()

  await notifyUsers([approval.requestedBy], {
    type: `approval.${approval.status}`,
    title: `Approval ${approval.status}`,
    message: `${approval.approvalNumber} — ${input.notes ?? ''}`,
    link: '/approvals',
  })
  await writeAudit({
    req,
    actor: ctx,
    action: `approval.${approval.status}`,
    resourceType: 'Approval',
    resourceId: approvalId,
    reason: input.notes,
  })
  return approval
}

export async function pendingApprovalsFor(req: AuthContext) {
  const perms = [...req.permissions]
  return Approval.find({
    status: 'pending',
    requiredPermission: { $in: perms },
    $or: [{ requiredRole: { $exists: false } }, { requiredRole: null }, { requiredRole: { $in: req.roles } }],
    requestedBy: { $ne: req.userId },
  })
    .sort({ createdAt: 1 })
    .lean()
}
