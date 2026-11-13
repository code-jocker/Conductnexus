import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import {
  Letter,
  LetterTemplate,
  MessageQueue,
  Notification,
  NotificationTemplate,
} from '../models/communications.js'
import { Student } from '../models/school.js'
import { createLetter, submitLetter, issueLetter, generateLetterPdf } from '../services/letters.service.js'
import {
  processMessageQueue,
  queueParentMessage,
  queueStatusCounts,
  refreshCommsSettings,
  retryMessage,
  startWhatsapp,
  stopWhatsapp,
  whatsappStatus,
} from '../services/communication.service.js'
import { assertStudentAccess } from '../services/rbac.service.js'
import { writeAudit } from '../services/audit.service.js'
import { objectId, paginationQuery, searchRegex } from './helpers.js'

const router = Router()
router.use(authenticate)

// ── In-app notifications ───────────────────────────────────────────────────

router.get(
  '/notifications',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = { userId: req.auth!.userId }
    if (req.query.unread === 'true') filter.readAt = { $exists: false }
    const [total, items, unread] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      Notification.countDocuments({ userId: req.auth!.userId, readAt: { $exists: false } }),
    ])
    ok(res, items, { ...pagedMeta(total, page, pageSize), unread })
  }),
)

router.get(
  '/notifications/unread-count',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    ok(res, { unread: await Notification.countDocuments({ userId: req.auth!.userId, readAt: { $exists: false } }) })
  }),
)

router.post(
  '/notifications/read-all',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const result = await Notification.updateMany({ userId: req.auth!.userId, readAt: { $exists: false } }, { $set: { readAt: new Date() } })
    ok(res, { marked: result.modifiedCount })
  }),
)

router.post(
  '/notifications/:id/read',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const item = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.auth!.userId },
      { $set: { readAt: new Date() } },
      { new: true },
    )
    if (!item) throw ApiError.notFound('Notification not found')
    ok(res, item)
  }),
)

// ── Message queue ──────────────────────────────────────────────────────────

router.get(
  '/notifications/queue/stats',
  requirePermission('notifications.manage'),
  asyncHandler(async (_req, res) => {
    ok(res, await queueStatusCounts())
  }),
)

router.get(
  '/notifications/queue',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (req.query.status) filter.status = req.query.status
    if (req.query.channel) filter.channel = req.query.channel
    if (req.query.q) {
      const rx = searchRegex(String(req.query.q))
      filter.$or = [{ to: rx }, { body: rx }, { templateKey: rx }]
    }
    const [total, items] = await Promise.all([
      MessageQueue.countDocuments(filter),
      MessageQueue.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('parentId', 'name phone')
        .populate('studentId', 'fullName studentId')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/notifications/queue/process',
  requirePermission('notifications.manage'),
  asyncHandler(async (_req, res) => {
    await refreshCommsSettings()
    ok(res, await processMessageQueue(50))
  }),
)

router.post(
  '/notifications/queue/:id/retry',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    ok(res, await retryMessage(req.params.id))
  }),
)

router.post(
  '/communications/send',
  requirePermission('notifications.manage'),
  validate({
    body: z.object({
      studentId: objectId,
      parentId: objectId.optional(),
      templateKey: z.string().trim().min(2).max(80),
      extraVars: z.record(z.union([z.string(), z.number()])).optional(),
      dedupeSuffix: z.string().trim().max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const student = await assertStudentAccess(req.auth!, req.body.studentId)
    const result = await queueParentMessage({
      studentId: student._id,
      onlyParentId: req.body.parentId,
      templateKey: req.body.templateKey,
      extraVars: req.body.extraVars,
      dedupeSuffix: req.body.dedupeSuffix ?? `manual-${Date.now()}`,
      createdBy: req.auth!.userId,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: 'communication.parent_message_queued',
      resourceType: 'MessageQueue',
      resourceId: String(student._id),
      after: result,
    })
    created(res, result)
  }),
)

// ── Templates ──────────────────────────────────────────────────────────────

router.get(
  '/notifications/templates',
  requirePermission('notifications.manage'),
  asyncHandler(async (_req, res) => {
    ok(res, await NotificationTemplate.find().sort({ key: 1 }).lean())
  }),
)

router.post(
  '/notifications/templates',
  requirePermission('templates.manage'),
  validate({
    body: z.object({
      key: z.string().trim().min(2).max(80).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
      name: z.string().trim().min(2).max(160),
      channel: z.enum(['in_app', 'whatsapp', 'sms', 'email']).default('whatsapp'),
      subject: z.string().trim().max(300).optional().default(''),
      body: z.string().trim().min(5).max(5000),
      active: z.boolean().optional().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (await NotificationTemplate.exists({ key: req.body.key })) throw ApiError.conflict('A template with this key already exists')
    const template = await NotificationTemplate.create(req.body)
    await writeAudit({ req, actor: req.auth, action: 'notification_template.created', resourceType: 'NotificationTemplate', resourceId: String(template._id), after: { key: template.key } })
    created(res, template)
  }),
)

router.patch(
  '/notifications/templates/:id',
  requirePermission('templates.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160).optional(),
      channel: z.enum(['in_app', 'whatsapp', 'sms', 'email']).optional(),
      subject: z.string().trim().max(300).optional(),
      body: z.string().trim().min(5).max(5000).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const template = await NotificationTemplate.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true })
    if (!template) throw ApiError.notFound('Template not found')
    await writeAudit({ req, actor: req.auth, action: 'notification_template.updated', resourceType: 'NotificationTemplate', resourceId: String(template._id), after: req.body })
    ok(res, template)
  }),
)

router.get(
  '/letter-templates',
  requirePermission('letters.view'),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {}
    if (req.query.active !== 'all') filter.active = true
    ok(res, await LetterTemplate.find(filter).sort({ type: 1 }).lean())
  }),
)

