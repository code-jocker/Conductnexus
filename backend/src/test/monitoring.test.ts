import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LoggingReporter,
  captureError,
  getReporter,
  resolveReporter,
  setReporter,
  type ErrorCapture,
  type ErrorReporter,
} from '../services/monitoring.service.js'

/**
 * The monitoring seam must actually capture, must not swallow a throwing
 * reporter, and must never claim a provider exists when none is registered.
 */

class CapturingReporter implements ErrorReporter {
  readonly name = 'capturing'
  readonly seen: ErrorCapture[] = []
  capture(input: ErrorCapture): void {
    this.seen.push(input)
  }
}

afterEach(() => {
  setReporter(new LoggingReporter())
})

describe('error monitoring', () => {
  it('defaults to the logging reporter', () => {
    expect(getReporter().name).toBe('log')
    expect(getReporter()).toBeInstanceOf(LoggingReporter)
  })

  it('resolves the default provider from an empty name', () => {
    expect(resolveReporter(undefined).name).toBe('log')
    expect(resolveReporter('  ').name).toBe('log')
    expect(resolveReporter('LOG').name).toBe('log')
  })

  it('refuses to pretend an unknown provider is configured', () => {
    expect(() => resolveReporter('sentry')).toThrow(/Unknown ERROR_REPORTING_PROVIDER/)
    expect(() => resolveReporter('sentry')).toThrow(/setReporter/)
  })

  it('forwards captured errors to the registered reporter', () => {
    const reporter = new CapturingReporter()
    setReporter(reporter)

    const error = new Error('boom')
    captureError({ error, context: { requestId: 'req-1', path: '/incidents' } })

    expect(reporter.seen).toHaveLength(1)
    expect(reporter.seen[0]?.error).toBe(error)
    expect(reporter.seen[0]?.context).toMatchObject({ requestId: 'req-1', path: '/incidents' })
  })

  it('survives a reporter that throws', () => {
    setReporter({
      name: 'broken',
      capture() {
        throw new Error('reporter exploded')
      },
    })

    expect(() => captureError({ error: new Error('original') })).not.toThrow()
  })

  it('captures non-Error throwables', () => {
    const reporter = new CapturingReporter()
    setReporter(reporter)
    captureError({ error: 'a string failure' })
    expect(reporter.seen[0]?.error).toBe('a string failure')
  })
})