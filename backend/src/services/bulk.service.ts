import { Types } from 'mongoose'
import { Student } from '../models/school.js'
import { BulkOperation, DisciplineLedger, Offence, type IBulkResultLine } from '../models/discipline.js'
import { Recognition } from '../models/support.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from './audit.service.js'
import { postTransaction, termBalances } from './ledger.service.js'
import { resolveTerm } from './academic.service.js'
import { visibleStudentQuery, type AuthContext } from './rbac.service.js'
import { nextRef } from '../shared/refs.js'
import type { Request } from 'express'

export type BulkType = 'deduction' | 'reward'
export type BulkScope = 'class' | 'stream' | 'dormitory' | 'school' | 'selection'

export type BulkOperationInput = {
  type: BulkType
  scope: BulkScope
  classId?: string
  streamId?: string
  dormitoryId?: string
  studentIds?: string[]
  offenceId?: string
  points?: number
  reason: string
  title?: string
  termId?: string
  clientReference?: string
  excludeStudentIds?: string[]
  exclusionReason?: string
}

export type BulkPreviewLine = {
  studentId: string
  name: string
  currentBalance: number
  change: number
  projectedBalance: number
  skipped: boolean
  skipReason?: string
}

async function resolveStudents(ctx: AuthContext, input: BulkOperationInput) {
  const scopeFilter: Record<string, unknown> = {}
  if (input.scope === 'class') {
    if (!input.classId) throw ApiError.badRequest('Select a class')
    scopeFilter.classId = new Types.ObjectId(input.classId)
  } else if (input.scope === 'stream') {
    if (!input.streamId) throw ApiError.badRequest('Select a stream')
    scopeFilter.streamId = new Types.ObjectId(input.streamId)
  } else if (input.scope === 'dormitory') {
    if (!input.dormitoryId) throw ApiError.badRequest('Select a dormitory')
    scopeFilter.dormitoryId = new Types.ObjectId(input.dormitoryId)
  } else if (input.scope === 'selection') {
    if (!input.studentIds?.length) throw ApiError.badRequest('Select at least one student')
    scopeFilter._id = { $in: input.studentIds.map((id) => new Types.ObjectId(id)) }
  }
  // scope 'school' intentionally has no scope filter — every active student the
  // operator can see is included (subject to RBAC visibility).

  const visibility = await visibleStudentQuery(ctx)
  const filter = { status: 'active', ...visibility, ...scopeFilter }
  return Student.find(filter)
    .select('fullName studentId classId streamId dormitoryId currentBalance currentTermId termId academicYearId status')
    .lean()
}

async function resolvePerStudentChange(input: BulkOperationInput) {
  if (input.type === 'deduction') {
    if (!input.offenceId) throw ApiError.badRequest('Select an offence rule')
    const offence = await Offence.findById(input.offenceId)
    if (!offence || !offence.active) throw ApiError.badRequest('Select an active offence rule')
    if (offence.deduction <= 0) throw ApiError.badRequest('The selected offence carries no mark deduction')
    return { change: -offence.deduction, offence: { id: String(offence._id), name: offence.name, deduction: offence.deduction } }
  }
  const points = Math.round(input.points ?? 0)
  if (points <= 0) throw ApiError.badRequest('Reward points must be greater than zero')
  return { change: Math.min(20, points), offence: undefined }
}

export async function previewBulkOperation(ctx: AuthContext, input: BulkOperationInput) {
  const [students, perStudent, term] = await Promise.all([
    resolveStudents(ctx, input),
    resolvePerStudentChange(input),
    resolveTerm(input.termId),
  ])
  if (!students.length) throw ApiError.badRequest('No active students match this selection')

  // The screen must show the balance of the term being changed, not whatever
  // the student's live record happens to hold for a different term.
  const balances = await termBalances(
    students.map((student) => student._id),
    term._id,
  )
  const excluded = new Set((input.excludeStudentIds ?? []).map((id) => String(id)))
  const exclusionReason = input.exclusionReason?.trim() || 'Excluded by operator'
  const lines: BulkPreviewLine[] = students.map((student) => {
    const onTerm = String(student.currentTermId ?? student.termId ?? '') === String(term._id)
    const currentBalance = balances.get(String(student._id)) ?? (onTerm ? student.currentBalance : 0)
    let skipped = false
    let skipReason: string | undefined
    if (excluded.has(String(student._id))) {
      skipped = true
      skipReason = exclusionReason
    } else if (perStudent.change < 0 && currentBalance <= 0) {
      skipped = true
      skipReason = 'Balance already at zero — record the case for intervention instead'
    }
    const projectedBalance = skipped ? currentBalance : Math.max(0, currentBalance + perStudent.change)
    return {
      studentId: String(student._id),
      name: student.fullName,
      currentBalance,
      change: projectedBalance - currentBalance,
      projectedBalance,
      skipped,
      skipReason,
    }
  })

  const applicable = lines.filter((line) => !line.skipped).length
  return {
    type: input.type,
    scope: input.scope,
    offence: perStudent.offence,
    points: input.type === 'reward' ? perStudent.change : undefined,
    count: lines.length,
    applicable,
    skipped: lines.length - applicable,
    totalChange: lines.reduce((sum, line) => sum + (line.skipped ? 0 : line.change), 0),
    lines,
  }
}

