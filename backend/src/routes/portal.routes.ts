import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, ok } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { ClassModel, Dormitory, GuardianLink, Parent, Student } from '../models/school.js'
import { DisciplineLedger, Incident } from '../models/discipline.js'
import { Letter, Meeting, MessageQueue } from '../models/communications.js'
import { Announcement, Acknowledgement, MeetingRequest } from '../models/engagement.js'
import { Recognition } from '../models/support.js'
import { DataRequest } from '../models/governance.js'
import { RiskAssessment } from '../models/discipline.js'
import { AbsenceExcuse, AttendanceRecord, BoardingMovement } from '../models/attendance.js'
import { nextRef } from '../shared/refs.js'
import { writeAudit } from '../services/audit.service.js'
import { notifyPermission } from '../services/notification.service.js'
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
// Scoped to /portal: an unscoped middleware would also run for unrelated paths
// that fall through to this router and reject them with the wrong error.
portalRouter.use('/portal', authenticate, requirePermission('portal.view_children'))

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
        deduction: i.offenceSnapshot?.deduction ?? 0,
        deductionApplied: i.deductionApplied,
      })),
      letters,
      meetings,
      recognition,
      riskHistory,
    })
  }),
)

portalRouter.get(
  '/portal/children/:id/attendance',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    const { student } = await assertChild(parent._id, idOf(req))
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : undefined
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : undefined
    const filter: Record<string, unknown> = { studentId: student._id }
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    const [records, movements, excuses] = await Promise.all([
      AttendanceRecord.find(filter).sort({ date: -1 }).limit(120).lean(),
      BoardingMovement.find({ studentId: student._id }).sort({ outAt: -1 }).limit(10).lean(),
      AbsenceExcuse.find({ studentId: student._id }).sort({ submittedAt: -1 }).limit(10).lean(),
    ])
    const summary = { present: 0, absent: 0, late: 0, excused: 0, sick: 0, permission: 0, suspended: 0 }
    for (const record of records) summary[record.status]++
    const attended = summary.present + summary.late
    const counted = records.length - summary.excused - summary.permission
    ok(res, {
      student: { id: String(student._id), fullName: student.fullName, studentId: student.studentId },
      records: records.map((r) => ({
        id: String(r._id),
        date: r.date,
        session: r.session,
        status: r.status,
        minutesLate: r.minutesLate,
        reason: r.reason,
      })),
      summary,
      attendanceRate: counted > 0 ? Math.round((attended / counted) * 1000) / 10 : null,
      boarding: {
        status: student.boardingStatus ?? 'day',
        dormitory: student.dormitoryId ? String(student.dormitoryId) : null,
        movements: movements.map((m) => ({
          reference: m.reference,
          type: m.type,
          destination: m.destination,
          outAt: m.outAt,
          expectedReturnAt: m.expectedReturnAt,
          returnedAt: m.returnedAt,
          status: m.status,
        })),
      },
      excuses,
    })
  }),
)

