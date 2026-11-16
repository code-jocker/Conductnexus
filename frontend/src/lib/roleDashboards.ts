import type { Dashboard } from '../lib/types'

/**
 * Role-specific dashboard definitions.
 *
 * Every number rendered by these dashboards comes from
 * `GET /analytics/dashboard`, which already scopes its queries to the caller's
 * permissions (`services/analytics.service.ts`). This file only decides which of
 * those real figures each role leads with and which widgets they are allowed to
 * see — it never fabricates data.
 */

export type StatTone = 'brand' | 'ochre' | 'amber' | 'red' | 'emerald' | 'slate'

export type StatDef = {
  label: string
  value: number | string
  hint: string
  tone: StatTone
  href: string
}

export type WidgetKey =
  | 'trend'
  | 'risk'
  | 'recentIncidents'
  | 'highRisk'
  | 'approvals'
  | 'followUps'
  | 'classAverages'
  | 'users'
  | 'audit'
  | 'queue'
  | 'whatsapp'
  | 'safeguarding'
  | 'investigations'
  | 'appeals'
  | 'letters'
  | 'parents'
  | 'recognition'
  | 'meetings'
  | 'notifications'

export type RoleDashboard = {
  eyebrow: string
  headline: string
  subtitle: string
  stats: (data: Dashboard) => StatDef[]
  widgets: WidgetKey[]
  quickActions: { label: string; href: string }[]
}

const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0))

function unread(data: Dashboard): number {
  const value = data.extra?.unreadNotifications
  return typeof value === 'number' ? value : 0
}

function queueValue(data: Dashboard, ...keys: string[]): number {
  const queue = data.extra?.queue
  if (!queue || typeof queue !== 'object') return 0
  const block = queue as Record<string, unknown>
  for (const key of keys) {
    const value = block[key]
    if (typeof value === 'number') return value
  }
  return 0
}

function extraNumber(data: Dashboard, key: string, field: string): number {
  const block = data.extra?.[key]
  if (!block || typeof block !== 'object') return 0
  return n((block as Record<string, unknown>)[field])
}

/* ── ADMIN ─────────────────────────────────────────────────────────────────── */

const admin: RoleDashboard = {
  eyebrow: 'System administration',
  headline: 'Platform overview',
  subtitle: 'Users, structure, integrations, audit trail and operational health.',
  stats: (d) => [
    { label: 'Active users', value: extraNumber(d, 'users', 'active'), hint: `${extraNumber(d, 'users', 'total')} total accounts`, tone: 'brand', href: '/users' },
    { label: 'Roles configured', value: extraNumber(d, 'users', 'roles'), hint: 'Role and permission matrix', tone: 'slate', href: '/users' },
    { label: 'Students on roll', value: d.metrics.students, hint: 'Active students this term', tone: 'emerald', href: '/students' },
    { label: 'Open incidents', value: d.metrics.incidents, hint: `${d.metrics.pendingReview} awaiting review`, tone: 'ochre', href: '/incidents' },
  ],
  widgets: ['users', 'trend', 'recentIncidents', 'audit', 'queue', 'whatsapp', 'notifications'],
  quickActions: [
    { label: 'Manage users', href: '/users' },
    { label: 'School structure', href: '/structure' },
    { label: 'Audit logs', href: '/audit' },
    { label: 'System settings', href: '/settings' },
  ],
}

/* ── HEADTEACHER ───────────────────────────────────────────────────────────── */

