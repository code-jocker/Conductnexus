import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, ok, pagedMeta, parsePagination, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { CalendarEvent, Meeting } from '../models/communications.js'
import { User } from '../models/core.js'
import { nextRef } from '../shared/refs.js'
import { queueParentMessage } from '../services/communication.service.js'
import { assertStudentAccess } from '../services/rbac.service.js'
import { notifyUsers } from '../services/notification.service.js'
import { writeAudit } from '../services/audit.service.js'
import { objectId } from './helpers.js'

const router = Router()
router.use(authenticate)

const kigaliDate = (d: Date) => d.toLocaleDateString('en-RW', { timeZone: 'Africa/Kigali' })
const kigaliTime = (d: Date) => d.toLocaleTimeString('en-RW', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' })

async function makeCalendarEvent(input: {
  title: string
  type: InstanceType<typeof CalendarEvent>['type']
  startAt: Date
  endAt: Date
  location?: string
  studentId?: Types.ObjectId
  meetingId?: Types.ObjectId
  assignedTo: Types.ObjectId[]
  createdBy: Types.ObjectId
  notes?: string
  confidential: boolean
}) {
  return CalendarEvent.create({ ...input, allDay: false })
}

router.get(
  '/meetings',
  requirePermission('meetings.view'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const filter: Record<string, unknown> = {}
    if (req.query.type) filter.type = req.query.type
    if (req.query.status) filter.status = req.query.status
    if (req.query.from || req.query.to) {
      filter.scheduledAt = {
        ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}),
        ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}),
      }
    }
    const items = await Meeting.find(filter)
      .sort({ scheduledAt: 1 })
      .skip(skip)
      .limit(pageSize)
      .populate('studentId', 'fullName studentId')
      .populate('createdBy', 'name')
      .lean()
    const canSeeRestricted = req.auth!.permissions.has('meetings.notes.view') || req.auth!.roles.includes('HEADTEACHER')
    const visible = items.filter((m) => {
      if (m.confidentiality !== 'restricted' || canSeeRestricted) return true
      return String(m.createdBy) === String(req.auth!.userId) || m.participants.some((p) => String(p.userId ?? '') === String(req.auth!.userId))
    })
    ok(res, visible, pagedMeta(visible.length, page, pageSize))
  }),
)

router.post(
  '/meetings',
  requirePermission('meetings.manage'),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(200),
      type: z.enum(['parent', 'hearing', 'counselling', 'staff', 'safeguarding']).default('parent'),
      scheduledAt: z.string().trim().min(4),
      durationMinutes: z.number().int().min(10).max(480).optional().default(30),
      location: z.string().trim().max(200).optional(),
      studentId: objectId.optional(),
      caseId: objectId.optional(),
      participants: z
        .array(z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(40).optional(), role: z.string().trim().max(80).optional(), userId: objectId.optional() }))
        .optional()
        .default([]),
      notes: z.string().trim().max(5000).optional(),
      confidentiality: z.enum(['standard', 'restricted']).optional().default('standard'),
      sendParentInvite: z.boolean().optional().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    const scheduledAt = new Date(req.body.scheduledAt)
    if (Number.isNaN(scheduledAt.getTime())) throw ApiError.badRequest('Invalid meeting date and time')
    if (req.body.confidentiality === 'restricted' && !req.auth!.permissions.has('meetings.notes.view') && !req.auth!.roles.includes('HEADTEACHER')) {
      throw ApiError.forbidden('Only authorized leadership can restrict a meeting')
    }
    if (req.body.studentId) await assertStudentAccess(req.auth!, req.body.studentId)
    const participantIds = req.body.participants.map((p: { userId?: string }) => p.userId).filter(Boolean) as string[]
    if (participantIds.length) {
      const count = await User.countDocuments({ _id: { $in: participantIds }, status: 'active' })
      if (count !== new Set(participantIds).size) throw ApiError.badRequest('One or more participants are not active staff members')
    }
    const reference = await nextRef('MTG', 4)
    const endAt = new Date(scheduledAt.getTime() + req.body.durationMinutes * 60_000)
    const meeting = await Meeting.create({
      reference,
      title: req.body.title,
      type: req.body.type,
      scheduledAt,
      durationMinutes: req.body.durationMinutes,
      location: req.body.location,
      studentId: req.body.studentId,
      caseId: req.body.caseId,
      participants: req.body.participants,
      attendance: [
        ...participantIds.map((id: string) => ({ userId: new Types.ObjectId(id), status: 'invited' })),
        ...req.body.participants
          .filter((p: { userId?: string }) => !p.userId)
          .map((p: { name: string }) => ({ name: p.name, status: 'invited' })),
      ],
      notes: req.body.notes,
      confidentiality: req.body.confidentiality,
      status: 'scheduled',
      createdBy: req.auth!.userId,
    })
    const event = await makeCalendarEvent({
      title: meeting.title,
      type: meeting.type === 'staff' ? 'staff' : meeting.type === 'hearing' ? 'hearing' : meeting.type === 'counselling' ? 'counselling' : 'parent_meeting',
      startAt: scheduledAt,
      endAt,
      location: meeting.location ?? undefined,
      studentId: meeting.studentId ?? undefined,
      meetingId: meeting._id,
      assignedTo: participantIds.map((id: string) => new Types.ObjectId(id)),
      createdBy: req.auth!.userId,
      notes: `Meeting ${reference}`,
      confidential: meeting.confidentiality === 'restricted',
    })
    meeting.calendarEventId = event._id
    let inviteQueued = 0
    if (req.body.sendParentInvite && meeting.studentId) {
      const result = await queueParentMessage({
        studentId: meeting.studentId,
        templateKey: 'meeting_invitation',
        dedupeSuffix: String(meeting._id),
        createdBy: req.auth!.userId,
        extraVars: {
          meetingDate: kigaliDate(scheduledAt),
          meetingTime: kigaliTime(scheduledAt),
          venue: req.body.location ?? 'School campus',
        },
      })
      inviteQueued = result.queued
      meeting.invitations.push({ channel: 'whatsapp/sms/email', status: inviteQueued ? 'queued' : 'not_queued', sentAt: new Date(), to: 'Student guardians' })
    }
    await meeting.save()
    if (participantIds.length) {
      await notifyUsers(participantIds, {
        type: 'meeting.invitation',
        title: 'Meeting scheduled',
        message: `${meeting.title} — ${kigaliDate(scheduledAt)} at ${kigaliTime(scheduledAt)}`,
        link: `/meetings/${meeting._id}`,
      })
    }
    await writeAudit({ req, actor: req.auth, action: 'meeting.created', resourceType: 'Meeting', resourceId: String(meeting._id), after: { reference, title: meeting.title, inviteQueued } })
    created(res, { meeting, calendarEventId: String(event._id), invitesQueued: inviteQueued })
  }),
)