export async function applyBulkOperation(ctx: AuthContext, input: BulkOperationInput, req?: Request) {
  const [preview, term] = await Promise.all([previewBulkOperation(ctx, input), resolveTerm(input.termId)])

  if (input.clientReference) {
    const existing = await BulkOperation.findOne({ clientReference: input.clientReference, requestedBy: ctx.userId })
    if (existing) return existing
  }

  const reference = await nextRef('BULK', 5)
  const excludedIds = new Set((input.excludeStudentIds ?? []).map((id) => String(id)))
  const exclusions = preview.lines
    .filter((line) => excludedIds.has(line.studentId))
    .map((line) => ({
      studentId: new Types.ObjectId(line.studentId),
      name: line.name,
      reason: line.skipReason ?? input.exclusionReason?.trim() ?? 'Excluded by operator',
    }))

  const operation = await BulkOperation.create({
    reference,
    type: input.type,
    scope: input.scope,
    classId: input.classId ? new Types.ObjectId(input.classId) : undefined,
    streamId: input.streamId ? new Types.ObjectId(input.streamId) : undefined,
    dormitoryId: input.dormitoryId ? new Types.ObjectId(input.dormitoryId) : undefined,
    offenceId: input.offenceId ? new Types.ObjectId(input.offenceId) : undefined,
    points: input.type === 'reward' ? preview.points : undefined,
    reason: input.reason,
    termId: term._id,
    requestedBy: ctx.userId,
    approvedBy: ctx.userId,
    status: 'applying',
    total: preview.count,
    exclusions,
    results: [],
    clientReference: input.clientReference,
  })

  const results: IBulkResultLine[] = []
  let applied = 0
  let skipped = 0
  let failed = 0

  for (const line of preview.lines) {
    const studentId = new Types.ObjectId(line.studentId)
    if (line.skipped) {
      skipped += 1
      results.push({ studentId, name: line.name, ok: false, skipped: true, skipReason: line.skipReason })
      continue
    }

    const already = await DisciplineLedger.findOne({ bulkOperationId: operation._id, studentId, type: input.type })
    if (already) {
      applied += 1
      results.push({
        studentId,
        name: line.name,
        ok: true,
        skipped: true,
        skipReason: 'Already applied in this operation',
        change: already.change,
        newBalance: already.newBalance,
        ledgerId: String(already._id),
      })
      continue
    }

    try {
      const ledger = await postTransaction({
        studentId,
        termId: String(term._id),
        academicYearId: String(term.academicYearId),
        type: input.type,
        change: line.change,
        reason: input.reason,
        actor: { userId: ctx.userId, name: ctx.name, roles: ctx.roles },
        approvedBy: ctx.userId,
        bulkOperationId: operation._id,
      })
      applied += 1
      results.push({
        studentId,
        name: line.name,
        ok: true,
        change: ledger.change,
        newBalance: ledger.newBalance,
        ledgerId: String(ledger._id),
      })
      if (input.type === 'reward') {
        await Recognition.create({
          studentId,
          type: 'reward',
          category: 'Positive conduct',
          title: input.title ?? 'Conduct reward',
          description: input.reason,
          points: ledger.change,
          awardedBy: ctx.userId,
          termId: term._id,
        })
      }
    } catch (err) {
      failed += 1
      results.push({
        studentId,
        name: line.name,
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to post transaction',
      })
    }
  }

  operation.results = results as never
  operation.applied = applied
  operation.skipped = skipped
  operation.failed = failed
  operation.status = failed === 0 ? 'completed' : applied === 0 ? 'failed' : 'partial'
  operation.completedAt = new Date()
  await operation.save()

  await writeAudit({
    req,
    actor: ctx,
    action: `discipline.bulk_${input.type}_applied`,
    resourceType: 'BulkOperation',
    resourceId: String(operation._id),
    after: { reference, type: input.type, applied, skipped, failed, total: preview.count },
    reason: input.reason,
  })

  return operation
}

