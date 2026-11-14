import { Types } from 'mongoose'
import { Student } from '../models/school.js'
import { BulkOperation, DisciplineLedger, Offence, type IBulkResultLine } from '../models/discipline.js'
import { Recognition } from '../models/support.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from './audit.service.js'
import { postTransaction } from './ledger.service.js'
import { resolveTerm } from './academic.service.js'
import { visibleStudentQuery, type AuthContext } from './rbac.service.js'
import { nextRef } from '../shared/refs.js'
import type { Request } from 'express'

export type BulkType = 'deduction' | 'reward'
export type BulkScope = 'class' | 'stream' | 'selection'

export type BulkOperationInput = {
  type: BulkType
  scope: BulkScope
  classId?: string
  streamId?: string
  studentIds?: string[]
  offenceId?: string
  points?: number
  reason: string
  title?: string
  termId?: string
  clientReference?: string
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
  } else {
    if (!input.studentIds?.length) throw ApiError.badRequest('Select at least one student')
    scopeFilter._id = { $in: input.studentIds.map((id) => new Types.ObjectId(id)) }
  }

  const visibility = await visibleStudentQuery(ctx)
  const filter = { status: 'active', ...visibility, ...scopeFilter }
  return Student.find(filter)
    .select('fullName studentId classId streamId currentBalance currentTermId termId academicYearId status')
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
  const [students, perStudent] = await Promise.all([resolveStudents(ctx, input), resolvePerStudentChange(input)])
  if (!students.length) throw ApiError.badRequest('No active students match this selection')

  const lines: BulkPreviewLine[] = students.map((student) => {
    const currentBalance = student.currentBalance
    let skipped = false
    let skipReason: string | undefined
    if (perStudent.change < 0 && currentBalance <= 0) {
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
  const operation = await BulkOperation.create({
    reference,
    type: input.type,
    scope: input.scope,
    classId: input.classId ? new Types.ObjectId(input.classId) : undefined,
    streamId: input.streamId ? new Types.ObjectId(input.streamId) : undefined,
    offenceId: input.offenceId ? new Types.ObjectId(input.offenceId) : undefined,
    points: input.type === 'reward' ? preview.points : undefined,
    reason: input.reason,
    termId: term._id,
    requestedBy: ctx.userId,
    approvedBy: ctx.userId,
    status: 'applying',
    total: preview.count,
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