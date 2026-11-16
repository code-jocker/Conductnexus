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
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  TEMPLATE_CATEGORIES,
  TemplateVersion,
} from '../models/communications.js'
import { Student } from '../models/school.js'
import { createLetter, submitLetter, issueLetter, generateLetterPdf } from '../services/letters.service.js'
import {
  processMessageQueue,
  purgeNonWhatsappFailures,
  queueParentMessage,
  deliveryBlockReason,
  queueStatusCounts,
  refreshCommsSettings,
  renderTemplate,
  rerouteStrandedSms,
  retryMessage,
  startWhatsapp,
  stopWhatsapp,
  unresolvedPlaceholders,
  whatsappStatus,
} from '../services/communication.service.js'
import { assertStudentAccess } from '../services/rbac.service.js'
import { writeAudit } from '../services/audit.service.js'
import {
  getPreferenceMatrix,
  resetPreferences,
  updatePreferences,
} from '../services/notification-preferences.service.js'
import {
  COMMON_PLACEHOLDER_SAMPLES,
  extractPlaceholders,
} from '../data/templateLibrary.js'
import { objectId, paginationQuery, searchRegex } from './helpers.js'

const router = Router()
router.use(authenticate)

/** Human-readable summary of what an administrator changed in a template. */
function describeTemplateChange(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const changed = Object.keys(after).filter(
    (k) => k !== 'active' && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  )
  if (!changed.length) return 'No content change'
  return `Updated ${changed.join(', ')}`
}

// ── In-app notifications ───────────────────────────────────────────────────

router.get(
  '/notifications',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = { userId: req.auth!.userId }
    if (req.query.unread === 'true') filter.readAt = { $exists: false }
    const [total, items, unread, grouped] = await Promise.all([
      Notification.countDocuments(filter),
      // Priority is stored as a label for display, so rank it explicitly before
      // sorting — an alphabetical sort would put "normal" above "critical".
      Notification.aggregate([
        { $match: filter },
        {
          $addFields: {
            priorityRank: {
              $switch: {
                branches: [
                  { case: { $eq: ['$priority', 'critical'] }, then: 4 },
                  { case: { $eq: ['$priority', 'high'] }, then: 3 },
                  { case: { $eq: ['$priority', 'normal'] }, then: 2 },
                ],
                default: 1,
              },
            },
          },
        },
        { $sort: { priorityRank: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: pageSize },
        { $project: { priorityRank: 0 } },
      ]),
      Notification.countDocuments({ userId: req.auth!.userId, readAt: { $exists: false } }),
      Notification.aggregate([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 }, unread: { $sum: { $cond: [{ $ifNull: ['$readAt', false] }, 0, 1] } } } },
        { $sort: { count: -1 } },
      ]),
    ])
    // Group by the leading segment of the type (approval.decided -> approval) so
    // a client can render one bucket per kind of event.
    const groups = Object.values(
      grouped.reduce<Record<string, { category: string; count: number; unread: number }>>((acc, row) => {
        const key = String(row._id).split('.')[0] ?? 'system'
        const current = acc[key] ?? { category: key, count: 0, unread: 0 }
        current.count += row.count
        current.unread += row.unread
        acc[key] = current
        return acc
      }, {}),
    ).sort((a, b) => b.count - a.count)
    ok(res, items, { ...pagedMeta(total, page, pageSize), unread, groups })
  }),
)

router.get(
  '/notifications/unread-count',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    ok(res, { unread: await Notification.countDocuments({ userId: req.auth!.userId, readAt: { $exists: false } }) })
  }),
)

router.get(
  '/notifications/preferences',
  asyncHandler(async (req, res) => {
    ok(res, { matrix: await getPreferenceMatrix(String(req.auth!.userId)) })
  }),
)

const preferenceUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        channel: z.enum(NOTIFICATION_CHANNELS),
        category: z.enum(NOTIFICATION_CATEGORIES),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_CHANNELS.length * NOTIFICATION_CATEGORIES.length),
})

