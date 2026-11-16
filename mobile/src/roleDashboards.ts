import type { ComponentProps } from 'react'
import type { Ionicons } from '@expo/vector-icons'
import type { DashboardPayload } from './api/types'

/**
 * Role-specific mobile home configuration.
 *
 * Mirrors `frontend/src/lib/roleDashboards.ts`. Every value rendered here comes
 * from the same permission-scoped `GET /analytics/dashboard` payload the web
 * dashboard consumes (`services/analytics.service.ts`), so a role sees exactly
 * the figures its permissions allow — this file only decides which of them the
 * small screen leads with.
 */

export type IconName = ComponentProps<typeof Ionicons>['name']
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'

export type MobileStat = {
  label: string
  value: number | string
  icon: IconName
  tone: Tone
}

export type MobileSection =
  | 'approvals'
  | 'recentIncidents'
  | 'highRisk'
  | 'followUps'
  | 'meetings'
  | 'letters'
  | 'audit'
  | 'queue'
  | 'whatsapp'
  | 'safeguarding'
  | 'investigations'
  | 'appeals'
  | 'recognition'
  | 'parents'
  | 'users'
  | 'notifications'
  | 'trend'

export type MobileQuickAction = {
  title: string
  icon: IconName
  route: string
  /** Only offered when the signed-in user holds this permission. */
  permission?: string
}

export type MobileRoleDashboard = {
  eyebrow: string
  headline: string
  subtitle: string
  stats: (data: DashboardPayload) => MobileStat[]
  sections: MobileSection[]
  quickActions: MobileQuickAction[]
}

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0))

/** Reads one numeric field from a permission-gated `extra` block. */
function extraNumber(data: DashboardPayload, key: string, field: string): number {
  const block = data.extra?.[key]
  if (!block || typeof block !== 'object') return 0
  return num((block as Record<string, unknown>)[field])
}

function unread(data: DashboardPayload): number {
  return num(data.extra?.unreadNotifications)
}

function countOf(data: DashboardPayload, key: string): number {
  const value = data.extra?.[key]
  return Array.isArray(value) ? value.length : 0
}

const admin: MobileRoleDashboard = {
  eyebrow: 'System administration',
  headline: 'Platform overview',
  subtitle: 'Users, roles, structure, audit and operational health.',
  stats: (d) => [
    { label: 'Active users', value: extraNumber(d, 'users', 'active'), icon: 'people-outline', tone: 'info' },
    { label: 'Roles', value: extraNumber(d, 'users', 'roles'), icon: 'key-outline', tone: 'neutral' },
    { label: 'Students', value: d.metrics.students, icon: 'school-outline', tone: 'success' },
    { label: 'Open incidents', value: d.metrics.incidents, icon: 'alert-circle-outline', tone: 'warning' },
  ],
  sections: ['users', 'audit', 'queue', 'whatsapp', 'notifications', 'recentIncidents'],
  quickActions: [
    { title: 'Users', icon: 'people-outline', route: '/(staff)/students' },
    { title: 'Notifications', icon: 'notifications-outline', route: '/notifications' },
  ],
}

const headteacher: MobileRoleDashboard = {
  eyebrow: 'Headteacher',
  headline: 'School oversight',
  subtitle: 'Serious cases, high-level approvals, risk posture and welfare.',
  stats: (d) => [
    { label: 'Students', value: d.metrics.students, icon: 'school-outline', tone: 'info' },
    { label: 'Awaiting approval', value: d.metrics.pendingApprovals, icon: 'checkbox-outline', tone: 'warning' },
    { label: 'High / critical risk', value: num(d.metrics.highRisk) + num(d.metrics.critical), icon: 'warning-outline', tone: 'danger' },
    { label: 'Investigations', value: extraNumber(d, 'investigations', 'open'), icon: 'search-outline', tone: 'accent' },
  ],
  sections: ['approvals', 'safeguarding', 'investigations', 'appeals', 'highRisk', 'recentIncidents', 'letters'],
  quickActions: [
    { title: 'Approvals', icon: 'checkbox-outline', route: '/(staff)/tasks' },
    { title: 'Students', icon: 'people-outline', route: '/(staff)/students' },
    { title: 'Notifications', icon: 'notifications-outline', route: '/notifications' },
  ],
}

