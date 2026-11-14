import jwt from 'jsonwebtoken'
import { Types } from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { Role, User, UserRole } from '../models/core.js'
import { ClassModel, Parent, Student, GuardianLink, AcademicYear, Term } from '../models/school.js'
import { DisciplineLedger } from '../models/discipline.js'
import { PromotionBatch } from '../models/promotion.js'
import { AuditLog } from '../models/governance.js'

const BASE = `http://127.0.0.1:${env.PORT || 4000}/api/v1`

let failures = 0
function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}`, detail ?? '')
  }
}

async function tokenFor(userId: string) {
  return jwt.sign({ sub: String(userId), typ: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' })
}

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = (await res.json().catch(() => ({}))) as { data?: unknown; error?: { message?: string } }
  return { status: res.status, data: payload.data as Record<string, unknown> | undefined, error: payload.error?.message }
}

async function main() {
  await connectDatabase()

  const adminRole = await Role.findOne({ key: 'ADMIN' })
  if (!adminRole) throw new Error('ADMIN role missing — run setup/seed first')
  const adminLink = await UserRole.findOne({ roleId: adminRole._id }).lean()
  const admin = adminLink ? await User.findById(adminLink.userId) : null
  if (!admin) throw new Error('No admin user found')

  const headEmail = `smoke.head.${Date.now()}@local.test`
  const headRole = await Role.findOne({ key: 'HEADTEACHER' })
  if (!headRole) throw new Error('HEADTEACHER role missing')
  const head = await User.create({ name: 'Smoke Headteacher', email: headEmail, passwordHash: 'x'.repeat(60), emailVerified: true, status: 'active' })
  await UserRole.create({ userId: head._id, roleId: headRole._id, assignedAt: new Date() })

  const adminToken = await tokenFor(String(admin._id))
  const headToken = await tokenFor(String(head._id))
  const suffix = String(Date.now()).slice(-6)
  const phone = `0788${suffix}`

  const cls = await ClassModel.findOne({ active: true }).sort({ name: 1 }).lean()
  if (!cls) throw new Error('No active class found')
  const otherCls = await ClassModel.findOne({ active: true, _id: { $ne: cls._id } }).lean()
  const year = await AcademicYear.findOne({ isActive: true }).lean()
  const term = await Term.findOne({ isActive: true }).lean()

  let studentId = ''
  let batchId = ''
  try {
    console.log('\nRegistration')
    const reg = await call('POST', '/students', adminToken, {
      firstName: 'Smoke',
      lastName: `Learner${suffix}`,
      gender: 'female',
      dateOfBirth: '2012-04-18',
      classId: String(cls._id),
      admissionType: 'new',
      boardingStatus: 'day',
      guardians: [{ name: 'Smoke Guardian', relationship: 'Mother', phone, whatsappConsent: true, isPrimary: true, isEmergencyContact: true }],
    })
    check('POST /students returns 201', reg.status === 201, reg)
    studentId = String((reg.data as { _id?: string })?._id ?? '')
    check('student id returned', Boolean(studentId), reg.data)
    if (!studentId) throw new Error('Registration failed, aborting')

    console.log('\nProfile')
    const profile = await call('GET', `/students/${studentId}/profile`, adminToken)
    const p = profile.data as {
      student?: { fullName?: string }
      guardians?: { parentId?: { phone?: string; whatsappConsent?: boolean } }[]
      permissions?: Record<string, boolean>
      conduct?: { currentBalance?: number }
    }
    check('GET profile 200', profile.status === 200, profile)
    check('guardian linked with WhatsApp consent', p?.guardians?.length === 1 && p.guardians[0].parentId?.whatsappConsent === true, p?.guardians)
    check('profile permissions present', typeof p?.permissions?.canEdit === 'boolean', p?.permissions)
    check('conduct allocation initialised', typeof p?.conduct?.currentBalance === 'number', p?.conduct)

    console.log('\nEdit, guardians, lifecycle')
    const patched = await call('PATCH', `/students/${studentId}`, adminToken, { notes: 'Smoke test record', medicalNotes: 'None' })
    check('PATCH student 200', patched.status === 200, patched)

    const secondPhone = `0789${suffix}`
    const added = await call('POST', `/students/${studentId}/guardians`, adminToken, { name: 'Smoke Father', relationship: 'Father', phone: secondPhone, whatsappConsent: true })
    check('POST guardian 201', added.status === 201, added)
    const linkId = String((added.data as { _id?: string })?._id ?? '')
    if (linkId) {
      const removed = await call('DELETE', `/students/${studentId}/guardians/${linkId}`, adminToken)
      check('DELETE guardian 200', removed.status === 200, removed)
    } else {
      check('guardian link id returned', false, added.data)
    }

    const suspended = await call('POST', `/students/${studentId}/lifecycle`, adminToken, { action: 'suspend', reason: 'Smoke test suspension' })
    check('lifecycle suspend 200', suspended.status === 200, suspended)
    const reinstated = await call('POST', `/students/${studentId}/lifecycle`, adminToken, { action: 'reinstate', reason: 'Smoke test reinstatement' })
    check('lifecycle reinstate 200', reinstated.status === 200, reinstated)

    const ledger = await call('GET', `/students/${studentId}/ledger`, adminToken)
    check('GET ledger 200', ledger.status === 200, ledger)

    console.log('\nPromotion workflow')
    const batch = await call('POST', '/promotions', adminToken, {
      title: `Smoke batch ${suffix}`,
      fromClassId: String(cls._id),
      toClassId: otherCls ? String(otherCls._id) : null,
      graduate: otherCls ? false : true,
      toAcademicYearId: year?._id ? String(year._id) : null,
      toTermId: term?._id ? String(term._id) : null,
      studentIds: [studentId],
      reason: 'Smoke test batch',
    })
    check('POST /promotions 201', batch.status === 201, batch)
    batchId = String((batch.data as { _id?: string })?._id ?? '')
    check('batch id returned', Boolean(batchId), batch.data)

    if (batchId) {
      const submitted = await call('POST', `/promotions/${batchId}/submit`, adminToken)
      check('submit 200', submitted.status === 200, submitted)
      const approved = await call('POST', `/promotions/${batchId}/approve`, headToken, { notes: 'Smoke approval' })
      check('approve by headteacher 200', approved.status === 200, approved)
      const executed = await call('POST', `/promotions/${batchId}/execute`, adminToken)
      check('execute 200', executed.status === 200, executed)
      const detail = await call('GET', `/promotions/${batchId}`, adminToken)
      const d = detail.data as { status?: string; items?: { status?: string }[] }
      check('batch completed', d?.status === 'completed', d)
      check('student item promoted/graduated', ['promoted', 'graduated'].includes(String(d?.items?.[0]?.status)), d?.items)

      const after = await Student.findById(studentId).lean()
      check('student moved or graduated', d?.items?.[0]?.status === 'graduated' ? after?.status === 'graduated' : String(after?.classId) === String(otherCls?._id), {
        status: after?.status,
        classId: after?.classId,
      })
      check('enrollment history records movement', (after?.enrollmentHistory ?? []).some((h) => ['promoted', 'graduated'].includes(h.action)), after?.enrollmentHistory)
    }

    const activity = await call('GET', `/students/${studentId}/activity`, adminToken)
    check('GET activity 200', activity.status === 200, activity)
  } finally {
    console.log('\nCleanup')
    if (batchId) {
      await PromotionBatch.deleteOne({ _id: batchId })
      await AuditLog.deleteMany({ resourceId: batchId })
    }
    if (studentId) {
      await Student.deleteOne({ _id: studentId })
      await DisciplineLedger.collection.deleteMany({ studentId: new Types.ObjectId(studentId) })
      await AuditLog.deleteMany({ resourceId: studentId })
      const links = await GuardianLink.find({ studentId }).lean()
      for (const link of links) {
        const remaining = await GuardianLink.countDocuments({ parentId: link.parentId, _id: { $ne: link._id } })
        await GuardianLink.deleteOne({ _id: link._id })
        if (remaining === 0) await Parent.deleteOne({ _id: link.parentId })
      }
    }
    await UserRole.deleteMany({ userId: head._id })
    await User.deleteOne({ _id: head._id })

    await disconnectDatabase()
    console.log(failures === 0 ? '\nSMOKE PASSED' : `\nSMOKE FAILED (${failures} check(s))`)
    process.exit(failures === 0 ? 0 : 1)
  }
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
