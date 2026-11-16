import { describe, expect, it } from 'vitest'
import { BACKUP_KEY_MIN_LENGTH, backupKeyPolicyError } from '../config/env.js'

/**
 * Backup encryption key policy (audit B4).
 *
 * A production deployment must refuse to boot without a real key rather than
 * silently reusing the JWT signing secret to encrypt backups.
 */

const STRONG = 'a'.repeat(BACKUP_KEY_MIN_LENGTH)

describe('backup encryption key policy', () => {
  it('requires the key in production', () => {
    expect(backupKeyPolicyError('production', '')).toContain('BACKUP_ENCRYPTION_KEY')
  })

  it('rejects a key that is too short in production', () => {
    expect(backupKeyPolicyError('production', 'short-key')).toMatch(/at least \d+ characters/)
  })

  it('accepts a sufficiently strong key in production', () => {
    expect(backupKeyPolicyError('production', STRONG)).toBeNull()
  })

  it('does not enforce the key outside production', () => {
    expect(backupKeyPolicyError('development', '')).toBeNull()
    expect(backupKeyPolicyError('test', '')).toBeNull()
  })

  it('treats whitespace-only keys as missing', () => {
    expect(backupKeyPolicyError('production', ' '.repeat(64))).not.toBeNull()
  })
})