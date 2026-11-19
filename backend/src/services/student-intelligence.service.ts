import { Types } from 'mongoose'
import { DisciplineLedger, Incident, RiskAssessment } from '../models/discipline.js'
import { Student } from '../models/school.js'
import { AttendanceRecord } from '../models/attendance.js'
import { FollowUp, Intervention, Recognition } from '../models/support.js'
import { CounsellingAppointment } from '../models/welfare.js'
import { hasPermission, type AuthContext } from './rbac.service.js'

const DAY = 86_400_000
const TREND_DAYS = 56
const WEEK = 7 * DAY

type WeeklyPoint = { weekStart: string; incidents: number; deductions: number; rewards: number }
type Recommendation = { key: string; title: string; detail: string; tone: 'emerald' | 'amber' | 'red' | 'brand' }

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function startOfWeek(date: Date) {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d
}

/**
 * Explainable student intelligence (audit P4).
 *
 * Every number is derived here and returned with its source, so staff can see
 * why a recommendation was made. The output is advisory only — nothing in this
 * service writes a sanction, ledger entry or risk decision.
 */
export async function buildStudentIntelligence(
  studentId: Types.ObjectId | string,
  ctx: AuthContext,
  termId?: Types.ObjectId,
) {
  const student = await Student.findById(studentId).populate('classId', 'name').lean()
  if (!student) return null

  const now = new Date()
  const currentStart = new Date(now.getTime() - TREND_DAYS * DAY)
  const previousStart = new Date(now.getTime() - TREND_DAYS * 2 * DAY)
  const attendanceStart = isoDay(new Date(now.getTime() - 30 * DAY))
  const recentCutoff = new Date(now.getTime() - 21 * DAY)

  const [incidents, ledger, recognitions, attendance, interventions, followUps, assessments] = await Promise.all([
    Incident.find({
      studentId: student._id,
      occurredAt: { $gte: previousStart },
      status: { $in: ['approved', 'resolved', 'closed', 'escalated'] },
    })
      .select('offenceSnapshot occurredAt severity status')
      .lean(),
    DisciplineLedger.find({ studentId: student._id, createdAt: { $gte: previousStart } })
      .select('change type reason createdAt')
      .lean(),
    Recognition.find({ studentId: student._id, awardedAt: { $gte: previousStart } })
      .select('title points awardedAt')
      .sort({ awardedAt: -1 })
      .lean(),
    AttendanceRecord.find({ studentId: student._id, date: { $gte: attendanceStart } })
      .select('date session status')
      .lean(),
    hasPermission(ctx, 'interventions.view')
      ? Intervention.find({ studentId: student._id, status: { $in: ['open', 'in_progress'] } })
          .select('title status')
          .lean()
      : Promise.resolve(null),
    hasPermission(ctx, 'followups.view')
      ? FollowUp.find({ studentId: student._id, status: { $in: ['pending', 'overdue'] } })
          .select('type dueDate status')
          .lean()
      : Promise.resolve(null),
    RiskAssessment.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(1).lean(),
  ])

  const currentIncidents = incidents.filter((i) => new Date(i.occurredAt) >= currentStart)
  const previousIncidents = incidents.filter((i) => new Date(i.occurredAt) < currentStart)

  const weekly: WeeklyPoint[] = []
  for (let week = 7; week >= 0; week--) {
    const from = new Date(now.getTime() - (week + 1) * WEEK)
    const to = new Date(now.getTime() - week * WEEK)
    const inWeek = (at: Date) => at >= from && at < to
    weekly.push({
      weekStart: isoDay(from),
      incidents: incidents.filter((i) => inWeek(new Date(i.occurredAt))).length,
      deductions: ledger.filter((l) => l.change < 0 && inWeek(new Date(l.createdAt))).reduce((sum, l) => sum + Math.abs(l.change), 0),
      rewards: ledger.filter((l) => l.change > 0 && inWeek(new Date(l.createdAt))).reduce((sum, l) => sum + l.change, 0),
    })
  }

  const repeatMap = new Map<string, number>()
  for (const incident of currentIncidents) {
    const name = incident.offenceSnapshot?.name
    if (name) repeatMap.set(name, (repeatMap.get(name) ?? 0) + 1)
  }
  const repeatedOffences = [...repeatMap.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  const dailyAttendance = attendance.filter((a) => a.session === 'daily')
  const attendanceRows = dailyAttendance.length ? dailyAttendance : attendance
  const attended = attendanceRows.filter((a) => a.status === 'present' || a.status === 'late').length
  const counted = attendanceRows.filter((a) => a.status !== 'excused' && a.status !== 'permission').length
  const attendanceRate = counted ? Math.round((attended / counted) * 1000) / 10 : null

  const currentRewardPoints = recognitions
    .filter((r) => new Date(r.awardedAt) >= currentStart)
    .reduce((sum, r) => sum + (r.points ?? 0), 0)
  const previousRewardPoints = recognitions
    .filter((r) => new Date(r.awardedAt) < currentStart)
    .reduce((sum, r) => sum + (r.points ?? 0), 0)

  const currentDeductions = ledger
    .filter((l) => l.change < 0 && new Date(l.createdAt) >= currentStart)
    .reduce((sum, l) => sum + Math.abs(l.change), 0)
  const previousDeductions = ledger
    .filter((l) => l.change < 0 && new Date(l.createdAt) < currentStart)
    .reduce((sum, l) => sum + Math.abs(l.change), 0)

  let welfare: { appointments: number; completed: number; lastAt: string | null } | null = null
  if (hasPermission(ctx, 'welfare.view') || hasPermission(ctx, 'welfare.records.view')) {
    // Only aggregate engagement counts are exposed; session notes stay in the
    // confidential welfare centre behind their own permission checks.
    const appointments = await CounsellingAppointment.find({ studentId: student._id })
      .select('status scheduledAt')
      .lean()
    welfare = {
      appointments: appointments.length,
      completed: appointments.filter((a) => a.status === 'completed').length,
      lastAt: appointments.length
        ? new Date(Math.max(...appointments.map((a) => new Date(a.scheduledAt).getTime()))).toISOString()
        : null,
    }
  }

  const classDoc = student.classId as unknown as { name?: string } | null
  const assessment = assessments[0]
  const recommendations: Recommendation[] = []
  if (attendanceRate !== null && attendanceRate < 85) {
    recommendations.push({
      key: 'attendance_support',
      title: 'Attendance support conversation',
      detail: `Attendance is ${attendanceRate}% over the last 30 days. A supportive conversation with the guardian and class teacher is more effective than a sanction.`,
      tone: attendanceRate < 70 ? 'red' : 'amber',
    })
  }
  if (repeatedOffences.length) {
    recommendations.push({
      key: 'repeated_offence',
      title: `Targeted support for repeated ${repeatedOffences[0]!.name.toLowerCase()}`,
      detail: `${repeatedOffences[0]!.count} incidents of the same rule this period. Consider a restorative conversation or a short improvement plan before escalating.`,
      tone: 'amber',
    })
  }
  if (currentDeductions > previousDeductions && currentDeductions > 0) {
    recommendations.push({
      key: 'deduction_trend',
      title: 'Deductions are rising',
      detail: `Deductions increased from ${previousDeductions} to ${currentDeductions} marks compared with the previous ${TREND_DAYS} days. Review the pattern with the discipline team.`,
      tone: 'amber',
    })
  }
  if (currentRewardPoints > previousRewardPoints && currentRewardPoints > 0) {
    recommendations.push({
      key: 'positive_momentum',
      title: 'Positive momentum — keep recognising it',
      detail: `Recognition points rose from ${previousRewardPoints} to ${currentRewardPoints}. A specific acknowledgement can reinforce the improvement.`,
      tone: 'emerald',
    })
  }
  if (followUps?.length) {
    recommendations.push({
      key: 'follow_up_due',
      title: `${followUps.length} support follow-up${followUps.length === 1 ? '' : 's'} pending`,
      detail: 'Closing open care commitments keeps the support plan credible for the student and guardian.',
      tone: 'brand',
    })
  }
  if (['orange', 'red'].includes(student.riskLevel)) {
    recommendations.push({
      key: 'support_review',
      title: 'Schedule a student support review',
      detail: 'The current risk level warrants a documented review with the class teacher, guardian and support staff. Risk scores are advisory and never automatic punishment.',
      tone: 'red',
    })
  }
  const quiet = currentIncidents.filter((i) => new Date(i.occurredAt) >= recentCutoff).length === 0
  if (quiet && student.riskLevel === 'green' && currentIncidents.length <= previousIncidents.length) {
    recommendations.push({
      key: 'stability',
      title: 'Stable period — recognise the effort',
      detail: 'No incidents in the last three weeks. A positive note home or a certificate would consolidate the progress.',
      tone: 'emerald',
    })
  }

  const headline = assessment?.explanation
    ? String(assessment.explanation)
    : `${currentIncidents.length} incident(s) and ${recognitions.length} recognition(s) in the last ${TREND_DAYS} days.`

  return {
    student: {
      id: String(student._id),
      fullName: student.fullName,
      studentId: student.studentId,
      className: classDoc?.name ?? '',
      balance: student.currentBalance,
      riskLevel: student.riskLevel,
    },
    term: termId ? String(termId) : student.currentTermId ? String(student.currentTermId) : null,
    window: { days: TREND_DAYS, from: isoDay(previousStart), to: isoDay(now) },
    trends: {
      weekly,
      incidents: {
        current: currentIncidents.length,
        previous: previousIncidents.length,
        direction: currentIncidents.length > previousIncidents.length ? 'up' : currentIncidents.length < previousIncidents.length ? 'down' : 'flat',
      },
      deductions: { current: currentDeductions, previous: previousDeductions },
      rewards: { current: currentRewardPoints, previous: previousRewardPoints },
    },
    repeatedOffences,
    recognition: {
      count: recognitions.length,
      points: currentRewardPoints,
      recent: recognitions.slice(0, 5).map((r) => ({ title: r.title, points: r.points, awardedAt: r.awardedAt })),
    },
    attendance:
      attendanceRate === null
        ? null
        : {
            rate: attendanceRate,
            present: attendanceRows.filter((a) => a.status === 'present').length,
            late: attendanceRows.filter((a) => a.status === 'late').length,
            absent: attendanceRows.filter((a) => a.status === 'absent').length,
            sessions: attendanceRows.length,
            from: attendanceStart,
          },
    support: interventions === null && followUps === null
      ? null
      : {
          activeInterventions: interventions?.length ?? 0,
          pendingFollowUps: followUps?.length ?? 0,
        },
    welfare,
    explanation: {
      headline,
      factors: assessment?.factors ?? [],
    },
    recommendations,
    advisoryOnly: true,
    sources: [
      'Conduct ledger',
      'Approved incidents',
      'Recognition records',
      'Attendance register (daily)',
      ...(interventions === null ? [] : ['Interventions']),
      ...(followUps === null ? [] : ['Welfare follow-ups']),
      ...(welfare === null ? [] : ['Counselling engagement counts (no session notes)']),
    ],
    generatedAt: now.toISOString(),
  }
}
