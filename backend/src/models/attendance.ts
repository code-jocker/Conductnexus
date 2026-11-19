import { Schema, model, Types, type Document } from 'mongoose'

/**
 * Attendance and boarding are deliberately kept out of the discipline ledger.
 * An absence is an operational fact, not a conduct deduction; nothing in this
 * module writes to DisciplineLedger or Student.currentBalance.
 */

export type AttendanceSession = 'daily' | 'classroom' | 'dormitory_morning' | 'dormitory_evening'
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'sick' | 'permission' | 'suspended'

export const ATTENDANCE_SESSIONS: AttendanceSession[] = ['daily', 'classroom', 'dormitory_morning', 'dormitory_evening']
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused', 'sick', 'permission', 'suspended']

export interface IAttendanceRecord extends Document {
  studentId: Types.ObjectId
  /** Local school date as YYYY-MM-DD so a register is unique per school day. */
  date: string
  session: AttendanceSession
  status: AttendanceStatus
  classId?: Types.ObjectId
  streamId?: Types.ObjectId | null
  dormitoryId?: Types.ObjectId | null
  minutesLate?: number
  reason?: string
  note?: string
  termId?: Types.ObjectId | null
  academicYearId?: Types.ObjectId | null
  recordedBy: Types.ObjectId
  recordedAt: Date
  source: 'manual' | 'correction' | 'import' | 'sync'
  parentNotifiedAt?: Date
  updatedBy?: Types.ObjectId
}

