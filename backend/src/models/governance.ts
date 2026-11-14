import { Schema, model, Types, type Document } from 'mongoose'

export interface IAuditLog extends Document {
  actorId?: Types.ObjectId
  actorName: string
  actorRoles: string[]
  action: string
  resourceType: string
  resourceId?: string
  before?: unknown
  after?: unknown
  reason?: string
  requestId?: string
  ip?: string
  userAgent?: string
  createdAt: Date
}

const auditSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, required: true },
    actorRoles: { type: [String], default: [] },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, required: true, index: true },
    resourceId: { type: String },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    reason: { type: String },
    requestId: { type: String },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
auditSchema.index({ createdAt: -1 })
auditSchema.index({ resourceType: 1, resourceId: 1 })
export const AuditLog = model<IAuditLog>('AuditLog', auditSchema)

export type SafeguardingStatus = 'open' | 'under_review' | 'referred' | 'escalated' | 'resolved' | 'closed'

export interface ISafeguardingCase extends Document {
  caseNumber: string
  category: 'bullying' | 'harassment' | 'abuse' | 'protection' | 'other'
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: SafeguardingStatus
  studentId?: Types.ObjectId
  reportedBy: Types.ObjectId
  confidential: boolean
  narrative: string
  immediateRisk?: string
  assignedTo?: Types.ObjectId
  referrals: { type: string; to: string; at: Date; notes?: string; status: string }[]
  escalation?: { level: string; to?: string; at: Date; reason: string }
  resolution?: string
  accessLog: { userId: Types.ObjectId; at: Date; action: string }[]
  evidenceIds: Types.ObjectId[]
  deadline?: Date
  closedAt?: Date
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
}

const safeguardingSchema = new Schema<ISafeguardingCase>(
  {
    caseNumber: { type: String, required: true, unique: true },
    category: { type: String, enum: ['bullying', 'harassment', 'abuse', 'protection', 'other'], required: true },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    status: {
      type: String,
      enum: ['open', 'under_review', 'referred', 'escalated', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', index: true },
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    confidential: { type: Boolean, default: true },
    narrative: { type: String, required: true },
    immediateRisk: { type: String },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    referrals: [{ type: String, to: String, at: { type: Date, default: Date.now }, notes: String, status: String }],
    escalation: { level: String, to: String, at: Date, reason: String },
    resolution: { type: String },
    accessLog: [{ userId: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now }, action: String }],
    evidenceIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    deadline: { type: Date },
    closedAt: { type: Date },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
  },
  { timestamps: true },
)
export const SafeguardingCase = model<ISafeguardingCase>('SafeguardingCase', safeguardingSchema)

export interface IInvestigation extends Document {
  caseNumber: string
  incidentIds: Types.ObjectId[]
  studentId: Types.ObjectId
  title: string
  type: 'misconduct' | 'serious_incident' | 'safeguarding_linked' | 'other'
  status: 'opened' | 'investigating' | 'findings' | 'decision' | 'closed' | 'cancelled'
  assignedTo?: Types.ObjectId
  createdBy: Types.ObjectId
  linkedSafeguardingCaseId?: Types.ObjectId
  deadline?: Date
  timeline: { at: Date; by?: Types.ObjectId; type: string; content: string; visibility: string }[]
  witnesses: { name: string; contact?: string; statement?: string; recordedAt?: Date; recordedBy?: Types.ObjectId }[]
  studentStatement?: { content: string; recordedAt?: Date; recordedBy?: Types.ObjectId }
  findings?: string
  recommendations?: string
  decision?: { outcome: string; approvedBy?: Types.ObjectId; decidedAt?: Date; notes?: string }
  evidenceIds: Types.ObjectId[]
  closedAt?: Date
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
}

const investigationSchema = new Schema<IInvestigation>(
  {
    caseNumber: { type: String, required: true, unique: true },
    incidentIds: [{ type: Schema.Types.ObjectId, ref: 'Incident' }],
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    title: { type: String, required: true },
    type: { type: String, enum: ['misconduct', 'serious_incident', 'safeguarding_linked', 'other'], default: 'misconduct' },
    status: {
      type: String,
      enum: ['opened', 'investigating', 'findings', 'decision', 'closed', 'cancelled'],
      default: 'opened',
      index: true,
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    linkedSafeguardingCaseId: { type: Schema.Types.ObjectId, ref: 'SafeguardingCase' },
    deadline: { type: Date },
    timeline: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, type: String, content: String, visibility: { type: String, default: 'case_team' } }],
    witnesses: [{ name: String, contact: String, statement: String, recordedAt: Date, recordedBy: { type: Schema.Types.ObjectId, ref: 'User' } }],
    studentStatement: { content: String, recordedAt: Date, recordedBy: { type: Schema.Types.ObjectId, ref: 'User' } },
    findings: { type: String },
    recommendations: { type: String },
    decision: { outcome: String, approvedBy: { type: Schema.Types.ObjectId, ref: 'User' }, decidedAt: Date, notes: String },
    evidenceIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    closedAt: { type: Date },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
  },
  { timestamps: true },
)
export const Investigation = model<IInvestigation>('Investigation', investigationSchema)

