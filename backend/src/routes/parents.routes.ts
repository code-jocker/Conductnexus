import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, noContent, ok, pagedMeta, parsePagination, queryOf, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { GuardianLink, Parent, Student as StudentModel } from '../models/school.js'
import { Role, User, UserRole } from '../models/core.js'
import { normalizeRwandaPhone } from '../shared/utils.js'
import { hashPassword } from '../services/auth.service.js'
import { writeAudit } from '../services/audit.service.js'
import { assertStudentAccess } from '../services/rbac.service.js'
import { objectId, paginationQuery, searchRegex } from './helpers.js'

const router = Router()
router.use(authenticate)

const parentListQuery = paginationQuery.extend({
  consent: z.enum(['whatsapp', 'sms', 'email']).optional(),
})

router.get(
  '/parents',
  requirePermission('parents.view'),
  validate({ query: parentListQuery }),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const q = queryOf<z.infer<typeof parentListQuery>>(req)
    const filter: Record<string, unknown> = {}
    if (q.q) {
      const rx = searchRegex(q.q)
      filter.$or = [{ name: rx }, { phone: rx }, { email: rx }]
    }
    if (q.consent) filter[`${q.consent}Consent`] = true
    const [total, parents] = await Promise.all([
      Parent.countDocuments(filter),
      Parent.find(filter).sort({ name: 1 }).skip(skip).limit(pageSize).lean(),
    ])
    const links = await GuardianLink.find({ parentId: { $in: parents.map((p) => p._id) } })
      .populate('studentId', 'fullName studentId classId')
      .lean()
    ok(
      res,
      parents.map((p) => ({
        ...p,
        id: String(p._id),
        children: links.filter((l) => String(l.parentId) === String(p._id)),
      })),
      pagedMeta(total, page, pageSize),
    )
  }),
)

router.post(
  '/parents',
  requirePermission('parents.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      relationship: z.string().trim().max(60).optional().default('Guardian'),
      phone: z.string().trim().min(9),
      altPhone: z.string().trim().optional(),
      email: z.string().email().optional().or(z.literal('')),
      preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'call']).optional().default('sms'),
      whatsappConsent: z.boolean().optional().default(false),
      smsConsent: z.boolean().optional().default(false),
      emailConsent: z.boolean().optional().default(false),
      notes: z.string().trim().max(1000).optional(),
      studentId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const phone = normalizeRwandaPhone(req.body.phone)
    const parent = await Parent.create({
      ...req.body,
      phone,
      altPhone: req.body.altPhone ? normalizeRwandaPhone(req.body.altPhone) : undefined,
      email: req.body.email || undefined,
      portalUserId: undefined,
      createdBy: req.auth!.userId,
    })
    if (req.body.studentId) {
      await assertStudentAccess(req.auth!, req.body.studentId)
      await GuardianLink.updateOne(
        { studentId: req.body.studentId, parentId: parent._id },
        { $setOnInsert: { studentId: req.body.studentId, parentId: parent._id, relationship: parent.relationship, isPrimary: false } },
        { upsert: true },
      )
    }
    await writeAudit({ req, actor: req.auth, action: 'parent.created', resourceType: 'Parent', resourceId: String(parent._id), after: { name: parent.name } })
    created(res, parent)
  }),
)

router.get(
  '/parents/:id',
  requirePermission('parents.view'),
  asyncHandler(async (req, res) => {
    const parent = await Parent.findById(req.params.id).lean()
    if (!parent) throw ApiError.notFound('Parent not found')
    const links = await GuardianLink.find({ parentId: parent._id })
      .populate({ path: 'studentId', select: 'fullName studentId classId currentBalance riskLevel status', populate: { path: 'classId', select: 'name' } })
      .lean()
    ok(res, { ...parent, id: String(parent._id), children: links })
  }),
)

router.get(
  '/parents/:id/students',
  requirePermission('parents.view'),
  asyncHandler(async (req, res) => {
    const links = await GuardianLink.find({ parentId: req.params.id })
      .populate('studentId', 'fullName studentId classId currentBalance riskLevel status')
      .lean()
    ok(res, links)
  }),
)

router.patch(
  '/parents/:id',
  requirePermission('parents.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120).optional(),
      relationship: z.string().trim().max(60).optional(),
      phone: z.string().trim().min(9).optional(),
      altPhone: z.string().trim().optional(),
      email: z.string().email().optional().or(z.literal('')),
      preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'call']).optional(),
      whatsappConsent: z.boolean().optional(),
      smsConsent: z.boolean().optional(),
      emailConsent: z.boolean().optional(),
      notes: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const parent = await Parent.findById(req.params.id)
    if (!parent) throw ApiError.notFound('Parent not found')
    Object.assign(parent, req.body)
    if (req.body.phone) parent.phone = normalizeRwandaPhone(req.body.phone)
    if (req.body.altPhone) parent.altPhone = normalizeRwandaPhone(req.body.altPhone)
    if (req.body.email !== undefined) parent.email = req.body.email || undefined
    await parent.save()
    await writeAudit({ req, actor: req.auth, action: 'parent.updated', resourceType: 'Parent', resourceId: String(parent._id), after: req.body })
    ok(res, parent)
  }),
)