async function changeForOperation(operation: InstanceType<typeof BulkOperation>): Promise<number> {
  if (operation.type === 'reward') return Math.min(20, Math.round(operation.points ?? 0))
  if (!operation.offenceId) throw ApiError.badRequest('This operation has no offence rule to retry')
  const offence = await Offence.findById(operation.offenceId)
  if (!offence || offence.deduction <= 0) throw ApiError.badRequest('The offence rule is no longer available')
  return -offence.deduction
}

/**
 * Retries only the lines that failed, against the same term and operation.
 *
 * The unique (bulkOperationId, studentId, type) index makes this safe to run
 * more than once: a student who was already credited is detected and reported
 * as skipped instead of being changed twice.
 */
export async function retryBulkOperation(ctx: AuthContext, id: string, req?: Request) {
  const operation = await BulkOperation.findById(id)
  if (!operation) throw ApiError.notFound('Bulk operation not found')
  if (String(operation.requestedBy) !== String(ctx.userId) && !ctx.permissions.has('incidents.view_all')) {
    throw ApiError.forbidden('You are not authorized to retry this bulk operation')
  }
  if (operation.status === 'applying') throw ApiError.badRequest('This operation is still running')
  const pending = operation.results.filter((line) => !line.ok && !line.skipped)
  if (!pending.length) return operation

  const term = await resolveTerm(operation.termId ? String(operation.termId) : undefined)
  const change = await changeForOperation(operation)
  const results = operation.results.map((line) => ({ ...line }))
  let recovered = 0
  let stillFailed = 0

  for (const line of results) {
    if (line.ok || line.skipped) continue
    const studentId = new Types.ObjectId(String(line.studentId))
    const already = await DisciplineLedger.findOne({
      bulkOperationId: operation._id,
      studentId,
      type: operation.type,
    })
    if (already) {
      line.ok = true
      line.change = already.change
      line.newBalance = already.newBalance
      line.ledgerId = String(already._id)
      line.error = undefined
      recovered += 1
      continue
    }
    try {
      const ledger = await postTransaction({
        studentId,
        termId: String(term._id),
        academicYearId: String(term.academicYearId),
        type: operation.type,
        change,
        reason: operation.reason,
        actor: { userId: ctx.userId, name: ctx.name, roles: ctx.roles },
        approvedBy: ctx.userId,
        bulkOperationId: operation._id,
      })
      line.ok = true
      line.change = ledger.change
      line.newBalance = ledger.newBalance
      line.ledgerId = String(ledger._id)
      line.error = undefined
      recovered += 1
      if (operation.type === 'reward') {
        await Recognition.create({
          studentId,
          type: 'reward',
          category: 'Positive conduct',
          title: 'Conduct reward',
          description: operation.reason,
          points: ledger.change,
          awardedBy: ctx.userId,
          termId: term._id,
        })
      }
    } catch (err) {
      stillFailed += 1
      line.error = err instanceof Error ? err.message : 'Retry failed'
    }
  }

  operation.results = results as never
  operation.applied += recovered
  operation.failed = stillFailed
  operation.status = stillFailed === 0 ? 'completed' : operation.applied === 0 ? 'failed' : 'partial'
  operation.completedAt = new Date()
  await operation.save()

  await writeAudit({
    req,
    actor: ctx,
    action: `discipline.bulk_${operation.type}_retried`,
    resourceType: 'BulkOperation',
    resourceId: String(operation._id),
    after: { reference: operation.reference, recovered, stillFailed },
  })
  return operation
}

/** CSV of the execution report an operator can download and file. */
export function bulkOperationCsv(operation: InstanceType<typeof BulkOperation>): string {
  const escape = (value: unknown) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const header = ['Reference', 'Type', 'Scope', 'Student', 'Outcome', 'Change', 'New balance', 'Ledger', 'Detail']
  const rows = operation.results.map((line) => [
    operation.reference,
    operation.type,
    operation.scope,
    line.name,
    line.ok ? (line.skipped ? 'Skipped' : 'Applied') : 'Failed',
    line.change ?? '',
    line.newBalance ?? '',
    line.ledgerId ?? '',
    line.ok ? line.skipReason ?? '' : line.error ?? '',
  ])
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
}