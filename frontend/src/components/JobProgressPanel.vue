<script setup lang="ts">
import { computed } from 'vue'
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

function getStatusType(status: SampleJobStatus): 'success' | 'error' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'completed':
      return 'success'
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

function getProgressPercentage(job: SampleJob): number {
  if (job.total_items === 0) return 0
  return Math.round((job.completed_items / job.total_items) * 100)
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
                {{ job.status }}
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
              <div class="progress-text">
                <span>Total progress: {{ job.completed_items }} / {{ job.total_items }} items</span>
                <span>{{ getProgressPercentage(job) }}%</span>
              </div>
              <NProgress
                type="line"
                :percentage="getProgressPercentage(job)"
                :show-indicator="false"
                :status="job.status === 'failed' ? 'error' : job.status === 'completed' ? 'success' : 'default'"
              />
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
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 0.25rem;
  background: var(--bg-surface, #f5f5f5);
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
  color: var(--text-secondary, #666666);
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
  background: var(--bg-color, #ffffff);
  border-radius: 0.25rem;
}

.progress-line {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary, #666666);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-label {
  font-weight: 500;
  margin-right: 0.5rem;
}

.progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  color: var(--text-secondary, #666666);
}

.error-message {
  margin: 0;
  padding: 0.5rem;
  background: var(--error-color, #d32f2f);
  color: white;
  border-radius: 0.25rem;
  font-size: 0.875rem;
}
</style>
