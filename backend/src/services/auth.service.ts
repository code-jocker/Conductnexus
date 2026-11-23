import crypto from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { Types } from 'mongoose'
import { emailConfigured, env, firebaseConfigured, isProd, whatsappAvailable } from '../config/env.js'
import { Session, User, Role, UserRole, TrustedDevice, getSettings, type IUser, type SessionPlatform } from '../models/core.js'
import { ApiError } from '../shared/errors.js'
import { addDays, addMinutes, normalizeRwandaPhone, randomCode, randomToken, sha256 } from '../shared/utils.js'
import { getUserContext, invalidateUserAccess, type AuthContext } from './rbac.service.js'
import { clearSessionCache } from './session.service.js'
import { resetEmail, sendMail, twoFactorEmail, verificationEmail } from './email.service.js'
import { sendWhatsAppText } from './communication.service.js'
import { logger } from '../shared/logger.js'

export const REFRESH_COOKIE = 'cn_refresh'
export const REFRESH_COOKIE_PATH = '/api/v1/auth'

/** Roles that must always use MFA regardless of per-user or school-wide settings. */
export const MFA_REQUIRED_ROLES = new Set(['ADMIN', 'HEADTEACHER', 'IT'])

async function hasAdminRole(userId: Types.ObjectId | string): Promise<boolean> {\n  const links = await UserRole.find({ userId }).lean()\n  if (!links.length) return false\n  const roles = await Role.find({ _id: { $in: links.map((l) => l.roleId) } }).lean()\n  return roles.some((r) => r.key === 'ADMIN')\n}\n\nasync function rotateTrustedDevice(userId: Types.ObjectId | string, rawToken: string): Promise<string | null> {
  const nextToken = randomToken(48)
  const updated = await TrustedDevice.findOneAndUpdate(
    {
      userId,
      tokenHash: sha256(rawToken),
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        tokenHash: sha256(nextToken),
        lastUsedAt: new Date(),
        expiresAt: addDays(new Date(), 30),
      },
    },
    { new: true },
  )
  return updated ? nextToken : null
}

async function requiresMfaByRole(userId: Types.ObjectId | string): Promise<boolean> {
  const links = await UserRole.find({ userId }).lean()
  if (!links.length) return false
  const roles = await Role.find({ _id: { $in: links.map((l) => l.roleId) } }).lean()
  return roles.some((r) => MFA_REQUIRED_ROLES.has(r.key))
}

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
  sessionId?: string
}

export type ClientMeta = {
  ip?: string
  userAgent?: string
  deviceId?: string
  deviceName?: string
  platform?: SessionPlatform
  appVersion?: string
  refreshDays?: number
}

function signAccessToken(userId: Types.ObjectId | string, sessionId: Types.ObjectId | string): string {
  return jwt.sign(
    { sub: String(userId), sid: String(sessionId), typ: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'] },
  )
}

export async function issueTokens(user: IUser, meta: ClientMeta = {}): Promise<TokenPair> {
  const settings = await getSettings()
  const refreshDays = meta.refreshDays ?? settings.security.sessionDays ?? env.REFRESH_TOKEN_TTL_DAYS
  const refreshToken = randomToken(48)
  const refreshExpires = addDays(new Date(), refreshDays)
  const session = await Session.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    expiresAt: refreshExpires,
    ip: meta.ip,
    userAgent: meta.userAgent,
    deviceId: meta.deviceId,
    deviceName: meta.deviceName,
    platform: meta.platform ?? 'web',
    appVersion: meta.appVersion,
    lastActiveAt: new Date(),
  })
  return {
    accessToken: signAccessToken(user._id, session._id),
    refreshToken,
    refreshExpires,
    sessionId: String(session._id),
  }
}

export type AccessClaims = { userId: string; sessionId?: string }

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub?: string; sid?: string; typ?: string }
    if (!payload.sub || payload.typ !== 'access') throw new Error('invalid token')
    return { userId: payload.sub, sessionId: payload.sid }
  } catch {
    throw ApiError.unauthorized('Your session has expired. Please sign in again.')
  }
}

export const TWO_FACTOR_TTL_MINUTES = 10
export const TWO_FACTOR_MAX_ATTEMPTS = 5

export type TwoFactorChannel = 'email' | 'whatsapp'

