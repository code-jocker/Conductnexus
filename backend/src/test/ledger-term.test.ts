import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { AcademicYear, ClassModel, Student, Term } from '../models/school.js'
import { DisciplineLedger } from '../models/discipline.js'
import { seedSchoolDefaults } from '../services/seed.service.js'
import {
  postTransaction,
  reconcileAllTerms,
  reconcileLedger,
  reverseTransaction,
  studentConductSummary,
  termBalance,
} from '../services/ledger.service.js'

/**
 * Conduct ledger and academic-term isolation.
 *
 * These tests run against whatever MongoDB the suite is pointed at. On a
 * standalone server they exercise the optimistic-CAS path; on a replica set the
 * same assertions cover the transactional path. Both must preserve the same
 * invariants: one row per idempotency key, a per-term balance derived from that
 * term's own ledger, and an immutable chain that reconciles.
 */

const ACTOR = { userId: new mongoose.Types.ObjectId(), name: 'Ledger Test Admin', roles: ['ADMIN'] }

let yearId: mongoose.Types.ObjectId
let termA: mongoose.Types.ObjectId
let termB: mongoose.Types.ObjectId
let studentId: mongoose.Types.ObjectId

async function makeTerm(name: string, number: number, isActive: boolean) {
  return Term.create({
    academicYearId: yearId,
    name,
    number,
    startDate: new Date('2099-01-01T00:00:00Z'),
    endDate: new Date('2099-12-31T00:00:00Z'),
    isActive,
    startingMarks: 40,
  })
}

beforeAll(async () => {
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await seedSchoolDefaults({ schoolName: 'Ledger Test School' })

  const year = await AcademicYear.create({
    name: 'Test Academic Year 2099',
    startDate: new Date('2099-01-01T00:00:00Z'),
    endDate: new Date('2099-12-31T00:00:00Z'),
    isActive: false,
    status: 'planned',
  })
  yearId = year._id

  const a = await makeTerm('Test Term A', 1, true)
  const b = await makeTerm('Test Term B', 2, false)
  termA = a._id
  termB = b._id

  const cls = await ClassModel.create({ name: 'Ledger Test Class', level: 'O' })
  const student = await Student.create({
    studentId: 'LEDGER-001',
    admissionNumber: 'ADM-LEDGER-001',
    firstName: 'Ledger',
    lastName: 'Student',
    fullName: 'Ledger Student',
    gender: 'male',
    classId: cls._id,
    academicYearId: yearId,
    termId: termA,
    currentTermId: termA,
    currentBalance: 0,
  })
  studentId = student._id
})

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
})

