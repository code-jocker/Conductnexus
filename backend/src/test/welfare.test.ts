import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { ClassModel, Student } from '../models/school.js'
import { DisciplineLedger } from '../models/discipline.js'
import { CounsellingRecord, DetentionSession } from '../models/welfare.js'

/**
 * Confidential welfare centre and detention (audit P3).
 *
 * The centre must be unreachable without welfare permissions, session notes
 * must be read-logged, escalation must create a restricted safeguarding case,
 * and detention must never post to the discipline ledger.
 */

const PASSWORD = 'WelfarePass2026'
let app: Express
let headToken = ''
let patronToken = ''
let teacherToken = ''
let adminToken = ''
let matronToken = ''
let classId = ''
let studentId = ''
let teacherId = ''
let patronId = ''
let appointmentId = ''
let recordId = ''
let planId = ''
let referralId = ''
let detentionId = ''

async function makeUser(email: string, name: string, roleKey: string) {
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
  let res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
  if (res.body.data.twoFactorRequired) {
    res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challenge: res.body.data.challenge, code: res.body.data.devCode })
    expect(res.status).toBe(200)
  }
  return res.body.data.accessToken as string
}

beforeAll(async () => {
  app = createApp()
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await seedRbac()

  await makeUser('welfare.head@audit.rw', 'Welfare Head', 'HEADTEACHER')
  const patron = await makeUser('welfare.patron@audit.rw', 'Welfare Patron', 'PATRON')
  const teacher = await makeUser('welfare.teacher@audit.rw', 'Welfare Teacher', 'TEACHER')
  await makeUser('welfare.matron@audit.rw', 'Welfare Matron', 'MATRON')
  await makeUser('welfare.admin@audit.rw', 'Welfare Admin', 'ADMIN')
  patronId = String(patron._id)
  teacherId = String(teacher._id)

  const cls = await ClassModel.create({ name: 'Welfare Class', level: 'O' })
  classId = String(cls._id)
  await User.updateOne({ email: 'welfare.teacher@audit.rw' }, { $set: { assignedClassIds: [cls._id] } })

  const student = await Student.create({
    studentId: 'WEL-001',
    admissionNumber: 'ADM-WEL-001',
    firstName: 'Claudine',
    lastName: 'Uwera',
    fullName: 'Claudine Uwera',
    gender: 'female',
    classId: cls._id,
    currentBalance: 40,
  })
  studentId = String(student._id)

  headToken = await login('welfare.head@audit.rw')
  patronToken = await login('welfare.patron@audit.rw')
  teacherToken = await login('welfare.teacher@audit.rw')
  matronToken = await login('welfare.matron@audit.rw')
  adminToken = await login('welfare.admin@audit.rw')
})

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
})

