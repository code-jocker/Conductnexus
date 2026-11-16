import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { ROLE_SEEDS } from '../shared/roles.js'

/**
 * Authorization matrix (audit H4).
 *
 * The expected outcome for every cell is derived from `ROLE_SEEDS` — the same
 * source that seeds `RolePermission` — so this test fails the moment a role's
 * granted permissions and a route's required permission drift apart. No expected
 * status is hard-coded per role.
 */

const PASSWORD = 'AuthzPass2026'
let app: Express

const tokens: Record<string, string> = {}
const permissionsByRole: Record<string, Set<string>> = Object.fromEntries(
  ROLE_SEEDS.map((role) => [role.key, new Set<string>(role.permissions)]),
)
const ROLE_KEYS = ROLE_SEEDS.map((role) => role.key)

type MatrixCase = {
  method: 'get' | 'post'
  path: string
  /** Single permission the route requires. */
  permission?: string
  /** Alternative permissions — the route accepts any one of them. */
  anyOf?: string[]
  /** Sent only for mutating verbs; deliberately invalid so authorization is
   *  distinguishable from validation (guard runs before `validate`). */
  body?: unknown
}

const APPROVAL_PERMISSIONS = [
  'marks.adjust.approve',
  'incidents.review',
  'letters.approve',
  'safeguarding.escalate',
  'students.promote.approve',
  'investigations.decide',
]

const CASES: MatrixCase[] = [
  { method: 'get', path: '/api/v1/users', permission: 'users.view' },
  { method: 'get', path: '/api/v1/audit-logs', permission: 'audit.view' },
  { method: 'get', path: '/api/v1/students', permission: 'students.view' },
  { method: 'get', path: '/api/v1/policies', permission: 'policies.view' },
  { method: 'get', path: '/api/v1/safeguarding/cases', permission: 'safeguarding.view' },
  { method: 'get', path: '/api/v1/meetings', permission: 'meetings.view' },
  { method: 'get', path: '/api/v1/approvals', anyOf: APPROVAL_PERMISSIONS },
  { method: 'post', path: '/api/v1/incidents', permission: 'incidents.create', body: {} },
]

function isAllowed(roleKey: string, testCase: MatrixCase): boolean {
  const permissions = permissionsByRole[roleKey] ?? new Set<string>()
  if (testCase.anyOf) return testCase.anyOf.some((p) => permissions.has(p))
  return testCase.permission ? permissions.has(testCase.permission) : true
}

function auth(roleKey: string) {
  return { Authorization: `Bearer ${tokens[roleKey]}` }
}

async function createUser(email: string, name: string, roleKey: string) {
  const user = await User.create({
    name,
    email,
    passwordHash: await hashPassword(PASSWORD),
    emailVerified: true,
    status: 'active',
  })
  const role = await Role.findOne({ key: roleKey })
  if (!role) throw new Error(`Role ${roleKey} missing after seedRbac`)
  await UserRole.create({ userId: user._id, roleId: role._id, assignedAt: new Date() })
  return user
}

beforeAll(async () => {
  app = createApp()
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await seedRbac()

  for (const roleKey of ROLE_KEYS) {
    const email = `${roleKey.toLowerCase()}@authz.rw`
    await createUser(email, `Authz ${roleKey}`, roleKey)
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
    expect(res.status, `login failed for ${roleKey}`).toBe(200)
    tokens[roleKey] = res.body.data.accessToken
  }
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('authorization matrix', () => {
  for (const testCase of CASES) {
    const label = `${testCase.method.toUpperCase()} ${testCase.path}`

    it(`${label} grants only roles holding ${testCase.anyOf ? 'one of ' + testCase.anyOf.join(' | ') : testCase.permission}`, async () => {
      const assertions = ROLE_KEYS.map(async (roleKey) => {
        const request_ = request(app)[testCase.method](testCase.path).set(auth(roleKey))
        const res = testCase.body === undefined ? await request_ : await request_.send(testCase.body)
        const allowed = isAllowed(roleKey, testCase)

        if (!allowed) {
          expect(res.status, `${roleKey} must be denied ${label}`).toBe(403)
          return
        }
        // An authorized caller must never be stopped by the authorization layer.
        // Mutating verbs are sent an invalid body, so 400 (validation) proves the
        // guard let them through.
        expect(res.status, `${roleKey} must be authorized for ${label}`).not.toBe(403)
        if (testCase.body === undefined) {
          expect(res.status, `${roleKey} must succeed on ${label}`).toBeLessThan(400)
        } else {
          // The guard passed, so the request must have reached body validation
          // (400) or schema validation (422) — never an auth failure.
          expect([400, 422], `${roleKey} must reach validation on ${label}`).toContain(res.status)
        }
      })
      await Promise.all(assertions)
    })
  }

  it('rejects an unauthenticated caller with 401 rather than 403', async () => {
    const res = await request(app).get('/api/v1/users')
    expect(res.status).toBe(401)
  })

  it('covers every seeded role', () => {
    expect(ROLE_KEYS).toHaveLength(12)
    expect(Object.keys(tokens)).toHaveLength(12)
  })
})