export interface IAppeal extends Document {
  appealNumber: string
  studentId: Types.ObjectId
  decisionType: 'incident' | 'suspension' | 'expulsion' | 'other'
  decisionRef: string
  incidentId?: Types.ObjectId
  originalDecisionBy?: Types.ObjectId
  grounds: string
  reason: string
  evidenceIds: Types.ObjectId[]
  submittedBy: Types.ObjectId
  submittedAt: Date
  deadline: Date
  status: 'submitted' | 'under_review' | 'decided' | 'rejected' | 'withdrawn'
  reviewerId?: Types.ObjectId
  decision?: 'upheld' | 'overturned' | 'modified' | 'dismissed'
  decisionExplanation?: string
  decidedAt?: Date
  linkedLedgerId?: Types.ObjectId
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
}

const appealSchema = new Schema<IAppeal>(
  {
    appealNumber: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    decisionType: { type: String, enum: ['incident', 'suspension', 'expulsion', 'other'], default: 'incident' },
    decisionRef: { type: String, required: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', index: true },
    originalDecisionBy: { type: Schema.Types.ObjectId, ref: 'User' },
    grounds: { type: String, required: true },
    reason: { type: String, required: true },
    evidenceIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: { type: Date, default: Date.now },
    deadline: { type: Date, required: true },
    status: { type: String, enum: ['submitted', 'under_review', 'decided', 'rejected', 'withdrawn'], default: 'submitted', index: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
    decision: { type: String, enum: ['upheld', 'overturned', 'modified', 'dismissed'] },
    decisionExplanation: { type: String },
    decidedAt: { type: Date },
    linkedLedgerId: { type: Schema.Types.ObjectId, ref: 'DisciplineLedger' },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
  },
  { timestamps: true },
)
export const Appeal = model<IAppeal>('Appeal', appealSchema)

export interface IEvidence extends Document {
  fileName: string
  originalName: string
  mimeType: string
  size: number
  sha256: string
  storagePath: string
  description?: string
  classification: 'internal' | 'confidential' | 'restricted'
  uploadedBy: Types.ObjectId
  linkedType?: 'incident' | 'investigation' | 'safeguarding' | 'appeal' | 'meeting' | 'general'
  linkedId?: Types.ObjectId
  reviewStatus: 'pending' | 'reviewed' | 'rejected'
  reviewedBy?: Types.ObjectId
  reviewedAt?: Date
  reviewNotes?: string
  accessLog: { userId: Types.ObjectId; at: Date; action: string }[]
  createdAt: Date
}

const evidenceSchema = new Schema<IEvidence>(
  {
    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    storagePath: { type: String, required: true },
    description: { type: String },
    classification: { type: String, enum: ['internal', 'confidential', 'restricted'], default: 'confidential' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    linkedType: { type: String, enum: ['incident', 'investigation', 'safeguarding', 'appeal', 'meeting', 'general'], default: 'general' },
    linkedId: { type: Schema.Types.ObjectId },
    reviewStatus: { type: String, enum: ['pending', 'reviewed', 'rejected'], default: 'pending' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNotes: { type: String },
    accessLog: [{ userId: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now }, action: String }],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
evidenceSchema.index({ linkedType: 1, linkedId: 1 })
export const Evidence = model<IEvidence>('Evidence', evidenceSchema)

export interface IDataRequest extends Document {
  requestNumber: string
  type: 'correction' | 'access' | 'objection' | 'erasure'
  requesterName: string
  requesterContact: string
  studentId?: Types.ObjectId
  details: string
  status: 'received' | 'under_review' | 'approved' | 'rejected' | 'completed'
  handledBy?: Types.ObjectId
  decision?: string
  dueDate: Date
  completedAt?: Date
}

const dataRequestSchema = new Schema<IDataRequest>(
  {
    requestNumber: { type: String, required: true, unique: true },
    type: { type: String, enum: ['correction', 'access', 'objection', 'erasure'], required: true },
    requesterName: { type: String, required: true },
    requesterContact: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    details: { type: String, required: true },
    status: { type: String, enum: ['received', 'under_review', 'approved', 'rejected', 'completed'], default: 'received' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decision: { type: String },
    dueDate: { type: Date, required: true },
    completedAt: { type: Date },
  },
  { timestamps: true },
)
export const DataRequest = model<IDataRequest>('DataRequest', dataRequestSchema)

export interface IDataBreach extends Document {
  breachNumber: string
  title: string
  description: string
  discoveredAt: Date
  severity: 'low' | 'medium' | 'high' | 'critical'
  affectedRecords: number
  dataCategories: string[]
  containment: string
  reportedToAuthority: boolean
  authorityNotifiedAt?: Date
  individualsNotified: boolean
  status: 'open' | 'contained' | 'closed'
  handledBy?: Types.ObjectId
}

const breachSchema = new Schema<IDataBreach>(
  {
    breachNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    discoveredAt: { type: Date, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    affectedRecords: { type: Number, default: 0 },
    dataCategories: { type: [String], default: [] },
    containment: { type: String, default: '' },
    reportedToAuthority: { type: Boolean, default: false },
    authorityNotifiedAt: { type: Date },
    individualsNotified: { type: Boolean, default: false },
    status: { type: String, enum: ['open', 'contained', 'closed'], default: 'open' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
export const DataBreach = model<IDataBreach>('DataBreach', breachSchema)

export interface IAccessLog extends Document {
  userId: Types.ObjectId
  userName: string
  resourceType: string
  resourceId?: string
  action: string
  classification: string
  ip?: string
  createdAt: Date
}

const accessLogSchema = new Schema<IAccessLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String },
    action: { type: String, required: true },
    classification: { type: String, default: 'confidential' },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
accessLogSchema.index({ createdAt: -1 })
export const AccessLog = model<IAccessLog>('AccessLog', accessLogSchema)

export interface IBackupRecord extends Document {
  filename: string
  path: string
  size: number
  checksum: string
  encrypted: boolean
  status: 'running' | 'completed' | 'failed'
  collections: { name: string; count: number }[]
  restoreTestedAt?: Date
  restoreTestResult?: string
  retentionUntil: Date
  error?: string
  createdBy?: Types.ObjectId
  createdAt: Date
}

const backupSchema = new Schema<IBackupRecord>(
  {
    filename: { type: String, required: true },
    path: { type: String, required: true },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    encrypted: { type: Boolean, default: true },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'completed' },
    collections: [{ name: String, count: Number }],
    restoreTestedAt: { type: Date },
    restoreTestResult: { type: String },
    retentionUntil: { type: Date, required: true },
    error: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
export const BackupRecord = model<IBackupRecord>('BackupRecord', backupSchema)

export interface IErrorLog extends Document {
  level: string
  message: string
  stack?: string
  path?: string
  method?: string
  userId?: Types.ObjectId
  requestId?: string
  createdAt: Date
}

const errorSchema = new Schema<IErrorLog>(
  {
    level: { type: String, default: 'error' },
    message: { type: String, required: true },
    stack: { type: String },
    path: { type: String },
    method: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    requestId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
errorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 })
export const ErrorLog = model<IErrorLog>('ErrorLog', errorSchema)

export interface ISyncLog extends Document {
  userId: Types.ObjectId
  clientId: string
  action: string
  resourceType: string
  resourceId?: string
  status: 'synced' | 'conflict' | 'rejected'
  conflictReason?: string
  createdAt: Date
}

const syncSchema = new Schema<ISyncLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: String, required: true },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String },
    status: { type: String, enum: ['synced', 'conflict', 'rejected'], default: 'synced' },
    conflictReason: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
export const SyncLog = model<ISyncLog>('SyncLog', syncSchema)
