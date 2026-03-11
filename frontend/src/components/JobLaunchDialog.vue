<script setup lang="ts">
import { ref, computed, onMounted, watch, h, type VNode } from 'vue'
import {
  NModal,
  NSelect,
  NButton,
  NSpace,
  NAlert,
  NDivider,
  NCheckbox,
  NTag,
  NTooltip,
} from 'naive-ui'
import type { SelectRenderLabel } from 'naive-ui'
import type { TrainingRun, Study, StudyAvailability, CreateSampleJobPayload, SampleJob, ValidationResult } from '../api/types'
import { apiClient } from '../api/client'
import StudyEditor from './StudyEditor.vue'
import { useGenerateInputsPersistence } from '../composables/useGenerateInputsPersistence'
import { getTrainingRunDualBead, getStudyDualBead, DUAL_BEAD_COLORS, type DualBead } from '../composables/dualBeadStatus'

// TrainingRunStatus is kept for the filter logic (getRunStatus) but is no longer used for bead rendering.
// Bead rendering now uses the dual-bead system from dualBeadStatus.ts.
type TrainingRunStatus = 'complete' | 'partial' | 'running' | 'queued' | 'empty'

const props = defineProps<{
  show: boolean
  /** Incremented by the parent when a job completes via WebSocket, triggering a data refresh. */
  refreshTrigger?: number
  /** When set, pre-populates the dialog with the given job's settings for regeneration. */
  prefillJob?: SampleJob | null
  /**
   * When true, the dialog pre-checks "Generate missing samples only" (missingOnly=true)
   * and clears "Clear existing samples" (clearExisting=false) on prefill.
   * Used when launching from the validation results dialog (AC5: S-117).
   */
  prefillMissingOnly?: boolean
}>()

// update:show: Emitted when the dialog is opened or closed. Payload: boolean visibility state.
// success: Emitted after a sample job is successfully created. No payload.
const emit = defineEmits<{
  'update:show': [value: boolean]
  success: []
}>()

const loading = ref(false)
const error = ref<string | null>(null)

// Available options
const trainingRuns = ref<TrainingRun[]>([])
const sampleJobs = ref<SampleJob[]>([])
const studies = ref<Study[]>([])

// Study sample availability for the selected training run
const studyAvailability = ref<StudyAvailability[]>([])

// Study editor sub-dialog
const studyEditorOpen = ref(false)

// Training run filter: when true, show all runs; when false, show only gray (empty) runs
const showAllRuns = ref(true)

/** True while a manual refresh of the training runs list is in progress. */
const refreshingTrainingRuns = ref(false)

// Form selections
const selectedTrainingRunId = ref<number | null>(null)
const selectedStudy = ref<string | null>(null)

// Checkpoint selection for regeneration
const selectedCheckpoints = ref<Set<string>>(new Set())

// Whether to clear existing sample directories for selected checkpoints
const clearExisting = ref(false)

// Whether to generate only missing samples (skip existing output files)
const missingOnly = ref(false)

// Validation preview state
const validationResult = ref<ValidationResult | null>(null)
const validating = ref(false)

// Confirmation dialog for regenerating a fully-validated (complete) sample set
const confirmRegenOpen = ref(false)

// When true, the training run watcher skips checkpoint auto-selection to allow
// applyPrefill to control checkpoint selection instead.
const prefillActive = ref(false)

// When true, smart checkbox defaults have already been applied for the current
// training run + study combination. Reset when the run or study changes so that
// a fresh combo gets fresh defaults. Once set, manual user changes take effect
// without being overridden by subsequent validation re-fetches.
const validationDefaultsApplied = ref(false)

// Persistence composable
const persistence = useGenerateInputsPersistence()

// Computed: the selected training run object
const selectedTrainingRun = computed(() =>
  trainingRuns.value.find(r => r.id === selectedTrainingRunId.value) ?? null
)

// Compute status per training run based on job list and sample presence.
// Uses job data as the primary indicator because run.has_samples only checks
// root-level sample directories, not study-scoped ones ({sample_dir}/{study}/{checkpoint}/).
function getRunStatus(run: TrainingRun): TrainingRunStatus {
  const runJobs = sampleJobs.value.filter(j => j.training_run_name === run.name)
  const hasRunning = runJobs.some(j => j.status === 'running')
  const hasQueued = runJobs.some(j => j.status === 'pending' || j.status === 'stopped')
  const hasCompletedWithErrors = runJobs.some(j => j.status === 'completed_with_errors')
  const hasCompleted = runJobs.some(j => j.status === 'completed')
  if (hasRunning) return 'running'
  if (hasQueued) return 'queued'
  // completed_with_errors means some items failed → partial sample coverage
  if (hasCompletedWithErrors) return 'partial'
  // A successfully completed job means all samples were generated
  if (hasCompleted) return 'complete'
  // Legacy fallback: root-level has_samples check
  if (run.has_samples) return 'complete'
  return 'empty'
}

