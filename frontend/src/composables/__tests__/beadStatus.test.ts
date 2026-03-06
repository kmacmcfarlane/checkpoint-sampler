import { describe, it, expect } from 'vitest'
import { getBeadStatus, BEAD_COLORS } from '../beadStatus'
import type { TrainingRun, SampleJob } from '../../api/types'

const baseRun: TrainingRun = {
  id: 1,
  name: 'test-run',
  checkpoint_count: 1,
  has_samples: false,
  checkpoints: [],
}

function makeJob(status: SampleJob['status'], runName = 'test-run'): SampleJob {
  return {
    id: `job-${status}`,
    training_run_name: runName,
    study_id: 'study-1',
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

describe('getBeadStatus', () => {
  // AC1: green when all jobs completed successfully
  describe('green (complete)', () => {
    it('returns complete when run has_samples and no jobs', () => {
      const run = { ...baseRun, has_samples: true }
      expect(getBeadStatus(run, [])).toBe('complete')
    })

    it('returns complete when all jobs have status completed', () => {
      const jobs = [makeJob('completed'), makeJob('completed')]
      expect(getBeadStatus(baseRun, jobs)).toBe('complete')
    })

    it('returns complete when a single completed job exists', () => {
      expect(getBeadStatus(baseRun, [makeJob('completed')])).toBe('complete')
    })
  })

  // AC2: blue when job(s) are in-progress
  describe('blue (running)', () => {
    it.each([
      ['running' as const],
      ['pending' as const],
      ['stopped' as const],
    ])('returns running when a job has status %s', (status) => {
      expect(getBeadStatus(baseRun, [makeJob(status)])).toBe('running')
    })

    it('returns running when mix of running and completed', () => {
      const jobs = [makeJob('running'), makeJob('completed')]
      expect(getBeadStatus(baseRun, jobs)).toBe('running')
    })

    it('returns running when mix of pending and completed', () => {
      const jobs = [makeJob('pending'), makeJob('completed')]
      expect(getBeadStatus(baseRun, jobs)).toBe('running')
    })
  })

  // AC3: yellow when job(s) have partial failures
  describe('yellow (complete_with_errors)', () => {
    it('returns complete_with_errors when a job has completed_with_errors', () => {
      expect(getBeadStatus(baseRun, [makeJob('completed_with_errors')])).toBe('complete_with_errors')
    })

    it('returns complete_with_errors when mix of completed and completed_with_errors', () => {
      const jobs = [makeJob('completed'), makeJob('completed_with_errors')]
      expect(getBeadStatus(baseRun, jobs)).toBe('complete_with_errors')
    })
  })

  // AC4: red when job(s) have complete failures
  describe('red (failed)', () => {
    it('returns failed when a job has status failed', () => {
      expect(getBeadStatus(baseRun, [makeJob('failed')])).toBe('failed')
    })

    it('returns failed when mix of completed and failed', () => {
      const jobs = [makeJob('completed'), makeJob('failed')]
      expect(getBeadStatus(baseRun, jobs)).toBe('failed')
    })
  })

  // AC5: precedence — red > yellow > blue > green
  describe('precedence: red > yellow > blue > green', () => {
    it('red beats yellow (failed overrides complete_with_errors)', () => {
      const jobs = [makeJob('completed_with_errors'), makeJob('failed')]
      expect(getBeadStatus(baseRun, jobs)).toBe('failed')
    })

    it('red beats blue (failed overrides running)', () => {
      const jobs = [makeJob('running'), makeJob('failed')]
      expect(getBeadStatus(baseRun, jobs)).toBe('failed')
    })

    it('red beats green (failed overrides completed)', () => {
      const jobs = [makeJob('completed'), makeJob('failed')]
      expect(getBeadStatus(baseRun, jobs)).toBe('failed')
    })

    it('yellow beats blue (complete_with_errors overrides running)', () => {
      const jobs = [makeJob('running'), makeJob('completed_with_errors')]
      expect(getBeadStatus(baseRun, jobs)).toBe('complete_with_errors')
    })

    it('yellow beats green (complete_with_errors overrides completed)', () => {
      const jobs = [makeJob('completed'), makeJob('completed_with_errors')]
      expect(getBeadStatus(baseRun, jobs)).toBe('complete_with_errors')
    })

    it('blue beats green (running overrides completed)', () => {
      const jobs = [makeJob('completed'), makeJob('running')]
      expect(getBeadStatus(baseRun, jobs)).toBe('running')
    })

    it('red wins over all statuses combined', () => {
      const jobs = [
        makeJob('completed'),
        makeJob('running'),
        makeJob('completed_with_errors'),
        makeJob('failed'),
      ]
      expect(getBeadStatus(baseRun, jobs)).toBe('failed')
    })
  })

  // empty state
  describe('gray (empty)', () => {
    it('returns empty when run has no samples and no jobs', () => {
      expect(getBeadStatus(baseRun, [])).toBe('empty')
    })

    it('ignores jobs from other training runs', () => {
      const otherJob = makeJob('failed', 'other-run')
      expect(getBeadStatus(baseRun, [otherJob])).toBe('empty')
    })

    it('returns empty when run has no samples and only foreign jobs exist', () => {
      const foreignJobs = [makeJob('running', 'other-run'), makeJob('failed', 'another-run')]
      expect(getBeadStatus(baseRun, foreignJobs)).toBe('empty')
    })
  })
})

describe('BEAD_COLORS', () => {
  it('complete maps to green (#18a058)', () => {
    expect(BEAD_COLORS.complete).toBe('#18a058')
  })

  it('complete_with_errors maps to yellow (#f0a020)', () => {
    expect(BEAD_COLORS.complete_with_errors).toBe('#f0a020')
  })

  it('failed maps to red (#d03050)', () => {
    expect(BEAD_COLORS.failed).toBe('#d03050')
  })

  it('running maps to blue (#2080f0)', () => {
    expect(BEAD_COLORS.running).toBe('#2080f0')
  })

  it('empty maps to gray (#909090)', () => {
    expect(BEAD_COLORS.empty).toBe('#909090')
  })
})
