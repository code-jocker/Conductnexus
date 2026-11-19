import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac, seedSchoolDefaults } from '../services/seed.service.js'
import { AccessRequest, MailMessage, Role, User, UserRole } from '../models/core.js'

const PASSWORD = 'TestPass2026'
let app: Express
let adminToken = ''
let teacherToken = ''

async function createUser(email: string, name: string, roleKey: string) {
  const user = await User.create({
    name,
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

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
  expect(res.status).toBe(200)
  return res.body.data.accessToken as string
}

function submit(body: Record<string, unknown>, ip = '10.20.0.1') {
  return request(app).post('/api/v1/auth/access-request').set('X-Forwarded-For', ip).send(body)
}

beforeAll(async () => {
  app = createApp()
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await seedRbac()
  await seedSchoolDefaults()
  await createUser('access-admin@test.rw', 'Access Administrator', 'ADMIN')
  await createUser('access-teacher@test.rw', 'Access Teacher', 'TEACHER')
  adminToken = await login('access-admin@test.rw')
  teacherToken = await login('access-teacher@test.rw')
})

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
})

describe('public access requests', () => {
  it('lists only the roles the public may request', async () => {
    const res = await request(app).get('/api/v1/auth/access-request/roles')
    expect(res.status).toBe(200)
    const keys = (res.body.data as { key: string }[]).map((role) => role.key)
    expect(keys).toContain('TEACHER')
    expect(keys).not.toContain('ADMIN')
    expect(keys).not.toContain('IT')
    expect(keys).not.toContain('PARENT')
  })

  it('accepts a request and keeps it pending', async () => {
    const res = await submit({
      name: 'Aline Uwase',
      email: 'aline@test.rw',
      phone: '+250788000111',
      requestedRole: 'TEACHER',
      reason: 'I teach Mathematics in S2.',
    })
    expect(res.status).toBe(202)
    expect(res.body.data.message).toMatch(/received/i)

    const doc = await AccessRequest.findOne({ email: 'aline@test.rw' })
    expect(doc?.status).toBe('pending')
    expect(doc?.requestedRole).toBe('TEACHER')
    expect(doc?.phone).toBe('+250788000111')

    const acknowledgement = await MailMessage.findOne({ to: 'aline@test.rw', subject: /received your ConductNexus/i })
    expect(acknowledgement).toBeTruthy()
  })

  it('updates the same pending request instead of creating a duplicate', async () => {
    const res = await submit(
      { name: 'Aline U.', email: 'aline@test.rw', phone: '+250788000222', requestedRole: 'MATRON', reason: 'Boarding duty' },
      '10.20.0.2',
    )
    expect(res.status).toBe(202)
    expect(await AccessRequest.countDocuments({ email: 'aline@test.rw' })).toBe(1)
    const doc = await AccessRequest.findOne({ email: 'aline@test.rw' })
    expect(doc?.name).toBe('Aline U.')
    expect(doc?.requestedRole).toBe('MATRON')
  })

  it('answers the same way for emails that already have accounts', async () => {
    const res = await submit(
      { name: 'Access Administrator', email: 'access-admin@test.rw', requestedRole: 'TEACHER' },
      '10.20.0.3',
    )
    expect(res.status).toBe(202)
    expect(await AccessRequest.exists({ email: 'access-admin@test.rw' })).toBeFalsy()
  })

  it('refuses administrator and IT roles from the public form', async () => {
    const res = await submit(
      { name: 'Intruder', email: 'intruder@test.rw', requestedRole: 'ADMIN' },
      '10.20.0.4',
    )
    expect(res.status).toBe(400)
  })
})

describe('access request administration', () => {
  it('requires users.view to list requests', async () => {
    const anonymous = await request(app).get('/api/v1/access-requests')
    expect(anonymous.status).toBe(401)

    const forbidden = await request(app)
      .get('/api/v1/access-requests')
      .set({ Authorization: `Bearer ${teacherToken}` })
    expect(forbidden.status).toBe(403)

    const allowed = await request(app)
      .get('/api/v1/access-requests?status=pending')
      .set({ Authorization: `Bearer ${adminToken}` })
    expect(allowed.status).toBe(200)
    expect(allowed.body.data[0].roleName).toBe('Matron')
  })

  it('approves a request, creates the account and records notifications', async () => {
    const doc = await AccessRequest.findOne({ email: 'aline@test.rw' })
    const res = await request(app)
      .post(`/api/v1/access-requests/${doc!._id}/approve`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ roleKey: 'MATRON', note: 'Welcome to boarding duty' })

    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(true)
    expect(res.body.data.user.email).toBe('aline@test.rw')
    expect(res.body.data.temporaryPassword).toBeTruthy()
    expect(res.body.data.emailDelivered).toBe(false)
    expect(res.body.data.whatsappDelivered).toBe(false)
    expect(res.body.data.whatsappError).toMatch(/disabled/i)

    const user = await User.findOne({ email: 'aline@test.rw' })
    expect(user?.status).toBe('active')
    expect(user?.mustChangePassword).toBe(true)
    expect(user?.position).toBe('Matron')

    const role = await Role.findOne({ key: 'MATRON' })
    expect(await UserRole.exists({ userId: user!._id, roleId: role!._id })).toBeTruthy()

    const updated = await AccessRequest.findById(doc!._id)
    expect(updated?.status).toBe('approved')
    expect(updated?.userId?.toString()).toBe(user!._id.toString())
    expect(updated?.decisionNote).toBe('Welcome to boarding duty')
    expect(updated?.notifications?.whatsapp).toBe(false)

    const approvalMail = await MailMessage.findOne({ to: 'aline@test.rw', subject: /access was approved/i })
    expect(approvalMail).toBeTruthy()
  })

  it('refuses to review an approved request again', async () => {
    const doc = await AccessRequest.findOne({ email: 'aline@test.rw' })
    const res = await request(app)
      .post(`/api/v1/access-requests/${doc!._id}/approve`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({})
    expect(res.status).toBe(409)
  })

  it('rejects a request with a note and notifies the requester', async () => {
    const created = await submit(
      { name: 'Bob Nkusi', email: 'bob@test.rw', requestedRole: 'LIBRARIAN', reason: 'Library support' },
      '10.20.0.5',
    )
    expect(created.status).toBe(202)
    const doc = await AccessRequest.findOne({ email: 'bob@test.rw' })

    const res = await request(app)
      .post(`/api/v1/access-requests/${doc!._id}/reject`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ note: 'Please visit the school office to confirm your details.' })
    expect(res.status).toBe(200)

    const updated = await AccessRequest.findById(doc!._id)
    expect(updated?.status).toBe('rejected')
    expect(updated?.decisionNote).toMatch(/school office/i)
    expect(await User.exists({ email: 'bob@test.rw' })).toBeFalsy()

    const rejectionMail = await MailMessage.findOne({ to: 'bob@test.rw', subject: /update on your ConductNexus/i })
    expect(rejectionMail).toBeTruthy()
  })
})
