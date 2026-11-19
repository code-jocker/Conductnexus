import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { AcademicYear, ClassModel, Dormitory, Stream, Student, Term } from '../models/school.js'
import { DisciplineLedger, Incident, Approval } from '../models/discipline.js'
import { allocateTermForAllStudents, reconcileLedger } from '../services/ledger.service.js'
import { writeAudit } from '../services/audit.service.js'
import { getActiveTerm } from '../services/academic.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

const dateField = z.string().trim().min(4)

router.get(
  '/structure/options',
  asyncHandler(async (req, res) => {
    const [years, terms, classes, streams, dormitories] = await Promise.all([
      AcademicYear.find().sort({ startDate: -1 }).lean(),
      Term.find().sort({ startDate: -1 }).lean(),
      ClassModel.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
      Stream.find({ active: true }).sort({ name: 1 }).lean(),
      Dormitory.find({ active: true }).sort({ name: 1 }).lean(),
    ])
    ok(res, { years, terms, classes, streams, dormitories, activeTerm: await getActiveTerm() })
  }),
)

// ── Academic years ─────────────────────────────────────────────────────────

router.get(
  '/academic-years',
  asyncHandler(async (_req, res) => {
    const years = await AcademicYear.find().sort({ startDate: -1 }).lean()
    const terms = await Term.find().sort({ number: 1 }).lean()
    ok(
      res,
      years.map((y) => ({ ...y, id: String(y._id), terms: terms.filter((t) => String(t.academicYearId) === String(y._id)) })),
    )
  }),
)

router.post(
  '/academic-years',
  requirePermission('academic_years.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(4).max(40),
      startDate: dateField,
      endDate: dateField,
      terms: z
        .array(
          z.object({
            name: z.string().trim().min(2).max(60),
            number: z.number().int().min(1).max(4),
            startDate: dateField,
            endDate: dateField,
            startingMarks: z.number().int().min(0).max(100).optional(),
          }),
        )
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const start = new Date(req.body.startDate)
    const end = new Date(req.body.endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw ApiError.badRequest('The academic year end date must be after the start date')
    }
    if (await AcademicYear.exists({ name: req.body.name })) throw ApiError.conflict('An academic year with this name already exists')
    const year = await AcademicYear.create({ name: req.body.name, startDate: start, endDate: end })
    if (req.body.terms?.length) {
      await Term.insertMany(
        req.body.terms.map((t: { name: string; number: number; startDate: string; endDate: string; startingMarks?: number }) => ({
          academicYearId: year._id,
          name: t.name,
          number: t.number,
          startDate: new Date(t.startDate),
          endDate: new Date(t.endDate),
          startingMarks: t.startingMarks ?? 40,
        })),
      )
    }
    await writeAudit({ req, actor: req.auth, action: 'academic_year.created', resourceType: 'AcademicYear', resourceId: String(year._id), after: req.body })
    created(res, year)
  }),
)

router.patch(
  '/academic-years/:id',
  requirePermission('academic_years.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(4).max(40).optional(),
      startDate: dateField.optional(),
      endDate: dateField.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const year = await AcademicYear.findById(req.params.id)
    if (!year) throw ApiError.notFound('Academic year not found')
    if (req.body.name !== undefined) year.name = req.body.name
    if (req.body.startDate) year.startDate = new Date(req.body.startDate)
    if (req.body.endDate) year.endDate = new Date(req.body.endDate)
    await year.save()
    await writeAudit({ req, actor: req.auth, action: 'academic_year.updated', resourceType: 'AcademicYear', resourceId: String(year._id), after: req.body })
    ok(res, year)
  }),
)

router.post(
  '/academic-years/:id/activate',
  requirePermission('academic_years.manage'),
  asyncHandler(async (req, res) => {
    const year = await AcademicYear.findById(req.params.id)
    if (!year) throw ApiError.notFound('Academic year not found')
    if (year.status === 'closed') throw ApiError.badRequest('A closed academic year cannot be reactivated. Create a new year instead.')
    await AcademicYear.updateMany({ _id: { $ne: year._id } }, { $set: { isActive: false, status: 'planned' } })
    year.isActive = true
    year.status = 'active'
    await year.save()
    await writeAudit({ req, actor: req.auth, action: 'academic_year.activated', resourceType: 'AcademicYear', resourceId: String(year._id) })
    ok(res, year)
  }),
)

