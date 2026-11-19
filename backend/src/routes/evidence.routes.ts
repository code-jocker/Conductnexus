import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Evidence, SafeguardingCase } from '../models/governance.js'
import { Incident } from '../models/discipline.js'
import { getSettings } from '../models/core.js'
import { env } from '../config/env.js'
import { writeAccessLog, writeAudit } from '../services/audit.service.js'
import { assertStudentAccess, assertSafeguardingAccess } from '../services/rbac.service.js'
import {
  assertContentMatches,
  createDownloadTicket,
  encryptEvidenceFile,
  evidenceEncryptionAvailable,
  readEvidenceFile,
  scanEvidenceFile,
  verifyDownloadTicket,
} from '../services/evidence-security.service.js'
import { objectId } from './helpers.js'

const router = Router()

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

// Signed ticket delivery, defined before the authentication middleware so a
// browser or mobile client can download with a short-lived URL instead of a
// long-lived session token. Tickets are only issued after the normal access
// checks pass and are bound to one evidence record and one user.
router.get(
  '/evidence/:id/file',
  asyncHandler(async (req, res) => {
    const ticket = verifyDownloadTicket(String(req.query.token ?? ''))
    if (!ticket || ticket.evidenceId !== req.params.id) {
      throw ApiError.unauthorized('This download link is invalid or has expired')
    }
    const evidence = await Evidence.findById(req.params.id)
    if (!evidence || evidence.deletedAt) throw ApiError.notFound('Evidence not found')
    if (!fs.existsSync(evidence.storagePath)) {
      throw ApiError.notFound('The stored file is missing. Contact IT to restore from backup.')
    }
    const buffer = readEvidenceFile(evidence.storagePath, Boolean(evidence.encrypted))
    const userId = new Types.ObjectId(ticket.userId)
    evidence.accessLog.push({ userId, at: new Date(), action: 'downloaded' })
    await evidence.save()
    await writeAccessLog({
      actor: { userId, name: ticket.name } as never,
      resourceType: 'Evidence',
      resourceId: String(evidence._id),
      action: 'downloaded',
      classification: evidence.classification,
      req,
    })
    res.setHeader('Content-Type', evidence.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(evidence.originalName)}"`)
    res.setHeader('X-Content-SHA256', evidence.sha256)
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(buffer)
  }),
)

