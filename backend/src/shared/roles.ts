import { PERMISSION_KEYS } from './permissions.js'

export type RoleKey =
  | 'ADMIN'
  | 'HEADTEACHER'
  | 'TEACHER'
  | 'DEPUTY_DISCIPLINE'
  | 'IT'
  | 'PATRON'
  | 'MATRON'
  | 'BURSAR'
  | 'DOS'
  | 'LIBRARIAN'
  | 'SECRETARY'
  | 'PARENT'

export type RoleSeed = {
  key: RoleKey
  name: string
  description: string
  permissions: string[]
}

const all = PERMISSION_KEYS

const admin = all.filter(
  (k) =>
    !k.startsWith('safeguarding.') &&
    !k.startsWith('investigations.decide') &&
    !k.startsWith('appeals.decide') &&
    !k.startsWith('meetings.notes.') &&
    k !== 'safeguarding.evidence.view' &&
    k !== 'portal.view_children',
)

const headteacher = [
  'users.view', 'settings.manage', 'audit.view', 'reports.view', 'reports.export', 'analytics.view',
  'calendar.view', 'calendar.manage', 'notifications.view', 'notifications.manage',
  'students.view', 'students.view_all', 'students.view_assigned', 'students.update', 'students.archive',
  'students.restore', 'students.lifecycle', 'students.manage_guardians', 'students.documents', 'students.activity.view',
  'students.promote', 'students.promote.approve',
  'classes.view', 'dormitories.view', 'academic_years.manage', 'terms.manage',
  'incidents.view', 'incidents.view_all', 'incidents.review', 'incidents.escalate', 'incidents.close',
  'marks.view', 'marks.adjust.approve', 'marks.reverse', 'risk.view', 'risk.manage', 'risk.escalate',
  'blacklist.view', 'blacklist.manage', 'interventions.view', 'interventions.manage',
  'followups.view', 'followups.manage', 'parents.view', 'parent_contacts.view',
  'letters.view', 'letters.create', 'letters.approve', 'letters.issue',
  'safeguarding.view', 'safeguarding.assign', 'safeguarding.escalate', 'safeguarding.close',
  'safeguarding.evidence.view', 'investigations.view', 'investigations.assign', 'investigations.decide',
  'investigations.close', 'appeals.view', 'appeals.decide', 'recognition.view', 'evidence.view',
  'policies.view', 'meetings.view', 'meetings.manage', 'meetings.notes.view',
  'data_protection.view', 'data_protection.manage', 'data_protection.export', 'offences.view',
]

const deputy = [
  'reports.view', 'reports.export', 'analytics.view', 'calendar.view', 'calendar.manage',
  'notifications.view', 'notifications.manage', 'users.view',
  'students.view', 'students.view_all', 'students.update', 'students.import', 'students.export',
  'students.promote', 'students.restore', 'students.lifecycle', 'students.manage_guardians', 'students.documents',
  'students.activity.view', 'classes.view', 'dormitories.view',
  'incidents.view', 'incidents.view_all', 'incidents.create', 'incidents.update', 'incidents.submit',
  'incidents.review', 'incidents.escalate', 'incidents.close', 'marks.view', 'marks.deduct', 'marks.reward',
  'marks.adjust.request', 'marks.adjust.approve', 'marks.reverse', 'risk.view', 'risk.manage', 'risk.escalate',
  'blacklist.view', 'blacklist.manage', 'interventions.view', 'interventions.manage', 'followups.view',
  'followups.manage', 'parents.view', 'parents.manage', 'parent_contacts.view', 'parent_contacts.manage',
  'letters.view', 'letters.create', 'letters.approve', 'letters.issue', 'templates.manage',
  'safeguarding.view', 'safeguarding.create', 'safeguarding.escalate',
  'investigations.view', 'investigations.create', 'investigations.assign', 'investigations.evidence',
  'investigations.close', 'appeals.view', 'recognition.view', 'recognition.manage', 'evidence.view',
  'evidence.upload', 'evidence.review', 'policies.view', 'meetings.view', 'meetings.manage',
  'meetings.notes.view', 'offences.view', 'offences.manage', 'data_protection.view',
]

