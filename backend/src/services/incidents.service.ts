import { Types } from 'mongoose'
import { getSettings } from '../models/core.js'
import { ClassModel, Dormitory, Student, type IStudent } from '../models/school.js'
import { Offence, type IIncident } from '../models/discipline.js'
import { Evidence } from '../models/governance.js'
import { Incident } from '../models/discipline.js'
import { nextRef } from '../shared/refs.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from './audit.service.js'
import { createApproval } from './approvals.util.js'
import { notifyPermission, notifyRole, notifyUsers } from './notification.service.js'
import { postTransaction } from './ledger.service.js'
import { evaluateStudentRisk } from './risk.service.js'
import { queueParentMessage } from './communication.service.js'
import { canAccessStudent, hasPermission, type AuthContext } from './rbac.service.js'
import type { Request } from 'express'

export type CreateIncidentInput = {
  studentId: string
  offenceId: string
  description: string
  occurredAt: string
  location: string
  witnesses?: { name: string; contact?: string; statement?: string }[]
  evidenceIds?: string[]
  immediateAction?: string
  safeguardingFlag?: boolean
  clientSubmissionId?: string
}

export async function createIncident(ctx: AuthContext, input: CreateIncidentInput, req?: Request) {
  const student = await Student.findById(input.studentId)
  if (!student) throw ApiError.notFound('Student not found')
  if (student.status !== 'active') throw ApiError.badRequest('Incidents can only be recorded for active students.')
  if (!(await canAccessStudent(ctx, student))) throw ApiError.forbidden('You cannot record an incident for this student.')

  const offence = await Offence.findById(input.offenceId)
  if (!offence || !offence.active) throw ApiError.badRequest('Select a valid, active offence rule.')

  const settings = await getSettings()
  const occurredAt = new Date(input.occurredAt)
  if (Number.isNaN(occurredAt.getTime())) throw ApiError.badRequest('Invalid incident date and time')
  if (occurredAt.getTime() > Date.now() + 60_000) throw ApiError.badRequest('Incident time cannot be in the future')
  if (occurredAt.getTime() < Date.now() - settings.discipline.maxBackdatingDays * 86_400_000) {
    throw ApiError.badRequest(`Incidents can only be backdated ${settings.discipline.maxBackdatingDays} days.`)
  }

  const classDoc = await ClassModel.findById(student.classId)
  if (classDoc && offence.applicableLevels.length && !offence.applicableLevels.includes(classDoc.level)) {
    throw ApiError.badRequest('This offence rule does not apply to the student’s class level.')
  }
  const dorm = student.dormitoryId ? await Dormitory.findById(student.dormitoryId) : null

  if (input.clientSubmissionId) {
    const existing = await Incident.findOne({ clientSubmissionId: input.clientSubmissionId })
    if (existing) return existing
  }

  const termId = student.currentTermId ?? student.termId ?? undefined
  const incidentNumber = await nextRef('INC', 5)
  const incident = await Incident.create({
    incidentNumber,
    studentId: student._id,
    studentSnapshot: {
      fullName: student.fullName,
      studentId: student.studentId,
      className: classDoc?.name ?? '',
      dormitoryName: dorm?.name,
    },
    offenceId: offence._id,
    offenceSnapshot: {
      name: offence.name,
      code: offence.code,
      deduction: offence.deduction,
      severity: offence.severity,
      requiresApproval: offence.requiresApproval,
      requiresEvidence: offence.requiresEvidence,
      notifyParent: offence.notifyParent,
    },
    description: input.description,
    occurredAt,
    location: input.location,
    reportedBy: ctx.userId,
    severity: offence.severity,
    status: 'draft',
    witnesses: input.witnesses ?? [],
    evidenceIds: (input.evidenceIds ?? []).filter(Boolean).map((id) => new Types.ObjectId(id)),
    immediateAction: input.immediateAction?.trim() || undefined,
    safeguardingFlag: Boolean(input.safeguardingFlag),
    academicYearId: student.academicYearId ?? undefined,
    termId,
    clientSubmissionId: input.clientSubmissionId,
    parentNotificationStatus: offence.notifyParent ? 'pending' : 'not_required',
    history: [{ at: new Date(), by: ctx.userId, action: 'created', note: 'Draft incident created' }],
  })

  if (input.evidenceIds?.length) {
    await Evidence.updateMany(
      { _id: { $in: input.evidenceIds }, uploadedBy: ctx.userId },
      { $set: { linkedType: 'incident', linkedId: incident._id } },
    )
  }

  await writeAudit({
    req,
    actor: ctx,
    action: 'incident.created',
    resourceType: 'Incident',
    resourceId: String(incident._id),
    after: { incidentNumber, studentId: student.studentId, offence: offence.name, status: 'draft' },
  })

  if (input.safeguardingFlag) {
    await notifyPermission('safeguarding.view', {
      type: 'safeguarding_flag',
      title: 'Possible safeguarding concern reported',
      message: `${student.fullName} — ${offence.name}. Review whether a safeguarding case should be opened.`,
      link: '/safeguarding',
      data: { incidentId: String(incident._id) },
    })
  }

  return incident
}

