import { Schema, model, Types, type Document } from 'mongoose'

export type Severity = 'minor' | 'moderate' | 'serious' | 'critical'

export interface IOffence extends Document {
  code: string
  name: string
  category: string
  description?: string
  deduction: number
  severity: Severity
  applicableLevels: string[]
  requiresApproval: boolean
  requiresEvidence: boolean
  notifyParent: boolean
  active: boolean
  policyId?: Types.ObjectId
  createdBy?: Types.ObjectId
}

const offenceSchema = new Schema<IOffence>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, default: 'General' },
    description: { type: String },
    deduction: { type: Number, required: true, min: 0, max: 40 },
    severity: { type: String, enum: ['minor', 'moderate', 'serious', 'critical'], default: 'minor' },
    applicableLevels: { type: [String], default: ['O', 'A'] },
    requiresApproval: { type: Boolean, default: true },
    requiresEvidence: { type: Boolean, default: false },
    notifyParent: { type: Boolean, default: true },
    active: { type: Boolean, default: true, index: true },
    policyId: { type: Schema.Types.ObjectId, ref: 'Policy' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
export const Offence = model<IOffence>('Offence', offenceSchema)

export interface IPolicy extends Document {
  title: string
  type: 'handbook' | 'discipline' | 'safeguarding' | 'data_protection' | 'other'
  version: string
  summary: string
  content: string
  effectiveDate: Date
  published: boolean
  offenceCategories: string[]
  supersedes?: Types.ObjectId
  createdBy?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const policySchema = new Schema<IPolicy>(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['handbook', 'discipline', 'safeguarding', 'data_protection', 'other'], default: 'discipline' },
    version: { type: String, required: true, default: '1.0' },
    summary: { type: String, default: '' },
    content: { type: String, default: '' },
    effectiveDate: { type: Date, required: true },
    published: { type: Boolean, default: false },
    offenceCategories: { type: [String], default: [] },
    supersedes: { type: Schema.Types.ObjectId, ref: 'Policy' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
policySchema.index({ title: 1, version: 1 }, { unique: true })
export const Policy = model<IPolicy>('Policy', policySchema)

export type IncidentStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'resolved'
  | 'escalated'
  | 'closed'

export interface IIncident extends Document {
  incidentNumber: string
  studentId: Types.ObjectId
  studentSnapshot: { fullName: string; studentId: string; className: string; dormitoryName?: string }
  offenceId: Types.ObjectId
  offenceSnapshot: {
    name: string
    code: string
    deduction: number
    severity: Severity
    requiresApproval: boolean
    requiresEvidence: boolean
    notifyParent: boolean
    policyTitle?: string
    policyVersion?: string
  }
  description: string
  occurredAt: Date
  location: string
  reportedBy: Types.ObjectId
  severity: Severity
  status: IncidentStatus
  evidenceIds: Types.ObjectId[]
  witnesses: { name: string; contact?: string; statement?: string }[]
  immediateAction?: string
  sanctions: {
    _id?: Types.ObjectId
    title: string
    type: 'warning' | 'detention' | 'community_service' | 'suspension' | 'expulsion_recommendation' | 'counselling' | 'other'
    details?: string
    startDate?: Date
    endDate?: Date
    status: 'active' | 'completed' | 'cancelled'
    issuedBy?: Types.ObjectId
    issuedAt: Date
  }[]
  review: {
    reviewedBy?: Types.ObjectId
    reviewedAt?: Date
    decision?: 'approved' | 'rejected' | 'info_requested'
    comments?: string
  }
  deductionApplied: boolean
  ledgerId?: Types.ObjectId
  adjustmentId?: Types.ObjectId
  approvalId?: Types.ObjectId
  parentNotificationStatus: 'not_required' | 'pending' | 'queued' | 'sent' | 'failed'
  safeguardingFlag: boolean
  investigationId?: Types.ObjectId
  academicYearId?: Types.ObjectId
  termId?: Types.ObjectId
  clientSubmissionId?: string
  bulkOperationId?: Types.ObjectId
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
  createdAt: Date
  updatedAt: Date
}

const incidentSchema = new Schema<IIncident>(
  {
    incidentNumber: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentSnapshot: {
      fullName: String,
      studentId: String,
      className: String,
      dormitoryName: String,
    },
    offenceId: { type: Schema.Types.ObjectId, ref: 'Offence', required: true, index: true },
    offenceSnapshot: {
      name: String,
      code: String,
      deduction: Number,
      severity: String,
      requiresApproval: Boolean,
      requiresEvidence: Boolean,
      notifyParent: Boolean,
      policyTitle: String,
      policyVersion: String,
    },
    description: { type: String, required: true, maxlength: 5000 },
    occurredAt: { type: Date, required: true, index: true },
    location: { type: String, required: true, trim: true },
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    severity: { type: String, enum: ['minor', 'moderate', 'serious', 'critical'], default: 'minor' },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'resolved', 'escalated', 'closed'],
      default: 'draft',
      index: true,
    },
    evidenceIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    witnesses: [{ name: String, contact: String, statement: String }],
    immediateAction: { type: String, maxlength: 1000 },
    sanctions: [
      {
        title: { type: String, required: true, maxlength: 200 },
        type: {
          type: String,
          enum: ['warning', 'detention', 'community_service', 'suspension', 'expulsion_recommendation', 'counselling', 'other'],
          default: 'warning',
        },
        details: { type: String, maxlength: 2000 },
        startDate: Date,
        endDate: Date,
        status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
        issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        issuedAt: { type: Date, default: Date.now },
      },
    ],
    review: {
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
      decision: { type: String, enum: ['approved', 'rejected', 'info_requested'] },
      comments: String,
    },
    deductionApplied: { type: Boolean, default: false },
    ledgerId: { type: Schema.Types.ObjectId, ref: 'DisciplineLedger' },
    adjustmentId: { type: Schema.Types.ObjectId, ref: 'AdjustmentRequest' },
    approvalId: { type: Schema.Types.ObjectId, ref: 'Approval' },
    parentNotificationStatus: {
      type: String,
      enum: ['not_required', 'pending', 'queued', 'sent', 'failed'],
      default: 'not_required',
    },
    safeguardingFlag: { type: Boolean, default: false },
    investigationId: { type: Schema.Types.ObjectId, ref: 'Investigation' },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear' },
    termId: { type: Schema.Types.ObjectId, ref: 'Term' },
    clientSubmissionId: { type: String, unique: true, sparse: true },
    bulkOperationId: { type: Schema.Types.ObjectId, ref: 'BulkOperation', index: true },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
  },
  { timestamps: true },
)
incidentSchema.index({ status: 1, occurredAt: -1 })
incidentSchema.index({ termId: 1, studentId: 1 })

export const Incident = model<IIncident>('Incident', incidentSchema)

export interface IDisciplineLedger extends Document {
  studentId: Types.ObjectId
  academicYearId?: Types.ObjectId
  termId: Types.ObjectId
  incidentId?: Types.ObjectId
  adjustmentId?: Types.ObjectId
  bulkOperationId?: Types.ObjectId
  type: 'initial_allocation' | 'deduction' | 'reward' | 'adjustment' | 'reversal' | 'correction'
  previousBalance: number
  change: number
  newBalance: number
  reason: string
  createdBy?: Types.ObjectId
  approvedBy?: Types.ObjectId
  status: 'posted'
  reversalOf?: Types.ObjectId
  auditRef?: string
  /** Caller-supplied key making a retried write return the original row instead of posting twice. */
  idempotencyKey?: string
  createdAt: Date
}

const ledgerSchema = new Schema<IDisciplineLedger>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear' },
    termId: { type: Schema.Types.ObjectId, ref: 'Term', required: true, index: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', index: true },
    adjustmentId: { type: Schema.Types.ObjectId, ref: 'AdjustmentRequest' },
    bulkOperationId: { type: Schema.Types.ObjectId, ref: 'BulkOperation', index: true },
    type: {
      type: String,
      enum: ['initial_allocation', 'deduction', 'reward', 'adjustment', 'reversal', 'correction'],
      required: true,
    },
    previousBalance: { type: Number, required: true },
    change: { type: Number, required: true },
    newBalance: { type: Number, required: true },
    reason: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['posted'], default: 'posted' },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'DisciplineLedger' },
    auditRef: { type: String },
    idempotencyKey: { type: String, maxlength: 160 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
ledgerSchema.index({ studentId: 1, termId: 1, createdAt: -1 })
ledgerSchema.index(
  { studentId: 1, termId: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: 'initial_allocation' } },
)
ledgerSchema.index(
  { incidentId: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: 'deduction', incidentId: { $type: 'objectId' } } },
)
// One entry per student per bulk operation — makes bulk retries idempotent at the
// row level even when the Idempotency-Key header is absent.
ledgerSchema.index(
  { bulkOperationId: 1, studentId: 1, type: 1 },
  { unique: true, partialFilterExpression: { bulkOperationId: { $type: 'objectId' } } },
)
// Client retries must replay the original row instead of posting a second one.
ledgerSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
)
// A reversal is compensative and may only exist once per original entry.
ledgerSchema.index(
  { reversalOf: 1 },
  { unique: true, partialFilterExpression: { reversalOf: { $type: 'objectId' } } },
)
ledgerSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany', 'deleteOne', 'deleteMany'], function (next) {
  next(new Error('Discipline ledger entries are immutable. Create a compensating transaction instead.'))
})

