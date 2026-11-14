import jwt from 'jsonwebtoken'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { Role, Session, User, UserRole } from '../models/core.js'
import { AuditLog } from '../models/governance.js'

const BASE = `http://127.0.0.1:${env.PORT || 4000}/api/v1`
const TEMP = 'TempPass2026a'
const NEXT = 'NextPass2026b'

let failures = 0
function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}`, detail ?? '')
  }
}

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { message?: string } }
  return { status: res.status, data: payload.data, error: payload.error?.message }
}

async function main() {
  await connectDatabase()
  const adminRole = await Role.findOne({ key: 'ADMIN' })
  const teacherRole = await Role.findOne({ key: 'TEACHER' })
  if (!adminRole || !teacherRole) throw new Error('Roles missing — run setup/seed first')
  const adminLink = await UserRole.findOne({ roleId: adminRole._id }).lean()
  const admin = adminLink ? await User.findById(adminLink.userId) : null
  if (!admin) throw new Error('No admin user found')
  const adminToken = jwt.sign({ sub: String(admin._id), typ: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' })

  const email = `smoke.password.${Date.now()}@local.test`
  try {
    console.log('\nCreate user with temporary password')
    const created = await call('POST', '/users', adminToken, {
      name: 'Smoke Password User',
      email,
      roleIds: [String(teacherRole._id)],
      sendInvite: false,
      temporaryPassword: TEMP,
    })
    check('POST /users 201', created.status === 201, created)

    console.log('\nForced change with temporary password')
    const login1 = await call('POST', '/auth/login', null, { email, password: TEMP })
    check('login with temporary password 200', login1.status === 200, login1)
    const token = String((login1.data as { accessToken?: string })?.accessToken ?? '')
    check('must change password flag set', (login1.data as { user?: { mustChangePassword?: boolean } })?.user?.mustChangePassword === true, login1.data)

    const noCurrent = await call('POST', '/auth/change-password', token, { newPassword: NEXT })
    check('change without temporary password rejected', noCurrent.status === 400, noCurrent)

    const changed = await call('POST', '/auth/change-password', token, { currentPassword: TEMP, newPassword: NEXT })
    check('change with temporary password 200', changed.status === 200, changed)

    const login2 = await call('POST', '/auth/login', null, { email, password: NEXT })
    check('login with new password 200', login2.status === 200, login2)
    check('must change password cleared', (login2.data as { user?: { mustChangePassword?: boolean } })?.user?.mustChangePassword === false, login2.data)

    const weak = await call('POST', '/auth/change-password', String((login2.data as { accessToken?: string })?.accessToken ?? ''), { currentPassword: NEXT, newPassword: 'short' })
    check('weak password rejected with field detail', weak.status === 422, weak)
  } finally {
    const user = await User.findOne({ email })
    if (user) {
      await Session.deleteMany({ userId: user._id })
      await UserRole.deleteMany({ userId: user._id })
      await AuditLog.deleteMany({ resourceId: String(user._id) })
      await User.deleteOne({ _id: user._id })
    }
    await disconnectDatabase()
    console.log(failures === 0 ? '\nPASSWORD SMOKE PASSED' : `\nPASSWORD SMOKE FAILED (${failures})`)
    process.exit(failures === 0 ? 0 : 1)
  }
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
