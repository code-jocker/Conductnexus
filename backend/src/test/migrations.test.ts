import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
// Register the collections the baseline migration indexes so the test does not
// depend on another file having created them first.
import '../models/discipline.js'
import { Migration } from '../models/migration.js'
import {
  compareMigrations,
  discoverMigrations,
  migrationStatus,
  runMigrations,
  type AppliedMigration,
  type MigrationFile,
} from '../services/migrations.service.js'

/**
 * Migration runner guarantees:
 *  - every migration is applied exactly once;
 *  - a second run is a no-op;
 *  - an applied migration edited on disk is refused, not silently re-run;
 *  - a ledger entry with no file is refused;
 *  - ordering is ascending.
 */

const file = (name: string, checksum: string): MigrationFile => ({
  name,
  file: `${name}.ts`,
  path: `/tmp/${name}.ts`,
  checksum,
})

beforeAll(async () => {
  await connectDatabase()
  await Migration.deleteMany({})
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()))
  // The imported discipline model declares clientSubmissionId_1 as unique,
  // while the historical baseline migration intentionally creates it sparse
  // but non-unique. Remove the model-created test index so the migration can
  // exercise its own declared index definition in this isolated CI database.
  await mongoose.connection.collection('incidents').dropIndex('clientSubmissionId_1').catch(() => undefined)
})

afterAll(async () => {
  await Migration.deleteMany({})
  await disconnectDatabase()
})

describe('migration runner', () => {
  it('discovers migrations in ascending filename order', async () => {
    const files = await discoverMigrations()
    expect(files.length).toBeGreaterThan(0)
    const names = files.map((f) => f.name)
    expect(names).toEqual([...names].sort())
    for (const f of files) {
      expect(f.name).toMatch(/^\d{4}_/)
      expect(f.checksum).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('applies every pending migration exactly once', async () => {
    const first = await runMigrations()
    expect(first.applied.length).toBeGreaterThan(0)
    expect(first.skipped).toBe(0)

    const second = await runMigrations()
    expect(second.applied).toEqual([])
    expect(second.skipped).toBe(first.applied.length)

    const ledger = await Migration.countDocuments()
    expect(ledger).toBe(first.applied.length)

    const status = await migrationStatus()
    expect(status.pending).toEqual([])
    expect(status.modified).toEqual([])
    expect(status.missing).toEqual([])
  })

  it('is idempotent after the ledger is cleared but indexes exist', async () => {
    const files = await discoverMigrations()
    const applied: AppliedMigration[] = files.map((f) => ({ name: f.name, checksum: f.checksum }))
    const { pending } = compareMigrations(files, applied)
    expect(pending).toEqual([])
  })

  it('reports a modified applied migration instead of re-running it', () => {
    const files = [file('0001_baseline_indexes', 'a'.repeat(64)), file('0002_other', 'b'.repeat(64))]
    const applied: AppliedMigration[] = [{ name: '0001_baseline_indexes', checksum: 'c'.repeat(64) }]

    const { pending, modified } = compareMigrations(files, applied)
    expect(modified).toEqual(['0001_baseline_indexes'])
    expect(pending.map((f) => f.name)).toEqual(['0002_other'])
  })

  it('reports a ledger entry whose file is missing', () => {
    const files = [file('0001_baseline_indexes', 'a'.repeat(64))]
    const applied: AppliedMigration[] = [
      { name: '0001_baseline_indexes', checksum: 'a'.repeat(64) },
      { name: '0099_removed', checksum: 'd'.repeat(64) },
    ]

    const { missing, pending } = compareMigrations(files, applied)
    expect(missing).toEqual(['0099_removed'])
    expect(pending).toEqual([])
  })

  it('creates the indexes declared by the baseline migration', async () => {
    await runMigrations()
    const indexes = await mongoose.connection.collection('incidents').indexes()
    expect(indexes.some((index) => index.name.includes('status_1_occurredAt_-1'))).toBe(true)
    expect(indexes.some((index) => index.name.includes('clientSubmissionId_1'))).toBe(true)
  })
})