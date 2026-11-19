import mongoose, { Types } from 'mongoose'
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
  /** Retried writes with the same key return the original row instead of posting twice. */
  idempotencyKey?: string
}

async function currentStudent(studentId: string | Types.ObjectId) {
  const student = await Student.findById(studentId)
  if (!student) throw ApiError.notFound('Student not found')
  return student
}

let transactionSupport: Promise<boolean> | null = null

/**
 * MongoDB transactions need a replica set (or mongos). Atlas always provides
 * one; a local standalone server does not. The result is cached because the
 * topology does not change while the process is running.
 */
export async function supportsTransactions(): Promise<boolean> {
  if (!transactionSupport) {
    transactionSupport = (async () => {
      try {
        const db = mongoose.connection.db
        if (!db) return false
        const info = (await db.admin().command({ hello: 1 })) as { setName?: string; msg?: string }
        return Boolean(info.setName) || info.msg === 'isdbgrid'
      } catch {
        return false
      }
    })()
  }
  return transactionSupport
}

/** Balance of one student in one term, derived from the term's own ledger. */
export async function termBalance(studentId: string | Types.ObjectId, termId: string | Types.ObjectId): Promise<number> {
  const last = await DisciplineLedger.findOne({ studentId, termId })
    .sort({ createdAt: -1, _id: -1 })
    .select('newBalance')
    .lean()
  return last?.newBalance ?? 0
}

/** Balances for many students in one term, in a single aggregation. */
export async function termBalances(
  studentIds: (string | Types.ObjectId)[],
  termId: string | Types.ObjectId,
): Promise<Map<string, number>> {
  if (!studentIds.length) return new Map()
  const rows = await DisciplineLedger.aggregate<{ _id: Types.ObjectId; balance: number }>([
    { $match: { termId: new Types.ObjectId(String(termId)), studentId: { $in: studentIds.map((id) => new Types.ObjectId(String(id))) } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: { _id: '$studentId', balance: { $last: '$newBalance' } } },
  ])
  return new Map(rows.map((row) => [String(row._id), row.balance]))
}

async function duplicateRowFor(input: PostTransactionInput) {
  if (input.idempotencyKey) {
    const row = await DisciplineLedger.findOne({ idempotencyKey: input.idempotencyKey })
    if (row) return row
  }
  if (input.type === 'deduction' && input.incidentId) {
    return DisciplineLedger.findOne({ incidentId: input.incidentId, type: 'deduction' })
  }
  if (input.type === 'initial_allocation') {
    return DisciplineLedger.findOne({ studentId: input.studentId, termId: input.termId, type: 'initial_allocation' })
  }
  return null
}

function ledgerFields(input: PostTransactionInput, previous: number, applied: number, target: number) {
  return {
    studentId: input.studentId,
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
    status: 'posted' as const,
    reversalOf: input.reversalOf ?? undefined,
    auditRef: input.auditRef,
    idempotencyKey: input.idempotencyKey,
  }
}

async function afterPosted(
  ledger: IDisciplineLedger,
  previous: number,
  target: number,
  applied: number,
  input: PostTransactionInput,
  studentId: Types.ObjectId,
) {
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
    await evaluateStudentRisk(studentId, `Ledger transaction: ${input.type}`, input.actor as { userId: Types.ObjectId; name: string })
  } catch (err) {
    logger.error({ err, studentId: String(studentId) }, 'Risk evaluation failed after ledger post')
  }
}