/**
 * Renders a bead circle element for use in NSelect renderLabel.
 * Returns null (no element) when color is null.
 * IMPORTANT: All styles must be inlined — renderLabel VNodes run outside scoped CSS context.
 */
function renderBeadSpan(color: string, title: string, testId: string): VNode {
  return h('span', {
    'data-testid': testId,
    style: {
      display: 'inline-block',
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      flexShrink: '0',
      backgroundColor: color,
    },
    title,
  })
}

// renderLabel function for the training run NSelect.
// NSelect does not support a #option slot — custom option rendering must be
// done via the renderLabel prop (a render function returning VNodeChild).
//
// IMPORTANT: VNodes returned from renderLabel are rendered outside Vue's scoped
// compilation context, so scoped CSS classes are NOT applied.
// All styles must be inlined directly on the element.
//
// Renders up to two beads per training run using the dual-bead system:
//   Slot 1 (activity): blue = running/pending job, green = all studies complete
//   Slot 2 (problem):  red = failed job, yellow = incomplete without running jobs
const renderTrainingRunLabel: SelectRenderLabel = (option) => {
  const dualBead = (option as { _dualBead?: DualBead })._dualBead

  const children: VNode[] = []

  if (dualBead) {
    // Slot 1: activity bead (blue/green)
    if (dualBead.activity === 'blue') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.blue, 'running', 'run-bead-activity'))
    } else if (dualBead.activity === 'green') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.green, 'complete', 'run-bead-activity'))
    }

    // Slot 2: problem bead (red/yellow)
    if (dualBead.problem === 'red') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.red, 'failed', 'run-bead-problem'))
    } else if (dualBead.problem === 'yellow') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.yellow, 'incomplete', 'run-bead-problem'))
    }
  }

  children.push(h('span', {}, String(option.label ?? '')))

  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } }, children)
}

// Training run select options (filtered by showAllRuns)
// Each option includes _dualBead metadata for the renderLabel function.
const trainingRunOptions = computed(() => {
  return trainingRuns.value
    .filter(run => {
      if (showAllRuns.value) return true
      return getRunStatus(run) === 'empty'
    })
    .map(run => {
      // Compute dual-bead for this training run:
      // - Study statuses come from ALL studyAvailability entries for ALL training runs;
      //   but since trainingRunOptions is not per-selected-run, we use the currently
      //   loaded studyAvailability (which is for the selected training run).
      //   For non-selected runs, we don't have availability data, so pass empty array.
      //
      // When a training run IS the selected run, use the loaded studyAvailability.
      // For other runs, studyStatuses = [] (no green bead unless it's the selected run).
      const studyStatuses = run.id === selectedTrainingRunId.value
        ? studyAvailability.value.map(a => a.sample_status)
        : []
      const dualBead = getTrainingRunDualBead(run.name, sampleJobs.value, studyStatuses)

      return {
        label: run.name,
        value: run.id,
        // Custom rendering via renderLabel
        _dualBead: dualBead,
      }
    })
})

// Whether the selected run has any existing samples or active jobs
const selectedRunHasSamples = computed(() => {
  const run = selectedTrainingRun.value
  if (!run) return false
  const status = getRunStatus(run)
  return status === 'complete' || status === 'partial' || status === 'running' || status === 'queued'
})

// Checkpoints of the selected training run
const selectedRunCheckpoints = computed(() => selectedTrainingRun.value?.checkpoints ?? [])

// Map of checkpoint filename -> error message for checkpoints that failed in the most
// recent completed_with_errors job for the selected training run.
const failedCheckpointMap = computed((): Map<string, string> => {
  const run = selectedTrainingRun.value
  if (!run) return new Map()

  // Find the most recent completed_with_errors job for this run
  const errorJobs = sampleJobs.value
    .filter(j => j.training_run_name === run.name && j.status === 'completed_with_errors')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  if (errorJobs.length === 0) return new Map()

  const mostRecentErrorJob = errorJobs[0]
  const details = mostRecentErrorJob.failed_item_details ?? []
  if (details.length === 0) return new Map()

  const result = new Map<string, string>()
  for (const detail of details) {
    // If multiple errors for the same checkpoint, join them
    const existing = result.get(detail.checkpoint_filename)
    if (existing) {
      result.set(detail.checkpoint_filename, `${existing}; ${detail.error_message}`)
    } else {
      result.set(detail.checkpoint_filename, detail.error_message)
    }
  }
  return result
})

