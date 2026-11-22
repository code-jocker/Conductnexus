import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { ClassModel, Dormitory, GuardianLink, Parent, Student } from '../models/school.js'
import { DisciplineLedger } from '../models/discipline.js'
import { AttendanceRecord, BoardingMovement } from '../models/attendance.js'

/**
 * Attendance and boarding (audit P3). The register is idempotent per school
 * day, corrections and excuses flow through approval, boarding movements can be
 * escalated as missing, and none of it touches the discipline ledger.
 */

const PASSWORD = 'AttendancePass2026'
let app: Express
let adminToken = ''
let teacherToken = ''
let parentToken = ''
let classId = ''
let dormitoryId = ''
let firstStudentId = ''
let secondStudentId = ''
let parentChildId = ''
let absentRecordId = ''
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date())

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

  await makeUser('attendance.admin@audit.rw', 'Attendance Admin', 'ADMIN')
  await makeUser('attendance.teacher@audit.rw', 'Attendance Teacher', 'TEACHER')
  const parentUser = await makeUser('attendance.parent@audit.rw', 'Attendance Parent', 'PARENT')

  const cls = await ClassModel.create({ name: 'Attendance Class', level: 'O' })
  classId = String(cls._id)
  await User.updateOne({ email: 'attendance.teacher@audit.rw' }, { $set: { assignedClassIds: [cls._id] } })
  const dorm = await Dormitory.create({ name: 'Attendance Dorm', code: 'ATD', gender: 'female', capacity: 2 })
  dormitoryId = String(dorm._id)

  const first = await Student.create({
    studentId: 'ATT-001',
    admissionNumber: 'ADM-ATT-001',
    firstName: 'Alice',
    lastName: 'Mukamana',
    fullName: 'Alice Mukamana',
    gender: 'female',
    classId: cls._id,
    currentBalance: 40,
  })
  const second = await Student.create({
    studentId: 'ATT-002',
    admissionNumber: 'ADM-ATT-002',
    firstName: 'Bob',
    lastName: 'Nkurunziza',
    fullName: 'Bob Nkurunziza',
    gender: 'male',
    classId: cls._id,
    currentBalance: 40,
  })
  firstStudentId = String(first._id)
  secondStudentId = String(second._id)

  const parent = await Parent.create({
    name: 'Attendance Parent',
    phone: '0788555011',
    portalUserId: parentUser._id,
    whatsappConsent: true,
  })
  await GuardianLink.create({ studentId: first._id, parentId: parent._id, relationship: 'mother', isPrimary: true })
  parentChildId = firstStudentId

  adminToken = await login('attendance.admin@audit.rw')
  teacherToken = await login('attendance.teacher@audit.rw')
  parentToken = await login('attendance.parent@audit.rw')
})

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
})

describe('attendance register', () => {
  it('records a register and keeps re-marking idempotent', async () => {
    const first = await request(app)
      .post('/api/v1/attendance/mark')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        date: today,
        session: 'daily',
        classId,
        entries: [
          { studentId: firstStudentId, status: 'present' },
          { studentId: secondStudentId, status: 'absent', reason: 'No explanation yet' },
        ],
      })
    expect(first.status).toBe(200)
    expect(first.body.data.recorded).toBe(2)

    const second = await request(app)
      .post('/api/v1/attendance/mark')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        date: today,
        session: 'daily',
        classId,
        entries: [{ studentId: secondStudentId, status: 'late', minutesLate: 15 }],
      })
    expect(second.status).toBe(200)
    const records = await AttendanceRecord.find({ date: today, session: 'daily' })
    expect(records).toHaveLength(2)
    const updated = records.find((r) => String(r.studentId) === secondStudentId)
    expect(updated?.status).toBe('late')
    expect(updated?.minutesLate).toBe(15)
  })

  it('never deducts conduct marks for an absence', async () => {
    const student = await Student.findById(secondStudentId)
    expect(student?.currentBalance).toBe(40)
    expect(await DisciplineLedger.countDocuments({ studentId: secondStudentId })).toBe(0)
  })

  it('returns the roster with existing marks and unmarked counts', async () => {
    const res = await request(app)
      .get(`/api/v1/attendance/roster?date=${today}&session=daily&classId=${classId}`)
      .set({ Authorization: `Bearer ${teacherToken}` })
    expect(res.status).toBe(200)
    expect(res.body.data.students).toHaveLength(2)
    expect(res.body.data.counts.present).toBe(1)
    expect(res.body.data.counts.late).toBe(1)
    expect(res.body.data.counts.unmarked).toBe(0)
  })

  it('refuses registers to a parent account', async () => {
    const res = await request(app).get('/api/v1/attendance/roster').set({ Authorization: `Bearer ${parentToken}` })
    expect(res.status).toBe(403)
  })

  it('requires approval before a correction changes the register', async () => {
    const record = await AttendanceRecord.findOne({ studentId: secondStudentId, date: today })
    absentRecordId = String(record?._id)
    const correction = await request(app)
      .post(`/api/v1/attendance/${absentRecordId}/correction`)
      .set({ Authorization: `Bearer ${teacherToken}` })
      .send({ status: 'present', reason: 'Student arrived after the register was closed' })
    expect(correction.status).toBe(201)
    const stillLate = await AttendanceRecord.findById(absentRecordId)
    expect(stillLate?.status).toBe('late')

    const decision = await request(app)
      .post(`/api/v1/attendance/corrections/${correction.body.data._id}/decide`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ decision: 'approve', note: 'Verified with the class teacher' })
    expect(decision.status).toBe(200)
    const corrected = await AttendanceRecord.findById(absentRecordId)
    expect(corrected?.status).toBe('present')
    expect(corrected?.source).toBe('correction')
  })

  it('applies an approved absence excuse to recorded absences', async () => {
    await request(app)
      .post('/api/v1/attendance/mark')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ date: today, session: 'classroom', classId, entries: [{ studentId: secondStudentId, status: 'absent' }] })
    const excuse = await request(app)
      .post('/api/v1/attendance/excuses')
      .set({ Authorization: `Bearer ${teacherToken}` })
      .send({ studentId: secondStudentId, fromDate: today, toDate: today, category: 'medical', reason: 'Clinic visit confirmed by the nurse' })
    expect(excuse.status).toBe(201)
    const review = await request(app)
      .post(`/api/v1/attendance/excuses/${excuse.body.data._id}/review`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ decision: 'approve', note: 'Medical note checked' })
    expect(review.status).toBe(200)
    expect(review.body.data.appliedDates).toContain(today)
    const record = await AttendanceRecord.findOne({ studentId: secondStudentId, date: today, session: 'classroom' })
    expect(record?.status).toBe('excused')
  })

  it('summarises attendance without counting excused absences against the rate', async () => {
    const res = await request(app)
      .get('/api/v1/attendance/overview?session=classroom')
      .set({ Authorization: `Bearer ${adminToken}` })
    expect(res.status).toBe(200)
    expect(res.body.data.students).toBe(2)
    expect(res.body.data.totals.excused).toBeGreaterThanOrEqual(1)
  })

  it('lets a parent see their own child attendance and nobody else', async () => {
    const own = await request(app)
      .get(`/api/v1/portal/children/${parentChildId}/attendance`)
      .set({ Authorization: `Bearer ${parentToken}` })
    expect(own.status).toBe(200)
    expect(own.body.data.student.id).toBe(parentChildId)
    expect(own.body.data.records.length).toBeGreaterThanOrEqual(1)

    const unlinked = await request(app)
      .get(`/api/v1/portal/children/${secondStudentId}/attendance`)
      .set({ Authorization: `Bearer ${parentToken}` })
    expect(unlinked.status).toBe(403)
  })
})

