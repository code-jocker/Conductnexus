import { Types } from 'mongoose'
import { DisciplineLedger, Incident } from '../models/discipline.js'
import { ClassModel, Dormitory, Student, Stream, Term, AcademicYear } from '../models/school.js'
import { FollowUp, Intervention } from '../models/support.js'
import { MessageQueue } from '../models/communications.js'
import { User } from '../models/core.js'

export type ReportFilters = {
  termId?: string
  academicYearId?: string
  from?: string
  to?: string
  classId?: string
  streamId?: string
  dormitoryId?: string
}

async function resolveScope(filters: ReportFilters) {
  const studentMatch: Record<string, unknown> = { status: { $in: ['active', 'suspended'] } }
  if (filters.classId) studentMatch.classId = new Types.ObjectId(filters.classId)
  if (filters.streamId) studentMatch.streamId = new Types.ObjectId(filters.streamId)
  if (filters.dormitoryId) studentMatch.dormitoryId = new Types.ObjectId(filters.dormitoryId)
  if (filters.academicYearId) studentMatch.academicYearId = new Types.ObjectId(filters.academicYearId)
  const students = await Student.find(studentMatch).select('_id classId streamId dormitoryId currentBalance riskLevel fullName studentId status').lean()
  const studentIds = students.map((s) => s._id)

  const incidentMatch: Record<string, unknown> = { studentId: { $in: studentIds } }
  if (filters.termId) {
    incidentMatch.termId = new Types.ObjectId(filters.termId)
    const term = await Term.findById(filters.termId).lean()
    if (term && !filters.academicYearId) incidentMatch.academicYearId = term.academicYearId
  } else if (filters.academicYearId) {
    const terms = await Term.find({ academicYearId: filters.academicYearId }).select('_id').lean()
    incidentMatch.termId = { $in: terms.map((t) => t._id) }
  }
  if (filters.from || filters.to) {
    incidentMatch.occurredAt = {
      ...(filters.from ? { $gte: new Date(filters.from) } : {}),
      ...(filters.to ? { $lte: new Date(filters.to) } : {}),
    }
  }

  const ledgerMatch: Record<string, unknown> = { studentId: { $in: studentIds } }
  if (filters.termId) ledgerMatch.termId = new Types.ObjectId(filters.termId)
  else if (incidentMatch.termId) ledgerMatch.termId = incidentMatch.termId
  if (filters.from || filters.to) {
    ledgerMatch.createdAt = {
      ...(filters.from ? { $gte: new Date(filters.from) } : {}),
      ...(filters.to ? { $lte: new Date(filters.to) } : {}),
    }
  }
  return { students, studentIds, incidentMatch, ledgerMatch }
}

