import { Schema, model, Types, type Document } from 'mongoose'

/**
 * Parent engagement (audit P4): school notices, guardian acknowledgements and
 * guardian-initiated meeting bookings. These records are separate from
 * discipline so a notice or booking never changes a conduct balance.
 */

export interface IAnnouncement extends Document {
  reference: string
  title: string
  body: string
  titleRw?: string
  bodyRw?: string
  audience: 'parents' | 'staff' | 'all'
  /** Empty means the whole school; otherwise the notice targets these classes. */
  classIds: Types.ObjectId[]
  studentIds: Types.ObjectId[]
  requiresAcknowledgement: boolean
  status: 'draft' | 'published' | 'archived'
  publishAt?: Date
  expiresAt?: Date
  createdBy: Types.ObjectId
  publishedBy?: Types.ObjectId
  publishedAt?: Date
}

const announcementSchema = new Schema<IAnnouncement>(
  {
    reference: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    titleRw: { type: String, trim: true },
    bodyRw: { type: String },
    audience: { type: String, enum: ['parents', 'staff', 'all'], default: 'parents', index: true },
    classIds: [{ type: Schema.Types.ObjectId, ref: 'ClassModel' }],
    studentIds: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    requiresAcknowledgement: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
    publishAt: { type: Date, index: true },
    expiresAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date },
  },
  { timestamps: true },
)
announcementSchema.index({ status: 1, audience: 1, publishAt: -1 })
export const Announcement = model<IAnnouncement>('Announcement', announcementSchema)

export type AcknowledgementItem = 'announcement' | 'letter' | 'policy'

export interface IAcknowledgement extends Document {
  parentId: Types.ObjectId
  studentId?: Types.ObjectId
  itemType: AcknowledgementItem
  itemId: Types.ObjectId
  status: 'acknowledged' | 'declined'
  note?: string
  respondedAt: Date
}

const acknowledgementSchema = new Schema<IAcknowledgement>(
  {
    parentId: { type: Schema.Types.ObjectId, ref: 'Parent', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    itemType: { type: String, enum: ['announcement', 'letter', 'policy'], required: true },
    itemId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['acknowledged', 'declined'], required: true },
    note: { type: String, maxlength: 1000 },
    respondedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)
acknowledgementSchema.index({ parentId: 1, itemType: 1, itemId: 1 }, { unique: true })
acknowledgementSchema.index({ itemType: 1, itemId: 1, status: 1 })
export const Acknowledgement = model<IAcknowledgement>('Acknowledgement', acknowledgementSchema)

export interface IMeetingRequest extends Document {
  reference: string
  parentId: Types.ObjectId
  studentId: Types.ObjectId
  preferredAt: Date
  alternateAt?: Date
  reason: string
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  decidedBy?: Types.ObjectId
  decidedAt?: Date
  decisionNote?: string
  meetingId?: Types.ObjectId
}

const meetingRequestSchema = new Schema<IMeetingRequest>(
  {
    reference: { type: String, required: true, unique: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Parent', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    preferredAt: { type: Date, required: true },
    alternateAt: { type: Date },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'declined', 'cancelled'], default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionNote: { type: String },
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting' },
  },
  { timestamps: true },
)
meetingRequestSchema.index({ status: 1, preferredAt: 1 })
export const MeetingRequest = model<IMeetingRequest>('MeetingRequest', meetingRequestSchema)
