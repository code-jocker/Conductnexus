import { Schema, model, Types, type Document } from 'mongoose'

export type UserStatus = 'active' | 'inactive' | 'pending'

export interface IUser extends Document {
  _id: Types.ObjectId
  name: string
  email: string
  passwordHash?: string
  googleUid?: string
  authProvider: 'local' | 'google' | 'both'
  emailVerified: boolean
  emailVerificationTokenHash?: string
  emailVerificationExpires?: Date
  passwordResetCodeHash?: string
  passwordResetTokenHash?: string
  passwordResetExpires?: Date
  status: UserStatus
  phone?: string
  position?: string
  avatarUrl?: string
  assignedClassIds: Types.ObjectId[]
  assignedDormitoryIds: Types.ObjectId[]
  failedLoginCount: number
  lockUntil?: Date
  lastLoginAt?: Date
  mustChangePassword: boolean
  createdBy?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, select: false },
    googleUid: { type: String, sparse: true, index: true },
    authProvider: { type: String, enum: ['local', 'google', 'both'], default: 'local' },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    passwordResetCodeHash: { type: String, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    status: { type: String, enum: ['active', 'inactive', 'pending'], default: 'active', index: true },
    phone: { type: String, trim: true },
    position: { type: String, trim: true },
    avatarUrl: { type: String },
    assignedClassIds: [{ type: Schema.Types.ObjectId, ref: 'Class' }],
    assignedDormitoryIds: [{ type: Schema.Types.ObjectId, ref: 'Dormitory' }],
    failedLoginCount: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLoginAt: { type: Date },
    mustChangePassword: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash
        delete ret.emailVerificationTokenHash
        delete ret.emailVerificationExpires
        delete ret.passwordResetCodeHash
        delete ret.passwordResetTokenHash
        delete ret.passwordResetExpires
        delete ret.__v
        return ret
      },
    },
  },
)

userSchema.index({ status: 1, createdAt: -1 })

export const User = model<IUser>('User', userSchema)

export type SessionPlatform = 'web' | 'android' | 'ios' | 'unknown'

