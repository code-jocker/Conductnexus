import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { authenticate } from '../middleware/auth.js'
import { authLimiter, forgotLimiter, twoFactorLimiter } from '../middleware/error.js'
import { asyncHandler, ok, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from '../services/audit.service.js'
import {
  REFRESH_COOKIE,
  beginTwoFactorEnrollment,
  beginEmailChange,
  verifyEmailChange,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
  changePassword,
  completeSetup,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  loginWithGoogle,
  loginWithPassword,
  refreshCookieOptions,
  requestPasswordReset,
  resetPassword,
  revokeAllSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  sendVerificationEmail,
  setupStatus,
  twoFactorStatus,
  verifyEmailToken,
  resendTwoFactorCode,
  verifyTwoFactorChallenge,
  type TokenPair,
  type TwoFactorChannel,
} from '../services/auth.service.js'
import { getSettings, User as UserModel } from '../models/core.js'
import { emailConfigured, firebaseConfigured } from '../config/env.js'
import { invalidateUserAccess } from '../services/rbac.service.js'
import { requestableRoles } from '../shared/roles.js'
import { submitAccessRequest } from '../services/access-request.service.js'
import { listUserSessions, registerPushToken, removePushToken, revokeSession } from '../services/session.service.js'
import { actorOf, passwordField } from './helpers.js'

const router = Router()
const ADMIN_TRUST_COOKIE = 'cn_admin_trust'
const trustedCookieOptions = () => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
})
function setTrustedDeviceCookie(res: import('express').Response, token?: string) {
  if (token) res.cookie(ADMIN_TRUST_COOKIE, token, trustedCookieOptions())
}

const deviceSchema = z
  .object({
    deviceId: z.string().trim().min(3).max(120).optional(),
    deviceName: z.string().trim().max(120).optional(),
    platform: z.enum(['ios', 'android', 'web', 'unknown']).optional(),
    appVersion: z.string().trim().max(40).optional(),
  })
  .optional()

type DeviceInput = z.infer<typeof deviceSchema>

function clientMeta(req: import('express').Request, device: DeviceInput, platform: 'web' | 'android' | 'ios' = 'web') {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    deviceId: device?.deviceId,
    deviceName: device?.deviceName,
    platform: device?.platform ?? platform,
    appVersion: device?.appVersion,
  }
}

const channelSchema = z.enum(['email', 'whatsapp']).optional()

/**
 * The code never leaves the server: clients only learn which channel was used
 * and a masked destination. `devCode` exists solely so a local checkout with
 * no mail provider configured can still be signed into.
 */
function twoFactorPayload(result: {
  challenge: string
  userId: string
  name: string
  email: string
  channel: TwoFactorChannel
  channels: TwoFactorChannel[]
  maskedDestination: string
  delivered: boolean
  warning?: string
  devCode?: string
}) {
  return {
    twoFactorRequired: true,
    challenge: result.challenge,
    userId: result.userId,
    name: result.name,
    email: result.email,
    channel: result.channel,
    channels: result.channels,
    maskedDestination: result.maskedDestination,
    delivered: result.delivered,
    warning: result.warning,
    devCode: result.devCode,
    message: result.delivered
      ? `A verification code was sent to ${result.maskedDestination} by ${result.channel === 'whatsapp' ? 'WhatsApp' : 'email'}.`
      : 'The verification code could not be delivered. Request a code on another channel.',
  }
}

function sendTokens(res: import('express').Response, tokens: TokenPair, payload: Record<string, unknown>) {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions(tokens.refreshExpires))
  return ok(res, {
    ...payload,
    accessToken: tokens.accessToken,
    sessionExpiresAt: tokens.refreshExpires,
  })
}

function sendNativeTokens(res: import('express').Response, tokens: TokenPair, payload: Record<string, unknown>) {
  return ok(res, {
    ...payload,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    refreshExpires: tokens.refreshExpires,
    sessionId: tokens.sessionId,
  })
}

