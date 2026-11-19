import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { Announcement, Acknowledgement, MeetingRequest } from '../models/engagement.js'
import { CalendarEvent, Letter, Meeting, Notification } from '../models/communications.js'
import { ClassModel, GuardianLink, Parent, Student } from '../models/school.js'
import { nextRef } from '../shared/refs.js'
import { writeAudit } from '../services/audit.service.js'
import { assertStudentAccess } from '../services/rbac.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

/** Classes and students a notice targets; an empty target means the whole school. */
async function targetStudentIds(announcement: { classIds: Types.ObjectId[]; studentIds: Types.ObjectId[] }) {
  if (announcement.studentIds.length) return announcement.studentIds
  if (announcement.classIds.length) {
    const students = await Student.find({ classId: { $in: announcement.classIds }, status: 'active' }).select('_id').lean()
    return students.map((s) => s._id)
  }
  const students = await Student.find({ status: 'active' }).select('_id').lean()
  return students.map((s) => s._id)
}

async function guardianCount(announcement: { classIds: Types.ObjectId[]; studentIds: Types.ObjectId[] }) {
  const studentIds = await targetStudentIds(announcement)
  if (!studentIds.length) return 0
  const parents = await GuardianLink.distinct('parentId', { studentId: { $in: studentIds } })
  return parents.length
}

// ── Announcements / notices ────────────────────────────────────────────────

router.get(
  '/announcements',
  requirePermission('letters.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (req.query.status) filter.status = req.query.status
    if (req.query.audience) filter.audience = req.query.audience
    if (req.query.q) filter.title = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const [total, items] = await Promise.all([
      Announcement.countDocuments(filter),
      Announcement.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).populate('createdBy', 'name').lean(),
    ])
    const ids = items.map((a) => a._id)
    const counts = ids.length
      ? await Acknowledgement.aggregate([
          { $match: { itemType: 'announcement', itemId: { $in: ids } } },
          {
            $group: {
              _id: '$itemId',
              acknowledged: { $sum: { $cond: [{ $eq: ['$status', 'acknowledged'] }, 1, 0] } },
              declined: { $sum: { $cond: [{ $eq: ['$status', 'declined'] }, 1, 0] } },
            },
          },
        ])
      : []
    const countMap = new Map(counts.map((c) => [String(c._id), c]))
    const expected = await Promise.all(
      items.filter((a) => a.requiresAcknowledgement).map(async (a) => ({ id: String(a._id), expected: await guardianCount(a) })),
    )
    const expectedMap = new Map(expected.map((e) => [e.id, e.expected]))
    ok(
      res,
      items.map((a) => ({
        ...a,
        acknowledgementCounts: countMap.get(String(a._id)) ?? { acknowledged: 0, declined: 0 },
        expectedAcknowledgements: expectedMap.get(String(a._id)) ?? null,
      })),
      pagedMeta(total, page, pageSize),
    )
  }),
)

router.post(
  '/announcements',
  requirePermission('letters.create'),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(200),
      body: z.string().trim().min(10).max(20000),
      titleRw: z.string().trim().max(200).optional(),
      bodyRw: z.string().max(20000).optional(),
      audience: z.enum(['parents', 'staff', 'all']).default('parents'),
      classIds: z.array(objectId).max(60).optional().default([]),
      studentIds: z.array(objectId).max(500).optional().default([]),
      requiresAcknowledgement: z.boolean().optional().default(false),
      publishAt: z.string().trim().optional(),
      expiresAt: z.string().trim().optional(),
      publish: z.boolean().optional().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      classIds: string[]
      studentIds: string[]
      publishAt?: string
      expiresAt?: string
      publish: boolean
      [key: string]: unknown
    }
    const classIds = body.classIds.map((id) => new Types.ObjectId(id))
    const studentIds = body.studentIds.map((id) => new Types.ObjectId(id))
    if (classIds.length) {
      const found = await ClassModel.countDocuments({ _id: { $in: classIds }, active: true })
      if (found !== new Set(body.classIds).size) throw ApiError.badRequest('One or more classes are not active')
    }
    if (studentIds.length) {
      const found = await Student.countDocuments({ _id: { $in: studentIds }, status: 'active' })
      if (found !== new Set(body.studentIds).size) throw ApiError.badRequest('One or more students are not active')
    }
    const publishAt = body.publishAt ? new Date(body.publishAt) : undefined
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined
    if (publishAt && Number.isNaN(publishAt.getTime())) throw ApiError.badRequest('Invalid publication date')
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw ApiError.badRequest('Invalid expiry date')
    if (publishAt && expiresAt && expiresAt <= publishAt) throw ApiError.badRequest('Expiry must be after publication')
    const reference = await nextRef('ANN', 4)
    const announcement = await Announcement.create({
      reference,
      title: body.title,
      body: body.body,
      titleRw: body.titleRw,
      bodyRw: body.bodyRw,
      audience: body.audience,
      classIds,
      studentIds,
      requiresAcknowledgement: body.requiresAcknowledgement,
      status: body.publish ? 'published' : 'draft',
      publishAt: body.publish ? publishAt ?? new Date() : publishAt,
      expiresAt,
      createdBy: req.auth!.userId,
      publishedBy: body.publish ? req.auth!.userId : undefined,
      publishedAt: body.publish ? new Date() : undefined,
    })
    await writeAudit({
      req,
      actor: req.auth,
      action: body.publish ? 'announcement.published' : 'announcement.drafted',
      resourceType: 'Announcement',
      resourceId: String(announcement._id),
      after: { reference, title: announcement.title, audience: announcement.audience },
    })
    created(res, announcement)
  }),
)