// Initialize checkpoint selections and restore persisted inputs when the training run changes
watch(selectedTrainingRunId, async () => {
  const skipAutoSelection = prefillActive.value
  prefillActive.value = false

  // When prefill is active, skip all automatic state changes — the caller
  // (applyPrefill) has already set checkpoints, clearExisting, and form values.
  if (!skipAutoSelection) {
    selectedCheckpoints.value = new Set()
    clearExisting.value = false
    missingOnly.value = false
  }
  validationResult.value = null
  validationDefaultsApplied.value = false

  const run = selectedTrainingRun.value
  if (!run || run.checkpoints.length === 0) return

  if (!skipAutoSelection) {
    // Auto-select failed checkpoints if any exist for this training run,
    // otherwise select all checkpoints by default for regeneration
    const failedCps = failedCheckpointMap.value
    if (failedCps.size > 0) {
      selectedCheckpoints.value = new Set(failedCps.keys())
    } else if (selectedRunHasSamples.value) {
      selectedCheckpoints.value = new Set(run.checkpoints.map(c => c.filename))
    }

    // Note: clearExisting and missingOnly defaults are now handled by the
    // validationResult watcher (smart checkbox defaults per S-115).
    // After validation completes, it sets missingOnly=true for incomplete sets
    // and leaves clearExisting=false for complete sets.
  }

})

// Fetch study sample availability when training run changes
watch(selectedTrainingRunId, async (runId) => {
  studyAvailability.value = []
  if (runId === null) return

  try {
    studyAvailability.value = await apiClient.getStudyAvailability(runId)
  } catch {
    // Non-fatal; proceed without availability data
    studyAvailability.value = []
  }
})

// Trigger validation when training run + study are both selected
watch([selectedTrainingRunId, selectedStudy], async () => {
  validationResult.value = null
  validationDefaultsApplied.value = false
  if (selectedTrainingRunId.value === null || selectedStudy.value === null) return

  validating.value = true
  try {
    validationResult.value = await apiClient.validateTrainingRun(
      selectedTrainingRunId.value,
      selectedStudy.value,
    )
  } catch {
    // Validation fetch failure is non-fatal; proceed without preview
    validationResult.value = null
  } finally {
    validating.value = false
  }
})

// S-115: Apply smart checkbox defaults when validation results arrive.
// - Incomplete sample set (some missing): check "Generate missing only", uncheck "Clear existing"
// - Complete sample set (none missing): leave "Clear existing" unchecked (default)
//
// Defaults are applied only once per training run + study combination
// (guarded by validationDefaultsApplied). After the first application,
// manual user changes to either checkbox are respected and not overridden.
watch(validationResult, (result) => {
  // Only apply defaults when validation has returned a result and defaults
  // have not yet been applied for this run+study combination.
  if (!result) return
  if (validationDefaultsApplied.value) return

  if (hasMissingSamples.value) {
    // Incomplete sample set: default to generating only the missing ones.
    // Also clear clearExisting since missing_only and clear_existing are mutually exclusive.
    missingOnly.value = true
    clearExisting.value = false
  } else {
    // Complete sample set (or no samples): leave both checkboxes unchecked.
    // clearExisting was reset to false when the training run changed, so no action needed.
    // Explicitly ensure clearExisting stays false (not auto-set by old code path).
    clearExisting.value = false
  }

  validationDefaultsApplied.value = true
})

// Persist training run selection changes (AC3)
watch(selectedTrainingRunId, (runId) => {
  if (runId !== null) {
    persistence.saveTrainingRunId(runId)
  }
})

// Persist study selection changes
watch(selectedStudy, (studyId) => {
  persistence.saveStudyId(studyId)
})

function selectMissingCheckpoints() {
  selectedCheckpoints.value = new Set(missingCheckpointFilenames.value)
  clearExisting.value = false
}

function selectAllCheckpoints() {
  // Use validation result checkpoints when available (the displayed list), otherwise fall back to training run checkpoints
  if (validationResult.value) {
    selectedCheckpoints.value = new Set(validationResult.value.checkpoints.map(c => c.checkpoint))
  } else {
    selectedCheckpoints.value = new Set(selectedRunCheckpoints.value.map(c => c.filename))
  }
}

function deselectAllCheckpoints() {
  selectedCheckpoints.value = new Set()
}

function toggleCheckpoint(filename: string) {
  const next = new Set(selectedCheckpoints.value)
  if (next.has(filename)) {
    next.delete(filename)
  } else {
    next.add(filename)
  }
  selectedCheckpoints.value = next
}