export const DisciplineLedger = model<IDisciplineLedger>('DisciplineLedger', ledgerSchema)

export interface IAdjustmentRequest extends Document {
  reference: string
  studentId: Types.ObjectId
  ledgerId?: Types.ObjectId
  incidentId?: Types.ObjectId
  requestedBy: Types.ObjectId
  reason: string
  requestedChange: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decidedBy?: Types.ObjectId
  decisionReason?: string
  decidedAt?: Date
  resultingLedgerId?: Types.ObjectId
  approvalId?: Types.ObjectId
}

const adjustmentSchema = new Schema<IAdjustmentRequest>(
  {
    reference: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    ledgerId: { type: Schema.Types.ObjectId, ref: 'DisciplineLedger' },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, maxlength: 2000 },
    requestedChange: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decisionReason: { type: String },
    decidedAt: { type: Date },
    resultingLedgerId: { type: Schema.Types.ObjectId, ref: 'DisciplineLedger' },
    approvalId: { type: Schema.Types.ObjectId, ref: 'Approval' },
  },
  { timestamps: true },
)
export const AdjustmentRequest = model<IAdjustmentRequest>('AdjustmentRequest', adjustmentSchema)

export interface IApproval extends Document {
  approvalNumber: string
  type: 'incident' | 'adjustment' | 'letter' | 'intervention' | 'safeguarding_escalation'
  refId: Types.ObjectId
  studentId?: Types.ObjectId
  title: string
  summary?: string
  requestedBy: Types.ObjectId
  status: 'pending' | 'approved' | 'rejected' | 'info_requested'
  decidedBy?: Types.ObjectId
  decisionNotes?: string
  rejectionReason?: string
  requiredPermission: string
  requiredRole?: string
  createdAt: Date
  decidedAt?: Date
}

