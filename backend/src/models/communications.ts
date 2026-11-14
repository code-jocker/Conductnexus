import { Schema, model, Types, type Document } from 'mongoose'

export interface ILetterTemplate extends Document {
  name: string
  type: string
  subject: string
  body: string
  active: boolean
  language: 'en' | 'rw'
  createdBy?: Types.ObjectId
}

const letterTemplateSchema = new Schema<ILetterTemplate>(
  {
    name: { type: String, required: true },
    type: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    active: { type: Boolean, default: true },
    language: { type: String, enum: ['en', 'rw'], default: 'en' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
export const LetterTemplate = model<ILetterTemplate>('LetterTemplate', letterTemplateSchema)

export interface ILetter extends Document {
  reference: string
  type:
    | 'warning'
    | 'parent_meeting_invitation'
    | 'serious_incident'
    | 'hearing_invitation'
    | 'suspension'
    | 'expulsion_recommendation'
    | 'expulsion_decision'
    | 'conduct_report'
    | 'improvement_notice'
  studentId: Types.ObjectId
  incidentId?: Types.ObjectId
  investigationId?: Types.ObjectId
  subject: string
  body: string
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'issued'
  preparedBy: Types.ObjectId
  approvedBy?: Types.ObjectId
  approvalNotes?: string
  rejectionReason?: string
  issuedAt?: Date
  deliveryStatus: 'not_sent' | 'queued' | 'sent' | 'failed'
  templateId?: Types.ObjectId
  confidentiality: 'standard' | 'restricted'
  studentSnapshot: { fullName: string; studentId: string; className: string }
  history: { at: Date; by?: Types.ObjectId; action: string; note?: string }[]
  createdAt: Date
  updatedAt: Date
}

const letterSchema = new Schema<ILetter>(
  {
    reference: { type: String, required: true, unique: true },
    type: {
      type: String,
      enum: [
        'warning', 'parent_meeting_invitation', 'serious_incident', 'hearing_invitation',
        'suspension', 'expulsion_recommendation', 'expulsion_decision', 'conduct_report', 'improvement_notice',
      ],
      required: true,
    },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident' },
    investigationId: { type: Schema.Types.ObjectId, ref: 'Investigation' },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected', 'issued'], default: 'draft', index: true },
    preparedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvalNotes: { type: String },
    rejectionReason: { type: String },
    issuedAt: { type: Date },
    deliveryStatus: { type: String, enum: ['not_sent', 'queued', 'sent', 'failed'], default: 'not_sent' },
    templateId: { type: Schema.Types.ObjectId, ref: 'LetterTemplate' },
    confidentiality: { type: String, enum: ['standard', 'restricted'], default: 'standard' },
    studentSnapshot: { fullName: String, studentId: String, className: String },
    history: [{ at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, note: String }],
  },
  { timestamps: true },
)
export const Letter = model<ILetter>('Letter', letterSchema)

export interface INotificationTemplate extends Document {
  key: string
  name: string
  channel: 'in_app' | 'whatsapp' | 'sms' | 'email'
  subject: string
  body: string
  active: boolean
  language: 'en' | 'rw'
}

const notificationTemplateSchema = new Schema<INotificationTemplate>(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    channel: { type: String, enum: ['in_app', 'whatsapp', 'sms', 'email'], default: 'whatsapp' },
    subject: { type: String, default: '' },
    body: { type: String, required: true },
    active: { type: Boolean, default: true },
    language: { type: String, enum: ['en', 'rw'], default: 'en' },
  },
  { timestamps: true },
)
export const NotificationTemplate = model<INotificationTemplate>('NotificationTemplate', notificationTemplateSchema)

export interface INotification extends Document {
  userId: Types.ObjectId
  type: string
  title: string
  message: string
  link?: string
  readAt?: Date
  data?: Record<string, unknown>
  createdAt: Date
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String },
    readAt: { type: Date },
    data: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 })
export const Notification = model<INotification>('Notification', notificationSchema)

export interface IMessageQueue extends Document {
  channel: 'whatsapp' | 'sms' | 'email'
  to: string
  parentId?: Types.ObjectId
  studentId?: Types.ObjectId
  incidentId?: Types.ObjectId
  letterId?: Types.ObjectId
  templateKey?: string
  subject?: string
  body: string
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'manual_review' | 'dead_letter'
  attempts: number
  maxAttempts: number
  nextAttemptAt: Date
  lastError?: string
  leaseUntil?: Date
  dedupeKey?: string
  sentAt?: Date
  provider?: string
  createdBy?: Types.ObjectId
  createdAt: Date
}

