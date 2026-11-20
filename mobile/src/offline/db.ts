import { Platform } from 'react-native'
import type { DraftStatus, LocalDraft } from './db.types.js'

export type { DraftStatus, LocalDraft }

type DbModule = {
  listDrafts: () => LocalDraft[]
  countPendingDrafts: () => number
  saveDraft: (input: {
    studentId: string
    studentName: string
    offenceId: string
    offenceName: string
    description: string
    occurredAt: string
    location: string
    safeguarding: boolean
    localId?: string
  }) => LocalDraft
  deleteDraft: (localId: string) => void
  markDraftSynced: (localId: string, incidentId?: string, reference?: string) => void
  markDraftFailed: (localId: string, status: 'conflict' | 'rejected', error?: string) => void
  retryDraftAsNew: (localId: string) => LocalDraft
  discardDraft: (localId: string) => void
}

// Deferred require so expo-sqlite (which pulls in SharedArrayBuffer on web) is
// never evaluated when this module is imported on web. Metro tree-shakes the
// unused branch at build time based on Platform.OS.
const mod: DbModule = Platform.OS === 'web'
  ? (require as unknown as (id: string) => DbModule)('./db.web')
  : (require as unknown as (id: string) => DbModule)('./db.native')

export const listDrafts = mod.listDrafts
export const countPendingDrafts = mod.countPendingDrafts
export const saveDraft = mod.saveDraft
export const deleteDraft = mod.deleteDraft
export const markDraftSynced = mod.markDraftSynced
export const markDraftFailed = mod.markDraftFailed
export const retryDraftAsNew = mod.retryDraftAsNew
export const discardDraft = mod.discardDraft
