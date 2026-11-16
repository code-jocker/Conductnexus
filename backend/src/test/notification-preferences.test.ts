import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { NotificationPreference } from '../models/communications.js'
import {
  categoryOf,
  getPreferenceMatrix,
  isChannelEnabled,
  resetPreferences,
  updatePreferences,
} from '../services/notification-preferences.service.js'
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from '../models/communications.js'
import { notifyUsers, priorityOf } from '../services/notification.service.js'

/**
 * Notification preferences (audit M5):
 *  - missing rows mean enabled (opt-out, not silently off);
 *  - updates are scoped to the caller, so one user cannot mute another;
 *  - the matrix always covers every channel x category pair.
 */

const PASSWORD = 'PrefPass2026'
let app: Express
let tokens: Record<string, string> = {}

const auth = (email: string) => ({ Authorization: `Bearer ${tokens[email]}` })

async function createUser(email: string, roleKey: string) {
  const user = await User.create({
    name: email,
    email,
    passwordHash: await hashPassword(PASSWORD),
    emailVerified: true,
    status: 'active',
  })
  const role = await Role.findOne({ key: roleKey })
  if (!role) throw new Error(`Role ${roleKey} missing`)
  await UserRole.create({ userId: user._id, roleId: role._id, assignedAt: new Date() })
  return user
}

beforeAll(async () => {
  app = createApp()
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await seedRbac()

  for (const [email, role] of [
    ['pref-teacher@test.rw', 'TEACHER'],
    ['pref-parent@test.rw', 'PARENT'],
  ] as const) {
    await createUser(email, role)
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
    expect(res.status, `login failed for ${email}`).toBe(200)
    tokens[email] = res.body.data.accessToken
  }
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('notification preferences', () => {
  it('derives the category from a notification type', () => {
    expect(categoryOf('approval.decided')).toBe('approval')
    expect(categoryOf('incident.submitted')).toBe('incident')
    expect(categoryOf('safeguarding.created')).toBe('safeguarding')
    expect(categoryOf('unknown.thing')).toBe('system')
  })

  it('defaults every channel and category to enabled with no rows', async () => {
    const user = await User.findOne({ email: 'pref-teacher@test.rw' }).lean()
    const matrix = await getPreferenceMatrix(String(user!._id))

    expect(matrix).toHaveLength(NOTIFICATION_CHANNELS.length * NOTIFICATION_CATEGORIES.length)
    expect(matrix.every((row) => row.enabled && row.defaulted)).toBe(true)
    expect(await isChannelEnabled(String(user!._id), 'push', 'approval')).toBe(true)
  })

  it('persists a mute and leaves the other channels untouched', async () => {
    const user = await User.findOne({ email: 'pref-teacher@test.rw' }).lean()
    const userId = String(user!._id)

    const matrix = await updatePreferences(userId, [{ channel: 'push', category: 'incident', enabled: false }])
    const row = matrix.find((r) => r.channel === 'push' && r.category === 'incident')
    expect(row?.enabled).toBe(false)
    expect(row?.defaulted).toBe(false)

    expect(await isChannelEnabled(userId, 'push', 'incident')).toBe(false)
    expect(await isChannelEnabled(userId, 'email', 'incident')).toBe(true)
    expect(await NotificationPreference.countDocuments({ userId: user!._id })).toBe(1)
  })

  it('rejects an unknown channel or category', async () => {
    const res = await request(app)
      .put('/api/v1/notifications/preferences')
      .set(auth('pref-teacher@test.rw'))
      .send({ updates: [{ channel: 'carrier-pigeon', category: 'incident', enabled: false }] })
    expect(res.status).toBe(422)
  })

  it('scopes updates to the caller', async () => {
    const parent = await User.findOne({ email: 'pref-parent@test.rw' }).lean()
    const teacher = await User.findOne({ email: 'pref-teacher@test.rw' }).lean()

    const res = await request(app)
      .put('/api/v1/notifications/preferences')
      .set(auth('pref-parent@test.rw'))
      .send({ updates: [{ channel: 'push', category: 'approval', enabled: false }] })
    expect(res.status).toBe(200)

    expect(await isChannelEnabled(String(parent!._id), 'push', 'approval')).toBe(false)
    expect(await isChannelEnabled(String(teacher!._id), 'push', 'approval')).toBe(true)
  })

  it('returns the matrix to defaults on reset', async () => {
    const user = await User.findOne({ email: 'pref-teacher@test.rw' }).lean()
    const userId = String(user!._id)
    await updatePreferences(userId, [{ channel: 'push', category: 'incident', enabled: false }])

    const matrix = await resetPreferences(userId)
    expect(matrix.every((row) => row.enabled && row.defaulted)).toBe(true)
    expect(await NotificationPreference.countDocuments({ userId: user!._id })).toBe(0)
  })

  it('serves the matrix over the API for the signed-in user', async () => {
    const res = await request(app).get('/api/v1/notifications/preferences').set(auth('pref-teacher@test.rw'))
    expect(res.status).toBe(200)
    expect(res.body.data.matrix).toHaveLength(NOTIFICATION_CHANNELS.length * NOTIFICATION_CATEGORIES.length)
  })
})

describe('notification priority and grouping', () => {
  it('derives priority from the notification type', () => {
    expect(priorityOf('safeguarding.created')).toBe('critical')
    expect(priorityOf('incident.submitted')).toBe('high')
    expect(priorityOf('risk.raised')).toBe('high')
    expect(priorityOf('approval.decided')).toBe('high')
    expect(priorityOf('appeal.received')).toBe('high')
    expect(priorityOf('letter.issued')).toBe('normal')
    expect(priorityOf('system.maintenance')).toBe('low')
  })

  it('stamps priority on delivery and groups the inbox by category', async () => {
    const teacher = await User.findOne({ email: 'pref-teacher@test.rw' }).lean()
    const userId = String(teacher!._id)

    await notifyUsers([userId], { type: 'safeguarding.created', title: 'Confidential', message: 'A case was opened' })
    await notifyUsers([userId], { type: 'letter.issued', title: 'Letter', message: 'A letter was issued' })

    const res = await request(app).get('/api/v1/notifications').set(auth('pref-teacher@test.rw'))
    expect(res.status).toBe(200)

    const critical = res.body.data.find((n: { type: string }) => n.type === 'safeguarding.created')
    expect(critical.priority).toBe('critical')

    const groups = res.body.meta.groups as { category: string; count: number }[]
    const safeguarding = groups.find((g) => g.category === 'safeguarding')
    const letter = groups.find((g) => g.category === 'letter')
    expect(safeguarding?.count).toBe(1)
    expect(letter?.count).toBe(1)

    // safeguarding must sort ahead of an ordinary letter.
    expect(res.body.data[0].type).toBe('safeguarding.created')
  })
})