router.get(
  '/setup-status',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings()
    ok(res, {
      ...(await setupStatus()),
      schoolMotto: settings.school.motto,
      startingMarks: settings.academic.startingMarks,
      timezone: settings.academic.timezone,
      language: settings.academic.language,
    })
  }),
)

router.get(
  '/access-request/roles',
  asyncHandler(async (_req, res) => {
    ok(res, requestableRoles())
  }),
)

router.post(
  '/access-request',
  authLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email(),
      phone: z.string().trim().max(30).optional().or(z.literal('')),
      requestedRole: z.string().trim().min(2).max(60),
      reason: z.string().trim().max(1000).optional().or(z.literal('')),
    }),
  }),
  asyncHandler(async (req, res) => {
    await submitAccessRequest({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone || undefined,
      requestedRole: req.body.requestedRole,
      reason: req.body.reason || undefined,
    })
    res.status(202).json({
      success: true,
      data: {
        message:
          'Your request was received. The school office will review it and contact you by email and WhatsApp once it is approved.',
      },
    })
  }),
)

router.post(
  '/setup',
  validate({
    body: z.object({
      schoolName: z.string().trim().min(2).max(140),
      schoolEmail: z.string().email().optional().or(z.literal('')),
      schoolPhone: z.string().trim().max(30).optional(),
      adminName: z.string().trim().min(2).max(120),
      adminEmail: z.string().email(),
      adminPassword: passwordField,
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await completeSetup(req.body)
    await writeAudit({
      req,
      actor: result.ctx,
      action: 'system.setup_completed',
      resourceType: 'Settings',
      after: { schoolName: req.body.schoolName },
    })
    sendTokens(res, result.tokens, { user: result.ctx.user, permissions: [...result.ctx.permissions], roles: result.ctx.roles })
  }),
)

router.post(
  '/login',
  authLimiter,
  validate({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(1),
      channel: channelSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await loginWithPassword({
      email: req.body.email,
      password: req.body.password,
      channel: req.body.channel,
      trustedDeviceToken: (req.cookies as Record<string, string> | undefined)?.[ADMIN_TRUST_COOKIE],
      ...clientMeta(req, undefined, 'web'),
    })
    if (result.status === 'two_factor_required') {
      await writeAudit({
        req,
        actor: { userId: new Types.ObjectId(result.userId), name: result.name },
        action: 'auth.2fa_challenged',
        resourceType: 'User',
        resourceId: result.userId,
        after: { channel: result.channel, delivered: result.delivered },
      })
      return ok(res, twoFactorPayload(result))
    }
    const { tokens, ctx } = result
    setTrustedDeviceCookie(res, result.trustedDeviceToken)
    await writeAudit({ req, actor: ctx, action: 'auth.login', resourceType: 'User', resourceId: String(ctx.userId) })
    sendTokens(res, tokens, { user: ctx.user, permissions: [...ctx.permissions], roles: ctx.roles })
  }),
)

router.post(
  '/google',
  authLimiter,
  validate({
    body: z.object({ idToken: z.string().min(20), channel: channelSchema }),
  }),
  asyncHandler(async (req, res) => {
    if (!firebaseConfigured) {
      throw ApiError.badRequest('Google Sign-In is not configured yet. Ask your administrator to set FIREBASE_PROJECT_ID on the server.')
    }
    const result = await loginWithGoogle({
      idToken: req.body.idToken,
      channel: req.body.channel,
      ...clientMeta(req, undefined, 'web'),
    })
    if (result.status === 'two_factor_required') {
      await writeAudit({
        req,
        actor: { userId: new Types.ObjectId(result.userId), name: result.name },
        action: 'auth.2fa_challenged',
        resourceType: 'User',
        resourceId: result.userId,
        after: { channel: result.channel, method: 'google', delivered: result.delivered },
      })
      return ok(res, twoFactorPayload(result))
    }
    const { tokens, ctx, isNew, hasAccess } = result
    await writeAudit({ req, actor: ctx, action: isNew ? 'auth.google_signup' : 'auth.google_login', resourceType: 'User', resourceId: String(ctx.userId) })
    sendTokens(res, tokens, {
      user: ctx.user,
      permissions: [...ctx.permissions],
      roles: ctx.roles,
      isNew,
      hasAccess,
      message: hasAccess
        ? undefined
        : 'Your Google account was verified. An administrator must assign your school role before you can open records.',
    })
  }),
)

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    const result = await rotateRefreshToken({ token, ...clientMeta(req, undefined, 'web') })
    sendTokens(res, result.tokens, {
      user: result.ctx.user,
      permissions: [...result.ctx.permissions],
      roles: result.ctx.roles,
    })
  }),
)

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    await revokeRefreshToken(token)
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' })
    ok(res, { message: 'Signed out' })
  }),
)

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(actorOf(req).userId)
    invalidateUserAccess(String(actorOf(req).userId))
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' })
    ok(res, { message: 'All sessions revoked' })
  }),
)