const attendanceRecordSchema = new Schema<IAttendanceRecord>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    session: { type: String, enum: ATTENDANCE_SESSIONS, default: 'daily', index: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', index: true },
    streamId: { type: Schema.Types.ObjectId, ref: 'Stream', default: null },
    dormitoryId: { type: Schema.Types.ObjectId, ref: 'Dormitory', default: null, index: true },
    minutesLate: { type: Number, min: 0, max: 1440 },
    reason: { type: String, trim: true, maxlength: 500 },
    note: { type: String, trim: true, maxlength: 1000 },
    termId: { type: Schema.Types.ObjectId, ref: 'Term', default: null, index: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ['manual', 'correction', 'import', 'sync'], default: 'manual' },
    parentNotifiedAt: { type: Date },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
// One register line per student, day and session. Re-marking updates in place.
attendanceRecordSchema.index({ studentId: 1, date: 1, session: 1 }, { unique: true })
attendanceRecordSchema.index({ date: 1, session: 1, classId: 1 })
attendanceRecordSchema.index({ studentId: 1, date: -1 })

export const AttendanceRecord = model<IAttendanceRecord>('AttendanceRecord', attendanceRecordSchema)

export interface IAttendanceCorrection extends Document {
  reference: string
  attendanceId: Types.ObjectId
  studentId: Types.ObjectId
  requestedBy: Types.ObjectId
  reason: string
  requestedStatus: AttendanceStatus
  requestedMinutesLate?: number
  previousStatus: AttendanceStatus
  previousMinutesLate?: number
  status: 'pending' | 'approved' | 'rejected'
  decidedBy?: Types.ObjectId
  decidedAt?: Date
  decisionNote?: string
}

const correctionSchema = new Schema<IAttendanceCorrection>(
  {
    reference: { type: String, required: true, unique: true },
    attendanceId: { type: Schema.Types.ObjectId, ref: 'AttendanceRecord', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    requestedStatus: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    requestedMinutesLate: { type: Number, min: 0, max: 1440 },
    previousStatus: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    previousMinutesLate: { type: Number },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
)
export const AttendanceCorrection = model<IAttendanceCorrection>('AttendanceCorrection', correctionSchema)

export type ExcuseCategory = 'medical' | 'family' | 'transport' | 'school_activity' | 'other'

export interface IAbsenceExcuse extends Document {
  reference: string
  studentId: Types.ObjectId
  fromDate: string
  toDate: string
  category: ExcuseCategory
  reason: string
  documentUrl?: string
  submittedBy?: Types.ObjectId
  submittedByName: string
  submittedAt: Date
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?: Types.ObjectId
  reviewedAt?: Date
  reviewNote?: string
  appliedDates: string[]
}

const excuseSchema = new Schema<IAbsenceExcuse>(
  {
    reference: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    fromDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    toDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    category: { type: String, enum: ['medical', 'family', 'transport', 'school_activity', 'other'], default: 'other' },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    documentUrl: { type: String, trim: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedByName: { type: String, required: true, trim: true },
    submittedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, trim: true, maxlength: 1000 },
    appliedDates: { type: [String], default: [] },
  },
  { timestamps: true },
)
export const AbsenceExcuse = model<IAbsenceExcuse>('AbsenceExcuse', excuseSchema)

export type BoardingMovementType = 'exit' | 'return' | 'weekend_permission' | 'medical' | 'school_activity' | 'home' | 'other'

export interface IBoardingMovement extends Document {
  reference: string
  studentId: Types.ObjectId
  dormitoryId?: Types.ObjectId | null
  type: BoardingMovementType
  destination: string
  reason: string
  outAt: Date
  expectedReturnAt?: Date
  returnedAt?: Date
  status: 'out' | 'returned' | 'overdue' | 'cancelled'
  approvedBy?: Types.ObjectId
  guardianNotifiedAt?: Date
  overdueNotifiedAt?: Date
  missingReportedAt?: Date
  missingReportedBy?: Types.ObjectId
  escalatedAt?: Date
  escalatedTo?: string[]
  resolvedAt?: Date
  resolutionNote?: string
  notes?: string
  createdBy: Types.ObjectId
}

const movementSchema = new Schema<IBoardingMovement>(
  {
    reference: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    dormitoryId: { type: Schema.Types.ObjectId, ref: 'Dormitory', default: null, index: true },
    type: { type: String, enum: ['exit', 'return', 'weekend_permission', 'medical', 'school_activity', 'home', 'other'], default: 'exit' },
    destination: { type: String, required: true, trim: true, maxlength: 200 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    outAt: { type: Date, required: true, default: Date.now },
    expectedReturnAt: { type: Date, index: true },
    returnedAt: { type: Date },
    status: { type: String, enum: ['out', 'returned', 'overdue', 'cancelled'], default: 'out', index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    guardianNotifiedAt: { type: Date },
    overdueNotifiedAt: { type: Date },
    missingReportedAt: { type: Date },
    missingReportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    escalatedAt: { type: Date },
    escalatedTo: { type: [String], default: [] },
    resolvedAt: { type: Date },
    resolutionNote: { type: String, trim: true, maxlength: 1000 },
    notes: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)
export const BoardingMovement = model<IBoardingMovement>('BoardingMovement', movementSchema)

export interface IBoardingAllocation extends Document {
  studentId: Types.ObjectId
  dormitoryId: Types.ObjectId
  roomNumber?: string
  bedNumber?: string
  allocatedAt: Date
  allocatedBy: Types.ObjectId
  active: boolean
  releasedAt?: Date
  releaseReason?: string
  notes?: string
}

const allocationSchema = new Schema<IBoardingAllocation>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    dormitoryId: { type: Schema.Types.ObjectId, ref: 'Dormitory', required: true, index: true },
    roomNumber: { type: String, trim: true, maxlength: 20 },
    bedNumber: { type: String, trim: true, maxlength: 20 },
    allocatedAt: { type: Date, default: Date.now },
    allocatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    active: { type: Boolean, default: true, index: true },
    releasedAt: { type: Date },
    releaseReason: { type: String, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
)
allocationSchema.index({ studentId: 1, active: 1 })
export const BoardingAllocation = model<IBoardingAllocation>('BoardingAllocation', allocationSchema)
