import { Schema, model, type Document } from 'mongoose'

/**
 * Applied-migration ledger.
 *
 * One row per migration that has run against this database. The `checksum` is the
 * SHA-256 of the migration file at the time it was applied; a later mismatch is a
 * hard error, so an already-applied migration can never be silently rewritten.
 */
export interface IMigration extends Document {
  name: string
  checksum: string
  appliedAt: Date
  durationMs: number
}

const migrationSchema = new Schema<IMigration>(
  {
    name: { type: String, required: true, unique: true },
    checksum: { type: String, required: true },
    appliedAt: { type: Date, required: true, default: Date.now },
    durationMs: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
)

export const Migration = model<IMigration>('Migration', migrationSchema)