const teacher = [
  'students.view', 'students.view_assigned', 'incidents.view_assigned', 'incidents.create',
  'incidents.update', 'incidents.submit', 'marks.view', 'marks.adjust.request', 'risk.view',
  'interventions.view', 'followups.view', 'followups.manage', 'recognition.view', 'recognition.create',
  'evidence.view', 'evidence.upload', 'policies.view', 'meetings.view', 'calendar.view',
  'notifications.view', 'offences.view', 'letters.view', 'students.activity.view',
]

const it = [
  'users.view', 'system.monitor', 'backups.manage', 'integrations.manage', 'audit.view',
  'whatsapp.manage', 'notifications.manage', 'data_protection.view', 'settings.manage',
]

const patron = [
  'students.view', 'students.view_assigned', 'incidents.view_assigned', 'incidents.create',
  'risk.view', 'interventions.view', 'interventions.manage', 'followups.view', 'followups.manage',
  'recognition.view', 'recognition.create', 'recognition.manage', 'safeguarding.view',
  'safeguarding.create', 'evidence.upload', 'policies.view', 'meetings.view', 'meetings.manage',
  'calendar.view', 'calendar.manage', 'notifications.view', 'parents.view', 'students.activity.view',
]

const matron = [
  'students.view', 'students.view_assigned', 'incidents.view_assigned', 'incidents.create',
  'risk.view', 'interventions.view', 'followups.view', 'followups.manage', 'recognition.view',
  'recognition.create', 'safeguarding.create', 'policies.view', 'meetings.view', 'calendar.view',
  'notifications.view',
]

const bursar = ['students.view', 'notifications.view', 'calendar.view', 'policies.view']

const dos = [
  'students.view', 'students.view_all', 'students.promote', 'students.documents', 'students.activity.view',
  'classes.view', 'dormitories.view', 'reports.view',
  'reports.export', 'analytics.view', 'incidents.view', 'incidents.view_all', 'marks.view', 'risk.view',
  'interventions.view', 'interventions.manage', 'followups.view', 'followups.manage', 'recognition.view',
  'recognition.manage', 'policies.view', 'meetings.view', 'meetings.manage', 'calendar.view',
  'calendar.manage', 'notifications.view',
]

const librarian = [
  'students.view', 'incidents.create', 'notifications.view', 'policies.view', 'calendar.view',
  'recognition.create', 'evidence.upload',
]

const secretary = [
  'students.view', 'students.update', 'students.manage_guardians', 'students.documents', 'students.activity.view',
  'parents.view', 'parents.manage', 'parent_contacts.view',
  'parent_contacts.manage', 'letters.view', 'letters.create', 'letters.issue', 'meetings.view',
  'meetings.manage', 'calendar.view', 'calendar.manage', 'notifications.view', 'notifications.manage',
  'policies.view', 'reports.view', 'evidence.upload', 'students.export',
]

export const ROLE_SEEDS: RoleSeed[] = [
  { key: 'ADMIN', name: 'Administrator', description: 'System configuration, user administration and school setup.', permissions: admin },
  { key: 'HEADTEACHER', name: 'Headteacher', description: 'School leadership, serious case approval and oversight.', permissions: headteacher },
  { key: 'TEACHER', name: 'Teacher', description: 'Record student behaviour and monitor assigned students.', permissions: teacher },
  { key: 'DEPUTY_DISCIPLINE', name: 'Deputy Headteacher — Discipline', description: 'Central discipline operations, reviews and case management.', permissions: deputy },
  { key: 'IT', name: 'IT Officer', description: 'Technical administration, monitoring and infrastructure.', permissions: it },
  { key: 'PATRON', name: 'Patron', description: 'Student support, counselling follow-ups and wellbeing.', permissions: patron },
  { key: 'MATRON', name: 'Matron', description: 'Boarding and dormitory student support.', permissions: matron },
  { key: 'BURSAR', name: 'Bursar', description: 'Financial administration with limited student access.', permissions: bursar },
  { key: 'DOS', name: 'Dean of Studies', description: 'Academic administration and conduct coordination.', permissions: dos },
  { key: 'LIBRARIAN', name: 'Librarian', description: 'Library administration and incident reporting.', permissions: librarian },
  { key: 'SECRETARY', name: 'Secretary', description: 'Administrative records, parent contacts and official letters.', permissions: secretary },
  { key: 'PARENT', name: 'Parent / Guardian', description: 'Optional parent portal access to linked children only.', permissions: ['portal.view_children'] },
]

export const ROLE_KEY_SET = new Set(ROLE_SEEDS.map((r) => r.key))
