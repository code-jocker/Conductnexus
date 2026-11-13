import crypto from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { Types } from 'mongoose'
import { env, firebaseConfigured, isProd, smtpConfigured } from '../config/env.js'
import { Session, User, getSettings, type IUser } from '../models/core.js'
import { ApiError } from '../shared/errors.js'
import { addDays, addMinutes, normalizeRwandaPhone, randomCode, randomToken, sha256 } from '../shared/utils.js'
import { getUserContext, type AuthContext } from './rbac.service.js'
import { resetEmail, sendMail, verificationEmail } from './email.service.js'
import { logger } from '../shared/logger.js'

export const REFRESH_COOKIE = 'cn_refresh'
export const REFRESH_COOKIE_PATH = '/api/v1/auth'

export const passwordSchema = (value: string): boolean => {
  return value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
  refreshExpires: Date
}

export async function issueTokens(
  user: IUser,
  meta: { ip?: string; userAgent?: string; refreshDays?: number } = {},
): Promise<TokenPair> {
  const settings = await getSettings()
  const refreshDays = meta.refreshDays ?? settings.security.sessionDays ?? env.REFRESH_TOKEN_TTL_DAYS
  const accessToken = jwt.sign({ sub: String(user._id), typ: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
  })
  const refreshToken = randomToken(48)
  const refreshExpires = addDays(new Date(), refreshDays)
  await Session.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    expiresAt: refreshExpires,
    ip: meta.ip,
    userAgent: meta.userAgent,
  })
  return { accessToken, refreshToken, refreshExpires }
}

export function verifyAccessToken(token: string): string {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub?: string; typ?: string }
    if (!payload.sub || payload.typ !== 'access') throw new Error('invalid token')
    return payload.sub
  } catch {
    throw ApiError.unauthorized('Your session has expired. Please sign in again.')
  }
}

export async function loginWithPassword(input: {
  email: string
  password: string
  ip?: string
  userAgent?: string
}): Promise<{ tokens: TokenPair; ctx: AuthContext }> {
  const settings = await getSettings()
  const email = input.email.trim().toLowerCase()
  const user = await User.findOne({ email }).select('+passwordHash')
  if (!user) throw ApiError.unauthorized('Incorrect email or password')
  if (user.status === 'inactive') throw ApiError.forbidden('This account has been deactivated. Contact an administrator.')
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw ApiError.tooMany('Too many failed attempts. This account is temporarily locked.')
  }
  if (!user.passwordHash) {
    throw ApiError.badRequest('This account uses Google Sign-In. Continue with Google instead.')
  }
  const valid = await verifyPassword(input.password, user.passwordHash)
  if (!valid) {
    user.failedLoginCount += 1
    if (user.failedLoginCount >= settings.security.maxFailedLogins) {
      user.lockUntil = addMinutes(new Date(), settings.security.lockoutMinutes)
      user.failedLoginCount = 0
    }
    await user.save()
    throw ApiError.unauthorized('Incorrect email or password')
  }
  user.failedLoginCount = 0
  user.lockUntil = undefined
  user.lastLoginAt = new Date()
  await user.save()
  const tokens = await issueTokens(user, { ip: input.ip, userAgent: input.userAgent })
  const ctx = await getUserContext(user._id)
  return { tokens, ctx }
}

// ── Firebase / Google Sign-In ───────────────────────────────────────────────

type CertCache = { fetchedAt: number; certs: Record<string, string> }
let certCache: CertCache | null = null

async function getFirebaseCerts(): Promise<Record<string, string>> {
  if (certCache && Date.now() - certCache.fetchedAt < 60 * 60 * 1000) return certCache.certs
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com')
  if (!res.ok) throw ApiError.internal('Unable to validate Google sign-in right now. Try again.')
  const certs = (await res.json()) as Record<string, string>
  certCache = { fetchedAt: Date.now(), certs }
  return certs
}

export type GoogleIdentity = {
  uid: string
  email: string
  emailVerified: boolean
  name?: string
  picture?: string
}

export async function verifyFirebaseIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!firebaseConfigured) {
    throw ApiError.badRequest('Google Sign-In is not configured on this server yet.')
  }
  const decoded = jwt.decode(idToken, { complete: true }) as { header?: { kid?: string }; payload?: Record<string, unknown> } | null
  const kid = decoded?.header?.kid
  if (!kid) throw ApiError.unauthorized('Invalid Google credential')
  const certs = await getFirebaseCerts()
  const publicKey = certs[kid]
  if (!publicKey) throw ApiError.unauthorized('Invalid Google credential')
  try {
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: env.FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    }) as Record<string, unknown>
    const email = String(payload.email ?? '').toLowerCase()
    if (!email) throw new Error('no email')
    const firebaseInfo = (payload.firebase ?? {}) as Record<string, unknown>
    return {
      uid: String(payload.user_id ?? payload.sub),
      email,
      emailVerified: Boolean(payload.email_verified),
      name: payload.name ? String(payload.name) : undefined,
      picture: payload.picture ? String(payload.picture) : undefined,
    }
  } catch (err) {
    logger.warn({ err }, 'Firebase token verification failed')
    throw ApiError.unauthorized('Google sign-in could not be verified. Please try again.')
  }
}