router.patch(
  '/announcements/:id',
  requirePermission('letters.create'),
  validate({
    body: z.object({
      action: z.enum(['publish', 'archive', 'restore']).optional(),
      title: z.string().trim().min(3).max(200).optional(),
      body: z.string().trim().min(10).max(20000).optional(),
      titleRw: z.string().trim().max(200).optional(),
      bodyRw: z.string().max(20000).optional(),
      requiresAcknowledgement: z.boolean().optional(),
      expiresAt: z.string().trim().nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const announcement = await Announcement.findById(req.params.id)
    if (!announcement) throw ApiError.notFound('Announcement not found')
    const before = { status: announcement.status, title: announcement.title }
    if (req.body.expiresAt !== undefined) {
      announcement.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined
      if (announcement.expiresAt && Number.isNaN(announcement.expiresAt.getTime())) throw ApiError.badRequest('Invalid expiry date')
    }
    if (req.body.title !== undefined) announcement.title = req.body.title
    if (req.body.body !== undefined) announcement.body = req.body.body
    if (req.body.titleRw !== undefined) announcement.titleRw = req.body.titleRw
    if (req.body.bodyRw !== undefined) announcement.bodyRw = req.body.bodyRw
    if (req.body.requiresAcknowledgement !== undefined) announcement.requiresAcknowledgement = req.body.requiresAcknowledgement
    if (req.body.action === 'publish') {
      announcement.status = 'published'
      announcement.publishAt = announcement.publishAt ?? new Date()
      announcement.publishedAt = new Date()
      announcement.publishedBy = req.auth!.userId
    } else if (req.body.action === 'archive') {
      announcement.status = 'archived'
    } else if (req.body.action === 'restore') {
      announcement.status = 'published'
    }
    await announcement.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: `announcement.${req.body.action ?? 'updated'}`,
      resourceType: 'Announcement',
      resourceId: String(announcement._id),
      before,
      after: { status: announcement.status, title: announcement.title },
    })
    ok(res, announcement)
  }),
)

router.get(
  '/announcements/:id/acknowledgements',
  requirePermission('letters.view'),
  asyncHandler(async (req, res) => {
    const announcement = await Announcement.findById(req.params.id).lean()
    if (!announcement) throw ApiError.notFound('Announcement not found')
    const responses = await Acknowledgement.find({ itemType: 'announcement', itemId: announcement._id })
      .populate('parentId', 'name phone email')
      .populate('studentId', 'fullName studentId')
      .sort({ respondedAt: -1 })
      .lean()
    ok(res, {
      announcement: { id: String(announcement._id), reference: announcement.reference, title: announcement.title },
      expected: await guardianCount(announcement),
      responses: responses.map((r) => ({
        id: String(r._id),
        parent: r.parentId,
        student: r.studentId,
        status: r.status,
        note: r.note,
        respondedAt: r.respondedAt,
      })),
    })
  }),
)

// ── Guardian responses across notices, letters and policies ────────────────

