<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTag, NProgress } from 'naive-ui'
import type { SampleJob } from '../api/types'
import type { JobProgressEntry, InferenceProgressEntry } from '../composables/useJobProgress'
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
  formatTimestamp,
  formatCompleteness,
  getGroupedErrors,
  sortCompletenessEntries,
} from '../lib/jobFormat'

/**
 * A single sample-job card in the job list.
 *
 * Extracted from JobProgressPanel.vue (R-021) as a presentational component: it
 * owns no state and performs no I/O. Expansion state and the ETA/runtime strings
 * are passed down from the panel, because the panel's scroll-to-failed-job
 * watcher needs to expand a card's error section from the outside, and the ETA
 * countdowns are interpolated across the whole job list by one shared timer.
 */
const props = defineProps<{
  job: SampleJob
  /** Checkpoint-level progress for this job, if any. */
  progress?: JobProgressEntry
  /** Per-sample inference progress for this job, if any. */
  inferenceProgress?: InferenceProgressEntry
  /** True while this specific job's stop request is in flight. */
  stopping: boolean
  /** Whether the job-parameters panel is expanded. */
  paramsExpanded: boolean
  /** Whether the failed-items error section is expanded. */
  errorExpanded: boolean
  /** Which grouped-error tracebacks are expanded, keyed by error index. */
  expandedTracebacks: Record<number, boolean>
  /** Preformatted total-runtime string. */
  runtime: string
  /** Preformatted per-sample ETA, or undefined when not available. */
  sampleEta?: string
  /** Preformatted whole-job ETA, or undefined when not available. */
  jobEta?: string
}>()

// toggle-params: Emitted when the card title or the params close button is clicked. No payload.
// toggle-errors: Emitted when the failed-items summary is clicked. No payload.
// toggle-traceback: Emitted when a traceback toggle is clicked. Payload: the error group index.
// stop / resume / retry-failed: Emitted for the matching action. Payload: the job ID string.
// regenerate / validate: Emitted for the matching action. Payload: the full SampleJob.
// delete: Emitted when Delete is clicked. Payload: the job ID string.
const emit = defineEmits<{
  'toggle-params': []
  'toggle-errors': []
  'toggle-traceback': [errorIdx: number]
  stop: [jobId: string]
  resume: [jobId: string]
  'retry-failed': [jobId: string]
  regenerate: [job: SampleJob]
  validate: [job: SampleJob]
  delete: [jobId: string]
}>()

/** Whether checkpoint-level progress is available (drives the progress details block). */
const hasCheckpointProgress = computed(
  () => props.progress !== undefined && props.progress.total_checkpoints > 0,
)

/** Whether per-sample inference progress is available and meaningful. */
const hasInferenceProgress = computed(
  () => props.inferenceProgress !== undefined && props.inferenceProgress.max_value > 0,
)

const inferencePercentage = computed(() => {
  const p = props.inferenceProgress
  if (!p || p.max_value === 0) return 0
  return Math.round((p.current_value / p.max_value) * 100)
})

/** Completeness entries sorted by checkpoint name. */
const completenessEntries = computed(() =>
  sortCompletenessEntries(props.progress?.checkpoint_completeness),
)

/** Generation parameters for the currently generating sample. */
const currentSampleParams = computed(() => props.progress?.current_sample_params)

const groupedErrors = computed(() => getGroupedErrors(props.job))

function isTracebackExpanded(errorIdx: number): boolean {
  return props.expandedTracebacks[errorIdx] ?? false
}
</script>

