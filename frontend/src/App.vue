<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { NConfigProvider, NButton, NTag } from 'naive-ui'
import type { TrainingRun, DimensionRole, FilterMode, Preset, SampleJob, SampleJobStatus, JobProgressMessage, InferenceProgressMessage } from './api/types'
import { apiClient } from './api/client'
import { useDimensionMapping } from './composables/useDimensionMapping'
import { useImagePreloader } from './composables/useImagePreloader'
import { useWebSocket } from './composables/useWebSocket'
import { useTheme } from './composables/useTheme'
import { usePresetPersistence } from './composables/usePresetPersistence'
import { useLastTrainingRun } from './composables/useLastTrainingRun'
import AppDrawer from './components/AppDrawer.vue'
import TrainingRunSelector from './components/TrainingRunSelector.vue'
import DimensionPanel from './components/DimensionPanel.vue'
import XYGrid from './components/XYGrid.vue'
import type { ImageClickContext, GridNavItem } from './components/types'
import MasterSlider from './components/MasterSlider.vue'
import ZoomControl from './components/ZoomControl.vue'
import FiltersDrawer from './components/FiltersDrawer.vue'
import PresetSelector from './components/PresetSelector.vue'
import ImageLightbox from './components/ImageLightbox.vue'
import CheckpointMetadataPanel from './components/CheckpointMetadataPanel.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import ComfyUIStatus from './components/ComfyUIStatus.vue'
import JobLaunchDialog from './components/JobLaunchDialog.vue'
import JobProgressPanel from './components/JobProgressPanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'

const { theme, isDark, toggle: toggleTheme } = useTheme()
const { savedData, savePresetSelection, clearPresetSelection } = usePresetPersistence()
const { lastTrainingRunId, saveLastTrainingRun } = useLastTrainingRun()

const selectedTrainingRun = ref<TrainingRun | null>(null)
const scanning = ref(false)
const scanError = ref<string | null>(null)
const lightboxImageUrl = ref<string | null>(null)
const lightboxContext = ref<ImageClickContext | null>(null)
const metadataPanelOpen = ref(false)
const drawerOpen = ref(false)
const jobLaunchDialogOpen = ref(false)
const jobProgressPanelOpen = ref(false)
const settingsDialogOpen = ref(false)
/** Job to prefill into the JobLaunchDialog when regenerating. */
const prefillJob = ref<SampleJob | null>(null)
/** AC5: Debug mode is session-only (ref, not persisted to localStorage). */
const debugMode = ref(false)
const sampleJobs = ref<SampleJob[]>([])
const jobsLoading = ref(false)

const WIDE_BREAKPOINT = 1024

/** True when the viewport is wide enough that the drawer does not overlay content. */
const isWideScreen = ref(false)

function initDrawerState() {
  isWideScreen.value = window.innerWidth >= WIDE_BREAKPOINT
  drawerOpen.value = isWideScreen.value
}

let mediaQuery: MediaQueryList | null = null

function onMediaChange(e: MediaQueryListEvent) {
  isWideScreen.value = e.matches
  drawerOpen.value = e.matches
}

/**
 * Collapse the drawer if we are on a narrow/medium screen where the drawer overlays
 * content. On wide screens the drawer runs side-by-side with the grid, so we leave it open.
 */
function collapseDrawerIfNarrow() {
  if (!isWideScreen.value) {
    drawerOpen.value = false
  }
}

/**
 * Eagerly auto-select a saved training run on mount, regardless of drawer state.
 * On narrow screens the drawer (and TrainingRunSelector) may not mount immediately,
 * so this ensures header buttons and scan data are available right away.
 *
 * The training run ID to restore is resolved from two sources (in priority order):
 *   1. The preset persistence data (trainingRunId saved alongside a preset)
 *   2. The standalone last-training-run persistence (saved on every training run selection)
 *
 * This ensures eager loading works even when no preset has ever been saved.
 */