router.get(
  '/acknowledgements',
  requirePermission('letters.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (req.query.itemType) filter.itemType = req.query.itemType
    if (req.query.status) filter.status = req.query.status
    const [total, responses] = await Promise.all([
      Acknowledgement.countDocuments(filter),
      Acknowledgement.find(filter)
        .populate('parentId', 'name phone')
        .populate('studentId', 'fullName studentId')
        .sort({ respondedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
    ])
    const letterIds = responses.filter((r) => r.itemType === 'letter').map((r) => r.itemId)
    const letters = letterIds.length
      ? await Letter.find({ _id: { $in: letterIds } }).select('reference subject type').lean()
      : []
    const letterMap = new Map(letters.map((l) => [String(l._id), l]))
    ok(
      res,
      responses.map((r) => ({
        ...r,
        letter: r.itemType === 'letter' ? letterMap.get(String(r.itemId)) ?? null : undefined,
      })),
      pagedMeta(total, page, pageSize),
    )
  }),
)

// ── Guardian meeting requests ──────────────────────────────────────────────

router.get(
  '/meeting-requests',
  requirePermission('meetings.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (req.query.status) filter.status = req.query.status
    const [total, items] = await Promise.all([
      MeetingRequest.countDocuments(filter),
      MeetingRequest.find(filter)
        .populate('parentId', 'name phone email')
        .populate('studentId', 'fullName studentId classId')
        .populate('decidedBy', 'name')
        .sort({ preferredAt: 1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
    ])
    ok(res, items, pagedMeta(total, page, pageSize))
  }),
)

router.patch(
  '/meeting-requests/:id',
  requirePermission('meetings.manage'),
  validate({
    body: z.object({
      action: z.enum(['approve', 'decline', 'cancel']),
      scheduledAt: z.string().trim().optional(),
      durationMinutes: z.number().int().min(10).max(240).optional().default(30),
      location: z.string().trim().max(200).optional(),
      note: z.string().trim().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const request = await MeetingRequest.findById(req.params.id)
    if (!request) throw ApiError.notFound('Meeting request not found')
    if (request.status !== 'pending') throw ApiError.conflict('This request has already been decided')
    const parent = await Parent.findById(request.parentId)
    const student = await Student.findById(request.studentId)
    if (!parent || !student) throw ApiError.notFound('Guardian or student record is missing')
    await assertStudentAccess(req.auth!, student._id)

    if (req.body.action === 'decline') {
      request.status = 'declined'
      request.decidedBy = req.auth!.userId
      request.decidedAt = new Date()
      request.decisionNote = req.body.note
      await request.save()
      await writeAudit({
        req,
        actor: req.auth,
        action: 'meeting_request.declined',
        resourceType: 'MeetingRequest',
        resourceId: String(request._id),
        after: { note: req.body.note },
      })
      ok(res, request)
      return
    }
    if (req.body.action === 'cancel') {
      request.status = 'cancelled'
      request.decidedBy = req.auth!.userId
      request.decidedAt = new Date()
      request.decisionNote = req.body.note
      await request.save()
      await writeAudit({
        req,
        actor: req.auth,
        action: 'meeting_request.cancelled',
        resourceType: 'MeetingRequest',
        resourceId: String(request._id),
      })
      ok(res, request)
      return
    }

    const scheduledAt = new Date(req.body.scheduledAt ?? request.preferredAt)
    if (Number.isNaN(scheduledAt.getTime())) throw ApiError.badRequest('Invalid meeting date and time')
    const durationMinutes = req.body.durationMinutes ?? 30
    const reference = await nextRef('MTG', 4)
    const meeting = await Meeting.create({
      reference,
      title: `Parent meeting — ${student.fullName}`,
      type: 'parent',
      scheduledAt,
      durationMinutes,
      location: req.body.location ?? 'School campus',
      studentId: student._id,
      participants: [{ name: parent.name, phone: parent.phone, role: 'Guardian' }],
      attendance: [{ name: parent.name, status: 'invited' }],
      confidentiality: 'standard',
      status: 'scheduled',
      createdBy: req.auth!.userId,
    })
    const event = await CalendarEvent.create({
      title: meeting.title,
      type: 'parent_meeting',
      startAt: scheduledAt,
      endAt: new Date(scheduledAt.getTime() + durationMinutes * 60_000),
      allDay: false,
      location: meeting.location ?? undefined,
      studentId: student._id,
      meetingId: meeting._id,
      assignedTo: [],
      createdBy: req.auth!.userId,
      notes: `Meeting ${reference}`,
      confidential: false,
    })
    meeting.calendarEventId = event._id
    await meeting.save()

    request.status = 'approved'
    request.meetingId = meeting._id
    request.decidedBy = req.auth!.userId
    request.decidedAt = new Date()
    request.decisionNote = req.body.note
    await request.save()

    if (parent.portalUserId) {
      await Notification.create({
        userId: parent.portalUserId,
        type: 'meeting.confirmed',
        title: 'Meeting confirmed',
        message: `Your meeting about ${student.fullName} is confirmed for ${scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}.`,
        link: '/portal',
        priority: 'normal',
      })
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'meeting_request.approved',
      resourceType: 'MeetingRequest',
      resourceId: String(request._id),
      after: { meetingId: String(meeting._id), reference, scheduledAt },
    })
    ok(res, { request, meeting })
  }),
)

export default router
