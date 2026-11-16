/**
 * Short-lived, in-process memoisation.
 *
 * Dashboards are expensive (a dozen aggregates) and read far more often than the
 * underlying conduct data changes. This is deliberately not Redis or a shared
 * cache: a single API instance owns it, it expires in seconds, and it is only
 * enabled in production so development and tests always read fresh data.
 *
 * There is no invalidation hook. Correctness rests on the short TTL, not on
 * remembering to bust the cache after a write — a missed invalidation would be a
 * silent data bug, a 30-second delay is not.
 */

type Entry = { value: unknown; expiresAt: number }

const DEFAULT_TTL_MS = 30_000
const MAX_ENTRIES = 500

const store = new Map<string, Entry>()
/** Loads already in flight, so a burst of requests triggers one computation. */
const inflight = new Map<string, Promise<unknown>>()

function prune(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }
}

function enforceLimit(): void {
  if (store.size <= MAX_ENTRIES) return
  // Map preserves insertion order, so the first key is the oldest.
  const oldest = store.keys().next()
  if (!oldest.done) store.delete(oldest.value)
}

export function cacheSize(): number {
  return store.size
}

export function clearCache(): void {
  store.clear()
  inflight.clear()
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expiresAt > now) return hit.value as T

  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const promise = (async () => {
    try {
      const value = await load()
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
      enforceLimit()
      return value
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

/** Drops every entry whose key starts with `prefix` (used when roles change). */
export function invalidatePrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

export const DASHBOARD_TTL_MS = DEFAULT_TTL_MS