const deputy: MobileRoleDashboard = {
  eyebrow: 'Discipline operations',
  headline: 'Case operations',
  subtitle: 'Approvals, incidents, high-risk students and follow-ups.',
  stats: (d) => [
    { label: 'Awaiting review', value: d.metrics.pendingReview, icon: 'time-outline', tone: 'warning' },
    { label: 'Approvals', value: d.metrics.pendingApprovals, icon: 'checkbox-outline', tone: 'danger' },
    { label: 'High / critical', value: num(d.metrics.highRisk) + num(d.metrics.critical), icon: 'warning-outline', tone: 'danger' },
    { label: 'Interventions', value: d.metrics.openInterventions, icon: 'medkit-outline', tone: 'success' },
  ],
  sections: ['approvals', 'recentIncidents', 'highRisk', 'followUps', 'letters', 'queue'],
  quickActions: [
    { title: 'Report incident', icon: 'add-circle-outline', route: '/incident/new', permission: 'incidents.create' },
    { title: 'Approvals', icon: 'checkbox-outline', route: '/(staff)/tasks' },
    { title: 'Incidents', icon: 'list-outline', route: '/(staff)/incidents' },
  ],
}

const teacher: MobileRoleDashboard = {
  eyebrow: 'Teacher',
  headline: 'My classes',
  subtitle: 'Report conduct, follow up on assigned students and track submissions.',
  stats: (d) => [
    { label: 'My students', value: d.metrics.students, icon: 'people-outline', tone: 'info' },
    { label: 'Reported by me', value: d.metrics.myIncidents, icon: 'alert-circle-outline', tone: 'warning' },
    { label: 'Awaiting review', value: d.metrics.pendingReview, icon: 'time-outline', tone: 'accent' },
    { label: 'Follow-ups', value: d.metrics.upcomingFollowUps, icon: 'calendar-outline', tone: 'neutral' },
  ],
  sections: ['recentIncidents', 'followUps', 'highRisk', 'recognition'],
  quickActions: [
    { title: 'Report incident', icon: 'add-circle-outline', route: '/incident/new', permission: 'incidents.create' },
    { title: 'Find student', icon: 'search-outline', route: '/(staff)/students', permission: 'students.view' },
    { title: 'Drafts', icon: 'cloud-offline-outline', route: '/drafts', permission: 'incidents.create' },
  ],
}

const it: MobileRoleDashboard = {
  eyebrow: 'IT',
  headline: 'Service health',
  subtitle: 'Queue backlog, WhatsApp channel, audit events and accounts.',
  stats: (d) => [
    { label: 'Active users', value: extraNumber(d, 'users', 'active'), icon: 'people-outline', tone: 'info' },
    { label: 'Users total', value: extraNumber(d, 'users', 'total'), icon: 'person-outline', tone: 'neutral' },
    { label: 'Unread', value: unread(d), icon: 'notifications-outline', tone: 'accent' },
    { label: 'Incidents', value: d.metrics.incidents, icon: 'alert-circle-outline', tone: 'warning' },
  ],
  sections: ['queue', 'whatsapp', 'audit', 'users', 'notifications'],
  quickActions: [
    { title: 'Notifications', icon: 'notifications-outline', route: '/notifications' },
  ],
}

const patron: MobileRoleDashboard = {
  eyebrow: 'Patron',
  headline: 'Student welfare',
  subtitle: 'Assigned students, wellbeing observations, referrals and follow-ups.',
  stats: (d) => [
    { label: 'My students', value: d.metrics.students, icon: 'people-outline', tone: 'info' },
    { label: 'High / critical', value: num(d.metrics.highRisk) + num(d.metrics.critical), icon: 'warning-outline', tone: 'danger' },
    { label: 'Interventions', value: d.metrics.openInterventions, icon: 'medkit-outline', tone: 'success' },
    { label: 'Follow-ups', value: d.metrics.upcomingFollowUps, icon: 'calendar-outline', tone: 'warning' },
  ],
  sections: ['highRisk', 'followUps', 'recentIncidents', 'recognition'],
  quickActions: [
    { title: 'Report incident', icon: 'add-circle-outline', route: '/incident/new', permission: 'incidents.create' },
    { title: 'My students', icon: 'people-outline', route: '/(staff)/students', permission: 'students.view' },
    { title: 'Follow-ups', icon: 'calendar-outline', route: '/(staff)/tasks' },
  ],
}

