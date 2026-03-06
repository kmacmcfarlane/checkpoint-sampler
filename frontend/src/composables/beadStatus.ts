import type { TrainingRun, SampleJob } from '../api/types'

/**
 * Status values for the Jobs nav button bead indicator.
 * Precedence: failed (red) > complete_with_errors (yellow) > running (blue) > complete (green) > empty (gray)
 */
export type BeadStatus = 'complete' | 'complete_with_errors' | 'failed' | 'running' | 'empty'

/**
 * Determine the bead status for the Jobs nav button given a training run and
 * the current list of sample jobs.
 *
 * Precedence: red > yellow > blue > green
 * - red    (failed)               = any job with status 'failed' (complete failure)
 * - yellow (complete_with_errors) = any job with status 'completed_with_errors' (partial failure)
 * - blue   (running)              = any job with status 'running', 'pending', or 'stopped' (in-progress)
 * - green  (complete)             = run.has_samples OR any job with status 'completed'
 * - gray   (empty)                = no samples and no jobs
 */
export function getBeadStatus(run: TrainingRun, jobs: SampleJob[]): BeadStatus {
  const runJobs = jobs.filter(j => j.training_run_name === run.name)
  const hasFailed = runJobs.some(j => j.status === 'failed')
  const hasPartialFailure = runJobs.some(j => j.status === 'completed_with_errors')
  const hasInProgress = runJobs.some(j => j.status === 'running' || j.status === 'pending' || j.status === 'stopped')
  const hasCompleted = runJobs.some(j => j.status === 'completed')
  if (hasFailed) return 'failed'
  if (hasPartialFailure) return 'complete_with_errors'
  if (hasInProgress) return 'running'
  if (hasCompleted || run.has_samples) return 'complete'
  return 'empty'
}

/** Map a BeadStatus to its display color. */
export const BEAD_COLORS: Record<BeadStatus, string> = {
  complete: '#18a058',          // green  — all completed successfully
  complete_with_errors: '#f0a020', // yellow — partial failures
  failed: '#d03050',            // red    — complete failures
  running: '#2080f0',           // blue   — in-progress (running/pending/stopped)
  empty: '#909090',             // gray   — no samples, no jobs
}
