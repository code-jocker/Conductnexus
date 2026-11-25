const LEGACY_KEY = 'cn_offline_drafts'
const DB_NAME = 'conductnexus'
const DB_VERSION = 2
const STORE = 'incident_drafts'

export type OfflineEvidenceFile = {
  name: string
  size: number
  type: string
  // Data URL (base64) so evidence survives browser restarts and IndexedDB storage.
  dataUrl: string
}

export type OfflineIncidentDraft = {
  localId: string
  studentIds: string[]
  studentNames: string[]
  studentRefs: string[]
  offenceId: string
  offenceName: string
  description: string
  occurredAt: string
  location: string
  safeguarding?: boolean
  witnesses?: { name: string; contact?: string; statement?: string }[]
  immediateAction?: string
  clientSubmissionId: string
  savedAt: string
  evidenceFiles: OfflineEvidenceFile[]
}

type LegacyDraft = {
  localId: string
  studentId?: string
  studentIds?: string[]
  studentName?: string
  studentNames?: string[]
  studentRef?: string
  studentRefs?: string[]
  offenceId: string
  offenceName: string
  description: string
  occurredAt: string
  location: string
  safeguarding?: boolean
  witnesses?: { name: string; contact?: string; statement?: string }[]
  immediateAction?: string
  clientSubmissionId: string
  savedAt: string
  evidenceFiles?: OfflineEvidenceFile[]
}

function notify() {
  window.dispatchEvent(new Event('cn-offline-drafts'))
}

function readLegacy(): LegacyDraft[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as LegacyDraft[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((draft): draft is LegacyDraft => draft && typeof draft.localId === 'string')
  } catch {
    return []
  }
}

function writeLegacy(drafts: LegacyDraft[]) {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(drafts))
  } catch {
    // Storage can be full or unavailable; the IndexedDB path still applies.
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'localId' })
          store.createIndex('savedAt', 'savedAt')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = action(tx.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function sortDrafts(drafts: LegacyDraft[]): LegacyDraft[] {
  return drafts.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0))
}

function normalizeLegacy(draft: LegacyDraft): OfflineIncidentDraft {
  return {
    localId: draft.localId,
    studentIds: draft.studentIds ?? (draft.studentId ? [draft.studentId] : []),
    studentNames: draft.studentNames ?? (draft.studentName ? [draft.studentName] : []),
    studentRefs: draft.studentRefs ?? (draft.studentRef ? [draft.studentRef] : []),
    offenceId: draft.offenceId,
    offenceName: draft.offenceName,
    description: draft.description,
    occurredAt: draft.occurredAt,
    location: draft.location,
    safeguarding: draft.safeguarding,
    witnesses: draft.witnesses,
    immediateAction: draft.immediateAction,
    clientSubmissionId: draft.clientSubmissionId,
    savedAt: draft.savedAt,
    evidenceFiles: draft.evidenceFiles ?? [],
  }
}

let ready: Promise<void> | null = null

async function prepare(): Promise<IDBDatabase | null> {
  const db = await openDb()
  if (!db) return null
  if (!ready) {
    ready = (async () => {
      const legacy = readLegacy()
      if (!legacy.length) return
      const existing = await run<OfflineIncidentDraft[]>(db, 'readonly', (store) => store.getAll())
      const known = new Set(existing.map((draft) => draft.localId))
      for (const draft of legacy) {
        if (!known.has(draft.localId)) {
          // Normalize legacy single-student drafts to the multi-student shape.
          const normalized: OfflineIncidentDraft = {
            localId: draft.localId,
            studentIds: draft.studentIds ?? (draft.studentId ? [draft.studentId] : []),
            studentNames: draft.studentNames ?? (draft.studentName ? [draft.studentName] : []),
            studentRefs: draft.studentRefs ?? (draft.studentRef ? [draft.studentRef] : []),
            offenceId: draft.offenceId,
            offenceName: draft.offenceName,
            description: draft.description,
            occurredAt: draft.occurredAt,
            location: draft.location,
            safeguarding: draft.safeguarding,
            witnesses: draft.witnesses,
            immediateAction: draft.immediateAction,
            clientSubmissionId: draft.clientSubmissionId,
            savedAt: draft.savedAt,
            evidenceFiles: draft.evidenceFiles ?? [],
          }
          await run(db, 'readwrite', (store) => store.put(normalized))
        }
      }
      try {
        localStorage.removeItem(LEGACY_KEY)
      } catch {
        // Leaving the legacy copy behind is harmless: duplicates merge by localId.
      }
    })()
  }
  await ready
  return db
}

export async function listOfflineDrafts(): Promise<OfflineIncidentDraft[]> {
  const db = await prepare()
  if (!db) return sortDrafts(readLegacy()).map(normalizeLegacy)
  try {
    const drafts = await run<OfflineIncidentDraft[]>(db, 'readonly', (store) => store.getAll())
    return sortDrafts(drafts).map(normalizeLegacy)
  } catch {
    return sortDrafts(readLegacy()).map(normalizeLegacy)
  }
}

export async function saveOfflineDraft(draft: OfflineIncidentDraft): Promise<void> {
  const db = await prepare()
  if (db) {
    try {
      await run(db, 'readwrite', (store) => store.put(draft))
      notify()
      return
    } catch {
      // Fall through to the legacy store so the report is never lost.
    }
  }
  writeLegacy([draft, ...readLegacy().filter((d) => d.localId !== draft.localId)])
  notify()
}

export async function removeOfflineDraft(localId: string): Promise<void> {
  const db = await prepare()
  if (db) {
    try {
      await run(db, 'readwrite', (store) => store.delete(localId))
      notify()
      return
    } catch {
      // Fall through.
    }
  }
  writeLegacy(readLegacy().filter((d) => d.localId !== localId))
  notify()
}

export async function clearOfflineDrafts(): Promise<void> {
  const db = await prepare()
  if (db) {
    try {
      await run(db, 'readwrite', (store) => store.clear())
      notify()
      return
    } catch {
      // Fall through.
    }
  }
  writeLegacy([])
  notify()
}

export function newLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Converts a File to a base64 Data URL for IndexedDB storage.
 * Files cannot be stored directly; Data URLs preserve name, type, and bytes.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Converts a base64 Data URL back into a File object for re-upload.
 */
export function dataUrlToFile(dataUrl: string, fileName?: string): File {
  const arr = dataUrl.split(',')
  const mime = arr[0].match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new File([u8arr], fileName ?? 'evidence.bin', { type: mime })
}