router.get(
  '/meetings/:id',
  requirePermission('meetings.view'),
  asyncHandler(async (req, res) => {
    const meeting = await Meeting.findById(req.params.id)
      .populate('studentId', 'fullName studentId classId')
      .populate('createdBy', 'name')
      .populate('participants.userId', 'name position')
    if (!meeting) throw ApiError.notFound('Meeting not found')
    const canSeeRestricted = req.auth!.permissions.has('meetings.notes.view') || req.auth!.roles.includes('HEADTEACHER')
    if (meeting.confidentiality === 'restricted' && !canSeeRestricted) {
      const isCreator = String(meeting.createdBy) === String(req.auth!.userId)
      const isParticipant = meeting.participants.some((p) => String(p.userId ?? '') === String(req.auth!.userId))
      if (!isCreator && !isParticipant) throw ApiError.forbidden('This meeting record is confidential')
    }
    ok(res, meeting)
  }),
)

router.patch(
  '/meetings/:id',
  requirePermission('meetings.manage'),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(200).optional(),
      scheduledAt: z.string().trim().optional(),
      durationMinutes: z.number().int().min(10).max(480).optional(),
      location: z.string().trim().max(200).optional(),
      status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
      notes: z.string().trim().max(10000).optional(),
      decisions: z.string().trim().max(10000).optional(),
      confidentiality: z.enum(['standard', 'restricted']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const meeting = await Meeting.findById(req.params.id)
    if (!meeting) throw ApiError.notFound('Meeting not found')
    const before = { status: meeting.status, scheduledAt: meeting.scheduledAt }
    Object.assign(meeting, req.body)
    if (req.body.scheduledAt) meeting.scheduledAt = new Date(req.body.scheduledAt)
    await meeting.save()
    if (meeting.calendarEventId && (req.body.scheduledAt || req.body.title || req.body.location || req.body.status)) {
      await CalendarEvent.updateOne(
        { _id: meeting.calendarEventId },
        {
          $set: {
            ...(req.body.title ? { title: req.body.title } : {}),
            ...(req.body.scheduledAt ? { startAt: meeting.scheduledAt } : {}),
            ...(req.body.durationMinutes ? { endAt: new Date(meeting.scheduledAt.getTime() + req.body.durationMinutes * 60_000) } : {}),
            ...(req.body.location !== undefined ? { location: req.body.location } : {}),
            ...(req.body.status === 'cancelled' ? { status: 'cancelled' } : {}),
            ...(req.body.status === 'completed' ? { status: 'completed' } : {}),
          },
        },
      )
    }
    await writeAudit({ req, actor: req.auth, action: 'meeting.updated', resourceType: 'Meeting', resourceId: String(meeting._id), before, after: req.body })
    ok(res, meeting)
  }),
)

