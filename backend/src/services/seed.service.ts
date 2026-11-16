import { env } from '../config/env.js'
import { getSettings, Permission, Role, RolePermission, User, UserRole } from '../models/core.js'
import { AcademicYear, ClassModel, Dormitory, Stream, Term } from '../models/school.js'
import { LetterTemplate, NotificationTemplate, WhatsappSession } from '../models/communications.js'
import { Offence, Policy } from '../models/discipline.js'
import { PERMISSIONS } from '../shared/permissions.js'
import { ROLE_SEEDS } from '../shared/roles.js'
import { logger } from '../shared/logger.js'
import {
  LETTER_TEMPLATE_LIBRARY,
  NOTIFICATION_TEMPLATE_LIBRARY,
  extractPlaceholders,
} from '../data/templateLibrary.js'

export async function seedRbac(): Promise<void> {
  await Permission.bulkWrite(
    PERMISSIONS.map((p) => ({
      updateOne: {
        filter: { key: p.key },
        update: { $set: { key: p.key, label: p.label, group: p.group } },
        upsert: true,
      },
    })),
  )

  for (const roleSeed of ROLE_SEEDS) {
    const role = await Role.findOneAndUpdate(
      { key: roleSeed.key },
      { $set: { name: roleSeed.name, description: roleSeed.description }, $setOnInsert: { isSystem: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    if (!role) continue
    await RolePermission.bulkWrite(
      roleSeed.permissions.map((permission) => ({
        updateOne: {
          filter: { roleId: role._id, permission },
          update: { $setOnInsert: { roleId: role._id, permission } },
          upsert: true,
        },
      })),
    )
  }
  logger.info('RBAC seeded')
}

function academicYearWindow(now = new Date()) {
  const y = now.getFullYear()
  const startYear = now.getMonth() >= 7 ? y : y - 1
  return {
    name: `${startYear}-${startYear + 1}`,
    start: new Date(Date.UTC(startYear, 8, 1)),
    end: new Date(Date.UTC(startYear + 1, 6, 31)),
    startYear,
  }
}

export async function seedSchoolDefaults(opts: {
  schoolName?: string
  schoolEmail?: string
  schoolPhone?: string
} = {}): Promise<void> {
  const settings = await getSettings()
  if (opts.schoolName) settings.school.name = opts.schoolName
  if (!settings.school.name) settings.school.name = env.SCHOOL_NAME || 'ConductNexus Demonstration Secondary School'
  if (opts.schoolEmail) settings.school.email = opts.schoolEmail
  if (opts.schoolPhone) settings.school.phone = opts.schoolPhone
  settings.academic.startingMarks = settings.academic.startingMarks || 40
  settings.backup.schedule = env.BACKUP_SCHEDULE
  settings.backup.retentionDays = env.BACKUP_RETENTION_DAYS
  await settings.save()

  const streams = [
    { name: 'Accounting', code: 'ACC', level: 'A' as const },
    { name: 'Software Development', code: 'SD', level: 'A' as const },
  ]
  const streamDocs: Record<string, unknown> = {}
  for (const s of streams) {
    const doc = await Stream.findOneAndUpdate(
      { code: s.code },
      { $setOnInsert: { ...s, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    streamDocs[s.code] = doc?._id
  }

  const classes = [
    { name: 'S1', level: 'O', streamId: null, order: 1 },
    { name: 'S2', level: 'O', streamId: null, order: 2 },
    { name: 'S3', level: 'O', streamId: null, order: 3 },
    { name: 'S4', level: 'A', streamId: streamDocs.ACC, order: 4 },
    { name: 'S5', level: 'A', streamId: streamDocs.ACC, order: 5 },
    { name: 'S6', level: 'A', streamId: streamDocs.ACC, order: 6 },
    { name: 'L3', level: 'A', streamId: streamDocs.SD, order: 7 },
    { name: 'L4', level: 'A', streamId: streamDocs.SD, order: 8 },
    { name: 'L5', level: 'A', streamId: streamDocs.SD, order: 9 },
  ]
  for (const c of classes) {
    await ClassModel.findOneAndUpdate(
      { name: c.name },
      { $setOnInsert: { ...c, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

  for (const d of [
    { name: 'Dormitory D1', code: 'D1', capacity: 60, gender: 'male' as const },
    { name: 'Dormitory D2', code: 'D2', capacity: 60, gender: 'female' as const },
    { name: 'Dormitory D3', code: 'D3', capacity: 40, gender: 'mixed' as const },
  ]) {
    await Dormitory.findOneAndUpdate(
      { code: d.code },
      { $setOnInsert: { ...d, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

  const win = academicYearWindow()
  let year = await AcademicYear.findOne({ name: win.name })
  if (!year) {
    year = await AcademicYear.create({
      name: win.name,
      startDate: win.start,
      endDate: win.end,
      isActive: true,
      status: 'active',
    })
  }
  const termSeeds = [
    { name: 'Term 1', number: 1, start: new Date(Date.UTC(win.startYear, 8, 1)), end: new Date(Date.UTC(win.startYear, 11, 15)) },
    { name: 'Term 2', number: 2, start: new Date(Date.UTC(win.startYear + 1, 0, 8)), end: new Date(Date.UTC(win.startYear + 1, 3, 4)) },
    { name: 'Term 3', number: 3, start: new Date(Date.UTC(win.startYear + 1, 3, 21)), end: new Date(Date.UTC(win.startYear + 1, 6, 10)) },
  ]
  const now = new Date()
  const activeTerm = termSeeds.find((t) => now >= t.start && now <= t.end) ?? termSeeds[0]
  for (const t of termSeeds) {
    await Term.findOneAndUpdate(
      { academicYearId: year._id, number: t.number },
      {
        $setOnInsert: {
          academicYearId: year._id,
          name: t.name,
          number: t.number,
          startDate: t.start,
          endDate: t.end,
          startingMarks: settings.academic.startingMarks,
          isActive: t.number === activeTerm.number,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

  const policy = await Policy.findOneAndUpdate(
    { title: 'School Discipline Policy', version: '1.0' },
    {
      $setOnInsert: {
        type: 'discipline',
        summary: 'Official conduct expectations, offence categories and approved deduction scales.',
        content:
          '<h2>1. Purpose</h2><p>This policy defines expected student conduct, the approved deduction scale and the review process used by ConductNexus.</p>' +
          '<h2>2. Conduct marks</h2><p>Each student begins every term with 40 conduct marks. Deductions are applied only after the required review and approval.</p>' +
          '<h2>3. Due process</h2><p>Every recorded incident may be reviewed, and the student may appeal a disciplinary decision within the configured appeal window.</p>' +
          '<h2>4. Positive behaviour</h2><p>Positive behaviour, achievements and improvement are recorded alongside sanctions.</p>',
        effectiveDate: win.start,
        published: true,
        offenceCategories: ['Attendance', 'Uniform', 'Classroom conduct', 'Integrity', 'Violence', 'Property', 'Substances'],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  const offences = [
    { code: 'LATE', name: 'Lateness', category: 'Attendance', deduction: 2, severity: 'minor' as const, description: 'Arriving late to class or school activities.' },
    { code: 'UNIFORM', name: 'Wrong uniform', category: 'Uniform', deduction: 3, severity: 'minor' as const, description: 'Not wearing the approved school uniform.' },
    { code: 'PHONE', name: 'Phone use in class', category: 'Classroom conduct', deduction: 5, severity: 'moderate' as const, description: 'Using a mobile phone during lessons without permission.' },
    { code: 'CHEAT', name: 'Cheating', category: 'Integrity', deduction: 8, severity: 'serious' as const, description: 'Dishonest conduct during assessments.', requiresEvidence: true },
    { code: 'FIGHT', name: 'Fighting', category: 'Violence', deduction: 10, severity: 'serious' as const, description: 'Physical altercation with another student.', requiresEvidence: true },
    { code: 'BULLY', name: 'Bullying', category: 'Violence', deduction: 8, severity: 'serious' as const, description: 'Repeated harmful behaviour towards another student.', requiresEvidence: true },
    { code: 'DISRESPECT', name: 'Disrespect', category: 'Classroom conduct', deduction: 4, severity: 'moderate' as const, description: 'Disrespectful conduct towards staff or students.' },
    { code: 'SKIP', name: 'Absence from class', category: 'Attendance', deduction: 2, severity: 'minor' as const, description: 'Missing a scheduled lesson without authorization.' },
    { code: 'THEFT', name: 'Theft', category: 'Property', deduction: 10, severity: 'critical' as const, description: 'Taking property that belongs to another person.', requiresEvidence: true },
    { code: 'VANDAL', name: 'Vandalism', category: 'Property', deduction: 6, severity: 'moderate' as const, description: 'Damaging school or student property.', requiresEvidence: true },
    { code: 'SUBSTANCE', name: 'Substance use', category: 'Substances', deduction: 12, severity: 'critical' as const, description: 'Possession or use of prohibited substances.', requiresEvidence: true },
  ]
  for (const o of offences) {
    await Offence.findOneAndUpdate(
      { code: o.code },
      { $setOnInsert: { ...o, requiresApproval: true, notifyParent: true, active: true, policyId: policy?._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

  await seedLetterTemplates()
  await seedNotificationTemplates()



  await WhatsappSession.findOneAndUpdate(
    { sessionName: env.WHATSAPP_SESSION },
    { $setOnInsert: { status: env.ENABLE_WHATSAPP ? 'disconnected' : 'disabled' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  logger.info('School defaults seeded')
}

export async function seedAdminFromEnv(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return
  const email = env.ADMIN_EMAIL.toLowerCase()
  let user = await User.findOne({ email })
  if (!user) {
    const { hashPassword, passwordSchema } = await import('./auth.service.js')
    if (!passwordSchema(env.ADMIN_PASSWORD)) {
      throw new Error('ADMIN_PASSWORD must be at least 10 characters with uppercase, lowercase and a number')
    }
    user = await User.create({
      name: env.ADMIN_NAME,
      email,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      emailVerified: true,
      status: 'active',
      position: 'System Administrator',
    })
    logger.info({ email }, 'Admin account created')
  }
  const adminRole = await Role.findOne({ key: 'ADMIN' })
  if (adminRole) {
    await UserRole.updateOne(
      { userId: user._id, roleId: adminRole._id },
      { $setOnInsert: { userId: user._id, roleId: adminRole._id, assignedAt: new Date() } },
      { upsert: true },
    )
  }
  const settings = await getSettings()
  settings.setupCompleted = true
  await settings.save()
}

/**
 * Upserts the notification template library as one record per language.
 *
 * Existing records are never deleted. A legacy record (one that has no
 * `originalBody`, i.e. it predates the library) is upgraded to the canonical
 * professional wording; once a record carries originals, administrator edits are
 * preserved and only genuinely new templates are inserted.
 */
export async function seedNotificationTemplates(): Promise<void> {
  for (const tpl of NOTIFICATION_TEMPLATE_LIBRARY) {
    const variants: { key: string; language: 'en' | 'rw'; subject: string; body: string }[] = [
      { key: tpl.key, language: 'en', subject: tpl.en.subject, body: tpl.en.body },
      { key: `${tpl.key}_rw`, language: 'rw', subject: tpl.rw.subject, body: tpl.rw.body },
    ]

    for (const v of variants) {
      const existing = await NotificationTemplate.findOne({ key: v.key }).lean()
      if (!existing) {
        await NotificationTemplate.create({
          key: v.key,
          name: v.language === 'rw' ? tpl.nameRw : tpl.name,
          description: tpl.description,
          category: tpl.category,
          channel: tpl.channel,
          subject: v.subject,
          body: v.body,
          placeholders: extractPlaceholders(v.subject, v.body),
          active: true,
          language: v.language,
          originalSubject: v.subject,
          originalBody: v.body,
          version: 1,
        })
        continue
      }
      if (!existing.originalBody) {
        await NotificationTemplate.updateOne(
          { _id: existing._id },
          {
            $set: {
              name: v.language === 'rw' ? tpl.nameRw : tpl.name,
              description: tpl.description,
              category: tpl.category,
              channel: tpl.channel,
              subject: v.subject,
              body: v.body,
              placeholders: extractPlaceholders(v.subject, v.body),
              language: v.language,
              originalSubject: v.subject,
              originalBody: v.body,
              version: 1,
            },
          },
        )
      }
    }
  }
}

/**
 * Upserts the official letter template library. Like notification templates,
 * legacy records are upgraded once to carry originals; later administrator edits
 * are preserved.
 */
export async function seedLetterTemplates(): Promise<void> {
  for (const tpl of LETTER_TEMPLATE_LIBRARY) {
    const existing = await LetterTemplate.findOne({ type: tpl.type }).lean()
    const placeholders = extractPlaceholders(tpl.en.subject, tpl.en.body, tpl.rw.subject, tpl.rw.body)

    if (!existing) {
      await LetterTemplate.create({
        type: tpl.type,
        name: tpl.name,
        nameRw: tpl.nameRw,
        description: tpl.description,
        category: tpl.category,
        subject: tpl.en.subject,
        body: tpl.en.body,
        subjectRw: tpl.rw.subject,
        bodyRw: tpl.rw.body,
        placeholders,
        active: true,
        originalSubject: tpl.en.subject,
        originalBody: tpl.en.body,
        originalSubjectRw: tpl.rw.subject,
        originalBodyRw: tpl.rw.body,
        version: 1,
      })
      continue
    }

    if (!existing.originalBody || !existing.bodyRw) {
      await LetterTemplate.updateOne(
        { _id: existing._id },
        {
          $set: {
            name: tpl.name,
            nameRw: tpl.nameRw,
            description: tpl.description,
            category: tpl.category,
            subject: tpl.en.subject,
            body: tpl.en.body,
            subjectRw: tpl.rw.subject,
            bodyRw: tpl.rw.body,
            placeholders,
            originalSubject: tpl.en.subject,
            originalBody: tpl.en.body,
            originalSubjectRw: tpl.rw.subject,
            originalBodyRw: tpl.rw.body,
            version: 1,
          },
        },
      )
    }
  }
}
