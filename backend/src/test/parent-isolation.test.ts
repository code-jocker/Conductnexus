import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { ClassModel, GuardianLink, Parent, Student } from '../models/school.js'
import { DisciplineLedger } from '../models/discipline.js'

/**
 * Parent isolation (audit P0). A parent account may only ever reach the
 * children linked to its own parent record, and must be refused on every staff
 * endpoint, including a direct identifier guess for an unlinked child.
 */

const PASSWORD = 'ParentPass2026'
let app: Express
let parentToken = ''
let teacherToken = ''
let adminToken = ''
let ownChildId = ''
let otherChildId = ''
let otherTermId = new mongoose.Types.ObjectId()

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
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
  expect(res.status).toBe(200)
  return res.body.data.accessToken as string
}

beforeAll(async () => {
  app = createApp()
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await seedRbac()

  const parentUser = await makeUser('guardian@isolation.rw', 'Isolation Guardian', 'PARENT')
  await makeUser('teacher@isolation.rw', 'Isolation Teacher', 'TEACHER')

  const cls = await ClassModel.create({ name: 'Isolation Class', level: 'O' })
  const ownChild = await Student.create({
    studentId: 'ISO-001',
    admissionNumber: 'ADM-ISO-001',
    firstName: 'Own',
    lastName: 'Child',
    fullName: 'Own Child',
    gender: 'female',
    classId: cls._id,
    currentBalance: 12,
  })
  const otherChild = await Student.create({
    studentId: 'ISO-002',
    admissionNumber: 'ADM-ISO-002',
    firstName: 'Other',
    lastName: 'Child',
    fullName: 'Other Child',
    gender: 'male',
    classId: cls._id,
    currentBalance: 30,
  })
  ownChildId = String(ownChild._id)
  otherChildId = String(otherChild._id)

  const parent = await Parent.create({
    name: 'Isolation Guardian',
    phone: '0788555000',
    portalUserId: parentUser._id,
    whatsappConsent: true,
  })
  await GuardianLink.create({ studentId: ownChild._id, parentId: parent._id, relationship: 'mother', isPrimary: true })

  // A conduct entry for the other child that must never leak through the portal.
  await DisciplineLedger.create({
    studentId: otherChild._id,
    termId: otherTermId,
    academicYearId: new mongoose.Types.ObjectId(),
    type: 'deduction',
    change: -5,
    previousBalance: 35,
    newBalance: 30,
    reason: 'Private conduct record',
    createdBy: parentUser._id,
  })

  await makeUser('admin@isolation.rw', 'Isolation Admin', 'ADMIN')
  parentToken = await login('guardian@isolation.rw')
  teacherToken = await login('teacher@isolation.rw')
  adminToken = await login('admin@isolation.rw')
})

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
})

describe('parent isolation', () => {
  it('lists only the children linked to the signed-in parent', async () => {
    const res = await request(app).get('/api/v1/portal/children').set({ Authorization: `Bearer ${parentToken}` })
    expect(res.status).toBe(200)
    const ids = (res.body.data.children as { id: string }[]).map((child) => child.id)
    expect(ids).toEqual([ownChildId])
    expect(ids).not.toContain(otherChildId)
  })

  it('opens the linked child', async () => {
    const res = await request(app)
      .get(`/api/v1/portal/children/${ownChildId}`)
      .set({ Authorization: `Bearer ${parentToken}` })
    expect(res.status).toBe(200)
    expect(res.body.data.student.id).toBe(ownChildId)
  })

  it('refuses a guessed identifier for an unlinked child', async () => {
    const res = await request(app)
      .get(`/api/v1/portal/children/${otherChildId}`)
      .set({ Authorization: `Bearer ${parentToken}` })
    expect(res.status).toBe(403)
  })

  it('keeps staff directories closed to a parent account', async () => {
    const directory = await request(app).get('/api/v1/students').set({ Authorization: `Bearer ${parentToken}` })
    expect(directory.status).toBe(403)

    const detail = await request(app)
      .get(`/api/v1/students/${otherChildId}`)
      .set({ Authorization: `Bearer ${parentToken}` })
    expect(detail.status).toBe(403)
  })

  it('keeps the conduct ledger closed to a parent account', async () => {
    const res = await request(app)
      .get(`/api/v1/discipline/ledger?studentId=${otherChildId}`)
      .set({ Authorization: `Bearer ${parentToken}` })
    expect(res.status).toBe(403)
  })

  it('keeps unassigned teachers out while leadership retains access', async () => {
    const teacher = await request(app)
      .get(`/api/v1/students/${otherChildId}`)
      .set({ Authorization: `Bearer ${teacherToken}` })
    expect(teacher.status).toBe(403)

    const admin = await request(app)
      .get(`/api/v1/students/${otherChildId}`)
      .set({ Authorization: `Bearer ${adminToken}` })
    expect(admin.status).toBeLessThan(400)
  })
})
