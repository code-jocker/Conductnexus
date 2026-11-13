import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, ok } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { ClassModel, Dormitory, GuardianLink, Parent, Student } from '../models/school.js'
import { DisciplineLedger, Incident } from '../models/discipline.js'
import { Letter, Meeting } from '../models/communications.js'
import { Recognition } from '../models/support.js'
import { DataRequest } from '../models/governance.js'
import { RiskAssessment } from '../models/discipline.js'
import { nextRef } from '../shared/refs.js'
import { writeAudit } from '../services/audit.service.js'
import { actorOf, idOf } from './helpers.js'

const PORTAL_INCIDENT_STATUSES = ['approved', 'resolved', 'closed']

async function currentParent(userId: Types.ObjectId) {
  const parent = await Parent.findOne({ portalUserId: userId })
  if (!parent) throw ApiError.forbidden('This account is not linked to a parent record.')
  return parent
}

async function assertChild(parentId: Types.ObjectId, studentId: string) {
  if (!Types.ObjectId.isValid(studentId)) throw ApiError.badRequest('Invalid student identifier')
  const link = await GuardianLink.findOne({ parentId, studentId })
  if (!link) throw ApiError.forbidden('You can only view children linked to your account.')
  const student = await Student.findById(studentId)
  if (!student) throw ApiError.notFound('Student not found')
  return { student, link }
}

export const portalRouter = Router()
portalRouter.use(authenticate, requirePermission('portal.view_children'))

portalRouter.get(
  '/portal/children',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    const links = await GuardianLink.find({ parentId: parent._id }).populate('studentId').lean()
    const children = await Promise.all(
      links
        .filter((l) => l.studentId)
        .map(async (l) => {
          const s = l.studentId as unknown as {
            _id: Types.ObjectId
            fullName: string
            studentId: string
            classId: Types.ObjectId
            dormitoryId?: Types.ObjectId
            currentBalance: number
            riskLevel: string
            status: string
          }
          const [cls, dorm] = await Promise.all([
            ClassModel.findById(s.classId).select('name').lean(),
            s.dormitoryId ? Dormitory.findById(s.dormitoryId).select('name').lean() : null,
          ])
          return {
            id: String(s._id),
            fullName: s.fullName,
            admissionNumber: s.studentId,
            className: cls?.name ?? '',
            dormitory: dorm?.name ?? '',
            balance: s.currentBalance,
            risk: s.riskLevel,
            status: s.status,
            relationship: l.relationship,
            primary: l.isPrimary,
          }
        }),
    )
    ok(res, { parent: { name: parent.name, phone: parent.phone, email: parent.email }, children })
  }),
)

portalRouter.get(
  '/portal/children/:id',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    const { student } = await assertChild(parent._id, idOf(req))
    const termId = student.currentTermId ?? student.termId
    const [cls, dorm, ledger, incidents, letters, meetings, recognition, riskHistory] = await Promise.all([
      ClassModel.findById(student.classId).select('name level').lean(),
      student.dormitoryId ? Dormitory.findById(student.dormitoryId).select('name').lean() : null,
      termId ? DisciplineLedger.find({ studentId: student._id, termId }).sort({ createdAt: -1 }).limit(60).lean() : [],
      Incident.find({ studentId: student._id, status: { $in: PORTAL_INCIDENT_STATUSES } })
        .sort({ occurredAt: -1 })
        .limit(30)
        .select('incidentNumber offenceSnapshot description occurredAt status deductionApplied')
        .lean(),
      Letter.find({ studentId: student._id, status: 'issued' }).sort({ createdAt: -1 }).limit(15).select('reference type subject issuedAt').lean(),
      Meeting.find({ studentId: student._id, status: 'scheduled' })
        .sort({ scheduledAt: 1 })
        .limit(10)
        .select('reference title scheduledAt location type')
        .lean(),
      Recognition.find({ studentId: student._id }).sort({ awardedAt: -1 }).limit(10).select('title description points awardedAt').lean(),
      RiskAssessment.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(5).select('riskLevel createdAt reasons').lean(),
    ])

    const deductions = ledger.filter((l) => l.change < 0).reduce((s, l) => s + Math.abs(l.change), 0)
    const rewards = ledger.filter((l) => l.type === 'reward').reduce((s, l) => s + l.change, 0)
    const initial = ledger.find((l) => l.type === 'initial_allocation')

    ok(res, {
      student: {
        id: String(student._id),
        fullName: student.fullName,
        admissionNumber: student.studentId,
        gender: student.gender,
        className: cls?.name ?? '',
        level: cls?.level ?? '',
        dormitory: dorm?.name ?? '',
        status: student.status,
        balance: student.currentBalance,
        risk: student.riskLevel,
      },
      conduct: {
        startingMarks: initial?.change ?? 0,
        totalDeductions: deductions,
        totalRewards: rewards,
        balance: student.currentBalance,
        transactions: ledger.map((l) => ({
          id: String(l._id),
          type: l.type,
          change: l.change,
          newBalance: l.newBalance,
          reason: l.reason,
          at: l.createdAt,
        })),
      },
      incidents: incidents.map((i) => ({
        id: String(i._id),
        reference: i.incidentNumber,
        offence: i.offenceSnapshot?.name,
        description: i.description,
        occurredAt: i.occurredAt,
        status: i.status,
        deduction: i.deductionApplied,
      })),
      letters,
      meetings,
      recognition,
      riskHistory,
    })
  }),
)

portalRouter.get(
  '/portal/consent',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    ok(res, {
      whatsappConsent: parent.whatsappConsent,
      smsConsent: parent.smsConsent,
      emailConsent: parent.emailConsent,
      preferredChannel: parent.preferredChannel,
    })
  }),
)

portalRouter.patch(
  '/portal/consent',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        whatsappConsent: z.boolean().optional(),
        smsConsent: z.boolean().optional(),
        emailConsent: z.boolean().optional(),
        preferredChannel: z.enum(['whatsapp', 'sms', 'email']).optional(),
      })
      .parse(req.body)
    const parent = await currentParent(actorOf(req).userId)
    const before = { whatsappConsent: parent.whatsappConsent, smsConsent: parent.smsConsent, emailConsent: parent.emailConsent }
    Object.assign(parent, input)
    await parent.save()
    await writeAudit({
      req,
      actor: actorOf(req),
      action: 'parent.consent.self_service',
      resourceType: 'Parent',
      resourceId: String(parent._id),
      before,
      after: input,
    })
    ok(res, { whatsappConsent: parent.whatsappConsent, smsConsent: parent.smsConsent, emailConsent: parent.emailConsent, preferredChannel: parent.preferredChannel })
  }),
)

portalRouter.post(
  '/portal/data-requests',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        type: z.enum(['correction', 'access', 'objection', 'erasure']),
        studentId: z.string().optional(),
        details: z.string().trim().min(10).max(4000),
      })
      .parse(req.body)
    const parent = await currentParent(actorOf(req).userId)
    if (input.studentId) await assertChild(parent._id, input.studentId)
    const request = await DataRequest.create({
      requestNumber: await nextRef('DSR', 4),
      type: input.type,
      requesterName: parent.name,
      requesterContact: parent.email || parent.phone,
      studentId: input.studentId ? new Types.ObjectId(input.studentId) : undefined,
      details: input.details,
      dueDate: new Date(Date.now() + 30 * 86_400_000),
    })
    res.status(201)
    ok(res, { requestNumber: request.requestNumber, type: request.type, status: request.status, dueDate: request.dueDate })
  }),
)
