import { reactive, type Ref } from 'vue'
import type {
  SampleJob,
  SampleJobStatus,
  JobProgressMessage,
  InferenceProgressMessage,
  CurrentSampleParams,
} from '../api/types'

/**
 * Checkpoint-level job progress entry tracked per job ID.
 *
 * Mirrors the subset of {@link JobProgressMessage} the JobProgressPanel renders,
 * plus the per-sample ETA that is updated independently by inference_progress events.
 */
export interface JobProgressEntry {
  checkpoints_completed: number
  total_checkpoints: number
  current_checkpoint?: string
  current_checkpoint_progress?: number
  current_checkpoint_total?: number
  checkpoint_completeness?: Array<{ checkpoint: string; expected: number; verified: number; missing: number }>
  sample_eta_seconds?: number
  job_eta_seconds?: number
  current_sample_params?: CurrentSampleParams
}

/** Per-sample inference progress entry tracked per job ID. */
export interface InferenceProgressEntry {
  current_value: number
  max_value: number
}

/** Terminal job statuses that indicate a job has finished. */
const TERMINAL_STATUSES: Set<SampleJobStatus> = new Set([
  'completed',
  'completed_with_errors',
  'failed',
])

/**
 * Dependencies the composable needs from the host component (App.vue).
 *
 * These are passed in (rather than owned) because they are shared with other
 * concerns: the sample job list is rendered and refreshed elsewhere, and the
 * trigger refs drive child components (JobLaunchDialog, TrainingRunSelector).
 */
export interface UseJobProgressOptions {
  /** The reactive list of sample jobs. Mutated in place by handleJobProgress. */
  sampleJobs: Ref<SampleJob[]>
  /** Counter bumped on any job status transition so the JobLaunchDialog refreshes its beads. */
  jobRefreshTrigger: Ref<number>
  /** Counter bumped when a job reaches a terminal status so TrainingRunSelector refreshes. */
  trainingRunsRefreshTrigger: Ref<number>
  /** Called when a job_progress event references a job not yet in the list (fetch full list). */
  onUnknownJob: () => void
}

export interface UseJobProgress {
  /** Checkpoint-level progress keyed by job ID. */
  jobProgress: Record<string, JobProgressEntry>
  /** Per-sample inference progress keyed by job ID. */
  inferenceProgress: Record<string, InferenceProgressEntry>
  /** Previous current_checkpoint_progress per job, used to detect new-sample boundaries. */
  prevCheckpointProgress: Record<string, number>
  /** Handle an inference_progress WebSocket event. */
  handleInferenceProgress: (message: InferenceProgressMessage) => void
  /** Handle a job_progress WebSocket event. */
  handleJobProgress: (message: JobProgressMessage) => void
}

/**
 * Owns the three manually-synced job-progress maps and the WebSocket handlers
 * that keep them in sync. Extracted from App.vue to encode (and unit-test) the
 * synchronization invariants that previously lived inline in the root component.
 *
 * Invariants preserved verbatim from the original App.vue implementation:
 *
 *  - Flip-flop guard (inference): only advance inferenceProgress when there is no
 *    existing entry or the incoming current_value is >= the stored value, so
 *    out-of-order stale events from a finished sample cannot rewind the bar.
 *  - B-067: lazily initialize a placeholder jobProgress entry (total_checkpoints: 1)
 *    on the first inference event so the bar renders before the first job_progress
 *    event arrives.
 *  - S-098: preserve an existing sample_eta_seconds across a job_progress event that
 *    omits one, UNLESS a sample just completed (completed_items increased), in which
 *    case the ETA is cleared because no sample is currently running.
 *  - Reset inferenceProgress whenever completed_items changes (sample boundary) or
 *    current_checkpoint_progress changes (new sample within a checkpoint).
 *  - jobRefreshTrigger bumps on any status transition; B-105: trainingRunsRefreshTrigger
 *    bumps (and inference/prevCheckpoint maps clear) on entering a terminal status.
 */