describe('confidential welfare centre', () => {
  it('denies the centre to staff without welfare authorization', async () => {
    const overview = await request(app).get('/api/v1/welfare/overview').set({ Authorization: `Bearer ${teacherToken}` })
    expect(overview.status).toBe(403)
    const admin = await request(app).get('/api/v1/welfare/overview').set({ Authorization: `Bearer ${adminToken}` })
    expect(admin.status).toBe(403)
  })

  it('schedules a counselling appointment and notifies the counsellor', async () => {
    const res = await request(app)
      .post('/api/v1/welfare/appointments')
      .set({ Authorization: `Bearer ${headToken}` })
      .send({
        studentId,
        counsellorId: patronId,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'Follow-up on reported anxiety during examinations',
        location: 'Welfare office',
      })
    expect(res.status).toBe(201)
    expect(res.body.data.reference).toMatch(/^CA-/)
    appointmentId = res.body.data._id

    const patronList = await request(app).get('/api/v1/welfare/appointments').set({ Authorization: `Bearer ${patronToken}` })
    expect(patronList.status).toBe(200)
    expect(patronList.body.data.some((a: { _id: string }) => a._id === appointmentId)).toBe(true)

    const matronList = await request(app).get('/api/v1/welfare/appointments').set({ Authorization: `Bearer ${matronToken}` })
    expect(matronList.status).toBe(200)
    expect(matronList.body.data.some((a: { _id: string }) => a._id === appointmentId)).toBe(false)
  })

  it('records a confidential session and logs every read', async () => {
    const complete = await request(app)
      .post(`/api/v1/welfare/appointments/${appointmentId}/complete`)
      .set({ Authorization: `Bearer ${patronToken}` })
      .send({
        presentingConcern: 'Anxiety around examinations and sleep disruption',
        sessionNotes: 'Confidential clinical notes. Student requested privacy from class teacher.',
        riskLevel: 'medium',
        outcome: 'Agreed breathing techniques; review in two weeks.',
        followUpRequired: true,
        followUpDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      })
    expect(complete.status).toBe(201)
    recordId = complete.body.data.record._id
    expect(complete.body.data.record.sessionNotes).toContain('Confidential clinical notes')
    expect(complete.body.data.followUp).toBeTruthy()

    const read = await request(app).get(`/api/v1/welfare/records/${recordId}`).set({ Authorization: `Bearer ${patronToken}` })
    expect(read.status).toBe(200)

    const accessLog = await request(app)
      .get(`/api/v1/welfare/records/${recordId}/access-log`)
      .set({ Authorization: `Bearer ${headToken}` })
    expect(accessLog.status).toBe(200)
    expect(accessLog.body.data.accessLog.length).toBeGreaterThanOrEqual(2)
    expect(accessLog.body.data.accessLog.some((entry: { action: string }) => entry.action === 'viewed')).toBe(true)

    const teacher = await request(app).get(`/api/v1/welfare/records/${recordId}`).set({ Authorization: `Bearer ${teacherToken}` })
    expect(teacher.status).toBe(403)
  })

  it('escalates a welfare record into a restricted safeguarding case', async () => {
    const res = await request(app)
      .post(`/api/v1/welfare/records/${recordId}/escalate`)
      .set({ Authorization: `Bearer ${patronToken}` })
      .send({
        category: 'protection',
        severity: 'high',
        narrative: 'Session disclosed a protection concern that requires safeguarding review.',
      })
    expect(res.status).toBe(201)
    expect(res.body.data.safeguardingCase.caseNumber).toMatch(/^SG-/)
    expect(String(res.body.data.record.escalatedCaseId)).toBe(String(res.body.data.safeguardingCase._id))

    const stored = await CounsellingRecord.findById(recordId).lean()
    expect(String(stored?.escalatedCaseId)).toBe(String(res.body.data.safeguardingCase._id))

    const teacher = await request(app)
      .get(`/api/v1/safeguarding/cases/${res.body.data.safeguardingCase._id}`)
      .set({ Authorization: `Bearer ${teacherToken}` })
    expect(teacher.status).toBe(403)
  })

  it('supports plan closure, outcome recording and reopening', async () => {
    const create = await request(app)
      .post('/api/v1/welfare/plans')
      .set({ Authorization: `Bearer ${headToken}` })
      .send({
        studentId,
        title: 'Examination wellbeing plan',
        reason: 'Sustained anxiety affecting attendance and sleep',
        category: 'wellbeing',
        assignedTo: patronId,
        goals: [{ description: 'Attend two counselling sessions', progress: 0 }],
      })
    expect(create.status).toBe(201)
    planId = create.body.data._id

    const close = await request(app)
      .post(`/api/v1/welfare/plans/${planId}/close`)
      .set({ Authorization: `Bearer ${patronToken}` })
      .send({ outcome: 'Student completed all sessions and reports improved sleep.' })
    expect(close.status).toBe(200)
    expect(close.body.data.status).toBe('completed')

    const reopen = await request(app)
      .post(`/api/v1/welfare/plans/${planId}/reopen`)
      .set({ Authorization: `Bearer ${patronToken}` })
      .send({ reason: 'New symptoms reported by the boarding matron.' })
    expect(reopen.status).toBe(200)
    expect(reopen.body.data.status).toBe('reopened')
    expect(reopen.body.data.reopenCount).toBe(1)
  })

  it('lets teachers refer a student but keeps referral oversight with welfare staff', async () => {
    const create = await request(app)
      .post('/api/v1/welfare/referrals')
      .set({ Authorization: `Bearer ${teacherToken}` })
      .send({
        studentId,
        service: 'school_nurse',
        destination: 'School health clinic',
        reason: 'Student reported persistent headaches during lessons.',
        urgency: 'medium',
        consentObtained: true,
        consentBy: 'Guardian verbal consent recorded by class teacher',
      })
    expect(create.status).toBe(201)
    referralId = create.body.data._id

    const mine = await request(app).get('/api/v1/welfare/referrals').set({ Authorization: `Bearer ${teacherToken}` })
    expect(mine.status).toBe(200)
    expect(mine.body.data.every((r: { fromStaffId: { _id: string } | string }) => (typeof r.fromStaffId === 'string' ? r.fromStaffId : r.fromStaffId._id) === teacherId)).toBe(true)

    const close = await request(app)
      .patch(`/api/v1/welfare/referrals/${referralId}`)
      .set({ Authorization: `Bearer ${headToken}` })
      .send({ status: 'closed', outcome: 'Nurse reviewed the student; no further referral required.' })
    expect(close.status).toBe(200)
    expect(close.body.data.status).toBe('closed')
  })
})

