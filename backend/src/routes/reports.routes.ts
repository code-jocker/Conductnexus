import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { ok, validate } from '../shared/http.js'
import { asyncHandler } from '../shared/http.js'
import { dashboardFor, incidentAnalytics, conductAnalytics } from '../services/analytics.service.js'
import {
  termReport,
  yearEndReport,
  highRiskReport,
  classReport,
  teacherActivityReport,
  communicationReport,
  toCsv,
  type ReportFilters,
} from '../services/reports.service.js'
import { objectId } from './helpers.js'

const filtersSchema = z.object({
  termId: objectId.optional(),
  academicYearId: objectId.optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  classId: objectId.optional(),
  streamId: objectId.optional(),
  dormitoryId: objectId.optional(),
})

type ReportKind = 'term' | 'year-end' | 'high-risk' | 'class' | 'teacher-activity' | 'communication'

const REPORTS: Record<
  ReportKind,
  { permission: string; run: (f: ReportFilters) => Promise<unknown> }
> = {
  term: { permission: 'reports.view', run: termReport },
  'year-end': { permission: 'reports.view', run: yearEndReport },
  'high-risk': { permission: 'reports.view', run: highRiskReport },
  class: { permission: 'reports.view', run: classReport },
  'teacher-activity': { permission: 'reports.view', run: teacherActivityReport },
  communication: { permission: 'reports.view', run: communicationReport },
}

function flatten(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v]),
    ),
  )
}

export const reportsRouter = Router()
reportsRouter.use(authenticate)

reportsRouter.get(
  '/analytics/dashboard',
  asyncHandler(async (req, res) => {
    ok(res, await dashboardFor(req.auth!))
  }),
)

reportsRouter.get(
  '/analytics/incidents',
  requirePermission('analytics.view'),
  asyncHandler(async (_req, res) => {
    ok(res, await incidentAnalytics())
  }),
)

reportsRouter.get(
  '/analytics/conduct',
  requirePermission('analytics.view'),
  asyncHandler(async (_req, res) => {
    ok(res, await conductAnalytics())
  }),
)

reportsRouter.get(
  '/reports/:kind',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const kind = String(req.params.kind) as ReportKind
    const report = REPORTS[kind]
    if (!report) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Unknown report "${kind}"` } })
      return
    }
    const query = filtersSchema.parse(req.query)
    ok(res, await report.run(query as ReportFilters))
  }),
)

reportsRouter.get(
  '/reports/:kind/export',
  requirePermission('reports.export'),
  asyncHandler(async (req, res) => {
    const kind = String(req.params.kind) as ReportKind
    const report = REPORTS[kind]
    if (!report) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Unknown report "${kind}"` } })
      return
    }
    const query = filtersSchema.parse(req.query)
    const data = (await report.run(query as ReportFilters)) as Record<string, unknown>
    const rows =
      (data.students as Record<string, unknown>[] | undefined) ??
      (data.classes as Record<string, unknown>[] | undefined) ??
      (data.teachers as Record<string, unknown>[] | undefined) ??
      (data.recent as Record<string, unknown>[] | undefined) ??
      (data.terms as Record<string, unknown>[] | undefined) ??
      []
    const csv = toCsv(flatten(rows))
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="conductnexus-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(csv)
  }),
)