// ── Native (Expo / React Native) session flow ──────────────────────────────
// The refresh token is returned in the response body and must be stored in
// the device keystore. It is never placed in a cookie for native clients.

router.post(
  '/native/login',
  authLimiter,
  validate({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(1),
      channel: channelSchema,
      device: deviceSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await loginWithPassword({
      email: req.body.email,
      password: req.body.password,
      channel: req.body.channel,
      ...clientMeta(req, req.body.device, 'android'),
    })
    if (result.status === 'two_factor_required') {
      await writeAudit({
        req,
        actor: { userId: new Types.ObjectId(result.userId), name: result.name },
        action: 'auth.native_2fa_challenged',
        resourceType: 'User',
        resourceId: result.userId,
        after: { channel: result.channel, delivered: result.delivered },
      })
      return ok(res, twoFactorPayload(result))
    }
    const { tokens, ctx } = result
    await writeAudit({ req, actor: ctx, action: 'auth.native_login', resourceType: 'User', resourceId: String(ctx.userId) })
    sendNativeTokens(res, tokens, {
      user: ctx.user,
      permissions: [...ctx.permissions],
      roles: ctx.roles,
    })
  }),
)

router.post(
  '/native/google',
  authLimiter,
  validate({
    body: z.object({ idToken: z.string().min(20), channel: channelSchema, device: deviceSchema }),
  }),
  asyncHandler(async (req, res) => {
    if (!firebaseConfigured) {
      throw ApiError.badRequest('Google Sign-In is not configured yet. Ask your administrator to set FIREBASE_PROJECT_ID on the server.')
    }
    const result = await loginWithGoogle({
      idToken: req.body.idToken,
      channel: req.body.channel,
      ...clientMeta(req, req.body.device, 'android'),
    })
    if (result.status === 'two_factor_required') {
      await writeAudit({
        req,
        actor: { userId: new Types.ObjectId(result.userId), name: result.name },
        action: 'auth.native_2fa_challenged',
        resourceType: 'User',
        resourceId: result.userId,
        after: { channel: result.channel, method: 'google', delivered: result.delivered },
      })
      return ok(res, twoFactorPayload(result))
    }
    const { tokens, ctx, isNew, hasAccess } = result
    await writeAudit({
      req,
      actor: ctx,
      action: isNew ? 'auth.native_google_signup' : 'auth.native_google_login',
      resourceType: 'User',
      resourceId: String(ctx.userId),
    })
    sendNativeTokens(res, tokens, {
      user: ctx.user,
      permissions: [...ctx.permissions],
      roles: ctx.roles,
      isNew,
      hasAccess,
      message: hasAccess
        ? undefined
        : 'Your Google account was verified. An administrator must assign your school role before you can open records.',
    })
  }),
)

