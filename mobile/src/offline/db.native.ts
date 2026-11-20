import { Platform } from 'react-native'
import * as SQLite from 'expo-sqlite'
import type { LocalDraft, Row } from './db.types.js'

export type { DraftStatus, LocalDraft } from './db.types.js'

let db: SQLite.SQLiteDatabase | null = null

function getDb(): SQLite.SQLiteDatabase {
  if (Platform.OS === 'web') {
    throw new Error('SQLite drafts are not available on web.')
  }
  if (!db) {
    db = SQLite.openDatabaseSync('conductnexus.db')
    db.execSync(`
      CREATE TABLE IF NOT EXISTS incident_drafts (
        local_id TEXT PRIMARY KEY NOT NULL,
        client_submission_id TEXT NOT NULL UNIQUE,
        student_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        offence_id TEXT NOT NULL,
        offence_name TEXT NOT NULL,
        description TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        location TEXT NOT NULL,
        safeguarding INTEGER NOT NULL DEFAULT 0,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        server_incident_id TEXT,
        server_reference TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incident_drafts_status ON incident_drafts (sync_status, updated_at);
    `)
  }
  return db
}

function mapRow(row: Row): LocalDraft {
  return {
    localId: row.local_id,
    clientSubmissionId: row.client_submission_id,
    studentId: row.student_id,
    studentName: row.student_name,
    offenceId: row.offence_id,
    offenceName: row.offence_name,
    description: row.description,
    occurredAt: row.occurred_at,
    location: row.location,
    safeguarding: row.safeguarding === 1,
    syncStatus: row.sync_status,
    serverIncidentId: row.server_incident_id ?? undefined,
    serverReference: row.server_reference ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listDrafts(): LocalDraft[] {
  return getDb().getAllSync<Row>('SELECT * FROM incident_drafts ORDER BY updated_at DESC').map(mapRow)
}

export function countPendingDrafts(): number {
  const row = getDb().getFirstSync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM incident_drafts WHERE sync_status IN ('pending','conflict')",
  )
  return row?.count ?? 0
}

export function saveDraft(input: {
  studentId: string
  studentName: string
  offenceId: string
  offenceName: string
  description: string
  occurredAt: string
  location: string
  safeguarding: boolean
  localId?: string
}): LocalDraft {
  const database = getDb()
  const now = new Date().toISOString()
  const localId = input.localId ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const existing = input.localId
    ? database.getFirstSync<Row>('SELECT * FROM incident_drafts WHERE local_id = ?', [input.localId])
    : null
  if (existing) {
    database.runSync(
      `UPDATE incident_drafts SET student_id = ?, student_name = ?, offence_id = ?, offence_name = ?, description = ?,
       occurred_at = ?, location = ?, safeguarding = ?, sync_status = 'pending', last_error = NULL, updated_at = ?
       WHERE local_id = ?`,
      [
        input.studentId,
        input.studentName,
        input.offenceId,
        input.offenceName,
        input.description,
        input.occurredAt,
        input.location,
        input.safeguarding ? 1 : 0,
        now,
        localId,
      ],
    )
  } else {
    database.runSync(
      `INSERT INTO incident_drafts
       (local_id, client_submission_id, student_id, student_name, offence_id, offence_name, description,
        occurred_at, location, safeguarding, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        localId,
        `mobile-${localId}`,
        input.studentId,
        input.studentName,
        input.offenceId,
        input.offenceName,
        input.description,
        input.occurredAt,
        input.location,
        input.safeguarding ? 1 : 0,
        now,
        now,
      ],
    )
  }
  const row = database.getFirstSync<Row>('SELECT * FROM incident_drafts WHERE local_id = ?', [localId])
  if (!row) throw new Error('The draft could not be saved on this device.')
  return mapRow(row)
}

export function deleteDraft(localId: string): void {
  getDb().runSync('DELETE FROM incident_drafts WHERE local_id = ?', [localId])
}

export function markDraftSynced(localId: string, incidentId?: string, reference?: string): void {
  getDb().runSync(
    "UPDATE incident_drafts SET sync_status = 'synced', server_incident_id = ?, server_reference = ?, last_error = NULL, updated_at = ? WHERE local_id = ?",
    [incidentId ?? null, reference ?? null, new Date().toISOString(), localId],
  )
}

export function markDraftFailed(localId: string, status: 'conflict' | 'rejected', error?: string): void {
  getDb().runSync('UPDATE incident_drafts SET sync_status = ?, last_error = ?, updated_at = ? WHERE local_id = ?', [
    status,
    error ?? null,
    new Date().toISOString(),
    localId,
  ])
}

export function retryDraftAsNew(localId: string): LocalDraft {
  const database = getDb()
  const submissionId = `mobile-${localId}-${Date.now()}`
  database.runSync(
    "UPDATE incident_drafts SET client_submission_id = ?, sync_status = 'pending', last_error = NULL, updated_at = ? WHERE local_id = ?",
    [submissionId, new Date().toISOString(), localId],
  )
  const row = database.getFirstSync<Row>('SELECT * FROM incident_drafts WHERE local_id = ?', [localId])
  if (!row) throw new Error('The draft could not be found on this device.')
  return mapRow(row)
}

export function discardDraft(localId: string): void {
  deleteDraft(localId)
}