// ── Terms ──────────────────────────────────────────────────────────────────

router.get(
  '/terms',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {}
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId
    const terms = await Term.find(filter).sort({ startDate: 1 }).lean()
    ok(res, terms)
  }),
)

router.post(
  '/terms',
  requirePermission('terms.manage'),
  validate({
    body: z.object({
      academicYearId: objectId,
      name: z.string().trim().min(2).max(60),
      number: z.number().int().min(1).max(4),
      startDate: dateField,
      endDate: dateField,
      startingMarks: z.number().int().min(0).max(100).optional().default(40),
    }),
  }),
  asyncHandler(async (req, res) => {
    const start = new Date(req.body.startDate)
    const end = new Date(req.body.endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw ApiError.badRequest('The term end date must be after the start date')
    }
    if (!(await AcademicYear.exists({ _id: req.body.academicYearId }))) throw ApiError.notFound('Academic year not found')
    if (await Term.exists({ academicYearId: req.body.academicYearId, number: req.body.number })) {
      throw ApiError.conflict('This academic year already has a term with that number')
    }
    const term = await Term.create({ ...req.body, startDate: start, endDate: end })
    await writeAudit({ req, actor: req.auth, action: 'term.created', resourceType: 'Term', resourceId: String(term._id), after: req.body })
    created(res, term)
  }),
)

router.patch(
  '/terms/:id',
  requirePermission('terms.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(60).optional(),
      startDate: dateField.optional(),
      endDate: dateField.optional(),
      startingMarks: z.number().int().min(0).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const term = await Term.findById(req.params.id)
    if (!term) throw ApiError.notFound('Term not found')
    if (term.closedAt) throw ApiError.badRequest('A closed term cannot be edited')
    if (req.body.name !== undefined) term.name = req.body.name
    if (req.body.startDate) term.startDate = new Date(req.body.startDate)
    if (req.body.endDate) term.endDate = new Date(req.body.endDate)
    if (req.body.startingMarks !== undefined) term.startingMarks = req.body.startingMarks
    await term.save()
    await writeAudit({ req, actor: req.auth, action: 'term.updated', resourceType: 'Term', resourceId: String(term._id), after: req.body })
    ok(res, term)
  }),
)

router.post(
  '/terms/:id/activate',
  requirePermission('terms.manage'),
  asyncHandler(async (req, res) => {
    const term = await Term.findById(req.params.id)
    if (!term) throw ApiError.notFound('Term not found')
    if (term.closedAt) throw ApiError.badRequest('A closed term cannot be reactivated. Create the next term instead.')
    const year = await AcademicYear.findById(term.academicYearId)
    if (!year) throw ApiError.notFound('Academic year not found')

    await Term.updateMany({ _id: { $ne: term._id } }, { $set: { isActive: false } })
    await AcademicYear.updateMany({ _id: { $ne: year._id } }, { $set: { isActive: false, status: 'planned' } })
    term.isActive = true
    await term.save()
    year.isActive = true
    year.status = 'active'
    await year.save()

    await Student.updateMany(
      { status: { $in: ['active', 'suspended'] } },
      { $set: { academicYearId: year._id, termId: term._id, currentTermId: term._id } },
    )
    const allocated = await allocateTermForAllStudents(
      { _id: term._id, startingMarks: term.startingMarks, academicYearId: term.academicYearId },
      { userId: req.auth!.userId, name: req.auth!.name, roles: req.auth!.roles },
    )
    await writeAudit({
      req,
      actor: req.auth,
      action: 'term.activated',
      resourceType: 'Term',
      resourceId: String(term._id),
      after: { startingMarks: term.startingMarks, allocationsCreated: allocated },
    })
    ok(res, { term, allocatedStudents: allocated })
  }),
)

