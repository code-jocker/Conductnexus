import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, ok } from '../shared/http.js'
import { SyncLog } from '../models/governance.js'
import { Incident } from '../models/discipline.js'
import { createIncident } from '../services/incidents.service.js'
import { actorOf, objectId } from './helpers.js'

const draftSchema = z.object({
  localId: z.string().trim().min(1).max(120),
  studentId: objectId,
  offenceId: objectId,
  description: z.string().trim().min(10).max(4000),
  occurredAt: z.string().trim().min(4),
  location: z.string().trim().max(160).default(''),
  safeguardingFlag: z.boolean().optional(),
  clientSubmissionId: z.string().trim().min(4).max(120),
})

export const syncRouter = Router()
syncRouter.use(authenticate)

syncRouter.get(
  '/sync/time',
  asyncHandler(async (_req, res) => {
    ok(res, { serverTime: new Date(), timezone: 'Africa/Kigali' })
  }),
)

syncRouter.post(
  '/sync/incidents',
  requirePermission('incidents.create'),
  asyncHandler(async (req, res) => {
    const input = z.object({ drafts: z.array(draftSchema).min(1).max(50) }).parse(req.body)
    const results: { localId: string; status: 'synced' | 'conflict' | 'rejected'; incidentId?: string; reference?: string; error?: string }[] = []

    for (const draft of input.drafts) {
      try {
        const existing = await Incident.findOne({ clientSubmissionId: draft.clientSubmissionId }).select('incidentNumber').lean()
        if (existing) {
          results.push({ localId: draft.localId, status: 'synced', reference: existing.incidentNumber })
          await SyncLog.create({ userId: actorOf(req).userId, clientId: draft.localId, action: 'incident.create', resourceType: 'Incident', status: 'synced' })
          continue
        }
        const incident = await createIncident(
          actorOf(req),
          {
            studentId: draft.studentId,
            offenceId: draft.offenceId,
            description: draft.description,
            occurredAt: draft.occurredAt,
            location: draft.location,
            safeguardingFlag: draft.safeguardingFlag,
            clientSubmissionId: draft.clientSubmissionId,
          },
          req,
        )
        results.push({ localId: draft.localId, status: 'synced', incidentId: String(incident._id), reference: incident.incidentNumber })
        await SyncLog.create({ userId: actorOf(req).userId, clientId: draft.localId, action: 'incident.create', resourceType: 'Incident', resourceId: String(incident._id), status: 'synced' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed'
        const conflict = /already|duplicate|concurrently/i.test(message)
        results.push({ localId: draft.localId, status: conflict ? 'conflict' : 'rejected', error: message })
        await SyncLog.create({
          userId: actorOf(req).userId,
          clientId: draft.localId,
          action: 'incident.create',
          resourceType: 'Incident',
          status: conflict ? 'conflict' : 'rejected',
          conflictReason: message,
        })
      }
    }

    ok(res, { results, syncedAt: new Date() })
  }),
)
