import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { ClassModel, Dormitory, Student } from '../models/school.js'
import { DisciplineLedger } from '../models/discipline.js'

/**
 * Role-aligned attendance (role responsibility framework).
 *
 * Teachers record their assigned classes, a named class teacher records their
 * own students, the patron records school-wide welfare follow-ups and the matron
 * runs boarding roll calls. Read-only roles must never be able to mark.
 */

const PASSWORD = 'RoleAttendance2026'
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date())
let app: Express

const tokens: Record<string, string> = {}
let classA = ''
let classB = ''
let aliceId = ''
let bobId = ''
let cathyId = ''

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

function auth(role: string) {
  return { Authorization: `Bearer ${tokens[role]}` }
}

async function roster(role: string, query: Record<string, string> = {}) {
  return request(app)
    .get('/api/v1/attendance/roster')
    .query({ date: today, session: 'daily', ...query })
    .set(auth(role))
}

async function mark(role: string, entries: Array<{ studentId: string; status: string }>, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/attendance/mark')
    .set(auth(role))
    .send({ date: today, session: 'daily', entries, ...extra })
}

beforeAll(async () => {
  app = createApp()
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await seedRbac()

  await makeUser('roles.teacher@audit.rw', 'Assigned Teacher', 'TEACHER')
  await makeUser('roles.formteacher@audit.rw', 'Named Class Teacher', 'TEACHER')
  await makeUser('roles.floating@audit.rw', 'Unassigned Teacher', 'TEACHER')
  await makeUser('roles.patron@audit.rw', 'Welfare Patron', 'PATRON')
  await makeUser('roles.matron@audit.rw', 'Boarding Matron', 'MATRON')
  await makeUser('roles.it@audit.rw', 'IT Officer', 'IT')
  await makeUser('roles.secretary@audit.rw', 'School Secretary', 'SECRETARY')

  const a = await ClassModel.create({ name: 'Role Class A', level: 'O' })
  const b = await ClassModel.create({ name: 'Role Class B', level: 'O' })
  classA = String(a._id)
  classB = String(b._id)

  const dorm = await Dormitory.create({ name: 'Role Dorm', code: 'RD1', gender: 'mixed', capacity: 40 })
  const formTeacher = await User.findOne({ email: 'roles.formteacher@audit.rw' })
  const assignedTeacher = await User.findOne({ email: 'roles.teacher@audit.rw' })
  await User.updateOne({ _id: assignedTeacher!._id }, { $set: { assignedClassIds: [a._id] } })

  const alice = await Student.create({
    studentId: 'ROLE-001',
    admissionNumber: 'ADM-ROLE-001',
    firstName: 'Alice',
    lastName: 'Day',
    fullName: 'Alice Day',
    gender: 'female',
    classId: a._id,
  })
  const bob = await Student.create({
    studentId: 'ROLE-002',
    admissionNumber: 'ADM-ROLE-002',
    firstName: 'Bob',
    lastName: 'Boarder',
    fullName: 'Bob Boarder',
    gender: 'male',
    classId: a._id,
    dormitoryId: dorm._id,
    boardingStatus: 'boarding',
  })
  const cathy = await Student.create({
    studentId: 'ROLE-003',
    admissionNumber: 'ADM-ROLE-003',
    firstName: 'Cathy',
    lastName: 'Boarder',
    fullName: 'Cathy Boarder',
    gender: 'female',
    classId: b._id,
    dormitoryId: dorm._id,
    boardingStatus: 'boarding',
    classTeacherId: formTeacher!._id,
  })
  aliceId = String(alice._id)
  bobId = String(bob._id)
  cathyId = String(cathy._id)

  for (const [key, email] of Object.entries({
    teacher: 'roles.teacher@audit.rw',
    formteacher: 'roles.formteacher@audit.rw',
    floating: 'roles.floating@audit.rw',
    patron: 'roles.patron@audit.rw',
    matron: 'roles.matron@audit.rw',
    it: 'roles.it@audit.rw',
    secretary: 'roles.secretary@audit.rw',
  })) {
    tokens[key] = await login(email)
  }
})

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
})

