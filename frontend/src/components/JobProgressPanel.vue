<script setup lang="ts">
import { computed, ref, toRef, watch, nextTick } from 'vue'
import { NModal, NButton, NSpace, NEmpty, NSpin } from 'naive-ui'
import type { SampleJob } from '../api/types'
import type { JobProgressEntry, InferenceProgressEntry } from '../composables/useJobProgress'
import { apiClient } from '../api/client'
import ConfirmDeleteDialog from './ConfirmDeleteDialog.vue'
import ValidationResultsDialog from './ValidationResultsDialog.vue'
import JobProgressItem from './JobProgressItem.vue'
import { useJobEtaCountdowns } from '../composables/useCountdown'
import { useJobRuntimes } from '../composables/useJobRuntime'
import { useLazyLoadObserver } from '../composables/useLazyLoadObserver'
import { useValidationDialog } from '../composables/useValidationDialog'
import { formatElapsedDuration } from '../lib/durationFormat'
import { formatDuration } from '../lib/jobFormat'

const props = defineProps<{
  show: boolean
  jobs: SampleJob[]
  /** Checkpoint-level progress keyed by job ID. */
  jobProgress?: Record<string, JobProgressEntry>
  /** Per-sample inference progress keyed by job ID. Reset between samples. */
  inferenceProgress?: Record<string, InferenceProgressEntry>
  loading?: boolean
  /** S-170: true while an additional (older) page of jobs is being prefetched. */
  loadingMore?: boolean
  /** S-170: true when more (older) jobs exist beyond what is currently loaded. */
  hasMore?: boolean
  /** The ID of the job currently being stopped, or null. Used to show loading state on the stop button. */
  stoppingJobId?: string | null
  /** When set, auto-scrolls to this job and expands its error details. Set by parent when navigating from a failed bead. */
  scrollToJobId?: string | null
}>()

// stop: Emitted when the user clicks Stop on a running job. Payload: the job ID string.
// resume: Emitted when the user clicks Resume on a stopped job. Payload: the job ID string.
// retryFailed: Emitted when the user clicks Retry failed on a completed_with_errors job. Payload: the job ID string.
// regenerate: Emitted when the user clicks Regenerate on a completed or completed_with_errors job. Payload: the full SampleJob object.
// delete: Emitted when the user confirms deletion. Payload: { id: string, deleteData: boolean }.
// refresh: Emitted when the user clicks the Refresh button. No payload.
// loadMore: Emitted when the user scrolls near the bottom and more jobs should be prefetched. No payload.
// close: Emitted when the modal is dismissed. No payload.
const emit = defineEmits<{
  stop: [jobId: string]
  resume: [jobId: string]
  retryFailed: [jobId: string]
  regenerate: [job: SampleJob]
  /** Emitted when the user clicks Regenerate inside the validation dialog. Signals that
   *  "Generate missing samples only" should be pre-checked in the launch dialog. */
  validateRegenerate: [job: SampleJob]
  delete: [id: string, deleteData: boolean]
  refresh: []
  loadMore: []
  close: []
}>()

/**
 * S-170: prefetch-ahead lazy loading (extracted to useLazyLoadObserver, R-021).
 * scrollContainer is the observer root so it works inside the modal's internal
 * scroll region; loadMoreSentinel sits at the bottom of the list.
 */
const { scrollContainer, loadMoreSentinel } = useLazyLoadObserver({
  active: toRef(props, 'show'),
  hasMore: () => props.hasMore ?? false,
  isLoading: () => props.loadingMore ?? false,
  onLoadMore: () => emit('loadMore'),
})

/**
 * State for the per-job validation dialog (extracted to useValidationDialog, R-021).
 * validationDialogJob is kept locally because it also supplies the dialog title
 * and the payload for the validateRegenerate emit.
 */
const {
  show: validationDialogShow,
  result: validationDialogResult,
  error: validationDialogError,
  loading: validationDialogLoading,
  run: runValidation,
} = useValidationDialog()
const validationDialogJob = ref<SampleJob | null>(null)

/** Open the validation dialog for a specific job. */
async function handleValidate(job: SampleJob) {
  validationDialogJob.value = job
  await runValidation(async () => {
    // Look up the training run ID from the checkpoint source
    const runs = await apiClient.getCheckpointTrainingRuns()
    const run = runs.find(r => r.name === job.training_run_name)
    if (!run) {
      // Abort: surface the lookup failure instead of a validation result.
      validationDialogError.value = `Training run "${job.training_run_name}" not found`
      return null
    }
    return await apiClient.validateTrainingRun(run.id, job.study_id)
  })
}

/** Re-run validation for the current dialog job without closing the dialog. */
async function handleValidationRefresh() {
  if (!validationDialogJob.value) return
  await handleValidate(validationDialogJob.value)
}