router.put(
  '/notifications/preferences',
  validate({ body: preferenceUpdateSchema }),
  asyncHandler(async (req, res) => {
    const matrix = await updatePreferences(String(req.auth!.userId), req.body.updates)
    await writeAudit({
      req,
      actor: req.auth,
      action: 'notification.preferences_updated',
      resourceType: 'User',
      resourceId: String(req.auth!.userId),
      after: { count: req.body.updates.length },
    })
    ok(res, { matrix })
  }),
)

router.delete(
  '/notifications/preferences',
  asyncHandler(async (req, res) => {
    const matrix = await resetPreferences(String(req.auth!.userId))
    await writeAudit({
      req,
      actor: req.auth,
      action: 'notification.preferences_reset',
      resourceType: 'User',
      resourceId: String(req.auth!.userId),
    })
    ok(res, { matrix })
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
    const [total, items, delivery] = await Promise.all([
      MessageQueue.countDocuments(filter),
      MessageQueue.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('parentId', 'name phone')
        .populate('studentId', 'fullName studentId')
        .lean(),
      deliveryBlockReason(),
    ])
    // A row sitting in "queued" with no reason reads as a broken worker, so the
    // delivery state travels with the page.
    ok(res, items, { ...pagedMeta(total, page, pageSize), delivery })
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
  '/notifications/queue/reroute-sms',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    await refreshCommsSettings()
    const { rerouted, reason } = await rerouteStrandedSms(true)
    const processed = rerouted > 0 ? await processMessageQueue(50) : { processed: 0, sent: 0, failed: 0 }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'communication.queue_rerouted_whatsapp',
      resourceType: 'MessageQueue',
      resourceId: 'bulk',
      after: { rerouted, ...processed },
    })
    ok(res, { rerouted, reason, ...processed })
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
  '/notifications/queue/purge-non-whatsapp',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    const result = await purgeNonWhatsappFailures()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'communication.queue_purged_non_whatsapp',
      resourceType: 'MessageQueue',
      resourceId: 'bulk',
      after: result,
    })
    ok(res, result)
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

const templateCategorySchema = z.enum([
  'conduct_notifications',
  'incident_notifications',
  'parent_engagement',
  'student_improvement',
  'risk_and_support',
  'investigation',
  'appeals_and_decisions',
  'official_letters',
  'general_communications',
])

const notificationTemplateBody = z.object({
  key: z.string().trim().min(2).max(80).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(400).optional().default(''),
  category: templateCategorySchema.optional().default('general_communications'),
  channel: z.enum(['in_app', 'whatsapp', 'sms', 'email']).default('whatsapp'),
  subject: z.string().trim().max(300).optional().default(''),
  body: z.string().trim().min(5).max(5000),
  active: z.boolean().optional().default(true),
  language: z.enum(['en', 'rw']).optional().default('en'),
})

router.get(
  '/notifications/templates/categories',
  requirePermission('notifications.manage'),
  asyncHandler(async (_req, res) => {
    ok(res, TEMPLATE_CATEGORIES)
  }),
)

router.get(
  '/notifications/templates',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {}
    if (req.query.category) filter.category = String(req.query.category)
    if (req.query.language) filter.language = String(req.query.language)
    if (req.query.active !== 'all') filter.active = req.query.active === 'false' ? false : true
    ok(res, await NotificationTemplate.find(filter).sort({ category: 1, key: 1 }).lean())
  }),
)

/**
 * Renders a template against sample data and reports any placeholder that would
 * still be unresolved, so an administrator can catch a broken template before a
 * real guardian ever receives it.
 */
