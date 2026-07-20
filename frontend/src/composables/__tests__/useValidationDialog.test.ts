import { describe, it, expect, vi } from 'vitest'
import { useValidationDialog } from '../useValidationDialog'
import type { ValidationResult } from '../../api/types'

function makeResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    training_run_name: 'run-a',
    total_expected: 10,
    total_found: 10,
    total_missing: 0,
    checkpoints: [],
    ...overrides,
  } as ValidationResult
}

describe('useValidationDialog', () => {
  it('starts closed and empty', () => {
    const d = useValidationDialog()

    expect(d.show.value).toBe(false)
    expect(d.result.value).toBeNull()
    expect(d.error.value).toBeNull()
    expect(d.loading.value).toBe(false)
  })

  it('shows the dialog in its loading state before the fetch resolves', async () => {
    const d = useValidationDialog()
    let resolveFetch: (v: ValidationResult) => void = () => {}
    const pending = d.run(() => new Promise<ValidationResult>((res) => { resolveFetch = res }))

    // Synchronously after run(), the dialog must already be visible and loading.
    expect(d.show.value).toBe(true)
    expect(d.loading.value).toBe(true)

    resolveFetch(makeResult())
    await pending
    expect(d.loading.value).toBe(false)
  })

  it('stores the result on success', async () => {
    const d = useValidationDialog()
    const result = makeResult({ total_missing: 3 })

    await d.run(async () => result)

    expect(d.result.value).toEqual(result)
    expect(d.error.value).toBeNull()
    expect(d.show.value).toBe(true)
  })

  it('captures the message from a thrown error', async () => {
    const d = useValidationDialog()

    await d.run(async () => { throw new Error('backend exploded') })

    expect(d.error.value).toBe('backend exploded')
    expect(d.result.value).toBeNull()
    expect(d.loading.value).toBe(false)
  })

  it('falls back to a generic message for a non-Error throw', async () => {
    const d = useValidationDialog()

    await d.run(async () => { throw 'just a string' })

    expect(d.error.value).toBe('Validation failed')
  })

  it('preserves a caller-set error when the fetcher aborts with null', async () => {
    const d = useValidationDialog()

    await d.run(async () => {
      d.error.value = 'Training run "x" not found'
      return null
    })

    expect(d.error.value).toBe('Training run "x" not found')
    expect(d.result.value).toBeNull()
    expect(d.loading.value).toBe(false)
  })

  it('clears the previous error when re-run after a failure', async () => {
    const d = useValidationDialog()
    await d.run(async () => { throw new Error('first failure') })
    expect(d.error.value).toBe('first failure')

    const result = makeResult()
    await d.run(async () => result)

    expect(d.error.value).toBeNull()
    expect(d.result.value).toEqual(result)
  })

  it('clears the previous result when re-run after a success', async () => {
    const d = useValidationDialog()
    await d.run(async () => makeResult({ total_missing: 1 }))

    const seen: Array<ValidationResult | null> = []
    await d.run(async () => {
      // Observed mid-flight: the stale result must already be cleared.
      seen.push(d.result.value)
      return makeResult({ total_missing: 2 })
    })

    expect(seen[0]).toBeNull()
    expect(d.result.value?.total_missing).toBe(2)
  })

  it('close() hides the dialog without discarding the result', async () => {
    const d = useValidationDialog()
    await d.run(async () => makeResult())

    d.close()

    expect(d.show.value).toBe(false)
    expect(d.result.value).not.toBeNull()
  })

  it('invokes the fetcher exactly once per run', async () => {
    const d = useValidationDialog()
    const fetcher = vi.fn(async () => makeResult())

    await d.run(fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