const messageSchema = new Schema<IMessageQueue>(
  {
    channel: { type: String, enum: ['whatsapp', 'sms', 'email'], required: true },
    to: { type: String, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Parent' },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident' },
    letterId: { type: Schema.Types.ObjectId, ref: 'Letter' },
    templateKey: { type: String },
    subject: { type: String },
    body: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'sending', 'sent', 'failed', 'manual_review', 'dead_letter'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lastError: { type: String },
    leaseUntil: { type: Date },
    dedupeKey: { type: String, unique: true, sparse: true },
    sentAt: { type: Date },
    provider: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
messageSchema.index({ status: 1, nextAttemptAt: 1 })
export const MessageQueue = model<IMessageQueue>('MessageQueue', messageSchema)

export interface IWhatsappSession extends Document {
  sessionName: string
  status: 'disabled' | 'not_installed' | 'initializing' | 'pairing' | 'qr' | 'ready' | 'auth_failure' | 'failed' | 'disconnected'
  qrDataUrl?: string
  pairingCode?: string
  pairingPhone?: string
  lastQrAt?: Date
  lastConnectedAt?: Date
  lastError?: string
  info?: { pushname?: string; number?: string }
}

const whatsappSchema = new Schema<IWhatsappSession>(
  {
    sessionName: { type: String, required: true, unique: true },
    status: { type: String, default: 'disconnected' },
    qrDataUrl: { type: String },
    pairingCode: { type: String },
    pairingPhone: { type: String },
    lastQrAt: { type: Date },
    lastConnectedAt: { type: Date },
    lastError: { type: String },
    info: { pushname: String, number: String },
  },
  { timestamps: true },
)
export const WhatsappSession = model<IWhatsappSession>('WhatsappSession', whatsappSchema)

export interface ICalendarEvent extends Document {
  title: string
  type: 'parent_meeting' | 'hearing' | 'counselling' | 'follow_up' | 'deadline' | 'school' | 'staff'
  startAt: Date
  endAt: Date
  allDay: boolean
  location?: string
  studentId?: Types.ObjectId
  incidentId?: Types.ObjectId
  meetingId?: Types.ObjectId
  assignedTo: Types.ObjectId[]
  createdBy: Types.ObjectId
  notes?: string
  confidential: boolean
  status: 'scheduled' | 'completed' | 'cancelled'
  reminderMinutes?: number
}

const calendarSchema = new Schema<ICalendarEvent>(
  {
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ['parent_meeting', 'hearing', 'counselling', 'follow_up', 'deadline', 'school', 'staff'],
      default: 'school',
    },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    location: { type: String },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident' },
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting' },
    assignedTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String },
    confidential: { type: Boolean, default: false },
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
    reminderMinutes: { type: Number, default: 30 },
  },
  { timestamps: true },
)
export const CalendarEvent = model<ICalendarEvent>('CalendarEvent', calendarSchema)

export interface IMeeting extends Document {
  reference: string
  title: string
  type: 'parent' | 'hearing' | 'counselling' | 'staff' | 'safeguarding'
  scheduledAt: Date
  durationMinutes: number
  location?: string
  studentId?: Types.ObjectId
  caseId?: Types.ObjectId
  participants: { name: string; phone?: string; role?: string; userId?: Types.ObjectId }[]
  invitations: { channel: string; status: string; sentAt?: Date; to?: string }[]
  attendance: { name: string; userId?: Types.ObjectId; status: 'invited' | 'attended' | 'absent' | 'excused' }[]
  notes?: string
  decisions?: string
  followUpActions: { description: string; assigneeId?: Types.ObjectId; dueDate?: Date; status: 'pending' | 'completed' }[]
  status: 'scheduled' | 'completed' | 'cancelled'
  confidentiality: 'standard' | 'restricted'
  createdBy: Types.ObjectId
  calendarEventId?: Types.ObjectId
}

const meetingSchema = new Schema<IMeeting>(
  {
    reference: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    type: { type: String, enum: ['parent', 'hearing', 'counselling', 'staff', 'safeguarding'], default: 'parent' },
    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 30 },
    location: { type: String },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    caseId: { type: Schema.Types.ObjectId },
    participants: [{ name: String, phone: String, role: String, userId: { type: Schema.Types.ObjectId, ref: 'User' } }],
    invitations: [{ channel: String, status: String, sentAt: Date, to: String }],
    attendance: [{ name: String, userId: { type: Schema.Types.ObjectId, ref: 'User' }, status: { type: String, enum: ['invited', 'attended', 'absent', 'excused'], default: 'invited' } }],
    notes: { type: String },
    decisions: { type: String },
    followUpActions: [{ description: String, assigneeId: { type: Schema.Types.ObjectId, ref: 'User' }, dueDate: Date, status: { type: String, enum: ['pending', 'completed'], default: 'pending' } }],
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
    confidentiality: { type: String, enum: ['standard', 'restricted'], default: 'standard' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    calendarEventId: { type: Schema.Types.ObjectId, ref: 'CalendarEvent' },
  },
  { timestamps: true },
)
export const Meeting = model<IMeeting>('Meeting', meetingSchema)
