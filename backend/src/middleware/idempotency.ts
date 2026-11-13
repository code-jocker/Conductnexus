import type { NextFunction, Request, Response } from 'express'
import { IdempotencyKey } from '../models/core.js'

export function idempotency(scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.header('Idempotency-Key')
      if (!key || !req.auth || req.method !== 'POST') return next()
      const existing = await IdempotencyKey.findOne({ key, scope, userId: req.auth.userId })
      if (existing) {
        res.setHeader('Idempotent-Replay', 'true')
        res.status(existing.statusCode).json(existing.response)
        return
      }
      const originalJson = res.json.bind(res)
      res.json = (body: unknown) => {
        if (res.statusCode < 400) {
          IdempotencyKey.create({
            key,
            scope,
            userId: req.auth!.userId,
            statusCode: res.statusCode,
            response: body,
          }).catch(() => undefined)
        }
        return originalJson(body)
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
