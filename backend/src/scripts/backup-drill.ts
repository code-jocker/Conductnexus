import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { logger } from '../shared/logger.js'
import { runBackup, restoreTest } from '../services/backup.service.js'

/**
 * Backup restore drill.
 *
 *   npm run backup:drill
 *
 * Takes a fresh backup, verifies its checksum and decryption through the same
 * code path an operator would use, then compares the readable document counts
 * against the live database. Exits non-zero if the backup cannot be restored or
 * if any collection count differs, so a silent backup failure cannot reach a
 * disaster.
 */

const EXCLUDED = new Set(['sessions', 'errorlogs', 'idempotencykeys', 'synclogs', 'backuprecords'])

/**
 * Collections the drill itself writes to. Taking a backup records an audit entry
 * and the restore test records another, so their counts legitimately advance
 * between the snapshot and the comparison — they are reported but never counted
 * as a failure.
 */
const DRILL_WRITES = new Set(['auditlogs'])

async function liveCounts(): Promise<Record<string, number>> {
  const db = mongoose.connection.db
  if (!db) throw new Error('No database connection')
  const collections = await db.listCollections().toArray()
  const counts: Record<string, number> = {}
  for (const { name } of collections) {
    if (EXCLUDED.has(name)) continue
    counts[name] = await db.collection(name).countDocuments()
  }
  return counts
}

async function main() {
  await connectDatabase()

  // Snapshot before the backup so the comparison is against the state that was
  // actually captured.
  const liveBefore = await liveCounts()

  const backup = await runBackup()
  logger.info(
    { id: String(backup.id), filename: backup.filename, bytes: backup.size, collections: backup.collections.length },
    'backup written',
  )

  const restored = await restoreTest(String(backup.id))
  logger.info({ collections: restored.counts.length, documents: restored.total }, 'restore verification succeeded')

  const backupCounts = new Map(restored.counts.map((row) => [row.name, row.count]))

  const mismatches: string[] = []
  for (const [name, count] of Object.entries(liveBefore)) {
    if (DRILL_WRITES.has(name)) continue
    const inBackup = backupCounts.get(name) ?? 0
    if (inBackup !== count) mismatches.push(`${name}: backup ${inBackup} vs live ${count}`)
  }
  for (const name of backupCounts.keys()) {
    if (DRILL_WRITES.has(name)) continue
    if (!(name in liveBefore)) mismatches.push(`${name}: present in backup but not in the live database`)
  }

  if (mismatches.length) {
    logger.error({ mismatches }, 'restore drill found differences between the backup and the live database')
    process.exitCode = 1
    return
  }

  logger.info(
    { collections: Object.keys(liveBefore).length, skipped: [...DRILL_WRITES].join(', ') },
    'restore drill passed: every compared collection matches the live counts',
  )
}

main()
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.stack : String(err) }, 'restore drill failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })