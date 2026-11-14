import { Types } from 'mongoose'
import { Role, RolePermission, User, UserPermissionOverride, UserRole } from '../models/core.js'
import { GuardianLink, Parent, Student, type IStudent } from '../models/school.js'
import { ApiError } from '../shared/errors.js'

export type AuthContext = {
  userId: Types.ObjectId
  sessionId?: string
  name: string
  email: string
  roles: string[]
  permissions: Set<string>
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    status: string
    avatarUrl?: string
    assignedClassIds: string[]
    assignedDormitoryIds: string[]
    mustChangePassword: boolean
    authProvider: string
  }
}

type CacheEntry = { expires: number; ctx: AuthContext }
const cache = new Map<string, CacheEntry>()
const CACHE_MS = 10_000

export function invalidateUserAccess(userId: string) {
  cache.delete(userId)
}

export async function getUserContext(userId: string | Types.ObjectId): Promise<AuthContext> {
  const id = String(userId)
  const cached = cache.get(id)
  if (cached && cached.expires > Date.now()) return cached.ctx

  const user = await User.findById(id)
  if (!user) throw ApiError.unauthorized('Account not found')
  if (user.status !== 'active') throw ApiError.forbidden('This account is not active. Contact an administrator.')

  const links = await UserRole.find({ userId: user._id }).lean()
  const roleIds = links.map((l) => l.roleId)
  const roles = await Role.find({ _id: { $in: roleIds } }).lean()
  const roleKeys = roles.map((r) => r.key)

  const rolePerms = await RolePermission.find({ roleId: { $in: roleIds } }).lean()
  const permissions = new Set(rolePerms.map((rp) => rp.permission))

  const overrides = await UserPermissionOverride.find({
    userId: user._id,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).lean()
  for (const o of overrides) {
    if (o.effect === 'deny') permissions.delete(o.permission)
  }
  for (const o of overrides) {
    if (o.effect === 'allow') permissions.add(o.permission)
  }

  const ctx: AuthContext = {
    userId: user._id,
    name: user.name,
    email: user.email,
    roles: roleKeys,
    permissions,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      status: user.status,
      avatarUrl: user.avatarUrl,
      assignedClassIds: user.assignedClassIds.map(String),
      assignedDormitoryIds: user.assignedDormitoryIds.map(String),
      mustChangePassword: user.mustChangePassword,
      authProvider: user.authProvider,
    },
  }
  cache.set(id, { expires: Date.now() + CACHE_MS, ctx })
  return ctx
}

export function hasPermission(ctx: AuthContext, permission: string): boolean {
  return ctx.permissions.has(permission)
}

export function hasRole(ctx: AuthContext, ...roles: string[]): boolean {
  return roles.some((r) => ctx.roles.includes(r))
}

export function assertPermission(ctx: AuthContext, permission: string) {
  if (!hasPermission(ctx, permission)) {
    throw ApiError.forbidden(`Missing permission: ${permission}`)
  }
}

export async function visibleStudentQuery(ctx: AuthContext): Promise<Record<string, unknown>> {
  if (hasPermission(ctx, 'students.view_all')) return {}
  if (hasPermission(ctx, 'students.view_assigned')) {
    const clauses: Record<string, unknown>[] = []
    if (ctx.user.assignedClassIds.length) clauses.push({ classId: { $in: ctx.user.assignedClassIds } })
    if (ctx.user.assignedDormitoryIds.length) clauses.push({ dormitoryId: { $in: ctx.user.assignedDormitoryIds } })
    if (hasPermission(ctx, 'portal.view_children')) {
      const parent = await Parent.findOne({ portalUserId: ctx.userId }).lean()
      if (parent) {
        const links = await GuardianLink.find({ parentId: parent._id }).select('studentId').lean()
        if (links.length) clauses.push({ _id: { $in: links.map((l) => l.studentId) } })
      }
    }
    if (!clauses.length) return { _id: { $in: [] } }
    return { $or: clauses }
  }
  if (hasPermission(ctx, 'students.view')) return {}
  if (hasPermission(ctx, 'portal.view_children')) {
    const parent = await Parent.findOne({ portalUserId: ctx.userId }).lean()
    if (!parent) return { _id: { $in: [] } }
    const links = await GuardianLink.find({ parentId: parent._id }).select('studentId').lean()
    return { _id: { $in: links.map((l) => l.studentId) } }
  }
  return { _id: { $in: [] } }
}

export async function canAccessStudent(ctx: AuthContext, student: IStudent | { _id: Types.ObjectId; classId?: Types.ObjectId; dormitoryId?: Types.ObjectId | null }): Promise<boolean> {
  if (hasPermission(ctx, 'students.view_all')) return true
  if (hasPermission(ctx, 'students.view') && !hasPermission(ctx, 'students.view_assigned')) return true
  if (hasPermission(ctx, 'students.view_assigned')) {
    const classIds = ctx.user.assignedClassIds
    const dormIds = ctx.user.assignedDormitoryIds
    if (student.classId && classIds.includes(String(student.classId))) return true
    if (student.dormitoryId && dormIds.includes(String(student.dormitoryId))) return true
  }
  if (hasPermission(ctx, 'portal.view_children')) {
    const parent = await Parent.findOne({ portalUserId: ctx.userId }).lean()
    if (parent) {
      const link = await GuardianLink.exists({ parentId: parent._id, studentId: student._id })
      return Boolean(link)
    }
  }
  return false
}

export async function assertStudentAccess(ctx: AuthContext, studentId: string | Types.ObjectId): Promise<IStudent> {
  const student = await Student.findById(studentId)
  if (!student) throw ApiError.notFound('Student not found')
  const allowed = await canAccessStudent(ctx, student)
  if (!allowed) throw ApiError.forbidden('You are not authorized to access this student record')
  return student
}

export async function safeguardingCaseAccess(ctx: AuthContext, caseDoc: { reportedBy: Types.ObjectId; assignedTo?: Types.ObjectId | null }): Promise<boolean> {
  if (!hasPermission(ctx, 'safeguarding.view')) return false
  if (hasRole(ctx, 'HEADTEACHER')) return true
  return String(caseDoc.reportedBy) === String(ctx.userId) || String(caseDoc.assignedTo ?? '') === String(ctx.userId)
}

export function assertSafeguardingAccess(ctx: AuthContext, caseDoc: { reportedBy: Types.ObjectId; assignedTo?: Types.ObjectId | null }) {
  if (!hasPermission(ctx, 'safeguarding.view')) {
    throw ApiError.forbidden('Safeguarding access requires dedicated authorization')
  }
  if (!hasRole(ctx, 'HEADTEACHER') && String(caseDoc.reportedBy) !== String(ctx.userId) && String(caseDoc.assignedTo ?? '') !== String(ctx.userId)) {
    throw ApiError.forbidden('You are not assigned to this safeguarding case')
  }
}
