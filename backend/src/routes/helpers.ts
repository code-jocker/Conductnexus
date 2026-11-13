import { z } from 'zod'
import { Types } from 'mongoose'
import type { Request } from 'express'
import { ApiError } from '../shared/errors.js'

export const objectId = z
  .string()
  .trim()
  .refine((v) => Types.ObjectId.isValid(v), 'Invalid identifier')

export const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(v) : undefined))
  .refine((v) => v === undefined || !Number.isNaN(v.getTime()), 'Invalid date')

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(120).optional(),
})

export const passwordField = z
  .string()
  .min(10, 'Use at least 10 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number')

export function idOf(req: Request, name = 'id'): string {
  const value = req.params[name]
  if (!value || !Types.ObjectId.isValid(value)) throw ApiError.badRequest('Invalid identifier')
  return value
}

export function actorOf(req: Request) {
  if (!req.auth) throw ApiError.unauthorized()
  return req.auth
}

export function searchRegex(q?: string) {
  if (!q) return undefined
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

export const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

export function assertObjectId(value: string, label = 'record'): string {
  if (!Types.ObjectId.isValid(value)) throw ApiError.badRequest(`Invalid ${label} identifier`)
  return value
}