<template>
  <div class="job-item" :data-testid="`job-${job.id}`">
    <div class="job-header">
      <div class="job-title">
        <button
          class="job-title-btn"
          :data-testid="`job-${job.id}-title`"
          :aria-expanded="paramsExpanded"
          @click="emit('toggle-params')"
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
          :loading="stopping"
          :data-testid="`job-${job.id}-stop`"
          @click="emit('stop', job.id)"
        >
          Stop
        </NButton>
        <NButton
          v-if="canResume(job)"
          size="tiny"
          type="primary"
          :data-testid="`job-${job.id}-resume`"
          @click="emit('resume', job.id)"
        >
          Resume
        </NButton>
        <NButton
          v-if="canRetryFailed(job)"
          size="tiny"
          type="warning"
          :data-testid="`job-${job.id}-retry-failed`"
          @click="emit('retry-failed', job.id)"
        >
          Retry failed
        </NButton>
        <NButton
          v-if="canRegenerate(job)"
          size="tiny"
          type="info"
          :data-testid="`job-${job.id}-regenerate`"
          @click="emit('regenerate', job)"
        >
          Regenerate
        </NButton>
        <!-- AC: FE: Validate button on each job in job list -->
        <NButton
          size="tiny"
          :data-testid="`job-${job.id}-validate`"
          @click="emit('validate', job)"
        >
          Validate
        </NButton>
        <NButton
          v-if="canDelete(job)"
          size="tiny"
          type="error"
          :data-testid="`job-${job.id}-delete`"
          @click="emit('delete', job.id)"
        >
          Delete
        </NButton>
      </div>
    </div>

    <!-- AC: FE: Clicking a job card title opens a detail view showing all job parameters -->
    <div
      v-if="paramsExpanded"
      class="job-params-panel"
      :data-testid="`job-${job.id}-params`"
    >
      <div class="job-params-header">
        <span class="job-params-title">Job Parameters</span>
        <button
          class="job-params-close"
          :data-testid="`job-${job.id}-params-close`"
          aria-label="Close parameters"
          @click="emit('toggle-params')"
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
              {{ hasCheckpointProgress ? progress?.total_checkpoints : job.total_items }} total
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
        <span :data-testid="`job-${job.id}-created-at`">Created: {{ formatTimestamp(job.created_at) }}</span>
        <span class="separator">•</span>
        <span :data-testid="`job-${job.id}-updated-at`">Updated: {{ formatTimestamp(job.updated_at) }}</span>
        <span class="separator">•</span>
        <span :data-testid="`job-${job.id}-runtime`">Runtime: {{ runtime }}</span>
      </p>

      <div class="job-progress">
        <div v-if="hasCheckpointProgress" class="progress-details">
          <p class="progress-line">
            <span class="progress-label">Checkpoints:</span>
            <span>{{ progress?.checkpoints_completed }} / {{ progress?.total_checkpoints }}</span>
          </p>
          <p v-if="progress?.current_checkpoint" class="progress-line">
            <span class="progress-label">Current checkpoint:</span>
            <span
              class="progress-checkpoint"
              :title="progress?.current_checkpoint"
              :data-testid="`job-${job.id}-current-checkpoint`"
            >{{ progress?.current_checkpoint }}</span>
          </p>
          <p v-if="progress?.current_checkpoint_progress !== undefined" class="progress-line">
            <span class="progress-label">Current progress:</span>
            <span>{{ progress?.current_checkpoint_progress }} / {{ progress?.current_checkpoint_total }} images</span>
          </p>
          <!-- AC1: FE: Show full generation parameters for the currently generating sample -->
          <div
            v-if="currentSampleParams"
            class="sample-params"
            :data-testid="`job-${job.id}-sample-params`"
          >
            <p class="sample-params-heading">Current Sample Parameters:</p>
            <dl class="sample-params-list">
              <div class="sample-params-row">
                <dt class="sample-params-label">CFG</dt>
                <dd class="sample-params-value" :data-testid="`job-${job.id}-param-cfg`">{{ currentSampleParams.cfg }}</dd>
              </div>
              <div class="sample-params-row">
                <dt class="sample-params-label">Steps</dt>
                <dd class="sample-params-value" :data-testid="`job-${job.id}-param-steps`">{{ currentSampleParams.steps }}</dd>
              </div>
              <div class="sample-params-row">
                <dt class="sample-params-label">Sampler</dt>
                <dd class="sample-params-value" :data-testid="`job-${job.id}-param-sampler`">{{ currentSampleParams.sampler_name }}</dd>
              </div>
              <div class="sample-params-row">
                <dt class="sample-params-label">Scheduler</dt>
                <dd class="sample-params-value" :data-testid="`job-${job.id}-param-scheduler`">{{ currentSampleParams.scheduler }}</dd>
              </div>
              <div class="sample-params-row">
                <dt class="sample-params-label">Prompt</dt>
                <dd class="sample-params-value" :data-testid="`job-${job.id}-param-prompt-name`">{{ currentSampleParams.prompt_name }}</dd>
              </div>
              <div class="sample-params-row">
                <dt class="sample-params-label">Seed</dt>
                <dd class="sample-params-value" :data-testid="`job-${job.id}-param-seed`">{{ currentSampleParams.seed }}</dd>
              </div>
              <div class="sample-params-row">
                <dt class="sample-params-label">Size</dt>
                <dd class="sample-params-value" :data-testid="`job-${job.id}-param-size`">{{ currentSampleParams.width }}×{{ currentSampleParams.height }}</dd>
              </div>
            </dl>
          </div>
          <!-- AC: FE: Secondary progress bar for per-sample inference progress -->
          <div
            v-if="hasInferenceProgress"
            class="inference-progress"
            :data-testid="`job-${job.id}-inference-progress`"
          >
            <p class="progress-line">
              <span class="progress-label">Inference:</span>
              <span>{{ inferenceProgress?.current_value }} / {{ inferenceProgress?.max_value }} steps</span>
            </p>
            <NProgress
              type="line"
              :percentage="inferencePercentage"
              :show-indicator="false"
              status="default"
              :height="6"
            />
          </div>
          <!-- AC: FE: JobProgressPanel displays ETA for the current sample being generated -->
          <p
            v-if="sampleEta"
            class="progress-line"
            :data-testid="`job-${job.id}-sample-eta`"
          >
            <span class="progress-label">Sample ETA:</span>
            <span>{{ sampleEta }}</span>
          </p>
          <!-- AC: FE: JobProgressPanel displays overall job ETA based on remaining samples and moving average -->
          <p
            v-if="jobEta"
            class="progress-line"
            :data-testid="`job-${job.id}-job-eta`"
          >
            <span class="progress-label">Job ETA:</span>
            <span>{{ jobEta }}</span>
          </p>
          <!-- AC: Completeness status per checkpoint -->
          <div
            v-if="completenessEntries.length > 0"
            class="completeness-section"
            :data-testid="`job-${job.id}-completeness`"
          >
            <p class="completeness-heading">Completeness:</p>
            <p
              v-for="entry in completenessEntries"
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
          @click="emit('toggle-errors')"
        >
          <span class="error-section-arrow" :class="{ 'error-section-arrow--expanded': errorExpanded }">&#9654;</span>
          <span class="error-section-label">{{ job.failed_items }} failed item{{ job.failed_items === 1 ? '' : 's' }}</span>
        </button>
        <div v-if="errorExpanded" class="error-details" :data-testid="`job-${job.id}-error-details`">
          <div
            v-for="(group, idx) in groupedErrors"
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
              @click="emit('toggle-traceback', idx)"
            >
              {{ isTracebackExpanded(idx) ? 'Hide full traceback' : 'Show full traceback' }}
            </button>
            <pre
              v-if="group.traceback && isTracebackExpanded(idx)"
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
</template>

<style scoped>
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