describe('detention management', () => {
  it('schedules detention without touching the conduct ledger', async () => {
    const ledgerBefore = await DisciplineLedger.countDocuments({ studentId })
    const res = await request(app)
      .post('/api/v1/detention/sessions')
      .set({ Authorization: `Bearer ${headToken}` })
      .send({
        studentId,
        reason: 'Repeated lateness discussed at the discipline panel',
        scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        location: 'Room 12',
        supervisorId: teacherId,
        notifyGuardian: false,
      })
    expect(res.status).toBe(201)
    detentionId = res.body.data.session._id
    expect(res.body.data.session.reference).toMatch(/^DT-/)

    const ledgerAfter = await DisciplineLedger.countDocuments({ studentId })
    expect(ledgerAfter).toBe(ledgerBefore)
    const student = await Student.findById(studentId).lean()
    expect(student?.currentBalance).toBe(40)
  })

  it('denies scheduling to staff without detention.manage', async () => {
    const res = await request(app)
      .post('/api/v1/detention/sessions')
      .set({ Authorization: `Bearer ${teacherToken}` })
      .send({
        studentId,
        reason: 'Attempted self-scheduling',
        scheduledAt: new Date().toISOString(),
        location: 'Room 1',
        supervisorId: teacherId,
      })
    expect(res.status).toBe(403)
  })

  it('lets the assigned supervisor mark attendance and completion', async () => {
    const attend = await request(app)
      .post(`/api/v1/detention/sessions/${detentionId}/attend`)
      .set({ Authorization: `Bearer ${teacherToken}` })
      .send({})
    expect(attend.status).toBe(200)
    expect(attend.body.data.status).toBe('attended')

    const complete = await request(app)
      .post(`/api/v1/detention/sessions/${detentionId}/complete`)
      .set({ Authorization: `Bearer ${teacherToken}` })
      .send({ notes: 'Student completed reflection worksheet.' })
    expect(complete.status).toBe(200)
    expect(complete.body.data.status).toBe('completed')

    const stored = await DetentionSession.findById(detentionId).lean()
    expect(stored?.status).toBe('completed')
    expect(await DisciplineLedger.countDocuments({ studentId })).toBe(0)
  })

  it('reports detention attendance to managers', async () => {
    const res = await request(app).get('/api/v1/detention/overview').set({ Authorization: `Bearer ${headToken}` })
    expect(res.status).toBe(200)
    expect(res.body.data.counts.attendanceRate).toBeGreaterThan(0)
    expect(res.body.data.counts.missedLast30Days).toBe(0)
  })
})
