import { Router } from 'express'
import { z } from 'zod'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Evidence, SafeguardingCase } from '../models/governance.js'
import { Incident } from '../models/discipline.js'
import { env } from '../config/env.js'
import { writeAccessLog, writeAudit } from '../services/audit.service.js'
import { assertStudentAccess, assertSafeguardingAccess } from '../services/rbac.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR)
fs.mkdirSync(uploadDir, { recursive: true })

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12).replace(/[^.\w]/g, '')
      cb(null, `${crypto.randomUUID()}${ext}`)
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      cb(new Error('Unsupported file type. Upload an image, PDF, Word, Excel or text file.'))
      return
    }
    cb(null, true)
  },
})

function canSeeRestricted(ctx: NonNullable<import('express').Request['auth']>) {
  return ctx.roles.includes('HEADTEACHER') || ctx.permissions.has('safeguarding.evidence.view')
}

async function assertEvidenceAccess(
  ctx: NonNullable<import('express').Request['auth']>,
  evidence: InstanceType<typeof Evidence>,
  action: 'viewed' | 'downloaded',
) {
  if (!ctx.permissions.has('evidence.view') && !ctx.permissions.has('safeguarding.evidence.view')) {
    throw ApiError.forbidden('Missing permission: evidence.view')
  }
  if (evidence.classification === 'restricted' && !canSeeRestricted(ctx)) {
    throw ApiError.forbidden('This evidence is restricted to safeguarding-authorized staff')
  }
  if (evidence.linkedType === 'safeguarding' && evidence.linkedId) {
    const caseDoc = await SafeguardingCase.findById(evidence.linkedId).select('reportedBy assignedTo')
    if (caseDoc) assertSafeguardingAccess(ctx, caseDoc)
  }
  if (evidence.linkedType === 'incident' && evidence.linkedId) {
    const incident = await Incident.findById(evidence.linkedId).select('studentId')
    if (incident) await assertStudentAccess(ctx, incident.studentId)
  }
  evidence.accessLog.push({ userId: ctx.userId, at: new Date(), action })
  await evidence.save()
  await writeAccessLog({ actor: ctx, resourceType: 'Evidence', resourceId: String(evidence._id), action, classification: evidence.classification })
}

