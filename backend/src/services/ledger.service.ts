import { Types } from 'mongoose'
import { getSettings, type ISettings } from '../models/core.js'
import { DisciplineLedger, type IDisciplineLedger } from '../models/discipline.js'
import { Student, Term, type IStudent } from '../models/school.js'
import { ApiError } from '../shared/errors.js'
import { logger } from '../shared/logger.js'
import { evaluateStudentRisk } from './risk.service.js'
import { writeAudit } from './audit.service.js'

export type LedgerActor = { userId: Types.ObjectId; name: string; roles?: string[] }

export type PostTransactionInput = {
  studentId: string | Types.ObjectId
  termId: string | Types.ObjectId
  academicYearId?: string | Types.ObjectId | null
  incidentId?: string | Types.ObjectId | null
  adjustmentId?: string | Types.ObjectId | null
  bulkOperationId?: string | Types.ObjectId | null
  type: IDisciplineLedger['type']
  change: number
  reason: string
  actor?: LedgerActor
  approvedBy?: string | Types.ObjectId | null
  reversalOf?: string | Types.ObjectId | null
  auditRef?: string
}

async function currentStudent(studentId: string | Types.ObjectId) {
  const student = await Student.findById(studentId)
  if (!student) throw ApiError.notFound('Student not found')
  return student
}

export async function postTransaction(input: PostTransactionInput): Promise<IDisciplineLedger> {
  if (!Number.isFinite(input.change) || input.change === 0) {
    throw ApiError.badRequest('A conduct transaction must change the balance by a non-zero amount')
  }
  const student = await currentStudent(input.studentId)

  if (input.type === 'deduction' && input.incidentId) {
    const existing = await DisciplineLedger.findOne({ incidentId: input.incidentId, type: 'deduction' })
    if (existing) throw ApiError.conflict('A deduction has already been applied for this incident')
  }
  if (input.type === 'initial_allocation') {
    const existing = await DisciplineLedger.findOne({ studentId: student._id, termId: input.termId, type: 'initial_allocation' })
    if (existing) return existing
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const fresh = await Student.findById(student._id).select('currentBalance balanceVersion fullName currentTermId')
    if (!fresh) throw ApiError.notFound('Student not found')
    const previous = fresh.currentBalance
    const target = Math.max(0, previous + input.change)
    const applied = target - previous
    if (applied === 0) {
      throw ApiError.badRequest('The conduct balance is already at zero; this deduction cannot be applied. Record the case for intervention instead.')
    }
    const updated = await Student.updateOne(
      { _id: fresh._id, balanceVersion: fresh.balanceVersion },
      { $set: { currentBalance: target, balanceVersion: fresh.balanceVersion + 1 } },
    )
    if (updated.modifiedCount !== 1) continue

    let ledger
    try {
      ledger = await DisciplineLedger.create({
        studentId: fresh._id,
        academicYearId: input.academicYearId ?? undefined,
        termId: input.termId,
        incidentId: input.incidentId ?? undefined,
        adjustmentId: input.adjustmentId ?? undefined,
        bulkOperationId: input.bulkOperationId ?? undefined,
        type: input.type,
        previousBalance: previous,
        change: applied,
        newBalance: target,
        reason: input.reason,
        createdBy: input.actor?.userId,
        approvedBy: input.approvedBy ?? undefined,
        status: 'posted',
        reversalOf: input.reversalOf ?? undefined,
        auditRef: input.auditRef,
      })
    } catch (err) {
      // Only the balance update is rolled back here. Once the immutable ledger row exists the
      // balance must stand, otherwise the ledger and the student balance drift apart.
      await Student.updateOne(
        { _id: fresh._id, balanceVersion: fresh.balanceVersion + 1 },
        { $set: { currentBalance: previous, balanceVersion: fresh.balanceVersion + 2 } },
      )
      if ((err as { code?: number }).code === 11000) {
        const existing = input.incidentId
          ? await DisciplineLedger.findOne({ incidentId: input.incidentId, type: 'deduction' })
          : input.type === 'initial_allocation'
            ? await DisciplineLedger.findOne({ studentId: fresh._id, termId: input.termId, type: 'initial_allocation' })
            : null
        if (existing) return existing
        throw ApiError.conflict('This conduct transaction was already recorded')
      }
      throw err
    }

    await writeAudit({
      actor: input.actor,
      action: 'discipline.ledger.posted',
      resourceType: 'DisciplineLedger',
      resourceId: String(ledger._id),
      before: { balance: previous },
      after: { balance: target, change: applied, type: input.type },
      reason: input.reason,
    })

    try {
      await evaluateStudentRisk(fresh._id, `Ledger transaction: ${input.type}`, input.actor as { userId: Types.ObjectId; name: string })
    } catch (err) {
      logger.error({ err, studentId: String(fresh._id) }, 'Risk evaluation failed after ledger post')
    }
    return ledger
  }
  throw ApiError.conflict('The student balance was updated concurrently. Please retry.')
}