export type TwoFactorDelivery = {
  channel: TwoFactorChannel
  channels: TwoFactorChannel[]
  maskedDestination: string
  delivered: boolean
  warning?: string
  devCode?: string
}

export type PasswordLoginResult =
  | { status: 'authenticated'; tokens: TokenPair; ctx: AuthContext; trustedDeviceToken?: string }
  | ({
      status: 'two_factor_required'
      canTrustDevice?: boolean
      challenge: string
      userId: string
      name: string
      email: string
      isNew?: boolean
      hasAccess?: boolean
    } & TwoFactorDelivery)

export type GoogleLoginResult =
  | { status: 'authenticated'; tokens: TokenPair; ctx: AuthContext; isNew: boolean; hasAccess: boolean; trustedDeviceToken?: string }
  | ({
      status: 'two_factor_required'
      canTrustDevice?: boolean
      challenge: string
      userId: string
      name: string
      email: string
      isNew: boolean
      hasAccess: boolean
    } & TwoFactorDelivery)

function signTwoFactorChallenge(userId: Types.ObjectId | string): string {
  return jwt.sign({ sub: String(userId), typ: '2fa' }, env.JWT_ACCESS_SECRET, { expiresIn: `${TWO_FACTOR_TTL_MINUTES}m` })
}

export function twoFactorChallengeUserId(token: string): string {
  return userIdFromTwoFactorChallenge(token)
}

function userIdFromTwoFactorChallenge(token: string): string {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub?: string; typ?: string }
    if (!payload.sub || payload.typ !== '2fa') throw new Error('invalid challenge')
    return payload.sub
  } catch {
    throw ApiError.unauthorized('Your verification session expired. Please sign in again.')
  }
}

