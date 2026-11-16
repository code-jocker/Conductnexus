import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { logger } from '../shared/logger.js'
import { migrationStatus, runMigrations } from '../services/migrations.service.js'

/**
 * Migration CLI.
 *
 *   npm run migrate           apply every pending migration
 *   npm run migrate:status    list applied, pending, missing and modified
 *
 * Exits non-zero on any inconsistency so it can gate a deploy.
 */

async function main() {
  const command = process.argv[2] ?? 'run'
  await connectDatabase()

  try {
    if (command === 'status') {
      const status = await migrationStatus()
      for (const row of status.applied) {
        logger.info({ migration: row.name, appliedAt: row.appliedAt, durationMs: row.durationMs }, 'applied')
      }
      for (const name of status.pending) logger.warn({ migration: name }, 'pending')
      for (const name of status.missing) logger.error({ migration: name }, 'in ledger but missing on disk')
      for (const name of status.modified) logger.error({ migration: name }, 'modified after being applied')

      const problems = status.pending.length + status.missing.length + status.modified.length
      if (problems > 0) {
        logger.error({ pending: status.pending.length, missing: status.missing.length, modified: status.modified.length }, 'migration status is not clean')
        process.exitCode = 1
      }
      return
    }

    if (command !== 'run') {
      logger.error({ command }, 'unknown migration command (expected "run" or "status")')
      process.exitCode = 1
      return
    }

    const result = await runMigrations()
    if (result.applied.length === 0) {
      logger.info({ skipped: result.skipped }, 'database is already up to date')
      return
    }
    for (const name of result.applied) logger.info({ migration: name }, 'migration applied')
    logger.info({ applied: result.applied.length, skipped: result.skipped }, 'migrations complete')
  } finally {
    await disconnectDatabase()
  }
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'migration run failed')
  process.exit(1)
})