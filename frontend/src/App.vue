<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { NConfigProvider, NButton, NTag } from 'naive-ui'
import type { TrainingRun, DimensionRole, FilterMode, UnifiedDimensionMode, Preset, SampleJob, SampleJobStatus, JobProgressMessage, InferenceProgressMessage, CurrentSampleParams } from './api/types'
import { apiClient } from './api/client'
import { useDimensionMapping } from './composables/useDimensionMapping'
import { useImagePreloader } from './composables/useImagePreloader'
import { useWebSocket } from './composables/useWebSocket'
import { useTheme } from './composables/useTheme'
import { usePresetPersistence } from './composables/usePresetPersistence'
import { useLastTrainingRun } from './composables/useLastTrainingRun'
import { computePresetWarnings } from './composables/presetWarnings'
import { getBeadStatus, BEAD_COLORS } from './composables/beadStatus'
import type { BeadStatus } from './composables/beadStatus'
import AppDrawer from './components/AppDrawer.vue'
import TrainingRunSelector from './components/TrainingRunSelector.vue'
import DimensionPanel from './components/DimensionPanel.vue'
import XYGrid from './components/XYGrid.vue'
import type { ImageClickContext, GridNavItem } from './components/types'
import MasterSlider from './components/MasterSlider.vue'
import AnimationControls from './components/AnimationControls.vue'
import ZoomControl from './components/ZoomControl.vue'
import FiltersDrawer from './components/FiltersDrawer.vue'
import PresetSelector from './components/PresetSelector.vue'
import ImageLightbox from './components/ImageLightbox.vue'
import CheckpointMetadataPanel from './components/CheckpointMetadataPanel.vue'
import ComfyUIStatus from './components/ComfyUIStatus.vue'
import JobLaunchDialog from './components/JobLaunchDialog.vue'
import JobProgressPanel from './components/JobProgressPanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import ValidationResultsDialog from './components/ValidationResultsDialog.vue'
import type { ValidationResult } from './api/types'

const { theme, isDark, toggle: toggleTheme } = useTheme()
const { getPresetIdForCombo, savePresetSelection, clearPresetForCombo } = usePresetPersistence()
const { lastTrainingRunId, saveLastTrainingRun, saveLastStudy } = useLastTrainingRun()

/** The study output dir for the currently selected training run. */
const selectedStudyOutputDir = ref('')

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
/** When true, the JobLaunchDialog pre-checks "Generate missing samples only". */
const prefillMissingOnly = ref(false)
/** AC5: Debug mode is session-only (ref, not persisted to localStorage). */
const debugMode = ref(false)
const sampleJobs = ref<SampleJob[]>([])
const jobsLoading = ref(false)
/** The ID of the job currently being stopped, or null when no stop is in progress. */
const stoppingJobId = ref<string | null>(null)

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
  const trainingRunId = lastTrainingRunId.value
  if (trainingRunId === null || trainingRunId === undefined) return

  try {
    const runs = await apiClient.getTrainingRuns()
    const run = runs.find((r) => r.id === trainingRunId)
    if (run) {
      await onTrainingRunSelect(run, run.study_output_dir || '')
      // AC1/AC2 (B-101): After the training run is selected and scan completes,
      // eagerly restore the saved preset so dimension assignments are applied
      // without waiting for the drawer (PresetSelector) to mount/open.
      await eagerRestorePreset()
    }
  } catch {
    // Silently ignore — TrainingRunSelector will retry when it mounts
  }
}

/**
 * AC1/AC2 (B-101): Eagerly restore the saved preset from localStorage.
 * This ensures dimension assignments are applied on initial load even when the
 * side panel (drawer) is collapsed on narrow screens. Without this, the preset
 * is only loaded when PresetSelector mounts inside the drawer, which on narrow
 * screens doesn't happen until the user opens the panel.
 */
/**
 * Flag indicating that eagerRestorePreset() already fetched and applied a preset.
 * When true, PresetSelector.attemptAutoLoad() can skip its redundant getPresets call
 * by passing a null autoLoadPresetId.
 */
const presetRestoredEagerly = ref(false)

