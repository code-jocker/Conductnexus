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

export type { Row }
