import { Types } from 'mongoose'
import { Incident, RiskAssessment } from '../models/discipline.js'
import { Student, type IStudent } from '../models/school.js'
import { getSettings } from '../models/core.js'
import { notifyPermission } from './notification.service.js'
import { writeAudit } from './audit.service.js'

const ORDER = ['green', 'yellow', 'orange', 'red'] as const
type Risk = (typeof ORDER)[number]

const LABELS: Record<Risk, string> = {
  green: 'Good standing',
  yellow: 'Attention required',
  orange: 'High risk',
  red: 'Critical risk',
}

export type RiskResult = {
  category: Risk
  score: number
  previousCategory: Risk
  explanation: string
  factors: string[]
  changed: boolean
}

export function categoryFromBalance(balance: number, thresholds: { green: number; yellow: number; orange: number }): Risk {
  if (balance >= thresholds.green) return 'green'
  if (balance >= thresholds.yellow) return 'yellow'
  if (balance >= thresholds.orange) return 'orange'
  return 'red'
}

export function riskLabel(category: string): string {
  return LABELS[category as Risk] ?? category
}

export async function evaluateStudentRisk(
  student: IStudent | Types.ObjectId | string,
  trigger: string,
  actor?: { userId: Types.ObjectId; name: string },
  termId?: Types.ObjectId,
): Promise<RiskResult> {
  const studentDoc = student instanceof Student ? student : await Student.findById(student)
  if (!studentDoc) throw new Error('Student not found')
  const settings = await getSettings()
  const currentTermId = termId ?? studentDoc.currentTermId ?? studentDoc.termId
  if (!currentTermId) {
    return {
      category: studentDoc.riskLevel,
      score: studentDoc.currentBalance,
      previousCategory: studentDoc.riskLevel,
      explanation: 'No active term — risk cannot be calculated yet.',
      factors: [],
      changed: false,
    }
  }

  const incidents = await Incident.find({
    studentId: studentDoc._id,
    termId: currentTermId,
    status: { $in: ['approved', 'resolved', 'closed', 'escalated'] },
  })
    .select('_id offenceId severity occurredAt offenceSnapshot')
    .lean()

  const thresholds = settings.risk.thresholds
  const baseCategory = categoryFromBalance(studentDoc.currentBalance, thresholds)
  const factors: string[] = [
    `Conduct balance is ${studentDoc.currentBalance} of ${settings.academic.startingMarks} starting marks.`,
    `${incidents.length} substantiated incident${incidents.length === 1 ? '' : 's'} this term.`,
  ]

  let category: Risk = baseCategory

  const since = new Date(Date.now() - settings.risk.seriousRecentDays * 86_400_000)
  const seriousRecent = incidents.filter(
    (i) => ['serious', 'critical'].includes(String(i.severity)) && new Date(i.occurredAt) >= since,
  )
  if (seriousRecent.length && category !== 'red') {
    const idx = Math.min(ORDER.indexOf(category) + 1, ORDER.length - 1)
    category = ORDER[idx]
    factors.push(
      `${seriousRecent.length} serious or critical incident${seriousRecent.length === 1 ? '' : 's'} in the last ${settings.risk.seriousRecentDays} days increased the risk level.`,
    )
  }

  const offenceCounts = new Map<string, number>()
  for (const i of incidents) {
    const key = String(i.offenceId)
    offenceCounts.set(key, (offenceCounts.get(key) ?? 0) + 1)
  }
  const repeats = [...offenceCounts.values()].some((n) => n >= settings.risk.repeatOffenceThreshold)
  if (repeats && category !== 'red') {
    const idx = Math.min(ORDER.indexOf(category) + 1, ORDER.length - 1)
    category = ORDER[idx]
    factors.push(`Repeated offences (${settings.risk.repeatOffenceThreshold}+ of the same type) increased the risk level.`)
  }

  const previousCategory = studentDoc.riskLevel
  const changed = category !== previousCategory
  const explanation =
    `${LABELS[category]}: balance ${studentDoc.currentBalance}, ${incidents.length} incident(s) this term` +
    `${seriousRecent.length ? `, ${seriousRecent.length} recent serious incident(s)` : ''}` +
    `${repeats ? ', repeated offences detected' : ''}.`

  if (changed) {
    studentDoc.riskLevel = category
    await studentDoc.save()
    await RiskAssessment.create({
      studentId: studentDoc._id,
      termId: currentTermId,
      category,
      score: studentDoc.currentBalance,
      previousCategory,
      trigger,
      explanation,
      factors,
      incidentIds: incidents.map((i) => i._id),
    })
    await writeAudit({
      actor: actor ? { userId: actor.userId, name: actor.name, roles: [] } : undefined,
      action: 'risk.changed',
      resourceType: 'Student',
      resourceId: String(studentDoc._id),
      before: { riskLevel: previousCategory },
      after: { riskLevel: category },
      reason: trigger,
    })
    if (category === 'orange' || category === 'red') {
      await notifyPermission('risk.escalate', {
        type: 'risk.escalation',
        title: `${LABELS[category]} — ${studentDoc.fullName}`,
        message: `${studentDoc.fullName} is now ${LABELS[category].toLowerCase()} with ${studentDoc.currentBalance} conduct marks.`,
        link: `/students/${studentDoc._id}`,
        data: { studentId: String(studentDoc._id), risk: category },
      })
    }
  } else {
    const existing = await RiskAssessment.exists({ studentId: studentDoc._id, termId: currentTermId })
    if (!existing) {
      await RiskAssessment.create({
        studentId: studentDoc._id,
        termId: currentTermId,
        category,
        score: studentDoc.currentBalance,
        previousCategory,
        trigger: trigger || 'Initial assessment',
        explanation,
        factors,
        incidentIds: incidents.map((i) => i._id),
      })
    }
  }

  return { category, score: studentDoc.currentBalance, previousCategory, explanation, factors, changed }
}
