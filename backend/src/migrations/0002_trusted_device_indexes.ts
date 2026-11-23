import type { MigrationModule } from '../services/migrations.service.js'

/**
 * 0002 — trusted-device security indexes.
 *
 * The device credential is stored only as a SHA-256 hash. The unique index
 * prevents duplicate credentials, the TTL index removes expired records, and
 * the compound index supports per-user active-device listing and revocation.
 */
const migration: MigrationModule = {
  name: '0002_trusted_device_indexes',

  async up(db) {
    const collection = db.connection.collection('trusteddevices')
    await collection.createIndex({ tokenHash: 1 }, { unique: true, name: 'tokenHash_1' })
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_1' })
    await collection.createIndex(
      { userId: 1, revokedAt: 1, expiresAt: 1 },
      { name: 'userId_1_revokedAt_1_expiresAt_1' },
    )
  },
}

export default migration
