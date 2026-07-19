<script setup lang="ts">
import { ref, computed, onMounted, watch, h, cloneVNode } from 'vue'
import { NSelect, NCheckbox, NButton, NEmpty } from 'naive-ui'
import type { SelectRenderLabel, SelectRenderTag, SelectRenderOption } from 'naive-ui'
import type { TrainingRun } from '../api/types'
import { apiClient } from '../api/client'
import { useGenerateInputsPersistence } from '../composables/useGenerateInputsPersistence'
import { useLastTrainingRun } from '../composables/useLastTrainingRun'

const props = defineProps<{
  /** Auto-select this training run ID if provided (used for restoring from localStorage). */
  autoSelectRunId?: string | null
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

/**
 * S-173: Configured checkpoint directories, fetched from /api/v1/config so the
 * empty state can name the exact paths the backend is scanning instead of a
 * generic "No Data" message.
 */
const checkpointDirs = ref<string[]>([])

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
 * S-148: Render a kind badge (LoRA/Checkpoint) for a training run option.
 * Only shows the badge for LoRA runs since checkpoint is the default/common kind.
 * IMPORTANT: VNodes run outside scoped CSS context — all styles must be inlined.
 */
function renderKindBadge(kind: string | undefined): ReturnType<typeof h> | null {
  if (kind !== 'lora') return null
  return h('span', {
    'data-testid': 'training-run-kind-badge',
    style: {
      display: 'inline-block',
      padding: '0 6px',
      fontSize: '11px',
      lineHeight: '18px',
      borderRadius: '3px',
      backgroundColor: 'rgba(99, 125, 255, 0.15)',
      color: '#637dff',
      fontWeight: '600',
      flexShrink: '0',
      whiteSpace: 'nowrap',
    },
  }, 'LoRA')
}

/**
 * B-098: renderLabel renders option labels with white-space: normal so long names
 * wrap to multiple lines instead of truncating with ellipsis.
 * S-148: Also renders a LoRA badge when the training run kind is 'lora'.
 * IMPORTANT: VNodes returned from renderLabel run outside Vue's scoped CSS context,
 * so all styles must be inlined.
 */
const renderWrappedLabel: SelectRenderLabel = (option) => {
  const kind = (option as { _kind?: string })._kind
  const badge = renderKindBadge(kind)
  const label = h('span', {
    style: {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: '1.4',
    },
    'data-testid': 'training-run-option-label',
  }, String(option.label ?? ''))

  if (!badge) return label
  return h('div', {
    style: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem' },
  }, [badge, label])
}

/**
 * B-098 UAT rework: renderTag renders the selected value in the closed-state trigger
 * with white-space: normal so that long names wrap instead of being truncated.
 * The NSelect trigger container will grow vertically to contain the wrapped text.
 * IMPORTANT: VNodes run outside Vue's scoped CSS context — all styles must be inlined.
 */
const renderWrappedTag: SelectRenderTag = ({ option }) => {
  const kind = (option as { _kind?: string })._kind
  const badge = renderKindBadge(kind)
  const label = h('span', {
    style: {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: '1.4',
      flex: '1',
      minWidth: '0',
    },
    'data-testid': 'training-run-selected-tag',
  }, String(option.label ?? ''))

  if (!badge) return label
  return h('div', {
    style: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'nowrap' },
  }, [badge, label])
}

/** Options for the first dropdown (Training Run). */
const groupOptions = computed(() => {
  return Array.from(trainingRunGroups.value.entries()).map(([key, runs]) => {
    // Determine the kind for the group. If all runs share the same kind, use it.
    // If mixed (shouldn't normally happen), default to 'checkpoint'.
    const kinds = new Set(runs.map(r => r.kind).filter(Boolean))
    const kind = kinds.size === 1 ? [...kinds][0] : 'checkpoint'
    return {
      label: key,
      value: key,
      _kind: kind,
    }
  })
})

/**
 * S-133 / B-098 UAT rework: zebra-stripe renderOption for the training-run dropdown.
 * Naive UI renders the dropdown menu in a Teleport (outside the component's DOM subtree)
 * so scoped :deep() CSS does not reach the option elements. Instead we use the renderOption
 * prop to clone each option VNode and inject an alternating background style so every other
 * row is lightly tinted.
 *
 * IMPORTANT: VNodes returned from renderOption run outside Vue's scoped CSS context so all
 * styles must be inlined.
 */
const renderZebraGroupOption: SelectRenderOption = ({ node, option }) => {
  const index = groupOptions.value.findIndex((o) => o.value === option.value)
  if (index < 0 || index % 2 === 0) return node
  return cloneVNode(node, { style: { backgroundColor: 'rgba(128, 128, 128, 0.07)' } })
}

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

/**
 * S-133 / B-098 UAT rework: zebra-stripe renderOption for the study dropdown.
 * Declared after studyOptions so the closure resolves correctly.
 */
const renderZebraStudyOption: SelectRenderOption = ({ node, option }) => {
  const index = studyOptions.value.findIndex((o) => o.value === option.value)
  if (index < 0 || index % 2 === 0) return node
  return cloneVNode(node, { style: { backgroundColor: 'rgba(128, 128, 128, 0.07)' } })
}

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

/**
 * S-173: Fetch the configured checkpoint directories so the empty state can
 * name them. Best-effort — if this fails, the empty state falls back to a
 * generic message rather than blocking the training run list.
 */
