import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Policy } from '../models/discipline.js'
import { writeAudit } from '../services/audit.service.js'

const router = Router()
router.use(authenticate)

router.get(
  '/policies',
  requirePermission('policies.view'),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {}
    if (req.query.type) filter.type = req.query.type
    if (req.query.published !== 'all') filter.published = true
    if (req.query.q) filter.title = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    ok(res, await Policy.find(filter).sort({ effectiveDate: -1, createdAt: -1 }).lean())
  }),
)

router.get(
  '/policies/:id',
  requirePermission('policies.view'),
  asyncHandler(async (req, res) => {
    const policy = await Policy.findById(req.params.id).populate('createdBy', 'name').lean()
    if (!policy) throw ApiError.notFound('Policy not found')
    if (!policy.published && !req.auth!.permissions.has('policies.manage')) throw ApiError.forbidden('This policy is not published')
    ok(res, policy)
  }),
)

router.post(
  '/policies',
  requirePermission('policies.manage'),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(200),
      type: z.enum(['handbook', 'discipline', 'safeguarding', 'data_protection', 'other']).default('discipline'),
      version: z.string().trim().min(1).max(20).default('1.0'),
      summary: z.string().trim().max(2000).optional().default(''),
      content: z.string().trim().max(200000).default(''),
      effectiveDate: z.string().trim().min(4),
      published: z.boolean().optional().default(false),
      offenceCategories: z.array(z.string().trim().max(80)).optional().default([]),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (await Policy.exists({ title: req.body.title, version: req.body.version })) {
      throw ApiError.conflict('This policy version already exists')
    }
    const policy = await Policy.create({
      ...req.body,
      effectiveDate: new Date(req.body.effectiveDate),
      createdBy: req.auth!.userId,
    })
    await writeAudit({ req, actor: req.auth, action: 'policy.created', resourceType: 'Policy', resourceId: String(policy._id), after: { title: policy.title, version: policy.version } })
    created(res, policy)
  }),
)

router.patch(
  '/policies/:id',
  requirePermission('policies.manage'),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(200).optional(),
      type: z.enum(['handbook', 'discipline', 'safeguarding', 'data_protection', 'other']).optional(),
      summary: z.string().trim().max(2000).optional(),
      content: z.string().trim().max(200000).optional(),
      effectiveDate: z.string().trim().optional(),
      offenceCategories: z.array(z.string().trim().max(80)).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const policy = await Policy.findById(req.params.id)
    if (!policy) throw ApiError.notFound('Policy not found')
    if (policy.published) throw ApiError.badRequest('Published policies are immutable. Create a new version instead.')
    Object.assign(policy, req.body)
    if (req.body.effectiveDate) policy.effectiveDate = new Date(req.body.effectiveDate)
    await policy.save()
    await writeAudit({ req, actor: req.auth, action: 'policy.updated', resourceType: 'Policy', resourceId: String(policy._id), after: req.body })
    ok(res, policy)
  }),
)

router.post(
  '/policies/:id/publish',
  requirePermission('policies.manage'),
  asyncHandler(async (req, res) => {
    const policy = await Policy.findById(req.params.id)
    if (!policy) throw ApiError.notFound('Policy not found')
    if (policy.published) throw ApiError.badRequest('This policy version is already published')
    await Policy.updateMany({ title: policy.title, _id: { $ne: policy._id }, published: true }, { $set: { published: false } })
    policy.published = true
    await policy.save()
    await writeAudit({ req, actor: req.auth, action: 'policy.published', resourceType: 'Policy', resourceId: String(policy._id), after: { title: policy.title, version: policy.version } })
    ok(res, policy)
  }),
)

router.post(
  '/policies/:id/new-version',
  requirePermission('policies.manage'),
  validate({
    body: z.object({
      version: z.string().trim().min(1).max(20),
      summary: z.string().trim().max(2000).optional().default(''),
      content: z.string().trim().max(200000).default(''),
      effectiveDate: z.string().trim().min(4),
    }),
  }),
  asyncHandler(async (req, res) => {
    const current = await Policy.findById(req.params.id)
    if (!current) throw ApiError.notFound('Policy not found')
    if (await Policy.exists({ title: current.title, version: req.body.version })) {
      throw ApiError.conflict('This policy version already exists')
    }
    const policy = await Policy.create({
      title: current.title,
      type: current.type,
      version: req.body.version,
      summary: req.body.summary,
      content: req.body.content,
      effectiveDate: new Date(req.body.effectiveDate),
      published: false,
      offenceCategories: current.offenceCategories,
      supersedes: current._id,
      createdBy: req.auth!.userId,
    })
    await writeAudit({ req, actor: req.auth, action: 'policy.version_created', resourceType: 'Policy', resourceId: String(policy._id), after: { title: policy.title, version: policy.version } })
    created(res, policy)
  }),
)

router.get(
  '/policies/:id/versions',
  requirePermission('policies.view'),
  asyncHandler(async (req, res) => {
    const policy = await Policy.findById(req.params.id).lean()
    if (!policy) throw ApiError.notFound('Policy not found')
    const versions = await Policy.find({ title: policy.title }).sort({ effectiveDate: -1 }).lean()
    ok(res, versions.map((v) => ({
      id: String(v._id),
      version: v.version,
      published: v.published,
      effectiveDate: v.effectiveDate,
      summary: v.summary,
      createdAt: v.createdAt,
    })))
  }),
)

export default router
