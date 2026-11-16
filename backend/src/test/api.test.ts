import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { ensureInitialAllocation } from '../services/ledger.service.js'
import { seedRbac, seedSchoolDefaults } from '../services/seed.service.js'
import { Role, Settings, User, UserRole } from '../models/core.js'
import { AcademicYear, ClassModel, Dormitory, GuardianLink, Parent, Student, Term } from '../models/school.js'
import { Offence, Approval } from '../models/discipline.js'
import {
  LetterTemplate,
  MessageQueue,
  NotificationTemplate,
  TemplateVersion,
} from '../models/communications.js'
import {
  LETTER_TEMPLATE_LIBRARY,
  NOTIFICATION_TEMPLATE_LIBRARY,
} from '../data/templateLibrary.js'
import { queueParentMessage } from '../services/communication.service.js'

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

  it('denies an unrelated user the audit timeline of someone else\'s approval', async () => {
    const requester = await User.findOne({ email: 'teacher@test.rw' }).lean()
    const approval = await Approval.create({
      approvalNumber: 'APR-TEST-0001',
      type: 'adjustment',
      refId: studentId,
      studentId,
      title: 'Confidential conduct adjustment',
      summary: 'Restricted case detail',
      requestedBy: requester!._id,
      status: 'pending',
      requiredPermission: 'marks.adjust.approve',
    })

    const denied = await request(app)
      .get(`/api/v1/approvals/${approval._id}/timeline`)
      .set(auth('parent@test.rw'))
    expect(denied.status).toBe(403)

    const allowed = await request(app)
      .get(`/api/v1/approvals/${approval._id}/timeline`)
      .set(auth('teacher@test.rw'))
    expect(allowed.status).toBe(200)
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

describe('ledger reconciliation and bulk review', () => {
  async function createSubmittedIncident(email: string) {
    const created = await request(app)
      .post('/api/v1/incidents')
      .set(auth(email))
      .send({
        studentId,
        offenceId,
        description: 'Used a phone during evening prep without permission.',
        occurredAt: new Date().toISOString(),
        location: 'Study hall',
      })
    expect(created.status).toBe(201)
    const submitted = await request(app)
      .post(`/api/v1/incidents/${created.body.data._id}/submit`)
      .set(auth(email))
    expect(submitted.status).toBe(200)
    return String(created.body.data._id)
  }

  it('reconciles the conduct ledger without reporting issues', async () => {
    const res = await request(app)
      .get('/api/v1/discipline/ledger/reconciliation')
      .set(auth('headteacher@test.rw'))
    expect(res.status).toBe(200)
    expect(res.body.data.healthy).toBe(true)
    expect(res.body.data.studentsChecked).toBeGreaterThanOrEqual(1)
    expect(res.body.data.issues).toEqual([])
  })

  it('denies reconciliation to a role without reports.view', async () => {
    const res = await request(app)
      .get('/api/v1/discipline/ledger/reconciliation')
      .set(auth('parent@test.rw'))
    expect(res.status).toBe(403)
  })

  it('bulk-reviews incidents while still enforcing independent review', async () => {
    await createUser('deputy@test.rw', 'Test Deputy', 'DEPUTY_DISCIPLINE')
    await login('deputy@test.rw')

    const deputyIncidentIds = [await createSubmittedIncident('deputy@test.rw'), await createSubmittedIncident('deputy@test.rw')]
    const adminIncidentId = await createSubmittedIncident('admin@test.rw')

    const res = await request(app)
      .post('/api/v1/incidents/bulk-review')
      .set(auth('deputy@test.rw'))
      .send({ ids: [...deputyIncidentIds, adminIncidentId], decision: 'approve', comments: 'Batch confirmed during leadership review.' })
    expect(res.status).toBe(200)
    expect(res.body.data.reviewed).toBe(1)
    expect(res.body.data.failed).toBe(2)

    const selfReviews = res.body.data.results.filter((result: { id: string }) => deputyIncidentIds.includes(result.id))
    expect(selfReviews.every((result: { ok: boolean }) => !result.ok)).toBe(true)

    const student = await Student.findById(studentId).lean()
    expect(student?.currentBalance).toBe(36)
  })

  it('refuses bulk review without the review permission', async () => {
    const res = await request(app)
      .post('/api/v1/incidents/bulk-review')
      .set(auth('teacher@test.rw'))
      .send({ ids: [new mongoose.Types.ObjectId().toString()], decision: 'approve' })
    expect(res.status).toBe(403)
  })

  it('detects an intentionally corrupted ledger row', async () => {
    const collection = mongoose.connection.collection('disciplineledgers')
    const row = await collection.findOne({ studentId: new mongoose.Types.ObjectId(studentId) })
    expect(row).toBeTruthy()
    await collection.updateOne({ _id: row!._id }, { $set: { newBalance: 999 } })

    const res = await request(app)
      .get('/api/v1/discipline/ledger/reconciliation')
      .set(auth('headteacher@test.rw'))
    expect(res.status).toBe(200)
    expect(res.body.data.healthy).toBe(false)
    expect(res.body.data.issues.length).toBeGreaterThan(0)

    await collection.updateOne({ _id: row!._id }, { $set: { newBalance: row!.newBalance } })
  })
})

describe('native sessions, devices and revocation', () => {
  const deviceA = {
    deviceId: 'test-device-a',
    deviceName: 'Pixel 8',
    platform: 'android' as const,
    appVersion: '1.0.0',
  }
  const deviceB = {
    deviceId: 'test-device-b',
    deviceName: 'iPhone 15',
    platform: 'ios' as const,
    appVersion: '1.0.0',
  }
  let accessA = ''
  let sessionA = ''
  let accessB = ''
  let refreshB = ''
  let sessionB = ''

  async function nativeLogin(email: string, device: typeof deviceA) {
    const res = await request(app).post('/api/v1/auth/native/login').send({ email, password: PASSWORD, device })
    expect(res.status).toBe(200)
    return res.body.data as { accessToken: string; refreshToken: string; sessionId: string }
  }

  it('signs in natively without setting a refresh cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/native/login')
      .send({ email: 'admin@test.rw', password: PASSWORD, device: deviceA })
    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.refreshToken).toBeTruthy()
    expect(res.body.data.sessionId).toBeTruthy()
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined
    expect(cookies?.some((c) => c.includes('cn_refresh'))).toBeFalsy()
    accessA = res.body.data.accessToken
    sessionA = res.body.data.sessionId
  })

  it('lists the native session with device metadata', async () => {
    const res = await request(app).get('/api/v1/auth/sessions').set({ Authorization: `Bearer ${accessA}` })
    expect(res.status).toBe(200)
    const sessions = res.body.data.sessions as { id: string; current: boolean; platform: string; deviceName?: string }[]
    const current = sessions.find((s) => s.id === sessionA)
    expect(current).toBeTruthy()
    expect(current?.current).toBe(true)
    expect(current?.platform).toBe('android')
    expect(current?.deviceName).toBe('Pixel 8')
  })

  it('registers and clears a push token on the current device', async () => {
    const token = 'ExponentPushToken[test-device-a]'
    const res = await request(app)
      .post('/api/v1/auth/push-token')
      .set({ Authorization: `Bearer ${accessA}` })
      .send({ token, platform: 'android' })
    expect(res.status).toBe(200)
    const list = await request(app).get('/api/v1/auth/sessions').set({ Authorization: `Bearer ${accessA}` })
    const current = (list.body.data.sessions as { id: string; pushEnabled: boolean }[]).find((s) => s.id === sessionA)
    expect(current?.pushEnabled).toBe(true)

    const removed = await request(app)
      .delete('/api/v1/auth/push-token')
      .set({ Authorization: `Bearer ${accessA}` })
    expect(removed.status).toBe(200)
  })

  it('allows one device to sign out another device', async () => {
    const second = await nativeLogin('admin@test.rw', deviceB)
    accessB = second.accessToken
    refreshB = second.refreshToken
    sessionB = second.sessionId

    const res = await request(app)
      .delete(`/api/v1/auth/sessions/${sessionA}`)
      .set({ Authorization: `Bearer ${accessB}` })
    expect(res.status).toBe(200)

    const me = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${accessA}` })
    expect(me.status).toBe(401)
  })

  it('revokes a device from an administrator account', async () => {
    const teacher = await User.findOne({ email: 'teacher@test.rw' }).lean()
    const teacherSession = await nativeLogin('teacher@test.rw', deviceA)

    const res = await request(app)
      .delete(`/api/v1/users/${String(teacher?._id)}/sessions/${teacherSession.sessionId}`)
      .set(auth('admin@test.rw'))
    expect(res.status).toBe(200)

    const me = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${teacherSession.accessToken}` })
    expect(me.status).toBe(401)
  })

  it('rotates native refresh tokens and detects reuse', async () => {
    const res = await request(app)
      .post('/api/v1/auth/native/refresh')
      .send({ refreshToken: refreshB, device: deviceB })
    expect(res.status).toBe(200)
    const rotated = res.body.data as { accessToken: string; refreshToken: string; sessionId: string }
    expect(rotated.sessionId).not.toBe(sessionB)

    const me = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${rotated.accessToken}` })
    expect(me.status).toBe(200)

    const reuse = await request(app)
      .post('/api/v1/auth/native/refresh')
      .send({ refreshToken: refreshB, device: deviceB })
    expect(reuse.status).toBe(401)

    const revoked = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${rotated.accessToken}` })
    expect(revoked.status).toBe(401)
  })
})

