import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate, requirePermission } from '../middleware/auth.js'
import { asyncHandler, created, noContent, ok, pagedMeta, parsePagination, queryOf, validate } from '../shared/http.js'
import { PERMISSIONS, PERMISSION_SET } from '../shared/permissions.js'
import {
  Permission,
  Role,
  RolePermission,
  User,
  UserPermissionOverride,
  UserRole,
} from '../models/core.js'
import { ApiError } from '../shared/errors.js'
import { hashPassword, revokeAllSessions } from '../services/auth.service.js'
import { getUserContext, invalidateUserAccess } from '../services/rbac.service.js'
import { listUserSessions, revokeSession } from '../services/session.service.js'
import { writeAudit } from '../services/audit.service.js'
import { inviteEmail, sendMail } from '../services/email.service.js'
import { env } from '../config/env.js'
import { objectId, paginationQuery, passwordField, searchRegex } from './helpers.js'

const router = Router()
router.use(authenticate)

const userListQuery = paginationQuery.extend({
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  role: z.string().trim().optional(),
})

async function rolesForUsers(userIds: Types.ObjectId[]) {
  const [links, roles] = await Promise.all([
    UserRole.find({ userId: { $in: userIds } }).lean(),
    Role.find().lean(),
  ])
  const roleById = new Map(roles.map((r) => [String(r._id), r]))
  const byUser = new Map<string, { id: string; key: string; name: string }[]>()
  for (const link of links) {
    const role = roleById.get(String(link.roleId))
    if (!role) continue
    const key = String(link.userId)
    const list = byUser.get(key) ?? []
    list.push({ id: String(role._id), key: role.key, name: role.name })
    byUser.set(key, list)
  }
  return byUser
}

router.get(
  '/users',
  requirePermission('users.view'),
  validate({ query: userListQuery }),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query)
    const q = queryOf<z.infer<typeof userListQuery>>(req)
    const filter: Record<string, unknown> = {}
    if (q.status) filter.status = q.status
    if (q.q) {
      const rx = searchRegex(q.q)
      filter.$or = [{ name: rx }, { email: rx }, { position: rx }]
    }
    if (q.role) {
      const role = await Role.findOne({ key: q.role.toUpperCase() }).lean()
      if (!role) {
        ok(res, [], pagedMeta(0, page, pageSize))
        return
      }
      const links = await UserRole.find({ roleId: role._id }).select('userId').lean()
      filter._id = { $in: links.map((l) => l.userId) }
    }
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    ])
    const roles = await rolesForUsers(users.map((u) => u._id))
    ok(
      res,
      users.map((u) => ({ ...u, id: String(u._id), roles: roles.get(String(u._id)) ?? [] })),
      pagedMeta(total, page, pageSize),
    )
  }),
)

router.get(
  '/users/:id',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).lean()
    if (!user) throw ApiError.notFound('User not found')
    const [links, roles, overrides] = await Promise.all([
      UserRole.find({ userId: user._id }).lean(),
      Role.find().lean(),
      UserPermissionOverride.find({ userId: user._id }).lean(),
    ])
    const roleById = new Map(roles.map((r) => [String(r._id), r]))
    ok(res, {
      ...user,
      id: String(user._id),
      roles: links
        .map((l) => roleById.get(String(l.roleId)))
        .filter(Boolean)
        .map((r) => ({ id: String(r!._id), key: r!.key, name: r!.name })),
      overrides,
    })
  }),
)

