import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { MessageQueue } from '../models/communications.js'
import { deliveryBlockReason, processMessageQueue } from '../services/communication.service.js'

/**
 * Message queue delivery state.
 *
 * When the WhatsApp channel is unavailable the queue must park messages intact
 * and say why. Burning delivery attempts against a session that cannot send is
 * what turned "waiting for the phone" into a silently stuck message reported as
 * "Queued 0/3".
 */

const PASSWORD = 'QueuePass2026'
let app: Express
let token = ''

beforeAll(async () => {
  app = createApp()
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await seedRbac()

  const user = await User.create({
    name: 'Queue Admin',
    email: 'queue-admin@test.rw',
    passwordHash: await hashPassword(PASSWORD),
    emailVerified: true,
    status: 'active',
  })
  const role = await Role.findOne({ key: 'ADMIN' })
  if (!role) throw new Error('ADMIN role missing')
  await UserRole.create({ userId: user._id, roleId: role._id, assignedAt: new Date() })

  const res = await request(app).post('/api/v1/auth/login').send({ email: 'queue-admin@test.rw', password: PASSWORD })
  expect(res.status, 'login failed').toBe(200)
  token = res.body.data.accessToken
})

afterEach(async () => {
  await MessageQueue.deleteMany({})
})

afterAll(async () => {
  await MessageQueue.deleteMany({})
  await disconnectDatabase()
})

const auth = () => ({ Authorization: `Bearer ${token}` })

describe('message queue delivery state', () => {
  it('reports the channel as unavailable in a test environment', () => {
    const delivery = deliveryBlockReason()
    expect(delivery.enabled).toBe(false)
    expect(delivery.ready).toBe(false)
    expect(delivery.reason).toContain('ENABLE_WHATSAPP')
  })

  it('parks a queued message without burning attempts while the channel is down', async () => {
    const queued = await MessageQueue.create({
      channel: 'whatsapp',
      to: '250793946732',
      body: 'Test body',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date(Date.now() - 60_000),
    })

    const result = await processMessageQueue()

    expect(result.sent).toBe(0)
    const row = await MessageQueue.findById(queued._id).lean()
    expect(row?.status).toBe('queued')
    expect(row?.attempts).toBe(0)
    expect(row?.lastError).toBeUndefined()
  })

  it('exposes the delivery state on the queue endpoint', async () => {
    await MessageQueue.create({
      channel: 'whatsapp',
      to: '250793946732',
      body: 'Test body',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date(),
    })

    const res = await request(app).get('/api/v1/notifications/queue').set(auth())
    expect(res.status).toBe(200)
    const delivery = res.body.meta.delivery as { ready: boolean; reason: string | null }
    expect(delivery.ready).toBe(false)
    expect(delivery.reason).toBeTruthy()
  })

  it('requires notifications.manage to read the queue', async () => {
    const res = await request(app).get('/api/v1/notifications/queue')
    expect(res.status).toBe(401)
  })
})
