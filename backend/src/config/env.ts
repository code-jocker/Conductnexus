import 'dotenv/config'
import { z } from 'zod'

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/conductnexus'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(14),
  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('ConductNexus <no-reply@conductnexus.rw>'),
  BACKUP_ENCRYPTION_KEY: z.string().optional().default(''),
  ERROR_REPORTING_PROVIDER: z.string().optional().default('log'),
  BACKUP_SCHEDULE: z.string().default('0 2 * * *'),
  BACKUP_RETENTION_DAYS: z.coerce.number().default(30),
  ENABLE_WHATSAPP: bool,
  WHATSAPP_SESSION: z.string().default('conductnexus'),
  WHATSAPP_EXECUTABLE_PATH: z.string().optional().default(''),
  WHATSAPP_RESOLVER_IP: z.string().optional().default(''),
  WHATSAPP_PAIR_PHONE: z.string().optional().default(''),
  AT_USERNAME: z.string().optional().default(''),
  AT_API_KEY: z.string().optional().default(''),
  AT_SENDER_ID: z.string().optional().default(''),
  AT_SMS_URL: z.string().optional().default(''),
  EXPO_ACCESS_TOKEN: z.string().optional().default(''),
  UPLOAD_DIR: z.string().default('storage/evidence'),
  ADMIN_EMAIL: z.string().optional().default(''),
  ADMIN_PASSWORD: z.string().optional().default(''),
  ADMIN_NAME: z.string().default('System Administrator'),
  SCHOOL_NAME: z.string().optional().default(''),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'

export const BACKUP_KEY_MIN_LENGTH = 32

/**
 * Backup encryption key policy.
 *
 * Outside production the service may fall back to a key derived from
 * `JWT_ACCESS_SECRET` so a fresh clone can take a backup. In production that
 * fallback would silently reuse a signing secret as an encryption key, so the
 * deployment is refused at boot instead — a missing key is a configuration
 * error, not something to paper over.
 *
 * Exported separately from the process-level check so the policy can be
 * unit-tested without exiting the test runner.
 */
export function backupKeyPolicyError(nodeEnv: string, key: string): string | null {
  if (nodeEnv !== 'production') return null
  const trimmed = key.trim()
  if (trimmed.length >= BACKUP_KEY_MIN_LENGTH) return null
  return `BACKUP_ENCRYPTION_KEY is required in production and must be at least ${BACKUP_KEY_MIN_LENGTH} characters`
}

const backupKeyError = backupKeyPolicyError(env.NODE_ENV, env.BACKUP_ENCRYPTION_KEY)
if (backupKeyError) {
  console.error(`Invalid environment configuration:\n  ${backupKeyError}.`)
  console.error(`  Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
  process.exit(1)
}

export const backupEncryptionKeyConfigured = env.BACKUP_ENCRYPTION_KEY.trim().length >= BACKUP_KEY_MIN_LENGTH
export const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)
export const smsConfigured = Boolean(env.AT_USERNAME && env.AT_API_KEY)
export const firebaseConfigured = Boolean(env.FIREBASE_PROJECT_ID)
export const whatsappEnabled = env.ENABLE_WHATSAPP
