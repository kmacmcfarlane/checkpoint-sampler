<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NSelect, NCheckbox } from 'naive-ui'
import type { TrainingRun } from '../api/types'
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
</script>

<template>
  <div class="training-run-selector">
    <label for="training-run-select">Training Run</label>
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
      :placeholder="loading ? 'Loading...' : 'Select a training run'"
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
</style>
