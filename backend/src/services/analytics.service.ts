import { Types } from 'mongoose'
import { AuditLog } from '../models/governance.js'
import { Approval, DisciplineLedger, Incident } from '../models/discipline.js'
import { ClassModel, GuardianLink, Parent, Student } from '../models/school.js'
import { FollowUp, Intervention, Recognition } from '../models/support.js'
import { Letter, MessageQueue, Meeting, Notification } from '../models/communications.js'
import { Role, User } from '../models/core.js'
import { hasPermission, visibleStudentQuery, type AuthContext } from './rbac.service.js'
import { visibleIncidentFilter } from './incidents.service.js'
import { pendingApprovalsFor } from './approvals.service.js'
import { queueStatusCounts, whatsappStatus } from './communication.service.js'

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  HEADTEACHER: 'Headteacher',
  TEACHER: 'Teacher',
  DEPUTY_DISCIPLINE: 'Deputy Headteacher — Discipline',
  IT: 'IT Officer',
  PATRON: 'Patron',
  MATRON: 'Matron',
  BURSAR: 'Bursar',
  DOS: 'Dean of Studies',
  LIBRARIAN: 'Librarian',
  SECRETARY: 'Secretary',
  PARENT: 'Parent / Guardian',
}

const PRIMARY_ORDER = ['ADMIN', 'HEADTEACHER', 'DEPUTY_DISCIPLINE', 'DOS', 'TEACHER', 'PATRON', 'MATRON', 'SECRETARY', 'IT', 'LIBRARIAN', 'BURSAR', 'PARENT']