// Study options include sample availability info and job status for dual-bead rendering.
// When a training run is selected:
//   Slot 1 (activity): blue = running/pending job for this study, green = sample_status='complete'
//   Slot 2 (problem):  red = failed job for this study, yellow = sample_status='partial' without running jobs
//
// For the currently selected study, validation results override directory-level availability
// to provide image-level accuracy (e.g. 590/684 → partial, not complete).
const studyOptions = computed(() => {
  const runName = selectedTrainingRun.value?.name ?? ''

  return studies.value.map(p => {
    const avail = studyAvailability.value.find(a => a.study_id === p.id)
    let sampleStatus = avail?.sample_status ?? 'none'

    // Override with validation results for the currently selected study.
    // The availability API only checks directory-level existence, which can report
    // 'complete' even when individual images are missing. Validation provides
    // image-level accuracy.
    if (p.id === selectedStudy.value && validationResult.value) {
      const vr = validationResult.value
      if (vr.total_actual === 0) {
        sampleStatus = 'none'
      } else if (vr.total_missing > 0) {
        sampleStatus = 'partial'
      } else {
        sampleStatus = 'complete'
      }
    }

    // Compute dual-bead for this study. Only possible when a training run is selected.
    const dualBead = runName
      ? getStudyDualBead(runName, p.id, sampleJobs.value, sampleStatus as 'none' | 'partial' | 'complete')
      : { activity: null, problem: null }

    // Checkpoint counts for tooltip — use availability data when present.
    // When validation overrides sampleStatus, the counts from availability still
    // reflect directory-level presence (close enough for tooltip context).
    const checkpointCounts = avail
      ? { withSamples: avail.checkpoints_with_samples, total: avail.total_checkpoints }
      : null

    return {
      label: p.name,
      value: p.id,
      // Metadata for bead rendering
      _sampleStatus: sampleStatus,
      _dualBead: dualBead,
      _checkpointCounts: checkpointCounts,
    }
  })
})

// renderLabel function for the study NSelect.
// Renders up to two beads per study using the dual-bead system.
//
// IMPORTANT: VNodes returned from renderLabel are rendered outside Vue's scoped
// compilation context, so scoped CSS classes are NOT applied. All styles must be inlined.
const renderStudyLabel: SelectRenderLabel = (option) => {
  const dualBead = (option as { _dualBead?: DualBead })._dualBead
  const counts = (option as { _checkpointCounts?: { withSamples: number; total: number } | null })._checkpointCounts

  // Build a human-readable checkpoint count tooltip, e.g. "3/5 checkpoints have samples"
  const checkpointCountTitle = counts
    ? `${counts.withSamples}/${counts.total} checkpoints have samples`
    : null

  const children: VNode[] = []

  if (dualBead) {
    // Slot 1: activity bead (blue/green)
    if (dualBead.activity === 'blue') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.blue, 'running', 'study-bead-activity'))
    } else if (dualBead.activity === 'green') {
      // Complete: show checkpoint counts in title (e.g. "5/5 checkpoints have samples")
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.green, checkpointCountTitle ?? 'complete', 'study-bead-activity'))
    }

    // Slot 2: problem bead (red/yellow)
    if (dualBead.problem === 'red') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.red, 'failed', 'study-bead-problem'))
    } else if (dualBead.problem === 'yellow') {
      // Partial: show checkpoint counts in title (e.g. "3/5 checkpoints have samples")
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.yellow, checkpointCountTitle ?? 'incomplete', 'study-bead-problem'))
    }
  }

  children.push(h('span', {}, String(option.label ?? '')))

  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } }, children)
}

const selectedStudyDetail = computed(() =>
  studies.value.find(p => p.id === selectedStudy.value)
)

// Effective checkpoints to use: when picker is shown, always use explicit selection
const effectiveCheckpointFilenames = computed((): string[] | undefined => {
  if (!selectedRunHasSamples.value) return undefined
  return Array.from(selectedCheckpoints.value)
})

// How many checkpoints will be targeted
const targetedCheckpointCount = computed(() => {
  if (!selectedRunHasSamples.value) {
    return selectedTrainingRun.value?.checkpoint_count ?? 0
  }
  return selectedCheckpoints.value.size
})

const totalCheckpoints = computed(() => selectedTrainingRun.value?.checkpoint_count ?? 0)

const imagesPerCheckpoint = computed(() =>
  selectedStudyDetail.value?.images_per_checkpoint ?? 0
)

const totalImages = computed(() => targetedCheckpointCount.value * imagesPerCheckpoint.value)

// Whether validation found missing samples (used for "Generate Missing" button visibility).
// Only true when SOME samples exist (total_actual > 0) AND some are missing. When zero
// samples exist for the study+training run, this is a "generate all" scenario, not
// "generate missing" (AC3: Generate Missing button only appears when some but not all exist).
const hasMissingSamples = computed(() => {
  if (!validationResult.value) return false
  return validationResult.value.total_actual > 0 &&
    validationResult.value.checkpoints.some(c => c.missing > 0)
})

// Whether the sample set is fully validated (all expected samples exist, none missing).
// This is the condition that requires a confirmation dialog before regeneration.
// AC4: No dialog when sample set has missing samples (incomplete validation).
// Note: total_missing can be negative when actual samples exceed expected count
// (e.g. more files on disk than the study requires). Both zero and negative values
// mean no samples are missing, so we use <= 0 rather than strict equality.
const isCompleteValidation = computed(() => {
  if (!validationResult.value) return false
  return validationResult.value.total_actual > 0 && validationResult.value.total_missing <= 0
})

// Checkpoints that have missing samples according to validation
const missingCheckpointFilenames = computed((): string[] => {
  if (!validationResult.value) return []
  return validationResult.value.checkpoints
    .filter(c => c.missing > 0)
    .map(c => c.checkpoint)
})

