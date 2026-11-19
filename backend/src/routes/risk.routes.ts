import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Incident, RiskAssessment } from '../models/discipline.js'
import { Student } from '../models/school.js'
import { FollowUp, Intervention, Recognition, RecognitionPlan, WatchlistEntry } from '../models/support.js'
import { User } from '../models/core.js'
import { assertStudentAccess, visibleStudentQuery } from '../services/rbac.service.js'
import { evaluateStudentRisk, riskLabel } from '../services/risk.service.js'
import { buildStudentIntelligence } from '../services/student-intelligence.service.js'
import { resolveTerm } from '../services/academic.service.js'
import { rewardStudent } from '../services/ledger.service.js'
import { writeAudit } from '../services/audit.service.js'
import { queueParentMessage } from '../services/communication.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

// ── Risk centre ────────────────────────────────────────────────────────────

router.get(
  '/risk/students',
  requirePermission('risk.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const categories = String(req.query.category ?? 'orange,red').split(',').filter(Boolean)
    const visibility = await visibleStudentQuery(req.auth!)
    const filter: Record<string, unknown> = { ...visibility, status: { $in: ['active', 'suspended'] }, riskLevel: { $in: categories } }
    if (req.query.classId) filter.classId = new Types.ObjectId(String(req.query.classId))
    if (req.query.q) filter.fullName = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const [total, students] = await Promise.all([
      Student.countDocuments(filter),
      Student.find(filter)
        .sort({ currentBalance: 1 })
        .skip(skip)
        .limit(pageSize)
        .populate('classId', 'name')
        .populate('dormitoryId', 'name')
        .lean(),
    ])
    ok(
      res,
      students.map((s) => ({ ...s, riskLabel: riskLabel(s.riskLevel) })),
      pagedMeta(total, page, pageSize),
    )
  }),
)

router.get(
  '/risk/students/:id',
  requirePermission('risk.view'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const term = await resolveTerm(req.query.termId as string | undefined)
    const [assessments, incidents, interventions, followUps, cls] = await Promise.all([
      RiskAssessment.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(30).lean(),
      Incident.find({ studentId: student._id, termId: term._id }).sort({ occurredAt: -1 }).limit(40).lean(),
      Intervention.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(20).lean(),
      FollowUp.find({ studentId: student._id }).sort({ dueDate: 1 }).limit(20).lean(),
      student.populate('classId', 'name'),
    ])
    ok(res, {
      student: { ...student.toJSON(), riskLabel: riskLabel(student.riskLevel) },
      term,
      currentCategory: student.riskLevel,
      assessments,
      incidents,
      interventions,
      followUps,
      class: cls.classId,
    })
  }),
)

router.get(
  '/risk/students/:id/insights',
  requirePermission('risk.view'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const term = await resolveTerm(req.query.termId as string | undefined)
    const insights = await buildStudentIntelligence(student._id, req.auth!, term._id)
    if (!insights) throw ApiError.notFound('Student not found')
    ok(res, insights)
  }),
)

router.post(
  '/risk/students/:id/recalculate',  requirePermission('risk.manage'),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.params.id)
    const result = await evaluateStudentRisk(
      student,
      'Manual recalculation',
      { userId: req.auth!.userId, name: req.auth!.name },
    )
    await writeAudit({
      req,
      actor: req.auth,
      action: 'risk.recalculated',
      resourceType: 'Student',
      resourceId: String(student._id),
      after: result,
    })
    ok(res, result)
  }),
)

router.get(
  '/risk/escalations',
  requirePermission('risk.escalate'),
  asyncHandler(async (req, res) => {
    const visibility = await visibleStudentQuery(req.auth!)
    const [students, pendingFollowUps] = await Promise.all([
      Student.find({ ...visibility, status: 'active', riskLevel: { $in: ['orange', 'red'] } })
        .sort({ currentBalance: 1 })
        .limit(100)
        .populate('classId', 'name')
        .populate('dormitoryId', 'name')
        .lean(),
      FollowUp.find({ status: { $in: ['pending', 'overdue'] }, dueDate: { $lte: new Date(Date.now() + 7 * 86_400_000) } })
        .sort({ dueDate: 1 })
        .limit(50)
        .populate('studentId', 'fullName studentId currentBalance riskLevel')
        .lean(),
    ])
    ok(res, {
      students: students.map((s) => ({ ...s, riskLabel: riskLabel(s.riskLevel) })),
      upcomingFollowUps: pendingFollowUps,
    })
  }),
)

