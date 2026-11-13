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

export type AuthUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  status: string
  avatarUrl?: string
  position?: string
  phone?: string
  mustChangePassword?: boolean
  authProvider?: string
  assignedClassIds?: string[]
  assignedDormitoryIds?: string[]
}

export type Me = {
  user: AuthUser
  roles: RoleKey[] | string[]
  permissions: string[]
  setup?: { setupCompleted: boolean; firebaseConfigured: boolean }
}

export type PaginationMeta = {
  total: number
  page: number
  pageSize: number
  totalPages: number
  [key: string]: unknown
}

export type Student = {
  _id?: string
  id?: string
  studentId: string
  admissionNumber: string
  firstName: string
  lastName: string
  fullName: string
  gender: 'male' | 'female'
  classId: { _id?: string; name?: string } | string
  streamId?: { _id?: string; name?: string } | string | null
  dormitoryId?: { _id?: string; name?: string } | string | null
  status: string
  currentBalance: number
  riskLevel: 'green' | 'yellow' | 'orange' | 'red'
  guardianCount?: number
  createdAt?: string
}

export type Offence = {
  _id: string
  code: string
  name: string
  category: string
  deduction: number
  severity: 'minor' | 'moderate' | 'serious' | 'critical'
  applicableLevels?: string[]
  requiresApproval: boolean
  requiresEvidence: boolean
  notifyParent: boolean
  active: boolean
}

export type Incident = {
  _id: string
  incidentNumber: string
  studentSnapshot: { fullName: string; studentId: string; className?: string; dormitoryName?: string }
  offenceSnapshot: { name: string; code?: string; deduction: number; severity: string }
  description: string
  occurredAt: string
  location?: string
  severity: string
  status: string
  deductionApplied?: boolean
  parentNotificationStatus?: string
  safeguardingFlag?: boolean
  reportedBy?: { _id?: string; name?: string } | string
  review?: { reviewedBy?: { name?: string } | string; reviewedAt?: string; decision?: string; comments?: string }
  createdAt: string
  history?: { at: string; action: string; note?: string }[]
}

export type LedgerEntry = {
  _id: string
  type: string
  previousBalance: number
  change: number
  newBalance: number
  reason: string
  createdAt: string
  createdBy?: { name?: string } | string
  status: string
}

export type Approval = {
  _id: string
  approvalNumber?: string
  type: string
  title: string
  summary?: string
  status: string
  requiredPermission: string
  requiredRole?: string
  requestedBy?: { _id?: string; name?: string } | string
  createdAt: string
  decidedAt?: string
  refId?: string
  studentId?: string | { _id?: string; fullName?: string; studentId?: string } | null
}

export type Dashboard = {
  role: string
  roleLabel: string
  roles: string[]
  metrics: {
    students: number
    highRisk: number
    critical: number
    incidents: number
    pendingReview: number
    pendingApprovals: number
    myIncidents: number
    openInterventions: number
    upcomingFollowUps: number
  }
  charts: {
    trend: { date: string; incidents: number; deductions: number }[]
    riskDistribution: Record<string, number>
    classAverages: { name: string; average: number; students: number }[]
  }
  lists: {
    recentIncidents: Incident[]
    highRiskStudents: { _id: string; fullName: string; studentId: string; currentBalance: number; riskLevel: string }[]
    pendingApprovals: Approval[]
    upcomingFollowUps: { _id: string; dueDate: string; type: string }[]
  }
  portalChildren: { id: string; name: string; studentId: string; className: string; balance: number; risk: string; status: string }[]
  extra: Record<string, unknown>
  generatedAt: string
}

export type StructureOptions = {
  years: { _id: string; name: string; isActive: boolean; status: string }[]
  terms: { _id: string; name: string; number: number; academicYearId: string; isActive: boolean; startingMarks: number; closedAt?: string }[]
  classes: { _id: string; name: string; level: string; streamId?: string | null; active: boolean }[]
  streams: { _id: string; name: string; code: string; level: string; active: boolean }[]
  dormitories: { _id: string; name: string; code: string; capacity: number; gender: string; active: boolean; occupants?: number }[]
}

export type ParentRecord = {
  _id: string
  name: string
  relationship: string
  phone: string
  altPhone?: string
  email?: string
  preferredChannel: string
  whatsappConsent: boolean
  smsConsent: boolean
  emailConsent: boolean
  verificationStatus: string
  portalUserId?: string
}

export type Settings = {
  school: { name: string; shortName: string; motto: string; address: string; phone: string; email: string; website: string; logoUrl: string }
  academic: { startingMarks: number; timezone: string; language: 'en' | 'rw'; currency: string }
  discipline: { requireReview: boolean; autoApproveSeverities: string[]; highImpactDeduction: number; maxBackdatingDays: number }
  risk: { thresholds: { green: number; yellow: number; orange: number }; seriousRecentDays: number; repeatOffenceThreshold: number }
  comms: { whatsappEnabled: boolean; smsEnabled: boolean; quietHoursStart: number; quietHoursEnd: number; retryLimit: number; notifyOnDeduction: boolean }
  backup: { schedule: string; retentionDays: number; rpoHours: number; rtoHours: number; lastRunAt?: string; lastStatus?: string }
  retention: { studentRecordsYears: number; disciplineYears: number; evidenceYears: number; auditYears: number; safeguardingYears: number }
  security: { maxFailedLogins: number; lockoutMinutes: number; sessionDays: number; requireEmailVerification: boolean }
  setupCompleted: boolean
}

export type NotificationItem = {
  _id: string
  type: string
  title: string
  message: string
  link?: string
  readAt?: string
  createdAt: string
}

export type Letter = {
  _id: string
  reference: string
  type: string
  subject: string
  body: string
  status: string
  deliveryStatus: string
  studentSnapshot: { fullName: string; studentId: string; className: string }
  createdAt: string
  issuedAt?: string
}
