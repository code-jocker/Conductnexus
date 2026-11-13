import { Schema, model, Types, type Document } from 'mongoose'

export interface IStream extends Document {
  name: string
  code: string
  level: 'O' | 'A'
  description?: string
  active: boolean
}

const streamSchema = new Schema<IStream>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    level: { type: String, enum: ['O', 'A'], default: 'A' },
    description: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)
export const Stream = model<IStream>('Stream', streamSchema)

export interface IClass extends Document {
  name: string
  level: string
  streamId?: Types.ObjectId | null
  order: number
  active: boolean
}

const classSchema = new Schema<IClass>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    level: { type: String, required: true, enum: ['O', 'A'] },
    streamId: { type: Schema.Types.ObjectId, ref: 'Stream', default: null },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)
export const ClassModel = model<IClass>('Class', classSchema)

export interface IDormitory extends Document {
  name: string
  code: string
  gender: 'male' | 'female' | 'mixed'
  capacity: number
  active: boolean
}

const dormitorySchema = new Schema<IDormitory>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    gender: { type: String, enum: ['male', 'female', 'mixed'], default: 'mixed' },
    capacity: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)
export const Dormitory = model<IDormitory>('Dormitory', dormitorySchema)

export interface IAcademicYear extends Document {
  name: string
  startDate: Date
  endDate: Date
  isActive: boolean
  status: 'planned' | 'active' | 'closed'
  closedAt?: Date
}

const academicYearSchema = new Schema<IAcademicYear>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false },
    status: { type: String, enum: ['planned', 'active', 'closed'], default: 'planned' },
    closedAt: { type: Date },
  },
  { timestamps: true },
)
export const AcademicYear = model<IAcademicYear>('AcademicYear', academicYearSchema)

export interface ITerm extends Document {
  academicYearId: Types.ObjectId
  name: string
  number: number
  startDate: Date
  endDate: Date
  isActive: boolean
  startingMarks: number
  closedAt?: Date
  closedSummary?: Record<string, unknown>
}

const termSchema = new Schema<ITerm>(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    name: { type: String, required: true, trim: true },
    number: { type: Number, required: true, min: 1, max: 4 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false },
    startingMarks: { type: Number, default: 40 },
    closedAt: { type: Date },
    closedSummary: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
)
termSchema.index({ academicYearId: 1, number: 1 }, { unique: true })
export const Term = model<ITerm>('Term', termSchema)

export type StudentStatus = 'active' | 'suspended' | 'transferred' | 'graduated' | 'expelled' | 'archived'

export interface IStudent extends Document {
  studentId: string
  admissionNumber: string
  firstName: string
  lastName: string
  otherNames?: string
  fullName: string
  gender: 'male' | 'female'
  dateOfBirth?: Date
  photoUrl?: string
  classId: Types.ObjectId
  streamId?: Types.ObjectId | null
  dormitoryId?: Types.ObjectId | null
  academicYearId?: Types.ObjectId | null
  termId?: Types.ObjectId | null
  currentTermId?: Types.ObjectId | null
  status: StudentStatus
  admissionDate: Date
  currentBalance: number
  balanceVersion: number
  riskLevel: 'green' | 'yellow' | 'orange' | 'red'
  enrollmentHistory: {
    academicYearId?: Types.ObjectId
    termId?: Types.ObjectId
    classId?: Types.ObjectId
    streamId?: Types.ObjectId | null
    dormitoryId?: Types.ObjectId | null
    action: string
    reason?: string
    at: Date
    by?: Types.ObjectId
  }[]
  notes?: string
  createdBy?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const studentSchema = new Schema<IStudent>(
  {
    studentId: { type: String, required: true, unique: true, trim: true },
    admissionNumber: { type: String, required: true, unique: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    otherNames: { type: String, trim: true },
    fullName: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['male', 'female'], required: true },
    dateOfBirth: { type: Date },
    photoUrl: { type: String },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
    streamId: { type: Schema.Types.ObjectId, ref: 'Stream', default: null },
    dormitoryId: { type: Schema.Types.ObjectId, ref: 'Dormitory', default: null, index: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
    termId: { type: Schema.Types.ObjectId, ref: 'Term', default: null },
    currentTermId: { type: Schema.Types.ObjectId, ref: 'Term', default: null },
    status: {
      type: String,
      enum: ['active', 'suspended', 'transferred', 'graduated', 'expelled', 'archived'],
      default: 'active',
      index: true,
    },
    admissionDate: { type: Date, default: Date.now },
    currentBalance: { type: Number, default: 40 },
    balanceVersion: { type: Number, default: 0 },
    riskLevel: { type: String, enum: ['green', 'yellow', 'orange', 'red'], default: 'green', index: true },
    enrollmentHistory: [
      {
        academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear' },
        termId: { type: Schema.Types.ObjectId, ref: 'Term' },
        classId: { type: Schema.Types.ObjectId, ref: 'Class' },
        streamId: { type: Schema.Types.ObjectId, ref: 'Stream' },
        dormitoryId: { type: Schema.Types.ObjectId, ref: 'Dormitory' },
        action: String,
        reason: String,
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
studentSchema.index({ lastName: 1, firstName: 1 })
studentSchema.index({ fullName: 'text', studentId: 'text', admissionNumber: 'text' })

export const Student = model<IStudent>('Student', studentSchema)

export interface IParent extends Document {
  name: string
  relationship: string
  phone: string
  altPhone?: string
  email?: string
  preferredChannel: 'whatsapp' | 'sms' | 'email' | 'call'
  whatsappConsent: boolean
  smsConsent: boolean
  emailConsent: boolean
  verificationStatus: 'unverified' | 'verified'
  portalUserId?: Types.ObjectId
  notes?: string
  createdBy?: Types.ObjectId
}

const parentSchema = new Schema<IParent>(
  {
    name: { type: String, required: true, trim: true },
    relationship: { type: String, default: 'Guardian' },
    phone: { type: String, required: true, trim: true, index: true },
    altPhone: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    preferredChannel: { type: String, enum: ['whatsapp', 'sms', 'email', 'call'], default: 'sms' },
    whatsappConsent: { type: Boolean, default: false },
    smsConsent: { type: Boolean, default: false },
    emailConsent: { type: Boolean, default: false },
    verificationStatus: { type: String, enum: ['unverified', 'verified'], default: 'unverified' },
    portalUserId: { type: Schema.Types.ObjectId, ref: 'User', sparse: true },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
export const Parent = model<IParent>('Parent', parentSchema)

export interface IGuardianLink extends Document {
  studentId: Types.ObjectId
  parentId: Types.ObjectId
  relationship: string
  isPrimary: boolean
}

const guardianSchema = new Schema<IGuardianLink>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Parent', required: true, index: true },
    relationship: { type: String, default: 'Guardian' },
    isPrimary: { type: Boolean, default: false },
  },
  { timestamps: true },
)
guardianSchema.index({ studentId: 1, parentId: 1 }, { unique: true })
export const GuardianLink = model<IGuardianLink>('StudentGuardian', guardianSchema)
