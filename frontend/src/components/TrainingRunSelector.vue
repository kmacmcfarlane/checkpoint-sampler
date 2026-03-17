<script setup lang="ts">
import { ref, computed, onMounted, watch, h } from 'vue'
import { NSelect, NCheckbox, NButton } from 'naive-ui'
import type { SelectRenderLabel, SelectRenderTag } from 'naive-ui'
import type { TrainingRun } from '../api/types'
import { apiClient } from '../api/client'
import { useGenerateInputsPersistence } from '../composables/useGenerateInputsPersistence'
import { useLastTrainingRun } from '../composables/useLastTrainingRun'

const props = defineProps<{
  /** Auto-select this training run ID if provided (used for restoring from localStorage). */
  autoSelectRunId?: number | null
  /**
   * Increment this counter to trigger an automatic refresh of the training run list.
   * Used by the parent to reactively refresh after a sample generation job completes.
   */
  refreshTrigger?: number
}>()

const trainingRuns = ref<TrainingRun[]>([])
const selectedGroupKey = ref<string | null>(null)
const selectedStudyOutputDir = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const attemptedAutoSelect = ref(false)

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

/**
 * B-098: renderLabel renders option labels with white-space: normal so long names
 * wrap to multiple lines instead of truncating with ellipsis.
 * IMPORTANT: VNodes returned from renderLabel run outside Vue's scoped CSS context,
 * so all styles must be inlined.
 */
const renderWrappedLabel: SelectRenderLabel = (option) =>
  h('span', {
    style: {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: '1.4',
    },
    'data-testid': 'training-run-option-label',
  }, String(option.label ?? ''))

/**
 * B-098 UAT rework: renderTag renders the selected value in the closed-state trigger
 * with white-space: normal so that long names wrap instead of being truncated.
 * The NSelect trigger container will grow vertically to contain the wrapped text.
 * IMPORTANT: VNodes run outside Vue's scoped CSS context — all styles must be inlined.
 */
const renderWrappedTag: SelectRenderTag = ({ option }) =>
  h('span', {
    style: {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: '1.4',
      display: 'block',
    },
    'data-testid': 'training-run-selected-tag',
  }, String(option.label ?? ''))

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

/**
 * AC1-2 (B-105): Automatically refresh the training run list when a sample generation
 * job completes. The parent increments refreshTrigger on each terminal job status
 * transition so the selector shows newly generated sample sets without a manual refresh.
 */
watch(
  () => props.refreshTrigger,
  (newVal, oldVal) => {
    // Skip the initial call (when the watcher fires on component mount with the initial value).
    // We only refresh when the trigger actually increments after the initial load.
    if (oldVal === undefined) return
    refreshTrainingRuns()
  },
)

function onGroupSelect(value: string | null) {
  if (value === null) {
    selectedGroupKey.value = null
    selectedStudyOutputDir.value = null
    return
  }
  selectedGroupKey.value = value

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
      :menu-props="{ style: 'min-width: 320px; max-width: min(1024px, 100vw)' }"
      :render-label="renderWrappedLabel"
      :render-tag="renderWrappedTag"
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
      :menu-props="{ style: 'min-width: 200px; max-width: min(1024px, 100vw)' }"
      :render-label="renderWrappedLabel"
      :render-tag="renderWrappedTag"
      filterable
      class="study-select"
      data-testid="study-select"
      size="small"
      @update:value="onStudySelect"
    />
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

/*
 * B-098 UAT rework: Override Naive UI NSelect trigger internals so the closed-state
 * selector grows vertically when the selected name is long, instead of overflowing.
 * These :deep() rules target Naive UI's internal .n-base-selection elements which are
 * outside Vue's scoped CSS scope without the deep selector.
 */
.training-run-select :deep(.n-base-selection),
.study-select :deep(.n-base-selection) {
  height: auto !important;
  min-height: var(--n-height);
}

.training-run-select :deep(.n-base-selection-tags),
.study-select :deep(.n-base-selection-tags) {
  flex-wrap: wrap;
  height: auto !important;
  min-height: var(--n-height);
  padding-top: 3px;
  padding-bottom: 3px;
}

.training-run-select :deep(.n-base-selection-label),
.study-select :deep(.n-base-selection-label) {
  height: auto !important;
  min-height: var(--n-height);
  white-space: normal;
  word-break: break-word;
}
</style>