// Validation: when checkpoint picker is shown, at least one must be selected
const checkpointValidationError = computed((): string | null => {
  if (!selectedRunHasSamples.value) return null
  if (selectedRunCheckpoints.value.length === 0) return null
  if (selectedCheckpoints.value.size === 0) return 'Select at least one checkpoint to regenerate'
  return null
})

const canSubmit = computed(() => {
  return (
    selectedTrainingRunId.value !== null &&
    selectedStudy.value !== null &&
    checkpointValidationError.value === null
  )
})

// AC4: When refreshTrigger changes (job completed via WebSocket), refresh training run + job data
watch(() => props.refreshTrigger, () => {
  fetchTrainingRunsAndJobs()
})

// When the dialog opens with a prefillJob, re-fetch data and apply prefill settings.
// This handles the case where the dialog was already mounted from a previous open.
watch(() => props.show, async (newShow) => {
  if (!newShow || !props.prefillJob) return

  // Re-fetch data to ensure latest state
  await Promise.all([
    fetchTrainingRunsAndJobs(),
    fetchStudies(),
  ])

  applyPrefill(props.prefillJob)
})

onMounted(async () => {
  await Promise.all([
    fetchTrainingRunsAndJobs(),
    fetchStudies(),
  ])

  // If a prefill job is provided, apply its settings instead of restoring from persistence
  if (props.prefillJob) {
    applyPrefill(props.prefillJob)
    return
  }

  // Restore last used study (only if it's still in the available list).
  // If only one study exists, auto-select it regardless of persisted state.
  if (studies.value.length === 1) {
    selectedStudy.value = studies.value[0].id
  } else {
    const lastStudyId = persistence.getLastStudyId()
    if (lastStudyId !== null) {
      const studyExists = studies.value.some(s => s.id === lastStudyId)
      if (studyExists) {
        selectedStudy.value = lastStudyId
      }
    }
  }

  // AC3: Restore last used training run (only if it's still in the available list).
  // Since showAllRuns defaults to true, all runs are visible without filter expansion.
  const lastTrainingRunId = persistence.getLastTrainingRunId()
  if (lastTrainingRunId !== null) {
    const runExists = trainingRuns.value.some(r => r.id === lastTrainingRunId)
    if (runExists) {
      selectedTrainingRunId.value = lastTrainingRunId
    }
  }
})

async function fetchTrainingRunsAndJobs() {
  try {
    const [runs, jobs] = await Promise.all([
      apiClient.getCheckpointTrainingRuns(),
      apiClient.listSampleJobs(),
    ])
    trainingRuns.value = runs
    sampleJobs.value = jobs
  } catch {
    trainingRuns.value = []
    sampleJobs.value = []
  }
}

/** Manual refresh of the training run list (triggered by the refresh icon button). */
async function refreshTrainingRunsAndJobs() {
  refreshingTrainingRuns.value = true
  try {
    await fetchTrainingRunsAndJobs()
  } finally {
    refreshingTrainingRuns.value = false
  }
}

async function fetchStudies() {
  try {
    studies.value = await apiClient.listStudies()
  } catch {
    studies.value = []
  }
}

function close() {
  emit('update:show', false)
  resetForm()
}

function resetForm() {
  selectedTrainingRunId.value = null
  selectedStudy.value = null
  selectedCheckpoints.value = new Set()
  clearExisting.value = false
  missingOnly.value = false
  showAllRuns.value = true
  prefillActive.value = false
  validationResult.value = null
  validationDefaultsApplied.value = false
  validating.value = false
  studyAvailability.value = []
  error.value = null
  confirmRegenOpen.value = false
}

/**
 * Apply pre-fill settings from a completed job. Finds the training run by name,
 * expands the filter if needed, and sets all form fields from the job.
 *
 * Sets prefillActive=true so the training run watcher skips its automatic
 * checkpoint selection and persistence restoration, allowing this function
 * to control all form values.
 */
function applyPrefill(job: SampleJob) {
  // Find the training run by name
  const run = trainingRuns.value.find(r => r.name === job.training_run_name)
  if (!run) return

  // Expand filter if the run is not in the default (empty) filter
  const runStatus = getRunStatus(run)
  if (runStatus !== 'empty') {
    showAllRuns.value = true
  }

  // Set prefillActive so the training run watcher skips auto-selection
  prefillActive.value = true

  // Set training run (this triggers the watch, but it will skip checkpoint auto-selection)
  selectedTrainingRunId.value = run.id

  // Set study from the job (workflow, VAE, CLIP, shift now come from the study definition)
  selectedStudy.value = job.study_id

  // Handle checkpoint selection based on job status
  if (job.status === 'completed_with_errors' && job.failed_item_details && job.failed_item_details.length > 0) {
    // For completed_with_errors jobs, pre-select only failed checkpoints
    const failedFilenames = new Set(job.failed_item_details.map(d => d.checkpoint_filename))
    selectedCheckpoints.value = failedFilenames
  } else if (run.has_samples) {
    // For completed jobs, select all checkpoints
    selectedCheckpoints.value = new Set(run.checkpoints.map(c => c.filename))
  }

  if (props.prefillMissingOnly) {
    // AC5 (S-117): When launched from the validation dialog, pre-check "Generate missing
    // samples only" and do not clear existing samples.
    missingOnly.value = true
    clearExisting.value = false
  } else {
    // Auto-enable clear_existing for runs with existing samples
    if (run.has_samples) {
      clearExisting.value = true
    }
  }
}