router.post(
  '/terms/:id/close',
  requirePermission('terms.manage'),
  asyncHandler(async (req, res) => {
    const term = await Term.findById(req.params.id)
    if (!term) throw ApiError.notFound('Term not found')
    if (term.closedAt) throw ApiError.badRequest('This term is already closed')
    const students = await Student.find({ status: { $in: ['active', 'suspended'] } }).select('_id currentBalance riskLevel').lean()
    const studentIds = students.map((s) => s._id)
    const [incidentRows, ledgerRows] = await Promise.all([
      Incident.aggregate([
        { $match: { termId: term._id } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
      DisciplineLedger.aggregate([
        { $match: { termId: term._id } },
        { $group: { _id: '$type', total: { $sum: '$change' }, count: { $sum: 1 } } },
      ]),
    ])
    const averageBalance = students.length
      ? Math.round((students.reduce((s, x) => s + x.currentBalance, 0) / students.length) * 10) / 10
      : 0
    term.closedSummary = {
      closedBy: req.auth!.name,
      students: students.length,
      averageBalance,
      highRisk: students.filter((s) => ['orange', 'red'].includes(s.riskLevel)).length,
      incidentsBySeverity: Object.fromEntries(incidentRows.map((r) => [r._id, r.count])),
      ledgerByType: Object.fromEntries(ledgerRows.map((r) => [r._id, { totalMarks: r.total, entries: r.count }])),
      studentIdsSample: studentIds.slice(0, 20).map(String),
    }
    term.closedAt = new Date()
    term.isActive = false
    await term.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'term.closed',
      resourceType: 'Term',
      resourceId: String(term._id),
      after: { averageBalance, students: students.length },
    })
    ok(res, term)
  }),
)

// ── Term transition centre ─────────────────────────────────────────────────

router.get(
  '/terms/:id/transition-preview',
  requirePermission('terms.manage'),
  asyncHandler(async (req, res) => {
    const term = await Term.findById(req.params.id).lean()
    if (!term) throw ApiError.notFound('Term not found')
    const [activeStudents, allocated, pendingIncidents, pendingApprovals, reconciliation, nextTerm] = await Promise.all([
      Student.countDocuments({ status: 'active' }),
      DisciplineLedger.countDocuments({ termId: term._id, type: 'initial_allocation' }),
      Incident.countDocuments({ termId: term._id, status: { $in: ['draft', 'submitted', 'under_review', 'escalated'] } }),
      Approval.countDocuments({ status: 'pending' }),
      reconcileLedger(String(term._id)),
      Term.findOne({ academicYearId: term.academicYearId, number: term.number + 1 }).lean(),
    ])
    ok(res, {
      term: { id: String(term._id), name: term.name, number: term.number, isActive: term.isActive, closedAt: term.closedAt ?? null, startingMarks: term.startingMarks },
      nextTerm: nextTerm ? { id: String(nextTerm._id), name: nextTerm.name, number: nextTerm.number } : null,
      students: { active: activeStudents, allocated, missingAllocation: Math.max(0, activeStudents - allocated) },
      pendingIncidents,
      pendingApprovals,
      reconciliation: {
        healthy: reconciliation.healthy,
        transactionsChecked: reconciliation.transactionsChecked,
        issues: reconciliation.issues.length,
        issueDetails: reconciliation.issues.slice(0, 20),
      },
      blockers: [
        ...(reconciliation.issues.length ? [`${reconciliation.issues.length} ledger reconciliation issue(s) need review.`] : []),
        ...(pendingIncidents ? [`${pendingIncidents} incident(s) are still open in this term.`] : []),
        ...(pendingApprovals ? [`${pendingApprovals} approval(s) are still pending across the school.`] : []),
      ],
    })
  }),
)

const openNextTermSchema = z.object({
  name: z.string().trim().min(2).max(60),
  startDate: dateField,
  endDate: dateField,
  startingMarks: z.number().int().min(0).max(100).optional().default(40),
  academicYearId: objectId.optional(),
  closePrevious: z.boolean().optional().default(true),
  allocate: z.boolean().optional().default(true),
  confirmIssues: z.boolean().optional().default(false),
})

router.post(
  '/terms/:id/open-next',
  requirePermission('terms.manage'),
  validate({ body: openNextTermSchema }),
  asyncHandler(async (req, res) => {
    const term = await Term.findById(req.params.id)
    if (!term) throw ApiError.notFound('Term not found')
    if (term.closedAt) throw ApiError.badRequest('This term is already closed. Open the next term from the active term.')
    if (!term.isActive) throw ApiError.badRequest('Only the active term can be closed and rolled forward.')

    const start = new Date(req.body.startDate)
    const end = new Date(req.body.endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw ApiError.badRequest('The new term end date must be after its start date')
    }

    const academicYearId = req.body.academicYearId ?? String(term.academicYearId)
    const year = await AcademicYear.findById(academicYearId)
    if (!year) throw ApiError.notFound('Academic year not found')
    const nextNumber = academicYearId === String(term.academicYearId) ? term.number + 1 : 1
    if (nextNumber > 4) throw ApiError.badRequest('This academic year already has four terms. Create the next academic year first.')
    if (await Term.exists({ academicYearId, number: nextNumber })) {
      throw ApiError.conflict('The next term number already exists in that academic year')
    }

    const reconciliation = await reconcileLedger(String(term._id))
    if (!reconciliation.healthy && !req.body.confirmIssues) {
      throw ApiError.conflict(
        `This term has ${reconciliation.issues.length} ledger reconciliation issue(s). Review them, then confirm the transition explicitly.`,
      )
    }

    const nextTerm = await Term.create({
      academicYearId,
      name: req.body.name,
      number: nextNumber,
      startDate: start,
      endDate: end,
      startingMarks: req.body.startingMarks,
      isActive: false,
    })

    if (req.body.closePrevious) {
      term.closedSummary = {
        closedBy: req.auth!.name,
        reason: `Rolled forward to ${nextTerm.name}`,
        ledgerTransactions: reconciliation.transactionsChecked,
        reconciliationIssues: reconciliation.issues.length,
      }
      term.closedAt = new Date()
      term.isActive = false
      await term.save()
    }

    await Term.updateMany({ _id: { $ne: nextTerm._id } }, { $set: { isActive: false } })
    await AcademicYear.updateMany({ _id: { $ne: year._id } }, { $set: { isActive: false, status: 'planned' } })
    nextTerm.isActive = true
    await nextTerm.save()
    year.isActive = true
    year.status = 'active'
    await year.save()

    await Student.updateMany(
      { status: { $in: ['active', 'suspended'] } },
      { $set: { academicYearId: year._id, termId: nextTerm._id, currentTermId: nextTerm._id } },
    )
    const allocated = req.body.allocate
      ? await allocateTermForAllStudents(
          { _id: nextTerm._id, startingMarks: nextTerm.startingMarks, academicYearId: nextTerm.academicYearId },
          { userId: req.auth!.userId, name: req.auth!.name, roles: req.auth!.roles },
        )
      : 0

    await writeAudit({
      req,
      actor: req.auth,
      action: 'term.rolled_forward',
      resourceType: 'Term',
      resourceId: String(nextTerm._id),
      after: {
        previousTerm: String(term._id),
        closedPrevious: req.body.closePrevious,
        startingMarks: nextTerm.startingMarks,
        allocatedStudents: allocated,
        reconciliationIssues: reconciliation.issues.length,
      },
    })
    created(res, {
      term: nextTerm,
      allocatedStudents: allocated,
      previousTermClosed: req.body.closePrevious,
      reconciliationIssues: reconciliation.issues.length,
    })
  }),
)

// ── Classes, streams, dormitories ──────────────────────────────────────────

router.get('/classes', asyncHandler(async (_req, res) => {
  const classes = await ClassModel.find().sort({ order: 1, name: 1 }).populate('streamId', 'name code').lean()
  const counts = await Student.aggregate([{ $match: { status: 'active' } }, { $group: { _id: '$classId', count: { $sum: 1 } } }])
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]))
  ok(res, classes.map((c) => ({ ...c, id: String(c._id), studentCount: countMap.get(String(c._id)) ?? 0 })))
}))