export async function loginWithGoogle(input: {
  idToken: string
  ip?: string
  userAgent?: string
}): Promise<{ tokens: TokenPair; ctx: AuthContext; isNew: boolean; hasAccess: boolean }> {
  const identity = await verifyFirebaseIdToken(input.idToken)
  let user = await User.findOne({
    $or: [{ googleUid: identity.uid }, { email: identity.email }],
  })
  let isNew = false

  if (user) {
    if (user.status === 'inactive') throw ApiError.forbidden('This account has been deactivated. Contact an administrator.')
    user.googleUid = identity.uid
    user.emailVerified = true
    user.authProvider = user.passwordHash ? 'both' : 'google'
    if (identity.picture && !user.avatarUrl) user.avatarUrl = identity.picture
    user.lastLoginAt = new Date()
    await user.save()
  } else {
    isNew = true
    user = await User.create({
      name: identity.name ?? identity.email.split('@')[0],
      email: identity.email,
      googleUid: identity.uid,
      authProvider: 'google',
      emailVerified: true,
      status: 'active',
      avatarUrl: identity.picture,
      lastLoginAt: new Date(),
    })
  }

  const tokens = await issueTokens(user, { ip: input.ip, userAgent: input.userAgent })
  const ctx = await getUserContext(user._id)
  return { tokens, ctx, isNew, hasAccess: ctx.roles.length > 0 }
}