async function eagerAutoSelect() {
  const trainingRunId = savedData.value?.trainingRunId ?? lastTrainingRunId.value
  if (trainingRunId === null || trainingRunId === undefined) return

  try {
    const runs = await apiClient.getTrainingRuns()
    const run = runs.find((r) => r.id === trainingRunId)
    if (run) {
      await onTrainingRunSelect(run)
    }
  } catch {
    // Silently ignore — TrainingRunSelector will retry when it mounts
  }
}

/**
 * Collapse the drawer when the user uses keyboard navigation keys (Ctrl+Arrow) to
 * cycle through the slider dimension. This allows the user to navigate the grid
 * with the keyboard even when the drawer is open on a narrow screen.
 */
function onGridKeyboardNav(event: KeyboardEvent) {
  const isSliderNav = (event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    || event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.ctrlKey
  if (isSliderNav) {
    collapseDrawerIfNarrow()
  }
}

onMounted(() => {
  initDrawerState()
  mediaQuery = window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`)
  mediaQuery.addEventListener('change', onMediaChange)
  document.addEventListener('keydown', onGridKeyboardNav)
  eagerAutoSelect()
})

onUnmounted(() => {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', onMediaChange)
  }
  document.removeEventListener('keydown', onGridKeyboardNav)
})

function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value
}

function onImageClick(context: ImageClickContext) {
  collapseDrawerIfNarrow()
  lightboxImageUrl.value = context.imageUrl
  lightboxContext.value = context
}

function onLightboxClose() {
  lightboxImageUrl.value = null
  lightboxContext.value = null
}

function onLightboxSliderChange(cellKey: string, value: string) {
  // Update the per-cell slider override
  onSliderValueUpdate(cellKey, value)
  // Also update the lightbox image URL
  if (lightboxContext.value) {
    const newUrl = lightboxContext.value.imagesBySliderValue[value]
    if (newUrl) {
      lightboxImageUrl.value = newUrl
      lightboxContext.value = { ...lightboxContext.value, currentSliderValue: value, imageUrl: newUrl }
    }
  }
}

function onLightboxNavigate(index: number) {
  if (!lightboxContext.value) return
  const gridImages = lightboxContext.value.gridImages
  if (!gridImages || gridImages.length === 0) return
  const clampedIndex = Math.max(0, Math.min(index, gridImages.length - 1))
  const item: GridNavItem = gridImages[clampedIndex]
  lightboxImageUrl.value = item.imageUrl
  lightboxContext.value = {
    ...lightboxContext.value,
    imageUrl: item.imageUrl,
    cellKey: item.cellKey ?? lightboxContext.value.cellKey,
    sliderValues: item.sliderValues,
    currentSliderValue: item.currentSliderValue,
    imagesBySliderValue: item.imagesBySliderValue,
    gridIndex: clampedIndex,
  }
}

const {
  dimensions,
  images,
  assignments,
  filterModes,
  xDimension,
  yDimension,
  sliderDimension,
  setScanResult,
  assignRole,
  setFilterMode,
  getFilterMode,
  addImage,
  removeImage,
} = useDimensionMapping()

/** Preset warnings for unmatched dimensions. */
const presetWarnings = ref<string[]>([])

/** Currently selected preset ID (for tracking and persistence). */
const selectedPresetId = ref<string | null>(null)

/** Combo filter selections: dimension name → set of selected values. */
const comboSelections = reactive<Record<string, Set<string>>>({})

/** Slider values per grid cell (key = "xVal|yVal"). */
const sliderValues = reactive<Record<string, string>>({})

/** Wrap reactive comboSelections as a computed ref for the preloader. */
const comboSelectionsRef = computed(() => comboSelections as Record<string, Set<string>>)

/** Pre-cache images: slider positions for visible cells first, then remaining. */
useImagePreloader(images, xDimension, yDimension, sliderDimension, comboSelectionsRef)

/** Rescan the current training run (used by WebSocket on directory_added). */
async function rescanCurrentTrainingRun() {
  const run = selectedTrainingRun.value
  if (!run) return
  try {
    const result = await apiClient.scanTrainingRun(run.id)
    setScanResult(result)
    // Reinitialize combo selections: all values selected by default
    for (const key of Object.keys(comboSelections)) {
      delete comboSelections[key]
    }
    for (const dim of result.dimensions) {
      comboSelections[dim.name] = new Set(dim.values)
    }
  } catch {
    // Silently ignore rescan failures from WebSocket events
  }
}

/** WebSocket live updates: connect when a training run is selected. */
const { connected: wsConnected, wsClient } = useWebSocket(
  selectedTrainingRun,
  addImage,
  removeImage,
  comboSelections,
  rescanCurrentTrainingRun,
)

/** Job progress data tracked separately from basic job info. */
const jobProgress = reactive<Record<string, {
  checkpoints_completed: number
  total_checkpoints: number
  current_checkpoint?: string
  current_checkpoint_progress?: number
  current_checkpoint_total?: number
  estimated_completion_time?: string
  checkpoint_completeness?: Array<{ checkpoint: string; expected: number; verified: number; missing: number }>
}>>({})

/** Per-sample inference progress keyed by job ID. */
const inferenceProgress = reactive<Record<string, { current_value: number; max_value: number }>>({})

/**
 * Track the previous current_checkpoint_progress per job so we can detect
 * when a new sample starts and reset the inference progress bar.
 */
const prevCheckpointProgress = reactive<Record<string, number>>({})

/** Handle inference progress updates from ComfyUI via WebSocket. */
function handleInferenceProgress(message: InferenceProgressMessage) {
  // Find which job this prompt belongs to by matching against running jobs
  // Since there is only one active prompt at a time, we apply inference progress
  // to the currently running job.
  const runningJob = sampleJobs.value.find(j => j.status === 'running')
  if (runningJob) {
    inferenceProgress[runningJob.id] = {
      current_value: message.current_value,
      max_value: message.max_value,
    }
  }
}

/** Handle job progress updates from WebSocket. */
function handleJobProgress(message: JobProgressMessage) {
  const jobIndex = sampleJobs.value.findIndex(j => j.id === message.job_id)
  if (jobIndex !== -1) {
    const previousStatus = sampleJobs.value[jobIndex].status
    // AC: Capture prevCompleted BEFORE the spread assignment so the comparison below is valid.
    const prevCompleted = sampleJobs.value[jobIndex].completed_items
    sampleJobs.value[jobIndex] = {
      ...sampleJobs.value[jobIndex],
      status: message.status,
      total_items: message.total_items,
      completed_items: message.completed_items,
      failed_items: message.failed_items,
      pending_items: message.pending_items,
      updated_at: new Date().toISOString(),
    }
    // AC: Reset inference progress between samples.
    // When completed_items changes, a sample has just finished and a new one is starting.
    if (message.completed_items !== prevCompleted) {
      delete inferenceProgress[message.job_id]
    }

    // Also reset when the current checkpoint progress changes (new sample within a checkpoint)
    const prevCpProgress = prevCheckpointProgress[message.job_id]
    if (message.current_checkpoint_progress !== undefined && message.current_checkpoint_progress !== prevCpProgress) {
      delete inferenceProgress[message.job_id]
    }
    if (message.current_checkpoint_progress !== undefined) {
      prevCheckpointProgress[message.job_id] = message.current_checkpoint_progress
    }

    // Store checkpoint-level progress separately
    // Estimated completion time would need to be calculated or fetched separately
    // For now, preserve existing value if available
    const existingEta = jobProgress[message.job_id]?.estimated_completion_time
    jobProgress[message.job_id] = {
      checkpoints_completed: message.checkpoints_completed,
      total_checkpoints: message.total_checkpoints,
      current_checkpoint: message.current_checkpoint,
      current_checkpoint_progress: message.current_checkpoint_progress,
      current_checkpoint_total: message.current_checkpoint_total,
      estimated_completion_time: existingEta,
      checkpoint_completeness: message.checkpoint_completeness,
    }
    // AC4: When a job transitions to a terminal status, increment the refresh trigger
    // so the JobLaunchDialog can update its training run options and status beads.
    if (TERMINAL_STATUSES.has(message.status) && !TERMINAL_STATUSES.has(previousStatus)) {
      jobRefreshTrigger.value++
      // Clear inference progress for completed jobs
      delete inferenceProgress[message.job_id]
      delete prevCheckpointProgress[message.job_id]
    }
  } else {
    // New job, fetch the full list
    fetchSampleJobs()
  }
}

// Register job progress and inference progress listeners
onMounted(() => {
  wsClient.onJobProgress(handleJobProgress)
  wsClient.onInferenceProgress(handleInferenceProgress)
})

onUnmounted(() => {
  wsClient.offJobProgress(handleJobProgress)
  wsClient.offInferenceProgress(handleInferenceProgress)
})

async function onTrainingRunSelect(run: TrainingRun) {
  // Skip redundant scan if the same training run is already selected and loaded
  if (selectedTrainingRun.value?.id === run.id && !scanning.value && !scanError.value && dimensions.value.length > 0) {
    return
  }

  // Persist the training run ID independently of preset selection so eager
  // auto-select works on the next page load even without a saved preset.
  saveLastTrainingRun(run.id)

  selectedTrainingRun.value = run
  scanning.value = true
  scanError.value = null

  // Reset combo selections and slider values
  for (const key of Object.keys(comboSelections)) {
    delete comboSelections[key]
  }
  for (const key of Object.keys(sliderValues)) {
    delete sliderValues[key]
  }

  try {
    const result = await apiClient.scanTrainingRun(run.id)
    setScanResult(result)
    // Initialize combo selections: all values selected by default
    for (const dim of result.dimensions) {
      comboSelections[dim.name] = new Set(dim.values)
    }
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to scan training run'
    scanError.value = message
  } finally {
    scanning.value = false
  }
}

function onAssignRole(dimensionName: string, role: DimensionRole) {
  assignRole(dimensionName, role)
}

function onFilterModeChange(dimensionName: string, mode: FilterMode) {
  const prevMode = getFilterMode(dimensionName)
  setFilterMode(dimensionName, mode)

  // When switching to 'single', reduce selection to one value
  if (mode === 'single' && prevMode !== 'single') {
    const current = comboSelections[dimensionName]
    const dim = dimensions.value.find((d) => d.name === dimensionName)
    if (dim) {
      // Pick first previously-selected value that's still valid, or first value
      let singleVal = dim.values[0]
      if (current) {
        for (const v of current) {
          if (dim.values.includes(v)) {
            singleVal = v
            break
          }
        }
      }
      comboSelections[dimensionName] = new Set(singleVal ? [singleVal] : [])
    }
  }

  // When switching to 'hide', restore all values (include everything)
  if (mode === 'hide') {
    const dim = dimensions.value.find((d) => d.name === dimensionName)
    if (dim) {
      comboSelections[dimensionName] = new Set(dim.values)
    }
  }

  // When switching to 'multi' from 'hide', start with all values selected
  if (mode === 'multi' && prevMode === 'hide') {
    const dim = dimensions.value.find((d) => d.name === dimensionName)
    if (dim) {
      comboSelections[dimensionName] = new Set(dim.values)
    }
  }
}

function onFilterUpdate(dimensionName: string, selected: Set<string>) {
  comboSelections[dimensionName] = selected
}

/** Handle header click from XYGrid: solo/unsolo a value in the dimension's filter. */
function onHeaderClick(dimensionName: string, value: string) {
  collapseDrawerIfNarrow()
  const dim = dimensions.value.find((d) => d.name === dimensionName)
  if (!dim) return
  const current = comboSelections[dimensionName]
  // If only this value is selected, re-select all (unsolo)
  if (current && current.size === 1 && current.has(value)) {
    comboSelections[dimensionName] = new Set(dim.values)
  } else {
    // Solo: select only this value
    comboSelections[dimensionName] = new Set([value])
  }
}

/** Master slider value ref. */
const masterSliderValue = ref<string>('')

/** Default slider value: master value if set, otherwise first value of slider dimension. */
const defaultSliderValue = computed(() => {
  if (masterSliderValue.value) return masterSliderValue.value
  return sliderDimension.value?.values[0] ?? ''
})

/** Cell size for grid zoom control. */
const cellSize = ref(200)

/** Right-side filters drawer open/closed state (closed by default). */
const filtersDrawerOpen = ref(false)

function toggleFiltersDrawer() {
  filtersDrawerOpen.value = !filtersDrawerOpen.value
}

// Reset master slider value when slider dimension changes
watch(sliderDimension, (dim) => {
  masterSliderValue.value = dim?.values[0] ?? ''
  for (const key of Object.keys(sliderValues)) {
    delete sliderValues[key]
  }
})

/** Update a single cell's slider value. */
function onSliderValueUpdate(cellKey: string, value: string) {
  sliderValues[cellKey] = value
}

/** Master slider changes all cell slider values in sync. */
function onMasterSliderChange(value: string) {
  masterSliderValue.value = value
  // Clear per-cell overrides so all cells follow the master
  for (const key of Object.keys(sliderValues)) {
    delete sliderValues[key]
  }
}

/** All dimension names from the current scan. */
const dimensionNames = computed(() => dimensions.value.map((d) => d.name))

/**
 * Determine if we should attempt auto-loading a preset.
 * Only auto-load once per training run, and only if the saved training run matches the current one.
 */
const shouldAutoLoadPreset = computed(() => {
  if (!savedData.value) return false
  if (!selectedTrainingRun.value) return false
  return savedData.value.trainingRunId === selectedTrainingRun.value.id
})

/** Load a preset: apply matching dimension assignments, warn about unmatched. */
function onPresetLoad(preset: Preset, warnings: string[]) {
  presetWarnings.value = warnings
  selectedPresetId.value = preset.id

  // Apply the preset mapping to assignments
  const m = preset.mapping
  for (const dim of dimensions.value) {
    if (m.x === dim.name) {
      assignRole(dim.name, 'x')
    } else if (m.y === dim.name) {
      assignRole(dim.name, 'y')
    } else if (m.slider === dim.name) {
      assignRole(dim.name, 'slider')
    } else {
      assignRole(dim.name, 'none')
    }
  }

  // Persist the selection to localStorage
  if (selectedTrainingRun.value) {
    savePresetSelection(selectedTrainingRun.value.id, preset.id)
  }
}

/** Reset dimension assignments when the user clicks New to configure a fresh preset. */
function onPresetNew() {
  presetWarnings.value = []
  selectedPresetId.value = null
  clearPresetSelection()

  // Reset all dimension assignments to 'none'
  for (const dim of dimensions.value) {
    assignRole(dim.name, 'none')
  }
}

function onPresetSave(preset: Preset) {
  presetWarnings.value = []
  selectedPresetId.value = preset.id

  // Persist the new preset selection
  if (selectedTrainingRun.value) {
    savePresetSelection(selectedTrainingRun.value.id, preset.id)
  }
}

function onPresetDelete(presetId: string) {
  presetWarnings.value = []

  // If the deleted preset was the selected one, clear the selection
  if (selectedPresetId.value === presetId) {
    selectedPresetId.value = null
    clearPresetSelection()
  }
}

/** Fetch all sample jobs. */
async function fetchSampleJobs() {
  jobsLoading.value = true
  try {
    sampleJobs.value = await apiClient.listSampleJobs()
  } catch (err: unknown) {
    console.warn('Failed to fetch sample jobs:', err)
    sampleJobs.value = []
  } finally {
    jobsLoading.value = false
  }
}

/** Open the job launch dialog. */
function openJobLaunchDialog() {
  prefillJob.value = null
  jobLaunchDialogOpen.value = true
}

/** Open the job launch dialog pre-populated with settings from a completed job. */
function handleRegenerate(job: SampleJob) {
  jobProgressPanelOpen.value = false
  prefillJob.value = job
  jobLaunchDialogOpen.value = true
}

/** Handle successful job creation. */
function onJobCreated() {
  fetchSampleJobs()
}

/** Stop a sample job. */
async function stopJob(jobId: string) {
  try {
    await apiClient.stopSampleJob(jobId)
    await fetchSampleJobs()
  } catch (err: unknown) {
    console.warn('Failed to stop sample job:', err)
  }
}

/** Resume a sample job. */
async function resumeJob(jobId: string) {
  try {
    await apiClient.resumeSampleJob(jobId)
    await fetchSampleJobs()
  } catch (err: unknown) {
    console.warn('Failed to resume sample job:', err)
  }
}

/** Toggle the job progress panel. */
function toggleJobProgressPanel() {
  jobProgressPanelOpen.value = !jobProgressPanelOpen.value
  if (jobProgressPanelOpen.value) {
    fetchSampleJobs()
  }
}

/**
 * Compute whether the "Generate Samples" button should be prominent (primary style).
 * All viewer-discovered training runs have samples by definition, so this is always false.
 * Kept for potential future use when generation-only runs without samples are visible.
 */
const showProminentGenerateButton = computed(() => {
  return selectedTrainingRun.value && !selectedTrainingRun.value.has_samples
})

/** AC1: Status of the current sidebar-selected training run for header bead. */
type TrainingRunButtonStatus = 'complete' | 'complete_with_errors' | 'running' | 'queued' | 'empty'

function getTrainingRunButtonStatus(run: TrainingRun): TrainingRunButtonStatus {
  const runJobs = sampleJobs.value.filter(j => j.training_run_name === run.name)
  const hasRunning = runJobs.some(j => j.status === 'running')
  const hasQueued = runJobs.some(j => j.status === 'pending' || j.status === 'stopped')
  const hasCompletedWithErrors = runJobs.some(j => j.status === 'completed_with_errors')
  if (hasRunning) return 'running'
  if (hasQueued) return 'queued'
  if (hasCompletedWithErrors) return 'complete_with_errors'
  if (run.has_samples) return 'complete'
  return 'empty'
}

const buttonBeadStatus = computed((): TrainingRunButtonStatus | null => {
  if (!selectedTrainingRun.value) return null
  return getTrainingRunButtonStatus(selectedTrainingRun.value)
})

const buttonBeadColor = computed((): string | null => {
  const status = buttonBeadStatus.value
  if (!status) return null
  const colorMap: Record<TrainingRunButtonStatus, string> = {
    complete: '#18a058',
    complete_with_errors: '#d03050',
    running: '#2080f0',
    queued: '#f0a020',
    empty: '#909090',
  }
  return colorMap[status]
})

/** AC4: Counter incremented when a job completes via WebSocket to trigger dialog refresh. */
const jobRefreshTrigger = ref(0)

/** Terminal job statuses that indicate a job has finished. */
const TERMINAL_STATUSES: Set<SampleJobStatus> = new Set(['completed', 'completed_with_errors', 'failed'])
</script>

<template>
  <NConfigProvider :theme="theme">
    <div class="app" :class="{ 'dark-mode': isDark }">
      <header class="app-header">
        <div class="header-left">
          <NButton
            quaternary
            size="small"
            aria-label="Toggle controls drawer"
            @click="toggleDrawer"
          >
            <span class="hamburger-icon">&#9776;</span>
          </NButton>
          <h1>Checkpoint Sampler</h1>
        </div>
        <div class="header-center">
          <NButton
            v-if="selectedTrainingRun && !scanning && !scanError && dimensions.length > 0"
            size="small"
            aria-label="Toggle filters drawer"
            data-testid="filters-button"
            @click="toggleFiltersDrawer"
          >Filters</NButton>
          <div v-if="sliderDimension" class="header-master-slider">
            <MasterSlider
              :values="sliderDimension.values"
              :current-value="defaultSliderValue"
              :dimension-name="sliderDimension.name"
              @change="onMasterSliderChange"
            />
          </div>
        </div>
        <div class="header-controls">
          <ZoomControl
            v-if="selectedTrainingRun && !scanning && !scanError"
            :cell-size="cellSize"
            class="header-zoom"
            @update:cell-size="cellSize = $event"
          />
          <NButton
            v-if="selectedTrainingRun && !scanning && !scanError"
            :type="showProminentGenerateButton ? 'primary' : 'default'"
            size="small"
            aria-label="Generate samples"
            data-testid="generate-samples-button"
            @click="openJobLaunchDialog"
          >
            Generate Samples
          </NButton>
          <NButton
            v-if="selectedTrainingRun && !scanning && !scanError"
            size="small"
            aria-label="Toggle sample jobs panel"
            @click="toggleJobProgressPanel"
          >
            <span
              v-if="buttonBeadColor"
              class="header-bead"
              :style="{ backgroundColor: buttonBeadColor }"
              :title="buttonBeadStatus ?? ''"
              data-testid="jobs-bead"
            ></span>
            Jobs
          </NButton>
          <NButton
            v-if="selectedTrainingRun && !scanning && !scanError"
            size="small"
            aria-label="Toggle checkpoint metadata panel"
            @click="metadataPanelOpen = !metadataPanelOpen"
          >Metadata</NButton>
          <NTag
            v-if="selectedTrainingRun"
            :type="wsConnected ? 'success' : 'default'"
            size="small"
            :title="wsConnected ? 'Live updates connected' : 'Live updates disconnected'"
            role="status"
          >{{ wsConnected ? 'Live' : 'Disconnected' }}</NTag>
          <NButton
            size="small"
            aria-label="Open settings"
            data-testid="settings-button"
            @click="settingsDialogOpen = true"
          >Settings</NButton>
          <NButton
            size="small"
            :type="debugMode ? 'warning' : 'default'"
            aria-label="Toggle debug mode"
            data-testid="debug-toggle"
            @click="debugMode = !debugMode"
          >Debug</NButton>
          <ComfyUIStatus />
          <ThemeToggle :is-dark="isDark" @toggle="toggleTheme" />
        </div>
      </header>
      <AppDrawer v-model:show="drawerOpen">
        <div class="drawer-section">
          <TrainingRunSelector
            :auto-select-run-id="savedData?.trainingRunId ?? lastTrainingRunId ?? null"
            @select="onTrainingRunSelect"
          />
        </div>
        <template v-if="selectedTrainingRun && !scanning && !scanError">
          <div class="drawer-section">
            <PresetSelector
              :assignments="assignments"
              :dimension-names="dimensionNames"
              :auto-load-preset-id="shouldAutoLoadPreset ? savedData?.presetId ?? null : null"
              @load="onPresetLoad"
              @save="onPresetSave"
              @delete="onPresetDelete"
              @new="onPresetNew"
            />
            <p v-if="presetWarnings.length > 0" class="warning" role="status">
              Unmatched dimensions from preset: {{ presetWarnings.join(', ') }}
            </p>
          </div>
          <div class="drawer-section">
            <DimensionPanel
              :dimensions="dimensions"
              :assignments="assignments"
              :filter-modes="filterModes"
              @assign="onAssignRole"
              @update:filter-mode="onFilterModeChange"
            />
          </div>
        </template>
      </AppDrawer>
      <main class="app-main">
        <p v-if="!selectedTrainingRun">Select a training run to get started.</p>
        <template v-else>
          <p v-if="scanning">Scanning...</p>
          <p v-else-if="scanError" class="error" role="alert">{{ scanError }}</p>
          <template v-else>
            <XYGrid
              :x-dimension="xDimension"
              :y-dimension="yDimension"
              :images="images"
              :combo-selections="comboSelections"
              :slider-dimension="sliderDimension"
              :slider-values="sliderValues"
              :default-slider-value="defaultSliderValue"
              :cell-size="cellSize"
              :debug-mode="debugMode"
              @update:slider-value="onSliderValueUpdate"
              @update:cell-size="cellSize = $event"
              @image:click="onImageClick"
              @header:click="onHeaderClick"
            />
          </template>
        </template>
      </main>
      <ImageLightbox
        v-if="lightboxImageUrl"
        :image-url="lightboxImageUrl"
        :cell-key="lightboxContext?.cellKey ?? null"
        :slider-values="lightboxContext?.sliderValues ?? []"
        :current-slider-value="lightboxContext?.currentSliderValue ?? ''"
        :images-by-slider-value="lightboxContext?.imagesBySliderValue ?? {}"
        :slider-dimension-name="sliderDimension?.name ?? ''"
        :grid-images="lightboxContext?.gridImages ?? []"
        :grid-index="lightboxContext?.gridIndex ?? 0"
        @close="onLightboxClose"
        @slider-change="onLightboxSliderChange"
        @navigate="onLightboxNavigate"
      />
      <CheckpointMetadataPanel
        v-if="metadataPanelOpen && selectedTrainingRun"
        :checkpoints="selectedTrainingRun.checkpoints"
        @close="metadataPanelOpen = false"
      />
      <FiltersDrawer
        v-model:show="filtersDrawerOpen"
        :dimensions="dimensions"
        :combo-selections="comboSelections"
        :get-filter-mode="getFilterMode"
        @filter-update="onFilterUpdate"
      />
      <JobLaunchDialog
        v-model:show="jobLaunchDialogOpen"
        :refresh-trigger="jobRefreshTrigger"
        :prefill-job="prefillJob"
        @success="onJobCreated"
      />
      <JobProgressPanel
        :show="jobProgressPanelOpen"
        :jobs="sampleJobs"
        :job-progress="jobProgress"
        :inference-progress="inferenceProgress"
        :loading="jobsLoading"
        @stop="stopJob"
        @resume="resumeJob"
        @regenerate="handleRegenerate"
        @refresh="fetchSampleJobs"
        @close="jobProgressPanelOpen = false"
      />
      <SettingsDialog
        v-model:show="settingsDialogOpen"
      />
    </div>
  </NConfigProvider>
</template>

<style scoped>
.app {
  --border-color: #e0e0e0;
  --bg-color: #ffffff;
  --text-color: #333333;
  --text-secondary: #666666;
  --bg-surface: #f5f5f5;
  --error-color: #d32f2f;
  --warning-color: #f57c00;
  --accent-color: #1976d2;
  --accent-bg: #e3f2fd;

  font-family: system-ui, -apple-system, sans-serif;
  max-width: 100vw;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-color);
  color: var(--text-color);
  overflow-x: hidden;
}

.app.dark-mode {
  --border-color: #3a3a3a;
  --bg-color: #1a1a1a;
  --text-color: #e0e0e0;
  --text-secondary: #aaaaaa;
  --bg-surface: #2a2a2a;
  --error-color: #f44336;
  --warning-color: #ffb74d;
  --accent-color: #90caf9;
  --accent-bg: #1e3a5f;
}

.app-header {
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.app-header h1 {
  margin: 0;
  font-size: 1.25rem;
  white-space: nowrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hamburger-icon {
  font-size: 1.25rem;
  line-height: 1;
}

.app-main {
  padding: 1rem;
  flex: 1;
}


.error {
  color: var(--error-color);
}

.warning {
  color: var(--warning-color);
  font-size: 0.875rem;
}

.header-center {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.header-master-slider {
  flex: 1;
  min-width: 0;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Compact zoom control wrapper in header */
.header-zoom {
  display: flex;
  align-items: center;
  min-width: 160px;
  max-width: 200px;
}

.header-bead {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 0.375rem;
  flex-shrink: 0;
}

.drawer-section {
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.drawer-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

@media (max-width: 767px) {
  .app-header {
    padding: 0.5rem;
  }

  .app-header h1 {
    font-size: 1rem;
  }

  .app-main {
    padding: 0.5rem;
  }

  .header-center {
    order: 3;
    flex-basis: 100%;
  }

  .header-zoom {
    min-width: 120px;
  }
}
</style>