const headteacher: RoleDashboard = {
  eyebrow: 'Headteacher workspace',
  headline: 'School-wide discipline oversight',
  subtitle: 'Serious cases, high-level approvals, risk posture and welfare across the school.',
  stats: (d) => [
    { label: 'Students on roll', value: d.metrics.students, hint: 'Whole school', tone: 'brand', href: '/students' },
    { label: 'Pending your approval', value: d.metrics.pendingApprovals, hint: 'High-impact decisions', tone: 'amber', href: '/approvals' },
    { label: 'High / critical risk', value: n(d.metrics.highRisk) + n(d.metrics.critical), hint: `${n(d.metrics.critical)} critical`, tone: 'red', href: '/risk' },
    { label: 'Open investigations', value: extraNumber(d, 'investigations', 'open'), hint: 'Under review', tone: 'ochre', href: '/investigations' },
  ],
  widgets: ['approvals', 'risk', 'trend', 'safeguarding', 'investigations', 'appeals', 'recentIncidents', 'highRisk', 'classAverages', 'letters'],
  quickActions: [
    { label: 'Approvals', href: '/approvals' },
    { label: 'Risk & support', href: '/risk' },
    { label: 'Safeguarding', href: '/safeguarding' },
    { label: 'Reports', href: '/reports' },
  ],
}

/* ── DEPUTY_DISCIPLINE ─────────────────────────────────────────────────────── */

const deputy: RoleDashboard = {
  eyebrow: 'Discipline operations',
  headline: 'Incident and case operations centre',
  subtitle: 'Approvals, ledger activity, bulk actions, high-risk students and parent communication.',
  stats: (d) => [
    { label: 'Awaiting review', value: d.metrics.pendingReview, hint: 'Incidents to review', tone: 'amber', href: '/incidents' },
    { label: 'Pending approvals', value: d.metrics.pendingApprovals, hint: 'Your decision required', tone: 'ochre', href: '/approvals' },
    { label: 'High / critical risk', value: n(d.metrics.highRisk) + n(d.metrics.critical), hint: `${n(d.metrics.critical)} critical`, tone: 'red', href: '/risk' },
    { label: 'Open interventions', value: d.metrics.openInterventions, hint: 'Support plans in flight', tone: 'brand', href: '/risk' },
  ],
  widgets: ['approvals', 'trend', 'recentIncidents', 'highRisk', 'risk', 'followUps', 'letters', 'queue'],
  quickActions: [
    { label: 'Record incident', href: '/incidents/new' },
    { label: 'Approvals', href: '/approvals' },
    { label: 'Bulk discipline', href: '/incidents' },
    { label: 'Reports', href: '/reports' },
  ],
}

/* ── TEACHER ───────────────────────────────────────────────────────────────── */

const teacher: RoleDashboard = {
  eyebrow: 'Teacher workspace',
  headline: 'Your classes and students',
  subtitle: 'Report conduct, follow up on assigned students and track your submissions.',
  stats: (d) => [
    { label: 'Students visible', value: d.metrics.students, hint: 'Assigned to you', tone: 'brand', href: '/students' },
    { label: 'Incidents you reported', value: d.metrics.myIncidents, hint: 'All time', tone: 'ochre', href: '/incidents' },
    { label: 'Awaiting review', value: d.metrics.pendingReview, hint: 'Across your classes', tone: 'amber', href: '/incidents' },
    { label: 'Follow-ups due', value: d.metrics.upcomingFollowUps, hint: 'Assigned to you', tone: 'slate', href: '/risk' },
  ],
  widgets: ['recentIncidents', 'followUps', 'highRisk', 'recognition'],
  quickActions: [
    { label: 'Record incident', href: '/incidents/new' },
    { label: 'My students', href: '/students' },
    { label: 'Offline drafts', href: '/drafts' },
  ],
}

/* ── IT ────────────────────────────────────────────────────────────────────── */

