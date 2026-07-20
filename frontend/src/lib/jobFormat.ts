import type { SampleJob, SampleJobStatus, WSCheckpointCompletenessInfo } from '../api/types'

/**
 * Pure presentation helpers for the sample-job list.
 *
 * Extracted from JobProgressPanel.vue (R-021). Everything here is a pure
 * function of its arguments so the status/tag mapping and error grouping can be
 * unit-tested without mounting the panel.
 */

/** Grouped error info including optional traceback. */
export interface GroupedError {
  errorMessage: string
  checkpoints: string[]
  traceback?: string
}

/** Naive UI tag type for a job status. */
export function getStatusType(status: SampleJobStatus): 'success' | 'error' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'completed_with_errors':
      return 'warning'
    case 'failed':
      return 'error'
    case 'stopped':
      return 'error'
    case 'running':
      return 'info'
    case 'pending':
      return 'default'
  }
}

/** Human-readable job status label. */
export function getStatusLabel(status: SampleJobStatus): string {
  if (status === 'completed_with_errors') return 'completed with errors'
  return status
}

/** Overall completion percentage for a job, guarding against divide-by-zero. */
export function getProgressPercentage(job: SampleJob): number {
  if (job.total_items === 0) return 0
  return Math.round((job.completed_items / job.total_items) * 100)
}

/** Naive UI progress bar status for a job. */
export function getProgressStatus(job: SampleJob): 'error' | 'success' | 'warning' | 'default' {
  if (job.status === 'failed') return 'error'
  if (job.status === 'completed_with_errors') return 'warning'
  if (job.status === 'completed') return 'success'
  return 'default'
}

export function canStop(job: SampleJob): boolean {
  return job.status === 'running'
}

export function canResume(job: SampleJob): boolean {
  return job.status === 'stopped'
}

export function canRegenerate(job: SampleJob): boolean {
  return job.status === 'completed' || job.status === 'completed_with_errors'
}

export function canRetryFailed(job: SampleJob): boolean {
  return job.status === 'completed_with_errors'
}

/** AC: FE: Delete button is hidden when job status is running. */
export function canDelete(job: SampleJob): boolean {
  return job.status !== 'running'
}

/** Whether a job has any failed items. */
export function hasFailedItems(job: SampleJob): boolean {
  return (job.failed_items ?? 0) > 0
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

/**
 * Format a duration in seconds to a human-readable string.
 * Examples: "5s", "2m 30s", "1h 15m", "2h 0m"
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s'
  const totalSeconds = Math.round(seconds)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

/** Format a completeness entry for display, e.g. '24/24 verified' or '23/24 -- 1 missing'. */
export function formatCompleteness(entry: WSCheckpointCompletenessInfo): string {
  if (entry.missing === 0) {
    return `${entry.verified}/${entry.expected} verified`
  }
  return `${entry.verified}/${entry.expected} -- ${entry.missing} missing`
}

/**
 * Group failed item details by error message.
 *
 * The FIRST detail for a given message supplies the traceback (later duplicates
 * of the same message are assumed to share it), and checkpoint filenames are
 * sorted so the list is stable across re-renders.
 */
export function getGroupedErrors(job: SampleJob): GroupedError[] {
  const details = job.failed_item_details ?? []
  if (details.length === 0) return []

  const grouped = new Map<string, { checkpoints: string[]; traceback?: string }>()
  for (const detail of details) {
    const existing = grouped.get(detail.error_message)
    if (existing) {
      existing.checkpoints.push(detail.checkpoint_filename)
    } else {
      grouped.set(detail.error_message, {
        checkpoints: [detail.checkpoint_filename],
        traceback: detail.traceback,
      })
    }
  }

  return Array.from(grouped.entries()).map(([errorMessage, data]) => ({
    errorMessage,
    checkpoints: data.checkpoints.sort(),
    traceback: data.traceback,
  }))
}

/** Sort completeness entries by checkpoint name for stable display. */
export function sortCompletenessEntries(
  entries: WSCheckpointCompletenessInfo[] | undefined,
): WSCheckpointCompletenessInfo[] {
  if (!entries || entries.length === 0) return []
  return [...entries].sort((a, b) => a.checkpoint.localeCompare(b.checkpoint))
}