const approvalSchema = new Schema<IApproval>(
  {
    approvalNumber: { type: String, required: true, unique: true },
    type: { type: String, enum: ['incident', 'adjustment', 'letter', 'intervention', 'safeguarding_escalation'], required: true },
    refId: { type: Schema.Types.ObjectId, required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    title: { type: String, required: true },
    summary: { type: String },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'info_requested'], default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decisionNotes: { type: String },
    rejectionReason: { type: String },
    requiredPermission: { type: String, required: true },
    requiredRole: { type: String },
    decidedAt: { type: Date },
  },
  { timestamps: true },
)
export const Approval = model<IApproval>('Approval', approvalSchema)

export interface IRiskAssessment extends Document {
  studentId: Types.ObjectId
  termId: Types.ObjectId
  category: 'green' | 'yellow' | 'orange' | 'red'
  score: number
  previousCategory?: string
  trigger: string
  explanation: string
  factors: string[]
  incidentIds: Types.ObjectId[]
  createdAt: Date
}

const riskSchema = new Schema<IRiskAssessment>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    termId: { type: Schema.Types.ObjectId, ref: 'Term', required: true },
    category: { type: String, enum: ['green', 'yellow', 'orange', 'red'], required: true },
    score: { type: Number, required: true },
    previousCategory: { type: String },
    trigger: { type: String, required: true },
    explanation: { type: String, required: true },
    factors: { type: [String], default: [] },
    incidentIds: [{ type: Schema.Types.ObjectId, ref: 'Incident' }],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