const it: RoleDashboard = {
  eyebrow: 'IT administration',
  headline: 'Service and infrastructure health',
  subtitle: 'Database, API, security events, sessions, failed jobs and backups.',
  stats: (d) => [
    { label: 'Active users', value: extraNumber(d, 'users', 'active'), hint: `${extraNumber(d, 'users', 'total')} total`, tone: 'brand', href: '/users' },
    { label: 'Queued messages', value: queueValue(d, 'pending', 'queued'), hint: 'Awaiting delivery', tone: 'amber', href: '/communications' },
    { label: 'Failed messages', value: queueValue(d, 'failed'), hint: 'Need attention', tone: 'red', href: '/communications' },
    { label: 'Unread notifications', value: unread(d), hint: 'Your inbox', tone: 'slate', href: '/communications' },
  ],
  widgets: ['queue', 'whatsapp', 'audit', 'users', 'notifications'],
  quickActions: [
    { label: 'Monitoring', href: '/monitoring' },
    { label: 'Audit logs', href: '/audit' },
    { label: 'WhatsApp session', href: '/communications' },
    { label: 'System settings', href: '/settings' },
  ],
}

/* ── PATRON ────────────────────────────────────────────────────────────────── */

const patron: RoleDashboard = {
  eyebrow: 'Patron workspace',
  headline: 'Student welfare and support',
  subtitle: 'Assigned students, wellbeing observations, referrals and follow-ups.',
  stats: (d) => [
    { label: 'Students visible', value: d.metrics.students, hint: 'Assigned to you', tone: 'brand', href: '/students' },
    { label: 'High / critical risk', value: n(d.metrics.highRisk) + n(d.metrics.critical), hint: 'Needs support', tone: 'red', href: '/risk' },
    { label: 'Open interventions', value: d.metrics.openInterventions, hint: 'Active plans', tone: 'ochre', href: '/risk' },
    { label: 'Follow-ups due', value: d.metrics.upcomingFollowUps, hint: 'Your tasks', tone: 'amber', href: '/risk' },
  ],
  widgets: ['highRisk', 'followUps', 'recentIncidents', 'recognition', 'meetings'],
  quickActions: [
    { label: 'Risk & support', href: '/risk' },
    { label: 'Record observation', href: '/incidents/new' },
    { label: 'Meetings', href: '/meetings' },
  ],
}

/* ── MATRON ────────────────────────────────────────────────────────────────── */

const matron: RoleDashboard = {
  eyebrow: 'Matron workspace',
  headline: 'Boarding and student care',
  subtitle: 'Welfare concerns, dormitory students, referrals and follow-up appointments.',
  stats: (d) => [
    { label: 'Students visible', value: d.metrics.students, hint: 'In your care', tone: 'brand', href: '/students' },
    { label: 'High / critical risk', value: n(d.metrics.highRisk) + n(d.metrics.critical), hint: 'Priority cases', tone: 'red', href: '/risk' },
    { label: 'Follow-ups due', value: d.metrics.upcomingFollowUps, hint: 'Appointments', tone: 'amber', href: '/risk' },
    { label: 'Open interventions', value: d.metrics.openInterventions, hint: 'Care plans', tone: 'ochre', href: '/risk' },
  ],
  widgets: ['highRisk', 'followUps', 'recentIncidents', 'meetings'],
  quickActions: [
    { label: 'Welfare concerns', href: '/risk' },
    { label: 'Record concern', href: '/incidents/new' },
    { label: 'Meetings', href: '/meetings' },
  ],
}

/* ── BURSAR ────────────────────────────────────────────────────────────────── */

const bursar: RoleDashboard = {
  eyebrow: 'Bursar workspace',
  headline: 'Student records and communication',
  subtitle: 'Authorized student records, payment summaries and permitted clearance information.',
  stats: (d) => [
    { label: 'Students on roll', value: d.metrics.students, hint: 'Active students', tone: 'brand', href: '/students' },
    { label: 'Open incidents', value: d.metrics.incidents, hint: 'Recorded this term', tone: 'slate', href: '/incidents' },
    { label: 'Parents on record', value: extraNumber(d, 'parents', 'total'), hint: 'Contactable guardians', tone: 'slate', href: '/communications' },
    { label: 'Letters issued', value: n((d.extra?.letters as unknown[])?.length ?? 0), hint: 'Recently issued', tone: 'slate', href: '/communications' },
  ],
  widgets: ['letters', 'notifications'],
  quickActions: [
    { label: 'Students', href: '/students' },
    { label: 'Communication', href: '/communications' },
    { label: 'Letters', href: '/communications' },
  ],
}

