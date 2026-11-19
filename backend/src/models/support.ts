import { Schema, model, Types, type Document } from 'mongoose'

export interface IIntervention extends Document {
  studentId: Types.ObjectId
  termId?: Types.ObjectId
  type: 'counselling' | 'behaviour_plan' | 'mentoring' | 'family' | 'watchlist'
  title: string
  plan: string
  goals: { description: string; target?: string; progress: number }[]
  assignedTo: Types.ObjectId
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  startDate: Date
  reviewDate?: Date
  outcome?: string
  confidentialNotes?: string
  createdBy: Types.ObjectId
}

const interventionSchema = new Schema<IIntervention>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    termId: { type: Schema.Types.ObjectId, ref: 'Term' },
    type: { type: String, enum: ['counselling', 'behaviour_plan', 'mentoring', 'family', 'watchlist'], default: 'mentoring' },
    title: { type: String, required: true },
    plan: { type: String, required: true },
    goals: [{ description: String, target: String, progress: { type: Number, default: 0 } }],
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['open', 'in_progress', 'completed', 'cancelled'], default: 'open', index: true },
    startDate: { type: Date, default: Date.now },
    reviewDate: { type: Date },
    outcome: { type: String },
    confidentialNotes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)
export const Intervention = model<IIntervention>('Intervention', interventionSchema)

export interface IFollowUp extends Document {
  studentId: Types.ObjectId
  interventionId?: Types.ObjectId
  type: 'counselling' | 'parent_meeting' | 'behaviour_check' | 'academic' | 'boarding_welfare' | 'other'
  dueDate: Date
  assignedTo: Types.ObjectId
  status: 'pending' | 'completed' | 'overdue' | 'cancelled'
  notes?: string
  completedAt?: Date
  completedBy?: Types.ObjectId
  createdBy: Types.ObjectId
}

const followUpSchema = new Schema<IFollowUp>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    interventionId: { type: Schema.Types.ObjectId, ref: 'Intervention' },
    type: { type: String, enum: ['counselling', 'parent_meeting', 'behaviour_check', 'academic', 'boarding_welfare', 'other'], default: 'behaviour_check' },
    dueDate: { type: Date, required: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'completed', 'overdue', 'cancelled'], default: 'pending', index: true },
    notes: { type: String },
    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)
export const FollowUp = model<IFollowUp>('FollowUp', followUpSchema)

export interface IRecognition extends Document {
  studentId: Types.ObjectId
  type: 'positive_behaviour' | 'achievement' | 'reward'
  category: string
  title: string
  description: string
  points: number
  awardedBy: Types.ObjectId
  awardedAt: Date
  termId?: Types.ObjectId
}

const recognitionSchema = new Schema<IRecognition>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    type: { type: String, enum: ['positive_behaviour', 'achievement', 'reward'], default: 'positive_behaviour' },
    category: { type: String, default: 'Positive conduct' },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    points: { type: Number, default: 0, min: 0, max: 20 },
    awardedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    awardedAt: { type: Date, default: Date.now },
    termId: { type: Schema.Types.ObjectId, ref: 'Term' },
  },
  { timestamps: true },
)
export const Recognition = model<IRecognition>('Recognition', recognitionSchema)

export interface IRecognitionPlan extends Document {
  studentId: Types.ObjectId
  title: string
  reason: string
  goals: { description: string; actions?: string; targetDate?: Date; progress: number; status: string }[]
  supportStaffId: Types.ObjectId
  startDate: Date
  nextReviewDate?: Date
  status: 'active' | 'completed' | 'abandoned'
  outcomeNotes?: string
  createdBy: Types.ObjectId
}

const planSchema = new Schema<IRecognitionPlan>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    title: { type: String, required: true },
    reason: { type: String, required: true },
    goals: [{ description: String, actions: String, targetDate: Date, progress: { type: Number, default: 0 }, status: { type: String, default: 'active' } }],
    supportStaffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startDate: { type: Date, default: Date.now },
    nextReviewDate: { type: Date },
    status: { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
    outcomeNotes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)
export const RecognitionPlan = model<IRecognitionPlan>('RecognitionPlan', planSchema)

export interface IWatchlistEntry extends Document {
  studentId: Types.ObjectId
  level: 'watch' | 'blacklist'
  reason: string
  addedBy: Types.ObjectId
  active: boolean
  expiresAt?: Date
}

const watchlistSchema = new Schema<IWatchlistEntry>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    level: { type: String, enum: ['watch', 'blacklist'], default: 'watch' },
    reason: { type: String, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    active: { type: Boolean, default: true },
    expiresAt: { type: Date },
  },
  { timestamps: true },
)
export const WatchlistEntry = model<IWatchlistEntry>('WatchlistEntry', watchlistSchema)