const matron: MobileRoleDashboard = {
  eyebrow: 'Matron',
  headline: 'Boarding care',
  subtitle: 'Welfare concerns, dormitory students, referrals and appointments.',
  stats: (d) => [
    { label: 'My students', value: d.metrics.students, icon: 'people-outline', tone: 'info' },
    { label: 'Priority cases', value: num(d.metrics.highRisk) + num(d.metrics.critical), icon: 'warning-outline', tone: 'danger' },
    { label: 'Follow-ups', value: d.metrics.upcomingFollowUps, icon: 'calendar-outline', tone: 'warning' },
    { label: 'Interventions', value: d.metrics.openInterventions, icon: 'medkit-outline', tone: 'success' },
  ],
  sections: ['highRisk', 'followUps', 'recentIncidents'],
  quickActions: [
    { title: 'Report concern', icon: 'add-circle-outline', route: '/incident/new', permission: 'incidents.create' },
    { title: 'My students', icon: 'people-outline', route: '/(staff)/students', permission: 'students.view' },
  ],
}

const bursar: MobileRoleDashboard = {
  eyebrow: 'Bursar',
  headline: 'Records and contact',
  subtitle: 'Authorized student records, payment summaries and clearance information.',
  stats: (d) => [
    { label: 'Students', value: d.metrics.students, icon: 'school-outline', tone: 'info' },
    { label: 'Incidents', value: d.metrics.incidents, icon: 'alert-circle-outline', tone: 'neutral' },
    { label: 'Parents', value: extraNumber(d, 'parents', 'total'), icon: 'people-outline', tone: 'accent' },
    { label: 'Letters', value: countOf(d, 'letters'), icon: 'document-text-outline', tone: 'neutral' },
  ],
  sections: ['letters', 'notifications'],
  quickActions: [
    { title: 'Students', icon: 'people-outline', route: '/(staff)/students', permission: 'students.view' },
    { title: 'Notifications', icon: 'notifications-outline', route: '/notifications' },
  ],
}

const dos: MobileRoleDashboard = {
  eyebrow: 'Dean of Studies',
  headline: 'Academic conduct',
  subtitle: 'Class and stream behaviour trends, repeat incidents and referrals.',
  stats: (d) => [
    { label: 'Students', value: d.metrics.students, icon: 'school-outline', tone: 'info' },
    { label: 'Open incidents', value: d.metrics.incidents, icon: 'alert-circle-outline', tone: 'warning' },
    { label: 'High / critical', value: num(d.metrics.highRisk) + num(d.metrics.critical), icon: 'warning-outline', tone: 'danger' },
    { label: 'Interventions', value: d.metrics.openInterventions, icon: 'medkit-outline', tone: 'success' },
  ],
  sections: ['trend', 'recentIncidents', 'highRisk', 'followUps'],
  quickActions: [
    { title: 'Find student', icon: 'search-outline', route: '/(staff)/students', permission: 'students.view' },
    { title: 'Incidents', icon: 'list-outline', route: '/(staff)/incidents', permission: 'incidents.view' },
    { title: 'Tasks', icon: 'checkbox-outline', route: '/(staff)/tasks' },
  ],
}

const librarian: MobileRoleDashboard = {
  eyebrow: 'Library',
  headline: 'Library conduct',
  subtitle: 'Library incidents, student lookup and observation submissions.',
  stats: (d) => [
    { label: 'Students', value: d.metrics.students, icon: 'school-outline', tone: 'info' },
    { label: 'Reported by me', value: d.metrics.myIncidents, icon: 'alert-circle-outline', tone: 'warning' },
    { label: 'Open incidents', value: d.metrics.incidents, icon: 'list-outline', tone: 'neutral' },
    { label: 'Recognition', value: countOf(d, 'recentRecognition'), icon: 'ribbon-outline', tone: 'success' },
  ],
  sections: ['recentIncidents'],
  quickActions: [
    { title: 'Report incident', icon: 'add-circle-outline', route: '/incident/new', permission: 'incidents.create' },
    { title: 'Find student', icon: 'search-outline', route: '/(staff)/students', permission: 'students.view' },
  ],
}