router.post(
  '/users',
  requirePermission('users.create'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email(),
      phone: z.string().trim().max(30).optional(),
      position: z.string().trim().max(120).optional(),
      roleIds: z.array(objectId).min(1, 'Assign at least one role'),
      classIds: z.array(objectId).optional(),
      dormitoryIds: z.array(objectId).optional(),
      temporaryPassword: passwordField.optional(),
      sendInvite: z.boolean().optional().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const email = req.body.email.trim().toLowerCase()
    if (await User.exists({ email })) throw ApiError.conflict('A user with this email already exists')
    const roles = await Role.find({ _id: { $in: req.body.roleIds } })
    if (roles.length !== req.body.roleIds.length) throw ApiError.badRequest('One or more selected roles do not exist')
    const temporaryPassword = req.body.temporaryPassword ?? `Cn-${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}!`
    const user = await User.create({
      name: req.body.name,
      email,
      phone: req.body.phone,
      position: req.body.position,
      passwordHash: await hashPassword(temporaryPassword),
      emailVerified: false,
      status: 'active',
      mustChangePassword: true,
      assignedClassIds: req.body.classIds ?? [],
      assignedDormitoryIds: req.body.dormitoryIds ?? [],
      createdBy: req.auth!.userId,
    })
    await UserRole.insertMany(roles.map((r) => ({ userId: user._id, roleId: r._id, assignedBy: req.auth!.userId })))
    let inviteDelivered = false
    if (req.body.sendInvite) {
      const mail = inviteEmail(user.name, `${env.APP_URL}/login`, temporaryPassword)
      const result = await sendMail({ to: user.email, ...mail })
      inviteDelivered = result.delivered
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'user.created',
      resourceType: 'User',
      resourceId: String(user._id),
      after: { email, roles: roles.map((r) => r.key) },
    })
    created(res, {
      user: { ...user.toJSON(), roles: roles.map((r) => ({ id: String(r._id), key: r.key, name: r.name })) },
      temporaryPassword: inviteDelivered ? undefined : temporaryPassword,
      inviteDelivered,
    })
  }),
)

router.patch(
  '/users/:id',
  requirePermission('users.update'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().max(30).optional(),
      position: z.string().trim().max(120).optional(),
      status: z.enum(['active', 'inactive', 'pending']).optional(),
      classIds: z.array(objectId).optional(),
      dormitoryIds: z.array(objectId).optional(),
      avatarUrl: z.string().url().optional().or(z.literal('')),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
    if (!user) throw ApiError.notFound('User not found')
    const before = { name: user.name, status: user.status, position: user.position }
    if (req.body.name !== undefined) user.name = req.body.name
    if (req.body.phone !== undefined) user.phone = req.body.phone
    if (req.body.position !== undefined) user.position = req.body.position
    if (req.body.status !== undefined) user.status = req.body.status
    if (req.body.classIds !== undefined) user.assignedClassIds = req.body.classIds.map((id: string) => new Types.ObjectId(id))
    if (req.body.dormitoryIds !== undefined) user.assignedDormitoryIds = req.body.dormitoryIds.map((id: string) => new Types.ObjectId(id))
    if (req.body.avatarUrl !== undefined) user.avatarUrl = req.body.avatarUrl || undefined
    await user.save()
    invalidateUserAccess(String(user._id))
    await writeAudit({ req, actor: req.auth, action: 'user.updated', resourceType: 'User', resourceId: String(user._id), before, after: req.body })
    ok(res, { ...user.toJSON(), id: String(user._id) })
  }),
)

router.post(
  '/users/:id/deactivate',
  requirePermission('users.deactivate'),
  asyncHandler(async (req, res) => {
    if (String(req.auth!.userId) === req.params.id) throw ApiError.badRequest('You cannot deactivate your own account')
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { status: 'inactive' } }, { new: true })
    if (!user) throw ApiError.notFound('User not found')
    invalidateUserAccess(String(user._id))
    await revokeAllSessions(user._id)
    await writeAudit({ req, actor: req.auth, action: 'user.deactivated', resourceType: 'User', resourceId: String(user._id) })
    ok(res, { message: 'User deactivated. All active sessions were signed out.' })
  }),
)

router.get(
  '/users/:id/sessions',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select('_id name email').lean()
    if (!user) throw ApiError.notFound('User not found')
    ok(res, {
      user: { id: String(user._id), name: user.name, email: user.email },
      sessions: await listUserSessions(user._id),
    })
  }),
)

router.delete(
  '/users/:id/sessions/:sessionId',
  requirePermission('users.update'),
  asyncHandler(async (req, res) => {
    await revokeSession(req.params.id, req.params.sessionId, 'revoked_by_admin')
    await writeAudit({
      req,
      actor: req.auth,
      action: 'auth.session_revoked_by_admin',
      resourceType: 'User',
      resourceId: req.params.id,
      after: { sessionId: req.params.sessionId },
    })
    ok(res, { message: 'Session signed out' })
  }),
)