router.post(
  '/native/refresh',
  validate({
    body: z.object({ refreshToken: z.string().min(20), device: deviceSchema }),
  }),
  asyncHandler(async (req, res) => {
    const result = await rotateRefreshToken({
      token: req.body.refreshToken,
      ...clientMeta(req, req.body.device, 'android'),
    })
    sendNativeTokens(res, result.tokens, {
      user: result.ctx.user,
      permissions: [...result.ctx.permissions],
      roles: result.ctx.roles,
    })
  }),
)

router.post(
  '/native/logout',
  validate({ body: z.object({ refreshToken: z.string().min(20).optional() }) }),
  asyncHandler(async (req, res) => {
    await revokeRefreshToken(req.body.refreshToken)
    ok(res, { message: 'Signed out' })
  }),
)

// ── Two-factor authentication (email) ──────────────────────────────────────
// Password login returns a short-lived challenge token when 2FA is enabled.
// The client submits that challenge plus the emailed code to receive tokens.

router.post(
  '/2fa/verify',
  twoFactorLimiter,
  validate({
    body: z.object({
      challenge: z.string().min(20),
      code: z.string().trim().length(6),
      trustDevice: z.boolean().optional().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await verifyTwoFactorChallenge({
      challenge: req.body.challenge,
      code: req.body.code,
      trustDevice: req.body.trustDevice,
      ...clientMeta(req, undefined, 'web'),
    })
    const { tokens, ctx } = result
    setTrustedDeviceCookie(res, result.trustedDeviceToken)
    await writeAudit({ req, actor: ctx, action: 'auth.2fa_verified', resourceType: 'User', resourceId: String(ctx.userId) })
    sendTokens(res, tokens, { user: ctx.user, permissions: [...ctx.permissions], roles: ctx.roles })
  }),
)

router.post(
  '/native/2fa/verify',
  twoFactorLimiter,
  validate({
    body: z.object({
      challenge: z.string().min(20),
      code: z.string().trim().length(6),
      device: deviceSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const { tokens, ctx } = await verifyTwoFactorChallenge({
      challenge: req.body.challenge,
      code: req.body.code,
      ...clientMeta(req, req.body.device, 'android'),
    })
    await writeAudit({ req, actor: ctx, action: 'auth.native_2fa_verified', resourceType: 'User', resourceId: String(ctx.userId) })
    sendNativeTokens(res, tokens, {
      user: ctx.user,
      permissions: [...ctx.permissions],
      roles: ctx.roles,
    })
  }),
)

router.post(
  '/2fa/resend',
  twoFactorLimiter,
  validate({
    body: z.object({
      challenge: z.string().min(20),
      channel: channelSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const delivery = await resendTwoFactorCode({
      challenge: req.body.challenge,
      channel: req.body.channel,
    })
    await writeAudit({
      req,
      actor: { userId: new Types.ObjectId(delivery.userId), name: delivery.name },
      action: 'auth.2fa_resent',
      resourceType: 'User',
      resourceId: delivery.userId,
      after: { channel: delivery.channel, delivered: delivery.delivered },
    })
    ok(res, {
      channel: delivery.channel,
      channels: delivery.channels,
      maskedDestination: delivery.maskedDestination,
      delivered: delivery.delivered,
      warning: delivery.warning,
      devCode: delivery.devCode,
      message: delivery.delivered
        ? `A new verification code was sent to ${delivery.maskedDestination} by ${delivery.channel === 'whatsapp' ? 'WhatsApp' : 'email'}.`
        : 'The verification code could not be delivered. Try another channel.',
    })
  }),
)

router.get(
  '/2fa/status',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await twoFactorStatus(actorOf(req).userId))
  }),
)

router.post(
  '/2fa/enroll',
  authenticate,
  authLimiter,
  validate({ body: z.object({ password: z.string().min(1), channel: channelSchema }) }),
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    const result = await beginTwoFactorEnrollment(ctx.userId, req.body.password, req.body.channel)
    await writeAudit({
      req,
      actor: ctx,
      action: 'auth.2fa_enrollment_started',
      resourceType: 'User',
      resourceId: String(ctx.userId),
      after: { channel: result.channel, delivered: result.delivered },
    })
    ok(res, {
      channel: result.channel,
      channels: result.channels,
      maskedDestination: result.maskedDestination,
      delivered: result.delivered,
      warning: result.warning,
      devCode: result.devCode,
      message: result.delivered
        ? `A verification code was sent to ${result.maskedDestination} by ${result.channel === 'whatsapp' ? 'WhatsApp' : 'email'}.`
        : 'The verification code could not be delivered. Try another channel.',
    })
  }),
)

router.post(
  '/2fa/enroll/confirm',
  authenticate,
  authLimiter,
  validate({ body: z.object({ code: z.string().trim().length(6) }) }),
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    await confirmTwoFactorEnrollment(ctx.userId, req.body.code)
    await writeAudit({ req, actor: ctx, action: 'auth.2fa_enabled', resourceType: 'User', resourceId: String(ctx.userId) })
    ok(res, { message: 'Two-factor authentication is now enabled.' })
  }),
)