/** Handle Regenerate from the validation dialog: close dialog and emit validateRegenerate (AC4-6: S-117). */
function handleValidationRegenerate(job: SampleJob) {
  validationDialogShow.value = false
  emit('validateRegenerate', job)
}

// AC1: Interpolate ETA countdown between WebSocket events using setInterval.
// AC2: Countdown resets when a new ETA value arrives from WebSocket.
// AC3: Timers are cleaned up on component unmount (handled inside useJobEtaCountdowns).
const { getDisplaySampleEta, getDisplayJobEta } = useJobEtaCountdowns(toRef(props, 'jobProgress'))

// AC: FE: each job row shows a total-runtime value, live-ticking while running,
// fixed total (updated_at - created_at) once terminal (S-159).
const { getRuntimeSeconds } = useJobRuntimes(toRef(props, 'jobs'))

/** Get the formatted total-runtime string for a job. */
function getJobRuntime(job: SampleJob): string {
  return formatElapsedDuration(getRuntimeSeconds(job))
}

/** Get the per-sample ETA string for a job, or undefined if not available.
 *  Uses countdown-interpolated value for smooth UX between WebSocket events. */
function getSampleETA(jobId: string): string | undefined {
  const seconds = getDisplaySampleEta(jobId)
  if (seconds === undefined || seconds <= 0) return undefined
  return formatDuration(seconds)
}

/** Get the per-job ETA string for a job, or undefined if not available.
 *  Uses countdown-interpolated value for smooth UX between WebSocket events. */
function getJobETA(jobId: string): string | undefined {
  const seconds = getDisplayJobEta(jobId)
  if (seconds === undefined || seconds <= 0) return undefined
  return formatDuration(seconds)
}