export async function updateDraftIncident(ctx: AuthContext, id: string, input: Partial<CreateIncidentInput>, req?: Request) {
  const incident = await Incident.findById(id)
  if (!incident) throw ApiError.notFound('Incident not found')
  if (incident.reportedBy.toString() !== ctx.userId.toString() && !hasPermission(ctx, 'incidents.view_all')) {
    throw ApiError.forbidden('You can only edit incidents you reported')
  }
  if (incident.status !== 'draft') throw ApiError.badRequest('Only draft incidents can be edited')
  if (input.description !== undefined) incident.description = input.description
  if (input.location !== undefined) incident.location = input.location
  if (input.occurredAt !== undefined) incident.occurredAt = new Date(input.occurredAt)
  if (input.witnesses !== undefined) incident.witnesses = input.witnesses
  if (input.evidenceIds !== undefined) incident.evidenceIds = input.evidenceIds.map((e) => new Types.ObjectId(e))
  if (input.immediateAction !== undefined) incident.immediateAction = input.immediateAction.trim() || undefined
  if (input.safeguardingFlag !== undefined) incident.safeguardingFlag = input.safeguardingFlag
  incident.history.push({ at: new Date(), by: ctx.userId, action: 'updated', note: 'Draft updated' })
  await incident.save()
  await writeAudit({ req, actor: ctx, action: 'incident.updated', resourceType: 'Incident', resourceId: id, after: { status: incident.status } })
  return incident
}

async function assertEvidenceRequirement(incident: IIncident) {
  if (!incident.offenceSnapshot.requiresEvidence) return
  const count = await Evidence.countDocuments({ linkedType: 'incident', linkedId: incident._id })
  if (count === 0) throw ApiError.badRequest('This offence requires supporting evidence before the incident can be submitted.')
}

export async function submitIncident(ctx: AuthContext, id: string, req?: Request) {
  const incident = await Incident.findById(id)
  if (!incident) throw ApiError.notFound('Incident not found')
  if (incident.reportedBy.toString() !== ctx.userId.toString() && !hasPermission(ctx, 'incidents.view_all')) {
    throw ApiError.forbidden('You can only submit incidents you reported')
  }
  if (!['draft', 'submitted'].includes(incident.status)) throw ApiError.badRequest('This incident cannot be submitted from its current status')
  await assertEvidenceRequirement(incident)
  const settings = await getSettings()
  incident.status = settings.discipline.requireReview || incident.offenceSnapshot.requiresApproval ? 'under_review' : 'submitted'
  incident.history.push({ at: new Date(), by: ctx.userId, action: 'submitted', note: 'Submitted for review' })
  await incident.save()

  await notifyPermission(
    'incidents.review',
    {
      type: 'incident.submitted',
      title: 'Incident awaiting review',
      message: `${incident.incidentNumber} — ${incident.studentSnapshot.fullName} (${incident.offenceSnapshot.name}).`,
      link: `/incidents/${incident._id}`,
      data: { incidentId: String(incident._id) },
    },
    { excludeUserId: String(ctx.userId) },
  )
  await writeAudit({ req, actor: ctx, action: 'incident.submitted', resourceType: 'Incident', resourceId: id, after: { status: incident.status } })

  if (!settings.discipline.requireReview && !incident.offenceSnapshot.requiresApproval) {
    return finalizeIncidentDeduction(incident, ctx, 'Automatically applied — review not required by policy', req)
  }
  return incident
}