router.post(
  '/meetings/:id/attendance',
  requirePermission('meetings.manage'),
  validate({
    body: z.object({
      attendance: z.array(z.object({ name: z.string().trim().max(120).optional(), userId: objectId.optional(), status: z.enum(['invited', 'attended', 'absent', 'excused']) })),
    }),
  }),
  asyncHandler(async (req, res) => {
    const meeting = await Meeting.findById(req.params.id)
    if (!meeting) throw ApiError.notFound('Meeting not found')
    meeting.attendance = req.body.attendance.map((a: { name?: string; userId?: string; status: 'invited' | 'attended' | 'absent' | 'excused' }) => ({
      name: a.name,
      userId: a.userId ? new Types.ObjectId(a.userId) : undefined,
      status: a.status,
    }))
    await meeting.save()
    await writeAudit({ req, actor: req.auth, action: 'meeting.attendance_recorded', resourceType: 'Meeting', resourceId: String(meeting._id), after: { entries: meeting.attendance.length } })
    ok(res, meeting)
  }),
)

router.post(
  '/meetings/:id/follow-ups',
  requirePermission('meetings.manage'),
  validate({
    body: z.object({
      description: z.string().trim().min(3).max(1000),
      assigneeId: objectId.optional(),
      dueDate: z.string().trim().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const meeting = await Meeting.findById(req.params.id)
    if (!meeting) throw ApiError.notFound('Meeting not found')
    meeting.followUpActions.push({
      description: req.body.description,
      assigneeId: req.body.assigneeId ? new Types.ObjectId(req.body.assigneeId) : undefined,
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
      status: 'pending',
    })
    await meeting.save()
    if (req.body.assigneeId) {
      await notifyUsers([req.body.assigneeId], {
        type: 'meeting.followup',
        title: 'Meeting follow-up assigned',
        message: req.body.description,
        link: `/meetings/${meeting._id}`,
      })
    }
    await writeAudit({ req, actor: req.auth, action: 'meeting.followup_added', resourceType: 'Meeting', resourceId: String(meeting._id) })
    created(res, meeting.followUpActions[meeting.followUpActions.length - 1])
  }),
)

// ── Calendar ───────────────────────────────────────────────────────────────

router.get(
  '/calendar',
  requirePermission('calendar.view'),
  asyncHandler(async (req, res) => {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date()
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 86_400_000)
    const ctx = req.auth!
    const filter: Record<string, unknown> = {
      startAt: { $gte: from, $lte: to },
      status: { $ne: 'cancelled' },
      $or: [{ assignedTo: ctx.userId }, { createdBy: ctx.userId }, { confidential: false }],
    }
    const events = await CalendarEvent.find(filter).sort({ startAt: 1 }).limit(500).lean()
    ok(res, events)
  }),
)

router.post(
  '/calendar',
  requirePermission('calendar.manage'),
  validate({
    body: z.object({
      title: z.string().trim().min(2).max(200),
      type: z.enum(['parent_meeting', 'hearing', 'counselling', 'follow_up', 'deadline', 'school', 'staff']).default('school'),
      startAt: z.string().trim().min(4),
      endAt: z.string().trim().min(4),
      allDay: z.boolean().optional().default(false),
      location: z.string().trim().max(200).optional(),
      studentId: objectId.optional(),
      assignedTo: z.array(objectId).optional().default([]),
      notes: z.string().trim().max(3000).optional(),
      confidential: z.boolean().optional().default(false),
      reminderMinutes: z.number().int().min(0).max(10080).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const startAt = new Date(req.body.startAt)
    const endAt = new Date(req.body.endAt)
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt < startAt) {
      throw ApiError.badRequest('The event must end after it starts')
    }
    const event = await CalendarEvent.create({
      ...req.body,
      startAt,
      endAt,
      createdBy: req.auth!.userId,
      assignedTo: req.body.assignedTo.map((id: string) => new Types.ObjectId(id)),
    })
    await writeAudit({ req, actor: req.auth, action: 'calendar.event_created', resourceType: 'CalendarEvent', resourceId: String(event._id), after: { title: event.title } })
    created(res, event)
  }),
)

router.patch(
  '/calendar/:id',
  requirePermission('calendar.manage'),
  validate({
    body: z.object({
      title: z.string().trim().min(2).max(200).optional(),
      startAt: z.string().trim().optional(),
      endAt: z.string().trim().optional(),
      location: z.string().trim().max(200).optional(),
      status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
      notes: z.string().trim().max(3000).optional(),
      reminderMinutes: z.number().int().min(0).max(10080).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const event = await CalendarEvent.findById(req.params.id)
    if (!event) throw ApiError.notFound('Calendar event not found')
    Object.assign(event, req.body)
    if (req.body.startAt) event.startAt = new Date(req.body.startAt)
    if (req.body.endAt) event.endAt = new Date(req.body.endAt)
    await event.save()
    await writeAudit({ req, actor: req.auth, action: 'calendar.event_updated', resourceType: 'CalendarEvent', resourceId: String(event._id), after: req.body })
    ok(res, event)
  }),
)

export default router