export async function postTransaction(input: PostTransactionInput): Promise<IDisciplineLedger> {
  if (!Number.isFinite(input.change) || input.change === 0) {
    throw ApiError.badRequest('A conduct transaction must change the balance by a non-zero amount')
  }
  const student = await currentStudent(input.studentId)

  const existing = await duplicateRowFor(input)
  if (existing) {
    if (input.type === 'deduction' && input.incidentId && !input.idempotencyKey) {
      throw ApiError.conflict('A deduction has already been applied for this incident')
    }
    return existing
  }

  const currentTermId = student.currentTermId ?? student.termId
  const isCurrentTerm = String(currentTermId ?? '') === String(input.termId)
  const useTransactions = await supportsTransactions()

  if (useTransactions) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const session = await mongoose.startSession()
      let created: IDisciplineLedger | null = null
      let previous = 0
      let target = 0
      let applied = 0
      try {
        await session.withTransaction(async () => {
          created = null
          const fresh = await Student.findById(student._id).session(session)
          if (!fresh) throw ApiError.notFound('Student not found')
          previous = isCurrentTerm
            ? fresh.currentBalance
            : ((
                await DisciplineLedger.findOne({ studentId: fresh._id, termId: input.termId })
                  .sort({ createdAt: -1, _id: -1 })
                  .select('newBalance')
                  .session(session)
                  .lean()
              )?.newBalance ?? 0)
          target = Math.max(0, previous + input.change)
          applied = target - previous
          if (applied === 0) {
            throw ApiError.badRequest(
              'The conduct balance is already at zero; this deduction cannot be applied. Record the case for intervention instead.',
            )
          }
          const guard = await Student.updateOne(
            { _id: fresh._id, balanceVersion: fresh.balanceVersion },
            isCurrentTerm
              ? { $set: { currentBalance: target, balanceVersion: fresh.balanceVersion + 1 } }
              : { $set: { balanceVersion: fresh.balanceVersion + 1 } },
            { session },
          )
          if (guard.modifiedCount !== 1) throw new Error('LEDGER_RETRY')
          created = (await DisciplineLedger.create([ledgerFields(input, previous, applied, target)], { session }))[0]
        })
        if (created) {
          const ledger = created as IDisciplineLedger
          await afterPosted(ledger, previous, target, applied, input, student._id)
          return ledger
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'LEDGER_RETRY') continue
        const code =
          (err as { code?: number }).code ??
          (err as { errorResponse?: { code?: number } }).errorResponse?.code
        if (code === 11000) {
          const row = await duplicateRowFor(input)
          if (row) return row
          throw ApiError.conflict('This conduct transaction was already recorded')
        }
        throw err
      } finally {
        await session.endSession()
      }
    }
    throw ApiError.conflict('The student balance was updated concurrently. Please retry.')
  }

  // Standalone MongoDB (no replica set): optimistic CAS on balanceVersion. The
  // ledger row is created only after the balance update wins, and a failed row
  // insert restores the previous balance so the two never drift.
  for (let attempt = 0; attempt < 6; attempt++) {
    const fresh = await Student.findById(student._id).select('currentBalance balanceVersion currentTermId termId')
    if (!fresh) throw ApiError.notFound('Student not found')
    const previous = isCurrentTerm
      ? fresh.currentBalance
      : await termBalance(fresh._id, input.termId)
    const target = Math.max(0, previous + input.change)
    const applied = target - previous
    if (applied === 0) {
      throw ApiError.badRequest(
        'The conduct balance is already at zero; this deduction cannot be applied. Record the case for intervention instead.',
      )
    }
    const updated = await Student.updateOne(
      { _id: fresh._id, balanceVersion: fresh.balanceVersion },
      isCurrentTerm
        ? { $set: { currentBalance: target, balanceVersion: fresh.balanceVersion + 1 } }
        : { $set: { balanceVersion: fresh.balanceVersion + 1 } },
    )
    if (updated.modifiedCount !== 1) continue

    let ledger
    try {
      ledger = await DisciplineLedger.create(ledgerFields(input, previous, applied, target))
    } catch (err) {
      if (isCurrentTerm) {
        await Student.updateOne(
          { _id: fresh._id, balanceVersion: fresh.balanceVersion + 1 },
          { $set: { currentBalance: previous, balanceVersion: fresh.balanceVersion + 2 } },
        )
      }
      if ((err as { code?: number }).code === 11000) {
        const row = await duplicateRowFor(input)
        if (row) return row
        throw ApiError.conflict('This conduct transaction was already recorded')
      }
      throw err
    }

    await afterPosted(ledger, previous, target, applied, input, fresh._id)
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

  // A student only receives the new-term opening marks when the student record
  // is actually on that term. Recording an allocation against a different term
  // would make the stored balance disagree with the term ledger.
  if (!studentDoc.currentTermId) {
    await Student.updateOne(
      { _id: studentDoc._id, currentTermId: null },
      { $set: { currentTermId: activeTerm._id, termId: activeTerm._id } },
    )
    studentDoc.currentTermId = activeTerm._id
  }

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
      idempotencyKey: `opening:${String(studentDoc._id)}:${String(activeTerm._id)}`,
    })
  }
  // Student already holds a balance (e.g. migrated record): record the opening position without changing it.
  try {
    return await DisciplineLedger.create({
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
      idempotencyKey: `opening-existing:${String(studentDoc._id)}:${String(activeTerm._id)}`,
    })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const row = await DisciplineLedger.findOne({ studentId: studentDoc._id, termId: activeTerm._id, type: 'initial_allocation' })
      if (row) return row
    }
    throw err
  }
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
    idempotencyKey: `reversal:${String(original._id)}`,
  })
}

export async function studentConductSummary(studentId: string, termId: string) {
  const [student, ledger] = await Promise.all([
    Student.findById(studentId).lean(),
    DisciplineLedger.find({ studentId, termId }).sort({ createdAt: 1, _id: 1 }).lean(),
  ])
  if (!student) throw ApiError.notFound('Student not found')
  const deductions = ledger.filter((l) => l.change < 0).reduce((s, l) => s + Math.abs(l.change), 0)
  const rewards = ledger.filter((l) => l.change > 0 && l.type === 'reward').reduce((s, l) => s + l.change, 0)
  const initial = ledger.find((l) => l.type === 'initial_allocation')
  // The requested term's balance is derived from that term's own immutable
  // ledger. The student document only holds the live, current-term balance.
  const termBalance = ledger.length ? ledger[ledger.length - 1].newBalance : 0
  const currentTermId = student.currentTermId ?? student.termId
  const isCurrentTerm = String(currentTermId ?? '') === String(termId)
  return {
    startingMarks: initial?.change ?? 0,
    totalDeductions: deductions,
    totalRewards: rewards,
    currentBalance: termBalance,
    termBalance,
    studentBalance: student.currentBalance,
    isCurrentTerm,
    transactions: ledger,
  }
}

