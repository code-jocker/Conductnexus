import type { MigrationModule } from '../services/migrations.service.js'

/**
 * 0001 — baseline index guard.
 *
 * Databases created before a model gained an index never receive it, because
 * Mongoose only builds indexes declared at model-registration time on a fresh
 * collection and `autoIndex` is off in production. This migration re-asserts the
 * indexes the application actually queries through, on every environment, so a
 * restored or long-lived database matches what the code expects.
 *
 * `createIndex` is idempotent and non-destructive: it is a no-op when an index
 * with the same key already exists, and it never drops or rewrites data.
 */
const migration: MigrationModule = {
  name: '0001_baseline_indexes',

  async up(db) {
    const collections = db.connection.collections

    const ensure = async (
      collection: string,
      keys: Record<string, 1 | -1>,
      options: Record<string, unknown> = {},
    ) => {
      const target = collections[collection]
      if (!target) return
      await target.createIndex(keys, options)
    }

    // Discipline — incident review queue and the conduct ledger.
    await ensure('incidents', { status: 1, occurredAt: -1 })
    await ensure('incidents', { termId: 1, studentId: 1 })
    await ensure('incidents', { clientSubmissionId: 1 }, { sparse: true })
    await ensure('disciplinediaries', { studentId: 1, termId: 1, createdAt: -1 })
    await ensure('disciplineledgers', { studentId: 1, termId: 1, createdAt: -1 })

    // Conduct risk and bulk operations.
    await ensure('riskassessments', { studentId: 1, createdAt: -1 })
    await ensure('bulkoperations', { requestedBy: 1, createdAt: -1 })

    // Communications — templates, inbox and the outbound queue.
    await ensure('notificationtemplates', { category: 1, language: 1 })
    await ensure('notifications', { userId: 1, readAt: 1, createdAt: -1 })
    await ensure('messagequeues', { status: 1, nextAttemptAt: 1 })

    // Identity and access.
    await ensure('users', { status: 1, createdAt: -1 })
    await ensure('userroles', { userId: 1, roleId: 1 }, { unique: true })
    await ensure('rolepermissions', { roleId: 1, permission: 1 }, { unique: true })

    // Audit trail.
    await ensure('auditlogs', { resourceType: 1, resourceId: 1 })
  },
}

export default migration