router.use(authenticate)

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
    if (req.query.includeDeleted !== 'true') filter.deletedAt = { $exists: false }
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
    // The declared MIME type and extension come from the client, so the bytes
    // themselves decide whether this is really the document it claims to be.
    try {
      assertContentMatches(req.file.path, req.file.mimetype)
    } catch (err) {
      fs.unlinkSync(req.file.path)
      throw err
    }
    const scan = await scanEvidenceFile(req.file.path)
    if (scan.status === 'infected') {
      fs.unlinkSync(req.file.path)
      await writeAudit({
        req,
        actor: req.auth,
        action: 'evidence.upload_blocked',
        resourceType: 'Evidence',
        after: { originalName: req.file.originalname, scan },
      })
      throw ApiError.badRequest('The uploaded file failed the malware scan and was rejected.')
    }
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
    const stored = encryptEvidenceFile(req.file.path)
    const settings = await getSettings()
    const years =
      linkedType === 'safeguarding'
        ? Math.max(settings.retention.evidenceYears, settings.retention.safeguardingYears)
        : settings.retention.evidenceYears
    const retentionUntil = new Date(Date.now() + Math.max(1, years) * 365.25 * 24 * 60 * 60 * 1000)
    const evidence = await Evidence.create({
      fileName: path.basename(stored.path),
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: buffer.length,
      sha256,
      storagePath: stored.path,
      description: req.body.description || undefined,
      classification,
      uploadedBy: req.auth!.userId,
      linkedType,
      linkedId,
      encrypted: stored.encrypted,
      scanStatus: scan.status,
      scanDetail: scan.detail,
      retentionUntil,
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

// Declared before '/evidence/:id' so the literal path wins.
router.get(
  '/evidence/security',
  requirePermission('evidence.view'),
  asyncHandler(async (_req, res) => {
    ok(res, {
      encryptionAtRest: evidenceEncryptionAvailable(),
      malwareScanning: env.CLAMAV_HOST ? 'clamav' : 'signature-only',
      privateStorage: true,
      downloadTickets: true,
    })
  }),
)

router.get(
  '/evidence/:id',
  requirePermission('evidence.view'),
  asyncHandler(async (req, res) => {
    const evidence = await Evidence.findById(req.params.id)
      .select('-storagePath')
      .populate('uploadedBy', 'name position')
      .populate('reviewedBy', 'name')
      .populate('accessLog.userId', 'name position')
      .populate('deletedBy', 'name')
    if (!evidence || evidence.deletedAt) throw ApiError.notFound('Evidence not found')
    await assertEvidenceAccess(req.auth!, evidence, 'viewed')
    ok(res, evidence)
  }),
)

router.get(
  '/evidence/:id/download',
  requirePermission('evidence.view'),
  asyncHandler(async (req, res) => {
    const evidence = await Evidence.findById(req.params.id)
    if (!evidence || evidence.deletedAt) throw ApiError.notFound('Evidence not found')
    await assertEvidenceAccess(req.auth!, evidence, 'downloaded')
    if (!fs.existsSync(evidence.storagePath)) throw ApiError.notFound('The stored file is missing. Contact IT to restore from backup.')
    const buffer = readEvidenceFile(evidence.storagePath, Boolean(evidence.encrypted))
    res.setHeader('Content-Type', evidence.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(evidence.originalName)}"`)
    res.setHeader('X-Content-SHA256', evidence.sha256)
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(buffer)
  }),
)

// Issues a short-lived URL so a browser or mobile client can stream the file
// without embedding a long-lived access token in the link.
router.post(
  '/evidence/:id/download-ticket',
  requirePermission('evidence.view'),
  asyncHandler(async (req, res) => {
    const evidence = await Evidence.findById(req.params.id)
    if (!evidence || evidence.deletedAt) throw ApiError.notFound('Evidence not found')
    await assertEvidenceAccess(req.auth!, evidence, 'viewed')
    const ticket = createDownloadTicket(String(evidence._id), String(req.auth!.userId), req.auth!.name, 300)
    created(res, {
      url: `/api/v1/evidence/${evidence._id}/file?token=${encodeURIComponent(ticket.token)}`,
      expiresAt: ticket.expiresAt,
    })
  }),
)

router.get(
  '/evidence/:id/access',
  requirePermission('evidence.review'),
  asyncHandler(async (req, res) => {
    const evidence = await Evidence.findById(req.params.id)
      .select('originalName classification linkedType linkedId accessLog')
      .populate('accessLog.userId', 'name position')
      .lean()
    if (!evidence || !evidence.accessLog) throw ApiError.notFound('Evidence not found')
    if (evidence.classification === 'restricted' && !canSeeRestricted(req.auth!)) {
      throw ApiError.forbidden('This evidence is restricted to safeguarding-authorized staff')
    }
    if (evidence.linkedType === 'safeguarding' && evidence.linkedId) {
      const caseDoc = await SafeguardingCase.findById(evidence.linkedId).select('reportedBy assignedTo')
      if (caseDoc) assertSafeguardingAccess(req.auth!, caseDoc)
    }
    ok(res, {
      id: String(evidence._id),
      originalName: evidence.originalName,
      classification: evidence.classification,
      entries: [...evidence.accessLog].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    })
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

async function detachEvidence(evidenceId: Types.ObjectId, linkedType?: string, linkedId?: Types.ObjectId | string) {
  if (!linkedId) return
  if (linkedType === 'incident') {
    await Incident.updateOne({ _id: linkedId }, { $pull: { evidenceIds: evidenceId } })
  } else if (linkedType === 'safeguarding') {
    await SafeguardingCase.updateOne({ _id: linkedId }, { $pull: { evidenceIds: evidenceId } })
  }
}

// Soft delete keeps the audit trail intact: the file is removed from disk, the
// record is marked deleted and the deletion is attributed to a named operator.
router.delete(
  '/evidence/:id',
  requirePermission('evidence.review'),
  validate({ body: z.object({ reason: z.string().trim().min(5).max(500) }) }),
  asyncHandler(async (req, res) => {
    const evidence = await Evidence.findById(req.params.id)
    if (!evidence || evidence.deletedAt) throw ApiError.notFound('Evidence not found')
    if (!req.auth!.roles.includes('HEADTEACHER') && !req.auth!.roles.includes('ADMIN')) {
      throw ApiError.forbidden('Only Headteacher or Administrator authority can delete evidence')
    }
    if (evidence.classification === 'restricted' && !canSeeRestricted(req.auth!)) {
      throw ApiError.forbidden('This evidence is restricted to safeguarding-authorized staff')
    }
    if (fs.existsSync(evidence.storagePath)) fs.unlinkSync(evidence.storagePath)
    evidence.deletedAt = new Date()
    evidence.deletedBy = req.auth!.userId
    evidence.deletionReason = req.body.reason
    await evidence.save()
    await detachEvidence(evidence._id, evidence.linkedType, evidence.linkedId)
    await writeAccessLog({ actor: req.auth!, resourceType: 'Evidence', resourceId: String(evidence._id), action: 'deleted', classification: evidence.classification })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'evidence.deleted',
      resourceType: 'Evidence',
      resourceId: String(evidence._id),
      before: { originalName: evidence.originalName, classification: evidence.classification, sha256: evidence.sha256 },
      reason: req.body.reason,
    })
    ok(res, { id: String(evidence._id), deletedAt: evidence.deletedAt, reason: evidence.deletionReason })
  }),
)

// Disposal run for records whose retention window has elapsed. This is
// deliberately a manual, audited administrative action rather than an
// unattended job that silently destroys files.
router.post(
  '/evidence/purge-expired',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    if (!req.auth!.roles.includes('HEADTEACHER') && !req.auth!.roles.includes('ADMIN')) {
      throw ApiError.forbidden('Only Headteacher or Administrator authority can purge expired evidence')
    }
    const now = new Date()
    const expired = await Evidence.find({ retentionUntil: { $lte: now }, deletedAt: { $exists: false } })
      .select('storagePath linkedType linkedId classification')
      .limit(500)
    let filesRemoved = 0
    for (const file of expired) {
      if (file.storagePath && fs.existsSync(file.storagePath)) {
        fs.unlinkSync(file.storagePath)
        filesRemoved += 1
      }
      await Evidence.updateOne(
        { _id: file._id },
        { deletedAt: now, deletedBy: req.auth!.userId, deletionReason: 'Retention period expired' },
      )
      await detachEvidence(file._id, file.linkedType, file.linkedId)
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'evidence.retention_purged',
      resourceType: 'Evidence',
      after: { recordsPurged: expired.length, filesRemoved },
      reason: 'Retention period expired',
    })
    ok(res, { recordsPurged: expired.length, filesRemoved, purgedAt: now })
  }),
)

export default router