describe('student CRUD, custom fields and bulk import', () => {
  let classId = ''

  beforeAll(async () => {
    const cls = await ClassModel.findOne({ name: 'S1' }).lean()
    if (!cls) throw new Error('Seed class S1 missing')
    classId = String(cls._id)
    await login('admin@test.rw')
    await login('teacher@test.rw')
  })

  it('registers a student with contact details and custom fields', async () => {
    const res = await request(app)
      .post('/api/v1/students')
      .set(auth('admin@test.rw'))
      .send({
        firstName: 'Aline',
        lastName: 'Mukamana',
        gender: 'female',
        classId,
        admissionType: 'new',
        boardingStatus: 'day',
        contact: { phone: '0788111222', email: 'aline@example.rw', address: 'Kigali' },
        customFields: [{ label: 'House', value: 'Amahoro' }],
      })
    expect(res.status).toBe(201)
    expect(res.body.data.contact.email).toBe('aline@example.rw')
    expect(res.body.data.customFields[0]).toMatchObject({ label: 'House', value: 'Amahoro' })

    const profile = await request(app).get(`/api/v1/students/${res.body.data._id}/profile`).set(auth('admin@test.rw'))
    expect(profile.status).toBe(200)
    expect(profile.body.data.student.contact.phone).toBe('0788111222')
  })

  it('rejects duplicate admission numbers with a conflict', async () => {
    const res = await request(app)
      .post('/api/v1/students')
      .set(auth('admin@test.rw'))
      .send({ firstName: 'Clone', lastName: 'Learner', gender: 'male', classId, admissionNumber: 'ADM-TEST-0001' })
    expect(res.status).toBe(409)
  })

  it('updates contact details and replaces custom fields', async () => {
    const created = await request(app)
      .post('/api/v1/students')
      .set(auth('admin@test.rw'))
      .send({ firstName: 'Eric', lastName: 'Nkurunziza', gender: 'male', classId })
    expect(created.status).toBe(201)

    const res = await request(app)
      .patch(`/api/v1/students/${created.body.data._id}`)
      .set(auth('admin@test.rw'))
      .send({
        contact: { phone: '0722333444', address: 'Huye' },
        customFields: [{ label: 'Transport', value: 'Route 4' }, { label: 'Sponsor', value: 'District' }],
      })
    expect(res.status).toBe(200)

    const profile = await request(app).get(`/api/v1/students/${created.body.data._id}/profile`).set(auth('admin@test.rw'))
    expect(profile.body.data.student.contact).toMatchObject({ phone: '0722333444', address: 'Huye' })
    expect(profile.body.data.student.customFields.map((f: { label: string }) => f.label)).toEqual(['Transport', 'Sponsor'])
  })

  it('dry-runs an import without creating records and reports duplicates', async () => {
    const before = await Student.countDocuments()
    const res = await request(app)
      .post('/api/v1/students/import')
      .set(auth('admin@test.rw'))
      .send({
        dryRun: true,
        rows: [
          { firstName: 'Import', lastName: 'First', gender: 'female', classId },
          { firstName: 'Duplicate', lastName: 'Person', gender: 'male', classId, admissionNumber: 'ADM-TEST-0001' },
          { firstName: '', lastName: 'NoFirst', gender: 'male', classId },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(3)
    expect(res.body.data.valid).toBe(1)
    expect(res.body.data.invalid).toBe(2)
    expect(res.body.data.imported).toBe(0)
    expect(await Student.countDocuments()).toBe(before)
    expect(res.body.data.results[1].duplicate.field).toBe('admissionNumber')
  })

  it('commits only valid import rows', async () => {
    const before = await Student.countDocuments()
    const res = await request(app)
      .post('/api/v1/students/import')
      .set(auth('admin@test.rw'))
      .send({
        rows: [
          { firstName: 'Import', lastName: 'Committed', gender: 'female', classId },
          { firstName: 'Duplicate', lastName: 'Person', gender: 'male', classId, admissionNumber: 'ADM-TEST-0001' },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data.imported).toBe(1)
    expect(res.body.data.failed).toBe(1)
    expect(await Student.countDocuments()).toBe(before + 1)
  })

  it('archives with a reason, then restores the student', async () => {
    const created = await request(app)
      .post('/api/v1/students')
      .set(auth('admin@test.rw'))
      .send({ firstName: 'Archive', lastName: 'Candidate', gender: 'male', classId })
    const id = created.body.data._id

    const noReason = await request(app).delete(`/api/v1/students/${id}`).set(auth('admin@test.rw'))
    expect(noReason.status).toBe(400)

    const archived = await request(app)
      .delete(`/api/v1/students/${id}?reason=${encodeURIComponent('Left the school')}`)
      .set(auth('admin@test.rw'))
    expect(archived.status).toBe(200)
    expect(archived.body.data.status).toBe('archived')
    expect(archived.body.data.undo?.length).toBeGreaterThan(0)

    const hidden = await request(app).get('/api/v1/students').set(auth('admin@test.rw')).query({ q: 'Archive Candidate' })
    expect(hidden.body.data.some((s: { _id: string }) => s._id === id)).toBe(false)

    const restored = await request(app).post(`/api/v1/students/${id}/restore`).set(auth('admin@test.rw'))
    expect(restored.status).toBe(200)
    expect(restored.body.data.status).toBe('active')
  })

  it('exports only explicitly selected students', async () => {
    const list = await request(app)
      .get('/api/v1/students')
      .set(auth('admin@test.rw'))
      .query({ q: 'Aline Mukamana' })
    expect(list.status).toBe(200)
    const target = list.body.data.find((s: { fullName: string }) => s.fullName === 'Aline Mukamana')
    expect(target).toBeTruthy()

    const res = await request(app)
      .get('/api/v1/students/export')
      .set(auth('admin@test.rw'))
      .query({ ids: String(target._id) })
    expect(res.status).toBe(200)
    expect(res.text).toContain('Aline Mukamana')
    expect(res.text.split('\n').filter((line) => line.trim()).length).toBe(2)
  })

  it('denies student import to teachers without the permission', async () => {
    const res = await request(app)
      .post('/api/v1/students/import')
      .set(auth('teacher@test.rw'))
      .send({ rows: [{ firstName: 'Blocked', lastName: 'Row', gender: 'male', classId }] })
    expect(res.status).toBe(403)
  })
})

describe('bulk deduct and reward (ledger-critical)', () => {
  const bulkStudents: string[] = []
  let offenceId = ''

  beforeAll(async () => {
    const cls = await ClassModel.findOne({ name: 'S1' }).lean()
    if (!cls) throw new Error('Seed class S1 missing')
    const bulkClass = String(cls._id)
    for (const [first, last] of [
      ['Bulk', 'One'],
      ['Bulk', 'Two'],
      ['Bulk', 'Three'],
    ]) {
      const s = await request(app)
        .post('/api/v1/students')
        .set(auth('admin@test.rw'))
        .send({ firstName: first, lastName: last, gender: 'male', classId: bulkClass })
      bulkStudents.push(s.body.data._id)
    }
    const off = await request(app)
      .post('/api/v1/offences')
      .set(auth('admin@test.rw'))
      .send({ code: 'BULK-T', name: 'Bulk Test Offence', category: 'Test', deduction: 5, severity: 'minor' })
    offenceId = off.body.data._id
  })

  it('previews a bulk deduction without posting anything', async () => {
    const res = await request(app)
      .post('/api/v1/discipline/bulk/preview')
      .set(auth('deputy@test.rw'))
      .send({ type: 'deduction', scope: 'selection', studentIds: bulkStudents, offenceId, reason: 'Bulk preview test' })
    expect(res.status).toBe(200)
    expect(res.body.data.count).toBe(3)
    expect(res.body.data.applicable).toBe(3)
    expect(res.body.data.lines.every((line: { projectedBalance: number }) => line.projectedBalance === 35)).toBe(true)
  })

  it('applies a deduction per student with audited ledger entries', async () => {
    const res = await request(app)
      .post('/api/v1/discipline/bulk/apply')
      .set(auth('deputy@test.rw'))
      .set('Idempotency-Key', 'bulk-deduct-1')
      .send({ type: 'deduction', scope: 'selection', studentIds: bulkStudents, offenceId, reason: 'Bulk deduction test' })
    expect(res.status).toBe(201)
    expect(res.body.data.applied).toBe(3)
    expect(res.body.data.failed).toBe(0)
    for (const id of bulkStudents) {
      const ledger = await request(app)
        .get('/api/v1/discipline/ledger')
        .set(auth('deputy@test.rw'))
        .query({ studentId: id })
      const deductions = ledger.body.data.transactions.filter((t: { type: string }) => t.type === 'deduction')
      expect(deductions.length).toBe(1)
      expect(deductions[0].change).toBe(-5)
    }
  })

  it('replays a duplicate bulk apply with the same idempotency key without changing balances', async () => {
    const res = await request(app)
      .post('/api/v1/discipline/bulk/apply')
      .set(auth('deputy@test.rw'))
      .set('Idempotency-Key', 'bulk-deduct-1')
      .send({ type: 'deduction', scope: 'selection', studentIds: bulkStudents, offenceId, reason: 'Bulk deduction test' })
    expect(res.status).toBe(201)
    expect(res.headers['idempotent-replay']).toBe('true')
    for (const id of bulkStudents) {
      const ledger = await request(app)
        .get('/api/v1/discipline/ledger')
        .set(auth('deputy@test.rw'))
        .query({ studentId: id })
      const deductions = ledger.body.data.transactions.filter((t: { type: string }) => t.type === 'deduction')
      expect(deductions.length).toBe(1)
    }
  })

  it('applies a reward per student', async () => {
    const res = await request(app)
      .post('/api/v1/discipline/bulk/apply')
      .set(auth('deputy@test.rw'))
      .send({ type: 'reward', scope: 'selection', studentIds: bulkStudents, points: 3, reason: 'Bulk reward test' })
    expect(res.status).toBe(201)
    expect(res.body.data.applied).toBe(3)
    for (const id of bulkStudents) {
      const ledger = await request(app)
        .get('/api/v1/discipline/ledger')
        .set(auth('deputy@test.rw'))
        .query({ studentId: id })
      const rewards = ledger.body.data.transactions.filter((t: { type: string }) => t.type === 'reward')
      expect(rewards.length).toBe(1)
      expect(rewards[0].change).toBe(3)
    }
  })

  it('applies a dormitory-wide reward and records exclusions with reasons', async () => {
    const dorm = await Dormitory.create({ code: 'BD1', name: 'Bulk Dorm', gender: 'male', capacity: 50 })
    await Student.updateMany({ _id: { $in: bulkStudents } }, { dormitoryId: dorm._id })

    const preview = await request(app)
      .post('/api/v1/discipline/bulk/preview')
      .set(auth('deputy@test.rw'))
      .send({
        type: 'reward',
        scope: 'dormitory',
        dormitoryId: String(dorm._id),
        points: 2,
        reason: 'Dorm preview',
        excludeStudentIds: [bulkStudents[2]],
        exclusionReason: 'Already recognised separately',
      })
    expect(preview.status).toBe(200)
    expect(preview.body.data.count).toBe(3)
    expect(preview.body.data.applicable).toBe(2)
    const excluded = preview.body.data.lines.find((l: { studentId: string }) => l.studentId === bulkStudents[2])
    expect(excluded.skipped).toBe(true)
    expect(excluded.skipReason).toBe('Already recognised separately')

    const res = await request(app)
      .post('/api/v1/discipline/bulk/apply')
      .set(auth('deputy@test.rw'))
      .send({
        type: 'reward',
        scope: 'dormitory',
        dormitoryId: String(dorm._id),
        points: 2,
        reason: 'Dorm reward',
        excludeStudentIds: [bulkStudents[2]],
        exclusionReason: 'Already recognised separately',
      })
    expect(res.status).toBe(201)
    expect(res.body.data.applied).toBe(2)
    expect(res.body.data.skipped).toBe(1)
    expect(res.body.data.exclusions.length).toBe(1)
    expect(res.body.data.exclusions[0].reason).toBe('Already recognised separately')
  })

  it('keeps the ledger reconcilable after bulk operations', async () => {
    const recon = await request(app)
      .get('/api/v1/discipline/ledger/reconciliation')
      .set(auth('admin@test.rw'))
    expect(recon.status).toBe(200)
    expect(recon.body.data.healthy).toBe(true)
  })

  it('denies bulk deduction to a teacher without approval authority', async () => {
    const res = await request(app)
      .post('/api/v1/discipline/bulk/apply')
      .set(auth('teacher@test.rw'))
      .send({ type: 'deduction', scope: 'selection', studentIds: bulkStudents, offenceId, reason: 'Should be denied' })
    expect(res.status).toBe(403)
  })

  it('restricts school-wide bulk operations to school leadership', async () => {
    // A deputy holds approval authority but must not reach every student at once.
    const denied = await request(app)
      .post('/api/v1/discipline/bulk/preview')
      .set(auth('deputy@test.rw'))
      .send({ type: 'reward', scope: 'school', points: 1, reason: 'Whole school reward' })
    expect(denied.status).toBe(403)

    const allowed = await request(app)
      .post('/api/v1/discipline/bulk/preview')
      .set(auth('headteacher@test.rw'))
      .send({ type: 'reward', scope: 'school', points: 1, reason: 'Whole school reward' })
    expect(allowed.status).toBe(200)
    expect(allowed.body.data.count).toBeGreaterThanOrEqual(1)
  })
})

describe('email two-factor authentication', () => {
  const email = 'twofactor@test.rw'
  let ipCounter = 0
  // Distinct source addresses keep each request in its own rate-limit bucket so
  // the shared auth limiter never turns a correct assertion into a 429.
  function freshIp() {
    ipCounter += 1
    return { 'X-Forwarded-For': `10.10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` }
  }

  async function loginExpectChallenge(): Promise<{ challenge: string; devCode?: string }> {
    const res = await request(app).post('/api/v1/auth/login').set(freshIp()).send({ email, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.data.twoFactorRequired).toBe(true)
    expect(res.body.data.challenge).toBeTruthy()
    expect(res.body.data.devCode).toMatch(/^\d{6}$/)
    return { challenge: res.body.data.challenge, devCode: res.body.data.devCode }
  }

  function other(code: string) {
    return String((Number(code) + 1) % 1_000_000).padStart(6, '0')
  }

  it('enables two-factor authentication with an emailed code', async () => {
    await createUser(email, 'Two Factor Teacher', 'TEACHER')
    const before = await request(app).post('/api/v1/auth/login').set(freshIp()).send({ email, password: PASSWORD })
    expect(before.status).toBe(200)
    expect(before.body.data.accessToken).toBeTruthy()
    expect(before.body.data.twoFactorRequired).toBeFalsy()
    tokens[email] = before.body.data.accessToken

    const enroll = await request(app).post('/api/v1/auth/2fa/enroll').set({ ...freshIp(), ...auth(email) }).send({ password: PASSWORD })
    expect(enroll.status).toBe(200)
    expect(enroll.body.data.devCode).toMatch(/^\d{6}$/)

    const wrong = await request(app)
      .post('/api/v1/auth/2fa/enroll/confirm')
      .set({ ...freshIp(), ...auth(email) })
      .send({ code: other(enroll.body.data.devCode) })
    expect(wrong.status).toBe(401)

    const confirm = await request(app)
      .post('/api/v1/auth/2fa/enroll/confirm')
      .set({ ...freshIp(), ...auth(email) })
      .send({ code: enroll.body.data.devCode })
    expect(confirm.status).toBe(200)

    const status = await request(app).get('/api/v1/auth/2fa/status').set({ ...freshIp(), ...auth(email) })
    expect(status.status).toBe(200)
    expect(status.body.data.enabled).toBe(true)
  })

  it('rejects an incorrect verification code at login', async () => {
    const { challenge, devCode } = await loginExpectChallenge()
    const denied = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .set(freshIp())
      .send({ challenge, code: other(devCode!) })
    expect(denied.status).toBe(401)
  })

  it('issues tokens only after a correct verification code', async () => {
    const { challenge, devCode } = await loginExpectChallenge()
    const verified = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .set(freshIp())
      .send({ challenge, code: devCode })
    expect(verified.status).toBe(200)
    expect(verified.body.data.accessToken).toBeTruthy()

    const me = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${verified.body.data.accessToken}` })
    expect(me.status).toBe(200)
    expect(me.body.data.user.email).toBe(email)
  })

  it('locks a challenge after too many incorrect codes', async () => {
    const ip = freshIp()
    const { challenge, devCode } = await loginExpectChallenge()
    const bad = other(devCode!)
    for (let i = 0; i < 5; i++) {
      const attempt = await request(app).post('/api/v1/auth/2fa/verify').set(ip).send({ challenge, code: bad })
      expect(attempt.status).toBe(401)
    }
    // Attempts are exhausted, so even the correct code is now rejected.
    const blocked = await request(app).post('/api/v1/auth/2fa/verify').set(ip).send({ challenge, code: devCode })
    expect(blocked.status).toBeGreaterThanOrEqual(400)
  })
})

describe('parent messaging, Kinyarwanda templates and portal link', () => {
  it('renders the Kinyarwanda variant and appends the parent-portal link', async () => {
    await Settings.findOneAndUpdate(
      { key: 'system' },
      { $set: { 'comms.whatsappEnabled': true, 'academic.language': 'rw' } },
    )

    const parent = await Parent.create({ name: 'Rwanda Parent', phone: '0788000000', whatsappConsent: true })
    const student = await Student.findOne({ status: 'active' }).lean()
    if (!student) throw new Error('No active student available')
    await GuardianLink.create({ studentId: student._id, parentId: parent._id, relationship: 'mother', isPrimary: true })

    const result = await queueParentMessage({ studentId: String(student._id), templateKey: 'incident_deduction' })
    expect(result.queued).toBeGreaterThan(0)

    const message = await MessageQueue.findOne({ parentId: parent._id }).sort({ createdAt: -1 }).lean()
    expect(message).toBeTruthy()
    expect(message!.body).toContain('Mubyeyi/Murera')
    expect(message!.body).toContain('Parent portal:')

    await Settings.findOneAndUpdate(
      { key: 'system' },
      { $set: { 'comms.whatsappEnabled': false, 'academic.language': 'en' } },
    )
  })
})

describe('bilingual template library', () => {
  it('ships 30 template types as 60 language versions', async () => {
    // 21 notification types Ã— 2 languages, plus 9 official letter types Ã— 2.
    expect(NOTIFICATION_TEMPLATE_LIBRARY.length).toBe(21)
    expect(LETTER_TEMPLATE_LIBRARY.length).toBe(9)
    expect(NOTIFICATION_TEMPLATE_LIBRARY.length + LETTER_TEMPLATE_LIBRARY.length).toBe(30)

    const notificationRows = await NotificationTemplate.countDocuments()
    expect(notificationRows).toBe(42)
    const letterRows = await LetterTemplate.countDocuments()
    expect(letterRows).toBe(9)
  })

  it('stores a Kinyarwanda version for every notification template', async () => {
    const rows = await NotificationTemplate.find({}, { key: 1, language: 1 }).lean()
    const byLanguage = new Map<string, Set<string>>()
    for (const row of rows) {
      if (!byLanguage.has(row.language)) byLanguage.set(row.language, new Set())
      byLanguage.get(row.language)!.add(row.key)
    }

    for (const tpl of NOTIFICATION_TEMPLATE_LIBRARY) {
      expect(byLanguage.get('en')?.has(tpl.key), `missing English row for ${tpl.key}`).toBe(true)
      expect(byLanguage.get('rw')?.has(`${tpl.key}_rw`), `missing Kinyarwanda row for ${tpl.key}`).toBe(true)
    }
  })

  it('gives every letter template both languages', async () => {
    const rows = await LetterTemplate.find().lean()
    for (const row of rows) {
      expect(row.bodyRw, `${row.type} is missing a Kinyarwanda body`).toBeTruthy()
      expect(row.subjectRw, `${row.type} is missing a Kinyarwanda subject`).toBeTruthy()
      expect(row.originalBodyRw, `${row.type} is missing a stored Kinyarwanda default`).toBeTruthy()
    }
  })

  it('classifies every template into a known category', async () => {
    const notificationCategories = await NotificationTemplate.distinct('category')
    const letterCategories = await LetterTemplate.distinct('category')
    const allowed = new Set([
      'conduct_notifications', 'incident_notifications', 'parent_engagement', 'student_improvement',
      'risk_and_support', 'investigation', 'appeals_and_decisions', 'official_letters', 'general_communications',
    ])
    for (const category of [...notificationCategories, ...letterCategories]) {
      expect(allowed.has(String(category)), `unknown category ${category}`).toBe(true)
    }
  })

  it('never ships an English word inside the Kinyarwanda letter body', async () => {
    // Placeholders are the only legitimate ASCII-heavy tokens; the prose around
    // them must be Kinyarwanda.
    const rwBody = (await LetterTemplate.findOne({ type: 'suspension' }).lean())?.bodyRw ?? ''
    expect(rwBody).toContain('Mubyeyi/Murera')
    expect(rwBody).not.toContain('Dear Parent/Guardian')
    expect(rwBody).toContain('{{studentName}}')
  })
})

describe('placeholder safety and template administration', () => {
  async function consentingParent(name: string, phone: string) {
    const parent = await Parent.create({ name, phone, whatsappConsent: true })
    const student = await Student.findOne({ status: 'active' }).lean()
    if (!student) throw new Error('No active student available')
    await GuardianLink.create({ studentId: student._id, parentId: parent._id, relationship: 'mother', isPrimary: true })
    return { parent, student }
  }

  async function withWhatsapp<T>(fn: () => Promise<T>): Promise<T> {
    await Settings.findOneAndUpdate(
      { key: 'system' },
      { $set: { 'comms.whatsappEnabled': true, 'academic.language': 'rw' } },
    )
    try {
      return await fn()
    } finally {
      await Settings.findOneAndUpdate(
        { key: 'system' },
        { $set: { 'comms.whatsappEnabled': false, 'academic.language': 'en' } },
      )
    }
  }

  it('refuses to queue a message that still contains an unresolved placeholder', async () => {
    const { parent, student } = await consentingParent('Placeholder Parent', '0788111222')

    await withWhatsapp(async () => {
      // positive_behaviour_recognition needs {{achievement}} and {{date}}, which
      // queueParentMessage cannot supply.
      await expect(
        queueParentMessage({ studentId: String(student._id), templateKey: 'positive_behaviour_recognition' }),
      ).rejects.toThrow(/unresolved placeholders/i)
    })

    const queued = await MessageQueue.countDocuments({ parentId: parent._id })
    expect(queued).toBe(0)

    await MessageQueue.deleteMany({ parentId: parent._id })
    await GuardianLink.deleteMany({ parentId: parent._id })
    await Parent.deleteOne({ _id: parent._id })
  })

  it('previews a template and reports placeholders it cannot fill', async () => {
    const preview = await request(app)
      .post('/api/v1/notifications/templates/preview')
      .set(auth('admin@test.rw'))
      .send({ key: 'incident_deduction', language: 'rw' })
    expect(preview.status).toBe(200)
    expect(preview.body.data.valid).toBe(true)
    expect(preview.body.data.missing).toEqual([])
    expect(preview.body.data.body).toContain('Mubyeyi/Murera')

    const partial = await request(app)
      .post('/api/v1/notifications/templates/preview')
      .set(auth('admin@test.rw'))
      .send({ key: 'positive_behaviour_recognition', language: 'rw', values: { achievement: 'Perfect attendance' } })
    expect(partial.status).toBe(200)
    // Illustrative samples fill every placeholder, so nothing is "missing" —
    // but the administrator can still see which values need real data.
    expect(partial.body.data.missing).toEqual([])
    expect(partial.body.data.unsupplied).toContain('date')
    expect(partial.body.data.unsupplied).toContain('studentName')
    expect(partial.body.data.unsupplied).not.toContain('achievement')
  })

  it('flags a placeholder that no sample can fill', async () => {
    const created = await request(app)
      .post('/api/v1/notifications/templates')
      .set(auth('admin@test.rw'))
      .send({
        key: 'probe_custom_template',
        name: 'Probe custom template',
        channel: 'whatsapp',
        body: 'Hello {{studentName}}, your reference is {{totallyUnknownPlaceholder}}.',
      })
    expect(created.status).toBe(201)

    const preview = await request(app)
      .post('/api/v1/notifications/templates/preview')
      .set(auth('admin@test.rw'))
      .send({ key: 'probe_custom_template', language: 'en' })
    expect(preview.status).toBe(200)
    expect(preview.body.data.missing).toContain('totallyUnknownPlaceholder')
    expect(preview.body.data.valid).toBe(false)
  })

  it('restores a template to its library default and keeps a version history', async () => {
    const template = await NotificationTemplate.findOne({ key: 'incident_deduction_rw' }).lean()
    if (!template) throw new Error('incident_deduction_rw not seeded')

    const edited = await request(app)
      .patch(`/api/v1/notifications/templates/${template._id}`)
      .set(auth('admin@test.rw'))
      .send({ body: 'Edited body that must be restorable.' })
    expect(edited.status).toBe(200)
    expect(edited.body.data.body).toBe('Edited body that must be restorable.')
    expect(edited.body.data.version).toBe(2)

    const versions = await request(app)
      .get(`/api/v1/notifications/templates/${template._id}/versions`)
      .set(auth('admin@test.rw'))
    expect(versions.status).toBe(200)
    expect(versions.body.data.length).toBeGreaterThanOrEqual(1)
    expect(versions.body.data[0].summary).toContain('Updated body')

    const restored = await request(app)
      .post(`/api/v1/notifications/templates/${template._id}/restore`)
      .set(auth('admin@test.rw'))
    expect(restored.status).toBe(200)
    expect(restored.body.data.body).toBe(template.originalBody)

    await expect(
      TemplateVersion.countDocuments({ templateType: 'notification', templateId: template._id }),
    ).resolves.toBeGreaterThanOrEqual(2)
  })

  it('records every template modification in the audit trail', async () => {
    const template = await NotificationTemplate.findOne({ key: 'general_communication_rw' }).lean()
    if (!template) throw new Error('general_communication_rw not seeded')

    const res = await request(app)
      .patch(`/api/v1/notifications/templates/${template._id}`)
      .set(auth('admin@test.rw'))
      .send({ name: 'General school communication (edited)' })
    expect(res.status).toBe(200)

    const audit = await mongoose.connection.db
      .collection('auditlogs')
      .findOne({ action: 'notification_template.updated', resourceId: String(template._id) })
    expect(audit).toBeTruthy()
  })

  it('blocks template management without the templates.manage permission', async () => {
    const template = await NotificationTemplate.findOne({ key: 'incident_deduction', language: 'en' }).lean()
    const res = await request(app)
      .patch(`/api/v1/notifications/templates/${template!._id}`)
      .set(auth('teacher@test.rw'))
      .send({ body: 'A teacher must not be able to edit official templates.' })
    expect(res.status).toBe(403)
  })

  it('duplicates a template as an inactive copy', async () => {
    const source = await NotificationTemplate.findOne({ key: 'meeting_invitation', language: 'en' }).lean()
    const res = await request(app)
      .post(`/api/v1/notifications/templates/${source!._id}/duplicate`)
      .set(auth('admin@test.rw'))
      .send({ key: 'meeting_invitation_copy', name: 'Meeting invitation (copy)' })
    expect(res.status).toBe(201)
    expect(res.body.data.active).toBe(false)
    expect(res.body.data.key).toBe('meeting_invitation_copy')
  })
})