router.post(
  '/users/:id/activate',
  requirePermission('users.deactivate'),
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { status: 'active' } }, { new: true })
    if (!user) throw ApiError.notFound('User not found')
    invalidateUserAccess(String(user._id))
    await writeAudit({ req, actor: req.auth, action: 'user.activated', resourceType: 'User', resourceId: String(user._id) })
    ok(res, { ...user.toJSON(), id: String(user._id) })
  }),
)

router.put(
  '/users/:id/roles',
  requirePermission('roles.manage'),
  validate({ body: z.object({ roleIds: z.array(objectId) }) }),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
    if (!user) throw ApiError.notFound('User not found')
    const roles = await Role.find({ _id: { $in: req.body.roleIds } })
    if (roles.length !== req.body.roleIds.length) throw ApiError.badRequest('One or more selected roles do not exist')
    if (String(req.auth!.userId) === String(user._id) && !roles.some((r) => r.key === 'ADMIN')) {
      throw ApiError.badRequest('You cannot remove your own administrator role')
    }
    await UserRole.deleteMany({ userId: user._id })
    if (roles.length) {
      await UserRole.insertMany(roles.map((r) => ({ userId: user._id, roleId: r._id, assignedBy: req.auth!.userId })))
    }
    invalidateUserAccess(String(user._id))
    await writeAudit({
      req,
      actor: req.auth,
      action: 'user.roles_changed',
      resourceType: 'User',
      resourceId: String(user._id),
      after: { roles: roles.map((r) => r.key) },
    })
    ok(res, { message: 'Roles updated', roles: roles.map((r) => ({ id: String(r._id), key: r.key, name: r.name })) })
  }),
)

router.get(
  '/users/:id/permissions',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const ctx = await getUserContext(req.params.id)
    const overrides = await UserPermissionOverride.find({ userId: req.params.id }).lean()
    ok(res, {
      roles: ctx.roles,
      effective: [...ctx.permissions].sort(),
      overrides,
    })
  }),
)

