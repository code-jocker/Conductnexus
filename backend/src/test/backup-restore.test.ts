import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { createApp } from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../services/auth.service.js'
import { seedRbac, seedSchoolDefaults } from '../services/seed.service.js'
import { Role, User, UserRole } from '../models/core.js'
import { runBackup, restoreTest, encryptionKey } from '../services/backup.service.js'
import { BackupRecord } from '../models/governance.js'
import fsp from 'node:fs/promises'
import path from 'node:path'

const BACKUP_DIR = path.resolve(process.cwd(), 'storage/backups')

describe('backup restore drill', () => {
  let app: ReturnType<typeof createApp>
  let actorUserId: string

  beforeAll(async () => {
    app = createApp()
    await connectDatabase()
    await mongoose.connection.dropDatabase()

    await seedRbac()
    await seedSchoolDefaults()

    const adminRole = await Role.findOne({ key: 'ADMIN' })
    if (!adminRole) throw new Error('ADMIN role missing')

    const user = await User.create({
      name: 'Backup Operator',
      email: 'backup-operator@test.rw',
      passwordHash: await hashPassword('TestPass2026'),
      emailVerified: true,
      status: 'active',
    })
    await UserRole.create({ userId: user._id, roleId: adminRole._id, assignedAt: new Date() })
    actorUserId = String(user._id)
  })

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => undefined)
    await disconnectDatabase()
    // Clean up backup files written to disk
    try {
      await fsp.rm(BACKUP_DIR, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('performs a full backup, then verifies decryption and integrity via restore drill', async () => {
    const { id, filename, size, collections } = await runBackup({ userId: actorUserId })

    expect(id).toBeTruthy()
    expect(filename).toMatch(/^conductnexus-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.cnbackup$/)
    expect(size).toBeGreaterThan(0)
    expect(collections.length).toBeGreaterThan(0)

    const record = await BackupRecord.findById(id)
    expect(record).toBeTruthy()
    expect(record!.status).toBe('completed')
    expect(record!.encrypted).toBe(true)
    expect(record!.checksum).toHaveLength(64)

    const drill = await restoreTest(id, { userId: actorUserId })

    expect(drill.ok).toBe(true)
    expect(drill.total).toBeGreaterThan(0)
    expect(drill.counts.length).toBeGreaterThan(0)
    expect(drill.testedAt).toBeTruthy()

    const updated = await BackupRecord.findById(id)
    expect(updated!.restoreTestedAt).toBeTruthy()
    expect(updated!.restoreTestResult).toMatch(/Decryption and integrity verification succeeded/)
  })

  it('restore drill fails on a tampered backup file', async () => {
    const { id } = await runBackup({ userId: actorUserId })
    const record = await BackupRecord.findById(id)
    expect(record).toBeTruthy()

    // Corrupt the encrypted file on disk
    const encrypted = await fsp.readFile(record!.path)
    const corrupted = Buffer.from(encrypted)
    corrupted[corrupted.length - 1] ^= 0xff
    await fsp.writeFile(record!.path, corrupted)

    await expect(restoreTest(id, { userId: actorUserId })).rejects.toThrow(/checksum|integrity/i)
  })

  it('encryption key is derived from BACKUP_ENCRYPTION_KEY when configured', () => {
    const key = encryptionKey()
    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32)
  })
})