export interface ISession extends Document {
  userId: Types.ObjectId
  tokenHash: string
  expiresAt: Date
  revokedAt?: Date
  revokedReason?: string
  replacedByHash?: string
  ip?: string
  userAgent?: string
  deviceId?: string
  deviceName?: string
  platform?: SessionPlatform
  appVersion?: string
  pushToken?: string
  lastActiveAt?: Date
  createdAt: Date
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokedReason: { type: String },
    replacedByHash: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    deviceId: { type: String },
    deviceName: { type: String },
    platform: { type: String, enum: ['web', 'android', 'ios', 'unknown'] },
    appVersion: { type: String },
    pushToken: { type: String },
    lastActiveAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
sessionSchema.index({ userId: 1, revokedAt: 1, lastActiveAt: -1 })

export const Session = model<ISession>('Session', sessionSchema)

export interface IRole extends Document {
  key: string
  name: string
  description: string
  isSystem: boolean
  createdAt: Date
}

const roleSchema = new Schema<IRole>(
  {
    key: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    isSystem: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const Role = model<IRole>('Role', roleSchema)

export interface IPermission extends Document {
  key: string
  label: string
  group: string
}

const permissionSchema = new Schema<IPermission>(
  {
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    group: { type: String, required: true },
  },
  { timestamps: true },
)

export const Permission = model<IPermission>('Permission', permissionSchema)

export interface IRolePermission extends Document {
  roleId: Types.ObjectId
  permission: string
}

const rolePermissionSchema = new Schema<IRolePermission>(
  {
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    permission: { type: String, required: true },
  },
  { timestamps: true },
)
rolePermissionSchema.index({ roleId: 1, permission: 1 }, { unique: true })
rolePermissionSchema.index({ permission: 1 })

export const RolePermission = model<IRolePermission>('RolePermission', rolePermissionSchema)

export interface IUserRole extends Document {
  userId: Types.ObjectId
  roleId: Types.ObjectId
  assignedBy?: Types.ObjectId
  assignedAt: Date
}

const userRoleSchema = new Schema<IUserRole>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)
userRoleSchema.index({ userId: 1, roleId: 1 }, { unique: true })

export const UserRole = model<IUserRole>('UserRole', userRoleSchema)

export interface IUserPermissionOverride extends Document {
  userId: Types.ObjectId
  permission: string
  effect: 'allow' | 'deny'
  reason?: string
  expiresAt?: Date
  grantedBy?: Types.ObjectId
}

const overrideSchema = new Schema<IUserPermissionOverride>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    permission: { type: String, required: true },
    effect: { type: String, enum: ['allow', 'deny'], required: true },
    reason: { type: String },
    expiresAt: { type: Date },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
overrideSchema.index({ userId: 1, permission: 1 }, { unique: true })

export const UserPermissionOverride = model<IUserPermissionOverride>(
  'UserPermissionOverride',
  overrideSchema,
)

export interface IMailMessage extends Document {
  to: string
  subject: string
  html: string
  text?: string
  status: 'queued' | 'sent' | 'failed' | 'stored'
  provider: 'smtp' | 'outbox'
  error?: string
  createdAt: Date
}

const mailSchema = new Schema<IMailMessage>(
  {
    to: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String },
    status: { type: String, enum: ['queued', 'sent', 'failed', 'stored'], default: 'queued' },
    provider: { type: String, enum: ['smtp', 'outbox'], default: 'outbox' },
    error: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
mailSchema.index({ createdAt: -1 })

export const MailMessage = model<IMailMessage>('MailMessage', mailSchema)

export interface IIdempotencyKey extends Document {
  key: string
  scope: string
  userId: Types.ObjectId
  resourceId?: string
  statusCode: number
  response: unknown
  createdAt: Date
}

const idempotencySchema = new Schema<IIdempotencyKey>(
  {
    key: { type: String, required: true },
    scope: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resourceId: { type: String },
    statusCode: { type: Number, default: 200 },
    response: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
idempotencySchema.index({ key: 1, scope: 1, userId: 1 }, { unique: true })
idempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 })

export const IdempotencyKey = model<IIdempotencyKey>('IdempotencyKey', idempotencySchema)

export interface ISettings extends Document {
  key: string
  school: {
    name: string
    shortName: string
    motto: string
    address: string
    phone: string
    email: string
    website: string
    logoUrl: string
  }
  academic: { startingMarks: number; timezone: string; language: 'en' | 'rw'; currency: string }
  discipline: {
    requireReview: boolean
    autoApproveSeverities: string[]
    highImpactDeduction: number
    maxBackdatingDays: number
  }
  risk: {
    thresholds: { green: number; yellow: number; orange: number }
    seriousRecentDays: number
    repeatOffenceThreshold: number
  }
  comms: {
    whatsappEnabled: boolean
    smsEnabled: boolean
    quietHoursStart: number
    quietHoursEnd: number
    retryLimit: number
    notifyOnDeduction: boolean
  }
  backup: {
    schedule: string
    retentionDays: number
    rpoHours: number
    rtoHours: number
    lastRunAt?: Date
    lastStatus?: string
  }
  retention: {
    studentRecordsYears: number
    disciplineYears: number
    evidenceYears: number
    auditYears: number
    safeguardingYears: number
  }
  security: {
    maxFailedLogins: number
    lockoutMinutes: number
    sessionDays: number
    requireEmailVerification: boolean
  }
  setupCompleted: boolean
  createdAt: Date
  updatedAt: Date
}

const settingsSchema = new Schema<ISettings>(
  {
    key: { type: String, required: true, unique: true, default: 'system' },
    school: {
      name: { type: String, default: '' },
      shortName: { type: String, default: 'CN' },
      motto: { type: String, default: 'Building Better Behaviour Through Connected School Discipline.' },
      address: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      website: { type: String, default: '' },
      logoUrl: { type: String, default: '' },
    },
    academic: {
      startingMarks: { type: Number, default: 40 },
      timezone: { type: String, default: 'Africa/Kigali' },
      language: { type: String, enum: ['en', 'rw'], default: 'en' },
      currency: { type: String, default: 'RWF' },
    },
    discipline: {
      requireReview: { type: Boolean, default: true },
      autoApproveSeverities: { type: [String], default: [] },
      highImpactDeduction: { type: Number, default: 8 },
      maxBackdatingDays: { type: Number, default: 14 },
    },
    risk: {
      thresholds: {
        green: { type: Number, default: 31 },
        yellow: { type: Number, default: 21 },
        orange: { type: Number, default: 11 },
      },
      seriousRecentDays: { type: Number, default: 30 },
      repeatOffenceThreshold: { type: Number, default: 3 },
    },
    comms: {
      whatsappEnabled: { type: Boolean, default: true },
      smsEnabled: { type: Boolean, default: false },
      quietHoursStart: { type: Number, default: 21 },
      quietHoursEnd: { type: Number, default: 6 },
      retryLimit: { type: Number, default: 3 },
      notifyOnDeduction: { type: Boolean, default: true },
    },
    backup: {
      schedule: { type: String, default: '0 2 * * *' },
      retentionDays: { type: Number, default: 30 },
      rpoHours: { type: Number, default: 24 },
      rtoHours: { type: Number, default: 4 },
      lastRunAt: { type: Date },
      lastStatus: { type: String },
    },
    retention: {
      studentRecordsYears: { type: Number, default: 7 },
      disciplineYears: { type: Number, default: 7 },
      evidenceYears: { type: Number, default: 5 },
      auditYears: { type: Number, default: 7 },
      safeguardingYears: { type: Number, default: 10 },
    },
    security: {
      maxFailedLogins: { type: Number, default: 5 },
      lockoutMinutes: { type: Number, default: 15 },
      sessionDays: { type: Number, default: 14 },
      requireEmailVerification: { type: Boolean, default: false },
    },
    setupCompleted: { type: Boolean, default: false },
  },
  { timestamps: true },
)

export const Settings = model<ISettings>('Settings', settingsSchema)

export async function getSettings(): Promise<ISettings> {
  let settings = await Settings.findOne({ key: 'system' })
  if (!settings) settings = await Settings.create({ key: 'system' })
  return settings
}