const sortedJobs = computed(() => {
  return [...props.jobs].sort((a, b) => {
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
})

/** Ref to the sentinel element at the top of the job list. Used for auto-scroll on reorder. */
const listTopSentinel = ref<HTMLElement | null>(null)

/**
 * AC (UAT feedback): When a job reorders to the top of the list due to
 * updated_at sort, auto-scroll so the new top item is visible.
 *
 * We watch for changes in the first job's ID. On the initial render
 * (previousTopId is null) we do not scroll — only react to subsequent
 * reorders while the panel is open.
 */
let previousTopId: string | null = null
watch(
  () => sortedJobs.value[0]?.id,
  (newTopId) => {
    if (newTopId === undefined) {
      previousTopId = null
      return
    }
    if (previousTopId !== null && newTopId !== previousTopId && listTopSentinel.value) {
      listTopSentinel.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    previousTopId = newTopId
  },
)

// Reset previousTopId whenever the panel is hidden so that reopening the panel
// does not trigger a spurious scroll for whatever job happens to be first.
watch(
  () => props.show,
  (show) => {
    if (!show) {
      previousTopId = null
    }
  },
)

/**
 * AC: When scrollToJobId changes to a valid job ID, expand its error section and scroll to it.
 * This enables navigation from the failed checkpoint bead in the Generate Samples dialog.
 */
watch(
  () => props.scrollToJobId,
  async (jobId) => {
    if (!jobId || !props.show) return
    // Expand the error section for this job
    expandedErrors.value = {
      ...expandedErrors.value,
      [jobId]: true,
    }
    // Wait for DOM to update with the expanded error section
    await nextTick()
    // Scroll to the job card
    const jobElement = document.querySelector(`[data-testid="job-${jobId}"]`)
    if (jobElement) {
      jobElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  },
)

/** Map of job IDs to whether their parameters panel is expanded. */
const expandedParams = ref<Record<string, boolean>>({})

function toggleParams(jobId: string) {
  expandedParams.value = {
    ...expandedParams.value,
    [jobId]: !expandedParams.value[jobId],
  }
}

function isParamsExpanded(jobId: string): boolean {
  return expandedParams.value[jobId] ?? false
}

/** Map of job IDs to whether their error section is expanded. */
const expandedErrors = ref<Record<string, boolean>>({})

function toggleErrorSection(jobId: string) {
  expandedErrors.value = {
    ...expandedErrors.value,
    [jobId]: !expandedErrors.value[jobId],
  }
}

function isErrorExpanded(jobId: string): boolean {
  return expandedErrors.value[jobId] ?? false
}

/** Map of "jobId:errorIdx" to whether the traceback is expanded. */
const expandedTracebacks = ref<Record<string, boolean>>({})

function toggleTraceback(jobId: string, errorIdx: number) {
  const key = `${jobId}:${errorIdx}`
  expandedTracebacks.value = {
    ...expandedTracebacks.value,
    [key]: !expandedTracebacks.value[key],
  }
}

/**
 * The expanded-traceback flags for one job, re-keyed by error index so the item
 * component does not need to know about the composite "jobId:errorIdx" key.
 */
function tracebacksForJob(jobId: string): Record<number, boolean> {
  const result: Record<number, boolean> = {}
  const prefix = `${jobId}:`
  for (const [key, value] of Object.entries(expandedTracebacks.value)) {
    if (key.startsWith(prefix)) {
      result[Number(key.slice(prefix.length))] = value
    }
  }
  return result
}

/** The ID of the job pending deletion confirmation, or null when the dialog is closed. */
const pendingDeleteJobId = ref<string | null>(null)
/** Whether the delete confirmation dialog is visible. */
const showDeleteDialog = ref(false)

function handleDeleteClick(jobId: string) {
  pendingDeleteJobId.value = jobId
  showDeleteDialog.value = true
}

function handleDeleteConfirm(deleteData: boolean) {
  if (pendingDeleteJobId.value !== null) {
    emit('delete', pendingDeleteJobId.value, deleteData)
  }
  showDeleteDialog.value = false
  pendingDeleteJobId.value = null
}

function handleDeleteCancel() {
  showDeleteDialog.value = false
  pendingDeleteJobId.value = null
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Sample Jobs"
    style="max-width: 700px;"
    data-testid="job-progress-panel"
    @update:show="emit('close')"
  >
    <template #header-extra>
      <NButton
        size="small"
        :loading="loading"
        @click="emit('refresh')"
      >
        Refresh
      </NButton>
    </template>

    <!-- S-170: dedicated scroll container so the prefetch IntersectionObserver has
         a stable root inside the modal. The header stays fixed; only the list scrolls. -->
    <div ref="scrollContainer" class="jobs-scroll" data-testid="jobs-scroll-container">
    <NSpin :show="loading ?? false">
      <div v-if="sortedJobs.length === 0" class="empty-state">
        <NEmpty description="No sample jobs yet" />
      </div>

      <NSpace v-else vertical :size="12">
        <!-- Sentinel element: scrollIntoView target when job list reorders (UAT feedback B-133) -->
        <div ref="listTopSentinel" data-testid="job-list-top-sentinel" style="height: 0; overflow: hidden;" aria-hidden="true" />
        <JobProgressItem
          v-for="job in sortedJobs"
          :key="job.id"
          :job="job"
          :progress="jobProgress?.[job.id]"
          :inference-progress="inferenceProgress?.[job.id]"
          :stopping="stoppingJobId === job.id"
          :params-expanded="isParamsExpanded(job.id)"
          :error-expanded="isErrorExpanded(job.id)"
          :expanded-tracebacks="tracebacksForJob(job.id)"
          :runtime="getJobRuntime(job)"
          :sample-eta="getSampleETA(job.id)"
          :job-eta="getJobETA(job.id)"
          @toggle-params="toggleParams(job.id)"
          @toggle-errors="toggleErrorSection(job.id)"
          @toggle-traceback="(idx: number) => toggleTraceback(job.id, idx)"
          @stop="emit('stop', $event)"
          @resume="emit('resume', $event)"
          @retry-failed="emit('retryFailed', $event)"
          @regenerate="emit('regenerate', $event)"
          @validate="handleValidate"
          @delete="handleDeleteClick"
        />
      </NSpace>
    </NSpin>

      <!-- S-170: sentinel observed by the IntersectionObserver to prefetch older
           pages ahead of the scroll position (invisible lazy loading). -->
      <div
        ref="loadMoreSentinel"
        data-testid="job-list-load-more-sentinel"
        aria-hidden="true"
        style="height: 1px;"
      />
      <div
        v-if="loadingMore"
        class="jobs-loading-more"
        data-testid="jobs-loading-more"
      >
        <NSpin :size="18" />
      </div>
    </div>
  </NModal>

  <ConfirmDeleteDialog
    :show="showDeleteDialog"
    data-testid="delete-job-dialog"
    title="Delete Sample Job"
    description="Are you sure you want to delete this sample job? This action cannot be undone."
    checkbox-label="Also delete sample data"
    :checkbox-checked="false"
    @update:show="(val) => { if (!val) handleDeleteCancel() }"
    @confirm="handleDeleteConfirm"
    @cancel="handleDeleteCancel"
  />

  <!-- AC: FE: Validation results dialog for per-job validation -->
  <ValidationResultsDialog
    :show="validationDialogShow"
    :result="validationDialogResult"
    :error="validationDialogError"
    :loading="validationDialogLoading"
    :job="validationDialogJob"
    :title="validationDialogJob ? `Validation: ${validationDialogJob.training_run_name}` : 'Validation Results'"
    @close="validationDialogShow = false"
    @refresh="handleValidationRefresh"
    @regenerate="handleValidationRegenerate"
  />
</template>

<style scoped>
/* S-170: internal scroll region for the job list so the prefetch observer has a
   stable root and the modal header stays fixed while the list scrolls. */
.jobs-scroll {
  max-height: 70vh;
  overflow-y: auto;
}

.jobs-loading-more {
  display: flex;
  justify-content: center;
  padding: 0.75rem 0;
}

.empty-state {
  padding: 2rem;
  text-align: center;
}
</style>
