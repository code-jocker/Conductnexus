import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, ok, parsePagination, pagedMeta, queryOf } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { getSettings } from '../models/core.js'
import { emailConfigured, whatsappAvailable } from '../config/env.js'
import { AccessLog, AuditLog, BackupRecord, DataBreach, DataRequest, SyncLog } from '../models/governance.js'
import { nextRef } from '../shared/refs.js'
import { writeAudit } from '../services/audit.service.js'
import { backupFile, cleanupOldBackups, restoreTest, runBackup } from '../services/backup.service.js'
import { refreshCommsSettings } from '../services/communication.service.js'
import { ledgerHealth, pendingQueueFailures, recentErrors, systemSnapshot } from '../services/monitoring.service.js'
import { actorOf, idOf, objectId, searchRegex } from './helpers.js'

const settingsPatchSchema = z
  .object({
    school: z
      .object({
        name: z.string().trim().max(160).optional(),
        shortName: z.string().trim().max(24).optional(),
        motto: z.string().trim().max(240).optional(),
        address: z.string().trim().max(240).optional(),
        phone: z.string().trim().max(32).optional(),
        email: z.string().trim().email().optional().or(z.literal('')),
        website: z.string().trim().max(160).optional(),
        logoUrl: z.string().trim().max(500).optional(),
      })
      .optional(),
    academic: z
      .object({
        startingMarks: z.number().int().min(1).max(200).optional(),
        timezone: z.string().trim().max(64).optional(),
        language: z.enum(['en', 'rw']).optional(),
        currency: z.string().trim().max(8).optional(),
      })
      .optional(),
    discipline: z
      .object({
        requireReview: z.boolean().optional(),
        autoApproveSeverities: z.array(z.enum(['minor', 'moderate', 'serious', 'critical'])).optional(),
        highImpactDeduction: z.number().int().min(1).max(40).optional(),
        maxBackdatingDays: z.number().int().min(0).max(365).optional(),
      })
      .optional(),
    risk: z
      .object({
        thresholds: z
          .object({
            green: z.number().int().min(1).optional(),
            yellow: z.number().int().min(1).optional(),
            orange: z.number().int().min(1).optional(),
          })
          .optional(),
        seriousRecentDays: z.number().int().min(1).max(365).optional(),
        repeatOffenceThreshold: z.number().int().min(1).max(20).optional(),
      })
      .optional(),
    comms: z
      .object({
        whatsappEnabled: z.boolean().optional(),
        smsEnabled: z.boolean().optional(),
        quietHoursStart: z.number().int().min(0).max(23).optional(),
        quietHoursEnd: z.number().int().min(0).max(23).optional(),
        retryLimit: z.number().int().min(0).max(10).optional(),
        notifyOnDeduction: z.boolean().optional(),
      })
      .optional(),
    backup: z
      .object({
        schedule: z.string().trim().max(64).optional(),
        retentionDays: z.number().int().min(1).max(3650).optional(),
        rpoHours: z.number().int().min(1).max(168).optional(),
        rtoHours: z.number().int().min(1).max(168).optional(),
      })
      .optional(),
    retention: z
      .object({
        studentRecordsYears: z.number().int().min(1).max(50).optional(),
        disciplineYears: z.number().int().min(1).max(50).optional(),
        evidenceYears: z.number().int().min(1).max(50).optional(),
        auditYears: z.number().int().min(1).max(50).optional(),
        safeguardingYears: z.number().int().min(1).max(50).optional(),
      })
      .optional(),
    security: z
      .object({
        maxFailedLogins: z.number().int().min(3).max(20).optional(),
        lockoutMinutes: z.number().int().min(1).max(240).optional(),
        sessionDays: z.number().int().min(1).max(90).optional(),
        requireEmailVerification: z.boolean().optional(),
        requireTwoFactor: z.boolean().optional(),
      })
      .optional(),
  })
  .strict()

export const adminRouter = Router()
adminRouter.use(authenticate)

adminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    ok(res, await getSettings())
  }),
)

adminRouter.patch(
  '/settings',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const patch = settingsPatchSchema.parse(req.body)
    // A school-wide 2FA requirement with no way to deliver codes would lock
    // every user out at the next sign-in, so refuse the setting instead.
    if (patch.security?.requireTwoFactor === true && !emailConfigured && !whatsappAvailable) {
      throw ApiError.badRequest(
        'Configure email (SMTP or Gmail OAuth2) or WhatsApp before requiring two-factor authentication, otherwise users cannot receive sign-in codes.',
      )
    }
    const settings = await getSettings()
    const before = settings.toObject()
    for (const [group, value] of Object.entries(patch)) {
      if (!value) continue
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue
        if (group === 'risk' && key === 'thresholds') {
          for (const [threshold, amount] of Object.entries(entry as Record<string, number | undefined>)) {
            if (amount !== undefined) settings.set(`risk.thresholds.${threshold}`, amount)
          }
        } else {
          settings.set(`${group}.${key}`, entry)
        }
      }
    }
    await settings.save()
    await refreshCommsSettings()
    await writeAudit({
      req,
      actor: actorOf(req),
      action: 'settings.updated',
      resourceType: 'Settings',
      resourceId: String(settings._id),
      before: { school: before.school, discipline: before.discipline, risk: before.risk, comms: before.comms },
      after: patch,
    })
    ok(res, settings)
  }),
)

