import { Types } from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { getSettings, Role, User, UserRole } from '../models/core.js'
import { ClassModel, Dormitory, GuardianLink, Parent, Student } from '../models/school.js'
import { Offence } from '../models/discipline.js'
import { FollowUp, Intervention, Recognition } from '../models/support.js'
import { getActiveAcademicYear, getActiveTerm } from '../services/academic.service.js'
import { getUserContext } from '../services/rbac.service.js'
import { ensureInitialAllocation } from '../services/ledger.service.js'
import { createIncident, reviewIncident, submitIncident } from '../services/incidents.service.js'
import { evaluateStudentRisk } from '../services/risk.service.js'
import { seedAdminFromEnv, seedRbac, seedSchoolDefaults } from '../services/seed.service.js'
import { hashPassword } from '../services/auth.service.js'
import { logger } from '../shared/logger.js'

const PASSWORD = 'Demo@2026!'

async function ensureUser(name: string, email: string, roleKey: string, position: string) {
  let user = await User.findOne({ email }).select('+passwordHash')
  if (!user) {
    user = await User.create({
      name,
      email,
      passwordHash: await hashPassword(PASSWORD),
      emailVerified: true,
      status: 'active',
      position,
    })
  } else {
    user.passwordHash = await hashPassword(PASSWORD)
    user.emailVerified = true
    user.status = 'active'
    user.failedLoginCount = 0
    user.lockUntil = undefined
    await user.save()
  }
  const role = await Role.findOne({ key: roleKey })
  if (role) {
    await UserRole.updateOne(
      { userId: user._id, roleId: role._id },
      { $setOnInsert: { userId: user._id, roleId: role._id, assignedAt: new Date() } },
      { upsert: true },
    )
  }
  return user
}