describe('boarding management', () => {
  it('allocates a boarding student to a dormitory', async () => {
    const res = await request(app)
      .post('/api/v1/boarding/allocations')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ studentId: firstStudentId, dormitoryId, roomNumber: 'B2', bedNumber: '4' })
    expect(res.status).toBe(201)
    const student = await Student.findById(firstStudentId)
    expect(String(student?.dormitoryId)).toBe(dormitoryId)
    expect(student?.boardingStatus).toBe('boarding')
    expect(student?.roomNumber).toBe('B2')
  })

  it('rejects a mixed-gender allocation and over-capacity dormitory', async () => {
    const wrongGender = await request(app)
      .post('/api/v1/boarding/allocations')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ studentId: secondStudentId, dormitoryId })
    expect(wrongGender.status).toBe(400)

    const second = await Student.create({
      studentId: 'ATT-003',
      admissionNumber: 'ADM-ATT-003',
      firstName: 'Cathy',
      lastName: 'Uwase',
      fullName: 'Cathy Uwase',
      gender: 'female',
      classId: new mongoose.Types.ObjectId(classId),
    })
    const third = await Student.create({
      studentId: 'ATT-004',
      admissionNumber: 'ADM-ATT-004',
      firstName: 'Diane',
      lastName: 'Uwera',
      fullName: 'Diane Uwera',
      gender: 'female',
      classId: new mongoose.Types.ObjectId(classId),
    })
    const full = await request(app)
      .post('/api/v1/boarding/allocations/bulk')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ studentIds: [String(second._id), String(third._id)], dormitoryId })
    // Capacity is 2 and one bed is taken, so only one of the two fits.
    expect(full.status).toBe(409)
  })

  it('escalates an overdue student as missing and resolves on return', async () => {
    const movement = await request(app)
      .post('/api/v1/boarding/movements')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        studentId: firstStudentId,
        type: 'weekend_permission',
        destination: 'Family home, Kicukiro',
        reason: 'Approved weekend leave',
        outAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        expectedReturnAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
    expect(movement.status).toBe(201)
    expect(movement.body.data.status).toBe('out')
    expect(movement.body.data.reference).toMatch(/^BRD-/)

    const overview = await request(app).get('/api/v1/boarding/overview').set({ Authorization: `Bearer ${adminToken}` })
    expect(overview.status).toBe(200)
    const flagged = await BoardingMovement.findById(movement.body.data._id)
    expect(flagged?.status).toBe('overdue')

    const missing = await request(app)
      .post(`/api/v1/boarding/movements/${movement.body.data._id}/missing`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ note: 'Not at the guardian home; guardian confirms departure' })
    expect(missing.status).toBe(201)
    expect(missing.body.data.missingReportedAt).toBeTruthy()
    expect(missing.body.data.escalatedTo).toContain('HEADTEACHER')

    const returned = await request(app)
      .post(`/api/v1/boarding/movements/${movement.body.data._id}/return`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ notes: 'Arrived at school with the matron' })
    expect(returned.status).toBe(200)
    expect(returned.body.data.status).toBe('returned')
    expect(returned.body.data.resolvedAt).toBeTruthy()
  })

  it('keeps allocation management closed to teachers', async () => {
    const res = await request(app)
      .post('/api/v1/boarding/allocations')
      .set({ Authorization: `Bearer ${teacherToken}` })
      .send({ studentId: firstStudentId, dormitoryId })
    expect(res.status).toBe(403)
  })
})
