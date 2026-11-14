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
  otherNames?: string
  fullName: string
  gender: 'male' | 'female'
  dateOfBirth?: string
  nationality?: string
  nationalId?: string
  religion?: string
  bloodGroup?: string
  photoUrl?: string
  contact?: { phone?: string; email?: string; address?: string }
  customFields?: { label: string; value: string }[]
  classId: { _id?: string; name?: string } | string
  streamId?: { _id?: string; name?: string } | string | null
  dormitoryId?: { _id?: string; name?: string } | string | null
  classTeacherId?: { _id?: string; name?: string; position?: string } | string | null
  status: string
  previousStatus?: string
  admissionDate?: string
  admissionType?: string
  previousSchool?: string
  previousClass?: string
  boardingStatus?: 'day' | 'boarding'
  roomNumber?: string
  emergencyContact?: { name?: string; relationship?: string; phone?: string }
  medicalNotes?: string
  documents?: StudentDocument[]
  archivedAt?: string
  archivedReason?: string
  currentBalance: number
  riskLevel: 'green' | 'yellow' | 'orange' | 'red'
  guardianCount?: number
  notes?: string
  enrollmentHistory?: PlacementEvent[]
  createdAt?: string
}

export type StudentDocument = {
  _id?: string
  title: string
  type: string
  url?: string
  notes?: string
  uploadedBy?: string
  uploadedAt: string
}

export type PlacementEvent = {
  _id?: string
  academicYearId?: string
  termId?: string
  classId?: string
  streamId?: string | null
  dormitoryId?: string | null
  action: string
  reason?: string
  at: string
  by?: string
}

export type GuardianLink = {
  _id: string
  relationship: string
  isPrimary: boolean
  isEmergencyContact: boolean
  notes?: string
  parentId?: {
    _id?: string
    name?: string
    relationship?: string
    phone?: string
    altPhone?: string
    email?: string
    address?: string
    occupation?: string
    nationalId?: string
    preferredChannel?: string
    whatsappConsent?: boolean
    smsConsent?: boolean
    emailConsent?: boolean
    verificationStatus?: string
  } | null
}

export type StudentProfile = {
  student: Student & { placementHistory?: PlacementEvent[] }
  class?: { name?: string; level?: string } | null
  stream?: { name?: string } | null
  dormitory?: { name?: string } | null
  classTeacher?: { name?: string; position?: string; email?: string } | null
  guardians: GuardianLink[]
  conduct: { startingMarks: number; totalDeductions: number; totalRewards: number; currentBalance: number; term?: { _id?: string; name?: string } }
  ledger: LedgerEntry[]
  incidents: Incident[]
  assessments: { _id: string; riskLevel: string; score?: number; reason?: string; createdAt: string }[]
  interventions: { _id: string; type: string; title: string; status: string; startDate?: string; assignedTo?: { name?: string } | string }[]
  followUps: { _id: string; type: string; dueDate: string; status: string }[]
  recognitions: { _id: string; title: string; points?: number; awardedAt: string; notes?: string; category?: string }[]
  letters: Letter[]
  messages: {
    _id: string
    channel: string
    status: string
    to: string
    templateKey?: string
    body: string
    attempts: number
    lastError?: string
    createdAt: string
    sentAt?: string
  }[]
  investigations: { _id: string; caseNumber: string; title: string; type: string; status: string; createdAt: string }[]
  appeals: { _id: string; appealNumber: string; decisionType: string; grounds: string; status: string; submittedAt: string }[]
  safeguarding: { _id: string; caseNumber: string; category: string; severity: string; status: string; createdAt: string }[]
  meetings: { _id: string; reference: string; title: string; type: string; scheduledAt: string; status: string }[]
  permissions: {
    canEdit: boolean
    canManageGuardians: boolean
    canManageDocuments: boolean
    canLifecycle: boolean
    canArchive: boolean
    canDelete: boolean
    canRestore: boolean
    canPromote: boolean
    canViewLedger: boolean
    canViewSafeguarding: boolean
    canViewActivity: boolean
  }
}

export type PromotionBatch = {
  _id: string
  id?: string
  batchNumber: string
  title: string
  fromClassId: { _id?: string; name?: string; level?: string } | string
  toClassId?: { _id?: string; name?: string; level?: string } | string | null
  graduate: boolean
  status: string
  reason?: string
  items?: {
    _id?: string
    studentId: string
    studentSnapshot: { fullName: string; studentId: string; admissionNumber: string }
    status: string
    error?: string
  }[]
  createdBy?: { name?: string } | string
  submittedAt?: string
  reviewedAt?: string
  executedAt?: string
  rejectionReason?: string
  decisionNotes?: string
  history?: { at: string; action: string; note?: string }[]
  createdAt: string
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
