import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { getSettings } from '../models/core.js'
import { BackupRecord } from '../models/governance.js'
import { logger } from '../shared/logger.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from './audit.service.js'
import type { AuthContext } from './rbac.service.js'

const BACKUP_DIR = path.resolve(process.cwd(), 'storage/backups')
const EXCLUDED = new Set(['sessions', 'errorlogs', 'idempotencykeys', 'synclogs', 'backuprecords'])
let running = false

export function encryptionKey(): Buffer {
  const configured = env.BACKUP_ENCRYPTION_KEY.trim()
  if (configured && /^[0-9a-f]{64}$/i.test(configured)) {
    return Buffer.from(configured, 'hex')
  }
  if (configured) {
    // Any sufficiently strong passphrase is accepted; stretch it to 32 bytes.
    return crypto.createHash('sha256').update(configured).digest()
  }
  return crypto.createHash('sha256').update(env.JWT_ACCESS_SECRET).digest()
}

/**
 * Key used by backups written before `BACKUP_ENCRYPTION_KEY` was mandatory.
 * Only consulted when decryption with the configured key fails, so enabling the
 * production key does not make earlier backups unreadable.
 */
function legacyEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(env.JWT_ACCESS_SECRET).digest()
}

function encryptWith(key: Buffer, buffer: Buffer): Buffer {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted])
}

function decryptWith(key: Buffer, buffer: Buffer): Buffer {
  const iv = buffer.subarray(0, 12)
  const tag = buffer.subarray(12, 28)
  const data = buffer.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

function encrypt(buffer: Buffer): Buffer {
  return encryptWith(encryptionKey(), buffer)
}

function decrypt(buffer: Buffer): Buffer {
  try {
    return decryptWith(encryptionKey(), buffer)
  } catch (err) {
    const legacy = legacyEncryptionKey()
    if (legacy.equals(encryptionKey())) throw err
    // Backups written before BACKUP_ENCRYPTION_KEY existed used the JWT-derived
    // key; keep them readable rather than failing the restore.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'backup decrypt failed with the configured key; trying the legacy key')
    return decryptWith(legacy, buffer)
  }
}

export async function ensureBackupDir() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true })
}

export async function runBackup(actor?: AuthContext): Promise<{ id: string; filename: string; size: number; collections: { name: string; count: number }[] }> {
  if (running) throw ApiError.conflict('A backup is already running')
  running = true
  const settings = await getSettings()
  const started = Date.now()
  const filename = `conductnexus-${new Date().toISOString().replace(/[:.]/g, '-')}.cnbackup`
  const filePath = path.join(BACKUP_DIR, filename)
  try {
    await ensureBackupDir()
    const db = mongoose.connection.db
    if (!db) throw ApiError.internal('Database is not connected')
    const collections = await db.listCollections().toArray()
    const payload: Record<string, unknown[]> = {}
    const counts: { name: string; count: number }[] = []
    for (const c of collections) {
      if (EXCLUDED.has(c.name.toLowerCase()) || c.name.startsWith('system.')) continue
      const docs = await db.collection(c.name).find({}).toArray()
      payload[c.name] = docs
      counts.push({ name: c.name, count: docs.length })
    }
    const json = Buffer.from(
      JSON.stringify({ meta: { created: new Date().toISOString(), version: 1, database: 'conductnexus' }, collections: payload }),
      'utf8',
    )
    const encrypted = encrypt(json)
    await fsp.writeFile(filePath, encrypted)
    const checksum = crypto.createHash('sha256').update(encrypted).digest('hex')
    const size = encrypted.length
    const retentionUntil = new Date(Date.now() + settings.backup.retentionDays * 86_400_000)

    const record = await BackupRecord.create({
      filename,
      path: filePath,
      size,
      checksum,
      encrypted: true,
      status: 'completed',
      collections: counts,
      retentionUntil,
      createdBy: actor?.userId,
    })

    settings.backup.lastRunAt = new Date()
    settings.backup.lastStatus = 'completed'
    await settings.save()
    await writeAudit({
      actor,
      action: 'backup.completed',
      resourceType: 'BackupRecord',
      resourceId: String(record._id),
      after: { filename, size, collections: counts.length },
    })
    logger.info({ filename, size, durationMs: Date.now() - started }, 'Encrypted backup completed')
    await cleanupOldBackups()
    return { id: String(record._id), filename, size, collections: counts }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backup failed'
    await BackupRecord.create({
      filename,
      path: filePath,
      size: 0,
      checksum: '',
      encrypted: true,
      status: 'failed',
      collections: [],
      retentionUntil: new Date(),
      error: message,
      createdBy: actor?.userId,
    }).catch(() => undefined)
    settings.backup.lastRunAt = new Date()
    settings.backup.lastStatus = 'failed'
    await settings.save()
    await writeAudit({ actor, action: 'backup.failed', resourceType: 'BackupRecord', reason: message })
    throw ApiError.internal(`Backup failed: ${message}`)
  } finally {
    running = false
  }
}

export async function cleanupOldBackups(): Promise<number> {
  const expired = await BackupRecord.find({ retentionUntil: { $lt: new Date() } })
  let removed = 0
  for (const record of expired) {
    try {
      if (fs.existsSync(record.path)) {
        await fsp.unlink(record.path)
        removed++
      }
    } catch (err) {
      logger.warn({ err, file: record.filename }, 'Could not delete expired backup file')
    }
  }
  return removed
}

export async function restoreTest(backupId: string, actor?: AuthContext) {
  const record = await BackupRecord.findById(backupId)
  if (!record) throw ApiError.notFound('Backup not found')
  if (!fs.existsSync(record.path)) throw ApiError.notFound('Backup file is missing from storage')
  await ensureBackupDir()
  const encrypted = await fsp.readFile(record.path)
  const checksum = crypto.createHash('sha256').update(encrypted).digest('hex')
  if (checksum !== record.checksum) throw ApiError.badRequest('Backup integrity check failed: checksum does not match')
  const json = decrypt(encrypted)
  const parsed = JSON.parse(json.toString('utf8')) as { collections: Record<string, unknown[]> }
  const counts = Object.entries(parsed.collections).map(([name, docs]) => ({ name, count: docs.length }))
  const total = counts.reduce((s, c) => s + c.count, 0)
  record.restoreTestedAt = new Date()
  record.restoreTestResult = `Decryption and integrity verification succeeded. ${counts.length} collections, ${total} documents readable.`
  await record.save()
  await writeAudit({
    actor,
    action: 'backup.restore_tested',
    resourceType: 'BackupRecord',
    resourceId: String(record._id),
    after: { collections: counts.length, documents: total },
  })
  return { ok: true, counts, total, testedAt: record.restoreTestedAt }
}

export async function backupFile(backupId: string) {
  const record = await BackupRecord.findById(backupId)
  if (!record) throw ApiError.notFound('Backup not found')
  if (!fs.existsSync(record.path)) throw ApiError.notFound('Backup file is missing from storage')
  return { record, stream: fs.createReadStream(record.path) }
}

export async function startBackupSchedule(cron: { schedule: (expr: string, fn: () => void) => unknown }) {
  const settings = await getSettings()
  cron.schedule(settings.backup.schedule, () => {
    runBackup().catch((err) => logger.error({ err }, 'Scheduled backup failed'))
  })
  logger.info({ schedule: settings.backup.schedule }, 'Backup schedule registered')
}
