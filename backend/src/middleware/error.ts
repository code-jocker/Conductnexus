import type { NextFunction, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { ApiError } from '../shared/errors.js'
import { ErrorLog } from '../models/governance.js'
import { logger } from '../shared/logger.js'
import { isProd } from '../config/env.js'
import { captureError } from '../services/monitoring.service.js'
import { ZodError } from 'zod'

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 400,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please slow down.' } },
})

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many sign-in attempts. Try again in 15 minutes.' } },
})

export const forgotLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many reset requests. Try again later.' } },
})

export const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many verification attempts. Try again in 15 minutes.' } },
})

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound('API endpoint not found'))
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500
  let code = 'INTERNAL_ERROR'
  let message = 'An unexpected error occurred'
  let details: unknown

  if (err instanceof ApiError) {
    status = err.status
    code = err.code
    message = err.message
    details = err.details
  } else if (err instanceof ZodError) {
    status = 422
    code = 'VALIDATION_ERROR'
    message = 'Please correct the highlighted fields.'
    details = err.flatten()
  } else if (typeof err === 'object' && err && 'name' in err) {
    const e = err as { name: string; code?: number; keyValue?: Record<string, unknown>; message?: string }
    if (e.name === 'ValidationError') {
      status = 422
      code = 'VALIDATION_ERROR'
      message = e.message ?? 'Validation failed'
    } else if (e.name === 'CastError') {
      status = 400
      code = 'INVALID_ID'
      message = 'Invalid record identifier'
    } else if (e.name === 'MulterError') {
      status = 400
      code = 'UPLOAD_ERROR'
      message = e.message ?? 'File upload failed'
    } else if (e.code === 11000) {
      status = 409
      code = 'DUPLICATE_RECORD'
      message = 'A record with these details already exists.'
      details = e.keyValue
    }
  }

  if (status >= 500) {
    logger.error({ err, requestId: req.requestId }, 'Unhandled request error')
    captureError({
      error: err,
      context: {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ...(req.auth?.userId ? { userId: String(req.auth.userId) } : {}),
      },
    })
    ErrorLog.create({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      path: req.originalUrl,
      method: req.method,
      userId: req.auth?.userId,
      requestId: req.requestId,
    }).catch(() => undefined)
  }

  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    requestId: req.requestId,
  })
}