describe('role-aligned attendance recording', () => {
  it('lets an assigned teacher open and save their class register', async () => {
    const list = await roster('teacher', { classId: classA })
    expect(list.status).toBe(200)
    expect(list.body.data.canRecord).toBe(true)
    expect(list.body.data.students.map((s: { studentId: string }) => s.studentId).sort()).toEqual(['ROLE-001', 'ROLE-002'])

    const saved = await mark('teacher', [{ studentId: aliceId, status: 'present' }], { classId: classA })
    expect(saved.status).toBe(200)
    expect(saved.body.data.recorded).toBe(1)
  })

  it('lets a named class teacher mark their own student without a class assignment', async () => {
    const list = await roster('formteacher')
    expect(list.status).toBe(200)
    expect(list.body.data.canRecord).toBe(true)
    expect(list.body.data.students.map((s: { studentId: string }) => s.studentId)).toEqual(['ROLE-003'])

    const saved = await mark('formteacher', [{ studentId: cathyId, status: 'present' }])
    expect(saved.status).toBe(200)

    const unrelated = await mark('formteacher', [{ studentId: aliceId, status: 'present' }])
    expect(unrelated.status).toBe(403)
  })

  it('gives an unassigned teacher read-only browsing across classes', async () => {
    const list = await roster('floating')
    expect(list.status).toBe(200)
    expect(list.body.data.canRecord).toBe(false)
    expect(list.body.data.students).toHaveLength(3)

    const denied = await mark('floating', [{ studentId: aliceId, status: 'present' }])
    expect(denied.status).toBe(403)
  })

  it('lets the patron record attendance across the school', async () => {
    const list = await roster('patron')
    expect(list.status).toBe(200)
    expect(list.body.data.students).toHaveLength(3)

    const saved = await mark('patron', [{ studentId: bobId, status: 'late', minutesLate: 8 }])
    expect(saved.status).toBe(200)
    expect(saved.body.data.recorded).toBe(1)
  })

  it('lets the matron run boarding roll calls without a dorm assignment', async () => {
    const daily = await roster('matron')
    expect(daily.status).toBe(200)
    expect(daily.body.data.canRecord).toBe(true)
    expect(daily.body.data.students.map((s: { studentId: string }) => s.studentId).sort()).toEqual(['ROLE-002', 'ROLE-003'])

    const rollCall = await request(app)
      .get('/api/v1/attendance/roster')
      .query({ date: today, session: 'dormitory_evening' })
      .set(auth('matron'))
    expect(rollCall.status).toBe(200)
    expect(rollCall.body.data.students).toHaveLength(2)

    const saved = await mark('matron', [{ studentId: bobId, status: 'present' }])
    expect(saved.status).toBe(200)

    const dayStudent = await mark('matron', [{ studentId: aliceId, status: 'present' }])
    expect(dayStudent.status).toBe(403)
  })

  it('keeps IT read-only and gives the secretary the reporting view', async () => {
    const readOnly = await roster('it')
    expect(readOnly.status).toBe(200)
    expect(readOnly.body.data.canRecord).toBe(false)
    const denied = await mark('it', [{ studentId: aliceId, status: 'present' }])
    expect(denied.status).toBe(403)

    const report = await request(app).get('/api/v1/attendance/overview').query({ session: 'daily' }).set(auth('secretary'))
    expect(report.status).toBe(200)
    const reportSave = await mark('secretary', [{ studentId: aliceId, status: 'present' }])
    expect(reportSave.status).toBe(403)
  })

  it('never posts attendance to the discipline ledger', async () => {
    expect(await DisciplineLedger.countDocuments()).toBe(0)
  })
})