router.post(
  '/classes',
  requirePermission('classes.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(40),
      level: z.enum(['O', 'A']),
      streamId: objectId.optional().nullable(),
      order: z.number().int().min(0).optional().default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (req.body.streamId) {
      const stream = await Stream.findById(req.body.streamId)
      if (!stream) throw ApiError.badRequest('Selected stream does not exist')
      if (stream.level !== req.body.level) throw ApiError.badRequest('A class level must match its stream level')
    }
    if (await ClassModel.exists({ name: req.body.name })) throw ApiError.conflict('A class with this name already exists')
    const cls = await ClassModel.create(req.body)
    await writeAudit({ req, actor: req.auth, action: 'class.created', resourceType: 'Class', resourceId: String(cls._id), after: req.body })
    created(res, cls)
  }),
)

router.patch(
  '/classes/:id',
  requirePermission('classes.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(40).optional(),
      level: z.enum(['O', 'A']).optional(),
      streamId: objectId.optional().nullable(),
      order: z.number().int().min(0).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const cls = await ClassModel.findById(req.params.id)
    if (!cls) throw ApiError.notFound('Class not found')
    const level = req.body.level ?? cls.level
    if (req.body.streamId) {
      const stream = await Stream.findById(req.body.streamId)
      if (!stream) throw ApiError.badRequest('Selected stream does not exist')
      if (stream.level !== level) throw ApiError.badRequest('A class level must match its stream level')
    }
    Object.assign(cls, req.body)
    await cls.save()
    await writeAudit({ req, actor: req.auth, action: 'class.updated', resourceType: 'Class', resourceId: String(cls._id), after: req.body })
    ok(res, cls)
  }),
)

