import { AccessRequest, Role, User, UserRole } from '../models/core.js'
import { ApiError } from '../shared/errors.js'
import { env } from '../config/env.js'
import { ROLE_SEEDS, isRequestableRole } from '../shared/roles.js'
import { hashPassword } from './auth.service.js'
import {
  accessApprovedEmail,
  accessReceivedEmail,
  accessRejectedEmail,
  sendMail,
} from './email.service.js'
import { sendWhatsAppText } from './communication.service.js'
import { writeAudit } from './audit.service.js'
import type { AuthContext } from './rbac.service.js'

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected'

export type SubmitAccessRequestInput = {
  name: string
  email: string
  phone?: string
  requestedRole: string
  reason?: string
}

function roleLabel(key: string): string {
  return ROLE_SEEDS.find((role) => role.key === key)?.name ?? key
}

async function resolveRole(key: string) {
  const role = await Role.findOne({ key }).lean()
  if (!role) throw ApiError.badRequest('The selected role is not available in this school yet')
  return role
}

function requireRequestableRole(key: string): string {
  const normalized = key.trim().toUpperCase()
  if (!isRequestableRole(normalized)) throw ApiError.badRequest('That role cannot be requested from the sign-in page')
  return normalized
}

export type SubmitOutcome = 'created' | 'updated' | 'existing'

/**
 * Records a public access request.
 *
 * The route always answers with the same message regardless of the outcome so
 * the form cannot be used to discover which emails already have accounts.
 */
export async function submitAccessRequest(input: SubmitAccessRequestInput): Promise<SubmitOutcome> {
  const email = input.email.trim().toLowerCase()
  const requestedRole = requireRequestableRole(input.requestedRole)
  await resolveRole(requestedRole)

  if (await User.exists({ email })) return 'existing'

  const pending = await AccessRequest.findOne({ email, status: 'pending' })
  if (pending) {
    pending.name = input.name
    pending.phone = input.phone
    pending.requestedRole = requestedRole
    pending.reason = input.reason
    await pending.save()
    return 'updated'
  }

  const request = await AccessRequest.create({
    name: input.name,
    email,
    phone: input.phone,
    requestedRole,
    reason: input.reason,
    status: 'pending',
  })

  const mail = accessReceivedEmail(input.name, roleLabel(requestedRole))
  await sendMail({ to: email, ...mail })
  await writeAudit({
    action: 'access_request.submitted',
    resourceType: 'AccessRequest',
    resourceId: String(request._id),
    after: { email, requestedRole },
  })
  return 'created'
}

export async function listAccessRequests(options: {
  status?: AccessRequestStatus
  page: number
  pageSize: number
  skip: number
}) {
  const filter = options.status ? { status: options.status } : {}
  const [total, rows] = await Promise.all([
    AccessRequest.countDocuments(filter),
    AccessRequest.find(filter).sort({ createdAt: -1 }).skip(options.skip).limit(options.pageSize).lean(),
  ])
  const reviewerIds = rows.map((row) => row.reviewedBy).filter(Boolean)
  const reviewers = reviewerIds.length
    ? await User.find({ _id: { $in: reviewerIds } }).select('name').lean()
    : []
  const reviewerNames = new Map(reviewers.map((user) => [String(user._id), user.name]))

  return {
    total,
    rows: rows.map((row) => ({
      ...row,
      id: String(row._id),
      roleName: roleLabel(row.requestedRole),
      reviewedByName: row.reviewedBy ? reviewerNames.get(String(row.reviewedBy)) : undefined,
    })),
  }
}

function temporaryPassword(): string {
  return `Cn-${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}!`
}

export type ApproveAccessRequestOptions = { roleKey?: string; note?: string }

export async function approveAccessRequest(
  id: string,
  actor: AuthContext,
  options: ApproveAccessRequestOptions = {},
) {
  const request = await AccessRequest.findById(id)
  if (!request) throw ApiError.notFound('Access request not found')
  if (request.status !== 'pending') throw ApiError.conflict('This request has already been reviewed')

  const roleKey = requireRequestableRole(options.roleKey ?? request.requestedRole)
  const role = await resolveRole(roleKey)

  let user = await User.findOne({ email: request.email })
  let created = false
  let password: string | undefined

  if (!user) {
    password = temporaryPassword()
    user = await User.create({
      name: request.name,
      email: request.email,
      phone: request.phone,
      position: role.name,
      passwordHash: await hashPassword(password),
      emailVerified: false,
      status: 'active',
      mustChangePassword: true,
      createdBy: actor.userId,
    })
    created = true
  }

  await UserRole.updateOne(
    { userId: user._id, roleId: role._id },
    {
      $setOnInsert: {
        userId: user._id,
        roleId: role._id,
        assignedBy: actor.userId,
        assignedAt: new Date(),
      },
    },
    { upsert: true },
  )

  const link = `${env.APP_URL}/login`
  const mail = accessApprovedEmail(user.name, role.name, link, password)
  const emailResult = await sendMail({ to: user.email, ...mail })

  let whatsappDelivered = false
  let whatsappError: string | undefined
  if (request.phone) {
    const body = [
      `Hello ${user.name}, your ConductNexus access was approved.`,
      `Role: ${role.name}.`,
      password ? `Temporary password: ${password}` : 'Use your existing password to sign in.',
      `Sign in: ${link}`,
      'Change your password after signing in.',
    ].join('\n')
    const result = await sendWhatsAppText(request.phone, body)
    whatsappDelivered = result.ok
    if (!result.ok) whatsappError = result.error
  } else {
    whatsappError = 'No phone number was provided'
  }

  request.status = 'approved'
  request.reviewedBy = actor.userId
  request.reviewedAt = new Date()
  request.decisionNote = options.note
  request.userId = user._id
  request.notifications = { email: emailResult.delivered, whatsapp: whatsappDelivered }
  await request.save()

  await writeAudit({
    actor,
    action: created ? 'access_request.approved' : 'access_request.role_granted',
    resourceType: 'AccessRequest',
    resourceId: String(request._id),
    after: { email: user.email, roleKey: role.key, userId: String(user._id) },
  })

  return {
    request: { ...request.toJSON(), id: String(request._id), roleName: role.name },
    user: { id: String(user._id), name: user.name, email: user.email },
    created,
    temporaryPassword: emailResult.delivered ? undefined : password,
    emailDelivered: emailResult.delivered,
    whatsappDelivered,
    whatsappError,
  }
}

export async function rejectAccessRequest(id: string, actor: AuthContext, note?: string) {
  const request = await AccessRequest.findById(id)
  if (!request) throw ApiError.notFound('Access request not found')
  if (request.status !== 'pending') throw ApiError.conflict('This request has already been reviewed')

  request.status = 'rejected'
  request.reviewedBy = actor.userId
  request.reviewedAt = new Date()
  request.decisionNote = note

  const mail = accessRejectedEmail(request.name, note)
  const emailResult = await sendMail({ to: request.email, ...mail })
  request.notifications = { email: emailResult.delivered, whatsapp: false }
  await request.save()

  await writeAudit({
    actor,
    action: 'access_request.rejected',
    resourceType: 'AccessRequest',
    resourceId: String(request._id),
    after: { email: request.email, note },
  })

  return {
    request: { ...request.toJSON(), id: String(request._id) },
    emailDelivered: emailResult.delivered,
  }
}