router.post(
  '/parents/:id/students',
  requirePermission('parents.manage'),
  validate({ body: z.object({ studentId: objectId, relationship: z.string().trim().max(60).optional(), isPrimary: z.boolean().optional().default(false) }) }),
  asyncHandler(async (req, res) => {
    const parent = await Parent.findById(req.params.id)
    if (!parent) throw ApiError.notFound('Parent not found')
    const student = await StudentModel.findById(req.body.studentId)
    if (!student) throw ApiError.notFound('Student not found')
    await assertStudentAccess(req.auth!, student._id)
    if (req.body.isPrimary) await GuardianLink.updateMany({ studentId: student._id }, { $set: { isPrimary: false } })
    const link = await GuardianLink.findOneAndUpdate(
      { studentId: student._id, parentId: parent._id },
      { $set: { relationship: req.body.relationship ?? parent.relationship, isPrimary: req.body.isPrimary } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    await writeAudit({
      req,
      actor: req.auth,
      action: 'parent.student_linked',
      resourceType: 'StudentGuardian',
      resourceId: String(link._id),
      after: { parentId: String(parent._id), studentId: String(student._id) },
    })
    created(res, link)
  }),
)

router.delete(
  '/parents/:id/students/:studentId',
  requirePermission('parents.manage'),
  asyncHandler(async (req, res) => {
    const link = await GuardianLink.findOneAndDelete({ parentId: req.params.id, studentId: req.params.studentId })
    if (!link) throw ApiError.notFound('Guardian link not found')
    await writeAudit({
      req,
      actor: req.auth,
      action: 'parent.student_unlinked',
      resourceType: 'StudentGuardian',
      resourceId: String(link._id),
      before: { parentId: req.params.id, studentId: req.params.studentId },
    })
    noContent(res)
  }),
)

router.post(
  '/parents/:id/portal-account',
  requirePermission('parents.manage'),
  asyncHandler(async (req, res) => {
    const parent = await Parent.findById(req.params.id)
    if (!parent) throw ApiError.notFound('Parent not found')
    if (parent.portalUserId) {
      const existing = await User.findById(parent.portalUserId).lean()
      return ok(res, { message: 'This parent already has a portal account.', email: existing?.email })
    }
    if (!parent.email) throw ApiError.badRequest('Add an email address to this parent before creating a portal account')
    if (await User.exists({ email: parent.email })) {
      throw ApiError.conflict('A user with this email already exists. Link the existing account instead.')
    }
    const temporaryPassword = `Cn-${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}!`
    const user = await User.create({
      name: parent.name,
      email: parent.email,
      phone: parent.phone,
      passwordHash: await hashPassword(temporaryPassword),
      emailVerified: true,
      status: 'active',
      mustChangePassword: true,
      position: 'Parent / Guardian',
      createdBy: req.auth!.userId,
    })
    const role = await Role.findOne({ key: 'PARENT' })
    if (!role) throw ApiError.internal('The PARENT role is missing. Re-run system seeding.')
    await UserRole.create({ userId: user._id, roleId: role._id, assignedBy: req.auth!.userId })
    parent.portalUserId = user._id
    await parent.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'parent.portal_account_created',
      resourceType: 'User',
      resourceId: String(user._id),
      after: { parentId: String(parent._id) },
    })
    created(res, { email: user.email, temporaryPassword, mustChangePassword: true })
  }),
)

router.post(
  '/parents/:id/consent',
  requirePermission('parents.manage'),
  validate({
    body: z.object({
      whatsappConsent: z.boolean().optional(),
      smsConsent: z.boolean().optional(),
      emailConsent: z.boolean().optional(),
      preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'call']).optional(),
      reason: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const parent = await Parent.findById(req.params.id)
    if (!parent) throw ApiError.notFound('Parent not found')
    const before = {
      whatsappConsent: parent.whatsappConsent,
      smsConsent: parent.smsConsent,
      emailConsent: parent.emailConsent,
      preferredChannel: parent.preferredChannel,
    }
    if (req.body.whatsappConsent !== undefined) parent.whatsappConsent = req.body.whatsappConsent
    if (req.body.smsConsent !== undefined) parent.smsConsent = req.body.smsConsent
    if (req.body.emailConsent !== undefined) parent.emailConsent = req.body.emailConsent
    if (req.body.preferredChannel) parent.preferredChannel = req.body.preferredChannel
    await parent.save()
    await writeAudit({
      req,
      actor: req.auth,
      action: 'parent.consent_changed',
      resourceType: 'Parent',
      resourceId: String(parent._id),
      before,
      after: req.body,
      reason: req.body.reason,
    })
    ok(res, parent)
  }),
)

router.get(
  '/parents/:id/students/:studentId/conduct',
  requirePermission('parents.view'),
  asyncHandler(async (req, res) => {
    const link = await GuardianLink.exists({ parentId: req.params.id, studentId: req.params.studentId })
    if (!link) throw ApiError.notFound('This parent is not linked to the student')
    const student = await assertStudentAccess(req.auth!, req.params.studentId)
    const { studentConductSummary } = await import('../services/ledger.service.js')
    const term = student.currentTermId ?? student.termId
    if (!term) throw ApiError.badRequest('This student has no active term')
    ok(res, { student: { id: String(student._id), fullName: student.fullName }, ...(await studentConductSummary(String(student._id), String(term))) })
  }),
)

export default router
