# Backup and recovery

Backups are encrypted AES-256-GCM snapshots of every collection except
`sessions`, `errorlogs`, `idempotencykeys`, `synclogs` and `backuprecords`. Files
live in `storage/backups` as `.cnbackup` with a SHA-256 checksum recorded on the
`BackupRecord`.

## Encryption key

- In development the key may be derived from `JWT_ACCESS_SECRET`.
- **In production `BACKUP_ENCRYPTION_KEY` is mandatory** and must be at least 32
  characters. The service refuses to boot without it rather than silently
  encrypting backups with a signing secret.
- A 64-character hex value is used directly as the key; any other strong value is
  stretched with SHA-256.
- Backups written before the key was introduced remain readable: decryption tries
  the configured key first and falls back to the legacy JWT-derived key, logging a
  warning when it does.

**Losing `BACKUP_ENCRYPTION_KEY` makes every backup unrecoverable.** Store it in
the platform secret manager and somewhere offline. Rotating it does not re-encrypt
existing files — restore them first, then take a new backup.

## Scheduled backups

`BACKUP_SCHEDULE` (default `0 2 * * *`) drives the nightly backup.
`BACKUP_RETENTION_DAYS` (default `30`) drives cleanup; `npm run purge:queue` is
unrelated and only clears stranded message-queue rows.

## Manual backup

```bash
npm run backup:drill     # backup, verify, compare with live counts (recommended)
```

Or via the API as a user holding `settings.manage`:

```
POST /api/v1/admin/backups
```

## Restore drill (run this, not just a backup)

```bash
npm run backup:drill
```

The drill:

1. Takes a fresh backup.
2. Verifies the stored checksum matches the file.
3. Decrypts it through the same code path an operator would use.
4. Compares readable document counts per collection against the live database.
5. Exits non-zero if any collection differs.

`auditlogs` is excluded from the count comparison because taking a backup and
running the drill each write an audit entry; the exclusion is logged.

## Recovering a production incident

1. Stop the API so no new writes land.
2. Provision a MongoDB instance (or a fresh database on the same cluster).
3. Point `MONGODB_URI` at it.
4. Restore the `.cnbackup` payload into MongoDB. The file is JSON after
   decryption, so a restore is `mongoimport --jsonArray` per collection, or the
   platform's snapshot restore if you take storage-level snapshots too.
5. Run `npm run migrate` to bring the schema to the current version.
6. Run `npm run seed` to restore roles, permissions and school defaults.
7. Verify with `GET /api/v1/health` and `GET /api/v1/admin/system`.
8. Re-issue credentials: password hashes survive, but active sessions do not
   (`sessions` is not backed up), so users sign in again.

## Recovery objectives

`Settings.backup` carries `rpoHours` and `rtoHours` per school. Treat them as
targets to test against, not as guarantees: the drill proves a backup is readable,
not that the surrounding restore procedure has been rehearsed. Rehearse on a
staging database at least once per term.

## Retention and integrity

- Files older than `BACKUP_RETENTION_DAYS` are removed by the scheduled cleanup.
- A checksum mismatch is a hard error on restore — never "repair" a backup by
  ignoring the warning.
- Backups contain personal data. Restrict `storage/backups` on disk and never
  place the directory behind a static web server.