function openStudyEditor() {
  studyEditorOpen.value = true
}

function closeStudyEditor() {
  studyEditorOpen.value = false
}

async function onStudySaved(study: Study) {
  await fetchStudies()
  selectedStudy.value = study.id
  // AC2: Auto-close the study editor sub-modal after saving
  studyEditorOpen.value = false
}

async function onStudyDeleted(studyId: string) {
  if (selectedStudy.value === studyId) {
    selectedStudy.value = null
  }
  await fetchStudies()
}

/**
 * Called when the Regenerate Samples / Generate Samples button is clicked.
 * For runs with a fully-validated (complete) sample set, shows a confirmation
 * dialog before proceeding. For runs with missing samples, proceeds directly.
 * AC1: Show confirmation when sample set is fully valid.
 * AC4: No confirmation when sample set has missing samples.
 */
async function submit() {
  if (!canSubmit.value || !selectedTrainingRun.value) return

  // AC1 + AC4: Show confirmation when the run has existing samples AND either:
  //   a) validation confirms all expected samples exist (isCompleteValidation), OR
  //   b) validation is still in progress (validating=true) — conservative: we can't
  //      yet confirm missing samples, so show the dialog to avoid data loss.
  //
  // The validating guard fixes a race condition where the user clicks Regenerate before
  // the validation API call returns: without it, validationResult is null,
  // isCompleteValidation is false, and the dialog is bypassed entirely.
  if (selectedRunHasSamples.value && (isCompleteValidation.value || validating.value)) {
    confirmRegenOpen.value = true
    return
  }

  await doSubmit()
}

/**
 * Called when the user confirms regeneration in the confirmation dialog.
 * AC3: Confirm proceeds with regeneration.
 */
async function handleRegenConfirm() {
  confirmRegenOpen.value = false
  await doSubmit()
}

/**
 * Called when the user cancels the confirmation dialog.
 * AC3: Cancel aborts the operation.
 */
function handleRegenCancel() {
  confirmRegenOpen.value = false
}

