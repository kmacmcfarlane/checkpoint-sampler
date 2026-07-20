import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { useJobProgress, type UseJobProgress } from '../useJobProgress'
import type { SampleJob, JobProgressMessage, InferenceProgressMessage } from '../../api/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<SampleJob> = {}): SampleJob {
  return {
    id: 'job-1',
    training_run_name: 'run-a',
    study_id: 'study-1',
    study_name: 'Study 1',
    workflow_name: 'default',
    vae: '',
    clip: '',
    status: 'running',
    total_items: 10,
    completed_items: 0,
    failed_items: 0,
    pending_items: 10,
    checkpoint_filenames: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeJobProgressMsg(overrides: Partial<JobProgressMessage> = {}): JobProgressMessage {
  return {
    type: 'job_progress',
    job_id: 'job-1',
    status: 'running',
    total_items: 10,
    completed_items: 0,
    failed_items: 0,
    pending_items: 10,
    checkpoints_completed: 0,
    total_checkpoints: 2,
    ...overrides,
  }
}

function makeInferenceMsg(overrides: Partial<InferenceProgressMessage> = {}): InferenceProgressMessage {
  return {
    type: 'inference_progress',
    prompt_id: 'prompt-1',
    current_value: 0,
    max_value: 20,
    ...overrides,
  }
}

interface Harness {
  composable: UseJobProgress
  sampleJobs: Ref<SampleJob[]>
  jobRefreshTrigger: Ref<number>
  trainingRunsRefreshTrigger: Ref<number>
  onUnknownJob: ReturnType<typeof vi.fn>
}

function setup(jobs: SampleJob[] = []): Harness {
  const sampleJobs = ref<SampleJob[]>(jobs)
  const jobRefreshTrigger = ref(0)
  const trainingRunsRefreshTrigger = ref(0)
  const onUnknownJob = vi.fn()
  const composable = useJobProgress({
    sampleJobs,
    jobRefreshTrigger,
    trainingRunsRefreshTrigger,
    onUnknownJob,
  })
  return { composable, sampleJobs, jobRefreshTrigger, trainingRunsRefreshTrigger, onUnknownJob }
}

// ---------------------------------------------------------------------------
// handleInferenceProgress
// ---------------------------------------------------------------------------

describe('useJobProgress.handleInferenceProgress', () => {
  let h: Harness
  beforeEach(() => {
    h = setup([makeJob({ id: 'job-1', status: 'running' })])
  })

  it('records inference progress for the running job', () => {
    h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 5, max_value: 20 }))
    expect(h.composable.inferenceProgress['job-1']).toEqual({ current_value: 5, max_value: 20 })
  })

  it('does nothing when there is no running job', () => {
    h = setup([makeJob({ id: 'job-1', status: 'pending' })])
    h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 5 }))
    expect(h.composable.inferenceProgress['job-1']).toBeUndefined()
  })

  // AC: flip-flop guard — only advance when value >= existing
  describe('flip-flop guard (out-of-order stale events)', () => {
    it('advances when the incoming value is greater', () => {
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 5 }))
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 8 }))
      expect(h.composable.inferenceProgress['job-1'].current_value).toBe(8)
    })

    it('advances when the incoming value is equal', () => {
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 5, max_value: 20 }))
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 5, max_value: 30 }))
      expect(h.composable.inferenceProgress['job-1']).toEqual({ current_value: 5, max_value: 30 })
    })

    it('does NOT rewind when a stale lower value arrives', () => {
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 8 }))
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 3 }))
      expect(h.composable.inferenceProgress['job-1'].current_value).toBe(8)
    })
  })

  // AC (B-067): placeholder jobProgress so the bar renders before first job_progress
  it('B-067: initializes a placeholder jobProgress entry (total_checkpoints=1)', () => {
    expect(h.composable.jobProgress['job-1']).toBeUndefined()
    h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 1 }))
    expect(h.composable.jobProgress['job-1']).toMatchObject({
      checkpoints_completed: 0,
      total_checkpoints: 1,
    })
  })

  it('B-067: does not overwrite an existing jobProgress entry', () => {
    h.composable.handleJobProgress(makeJobProgressMsg({ checkpoints_completed: 1, total_checkpoints: 4 }))
    h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 1 }))
    expect(h.composable.jobProgress['job-1'].total_checkpoints).toBe(4)
    expect(h.composable.jobProgress['job-1'].checkpoints_completed).toBe(1)
  })

  // AC: live per-sample ETA from inference events
  it('updates sample_eta_seconds in jobProgress when present and positive', () => {
    h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 2, sample_eta_seconds: 42 }))
    expect(h.composable.jobProgress['job-1'].sample_eta_seconds).toBe(42)
  })

  it('ignores a zero/undefined sample_eta_seconds', () => {
    h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 2, sample_eta_seconds: 0 }))
    expect(h.composable.jobProgress['job-1'].sample_eta_seconds).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// handleJobProgress
