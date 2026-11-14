import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.js'
import { authLimiter, forgotLimiter } from '../middleware/error.js'
import { asyncHandler, ok, validate } from '../shared/http.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from '../services/audit.service.js'
import {
  REFRESH_COOKIE,
  changePassword,
  completeSetup,
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
  verifyEmailToken,
  type TokenPair,
} from '../services/auth.service.js'
import { getSettings, User as UserModel } from '../models/core.js'
import { firebaseConfigured, smtpConfigured } from '../config/env.js'
import { invalidateUserAccess } from '../services/rbac.service.js'
import { listUserSessions, registerPushToken, removePushToken, revokeSession } from '../services/session.service.js'
import { actorOf, passwordField } from './helpers.js'

const router = Router()

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
    }),
  }),
  asyncHandler(async (req, res) => {
    const { tokens, ctx } = await loginWithPassword({
      email: req.body.email,
      password: req.body.password,
      ...clientMeta(req, undefined, 'web'),
    })
    await writeAudit({ req, actor: ctx, action: 'auth.login', resourceType: 'User', resourceId: String(ctx.userId) })
    sendTokens(res, tokens, { user: ctx.user, permissions: [...ctx.permissions], roles: ctx.roles })
  }),
)

router.post(
  '/google',
  authLimiter,
  validate({
    body: z.object({ idToken: z.string().min(20) }),
  }),
  asyncHandler(async (req, res) => {
    if (!firebaseConfigured) {
      throw ApiError.badRequest('Google Sign-In is not configured yet. Ask your administrator to set FIREBASE_PROJECT_ID on the server.')
    }
    const { tokens, ctx, isNew, hasAccess } = await loginWithGoogle({
      idToken: req.body.idToken,
      ...clientMeta(req, undefined, 'web'),
    })
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
      device: deviceSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const { tokens, ctx } = await loginWithPassword({
      email: req.body.email,
      password: req.body.password,
      ...clientMeta(req, req.body.device, 'android'),
    })
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
    body: z.object({ idToken: z.string().min(20), device: deviceSchema }),
  }),
  asyncHandler(async (req, res) => {
    if (!firebaseConfigured) {
      throw ApiError.badRequest('Google Sign-In is not configured yet. Ask your administrator to set FIREBASE_PROJECT_ID on the server.')
    }
    const { tokens, ctx, isNew, hasAccess } = await loginWithGoogle({
      idToken: req.body.idToken,
      ...clientMeta(req, req.body.device, 'android'),
    })
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
        smtpConfigured,
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