router.get(
  '/evidence',
  requirePermission('evidence.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (req.query.linkedType) filter.linkedType = req.query.linkedType
    if (req.query.linkedId) filter.linkedId = req.query.linkedId
    if (req.query.reviewStatus) filter.reviewStatus = req.query.reviewStatus
    if (!canSeeRestricted(req.auth!)) filter.classification = { $ne: 'restricted' }
    const [total, items] = await Promise.all([
      Evidence.countDocuments(filter),
      Evidence.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select('-accessLog -storagePath -sha256')
        .populate('uploadedBy', 'name position')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/evidence',
  requirePermission('evidence.upload'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Attach a file to upload')
    const linkedType = String(req.body.linkedType ?? 'general')
    if (!['incident', 'investigation', 'safeguarding', 'appeal', 'meeting', 'general'].includes(linkedType)) {
      fs.unlinkSync(req.file.path)
      throw ApiError.badRequest('Invalid evidence category')
    }
    const classification = String(req.body.classification ?? 'confidential')
    if (!['internal', 'confidential', 'restricted'].includes(classification)) {
      fs.unlinkSync(req.file.path)
      throw ApiError.badRequest('Invalid evidence classification')
    }
    if (classification === 'restricted' && !canSeeRestricted(req.auth!)) {
      fs.unlinkSync(req.file.path)
      throw ApiError.forbidden('Only safeguarding-authorized staff can classify evidence as restricted')
    }
    if (linkedType === 'safeguarding' && !req.auth!.permissions.has('safeguarding.create') && !req.auth!.permissions.has('safeguarding.view')) {
      fs.unlinkSync(req.file.path)
      throw ApiError.forbidden('You are not authorized to attach safeguarding evidence')
    }
    let linkedId: string | undefined
    if (req.body.linkedId && ['incident', 'investigation', 'safeguarding', 'appeal', 'meeting'].includes(linkedType)) {
      linkedId = String(req.body.linkedId)
      if (linkedType === 'incident') {
        const incident = await Incident.findById(linkedId).select('studentId')
        if (!incident) {
          fs.unlinkSync(req.file.path)
          throw ApiError.notFound('Linked incident not found')
        }
        await assertStudentAccess(req.auth!, incident.studentId)
      }
    }
    const buffer = fs.readFileSync(req.file.path)
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
    const evidence = await Evidence.create({
      fileName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      sha256,
      storagePath: req.file.path,
      description: req.body.description || undefined,
      classification,
      uploadedBy: req.auth!.userId,
      linkedType,
      linkedId,
      accessLog: [{ userId: req.auth!.userId, at: new Date(), action: 'uploaded' }],
    })
    if (linkedType === 'incident' && linkedId) {
      await Incident.updateOne({ _id: linkedId }, { $addToSet: { evidenceIds: evidence._id } })
    }
    if (linkedType === 'safeguarding' && linkedId) {
      await SafeguardingCase.updateOne({ _id: linkedId }, { $addToSet: { evidenceIds: evidence._id } })
    }
    await writeAccessLog({ actor: req.auth!, resourceType: 'Evidence', resourceId: String(evidence._id), action: 'uploaded', classification })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'evidence.uploaded',
      resourceType: 'Evidence',
      resourceId: String(evidence._id),
      after: { linkedType, classification, size: evidence.size, sha256 },
    })
    created(res, {
      id: String(evidence._id),
      originalName: evidence.originalName,
      mimeType: evidence.mimeType,
      size: evidence.size,
      sha256: evidence.sha256,
      classification: evidence.classification,
      reviewStatus: evidence.reviewStatus,
      createdAt: evidence.createdAt,
    })
  }),
)

router.get(
  '/evidence/:id',
  requirePermission('evidence.view'),
  asyncHandler(async (req, res) => {
    const evidence = await Evidence.findById(req.params.id).populate('uploadedBy', 'name position').populate('reviewedBy', 'name')
    if (!evidence) throw ApiError.notFound('Evidence not found')
    await assertEvidenceAccess(req.auth!, evidence, 'viewed')
    ok(res, evidence)
  }),
)

router.get(
  '/evidence/:id/download',
  requirePermission('evidence.view'),
  asyncHandler(async (req, res) => {
    const evidence = await Evidence.findById(req.params.id)
    if (!evidence) throw ApiError.notFound('Evidence not found')
    await assertEvidenceAccess(req.auth!, evidence, 'downloaded')
    if (!fs.existsSync(evidence.storagePath)) throw ApiError.notFound('The stored file is missing. Contact IT to restore from backup.')
    res.setHeader('Content-Type', evidence.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(evidence.originalName)}"`)
    res.setHeader('X-Content-SHA256', evidence.sha256)
    res.sendFile(path.resolve(evidence.storagePath))
  }),
)

router.post(
  '/evidence/:id/review',
  requirePermission('evidence.review'),
  validate({ body: z.object({ status: z.enum(['reviewed', 'rejected']), notes: z.string().trim().max(2000).optional() }) }),
  asyncHandler(async (req, res) => {
    const evidence = await Evidence.findById(req.params.id)
    if (!evidence) throw ApiError.notFound('Evidence not found')
    if (evidence.classification === 'restricted' && !canSeeRestricted(req.auth!)) {
      throw ApiError.forbidden('This evidence is restricted to safeguarding-authorized staff')
    }
    evidence.reviewStatus = req.body.status
    evidence.reviewedBy = req.auth!.userId
    evidence.reviewedAt = new Date()
    evidence.reviewNotes = req.body.notes
    await evidence.save()
    await writeAudit({ req, actor: req.auth, action: 'evidence.reviewed', resourceType: 'Evidence', resourceId: String(evidence._id), after: { status: req.body.status } })
    ok(res, evidence)
  }),
)

export default router