// ---------------------------------------------------------------------------

describe('useJobProgress.handleJobProgress', () => {
  let h: Harness
  beforeEach(() => {
    h = setup([makeJob({ id: 'job-1', status: 'running', completed_items: 0 })])
  })

  it('updates the matching job entry in sampleJobs in place', () => {
    h.composable.handleJobProgress(makeJobProgressMsg({ completed_items: 3, total_items: 12 }))
    expect(h.sampleJobs.value[0].completed_items).toBe(3)
    expect(h.sampleJobs.value[0].total_items).toBe(12)
  })

  it('records checkpoint-level progress in jobProgress', () => {
    h.composable.handleJobProgress(makeJobProgressMsg({
      checkpoints_completed: 1,
      total_checkpoints: 3,
      current_checkpoint: 'chk-a',
      job_eta_seconds: 100,
    }))
    expect(h.composable.jobProgress['job-1']).toMatchObject({
      checkpoints_completed: 1,
      total_checkpoints: 3,
      current_checkpoint: 'chk-a',
      job_eta_seconds: 100,
    })
  })

  it('calls onUnknownJob when the job is not in the list', () => {
    h.composable.handleJobProgress(makeJobProgressMsg({ job_id: 'unknown-job' }))
    expect(h.onUnknownJob).toHaveBeenCalledTimes(1)
  })

  // AC: reset inference progress on sample boundary
  describe('inference reset on sample boundary', () => {
    it('clears inferenceProgress when completed_items changes', () => {
      h.composable.inferenceProgress['job-1'] = { current_value: 10, max_value: 20 }
      h.composable.handleJobProgress(makeJobProgressMsg({ completed_items: 1 }))
      expect(h.composable.inferenceProgress['job-1']).toBeUndefined()
    })

    it('does NOT clear inferenceProgress when completed_items is unchanged', () => {
      h.composable.inferenceProgress['job-1'] = { current_value: 10, max_value: 20 }
      h.composable.handleJobProgress(makeJobProgressMsg({ completed_items: 0 }))
      expect(h.composable.inferenceProgress['job-1']).toEqual({ current_value: 10, max_value: 20 })
    })

    it('clears inferenceProgress when current_checkpoint_progress changes', () => {
      h.composable.handleJobProgress(makeJobProgressMsg({ current_checkpoint_progress: 0 }))
      h.composable.inferenceProgress['job-1'] = { current_value: 10, max_value: 20 }
      h.composable.handleJobProgress(makeJobProgressMsg({ current_checkpoint_progress: 1 }))
      expect(h.composable.inferenceProgress['job-1']).toBeUndefined()
    })

    it('tracks prevCheckpointProgress per job', () => {
      h.composable.handleJobProgress(makeJobProgressMsg({ current_checkpoint_progress: 4 }))
      expect(h.composable.prevCheckpointProgress['job-1']).toBe(4)
    })
  })

  // AC (S-098): sample_eta_seconds preservation rules
  describe('S-098 ETA preservation', () => {
    it('uses the incoming sample_eta_seconds when present', () => {
      h.composable.handleJobProgress(makeJobProgressMsg({ sample_eta_seconds: 77 }))
      expect(h.composable.jobProgress['job-1'].sample_eta_seconds).toBe(77)
    })

    it('preserves an existing ETA when the event omits one and no sample completed', () => {
      // Inference event sets the ETA first
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 1, sample_eta_seconds: 55 }))
      // A start-of-sample job_progress arrives WITHOUT an ETA and same completed_items
      h.composable.handleJobProgress(makeJobProgressMsg({ completed_items: 0 }))
      expect(h.composable.jobProgress['job-1'].sample_eta_seconds).toBe(55)
    })

    it('clears the ETA when a sample just completed (completed_items increased) and no ETA in event', () => {
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 1, sample_eta_seconds: 55 }))
      h.composable.handleJobProgress(makeJobProgressMsg({ completed_items: 1 }))
      expect(h.composable.jobProgress['job-1'].sample_eta_seconds).toBeUndefined()
    })

    it('the incoming ETA wins even when a sample completed', () => {
      h.composable.handleInferenceProgress(makeInferenceMsg({ current_value: 1, sample_eta_seconds: 55 }))
      h.composable.handleJobProgress(makeJobProgressMsg({ completed_items: 1, sample_eta_seconds: 30 }))
      expect(h.composable.jobProgress['job-1'].sample_eta_seconds).toBe(30)
    })
  })

  // AC: status-transition triggers
  describe('status-transition triggers', () => {
    it('bumps jobRefreshTrigger on any status change', () => {
      h.composable.handleJobProgress(makeJobProgressMsg({ status: 'completed' }))
      expect(h.jobRefreshTrigger.value).toBe(1)
    })

    it('does not bump jobRefreshTrigger when status is unchanged', () => {
      h.composable.handleJobProgress(makeJobProgressMsg({ status: 'running' }))
      expect(h.jobRefreshTrigger.value).toBe(0)
    })

    it('B-105: bumps trainingRunsRefreshTrigger when entering a terminal status', () => {
      h.composable.handleJobProgress(makeJobProgressMsg({ status: 'completed' }))
      expect(h.trainingRunsRefreshTrigger.value).toBe(1)
    })

    it('B-105: clears inference + prevCheckpoint maps when entering a terminal status', () => {
      h.composable.handleJobProgress(makeJobProgressMsg({ current_checkpoint_progress: 2 }))
      h.composable.inferenceProgress['job-1'] = { current_value: 10, max_value: 20 }
      h.composable.handleJobProgress(makeJobProgressMsg({ status: 'completed', current_checkpoint_progress: 2 }))
      expect(h.composable.inferenceProgress['job-1']).toBeUndefined()
      expect(h.composable.prevCheckpointProgress['job-1']).toBeUndefined()
    })

    it.each([
      ['completed', true],
      ['completed_with_errors', true],
      ['failed', true],
      ['running', false],
      ['pending', false],
      ['stopped', false],
    ] as const)('terminal status %s → trainingRunsRefreshTrigger bumped=%s', (status, bumped) => {
      const local = setup([makeJob({ id: 'job-1', status: 'running' })])
      local.composable.handleJobProgress(makeJobProgressMsg({ status }))
      expect(local.trainingRunsRefreshTrigger.value).toBe(bumped ? 1 : 0)
    })

    it('does not re-bump trainingRunsRefreshTrigger on a terminal→terminal transition', () => {
      h = setup([makeJob({ id: 'job-1', status: 'completed' })])
      h.composable.handleJobProgress(makeJobProgressMsg({ status: 'failed' }))
      // Status changes (jobRefresh bumps) but both statuses are terminal, so no TR refresh
      expect(h.jobRefreshTrigger.value).toBe(1)
      expect(h.trainingRunsRefreshTrigger.value).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Map pruning (R-022)
// ---------------------------------------------------------------------------

describe('useJobProgress map pruning', () => {
  // AC: jobProgress map entries pruned on terminal job status

  it('drops live-tracking fields from jobProgress when a job goes terminal', () => {
    const h = setup([makeJob({ id: 'job-1', status: 'running' })])
    h.composable.handleJobProgress(
      makeJobProgressMsg({
        status: 'running',
        current_checkpoint: 'ckpt-a',
        current_checkpoint_progress: 3,
        current_checkpoint_total: 5,
        sample_eta_seconds: 12,
        job_eta_seconds: 90,
        current_sample_params: { prompt: 'a very long prompt' } as never,
      }),
    )
    expect(h.composable.jobProgress['job-1'].current_sample_params).toBeDefined()

    h.composable.handleJobProgress(
      makeJobProgressMsg({ status: 'completed', checkpoints_completed: 2 }),
    )

    const entry = h.composable.jobProgress['job-1']
    expect(entry.current_sample_params).toBeUndefined()
    expect(entry.sample_eta_seconds).toBeUndefined()
    expect(entry.job_eta_seconds).toBeUndefined()
    expect(entry.current_checkpoint).toBeUndefined()
  })

  it('retains the completion summary so finished jobs still render progress', () => {
    const h = setup([makeJob({ id: 'job-1', status: 'running' })])
    h.composable.handleJobProgress(
      makeJobProgressMsg({
        status: 'completed',
        checkpoints_completed: 2,
        total_checkpoints: 2,
        checkpoint_completeness: [{ checkpoint_filename: 'ckpt-a', complete: true }] as never,
      }),
    )
    const entry = h.composable.jobProgress['job-1']
    expect(entry.checkpoints_completed).toBe(2)
    expect(entry.total_checkpoints).toBe(2)
    expect(entry.checkpoint_completeness).toHaveLength(1)
  })

  it('prunes entries for jobs no longer present in the job list', () => {
    const h = setup([makeJob({ id: 'job-1', status: 'running' })])
    // Seed state for a job that later disappears from the list (deleted/paged out).
    h.composable.jobProgress['stale-job'] = { checkpoints_completed: 1, total_checkpoints: 1 }
    h.composable.inferenceProgress['stale-job'] = { current_value: 1, max_value: 2 }
    h.composable.prevCheckpointProgress['stale-job'] = 3

    h.composable.handleJobProgress(makeJobProgressMsg({ status: 'completed' }))

    expect(h.composable.jobProgress['stale-job']).toBeUndefined()
    expect(h.composable.inferenceProgress['stale-job']).toBeUndefined()
    expect(h.composable.prevCheckpointProgress['stale-job']).toBeUndefined()
    // The still-live job keeps its (pruned) entry.
    expect(h.composable.jobProgress['job-1']).toBeDefined()
  })
})
