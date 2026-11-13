const KEY = 'cn_offline_drafts'

export type OfflineIncidentDraft = {
  localId: string
  studentId: string
  studentName: string
  studentRef?: string
  offenceId: string
  offenceName: string
  description: string
  occurredAt: string
  location: string
  clientSubmissionId: string
  savedAt: string
}

function read(): OfflineIncidentDraft[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as OfflineIncidentDraft[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(drafts: OfflineIncidentDraft[]) {
  localStorage.setItem(KEY, JSON.stringify(drafts))
  window.dispatchEvent(new Event('cn-offline-drafts'))
}

export function listOfflineDrafts(): OfflineIncidentDraft[] {
  return read()
}

export function saveOfflineDraft(draft: OfflineIncidentDraft) {
  write([draft, ...read().filter((d) => d.localId !== draft.localId)])
}

export function removeOfflineDraft(localId: string) {
  write(read().filter((d) => d.localId !== localId))
}

export function clearOfflineDrafts() {
  write([])
}

export function newLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
