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
import {
  deliveryAnalytics,
  deliveryBlockReason,
  processMessageQueue,
  recordWhatsappReceipt,
  retryDeadLetters,
} from '../services/communication.service.js'

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

  it('does not let an unavailable WhatsApp session freeze email delivery', async () => {
    const row = await MessageQueue.create({
      channel: 'email',
      to: 'guardian@example.rw',
      subject: 'Conduct update',
      body: 'Test body',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date(Date.now() - 60_000),
    })

    const result = await processMessageQueue()
    expect(result.processed).toBe(1)

    const after = await MessageQueue.findById(row._id).lean()
    // SMTP is unconfigured here, so the honest outcome is a recorded failure —
    // never a "sent" status and never a permanently stuck "sending" row.
    expect(after?.status).toBe('dead_letter')
    expect(after?.attempts).toBe(1)
    expect(after?.lastError).toBeTruthy()
  })

  it('records WhatsApp delivery receipts against the queued row', async () => {
    const row = await MessageQueue.create({
      channel: 'whatsapp',
      to: '250793946732',
      body: 'Test body',
      status: 'sent',
      providerMessageId: 'wamid.TEST-RECEIPT',
      provider: 'whatsapp',
      attempts: 1,
      maxAttempts: 3,
      nextAttemptAt: new Date(),
    })

    await recordWhatsappReceipt('wamid.TEST-RECEIPT', 3)
    const delivered = await MessageQueue.findById(row._id).lean()
    expect(delivered?.ackStatus).toBe('delivered')
    expect(delivered?.deliveredAt).toBeInstanceOf(Date)
    expect(delivered?.receipts).toHaveLength(1)

    await recordWhatsappReceipt('wamid.TEST-RECEIPT', 4)
    const read = await MessageQueue.findById(row._id).lean()
    expect(read?.ackStatus).toBe('read')
    expect(read?.readAt).toBeInstanceOf(Date)
    expect(read?.receipts).toHaveLength(2)
  })

  it('reports delivery analytics per channel from real rows', async () => {
    await MessageQueue.create([
      { channel: 'whatsapp', to: '250793946732', body: 'a', status: 'sent', attempts: 1, maxAttempts: 3, nextAttemptAt: new Date() },
      { channel: 'email', to: 'guardian@example.rw', body: 'b', status: 'dead_letter', attempts: 3, maxAttempts: 3, nextAttemptAt: new Date(), lastError: 'SMTP unavailable' },
      { channel: 'sms', to: '250788000000', body: 'c', status: 'queued', attempts: 0, maxAttempts: 3, nextAttemptAt: new Date() },
    ])

    const analytics = await deliveryAnalytics(7)
    expect(analytics.totals.sent).toBe(1)
    expect(analytics.totals.dead_letter).toBe(1)
    expect(analytics.byChannel.whatsapp.sent).toBe(1)
    expect(analytics.byChannel.email.dead_letter).toBe(1)
    expect(analytics.pendingNow).toBe(1)
    expect(analytics.topFailureReasons[0]).toEqual({ reason: 'SMTP unavailable', count: 1 })
  })

  it('requeues dead letters in bulk', async () => {
    const row = await MessageQueue.create({
      channel: 'whatsapp',
      to: '250793946732',
      body: 'Retry me',
      status: 'dead_letter',
      attempts: 3,
      maxAttempts: 3,
      nextAttemptAt: new Date(),
      lastError: 'WhatsApp is not connected',
    })

    const result = await retryDeadLetters()
    expect(result.retried).toBe(1)
    expect(result.byChannel.whatsapp).toBe(1)

    const after = await MessageQueue.findById(row._id).lean()
    expect(after?.status).toBe('queued')
    expect(after?.attempts).toBe(0)
  })
})