/** Performs the actual API call to create the sample job. */
async function doSubmit() {
  if (!selectedTrainingRun.value) return

  loading.value = true
  error.value = null

  try {
    const payload: CreateSampleJobPayload = {
      training_run_name: selectedTrainingRun.value.name,
      study_id: selectedStudy.value!,
    }

    if (selectedRunHasSamples.value) {
      // When missing_only is set, clear_existing is mutually exclusive
      if (missingOnly.value) {
        payload.missing_only = true
      } else {
        payload.clear_existing = clearExisting.value
      }
      if (effectiveCheckpointFilenames.value && effectiveCheckpointFilenames.value.length > 0) {
        payload.checkpoint_filenames = effectiveCheckpointFilenames.value
      }
    }

    await apiClient.createSampleJob(payload)
    emit('success')
    close()
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to create sample job'
    error.value = message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Generate Samples"
    style="max-width: 640px;"
    :on-close="close"
    @update:show="emit('update:show', $event)"
  >
    <NModal
      :show="studyEditorOpen"
      preset="card"
      title="Manage Studies"
      style="max-width: 860px;"
      :on-close="closeStudyEditor"
      @update:show="studyEditorOpen = $event"
    >
      <StudyEditor
        :initial-study-id="selectedStudy"
        @study-saved="onStudySaved"
        @study-deleted="onStudyDeleted"
      />
    </NModal>

    <!-- AC1-AC3: Confirmation dialog shown when regenerating a fully-validated sample set. -->
    <!-- AC2: Dialog explains that all expected samples already exist and regeneration will overwrite them. -->
    <NModal
      :show="confirmRegenOpen"
      preset="card"
      title="Regenerate All Samples?"
      style="max-width: 420px;"
      :mask-closable="true"
      data-testid="confirm-regen-dialog"
      @update:show="(val) => { if (!val) handleRegenCancel() }"
    >
      <div class="confirm-regen-body">
        <p class="confirm-regen-description" data-testid="confirm-regen-description">
          All expected samples already exist for this training run. Regenerating will overwrite them. Are you sure you want to continue?
        </p>
      </div>
      <div class="action-buttons">
        <NButton
          type="warning"
          data-testid="confirm-regen-button"
          @click="handleRegenConfirm"
        >
          Yes, Regenerate
        </NButton>
        <NButton
          data-testid="confirm-regen-cancel-button"
          @click="handleRegenCancel"
        >
          Cancel
        </NButton>
      </div>
    </NModal>

    <NSpace vertical :size="16">
      <NAlert v-if="error" type="error" closable @close="error = null">
        {{ error }}
      </NAlert>

      <!-- Training run selector (top position per UAT feedback) -->
      <div class="form-field">
        <div class="field-header">
          <label for="training-run-select">Training Run</label>
          <NCheckbox
            :checked="showAllRuns"
            data-testid="show-all-runs-checkbox"
            @update:checked="showAllRuns = $event; selectedTrainingRunId = null"
          >
            Show all (including with existing samples)
          </NCheckbox>
        </div>
        <div class="training-run-select-row">
          <NSelect
            id="training-run-select"
            v-model:value="selectedTrainingRunId"
            :options="trainingRunOptions"
            :render-label="renderTrainingRunLabel"
            placeholder="Select a training run"
            clearable
            filterable
            data-testid="training-run-select"
            class="training-run-select-input"
          />
          <!-- AC: Refresh icon button to manually reload the training run list -->
          <NButton
            size="medium"
            circle
            :loading="refreshingTrainingRuns"
            :disabled="refreshingTrainingRuns"
            aria-label="Refresh training run list"
            data-testid="refresh-training-run-button"
            @click="refreshTrainingRunsAndJobs"
          >
            <svg v-if="!refreshingTrainingRuns" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4C7.58 4 4 7.58 4 12s3.58 8 8 8 8-3.58 8-8h-2c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L11 13h7V6l-2.35 2.35z" fill="currentColor" />
            </svg>
          </NButton>
        </div>
      </div>

      <!-- Study selector (second position — selecting triggers auto-validate) -->
      <div class="form-field">
        <label for="study-select">Study</label>
        <div class="study-field-row">
          <NSelect
            id="study-select"
            v-model:value="selectedStudy"
            :options="studyOptions"
            :render-label="renderStudyLabel"
            placeholder="Select a study"
            clearable
            data-testid="study-select"
            class="study-select"
          />
          <NButton
            size="medium"
            data-testid="manage-studies-button"
            @click="openStudyEditor"
          >
            Manage Studies
          </NButton>
        </div>
      </div>

      <!-- Checkpoint validation status list — shown when training run + study are selected and validation completes.
           Matches the validate-style display from the main controls slideout (checkmark/warning icons, found/expected counts).
           For runs with existing samples, checkboxes allow selecting checkpoints for regeneration.
           For runs without samples, the list is display-only (all checkpoints are targeted). -->
      <div
        v-if="selectedStudy !== null && selectedTrainingRunId !== null && (validating || validationResult)"
        class="form-field"
        data-testid="checkpoint-picker"
      >
        <div class="field-header">
          <label>{{ selectedRunHasSamples ? 'Checkpoint Validation Status' : 'Checkpoint Status' }}</label>
          <div v-if="selectedRunHasSamples && validationResult" class="checkpoint-controls">
            <NButton
              v-if="hasMissingSamples"
              size="tiny"
              type="warning"
              data-testid="select-missing-checkpoints"
              @click="selectMissingCheckpoints"
            >
              Select Missing
            </NButton>
            <NButton
              size="tiny"
              data-testid="select-all-checkpoints"
              @click="selectAllCheckpoints"
            >
              Select All
            </NButton>
            <NButton
              size="tiny"
              data-testid="deselect-all-checkpoints"
              @click="deselectAllCheckpoints"
            >
              Deselect All
            </NButton>
          </div>
        </div>
        <!-- Validation totals summary -->
        <div v-if="validationResult" class="validation-totals" data-testid="validation-totals">
          <p class="validation-totals-text">
            {{ validationResult.total_actual }} / {{ validationResult.total_expected }} samples
            <span v-if="validationResult.total_missing > 0" class="validation-missing-text">
              ({{ validationResult.total_missing }} missing)
            </span>
          </p>
        </div>
        <p v-if="selectedRunHasSamples && validationResult" class="field-hint">
          {{ selectedCheckpoints.size === 0 ? 'No checkpoints selected' : `${selectedCheckpoints.size} of ${selectedRunCheckpoints.length} selected` }}
        </p>
        <p v-if="checkpointValidationError" class="field-error" data-testid="checkpoint-validation-error">
          {{ checkpointValidationError }}
        </p>
        <p v-if="validating" class="validation-loading">Validating sample completeness...</p>
        <div v-if="validationResult" class="checkpoint-list" data-testid="validation-results">
          <div
            v-for="cp in validationResult.checkpoints"
            :key="cp.checkpoint"
            class="checkpoint-row"
            :class="{ 'checkpoint-row--warning': cp.missing > 0 }"
            :data-testid="`checkpoint-row-${cp.checkpoint}`"
          >
            <NCheckbox
              v-if="selectedRunHasSamples"
              :checked="selectedCheckpoints.has(cp.checkpoint)"
              @update:checked="toggleCheckpoint(cp.checkpoint)"
            >
              <span
                class="validation-status-icon"
                :style="{ color: cp.missing === 0 ? '#18a058' : undefined }"
                :class="{ 'validation-status-icon--warning': cp.missing > 0 }"
              >
                {{ cp.missing === 0 ? '\u2713' : '\u26A0' }}
              </span>
              <span class="checkpoint-filename">{{ cp.checkpoint }}</span>
              <span class="validation-checkpoint-counts">
                {{ cp.verified }}/{{ cp.expected }}
              </span>
              <NTooltip v-if="failedCheckpointMap.has(cp.checkpoint)" trigger="hover">
                <template #trigger>
                  <NTag
                    size="tiny"
                    type="error"
                    class="failed-checkpoint-tag"
                    :data-testid="`checkpoint-failed-badge-${cp.checkpoint}`"
                  >
                    failed
                  </NTag>
                </template>
                {{ failedCheckpointMap.get(cp.checkpoint) }}
              </NTooltip>
            </NCheckbox>
            <!-- Display-only row for runs without samples -->
            <template v-else>
              <span
                class="validation-status-icon"
                :style="{ color: cp.missing === 0 ? '#18a058' : undefined }"
                :class="{ 'validation-status-icon--warning': cp.missing > 0 }"
              >
                {{ cp.missing === 0 ? '\u2713' : '\u26A0' }}
              </span>
              <span class="checkpoint-filename">{{ cp.checkpoint }}</span>
              <span class="validation-checkpoint-counts">
                {{ cp.verified }}/{{ cp.expected }}
              </span>
            </template>
          </div>
        </div>
        <NCheckbox
          v-if="selectedRunHasSamples && validationResult"
          :checked="clearExisting"
          :disabled="missingOnly"
          data-testid="clear-existing-checkbox"
          class="clear-existing-checkbox"
          @update:checked="clearExisting = $event"
        >
          Clear existing samples for selected checkpoints
        </NCheckbox>
        <NCheckbox
          v-if="selectedRunHasSamples && validationResult"
          :checked="missingOnly"
          data-testid="missing-only-checkbox"
          class="missing-only-checkbox"
          @update:checked="missingOnly = $event; if ($event) clearExisting = false"
        >
          Generate missing samples only (skip existing)
        </NCheckbox>
      </div>

      <NDivider />

      <div class="summary" data-testid="job-summary">
        <p><strong>Training Run:</strong> {{ selectedTrainingRun?.name ?? 'N/A' }}</p>
        <p><strong>Checkpoints:</strong> {{ totalCheckpoints }}</p>
        <p v-if="selectedRunHasSamples">
          <strong>Checkpoints to regenerate:</strong> {{ targetedCheckpointCount === totalCheckpoints ? 'All' : targetedCheckpointCount }}
        </p>
        <p><strong>Images per checkpoint:</strong> {{ imagesPerCheckpoint }}</p>
        <p class="total-images"><strong>Total images:</strong> {{ totalImages }}</p>
      </div>

      <div class="action-buttons">
        <NButton
          type="primary"
          :disabled="!canSubmit || loading"
          :loading="loading"
          @click="submit"
        >
          {{ loading ? 'Creating...' : (selectedRunHasSamples ? 'Regenerate Samples' : 'Generate Samples') }}
        </NButton>
        <NButton @click="close">
          Cancel
        </NButton>
      </div>
    </NSpace>
  </NModal>
</template>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.training-run-select-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.training-run-select-input {
  flex: 1;
}

.study-field-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.study-select {
  flex: 1;
}

.form-field label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-color);
}

