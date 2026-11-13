import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny, z } from 'zod'
import { ApiError } from './errors.js'

export type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

export const asyncHandler =
  (fn: AsyncRoute) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }

export function ok<T>(res: Response, data: T, meta?: unknown) {
  return res.json({ success: true, data, ...(meta ? { meta } : {}) })
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ success: true, data })
}

export function noContent(res: Response) {
  return res.status(204).send()
}

export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  return { page, pageSize, skip: (page - 1) * pageSize }
}

export function pagedMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export function paginated<T>(res: Response, items: T[], total: number, page: number, pageSize: number) {
  return res.json({ success: true, data: items, meta: pagedMeta(total, page, pageSize) })
}

export function validate<TBody extends ZodTypeAny, TQuery extends ZodTypeAny>(
  schemas: { body?: TBody; query?: TQuery },
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        const parsed = schemas.body.safeParse(req.body)
        if (!parsed.success) {
          throw ApiError.unprocessable('Please correct the highlighted fields.', parsed.error.flatten())
        }
        req.body = parsed.data as z.infer<TBody>
      }
      if (schemas.query) {
        const parsed = schemas.query.safeParse(req.query)
        if (!parsed.success) {
          throw ApiError.badRequest('Invalid query parameters', parsed.error.flatten())
        }
        ;(req as Request & { validatedQuery?: unknown }).validatedQuery = parsed.data
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

export function queryOf<T>(req: Request): T {
  return (req as Request & { validatedQuery?: T }).validatedQuery ?? (req.query as unknown as T)
}