router.post(
  '/2fa/disable',
  authenticate,
  authLimiter,
  validate({ body: z.object({ password: z.string().default('') }) }),
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    await disableTwoFactor(ctx.userId, req.body.password)
    await writeAudit({ req, actor: ctx, action: 'auth.2fa_disabled', resourceType: 'User', resourceId: String(ctx.userId) })
    ok(res, { message: 'Two-factor authentication is disabled.' })
  }),
)

router.get(
  '/sessions',
  authenticate,
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    ok(res, { sessions: await listUserSessions(ctx.userId, ctx.sessionId) })
  }),
)

router.delete(
  '/sessions/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    await revokeSession(ctx.userId, req.params.id, 'revoked_by_user')
    if (req.params.id === ctx.sessionId) res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' })
    await writeAudit({
      req,
      actor: ctx,
      action: 'auth.session_revoked',
      resourceType: 'Session',
      resourceId: req.params.id,
    })
    ok(res, { message: 'Session signed out' })
  }),
)

router.post(
  '/logout-others',
  authenticate,
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    await revokeAllSessions(ctx.userId, ctx.sessionId)
    ok(res, { message: 'Other sessions signed out' })
  }),
)

router.post(
  '/push-token',
  authenticate,
  validate({
    body: z.object({
      token: z.string().trim().min(10).max(500),
      platform: z.enum(['ios', 'android', 'web', 'unknown']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    await registerPushToken({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      token: req.body.token,
      platform: req.body.platform,
    })
    ok(res, { message: 'This device will receive push notifications' })
  }),
)

router.delete(
  '/push-token',
  authenticate,
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    await removePushToken(ctx.userId, ctx.sessionId)
    ok(res, { message: 'Push notifications disabled for this device' })
  }),
)

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    const settings = await getSettings()
    ok(res, {
      user: ctx.user,
      roles: ctx.roles,
      permissions: [...ctx.permissions],
      setup: {
        completed: settings.setupCompleted,
        schoolName: settings.school.name,
        schoolMotto: settings.school.motto,
        timezone: settings.academic.timezone,
        language: settings.academic.language,
        emailConfigured,
        firebaseConfigured,
      },
    })
  }),
)

router.post(
  '/change-password',
  authenticate,
  validate({
    body: z.object({ currentPassword: z.string().optional().default(''), newPassword: passwordField }),
  }),
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    await changePassword(String(ctx.userId), req.body.currentPassword ?? '', req.body.newPassword, ctx.sessionId)
    await writeAudit({ req, actor: ctx, action: 'auth.password_changed', resourceType: 'User', resourceId: String(ctx.userId) })
    ok(res, { message: 'Password updated. Other sessions were signed out.' })
  }),
)

