import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, queryOf, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { ClassModel, Student } from '../models/school.js'
import { PromotionBatch } from '../models/promotion.js'
import { AcademicYear, Term } from '../models/school.js'
import { nextRef } from '../shared/refs.js'
import { writeAudit } from '../services/audit.service.js'
import { notifyPermission, notifyUsers } from '../services/notification.service.js'
import { hasRole, type AuthContext } from '../services/rbac.service.js'
import { objectId, paginationQuery, searchRegex } from './helpers.js'

const router = Router()
router.use(authenticate)

const promotionQuery = paginationQuery.extend({
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'executing', 'completed', 'failed', 'cancelled']).optional(),
  fromClassId: objectId.optional(),
  toClassId: objectId.optional(),
})

const createBatchSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    fromClassId: objectId,
    toClassId: objectId.optional().nullable(),
    graduate: z.boolean().optional().default(false),
    studentIds: z.array(objectId).max(1000).optional(),
    fromAcademicYearId: objectId.optional().nullable(),
    toAcademicYearId: objectId.optional().nullable(),
    toTermId: objectId.optional().nullable(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.graduate || Boolean(v.toClassId), {
    message: 'Select a destination class or mark this batch as graduation',
    path: ['toClassId'],
  })

async function buildItems(fromClassId: string, studentIds?: string[]) {
  const filter: Record<string, unknown> = { classId: new Types.ObjectId(fromClassId), status: 'active' }
  if (studentIds?.length) filter._id = { $in: studentIds.map((id) => new Types.ObjectId(id)) }
  const students = await Student.find(filter).sort({ lastName: 1, firstName: 1 })
  if (!students.length) throw ApiError.badRequest('No active students were found for the selected source class')
  return students.map((s) => ({
    studentId: s._id,
    studentSnapshot: { fullName: s.fullName, studentId: s.studentId, admissionNumber: s.admissionNumber },
    fromClassId: s.classId,
    fromStreamId: s.streamId ?? null,
    toClassId: null,
    toStreamId: null,
    status: 'pending' as const,
  }))
}

function assertApprovePermission(ctx: AuthContext) {
  if (!ctx.permissions.has('students.promote.approve')) {
    throw ApiError.forbidden('Missing permission: students.promote.approve')
  }
}

router.get(
  '/promotions',
  requirePermission('students.view'),
  validate({ query: promotionQuery }),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const q = queryOf<z.infer<typeof promotionQuery>>(req)
    const filter: Record<string, unknown> = {}
    if (q.status) filter.status = q.status
    if (q.fromClassId) filter.fromClassId = new Types.ObjectId(q.fromClassId)
    if (q.toClassId) filter.toClassId = new Types.ObjectId(q.toClassId)
    if (q.q) {
      const rx = searchRegex(q.q)
      filter.$or = [{ title: rx }, { batchNumber: rx }]
    }
    const [total, batches] = await Promise.all([
      PromotionBatch.countDocuments(filter),
      PromotionBatch.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select('-items')
        .populate('fromClassId', 'name level')
        .populate('toClassId', 'name level')
        .populate('createdBy', 'name')
        .lean(),
    ])
    ok(res, batches.map((b) => ({ ...b, id: String(b._id) })), pagedMeta(total, page, pageSize))
  }),
)

router.get(
  '/promotions/:id',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const batch = await PromotionBatch.findById(req.params.id)
      .populate('fromClassId', 'name level')
      .populate('toClassId', 'name level')
      .populate('createdBy', 'name position')
      .populate('submittedBy', 'name')
      .populate('reviewedBy', 'name')
      .populate('executedBy', 'name')
      .lean()
    if (!batch) throw ApiError.notFound('Promotion batch not found')
    ok(res, { ...batch, id: String(batch._id) })
  }),
)

