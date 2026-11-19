import { Schema, model, Types, type Document } from 'mongoose'

/**
 * Confidential welfare records.
 *
 * These collections are deliberately separate from the discipline ledger and
 * from whistleblower-visible student records. Access is gated by dedicated
 * welfare permissions and every read of session notes is written to AccessLog.
 */

export const COUNSELLING_MODES = ['in_person', 'virtual', 'phone'] as const
export type CounsellingMode = (typeof COUNSELLING_MODES)[number]

export const COUNSELLING_APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const
export type CounsellingAppointmentStatus = (typeof COUNSELLING_APPOINTMENT_STATUSES)[number]

export const WELFARE_REFERRAL_SERVICES = [
  'school_nurse',
  'external_counsellor',
  'psychologist',
  'hospital',
  'social_services',
  'police',
  'family',
  'ngo',
  'other',
] as const

export const WELFARE_REFERRAL_STATUSES = ['pending', 'accepted', 'in_progress', 'closed', 'declined'] as const

export const WELFARE_PLAN_CATEGORIES = ['wellbeing', 'behaviour', 'academic', 'attendance', 'family', 'other'] as const
export const WELFARE_PLAN_STATUSES = ['draft', 'active', 'completed', 'reopened', 'abandoned'] as const

export const DETENTION_STATUSES = ['scheduled', 'attended', 'completed', 'missed', 'cancelled'] as const

export interface ICounsellingAppointment extends Document {
  reference: string
  studentId: Types.ObjectId
  counsellorId: Types.ObjectId
  scheduledAt: Date
  durationMinutes: number
  mode: CounsellingMode
  location?: string
  reason: string
  status: CounsellingAppointmentStatus
  confidential: boolean
  guardianInformed: boolean
  notes?: string
  completedAt?: Date
  cancelledReason?: string
  recordId?: Types.ObjectId
  createdBy: Types.ObjectId
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
}

const appointmentSchema = new Schema<ICounsellingAppointment>(
  {
    reference: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 45, min: 10, max: 240 },
    mode: { type: String, enum: COUNSELLING_MODES, default: 'in_person' },
    location: { type: String },
    reason: { type: String, required: true },
    status: { type: String, enum: COUNSELLING_APPOINTMENT_STATUSES, default: 'scheduled', index: true },
    confidential: { type: Boolean, default: true },
    guardianInformed: { type: Boolean, default: false },
    notes: { type: String },
    completedAt: { type: Date },
    cancelledReason: { type: String },
    recordId: { type: Schema.Types.ObjectId, ref: 'CounsellingRecord' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
  },
  { timestamps: true },
)
appointmentSchema.index({ counsellorId: 1, scheduledAt: 1 })
export const CounsellingAppointment = model<ICounsellingAppointment>('CounsellingAppointment', appointmentSchema)

export interface ICounsellingRecord extends Document {
  reference: string
  studentId: Types.ObjectId
  appointmentId?: Types.ObjectId
  counsellorId: Types.ObjectId
  sessionDate: Date
  presentingConcern: string
  sessionNotes: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  interventions: string[]
  outcome: string
  followUpRequired: boolean
  followUpDate?: Date
  referralId?: Types.ObjectId
  escalatedCaseId?: Types.ObjectId
  accessLog: { userId: Types.ObjectId; at: Date; action: string }[]
  createdBy: Types.ObjectId
}

