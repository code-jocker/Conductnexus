import type { Server } from 'socket.io'
import { Types } from 'mongoose'
import { RolePermission, User, UserRole } from '../models/core.js'
import { Notification } from '../models/communications.js'
import { logger } from '../shared/logger.js'
import { sendPushToUsers } from './push.service.js'

let ioRef: Server | null = null
const FEED_LIMIT = 250

export function setSocketServer(io: Server) {
  ioRef = io
}

export type NotificationPayload = {
  type: string
  title: string
  message: string
  link?: string
  data?: Record<string, unknown>
}

export async function notifyUsers(userIds: (string | Types.ObjectId)[], payload: NotificationPayload) {
  const unique = [...new Set(userIds.map(String))]
  if (!unique.length) return
  try {
    const docs = await Notification.insertMany(
      unique.map((id) => ({
        userId: new Types.ObjectId(id),
        type: payload.type,
        title: payload.title,
        message: payload.message,
        link: payload.link,
        data: payload.data,
      })),
    )
    if (ioRef) {
      for (let i = 0; i < docs.length; i++) {
        ioRef.to(`user:${unique[i]}`).emit('notification:new', {
          id: String(docs[i]._id),
          type: payload.type,
          title: payload.title,
          message: payload.message,
          link: payload.link,
          createdAt: docs[i].createdAt,
        })
      }
    }
    // Safeguarding previews must not leak onto a lock screen.
    const sensitive = payload.type.startsWith('safeguarding') || payload.data?.sensitive === true
    void sendPushToUsers(unique, {
      title: sensitive ? 'ConductNexus' : payload.title,
      body: sensitive ? 'You have a new confidential update. Sign in to view it.' : payload.message,
      data: { type: payload.type, link: payload.link, ...payload.data },
    }).catch((err) => logger.warn({ err }, 'Push notification delivery failed'))
  } catch (err) {
    logger.error({ err }, 'Failed to create notifications')
  }
}

export async function notifyPermission(
  permission: string,
  payload: NotificationPayload,
  opts: { excludeUserId?: string; alsoUserIds?: string[] } = {},
) {
  const roleLinks = await RolePermission.find({ permission }).select('roleId').lean()
  const roleIds = roleLinks.map((r) => r.roleId)
  const users = await UserRole.find({ roleId: { $in: roleIds } }).select('userId').lean()
  const ids = new Set(users.map((u) => String(u.userId)))
  for (const id of opts.alsoUserIds ?? []) ids.add(id)
  if (opts.excludeUserId) ids.delete(opts.excludeUserId)
  if (!ids.size) return
  const active = await User.find({ _id: { $in: [...ids] }, status: 'active' }).select('_id').lean()
  await notifyUsers(active.map((u) => u._id), payload)
}

export async function notifyRole(roleKey: string, payload: NotificationPayload, excludeUserId?: string) {
  const role = await (await import('../models/core.js')).Role.findOne({ key: roleKey }).lean()
  if (!role) return
  const users = await UserRole.find({ roleId: role._id }).select('userId').lean()
  const ids = new Set(users.map((u) => String(u.userId)))
  if (excludeUserId) ids.delete(excludeUserId)
  const active = await User.find({ _id: { $in: [...ids] }, status: 'active' }).select('_id').lean()
  await notifyUsers(active.map((u) => u._id), payload)
}

export function feedRoom(userId: string) {
  return `user:${userId}`
}

export { FEED_LIMIT }