function hashEquals(provided: string, stored: string): boolean {
  const a = Buffer.from(provided, 'hex')
  const b = Buffer.from(stored, 'hex')
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@')
  const visible = name.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(2, name.length - visible.length))}@${domain}`
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `${digits.slice(0, 3)}•••${digits.slice(-3)}`
}

function twoFactorChannels(user: IUser): TwoFactorChannel[] {
  // Only advertise WhatsApp where this deployment can actually send it.
  return ['email', ...(user.phone && whatsappAvailable ? (['whatsapp'] as const) : [])]
}

async function deliverTwoFactorCode(
  user: IUser,
  code: string,
  channel: TwoFactorChannel,
): Promise<{ received: boolean; warning?: string }> {
  if (channel === 'whatsapp') {
    if (!user.phone) return { received: false, warning: 'No mobile number is registered on this account. Use email instead.' }
    const result = await sendWhatsAppText(
      user.phone,
      `ConductNexus sign-in code: ${code}\nThis code expires in ${TWO_FACTOR_TTL_MINUTES} minutes. Never share it. If you did not try to sign in, change your password immediately.`,
    )
    return {
      received: result.ok,
      warning: result.ok ? undefined : `WhatsApp could not deliver the code (${result.error}). Request a code by email instead.`,
    }
  }
  const result = await sendMail({ to: user.email, ...twoFactorEmail(user.name, code) })
  return {
    received: result.delivered,
    warning: result.delivered
      ? undefined
      : isProd
        ? 'Email delivery is currently unavailable. Contact your school administrator.'
        : 'Email delivery is not configured. Use the development code shown in the server response.',
  }
}

async function issueTwoFactorChallenge(
  user: IUser,
  channel: TwoFactorChannel = 'email',
): Promise<TwoFactorDelivery> {
  const channels = twoFactorChannels(user)
  if (!channels.includes(channel)) {
    throw ApiError.badRequest('That verification channel is not available for this account.')
  }
  const code = randomCode(6)
  user.twoFactorCodeHash = sha256(`${user._id}:${code}`)
  user.twoFactorExpires = addMinutes(new Date(), TWO_FACTOR_TTL_MINUTES)
  user.twoFactorAttempts = 0
  user.twoFactorCodeSentAt = new Date()
  await user.save()
  const delivery = await deliverTwoFactorCode(user, code, channel)
  return {
    channel,
    channels,
    maskedDestination: channel === 'whatsapp' ? maskPhone(user.phone ?? '') : maskEmail(user.email),
    delivered: delivery.received,
    warning: delivery.warning,
    devCode: !isProd && !delivery.received ? code : undefined,
  }
}

export async function loginWithPassword(input: {
  email: string
  password: string
  channel?: TwoFactorChannel
  trustedDeviceToken?: string
} & ClientMeta): Promise<PasswordLoginResult> {
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
  await user.save()

  // Two-factor is always applied when the account opted in, school-wide when
  // settings.security.requireTwoFactor is on, and for privileged roles
  // (ADMIN, HEADTEACHER, IT) regardless of other settings. A challenge never
  // issues tokens, so a stolen password alone cannot start a session.
  const adminAccount = await hasAdminRole(user._id)
  if (adminAccount && input.trustedDeviceToken) {
    const rotatedToken = await rotateTrustedDevice(user._id, input.trustedDeviceToken)
    if (rotatedToken) {
      user.lastLoginAt = new Date()
      await user.save()
      const tokens = await issueTokens(user, input)
      const ctx = await getUserContext(user._id)
      return { status: 'authenticated', tokens, ctx, trustedDeviceToken: rotatedToken }
    }
  }
  const roleMandated = await requiresMfaByRole(user._id)
  if (user.twoFactorEnabled || settings.security.requireTwoFactor || roleMandated) {
    const challenge = signTwoFactorChallenge(user._id)
    const delivery = await issueTwoFactorChallenge(user, input.channel ?? 'email')
    return {
      status: 'two_factor_required',
      canTrustDevice: adminAccount,
      challenge,
      userId: String(user._id),
      name: user.name,
      email: user.email,
      ...delivery,
    }
  }

  user.lastLoginAt = new Date()
  await user.save()
  const tokens = await issueTokens(user, input)
  const ctx = await getUserContext(user._id)
  return { status: 'authenticated', tokens, ctx }
}

export async function verifyTwoFactorChallenge(input: {
  challenge: string
  code: string
  trustDevice?: boolean
} & ClientMeta): Promise<{ tokens: TokenPair; ctx: AuthContext; trustedDeviceToken?: string }> {
  const userId = userIdFromTwoFactorChallenge(input.challenge)
  const settings = await getSettings()
  const user = await User.findById(userId).select('+twoFactorCodeHash +twoFactorExpires +twoFactorAttempts')
  if (!user) throw ApiError.unauthorized('Account not found')
  if (user.status !== 'active') throw ApiError.forbidden('This account is not active.')
  if (!user.twoFactorEnabled && !settings.security.requireTwoFactor && !(await requiresMfaByRole(userId))) {
    throw ApiError.badRequest('Two-factor authentication is not enabled for this account.')
  }
  if (!user.twoFactorCodeHash || !user.twoFactorExpires) {
    throw ApiError.unauthorized('No verification code is pending. Please sign in again.')
  }
  if (user.twoFactorExpires < new Date()) {
    throw ApiError.badRequest('The verification code has expired. Please sign in again.')
  }
  if ((user.twoFactorAttempts ?? 0) >= TWO_FACTOR_MAX_ATTEMPTS) {
    user.twoFactorCodeHash = undefined
    user.twoFactorExpires = undefined
    user.twoFactorAttempts = 0
    await user.save()
    throw ApiError.tooMany('Too many incorrect verification codes. Please sign in again.')
  }
  const provided = sha256(`${user._id}:${input.code.trim()}`)
  if (!hashEquals(provided, user.twoFactorCodeHash)) {
    user.twoFactorAttempts = (user.twoFactorAttempts ?? 0) + 1
    logger.warn({ userId: String(user._id), attempts: user.twoFactorAttempts, ip: input.ip }, 'Two-factor verification failed')
    await user.save()
    throw ApiError.unauthorized('The verification code is incorrect.')
  }
  user.twoFactorCodeHash = undefined
  user.twoFactorExpires = undefined
  user.twoFactorAttempts = 0
  user.twoFactorCodeSentAt = undefined
  user.lastLoginAt = new Date()
  await user.save()
  const tokens = await issueTokens(user, input)
  const ctx = await getUserContext(user._id)
  let trustedDeviceToken: string | undefined
  if (input.trustDevice && ctx.roles.includes('ADMIN')) {
    trustedDeviceToken = randomToken(48)
    await TrustedDevice.create({
      userId: user._id,
      tokenHash: sha256(trustedDeviceToken),
      deviceName: input.deviceName || 'Trusted browser',
      userAgent: input.userAgent,
      lastUsedAt: new Date(),
      expiresAt: addDays(new Date(), 30),
    })
  }
  return { tokens, ctx, trustedDeviceToken }
}

/**
 * Re-issues a sign-in code on the channel the person chooses.
 *
 * The challenge token proves the password was already accepted, and the cooldown
 * stops a logged-in attacker from turning the endpoint into an SMS/email pump.
 */
export async function resendTwoFactorCode(input: {
  challenge: string
  channel?: TwoFactorChannel
}): Promise<TwoFactorDelivery & { userId: string; name: string }> {
  const userId = userIdFromTwoFactorChallenge(input.challenge)
  const settings = await getSettings()
  const user = await User.findById(userId).select('+twoFactorCodeSentAt')
  if (!user) throw ApiError.unauthorized('Account not found')
  if (user.status !== 'active') throw ApiError.forbidden('This account is not active.')
  if (!user.twoFactorEnabled && !settings.security.requireTwoFactor && !(await requiresMfaByRole(userId))) {
    throw ApiError.badRequest('Two-factor authentication is not enabled for this account.')
  }
  const sentAt = (user as IUser & { twoFactorCodeSentAt?: Date }).twoFactorCodeSentAt
  if (sentAt) {
    const waitMs = sentAt.getTime() + env.TWO_FACTOR_RESEND_SECONDS * 1000 - Date.now()
    if (waitMs > 0) {
      throw ApiError.tooMany(`Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting another code.`)
    }
  }
  return { ...(await issueTwoFactorChallenge(user, input.channel ?? 'email')), userId: String(user._id), name: user.name }
}

export async function twoFactorStatus(userId: string | Types.ObjectId): Promise<{
  enabled: boolean
  mandatory: boolean
  channels: TwoFactorChannel[]
  email: string
  phone?: string
}> {
  const [user, settings] = await Promise.all([User.findById(userId), getSettings()])
  if (!user) throw ApiError.notFound('Account not found')
  const roleMandated = await requiresMfaByRole(userId)
  return {
    enabled: Boolean(user.twoFactorEnabled),
    mandatory: Boolean(settings.security.requireTwoFactor || roleMandated),
    channels: twoFactorChannels(user),
    email: user.email,
    phone: user.phone,
  }
}

export async function beginTwoFactorEnrollment(
  userId: string | Types.ObjectId,
  password: string,
  channel: TwoFactorChannel = 'email',
): Promise<TwoFactorDelivery> {
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw ApiError.notFound('Account not found')
  if (user.twoFactorEnabled) throw ApiError.badRequest('Two-factor authentication is already enabled.')
  if (!user.passwordHash) throw ApiError.badRequest('Set a password before enabling two-factor authentication.')
  if (!(await verifyPassword(password, user.passwordHash))) throw ApiError.badRequest('Password is incorrect')
  return issueTwoFactorChallenge(user, channel)
}

export async function confirmTwoFactorEnrollment(userId: string | Types.ObjectId, code: string): Promise<void> {
  const user = await User.findById(userId).select('+twoFactorCodeHash +twoFactorExpires +twoFactorAttempts')
  if (!user) throw ApiError.notFound('Account not found')
  if (!user.twoFactorCodeHash || !user.twoFactorExpires) {
    throw ApiError.badRequest('Start the two-factor setup again to receive a new code.')
  }
  if (user.twoFactorExpires < new Date()) {
    throw ApiError.badRequest('The verification code has expired. Start the two-factor setup again.')
  }
  if ((user.twoFactorAttempts ?? 0) >= TWO_FACTOR_MAX_ATTEMPTS) {
    user.twoFactorCodeHash = undefined
    user.twoFactorExpires = undefined
    user.twoFactorAttempts = 0
    await user.save()
    throw ApiError.tooMany('Too many incorrect verification codes. Start the two-factor setup again.')
  }
  const provided = sha256(`${user._id}:${code.trim()}`)
  if (!hashEquals(provided, user.twoFactorCodeHash)) {
    user.twoFactorAttempts = (user.twoFactorAttempts ?? 0) + 1
    await user.save()
    throw ApiError.unauthorized('The verification code is incorrect.')
  }
  user.twoFactorEnabled = true
  user.twoFactorCodeHash = undefined
  user.twoFactorExpires = undefined
  user.twoFactorAttempts = 0
  user.twoFactorCodeSentAt = undefined
  await user.save()
}

export async function disableTwoFactor(userId: string | Types.ObjectId, password: string): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw ApiError.notFound('Account not found')
  if (user.passwordHash && !(await verifyPassword(password, user.passwordHash))) {
    throw ApiError.badRequest('Password is incorrect')
  }
  user.twoFactorEnabled = false
  user.twoFactorCodeHash = undefined
  user.twoFactorExpires = undefined
  user.twoFactorAttempts = 0
  user.twoFactorCodeSentAt = undefined
  await user.save()
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
  channel?: TwoFactorChannel
  trustedDeviceToken?: string
} & ClientMeta): Promise<GoogleLoginResult> {
  const identity = await verifyFirebaseIdToken(input.idToken)
  const settings = await getSettings()
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
    })
  }

  // Admins can skip email OTP only when this browser presents a valid,
  // server-recorded trusted-device credential. Google identity is still verified.
  const adminAccount = await hasAdminRole(user._id)
  if (adminAccount && input.trustedDeviceToken) {
    const rotatedToken = await rotateTrustedDevice(user._id, input.trustedDeviceToken)
    if (rotatedToken) {
      user.lastLoginAt = new Date()
      await user.save()
      const tokens = await issueTokens(user, input)
      const ctx = await getUserContext(user._id)
      return { status: 'authenticated', tokens, ctx, isNew, hasAccess: ctx.roles.length > 0, trustedDeviceToken: rotatedToken }
    }
  }

  // Google proves identity, but privileged roles still require possession of
  // the enrolled email channel on an untrusted device.
  if (user.twoFactorEnabled || settings.security.requireTwoFactor || (await requiresMfaByRole(user._id))) {
    const challenge = signTwoFactorChallenge(user._id)
    const delivery = await issueTwoFactorChallenge(user, input.channel ?? 'email')
    return {
      status: 'two_factor_required',
      canTrustDevice: adminAccount,
      challenge,
      userId: String(user._id),
      name: user.name,
      email: user.email,
      isNew,
      hasAccess: (await getUserContext(user._id)).roles.length > 0,
      ...delivery,
    }
  }

  user.lastLoginAt = new Date()
  await user.save()
  const tokens = await issueTokens(user, input)
  const ctx = await getUserContext(user._id)
  return { status: 'authenticated', tokens, ctx, isNew, hasAccess: ctx.roles.length > 0 }
}

export async function rotateRefreshToken(input: {
  token?: string
} & ClientMeta): Promise<{ tokens: TokenPair; ctx: AuthContext }> {
  if (!input.token) throw ApiError.unauthorized('No active session')
  const tokenHash = sha256(input.token)
  const session = await Session.findOne({ tokenHash })
  if (!session) throw ApiError.unauthorized('Session not found. Please sign in again.')
  if (session.revokedAt) {
    await Session.updateMany({ userId: session.userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: 'token_reuse' } })
    clearSessionCache()
    throw ApiError.unauthorized('Session reuse detected. All sessions have been revoked.')
  }
  if (session.expiresAt < new Date()) {
    session.revokedAt = new Date()
    session.revokedReason = 'expired'
    await session.save()
    clearSessionCache(String(session._id))
    throw ApiError.unauthorized('Session expired. Please sign in again.')
  }
  const user = await User.findById(session.userId)
  if (!user || user.status !== 'active') throw ApiError.forbidden('Account is not active')

  const refreshToken = randomToken(48)
  const refreshExpires = session.expiresAt
  session.revokedAt = new Date()
  session.revokedReason = 'rotated'
  session.replacedByHash = sha256(refreshToken)
  await session.save()
  const replacement = await Session.create({
    userId: user._id,
    tokenHash: session.replacedByHash,
    expiresAt: refreshExpires,
    ip: input.ip ?? session.ip,
    userAgent: input.userAgent ?? session.userAgent,
    deviceId: input.deviceId ?? session.deviceId,
    deviceName: input.deviceName ?? session.deviceName,
    platform: input.platform ?? session.platform,
    appVersion: input.appVersion ?? session.appVersion,
    pushToken: session.pushToken,
    lastActiveAt: new Date(),
  })
  clearSessionCache(String(session._id))
  return {
    tokens: {
      accessToken: signAccessToken(user._id, replacement._id),
      refreshToken,
      refreshExpires,
      sessionId: String(replacement._id),
    },
    ctx: await getUserContext(user._id),
  }
}

export async function revokeRefreshToken(token?: string): Promise<void> {
  if (!token) return
  const session = await Session.findOneAndUpdate(
    { tokenHash: sha256(token), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: 'signed_out' } },
  )
  if (session) clearSessionCache(String(session._id))
}

export async function revokeAllSessions(userId: string | Types.ObjectId, exceptSessionId?: string): Promise<void> {
  const filter: Record<string, unknown> = { userId, revokedAt: { $exists: false } }
  if (exceptSessionId) filter._id = { $ne: exceptSessionId }
  await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: 'revoked_all' } })
  clearSessionCache()
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
    devToken: !isProd && !emailConfigured ? token : undefined,
  }
}

export async function beginEmailChange(userId: string | Types.ObjectId, newEmailInput: string, password: string): Promise<void> {
  const newEmail = newEmailInput.trim().toLowerCase()
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw ApiError.notFound('Account not found')
  if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) throw ApiError.badRequest('Confirm your current password to change your email.')
  if (newEmail === user.email) throw ApiError.badRequest('That is already your current email address.')
  if (await User.exists({ email: newEmail })) throw ApiError.conflict('That email address is already used by another account.')
  const token = randomToken(32)
  user.pendingEmail = newEmail
  user.emailChangeTokenHash = sha256(token)
  user.emailChangeExpires = addMinutes(new Date(), 30)
  await user.save()
  const link = `${env.APP_URL}/verify-email-change?token=${token}`
  const result = await sendMail({
    to: newEmail,
    subject: 'Confirm your new ConductNexus email address',
    html: `<p>Hello ${user.name},</p><p>Confirm your new email address by opening this link:</p><p><a href="${link}">Verify new email</a></p><p>This link expires in 30 minutes. Your current email remains unchanged until verification succeeds.</p>`,
  })
  if (!result.delivered && isProd) throw ApiError.badRequest('The verification email could not be delivered. Your current email has not been changed; please try again later.')
}

export async function verifyEmailChange(token: string): Promise<{ userId: string; name: string }> {
  const user = await User.findOne({
    emailChangeTokenHash: sha256(token),
    emailChangeExpires: { $gt: new Date() },
  }).select('+emailChangeTokenHash +emailChangeExpires +pendingEmail')
  if (!user || !user.pendingEmail) throw ApiError.badRequest('This email-change link is invalid or has expired.')
  if (await User.exists({ email: user.pendingEmail, _id: { $ne: user._id } })) throw ApiError.conflict('That email address is now used by another account.')
  user.email = user.pendingEmail
  user.emailVerified = true
  user.pendingEmail = undefined
  user.emailChangeTokenHash = undefined
  user.emailChangeExpires = undefined
  await user.save()
  await TrustedDevice.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
  await revokeAllSessions(user._id)
  invalidateUserAccess(String(user._id))
  return { userId: String(user._id), name: user.name }
}

export async function listTrustedDevices(userId: string | Types.ObjectId) {
  return TrustedDevice.find({ userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
    .select('_id deviceName userAgent createdAt lastUsedAt expiresAt')
    .sort({ lastUsedAt: -1 })
    .lean()
}

export async function revokeTrustedDevice(userId: string | Types.ObjectId, deviceId: string): Promise<void> {
  if (!Types.ObjectId.isValid(deviceId)) throw ApiError.badRequest('Invalid device identifier.')
  const result = await TrustedDevice.updateOne({ _id: deviceId, userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
  if (!result.matchedCount) throw ApiError.notFound('Trusted device not found.')
}

export async function revokeAllTrustedDevices(userId: string | Types.ObjectId): Promise<void> {
  await TrustedDevice.updateMany({ userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
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
    devCode: !isProd && !emailConfigured ? code : undefined,
    devToken: !isProd && !emailConfigured ? token : undefined,
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
  await TrustedDevice.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
  await revokeAllSessions(user._id)
  await sendMail({
    to: user.email,
    subject: 'Your ConductNexus password was changed',
    html: `<p>Your ConductNexus password was changed successfully.</p><p>If this was not you, contact your school administrator immediately.</p>`,
  })
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
): Promise<void> {
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
  await TrustedDevice.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
  invalidateUserAccess(String(user._id))
  await revokeAllSessions(user._id, keepSessionId)
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
    emailConfigured,
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