.field-hint {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 0;
}

.checkpoint-controls {
  display: flex;
  gap: 0.375rem;
}

.checkpoint-list {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.checkpoint-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0;
}

.checkpoint-row--warning {
  color: var(--warning-color);
}

.checkpoint-filename {
  font-family: monospace;
  font-size: 0.8125rem;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.validation-status-icon {
  flex-shrink: 0;
  width: 1.25em;
  text-align: center;
}

.validation-status-icon--warning {
  color: var(--warning-color);
}

.validation-checkpoint-counts {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.failed-checkpoint-tag {
  margin-left: 0.5rem;
}

.validation-totals {
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

.field-error {
  font-size: 0.8125rem;
  color: var(--error-color);
  margin: 0;
  font-weight: 500;
}

.clear-existing-checkbox {
  margin-top: 0.5rem;
}

.missing-only-checkbox {
  margin-top: 0.25rem;
}

.validation-loading {
  font-style: italic;
  color: var(--text-secondary);
  margin: 0;
}

.summary {
  padding: 1rem;
  background: var(--bg-surface);
  border-radius: 0.25rem;
}

.summary p {
  margin: 0.5rem 0;
  color: var(--text-color);
}

.summary .total-images {
  font-size: 1.125rem;
  color: var(--accent-color);
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.confirm-regen-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.confirm-regen-description {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text-color);
  line-height: 1.5;
}
</style>