export async function dashboardFor(ctx: AuthContext) {
  const primaryRole = PRIMARY_ORDER.find((r) => ctx.roles.includes(r)) ?? ctx.roles[0] ?? 'TEACHER'
  const studentFilter = await visibleStudentQuery(ctx)
  const incidentFilter = await visibleIncidentFilter(ctx)
  const since14 = new Date(Date.now() - 13 * 86_400_000)
  since14.setUTCHours(0, 0, 0, 0)

  const [
    totalStudents,
    highRiskStudents,
    criticalStudents,
    totalIncidents,
    pendingReview,
    myIncidents,
    openInterventions,
    upcomingFollowUps,
    pendingApprovals,
  ] = await Promise.all([
    Student.countDocuments({ ...studentFilter, status: 'active' }),
    Student.countDocuments({ ...studentFilter, riskLevel: { $in: ['orange', 'red'] } }),
    Student.countDocuments({ ...studentFilter, riskLevel: 'red' }),
    Incident.countDocuments({ ...incidentFilter, status: { $ne: 'draft' } }),
    Incident.countDocuments({ ...incidentFilter, status: { $in: ['submitted', 'under_review', 'escalated'] } }),
    Incident.countDocuments({ reportedBy: ctx.userId, status: { $ne: 'draft' } }),
    Intervention.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    FollowUp.find({ assignedTo: ctx.userId, status: 'pending' }).sort({ dueDate: 1 }).limit(5).lean(),
    pendingApprovalsFor(ctx),
  ])

  const [recentIncidents, highRiskList, riskAgg, incidentAgg, ledgerAgg, classList] = await Promise.all([
    Incident.find({ ...incidentFilter, status: { $ne: 'draft' } })
      .sort({ occurredAt: -1 })
      .limit(8)
      .select('incidentNumber studentSnapshot offenceSnapshot severity status occurredAt reportedBy')
      .lean(),
    Student.find({ ...studentFilter, riskLevel: { $in: ['orange', 'red'] } })
      .sort({ currentBalance: 1 })
      .limit(8)
      .select('fullName studentId currentBalance riskLevel classId dormitoryId')
      .lean(),
    Student.aggregate([
      { $match: { ...studentFilter, status: 'active' } },
      { $group: { _id: '$riskLevel', count: { $sum: 1 } } },
    ]),
    Incident.aggregate([
      { $match: { ...incidentFilter, status: { $ne: 'draft' }, occurredAt: { $gte: since14 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'Africa/Kigali' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    DisciplineLedger.aggregate([
      { $match: { createdAt: { $gte: since14 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Kigali' } }, deductions: { $sum: { $cond: [{ $lt: ['$change', 0] }, { $abs: '$change' }, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    ClassModel.find({ active: true }).sort({ order: 1 }).select('name').lean(),
  ])

  const riskCounts: Record<string, number> = { green: 0, yellow: 0, orange: 0, red: 0 }
  for (const r of riskAgg) riskCounts[r._id as string] = r.count
  const classAverages = await Promise.all(
    classList.slice(0, 8).map(async (c) => {
      const rows = await Student.aggregate([
        { $match: { ...studentFilter, classId: c._id, status: 'active' } },
        { $group: { _id: null, avg: { $avg: '$currentBalance' }, count: { $sum: 1 } } },
      ])
      return { name: c.name, average: rows[0] ? Math.round(rows[0].avg * 10) / 10 : 0, students: rows[0]?.count ?? 0 }
    }),
  )

  const trend: { date: string; incidents: number; deductions: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000)
    const key = d.toISOString().slice(0, 10)
    trend.push({
      date: key,
      incidents: incidentAgg.find((x) => x._id === key)?.count ?? 0,
      deductions: ledgerAgg.find((x) => x._id === key)?.deductions ?? 0,
    })
  }

  const extra: Record<string, unknown> = {}
  if (hasPermission(ctx, 'users.view')) {
    const [totalUsers, activeUsers, roleCount] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: 'active' }),
      Role.countDocuments(),
    ])
    extra.users = { total: totalUsers, active: activeUsers, roles: roleCount }
  }
  if (hasPermission(ctx, 'audit.view')) {
    extra.recentAudit = await AuditLog.find().sort({ createdAt: -1 }).limit(8).select('actorName action resourceType createdAt').lean()
  }
  if (hasPermission(ctx, 'notifications.manage') || hasPermission(ctx, 'whatsapp.manage')) {
    extra.queue = await queueStatusCounts()
    if (hasPermission(ctx, 'whatsapp.manage')) extra.whatsapp = await whatsappStatus()
  }
  if (hasPermission(ctx, 'safeguarding.view')) {
    const { SafeguardingCase } = await import('../models/governance.js')
    extra.safeguarding = {
      open: await SafeguardingCase.countDocuments({ status: { $in: ['open', 'under_review', 'referred', 'escalated'] } }),
      critical: await SafeguardingCase.countDocuments({ severity: 'critical', status: { $ne: 'closed' } }),
    }
  }
  if (hasPermission(ctx, 'investigations.view')) {
    const { Investigation } = await import('../models/governance.js')
    extra.investigations = { open: await Investigation.countDocuments({ status: { $ne: 'closed' } }) }
  }
  if (hasPermission(ctx, 'appeals.view')) {
    const { Appeal } = await import('../models/governance.js')
    extra.appeals = { pending: await Appeal.countDocuments({ status: { $in: ['submitted', 'under_review'] } }) }
  }
  if (hasPermission(ctx, 'letters.view')) {
    extra.letters = await Letter.find().sort({ createdAt: -1 }).limit(5).select('reference type status studentSnapshot createdAt').lean()
  }
  if (hasPermission(ctx, 'parents.view')) {
    extra.parents = { total: await Parent.countDocuments() }
  }
  if (hasPermission(ctx, 'recognition.view')) {
    extra.recentRecognition = await Recognition.find().sort({ awardedAt: -1 }).limit(5).populate('studentId', 'fullName').lean()
    extra.openPlans = await Intervention.countDocuments({ type: 'behaviour_plan', status: { $in: ['open', 'in_progress'] } })
  }
  if (hasPermission(ctx, 'meetings.view')) {
    extra.upcomingMeetings = await Meeting.find({ scheduledAt: { $gte: new Date() }, status: 'scheduled' })
      .sort({ scheduledAt: 1 })
      .limit(5)
      .select('reference title type scheduledAt studentId')
      .lean()
  }
  extra.unreadNotifications = await Notification.countDocuments({ userId: ctx.userId, readAt: { $exists: false } })

  let portalChildren: unknown[] = []
  if (hasPermission(ctx, 'portal.view_children')) {
    const parent = await Parent.findOne({ portalUserId: ctx.userId }).lean()
    if (parent) {
      const links = await GuardianLink.find({ parentId: parent._id }).populate<{ studentId: { _id: Types.ObjectId; fullName: string; studentId: string; currentBalance: number; riskLevel: string; classId: Types.ObjectId; status: string } }>('studentId').lean()
      portalChildren = await Promise.all(
        links
          .filter((l) => l.studentId)
          .map(async (l) => {
            const s = l.studentId
            const cls = await ClassModel.findById(s.classId).lean()
            return {
              id: String(s._id),
              name: s.fullName,
              studentId: s.studentId,
              className: cls?.name ?? '',
              balance: s.currentBalance,
              risk: s.riskLevel,
              status: s.status,
            }
          }),
      )
    }
  }

  return {
    role: primaryRole,
    roleLabel: ROLE_LABELS[primaryRole] ?? primaryRole,
    roles: ctx.roles,
    user: ctx.user,
    metrics: {
      students: totalStudents,
      highRisk: highRiskStudents,
      critical: criticalStudents,
      incidents: totalIncidents,
      pendingReview,
      pendingApprovals: pendingApprovals.length,
      myIncidents,
      openInterventions,
      upcomingFollowUps: upcomingFollowUps.length,
    },
    charts: {
      trend,
      riskDistribution: riskCounts,
      classAverages,
    },
    lists: {
      recentIncidents,
      highRiskStudents: highRiskList,
      pendingApprovals: pendingApprovals.slice(0, 5),
      upcomingFollowUps,
    },
    portalChildren,
    extra,
    generatedAt: new Date(),
  }
}

export async function incidentAnalytics() {
  const byDay = await Incident.aggregate([
    { $match: { status: { $ne: 'draft' }, occurredAt: { $gte: new Date(Date.now() - 90 * 86_400_000) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'Africa/Kigali' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  const byOffence = await Incident.aggregate([
    { $match: { status: { $ne: 'draft' } } },
    { $group: { _id: '$offenceSnapshot.name', count: { $sum: 1 }, marks: { $sum: '$offenceSnapshot.deduction' } } },
    { $sort: { count: -1 } },
    { $limit: 15 },
  ])
  const bySeverity = await Incident.aggregate([{ $match: { status: { $ne: 'draft' } } }, { $group: { _id: '$severity', count: { $sum: 1 } } }])
  const approvalTimeline = await Approval.aggregate([
    { $match: { type: 'incident', decidedAt: { $exists: true } } },
    { $project: { hours: { $divide: [{ $subtract: ['$decidedAt', '$createdAt'] }, 3_600_000] } } },
    { $group: { _id: null, averageHours: { $avg: '$hours' }, count: { $sum: 1 } } },
  ])
  return {
    byDay: byDay.map((r) => ({ date: r._id, count: r.count })),
    byOffence: byOffence.map((r) => ({ name: r._id, count: r.count, marks: r.marks })),
    bySeverity: Object.fromEntries(bySeverity.map((r) => [r._id, r.count])),
    approval: approvalTimeline[0] ? { averageHours: Math.round(approvalTimeline[0].averageHours * 10) / 10, decisions: approvalTimeline[0].count } : { averageHours: 0, decisions: 0 },
  }
}

export async function conductAnalytics() {
  const distribution = await Student.aggregate([
    { $match: { status: 'active' } },
    { $bucketAuto: { groupBy: '$currentBalance', buckets: 8 } },
  ])
  const risk = await Student.aggregate([{ $match: { status: 'active' } }, { $group: { _id: '$riskLevel', count: { $sum: 1 } } }])
  const deductionsByCategory = await DisciplineLedger.aggregate([
    { $match: { change: { $lt: 0 } } },
    { $group: { _id: '$type', total: { $sum: { $abs: '$change' } }, count: { $sum: 1 } } },
  ])
  return {
    distribution: distribution.map((b) => ({ min: b._id.min, max: b._id.max, count: b.count })),
    risk: Object.fromEntries(risk.map((r) => [r._id, r.count])),
    byType: Object.fromEntries(deductionsByCategory.map((r) => [r._id, { total: r.total, count: r.count }])),
  }
}