export type ReviewDecision = 'approve' | 'reject' | 'request_info'

export async function reviewIncident(ctx: AuthContext, id: string, input: { decision: ReviewDecision; comments?: string }, req?: Request) {
  const incident = await Incident.findById(id)
  if (!incident) throw ApiError.notFound('Incident not found')
  if (String(incident.reportedBy) === String(ctx.userId)) {
    throw ApiError.forbidden('You cannot review or approve an incident you reported.')
  }
  if (!['submitted', 'under_review', 'escalated'].includes(incident.status)) {
    throw ApiError.badRequest('This incident is not awaiting review')
  }
  if (input.decision === 'reject' && !input.comments?.trim()) {
    throw ApiError.badRequest('A rejection reason is required')
  }

  if (input.decision === 'request_info') {
    incident.status = 'under_review'
    incident.review = { ...incident.review, reviewedBy: ctx.userId, reviewedAt: new Date(), decision: 'info_requested', comments: input.comments }
    incident.history.push({ at: new Date(), by: ctx.userId, action: 'info_requested', note: input.comments })
    await incident.save()
    await notifyUsers([incident.reportedBy], {
      type: 'incident.info_requested',
      title: 'More information requested',
      message: `Reviewer requested more information on ${incident.incidentNumber}.`,
      link: `/incidents/${incident._id}`,
    })
    await writeAudit({ req, actor: ctx, action: 'incident.info_requested', resourceType: 'Incident', resourceId: id, reason: input.comments })
    return incident
  }

  if (input.decision === 'reject') {
    incident.status = 'rejected'
    incident.review = { reviewedBy: ctx.userId, reviewedAt: new Date(), decision: 'rejected', comments: input.comments }
    incident.history.push({ at: new Date(), by: ctx.userId, action: 'rejected', note: input.comments })
    await incident.save()
    await notifyUsers([incident.reportedBy], {
      type: 'incident.rejected',
      title: 'Incident rejected',
      message: `${incident.incidentNumber} was rejected: ${input.comments}`,
      link: `/incidents/${incident._id}`,
    })
    await writeAudit({ req, actor: ctx, action: 'incident.rejected', resourceType: 'Incident', resourceId: id, reason: input.comments })
    return incident
  }

  const highImpact = ['serious', 'critical'].includes(incident.severity)
  if (highImpact && !ctx.roles.includes('HEADTEACHER')) {
    incident.status = 'escalated'
    incident.review = { ...incident.review, reviewedBy: ctx.userId, reviewedAt: new Date(), decision: 'approved', comments: input.comments }
    await incident.save()
    const approval = await createApproval({
      type: 'incident',
      refId: incident._id,
      studentId: incident.studentId,
      title: `Serious incident approval — ${incident.incidentNumber}`,
      summary: `${incident.studentSnapshot.fullName} — ${incident.offenceSnapshot.name} (${incident.offenceSnapshot.deduction} marks)`,
      requestedBy: ctx.userId,
      requiredPermission: 'incidents.review',
      requiredRole: 'HEADTEACHER',
    })
    incident.approvalId = approval._id
    incident.history.push({ at: new Date(), by: ctx.userId, action: 'escalated', note: 'Escalated to Headteacher for approval' })
    await incident.save()
    await notifyRole('HEADTEACHER', {
      type: 'approval.required',
      title: 'Serious incident requires your approval',
      message: `${incident.incidentNumber} — ${incident.studentSnapshot.fullName} (${incident.offenceSnapshot.name}).`,
      link: `/approvals`,
      data: { approvalId: String(approval._id) },
    })
    await writeAudit({ req, actor: ctx, action: 'incident.escalated', resourceType: 'Incident', resourceId: id, reason: 'Serious incident requires Headteacher approval' })
    return incident
  }

  return finalizeIncidentDeduction(incident, ctx, input.comments ?? 'Approved', req)
}