router.get('/streams', asyncHandler(async (_req, res) => {
  ok(res, await Stream.find().sort({ name: 1 }).lean())
}))

router.post(
  '/streams',
  requirePermission('classes.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(80),
      code: z.string().trim().min(2).max(12),
      level: z.enum(['O', 'A']).default('A'),
      description: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (await Stream.exists({ $or: [{ name: req.body.name }, { code: req.body.code.toUpperCase() }] })) {
      throw ApiError.conflict('A stream with this name or code already exists')
    }
    const stream = await Stream.create({ ...req.body, code: req.body.code.toUpperCase() })
    await writeAudit({ req, actor: req.auth, action: 'stream.created', resourceType: 'Stream', resourceId: String(stream._id), after: req.body })
    created(res, stream)
  }),
)

router.patch(
  '/streams/:id',
  requirePermission('classes.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(80).optional(),
      code: z.string().trim().min(2).max(12).optional(),
      level: z.enum(['O', 'A']).optional(),
      description: z.string().trim().max(300).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const stream = await Stream.findById(req.params.id)
    if (!stream) throw ApiError.notFound('Stream not found')
    if (req.body.code) req.body.code = req.body.code.toUpperCase()
    Object.assign(stream, req.body)
    await stream.save()
    await writeAudit({ req, actor: req.auth, action: 'stream.updated', resourceType: 'Stream', resourceId: String(stream._id), after: req.body })
    ok(res, stream)
  }),
)

router.get('/dormitories', asyncHandler(async (_req, res) => {
  const dorms = await Dormitory.find().sort({ name: 1 }).lean()
  const counts = await Student.aggregate([{ $match: { status: 'active' } }, { $group: { _id: '$dormitoryId', count: { $sum: 1 } } }])
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]))
  ok(res, dorms.map((d) => ({ ...d, id: String(d._id), occupants: countMap.get(String(d._id)) ?? 0 })))
}))

router.post(
  '/dormitories',
  requirePermission('dormitories.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(80),
      code: z.string().trim().min(1).max(12),
      gender: z.enum(['male', 'female', 'mixed']).default('mixed'),
      capacity: z.number().int().min(0).max(1000).optional().default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (await Dormitory.exists({ $or: [{ name: req.body.name }, { code: req.body.code.toUpperCase() }] })) {
      throw ApiError.conflict('A dormitory with this name or code already exists')
    }
    const dorm = await Dormitory.create({ ...req.body, code: req.body.code.toUpperCase() })
    await writeAudit({ req, actor: req.auth, action: 'dormitory.created', resourceType: 'Dormitory', resourceId: String(dorm._id), after: req.body })
    created(res, dorm)
  }),
)

router.patch(
  '/dormitories/:id',
  requirePermission('dormitories.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(80).optional(),
      gender: z.enum(['male', 'female', 'mixed']).optional(),
      capacity: z.number().int().min(0).max(1000).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const dorm = await Dormitory.findById(req.params.id)
    if (!dorm) throw ApiError.notFound('Dormitory not found')
    Object.assign(dorm, req.body)
    await dorm.save()
    await writeAudit({ req, actor: req.auth, action: 'dormitory.updated', resourceType: 'Dormitory', resourceId: String(dorm._id), after: req.body })
    ok(res, dorm)
  }),
)

export default router
