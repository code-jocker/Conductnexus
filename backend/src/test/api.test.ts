import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { ensureInitialAllocation } from '../services/ledger.service.js'
import { seedRbac, seedSchoolDefaults } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { AcademicYear, ClassModel, Student, Term } from '../models/school.js'
import { Offence } from '../models/discipline.js'

const PASSWORD = 'TestPass2026'
let app: Express
let studentId = ''
let offenceId = ''
const tokens: Record<string, string> = {}

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

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
  expect(res.status).toBe(200)
  tokens[email] = res.body.data.accessToken
}

function auth(email: string) {
  return { Authorization: `Bearer ${tokens[email]}` }
}

beforeAll(async () => {
  app = createApp()
  await connectDatabase()
  await mongoose.connection.dropDatabase()

  await seedRbac()
  await seedSchoolDefaults()

  const admin = await createUser('admin@test.rw', 'Test Administrator', 'ADMIN')
  await createUser('headteacher@test.rw', 'Test Headteacher', 'HEADTEACHER')
  await createUser('teacher@test.rw', 'Test Teacher', 'TEACHER')
  await createUser('parent@test.rw', 'Test Parent', 'PARENT')

  const [year, term, cls, offence] = await Promise.all([
    AcademicYear.findOne({ isActive: true }).lean(),
    Term.findOne({ isActive: true }).lean(),
    ClassModel.findOne({ name: 'S1' }).lean(),
    Offence.findOne({ code: 'LATE' }).lean(),
  ])
  if (!year || !term || !cls || !offence) throw new Error('School defaults were not seeded')

  const student = await Student.create({
    studentId: 'STD-TEST-0001',
    admissionNumber: 'ADM-TEST-0001',
    firstName: 'Test',
    lastName: 'Learner',
    fullName: 'Test Learner',
    gender: 'female',
    classId: cls._id,
    academicYearId: year._id,
    termId: term._id,
    currentTermId: term._id,
    currentBalance: 0,
    balanceVersion: 0,
    status: 'active',
    createdBy: admin._id,
  })
  await ensureInitialAllocation(student, term)
  studentId = String(student._id)
  offenceId = String(offence._id)

  await Promise.all([
    login('admin@test.rw'),
    login('headteacher@test.rw'),
    login('teacher@test.rw'),
    login('parent@test.rw'),
  ])
})

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
})

describe('service health', () => {
  it('reports a healthy API without authentication', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ok')
  })

  it('serves the OpenAPI document', async () => {
    const res = await request(app).get('/api/docs.json')
    expect(res.status).toBe(200)
    expect(res.body.openapi).toMatch(/^3\./)
  })
})

describe('authentication', () => {
  it('rejects a wrong password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@test.rw', password: 'wrong-password' })
    expect(res.status).toBe(401)
  })

  it('returns the signed-in user with roles, permissions and setup state', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(auth('teacher@test.rw'))
    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe('teacher@test.rw')
    expect(res.body.data.roles).toContain('TEACHER')
    expect(res.body.data.permissions).toContain('incidents.create')
    expect(res.body.data.setup).toBeTruthy()
  })

  it('blocks unauthenticated access to protected routes', async () => {
    const res = await request(app).get('/api/v1/users')
    expect(res.status).toBe(401)
  })
})

describe('role-based access control', () => {
  it('denies a parent access to the staff directory', async () => {
    const res = await request(app).get('/api/v1/users').set(auth('parent@test.rw'))
    expect(res.status).toBe(403)
  })

  it('denies a teacher access to system settings changes', async () => {
    const res = await request(app).patch('/api/v1/settings').set(auth('teacher@test.rw')).send({ school: { name: 'Hijacked' } })
    expect(res.status).toBe(403)
  })
})

describe('incident workflow and conduct ledger', () => {
  let incidentId = ''

  it('records an incident as a draft without deducting marks', async () => {
    const res = await request(app)
      .post('/api/v1/incidents')
      .set(auth('admin@test.rw'))
      .send({
        studentId,
        offenceId,
        description: 'Arrived late to the first lesson without an excuse.',
        occurredAt: new Date().toISOString(),
        location: 'Classroom 4',
      })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('draft')
    incidentId = String(res.body.data._id)

    const student = await Student.findById(studentId).lean()
    expect(student?.currentBalance).toBe(40)
  })

  it('submits the incident for independent review', async () => {
    const res = await request(app).post(`/api/v1/incidents/${incidentId}/submit`).set(auth('admin@test.rw'))
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('under_review')
  })

  it('refuses to let the reporter review their own incident', async () => {
    const res = await request(app)
      .post(`/api/v1/incidents/${incidentId}/review`)
      .set(auth('admin@test.rw'))
      .send({ decision: 'approve', comments: 'Self approval attempt' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('refuses a teacher without the review permission', async () => {
    const res = await request(app)
      .post(`/api/v1/incidents/${incidentId}/review`)
      .set(auth('teacher@test.rw'))
      .send({ decision: 'approve' })
    expect(res.status).toBe(403)
  })

  it('posts the deduction only after an independent headteacher approval', async () => {
    const res = await request(app)
      .post(`/api/v1/incidents/${incidentId}/review`)
      .set(auth('headteacher@test.rw'))
      .send({ decision: 'approve', comments: 'Confirmed with the class teacher.' })
    expect(res.status).toBe(200)

    const student = await Student.findById(studentId).lean()
    expect(student?.currentBalance).toBe(38)

    const ledgerRes = await request(app).get(`/api/v1/students/${studentId}/ledger`).set(auth('headteacher@test.rw'))
    expect(ledgerRes.status).toBe(200)
    const entries: { type: string; change: number; newBalance: number }[] = ledgerRes.body.data.transactions
    const deduction = entries.find((e) => e.type === 'deduction')
    expect(deduction).toBeTruthy()
    expect(deduction?.change).toBe(-2)
    expect(deduction?.newBalance).toBe(38)
  })
})