export async function rotateRefreshToken(input: {
  token?: string
  ip?: string
  userAgent?: string
}): Promise<{ tokens: TokenPair; ctx: AuthContext }> {
  if (!input.token) throw ApiError.unauthorized('No active session')
  const tokenHash = sha256(input.token)
  const session = await Session.findOne({ tokenHash })
  if (!session) throw ApiError.unauthorized('Session not found. Please sign in again.')
  if (session.revokedAt) {
    await Session.updateMany({ userId: session.userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
    throw ApiError.unauthorized('Session reuse detected. All sessions have been revoked.')
  }
  if (session.expiresAt < new Date()) {
    session.revokedAt = new Date()
    await session.save()
    throw ApiError.unauthorized('Session expired. Please sign in again.')
  }
  const user = await User.findById(session.userId)
  if (!user || user.status !== 'active') throw ApiError.forbidden('Account is not active')

  const refreshToken = randomToken(48)
  const refreshExpires = session.expiresAt
  session.revokedAt = new Date()
  session.replacedByHash = sha256(refreshToken)
  await session.save()
  await Session.create({
    userId: user._id,
    tokenHash: session.replacedByHash,
    expiresAt: refreshExpires,
    ip: input.ip,
    userAgent: input.userAgent,
  })
  const accessToken = jwt.sign({ sub: String(user._id), typ: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
  })
  const ctx = await getUserContext(user._id)
  return { tokens: { accessToken, refreshToken, refreshExpires }, ctx }
}

export async function revokeRefreshToken(token?: string): Promise<void> {
  if (!token) return
  await Session.updateOne({ tokenHash: sha256(token), revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
}

export async function revokeAllSessions(userId: string | Types.ObjectId): Promise<void> {
  await Session.updateMany({ userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
}

export function refreshCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: isProd,
    // Firebase Hosting and the API live on different sites in production.
    sameSite: isProd ? ('none' as const) : ('lax' as const),
    path: REFRESH_COOKIE_PATH,
    expires,
  }
}

// ── Email verification ─────────────────────────────────────────────────────

export async function sendVerificationEmail(user: IUser): Promise<{ delivered: boolean; devToken?: string }> {
  if (user.emailVerified) throw ApiError.badRequest('This email address is already verified.')
  const token = randomToken(32)
  user.emailVerificationTokenHash = sha256(token)
  user.emailVerificationExpires = addDays(new Date(), 1)
  await user.save()
  const link = `${env.APP_URL}/verify-email?token=${token}`
  const mail = verificationEmail(user.name, link)
  const result = await sendMail({ to: user.email, ...mail })
  return {
    delivered: result.delivered,
    devToken: !isProd && !smtpConfigured ? token : undefined,
  }
}

export async function verifyEmailToken(token: string): Promise<void> {
  const user = await User.findOne({
    emailVerificationTokenHash: sha256(token),
    emailVerificationExpires: { $gt: new Date() },
  }).select('+emailVerificationTokenHash +emailVerificationExpires')
  if (!user) throw ApiError.badRequest('This verification link is invalid or has expired.')
  user.emailVerified = true
  user.emailVerificationTokenHash = undefined
  user.emailVerificationExpires = undefined
  await user.save()
}

// ── Password reset ─────────────────────────────────────────────────────────

export async function requestPasswordReset(emailInput: string): Promise<{
  delivered: boolean
  devCode?: string
  devToken?: string
}> {
  const email = emailInput.trim().toLowerCase()
  const user = await User.findOne({ email })
  if (!user || user.status === 'inactive') {
    return { delivered: false }
  }
  const code = randomCode(6)
  const token = randomToken(32)
  user.passwordResetCodeHash = sha256(`${email}:${code}`)
  user.passwordResetTokenHash = sha256(token)
  user.passwordResetExpires = addMinutes(new Date(), 20)
  await user.save()
  const link = `${env.APP_URL}/reset-password?token=${token}`
  const mail = resetEmail(user.name, code, link)
  const result = await sendMail({ to: user.email, ...mail })
  return {
    delivered: result.delivered,
    devCode: !isProd && !smtpConfigured ? code : undefined,
    devToken: !isProd && !smtpConfigured ? token : undefined,
  }
}

export async function resetPassword(input: {
  email?: string
  code?: string
  token?: string
  newPassword: string
}): Promise<void> {
  if (!passwordSchema(input.newPassword)) {
    throw ApiError.unprocessable('Password must be at least 10 characters and include uppercase, lowercase and a number.')
  }
  let user: IUser | null = null
  if (input.token) {
    user = await User.findOne({
      passwordResetTokenHash: sha256(input.token),
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetTokenHash')
  } else if (input.email && input.code) {
    const email = input.email.trim().toLowerCase()
    user = await User.findOne({
      email,
      passwordResetCodeHash: sha256(`${email}:${input.code.trim()}`),
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetCodeHash')
  }
  if (!user) throw ApiError.badRequest('The reset code or link is invalid or has expired.')
  user.passwordHash = await hashPassword(input.newPassword)
  user.passwordResetCodeHash = undefined
  user.passwordResetTokenHash = undefined
  user.passwordResetExpires = undefined
  user.failedLoginCount = 0
  user.lockUntil = undefined
  user.emailVerified = true
  await user.save()
  await revokeAllSessions(user._id)
  await sendMail({
    to: user.email,
    subject: 'Your ConductNexus password was changed',
    html: `<p>Your ConductNexus password was changed successfully.</p><p>If this was not you, contact your school administrator immediately.</p>`,
  })
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  if (!passwordSchema(newPassword)) {
    throw ApiError.unprocessable('Password must be at least 10 characters and include uppercase, lowercase and a number.')
  }
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw ApiError.unauthorized('Account not found')
  if (user.passwordHash) {
    const valid = await verifyPassword(currentPassword, user.passwordHash)
    if (!valid) throw ApiError.badRequest('Current password is incorrect')
  }
  if (user.passwordHash && await verifyPassword(newPassword, user.passwordHash)) {
    throw ApiError.badRequest('New password must be different from the current password')
  }
  user.passwordHash = await hashPassword(newPassword)
  user.mustChangePassword = false
  await user.save()
  await sendMail({
    to: user.email,
    subject: 'Your ConductNexus password was changed',
    html: `<p>Your password was changed successfully.</p><p>If this was not you, contact your school administrator immediately.</p>`,
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────

export async function setupStatus() {
  const [hasAdmin, settings] = await Promise.all([
    User.exists({ email: { $exists: true } }),
    getSettings(),
  ])
  return {
    needsSetup: !settings.setupCompleted,
    hasUsers: Boolean(hasAdmin),
    schoolName: settings.school.name,
    firebaseConfigured,
    smtpConfigured,
  }
}

export async function completeSetup(input: {
  schoolName: string
  schoolEmail?: string
  schoolPhone?: string
  adminName: string
  adminEmail: string
  adminPassword: string
}): Promise<{ tokens: TokenPair; ctx: AuthContext }> {
  const settings = await getSettings()
  if (settings.setupCompleted && (await User.countDocuments()) > 0) {
    throw ApiError.forbidden('This system has already been set up.')
  }
  if (!passwordSchema(input.adminPassword)) {
    throw ApiError.unprocessable('Admin password must be at least 10 characters and include uppercase, lowercase and a number.')
  }
  const email = input.adminEmail.trim().toLowerCase()
  const existing = await User.findOne({ email })
  if (existing) throw ApiError.conflict('A user with this email already exists')

  const { seedRbac, seedSchoolDefaults } = await import('./seed.service.js')
  await seedRbac()
  await seedSchoolDefaults({
    schoolName: input.schoolName,
    schoolEmail: input.schoolEmail,
    schoolPhone: input.schoolPhone,
  })

  const user = await User.create({
    name: input.adminName,
    email,
    passwordHash: await hashPassword(input.adminPassword),
    emailVerified: true,
    status: 'active',
    position: 'System Administrator',
  })
  const { Role, UserRole } = await import('../models/core.js')
  const adminRole = await Role.findOne({ key: 'ADMIN' })
  if (adminRole) await UserRole.create({ userId: user._id, roleId: adminRole._id, assignedBy: user._id })

  settings.setupCompleted = true
  await settings.save()

  const tokens = await issueTokens(user)
  const ctx = await getUserContext(user._id)
  return { tokens, ctx }
}

export function normalizePhone(phone: string): string {
  return normalizeRwandaPhone(phone)
}

export function randomId(): string {
  return crypto.randomUUID()
}