adminRouter.get(
  '/audit-logs',
  requirePermission('audit.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(queryOf(req) as Record<string, unknown>)
    const q = queryOf<Record<string, string | undefined>>(req)
    const match: Record<string, unknown> = {}
    if (q.action) match.action = new RegExp(String(q.action).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    if (q.resourceType) match.resourceType = String(q.resourceType)
    if (q.resourceId) match.resourceId = String(q.resourceId)
    if (q.actorId && Types.ObjectId.isValid(String(q.actorId))) match.actorId = new Types.ObjectId(String(q.actorId))
    if (q.from || q.to) {
      match.createdAt = {
        ...(q.from ? { $gte: new Date(String(q.from)) } : {}),
        ...(q.to ? { $lte: new Date(String(q.to)) } : {}),
      }
    }
    const search = searchRegex(q.q ? String(q.q) : undefined)
    if (search) match.$or = [{ actorName: search }, { action: search }, { resourceType: search }]
    const [rows, total] = await Promise.all([
      AuditLog.find(match).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      AuditLog.countDocuments(match),
    ])
    ok(res, rows, pagedMeta(total, page, pageSize))
  }),
)

adminRouter.get(
  '/audit-logs/:id',
  requirePermission('audit.view'),
  asyncHandler(async (req, res) => {
    const log = await AuditLog.findById(idOf(req)).lean()
    if (!log) throw ApiError.notFound('Audit entry not found')
    ok(res, log)
  }),
)

adminRouter.get(
  '/backups',
  requirePermission('backups.manage'),
  asyncHandler(async (_req, res) => {
    const [records, settings] = await Promise.all([
      BackupRecord.find().sort({ createdAt: -1 }).limit(100).lean(),
      getSettings(),
    ])
    ok(res, { backups: records, policy: settings.backup })
  }),
)

adminRouter.post(
  '/backups',
  requirePermission('backups.manage'),
  asyncHandler(async (req, res) => {
    const result = await runBackup(actorOf(req))
    res.status(201)
    ok(res, result)
  }),
)

adminRouter.post(
  '/backups/cleanup',
  requirePermission('backups.manage'),
  asyncHandler(async (req, res) => {
    const removed = await cleanupOldBackups()
    await writeAudit({ req, actor: actorOf(req), action: 'backup.cleanup', resourceType: 'BackupRecord', after: { removed } })
    ok(res, { removed })
  }),
)

adminRouter.post(
  '/backups/:id/restore-test',
  requirePermission('backups.manage'),
  asyncHandler(async (req, res) => {
    ok(res, await restoreTest(idOf(req), actorOf(req)))
  }),
)