/* ── DOS ───────────────────────────────────────────────────────────────────── */

const dos: RoleDashboard = {
  eyebrow: 'Dean of Studies',
  headline: 'Academic and classroom conduct',
  subtitle: 'Class and stream behaviour trends, repeat classroom incidents and referrals.',
  stats: (d) => [
    { label: 'Students on roll', value: d.metrics.students, hint: 'All classes', tone: 'brand', href: '/students' },
    { label: 'Open incidents', value: d.metrics.incidents, hint: `${d.metrics.pendingReview} awaiting review`, tone: 'ochre', href: '/incidents' },
    { label: 'High / critical risk', value: n(d.metrics.highRisk) + n(d.metrics.critical), hint: 'Needs intervention', tone: 'red', href: '/risk' },
    { label: 'Open interventions', value: d.metrics.openInterventions, hint: 'Improvement plans', tone: 'amber', href: '/risk' },
  ],
  widgets: ['trend', 'classAverages', 'recentIncidents', 'highRisk', 'risk', 'followUps'],
  quickActions: [
    { label: 'Reports', href: '/reports' },
    { label: 'Promotions', href: '/promotions' },
    { label: 'Risk & support', href: '/risk' },
  ],
}

/* ── LIBRARIAN ─────────────────────────────────────────────────────────────── */

const librarian: RoleDashboard = {
  eyebrow: 'Library workspace',
  headline: 'Library conduct and observations',
  subtitle: 'Library-related incidents, student lookup and observation submissions.',
  stats: (d) => [
    { label: 'Students on roll', value: d.metrics.students, hint: 'Lookup access', tone: 'brand', href: '/students' },
    { label: 'Incidents reported', value: d.metrics.myIncidents, hint: 'By you', tone: 'ochre', href: '/incidents' },
    { label: 'Open incidents', value: d.metrics.incidents, hint: 'School-wide record', tone: 'slate', href: '/incidents' },
    { label: 'Recognition', value: n((d.extra?.recentRecognition as unknown[])?.length ?? 0), hint: 'Recent awards', tone: 'emerald', href: '/students' },
  ],
  widgets: ['recentIncidents'],
  quickActions: [
    { label: 'Record incident', href: '/incidents/new' },
    { label: 'Find student', href: '/students' },
  ],
}

/* ── SECRETARY ─────────────────────────────────────────────────────────────── */

const secretary: RoleDashboard = {
  eyebrow: 'Secretary workspace',
  headline: 'Correspondence, meetings and records',
  subtitle: 'Letter preparation, meeting minutes, parent invitations and approved documents.',
  stats: (d) => [
    { label: 'Upcoming meetings', value: n((d.extra?.upcomingMeetings as unknown[])?.length ?? 0), hint: 'Scheduled', tone: 'brand', href: '/meetings' },
    { label: 'Letters issued', value: n((d.extra?.letters as unknown[])?.length ?? 0), hint: 'Recently issued', tone: 'ochre', href: '/communications' },
    { label: 'Parents on record', value: extraNumber(d, 'parents', 'total'), hint: 'Guardian contacts', tone: 'slate', href: '/communications' },
    { label: 'Unread notifications', value: unread(d), hint: 'Your inbox', tone: 'slate', href: '/communications' },
  ],
  widgets: ['meetings', 'letters', 'parents', 'notifications'],
  quickActions: [
    { label: 'Meetings', href: '/meetings' },
    { label: 'Letters', href: '/communications' },
    { label: 'Calendar', href: '/meetings' },
  ],
}

/* ── PARENT ────────────────────────────────────────────────────────────────── */

