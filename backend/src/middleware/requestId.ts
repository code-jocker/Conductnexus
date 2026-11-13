import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) || crypto.randomUUID()
  req.requestId = id
  res.setHeader('X-Request-Id', id)
  next()
}
