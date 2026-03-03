<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NSelect, NCheckbox, NButton } from 'naive-ui'
import type { TrainingRun, CheckpointCompletenessInfo } from '../api/types'
import { apiClient } from '../api/client'
import { useGenerateInputsPersistence } from '../composables/useGenerateInputsPersistence'

const props = defineProps<{
  /** Auto-select this training run ID if provided (used for restoring from localStorage). */
  autoSelectRunId?: number | null
}>()

const trainingRuns = ref<TrainingRun[]>([])
const selectedId = ref<number | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const attemptedAutoSelect = ref(false)

// AC2: Validate button state
const validating = ref(false)
const validationError = ref<string | null>(null)
const validationResults = ref<CheckpointCompletenessInfo[] | null>(null)

const persistence = useGenerateInputsPersistence()

/**
 * AC1: hasSamplesFilter — show only training runs that have samples.
 * Defaults to true (only show runs with samples). Persisted to localStorage.
 * The checkbox is only rendered when there are runs without samples, so in
 * viewer-only mode (where all runs have samples) the checkbox stays hidden.
 */
const hasSamplesFilter = ref<boolean>(persistence.getHasSamplesFilter() ?? true)

// select: Emitted when the user selects a training run from the dropdown, or on auto-select restore. Payload: the selected TrainingRun object.
const emit = defineEmits<{
  select: [trainingRun: TrainingRun]
}>()

/** True when at least one loaded run has no samples, making the filter checkbox relevant. */
const hasRunsWithoutSamples = computed(() =>
  trainingRuns.value.some((run) => !run.has_samples)
)

const selectOptions = computed(() => {
  const filtered = hasSamplesFilter.value
    ? trainingRuns.value.filter((run) => run.has_samples)
    : trainingRuns.value
  return filtered.map((run) => ({
    label: run.name,
    value: run.id,
  }))
})

async function fetchTrainingRuns() {
  loading.value = true
  error.value = null
  selectedId.value = null
  try {
    trainingRuns.value = await apiClient.getTrainingRuns()
    attemptAutoSelect()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Failed to load training runs'
    error.value = message
  } finally {
    loading.value = false
  }
}

/**
 * Auto-select a training run if autoSelectRunId is provided and the run exists.
 * Gracefully handles stale training runs by doing nothing.
 */
function attemptAutoSelect() {
  if (props.autoSelectRunId === null || props.autoSelectRunId === undefined) return
  if (attemptedAutoSelect.value) return
  attemptedAutoSelect.value = true

  const run = trainingRuns.value.find((r) => r.id === props.autoSelectRunId)
  if (run) {
    selectedId.value = run.id
    emit('select', run)
  }
  // If run doesn't exist, do nothing (stale training run ID in localStorage)
}

onMounted(fetchTrainingRuns)

function onSelect(value: number | null) {
  if (value === null) {
    selectedId.value = null
    return
  }
  selectedId.value = value
  // Clear previous validation results when switching sample sets
  validationResults.value = null
  validationError.value = null
  const run = trainingRuns.value.find((r) => r.id === value)
  if (run) {
    emit('select', run)
  }
}

/** AC1: Persist the has-samples filter preference when the user toggles it. */
function onHasSamplesFilterChange(value: boolean) {
  hasSamplesFilter.value = value
  persistence.saveHasSamplesFilter(value)
}

// AC2: Validate button triggers completeness check against the selected sample set
async function onValidate() {
  if (selectedId.value === null) return

  validating.value = true
  validationError.value = null
  validationResults.value = null

  try {
    const result = await apiClient.validateTrainingRun(selectedId.value)
    validationResults.value = result.checkpoints
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Validation failed'
    validationError.value = message
  } finally {
    validating.value = false
  }
}

/**
 * AC6: Determine validation status for a checkpoint.
 * Returns 'pass' if missing === 0, 'warning' if missing > 0.
 */
function checkpointStatus(cp: CheckpointCompletenessInfo): 'pass' | 'warning' {
  return cp.missing === 0 ? 'pass' : 'warning'
}
</script>

<template>
  <div class="training-run-selector">
    <!-- AC1: Rename "Training Run" to "Sample Set" -->
    <label for="training-run-select">Sample Set</label>
    <NCheckbox
      v-if="hasRunsWithoutSamples"
      :checked="hasSamplesFilter"
      data-testid="has-samples-checkbox"
      @update:checked="onHasSamplesFilterChange"
    >
      Has Samples
    </NCheckbox>
    <NSelect
      :value="selectedId"
      :options="selectOptions"
      :disabled="loading || trainingRuns.length === 0"
      :placeholder="loading ? 'Loading...' : 'Select a sample set'"
      :loading="loading"
      :consistent-menu-width="false"
      :menu-props="{ style: 'min-width: 320px; max-width: min(600px, 100vw)' }"
      filterable
      class="training-run-select"
      data-testid="training-run-select"
      size="small"
      @update:value="onSelect"
    />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
  <!-- AC2: Validate button beneath the Sample Set selector -->
  <div v-if="selectedId !== null" class="validate-section">
    <NButton
      size="small"
      :loading="validating"
      :disabled="validating"
      data-testid="validate-button"
      @click="onValidate"
    >
      Validate
    </NButton>
    <p v-if="validationError" class="error" role="alert" data-testid="validation-error">
      {{ validationError }}
    </p>
    <!-- AC6: Display validation results inline (per-checkpoint pass/warning status) -->
    <div v-if="validationResults" class="validation-results" data-testid="validation-results">
      <div
        v-for="cp in validationResults"
        :key="cp.checkpoint"
        class="validation-checkpoint"
        :class="{ 'validation-checkpoint--warning': checkpointStatus(cp) === 'warning' }"
        :data-testid="`validation-cp-${cp.checkpoint}`"
      >
        <span
          class="validation-status-icon"
          :style="{ color: checkpointStatus(cp) === 'pass' ? '#18a058' : undefined }"
          :class="{
            'validation-status-icon--warning': checkpointStatus(cp) === 'warning',
          }"
        >
          {{ checkpointStatus(cp) === 'pass' ? '\u2713' : '\u26A0' }}
        </span>
        <span class="validation-checkpoint-name">{{ cp.checkpoint }}</span>
        <span class="validation-checkpoint-counts">
          {{ cp.verified }}/{{ cp.expected }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.training-run-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.training-run-select {
  min-width: 150px;
  flex: 1;
}

.training-run-selector label {
  font-weight: 600;
  white-space: nowrap;
}

.training-run-selector .error {
  color: var(--error-color);
  font-size: 0.875rem;
  margin: 0;
}

.validate-section {
  margin-top: 0.5rem;
}

.validate-section .error {
  color: var(--error-color);
  font-size: 0.875rem;
  margin: 0.25rem 0 0 0;
}

.validation-results {
  margin-top: 0.5rem;
  font-size: 0.8125rem;
}

.validation-checkpoint {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0;
}

.validation-checkpoint--warning {
  color: var(--warning-color);
}

.validation-status-icon {
  flex-shrink: 0;
  width: 1.25em;
  text-align: center;
}

.validation-status-icon--warning {
  color: var(--warning-color);
}

.validation-checkpoint-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.validation-checkpoint-counts {
  flex-shrink: 0;
  color: var(--text-secondary);
}
</style>