router.post(
  '/promotions',
  requirePermission('students.promote'),
  validate({ body: createBatchSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBatchSchema>
    const source = await ClassModel.findById(body.fromClassId)
    if (!source || !source.active) throw ApiError.badRequest('Select an active source class')
    let toClass = null
    if (!body.graduate) {
      toClass = await ClassModel.findById(body.toClassId!)
      if (!toClass || !toClass.active) throw ApiError.badRequest('Select an active destination class')
      if (String(toClass._id) === String(source._id)) throw ApiError.badRequest('The destination class must differ from the source class')
    }
    if (body.fromAcademicYearId && !(await AcademicYear.exists({ _id: body.fromAcademicYearId }))) {
      throw ApiError.badRequest('Source academic year not found')
    }
    if (body.toAcademicYearId && !(await AcademicYear.exists({ _id: body.toAcademicYearId }))) {
      throw ApiError.badRequest('Destination academic year not found')
    }
    if (body.toTermId && !(await Term.exists({ _id: body.toTermId }))) {
      throw ApiError.badRequest('Destination term not found')
    }
    const items = await buildItems(body.fromClassId, body.studentIds)
    const batchNumber = await nextRef('PRM', 4)
    const batch = await PromotionBatch.create({
      batchNumber,
      title: body.title,
      fromClassId: source._id,
      toClassId: toClass?._id ?? null,
      graduate: Boolean(body.graduate),
      fromAcademicYearId: body.fromAcademicYearId ?? null,
      toAcademicYearId: body.toAcademicYearId ?? null,
      toTermId: body.toTermId ?? null,
      status: 'draft',
      reason: body.reason,
      items: items.map((item) => ({ ...item, toClassId: toClass?._id ?? null, toStreamId: toClass?.streamId ?? null })),
      createdBy: req.auth!.userId,
      history: [{ at: new Date(), by: req.auth!.userId, action: 'created', note: `${items.length} student(s) staged` }],
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'promotion.created',
      resourceType: 'PromotionBatch',
      resourceId: String(batch._id),
      after: { batchNumber, fromClassId: body.fromClassId, toClassId: body.toClassId ?? null, graduate: Boolean(body.graduate), students: items.length },
    })
    created(res, batch)
  }),
)

router.patch(
  '/promotions/:id',
  requirePermission('students.promote'),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(160).optional(),
      reason: z.string().trim().max(1000).optional(),
      toClassId: objectId.optional().nullable(),
      graduate: z.boolean().optional(),
      toAcademicYearId: objectId.optional().nullable(),
      toTermId: objectId.optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const batch = await PromotionBatch.findById(req.params.id)
    if (!batch) throw ApiError.notFound('Promotion batch not found')
    if (!['draft', 'rejected'].includes(batch.status)) throw ApiError.badRequest('Only draft or rejected batches can be edited')
    if (req.body.title) batch.title = req.body.title
    if (req.body.reason !== undefined) batch.reason = req.body.reason
    if (req.body.graduate !== undefined) batch.graduate = req.body.graduate
    if (req.body.toClassId !== undefined) {
      if (req.body.toClassId) {
        const target = await ClassModel.findById(req.body.toClassId)
        if (!target || !target.active) throw ApiError.badRequest('Select an active destination class')
        batch.toClassId = target._id
        for (const item of batch.items) {
          if (item.status === 'pending') {
            item.toClassId = target._id
            item.toStreamId = target.streamId ?? null
          }
        }
      } else {
        batch.toClassId = null
      }
    }
    if (req.body.toAcademicYearId !== undefined) batch.toAcademicYearId = req.body.toAcademicYearId ? new Types.ObjectId(req.body.toAcademicYearId) : null
    if (req.body.toTermId !== undefined) batch.toTermId = req.body.toTermId ? new Types.ObjectId(req.body.toTermId) : null
    if (!batch.graduate && !batch.toClassId) throw ApiError.badRequest('Select a destination class or mark this batch as graduation')
    batch.history.push({ at: new Date(), by: req.auth!.userId, action: 'updated', note: 'Batch details updated' })
    await batch.save()
    await writeAudit({ req, actor: req.auth, action: 'promotion.updated', resourceType: 'PromotionBatch', resourceId: String(batch._id), after: req.body })
    ok(res, batch)
  }),
)

router.post(
  '/promotions/:id/submit',
  requirePermission('students.promote'),
  asyncHandler(async (req, res) => {
    const batch = await PromotionBatch.findById(req.params.id)
    if (!batch) throw ApiError.notFound('Promotion batch not found')
    if (!['draft', 'rejected'].includes(batch.status)) throw ApiError.badRequest('This batch cannot be submitted from its current status')
    if (!batch.graduate && !batch.toClassId) throw ApiError.badRequest('Select a destination class or mark this batch as graduation')
    if (!batch.items.length) throw ApiError.badRequest('This batch has no students')
    batch.status = 'submitted'
    batch.submittedBy = req.auth!.userId
    batch.submittedAt = new Date()
    batch.history.push({ at: new Date(), by: req.auth!.userId, action: 'submitted', note: 'Submitted for approval' })
    await batch.save()
    await notifyPermission(
      'students.promote.approve',
      {
        type: 'promotion.submitted',
        title: 'Promotion batch awaiting approval',
        message: `${batch.batchNumber} — ${batch.title} (${batch.items.length} students)`,
        link: `/promotions/${batch._id}`,
        data: { batchId: String(batch._id) },
      },
      { excludeUserId: String(req.auth!.userId) },
    )
    await writeAudit({ req, actor: req.auth, action: 'promotion.submitted', resourceType: 'PromotionBatch', resourceId: String(batch._id), after: { status: batch.status, students: batch.items.length } })
    ok(res, batch)
  }),
)

