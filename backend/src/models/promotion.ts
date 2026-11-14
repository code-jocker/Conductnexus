import { Schema, model, Types, type Document } from 'mongoose'

export type PromotionBatchStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type PromotionItemStatus = 'pending' | 'promoted' | 'graduated' | 'skipped' | 'failed'

export interface IPromotionItem {
  studentId: Types.ObjectId
  studentSnapshot: { fullName: string; studentId: string; admissionNumber: string }
  fromClassId: Types.ObjectId
  toClassId?: Types.ObjectId | null
  fromStreamId?: Types.ObjectId | null
  toStreamId?: Types.ObjectId | null
  status: PromotionItemStatus
  error?: string
  executedAt?: Date
}

export interface IPromotionBatch extends Document {
  batchNumber: string
  title: string
  fromClassId: Types.ObjectId
  toClassId?: Types.ObjectId | null
  graduate: boolean
  fromAcademicYearId?: Types.ObjectId | null
  toAcademicYearId?: Types.ObjectId | null
  toTermId?: Types.ObjectId | null
  status: PromotionBatchStatus
  reason?: string
  items: IPromotionItem[]
  createdBy: Types.ObjectId
  submittedBy?: Types.ObjectId
  submittedAt?: Date
  reviewedBy?: Types.ObjectId
  reviewedAt?: Date
  decisionNotes?: string
  rejectionReason?: string
  executedBy?: Types.ObjectId
  executedAt?: Date
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
  createdAt: Date
  updatedAt: Date
}

const promotionItemSchema = new Schema<IPromotionItem>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    studentSnapshot: { fullName: String, studentId: String, admissionNumber: String },
    fromClassId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    toClassId: { type: Schema.Types.ObjectId, ref: 'Class', default: null },
    fromStreamId: { type: Schema.Types.ObjectId, ref: 'Stream', default: null },
    toStreamId: { type: Schema.Types.ObjectId, ref: 'Stream', default: null },
    status: {
      type: String,
      enum: ['pending', 'promoted', 'graduated', 'skipped', 'failed'],
      default: 'pending',
    },
    error: String,
    executedAt: Date,
  },
  { _id: true },
)

const promotionBatchSchema = new Schema<IPromotionBatch>(
  {
    batchNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    fromClassId: { type: Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
    toClassId: { type: Schema.Types.ObjectId, ref: 'Class', default: null },
    graduate: { type: Boolean, default: false },
    fromAcademicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear' },
    toAcademicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear' },
    toTermId: { type: Schema.Types.ObjectId, ref: 'Term' },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'approved', 'rejected', 'executing', 'completed', 'failed', 'cancelled'],
      default: 'draft',
      index: true,
    },
    reason: String,
    items: { type: [promotionItemSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    decisionNotes: String,
    rejectionReason: String,
    executedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    executedAt: Date,
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
  },
  { timestamps: true },
)
promotionBatchSchema.index({ status: 1, createdAt: -1 })
promotionBatchSchema.index({ 'items.studentId': 1 })

export const PromotionBatch = model<IPromotionBatch>('PromotionBatch', promotionBatchSchema)
