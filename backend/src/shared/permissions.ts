export type PermissionDef = { key: string; label: string; group: string }

const p = (key: string, label: string, group: string): PermissionDef => ({ key, label, group })

export const PERMISSIONS: PermissionDef[] = [
  // System & administration
  p('setup.manage', 'Complete initial system setup', 'System'),
  p('users.view', 'View users', 'System'),
  p('users.create', 'Create users', 'System'),
  p('users.update', 'Update users', 'System'),
  p('users.deactivate', 'Deactivate users', 'System'),
  p('roles.manage', 'Manage roles', 'System'),
  p('permissions.manage', 'Manage permissions', 'System'),
  p('settings.manage', 'Manage system settings', 'System'),
  p('integrations.manage', 'Manage integrations', 'System'),
  p('backups.manage', 'Manage backups and recovery', 'System'),
  p('audit.view', 'View audit logs', 'System'),
  p('system.monitor', 'View system monitoring', 'System'),
  p('reports.view', 'View reports', 'Reports'),
  p('reports.export', 'Export reports', 'Reports'),
  p('analytics.view', 'View analytics', 'Reports'),
  p('calendar.view', 'View calendar', 'Calendar'),
  p('calendar.manage', 'Manage calendar', 'Calendar'),
  p('notifications.view', 'View notifications', 'Communication'),
  p('notifications.manage', 'Manage notifications', 'Communication'),
  p('whatsapp.manage', 'Manage WhatsApp connection', 'Communication'),

  // School & students
  p('students.view', 'View permitted students', 'Students'),
  p('students.view_all', 'View all students', 'Students'),
  p('students.view_assigned', 'View assigned students', 'Students'),
  p('students.create', 'Register students', 'Students'),
  p('students.update', 'Update students', 'Students'),
  p('students.import', 'Import students', 'Students'),
  p('students.export', 'Export student records', 'Students'),
  p('students.promote', 'Run promotion batches', 'Students'),
  p('students.promote.approve', 'Approve promotion batches', 'Students'),
  p('students.archive', 'Archive students', 'Students'),
  p('students.restore', 'Restore archived students', 'Students'),
  p('students.lifecycle', 'Suspend, transfer, withdraw or graduate students', 'Students'),
  p('students.manage_guardians', 'Manage student guardians', 'Students'),
  p('students.documents', 'Manage student documents', 'Students'),
  p('students.activity.view', 'View student activity history', 'Students'),
  p('classes.view', 'View classes and streams', 'School'),
  p('classes.manage', 'Manage classes and streams', 'School'),
  p('dormitories.view', 'View dormitories', 'School'),
  p('dormitories.manage', 'Manage dormitories', 'School'),
  p('academic_years.manage', 'Manage academic years', 'School'),
  p('terms.manage', 'Manage terms', 'School'),

  // Attendance
  p('attendance.view', 'View attendance registers', 'Attendance'),
  p('attendance.record', 'Record attendance', 'Attendance'),
  p('attendance.correct', 'Request attendance corrections', 'Attendance'),
  p('attendance.correct.approve', 'Approve attendance corrections', 'Attendance'),
  p('attendance.excuse.review', 'Review absence excuses', 'Attendance'),
  p('attendance.reports', 'View attendance reports', 'Attendance'),

  // Boarding
  p('boarding.view', 'View boarding operations', 'Boarding'),
  p('boarding.record', 'Record boarding movements', 'Boarding'),
  p('boarding.manage', 'Manage dormitory allocations and permissions', 'Boarding'),
  p('boarding.escalate', 'Escalate missing students', 'Boarding'),

  // Welfare & counselling
  p('welfare.view', 'Access the confidential welfare centre', 'Welfare'),
  p('welfare.view_all', 'View all confidential welfare cases', 'Welfare'),
  p('welfare.manage', 'Manage counselling, support plans and referrals', 'Welfare'),
  p('welfare.records.view', 'Read confidential counselling session notes', 'Welfare'),
  p('welfare.assign', 'Assign confidential welfare cases', 'Welfare'),
  p('welfare.escalate', 'Escalate welfare cases to safeguarding', 'Welfare'),
  p('welfare.refer', 'Refer students for welfare support', 'Welfare'),
  p('detention.view', 'View detention sessions', 'Discipline'),
  p('detention.manage', 'Schedule and manage detention', 'Discipline'),

  // Discipline
  p('incidents.view', 'View permitted incidents', 'Discipline'),
  p('incidents.view_all', 'View all incidents', 'Discipline'),
  p('incidents.view_assigned', 'View assigned students’ incidents', 'Discipline'),
  p('incidents.create', 'Record incidents', 'Discipline'),
  p('incidents.update', 'Update incidents', 'Discipline'),
  p('incidents.submit', 'Submit incidents', 'Discipline'),
  p('incidents.review', 'Review incidents', 'Discipline'),
  p('incidents.escalate', 'Escalate incidents', 'Discipline'),
  p('incidents.close', 'Close incidents', 'Discipline'),
  p('marks.view', 'View conduct marks', 'Discipline'),
  p('marks.deduct', 'Apply deductions', 'Discipline'),
  p('marks.reward', 'Apply rewards', 'Discipline'),
  p('marks.adjust.request', 'Request mark adjustments', 'Discipline'),
  p('marks.adjust.approve', 'Approve mark adjustments', 'Discipline'),
  p('marks.reverse', 'Reverse transactions', 'Discipline'),
  p('risk.view', 'View risk assessments', 'Student support'),
  p('risk.manage', 'Manage risk assessments', 'Student support'),
  p('risk.escalate', 'Escalate risk cases', 'Student support'),
  p('blacklist.view', 'View watchlist', 'Student support'),
  p('blacklist.manage', 'Manage watchlist', 'Student support'),
  p('offences.view', 'View offence rules', 'Discipline'),
  p('offences.manage', 'Manage offence rules', 'Discipline'),
  p('interventions.view', 'View interventions', 'Student support'),
  p('interventions.manage', 'Manage interventions', 'Student support'),
  p('followups.view', 'View follow-ups', 'Student support'),
  p('followups.manage', 'Manage follow-ups', 'Student support'),

  // Parents & communication
  p('parents.view', 'View parent contacts', 'Parents'),
  p('parents.manage', 'Manage parent contacts', 'Parents'),
  p('parent_contacts.view', 'View parent contact details', 'Parents'),
  p('parent_contacts.manage', 'Manage parent contact details', 'Parents'),
  p('letters.view', 'View letters', 'Documents'),
  p('letters.create', 'Prepare letters', 'Documents'),
  p('letters.approve', 'Approve letters', 'Documents'),
  p('letters.issue', 'Issue letters', 'Documents'),
  p('templates.manage', 'Manage document and message templates', 'Documents'),

  // Safeguarding
  p('safeguarding.view', 'View safeguarding cases', 'Safeguarding'),
  p('safeguarding.create', 'Report safeguarding concerns', 'Safeguarding'),
  p('safeguarding.assign', 'Assign safeguarding cases', 'Safeguarding'),
  p('safeguarding.escalate', 'Escalate safeguarding cases', 'Safeguarding'),
  p('safeguarding.close', 'Resolve and close safeguarding cases', 'Safeguarding'),
  p('safeguarding.evidence.view', 'View confidential safeguarding evidence', 'Safeguarding'),

  // Investigations
  p('investigations.view', 'View investigations', 'Investigations'),
  p('investigations.create', 'Open investigations', 'Investigations'),
  p('investigations.assign', 'Assign investigators', 'Investigations'),
  p('investigations.evidence', 'Manage investigation evidence and statements', 'Investigations'),
  p('investigations.decide', 'Approve investigation findings and decisions', 'Investigations'),
  p('investigations.close', 'Close investigations', 'Investigations'),

  // Appeals
  p('appeals.view', 'View appeals', 'Appeals'),
  p('appeals.submit', 'Submit appeals', 'Appeals'),
  p('appeals.review', 'Review appeals', 'Appeals'),
  p('appeals.decide', 'Decide appeals', 'Appeals'),

  // Recognition
  p('recognition.view', 'View positive behaviour records', 'Recognition'),
  p('recognition.create', 'Record positive behaviour and achievements', 'Recognition'),
  p('recognition.manage', 'Manage recognition, rewards and improvement plans', 'Recognition'),

  // Evidence
  p('evidence.view', 'View authorized evidence', 'Evidence'),
  p('evidence.upload', 'Upload evidence', 'Evidence'),
  p('evidence.review', 'Review evidence', 'Evidence'),

  // Policy centre
  p('policies.view', 'View rules and policies', 'Policies'),
  p('policies.manage', 'Manage rules and policies', 'Policies'),

  // Meetings
  p('meetings.view', 'View meetings', 'Meetings'),
  p('meetings.manage', 'Manage meetings', 'Meetings'),
  p('meetings.notes.view', 'View confidential meeting notes', 'Meetings'),

  // Data protection
  p('data_protection.view', 'View data protection centre', 'Data protection'),
  p('data_protection.manage', 'Manage data protection', 'Data protection'),
  p('data_protection.export', 'Authorize secure data exports', 'Data protection'),
  p('data_protection.breaches', 'Report and manage data breaches', 'Data protection'),

  // Parent portal
  p('portal.view_children', 'View linked children', 'Parent portal'),
]

export const PERMISSION_KEYS = PERMISSIONS.map((x) => x.key)
export const PERMISSION_SET = new Set(PERMISSION_KEYS)

export const HIGH_IMPACT_LETTER_TYPES = new Set([
  'suspension',
  'expulsion_recommendation',
  'expulsion_decision',
])

export const HIGH_IMPACT_INCIDENT_SEVERITIES = new Set(['serious', 'critical'])
