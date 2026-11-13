import { env } from '../config/env.js'
import { getSettings, Permission, Role, RolePermission, User, UserRole } from '../models/core.js'
import { AcademicYear, ClassModel, Dormitory, Stream, Term } from '../models/school.js'
import { LetterTemplate, NotificationTemplate, WhatsappSession } from '../models/communications.js'
import { Offence, Policy } from '../models/discipline.js'
import { PERMISSIONS } from '../shared/permissions.js'
import { ROLE_SEEDS } from '../shared/roles.js'
import { logger } from '../shared/logger.js'

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

  const letterTemplates = [
    {
      type: 'warning',
      name: 'Disciplinary warning letter',
      subject: 'Official warning regarding {{studentName}}',
      body:
        'Dear {{parentName}},\n\nThis letter is to formally warn you about the conduct of {{studentName}} ({{studentId}}, {{className}}).\n\nIncident: {{incidentNumber}} — {{offenceName}}\nDate: {{incidentDate}}\nApproved deduction: {{deduction}} marks\nRemaining conduct marks: {{balance}}\n\nWe request your support in addressing this matter. Please contact the school for clarification.\n\nYours sincerely,\n{{schoolName}}',
    },
    {
      type: 'parent_meeting_invitation',
      name: 'Parent meeting invitation',
      subject: 'Invitation to meet regarding {{studentName}}',
      body:
        'Dear {{parentName}},\n\nYou are invited to meet the school discipline team regarding {{studentName}} ({{className}}).\n\nDate: {{meetingDate}}\nTime: {{meetingTime}}\nVenue: {{venue}}\n\nPlease confirm your attendance.\n\nYours sincerely,\n{{schoolName}}',
    },
    {
      type: 'serious_incident',
      name: 'Serious incident notification',
      subject: 'Serious incident notification — {{studentName}}',
      body:
        'Dear {{parentName}},\n\nWe are notifying you of a serious incident involving {{studentName}} on {{incidentDate}}.\n\nReference: {{incidentNumber}}\n\nA member of the school leadership team will contact you. Confidential investigation details are not shared in this notice.\n\nYours sincerely,\n{{schoolName}}',
    },
    {
      type: 'hearing_invitation',
      name: 'Disciplinary hearing invitation',
      subject: 'Disciplinary hearing — {{studentName}}',
      body:
        'Dear {{parentName}},\n\nYou and {{studentName}} are invited to a disciplinary hearing.\n\nReference: {{caseNumber}}\nDate: {{meetingDate}}\nTime: {{meetingTime}}\nVenue: {{venue}}\n\nYou may bring supporting evidence and may be accompanied by a guardian.\n\nYours sincerely,\n{{schoolName}}',
    },
    {
      type: 'suspension',
      name: 'Suspension letter',
      subject: 'Suspension decision — {{studentName}}',
      body:
        'Dear {{parentName}},\n\nFollowing a disciplinary decision, {{studentName}} ({{className}}) has been suspended in accordance with school policy.\n\nDecision reference: {{decisionRef}}\nEffective date: {{effectiveDate}}\nDuration: {{duration}}\n\nYou may appeal this decision within the timeframe stated in the school handbook.\n\nYours sincerely,\n{{schoolName}}',
    },
    {
      type: 'expulsion_recommendation',
      name: 'Expulsion recommendation',
      subject: 'Expulsion recommendation — {{studentName}}',
      body:
        'Dear Parent/Guardian,\n\nThe school leadership has recommended expulsion for {{studentName}} following case {{decisionRef}}. This recommendation requires Headteacher approval before it becomes final.\n\nYours sincerely,\n{{schoolName}}',
    },
    {
      type: 'expulsion_decision',
      name: 'Expulsion decision',
      subject: 'Expulsion decision — {{studentName}}',
      body:
        'Dear Parent/Guardian,\n\nFollowing due process, the Headteacher has approved the expulsion of {{studentName}} ({{className}}) effective {{effectiveDate}}.\n\nDecision reference: {{decisionRef}}\n\nAppeal rights and procedures are set out in the school handbook.\n\nYours sincerely,\n{{schoolName}}',
    },
    {
      type: 'conduct_report',
      name: 'Student conduct report',
      subject: 'Conduct report — {{studentName}}',
      body:
        'Dear {{parentName}},\n\nPlease find the conduct summary for {{studentName}} ({{className}}) for {{termName}}.\n\nStarting marks: {{startingMarks}}\nDeductions: {{deductions}}\nRewards: {{rewards}}\nCurrent balance: {{balance}}\n\nYours sincerely,\n{{schoolName}}',
    },
    {
      type: 'improvement_notice',
      name: 'Student improvement notice',
      subject: 'Conduct improvement plan — {{studentName}}',
      body:
        'Dear {{parentName}},\n\n{{studentName}} is participating in a behaviour improvement plan with the support of {{supportStaff}}.\n\nNext review: {{reviewDate}}\n\nWe appreciate your partnership.\n\nYours sincerely,\n{{schoolName}}',
    },
  ]
  for (const t of letterTemplates) {
    await LetterTemplate.findOneAndUpdate(
      { type: t.type, name: t.name },
      { $setOnInsert: { ...t, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

  const notificationTemplates = [
    {
      key: 'incident_deduction',
      name: 'Discipline deduction alert',
      channel: 'whatsapp' as const,
      subject: 'Conduct update for {{studentName}}',
      body:
        'Dear Parent/Guardian,\n\nThis is to inform you that {{studentName}} was involved in the following incident:\n\nIncident: {{offenceName}}\nDate: {{incidentDate}}\nMarks deducted: {{deduction}}\nRemaining conduct marks: {{balance}}\n\nPlease contact the school if further clarification is required.\n\nConductNexus — School Discipline Management.',
    },
    {
      key: 'serious_incident',
      name: 'Serious incident alert',
      channel: 'whatsapp' as const,
      subject: 'Important school notice',
      body:
        'Dear Parent/Guardian,\n\nA serious incident involving {{studentName}} has been recorded and is under review. A member of the school leadership team will contact you.\n\nConductNexus — School Discipline Management.',
    },
    {
      key: 'high_risk',
      name: 'High-risk student alert',
      channel: 'in_app' as const,
      subject: 'Student risk escalation',
      body: '{{studentName}} ({{className}}) has moved to {{riskLevel}} risk. Current conduct balance: {{balance}}.',
    },
    {
      key: 'meeting_invitation',
      name: 'Meeting invitation',
      channel: 'whatsapp' as const,
      subject: 'Meeting invitation',
      body:
        'Dear Parent/Guardian,\n\nYou are invited to a meeting regarding {{studentName}} on {{meetingDate}} at {{meetingTime}}.\n\nVenue: {{venue}}\n\nConductNexus — School Discipline Management.',
    },
    {
      key: 'warning_letter',
      name: 'Warning letter notice',
      channel: 'whatsapp' as const,
      subject: 'Official letter issued',
      body: 'An official {{letterType}} letter has been issued for {{studentName}}. Please check your email or contact the school.',
    },
    {
      key: 'follow_up_reminder',
      name: 'Follow-up reminder',
      channel: 'in_app' as const,
      subject: 'Follow-up due',
      body: 'Follow-up for {{studentName}} is due on {{dueDate}}.',
    },
    {
      key: 'conduct_improvement',
      name: 'Conduct improvement notification',
      channel: 'whatsapp' as const,
      subject: 'Positive conduct update',
      body: 'We are pleased to share that {{studentName}} has been recognised for positive behaviour: {{title}}.',
    },
  ]
  for (const t of notificationTemplates) {
    await NotificationTemplate.findOneAndUpdate(
      { key: t.key },
      { $setOnInsert: { ...t, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

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
