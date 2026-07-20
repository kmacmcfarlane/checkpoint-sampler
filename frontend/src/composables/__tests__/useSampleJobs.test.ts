import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSampleJobs, JOBS_PAGE_SIZE } from '../useSampleJobs'
import type { SampleJob } from '../../api/types'

// Mock the api client — only the sample-job endpoints are exercised here.
vi.mock('../../api/client', () => ({
  apiClient: {
    listSampleJobsPage: vi.fn(),
    stopSampleJob: vi.fn(),
    resumeSampleJob: vi.fn(),
    retryFailedSampleJob: vi.fn(),
    deleteSampleJob: vi.fn(),
  },
}))
import { apiClient } from '../../api/client'

const mockListPage = apiClient.listSampleJobsPage as ReturnType<typeof vi.fn>
const mockStop = apiClient.stopSampleJob as ReturnType<typeof vi.fn>
const mockResume = apiClient.resumeSampleJob as ReturnType<typeof vi.fn>
const mockRetry = apiClient.retryFailedSampleJob as ReturnType<typeof vi.fn>
const mockDelete = apiClient.deleteSampleJob as ReturnType<typeof vi.fn>

function makeJob(id: string, overrides: Partial<SampleJob> = {}): SampleJob {
  return {
    id,
    training_run_name: 'run-a',
    study_id: 'study-1',
    study_name: 'Study 1',
    workflow_name: 'wf',
    status: 'pending',
    total_items: 10,
    completed_items: 0,
    failed_items: 0,
    pending_items: 10,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as SampleJob
}

/** Silences the console.warn calls the composable makes on non-fatal failures. */
let warnSpy: ReturnType<typeof vi.spyOn>

function setup(onActionError = vi.fn()) {
  return { jobs: useSampleJobs({ onActionError }), onActionError }
}

describe('useSampleJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  describe('fetchSampleJobs', () => {
    it('loads the first page and records the total', async () => {
      mockListPage.mockResolvedValue({ jobs: [makeJob('a')], total: 5 })
      const { jobs } = setup()

      await jobs.fetchSampleJobs()

      expect(mockListPage).toHaveBeenCalledWith(JOBS_PAGE_SIZE, 0)
      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['a'])
      expect(jobs.jobsTotal.value).toBe(5)
      expect(jobs.jobsLoading.value).toBe(false)
    })

    it('replaces (not appends to) the accumulated list on refresh', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a'), makeJob('b')], total: 2 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('c')], total: 1 })
      await jobs.fetchSampleJobs()

      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['c'])
      expect(jobs.jobsTotal.value).toBe(1)
    })

    it('resets to an empty list when the request fails', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 1 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      mockListPage.mockRejectedValueOnce(new Error('boom'))
      await jobs.fetchSampleJobs()

      expect(jobs.sampleJobs.value).toEqual([])
      expect(jobs.jobsTotal.value).toBe(0)
      expect(jobs.jobsLoading.value).toBe(false)
      expect(warnSpy).toHaveBeenCalled()
    })
  })

  describe('hasMoreJobs', () => {
    it('is true while fewer jobs are loaded than the reported total', async () => {
      mockListPage.mockResolvedValue({ jobs: [makeJob('a')], total: 3 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      expect(jobs.hasMoreJobs.value).toBe(true)
    })

    it('is false once the loaded count reaches the total', async () => {
      mockListPage.mockResolvedValue({ jobs: [makeJob('a'), makeJob('b')], total: 2 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      expect(jobs.hasMoreJobs.value).toBe(false)
    })
  })

  describe('loadMoreJobs', () => {
    it('appends the next page at an offset equal to the loaded count', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 2 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('b')], total: 2 })
      await jobs.loadMoreJobs()

      expect(mockListPage).toHaveBeenLastCalledWith(JOBS_PAGE_SIZE, 1)
      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['a', 'b'])
    })

    it('dedupes the one-row overlap that occurs when offsets shift mid-paging', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a'), makeJob('b')], total: 4 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      // Server returns 'b' again alongside genuinely new rows.
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('b'), makeJob('c')], total: 4 })
      await jobs.loadMoreJobs()

      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['a', 'b', 'c'])
    })

    it('is a no-op when everything is already loaded', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 1 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()
      mockListPage.mockClear()

      await jobs.loadMoreJobs()

      expect(mockListPage).not.toHaveBeenCalled()
    })

    it('does not double-fetch when a prefetch is already in flight', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 5 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      mockListPage.mockClear()
      let resolveSecond: (v: unknown) => void = () => {}
      mockListPage.mockReturnValueOnce(new Promise((res) => { resolveSecond = res }))

      const first = jobs.loadMoreJobs()
      // Second call while the first is still pending must be rejected by the guard.
      await jobs.loadMoreJobs()
      expect(mockListPage).toHaveBeenCalledTimes(1)

      resolveSecond({ jobs: [makeJob('b')], total: 5 })
      await first
    })

    it('keeps the accumulated list intact when the prefetch fails', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 5 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      mockListPage.mockRejectedValueOnce(new Error('nope'))
      await jobs.loadMoreJobs()

      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['a'])
      expect(jobs.jobsLoadingMore.value).toBe(false)
    })
  })

  describe('handleUnknownJob', () => {
    it('treats an empty list as an initial load', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 1 })
      const { jobs } = setup()

      await jobs.handleUnknownJob()

      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['a'])
      expect(jobs.jobsTotal.value).toBe(1)
    })

    it('PREPENDS brand-new jobs, preserving already-loaded older pages', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('b'), makeJob('c')], total: 2 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      // A new job appears at the head of page 1.
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('new'), makeJob('b')], total: 3 })
      await jobs.handleUnknownJob()

      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['new', 'b', 'c'])
      expect(jobs.jobsTotal.value).toBe(3)
    })

    it('does not duplicate jobs already present', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 1 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 1 })
      await jobs.handleUnknownJob()

      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['a'])
    })

    it('leaves the list untouched when the refresh fails', async () => {
      mockListPage.mockResolvedValueOnce({ jobs: [makeJob('a')], total: 1 })
      const { jobs } = setup()
      await jobs.fetchSampleJobs()

      mockListPage.mockRejectedValueOnce(new Error('down'))
      await jobs.handleUnknownJob()

      expect(jobs.sampleJobs.value.map(j => j.id)).toEqual(['a'])
    })
  })

  describe('lifecycle actions', () => {
    beforeEach(() => {
      mockListPage.mockResolvedValue({ jobs: [makeJob('a')], total: 1 })
    })

    it('stopJob clears stoppingJobId and refreshes on success', async () => {
      mockStop.mockResolvedValue(undefined)
      const { jobs } = setup()

      await jobs.stopJob('a')

      expect(mockStop).toHaveBeenCalledWith('a')
      expect(mockListPage).toHaveBeenCalled()
      expect(jobs.stoppingJobId.value).toBeNull()
    })

    it('stopJob clears stoppingJobId and reports an error on failure', async () => {
      mockStop.mockRejectedValue(new Error('nope'))
      const { jobs, onActionError } = setup()

      await jobs.stopJob('a')

      expect(jobs.stoppingJobId.value).toBeNull()
      expect(onActionError).toHaveBeenCalledWith('Failed to stop sample job. Please try again.')
    })

    it('resumeJob refreshes on success and reports on failure', async () => {
      mockResume.mockResolvedValueOnce(undefined)
      const { jobs, onActionError } = setup()
      await jobs.resumeJob('a')
      expect(mockListPage).toHaveBeenCalled()
      expect(onActionError).not.toHaveBeenCalled()

      mockResume.mockRejectedValueOnce(new Error('nope'))
      await jobs.resumeJob('a')
      expect(onActionError).toHaveBeenCalledWith('Failed to resume sample job. Please try again.')
    })

    it('retryFailedJob reports a retry-specific message on failure', async () => {
      mockRetry.mockRejectedValue(new Error('nope'))
      const { jobs, onActionError } = setup()

      await jobs.retryFailedJob('a')

      expect(onActionError).toHaveBeenCalledWith('Failed to retry failed job items. Please try again.')
    })

    it('deleteJob forwards the deleteData flag and refreshes on success', async () => {
      mockDelete.mockResolvedValue(undefined)
      const { jobs } = setup()

      await jobs.deleteJob('a', true)

      expect(mockDelete).toHaveBeenCalledWith('a', true)
      expect(mockListPage).toHaveBeenCalled()
    })

    it('deleteJob reports a delete-specific message on failure', async () => {
      mockDelete.mockRejectedValue(new Error('nope'))
      const { jobs, onActionError } = setup()

      await jobs.deleteJob('a', false)

      expect(onActionError).toHaveBeenCalledWith('Failed to delete sample job. Please try again.')
    })
  })
})