/**
 * Opens a new term for every active student.
 *
 * The previous implementation zeroed each balance before writing the opening
 * allocation, so a failed write left the student at zero with no ledger row.
 * This version writes the balance and the opening row together, guards the
 * update with balanceVersion, and restores the previous state if the immutable
 * row cannot be created.
 */
export async function allocateTermForAllStudents(
  term: { _id: Types.ObjectId; startingMarks: number; academicYearId: Types.ObjectId },
  actor?: LedgerActor,
) {
  const settings = await getSettings()
  const starting = term.startingMarks || settings.academic.startingMarks
  const students = await Student.find({ status: 'active' }).select(
    '_id currentBalance balanceVersion currentTermId termId',
  )
  let allocated = 0
  for (const s of students) {
    const existing = await DisciplineLedger.exists({ studentId: s._id, termId: term._id, type: 'initial_allocation' })
    if (existing) continue

    const onTerm = String(s.currentTermId ?? s.termId ?? '') === String(term._id)
    if (onTerm) {
      // Already live on this term: record the actual opening position without
      // altering a balance that staff can already see.
      try {
        await DisciplineLedger.create({
          studentId: s._id,
          academicYearId: term.academicYearId,
          termId: term._id,
          type: 'initial_allocation',
          previousBalance: 0,
          change: s.currentBalance,
          newBalance: s.currentBalance,
          reason: 'Opening conduct balance recorded from the live student record',
          createdBy: actor?.userId,
          status: 'posted',
          idempotencyKey: `opening-live:${String(s._id)}:${String(term._id)}`,
        })
        allocated++
      } catch (err) {
        if ((err as { code?: number }).code === 11000) allocated++
      }
      continue
    }

    const previousBalance = s.currentBalance
    const previousTermId = s.currentTermId ?? null
    const previousLegacyTermId = s.termId ?? null
    const guarded = await Student.updateOne(
      { _id: s._id, balanceVersion: s.balanceVersion },
      {
        $set: {
          currentBalance: starting,
          currentTermId: term._id,
          termId: term._id,
          balanceVersion: s.balanceVersion + 1,
        },
      },
    )
    if (guarded.modifiedCount !== 1) continue
    try {
      await DisciplineLedger.create({
        studentId: s._id,
        academicYearId: term.academicYearId,
        termId: term._id,
        type: 'initial_allocation',
        previousBalance: 0,
        change: starting,
        newBalance: starting,
        reason: `Initial conduct allocation — ${starting} marks for the term`,
        createdBy: actor?.userId,
        status: 'posted',
        idempotencyKey: `opening:${String(s._id)}:${String(term._id)}`,
      })
      allocated++
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        allocated++
        continue
      }
      await Student.updateOne(
        { _id: s._id, balanceVersion: s.balanceVersion + 1 },
        {
          $set: {
            currentBalance: previousBalance,
            currentTermId: previousTermId,
            termId: previousLegacyTermId,
            balanceVersion: s.balanceVersion + 2,
          },
        },
      )
      logger.error({ err, studentId: String(s._id) }, 'Term allocation failed; previous balance restored')
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

  const rows = await DisciplineLedger.find({ termId }).sort({ studentId: 1, createdAt: 1, _id: 1 }).lean()
  const studentIds = [...new Set(rows.map((row) => String(row.studentId)))].map((id) => new Types.ObjectId(id))
  const [students, duplicateDeductions] = await Promise.all([
    Student.find({ $or: [{ status: 'active' }, { _id: { $in: studentIds } }] })
      .select('fullName studentId currentBalance termId currentTermId')
      .lean(),
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

/**
 * Reconciles every term. Historical terms are included deliberately: a
 * correction posted into a past term must still chain correctly even though it
 * no longer influences the student's current balance.
 */
export async function reconcileAllTerms() {
  const terms = await Term.find().sort({ startDate: -1 }).lean()
  const reports = []
  for (const term of terms) {
    reports.push(await reconcileLedger(String(term._id)))
  }
  return {
    terms: reports,
    healthy: reports.every((report) => report.healthy),
    transactionsChecked: reports.reduce((sum, report) => sum + report.transactionsChecked, 0),
    issues: reports.reduce((sum, report) => sum + report.issues.length, 0),
    generatedAt: new Date(),
  }
}
