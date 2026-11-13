import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Investigation } from '../models/governance.js'
import { Incident } from '../models/discipline.js'
import { User } from '../models/core.js'
import { nextRef } from '../shared/refs.js'
import { assertStudentAccess } from '../services/rbac.service.js'
import { writeAccessLog, writeAudit } from '../services/audit.service.js'
import { notifyUsers } from '../services/notification.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

type InvestigationDoc = InstanceType<typeof Investigation>

function assertInvestigationAccess(ctx: NonNullable<import('express').Request['auth']>, doc: InvestigationDoc) {
  if (ctx.roles.includes('HEADTEACHER')) return
  if (!ctx.permissions.has('investigations.view')) throw ApiError.forbidden('Missing permission: investigations.view')
  if (String(doc.createdBy) === String(ctx.userId) || String(doc.assignedTo ?? '') === String(ctx.userId)) return
  throw ApiError.forbidden('You are not assigned to this investigation')
}

router.get(
  '/investigations',
  requirePermission('investigations.view'),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = ctx.roles.includes('HEADTEACHER')
      ? {}
      : { $or: [{ createdBy: ctx.userId }, { assignedTo: ctx.userId }] }
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      const clauses = [{ caseNumber: rx }, { title: rx }]
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: clauses }]
        delete filter.$or
      } else {
        filter.$or = clauses
      }
    }
    const [total, items] = await Promise.all([
      Investigation.countDocuments(filter),
      Investigation.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select('-witnesses.statement -studentStatement -timeline')
        .populate('studentId', 'fullName studentId classId')
        .populate('assignedTo', 'name position')
        .populate('createdBy', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/investigations',
  requirePermission('investigations.create'),
  validate({
    body: z.object({
      studentId: objectId,
      incidentIds: z.array(objectId).optional(),
      title: z.string().trim().min(5).max(200),
      type: z.enum(['misconduct', 'serious_incident', 'safeguarding_linked', 'other']).default('misconduct'),
      assignedTo: objectId.optional(),
      deadline: z.string().trim().optional(),
      linkedSafeguardingCaseId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    if (req.body.assignedTo && !(await User.exists({ _id: req.body.assignedTo, status: 'active' }))) {
      throw ApiError.badRequest('Select an active investigator')
    }
    const caseNumber = await nextRef('INV', 4)
    const doc = await Investigation.create({
      caseNumber,
      incidentIds: req.body.incidentIds ?? [],
      studentId: student._id,
      title: req.body.title,
      type: req.body.type,
      assignedTo: req.body.assignedTo,
      createdBy: req.auth!.userId,
      deadline: req.body.deadline ? new Date(req.body.deadline) : new Date(Date.now() + 14 * 86_400_000),
      linkedSafeguardingCaseId: req.body.linkedSafeguardingCaseId,
      timeline: [{ at: new Date(), by: req.auth!.userId, type: 'case_opened', content: 'Investigation opened', visibility: 'case_team' }],
      history: [{ at: new Date(), by: req.auth!.userId, action: 'opened', note: req.body.title }],
    })
    if (req.body.assignedTo) {
      await notifyUsers([req.body.assignedTo], {
        type: 'investigation.assigned',
        title: 'Investigation assigned to you',
        message: `${caseNumber}: ${req.body.title}`,
        link: `/investigations/${doc._id}`,
      })
    }
    await writeAccessLog({ actor: req.auth!, resourceType: 'Investigation', resourceId: String(doc._id), action: 'created', req })
    await writeAudit({ req, actor: req.auth, action: 'investigation.opened', resourceType: 'Investigation', resourceId: String(doc._id), after: { caseNumber, title: doc.title } })
    created(res, doc)
  }),
)

router.get(
  '/investigations/:id',
  requirePermission('investigations.view'),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId currentBalance riskLevel')
      .populate('assignedTo', 'name position')
      .populate('createdBy', 'name position')
      .populate('incidentIds', 'incidentNumber offenceSnapshot severity occurredAt status')
      .populate('evidenceIds')
    if (!doc) throw ApiError.notFound('Investigation not found')
    assertInvestigationAccess(req.auth!, doc)
    const canSeeConfidential = req.auth!.roles.includes('HEADTEACHER') || req.auth!.permissions.has('investigations.evidence')
    if (!canSeeConfidential) {
      doc.timeline = doc.timeline.filter((t) => t.visibility === 'school') as typeof doc.timeline
      doc.witnesses = [] as typeof doc.witnesses
      doc.studentStatement = undefined
    }
    await writeAccessLog({ actor: req.auth!, resourceType: 'Investigation', resourceId: String(doc._id), action: 'viewed', req })
    ok(res, doc)
  }),
)

router.patch(
  '/investigations/:id',
  requirePermission('investigations.evidence'),
  validate({
    body: z.object({
      title: z.string().trim().min(5).max(200).optional(),
      type: z.enum(['misconduct', 'serious_incident', 'safeguarding_linked', 'other']).optional(),
      status: z.enum(['opened', 'investigating', 'findings', 'decision', 'closed', 'cancelled']).optional(),
      assignedTo: objectId.optional(),
      deadline: z.string().trim().optional(),
      findings: z.string().trim().max(10000).optional(),
      recommendations: z.string().trim().max(5000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Investigation not found')
    assertInvestigationAccess(req.auth!, doc)
    if (req.body.assignedTo !== undefined && !req.auth!.permissions.has('investigations.assign')) {
      throw ApiError.forbidden('Missing permission: investigations.assign')
    }
    if (req.body.status === 'closed' && !req.auth!.permissions.has('investigations.close')) {
      throw ApiError.forbidden('Missing permission: investigations.close')
    }
    const before = { status: doc.status, assignedTo: doc.assignedTo ? String(doc.assignedTo) : null }
    Object.assign(doc, req.body)
    if (req.body.deadline) doc.deadline = new Date(req.body.deadline)
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'updated', note: req.body.status ? `Status: ${req.body.status}` : 'Case updated' })
    await doc.save()
    if (req.body.assignedTo && String(req.body.assignedTo) !== before.assignedTo) {
      await notifyUsers([req.body.assignedTo], {
        type: 'investigation.assigned',
        title: 'Investigation assigned to you',
        message: `${doc.caseNumber}: ${doc.title}`,
        link: `/investigations/${doc._id}`,
      })
    }
    await writeAudit({ req, actor: req.auth, action: 'investigation.updated', resourceType: 'Investigation', resourceId: String(doc._id), before, after: req.body })
    ok(res, doc)
  }),
)

router.post(
  '/investigations/:id/timeline',
  requirePermission('investigations.evidence'),
  validate({
    body: z.object({
      type: z.string().trim().min(2).max(80),
      content: z.string().trim().min(2).max(5000),
      visibility: z.enum(['case_team', 'school', 'headteacher']).optional().default('case_team'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Investigation not found')
    assertInvestigationAccess(req.auth!, doc)
    if (doc.status === 'closed') throw ApiError.badRequest('A closed investigation cannot be edited')
    doc.timeline.push({ at: new Date(), by: req.auth!.userId, type: req.body.type, content: req.body.content, visibility: req.body.visibility })
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'timeline_entry', note: req.body.type })
    await doc.save()
    await writeAudit({ req, actor: req.auth, action: 'investigation.timeline_added', resourceType: 'Investigation', resourceId: String(doc._id), after: { type: req.body.type } })
    created(res, doc.timeline[doc.timeline.length - 1])
  }),
)

router.post(
  '/investigations/:id/witnesses',
  requirePermission('investigations.evidence'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      contact: z.string().trim().max(80).optional(),
      statement: z.string().trim().max(10000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Investigation not found')
    assertInvestigationAccess(req.auth!, doc)
    if (doc.status === 'closed') throw ApiError.badRequest('A closed investigation cannot be edited')
    doc.witnesses.push({ ...req.body, recordedAt: new Date(), recordedBy: req.auth!.userId })
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'witness_recorded', note: req.body.name })
    await doc.save()
    await writeAudit({ req, actor: req.auth, action: 'investigation.witness_recorded', resourceType: 'Investigation', resourceId: String(doc._id), after: { witness: req.body.name } })
    created(res, doc)
  }),
)

router.post(
  '/investigations/:id/student-statement',
  requirePermission('investigations.evidence'),
  validate({ body: z.object({ content: z.string().trim().min(5).max(15000) }) }),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Investigation not found')
    assertInvestigationAccess(req.auth!, doc)
    doc.studentStatement = { content: req.body.content, recordedAt: new Date(), recordedBy: req.auth!.userId }
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'student_statement_recorded' })
    await doc.save()
    await writeAudit({ req, actor: req.auth, action: 'investigation.student_statement_recorded', resourceType: 'Investigation', resourceId: String(doc._id) })
    ok(res, doc)
  }),
)