async function main() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Demo data cannot be seeded in production')
  }
  await connectDatabase()
  await seedRbac()
  await seedSchoolDefaults()
  await seedAdminFromEnv()

  const settings = await getSettings()
  if (!settings.setupCompleted) {
    settings.setupCompleted = true
    await settings.save()
  }

  const admin = await ensureUser('System Administrator', 'admin@conductnexus.rw', 'ADMIN', 'System Administrator')
  const headteacher = await ensureUser('Head Teacher', 'headteacher@conductnexus.rw', 'HEADTEACHER', 'Headteacher')
  const teacher = await ensureUser('Class Teacher', 'teacher@conductnexus.rw', 'TEACHER', 'Teacher of Mathematics')
  const parentUser = await ensureUser('Demo Parent', 'parent@conductnexus.rw', 'PARENT', 'Parent / Guardian')

  const [year, term] = await Promise.all([getActiveAcademicYear(), getActiveTerm()])
  const classes = await ClassModel.find({ active: true }).sort({ order: 1 }).lean()
  const dorms = await Dormitory.find({ active: true }).lean()
  const existing = await Student.countDocuments()

  const firstNames = ['Aline', 'Eric', 'Chantal', 'Patrick', 'Divine', 'Jean', 'Sandrine', 'Emmanuel', 'Claudine', 'Samuel', 'Grace', 'Yves']
  const lastNames = ['Uwase', 'Nkurunziza', 'Mukamana', 'Habimana', 'Ingabire', 'Mugisha', 'Uwimana', 'Bizimana']

  if (existing < 12) {
    for (let i = 0; i < 24; i++) {
      const cls = classes[i % classes.length]
      if (!cls) continue
      const first = firstNames[i % firstNames.length]!
      const last = lastNames[i % lastNames.length]!
      const studentNumber = String(i + 1).padStart(4, '0')
      const studentId = `STD-${year.name.slice(0, 4)}-${studentNumber}`
      if (await Student.exists({ studentId })) continue
      const doc = await Student.create({
        studentId,
        admissionNumber: `ADM-${year.name.slice(0, 4)}-${studentNumber}`,
        firstName: first,
        lastName: last,
        fullName: `${first} ${last}`,
        gender: i % 2 === 0 ? 'female' : 'male',
        classId: cls._id,
        streamId: cls.streamId ?? null,
        dormitoryId: dorms[i % dorms.length]?._id ?? null,
        academicYearId: year._id,
        termId: term._id,
        currentTermId: term._id,
        currentBalance: 0,
        balanceVersion: 0,
        status: 'active',
        createdBy: admin._id,
      })
      await ensureInitialAllocation(doc, { _id: term._id, startingMarks: term.startingMarks, academicYearId: year._id })

      if (i < 8) {
        const parent = await Parent.create({
          name: `${last} Family`,
          relationship: 'Guardian',
          phone: `+25078${String(1000000 + i)}`,
          email: i < 3 ? `guardian${i + 1}@example.rw` : undefined,
          preferredChannel: 'sms',
          smsConsent: true,
          portalUserId: i < 2 ? parentUser._id : undefined,
          createdBy: admin._id,
        })
        await GuardianLink.create({ studentId: doc._id, parentId: parent._id, relationship: 'Guardian', isPrimary: true })
      }
    }
    logger.info('Demo students created')
  }

  const settingsAfter = await getSettings()
  settingsAfter.discipline.requireReview = true
  settingsAfter.comms.whatsappEnabled = false
  await settingsAfter.save()

  const adminCtx = await getUserContext(admin._id)
  const headCtx = await getUserContext(headteacher._id)
  const students = await Student.find({ status: 'active' }).sort({ createdAt: 1 }).limit(10)
  const offences = await Offence.find({ active: true, severity: { $in: ['minor', 'moderate'] }, requiresEvidence: { $ne: true } }).lean()

  const dayAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
  for (let i = 0; i < Math.min(8, students.length); i++) {
    const student = students[i]!
    const offence = offences[i % offences.length]
    if (!offence) continue
    const existingIncidents = await (await import('../models/discipline.js')).Incident.countDocuments({ studentId: student._id })
    if (existingIncidents > 0) continue
    try {
      const incident = await createIncident(headCtx, {
        studentId: String(student._id),
        offenceId: String(offence._id),
        description: `Demo record: ${offence.description}`,
        occurredAt: dayAgo(i + 1),
        location: 'Classroom',
        clientSubmissionId: `demo-${String(student._id)}-${i}`,
      })
      await submitIncident(headCtx, String(incident._id))
      await reviewIncident(adminCtx, String(incident._id), { decision: 'approve', comments: 'Reviewed against school policy.' })
      await evaluateStudentRisk(student._id, 'Demo seed evaluation', { userId: headteacher._id, name: headteacher.name })
    } catch (err) {
      logger.warn({ err, student: student.fullName }, 'Could not create demo incident')
    }
  }

  if ((await Recognition.countDocuments()) === 0) {
    for (let i = 0; i < 4 && i < students.length; i++) {
      const student = students[i]!
      await Recognition.create({
        studentId: student._id,
        title: ['Outstanding class participation', 'Helping a fellow student', 'Best improvement', 'Community service'][i],
        description: 'Positive behaviour recorded by a teacher during the demo term.',
        points: 3,
        category: 'positive_behaviour',
        awardedBy: teacher._id,
        termId: term._id,
        academicYearId: year._id,
      })
    }
  }

  if ((await Intervention.countDocuments()) === 0 && students[0]) {
    await Intervention.create({
      studentId: students[0]._id,
      type: 'behaviour_plan',
      title: 'Behaviour improvement plan',
      plan: 'Weekly check-in with the class teacher, daily conduct tracking and a review of conduct goals.',
      assignedTo: teacher._id,
      status: 'in_progress',
      startDate: new Date(),
      reviewDate: new Date(Date.now() + 14 * 86_400_000),
      createdBy: headteacher._id,
    })
    await FollowUp.create({
      studentId: students[0]._id,
      type: 'behaviour_check',
      notes: 'Review progress against the behaviour improvement plan.',
      assignedTo: teacher._id,
      dueDate: new Date(Date.now() + 7 * 86_400_000),
      status: 'pending',
      createdBy: headteacher._id,
    })
  }

  console.log('\nDemo accounts (password: ' + PASSWORD + ')')
  console.log('  Admin:       admin@conductnexus.rw')
  console.log('  Headteacher: headteacher@conductnexus.rw')
  console.log('  Teacher:     teacher@conductnexus.rw')
  console.log('  Parent:      parent@conductnexus.rw\n')
  logger.info('Demo seed complete')
  await disconnectDatabase()
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Demo seed failed')
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