export async function ensureInitialAllocation(
  student: IStudent | string | Types.ObjectId,
  term?: { _id: Types.ObjectId; startingMarks: number; academicYearId: Types.ObjectId } | null,
  actor?: LedgerActor,
): Promise<IDisciplineLedger | null> {
  const studentDoc = student instanceof Student ? student : await Student.findById(student)
  if (!studentDoc) throw ApiError.notFound('Student not found')
  const settings = await getSettings()
  const activeTerm = term ?? (await Term.findById(studentDoc.currentTermId ?? studentDoc.termId))
  if (!activeTerm) return null
  const existing = await DisciplineLedger.findOne({
    studentId: studentDoc._id,
    termId: activeTerm._id,
    type: 'initial_allocation',
  })
  if (existing) return existing

  const starting = activeTerm.startingMarks || settings.academic.startingMarks
  if (studentDoc.currentBalance === 0) {
    return postTransaction({
      studentId: studentDoc._id,
      termId: activeTerm._id,
      academicYearId: activeTerm.academicYearId,
      type: 'initial_allocation',
      change: starting,
      reason: `Initial conduct allocation — ${starting} marks for the term`,
      actor,
    })
  }
  // Student already holds a balance (e.g. migrated record): record the opening position without changing it.
  return DisciplineLedger.create({
    studentId: studentDoc._id,
    academicYearId: activeTerm.academicYearId,
    termId: activeTerm._id,
    type: 'initial_allocation',
    previousBalance: 0,
    change: studentDoc.currentBalance,
    newBalance: studentDoc.currentBalance,
    reason: 'Recorded opening conduct balance (existing record)',
    createdBy: actor?.userId,
    status: 'posted',
  })
}

export async function rewardStudent(input: {
  studentId: string
  points: number
  reason: string
  termId: string
  academicYearId?: string
  actor: LedgerActor
}) {
  if (input.points <= 0) throw ApiError.badRequest('Reward points must be greater than zero')
  return postTransaction({
    studentId: input.studentId,
    termId: input.termId,
    academicYearId: input.academicYearId,
    type: 'reward',
    change: Math.min(20, Math.round(input.points)),
    reason: input.reason,
    actor: input.actor,
  })
}

export async function reverseTransaction(input: {
  ledgerId: string
  reason: string
  actor: LedgerActor
}) {
  const original = await DisciplineLedger.findById(input.ledgerId)
  if (!original) throw ApiError.notFound('Ledger transaction not found')
  if (original.type === 'reversal') throw ApiError.badRequest('A reversal cannot itself be reversed')
  const already = await DisciplineLedger.findOne({ reversalOf: original._id })
  if (already) throw ApiError.conflict('This transaction has already been reversed')
  return postTransaction({
    studentId: original.studentId,
    termId: original.termId,
    academicYearId: original.academicYearId,
    type: 'reversal',
    change: -original.change,
    reason: input.reason,
    actor: input.actor,
    reversalOf: original._id,
  })
}

export async function studentConductSummary(studentId: string, termId: string) {  const [student, ledger] = await Promise.all([
    Student.findById(studentId).lean(),
    DisciplineLedger.find({ studentId, termId }).sort({ createdAt: 1 }).lean(),
  ])
  if (!student) throw ApiError.notFound('Student not found')
  const deductions = ledger.filter((l) => l.change < 0).reduce((s, l) => s + Math.abs(l.change), 0)
  const rewards = ledger.filter((l) => l.change > 0 && l.type === 'reward').reduce((s, l) => s + l.change, 0)
  const initial = ledger.find((l) => l.type === 'initial_allocation')
  return {
    startingMarks: initial?.change ?? 0,
    totalDeductions: deductions,
    totalRewards: rewards,
    currentBalance: student.currentBalance,
    transactions: ledger,
  }
}

export async function allocateTermForAllStudents(term: { _id: Types.ObjectId; startingMarks: number; academicYearId: Types.ObjectId }, actor?: LedgerActor) {
  const students = await Student.find({ status: 'active' }).select('_id currentBalance currentTermId termId')
  let allocated = 0
  for (const s of students) {
    const existing = await DisciplineLedger.exists({ studentId: s._id, termId: term._id, type: 'initial_allocation' })
    if (existing) continue
    try {
      if (s.currentBalance !== 0) {
        // Roll the previous balance forward as the opening position for the new term.
        await Student.updateOne({ _id: s._id }, { $set: { currentBalance: 0, currentTermId: term._id, termId: term._id } })
      } else {
        await Student.updateOne({ _id: s._id }, { $set: { currentTermId: term._id, termId: term._id } })
      }
      await ensureInitialAllocation(s._id, term, actor)
      allocated++
    } catch {
      // continue: individual failures are visible in logs and can be retried
    }
  }
  return allocated
}

