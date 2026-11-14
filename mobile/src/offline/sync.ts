import { syncDrafts } from '../api/endpoints'
import type { SyncDraft } from '../api/types'
import { listDrafts, markDraftFailed, markDraftSynced, type LocalDraft } from './db'

export type DraftSyncSummary = {
  attempted: number
  synced: number
  failed: number
  pending: number
}

export function pendingDrafts(): LocalDraft[] {
  return listDrafts().filter((d) => d.syncStatus === 'pending' || d.syncStatus === 'conflict')
}

export async function syncPendingDrafts(): Promise<DraftSyncSummary> {
  const drafts = pendingDrafts()
  if (!drafts.length) return { attempted: 0, synced: 0, failed: 0, pending: 0 }

  let synced = 0
  let failed = 0
  for (let offset = 0; offset < drafts.length; offset += 50) {
    const chunk = drafts.slice(offset, offset + 50)
    const payload: SyncDraft[] = chunk.map((draft) => ({
      localId: draft.localId,
      studentId: draft.studentId,
      offenceId: draft.offenceId,
      description: draft.description,
      occurredAt: draft.occurredAt,
      location: draft.location,
      safeguardingFlag: draft.safeguarding || undefined,
      clientSubmissionId: draft.clientSubmissionId,
    }))
    const response = await syncDrafts(payload)
    for (const result of response.results) {
      if (result.status === 'synced') {
        markDraftSynced(result.localId, result.incidentId, result.reference)
        synced += 1
      } else {
        markDraftFailed(result.localId, result.status, result.error)
        failed += 1
      }
    }
  }
  return { attempted: drafts.length, synced, failed, pending: pendingDrafts().length }
}