adminRouter.get(
  '/backups/:id/download',
  requirePermission('backups.manage'),
  asyncHandler(async (req, res) => {
    const { record, stream } = await backupFile(idOf(req))
    await writeAudit({ req, actor: actorOf(req), action: 'backup.downloaded', resourceType: 'BackupRecord', resourceId: String(record._id) })
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`)
    stream.pipe(res)
  }),
)

adminRouter.get(
  '/system/health',
  requirePermission('system.monitor'),
  asyncHandler(async (_req, res) => {
    ok(res, await systemSnapshot())
  }),
)

adminRouter.get(
  '/system/errors',
  requirePermission('system.monitor'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50)
    ok(res, await recentErrors(limit))
  }),
)

adminRouter.get(
  '/system/queue-failures',
  requirePermission('system.monitor'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50)
    ok(res, await pendingQueueFailures(limit))
  }),
)

adminRouter.get(
  '/system/ledger-health',
  requirePermission('system.monitor'),
  asyncHandler(async (_req, res) => {
    ok(res, await ledgerHealth())
  }),
)

adminRouter.get(
  '/data-protection/requests',
  requirePermission('data_protection.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(queryOf(req) as Record<string, unknown>)
    const q = queryOf<Record<string, string | undefined>>(req)
    const match: Record<string, unknown> = {}
    if (q.status) match.status = String(q.status)
    if (q.type) match.type = String(q.type)
    const [rows, total] = await Promise.all([
      DataRequest.find(match).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      DataRequest.countDocuments(match),
    ])
    ok(res, rows, pagedMeta(total, page, pageSize))
  }),
)

const dataRequestSchema = z.object({
  type: z.enum(['correction', 'access', 'objection', 'erasure']),
  requesterName: z.string().trim().min(2).max(160),
  requesterContact: z.string().trim().min(5).max(160),
  studentId: objectId.optional(),
  details: z.string().trim().min(10).max(4000),
  dueInDays: z.number().int().min(1).max(90).optional(),
})

adminRouter.post(
  '/data-protection/requests',
  requirePermission('data_protection.manage'),
  asyncHandler(async (req, res) => {
    const input = dataRequestSchema.parse(req.body)
    const request = await DataRequest.create({
      requestNumber: await nextRef('DSR', 4),
      type: input.type,
      requesterName: input.requesterName,
      requesterContact: input.requesterContact,
      studentId: input.studentId ? new Types.ObjectId(input.studentId) : undefined,
      details: input.details,
      dueDate: new Date(Date.now() + (input.dueInDays ?? 30) * 86_400_000),
    })
    await writeAudit({ req, actor: actorOf(req), action: 'data_request.created', resourceType: 'DataRequest', resourceId: String(request._id), after: { type: input.type, requester: input.requesterName } })
    res.status(201)
    ok(res, request)
  }),
)

adminRouter.patch(
  '/data-protection/requests/:id',
  requirePermission('data_protection.manage'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        status: z.enum(['received', 'under_review', 'approved', 'rejected', 'completed']).optional(),
        decision: z.string().trim().max(4000).optional(),
      })
      .parse(req.body)
    const request = await DataRequest.findById(idOf(req))
    if (!request) throw ApiError.notFound('Data request not found')
    if (input.status) {
      request.status = input.status
      if (input.status === 'completed' || input.status === 'rejected') {
        request.completedAt = new Date()
        request.handledBy = actorOf(req).userId
      }
    }
    if (input.decision !== undefined) request.decision = input.decision
    await request.save()
    await writeAudit({ req, actor: actorOf(req), action: 'data_request.updated', resourceType: 'DataRequest', resourceId: String(request._id), after: input })
    ok(res, request)
  }),
)

adminRouter.get(
  '/data-protection/breaches',
  requirePermission('data_protection.view'),
  asyncHandler(async (_req, res) => {
    ok(res, await DataBreach.find().sort({ discoveredAt: -1 }).limit(200).lean())
  }),
)

adminRouter.post(
  '/data-protection/breaches',
  requirePermission('data_protection.breaches'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(4).max(200),
        description: z.string().trim().min(10).max(8000),
        discoveredAt: z.coerce.date().optional(),
        severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        affectedRecords: z.number().int().min(0).max(1_000_000).optional(),
        dataCategories: z.array(z.string().trim().max(80)).max(20).optional(),
      })
      .parse(req.body)
    const breach = await DataBreach.create({
      breachNumber: await nextRef('BRC', 4),
      title: input.title,
      description: input.description,
      discoveredAt: input.discoveredAt ?? new Date(),
      severity: input.severity ?? 'medium',
      affectedRecords: input.affectedRecords ?? 0,
      dataCategories: input.dataCategories ?? [],
      handledBy: actorOf(req).userId,
    })
    await writeAudit({ req, actor: actorOf(req), action: 'data_breach.reported', resourceType: 'DataBreach', resourceId: String(breach._id), after: { severity: breach.severity } })
    res.status(201)
    ok(res, breach)
  }),
)

adminRouter.patch(
  '/data-protection/breaches/:id',
  requirePermission('data_protection.breaches'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        containment: z.string().trim().max(8000).optional(),
        status: z.enum(['open', 'contained', 'closed']).optional(),
        reportedToAuthority: z.boolean().optional(),
        individualsNotified: z.boolean().optional(),
      })
      .parse(req.body)
    const breach = await DataBreach.findById(idOf(req))
    if (!breach) throw ApiError.notFound('Breach record not found')
    if (input.containment !== undefined) breach.containment = input.containment
    if (input.status) breach.status = input.status
    if (input.individualsNotified !== undefined) breach.individualsNotified = input.individualsNotified
    if (input.reportedToAuthority !== undefined) {
      breach.reportedToAuthority = input.reportedToAuthority
      if (input.reportedToAuthority && !breach.authorityNotifiedAt) breach.authorityNotifiedAt = new Date()
    }
    await breach.save()
    await writeAudit({ req, actor: actorOf(req), action: 'data_breach.updated', resourceType: 'DataBreach', resourceId: String(breach._id), after: input })
    ok(res, breach)
  }),
)

adminRouter.get(
  '/data-protection/access-log',
  requirePermission('data_protection.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(queryOf(req) as Record<string, unknown>)
    const q = queryOf<Record<string, string | undefined>>(req)
    const match: Record<string, unknown> = {}
    if (q.resourceType) match.resourceType = String(q.resourceType)
    if (q.resourceId) match.resourceId = String(q.resourceId)
    if (q.userId && Types.ObjectId.isValid(String(q.userId))) match.userId = new Types.ObjectId(String(q.userId))
    const [rows, total] = await Promise.all([
      AccessLog.find(match).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      AccessLog.countDocuments(match),
    ])
    ok(res, rows, pagedMeta(total, page, pageSize))
  }),
)

adminRouter.get(
  '/sync-log',
  requirePermission('system.monitor'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(queryOf(req) as Record<string, unknown>)
    const [rows, total] = await Promise.all([
      SyncLog.find().sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      SyncLog.countDocuments(),
    ])
    ok(res, rows, pagedMeta(total, page, pageSize))
  }),
)

adminRouter.get(
  '/permissions-catalog',
  requirePermission('permissions.manage'),
  asyncHandler(async (_req, res) => {
    const { PERMISSIONS } = await import('../shared/permissions.js')
    ok(res, PERMISSIONS)
  }),
)
