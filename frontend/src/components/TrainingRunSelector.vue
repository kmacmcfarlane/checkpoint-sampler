<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NSelect, NCheckbox, NButton } from 'naive-ui'
import type { TrainingRun, CheckpointCompletenessInfo } from '../api/types'
import { apiClient } from '../api/client'
import { useGenerateInputsPersistence } from '../composables/useGenerateInputsPersistence'
import { useLastTrainingRun } from '../composables/useLastTrainingRun'

const props = defineProps<{
  /** Auto-select this training run ID if provided (used for restoring from localStorage). */
  autoSelectRunId?: number | null
}>()

const trainingRuns = ref<TrainingRun[]>([])
const selectedGroupKey = ref<string | null>(null)
const selectedStudyOutputDir = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const attemptedAutoSelect = ref(false)

// AC2: Validate button state
const validating = ref(false)
const validationError = ref<string | null>(null)
const validationResults = ref<CheckpointCompletenessInfo[] | null>(null)
const validationTotals = ref<{ total_expected: number; total_actual: number; total_missing: number } | null>(null)

const persistence = useGenerateInputsPersistence()
const { saveLastStudy, getLastStudy } = useLastTrainingRun()

/**
 * AC1: hasSamplesFilter — show only training runs that have samples.
 * Defaults to true (only show runs with samples). Persisted to localStorage.
 * The checkbox is only rendered when there are runs without samples, so in
 * viewer-only mode (where all runs have samples) the checkbox stays hidden.
 */
const hasSamplesFilter = ref<boolean>(persistence.getHasSamplesFilter() ?? true)

const emit = defineEmits<{
  select: [trainingRun: TrainingRun, studyOutputDir: string]
  'generate-missing': []
}>()

/** True while a manual refresh of the training runs list is in progress. */
const refreshing = ref(false)

/** True when at least one loaded run has no samples, making the filter checkbox relevant. */
const hasRunsWithoutSamples = computed(() =>
  trainingRuns.value.some((run) => !run.has_samples)
)

/** Filtered runs based on hasSamplesFilter. */
const filteredRuns = computed(() => {
  return hasSamplesFilter.value
    ? trainingRuns.value.filter((run) => run.has_samples)
    : trainingRuns.value
})

/** Group runs by training_run_dir (or fall back to name for legacy/checkpoint-source). */
const trainingRunGroups = computed(() => {
  const groups = new Map<string, TrainingRun[]>()
  for (const run of filteredRuns.value) {
    const key = run.training_run_dir || run.name
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(run)
  }
  return groups
})

/** Options for the first dropdown (Training Run). */
const groupOptions = computed(() => {
  return Array.from(trainingRunGroups.value.keys()).map((key) => ({
    label: key,
    value: key,
  }))
})

/** Runs in the currently selected group. */
const selectedGroupRuns = computed(() => {
  if (!selectedGroupKey.value) return []
  return trainingRunGroups.value.get(selectedGroupKey.value) ?? []
})

/** Options for the second dropdown (Study). */
const studyOptions = computed(() => {
  return selectedGroupRuns.value.map((run) => ({
    label: run.study_label || run.name,
    value: run.study_output_dir || '',
  }))
})

/** Whether to show the study dropdown. Hidden when group has exactly 1 run with no study_label. */
const showStudySelect = computed(() => {
  const runs = selectedGroupRuns.value
  if (runs.length === 0) return false
  if (runs.length === 1 && !runs[0].study_label) return false
  return true
})

/** The currently selected TrainingRun object. */
const selectedTrainingRun = computed(() => {
  if (!selectedGroupKey.value) return null
  const runs = selectedGroupRuns.value
  if (runs.length === 0) return null
  if (!showStudySelect.value) return runs[0]
  return runs.find((r) => (r.study_output_dir || '') === selectedStudyOutputDir.value) ?? null
})

async function fetchTrainingRuns() {
  loading.value = true
  error.value = null
  selectedGroupKey.value = null
  selectedStudyOutputDir.value = null
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
    const groupKey = run.training_run_dir || run.name
    selectedGroupKey.value = groupKey
    selectedStudyOutputDir.value = run.study_output_dir || ''
    emit('select', run, run.study_output_dir || '')
  }
}

/** Manual refresh of the training run list (triggered by the refresh icon button). */
async function refreshTrainingRuns() {
  refreshing.value = true
  try {
    trainingRuns.value = await apiClient.getTrainingRuns()
    attemptAutoSelect()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Failed to load training runs'
    error.value = message
  } finally {
    refreshing.value = false
  }
}

onMounted(fetchTrainingRuns)

