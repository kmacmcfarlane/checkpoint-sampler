<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { NModal, NButton, NTag, NProgress, NSpace, NEmpty, NSpin } from 'naive-ui'
import type { SampleJob, SampleJobStatus, CurrentSampleParams, ValidationResult } from '../api/types'
import { apiClient } from '../api/client'
import ConfirmDeleteDialog from './ConfirmDeleteDialog.vue'
import ValidationResultsDialog from './ValidationResultsDialog.vue'
import { useJobEtaCountdowns } from '../composables/useCountdown'

/** Completeness verification result for a single checkpoint. */
interface CompletenessEntry {
  checkpoint: string
  expected: number
  verified: number
  missing: number
}

/** Per-sample inference progress from ComfyUI node-level events. */
interface InferenceProgress {
  current_value: number
  max_value: number
}

const props = defineProps<{
  show: boolean
  jobs: SampleJob[]
  jobProgress?: Record<string, {
    checkpoints_completed: number
    total_checkpoints: number
    current_checkpoint?: string
    current_checkpoint_progress?: number
    current_checkpoint_total?: number
    checkpoint_completeness?: CompletenessEntry[]
    /** Estimated seconds remaining for the current sample. */
    sample_eta_seconds?: number
    /** Estimated seconds remaining for the entire job. */
    job_eta_seconds?: number
    /** Generation parameters for the currently generating sample. */
    current_sample_params?: CurrentSampleParams
  }>
  /** Per-sample inference progress keyed by job ID. Reset between samples. */
  inferenceProgress?: Record<string, InferenceProgress>
  loading?: boolean
  /** The ID of the job currently being stopped, or null. Used to show loading state on the stop button. */
  stoppingJobId?: string | null
}>()

// stop: Emitted when the user clicks Stop on a running job. Payload: the job ID string.
// resume: Emitted when the user clicks Resume on a stopped job. Payload: the job ID string.
// retryFailed: Emitted when the user clicks Retry failed on a completed_with_errors job. Payload: the job ID string.
// regenerate: Emitted when the user clicks Regenerate on a completed or completed_with_errors job. Payload: the full SampleJob object.
// delete: Emitted when the user confirms deletion. Payload: { id: string, deleteData: boolean }.
// refresh: Emitted when the user clicks the Refresh button. No payload.
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
  close: []
}>()

/** State for the per-job validation dialog. */
const validationDialogShow = ref(false)
const validationDialogJob = ref<SampleJob | null>(null)
const validationDialogResult = ref<ValidationResult | null>(null)
const validationDialogError = ref<string | null>(null)
const validationDialogLoading = ref(false)

