import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mongoose from 'mongoose'
import { Migration } from '../models/migration.js'

/**
 * Versioned migration runner.
 *
 * Migrations live in `src/migrations` and are named `NNNN_description.ts`, so they
 * compile into `dist/migrations` alongside the rest of the service and the same
 * discovery code works under `tsx` (dev/tests) and plain `node` (production).
 *
 * Guarantees:
 *  - applied exactly once, tracked in the `migrations` collection;
 *  - an applied migration whose file changed is a hard error (no silent edits);
 *  - a migration applied elsewhere but missing from the codebase is reported;
 *  - migrations always run in ascending filename order.
 */

export type MigrationContext = typeof mongoose

export type MigrationModule = {
  /** Sequential name, e.g. `0001_baseline_indexes`. */
  name: string
  up: (db: MigrationContext) => Promise<void>
  /** Optional rollback. Not run automatically. */
  down?: (db: MigrationContext) => Promise<void>
}

export type MigrationFile = {
  name: string
  file: string
  path: string
  checksum: string
}

export type AppliedMigration = { name: string; checksum: string }

export type MigrationStatus = {
  applied: { name: string; appliedAt: Date; durationMs: number }[]
  pending: string[]
  /** Applied in a database but no longer present in the codebase. */
  missing: string[]
  /** Recorded checksum differs from the file on disk. */
  modified: string[]
}

const MIGRATION_PATTERN = /^(\d{4})_.*\.(ts|js)$/
const here = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = join(here, '..', 'migrations')

export function checksumOf(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

/** Every migration file on disk, in ascending order. */
export async function discoverMigrations(): Promise<MigrationFile[]> {
  let entries: string[]
  try {
    entries = await readdir(MIGRATIONS_DIR)
  } catch {
    return []
  }

  const files = entries.filter((entry) => MIGRATION_PATTERN.test(entry)).sort()
  const discovered: MigrationFile[] = []
  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file)
    const contents = await readFile(path, 'utf8')
    discovered.push({
      name: file.replace(/\.(ts|js)$/, ''),
      file,
      path,
      checksum: checksumOf(contents),
    })
  }
  return discovered
}

/**
 * Pure comparison of files against the ledger. Exported so the rules can be
 * unit-tested without touching a database.
 */
export function compareMigrations(
  files: MigrationFile[],
  applied: AppliedMigration[],
): { pending: MigrationFile[]; missing: string[]; modified: string[] } {
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]))
  const fileNames = new Set(files.map((file) => file.name))

  const pending = files.filter((file) => !appliedByName.has(file.name))
  const missing = [...appliedByName.keys()].filter((name) => !fileNames.has(name)).sort()
  const modified = files
    .filter((file) => {
      const recorded = appliedByName.get(file.name)
      return recorded !== undefined && recorded !== file.checksum
    })
    .map((file) => file.name)

  return { pending, missing, modified }
}

export async function migrationStatus(): Promise<MigrationStatus> {
  const [files, appliedRows] = await Promise.all([
    discoverMigrations(),
    Migration.find().sort({ name: 1 }).lean(),
  ])
  const applied: AppliedMigration[] = appliedRows.map((row) => ({ name: row.name, checksum: row.checksum }))
  const { pending, missing, modified } = compareMigrations(files, applied)

  return {
    applied: appliedRows.map((row) => ({ name: row.name, appliedAt: row.appliedAt, durationMs: row.durationMs })),
    pending: pending.map((file) => file.name),
    missing,
    modified,
  }
}

async function importMigration(file: MigrationFile): Promise<MigrationModule> {
  // `pathToFileURL` percent-encodes spaces. Node accepts the encoded form, but
  // the vite/tsx resolver used by the test suite does not, so decode it back to a
  // plain path (both loaders accept a file URL containing literal spaces).
  const href = decodeURI(pathToFileURL(file.path).href)
  const loaded = (await import(href)) as { default?: MigrationModule } & Partial<MigrationModule>
  const migration = (loaded.default ?? loaded) as MigrationModule
  if (typeof migration.up !== 'function') {
    throw new Error(`Migration ${file.name} does not export an "up" function`)
  }
  return migration
}

export type MigrationRunResult = {
  applied: string[]
  skipped: number
  missing: string[]
}

/**
 * Applies every pending migration in order. Refuses to start if any applied
 * migration was modified after the fact, so the database is never left half-way
 * through a sequence that no longer matches the code.
 */
export async function runMigrations(): Promise<MigrationRunResult> {
  const files = await discoverMigrations()
  const appliedRows = await Migration.find().lean()
  const applied: AppliedMigration[] = appliedRows.map((row) => ({ name: row.name, checksum: row.checksum }))

  const { pending, modified, missing } = compareMigrations(files, applied)

  if (modified.length) {
    throw new Error(
      `Applied migration(s) changed on disk: ${modified.join(', ')}. ` +
        'Add a new migration instead of editing one that has already run.',
    )
  }
  if (missing.length) {
    throw new Error(
      `Migration(s) recorded in the database but missing from src/migrations: ${missing.join(', ')}. ` +
        'Restore the file or clear the ledger entry deliberately.',
    )
  }

  const appliedNames: string[] = []
  for (const file of pending) {
    const migration = await importMigration(file)
    const startedAt = Date.now()
    await migration.up(mongoose)
    const durationMs = Date.now() - startedAt
    await Migration.create({ name: file.name, checksum: file.checksum, appliedAt: new Date(), durationMs })
    appliedNames.push(file.name)
  }

  return { applied: appliedNames, skipped: applied.length, missing: [] }
}