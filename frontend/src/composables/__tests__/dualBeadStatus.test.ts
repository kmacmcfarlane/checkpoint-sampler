import { describe, it, expect } from 'vitest'
import { getTrainingRunDualBead, getStudyDualBead, DUAL_BEAD_COLORS } from '../dualBeadStatus'
import type { SampleJob } from '../../api/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(
  status: SampleJob['status'],
  opts: { runName?: string; studyId?: string } = {},
): SampleJob {
  return {
    id: `job-${status}-${Math.random()}`,
    training_run_name: opts.runName ?? 'test-run',
    study_id: opts.studyId ?? 'study-1',
    study_name: 'Test Study',
    workflow_name: 'default',
    vae: '',
    clip: '',
    status,
    total_items: 10,
    completed_items: 5,
    failed_items: 0,
    pending_items: 5,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// getTrainingRunDualBead
// ---------------------------------------------------------------------------

describe('getTrainingRunDualBead', () => {
  // AC: Training Run — Slot 1 (activity)

  describe('slot 1 (activity bead)', () => {
    // AC: Blue bead when there is a running job for the sample set
    it('returns activity=blue when a job is running', () => {
      const result = getTrainingRunDualBead('test-run', [makeJob('running')], [])
      expect(result.activity).toBe('blue')
    })

    it('returns activity=blue when a job is pending', () => {
      const result = getTrainingRunDualBead('test-run', [makeJob('pending')], [])
      expect(result.activity).toBe('blue')
    })

    it('blue wins over green (running job + all complete study statuses)', () => {
      const result = getTrainingRunDualBead('test-run', [makeJob('running')], ['complete', 'complete'])
      // AC: Blue bead takes priority over green
      expect(result.activity).toBe('blue')
    })

    // AC: Green bead when at least one study is complete and none are partial
    it('returns activity=green when all study statuses are complete and no running jobs', () => {
      const result = getTrainingRunDualBead('test-run', [], ['complete', 'complete'])
      expect(result.activity).toBe('green')
    })

    it('returns activity=green when some studies complete and rest are none (no partial)', () => {
      const result = getTrainingRunDualBead('test-run', [], ['none', 'none', 'complete', 'none'])
      expect(result.activity).toBe('green')
    })

    it('returns activity=null when study statuses array is empty and no jobs', () => {
      const result = getTrainingRunDualBead('test-run', [], [])
      expect(result.activity).toBeNull()
    })

    it('returns activity=null when some studies complete but others partial', () => {
      const result = getTrainingRunDualBead('test-run', [], ['complete', 'partial'])
      expect(result.activity).toBeNull()
    })

    it('returns activity=null when no jobs and all statuses are none', () => {
      const result = getTrainingRunDualBead('test-run', [], ['none', 'none'])
      expect(result.activity).toBeNull()
    })

    it('ignores jobs from other training runs', () => {
      const otherJob = makeJob('running', { runName: 'other-run' })
      const result = getTrainingRunDualBead('test-run', [otherJob], [])
      expect(result.activity).toBeNull()
    })

    // No job-based green fallback: green only comes from availability data (all studies complete)
    it('returns activity=null when a completed job exists but no availability data', () => {
      // Non-selected training runs lack availability data → no green bead
      const result = getTrainingRunDualBead('test-run', [makeJob('completed')], [])
      expect(result.activity).toBeNull()
    })

    it('returns activity=null when a completed job exists and some study statuses are partial', () => {
      // Partial status blocks green bead even when some studies are complete
      const result = getTrainingRunDualBead('test-run', [makeJob('completed')], ['complete', 'partial'])
      expect(result.activity).toBeNull()
    })

    it('returns activity=null when all study statuses are partial', () => {
      // All partial → yellow only, no green
      const result = getTrainingRunDualBead('test-run', [], ['partial', 'partial'])
      expect(result.activity).toBeNull()
    })
  })

  // AC: Training Run — Slot 2 (problem)

  describe('slot 2 (problem bead)', () => {
    // AC: Red bead when there is a failed job with missing samples
    it('returns problem=red when a job has failed', () => {
      const result = getTrainingRunDualBead('test-run', [makeJob('failed')], [])
      expect(result.problem).toBe('red')
    })

    // AC: Red beats yellow
    it('red wins over yellow (failed + completed_with_errors)', () => {
      const result = getTrainingRunDualBead(
        'test-run',
        [makeJob('failed'), makeJob('completed_with_errors')],
        [],
      )
      // AC: Red bead takes priority over yellow
      expect(result.problem).toBe('red')
    })

    // Yellow only comes from study availability (partial status), not from job status alone
    it('returns problem=null when completed_with_errors but no partial study status', () => {
      const result = getTrainingRunDualBead('test-run', [makeJob('completed_with_errors')], [])
      expect(result.problem).toBeNull()
    })

    it('returns problem=null when all jobs completed successfully', () => {
      const result = getTrainingRunDualBead('test-run', [makeJob('completed')], [])
      expect(result.problem).toBeNull()
    })

    it('returns problem=null when no jobs at all', () => {
      const result = getTrainingRunDualBead('test-run', [], [])
      expect(result.problem).toBeNull()
    })

    it('ignores jobs from other training runs for problem bead', () => {
      const otherJob = makeJob('failed', { runName: 'other-run' })
      const result = getTrainingRunDualBead('test-run', [otherJob], [])
      expect(result.problem).toBeNull()
    })

    // AC: Yellow bead from study-level partial status (incomplete without running jobs)
    it('returns problem=yellow when study statuses include partial and no running jobs', () => {
      const result = getTrainingRunDualBead('test-run', [], ['partial', 'none'])
      expect(result.problem).toBe('yellow')
    })

    it('returns problem=null when study statuses are partial but there is a running job', () => {
      // Yellow suppressed when a job is running to fix the partial state
      const result = getTrainingRunDualBead('test-run', [makeJob('running')], ['partial', 'none'])
      expect(result.problem).toBeNull()
    })

    it('returns problem=red (not yellow) when study statuses are partial and job has failed', () => {
      // Red wins over yellow from study partial status
      const result = getTrainingRunDualBead('test-run', [makeJob('failed')], ['partial', 'none'])
      expect(result.problem).toBe('red')
    })
  })

  // AC: FE: Blue bead takes priority over green; red takes priority over yellow

  describe('priority rules', () => {
    it('blue priority over green: running job overrides all-complete study statuses', () => {
      const result = getTrainingRunDualBead('test-run', [makeJob('running')], ['complete', 'complete'])
      expect(result.activity).toBe('blue')
    })

    it('red priority over yellow: failed job overrides partial study status', () => {
      const result = getTrainingRunDualBead('test-run', [makeJob('failed')], ['partial'])
      expect(result.problem).toBe('red')
    })
  })

  describe('both beads active simultaneously', () => {
    it('can show both activity and problem beads at the same time', () => {
      // Pending (activity=blue) + failed (problem=red)
      const result = getTrainingRunDualBead('test-run', [makeJob('pending'), makeJob('failed')], [])
      expect(result.activity).toBe('blue')
      expect(result.problem).toBe('red')
    })
  })
})

// ---------------------------------------------------------------------------
// getStudyDualBead
// ---------------------------------------------------------------------------

describe('getStudyDualBead', () => {
  // AC: Study Beads — Slot 1 (activity)

  describe('slot 1 (activity bead)', () => {
    // AC: Blue bead when there is a running job for selected sample set
    it('returns activity=blue when a job for this study is running', () => {
      const job = makeJob('running', { runName: 'run-a', studyId: 'study-x' })
      const result = getStudyDualBead('run-a', 'study-x', [job], 'none')
      expect(result.activity).toBe('blue')
    })

    it('returns activity=blue when a job for this study is pending', () => {
      const job = makeJob('pending', { runName: 'run-a', studyId: 'study-x' })
      const result = getStudyDualBead('run-a', 'study-x', [job], 'none')
      expect(result.activity).toBe('blue')
    })

    // AC: Blue wins over green
    it('blue wins over green (running + complete status)', () => {
      const job = makeJob('running', { runName: 'run-a', studyId: 'study-x' })
      // AC: Blue bead takes priority over green
      const result = getStudyDualBead('run-a', 'study-x', [job], 'complete')
      expect(result.activity).toBe('blue')
    })

    // AC: Green bead when selected sample set is complete
    it('returns activity=green when sample_status is complete and no running jobs', () => {
      const result = getStudyDualBead('run-a', 'study-x', [], 'complete')
      expect(result.activity).toBe('green')
    })

    it('returns activity=null when sample_status is none and no jobs', () => {
      const result = getStudyDualBead('run-a', 'study-x', [], 'none')
      expect(result.activity).toBeNull()
    })

    it('returns activity=null when sample_status is partial and no running jobs', () => {
      // Partial doesn't trigger green (not complete)
      const result = getStudyDualBead('run-a', 'study-x', [], 'partial')
      expect(result.activity).toBeNull()
    })

    it('ignores jobs from other studies', () => {
      const otherJob = makeJob('running', { runName: 'run-a', studyId: 'study-other' })
      const result = getStudyDualBead('run-a', 'study-x', [otherJob], 'none')
      expect(result.activity).toBeNull()
    })

    it('ignores jobs from other training runs', () => {
      const otherJob = makeJob('running', { runName: 'other-run', studyId: 'study-x' })
      const result = getStudyDualBead('run-a', 'study-x', [otherJob], 'none')
      expect(result.activity).toBeNull()
    })
  })

  // AC: Study Beads — Slot 2 (problem)

  describe('slot 2 (problem bead)', () => {
    // AC: Red bead when there is a failed job with missing samples
    it('returns problem=red when a job for this study has failed', () => {
      const job = makeJob('failed', { runName: 'run-a', studyId: 'study-x' })
      const result = getStudyDualBead('run-a', 'study-x', [job], 'none')
      expect(result.problem).toBe('red')
    })

    // AC: Red beats yellow
    it('red wins over yellow: failed job with partial status', () => {
      const job = makeJob('failed', { runName: 'run-a', studyId: 'study-x' })
      // AC: Red bead takes priority over yellow
      const result = getStudyDualBead('run-a', 'study-x', [job], 'partial')
      expect(result.problem).toBe('red')
    })

    // AC: Yellow bead when selected sample set exists but incomplete
    it('returns problem=yellow when sample_status is partial and no running jobs', () => {
      const result = getStudyDualBead('run-a', 'study-x', [], 'partial')
      expect(result.problem).toBe('yellow')
    })

    it('returns problem=null when sample_status is partial but there is a running job', () => {
      // Yellow only shows when partial without running jobs
      const job = makeJob('running', { runName: 'run-a', studyId: 'study-x' })
      const result = getStudyDualBead('run-a', 'study-x', [job], 'partial')
      expect(result.problem).toBeNull()
    })

    it('returns problem=null when sample_status is none', () => {
      const result = getStudyDualBead('run-a', 'study-x', [], 'none')
      expect(result.problem).toBeNull()
    })

    it('returns problem=null when sample_status is complete', () => {
      const result = getStudyDualBead('run-a', 'study-x', [], 'complete')
      expect(result.problem).toBeNull()
    })

    it('ignores jobs from other studies for problem bead', () => {
      const otherJob = makeJob('failed', { runName: 'run-a', studyId: 'other-study' })
      const result = getStudyDualBead('run-a', 'study-x', [otherJob], 'none')
      expect(result.problem).toBeNull()
    })
  })

  describe('both beads active simultaneously', () => {
    it('can show both activity (blue) and problem (red) beads', () => {
      const runningJob = makeJob('running', { runName: 'run-a', studyId: 'study-x' })
      const failedJob = makeJob('failed', { runName: 'run-a', studyId: 'study-x' })
      const result = getStudyDualBead('run-a', 'study-x', [runningJob, failedJob], 'partial')
      expect(result.activity).toBe('blue')
      expect(result.problem).toBe('red')
    })

    it('can show both activity (green) and no problem when complete', () => {
      const result = getStudyDualBead('run-a', 'study-x', [], 'complete')
      expect(result.activity).toBe('green')
      expect(result.problem).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// DUAL_BEAD_COLORS
// ---------------------------------------------------------------------------

describe('DUAL_BEAD_COLORS', () => {
  it('blue maps to #2080f0', () => {
    expect(DUAL_BEAD_COLORS.blue).toBe('#2080f0')
  })

  it('green maps to #18a058', () => {
    expect(DUAL_BEAD_COLORS.green).toBe('#18a058')
  })

  it('yellow maps to #f0a020', () => {
    expect(DUAL_BEAD_COLORS.yellow).toBe('#f0a020')
  })

  it('red maps to #d03050', () => {
    expect(DUAL_BEAD_COLORS.red).toBe('#d03050')
  })
})
