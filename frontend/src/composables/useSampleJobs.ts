import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { SampleJob } from '../api/types'
import { apiClient } from '../api/client'

/**
 * Page size for the sample-job list.
 *
 * Intentionally larger than fits on screen so the first page fills the viewport
 * with a buffer, giving the prefetch observer room to load ahead invisibly.
 */
export const JOBS_PAGE_SIZE = 50

/**
 * Dependencies the composable needs from the host component (App.vue).
 *
 * Only the user-facing error channel is injected: the toast API is owned by the
 * root component (it needs the Naive UI message provider), while every piece of
 * job-list state below is owned by this composable.
 */
export interface UseSampleJobsOptions {
  /** Surfaces a user-facing error toast when a job lifecycle action fails. */
  onActionError: (message: string) => void
}

export interface UseSampleJobs {
  /** The accumulated job list, newest first (created_at DESC, per server order). */
  sampleJobs: Ref<SampleJob[]>
  /** True while the first page is being (re)fetched. */
  jobsLoading: Ref<boolean>
  /** True while an additional (older) page is being prefetched. */
  jobsLoadingMore: Ref<boolean>
  /** Total job count across all pages, from the paginated response. */
  jobsTotal: Ref<number>
  /** Whether more (older) jobs exist beyond what is currently loaded. */
  hasMoreJobs: ComputedRef<boolean>
  /** The ID of the job currently being stopped, or null when no stop is in progress. */
  stoppingJobId: Ref<string | null>
  /** Fetch the first page, replacing the accumulated list. */
  fetchSampleJobs: () => Promise<void>
  /** Prefetch and append the next page of older jobs (deduped by id). */
  loadMoreJobs: () => Promise<void>
  /** Refresh after a job_progress event referenced an unknown job (prepends new jobs). */
  handleUnknownJob: () => Promise<void>
  /** Stop a running job, then refresh the list. */
  stopJob: (jobId: string) => Promise<void>
  /** Resume a stopped job, then refresh the list. */
  resumeJob: (jobId: string) => Promise<void>
  /** Retry failed items in a completed_with_errors job, then refresh the list. */
  retryFailedJob: (jobId: string) => Promise<void>
  /** Delete a job (optionally its sample data), then refresh the list. */
  deleteJob: (jobId: string, deleteData: boolean) => Promise<void>
}

/**
 * Owns the paginated sample-job list and the job lifecycle actions that mutate
 * it. Extracted from App.vue (R-021) following the useJobProgress pattern, so
 * the S-170 pagination invariants below are encoded and unit-testable in one
 * place instead of inline in the root component.
 *
 * Invariants preserved verbatim from the original App.vue implementation:
 *
 *  - loadMoreJobs is a no-op while another prefetch is in flight or when
 *    everything is already loaded, so a burst of observer callbacks cannot
 *    double-fetch the same offset.
 *  - Appending pages dedupes by id: because created_at ordering is stable,
 *    appending never drops or reorders already-loaded jobs, and the dedupe
 *    absorbs the one-row overlap that occurs when a brand-new job shifts
 *    server offsets mid-paging.
 *  - handleUnknownJob PREPENDS only genuinely new jobs rather than resetting to
 *    page 1, so already-loaded older pages and the user's scroll position
 *    survive a job starting while they are scrolled down. When nothing is
 *    loaded yet it degrades to an initial load.
 *  - Fetch failures are non-fatal and logged via console.warn: the initial fetch
 *    resets to an empty list, while prefetch/unknown-job failures leave the
 *    accumulated list untouched so a transient error cannot blank the panel.
 *  - Lifecycle actions (stop/resume/retry/delete) always re-fetch on success and
 *    surface a toast on failure; stoppingJobId is cleared in a finally block so
 *    the Stop button never gets stuck in its loading state.
 *
 * Known accepted edge case (unchanged): if a job BELOW the currently loaded
 * window is deleted between two page fetches, the offset-based seam can skip a
 * single job at the page boundary. This is rare (deletion is manual) and
 * self-heals on the next full refresh, so it is not tracked with a server cursor.
 */