router.post(
  '/notifications/templates/preview',
  requirePermission('notifications.manage'),
  validate({
    body: z.object({
      key: z.string().trim().min(2).max(80),
      language: z.enum(['en', 'rw']).optional().default('en'),
      values: z.record(z.string(), z.union([z.string(), z.number()])).optional().default({}),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { key, language } = req.body
    // Kinyarwanda rows are stored under a `_rw` key, matching how messages are
    // selected at send time.
    const candidates = language === 'rw' ? [`${key}_rw`, key] : [key]
    let template = null
    for (const candidate of candidates) {
      template = await NotificationTemplate.findOne({ key: candidate, active: true })
      if (template) break
    }
    if (!template) throw ApiError.notFound('Template not found')

    const samples: Record<string, string | number> = { ...COMMON_PLACEHOLDER_SAMPLES }
    const provided = req.body.values ?? {}
    for (const [k, v] of Object.entries(provided) as [string, string | number][]) samples[k] = v

    const vars: Record<string, string | number | undefined> = {}
    // An unknown placeholder is rendered back as itself so the preview can
    // report it; rendering never re-scans its own replacement.
    for (const p of template.placeholders) vars[p] = samples[p] ?? `{{${p}}}`

    const subject = template.subject ? renderTemplate(template.subject, vars) : ''
    const body = renderTemplate(template.body, vars)
    const missing = [...new Set([...unresolvedPlaceholders(subject), ...unresolvedPlaceholders(body)])]
    // Placeholders the caller did not supply are filled with an illustrative
    // sample, so an administrator can see what still needs real data.
    const unsupplied = template.placeholders.filter((p) => provided[p] === undefined)

    ok(res, {
      key: template.key,
      language: template.language,
      subject,
      body,
      placeholders: template.placeholders,
      missing,
      unsupplied,
      valid: missing.length === 0,
    })
  }),
)

router.post(
  '/notifications/templates',
  requirePermission('templates.manage'),
  validate({ body: notificationTemplateBody }),
  asyncHandler(async (req, res) => {
    if (await NotificationTemplate.exists({ key: req.body.key })) throw ApiError.conflict('A template with this key already exists')
    const body = req.body
    const template = await NotificationTemplate.create({
      ...body,
      placeholders: extractPlaceholders(body.subject ?? '', body.body),
      originalSubject: body.subject ?? '',
      originalBody: body.body,
      version: 1,
      updatedBy: req.auth!.userId,
    })
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
      description: z.string().trim().max(400).optional(),
      category: templateCategorySchema.optional(),
      channel: z.enum(['in_app', 'whatsapp', 'sms', 'email']).optional(),
      subject: z.string().trim().max(300).optional(),
      body: z.string().trim().min(5).max(5000).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const template = await NotificationTemplate.findById(req.params.id)
    if (!template) throw ApiError.notFound('Template not found')

    const before = {
      name: template.name,
      description: template.description,
      category: template.category,
      channel: template.channel,
      subject: template.subject,
      body: template.body,
      active: template.active,
    }
    const update: Record<string, unknown> = { ...req.body, updatedBy: req.auth!.userId, version: template.version + 1 }
    if (req.body.subject !== undefined || req.body.body !== undefined) {
      update.placeholders = extractPlaceholders(
        req.body.subject ?? template.subject,
        req.body.body ?? template.body,
      )
    }

    await TemplateVersion.create({
      templateType: 'notification',
      templateId: template._id,
      language: template.language,
      version: template.version,
      changedBy: req.auth!.userId,
      summary: describeTemplateChange(before, req.body as Record<string, unknown>),
      snapshot: before,
    })

    Object.assign(template, update)
    await template.save()
    await writeAudit({ req, actor: req.auth, action: 'notification_template.updated', resourceType: 'NotificationTemplate', resourceId: String(template._id), after: req.body })
    ok(res, template)
  }),
)

router.post(
  '/notifications/templates/:id/restore',
  requirePermission('templates.manage'),
  asyncHandler(async (req, res) => {
    const template = await NotificationTemplate.findById(req.params.id)
    if (!template) throw ApiError.notFound('Template not found')
    if (!template.originalBody) throw ApiError.badRequest('This template has no stored default to restore')

    await TemplateVersion.create({
      templateType: 'notification',
      templateId: template._id,
      language: template.language,
      version: template.version,
      changedBy: req.auth!.userId,
      summary: 'Restored to library default',
      snapshot: {
        name: template.name,
        description: template.description,
        category: template.category,
        channel: template.channel,
        subject: template.subject,
        body: template.body,
      },
    })

    template.subject = template.originalSubject
    template.body = template.originalBody
    template.placeholders = extractPlaceholders(template.originalSubject, template.originalBody)
    template.version += 1
    template.updatedBy = req.auth!.userId
    await template.save()
    await writeAudit({ req, actor: req.auth, action: 'notification_template.restored', resourceType: 'NotificationTemplate', resourceId: String(template._id) })
    ok(res, template)
  }),
)

router.post(
  '/notifications/templates/:id/duplicate',
  requirePermission('templates.manage'),
  validate({
    body: z.object({
      key: z.string().trim().min(2).max(80).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
      name: z.string().trim().min(2).max(160).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const source = await NotificationTemplate.findById(req.params.id).lean()
    if (!source) throw ApiError.notFound('Template not found')
    if (await NotificationTemplate.exists({ key: req.body.key })) throw ApiError.conflict('A template with this key already exists')

    const copy = await NotificationTemplate.create({
      key: req.body.key,
      name: req.body.name ?? `${source.name} (copy)`,
      description: source.description,
      category: source.category,
      channel: source.channel,
      subject: source.subject,
      body: source.body,
      placeholders: source.placeholders,
      active: false,
      language: source.language,
      originalSubject: source.originalSubject || source.subject,
      originalBody: source.originalBody || source.body,
      version: 1,
      updatedBy: req.auth!.userId,
    })
    await writeAudit({ req, actor: req.auth, action: 'notification_template.duplicated', resourceType: 'NotificationTemplate', resourceId: String(copy._id), after: { from: String(source._id), key: copy.key } })
    created(res, copy)
  }),
)

router.get(
  '/notifications/templates/:id/versions',
  requirePermission('templates.manage'),
  asyncHandler(async (req, res) => {
    ok(
      res,
      await TemplateVersion.find({ templateType: 'notification', templateId: req.params.id })
        .sort({ version: -1 })
        .limit(50)
        .lean(),
    )
  }),
)

router.get(
  '/letter-templates',
  requirePermission('letters.view'),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {}
    if (req.query.active !== 'all') filter.active = true
    if (req.query.category) filter.category = String(req.query.category)
    ok(res, await LetterTemplate.find(filter).sort({ type: 1 }).lean())
  }),
)

router.post(
  '/letter-templates',
  requirePermission('templates.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(3).max(160),
      nameRw: z.string().trim().max(160).optional().default(''),
      description: z.string().trim().max(400).optional().default(''),
      category: templateCategorySchema.optional().default('official_letters'),
      type: z.string().trim().min(2).max(60),
      subject: z.string().trim().min(3).max(300),
      body: z.string().trim().min(10).max(20000),
      subjectRw: z.string().trim().max(300).optional().default(''),
      bodyRw: z.string().trim().max(20000).optional().default(''),
      active: z.boolean().optional().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body
    const template = await LetterTemplate.create({
      ...b,
      placeholders: extractPlaceholders(b.subject, b.body, b.subjectRw ?? '', b.bodyRw ?? ''),
      originalSubject: b.subject,
      originalBody: b.body,
      originalSubjectRw: b.subjectRw ?? '',
      originalBodyRw: b.bodyRw ?? '',
      version: 1,
      createdBy: req.auth!.userId,
      updatedBy: req.auth!.userId,
    })
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
      nameRw: z.string().trim().max(160).optional(),
      description: z.string().trim().max(400).optional(),
      category: templateCategorySchema.optional(),
      subject: z.string().trim().min(3).max(300).optional(),
      body: z.string().trim().min(10).max(20000).optional(),
      subjectRw: z.string().trim().max(300).optional(),
      bodyRw: z.string().trim().max(20000).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const template = await LetterTemplate.findById(req.params.id)
    if (!template) throw ApiError.notFound('Letter template not found')

    const before = {
      name: template.name,
      nameRw: template.nameRw,
      description: template.description,
      category: template.category,
      subject: template.subject,
      body: template.body,
      subjectRw: template.subjectRw,
      bodyRw: template.bodyRw,
      active: template.active,
    }

    await TemplateVersion.create({
      templateType: 'letter',
      templateId: template._id,
      version: template.version,
      changedBy: req.auth!.userId,
      summary: describeTemplateChange(before, req.body as Record<string, unknown>),
      snapshot: before,
    })

    const update: Record<string, unknown> = { ...req.body, updatedBy: req.auth!.userId, version: template.version + 1 }
    if (
      req.body.subject !== undefined ||
      req.body.body !== undefined ||
      req.body.subjectRw !== undefined ||
      req.body.bodyRw !== undefined
    ) {
      update.placeholders = extractPlaceholders(
        req.body.subject ?? template.subject,
        req.body.body ?? template.body,
        req.body.subjectRw ?? template.subjectRw,
        req.body.bodyRw ?? template.bodyRw,
      )
    }
    Object.assign(template, update)
    await template.save()
    await writeAudit({ req, actor: req.auth, action: 'letter_template.updated', resourceType: 'LetterTemplate', resourceId: String(template._id), after: req.body })
    ok(res, template)
  }),
)

router.post(
  '/letter-templates/:id/restore',
  requirePermission('templates.manage'),
  asyncHandler(async (req, res) => {
    const template = await LetterTemplate.findById(req.params.id)
    if (!template) throw ApiError.notFound('Letter template not found')
    if (!template.originalBody) throw ApiError.badRequest('This template has no stored default to restore')

    await TemplateVersion.create({
      templateType: 'letter',
      templateId: template._id,
      version: template.version,
      changedBy: req.auth!.userId,
      summary: 'Restored to library default',
      snapshot: {
        name: template.name,
        nameRw: template.nameRw,
        description: template.description,
        category: template.category,
        subject: template.subject,
        body: template.body,
        subjectRw: template.subjectRw,
        bodyRw: template.bodyRw,
      },
    })

    template.subject = template.originalSubject
    template.body = template.originalBody
    template.subjectRw = template.originalSubjectRw
    template.bodyRw = template.originalBodyRw
    template.placeholders = extractPlaceholders(
      template.originalSubject,
      template.originalBody,
      template.originalSubjectRw,
      template.originalBodyRw,
    )
    template.version += 1
    template.updatedBy = req.auth!.userId
    await template.save()
    await writeAudit({ req, actor: req.auth, action: 'letter_template.restored', resourceType: 'LetterTemplate', resourceId: String(template._id) })
    ok(res, template)
  }),
)

router.post(
  '/letter-templates/:id/duplicate',
  requirePermission('templates.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(3).max(160).optional(),
      type: z.string().trim().min(2).max(60).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const source = await LetterTemplate.findById(req.params.id).lean()
    if (!source) throw ApiError.notFound('Letter template not found')
    const type = req.body.type ?? `${source.type}_copy`
    if (await LetterTemplate.exists({ type })) throw ApiError.conflict('A letter template with this type already exists')

    const copy = await LetterTemplate.create({
      type,
      name: req.body.name ?? `${source.name} (copy)`,
      nameRw: source.nameRw,
      description: source.description,
      category: source.category,
      subject: source.subject,
      body: source.body,
      subjectRw: source.subjectRw,
      bodyRw: source.bodyRw,
      placeholders: source.placeholders,
      active: false,
      originalSubject: source.originalSubject || source.subject,
      originalBody: source.originalBody || source.body,
      originalSubjectRw: source.originalSubjectRw || source.subjectRw,
      originalBodyRw: source.originalBodyRw || source.bodyRw,
      version: 1,
      createdBy: req.auth!.userId,
      updatedBy: req.auth!.userId,
    })
    await writeAudit({ req, actor: req.auth, action: 'letter_template.duplicated', resourceType: 'LetterTemplate', resourceId: String(copy._id), after: { from: String(source._id), type } })
    created(res, copy)
  }),
)

router.get(
  '/letter-templates/:id/versions',
  requirePermission('templates.manage'),
  asyncHandler(async (req, res) => {
    ok(
      res,
      await TemplateVersion.find({ templateType: 'letter', templateId: req.params.id })
        .sort({ version: -1 })
        .limit(50)
        .lean(),
    )
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
  validate({
    body: z.object({
      phoneNumber: z
        .string()
        .trim()
        .regex(/^\+?\d{8,15}$/, 'Use digits only, including the country code (for example 2507XXXXXXXX)')
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await startWhatsapp(req.body.phoneNumber)
    await writeAudit({
      req,
      actor: req.auth,
      action: 'whatsapp.connect_requested',
      resourceType: 'WhatsappSession',
      after: { mode: req.body.phoneNumber ? 'pairing_code' : 'qr', status: result.status },
    })
    ok(res, result)
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