async function fetchCheckpointDirs() {
  try {
    const config = await apiClient.getConfig()
    checkpointDirs.value = config.checkpoint_dirs ?? []
  } catch {
    checkpointDirs.value = []
  }
}

/**
 * S-173: Empty-state description naming the configured checkpoint directories
 * and hinting at the config/layout docs, shown instead of NSelect's generic
 * "No Data" message when no training runs are found.
 */
const emptyStateDescription = computed(() => {
  if (checkpointDirs.value.length === 0) {
    return 'No training runs found. Check that your configured checkpoint directories contain the expected files — see docs/filesystem.md for the expected layout.'
  }
  const dirList = checkpointDirs.value.join(', ')
  return `No training runs found in the configured checkpoint director${checkpointDirs.value.length === 1 ? 'y' : 'ies'}: ${dirList}. Check config.yaml and docs/filesystem.md for the expected layout.`
})

onMounted(() => {
  fetchTrainingRuns()
  fetchCheckpointDirs()
})

/**
 * AC1-2 (B-105): Automatically refresh the training run list when a sample generation
 * job completes. The parent increments refreshTrigger on each terminal job status
 * transition so the selector shows newly generated sample sets without a manual refresh.
 */
watch(
  () => props.refreshTrigger,
  (_newVal, oldVal) => {
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
      :render-option="renderZebraGroupOption"
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
  <!--
    S-173: Helpful empty state shown when discovery finds zero training runs.
    NSelect's built-in "No Data" empty state only appears inside the (disabled,
    unopenable) dropdown, so it is effectively invisible. This standalone block
    names the exact configured checkpoint directories and hints at the docs so
    a misconfigured newcomer isn't left staring at a permanently-empty selector.
  -->
  <NEmpty
    v-if="!loading && !error && trainingRuns.length === 0"
    data-testid="training-run-empty-state"
    :description="emptyStateDescription"
    class="training-run-empty-state"
  />
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
      :render-option="renderZebraStudyOption"
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

.training-run-empty-state {
  margin-top: 0.5rem;
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
 * B-098 UAT rework (v2): Override Naive UI NSelect trigger internals so the
 * closed-state selector grows vertically when the selected name is long.
 *
 * For filterable single-select, Naive UI renders:
 *   .n-base-selection-label (inline-flex, height: var(--n-height))
 *     <input class="n-base-selection-input" />   ← width: 100% in flex
 *     .n-base-selection-label__render-label      ← position: absolute overlay
 *       .n-base-selection-overlay__wrapper
 *         [renderTag output]
 *
 * Problem: The label has a fixed height, and the overlay is position: absolute
 * so it cannot expand the parent. The previous fix made the overlay relative,
 * but then the input (width: 100%) stole all horizontal space.
 *
 * Solution:
 *   1. Label: height: auto so it can grow vertically.
 *   2. Input: width: 0 / flex: 0 so it takes no space when collapsed.
 *   3. Overlay: position: relative so it participates in flex layout and
 *      its height drives the parent's height.
 *   4. Overlay wrapper: allow text to wrap naturally.
 */
.training-run-select :deep(.n-base-selection),
.study-select :deep(.n-base-selection) {
  height: auto !important;
  min-height: var(--n-height);
}

.training-run-select :deep(.n-base-selection-label),
.study-select :deep(.n-base-selection-label) {
  height: auto !important;
  min-height: var(--n-height);
  align-items: center;
}

/*
 * Collapse the filter <input> to zero width when the selector is closed
 * (i.e. not active). Naive UI sets it to width: 100%, which steals all flex
 * space from the render-label overlay and causes character-per-line wrapping.
 * We only apply this when the root element does NOT have .n-base-selection--active,
 * so typing still works normally when the dropdown is open.
 */
.training-run-select :deep(.n-base-selection:not(.n-base-selection--active) .n-base-selection-input),
.study-select :deep(.n-base-selection:not(.n-base-selection--active) .n-base-selection-input) {
  width: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  flex: 0 0 0 !important;
  min-width: 0 !important;
  overflow: hidden !important;
}

/*
 * The render-label overlay is position: absolute by default, which means it
 * cannot expand the parent. We re-flow it into the flex container so the
 * parent grows to contain the wrapped text. The padding from the original
 * --n-padding-single is added here since the absolute overlay had it.
 */
.training-run-select :deep(.n-base-selection-label__render-label),
.study-select :deep(.n-base-selection-label__render-label) {
  position: relative !important;
  top: auto !important;
  right: auto !important;
  bottom: auto !important;
  left: auto !important;
  flex: 1;
  min-width: 0;
  overflow: visible !important;
  padding: 4px 28px 4px 10px; /* right-pad preserves space for the arrow/suffix */
  pointer-events: auto;
}

.training-run-select :deep(.n-base-selection-overlay__wrapper),
.study-select :deep(.n-base-selection-overlay__wrapper) {
  flex-basis: auto !important;
  overflow: visible !important;
  white-space: normal !important;
  word-break: break-word;
}

/*
 * B-098: Add vertical spacing between dropdown option items so multi-line
 * wrapped names are easier to read and visually separated.
 */
.training-run-select :deep(.n-base-select-option),
.study-select :deep(.n-base-select-option) {
  min-height: calc(var(--n-option-height) + 8px);
  align-items: flex-start;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}

.training-run-select :deep(.n-base-select-option__content),
.study-select :deep(.n-base-select-option__content) {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: unset !important;
  line-height: 1.4;
}
</style>
