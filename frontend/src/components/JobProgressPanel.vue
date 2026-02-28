<script setup lang="ts">
import { computed, ref } from 'vue'
import { NModal, NButton, NTag, NProgress, NSpace, NEmpty, NSpin } from 'naive-ui'
import type { SampleJob, SampleJobStatus } from '../api/types'

const props = defineProps<{
  show: boolean
  jobs: SampleJob[]
  jobProgress?: Record<string, {
    checkpoints_completed: number
    total_checkpoints: number
    current_checkpoint?: string
    current_checkpoint_progress?: number
    current_checkpoint_total?: number
    estimated_completion_time?: string
  }>
  loading?: boolean
}>()

const emit = defineEmits<{
  stop: [jobId: string]
  resume: [jobId: string]
  refresh: []
  close: []
}>()

const sortedJobs = computed(() => {
  return [...props.jobs].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
})

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

function handleStop(jobId: string) {
  emit('stop', jobId)
}

function handleResume(jobId: string) {
  emit('resume', jobId)
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

function getJobProgress(jobId: string) {
  return props.jobProgress?.[jobId]
}

function hasCheckpointProgress(jobId: string): boolean {
  const progress = getJobProgress(jobId)
  return progress !== undefined && progress.total_checkpoints > 0
}

/** Whether a job has any failed items. */
function hasFailedItems(job: SampleJob): boolean {
  return (job.failed_items ?? 0) > 0
}

/**
 * Group failed item details by error message.
 * Returns an array of { errorMessage, checkpoints } objects.
 */
function getGroupedErrors(job: SampleJob): Array<{ errorMessage: string; checkpoints: string[] }> {
  const details = job.failed_item_details ?? []
  if (details.length === 0) return []

  const grouped = new Map<string, string[]>()
  for (const detail of details) {
    const existing = grouped.get(detail.error_message)
    if (existing) {
      existing.push(detail.checkpoint_filename)
    } else {
      grouped.set(detail.error_message, [detail.checkpoint_filename])
    }
  }

  return Array.from(grouped.entries()).map(([errorMessage, checkpoints]) => ({
    errorMessage,
    checkpoints: checkpoints.sort(),
  }))
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
              <strong>{{ job.training_run_name }}</strong>
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
            </div>
          </div>

          <div class="job-details">
            <p class="job-meta">
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
                  <span>{{ getJobProgress(job.id)?.current_checkpoint }}</span>
                </p>
                <p v-if="getJobProgress(job.id)?.current_checkpoint_progress !== undefined" class="progress-line">
                  <span class="progress-label">Current progress:</span>
                  <span>{{ getJobProgress(job.id)?.current_checkpoint_progress }} / {{ getJobProgress(job.id)?.current_checkpoint_total }} images</span>
                </p>
                <p v-if="getJobProgress(job.id)?.estimated_completion_time" class="progress-line">
                  <span class="progress-label">Estimated completion:</span>
                  <span>{{ formatTimestamp(getJobProgress(job.id)!.estimated_completion_time!) }}</span>
                </p>
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

.error-message {
  margin: 0;
  padding: 0.5rem;
  background: var(--error-color);
  color: var(--bg-color);
  border-radius: 0.25rem;
  font-size: 0.875rem;
}
</style>
