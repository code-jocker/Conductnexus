import type { Types } from 'mongoose'
import { env } from '../config/env.js'
import { Session } from '../models/core.js'
import { logger } from '../shared/logger.js'
import { clearPushToken } from './session.service.js'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const CHUNK_SIZE = 100
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/

export type PushMessage = {
  title: string
  body: string
  data?: Record<string, unknown>
  channelId?: string
  sound?: 'default' | null
}

type ExpoTicket = {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

export function isExpoPushToken(token: string): boolean {
  return EXPO_TOKEN.test(token)
}

async function sendChunk(tokens: string[], message: PushMessage): Promise<void> {
  const payload = tokens.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: message.data,
    sound: message.sound === null ? undefined : (message.sound ?? 'default'),
    priority: 'high',
    channelId: message.channelId ?? 'default',
  }))
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
    'content-type': 'application/json',
  }
  if (env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`
  const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(payload) })
  if (!res.ok) {
    logger.warn({ status: res.status }, 'Expo push request failed')
    return
  }
  const json = (await res.json()) as { data?: ExpoTicket[] }
  const tickets = json.data ?? []
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i]
    if (ticket.status === 'error') {
      const reason = ticket.details?.error ?? ticket.message ?? 'unknown'
      logger.warn({ reason }, 'Expo push ticket error')
      if (reason === 'DeviceNotRegistered' && tokens[i]) await clearPushToken(tokens[i])
    }
  }
}

export async function sendPushToTokens(tokens: string[], message: PushMessage): Promise<void> {
  const unique = [...new Set(tokens.filter(isExpoPushToken))]
  if (!unique.length) return
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    try {
      await sendChunk(unique.slice(i, i + CHUNK_SIZE), message)
    } catch (err) {
      logger.warn({ err }, 'Expo push delivery failed')
    }
  }
}

export async function sendPushToUsers(userIds: (string | Types.ObjectId)[], message: PushMessage): Promise<void> {
  const ids = [...new Set(userIds.map(String))]
  if (!ids.length) return
  const sessions = await Session.find({
    userId: { $in: ids },
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
    pushToken: { $exists: true, $ne: null },
  })
    .select('pushToken')
    .lean()
  await sendPushToTokens(
    sessions.map((s) => s.pushToken).filter((t): t is string => Boolean(t)),
    message,
  )
}

export async function sendPushToUser(userId: string | Types.ObjectId, message: PushMessage): Promise<void> {
  await sendPushToUsers([userId], message)
}
