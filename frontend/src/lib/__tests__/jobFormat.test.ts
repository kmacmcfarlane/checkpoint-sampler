import { describe, it, expect } from 'vitest'
import {
  getStatusType,
  getStatusLabel,
  getProgressPercentage,
  getProgressStatus,
  canStop,
  canResume,
  canRegenerate,
  canRetryFailed,
  canDelete,
  hasFailedItems,
  formatDuration,
  formatCompleteness,
  getGroupedErrors,
  sortCompletenessEntries,
} from '../jobFormat'
import type { SampleJob, SampleJobStatus, WSCheckpointCompletenessInfo } from '../../api/types'

function makeJob(overrides: Partial<SampleJob> = {}): SampleJob {
  return {
    id: 'job-1',
    training_run_name: 'run-a',
    study_id: 'study-1',
    study_name: 'Study 1',
    workflow_name: 'wf',
    status: 'running',
    total_items: 10,
    completed_items: 0,
    failed_items: 0,
    pending_items: 10,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as SampleJob
}

describe('jobFormat', () => {
  describe('getStatusType', () => {
    it.each<[SampleJobStatus, string]>([
      ['completed', 'success'],
      ['completed_with_errors', 'warning'],
      ['failed', 'error'],
      ['stopped', 'error'],
      ['running', 'info'],
      ['pending', 'default'],
    ])('maps %s to %s', (status, expected) => {
      expect(getStatusType(status)).toBe(expected)
    })
  })

  describe('getStatusLabel', () => {
    it('expands completed_with_errors into prose', () => {
      expect(getStatusLabel('completed_with_errors')).toBe('completed with errors')
    })

    it('passes other statuses through unchanged', () => {
      expect(getStatusLabel('running')).toBe('running')
    })
  })

  describe('getProgressPercentage', () => {
    it('returns 0 when there are no items (no divide-by-zero)', () => {
      expect(getProgressPercentage(makeJob({ total_items: 0, completed_items: 0 }))).toBe(0)
    })

    it('rounds to the nearest whole percent', () => {
      expect(getProgressPercentage(makeJob({ total_items: 3, completed_items: 1 }))).toBe(33)
      expect(getProgressPercentage(makeJob({ total_items: 10, completed_items: 10 }))).toBe(100)
    })
  })

  describe('getProgressStatus', () => {
    it.each<[SampleJobStatus, string]>([
      ['failed', 'error'],
      ['completed_with_errors', 'warning'],
      ['completed', 'success'],
      ['running', 'default'],
      ['pending', 'default'],
    ])('maps %s to %s', (status, expected) => {
      expect(getProgressStatus(makeJob({ status }))).toBe(expected)
    })
  })

  describe('action predicates', () => {
    it('allows stop only while running', () => {
      expect(canStop(makeJob({ status: 'running' }))).toBe(true)
      expect(canStop(makeJob({ status: 'pending' }))).toBe(false)
    })

    it('allows resume only when stopped', () => {
      expect(canResume(makeJob({ status: 'stopped' }))).toBe(true)
      expect(canResume(makeJob({ status: 'running' }))).toBe(false)
    })

    it('allows regenerate for both completed variants', () => {
      expect(canRegenerate(makeJob({ status: 'completed' }))).toBe(true)
      expect(canRegenerate(makeJob({ status: 'completed_with_errors' }))).toBe(true)
      expect(canRegenerate(makeJob({ status: 'running' }))).toBe(false)
    })

    it('allows retry only for completed_with_errors', () => {
      expect(canRetryFailed(makeJob({ status: 'completed_with_errors' }))).toBe(true)
      expect(canRetryFailed(makeJob({ status: 'completed' }))).toBe(false)
    })

    it('hides delete only while running', () => {
      expect(canDelete(makeJob({ status: 'running' }))).toBe(false)
      expect(canDelete(makeJob({ status: 'completed' }))).toBe(true)
      expect(canDelete(makeJob({ status: 'pending' }))).toBe(true)
    })
  })

  describe('hasFailedItems', () => {
    it('treats a missing failed_items count as zero', () => {
      expect(hasFailedItems(makeJob({ failed_items: undefined }))).toBe(false)
      expect(hasFailedItems(makeJob({ failed_items: 0 }))).toBe(false)
      expect(hasFailedItems(makeJob({ failed_items: 2 }))).toBe(true)
    })
  })

  describe('formatDuration', () => {
    it.each<[number, string]>([
      [0, '0s'],
      [-5, '0s'],
      [5, '5s'],
      [59, '59s'],
      [60, '1m'],
      [150, '2m 30s'],
      [3600, '1h 0m'],
      [4500, '1h 15m'],
    ])('formats %d seconds as %s', (seconds, expected) => {
      expect(formatDuration(seconds)).toBe(expected)
    })
  })

  describe('formatCompleteness', () => {
    it('reports verified counts when nothing is missing', () => {
      expect(formatCompleteness({ checkpoint: 'c', verified: 24, expected: 24, missing: 0 } as WSCheckpointCompletenessInfo))
        .toBe('24/24 verified')
    })

    it('reports the missing count when incomplete', () => {
      expect(formatCompleteness({ checkpoint: 'c', verified: 23, expected: 24, missing: 1 } as WSCheckpointCompletenessInfo))
        .toBe('23/24 -- 1 missing')
    })
  })

  describe('sortCompletenessEntries', () => {
    it('returns an empty array for undefined or empty input', () => {
      expect(sortCompletenessEntries(undefined)).toEqual([])
      expect(sortCompletenessEntries([])).toEqual([])
    })

    it('sorts by checkpoint name without mutating the input', () => {
      const input = [
        { checkpoint: 'b', verified: 1, expected: 1, missing: 0 },
        { checkpoint: 'a', verified: 1, expected: 1, missing: 0 },
      ] as WSCheckpointCompletenessInfo[]

      const sorted = sortCompletenessEntries(input)

      expect(sorted.map(e => e.checkpoint)).toEqual(['a', 'b'])
      expect(input.map(e => e.checkpoint)).toEqual(['b', 'a'])
    })
  })

  describe('getGroupedErrors', () => {
    it('returns an empty array when there are no details', () => {
      expect(getGroupedErrors(makeJob({ failed_item_details: undefined }))).toEqual([])
      expect(getGroupedErrors(makeJob({ failed_item_details: [] }))).toEqual([])
    })

    it('groups checkpoints under a shared error message', () => {
      const job = makeJob({
        failed_item_details: [
          { checkpoint_filename: 'b.safetensors', error_message: 'OOM' },
          { checkpoint_filename: 'a.safetensors', error_message: 'OOM' },
        ],
      } as Partial<SampleJob>)

      const groups = getGroupedErrors(job)

      expect(groups).toHaveLength(1)
      expect(groups[0].errorMessage).toBe('OOM')
      // Checkpoints are sorted for stable rendering.
      expect(groups[0].checkpoints).toEqual(['a.safetensors', 'b.safetensors'])
    })

    it('keeps distinct error messages in separate groups', () => {
      const job = makeJob({
        failed_item_details: [
          { checkpoint_filename: 'a', error_message: 'OOM' },
          { checkpoint_filename: 'b', error_message: 'timeout' },
        ],
      } as Partial<SampleJob>)

      expect(getGroupedErrors(job).map(g => g.errorMessage)).toEqual(['OOM', 'timeout'])
    })

    it('takes the traceback from the first detail of each message', () => {
      const job = makeJob({
        failed_item_details: [
          { checkpoint_filename: 'a', error_message: 'OOM', traceback: 'first-trace' },
          { checkpoint_filename: 'b', error_message: 'OOM', traceback: 'second-trace' },
        ],
      } as Partial<SampleJob>)

      expect(getGroupedErrors(job)[0].traceback).toBe('first-trace')
    })
  })
})
