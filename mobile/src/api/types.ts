export type ApiEnvelope<T> = {
  success: boolean
  data: T
  error?: { code: string; message: string; details?: unknown }
  meta?: {
    page?: number
    pageSize?: number
    total?: number
    totalPages?: number
    unread?: number
    pendingCount?: number
  }
  requestId?: string
}

export type PageMeta = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type SessionUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  status: string
  avatarUrl?: string
  assignedClassIds: string[]
  assignedDormitoryIds: string[]
  mustChangePassword: boolean
  authProvider: string
  position?: string
}

export type SessionPayload = {
  accessToken: string
  refreshToken: string
  refreshExpires: string
  sessionId: string
  user: SessionUser
  permissions: string[]
  roles: string[]
}

export type MePayload = {
  user: SessionUser
  roles: string[]
  permissions: string[]
  setup: {
    completed: boolean
    schoolName: string
    schoolMotto: string
    timezone: string
    language: string
    smtpConfigured: boolean
    firebaseConfigured: boolean
  }
}

export type SessionView = {
  id: string
  current: boolean
  platform: 'web' | 'android' | 'ios' | 'unknown'
  deviceId?: string
  deviceName?: string
  appVersion?: string
  ip?: string
  userAgent?: string
  pushEnabled: boolean
  createdAt: string
  lastActiveAt?: string
  expiresAt: string
}

export type DashboardMetric = {
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

export type IncidentSummary = {
  _id: string
  incidentNumber: string
  studentSnapshot?: { fullName?: string; studentId?: string; className?: string }
  offenceSnapshot?: { code?: string; name?: string; deduction?: number; severity?: string }
  severity: 'minor' | 'moderate' | 'serious' | 'critical'
  status: 'draft' | 'submitted' | 'under_review' | 'escalated' | 'approved' | 'rejected' | 'closed'
  occurredAt: string
  reportedAt?: string
  reportedBy?: { _id?: string; name?: string; position?: string } | string
  description?: string
  location?: string
  deductionApplied?: boolean
  safeguardingFlag?: boolean
  studentId?: { _id: string; fullName?: string; studentId?: string; currentBalance?: number; riskLevel?: string } | string
  witnesses?: { name: string; contact?: string; statement?: string }[]
  evidenceIds?: { _id: string; originalName?: string; fileName?: string; mimeType?: string; size?: number; url?: string }[]
  parentNotificationStatus?: string
  review?: {
    decision?: string
    comments?: string
    reviewedAt?: string
    reviewedBy?: { _id?: string; name?: string; position?: string } | string
  }
  history?: { at: string; action: string; note?: string }[]
  createdAt?: string
  updatedAt?: string
}

export type DashboardPayload = {
  role: string
  roleLabel: string
  roles: string[]
  user: SessionUser
  metrics: DashboardMetric
  charts: {
    trend: { date: string; incidents: number; deductions: number }[]
    riskDistribution: Record<string, number>
    classAverages: { name: string; average: number; students: number }[]
  }
  lists: {
    recentIncidents: IncidentSummary[]
    highRiskStudents: Student[]
    pendingApprovals: Approval[]
    upcomingFollowUps: FollowUp[]
  }
  portalChildren: unknown[]
  extra: Record<string, unknown>
  generatedAt: string
}

export type Student = {
  _id?: string
  id?: string
  fullName: string
  studentId: string
  admissionNumber?: string
  currentBalance: number
  riskLevel: 'green' | 'yellow' | 'orange' | 'red'
  status: string
  gender?: string
  classId?: { name?: string; level?: string } | string
  streamId?: { name?: string } | string
  dormitoryId?: { name?: string } | string
  guardianName?: string
  guardianPhone?: string
  avatarUrl?: string
}

export type GuardianView = {
  _id?: string
  relationship?: string
  isPrimary?: boolean
  parentId?: { _id?: string; name?: string; phone?: string; email?: string; whatsappConsent?: boolean } | string
}

export type StudentProfile = {
  student: Student & { firstName?: string; lastName?: string; notes?: string }
  class?: { name?: string; level?: string } | null
  stream?: { name?: string } | null
  dormitory?: { name?: string } | null
  guardians: GuardianView[]
  conduct: {
    startingMarks: number
    totalDeductions: number
    totalRewards: number
    currentBalance: number
    transactions: LedgerEntry[]
    term?: { name?: string }
  }
  incidents: IncidentSummary[]
  assessments: { _id?: string; riskLevel?: string; reasons?: string[]; createdAt?: string }[]
  interventions: { _id?: string; title?: string; status?: string; type?: string; createdAt?: string }[]
  followUps: { _id?: string; title?: string; dueDate?: string; status?: string }[]
  recognitions: { _id?: string; title?: string; points?: number; awardedAt?: string }[]
}

export type LedgerEntry = {
  id?: string
  _id?: string
  type: string
  change: number
  newBalance: number
  reason: string
  at?: string
  createdAt?: string
  balanceBefore?: number
}

export type Offence = {
  _id: string
  code: string
  name: string
  category: string
  deduction: number
  severity: 'minor' | 'moderate' | 'serious' | 'critical'
  requiresApproval?: boolean
  requiresEvidence?: boolean
  active?: boolean
}

export type Approval = {
  _id: string
  approvalNumber: string
  type: 'incident' | 'adjustment' | 'letter' | 'intervention' | 'safeguarding_escalation'
  status: 'pending' | 'approved' | 'rejected' | 'info_requested'
  title: string
  summary?: string
  requiredPermission: string
  studentId?: { _id?: string; fullName?: string; studentId?: string; currentBalance?: number } | string
  requestedBy?: { name?: string } | string
  createdAt: string
  decidedAt?: string
}

export type FollowUp = {
  _id: string
  title?: string
  dueDate?: string
  status?: string
}

export type NotificationItem = {
  _id: string
  type: string
  title: string
  message: string
  link?: string
  readAt?: string
  createdAt: string
  data?: Record<string, unknown>
}

export type PortalChild = {
  id: string
  fullName: string
  admissionNumber: string
  className: string
  dormitory: string
  balance: number
  risk: string
  status: string
  relationship?: string
  primary?: boolean
}

export type PortalChildDetail = {
  student: {
    id: string
    fullName: string
    admissionNumber: string
    gender?: string
    className: string
    level?: string
    dormitory?: string
    status: string
    balance: number
    risk: string
  }
  conduct: {
    startingMarks: number
    totalDeductions: number
    totalRewards: number
    balance: number
    transactions: { id: string; type: string; change: number; newBalance: number; reason: string; at: string }[]
  }
  incidents: {
    id: string
    reference: string
    offence?: string
    description?: string
    occurredAt: string
    status: string
    deduction?: number
  }[]
  letters: { _id: string; reference: string; type: string; subject: string; issuedAt: string }[]
  meetings: { _id: string; reference: string; title: string; scheduledAt: string; location?: string; type?: string }[]
  recognition: { _id: string; title: string; description?: string; points?: number; awardedAt: string }[]
  riskHistory: { _id: string; riskLevel: string; createdAt: string; reasons?: string[] }[]
}

export type SyncDraft = {
  localId: string
  studentId: string
  offenceId: string
  description: string
  occurredAt: string
  location: string
  safeguardingFlag?: boolean
  clientSubmissionId: string
}

export type SyncResult = {
  localId: string
  status: 'synced' | 'conflict' | 'rejected'
  incidentId?: string
  reference?: string
  error?: string
}
