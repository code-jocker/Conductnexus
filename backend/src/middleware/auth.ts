import type { NextFunction, Request, Response } from 'express'
import { ApiError } from '../shared/errors.js'
import { getUserContext, hasPermission, hasRole, type AuthContext } from '../services/rbac.service.js'
import { verifyAccessToken } from '../services/auth.service.js'
import { assertSessionActive } from '../services/session.service.js'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
      auth?: AuthContext
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) throw ApiError.unauthorized()
    const token = header.slice(7).trim()
    const { userId, sessionId } = verifyAccessToken(token)
    if (sessionId) await assertSessionActive(sessionId)
    req.auth = { ...(await getUserContext(userId)), sessionId }
    next()
  } catch (err) {
    next(err)
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization
    if (header?.startsWith('Bearer ')) {
      const { userId, sessionId } = verifyAccessToken(header.slice(7).trim())
      if (sessionId) await assertSessionActive(sessionId)
      req.auth = { ...(await getUserContext(userId)), sessionId }
    }
  } catch {
    req.auth = undefined
  }
  next()
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw ApiError.unauthorized()
      if (!permissions.some((p) => hasPermission(req.auth!, p))) {
        throw ApiError.forbidden(`Missing permission: ${permissions.join(' or ')}`)
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

export function requireAllPermissions(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw ApiError.unauthorized()
      if (!permissions.every((p) => hasPermission(req.auth!, p))) {
        throw ApiError.forbidden('You do not have all required permissions')
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw ApiError.unauthorized()
      if (!hasRole(req.auth, ...roles)) throw ApiError.forbidden('This action requires a different role')
      next()
    } catch (err) {
      next(err)
    }
  }
}