portalRouter.post(
  '/portal/children/:id/excuses',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    const { student } = await assertChild(parent._id, idOf(req))
    const body = z
      .object({
        fromDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
        toDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
        category: z.enum(['medical', 'family', 'transport', 'school_activity', 'other']).default('other'),
        reason: z.string().trim().min(5).max(1000),
      })
      .parse(req.body)
    if (body.toDate < body.fromDate) throw ApiError.badRequest('The excuse end date cannot be before the start date')
    const overlap = await AbsenceExcuse.exists({
      studentId: student._id,
      status: 'pending',
      fromDate: { $lte: body.toDate },
      toDate: { $gte: body.fromDate },
    })
    if (overlap) throw ApiError.conflict('An excuse covering these dates is already awaiting review')
    const excuse = await AbsenceExcuse.create({
      reference: await nextRef('EXC'),
      studentId: student._id,
      ...body,
      submittedBy: actorOf(req).userId,
      submittedByName: parent.name,
      status: 'pending',
    })
    await writeAudit({
      req,
      actor: actorOf(req),
      action: 'attendance.parent_excuse_submitted',
      resourceType: 'AbsenceExcuse',
      resourceId: String(excuse._id),
      after: { studentId: String(student._id), fromDate: body.fromDate, toDate: body.toDate, category: body.category },
    })
    res.status(201).json({ success: true, data: excuse })
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

// ── School notices, acknowledgements and meeting bookings (audit P4) ──────

type LinkedChild = { id: string; classId: string; fullName: string; studentId: string }

async function linkedChildren(parentId: Types.ObjectId): Promise<LinkedChild[]> {
  const links = await GuardianLink.find({ parentId })
    .populate<{ studentId: { _id: Types.ObjectId; classId: Types.ObjectId; fullName: string; studentId: string } | null }>('studentId')
    .lean()
  return links
    .filter((l) => l.studentId)
    .map((l) => ({
      id: String(l.studentId!._id),
      classId: l.studentId!.classId ? String(l.studentId!.classId) : '',
      fullName: l.studentId!.fullName,
      studentId: l.studentId!.studentId,
    }))
}

function noticeMatchesChild(
  notice: { classIds: Types.ObjectId[]; studentIds: Types.ObjectId[] },
  children: LinkedChild[],
) {
  if (!notice.classIds.length && !notice.studentIds.length) return true
  const ownClassIds = new Set(children.map((c) => c.classId).filter(Boolean))
  const ownStudentIds = new Set(children.map((c) => c.id))
  return (
    notice.classIds.some((id) => ownClassIds.has(String(id))) ||
    notice.studentIds.some((id) => ownStudentIds.has(String(id)))
  )
}

portalRouter.get(
  '/portal/notices',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    const children = await linkedChildren(parent._id)
    const classIds = children.map((c) => new Types.ObjectId(c.classId)).filter((id) => id)
    const studentIds = children.map((c) => new Types.ObjectId(c.id))
    const now = new Date()
    const notices = await Announcement.find({
      status: 'published',
      audience: { $in: ['parents', 'all'] },
      $and: [
        { $or: [{ publishAt: { $exists: false } }, { publishAt: { $lte: now } }] },
        { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }] },
        {
          $or: [
            { classIds: { $size: 0 }, studentIds: { $size: 0 } },
            ...(classIds.length ? [{ classIds: { $in: classIds } }] : []),
            ...(studentIds.length ? [{ studentIds: { $in: studentIds } }] : []),
          ],
        },
      ],
    })
      .sort({ publishAt: -1, createdAt: -1 })
      .limit(50)
      .lean()
    const acknowledgements = notices.length
      ? await Acknowledgement.find({
          parentId: parent._id,
          itemType: 'announcement',
          itemId: { $in: notices.map((n) => n._id) },
        })
          .select('itemId status respondedAt')
          .lean()
      : []
    const ackMap = new Map(acknowledgements.map((a) => [String(a.itemId), a]))
    ok(res, {
      notices: notices
        .filter((n) => noticeMatchesChild(n, children))
        .map((n) => ({
          id: String(n._id),
          reference: n.reference,
          title: n.title,
          body: n.body,
          titleRw: n.titleRw,
          bodyRw: n.bodyRw,
          requiresAcknowledgement: n.requiresAcknowledgement,
          publishedAt: n.publishedAt ?? n.publishAt,
          acknowledgement: ackMap.get(String(n._id)) ?? null,
        })),
      children,
    })
  }),
)

portalRouter.post(
  '/portal/notices/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        decision: z.enum(['acknowledged', 'declined']),
        note: z.string().trim().max(1000).optional(),
        studentId: z.string().optional(),
      })
      .parse(req.body)
    const parent = await currentParent(actorOf(req).userId)
    const children = await linkedChildren(parent._id)
    if (input.studentId) await assertChild(parent._id, input.studentId)
    if (!Types.ObjectId.isValid(req.params.id)) throw ApiError.badRequest('Invalid notice identifier')
    const notice = await Announcement.findOne({ _id: req.params.id, status: 'published' })
    if (!notice) throw ApiError.notFound('Notice not found')
    const now = new Date()
    if (notice.expiresAt && notice.expiresAt <= now) throw ApiError.badRequest('This notice has expired')
    if (!noticeMatchesChild(notice, children)) throw ApiError.forbidden('This notice is not addressed to your family')
    const acknowledgement = await Acknowledgement.findOneAndUpdate(
      { parentId: parent._id, itemType: 'announcement', itemId: notice._id },
      {
        $set: {
          status: input.decision,
          note: input.note,
          respondedAt: now,
          studentId: input.studentId ? new Types.ObjectId(input.studentId) : undefined,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    await writeAudit({
      req,
      actor: actorOf(req),
      action: 'portal.notice.acknowledged',
      resourceType: 'Announcement',
      resourceId: String(notice._id),
      after: { decision: input.decision, parentId: String(parent._id) },
    })
    ok(res, acknowledgement)
  }),
)

portalRouter.get(
  '/portal/letters',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    const children = await linkedChildren(parent._id)
    const letters = await Letter.find({ studentId: { $in: children.map((c) => c.id) }, status: 'issued' })
      .sort({ issuedAt: -1 })
      .limit(100)
      .select('reference type subject issuedAt studentId confidentiality')
      .lean()
    const acknowledgements = letters.length
      ? await Acknowledgement.find({
          parentId: parent._id,
          itemType: 'letter',
          itemId: { $in: letters.map((l) => l._id) },
        })
          .select('itemId status respondedAt')
          .lean()
      : []
    const ackMap = new Map(acknowledgements.map((a) => [String(a.itemId), a]))
    const childMap = new Map(children.map((c) => [c.id, c]))
    ok(
      res,
      letters
        .filter((l) => l.confidentiality !== 'restricted')
        .map((l) => ({
          id: String(l._id),
          reference: l.reference,
          type: l.type,
          subject: l.subject,
          issuedAt: l.issuedAt,
          student: childMap.get(String(l.studentId)) ?? null,
          acknowledgement: ackMap.get(String(l._id)) ?? null,
        })),
    )
  }),
)