// ── Interventions ──────────────────────────────────────────────────────────

router.get(
  '/interventions',
  requirePermission('interventions.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (!req.auth!.permissions.has('interventions.manage')) filter.assignedTo = req.auth!.userId
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    const [total, items] = await Promise.all([
      Intervention.countDocuments(filter),
      Intervention.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId currentBalance riskLevel classId')
        .populate('assignedTo', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/interventions',
  requirePermission('interventions.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      type: z.enum(['counselling', 'behaviour_plan', 'mentoring', 'family', 'watchlist']),
      title: z.string().trim().min(3).max(160),
      plan: z.string().trim().min(5).max(5000),
      goals: z.array(z.object({ description: z.string().trim().min(2).max(400), target: z.string().trim().max(200).optional(), progress: z.number().int().min(0).max(100).optional() })).optional(),
      assignedTo: objectId,
      startDate: z.string().trim().optional(),
      reviewDate: z.string().trim().optional(),
      termId: objectId.optional(),
      confidentialNotes: z.string().trim().max(5000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    if (!(await User.exists({ _id: req.body.assignedTo, status: 'active' }))) throw ApiError.badRequest('Select an active staff member')
    const term = await resolveTerm(req.body.termId)
    const intervention = await Intervention.create({
      ...req.body,
      studentId: student._id,
      termId: term._id,
      goals: req.body.goals ?? [],
      startDate: req.body.startDate ? new Date(req.body.startDate) : new Date(),
      reviewDate: req.body.reviewDate ? new Date(req.body.reviewDate) : undefined,
      createdBy: req.auth!.userId,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'intervention.created',
      resourceType: 'Intervention',
      resourceId: String(intervention._id),
      after: { studentId: String(student._id), type: intervention.type },
    })
    created(res, intervention)
  }),
)

router.patch(
  '/interventions/:id',
  requirePermission('interventions.manage'),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(160).optional(),
      plan: z.string().trim().min(5).max(5000).optional(),
      goals: z.array(z.object({ description: z.string().trim().min(2).max(400), target: z.string().trim().max(200).optional(), progress: z.number().int().min(0).max(100) })).optional(),
      assignedTo: objectId.optional(),
      status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
      reviewDate: z.string().trim().optional(),
      outcome: z.string().trim().max(2000).optional(),
      confidentialNotes: z.string().trim().max(5000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) throw ApiError.notFound('Intervention not found')
    await assertStudentAccess(req.auth!, intervention.studentId)
    if (req.body.reviewDate) req.body.reviewDate = new Date(req.body.reviewDate) as unknown as string
    Object.assign(intervention, req.body)
    await intervention.save()
    await writeAudit({ req, actor: req.auth, action: 'intervention.updated', resourceType: 'Intervention', resourceId: String(intervention._id), after: req.body })
    ok(res, intervention)
  }),
)

// ── Follow-ups ─────────────────────────────────────────────────────────────

router.get(
  '/followups',
  requirePermission('followups.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (!req.auth!.permissions.has('followups.manage') || req.query.mine === 'true') filter.assignedTo = req.auth!.userId
    if (req.query.status) filter.status = req.query.status
    if (req.query.type) filter.type = req.query.type
    if (req.query.studentId) filter.studentId = req.query.studentId
    const [total, items] = await Promise.all([
      FollowUp.countDocuments(filter),
      FollowUp.find(filter)
        .sort({ dueDate: 1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId currentBalance riskLevel')
        .populate('assignedTo', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/followups',
  requirePermission('followups.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      interventionId: objectId.optional(),
      type: z.enum(['counselling', 'parent_meeting', 'behaviour_check', 'academic', 'other']).optional().default('behaviour_check'),
      dueDate: z.string().trim().min(4),
      assignedTo: objectId,
      notes: z.string().trim().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    if (!(await User.exists({ _id: req.body.assignedTo, status: 'active' }))) throw ApiError.badRequest('Select an active staff member')
    const followUp = await FollowUp.create({ ...req.body, studentId: student._id, dueDate: new Date(req.body.dueDate), createdBy: req.auth!.userId })
    await writeAudit({ req, actor: req.auth, action: 'followup.created', resourceType: 'FollowUp', resourceId: String(followUp._id), after: { studentId: String(student._id) } })
    created(res, followUp)
  }),
)

router.patch(
  '/followups/:id',
  requirePermission('followups.manage'),
  validate({
    body: z.object({
      dueDate: z.string().trim().optional(),
      assignedTo: objectId.optional(),
      notes: z.string().trim().max(2000).optional(),
      status: z.enum(['pending', 'completed', 'overdue', 'cancelled']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const followUp = await FollowUp.findById(req.params.id)
    if (!followUp) throw ApiError.notFound('Follow-up not found')
    await assertStudentAccess(req.auth!, followUp.studentId)
    if (req.body.dueDate) req.body.dueDate = new Date(req.body.dueDate) as unknown as string
    Object.assign(followUp, req.body)
    if (req.body.status === 'completed') {
      followUp.completedAt = new Date()
      followUp.completedBy = req.auth!.userId
    }
    await followUp.save()
    await writeAudit({ req, actor: req.auth, action: 'followup.updated', resourceType: 'FollowUp', resourceId: String(followUp._id), after: req.body })
    ok(res, followUp)
  }),
)

router.post(
  '/followups/:id/complete',
  requirePermission('followups.manage'),
  validate({ body: z.object({ notes: z.string().trim().max(2000).optional() }) }),
  asyncHandler(async (req, res) => {
    const followUp = await FollowUp.findById(req.params.id)
    if (!followUp) throw ApiError.notFound('Follow-up not found')
    await assertStudentAccess(req.auth!, followUp.studentId)
    followUp.status = 'completed'
    followUp.completedAt = new Date()
    followUp.completedBy = req.auth!.userId
    if (req.body.notes) followUp.notes = [followUp.notes, req.body.notes].filter(Boolean).join('\n')
    await followUp.save()
    await writeAudit({ req, actor: req.auth, action: 'followup.completed', resourceType: 'FollowUp', resourceId: String(followUp._id) })
    ok(res, followUp)
  }),
)

// ── Recognition ────────────────────────────────────────────────────────────

router.get(
  '/recognition',
  requirePermission('recognition.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const visibility = await visibleStudentQuery(req.auth!)
    const studentIds = (await Student.find(visibility).select('_id').lean()).map((s) => s._id)
    const filter: Record<string, unknown> = { studentId: { $in: studentIds } }
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.type) filter.type = req.query.type
    const [total, items] = await Promise.all([
      Recognition.countDocuments(filter),
      Recognition.find(filter)
        .sort({ awardedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId classId')
        .populate('awardedBy', 'name')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/recognition',
  requirePermission('recognition.create'),
  validate({
    body: z.object({
      studentId: objectId,
      type: z.enum(['positive_behaviour', 'achievement', 'reward']).default('positive_behaviour'),
      category: z.string().trim().max(80).optional(),
      title: z.string().trim().min(3).max(160),
      description: z.string().trim().max(2000).optional(),
      points: z.number().int().min(0).max(20).optional().default(0),
      applyMarks: z.boolean().optional().default(false),
      notifyGuardian: z.boolean().optional().default(false),
      termId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const term = await resolveTerm(req.body.termId)
    let ledger = null
    if (req.body.applyMarks && req.body.points > 0) {
      if (!req.auth!.permissions.has('marks.reward')) throw ApiError.forbidden('Missing permission to apply conduct marks')
      ledger = await rewardStudent({
        studentId: String(student._id),
        points: req.body.points,
        reason: req.body.title,
        termId: String(term._id),
        academicYearId: String(term.academicYearId),
        actor: { userId: req.auth!.userId, name: req.auth!.name, roles: req.auth!.roles },
      })
    }
    const recognition = await Recognition.create({
      studentId: student._id,
      type: req.body.type,
      category: req.body.category ?? 'Positive conduct',
      title: req.body.title,
      description: req.body.description ?? '',
      points: req.body.points,
      awardedBy: req.auth!.userId,
      termId: term._id,
    })
    let guardianMessage = null
    if (req.body.notifyGuardian) {
      guardianMessage = await queueParentMessage({
        studentId: student._id,
        templateKey: 'positive_behaviour_recognition',
        dedupeSuffix: `recognition:${recognition._id}`,
        extraVars: {
          achievement: recognition.title,
          date: recognition.awardedAt.toLocaleDateString('en-GB'),
        },
      })
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'recognition.awarded',
      resourceType: 'Recognition',
      resourceId: String(recognition._id),
      after: { studentId: String(student._id), points: req.body.points, applyMarks: req.body.applyMarks, notifyGuardian: req.body.notifyGuardian },
    })
    created(res, { recognition, ledger, guardianMessage })
  }),
)

router.get(
  '/recognition/plans',
  requirePermission('recognition.view'),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {}
    if (req.query.status) filter.status = req.query.status
    if (req.query.studentId) filter.studentId = req.query.studentId
    ok(res, await RecognitionPlan.find(filter).sort({ createdAt: -1 }).populate('studentId', 'fullName studentId').populate('supportStaffId', 'name').lean())
  }),
)

router.post(
  '/recognition/plans',
  requirePermission('recognition.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      title: z.string().trim().min(3).max(160),
      reason: z.string().trim().min(5).max(2000),
      goals: z.array(z.object({ description: z.string().trim().min(2).max(400), actions: z.string().trim().max(600).optional(), targetDate: z.string().trim().optional() })).optional(),
      supportStaffId: objectId,
      nextReviewDate: z.string().trim().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const plan = await RecognitionPlan.create({
      studentId: student._id,
      title: req.body.title,
      reason: req.body.reason,
      goals: (req.body.goals ?? []).map((g: { title: string; description?: string; targetDate?: string }) => ({ ...g, targetDate: g.targetDate ? new Date(g.targetDate) : undefined, progress: 0, status: 'active' })),
      supportStaffId: req.body.supportStaffId,
      nextReviewDate: req.body.nextReviewDate ? new Date(req.body.nextReviewDate) : undefined,
      createdBy: req.auth!.userId,
    })
    await writeAudit({ req, actor: req.auth, action: 'recognition_plan.created', resourceType: 'RecognitionPlan', resourceId: String(plan._id) })
    created(res, plan)
  }),
)

// ── Watchlist ──────────────────────────────────────────────────────────────

router.get(
  '/watchlist',
  requirePermission('blacklist.view'),
  asyncHandler(async (_req, res) => {
    const entries = await WatchlistEntry.find({ active: true }).sort({ createdAt: -1 }).populate('studentId', 'fullName studentId currentBalance riskLevel').lean()
    ok(res, entries)
  }),
)

router.post(
  '/watchlist',
  requirePermission('blacklist.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      level: z.enum(['watch', 'blacklist']).optional().default('watch'),
      reason: z.string().trim().min(5).max(2000),
      expiresAt: z.string().trim().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const entry = await WatchlistEntry.create({
      studentId: student._id,
      level: req.body.level,
      reason: req.body.reason,
      addedBy: req.auth!.userId,
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
    })
    await writeAudit({ req, actor: req.auth, action: 'watchlist.added', resourceType: 'WatchlistEntry', resourceId: String(entry._id), reason: req.body.reason })
    created(res, entry)
  }),
)

router.post(
  '/watchlist/:id/remove',
  requirePermission('blacklist.manage'),
  validate({ body: z.object({ reason: z.string().trim().max(500).optional() }) }),
  asyncHandler(async (req, res) => {
    const entry = await WatchlistEntry.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { new: true })
    if (!entry) throw ApiError.notFound('Watchlist entry not found')
    await writeAudit({ req, actor: req.auth, action: 'watchlist.removed', resourceType: 'WatchlistEntry', resourceId: String(entry._id), reason: req.body.reason })
    ok(res, entry)
  }),
)

export default router
