import { Types } from 'mongoose'
import { Session, type SessionPlatform } from '../models/core.js'
import { ApiError } from '../shared/errors.js'
import { logger } from '../shared/logger.js'

export type SessionMeta = {
  ip?: string
  userAgent?: string
  deviceId?: string
  deviceName?: string
  platform?: SessionPlatform
  appVersion?: string
}

export type SessionView = {
  id: string
  current: boolean
  platform: SessionPlatform
  deviceId?: string
  deviceName?: string
  appVersion?: string
  ip?: string
  userAgent?: string
  pushEnabled: boolean
  createdAt: Date
  lastActiveAt?: Date
  expiresAt: Date
}

const CACHE_TTL_MS = 20_000
const CACHE_MAX = 5_000
const activeCache = new Map<string, { active: boolean; checkedAt: number }>()

export function clearSessionCache(sessionId?: string) {
  if (sessionId) activeCache.delete(sessionId)
  else activeCache.clear()
}

/**
 * Access tokens carry the session id (`sid`) so revoking a device takes
 * effect immediately, even if its access token has not expired yet.
 * A short cache keeps this off the hot path without delaying revocation
 * beyond the cache window.
 */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId)) return false
  const hit = activeCache.get(sessionId)
  if (hit && Date.now() - hit.checkedAt < CACHE_TTL_MS) return hit.active
  const session = await Session.findOne({
    _id: sessionId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  })
    .select('_id')
    .lean()
  const active = Boolean(session)
  if (activeCache.size >= CACHE_MAX) activeCache.clear()
  activeCache.set(sessionId, { active, checkedAt: Date.now() })
  return active
}

export async function assertSessionActive(sessionId: string): Promise<void> {
  if (!(await isSessionActive(sessionId))) {
    throw ApiError.unauthorized('This session has been signed out. Please sign in again.')
  }
}

export async function listUserSessions(userId: string | Types.ObjectId, currentSessionId?: string): Promise<SessionView[]> {
  const sessions = await Session.find({
    userId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActiveAt: -1, createdAt: -1 })
    .lean()
  return sessions.map((s) => ({
    id: String(s._id),
    current: Boolean(currentSessionId && String(s._id) === currentSessionId),
    platform: (s.platform ?? 'unknown') as SessionPlatform,
    deviceId: s.deviceId,
    deviceName: s.deviceName,
    appVersion: s.appVersion,
    ip: s.ip,
    userAgent: s.userAgent,
    pushEnabled: Boolean(s.pushToken),
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    expiresAt: s.expiresAt,
  }))
}

export async function revokeSession(userId: string | Types.ObjectId, sessionId: string, reason = 'revoked_by_user'): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId)) throw ApiError.notFound('Session not found')
  const result = await Session.updateOne(
    { _id: sessionId, userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  )
  clearSessionCache(sessionId)
  if (!result.matchedCount) throw ApiError.notFound('Session not found or already signed out')
}

export async function registerPushToken(input: {
  userId: string | Types.ObjectId
  sessionId?: string
  token: string
  platform?: SessionPlatform
}): Promise<void> {
  if (!input.sessionId) throw ApiError.badRequest('Sign in again to register this device for notifications.')
  // A push token belongs to one device; drop it from any older session.
  await Session.updateMany(
    { userId: input.userId, pushToken: input.token, _id: { $ne: input.sessionId } },
    { $unset: { pushToken: 1 } },
  )
  const result = await Session.updateOne(
    { _id: input.sessionId, userId: input.userId, revokedAt: { $exists: false } },
    {
      $set: {
        pushToken: input.token,
        lastActiveAt: new Date(),
        ...(input.platform ? { platform: input.platform } : {}),
      },
    },
  )
  if (!result.matchedCount) throw ApiError.unauthorized('This session has been signed out. Please sign in again.')
  clearSessionCache(input.sessionId)
}

export async function removePushToken(userId: string | Types.ObjectId, sessionId?: string, token?: string): Promise<void> {
  if (sessionId) {
    await Session.updateOne({ _id: sessionId, userId }, { $unset: { pushToken: 1 } })
    clearSessionCache(sessionId)
    return
  }
  if (token) await Session.updateMany({ userId, pushToken: token }, { $unset: { pushToken: 1 } })
}

export async function clearPushToken(token: string): Promise<void> {
  try {
    await Session.updateMany({ pushToken: token }, { $unset: { pushToken: 1 } })
  } catch (err) {
    logger.warn({ err }, 'Could not clear an invalid push token')
  }
}
