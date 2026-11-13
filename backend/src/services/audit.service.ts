import type { Request } from 'express'
import { Types } from 'mongoose'
import { AccessLog, AuditLog } from '../models/governance.js'
import { logger } from '../shared/logger.js'
import type { AuthContext } from './rbac.service.js'

type AuditActor = { userId: Types.ObjectId; name: string; roles?: string[] }

type AuditInput = {
  req?: Request
  actor?: AuditActor
  action: string
  resourceType: string
  resourceId?: string
  before?: unknown
  after?: unknown
  reason?: string
}

const SENSITIVE_KEYS = new Set(['passwordHash', 'password', 'token', 'refreshToken', 'resetCode', 'tokenHash'])

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 4) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1))
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(k)) continue
      out[k] = sanitize(v, depth + 1)
    }
    return out
  }
  return value
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const req = input.req
    await AuditLog.create({
      actorId: input.actor?.userId,
      actorName: input.actor?.name ?? 'System',
      actorRoles: input.actor?.roles ?? [],
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: sanitize(input.before),
      after: sanitize(input.after),
      reason: input.reason,
      requestId: req?.requestId,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    })
  } catch (err) {
    logger.error({ err }, 'Failed to write audit log')
  }
}

export async function writeAccessLog(input: {
  actor: AuthContext
  resourceType: string
  resourceId?: string
  action: string
  classification?: string
  req?: Request
}): Promise<void> {
  try {
    await AccessLog.create({
      userId: input.actor.userId,
      userName: input.actor.name,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      classification: input.classification ?? 'confidential',
      ip: input.req?.ip,
    })
  } catch (err) {
    logger.error({ err }, 'Failed to write access log')
  }
}

export function idsEqual(a: unknown, b: unknown): boolean {
  if (!a || !b) return false
  return String(a) === String(b)
}

export function objectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value)
}