const recordSchema = new Schema<ICounsellingRecord>(
  {
    reference: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'CounsellingAppointment' },
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionDate: { type: Date, required: true, index: true },
    presentingConcern: { type: String, required: true },
    sessionNotes: { type: String, required: true },
    riskLevel: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
    interventions: { type: [String], default: [] },
    outcome: { type: String, required: true },
    followUpRequired: { type: Boolean, default: false },
    followUpDate: { type: Date },
    referralId: { type: Schema.Types.ObjectId, ref: 'WelfareReferral' },
    escalatedCaseId: { type: Schema.Types.ObjectId, ref: 'SafeguardingCase' },
    accessLog: [{ userId: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now }, action: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)
recordSchema.index({ studentId: 1, sessionDate: -1 })
export const CounsellingRecord = model<ICounsellingRecord>('CounsellingRecord', recordSchema)

export interface IWelfareReferral extends Document {
  reference: string
  studentId: Types.ObjectId
  fromStaffId: Types.ObjectId
  service: string
  destination: string
  reason: string
  urgency: 'low' | 'medium' | 'high' | 'critical'
  consentObtained: boolean
  consentBy?: string
  externalContact?: string
  status: (typeof WELFARE_REFERRAL_STATUSES)[number]
  outcome?: string
  assignedTo?: Types.ObjectId
  closedAt?: Date
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
  createdBy: Types.ObjectId
}

const referralSchema = new Schema<IWelfareReferral>(
  {
    reference: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    fromStaffId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    service: { type: String, required: true },
    destination: { type: String, required: true },
    reason: { type: String, required: true },
    urgency: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    consentObtained: { type: Boolean, default: false },
    consentBy: { type: String },
    externalContact: { type: String },
    status: { type: String, enum: WELFARE_REFERRAL_STATUSES, default: 'pending', index: true },
    outcome: { type: String },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    closedAt: { type: Date },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)
referralSchema.index({ studentId: 1, createdAt: -1 })
export const WelfareReferral = model<IWelfareReferral>('WelfareReferral', referralSchema)

export interface IWelfareSupportPlan extends Document {
  reference: string
  studentId: Types.ObjectId
  title: string
  reason: string
  category: (typeof WELFARE_PLAN_CATEGORIES)[number]
  goals: { description: string; actions?: string; targetDate?: Date; progress: number; status: string }[]
  assignedTo: Types.ObjectId
  startDate: Date
  reviewDate?: Date
  status: (typeof WELFARE_PLAN_STATUSES)[number]
  outcome?: string
  confidentialNotes?: string
  closedAt?: Date
  closedBy?: Types.ObjectId
  reopenCount: number
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
  createdBy: Types.ObjectId
}

const supportPlanSchema = new Schema<IWelfareSupportPlan>(
  {
    reference: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    title: { type: String, required: true },
    reason: { type: String, required: true },
    category: { type: String, enum: WELFARE_PLAN_CATEGORIES, default: 'wellbeing' },
    goals: [
      {
        description: String,
        actions: String,
        targetDate: Date,
        progress: { type: Number, default: 0 },
        status: { type: String, default: 'active' },
      },
    ],
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    startDate: { type: Date, default: Date.now },
    reviewDate: { type: Date },
    status: { type: String, enum: WELFARE_PLAN_STATUSES, default: 'active', index: true },
    outcome: { type: String },
    confidentialNotes: { type: String },
    closedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reopenCount: { type: Number, default: 0 },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)
supportPlanSchema.index({ studentId: 1, status: 1 })
export const WelfareSupportPlan = model<IWelfareSupportPlan>('WelfareSupportPlan', supportPlanSchema)

export interface IDetentionSession extends Document {
  reference: string
  studentId: Types.ObjectId
  incidentId?: Types.ObjectId
  reason: string
  scheduledAt: Date
  durationMinutes: number
  location: string
  supervisorId: Types.ObjectId
  status: (typeof DETENTION_STATUSES)[number]
  attendedAt?: Date
  completedAt?: Date
  notes?: string
  cancelledReason?: string
  rescheduledFromId?: Types.ObjectId
  termId?: Types.ObjectId
  createdBy: Types.ObjectId
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
}

const detentionSchema = new Schema<IDetentionSession>(
  {
    reference: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', index: true },
    reason: { type: String, required: true },
    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 60, min: 10, max: 240 },
    location: { type: String, required: true },
    supervisorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: DETENTION_STATUSES, default: 'scheduled', index: true },
    attendedAt: { type: Date },
    completedAt: { type: Date },
    notes: { type: String },
    cancelledReason: { type: String },
    rescheduledFromId: { type: Schema.Types.ObjectId, ref: 'DetentionSession' },
    termId: { type: Schema.Types.ObjectId, ref: 'Term' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
  },
  { timestamps: true },
)
detentionSchema.index({ scheduledAt: 1, status: 1 })
export const DetentionSession = model<IDetentionSession>('DetentionSession', detentionSchema)