router.post(
  '/promotions/:id/approve',
  validate({ body: z.object({ notes: z.string().trim().max(2000).optional() }) }),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    assertApprovePermission(ctx)
    const batch = await PromotionBatch.findById(req.params.id)
    if (!batch) throw ApiError.notFound('Promotion batch not found')
    if (batch.status !== 'submitted') throw ApiError.badRequest('Only submitted batches can be approved')
    if (String(batch.submittedBy ?? batch.createdBy) === String(ctx.userId) && !hasRole(ctx, 'HEADTEACHER')) {
      throw ApiError.forbidden('A batch cannot be approved by the person who submitted it')
    }
    batch.status = 'approved'
    batch.reviewedBy = ctx.userId
    batch.reviewedAt = new Date()
    batch.decisionNotes = req.body.notes
    batch.history.push({ at: new Date(), by: ctx.userId, action: 'approved', note: req.body.notes })
    await batch.save()
    await notifyUsers([batch.createdBy], {
      type: 'promotion.approved',
      title: 'Promotion batch approved',
      message: `${batch.batchNumber} is approved and ready to execute.`,
      link: `/promotions/${batch._id}`,
    })
    await writeAudit({ req, actor: ctx, action: 'promotion.approved', resourceType: 'PromotionBatch', resourceId: String(batch._id), reason: req.body.notes })
    ok(res, batch)
  }),
)