const secretary: MobileRoleDashboard = {
  eyebrow: 'Secretary',
  headline: 'Meetings and letters',
  subtitle: 'Letter preparation, meetings, parent contacts and approved documents.',
  stats: (d) => [
    { label: 'Meetings', value: countOf(d, 'upcomingMeetings'), icon: 'calendar-outline', tone: 'info' },
    { label: 'Letters', value: countOf(d, 'letters'), icon: 'document-text-outline', tone: 'warning' },
    { label: 'Parents', value: extraNumber(d, 'parents', 'total'), icon: 'people-outline', tone: 'neutral' },
    { label: 'Unread', value: unread(d), icon: 'notifications-outline', tone: 'accent' },
  ],
  sections: ['meetings', 'letters', 'parents', 'notifications'],
  quickActions: [
    { title: 'Notifications', icon: 'notifications-outline', route: '/notifications' },
    { title: 'Students', icon: 'people-outline', route: '/(staff)/students', permission: 'students.view' },
  ],
}

const parent: MobileRoleDashboard = {
  eyebrow: 'Parent portal',
  headline: 'My children',
  subtitle: 'Conduct progress, recognition, meetings and school communication.',
  stats: (d) => [
    { label: 'Children', value: d.portalChildren?.length ?? 0, icon: 'people-outline', tone: 'info' },
    { label: 'Unread', value: unread(d), icon: 'notifications-outline', tone: 'accent' },
    { label: 'Meetings', value: countOf(d, 'upcomingMeetings'), icon: 'calendar-outline', tone: 'warning' },
    { label: 'Letters', value: countOf(d, 'letters'), icon: 'document-text-outline', tone: 'neutral' },
  ],
  sections: ['letters', 'meetings', 'notifications'],
  quickActions: [
    { title: 'Notifications', icon: 'notifications-outline', route: '/notifications' },
  ],
}

const fallback: MobileRoleDashboard = {
  eyebrow: 'Overview',
  headline: 'Your workspace',
  subtitle: 'Live conduct posture across your school.',
  stats: (d) => [
    { label: 'Students', value: d.metrics.students, icon: 'school-outline', tone: 'info' },
    { label: 'Open incidents', value: d.metrics.incidents, icon: 'alert-circle-outline', tone: 'warning' },
    { label: 'Awaiting review', value: d.metrics.pendingReview, icon: 'time-outline', tone: 'accent' },
    { label: 'High / critical', value: num(d.metrics.highRisk) + num(d.metrics.critical), icon: 'warning-outline', tone: 'danger' },
  ],
  sections: ['recentIncidents', 'highRisk', 'approvals', 'followUps'],
  quickActions: [],
}

const BY_ROLE: Record<string, MobileRoleDashboard> = {
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

/** Mirrors `PRIMARY_ORDER` in the backend analytics service. */
const PRIMARY_ORDER = [
  'ADMIN',
  'HEADTEACHER',
  'DEPUTY_DISCIPLINE',
  'DOS',
  'TEACHER',
  'PATRON',
  'MATRON',
  'SECRETARY',
  'IT',
  'LIBRARIAN',
  'BURSAR',
  'PARENT',
]

export function mobileRoleDashboardFor(
  roles: string[] | undefined,
  apiRole?: string,
  permissions: string[] = [],
): MobileRoleDashboard {
  let base: MobileRoleDashboard | undefined = apiRole ? BY_ROLE[apiRole] : undefined
  if (!base) {
    const primary = PRIMARY_ORDER.find((role) => roles?.includes(role))
    base = primary ? BY_ROLE[primary] : fallback
  }
  const resolved = base ?? fallback
  return {
    ...resolved,
    // A parent-only account that also holds staff roles must not be offered
    // staff actions it cannot use.
    quickActions: resolved.quickActions.filter(
      (action) => !action.permission || permissions.includes(action.permission),
    ),
  }
}