router.post(
  '/change-email',
  authenticate,
  authLimiter,
  validate({ body: z.object({ newEmail: z.string().trim().email(), password: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    await beginEmailChange(ctx.userId, req.body.newEmail, req.body.password)
    await writeAudit({ req, actor: ctx, action: 'auth.email_change_requested', resourceType: 'User', resourceId: String(ctx.userId), after: { newEmail: req.body.newEmail.trim().toLowerCase() } })
    ok(res, { message: 'A verification link has been sent to your new email address. Your current email remains active until verification.' })
  }),
)

router.post(
  '/verify-email-change',
  authLimiter,
  validate({ body: z.object({ token: z.string().min(10) }) }),
  asyncHandler(async (req, res) => {
    await verifyEmailChange(req.body.token)
    ok(res, { message: 'Your email address has been changed and verified. Please sign in again.' })
  }),
)

router.get(
  '/trusted-devices',
  authenticate,
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    if (!ctx.roles.includes('ADMIN')) throw ApiError.forbidden()
    ok(res, { devices: await listTrustedDevices(ctx.userId) })
  }),
)

router.delete(
  '/trusted-devices/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    if (!ctx.roles.includes('ADMIN')) throw ApiError.forbidden()
    await revokeTrustedDevice(ctx.userId, req.params.id)
    await writeAudit({ req, actor: ctx, action: 'auth.trusted_device_revoked', resourceType: 'TrustedDevice', resourceId: req.params.id })
    ok(res, { message: 'Trusted device revoked. It will require email verification next time.' })
  }),
)

router.delete(
  '/trusted-devices',
  authenticate,
  asyncHandler(async (req, res) => {
    const ctx = actorOf(req)
    if (!ctx.roles.includes('ADMIN')) throw ApiError.forbidden()
    await revokeAllTrustedDevices(ctx.userId)
    res.clearCookie(ADMIN_TRUST_COOKIE, { path: '/api/v1/auth', secure: true, sameSite: 'none' })
    await writeAudit({ req, actor: ctx, action: 'auth.trusted_devices_revoked', resourceType: 'User', resourceId: String(ctx.userId) })
    ok(res, { message: 'All trusted devices have been revoked.' })
  }),
)

router.post(
  '/verify-email',
  validate({ body: z.object({ token: z.string().min(10) }) }),
  asyncHandler(async (req, res) => {
    await verifyEmailToken(req.body.token)
    ok(res, { message: 'Email address verified' })
  }),
)

router.post(
  '/resend-verification',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(actorOf(req).userId)
    if (!user) throw ApiError.notFound('Account not found')
    const result = await sendVerificationEmail(user)
    ok(res, {
      delivered: result.delivered,
      devToken: result.devToken,
      message: result.delivered
        ? 'Verification email sent'
        : 'Email delivery is not configured. Use the development link shown in the server response.',
    })
  }),
)

router.post(
  '/forgot-password',
  forgotLimiter,
  validate({ body: z.object({ email: z.string().email() }) }),
  asyncHandler(async (req, res) => {
    const result = await requestPasswordReset(req.body.email)
    ok(res, {
      delivered: result.delivered,
      devCode: result.devCode,
      devToken: result.devToken,
      message: 'If the address belongs to an active account, a reset code and link have been sent.',
    })
  }),
)

router.post(
  '/reset-password',
  forgotLimiter,
  validate({
    body: z.object({
      email: z.string().email().optional(),
      code: z.string().trim().length(6).optional(),
      token: z.string().min(10).optional(),
      newPassword: passwordField,
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.body.token && !(req.body.email && req.body.code)) {
      throw ApiError.badRequest('Provide the emailed link token, or your email address and six-digit code.')
    }
    await resetPassword(req.body)
    ok(res, { message: 'Password reset. You can now sign in.' })
  }),
)

export default router
