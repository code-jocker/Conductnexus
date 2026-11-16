import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'

/**
 * Report exports (audit F2).
 *
 * Exports are built from the same scoped report data the JSON endpoint returns,
 * so an export cannot leak a figure a caller may not read.
 */

const PASSWORD = 'ExportPass2026'
let app: Express
const tokens: Record<string, string> = {}

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
    ['export-head@test.rw', 'HEADTEACHER'],
    ['export-teacher@test.rw', 'TEACHER'],
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

describe('report exports', () => {
  it('returns CSV by default for a permitted role', async () => {
    const res = await request(app).get('/api/v1/reports/term/export').set(auth('export-head@test.rw'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('conductnexus-term-')
  })

  it('returns a real PDF when format=pdf', async () => {
    const res = await request(app)
      .get('/api/v1/reports/term/export')
      .query({ format: 'pdf' })
      .set(auth('export-head@test.rw'))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => cb(null, Buffer.concat(chunks)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition']).toContain('.pdf')
    const body = res.body as Buffer
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(body.length).toBeGreaterThan(500)
  })

  it('rejects an unsupported format', async () => {
    const res = await request(app)
      .get('/api/v1/reports/term/export')
      .query({ format: 'xlsx' })
      .set(auth('export-head@test.rw'))
    expect(res.status).toBe(400)
  })

  it('refuses export to a role without reports.export', async () => {
    const res = await request(app).get('/api/v1/reports/term/export').set(auth('export-teacher@test.rw'))
    expect(res.status).toBe(403)
  })

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/reports/term/export')
    expect(res.status).toBe(401)
  })
})