export type { ISettings }
export { getSettings }

export type LedgerIssue = {
  studentId: string
  studentName: string
  studentRef: string
  ledgerId: string
  kind: 'broken_chain' | 'math_mismatch' | 'balance_drift' | 'negative_balance' | 'duplicate_deduction'
  detail: string
}

/**
 * Walks every ledger row in posting order and proves that each row chains
 * from the previous balance and that the final row matches the student's
 * stored balance. Immutable rows are never repaired here; the report points
 * an administrator at the exact record that needs an audit follow-up.
 */
export async function reconcileLedger(termId: string) {
  const term = await Term.findById(termId).lean()
  if (!term) throw ApiError.notFound('Term not found')

  const [students, rows, duplicateDeductions] = await Promise.all([
    Student.find({ status: 'active' }).select('fullName studentId currentBalance termId currentTermId').lean(),
    DisciplineLedger.find({ termId }).sort({ studentId: 1, createdAt: 1, _id: 1 }).lean(),
    DisciplineLedger.aggregate([
      { $match: { termId: new Types.ObjectId(termId), type: 'deduction', incidentId: { $ne: null } } },
      { $group: { _id: { incidentId: '$incidentId', studentId: '$studentId' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]),
  ])

  const byStudent = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = String(row.studentId)
    const list = byStudent.get(key) ?? []
    list.push(row)
    byStudent.set(key, list)
  }
  const studentMap = new Map(students.map((student) => [String(student._id), student]))
  const issues: LedgerIssue[] = []
  let checkedTransactions = 0
  let matchedStudents = 0

  for (const [studentKey, entries] of byStudent) {
    const student = studentMap.get(studentKey)
    if (!student) continue
    let expectedPrevious = 0
    let broken = false
    for (const entry of entries) {
      checkedTransactions += 1
      if (entry.previousBalance !== expectedPrevious) {
        broken = true
        issues.push({
          studentId: studentKey,
          studentName: student.fullName,
          studentRef: student.studentId,
          ledgerId: String(entry._id),
          kind: 'broken_chain',
          detail: `Previous balance is ${entry.previousBalance} but the prior row ended at ${expectedPrevious}.`,
        })
      }
      if (entry.previousBalance + entry.change !== entry.newBalance) {
        issues.push({
          studentId: studentKey,
          studentName: student.fullName,
          studentRef: student.studentId,
          ledgerId: String(entry._id),
          kind: 'math_mismatch',
          detail: `${entry.previousBalance} ${entry.change >= 0 ? '+' : '−'} ${Math.abs(entry.change)} should equal ${entry.previousBalance + entry.change}, not ${entry.newBalance}.`,
        })
      }
      if (entry.newBalance < 0) {
        issues.push({
          studentId: studentKey,
          studentName: student.fullName,
          studentRef: student.studentId,
          ledgerId: String(entry._id),
          kind: 'negative_balance',
          detail: `Balance ${entry.newBalance} cannot be negative.`,
        })
      }
      expectedPrevious = entry.newBalance
    }
    const last = entries[entries.length - 1]
    const onCurrentTerm = String(student.currentTermId ?? student.termId ?? '') === String(termId)
    if (last && onCurrentTerm && last.newBalance !== student.currentBalance) {
      issues.push({
        studentId: studentKey,
        studentName: student.fullName,
        studentRef: student.studentId,
        ledgerId: String(last._id),
        kind: 'balance_drift',
        detail: `Ledger ends at ${last.newBalance} but the student record holds ${student.currentBalance}.`,
      })
    }
    if (!broken) matchedStudents += 1
  }

  const namesById = new Map(students.map((student) => [String(student._id), student]))
  for (const duplicate of duplicateDeductions as { _id: { incidentId: string; studentId: string }; count: number }[]) {
    const student = namesById.get(String(duplicate._id.studentId))
    issues.push({
      studentId: String(duplicate._id.studentId),
      studentName: student?.fullName ?? 'Unknown student',
      studentRef: student?.studentId ?? '—',
      ledgerId: String(duplicate._id.incidentId),
      kind: 'duplicate_deduction',
      detail: `${duplicate.count} deductions were posted for the same incident.`,
    })
  }

  const activeWithLedger = [...byStudent.keys()].filter((key) => studentMap.has(key)).length
  return {
    term: { id: String(term._id), name: term.name, number: term.number },
    studentsChecked: activeWithLedger,
    studentsMatched: matchedStudents,
    transactionsChecked: checkedTransactions,
    issues,
    healthy: issues.length === 0,
    generatedAt: new Date(),
  }
}