router.post(
  '/letter-templates',
  requirePermission('templates.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(3).max(160),
      type: z.string().trim().min(2).max(60),
      subject: z.string().trim().min(3).max(300),
      body: z.string().trim().min(10).max(20000),
      active: z.boolean().optional().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const template = await LetterTemplate.create({ ...req.body, createdBy: req.auth!.userId })
    await writeAudit({ req, actor: req.auth, action: 'letter_template.created', resourceType: 'LetterTemplate', resourceId: String(template._id), after: { name: template.name } })
    created(res, template)
  }),
)

router.patch(
  '/letter-templates/:id',
  requirePermission('templates.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(3).max(160).optional(),
      subject: z.string().trim().min(3).max(300).optional(),
      body: z.string().trim().min(10).max(20000).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const template = await LetterTemplate.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true })
    if (!template) throw ApiError.notFound('Letter template not found')
    await writeAudit({ req, actor: req.auth, action: 'letter_template.updated', resourceType: 'LetterTemplate', resourceId: String(template._id), after: req.body })
    ok(res, template)
  }),
)

// ── Letters ────────────────────────────────────────────────────────────────

router.get(
  '/letters',
  requirePermission('letters.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const canReview = req.auth!.permissions.has('letters.approve') || req.auth!.permissions.has('letters.issue')
    const filter: Record<string, unknown> = canReview ? {} : { preparedBy: req.auth!.userId }
    if (req.query.status) filter.status = req.query.status
    if (req.query.type) filter.type = req.query.type
    if (req.query.studentId) filter.studentId = req.query.studentId
    if (req.query.q) {
      const rx = searchRegex(String(req.query.q))
      filter.$or = [{ reference: rx }, { subject: rx }, { 'studentSnapshot.fullName': rx }]
    }
    const [total, items] = await Promise.all([
      Letter.countDocuments(filter),
      Letter.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('studentId', 'fullName studentId classId')
        .populate('preparedBy', 'name')
        .populate('approvedBy', 'name')
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.post(
  '/letters',
  requirePermission('letters.create'),
  validate({
    body: z.object({
      type: z.enum(['warning', 'parent_meeting_invitation', 'serious_incident', 'hearing_invitation', 'suspension', 'expulsion_recommendation', 'expulsion_decision', 'conduct_report', 'improvement_notice']),
      studentId: objectId,
      incidentId: objectId.optional(),
      templateId: objectId.optional(),
      subject: z.string().trim().max(300).optional(),
      body: z.string().trim().max(20000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const letter = await createLetter(req.auth!, req.body, req)
    created(res, letter)
  }),
)

router.get(
  '/letters/:id',
  requirePermission('letters.view'),
  asyncHandler(async (req, res) => {
    const letter = await Letter.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId')
      .populate('preparedBy', 'name')
      .populate('approvedBy', 'name')
      .populate('incidentId', 'incidentNumber offenceSnapshot')
    if (!letter) throw ApiError.notFound('Letter not found')
    const canReview = req.auth!.permissions.has('letters.approve') || req.auth!.permissions.has('letters.issue')
    if (!canReview && String(letter.preparedBy) !== String(req.auth!.userId)) {
      await assertStudentAccess(req.auth!, letter.studentId)
    }
    ok(res, letter)
  }),
)

router.post(
  '/letters/:id/submit',
  requirePermission('letters.create'),
  asyncHandler(async (req, res) => {
    ok(res, await submitLetter(req.auth!, req.params.id, req))
  }),
)

router.post(
  '/letters/:id/issue',
  requirePermission('letters.issue'),
  asyncHandler(async (req, res) => {
    ok(res, await issueLetter(req.auth!, req.params.id, req))
  }),
)

router.get(
  '/letters/:id/pdf',
  requirePermission('letters.view'),
  asyncHandler(async (req, res) => {
    const letter = await Letter.findById(req.params.id)
    if (!letter) throw ApiError.notFound('Letter not found')
    const canReview = req.auth!.permissions.has('letters.approve') || req.auth!.permissions.has('letters.issue')
    if (!canReview && String(letter.preparedBy) !== String(req.auth!.userId)) {
      await assertStudentAccess(req.auth!, letter.studentId)
    }
    if (!['approved', 'issued'].includes(letter.status)) throw ApiError.badRequest('Only approved letters can be downloaded as an official PDF')
    const pdf = await generateLetterPdf(req.params.id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${letter.reference}.pdf"`)
    res.send(pdf)
  }),
)

// ── WhatsApp ───────────────────────────────────────────────────────────────

router.get(
  '/whatsapp/status',
  requirePermission('notifications.view'),
  asyncHandler(async (_req, res) => {
    ok(res, await whatsappStatus())
  }),
)

router.get(
  '/whatsapp/qr',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (_req, res) => {
    const status = await whatsappStatus()
    ok(res, {
      status: status.status,
      qrDataUrl: status.status === 'qr' ? status.qrDataUrl : null,
      enabled: status.enabled,
      lastError: status.lastError,
    })
  }),
)

router.post(
  '/whatsapp/connect',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (_req, res) => {
    ok(res, await startWhatsapp())
  }),
)

router.post(
  '/whatsapp/disconnect',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    await stopWhatsapp()
    await writeAudit({ req, actor: req.auth, action: 'whatsapp.disconnected', resourceType: 'WhatsappSession' })
    ok(res, { message: 'WhatsApp disconnected' })
  }),
)

export default router
