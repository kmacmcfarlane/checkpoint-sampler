<script setup lang="ts">
import { NModal, NButton, NTag, NEmpty, NSpin } from 'naive-ui'
import type { ValidationResult, SampleJob } from '../api/types'

const props = defineProps<{
  show: boolean
  /** Validation results to display, or null when loading. */
  result: ValidationResult | null
  /** Error message if validation failed. */
  error: string | null
  /** Whether the validation request is in progress. */
  loading: boolean
  /** The job being validated (used for Regenerate button). */
  job: SampleJob | null
  /** Title to show in the dialog header. */
  title?: string
}>()

// close: Emitted when the dialog is dismissed.
// regenerate: Emitted when the user clicks Regenerate. Payload: the job whose settings should be prefilled.
const emit = defineEmits<{
  close: []
  regenerate: [job: SampleJob]
}>()

function getCheckpointStatus(missing: number): 'pass' | 'warning' {
  return missing === 0 ? 'pass' : 'warning'
}

function hasAnyMissing(): boolean {
  if (!props.result) return false
  return props.result.total_missing > 0
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="title ?? 'Validation Results'"
    style="max-width: 600px; max-height: 80vh; overflow-y: auto;"
    data-testid="validation-results-dialog"
    @update:show="emit('close')"
  >
    <template #header-extra>
      <NButton
        v-if="job"
        size="small"
        type="primary"
        data-testid="validation-regenerate-button"
        @click="emit('regenerate', job)"
      >
        Regenerate
      </NButton>
    </template>

    <NSpin :show="loading">
      <div v-if="error" class="validation-error" data-testid="validation-dialog-error" role="alert">
        {{ error }}
      </div>

      <NEmpty
        v-else-if="!loading && !result"
        description="No validation results available"
      />

      <template v-else-if="result">
        <!-- Summary row -->
        <div class="validation-summary" data-testid="validation-dialog-summary">
          <span class="validation-summary-label">Total:</span>
          <span>
            {{ result.total_actual }} / {{ result.total_expected }} samples
          </span>
          <NTag
            v-if="result.total_missing === 0"
            type="success"
            size="small"
            data-testid="validation-dialog-status-complete"
          >
            Complete
          </NTag>
          <NTag
            v-else
            type="warning"
            size="small"
            data-testid="validation-dialog-status-missing"
          >
            {{ result.total_missing }} missing
          </NTag>
        </div>

        <!-- Per-checkpoint results -->
        <div class="validation-checkpoints" data-testid="validation-dialog-checkpoints">
          <div
            v-for="cp in result.checkpoints"
            :key="cp.checkpoint"
            class="validation-checkpoint-row"
            :class="{ 'validation-checkpoint-row--warning': getCheckpointStatus(cp.missing) === 'warning' }"
            :data-testid="`validation-dialog-cp-${cp.checkpoint}`"
          >
            <span
              class="validation-status-icon"
              :class="{
                'validation-status-icon--pass': getCheckpointStatus(cp.missing) === 'pass',
                'validation-status-icon--warning': getCheckpointStatus(cp.missing) === 'warning',
              }"
            >
              {{ getCheckpointStatus(cp.missing) === 'pass' ? '\u2713' : '\u26A0' }}
            </span>
            <span class="validation-checkpoint-name" :title="cp.checkpoint">{{ cp.checkpoint }}</span>
            <span class="validation-checkpoint-counts" :data-testid="`validation-dialog-cp-counts-${cp.checkpoint}`">
              {{ cp.verified }}/{{ cp.expected }}
            </span>
          </div>
        </div>

        <!-- Regenerate footer hint when there are missing samples -->
        <p v-if="hasAnyMissing() && job" class="validation-regenerate-hint">
          Click <strong>Regenerate</strong> to generate missing samples only.
        </p>
      </template>
    </NSpin>
  </NModal>
</template>

<style scoped>
.validation-error {
  color: var(--error-color);
  padding: 0.5rem 0;
  font-size: 0.875rem;
}

.validation-summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
}

.validation-summary-label {
  font-weight: 600;
  color: var(--text-secondary);
}

.validation-checkpoints {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 0.8125rem;
}

.validation-checkpoint-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0;
}

.validation-checkpoint-row--warning {
  color: var(--warning-color);
}

.validation-status-icon {
  flex-shrink: 0;
  width: 1.25em;
  text-align: center;
}

.validation-status-icon--pass {
  color: var(--success-color, #18a058);
}

.validation-status-icon--warning {
  color: var(--warning-color);
}

.validation-checkpoint-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}

.validation-checkpoint-counts {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.validation-regenerate-hint {
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}
</style>
