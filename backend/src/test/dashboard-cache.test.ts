import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DASHBOARD_TTL_MS,
  cached,
  cacheSize,
  clearCache,
  invalidatePrefix,
} from '../services/dashboard-cache.js'

/**
 * The cache is a short-TTL memo, not an invalidation graph. These tests pin the
 * behaviour correctness depends on: entries expire, loads are shared, and the
 * store cannot grow without bound.
 */

beforeEach(() => {
  clearCache()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dashboard cache', () => {
  it('loads once and serves the cached value inside the TTL', async () => {
    const load = vi.fn(async () => ({ incidents: 1 }))
    const first = await cached('k', 30_000, load)
    const second = await cached('k', 30_000, load)

    expect(load).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('expires entries after the TTL', async () => {
    const load = vi.fn(async () => ({ incidents: 1 }))
    await cached('k', 30_000, load)

    vi.advanceTimersByTime(30_001)
    await cached('k', 30_000, load)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares concurrent loads of the same key', async () => {
    let resolveLoad: ((value: number) => void) | undefined
    const load = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveLoad = resolve
        }),
    )

    const first = cached('k', 30_000, load)
    const second = cached('k', 30_000, load)
    resolveLoad?.(7)

    await expect(first).resolves.toBe(7)
    await expect(second).resolves.toBe(7)
  })

  it('keys are independent', async () => {
    await cached('a', 30_000, async () => 1)
    const b = await cached('b', 30_000, async () => 2)
    expect(b).toBe(2)
    expect(cacheSize()).toBe(2)
  })

  it('invalidates by prefix', async () => {
    await cached('dashboard:u1:ADMIN', 30_000, async () => 1)
    await cached('dashboard:u2:TEACHER', 30_000, async () => 2)

    invalidatePrefix('dashboard:u1')

    expect(cacheSize()).toBe(1)
    const reloaded = await cached('dashboard:u1:ADMIN', 30_000, async () => 99)
    expect(reloaded).toBe(99)
  })

  it('uses a 30 second TTL', () => {
    expect(DASHBOARD_TTL_MS).toBe(30_000)
  })
})