router.put(
  '/users/:id/permissions',
  requirePermission('permissions.manage'),
  validate({
    body: z.object({
      overrides: z.array(
        z.object({
          permission: z.string().refine((p) => PERMISSION_SET.has(p), 'Unknown permission'),
          effect: z.enum(['allow', 'deny']),
          reason: z.string().trim().max(500).optional(),
          expiresAt: z.string().datetime().optional(),
        }),
      ),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
    if (!user) throw ApiError.notFound('User not found')
    await UserPermissionOverride.deleteMany({ userId: user._id })
    if (req.body.overrides.length) {
      await UserPermissionOverride.insertMany(
        req.body.overrides.map((o: { permission: string; effect: 'allow' | 'deny'; reason?: string; expiresAt?: string }) => ({
          userId: user._id,
          permission: o.permission,
          effect: o.effect,
          reason: o.reason,
          expiresAt: o.expiresAt ? new Date(o.expiresAt) : undefined,
          grantedBy: req.auth!.userId,
        })),
      )
    }
    invalidateUserAccess(String(user._id))
    await writeAudit({
      req,
      actor: req.auth,
      action: 'user.permission_overrides_changed',
      resourceType: 'User',
      resourceId: String(user._id),
      after: { overrides: req.body.overrides },
    })
    const ctx = await getUserContext(String(user._id))
    ok(res, { effective: [...ctx.permissions].sort() })
  }),
)

router.get(
  '/roles',
  requirePermission('users.view'),
  asyncHandler(async (_req, res) => {
    const [roles, rolePerms, userRoles] = await Promise.all([
      Role.find().sort({ key: 1 }).lean(),
      RolePermission.find().lean(),
      UserRole.find().lean(),
    ])
    const permsByRole = new Map<string, string[]>()
    for (const rp of rolePerms) {
      const list = permsByRole.get(String(rp.roleId)) ?? []
      list.push(rp.permission)
      permsByRole.set(String(rp.roleId), list)
    }
    const countByRole = new Map<string, number>()
    for (const ur of userRoles) countByRole.set(String(ur.roleId), (countByRole.get(String(ur.roleId)) ?? 0) + 1)
    ok(
      res,
      roles.map((r) => ({
        id: String(r._id),
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        users: countByRole.get(String(r._id)) ?? 0,
        permissions: (permsByRole.get(String(r._id)) ?? []).sort(),
      })),
    )
  }),
)

router.get(
  '/permissions',
  requirePermission('users.view'),
  asyncHandler(async (_req, res) => {
    const stored = await Permission.find().sort({ group: 1, key: 1 }).lean()
    const list = stored.length
      ? stored.map((p) => ({ key: p.key, label: p.label, group: p.group }))
      : PERMISSIONS
    const grouped: Record<string, { key: string; label: string }[]> = {}
    for (const p of list) {
      grouped[p.group] = grouped[p.group] ?? []
      grouped[p.group].push({ key: p.key, label: p.label })
    }
    ok(res, { permissions: list, groups: grouped })
  }),
)

router.post(
  '/roles',
  requirePermission('roles.manage'),
  validate({
    body: z.object({
      key: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_]+$/, 'Use letters, numbers and underscores'),
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(500).optional().default(''),
      permissions: z.array(z.string().refine((p) => PERMISSION_SET.has(p))).optional().default([]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const key = req.body.key.toUpperCase()
    if (await Role.exists({ key })) throw ApiError.conflict('A role with this key already exists')
    const role = await Role.create({
      key,
      name: req.body.name,
      description: req.body.description,
      isSystem: false,
    })
    if (req.body.permissions.length) {
      await RolePermission.insertMany(req.body.permissions.map((permission: string) => ({ roleId: role._id, permission })))
    }
    await writeAudit({
      req,
      actor: req.auth,
      action: 'role.created',
      resourceType: 'Role',
      resourceId: String(role._id),
      after: { key, permissions: req.body.permissions },
    })
    created(res, { id: String(role._id), key: role.key, name: role.name, permissions: req.body.permissions })
  }),
)

router.patch(
  '/roles/:id',
  requirePermission('roles.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const role = await Role.findById(req.params.id)
    if (!role) throw ApiError.notFound('Role not found')
    if (req.body.name !== undefined) role.name = req.body.name
    if (req.body.description !== undefined) role.description = req.body.description
    await role.save()
    await writeAudit({ req, actor: req.auth, action: 'role.updated', resourceType: 'Role', resourceId: String(role._id), after: req.body })
    ok(res, { id: String(role._id), key: role.key, name: role.name, description: role.description })
  }),
)

router.put(
  '/roles/:id/permissions',
  requirePermission('roles.manage'),
  validate({ body: z.object({ permissions: z.array(z.string().refine((p) => PERMISSION_SET.has(p))) }) }),
  asyncHandler(async (req, res) => {
    const role = await Role.findById(req.params.id)
    if (!role) throw ApiError.notFound('Role not found')
    if (role.key === 'ADMIN') {
      const required = ['users.view', 'users.create', 'users.update', 'roles.manage', 'settings.manage']
      if (!required.every((p) => req.body.permissions.includes(p))) {
        throw ApiError.badRequest('The Administrator role must retain core system permissions.')
      }
    }
    const before = await RolePermission.find({ roleId: role._id }).select('permission').lean()
    await RolePermission.deleteMany({ roleId: role._id })
    if (req.body.permissions.length) {
      await RolePermission.insertMany(req.body.permissions.map((permission: string) => ({ roleId: role._id, permission })))
    }
    const affected = await UserRole.find({ roleId: role._id }).select('userId').lean()
    for (const link of affected) invalidateUserAccess(String(link.userId))
    await writeAudit({
      req,
      actor: req.auth,
      action: 'role.permissions_changed',
      resourceType: 'Role',
      resourceId: String(role._id),
      before: { permissions: before.map((b) => b.permission) },
      after: { permissions: req.body.permissions },
    })
    ok(res, { message: 'Role permissions saved', permissions: req.body.permissions.sort() })
  }),
)

router.delete(
  '/roles/:id',
  requirePermission('roles.manage'),
  asyncHandler(async (req, res) => {
    const role = await Role.findById(req.params.id)
    if (!role) throw ApiError.notFound('Role not found')
    if (role.isSystem) throw ApiError.badRequest('System roles cannot be deleted')
    if (await UserRole.exists({ roleId: role._id })) throw ApiError.badRequest('Remove this role from all users before deleting it')
    await Promise.all([RolePermission.deleteMany({ roleId: role._id }), Role.findByIdAndDelete(role._id)])
    await writeAudit({ req, actor: req.auth, action: 'role.deleted', resourceType: 'Role', resourceId: String(role._id) })
    noContent(res)
  }),
)

export default router