function onGroupSelect(value: string | null) {
  if (value === null) {
    selectedGroupKey.value = null
    selectedStudyOutputDir.value = null
    return
  }
  selectedGroupKey.value = value
  // Clear previous validation results when switching
  validationResults.value = null
  validationError.value = null
  validationTotals.value = null

  // Auto-select study: try persisted, then first available
  const runs = trainingRunGroups.value.get(value) ?? []
  if (runs.length === 0) return

  if (runs.length === 1 && !runs[0].study_label) {
    // Single run with no study — auto-select
    selectedStudyOutputDir.value = runs[0].study_output_dir || ''
    emit('select', runs[0], runs[0].study_output_dir || '')
    return
  }

  // Try to restore persisted study selection
  const persisted = getLastStudy(value)
  const persistedRun = persisted !== null
    ? runs.find((r) => (r.study_output_dir || '') === persisted)
    : null

  if (persistedRun) {
    selectedStudyOutputDir.value = persisted!
    emit('select', persistedRun, persisted!)
  } else {
    // Default to first study
    const first = runs[0]
    selectedStudyOutputDir.value = first.study_output_dir || ''
    emit('select', first, first.study_output_dir || '')
  }
}

function onStudySelect(value: string | null) {
  if (value === null) return
  selectedStudyOutputDir.value = value
  // Clear previous validation results when switching studies
  validationResults.value = null
  validationError.value = null
  validationTotals.value = null

  const run = selectedGroupRuns.value.find((r) => (r.study_output_dir || '') === value)
  if (run) {
    // Persist study selection per training run dir
    if (selectedGroupKey.value) {
      saveLastStudy(selectedGroupKey.value, value)
    }
    emit('select', run, value)
  }
}

/** AC1: Persist the has-samples filter preference when the user toggles it. */
function onHasSamplesFilterChange(value: boolean) {
  hasSamplesFilter.value = value
  persistence.saveHasSamplesFilter(value)
}

// AC2: Validate button triggers completeness check against the selected sample set
async function onValidate() {
  const run = selectedTrainingRun.value
  if (!run) return

  validating.value = true
  validationError.value = null
  validationResults.value = null
  validationTotals.value = null

  try {
    const result = await apiClient.validateTrainingRun(run.id, undefined, selectedStudyOutputDir.value || undefined)
    validationResults.value = result.checkpoints
    validationTotals.value = {
      total_expected: result.total_expected,
      total_actual: result.total_actual,
      total_missing: result.total_missing,
    }
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
      :value="selectedGroupKey"
      :options="groupOptions"
      :disabled="loading || trainingRuns.length === 0"
      :placeholder="loading ? 'Loading...' : 'Select a training run'"
      :loading="loading"
      :consistent-menu-width="false"
      :menu-props="{ style: 'min-width: 320px; max-width: min(600px, 100vw)' }"
      filterable
      class="training-run-select"
      data-testid="training-run-select"
      size="small"
      @update:value="onGroupSelect"
    />
    <!-- AC: Refresh icon button to manually reload the sample set list -->
    <NButton
      size="small"
      circle
      :loading="refreshing"
      :disabled="refreshing"
      aria-label="Refresh sample set list"
      data-testid="refresh-sample-set-button"
      @click="refreshTrainingRuns"
    >
      <svg v-if="!refreshing" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4C7.58 4 4 7.58 4 12s3.58 8 8 8 8-3.58 8-8h-2c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L11 13h7V6l-2.35 2.35z" fill="currentColor" />
      </svg>
    </NButton>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
  <!-- Study dropdown (hidden when group has exactly 1 run with no study label) -->
  <div v-if="showStudySelect" class="study-selector">
    <label for="study-select">Study</label>
    <NSelect
      :value="selectedStudyOutputDir"
      :options="studyOptions"
      :consistent-menu-width="false"
      :menu-props="{ style: 'min-width: 200px; max-width: min(400px, 100vw)' }"
      filterable
      class="study-select"
      data-testid="study-select"
      size="small"
      @update:value="onStudySelect"
    />
  </div>
  <!-- AC2: Validate button beneath the Sample Set selector -->
  <div v-if="selectedTrainingRun !== null" class="validate-section">
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
    <!-- AC (S-084): Validation totals summary and Generate Missing button -->
    <div v-if="validationTotals" class="validation-totals" data-testid="validation-totals">
      <p class="validation-totals-text">
        {{ validationTotals.total_actual }} / {{ validationTotals.total_expected }} samples
        <span v-if="validationTotals.total_missing > 0" class="validation-missing-text">
          ({{ validationTotals.total_missing }} missing)
        </span>
      </p>
      <NButton
        v-if="validationTotals.total_missing > 0"
        size="small"
        type="warning"
        data-testid="generate-missing-button"
        @click="emit('generate-missing')"
      >
        Generate Missing
      </NButton>
    </div>
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

.study-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.study-selector label {
  font-weight: 600;
  white-space: nowrap;
}

.study-select {
  min-width: 150px;
  flex: 1;
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

.validation-totals {
  margin-top: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.validation-totals-text {
  font-size: 0.8125rem;
  color: var(--text-color);
  margin: 0;
}

.validation-missing-text {
  color: var(--warning-color);
  font-weight: 600;
}
</style>
