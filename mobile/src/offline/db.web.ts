export type DraftStatus = 'pending' | 'synced' | 'conflict' | 'rejected'

export type LocalDraft = {
  localId: string
  clientSubmissionId: string
  studentId: string
  studentName: string
  offenceId: string
  offenceName: string
  description: string
  occurredAt: string
  location: string
  safeguarding: boolean
  syncStatus: DraftStatus
  serverIncidentId?: string
  serverReference?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

type Row = {
  local_id: string
  client_submission_id: string
  student_id: string
  student_name: string
  offence_id: string
  offence_name: string
  description: string
  occurred_at: string
  location: string
  safeguarding: number
  sync_status: DraftStatus
  server_incident_id: string | null
  server_reference: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

const STORAGE_KEY = 'conductnexus:drafts:v1'

function memoryStore(): { rows: Row[] } {
  const g = globalThis as { __conductnexusDrafts?: { rows: Row[] } }
  if (!g.__conductnexusDrafts) g.__conductnexusDrafts = { rows: [] }
  return g.__conductnexusDrafts
}

function canUseLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
  } catch {
    return false
  }
}

function readRows(): Row[] {
  if (!canUseLocalStorage()) return memoryStore().rows
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Row[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return memoryStore().rows
  }
}

function writeRows(rows: Row[]): void {
  if (!canUseLocalStorage()) {
    memoryStore().rows = rows
    return
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  } catch {
    memoryStore().rows = rows
  }
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

function sortByUpdatedDesc(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function listDrafts(): LocalDraft[] {
  return sortByUpdatedDesc(readRows()).map(mapRow)
}

export function countPendingDrafts(): number {
  return readRows().filter((r) => r.sync_status === 'pending' || r.sync_status === 'conflict').length
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
  const now = new Date().toISOString()
  const localId = input.localId ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const rows = readRows()
  const index = input.localId ? rows.findIndex((r) => r.local_id === input.localId) : -1
  if (index >= 0) {
    const prev = rows[index]
    if (!prev) throw new Error('The draft could not be found on this device.')
    rows[index] = {
      local_id: prev.local_id,
      client_submission_id: prev.client_submission_id,
      student_id: input.studentId,
      student_name: input.studentName,
      offence_id: input.offenceId,
      offence_name: input.offenceName,
      description: input.description,
      occurred_at: input.occurredAt,
      location: input.location,
      safeguarding: input.safeguarding ? 1 : 0,
      sync_status: 'pending',
      server_incident_id: prev.server_incident_id,
      server_reference: prev.server_reference,
      last_error: null,
      created_at: prev.created_at,
      updated_at: now,
    }
  } else {
    rows.push({
      local_id: localId,
      client_submission_id: `mobile-${localId}`,
      student_id: input.studentId,
      student_name: input.studentName,
      offence_id: input.offenceId,
      offence_name: input.offenceName,
      description: input.description,
      occurred_at: input.occurredAt,
      location: input.location,
      safeguarding: input.safeguarding ? 1 : 0,
      sync_status: 'pending',
      server_incident_id: null,
      server_reference: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    })
  }
  writeRows(rows)
  const row = rows.find((r) => r.local_id === localId)
  if (!row) throw new Error('The draft could not be saved on this device.')
  return mapRow(row)
}

export function deleteDraft(localId: string): void {
  writeRows(readRows().filter((r) => r.local_id !== localId))
}

export function markDraftSynced(localId: string, incidentId?: string, reference?: string): void {
  const rows = readRows()
  const row = rows.find((r) => r.local_id === localId)
  if (!row) return
  row.sync_status = 'synced'
  row.server_incident_id = incidentId ?? null
  row.server_reference = reference ?? null
  row.last_error = null
  row.updated_at = new Date().toISOString()
  writeRows(rows)
}

export function markDraftFailed(localId: string, status: 'conflict' | 'rejected', error?: string): void {
  const rows = readRows()
  const row = rows.find((r) => r.local_id === localId)
  if (!row) return
  row.sync_status = status
  row.last_error = error ?? null
  row.updated_at = new Date().toISOString()
  writeRows(rows)
}

export function retryDraftAsNew(localId: string): LocalDraft {
  const rows = readRows()
  const row = rows.find((r) => r.local_id === localId)
  if (!row) throw new Error('The draft could not be found on this device.')
  row.client_submission_id = `mobile-${localId}-${Date.now()}`
  row.sync_status = 'pending'
  row.last_error = null
  row.updated_at = new Date().toISOString()
  writeRows(rows)
  return mapRow(row)
}

export function discardDraft(localId: string): void {
  deleteDraft(localId)
}