export function useJobProgress(options: UseJobProgressOptions): UseJobProgress {
  const { sampleJobs, jobRefreshTrigger, trainingRunsRefreshTrigger, onUnknownJob } = options

  const jobProgress = reactive<Record<string, JobProgressEntry>>({})
  const inferenceProgress = reactive<Record<string, InferenceProgressEntry>>({})
  const prevCheckpointProgress = reactive<Record<string, number>>({})

  function handleInferenceProgress(message: InferenceProgressMessage): void {
    // Find which job this prompt belongs to by matching against running jobs.
    // Since there is only one active prompt at a time, we apply inference progress
    // to the currently running job.
    const runningJob = sampleJobs.value.find(j => j.status === 'running')
    if (runningJob) {
      const existing = inferenceProgress[runningJob.id]
      // AC: Only update inference progress if this is a fresh start (no existing entry) or
      // the value is moving forward. This prevents out-of-order stale WebSocket events from
      // a completed sample from flipping the progress bar back to a lower value (flip-flop fix).
      if (!existing || message.current_value >= existing.current_value) {
        inferenceProgress[runningJob.id] = {
          current_value: message.current_value,
          max_value: message.max_value,
        }
      }
      // AC (B-067): Ensure jobProgress is initialized before the first job_progress event arrives.
      // Without this, inference progress events that arrive before the first job_progress event
      // would not display the progress bar because hasCheckpointProgress() would return false
      // (it checks total_checkpoints > 0). Use a placeholder with total_checkpoints: 1 so
      // the inference bar renders immediately; this is overwritten by the first job_progress event.
      if (!jobProgress[runningJob.id]) {
        jobProgress[runningJob.id] = {
          checkpoints_completed: 0,
          total_checkpoints: 1,
        }
      }
      // AC: Update per-sample ETA in jobProgress from inference_progress events.
      // This gives live ETA updates during sample generation, based on step completion rate.
      if (message.sample_eta_seconds !== undefined && message.sample_eta_seconds > 0) {
        const existingProgress = jobProgress[runningJob.id]
        jobProgress[runningJob.id] = {
          ...(existingProgress ?? { checkpoints_completed: 0, total_checkpoints: 1 }),
          sample_eta_seconds: message.sample_eta_seconds,
        }
      }
    }
  }

  function handleJobProgress(message: JobProgressMessage): void {
    const jobIndex = sampleJobs.value.findIndex(j => j.id === message.job_id)
    if (jobIndex !== -1) {
      const previousStatus = sampleJobs.value[jobIndex].status
      // AC: Capture prevCompleted BEFORE the spread assignment so the comparison below is valid.
      const prevCompleted = sampleJobs.value[jobIndex].completed_items
      sampleJobs.value[jobIndex] = {
        ...sampleJobs.value[jobIndex],
        status: message.status,
        total_items: message.total_items,
        completed_items: message.completed_items,
        failed_items: message.failed_items,
        pending_items: message.pending_items,
        failed_item_details: message.failed_item_details,
        updated_at: new Date().toISOString(),
      }
      // AC: Reset inference progress between samples.
      // When completed_items changes, a sample has just finished and a new one is starting.
      if (message.completed_items !== prevCompleted) {
        delete inferenceProgress[message.job_id]
      }

      // Also reset when the current checkpoint progress changes (new sample within a checkpoint)
      const prevCpProgress = prevCheckpointProgress[message.job_id]
      if (message.current_checkpoint_progress !== undefined && message.current_checkpoint_progress !== prevCpProgress) {
        delete inferenceProgress[message.job_id]
      }
      if (message.current_checkpoint_progress !== undefined) {
        prevCheckpointProgress[message.job_id] = message.current_checkpoint_progress
      }

      // Store checkpoint-level progress separately with ETA data from the backend.
      // AC (S-098 UAT): Preserve existing sample_eta_seconds when the job_progress event does
      // not include one — unless a sample just completed (completed_items increased), in which
      // case we clear it because no sample is currently running.
      // This ensures the ETA set by inference_progress events is not erased by the
      // start-of-sample job_progress broadcast that arrives before inference begins.
      const incomingSampleETA = message.sample_eta_seconds !== undefined
        ? message.sample_eta_seconds
        : (message.completed_items > prevCompleted
          ? undefined
          : jobProgress[message.job_id]?.sample_eta_seconds)

      jobProgress[message.job_id] = {
        checkpoints_completed: message.checkpoints_completed,
        total_checkpoints: message.total_checkpoints,
        current_checkpoint: message.current_checkpoint,
        current_checkpoint_progress: message.current_checkpoint_progress,
        current_checkpoint_total: message.current_checkpoint_total,
        checkpoint_completeness: message.checkpoint_completeness,
        sample_eta_seconds: incomingSampleETA,
        job_eta_seconds: message.job_eta_seconds,
        current_sample_params: message.current_sample_params,
      }
      // Increment refresh trigger whenever job status changes so the JobLaunchDialog
      // can update training run options and status beads for any status transition
      // (including pending → running, not just terminal statuses).
      if (message.status !== previousStatus) {
        jobRefreshTrigger.value++
      }
      // Clear inference progress for completed jobs; also signal TrainingRunSelector to refresh
      // so newly generated sample sets appear automatically (AC1-2, B-105).
      if (TERMINAL_STATUSES.has(message.status) && !TERMINAL_STATUSES.has(previousStatus)) {
        delete inferenceProgress[message.job_id]
        delete prevCheckpointProgress[message.job_id]
        trainingRunsRefreshTrigger.value++
      }
    } else {
      // New job, fetch the full list
      onUnknownJob()
    }
  }

  return {
    jobProgress,
    inferenceProgress,
    prevCheckpointProgress,
    handleInferenceProgress,
    handleJobProgress,
  }
}