export async function finalizeIncidentDeduction(incident: IIncident, approver: AuthContext, notes: string, req?: Request) {
  if (incident.deductionApplied) return incident
  const settings = await getSettings()
  const student = await Student.findById(incident.studentId)
  if (!student) throw ApiError.notFound('Student not found')
  const termId = incident.termId ?? student.currentTermId ?? student.termId
  if (!termId) throw ApiError.badRequest('No active term is available for this incident')

  const deduction = incident.offenceSnapshot.deduction
  if (deduction > 0) {
    const ledger = await postTransaction({
      studentId: student._id,
      termId,
      academicYearId: incident.academicYearId,
      incidentId: incident._id,
      type: 'deduction',
      change: -deduction,
      reason: `Incident ${incident.incidentNumber} — ${incident.offenceSnapshot.name}`,
      actor: { userId: approver.userId, name: approver.name, roles: approver.roles },
      approvedBy: approver.userId,
    })
    incident.ledgerId = ledger._id
  } else {
    await evaluateStudentRisk(student._id, `Incident ${incident.incidentNumber}`, { userId: approver.userId, name: approver.name })
  }

  incident.deductionApplied = true
  incident.status = 'approved'
  incident.review = {
    reviewedBy: incident.review?.reviewedBy ?? approver.userId,
    reviewedAt: incident.review?.reviewedAt ?? new Date(),
    decision: 'approved',
    comments: notes,
  }
  incident.history.push({ at: new Date(), by: approver.userId, action: 'approved', note: notes })
  await incident.save()

  if (incident.offenceSnapshot.notifyParent && settings.comms.notifyOnDeduction) {
    try {
      await queueParentMessage({
        studentId: student._id,
        incidentId: incident._id,
        templateKey: ['serious', 'critical'].includes(incident.severity) ? 'serious_incident' : 'incident_deduction',
        createdBy: approver.userId,
        extraVars: { balance: student.currentBalance },
      })
    } catch {
      incident.parentNotificationStatus = 'failed'
      await incident.save()
    }
  }

  await notifyUsers([incident.reportedBy], {
    type: 'incident.approved',
    title: 'Incident approved',
    message: `${incident.incidentNumber} was approved. ${deduction} conduct mark(s) recorded.`,
    link: `/incidents/${incident._id}`,
  })
  await writeAudit({
    req,
    actor: approver,
    action: 'incident.approved',
    resourceType: 'Incident',
    resourceId: String(incident._id),
    after: { status: incident.status, deduction },
  })
  return incident
}

export async function closeIncident(ctx: AuthContext, id: string, note: string, req?: Request) {
  const incident = await Incident.findById(id)
  if (!incident) throw ApiError.notFound('Incident not found')
  if (!['approved', 'rejected', 'resolved', 'escalated'].includes(incident.status)) {
    throw ApiError.badRequest('Only reviewed incidents can be closed')
  }
  incident.status = 'closed'
  incident.history.push({ at: new Date(), by: ctx.userId, action: 'closed', note })
  await incident.save()
  await writeAudit({ req, actor: ctx, action: 'incident.closed', resourceType: 'Incident', resourceId: id, reason: note })
  return incident
}

export async function visibleIncidentFilter(ctx: AuthContext): Promise<Record<string, unknown>> {
  if (hasPermission(ctx, 'incidents.view_all')) return {}
  const { visibleStudentQuery } = await import('./rbac.service.js')
  const studentFilter = await visibleStudentQuery(ctx)
  const students = await Student.find(studentFilter).select('_id').lean()
  const studentIds = students.map((s) => s._id)
  if (hasPermission(ctx, 'incidents.view_assigned')) {
    return { $or: [{ reportedBy: ctx.userId }, { studentId: { $in: studentIds } }] }
  }
  return { reportedBy: ctx.userId }
}

export async function getIncidentForUser(ctx: AuthContext, id: string) {
  const incident = await Incident.findById(id)
  if (!incident) throw ApiError.notFound('Incident not found')
  if (hasPermission(ctx, 'incidents.view_all')) return incident
  if (String(incident.reportedBy) === String(ctx.userId)) return incident
  if (hasPermission(ctx, 'incidents.view_assigned')) {
    const student = await Student.findById(incident.studentId)
    if (student && (await canAccessStudent(ctx, student))) return incident
  }
  throw ApiError.forbidden('You are not authorized to view this incident')
}

export { IStudent }
