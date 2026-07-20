import { ref, type Ref } from 'vue'
import type { ValidationResult } from '../api/types'

export interface UseValidationDialog {
  /** Whether the dialog is visible. */
  show: Ref<boolean>
  /** The successful validation result, or null while loading / on error. */
  result: Ref<ValidationResult | null>
  /** The error message from a failed validation, or null. */
  error: Ref<string | null>
  /** True while a validation request is in flight. */
  loading: Ref<boolean>
  /**
   * Open the dialog and run a validation request.
   *
   * The fetcher may return null to abort with a caller-supplied error message
   * already written to {@link error} (used when a prerequisite lookup fails,
   * e.g. the training run for a job cannot be resolved).
   */
  run: (fetcher: () => Promise<ValidationResult | null>) => Promise<void>
  /** Close the dialog, leaving the last result in place. */
  close: () => void
}

/**
 * Owns the four-ref state machine behind a validation results dialog: visibility,
 * result, error, and loading. Extracted (R-021) because App.vue and
 * JobProgressPanel each carried an identical copy of this state plus the same
 * open/reset/try/catch/finally sequence around a different fetch call.
 *
 * Behavior-preserving details carried over from both original call sites:
 *
 *  - Opening resets result AND error before showing, so a retry after a failure
 *    does not flash the previous error next to a fresh spinner.
 *  - `show` is set to true BEFORE awaiting, so the dialog appears immediately in
 *    its loading state rather than after the request resolves.
 *  - The unknown-error path narrows via `'message' in err` and falls back to the
 *    literal 'Validation failed', matching the previous inline handlers.
 *  - `loading` is cleared in a finally block, including on the aborted-fetcher
 *    path, so the dialog can never be left spinning.
 */
export function useValidationDialog(): UseValidationDialog {
  const show = ref(false)
  const result = ref<ValidationResult | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)

  async function run(fetcher: () => Promise<ValidationResult | null>): Promise<void> {
    result.value = null
    error.value = null
    loading.value = true
    show.value = true

    try {
      const validation = await fetcher()
      // A null return means the fetcher aborted and already set `error`.
      if (validation !== null) {
        result.value = validation
      }
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Validation failed'
      error.value = message
    } finally {
      loading.value = false
    }
  }

  function close(): void {
    show.value = false
  }

  return { show, result, error, loading, run, close }
}