riskSchema.index({ studentId: 1, createdAt: -1 })
export const RiskAssessment = model<IRiskAssessment>('RiskAssessment', riskSchema)

export interface IBulkResultLine {
  studentId: Types.ObjectId
  name: string
  ok: boolean
  skipped?: boolean
  skipReason?: string
  change?: number
  newBalance?: number
  ledgerId?: string
  error?: string
}

export interface IBulkOperation extends Document {
  reference: string
  type: 'deduction' | 'reward'
  scope: 'class' | 'stream' | 'dormitory' | 'school' | 'selection'
  classId?: Types.ObjectId
  streamId?: Types.ObjectId
  dormitoryId?: Types.ObjectId
  offenceId?: Types.ObjectId
  points?: number
  reason: string
  termId?: Types.ObjectId
  requestedBy: Types.ObjectId
  approvedBy?: Types.ObjectId
  status: 'applying' | 'completed' | 'partial' | 'failed'
  total: number
  applied: number
  skipped: number
  failed: number
  exclusions: { studentId: Types.ObjectId; name: string; reason: string }[]
  results: IBulkResultLine[]
  clientReference?: string
  createdAt: Date
  completedAt?: Date
}

const bulkResultLineSchema = new Schema<IBulkResultLine>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    name: String,
    ok: Boolean,
    skipped: Boolean,
    skipReason: String,
    change: Number,
    newBalance: Number,
    ledgerId: String,
    error: String,
  },
  { _id: false },
)

const bulkOperationSchema = new Schema<IBulkOperation>(
  {
    reference: { type: String, required: true, unique: true },
    type: { type: String, enum: ['deduction', 'reward'], required: true },
    scope: { type: String, enum: ['class', 'stream', 'dormitory', 'school', 'selection'], required: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class' },
    streamId: { type: Schema.Types.ObjectId, ref: 'Stream' },
    dormitoryId: { type: Schema.Types.ObjectId, ref: 'Dormitory' },
    offenceId: { type: Schema.Types.ObjectId, ref: 'Offence' },
    points: { type: Number },
    reason: { type: String, required: true },
    termId: { type: Schema.Types.ObjectId, ref: 'Term' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['applying', 'completed', 'partial', 'failed'], default: 'applying' },
    total: { type: Number, default: 0 },
    applied: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    exclusions: [
      {
        studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
        name: String,
        reason: String,
        _id: false,
      },
    ],
    results: { type: [bulkResultLineSchema], default: [] },
    clientReference: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
bulkOperationSchema.index({ requestedBy: 1, createdAt: -1 })
bulkOperationSchema.index(
  { clientReference: 1, requestedBy: 1 },
  { unique: true, partialFilterExpression: { clientReference: { $type: 'string' } } },
)
export const BulkOperation = model<IBulkOperation>('BulkOperation', bulkOperationSchema)