router.post(
  '/promotions/:id/reject',
  validate({ body: z.object({ reason: z.string().trim().min(3).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    assertApprovePermission(ctx)
    const batch = await PromotionBatch.findById(req.params.id)
    if (!batch) throw ApiError.notFound('Promotion batch not found')
    if (batch.status !== 'submitted') throw ApiError.badRequest('Only submitted batches can be rejected')
    batch.status = 'rejected'
    batch.reviewedBy = ctx.userId
    batch.reviewedAt = new Date()
    batch.rejectionReason = req.body.reason
    batch.history.push({ at: new Date(), by: ctx.userId, action: 'rejected', note: req.body.reason })
    await batch.save()
    await notifyUsers([batch.createdBy], {
      type: 'promotion.rejected',
      title: 'Promotion batch rejected',
      message: `${batch.batchNumber}: ${req.body.reason}`,
      link: `/promotions/${batch._id}`,
    })
    await writeAudit({ req, actor: ctx, action: 'promotion.rejected', resourceType: 'PromotionBatch', resourceId: String(batch._id), reason: req.body.reason })
    ok(res, batch)
  }),
)

async function executeBatch(batchId: string, ctx: AuthContext) {
  const batch = await PromotionBatch.findOneAndUpdate(
    { _id: batchId, status: 'approved' },
    { $set: { status: 'executing', executedBy: ctx.userId, executedAt: new Date() } },
    { new: true },
  )
  if (!batch) {
    const current = await PromotionBatch.findById(batchId)
    if (!current) throw ApiError.notFound('Promotion batch not found')
    throw ApiError.badRequest(`This batch cannot be executed from status "${current.status}"`)
  }

  let promoted = 0
  let graduated = 0
  let skipped = 0
  let failed = 0
  for (const item of batch.items) {
    if (item.status !== 'pending') {
      skipped++
      continue
    }
    try {
      const student = await Student.findById(item.studentId)
      if (!student) throw new Error('Student record no longer exists')
      if (student.status !== 'active') throw new Error(`Student is ${student.status}`)
      if (String(student.classId) !== String(batch.fromClassId)) {
        throw new Error('Student is no longer in the source class')
      }
      if (batch.toAcademicYearId) student.academicYearId = batch.toAcademicYearId
      if (batch.toTermId) {
        student.termId = batch.toTermId
        student.currentTermId = batch.toTermId
      }
      if (batch.graduate) {
        student.previousStatus = 'active'
        student.status = 'graduated'
        student.enrollmentHistory.push({
          academicYearId: student.academicYearId ?? undefined,
          termId: student.currentTermId ?? undefined,
          classId: student.classId,
          streamId: student.streamId,
          dormitoryId: student.dormitoryId,
          action: 'graduated',
          reason: `Graduation batch ${batch.batchNumber}`,
          at: new Date(),
          by: ctx.userId,
        })
        item.status = 'graduated'
        graduated++
      } else {
        const toClass = await ClassModel.findById(item.toClassId ?? batch.toClassId)
        if (!toClass || !toClass.active) throw new Error('Destination class is not active')
        student.classId = toClass._id
        student.streamId = item.toStreamId ?? toClass.streamId ?? null
        student.enrollmentHistory.push({
          academicYearId: student.academicYearId ?? undefined,
          termId: student.currentTermId ?? undefined,
          classId: toClass._id,
          streamId: item.toStreamId ?? toClass.streamId ?? undefined,
          dormitoryId: student.dormitoryId ?? undefined,
          action: 'promoted',
          reason: `Promotion batch ${batch.batchNumber}`,
          at: new Date(),
          by: ctx.userId,
        })
        item.status = 'promoted'
        promoted++
      }
      item.executedAt = new Date()
      item.error = undefined
      await student.save()
    } catch (err) {
      item.status = 'failed'
      item.error = err instanceof Error ? err.message : 'Promotion failed'
      failed++
    }
  }

  batch.status = failed > 0 ? 'failed' : 'completed'
  batch.history.push({
    at: new Date(),
    by: ctx.userId,
    action: 'executed',
    note: `${promoted} promoted, ${graduated} graduated, ${skipped} skipped, ${failed} failed`,
  })
  await batch.save()
  await notifyUsers([batch.createdBy], {
    type: 'promotion.executed',
    title: 'Promotion batch executed',
    message: `${batch.batchNumber}: ${promoted} promoted, ${graduated} graduated, ${failed} failed.`,
    link: `/promotions/${batch._id}`,
  })
  await writeAudit({
    req: undefined,
    actor: ctx,
    action: 'promotion.executed',
    resourceType: 'PromotionBatch',
    resourceId: String(batch._id),
    after: { promoted, graduated, skipped, failed, status: batch.status },
  })
  return { batch, promoted, graduated, skipped, failed }
}

router.post(
  '/promotions/:id/execute',
  requirePermission('students.promote'),
  asyncHandler(async (req, res) => {
    ok(res, await executeBatch(req.params.id, req.auth!))
  }),
)

router.post(
  '/promotions/:id/retry',
  requirePermission('students.promote'),
  asyncHandler(async (req, res) => {
    const ctx = req.auth!
    const batch = await PromotionBatch.findById(req.params.id)
    if (!batch) throw ApiError.notFound('Promotion batch not found')
    if (batch.status !== 'failed') throw ApiError.badRequest('Only failed batches can be retried')
    for (const item of batch.items) {
      if (item.status === 'failed') {
        item.status = 'pending'
        item.error = undefined
      }
    }
    batch.status = 'approved'
    batch.history.push({ at: new Date(), by: ctx.userId, action: 'retry_requested', note: 'Failed items reset for another execution attempt' })
    await batch.save()
    await writeAudit({ req, actor: ctx, action: 'promotion.retry', resourceType: 'PromotionBatch', resourceId: String(batch._id) })
    ok(res, await executeBatch(req.params.id, ctx))
  }),
)

router.post(
  '/promotions/:id/cancel',
  requirePermission('students.promote'),
  validate({ body: z.object({ reason: z.string().trim().min(3).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const batch = await PromotionBatch.findById(req.params.id)
    if (!batch) throw ApiError.notFound('Promotion batch not found')
    if (['completed', 'cancelled', 'executing'].includes(batch.status)) {
      throw ApiError.badRequest('This batch can no longer be cancelled')
    }
    batch.status = 'cancelled'
    batch.history.push({ at: new Date(), by: req.auth!.userId, action: 'cancelled', note: req.body.reason })
    await batch.save()
    await writeAudit({ req, actor: req.auth, action: 'promotion.cancelled', resourceType: 'PromotionBatch', resourceId: String(batch._id), reason: req.body.reason })
    ok(res, batch)
  }),
)

export default router