portalRouter.post(
  '/portal/letters/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const input = z
      .object({ decision: z.enum(['acknowledged', 'declined']), note: z.string().trim().max(1000).optional() })
      .parse(req.body)
    const parent = await currentParent(actorOf(req).userId)
    if (!Types.ObjectId.isValid(req.params.id)) throw ApiError.badRequest('Invalid letter identifier')
    const letter = await Letter.findOne({ _id: req.params.id, status: 'issued' })
    if (!letter) throw ApiError.notFound('Letter not found')
    await assertChild(parent._id, String(letter.studentId))
    const acknowledgement = await Acknowledgement.findOneAndUpdate(
      { parentId: parent._id, itemType: 'letter', itemId: letter._id },
      { $set: { status: input.decision, note: input.note, respondedAt: new Date(), studentId: letter.studentId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    await writeAudit({
      req,
      actor: actorOf(req),
      action: 'portal.letter.acknowledged',
      resourceType: 'Letter',
      resourceId: String(letter._id),
      after: { decision: input.decision, parentId: String(parent._id) },
    })
    ok(res, acknowledgement)
  }),
)

portalRouter.get(
  '/portal/messages',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    // Address fallback covers historical rows queued before parentId was stored.
    const addresses = [parent.phone, parent.email].filter(Boolean) as string[]
    const messages = await MessageQueue.find({
      $or: [{ parentId: parent._id }, ...(addresses.length ? [{ to: { $in: addresses } }] : [])],
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('channel subject body status sentAt deliveredAt readAt createdAt studentId templateKey')
      .populate('studentId', 'fullName studentId')
      .lean()
    ok(
      res,
      messages.map((m) => ({
        id: String(m._id),
        channel: m.channel,
        subject: m.subject,
        body: m.body,
        status: m.status,
        templateKey: m.templateKey,
        student: m.studentId,
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
        createdAt: m.createdAt,
      })),
    )
  }),
)

portalRouter.get(
  '/portal/meeting-requests',
  asyncHandler(async (req, res) => {
    const parent = await currentParent(actorOf(req).userId)
    const requests = await MeetingRequest.find({ parentId: parent._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('studentId', 'fullName studentId')
      .populate('meetingId', 'reference scheduledAt location status')
      .lean()
    ok(res, requests)
  }),
)

portalRouter.post(
  '/portal/meeting-requests',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        studentId: z.string().trim().min(1),
        preferredAt: z.string().trim().min(4),
        alternateAt: z.string().trim().optional(),
        reason: z.string().trim().min(10).max(2000),
      })
      .parse(req.body)
    const parent = await currentParent(actorOf(req).userId)
    const { student } = await assertChild(parent._id, input.studentId)
    const preferredAt = new Date(input.preferredAt)
    const alternateAt = input.alternateAt ? new Date(input.alternateAt) : undefined
    if (Number.isNaN(preferredAt.getTime())) throw ApiError.badRequest('Choose a valid preferred date and time')
    if (alternateAt && Number.isNaN(alternateAt.getTime())) throw ApiError.badRequest('Choose a valid alternative date and time')
    if (preferredAt.getTime() < Date.now()) throw ApiError.badRequest('Preferred date must be in the future')
    if (preferredAt.getTime() > Date.now() + 180 * 86_400_000) throw ApiError.badRequest('Preferred date must be within the next six months')
    if (alternateAt && alternateAt.getTime() < Date.now()) throw ApiError.badRequest('Alternative date must be in the future')
    const pending = await MeetingRequest.exists({ parentId: parent._id, studentId: student._id, status: 'pending' })
    if (pending) throw ApiError.conflict('You already have a meeting request awaiting a response for this child')
    const request = await MeetingRequest.create({
      reference: await nextRef('MRQ', 4),
      parentId: parent._id,
      studentId: student._id,
      preferredAt,
      alternateAt,
      reason: input.reason,
      status: 'pending',
    })
    await notifyPermission('meetings.manage', {
      type: 'meeting.requested',
      title: 'Guardian meeting request',
      message: `${parent.name} requested a meeting about ${student.fullName}.`,
      link: '/engagement',
    })
    await writeAudit({
      req,
      actor: actorOf(req),
      action: 'portal.meeting.requested',
      resourceType: 'MeetingRequest',
      resourceId: String(request._id),
      after: { studentId: String(student._id), preferredAt },
    })
    res.status(201)
    ok(res, request)
  }),
)