async function eagerRestorePreset() {
  const run = selectedTrainingRun.value
  if (!run) return
  const presetId = getPresetIdForCombo(run.id, selectedStudyOutputDir.value)
  if (!presetId) return

  try {
    const presets = await apiClient.getPresets()
    const preset = presets.find((p) => p.id === presetId)
    if (preset) {
      const warnings = computePresetWarnings(preset, dimensionNames.value)
      onPresetLoad(preset, warnings)
      presetRestoredEagerly.value = true
    } else {
      // Preset no longer exists — clear stale persistence for this combo
      clearPresetForCombo(run.id, selectedStudyOutputDir.value)
    }
  } catch {
    // Silently ignore — PresetSelector will retry when it mounts
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

function onLightboxSliderChange(_cellKey: string, value: string) {
  // Propagate lightbox slider changes to the master slider (and clear per-cell overrides)
  // so all cells and the master slider stay in sync (AC1, AC2 — B-068).
  onMasterSliderChange(value)
  // Also update the lightbox image URL to reflect the new slider value
  if (lightboxContext.value) {
    const newUrl = lightboxContext.value.imagesBySliderValue[value]
    if (newUrl) {
      lightboxImageUrl.value = newUrl
      lightboxContext.value = {
        ...lightboxContext.value,
        currentSliderValue: value,
        imageUrl: newUrl,
        debugInfo: lightboxContext.value.debugInfo
          ? { ...lightboxContext.value.debugInfo, sliderValue: value }
          : undefined,
      }
    }
  }
}

function onLightboxNavigate(index: number) {
  if (!lightboxContext.value) return
  const gridImages = lightboxContext.value.gridImages
  if (!gridImages || gridImages.length === 0) return
  const clampedIndex = Math.max(0, Math.min(index, gridImages.length - 1))
  const item: GridNavItem = gridImages[clampedIndex]
  // Use the live master slider value instead of the stale snapshot value so all sliders
  // stay in sync after Shift+Arrow navigation (AC2, AC3 — B-068).
  const liveSliderValue = defaultSliderValue.value || item.currentSliderValue
  const liveImageUrl = item.imagesBySliderValue[liveSliderValue] ?? item.imageUrl
  lightboxImageUrl.value = liveImageUrl
  lightboxContext.value = {
    ...lightboxContext.value,
    imageUrl: liveImageUrl,
    cellKey: item.cellKey ?? lightboxContext.value.cellKey,
    sliderValues: item.sliderValues,
    currentSliderValue: liveSliderValue,
    imagesBySliderValue: item.imagesBySliderValue,
    gridIndex: clampedIndex,
    debugInfo: item.debugInfo,
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
  xSliderDimension,
  ySliderDimension,
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
    const result = await apiClient.scanTrainingRun(run.id, selectedStudyOutputDir.value || undefined)
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
  checkpoint_completeness?: Array<{ checkpoint: string; expected: number; verified: number; missing: number }>
  sample_eta_seconds?: number
  job_eta_seconds?: number
  current_sample_params?: CurrentSampleParams
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
    const existing = inferenceProgress[runningJob.id]
    // AC: Only update inference progress if this is a fresh start (no existing entry) or
    // the value is moving forward. This prevents out-of-order stale WebSocket events from
    // a completed sample from flipping the progress bar back to a lower value (flip-flop fix).
    if (!existing || message.current_value >= existing.current_value) {
      inferenceProgress[runningJob.id] = {
        current_value: message.current_value,
        max_value: message.max_value,
      }
    }
    // AC (B-067): Ensure jobProgress is initialized before the first job_progress event arrives.
    // Without this, inference progress events that arrive before the first job_progress event
    // would not display the progress bar because hasCheckpointProgress() would return false
    // (it checks total_checkpoints > 0). Use a placeholder with total_checkpoints: 1 so
    // the inference bar renders immediately; this is overwritten by the first job_progress event.
    if (!jobProgress[runningJob.id]) {
      jobProgress[runningJob.id] = {
        checkpoints_completed: 0,
        total_checkpoints: 1,
      }
    }
    // AC: Update per-sample ETA in jobProgress from inference_progress events.
    // This gives live ETA updates during sample generation, based on step completion rate.
    if (message.sample_eta_seconds !== undefined && message.sample_eta_seconds > 0) {
      const existing = jobProgress[runningJob.id]
      jobProgress[runningJob.id] = {
        ...(existing ?? { checkpoints_completed: 0, total_checkpoints: 1 }),
        sample_eta_seconds: message.sample_eta_seconds,
      }
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
      failed_item_details: message.failed_item_details,
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

    // Store checkpoint-level progress separately with ETA data from the backend.
    // AC (S-098 UAT): Preserve existing sample_eta_seconds when the job_progress event does
    // not include one — unless a sample just completed (completed_items increased), in which
    // case we clear it because no sample is currently running.
    // This ensures the ETA set by inference_progress events is not erased by the
    // start-of-sample job_progress broadcast that arrives before inference begins.
    const incomingSampleETA = message.sample_eta_seconds !== undefined
      ? message.sample_eta_seconds
      : (message.completed_items > prevCompleted
        ? undefined
        : jobProgress[message.job_id]?.sample_eta_seconds)

    jobProgress[message.job_id] = {
      checkpoints_completed: message.checkpoints_completed,
      total_checkpoints: message.total_checkpoints,
      current_checkpoint: message.current_checkpoint,
      current_checkpoint_progress: message.current_checkpoint_progress,
      current_checkpoint_total: message.current_checkpoint_total,
      checkpoint_completeness: message.checkpoint_completeness,
      sample_eta_seconds: incomingSampleETA,
      job_eta_seconds: message.job_eta_seconds,
      current_sample_params: message.current_sample_params,
    }
    // Increment refresh trigger whenever job status changes so the JobLaunchDialog
    // can update training run options and status beads for any status transition
    // (including pending → running, not just terminal statuses).
    if (message.status !== previousStatus) {
      jobRefreshTrigger.value++
    }
    // Clear inference progress for completed jobs; also signal TrainingRunSelector to refresh
    // so newly generated sample sets appear automatically (AC1-2, B-105).
    if (TERMINAL_STATUSES.has(message.status) && !TERMINAL_STATUSES.has(previousStatus)) {
      delete inferenceProgress[message.job_id]
      delete prevCheckpointProgress[message.job_id]
      trainingRunsRefreshTrigger.value++
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

async function onTrainingRunSelect(run: TrainingRun, studyOutputDir: string) {
  selectedStudyOutputDir.value = studyOutputDir

  // Skip redundant scan if the same training run is already selected.
  // Two cases:
  //   1. Already loaded (not scanning, no error, dimensions available) — nothing to do.
  //   2. Currently scanning the same run — a concurrent scan is already in flight
  //      (e.g. eagerAutoSelect started a scan and TrainingRunSelector emitted select
  //      for the same run before the scan completed). Proceeding would launch a
  //      duplicate scan whose setScanResult would reset preset assignments applied
  //      by eagerRestorePreset (race condition: B-101 UAT fix).
  if (selectedTrainingRun.value?.id === run.id) {
    const alreadyLoaded = !scanning.value && !scanError.value && dimensions.value.length > 0
    const scanInFlight = scanning.value
    if (alreadyLoaded || scanInFlight) {
      return
    }
  }

  // Persist the training run ID independently of preset selection so eager
  // auto-select works on the next page load even without a saved preset.
  saveLastTrainingRun(run.id)

  // AC2: Reset the eager-restore flag so PresetSelector can auto-load the stored
  // preset for the newly selected TR+study combo via autoLoadPresetIdForCurrentCombo.
  presetRestoredEagerly.value = false
  selectedPresetId.value = null
  presetWarnings.value = []

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
    const result = await apiClient.scanTrainingRun(run.id, studyOutputDir || undefined)
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

/**
 * Handle the unified dimension mode change from DimensionPanel.
 * Decomposes a UnifiedDimensionMode into role assignment and filter mode changes.
 * Axis modes ('x', 'y', 'slider') assign the dimension to that axis.
 * Filter modes ('single', 'multi', 'hide') unassign the dimension and set the filter.
 */
function onDimensionModeChange(dimensionName: string, mode: UnifiedDimensionMode) {
  const AXIS_MODES: Set<string> = new Set(['x', 'y', 'slider', 'x_slider', 'y_slider'])

  // Capture effective mode before any changes for transition logic
  const prevMode = getFilterMode(dimensionName)

  if (AXIS_MODES.has(mode)) {
    const newRole = mode as DimensionRole
    // Capture the current unified mode of the dimension being changed
    const currentRole = assignments.value.get(dimensionName) ?? 'none'
    const currentFilterMode = filterModes.value.get(dimensionName) ?? 'single'

    // Find which dimension currently holds the target axis role
    let displacedName: string | null = null
    for (const [name, role] of assignments.value) {
      if (role === newRole && name !== dimensionName) {
        displacedName = name
        break
      }
    }

    // Assign the new axis role (composable displaces old holder to 'none')
    assignRole(dimensionName, newRole)

    // Swap: give the displaced dimension the previous role of the changed dimension
    if (displacedName) {
      if (currentRole !== 'none') {
        // Both had axis roles — swap them
        assignRole(displacedName, currentRole)
      } else {
        // Changed dimension was a filter mode — give displaced dimension that filter mode
        assignRole(displacedName, 'none')
        setFilterMode(displacedName, currentFilterMode)
      }
    }
  } else {
    // Unassign from any axis (set role to 'none')
    assignRole(dimensionName, 'none')
    // Then apply the selected filter mode
    const filterMode = mode as FilterMode
    setFilterMode(dimensionName, filterMode)

    // Adjust combo selections based on filter mode transitions
    if (filterMode === 'single' && prevMode !== 'single') {
      const current = comboSelections[dimensionName]
      const dim = dimensions.value.find((d) => d.name === dimensionName)
      if (dim) {
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

    if (filterMode === 'hide') {
      const dim = dimensions.value.find((d) => d.name === dimensionName)
      if (dim) {
        comboSelections[dimensionName] = new Set(dim.values)
      }
    }

    if (filterMode === 'multi' && (prevMode === 'hide' || prevMode === 'single')) {
      const dim = dimensions.value.find((d) => d.name === dimensionName)
      if (dim) {
        comboSelections[dimensionName] = new Set(dim.values)
      }
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

/** X slider value: the currently selected value shown in the bottom slider. */
const xSliderValue = ref<string>('')

/** Effective X slider value: xSliderValue if set, otherwise first value of xSliderDimension. */
const currentXSliderValue = computed(() => {
  if (xSliderValue.value) return xSliderValue.value
  return xSliderDimension.value?.values[0] ?? ''
})

/** Y slider value: the currently selected value shown in the right slider. */
const ySliderValue = ref<string>('')

/** Effective Y slider value: ySliderValue if set, otherwise first value of ySliderDimension. */
const currentYSliderValue = computed(() => {
  if (ySliderValue.value) return ySliderValue.value
  return ySliderDimension.value?.values[0] ?? ''
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

// Reset X slider value when X slider dimension changes
watch(xSliderDimension, (dim) => {
  xSliderValue.value = dim?.values[0] ?? ''
  if (dim) {
    comboSelections[dim.name] = new Set(dim.values)
  }
})

// Reset Y slider value when Y slider dimension changes
watch(ySliderDimension, (dim) => {
  ySliderValue.value = dim?.values[0] ?? ''
  if (dim) {
    comboSelections[dim.name] = new Set(dim.values)
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

/** X slider: navigate to a specific X slider dimension value (solo that value in comboSelections). */
function onXSliderChange(value: string) {
  xSliderValue.value = value
  const dim = xSliderDimension.value
  if (dim) {
    comboSelections[dim.name] = new Set([value])
  }
}

/** Y slider: navigate to a specific Y slider dimension value (solo that value in comboSelections). */
function onYSliderChange(value: string) {
  ySliderValue.value = value
  const dim = ySliderDimension.value
  if (dim) {
    comboSelections[dim.name] = new Set([value])
  }
}

/** All dimension names from the current scan. */
const dimensionNames = computed(() => dimensions.value.map((d) => d.name))

/**
 * The preset ID to auto-load for the currently selected TR+study combo.
 * Returns null when no preset is stored for the combo, or when the eager
 * restore path already applied the preset (to avoid a redundant API call).
 */
const autoLoadPresetIdForCurrentCombo = computed((): string | null => {
  if (presetRestoredEagerly.value) return null
  if (!selectedTrainingRun.value) return null
  return getPresetIdForCombo(selectedTrainingRun.value.id, selectedStudyOutputDir.value)
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
    } else if (m.x_slider === dim.name) {
      assignRole(dim.name, 'x_slider')
    } else if (m.y_slider === dim.name) {
      assignRole(dim.name, 'y_slider')
    } else {
      assignRole(dim.name, 'none')
    }
  }

  // AC1: Persist the selection to localStorage keyed by TR+study combo
  if (selectedTrainingRun.value) {
    savePresetSelection(selectedTrainingRun.value.id, selectedStudyOutputDir.value, preset.id)
  }
}

/** Reset dimension assignments when the user clicks New to configure a fresh preset. */
function onPresetNew() {
  presetWarnings.value = []
  selectedPresetId.value = null
  // Clear the stored preset for the current TR+study combo
  if (selectedTrainingRun.value) {
    clearPresetForCombo(selectedTrainingRun.value.id, selectedStudyOutputDir.value)
  }

  // Reset all dimension assignments to 'none'
  for (const dim of dimensions.value) {
    assignRole(dim.name, 'none')
  }
}

function onPresetSave(preset: Preset) {
  presetWarnings.value = []
  selectedPresetId.value = preset.id

  // AC1: Persist the new preset selection keyed by TR+study combo
  if (selectedTrainingRun.value) {
    savePresetSelection(selectedTrainingRun.value.id, selectedStudyOutputDir.value, preset.id)
  }
}

function onPresetDelete(presetId: string) {
  presetWarnings.value = []

  // If the deleted preset was the selected one, clear the selection for the current combo
  if (selectedPresetId.value === presetId) {
    selectedPresetId.value = null
    if (selectedTrainingRun.value) {
      clearPresetForCombo(selectedTrainingRun.value.id, selectedStudyOutputDir.value)
    }
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
  prefillMissingOnly.value = false
  jobLaunchDialogOpen.value = true
}

/** Open the job launch dialog pre-populated with settings from a completed job. */
function handleRegenerate(job: SampleJob) {
  jobProgressPanelOpen.value = false
  prefillJob.value = job
  prefillMissingOnly.value = false
  jobLaunchDialogOpen.value = true
}

/**
 * AC4-6 (S-117): Open job launch dialog from validation results dialog.
 * Pre-checks "Generate missing samples only" per AC5, and closes the validation dialog.
 */
function handleValidationRegenerate(job: SampleJob) {
  // AC6: Validation dialog closes when Generate Samples dialog opens (handled in
  // ValidationResultsDialog which emits 'regenerate', and we set the validation
  // dialog show state to false from the respective component's close handler)
  prefillJob.value = job
  prefillMissingOnly.value = true
  jobLaunchDialogOpen.value = true
}

/** Handle successful job creation. Opens the job progress panel so the user sees job activity. */
function onJobCreated() {
  fetchSampleJobs()
  // B-106 AC3: Show job progress after job creation (including regeneration)
  jobProgressPanelOpen.value = true
}

/** Stop a sample job. */
async function stopJob(jobId: string) {
  stoppingJobId.value = jobId
  try {
    await apiClient.stopSampleJob(jobId)
    await fetchSampleJobs()
  } catch (err: unknown) {
    console.warn('Failed to stop sample job:', err)
  } finally {
    stoppingJobId.value = null
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

/** Retry failed items in a completed_with_errors job. */
async function retryFailedJob(jobId: string) {
  try {
    await apiClient.retryFailedSampleJob(jobId)
    await fetchSampleJobs()
  } catch (err: unknown) {
    console.warn('Failed to retry failed job items:', err)
  }
}

/** Delete a sample job, optionally removing its sample data from disk. */
async function deleteJob(jobId: string, deleteData: boolean) {
  try {
    await apiClient.deleteSampleJob(jobId, deleteData)
    await fetchSampleJobs()
  } catch (err: unknown) {
    console.warn('Failed to delete sample job:', err)
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

/** AC1–AC5 (B-051): Bead status and color for the Jobs nav button. */
const buttonBeadStatus = computed((): BeadStatus | null => {
  if (!selectedTrainingRun.value) return null
  return getBeadStatus(selectedTrainingRun.value, sampleJobs.value)
})

const buttonBeadColor = computed((): string | null => {
  const status = buttonBeadStatus.value
  if (!status) return null
  return BEAD_COLORS[status]
})

/** AC4: Counter incremented when a job completes via WebSocket to trigger dialog refresh. */
const jobRefreshTrigger = ref(0)

/**
 * AC1-2 (B-105): Counter incremented when a job reaches a terminal status via WebSocket.
 * Passed to TrainingRunSelector so it automatically refreshes after sample generation completes,
 * making new sample sets visible without a manual refresh click.
 */
const trainingRunsRefreshTrigger = ref(0)

/** Terminal job statuses that indicate a job has finished. */
const TERMINAL_STATUSES: Set<SampleJobStatus> = new Set(['completed', 'completed_with_errors', 'failed'])

/** State for the slideout-level validation dialog (no job context). */
const slideoutValidationDialogShow = ref(false)
const slideoutValidationResult = ref<ValidationResult | null>(null)
const slideoutValidationError = ref<string | null>(null)
const slideoutValidationLoading = ref(false)

/** Open the validation dialog from the controls slideout for the selected training run. */
async function handleSlideoutValidate() {
  if (!selectedTrainingRun.value) return
  slideoutValidationResult.value = null
  slideoutValidationError.value = null
  slideoutValidationLoading.value = true
  slideoutValidationDialogShow.value = true

  try {
    const result = await apiClient.validateTrainingRun(selectedTrainingRun.value.id, undefined, selectedStudyOutputDir.value || undefined)
    slideoutValidationResult.value = result
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Validation failed'
    slideoutValidationError.value = message
  } finally {
    slideoutValidationLoading.value = false
  }
}
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
        </div>
        <div class="header-center">
          <NButton
            v-if="selectedTrainingRun && !scanning && !scanError && dimensions.length > 0"
            size="small"
            aria-label="Toggle filters drawer"
            data-testid="filters-button"
            @click="toggleFiltersDrawer"
          >Filters</NButton>
          <AnimationControls
            v-if="sliderDimension"
            :values="sliderDimension.values"
            :current-value="defaultSliderValue"
            :dimension-name="sliderDimension.name"
            @change="onMasterSliderChange"
          />
        </div>
        <div class="header-controls">
          <ZoomControl
            v-if="selectedTrainingRun && !scanning && !scanError"
            :cell-size="cellSize"
            class="header-zoom"
            @update:cell-size="cellSize = $event"
          />
          <NButton
            :type="showProminentGenerateButton ? 'primary' : 'default'"
            size="small"
            aria-label="Generate samples"
            data-testid="generate-samples-button"
            @click="openJobLaunchDialog"
          >
            Generate Samples
          </NButton>
          <NButton
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
          <ComfyUIStatus />
        </div>
      </header>
      <AppDrawer v-model:show="drawerOpen">
        <div class="drawer-section">
          <TrainingRunSelector
            :auto-select-run-id="lastTrainingRunId ?? null"
            :refresh-trigger="trainingRunsRefreshTrigger"
            @select="onTrainingRunSelect"
          />
          <!-- AC: FE: Validate button in main controls slideout panel -->
          <div v-if="selectedTrainingRun && !scanning && !scanError" class="slideout-validate-row">
            <NButton
              size="small"
              data-testid="slideout-validate-button"
              :loading="slideoutValidationLoading"
              :disabled="slideoutValidationLoading"
              @click="handleSlideoutValidate"
            >
              Validate
            </NButton>
          </div>
        </div>
        <template v-if="selectedTrainingRun && !scanning && !scanError">
          <div class="drawer-section">
            <PresetSelector
              :assignments="assignments"
              :filter-modes="filterModes"
              :dimension-names="dimensionNames"
              :auto-load-preset-id="autoLoadPresetIdForCurrentCombo"
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
              @update:mode="onDimensionModeChange"
            />
          </div>
        </template>
      </AppDrawer>
      <main class="app-main" :class="{ 'app-main--x-slider-visible': !!xSliderDimension, 'app-main--y-slider-visible': !!ySliderDimension }">
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
        :grid-column-count="lightboxContext?.gridColumnCount ?? 0"
        :debug-mode="debugMode"
        :debug-info="lightboxContext?.debugInfo"
        :x-slider-values="xSliderDimension?.values ?? []"
        :current-x-slider-value="currentXSliderValue"
        :x-dimension-name="xSliderDimension?.name ?? ''"
        :y-slider-values="ySliderDimension?.values ?? []"
        :current-y-slider-value="currentYSliderValue"
        :y-dimension-name="ySliderDimension?.name ?? ''"
        @close="onLightboxClose"
        @slider-change="onLightboxSliderChange"
        @navigate="onLightboxNavigate"
        @x-slider-change="onXSliderChange"
        @y-slider-change="onYSliderChange"
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
        :prefill-missing-only="prefillMissingOnly"
        @success="onJobCreated"
      />
      <JobProgressPanel
        :show="jobProgressPanelOpen"
        :jobs="sampleJobs"
        :job-progress="jobProgress"
        :inference-progress="inferenceProgress"
        :loading="jobsLoading"
        :stopping-job-id="stoppingJobId"
        @stop="stopJob"
        @resume="resumeJob"
        @retry-failed="retryFailedJob"
        @regenerate="handleRegenerate"
        @validate-regenerate="handleValidationRegenerate"
        @delete="deleteJob"
        @refresh="fetchSampleJobs"
        @close="jobProgressPanelOpen = false"
      />
      <SettingsDialog
        v-model:show="settingsDialogOpen"
        :is-dark="isDark"
        :debug-mode="debugMode"
        @toggle-theme="toggleTheme"
        @update:debug-mode="debugMode = $event"
      />
      <!-- AC: FE: Validation results dialog for controls slideout validate (no job context) -->
      <ValidationResultsDialog
        :show="slideoutValidationDialogShow"
        :result="slideoutValidationResult"
        :error="slideoutValidationError"
        :loading="slideoutValidationLoading"
        :job="null"
        :title="selectedTrainingRun ? `Validation: ${selectedTrainingRun.study_label ? selectedTrainingRun.study_label + ' (' + (selectedTrainingRun.training_run_dir || selectedTrainingRun.name) + ')' : selectedTrainingRun.name}` : 'Validation Results'"
        @close="slideoutValidationDialogShow = false"
        @regenerate="handleValidationRegenerate"
      />
      <!-- AC: X slider pinned to bottom of viewport; hidden when no X Slider dimension mapping -->
      <div
        v-if="xSliderDimension"
        class="x-slider-bar"
        data-testid="x-slider-bar"
      >
        <MasterSlider
          :values="xSliderDimension.values"
          :current-value="currentXSliderValue"
          :dimension-name="xSliderDimension.name"
          data-testid="x-master-slider"
          @change="onXSliderChange"
        />
      </div>
      <!-- AC: Y slider pinned to right edge of viewport; hidden when no Y Slider dimension mapping -->
      <div
        v-if="ySliderDimension"
        class="y-slider-bar"
        data-testid="y-slider-bar"
      >
        <MasterSlider
          :values="ySliderDimension.values"
          :current-value="currentYSliderValue"
          :dimension-name="ySliderDimension.name"
          data-testid="y-master-slider"
          @change="onYSliderChange"
        />
      </div>
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
  --play-icon-color: #22c55e;

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
  --play-icon-color: #4ade80;
}

.app-header {
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;

  /* Ensure header stacks above the fixed Y slider bar (z-index 90)
     so header buttons remain clickable in the overlap region (B-111). */
  position: relative;
  z-index: 100;
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

/* AC3: Add bottom padding when X slider is visible so content is not hidden behind it */
.app-main--x-slider-visible {
  padding-bottom: 5rem;
}

/* AC3: Add right padding when Y slider is visible so content is not hidden behind it */
.app-main--y-slider-visible {
  padding-right: 5rem;
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

.slideout-validate-row {
  margin-top: 0.5rem;
}

.drawer-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

/* AC1: X slider pinned to the very bottom edge of the viewport */
.x-slider-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 90;
  background-color: var(--bg-surface);
  border-top: 1px solid var(--border-color);
  padding: 0.25rem 1rem;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
}

/* AC1: Y slider pinned to the right edge of the viewport (vertical orientation) */
.y-slider-bar {
  position: fixed;
  top: 0;
  bottom: 0;
  right: 0;
  z-index: 90;
  background-color: var(--bg-surface);
  border-left: 1px solid var(--border-color);
  padding: 1rem 0.25rem;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 4rem;
}

.y-slider-bar :deep(.master-slider) {
  writing-mode: vertical-lr;
  height: 100%;
  width: auto;
  border-bottom: none;
  margin-bottom: 0;
  padding: 0;
}

.y-slider-bar :deep(.master-slider__main) {
  flex-direction: column;
  align-items: center;
  height: 100%;
  gap: 0.5rem;
}

.y-slider-bar :deep(.master-slider__slider-wrapper) {
  flex: 1;
  min-width: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.y-slider-bar :deep(.master-slider__slider) {
  writing-mode: vertical-lr;
  width: auto;
  height: 100%;
}

.y-slider-bar :deep(.master-slider__label) {
  writing-mode: vertical-lr;
  white-space: nowrap;
}

.y-slider-bar :deep(.master-slider__value) {
  writing-mode: vertical-lr;
  white-space: nowrap;
}

@media (max-width: 767px) {
  .app-header {
    padding: 0.5rem;
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

  .x-slider-bar {
    padding: 0.25rem 0.5rem;
  }

  .y-slider-bar {
    padding: 0.5rem 0.25rem;
  }
}
</style>