export function useSampleJobs(options: UseSampleJobsOptions): UseSampleJobs {
  const { onActionError } = options

  const sampleJobs = ref<SampleJob[]>([])
  const jobsLoading = ref(false)
  const jobsLoadingMore = ref(false)
  const jobsTotal = ref(0)
  const stoppingJobId = ref<string | null>(null)

  const hasMoreJobs = computed(() => sampleJobs.value.length < jobsTotal.value)

  async function fetchSampleJobs(): Promise<void> {
    jobsLoading.value = true
    try {
      const page = await apiClient.listSampleJobsPage(JOBS_PAGE_SIZE, 0)
      sampleJobs.value = page.jobs
      jobsTotal.value = page.total
    } catch (err: unknown) {
      console.warn('Failed to fetch sample jobs:', err)
      sampleJobs.value = []
      jobsTotal.value = 0
    } finally {
      jobsLoading.value = false
    }
  }

  async function loadMoreJobs(): Promise<void> {
    if (jobsLoadingMore.value || !hasMoreJobs.value) return
    jobsLoadingMore.value = true
    try {
      const page = await apiClient.listSampleJobsPage(JOBS_PAGE_SIZE, sampleJobs.value.length)
      const existingIds = new Set(sampleJobs.value.map(j => j.id))
      const newJobs = page.jobs.filter(j => !existingIds.has(j.id))
      if (newJobs.length > 0) {
        sampleJobs.value = [...sampleJobs.value, ...newJobs]
      }
      jobsTotal.value = page.total
    } catch (err: unknown) {
      console.warn('Failed to load more sample jobs:', err)
    } finally {
      jobsLoadingMore.value = false
    }
  }

  async function handleUnknownJob(): Promise<void> {
    try {
      const page = await apiClient.listSampleJobsPage(JOBS_PAGE_SIZE, 0)
      if (sampleJobs.value.length === 0) {
        // Nothing loaded yet (panel never opened): treat as an initial load.
        sampleJobs.value = page.jobs
        jobsTotal.value = page.total
        return
      }
      const existingIds = new Set(sampleJobs.value.map(j => j.id))
      const brandNew = page.jobs.filter(j => !existingIds.has(j.id))
      if (brandNew.length > 0) {
        sampleJobs.value = [...brandNew, ...sampleJobs.value]
      }
      jobsTotal.value = page.total
    } catch (err: unknown) {
      console.warn('Failed to refresh sample jobs for new job:', err)
    }
  }

  async function stopJob(jobId: string): Promise<void> {
    stoppingJobId.value = jobId
    try {
      await apiClient.stopSampleJob(jobId)
      await fetchSampleJobs()
    } catch (err: unknown) {
      console.warn('Failed to stop sample job:', err)
      onActionError('Failed to stop sample job. Please try again.')
    } finally {
      stoppingJobId.value = null
    }
  }

  async function resumeJob(jobId: string): Promise<void> {
    try {
      await apiClient.resumeSampleJob(jobId)
      await fetchSampleJobs()
    } catch (err: unknown) {
      console.warn('Failed to resume sample job:', err)
      onActionError('Failed to resume sample job. Please try again.')
    }
  }

  async function retryFailedJob(jobId: string): Promise<void> {
    try {
      await apiClient.retryFailedSampleJob(jobId)
      await fetchSampleJobs()
    } catch (err: unknown) {
      console.warn('Failed to retry failed job items:', err)
      onActionError('Failed to retry failed job items. Please try again.')
    }
  }

  async function deleteJob(jobId: string, deleteData: boolean): Promise<void> {
    try {
      await apiClient.deleteSampleJob(jobId, deleteData)
      await fetchSampleJobs()
    } catch (err: unknown) {
      console.warn('Failed to delete sample job:', err)
      onActionError('Failed to delete sample job. Please try again.')
    }
  }

  return {
    sampleJobs,
    jobsLoading,
    jobsLoadingMore,
    jobsTotal,
    hasMoreJobs,
    stoppingJobId,
    fetchSampleJobs,
    loadMoreJobs,
    handleUnknownJob,
    stopJob,
    resumeJob,
    retryFailedJob,
    deleteJob,
  }
}