const parent: RoleDashboard = {
  eyebrow: 'Parent portal',
  headline: 'Your children',
  subtitle: 'Conduct progress, recognition, meetings and school communication.',
  stats: (d) => [
    { label: 'Linked children', value: d.portalChildren.length, hint: 'Authorized records', tone: 'brand', href: '/portal' },
    { label: 'Unread messages', value: unread(d), hint: 'From the school', tone: 'slate', href: '/communications' },
    { label: 'Upcoming meetings', value: n((d.extra?.upcomingMeetings as unknown[])?.length ?? 0), hint: 'Scheduled', tone: 'amber', href: '/meetings' },
    { label: 'Letters', value: n((d.extra?.letters as unknown[])?.length ?? 0), hint: 'Issued to you', tone: 'slate', href: '/communications' },
  ],
  widgets: ['letters', 'meetings', 'notifications'],
  quickActions: [
    { label: 'Open parent portal', href: '/portal' },
    { label: 'Meetings', href: '/meetings' },
  ],
}

const FALLBACK: RoleDashboard = {
  eyebrow: 'Overview',
  headline: 'Your workspace',
  subtitle: 'Live conduct posture across your school — reviewed, approved and fully auditable.',
  stats: (d) => [
    { label: 'Students on roll', value: d.metrics.students, hint: 'Active students this term', tone: 'brand', href: '/students' },
    { label: 'Open incidents', value: d.metrics.incidents, hint: `${d.metrics.myIncidents} reported by you`, tone: 'ochre', href: '/incidents' },
    { label: 'Awaiting review', value: d.metrics.pendingReview, hint: `${d.metrics.pendingApprovals} approvals pending`, tone: 'amber', href: '/approvals' },
    { label: 'High / critical risk', value: n(d.metrics.highRisk) + n(d.metrics.critical), hint: `${n(d.metrics.critical)} critical cases`, tone: 'red', href: '/risk' },
  ],
  widgets: ['trend', 'risk', 'recentIncidents', 'highRisk', 'approvals', 'classAverages'],
  quickActions: [],
}

const BY_ROLE: Record<string, RoleDashboard> = {
  ADMIN: admin,
  HEADTEACHER: headteacher,
  DEPUTY_DISCIPLINE: deputy,
  TEACHER: teacher,
  IT: it,
  PATRON: patron,
  MATRON: matron,
  BURSAR: bursar,
  DOS: dos,
  LIBRARIAN: librarian,
  SECRETARY: secretary,
  PARENT: parent,
}

/**
 * The backend picks one primary role (`PRIMARY_ORDER` in
 * `services/analytics.service.ts`). Mirror that ordering so the web dashboard
 * agrees with the API about which workspace the user is in.
 */
const PRIMARY_ORDER = ['ADMIN', 'HEADTEACHER', 'DEPUTY_DISCIPLINE', 'DOS', 'TEACHER', 'PATRON', 'MATRON', 'SECRETARY', 'IT', 'LIBRARIAN', 'BURSAR', 'PARENT']

export function roleDashboardFor(roles: string[] | undefined, apiRole?: string): RoleDashboard {
  if (apiRole && BY_ROLE[apiRole]) return BY_ROLE[apiRole]
  for (const role of PRIMARY_ORDER) {
    if (roles?.includes(role) && BY_ROLE[role]) return BY_ROLE[role]
  }
  return FALLBACK
}

export const WIDGET_LABELS: Record<WidgetKey, string> = {
  trend: 'Incident & deduction trend',
  risk: 'Risk distribution',
  recentIncidents: 'Recent incidents',
  highRisk: 'High-risk students',
  approvals: 'Pending approvals',
  followUps: 'Follow-ups due',
  classAverages: 'Class conduct averages',
  users: 'User accounts',
  audit: 'Recent audit activity',
  queue: 'Message queue health',
  whatsapp: 'WhatsApp session',
  safeguarding: 'Safeguarding cases',
  investigations: 'Investigations',
  appeals: 'Appeals',
  letters: 'Recent letters',
  parents: 'Parent records',
  recognition: 'Recent recognition',
  meetings: 'Upcoming meetings',
  notifications: 'Notification centre',
}