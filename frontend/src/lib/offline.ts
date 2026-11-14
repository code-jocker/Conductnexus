const LEGACY_KEY = 'cn_offline_drafts'
const DB_NAME = 'conductnexus'
const DB_VERSION = 1
const STORE = 'incident_drafts'

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
  safeguarding?: boolean
  witnesses?: { name: string; contact?: string; statement?: string }[]
  immediateAction?: string
  clientSubmissionId: string
  savedAt: string
}

function notify() {
  window.dispatchEvent(new Event('cn-offline-drafts'))
}

function readLegacy(): OfflineIncidentDraft[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as OfflineIncidentDraft[]
    return Array.isArray(parsed) ? parsed.filter((draft) => draft && typeof draft.localId === 'string') : []
  } catch {
    return []
  }
}

function writeLegacy(drafts: OfflineIncidentDraft[]) {
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

function sortDrafts(drafts: OfflineIncidentDraft[]): OfflineIncidentDraft[] {
  return drafts.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0))
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
          await run(db, 'readwrite', (store) => store.put(draft))
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
  if (!db) return sortDrafts(readLegacy())
  try {
    const drafts = await run<OfflineIncidentDraft[]>(db, 'readonly', (store) => store.getAll())
    return sortDrafts(drafts)
  } catch {
    return sortDrafts(readLegacy())
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