router.post(
  '/investigations/:id/findings',
  requirePermission('investigations.evidence'),
  validate({
    body: z.object({
      findings: z.string().trim().min(10).max(15000),
      recommendations: z.string().trim().max(5000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Investigation not found')
    assertInvestigationAccess(req.auth!, doc)
    doc.findings = req.body.findings
    if (req.body.recommendations !== undefined) doc.recommendations = req.body.recommendations
    doc.status = 'findings'
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'findings_recorded' })
    await doc.save()
    await writeAudit({ req, actor: req.auth, action: 'investigation.findings_recorded', resourceType: 'Investigation', resourceId: String(doc._id) })
    ok(res, doc)
  }),
)

router.post(
  '/investigations/:id/decision',
  requirePermission('investigations.decide'),
  validate({
    body: z.object({
      outcome: z.string().trim().min(3).max(2000),
      notes: z.string().trim().max(5000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Investigation not found')
    if (!doc.findings) throw ApiError.badRequest('Record the investigation findings before a decision')
    if (String(doc.assignedTo ?? '') === String(req.auth!.userId)) {
      throw ApiError.forbidden('The assigned investigator cannot approve the final decision')
    }
    doc.decision = { outcome: req.body.outcome, approvedBy: req.auth!.userId, decidedAt: new Date(), notes: req.body.notes }
    doc.status = 'decision'
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'decision_recorded', note: req.body.outcome })
    await doc.save()
    await notifyUsers([doc.createdBy, ...(doc.assignedTo ? [doc.assignedTo] : [])], {
      type: 'investigation.decided',
      title: 'Investigation decision recorded',
      message: `${doc.caseNumber}: ${req.body.outcome}`,
      link: `/investigations/${doc._id}`,
    })
    await writeAudit({ req, actor: req.auth, action: 'investigation.decision_recorded', resourceType: 'Investigation', resourceId: String(doc._id), after: { outcome: req.body.outcome } })
    ok(res, doc)
  }),
)

router.post(
  '/investigations/:id/close',
  requirePermission('investigations.close'),
  validate({ body: z.object({ note: z.string().trim().min(3).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Investigation not found')
    assertInvestigationAccess(req.auth!, doc)
    if (!doc.decision) throw ApiError.badRequest('A final decision is required before closing the investigation')
    doc.status = 'closed'
    doc.closedAt = new Date()
    doc.history.push({ at: new Date(), by: req.auth!.userId, action: 'closed', note: req.body.note })
    await doc.save()
    await writeAudit({ req, actor: req.auth, action: 'investigation.closed', resourceType: 'Investigation', resourceId: String(doc._id), reason: req.body.note })
    ok(res, doc)
  }),
)

router.post(
  '/investigations/:id/link-incidents',
  requirePermission('investigations.evidence'),
  validate({ body: z.object({ incidentIds: z.array(objectId).min(1) }) }),
  asyncHandler(async (req, res) => {
    const doc = await Investigation.findById(req.params.id)
    if (!doc) throw ApiError.notFound('Investigation not found')
    assertInvestigationAccess(req.auth!, doc)
    const incidents = await Incident.find({ _id: { $in: req.body.incidentIds }, studentId: doc.studentId })
    if (!incidents.length) throw ApiError.badRequest('No matching incidents for this student were found')
    doc.incidentIds = [...new Set([...doc.incidentIds.map(String), ...incidents.map((i) => String(i._id))])].map(
      (id) => new Types.ObjectId(id),
    )
    await doc.save()
    await Incident.updateMany({ _id: { $in: incidents.map((i) => i._id) } }, { $set: { investigationId: doc._id } })
    await writeAudit({ req, actor: req.auth, action: 'investigation.incidents_linked', resourceType: 'Investigation', resourceId: String(doc._id), after: { incidents: incidents.length } })
    ok(res, doc)
  }),
)

export default router