export async function termReport(filters: ReportFilters) {
  const scope = await resolveScope(filters)
  const [incidents, ledger, term, classes] = await Promise.all([
    Incident.find(scope.incidentMatch).lean(),
    DisciplineLedger.find(scope.ledgerMatch).lean(),
    filters.termId ? Term.findById(filters.termId).populate('academicYearId').lean() : Term.findOne({ isActive: true }).populate('academicYearId').lean(),
    ClassModel.find({ active: true }).sort({ order: 1 }).lean(),
  ])

  const deductions = ledger.filter((l) => l.change < 0).reduce((s, l) => s + Math.abs(l.change), 0)
  const rewards = ledger.filter((l) => l.type === 'reward').reduce((s, l) => s + l.change, 0)
  const riskCounts = { green: 0, yellow: 0, orange: 0, red: 0 }
  for (const s of scope.students) riskCounts[s.riskLevel]++

  const offenceCounts = new Map<string, { name: string; count: number; marks: number }>()
  for (const i of incidents) {
    const key = i.offenceSnapshot?.name ?? 'Unknown'
    const current = offenceCounts.get(key) ?? { name: key, count: 0, marks: 0 }
    current.count++
    current.marks += i.offenceSnapshot?.deduction ?? 0
    offenceCounts.set(key, current)
  }

  const classStats = classes.map((c) => {
    const list = scope.students.filter((s) => String(s.classId) === String(c._id))
    const ids = new Set(list.map((s) => String(s._id)))
    const inc = incidents.filter((i) => ids.has(String(i.studentId)))
    return {
      classId: String(c._id),
      name: c.name,
      students: list.length,
      incidents: inc.length,
      averageBalance: list.length ? Math.round((list.reduce((s, x) => s + x.currentBalance, 0) / list.length) * 10) / 10 : 0,
      risk: {
        green: list.filter((s) => s.riskLevel === 'green').length,
        yellow: list.filter((s) => s.riskLevel === 'yellow').length,
        orange: list.filter((s) => s.riskLevel === 'orange').length,
        red: list.filter((s) => s.riskLevel === 'red').length,
      },
    }
  })

  return {
    term: term ? { id: String(term._id), name: term.name, academicYear: (term.academicYearId as unknown as { name?: string })?.name ?? '' } : null,
    studentCount: scope.students.length,
    totalIncidents: incidents.length,
    totalDeductions: deductions,
    totalRewards: rewards,
    goodStanding: riskCounts.green,
    attention: riskCounts.yellow,
    highRisk: riskCounts.orange,
    criticalRisk: riskCounts.red,
    riskDistribution: riskCounts,
    pendingCases: incidents.filter((i) => ['submitted', 'under_review', 'escalated'].includes(i.status)).length,
    resolvedCases: incidents.filter((i) => ['approved', 'resolved', 'closed'].includes(i.status)).length,
    rejectedCases: incidents.filter((i) => i.status === 'rejected').length,
    offenceBreakdown: [...offenceCounts.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    classStats,
    generatedAt: new Date(),
  }
}

export async function yearEndReport(filters: ReportFilters) {
  const year = filters.academicYearId
    ? await AcademicYear.findById(filters.academicYearId).lean()
    : await AcademicYear.findOne({ isActive: true }).lean()
  if (!year) return { academicYear: null, terms: [], comparisons: [], generatedAt: new Date() }
  const terms = await Term.find({ academicYearId: year._id }).sort({ number: 1 }).lean()
  const termReports = []
  for (const t of terms) {
    termReports.push(await termReport({ ...filters, academicYearId: String(year._id), termId: String(t._id) }))
  }
  const comparisons = termReports.map((r, idx) => ({
    term: terms[idx]?.name,
    incidents: r.totalIncidents,
    deductions: r.totalDeductions,
    rewards: r.totalRewards,
    highRisk: r.highRisk,
    critical: r.criticalRisk,
    averageConduct: r.studentCount ? Math.round(((r.studentCount * 40 - r.totalDeductions + r.totalRewards) / r.studentCount) * 10) / 10 : 0,
  }))

  const classes = await ClassModel.find({ active: true }).sort({ order: 1 }).lean()
  const streams = await Stream.find({ active: true }).lean()
  const dormitories = await Dormitory.find({ active: true }).lean()
  const students = await Student.find({ academicYearId: year._id, status: { $in: ['active', 'suspended'] } })
    .select('classId streamId dormitoryId currentBalance riskLevel')
    .lean()
  const compareGroups = (list: { _id: Types.ObjectId; name: string }[], field: 'classId' | 'streamId' | 'dormitoryId') =>
    list.map((g) => {
      const members = students.filter((s) => String(s[field]) === String(g._id))
      return {
        name: g.name,
        students: members.length,
        averageBalance: members.length ? Math.round((members.reduce((s, x) => s + x.currentBalance, 0) / members.length) * 10) / 10 : 0,
        highRisk: members.filter((s) => ['orange', 'red'].includes(s.riskLevel)).length,
      }
    })

  return {
    academicYear: { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate, status: year.status },
    terms: termReports,
    comparisons,
    classComparisons: compareGroups(classes, 'classId'),
    streamComparisons: compareGroups(streams, 'streamId'),
    dormitoryComparisons: compareGroups(dormitories, 'dormitoryId'),
    generatedAt: new Date(),
  }
}

export async function highRiskReport(filters: ReportFilters) {
  const scope = await resolveScope(filters)
  const riskStudents = scope.students.filter((s) => ['orange', 'red'].includes(s.riskLevel))
  const ids = riskStudents.map((s) => s._id)
  const [interventions, followUps, incidents] = await Promise.all([
    Intervention.find({ studentId: { $in: ids }, status: { $in: ['open', 'in_progress'] } }).populate('assignedTo', 'name').lean(),
    FollowUp.find({ studentId: { $in: ids }, status: 'pending' }).sort({ dueDate: 1 }).lean(),
    Incident.find({ studentId: { $in: ids }, ...(filters.termId ? { termId: new Types.ObjectId(filters.termId) } : {}) })
      .select('studentId occurredAt offenceSnapshot severity incidentNumber')
      .sort({ occurredAt: -1 })
      .lean(),
  ])
  return {
    students: riskStudents.map((s) => {
      const open = interventions.find((i) => String(i.studentId) === String(s._id))
      const next = followUps.find((f) => String(f.studentId) === String(s._id))
      const history = incidents.filter((i) => String(i.studentId) === String(s._id))
      return {
        studentId: String(s._id),
        name: s.fullName,
        admissionNumber: s.studentId,
        balance: s.currentBalance,
        risk: s.riskLevel,
        incidentCount: history.length,
        lastIncident: history[0]?.occurredAt ?? null,
        intervention: open ? { id: String(open._id), title: open.title, assignedTo: (open.assignedTo as unknown as { name?: string })?.name } : null,
        nextFollowUp: next?.dueDate ?? null,
        recentIncidents: history.slice(0, 5),
      }
    }),
    total: riskStudents.length,
    generatedAt: new Date(),
  }
}

export async function classReport(filters: ReportFilters) {
  const scope = await resolveScope(filters)
  const classes = await ClassModel.find({ active: true }).sort({ order: 1 }).lean()
  const incidents = await Incident.find(scope.incidentMatch).lean()
  return {
    classes: classes.map((c) => {
      const members = scope.students.filter((s) => String(s.classId) === String(c._id))
      const memberIds = new Set(members.map((m) => String(m._id)))
      const inc = incidents.filter((i) => memberIds.has(String(i.studentId)))
      const offenceCounts = new Map<string, number>()
      for (const i of inc) offenceCounts.set(i.offenceSnapshot?.name ?? 'Unknown', (offenceCounts.get(i.offenceSnapshot?.name ?? 'Unknown') ?? 0) + 1)
      return {
        class: c.name,
        classId: String(c._id),
        students: members.length,
        incidents: inc.length,
        averageConduct: members.length ? Math.round((members.reduce((s, x) => s + x.currentBalance, 0) / members.length) * 10) / 10 : 0,
        risk: {
          green: members.filter((s) => s.riskLevel === 'green').length,
          yellow: members.filter((s) => s.riskLevel === 'yellow').length,
          orange: members.filter((s) => s.riskLevel === 'orange').length,
          red: members.filter((s) => s.riskLevel === 'red').length,
        },
        outstandingCases: inc.filter((i) => ['submitted', 'under_review', 'escalated'].includes(i.status)).length,
        topOffences: [...offenceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      }
    }),
    generatedAt: new Date(),
  }
}

export async function teacherActivityReport(filters: ReportFilters) {
  const scope = await resolveScope(filters)
  const incidents = await Incident.find(scope.incidentMatch).select('reportedBy status').lean()
  const grouped = new Map<string, { submitted: number; approved: number; rejected: number; pending: number }>()
  for (const i of incidents) {
    const key = String(i.reportedBy)
    const g = grouped.get(key) ?? { submitted: 0, approved: 0, rejected: 0, pending: 0 }
    g.submitted++
    if (i.status === 'approved' || i.status === 'resolved' || i.status === 'closed') g.approved++
    else if (i.status === 'rejected') g.rejected++
    else if (['submitted', 'under_review', 'escalated'].includes(i.status)) g.pending++
    grouped.set(key, g)
  }
  const users = await User.find({ _id: { $in: [...grouped.keys()] } }).select('name email').lean()
  return {
    teachers: users
      .map((u) => ({ name: u.name, email: u.email, ...(grouped.get(String(u._id)) ?? { submitted: 0, approved: 0, rejected: 0, pending: 0 }) }))
      .sort((a, b) => b.submitted - a.submitted),
    generatedAt: new Date(),
  }
}

export async function communicationReport(filters: ReportFilters) {
  const match: Record<string, unknown> = {}
  if (filters.from || filters.to) {
    match.createdAt = {
      ...(filters.from ? { $gte: new Date(filters.from) } : {}),
      ...(filters.to ? { $lte: new Date(filters.to) } : {}),
    }
  }
  const messages = await MessageQueue.find(match).sort({ createdAt: -1 }).limit(5000).lean()
  const summary = { queued: 0, sent: 0, failed: 0, deadLetter: 0, manualReview: 0 }
  const byChannel: Record<string, number> = {}
  for (const m of messages) {
    if (m.status === 'sent') summary.sent++
    else if (m.status === 'failed') summary.failed++
    else if (m.status === 'dead_letter') summary.deadLetter++
    else if (m.status === 'manual_review') summary.manualReview++
    else summary.queued++
    byChannel[m.channel] = (byChannel[m.channel] ?? 0) + 1
  }
  return {
    summary,
    byChannel,
    recent: messages.slice(0, 100).map((m) => ({
      id: String(m._id),
      channel: m.channel,
      to: m.to.slice(0, 4) + '••••' + m.to.slice(-3),
      status: m.status,
      attempts: m.attempts,
      sentAt: m.sentAt,
      createdAt: m.createdAt,
      lastError: m.lastError,
    })),
    total: messages.length,
    generatedAt: new Date(),
  }
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return ''
  const keys = columns ?? Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [keys.join(','), ...rows.map((r) => keys.map((k) => escape(r[k])).join(','))].join('\r\n')
}