describe('conduct ledger integrity', () => {
  it('posts the opening allocation once and stays idempotent', async () => {
    const opening = await postTransaction({
      studentId,
      termId: termA,
      academicYearId: yearId,
      type: 'initial_allocation',
      change: 40,
      reason: 'Opening conduct allocation',
      actor: ACTOR,
      idempotencyKey: `opening:${String(studentId)}:${String(termA)}`,
    })
    expect(opening.newBalance).toBe(40)
    expect(await termBalance(studentId, termA)).toBe(40)

    const again = await postTransaction({
      studentId,
      termId: termA,
      academicYearId: yearId,
      type: 'initial_allocation',
      change: 40,
      reason: 'Opening conduct allocation',
      actor: ACTOR,
      idempotencyKey: `opening:${String(studentId)}:${String(termA)}`,
    })
    expect(String(again._id)).toBe(String(opening._id))
    const rows = await DisciplineLedger.countDocuments({ studentId, termId: termA })
    expect(rows).toBe(1)
  })

  it('returns the original row when a retried write reuses its idempotency key', async () => {
    const key = 'reward-idempotency-1'
    const first = await postTransaction({
      studentId,
      termId: termA,
      type: 'reward',
      change: 2,
      reason: 'Helping a classmate',
      actor: ACTOR,
      idempotencyKey: key,
    })
    const second = await postTransaction({
      studentId,
      termId: termA,
      type: 'reward',
      change: 2,
      reason: 'Helping a classmate',
      actor: ACTOR,
      idempotencyKey: key,
    })
    expect(String(second._id)).toBe(String(first._id))
    expect(await termBalance(studentId, termA)).toBe(42)
    expect(await DisciplineLedger.countDocuments({ idempotencyKey: key })).toBe(1)
  })

  it('keeps each term balance independent from the live student balance', async () => {
    const deductA = await postTransaction({
      studentId,
      termId: termA,
      type: 'deduction',
      change: -5,
      reason: 'Late to class',
      actor: ACTOR,
    })
    expect(deductA.newBalance).toBe(37)
    expect(await termBalance(studentId, termA)).toBe(37)

    // Move the student onto the next term with a fresh opening balance.
    const student = await Student.findById(studentId)
    if (!student) throw new Error('student missing')
    student.currentTermId = termB
    student.termId = termB
    student.currentBalance = 0
    student.balanceVersion += 1
    await student.save()

    await postTransaction({
      studentId,
      termId: termB,
      academicYearId: yearId,
      type: 'initial_allocation',
      change: 40,
      reason: 'Opening conduct allocation — Term B',
      actor: ACTOR,
      idempotencyKey: `opening:${String(studentId)}:${String(termB)}`,
    })
    await postTransaction({
      studentId,
      termId: termB,
      type: 'deduction',
      change: -3,
      reason: 'Missing homework',
      actor: ACTOR,
    })

    expect(await termBalance(studentId, termA)).toBe(37)
    expect(await termBalance(studentId, termB)).toBe(37)
    const live = await Student.findById(studentId).lean()
    expect(live?.currentBalance).toBe(37)
  })

  it('posts a historical correction into the old term without touching the live balance', async () => {
    await postTransaction({
      studentId,
      termId: termA,
      type: 'correction',
      change: -2,
      reason: 'Correction to a Term A deduction',
      actor: ACTOR,
    })

    expect(await termBalance(studentId, termA)).toBe(35)
    expect(await termBalance(studentId, termB)).toBe(37)
    const live = await Student.findById(studentId).lean()
    expect(live?.currentBalance).toBe(37)

    const summary = await studentConductSummary(String(studentId), String(termA))
    expect(summary.currentBalance).toBe(35)
    expect(summary.termBalance).toBe(35)
    expect(summary.studentBalance).toBe(37)
    expect(summary.isCurrentTerm).toBe(false)
    expect(summary.transactions).toHaveLength(4)
  })

  it('rejects a duplicate deduction for the same incident', async () => {
    const incidentId = new mongoose.Types.ObjectId()
    const first = await postTransaction({
      studentId,
      termId: termB,
      type: 'deduction',
      change: -1,
      reason: 'Incident-linked deduction',
      actor: ACTOR,
      incidentId,
    })
    expect(first.newBalance).toBe(36)

    await expect(
      postTransaction({
        studentId,
        termId: termB,
        type: 'deduction',
        change: -1,
        reason: 'Retry of the same incident',
        actor: ACTOR,
        incidentId,
      }),
    ).rejects.toMatchObject({ status: 409 })

    // Reversal puts the mark back exactly once.
    const reversal = await reverseTransaction({
      ledgerId: String(first._id),
      reason: 'Incident was overturned on appeal',
      actor: ACTOR,
    })
    expect(reversal.type).toBe('reversal')
    expect(reversal.change).toBe(1)
    expect(await termBalance(studentId, termB)).toBe(37)

    await expect(
      reverseTransaction({ ledgerId: String(first._id), reason: 'Second reversal attempt', actor: ACTOR }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('reconciles every term against its own ledger chain', async () => {
    const report = await reconcileLedger(String(termB))
    expect(report.healthy).toBe(true)
    expect(report.issues).toEqual([])
    expect(report.transactionsChecked).toBeGreaterThan(0)

    const all = await reconcileAllTerms()
    expect(all.healthy).toBe(true)
    expect(all.issues).toBe(0)
  })

  it('detects a stored balance that drifted from the ledger', async () => {
    await Student.updateOne({ _id: studentId }, { $set: { currentBalance: 99 } })
    const report = await reconcileLedger(String(termB))
    expect(report.healthy).toBe(false)
    expect(report.issues.some((issue) => issue.kind === 'balance_drift')).toBe(true)
    // Reconciliation reports, it never silently edits the historical record.
    const last = await DisciplineLedger.findOne({ studentId, termId: termB }).sort({ createdAt: -1, _id: -1 }).lean()
    expect(last?.newBalance).toBe(37)
    await Student.updateOne({ _id: studentId }, { $set: { currentBalance: 37 } })
  })
})