/** Open the validation dialog for a specific job. */
async function handleValidate(job: SampleJob) {
  validationDialogJob.value = job
  validationDialogResult.value = null
  validationDialogError.value = null
  validationDialogLoading.value = true
  validationDialogShow.value = true

  try {
    // Look up the training run ID from the checkpoint source
    const runs = await apiClient.getCheckpointTrainingRuns()
    const run = runs.find(r => r.name === job.training_run_name)
    if (!run) {
      validationDialogError.value = `Training run "${job.training_run_name}" not found`
      return
    }
    const result = await apiClient.validateTrainingRun(run.id, job.study_id)
    validationDialogResult.value = result
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Validation failed'
    validationDialogError.value = message
  } finally {
    validationDialogLoading.value = false
  }
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

const sortedJobs = computed(() => {
  return [...props.jobs].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
})

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

function toggleErrorSection(jobId: string) {
  expandedErrors.value = {
    ...expandedErrors.value,
    [jobId]: !expandedErrors.value[jobId],
  }
}

function isErrorExpanded(jobId: string): boolean {
  return expandedErrors.value[jobId] ?? false
}

function getStatusType(status: SampleJobStatus): 'success' | 'error' | 'warning' | 'info' | 'default' {
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

function getStatusLabel(status: SampleJobStatus): string {
  if (status === 'completed_with_errors') return 'completed with errors'
  return status
}

function getProgressPercentage(job: SampleJob): number {
  if (job.total_items === 0) return 0
  return Math.round((job.completed_items / job.total_items) * 100)
}

function getProgressStatus(job: SampleJob): 'error' | 'success' | 'warning' | 'default' {
  if (job.status === 'failed') return 'error'
  if (job.status === 'completed_with_errors') return 'warning'
  if (job.status === 'completed') return 'success'
  return 'default'
}

function canStop(job: SampleJob): boolean {
  return job.status === 'running'
}

function canResume(job: SampleJob): boolean {
  return job.status === 'stopped'
}

function canRegenerate(job: SampleJob): boolean {
  return job.status === 'completed' || job.status === 'completed_with_errors'
}

function canRetryFailed(job: SampleJob): boolean {
  return job.status === 'completed_with_errors'
}

// AC: FE: Delete button is hidden when job status is running
function canDelete(job: SampleJob): boolean {
  return job.status !== 'running'
}

function handleStop(jobId: string) {
  emit('stop', jobId)
}

function handleResume(jobId: string) {
  emit('resume', jobId)
}

function handleRetryFailed(jobId: string) {
  emit('retryFailed', jobId)
}

function handleRegenerate(job: SampleJob) {
  emit('regenerate', job)
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

/**
 * Format a duration in seconds to a human-readable string.
 * Examples: "5s", "2m 30s", "1h 15m", "2h 0m"
 */
function formatDuration(seconds: number): string {
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

function getJobProgress(jobId: string) {
  return props.jobProgress?.[jobId]
}

function getInferenceProgress(jobId: string): InferenceProgress | undefined {
  return props.inferenceProgress?.[jobId]
}

function hasInferenceProgress(jobId: string): boolean {
  const progress = getInferenceProgress(jobId)
  return progress !== undefined && progress.max_value > 0
}

function getInferencePercentage(jobId: string): number {
  const progress = getInferenceProgress(jobId)
  if (!progress || progress.max_value === 0) return 0
  return Math.round((progress.current_value / progress.max_value) * 100)
}

function hasCheckpointProgress(jobId: string): boolean {
  const progress = getJobProgress(jobId)
  return progress !== undefined && progress.total_checkpoints > 0
}

/** Get completeness entries for a job, sorted by checkpoint name. */
function getCompletenessEntries(jobId: string): CompletenessEntry[] {
  const progress = getJobProgress(jobId)
  if (!progress?.checkpoint_completeness || progress.checkpoint_completeness.length === 0) {
    return []
  }
  return [...progress.checkpoint_completeness].sort((a, b) => a.checkpoint.localeCompare(b.checkpoint))
}

/** Format a completeness entry for display, e.g. '24/24 verified' or '23/24 -- 1 missing'. */
function formatCompleteness(entry: CompletenessEntry): string {
  if (entry.missing === 0) {
    return `${entry.verified}/${entry.expected} verified`
  }
  return `${entry.verified}/${entry.expected} -- ${entry.missing} missing`
}

/** Whether a job has any failed items. */
function hasFailedItems(job: SampleJob): boolean {
  return (job.failed_items ?? 0) > 0
}

/** Grouped error info including optional traceback. */
interface GroupedError {
  errorMessage: string
  checkpoints: string[]
  traceback?: string
}

/**
 * Group failed item details by error message.
 * Returns an array of { errorMessage, checkpoints, traceback } objects.
 */
function getGroupedErrors(job: SampleJob): GroupedError[] {
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

/** Get current sample params for a job, or undefined if not available. */
function getCurrentSampleParams(jobId: string): CurrentSampleParams | undefined {
  return props.jobProgress?.[jobId]?.current_sample_params
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

function isTracebackExpanded(jobId: string, errorIdx: number): boolean {
  return expandedTracebacks.value[`${jobId}:${errorIdx}`] ?? false
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Sample Jobs"
    style="max-width: 700px; max-height: 80vh; overflow-y: auto;"
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

    <NSpin :show="loading ?? false">
      <div v-if="sortedJobs.length === 0" class="empty-state">
        <NEmpty description="No sample jobs yet" />
      </div>

      <NSpace v-else vertical :size="12">
        <div
          v-for="job in sortedJobs"
          :key="job.id"
          class="job-item"
          :data-testid="`job-${job.id}`"
        >
          <div class="job-header">
            <div class="job-title">
              <button
                class="job-title-btn"
                :data-testid="`job-${job.id}-title`"
                :aria-expanded="isParamsExpanded(job.id)"
                @click="toggleParams(job.id)"
              >
                <strong>{{ job.training_run_name }}</strong>
              </button>
              <NTag
                :type="getStatusType(job.status)"
                size="small"
                :data-testid="`job-${job.id}-status`"
              >
                {{ getStatusLabel(job.status) }}
              </NTag>
            </div>
            <div class="job-actions">
              <NButton
                v-if="canStop(job)"
                size="tiny"
                type="warning"
                :loading="stoppingJobId === job.id"
                :data-testid="`job-${job.id}-stop`"
                @click="handleStop(job.id)"
              >
                Stop
              </NButton>
              <NButton
                v-if="canResume(job)"
                size="tiny"
                type="primary"
                :data-testid="`job-${job.id}-resume`"
                @click="handleResume(job.id)"
              >
                Resume
              </NButton>
              <NButton
                v-if="canRetryFailed(job)"
                size="tiny"
                type="warning"
                :data-testid="`job-${job.id}-retry-failed`"
                @click="handleRetryFailed(job.id)"
              >
                Retry failed
              </NButton>
              <NButton
                v-if="canRegenerate(job)"
                size="tiny"
                type="info"
                :data-testid="`job-${job.id}-regenerate`"
                @click="handleRegenerate(job)"
              >
                Regenerate
              </NButton>
              <!-- AC: FE: Validate button on each job in job list -->
              <NButton
                size="tiny"
                :data-testid="`job-${job.id}-validate`"
                @click="handleValidate(job)"
              >
                Validate
              </NButton>
              <NButton
                v-if="canDelete(job)"
                size="tiny"
                type="error"
                :data-testid="`job-${job.id}-delete`"
                @click="handleDeleteClick(job.id)"
              >
                Delete
              </NButton>
            </div>
          </div>

          <!-- AC: FE: Clicking a job card title opens a detail view showing all job parameters -->
          <div
            v-if="isParamsExpanded(job.id)"
            class="job-params-panel"
            :data-testid="`job-${job.id}-params`"
          >
            <div class="job-params-header">
              <span class="job-params-title">Job Parameters</span>
              <button
                class="job-params-close"
                :data-testid="`job-${job.id}-params-close`"
                aria-label="Close parameters"
                @click="toggleParams(job.id)"
              >
                &times;
              </button>
            </div>
            <!-- AC: FE: Parameters include training run, workflow, preset name, VAE, CLIP, shift, and checkpoint list -->
            <dl class="job-params-list">
              <div class="job-params-row">
                <dt class="job-params-label">Training Run</dt>
                <dd class="job-params-value" :data-testid="`job-${job.id}-param-training-run`">{{ job.training_run_name }}</dd>
              </div>
              <div class="job-params-row">
                <dt class="job-params-label">Workflow</dt>
                <dd class="job-params-value" :data-testid="`job-${job.id}-param-workflow`">{{ job.workflow_name }}</dd>
              </div>
              <div class="job-params-row">
                <dt class="job-params-label">Study (Preset)</dt>
                <dd class="job-params-value" :data-testid="`job-${job.id}-param-study`">{{ job.study_name }}</dd>
              </div>
              <div class="job-params-row">
                <dt class="job-params-label">VAE</dt>
                <dd class="job-params-value" :data-testid="`job-${job.id}-param-vae`">{{ job.vae || '—' }}</dd>
              </div>
              <div class="job-params-row">
                <dt class="job-params-label">CLIP</dt>
                <dd class="job-params-value" :data-testid="`job-${job.id}-param-clip`">{{ job.clip || '—' }}</dd>
              </div>
              <div class="job-params-row" v-if="job.shift !== undefined">
                <dt class="job-params-label">Shift</dt>
                <dd class="job-params-value" :data-testid="`job-${job.id}-param-shift`">{{ job.shift }}</dd>
              </div>
              <div class="job-params-row">
                <dt class="job-params-label">Checkpoints</dt>
                <dd class="job-params-value" :data-testid="`job-${job.id}-param-checkpoints`">
                  <template v-if="job.checkpoint_filenames && job.checkpoint_filenames.length > 0">
                    <ul class="checkpoint-filenames-list" :data-testid="`job-${job.id}-param-checkpoint-list`">
                      <li
                        v-for="filename in job.checkpoint_filenames"
                        :key="filename"
                        class="checkpoint-filename-item"
                        :data-testid="`job-${job.id}-param-checkpoint-filename`"
                      >{{ filename }}</li>
                    </ul>
                  </template>
                  <template v-else>
                    {{ hasCheckpointProgress(job.id) ? getJobProgress(job.id)?.total_checkpoints : job.total_items }} total
                  </template>
                </dd>
              </div>
            </dl>
          </div>

          <div class="job-details">
            <p class="job-meta">
              <span>Study: {{ job.study_name }}</span>
              <span class="separator">•</span>
              <span>Workflow: {{ job.workflow_name }}</span>
              <span class="separator">•</span>
              <span>Created: {{ formatTimestamp(job.created_at) }}</span>
            </p>

            <div class="job-progress">
              <div v-if="hasCheckpointProgress(job.id)" class="progress-details">
                <p class="progress-line">
                  <span class="progress-label">Checkpoints:</span>
                  <span>{{ getJobProgress(job.id)?.checkpoints_completed }} / {{ getJobProgress(job.id)?.total_checkpoints }}</span>
                </p>
                <p v-if="getJobProgress(job.id)?.current_checkpoint" class="progress-line">
                  <span class="progress-label">Current checkpoint:</span>
                  <span
                    class="progress-checkpoint"
                    :title="getJobProgress(job.id)?.current_checkpoint"
                    :data-testid="`job-${job.id}-current-checkpoint`"
                  >{{ getJobProgress(job.id)?.current_checkpoint }}</span>
                </p>
                <p v-if="getJobProgress(job.id)?.current_checkpoint_progress !== undefined" class="progress-line">
                  <span class="progress-label">Current progress:</span>
                  <span>{{ getJobProgress(job.id)?.current_checkpoint_progress }} / {{ getJobProgress(job.id)?.current_checkpoint_total }} images</span>
                </p>
                <!-- AC1: FE: Show full generation parameters for the currently generating sample -->
                <div
                  v-if="getCurrentSampleParams(job.id)"
                  class="sample-params"
                  :data-testid="`job-${job.id}-sample-params`"
                >
                  <p class="sample-params-heading">Current Sample Parameters:</p>
                  <dl class="sample-params-list">
                    <div class="sample-params-row">
                      <dt class="sample-params-label">CFG</dt>
                      <dd class="sample-params-value" :data-testid="`job-${job.id}-param-cfg`">{{ getCurrentSampleParams(job.id)?.cfg }}</dd>
                    </div>
                    <div class="sample-params-row">
                      <dt class="sample-params-label">Steps</dt>
                      <dd class="sample-params-value" :data-testid="`job-${job.id}-param-steps`">{{ getCurrentSampleParams(job.id)?.steps }}</dd>
                    </div>
                    <div class="sample-params-row">
                      <dt class="sample-params-label">Sampler</dt>
                      <dd class="sample-params-value" :data-testid="`job-${job.id}-param-sampler`">{{ getCurrentSampleParams(job.id)?.sampler_name }}</dd>
                    </div>
                    <div class="sample-params-row">
                      <dt class="sample-params-label">Scheduler</dt>
                      <dd class="sample-params-value" :data-testid="`job-${job.id}-param-scheduler`">{{ getCurrentSampleParams(job.id)?.scheduler }}</dd>
                    </div>
                    <div class="sample-params-row">
                      <dt class="sample-params-label">Prompt</dt>
                      <dd class="sample-params-value" :data-testid="`job-${job.id}-param-prompt-name`">{{ getCurrentSampleParams(job.id)?.prompt_name }}</dd>
                    </div>
                    <div class="sample-params-row">
                      <dt class="sample-params-label">Seed</dt>
                      <dd class="sample-params-value" :data-testid="`job-${job.id}-param-seed`">{{ getCurrentSampleParams(job.id)?.seed }}</dd>
                    </div>
                    <div class="sample-params-row">
                      <dt class="sample-params-label">Size</dt>
                      <dd class="sample-params-value" :data-testid="`job-${job.id}-param-size`">{{ getCurrentSampleParams(job.id)?.width }}×{{ getCurrentSampleParams(job.id)?.height }}</dd>
                    </div>
                  </dl>
                </div>
                <!-- AC: FE: Secondary progress bar for per-sample inference progress -->
                <div
                  v-if="hasInferenceProgress(job.id)"
                  class="inference-progress"
                  :data-testid="`job-${job.id}-inference-progress`"
                >
                  <p class="progress-line">
                    <span class="progress-label">Inference:</span>
                    <span>{{ getInferenceProgress(job.id)?.current_value }} / {{ getInferenceProgress(job.id)?.max_value }} steps</span>
                  </p>
                  <NProgress
                    type="line"
                    :percentage="getInferencePercentage(job.id)"
                    :show-indicator="false"
                    status="default"
                    :height="6"
                  />
                </div>
                <!-- AC: FE: JobProgressPanel displays ETA for the current sample being generated -->
                <p
                  v-if="getSampleETA(job.id)"
                  class="progress-line"
                  :data-testid="`job-${job.id}-sample-eta`"
                >
                  <span class="progress-label">Sample ETA:</span>
                  <span>{{ getSampleETA(job.id) }}</span>
                </p>
                <!-- AC: FE: JobProgressPanel displays overall job ETA based on remaining samples and moving average -->
                <p
                  v-if="getJobETA(job.id)"
                  class="progress-line"
                  :data-testid="`job-${job.id}-job-eta`"
                >
                  <span class="progress-label">Job ETA:</span>
                  <span>{{ getJobETA(job.id) }}</span>
                </p>
                <!-- AC: Completeness status per checkpoint -->
                <div
                  v-if="getCompletenessEntries(job.id).length > 0"
                  class="completeness-section"
                  :data-testid="`job-${job.id}-completeness`"
                >
                  <p class="completeness-heading">Completeness:</p>
                  <p
                    v-for="entry in getCompletenessEntries(job.id)"
                    :key="entry.checkpoint"
                    class="completeness-line"
                    :class="{ 'completeness-line--missing': entry.missing > 0 }"
                  >
                    <span class="completeness-checkpoint" :title="entry.checkpoint">{{ entry.checkpoint }}</span>
                    <span class="completeness-status">{{ formatCompleteness(entry) }}</span>
                  </p>
                </div>
              </div>

              <!-- Item counts: completed, failed, pending -->
              <div class="item-counts" :data-testid="`job-${job.id}-counts`">
                <span>{{ job.completed_items }} completed</span>
                <span v-if="hasFailedItems(job)" class="failed-count" :data-testid="`job-${job.id}-failed-count`">{{ job.failed_items }} failed</span>
                <span v-if="(job.pending_items ?? 0) > 0">{{ job.pending_items }} pending</span>
              </div>

              <div class="progress-text">
                <span>Total progress: {{ job.completed_items }} / {{ job.total_items }} items</span>
                <span>{{ getProgressPercentage(job) }}%</span>
              </div>
              <NProgress
                type="line"
                :percentage="getProgressPercentage(job)"
                :show-indicator="false"
                :status="getProgressStatus(job)"
              />
            </div>

            <!-- Expandable error section for jobs with failed items -->
            <div v-if="hasFailedItems(job)" class="error-section" :data-testid="`job-${job.id}-error-section`">
              <button
                class="error-section-toggle"
                :data-testid="`job-${job.id}-error-toggle`"
                @click="toggleErrorSection(job.id)"
              >
                <span class="error-section-arrow" :class="{ 'error-section-arrow--expanded': isErrorExpanded(job.id) }">&#9654;</span>
                <span class="error-section-label">{{ job.failed_items }} failed item{{ job.failed_items === 1 ? '' : 's' }}</span>
              </button>
              <div v-if="isErrorExpanded(job.id)" class="error-details" :data-testid="`job-${job.id}-error-details`">
                <div
                  v-for="(group, idx) in getGroupedErrors(job)"
                  :key="idx"
                  class="error-group"
                >
                  <p class="error-group-header">
                    {{ group.errorMessage }} ({{ group.checkpoints.length }} checkpoint{{ group.checkpoints.length === 1 ? '' : 's' }})
                  </p>
                  <ul class="error-group-checkpoints">
                    <li v-for="cp in group.checkpoints" :key="cp" class="error-group-checkpoint">
                      {{ cp }}
                    </li>
                  </ul>
                  <!-- AC: FE: 'Show full traceback' toggle reveals the complete Python stack trace -->
                  <button
                    v-if="group.traceback"
                    class="traceback-toggle"
                    :data-testid="`job-${job.id}-traceback-toggle-${idx}`"
                    @click="toggleTraceback(job.id, idx)"
                  >
                    {{ isTracebackExpanded(job.id, idx) ? 'Hide full traceback' : 'Show full traceback' }}
                  </button>
                  <pre
                    v-if="group.traceback && isTracebackExpanded(job.id, idx)"
                    class="traceback-content"
                    :data-testid="`job-${job.id}-traceback-content-${idx}`"
                  >{{ group.traceback }}</pre>
                </div>
              </div>
            </div>

            <p v-if="job.error_message" class="error-message">
              {{ job.error_message }}
            </p>
          </div>
        </div>
      </NSpace>
    </NSpin>
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
    @regenerate="handleValidationRegenerate"
  />
</template>

<style scoped>
.empty-state {
  padding: 2rem;
  text-align: center;
}

.job-item {
  padding: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  background: var(--bg-surface);
}

.job-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.job-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.job-actions {
  display: flex;
  gap: 0.5rem;
}

.job-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.job-meta {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.separator {
  margin: 0 0.25rem;
}

.job-progress {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.progress-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
  padding: 0.5rem;
  background: var(--bg-color);
  border-radius: 0.25rem;
}

.progress-line {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-label {
  font-weight: 500;
  margin-right: 0.5rem;
}

.inference-progress {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin-top: 0.25rem;
}

.item-counts {
  display: flex;
  gap: 0.75rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.failed-count {
  color: var(--error-color);
  font-weight: 600;
}

.progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.error-section {
  margin-top: 0.25rem;
}

.error-section-toggle {
  background: none;
  border: none;
  padding: 0.25rem 0;
  font: inherit;
  color: var(--error-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 500;
  font-size: 0.875rem;
}

.error-section-arrow {
  display: inline-block;
  font-size: 0.625rem;
  transition: transform 0.15s;
}

.error-section-arrow--expanded {
  transform: rotate(90deg);
}

.error-section-label {
  text-decoration: underline;
  text-decoration-style: dotted;
}

.error-details {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: var(--bg-color);
  border: 1px solid var(--error-color);
  border-radius: 0.25rem;
}

.error-group {
  margin-bottom: 0.5rem;
}

.error-group:last-child {
  margin-bottom: 0;
}

.error-group-header {
  margin: 0 0 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--error-color);
}

.error-group-checkpoints {
  margin: 0;
  padding-left: 1.25rem;
  list-style: disc;
}

.error-group-checkpoint {
  font-size: 0.8125rem;
  font-family: monospace;
  color: var(--text-secondary);
}

.traceback-toggle {
  background: none;
  border: none;
  padding: 0.25rem 0;
  font: inherit;
  font-size: 0.75rem;
  color: var(--accent-color);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
}

.traceback-content {
  margin: 0.25rem 0 0;
  padding: 0.5rem;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-family: monospace;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: break-word;
  max-height: 300px;
  overflow-y: auto;
}

.error-message {
  margin: 0;
  padding: 0.5rem;
  background: var(--error-color);
  color: var(--bg-color);
  border-radius: 0.25rem;
  font-size: 0.875rem;
}

.sample-params {
  margin-top: 0.25rem;
  padding: 0.375rem 0.5rem;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
}

.sample-params-heading {
  margin: 0 0 0.25rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.sample-params-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.sample-params-row {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

.sample-params-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  min-width: 4.5rem;
  flex-shrink: 0;
}

.sample-params-value {
  font-size: 0.75rem;
  color: var(--text-color);
  font-family: monospace;
  word-break: break-all;
}

.completeness-section {
  margin-top: 0.25rem;
  padding-top: 0.25rem;
  border-top: 1px solid var(--border-color);
}

.completeness-heading {
  margin: 0 0 0.25rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.completeness-line {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.completeness-line--missing {
  color: var(--error-color);
  font-weight: 500;
}

.completeness-checkpoint {
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 0.5rem;
  min-width: 0;
}

.progress-checkpoint {
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.completeness-status {
  white-space: nowrap;
  flex-shrink: 0;
}

.job-title-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--text-color);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.job-title-btn:hover strong {
  color: var(--accent-color);
}

.job-params-panel {
  margin-bottom: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
}

.job-params-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.job-params-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.job-params-close {
  background: none;
  border: none;
  padding: 0 0.25rem;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  color: var(--text-secondary);
  cursor: pointer;
}

.job-params-close:hover {
  color: var(--text-color);
}

.job-params-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.job-params-row {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

.job-params-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  min-width: 7rem;
  flex-shrink: 0;
}

.job-params-value {
  font-size: 0.8125rem;
  color: var(--text-color);
  font-family: monospace;
  word-break: break-all;
}

.checkpoint-filenames-list {
  margin: 0;
  padding-left: 1rem;
  list-style: disc;
}

.checkpoint-filename-item {
  font-size: 0.8125rem;
  font-family: monospace;
  color: var(--text-color);
  word-break: break-all;
}
</style>
