import { ref, watch, onUnmounted, type Ref } from 'vue'
import type { SampleJob, SampleJobStatus } from '../api/types'

/** Statuses considered terminal for runtime purposes: the job has stopped changing. */
const TERMINAL_RUNTIME_STATUSES: Set<SampleJobStatus> = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'stopped',
])

/** Whether a job status is terminal (its total runtime is fixed). */
export function isTerminalRuntimeStatus(status: SampleJobStatus): boolean {
  return TERMINAL_RUNTIME_STATUSES.has(status)
}

/**
 * Composable that computes each job's total runtime, derived from the
 * existing `created_at` / `updated_at` timestamps (no new DB columns).
 *
 * - Running jobs: elapsed = now - created_at, ticking live every second.
 * - Terminal jobs (completed, completed_with_errors, failed, stopped):
 *   total = updated_at - created_at, fixed.
 *
 * A single shared 1-second ticker drives all running jobs' elapsed time.
 * The ticker only runs while at least one job in the list is running, and
 * is torn down on unmount.
 *
 * @param jobsRef - Reactive list of sample jobs.
 * @returns getRuntimeSeconds(job) - Returns the current runtime in seconds for a job.
 */
export function useJobRuntimes(jobsRef: Ref<SampleJob[]>) {
  const now = ref(Date.now())
  let intervalId: ReturnType<typeof setInterval> | null = null

  function hasRunningJob(): boolean {
    return jobsRef.value.some((job) => job.status === 'running')
  }

  function syncTimer() {
    if (hasRunningJob()) {
      if (intervalId === null) {
        now.value = Date.now()
        intervalId = setInterval(() => {
          now.value = Date.now()
        }, 1000)
      }
    } else if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  watch(jobsRef, syncTimer, { immediate: true, deep: true })

  onUnmounted(() => {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  })

  /** Get the current runtime in seconds for a job (live for running, fixed for terminal). */
  function getRuntimeSeconds(job: SampleJob): number {
    const start = new Date(job.created_at).getTime()
    const end = isTerminalRuntimeStatus(job.status) ? new Date(job.updated_at).getTime() : now.value
    return Math.max(0, Math.floor((end - start) / 1000))
  }

  return { getRuntimeSeconds }
}
