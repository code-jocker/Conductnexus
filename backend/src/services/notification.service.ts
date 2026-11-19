import type { Server } from 'socket.io'
import { Types } from 'mongoose'
import { RolePermission, User, UserRole } from '../models/core.js'
import { Notification, NotificationPreference, type NotificationCategory } from '../models/communications.js'
import { logger } from '../shared/logger.js'
import { sendPushToUsers } from './push.service.js'
import { categoryOf } from './notification-preferences.service.js'

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

/**
 * Priority derived from the notification type so every producer gets consistent
 * ordering without having to remember to set it.
 *
 * safeguarding/incident escalate — those demand action; approval and appeal are
 * decisions waiting on someone; everything else is informational.
 */
export function priorityOf(type: string): 'low' | 'normal' | 'high' | 'critical' {
  if (type.startsWith('safeguarding')) return 'critical'
  if (type.startsWith('welfare')) return 'high'
  if (type.startsWith('incident') || type.startsWith('risk') || type.startsWith('detention')) return 'high'
  if (type.startsWith('approval') || type.startsWith('appeal')) return 'high'
  if (type.startsWith('communication') || type.startsWith('system')) return 'low'
  return 'normal'
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
        priority: priorityOf(payload.type),
        data: payload.data,
      })),
    )
    if (ioRef) {
      for (let i = 0; i < docs.length; i++) {
        ioRef.to(`user:${unique[i]}`).emit('notification:new', {
          id: String(docs[i]._id),
          type: payload.type,
          priority: docs[i].priority,
          title: payload.title,
          message: payload.message,
          link: payload.link,
          createdAt: docs[i].createdAt,
        })
      }
    }
    // Safeguarding previews must not leak onto a lock screen.
    const sensitive = payload.type.startsWith('safeguarding') || payload.data?.sensitive === true
    const category = categoryOf(payload.type)
    const deliverable = await filterByPreference(unique, category)
    void sendPushToUsers(deliverable, {
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

/**
 * Drops recipients who muted this category on the push channel.
 *
 * Only push is filtered: the in-app record has already been written for every
 * recipient, and muting a channel must not hide a notification from the inbox.
 */
async function filterByPreference(userIds: string[], category: NotificationCategory): Promise<string[]> {
  if (!userIds.length) return []
  const muted = await NotificationPreference.find({
    userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
    channel: 'push',
    category,
    enabled: false,
  })
    .select('userId')
    .lean()
  if (!muted.length) return userIds
  const mutedIds = new Set(muted.map((row) => String(row.userId)))
  return userIds.filter((id) => !mutedIds.has(id))
}

export { FEED_LIMIT }
