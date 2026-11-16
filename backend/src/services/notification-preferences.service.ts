import { Types } from 'mongoose'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NotificationPreference,
  type NotificationCategory,
  type NotificationChannel,
} from '../models/communications.js'

/**
 * Notification delivery preferences.
 *
 * Two rules shape the whole surface:
 *  1. A missing row means enabled — preferences are opt-out, never silently off.
 *  2. Preferences gate delivery channels only. The in-app inbox always receives
 *     the record, so muting push can never hide something a user is accountable
 *     for.
 */

export type PreferenceMatrix = {
  channel: NotificationChannel
  category: NotificationCategory
  enabled: boolean
  /** True when no row exists and the effective value is the default. */
  defaulted: boolean
}

const asCategory = (value: string): NotificationCategory =>
  (NOTIFICATION_CATEGORIES as readonly string[]).includes(value) ? (value as NotificationCategory) : 'system'

/** Category is the first segment of a notification type, e.g. `approval.decided`. */
export function categoryOf(type: string): NotificationCategory {
  return asCategory(type.split('.')[0] ?? 'system')
}

/** Full matrix for a user, filling gaps with the enabled-by-default rule. */
export async function getPreferenceMatrix(userId: string): Promise<PreferenceMatrix[]> {
  const rows = await NotificationPreference.find({ userId: new Types.ObjectId(userId) }).lean()
  const stored = new Map(rows.map((row) => [`${row.channel}:${row.category}`, row.enabled]))

  const matrix: PreferenceMatrix[] = []
  for (const channel of NOTIFICATION_CHANNELS) {
    for (const category of NOTIFICATION_CATEGORIES) {
      const key = `${channel}:${category}`
      const has = stored.has(key)
      matrix.push({ channel, category, enabled: has ? Boolean(stored.get(key)) : true, defaulted: !has })
    }
  }
  return matrix
}

export type PreferenceUpdate = { channel: NotificationChannel; category: NotificationCategory; enabled: boolean }

export async function updatePreferences(userId: string, updates: PreferenceUpdate[]): Promise<PreferenceMatrix[]> {
  const id = new Types.ObjectId(userId)
  for (const update of updates) {
    await NotificationPreference.updateOne(
      { userId: id, channel: update.channel, category: update.category },
      { $set: { enabled: update.enabled } },
      { upsert: true },
    )
  }
  return getPreferenceMatrix(userId)
}

/** True unless the user has explicitly muted this category on this channel. */
export async function isChannelEnabled(
  userId: string,
  channel: NotificationChannel,
  category: NotificationCategory,
): Promise<boolean> {
  const row = await NotificationPreference.findOne({ userId: new Types.ObjectId(userId), channel, category })
    .select('enabled')
    .lean()
  return row ? Boolean(row.enabled) : true
}

export async function resetPreferences(userId: string): Promise<PreferenceMatrix[]> {
  await NotificationPreference.deleteMany({ userId: new Types.ObjectId(userId) })
  return getPreferenceMatrix(userId)
}